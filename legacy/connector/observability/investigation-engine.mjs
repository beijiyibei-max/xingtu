import { randomUUID } from 'node:crypto';
import { DemoObservabilityAdapter } from './demo-adapter.mjs';
import { normalizeFingerprint, redactLog, redactText, safeTimestamp } from './redactor.mjs';

const MAX_LOGS = 500;
const MAX_SPANS = 200;
const MAX_ERROR_GROUPS = 100;
const MAX_RESULTS = 20;
const MAX_WINDOW_MINUTES = 120;
const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_RESULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SEARCH_TIMEOUT_MS = 10 * 1000;
const EVIDENCE_SOURCE_LABELS = { trace: 'Trace', log: '日志', em: 'EM健康', mapping: 'EM映射' };

function boundedText(value, maxLength = 240, fallback = '') {
  const text = redactText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return text || fallback;
}

function markdownInline(value, fallback = '') {
  return boundedText(value, 500, fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

function normalizeStatus(value) {
  const raw = typeof value === 'object' && value ? value.code : value;
  const status = String(raw ?? 'UNSET').toUpperCase();
  return ['ERROR', 'STATUS_CODE_ERROR', '2'].includes(status) ? 'ERROR' : ['OK', 'STATUS_CODE_OK', '1'].includes(status) ? 'OK' : 'UNSET';
}

function normalizedWindow(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_WINDOW_MINUTES;
  return Math.min(MAX_WINDOW_MINUTES, Math.max(1, Math.round(numeric)));
}

function serviceKey(productName, serviceName) {
  return `${productName || '未映射产品'}\u0000${serviceName || '未映射服务'}`;
}

function healthState(instance) {
  if (Number(instance.healthState) === 0) return 'unhealthy';
  if (Number(instance.healthState) === 1) return 'healthy';
  return 'unknown';
}

function fingerprintGroups(logs) {
  const groups = new Map();
  logs.filter(log => ['WARN', 'ERROR', 'FATAL'].includes(log.severity)).forEach(log => {
    const fingerprint = normalizeFingerprint(`${log.exceptionType} ${log.errorCode} ${log.message}`);
    const key = `${serviceKey(log.productName, log.serviceName)}\u0000${fingerprint}`;
    if (!groups.has(key)) groups.set(key, { fingerprint, productName: log.productName, serviceName: log.serviceName, severity: log.severity, count: 0, firstAt: log.timestamp, lastAt: log.timestamp, sample: log.message });
    const group = groups.get(key);
    group.count += 1;
    if (new Date(log.timestamp) < new Date(group.firstAt)) group.firstAt = log.timestamp;
    if (new Date(log.timestamp) > new Date(group.lastAt)) group.lastAt = log.timestamp;
  });
  return [...groups.values()].map(group => ({ ...group, spanMs: new Date(group.lastAt) - new Date(group.firstAt) })).sort((a, b) => new Date(a.firstAt) - new Date(b.firstAt));
}

function contextFor(snapshot, productName, serviceName) {
  const instances = (snapshot?.instances || []).filter(instance => instance.productName === productName && instance.serviceName === serviceName);
  const products = (snapshot?.products || []).filter(product => product.productName === productName);
  const currentProduct = products.find(product => product.isCurrentVersion) || products.at(-1);
  const relations = (snapshot?.relations || []).filter(relation =>
    (relation.sourceProduct === productName && relation.sourceService === serviceName) ||
    (relation.targetProduct === productName && relation.targetService === serviceName)
  );
  return {
    productName,
    serviceName,
    productVersion: currentProduct?.version || instances[0]?.productVersion || '未同步',
    serviceVersions: [...new Set(instances.map(instance => instance.serviceVersion).filter(Boolean))],
    instances: instances.map(instance => ({
      instanceId: String(instance.id ?? ''),
      hostLabel: instance.hostLabel || '未知节点',
      lifecycleStatus: instance.lifecycleStatus || '未知',
      lifecycleFailed: /fail|error|stop/i.test(instance.lifecycleStatus || ''),
      healthState: healthState(instance),
      heartTime: instance.heartTime || null
    })),
    relations: relations.map(relation => ({
      type: relation.type,
      direction: relation.sourceProduct === productName && relation.sourceService === serviceName ? 'outbound' : 'inbound',
      sourceProduct: relation.sourceProduct,
      sourceService: relation.sourceService,
      targetProduct: relation.targetProduct,
      targetService: relation.targetService
    }))
  };
}

function buildCandidates(spans, logs, groups, snapshot) {
  const candidates = new Map();
  const ensure = (productName, serviceName) => {
    const key = serviceKey(productName, serviceName);
    if (!candidates.has(key)) candidates.set(key, { key, productName, serviceName, score: 0, reasons: [], impactEvidence: [] });
    return candidates.get(key);
  };
  const add = (candidate, points, label, detail, source) => {
    candidate.score += points;
    candidate.reasons.push({ points, label, detail, source });
  };

  const errorLogs = logs.filter(log => ['ERROR', 'FATAL'].includes(log.severity)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const earliest = errorLogs[0];
  spans.forEach(item => {
    if (item.status !== 'ERROR' && !item.exceptionType && !item.errorCode && !item.slow) return;
    const candidate = ensure(item.productName, item.serviceName);
    if (item.status === 'ERROR') add(candidate, 25, '失败 Span', `${item.operation} 返回 ERROR`, 'trace');
    if (item.exceptionType || item.errorCode) add(candidate, 15, '明确异常', [item.exceptionType, item.errorCode].filter(Boolean).join(' · '), 'trace');
    if (item.slow) add(candidate, 10, '耗时异常', `${item.operation} 耗时 ${item.durationMs} ms，异常阈值由数据源标记`, 'trace');
  });
  const errorLogServices = new Map();
  errorLogs.forEach(log => {
    const key = serviceKey(log.productName, log.serviceName);
    if (!errorLogServices.has(key)) errorLogServices.set(key, { productName: log.productName, serviceName: log.serviceName, count: 0, hasCode: false });
    const entry = errorLogServices.get(key);
    entry.count += 1;
    entry.hasCode ||= Boolean(log.exceptionType || log.errorCode);
  });
  errorLogServices.forEach(entry => add(ensure(entry.productName, entry.serviceName), entry.hasCode ? 10 : 5, '错误日志', `${entry.count} 条 ERROR/FATAL${entry.hasCode ? '，包含异常类型或错误码' : ''}`, 'log'));
  if (earliest) add(ensure(earliest.productName, earliest.serviceName), 20, '当前证据中最早错误', `最早采集到的错误出现在 ${new Date(earliest.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`, 'log');
  groups.filter(group => group.count >= 3 && group.spanMs <= 5 * 60 * 1000).forEach(group => add(ensure(group.productName, group.serviceName), 10, '错误集中爆发', `同类错误在 ${Math.max(1, Math.ceil(group.spanMs / 1000))} 秒内出现 ${group.count} 次`, 'log'));

  for (const candidate of candidates.values()) {
    const context = contextFor(snapshot, candidate.productName, candidate.serviceName);
    const unhealthy = context.instances.filter(instance => instance.healthState === 'unhealthy' || instance.lifecycleFailed);
    if (unhealthy.length) add(candidate, 10, 'EM实例异常', `${unhealthy.length} 个实例存在健康或生命周期异常`, 'em');
    const childErrors = spans.filter(span => span.parentSpanId && span.status === 'ERROR');
    const parentIds = new Set(spans.filter(span => span.productName === candidate.productName && span.serviceName === candidate.serviceName).map(span => span.spanId));
    if (childErrors.some(span => parentIds.has(span.parentSpanId))) candidate.impactEvidence.push('下游 Span 出现失败，本服务可能是受影响调用方；该信息不计入起因分。');
    candidate.context = context;
    candidate.score = Math.min(100, candidate.score);
    candidate.recommendedChecks = [];
    if (candidate.reasons.some(reason => reason.source === 'trace')) candidate.recommendedChecks.push('在APM中打开该服务的失败Span，核对异常栈、状态码和直接子Span。');
    if (candidate.reasons.some(reason => reason.source === 'log')) candidate.recommendedChecks.push('使用本次Trace/Request ID与查询时间窗回日志平台查看异常前后文。');
    if (unhealthy.length) candidate.recommendedChecks.push('核对EM中异常实例的健康探针、生命周期和最近心跳。');
    if (!context.instances.length) candidate.recommendedChecks.push('确认日志服务名与EM产品/服务名映射，避免环境上下文漏关联。');
    candidate.recommendedChecks = candidate.recommendedChecks.slice(0, 3);
  }

  const ranked = [...candidates.values()].filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || String(a.serviceName).localeCompare(String(b.serviceName))).slice(0, 3);
  ranked.forEach(candidate => {
    const evidenceSources = new Set(candidate.reasons.map(reason => reason.source));
    if (candidate.context.instances.length || candidate.context.productVersion !== '未同步') evidenceSources.add('mapping');
    candidate.evidenceSources = [...evidenceSources].sort();
    candidate.confidence = candidate.score >= 70 && evidenceSources.size >= 3 ? 'high' : candidate.score >= 45 ? 'medium' : 'low';
  });
  return ranked;
}

function buildTraceTree(spans) {
  const byId = new Map(spans.map(span => [span.spanId, span]));
  const children = new Map();
  spans.forEach(span => {
    if (!children.has(span.parentSpanId)) children.set(span.parentSpanId, []);
    children.get(span.parentSpanId).push(span);
  });
  children.forEach(items => items.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)));
  const roots = spans.filter(span => !span.parentSpanId || !byId.has(span.parentSpanId));
  const nodes = [];
  const visited = new Set();
  const visit = (span, depth) => {
    if (visited.has(span.spanId)) return;
    visited.add(span.spanId);
    nodes.push({ ...span, depth });
    (children.get(span.spanId) || []).forEach(child => visit(child, depth + 1));
  };
  roots.forEach(root => visit(root, 0));
  spans.forEach(span => visit(span, 0));
  return {
    nodes,
    rootCount: roots.length,
    orphanCount: roots.filter(span => span.parentSpanId && !byId.has(span.parentSpanId)).length,
    complete: spans.length > 0 && roots.length === 1 && visited.size === spans.length
  };
}

