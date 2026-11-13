import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function healthState(instance) {
  if (Number(instance.healthState) === 0 || /fail/i.test(instance.lifecycleStatus || '')) return 'unhealthy';
  if (Number(instance.healthState) === 1) return 'healthy';
  return 'unknown';
}

function validHeartTime(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= new Date('2000-01-01T00:00:00Z').getTime();
}

export function sanitizeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.relations) || !Array.isArray(snapshot.instances)) {
    throw new Error('快照结构不完整');
  }
  return {
    schemaVersion: 2,
    mode: 'live',
    capturedAt: new Date(snapshot.capturedAt || Date.now()).toISOString(),
    source: String(snapshot.source || 'EM Database').replace(/[\r\n]/g, ' ').slice(0, 120),
    products: snapshot.products.map(product => ({
      id: product.id,
      parentProductName: product.parentProductName || '',
      productName: product.productName || '',
      displayName: product.displayName || product.productName || '',
      version: product.version || '',
      isCurrentVersion: Boolean(product.isCurrentVersion),
      packageStatus: product.packageStatus || '',
      productType: Number(product.productType || 0),
      deployTime: product.deployTime || null
    })),
    relations: snapshot.relations.map(relation => ({
      id: relation.id,
      type: relation.type === 'conflict' ? 'conflict' : 'relyOn',
      sourceProduct: relation.sourceProduct || '',
      sourceService: relation.sourceService || '',
      targetProduct: relation.targetProduct || '',
      targetService: relation.targetService || '',
      updateTime: relation.updateTime || null
    })),
    instances: snapshot.instances.map(instance => ({
      id: instance.id,
      clusterId: instance.clusterId ?? null,
      productId: instance.productId ?? null,
      productName: instance.productName || '',
      productDisplayName: instance.productDisplayName || instance.productName || '',
      productVersion: instance.productVersion || '',
      serviceName: instance.serviceName || '',
      serviceDisplayName: instance.serviceDisplayName || instance.serviceName || '',
      serviceVersion: instance.serviceVersion || '',
      lifecycleStatus: instance.lifecycleStatus || '',
      healthState: Number(instance.healthState),
      prometheusPort: Number(instance.prometheusPort || 0),
      heartTime: instance.heartTime || null,
      updateTime: instance.updateTime || null,
      hostLabel: instance.hostLabel || '未知节点',
      lastDeployStatus: instance.lastDeployStatus || null,
      lastDeployProgress: instance.lastDeployProgress ?? null
    })),
    meta: {
      hostsMasked: snapshot.meta?.hostsMasked !== false,
      hostCount: Number(snapshot.meta?.hostCount || 0),
      productCount: Number(snapshot.meta?.productCount || snapshot.products.length),
      relationCount: Number(snapshot.meta?.relationCount || snapshot.relations.length),
      instanceCount: Number(snapshot.meta?.instanceCount || snapshot.instances.length)
    }
  };
}

