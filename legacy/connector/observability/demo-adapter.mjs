function at(base, offsetMs) {
  return new Date(base.getTime() + offsetMs).toISOString();
}

function span(base, input) {
  return {
    spanId: input.spanId,
    parentSpanId: input.parentSpanId || '',
    productName: input.productName,
    serviceName: input.serviceName,
    operation: input.operation,
    startTime: at(base, input.startMs),
    endTime: at(base, input.startMs + input.durationMs),
    durationMs: input.durationMs,
    status: input.status || 'OK',
    exceptionType: input.exceptionType || '',
    errorCode: input.errorCode || '',
    slow: Boolean(input.slow)
  };
}

function log(base, input) {
  return {
    timestamp: at(base, input.atMs),
    severity: input.severity,
    productName: input.productName,
    serviceName: input.serviceName,
    instanceId: input.instanceId || '',
    traceId: input.traceId,
    spanId: input.spanId || '',
    requestId: input.requestId || '',
    exceptionType: input.exceptionType || '',
    errorCode: input.errorCode || '',
    message: input.message
  };
}

function databaseTimeout(base) {
  const traceId = 'demo-trace-db-timeout';
  const requestId = 'REQ-DEMO-2401';
  const spans = [
    span(base, { spanId: 'span-batch', productName: 'DTBatch', serviceName: 'Batch', operation: 'POST /task/submit', startMs: 0, durationMs: 1480, status: 'ERROR' }),
    span(base, { spanId: 'span-batch-sql', parentSpanId: 'span-batch', productName: 'DTBatch', serviceName: 'BatchSql', operation: 'load task metadata', startMs: 35, durationMs: 1360, status: 'ERROR', exceptionType: 'SQLTransientConnectionException', errorCode: 'DB_POOL_TIMEOUT' }),
    span(base, { spanId: 'span-mysql', parentSpanId: 'span-batch-sql', productName: 'DTBase', serviceName: 'mysql', operation: 'acquire connection', startMs: 62, durationMs: 1210, status: 'ERROR', exceptionType: 'ConnectionPoolExhausted', errorCode: 'TOO_MANY_CONNECTIONS', slow: true })
  ];
  const logs = [
    log(base, { atMs: 115, severity: 'ERROR', productName: 'DTBase', serviceName: 'mysql', instanceId: 'demo-mysql-01', traceId, spanId: 'span-mysql', requestId, exceptionType: 'ConnectionPoolExhausted', errorCode: 'TOO_MANY_CONNECTIONS', message: 'connection backlog saturated; available=0 active=120' }),
    log(base, { atMs: 170, severity: 'ERROR', productName: 'DTBase', serviceName: 'mysql', instanceId: 'demo-mysql-01', traceId, spanId: 'span-mysql', requestId, exceptionType: 'ConnectionPoolExhausted', errorCode: 'TOO_MANY_CONNECTIONS', message: 'connection backlog saturated; available=0 active=121' }),
    log(base, { atMs: 260, severity: 'ERROR', productName: 'DTBase', serviceName: 'mysql', instanceId: 'demo-mysql-01', traceId, spanId: 'span-mysql', requestId, exceptionType: 'ConnectionPoolExhausted', errorCode: 'TOO_MANY_CONNECTIONS', message: 'connection backlog saturated; available=0 active=122' }),
    log(base, { atMs: 1290, severity: 'ERROR', productName: 'DTBatch', serviceName: 'BatchSql', instanceId: 'demo-batchsql-01', traceId, spanId: 'span-batch-sql', requestId, exceptionType: 'SQLTransientConnectionException', errorCode: 'DB_POOL_TIMEOUT', message: 'failed to acquire database connection after 1200ms' }),
    log(base, { atMs: 1420, severity: 'ERROR', productName: 'DTBatch', serviceName: 'Batch', instanceId: 'demo-batch-01', traceId, spanId: 'span-batch', requestId, errorCode: 'UPSTREAM_FAILURE', message: 'task submit failed because metadata service returned upstream error' })
  ];
  return { scenario: 'db-timeout', title: '数据库连接池耗尽', traceId, requestId, spans, logs };
}