function buildTimeline(spans, logs) {
  return [
    ...spans.map(span => ({
      type: 'span',
      timestamp: span.startTime,
      endTime: span.endTime,
      severity: span.status === 'ERROR' ? 'ERROR' : 'INFO',
      productName: span.productName,
      serviceName: span.serviceName,
      title: span.operation,
      detail: `${span.durationMs} ms · ${span.status}`,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      traceId: span.traceId || ''
    })),
    ...logs.map(log => ({
      type: 'log',
      timestamp: log.timestamp,
      severity: log.severity,
      productName: log.productName,
      serviceName: log.serviceName,
      title: log.exceptionType || log.errorCode || `${log.severity} 日志`,
      detail: log.message,
      spanId: log.spanId,
      traceId: log.traceId,
      requestId: log.requestId
    }))
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function reportFor(result) {
  const contextState = result.environmentContextAvailable ? `可用，映射覆盖率 ${result.quality.mappingRate}%` : '不可用，本次结论不包含部署与健康证据';
  const lines = [
    '# 星图故障定位报告', '',
    `- 调查编号：${markdownInline(result.id)}`,
    `- 查询条件：${markdownInline(result.query)}`,
    `- 环境边界：${markdownInline(result.queryScope.environmentName, '当前连接器环境')}`,
    `- 查询范围：最近 ${result.queryScope.windowMinutes} 分钟（${markdownInline(result.queryScope.startTime)} 至 ${markdownInline(result.queryScope.endTime)}）`,
    `- 生成时间：${new Date(result.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 数据模式：${result.mode === 'demo' ? '脱敏演示' : '现网只读'}`,
    `- 证据源：${markdownInline(result.sourceName, '未配置')}`,
    `- Trace ID：${markdownInline(result.traceId, '未获取')}`,
    `- Request ID：${markdownInline(result.requestId, '未获取')}`,
    `- EM环境上下文：${contextState}`,
    `- 数据质量：丢弃无效日志 ${result.summary.invalidLogCount} 条、无效Span ${result.summary.invalidSpanCount} 条${result.summary.truncatedLogCount || result.summary.truncatedSpanCount ? `；因数量限制省略日志 ${result.summary.truncatedLogCount} 条、Span ${result.summary.truncatedSpanCount} 条` : ''}`, '',
    '## 疑似故障点', ''
  ];
  result.candidates.forEach((candidate, index) => {
    lines.push(`### ${index + 1}. ${markdownInline(candidate.productName)} / ${markdownInline(candidate.serviceName)}`, '', `- 可信度：${candidate.confidence === 'high' ? '高' : candidate.confidence === 'medium' ? '中' : '低'}`, `- 证据分：${candidate.score}/100`, `- 独立证据：${candidate.evidenceSources.map(source => EVIDENCE_SOURCE_LABELS[source] || source).join('、')}`);
    candidate.reasons.forEach(reason => lines.push(`- +${reason.points} ${markdownInline(reason.label)}：${markdownInline(reason.detail)}`));
    candidate.impactEvidence.forEach(detail => lines.push(`- 影响范围：${markdownInline(detail)}`));
    candidate.recommendedChecks.forEach(detail => lines.push(`- 建议核验：${markdownInline(detail)}`));
    lines.push('');
  });
  if (!result.candidates.length) lines.push('- 当前证据不足，未生成疑似故障点。', '');
  lines.push('## 错误指纹', '');
  result.errorGroups.forEach(group => lines.push(`- ${markdownInline(group.productName)}/${markdownInline(group.serviceName)}：${group.count} 次；${markdownInline(group.sample)}`));
  if (!result.errorGroups.length) lines.push('- 未形成可归并的错误指纹。');
  lines.push('', `> ${markdownInline(result.disclaimer)}`);
  return lines.join('\n');
}

export class InvestigationEngine {
  constructor({ snapshotProvider, adapter = new DemoObservabilityAdapter(), resultTtlMs = DEFAULT_RESULT_TTL_MS, searchTimeoutMs = DEFAULT_SEARCH_TIMEOUT_MS, environmentName = '当前连接器环境' }) {
    this.snapshotProvider = snapshotProvider;
    this.adapter = adapter;
    this.results = new Map();
    this.resultTtlMs = resultTtlMs;
    this.searchTimeoutMs = searchTimeoutMs;
    this.environmentName = boundedText(environmentName, 160, '当前连接器环境');
  }

  sources() {
    return { sources: [this.adapter.describe()], presets: this.adapter.presets() };
  }

  async investigate(input = {}) {
    const query = boundedText(input.query, 240);
    const scenario = boundedText(input.scenario, 120);
    if (!query && !scenario) {
      const error = new Error('请输入 Trace ID、Request ID、服务名或错误内容。');
      error.code = 'INVESTIGATION_QUERY_REQUIRED';
      throw error;
    }
    const windowMinutes = normalizedWindow(input.windowMinutes);
    const queryEnd = new Date();
    const queryStart = new Date(queryEnd.getTime() - windowMinutes * 60 * 1000);
    const searchStartedAt = Date.now();
    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        const error = new Error('证据源查询超时');
        error.code = 'OBSERVABILITY_TIMEOUT';
        reject(error);
      }, this.searchTimeoutMs);
      timeout.unref?.();
    });
    let raw;
    try {
      raw = await Promise.race([
        this.adapter.search({ query, scenario, environmentName: this.environmentName, windowMinutes, startTime: queryStart.toISOString(), endTime: queryEnd.toISOString(), maxLogs: MAX_LOGS, maxSpans: MAX_SPANS, signal: controller.signal }),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeout);
    }
    const searchElapsedMs = Date.now() - searchStartedAt;
    const snapshot = await this.snapshotProvider();
    const rawLogs = Array.isArray(raw?.logs) ? raw.logs : [];
    const rawSpans = Array.isArray(raw?.spans) ? raw.spans : [];
    const sanitizedLogs = rawLogs.slice(0, MAX_LOGS).map(redactLog);
    const logs = sanitizedLogs.filter(log => log.timestamp);
    const sanitizedSpans = rawSpans.slice(0, MAX_SPANS).map(item => {
      const startTime = safeTimestamp(item.startTime);
      const endTime = safeTimestamp(item.endTime);
      const measuredDuration = startTime && endTime ? new Date(endTime) - new Date(startTime) : NaN;
      const providedDuration = Number(item.durationMs);
      return {
        spanId: boundedText(item.spanId, 240),
        parentSpanId: boundedText(item.parentSpanId, 240),
        traceId: boundedText(item.traceId || raw?.traceId, 240),
        productName: boundedText(item.productName, 160, '未映射产品'),
        serviceName: boundedText(item.serviceName, 160, '未映射服务'),
        operation: boundedText(item.operation, 500, '未命名操作'),
        startTime,
        endTime,
        durationMs: Number.isFinite(providedDuration) ? Math.max(0, providedDuration) : Number.isFinite(measuredDuration) ? Math.max(0, measuredDuration) : 0,
        status: normalizeStatus(item.status),
        exceptionType: boundedText(item.exceptionType, 240),
        errorCode: boundedText(item.errorCode, 240),
        slow: Boolean(item.slow)
      };
    });
    const spans = sanitizedSpans.filter(span => span.startTime && span.endTime && span.spanId);
    const traceIds = new Set(spans.map(span => span.traceId).filter(Boolean));
    if (traceIds.size > 1) {
      const error = new Error('查询结果包含多条Trace');
      error.code = 'OBSERVABILITY_MULTIPLE_TRACES';
      throw error;
    }
    const allErrorGroups = fingerprintGroups(logs);
    const errorGroups = allErrorGroups.slice(0, MAX_ERROR_GROUPS);
    const candidates = buildCandidates(spans, logs, allErrorGroups, snapshot);
    const traceStructure = buildTraceTree(spans);
    const evidenceServices = new Map([...spans, ...logs].map(item => [serviceKey(item.productName, item.serviceName), [item.productName, item.serviceName]]));
    const mappedServices = [...evidenceServices.values()].filter(([productName, serviceName]) => {
      const context = contextFor(snapshot, productName, serviceName);
      return context.instances.length > 0 || context.productVersion !== '未同步';
    }).length;
    const source = this.adapter.describe();
    const environmentContextAvailable = snapshot?.meta?.contextAvailable !== false;
    const result = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.resultTtlMs).toISOString(),
      mode: source.mode,
      sourceName: boundedText(source.name, 160, '未配置证据源'),
      sourceNotice: boundedText(source.notice, 500),
      query: query || boundedText(raw?.traceId, 240),
      scenario: boundedText(raw?.scenario, 120),
      title: boundedText(raw?.title, 240, '故障证据调查'),
      traceId: boundedText(raw?.traceId, 240),
      requestId: boundedText(raw?.requestId, 240),
      environmentContextAvailable,
      queryScope: {
        environmentName: this.environmentName,
        windowMinutes,
        startTime: queryStart.toISOString(),
        endTime: queryEnd.toISOString(),
        maxLogs: MAX_LOGS,
        maxSpans: MAX_SPANS
      },
      freshness: {
        evidenceQueriedAt: new Date().toISOString(),
        evidenceQueryElapsedMs: searchElapsedMs,
        environmentCapturedAt: safeTimestamp(snapshot?.capturedAt)
      },
      quality: {
        evidenceServiceCount: evidenceServices.size,
        mappedServiceCount: environmentContextAvailable ? mappedServices : 0,
        mappingRate: environmentContextAvailable && evidenceServices.size ? Math.round(mappedServices / evidenceServices.size * 100) : 0,
        traceRootCount: traceStructure.rootCount,
        orphanSpanCount: traceStructure.orphanCount,
        traceComplete: traceStructure.complete
      },
      summary: {
        spanCount: spans.length,
        logCount: logs.length,
        errorLogCount: logs.filter(log => ['ERROR', 'FATAL'].includes(log.severity)).length,
        candidateCount: candidates.length,
        invalidLogCount: sanitizedLogs.length - logs.length,
        invalidSpanCount: sanitizedSpans.length - spans.length,
        truncatedLogCount: Math.max(0, rawLogs.length - MAX_LOGS),
        truncatedSpanCount: Math.max(0, rawSpans.length - MAX_SPANS),
        truncatedErrorGroupCount: Math.max(0, allErrorGroups.length - MAX_ERROR_GROUPS)
      },
      spans,
      traceStructure,
      logs,
      timeline: buildTimeline(spans, logs),
      errorGroups,
      candidates,
      disclaimer: source.mode === 'demo' ? '定位结果为证据排序，不代表已经确定根因；当前为内置脱敏演示数据，不代表真实环境。' : '定位结果为证据排序，不代表已经确定根因；请回到原始日志与Trace平台核验。'
    };
    result.reportMarkdown = redactText(reportFor(result));
    this.prune();
    this.results.set(result.id, result);
    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value);
    return result;
  }

  prune() {
    const now = Date.now();
    for (const [id, result] of this.results) {
      if (new Date(result.expiresAt).getTime() <= now) this.results.delete(id);
    }
  }

  get(id) {
    this.prune();
    return this.results.get(id) || null;
  }
}