export function effectiveProducts(snapshot) {
  const counts = new Map();
  snapshot.instances.forEach(instance => {
    const key = String(instance.productId ?? '');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const groups = new Map();
  snapshot.products.forEach(product => {
    if (!groups.has(product.productName)) groups.set(product.productName, []);
    groups.get(product.productName).push(product);
  });
  return [...groups.values()].map(candidates => [...candidates].sort((a, b) => {
    const instanceDelta = (counts.get(String(b.id)) || 0) - (counts.get(String(a.id)) || 0);
    if (instanceDelta) return instanceDelta;
    const currentDelta = Number(Boolean(b.isCurrentVersion)) - Number(Boolean(a.isCurrentVersion));
    if (currentDelta) return currentDelta;
    return Number(b.id || 0) - Number(a.id || 0);
  })[0]);
}

function serviceMap(snapshot) {
  const map = new Map();
  snapshot.instances.forEach(instance => {
    const key = `${instance.productName}\u0000${instance.serviceName}`;
    if (!map.has(key)) map.set(key, { productName: instance.productName, serviceName: instance.serviceName, instances: [] });
    map.get(key).instances.push(instance);
  });
  return new Map([...map].map(([key, value]) => [key, {
    ...value,
    count: value.instances.length,
    versions: unique(value.instances.map(instance => instance.serviceVersion)),
    hosts: unique(value.instances.map(instance => instance.hostLabel)),
    lifecycles: unique(value.instances.map(instance => instance.lifecycleStatus)),
    states: value.instances.reduce((result, instance) => {
      const state = healthState(instance);
      result[state] += 1;
      return result;
    }, { healthy: 0, unhealthy: 0, unknown: 0 }),
    missingHeartCount: value.instances.filter(instance => !validHeartTime(instance.heartTime)).length,
    deployFailures: value.instances.filter(instance => /fail/i.test(instance.lastDeployStatus || '')).length
  }]));
}

function relationMap(snapshot) {
  return new Map(snapshot.relations.map(relation => [
    `${relation.type}\u0000${relation.sourceProduct}\u0000${relation.sourceService}\u0000${relation.targetProduct}\u0000${relation.targetService}`,
    relation
  ]));
}

export function snapshotSummary(snapshot, id = null) {
  const products = effectiveProducts(snapshot);
  const services = serviceMap(snapshot);
  const health = snapshot.instances.reduce((result, instance) => {
    result[healthState(instance)] += 1;
    return result;
  }, { healthy: 0, unhealthy: 0, unknown: 0 });
  return {
    id,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    demo: /演示/.test(snapshot.source || ''),
    hostsMasked: snapshot.meta?.hostsMasked !== false,
    productCount: products.length,
    serviceCount: services.size,
    instanceCount: snapshot.instances.length,
    relationCount: snapshot.relations.length,
    hostCount: new Set(snapshot.instances.map(instance => instance.hostLabel).filter(Boolean)).size,
    health
  };
}

function change(kind, severity, objectType, productName, serviceName, title, before, after, detail) {
  return { id: `${kind}-${createHash('sha1').update(`${objectType}|${productName}|${serviceName}|${before}|${after}`).digest('hex').slice(0, 10)}`, kind, severity, objectType, productName, serviceName, title, before, after, detail };
}

function sameList(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffSnapshots(beforeSnapshot, afterSnapshot) {
  const beforeProducts = new Map(effectiveProducts(beforeSnapshot).map(product => [product.productName, product]));
  const afterProducts = new Map(effectiveProducts(afterSnapshot).map(product => [product.productName, product]));
  const beforeServices = serviceMap(beforeSnapshot);
  const afterServices = serviceMap(afterSnapshot);
  const beforeRelations = relationMap(beforeSnapshot);
  const afterRelations = relationMap(afterSnapshot);
  const changes = [];

  for (const [name, product] of afterProducts) {
    const before = beforeProducts.get(name);
    if (!before) {
      changes.push(change('product-added', 'medium', 'product', name, '', `${name} 新增`, '未部署', product.version || '版本未上报', '当前产品清单中新增'));
      continue;
    }
    if ((before.version || '') !== (product.version || '')) changes.push(change('product-version', 'high', 'product', name, '', `${name} 产品版本变化`, before.version || '未上报', product.version || '未上报', '建议核查服务版本、实例数量和下游影响'));
    if ((before.packageStatus || '') !== (product.packageStatus || '')) changes.push(change('package-status', /fail/i.test(product.packageStatus || '') ? 'high' : 'medium', 'product', name, '', `${name} 包状态变化`, before.packageStatus || '未上报', product.packageStatus || '未上报', '产品包记录状态发生变化'));
  }
  for (const [name, product] of beforeProducts) {
    if (!afterProducts.has(name)) changes.push(change('product-removed', 'high', 'product', name, '', `${name} 已从产品清单移除`, product.version || '已部署', '未部署', '请确认是否为计划内卸载'));
  }

  for (const [key, service] of afterServices) {
    const before = beforeServices.get(key);
    const label = `${service.productName} / ${service.serviceName}`;
    if (!before) {
      changes.push(change('service-added', 'medium', 'service', service.productName, service.serviceName, `${label} 新增`, '无实例', `${service.count} 个实例`, '当前实例表中新出现服务'));
      continue;
    }
    if (before.count !== service.count) changes.push(change('instance-count', service.count < before.count ? 'high' : 'medium', 'service', service.productName, service.serviceName, `${label} 实例数量变化`, String(before.count), String(service.count), service.count < before.count ? '实例减少，建议确认是否存在漏部署或异常退出' : '实例增加，请确认是否为计划内扩容'));
    if (!sameList(before.versions, service.versions)) changes.push(change('service-version', 'high', 'service', service.productName, service.serviceName, `${label} 服务版本变化`, before.versions.join(' / ') || '未上报', service.versions.join(' / ') || '未上报', '建议核对产品包版本与服务版本是否匹配'));
    if (!sameList(before.hosts, service.hosts)) changes.push(change('host-changed', 'medium', 'service', service.productName, service.serviceName, `${label} 部署节点变化`, before.hosts.join('、') || '未知', service.hosts.join('、') || '未知', '服务部署位置发生变化'));
    if (!sameList(before.lifecycles, service.lifecycles)) changes.push(change('lifecycle', service.lifecycles.some(value => /fail|stop/i.test(value)) ? 'high' : 'medium', 'service', service.productName, service.serviceName, `${label} 生命周期变化`, before.lifecycles.join(' / ') || '未上报', service.lifecycles.join(' / ') || '未上报', '实例生命周期状态发生变化'));
    if (before.states.unhealthy !== service.states.unhealthy || before.states.healthy !== service.states.healthy) changes.push(change('health', service.states.unhealthy > before.states.unhealthy ? 'high' : 'medium', 'service', service.productName, service.serviceName, `${label} 健康状态变化`, `${before.states.healthy} 健康 / ${before.states.unhealthy} 异常`, `${service.states.healthy} 健康 / ${service.states.unhealthy} 异常`, service.states.unhealthy > before.states.unhealthy ? '异常实例增加' : '健康状态发生恢复或调整'));
    if (before.missingHeartCount !== service.missingHeartCount) changes.push(change('heart', service.missingHeartCount > before.missingHeartCount ? 'high' : 'medium', 'service', service.productName, service.serviceName, `${label} 心跳上报变化`, `${before.missingHeartCount} 个未上报`, `${service.missingHeartCount} 个未上报`, '仅统计有效时间与未上报，不展示原始敏感信息'));
    if (before.deployFailures !== service.deployFailures) changes.push(change('deploy-status', service.deployFailures > before.deployFailures ? 'high' : 'medium', 'service', service.productName, service.serviceName, `${label} 最近部署状态变化`, `${before.deployFailures} 个失败`, `${service.deployFailures} 个失败`, '建议核查最近部署记录'));
  }
  for (const [key, service] of beforeServices) {
    if (!afterServices.has(key)) changes.push(change('service-removed', 'high', 'service', service.productName, service.serviceName, `${service.productName} / ${service.serviceName} 已无当前实例`, `${service.count} 个实例`, '无实例', '请确认是否为计划内卸载或服务丢失'));
  }

  for (const [key, relation] of afterRelations) {
    if (!beforeRelations.has(key)) changes.push(change('relation-added', 'medium', 'relation', relation.sourceProduct, relation.sourceService, `新增${relation.type === 'conflict' ? '冲突' : '依赖'}关系`, '无', `${relation.sourceProduct}/${relation.sourceService} → ${relation.targetProduct}/${relation.targetService}`, '模块关系表发生变化'));
  }
  for (const [key, relation] of beforeRelations) {
    if (!afterRelations.has(key)) changes.push(change('relation-removed', 'medium', 'relation', relation.sourceProduct, relation.sourceService, `移除${relation.type === 'conflict' ? '冲突' : '依赖'}关系`, `${relation.sourceProduct}/${relation.sourceService} → ${relation.targetProduct}/${relation.targetService}`, '无', '模块关系表发生变化'));
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  changes.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.productName.localeCompare(b.productName) || a.title.localeCompare(b.title));
  return {
    from: snapshotSummary(beforeSnapshot),
    to: snapshotSummary(afterSnapshot),
    summary: {
      total: changes.length,
      high: changes.filter(item => item.severity === 'high').length,
      medium: changes.filter(item => item.severity === 'medium').length,
      products: new Set(changes.map(item => item.productName).filter(Boolean)).size
    },
    changes
  };
}

export class SnapshotStore {
  constructor(directory) {
    this.directory = directory;
  }

  async ensure() {
    await mkdir(this.directory, { recursive: true });
  }

  async save(snapshot, label = '') {
    await this.ensure();
    const safe = sanitizeSnapshot(snapshot);
    const digest = createHash('sha256').update(JSON.stringify(safe)).digest('hex').slice(0, 8);
    const timestamp = safe.capturedAt.replace(/[:.]/g, '-');
    const suffix = label ? `-${String(label).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24)}` : '';
    const id = `${timestamp}${suffix}-${digest}`;
    await writeFile(join(this.directory, `${id}.json`), JSON.stringify(safe, null, 2), 'utf8');
    return snapshotSummary(safe, id);
  }

  async list() {
    await this.ensure();
    const files = (await readdir(this.directory)).filter(name => name.endsWith('.json'));
    const summaries = await Promise.all(files.map(async name => {
      try {
        const snapshot = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
        return snapshotSummary(snapshot, name.slice(0, -5));
      } catch {
        return null;
      }
    }));
    return summaries.filter(Boolean).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  }

  async load(id) {
    if (!SAFE_ID.test(id || '')) {
      const error = new Error('快照编号无效');
      error.code = 'INVALID_SNAPSHOT_ID';
      throw error;
    }
    return JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8'));
  }
}
