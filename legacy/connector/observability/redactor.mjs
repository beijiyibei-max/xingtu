const SECRET_PATTERNS = [
  [/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[私钥已脱敏]'],
  [/(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[^\s,;]+/gi, '$1=[凭据已脱敏]'],
  [/(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, '$1=[凭据已脱敏]'],
  [/((?:"|')?(?:password|passwd|pwd|token|secret|client[_-]?secret|api[_-]?key|access[_-]?key|refresh[_-]?token|session(?:id)?)(?:"|')?\s*:\s*)(["'])(.*?)\2/gi, '$1$2[已脱敏]$2'],
  [/\b(password|passwd|pwd|token|secret|client[_-]?secret|api[_-]?key|access[_-]?key|refresh[_-]?token|session(?:id)?)\s*[:=]\s*([^\s,;&]+)/gi, '$1=[已脱敏]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[凭据已脱敏]@'],
  [/\b(?:jdbc:(?:mysql|postgresql)|mysql|postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[数据库连接串已脱敏]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP已脱敏]'],
  [/\b(?:[a-f0-9]{1,4}:){3,7}[a-f0-9]{1,4}\b/gi, '[IPv6已脱敏]'],
  [/(?:\b[a-f0-9]{0,4})?::(?:[a-f0-9]{1,4}:?){1,7}\b/gi, '[IPv6已脱敏]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已脱敏]']
];

export function safeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function redactText(value) {
  let output = String(value ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) output = output.replace(pattern, replacement);
  return output;
}

function redactedField(value, maxLength) {
  return redactText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maxLength);
}

export function redactLog(log) {
  return {
    timestamp: safeTimestamp(log.timestamp),
    severity: redactedField(log.severity || 'INFO', 16).toUpperCase(),
    productName: redactedField(log.productName || '未映射产品', 160),
    serviceName: redactedField(log.serviceName || '未映射服务', 160),
    instanceId: redactedField(log.instanceId, 240),
    traceId: redactedField(log.traceId, 240),
    spanId: redactedField(log.spanId, 240),
    requestId: redactedField(log.requestId, 240),
    taskId: redactedField(log.taskId, 240),
    jobId: redactedField(log.jobId, 240),
    exceptionType: redactedField(log.exceptionType, 240),
    errorCode: redactedField(log.errorCode, 240),
    message: redactedField(log.message, 4000)
  };
}

export function normalizeFingerprint(value) {
  return redactText(value)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}