function validationFailure(base) {
  const traceId = 'demo-trace-api-validation';
  const requestId = 'REQ-DEMO-2402';
  const spans = [
    span(base, { spanId: 'span-api', productName: 'DTApi', serviceName: 'Api', operation: 'POST /api/publish', startMs: 0, durationMs: 86, status: 'ERROR', exceptionType: 'ValidationException', errorCode: 'INVALID_ARGUMENT' })
  ];
  const logs = [
    log(base, { atMs: 34, severity: 'ERROR', productName: 'DTApi', serviceName: 'Api', instanceId: 'demo-api-01', traceId, spanId: 'span-api', requestId, exceptionType: 'ValidationException', errorCode: 'INVALID_ARGUMENT', message: 'request validation failed: required field is missing' })
  ];
  return { scenario: 'api-validation', title: '接口参数校验失败', traceId, requestId, spans, logs };
}

function slowBatch(base) {
  const traceId = 'demo-trace-slow-batch';
  const requestId = 'REQ-DEMO-2403';
  const spans = [
    span(base, { spanId: 'span-batch', productName: 'DTBatch', serviceName: 'Batch', operation: 'GET /task/list', startMs: 0, durationMs: 4380, status: 'ERROR' }),
    span(base, { spanId: 'span-batch-sql', parentSpanId: 'span-batch', productName: 'DTBatch', serviceName: 'BatchSql', operation: 'query task list', startMs: 42, durationMs: 4210, status: 'ERROR', exceptionType: 'QueryTimeoutException', errorCode: 'QUERY_TIMEOUT', slow: true })
  ];
  const logs = [
    log(base, { atMs: 4050, severity: 'WARN', productName: 'DTBatch', serviceName: 'BatchSql', instanceId: 'demo-batchsql-01', traceId, spanId: 'span-batch-sql', requestId, message: 'query duration exceeded warning threshold: elapsed=4000ms' }),
    log(base, { atMs: 4230, severity: 'ERROR', productName: 'DTBatch', serviceName: 'BatchSql', instanceId: 'demo-batchsql-01', traceId, spanId: 'span-batch-sql', requestId, exceptionType: 'QueryTimeoutException', errorCode: 'QUERY_TIMEOUT', message: 'task list query timed out after 4200ms' }),
    log(base, { atMs: 4350, severity: 'ERROR', productName: 'DTBatch', serviceName: 'Batch', instanceId: 'demo-batch-01', traceId, spanId: 'span-batch', requestId, errorCode: 'UPSTREAM_TIMEOUT', message: 'request failed because BatchSql timed out' })
  ];
  return { scenario: 'slow-batch', title: '批处理查询超时', traceId, requestId, spans, logs };
}

export class DemoObservabilityAdapter {
  describe() {
    return {
      id: 'demo-observability',
      name: '脱敏日志与Trace演示源',
      mode: 'demo',
      logs: true,
      traces: true,
      configured: true,
      notice: '当前证据为内置脱敏演示数据，不代表真实环境。'
    };
  }

  presets() {
    return [
      { id: 'db-timeout', label: '数据库连接池耗尽', query: 'demo-trace-db-timeout' },
      { id: 'api-validation', label: '接口参数错误', query: 'demo-trace-api-validation' },
      { id: 'slow-batch', label: '批处理查询超时', query: 'demo-trace-slow-batch' }
    ];
  }

  async search(input = {}) {
    const base = new Date(Date.now() - 2 * 60 * 1000);
    const query = String(input.query || '').trim().toLowerCase();
    const scenario = String(input.scenario || '').toLowerCase();
    const scenarios = [databaseTimeout(base), validationFailure(base), slowBatch(base)];
    if (scenario) {
      const selected = scenarios.find(item => item.scenario === scenario);
      if (selected) return selected;
      const error = new Error('未知演示场景');
      error.code = 'OBSERVABILITY_NO_MATCH';
      throw error;
    }

    const ranked = scenarios.map(item => {
      if (item.traceId.toLowerCase() === query || item.requestId.toLowerCase() === query) return { item, score: 100 };
      const fields = [
        item.title,
        item.traceId,
        item.requestId,
        ...item.spans.flatMap(span => [span.productName, span.serviceName, span.operation, span.exceptionType, span.errorCode]),
        ...item.logs.flatMap(entry => [entry.productName, entry.serviceName, entry.exceptionType, entry.errorCode, entry.message])
      ].filter(Boolean).map(value => String(value).toLowerCase());
      const exact = fields.some(value => value === query);
      const partial = query.length >= 3 && fields.some(value => value.includes(query));
      return { item, score: exact ? 60 : partial ? 30 : 0 };
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      const error = new Error('演示证据中没有匹配项');
      error.code = 'OBSERVABILITY_NO_MATCH';
      throw error;
    }
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
      const error = new Error('演示证据匹配到多条链路');
      error.code = 'OBSERVABILITY_AMBIGUOUS';
      throw error;
    }
    return ranked[0].item;
  }
}
