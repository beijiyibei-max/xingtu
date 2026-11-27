/* 统一请求封装：信封解析、401 跳登录、网络错误翻成人话。
   新页面一律走这里；orders-ui 已切换，其余页面下一轮。 */

export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const NETWORK_DOWN = '服务端没起来：无法连接后端，请确认它已启动，且 /api 代理指向本机服务。';
const PROXY_WRONG = '代理没配对：/api 返回的不是 JSON，请检查反向代理是否指向星图服务。';

function toLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = '/login?next=' + next;
}

/**
 * 发一次请求并解开 {success, error} 信封。
 * @param {string} path 以 / 开头的同源路径
 * @param {{method?:string, body?:unknown, headers?:Record<string,string>, timeout?:number, onUnauthorized?:()=>void}} [options]
 * @returns {Promise<any>} 解包后的响应体
 */
export async function request(path, { method = 'GET', body, headers, timeout = 15000, onUnauthorized } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(NETWORK_DOWN, { code: 'NETWORK_DOWN' });
  }

  if ([502, 503, 504].includes(response.status)) {
    throw new ApiError('服务端没起来：网关拿不到后端响应（HTTP ' + response.status + '），请确认星图服务已启动。', { code: 'NETWORK_DOWN', status: response.status });
  }

  if (response.status === 401) {
    (onUnauthorized || toLogin)();
    throw new ApiError('登录过期了，请重新登录。', { code: 'AUTH_REQUIRED', status: 401 });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (payload === null) throw new ApiError(PROXY_WRONG, { code: 'PROXY_MISCONFIGURED', status: response.status });

  if (payload.success === false || payload.error) {
    const failure = payload.error || {};
    throw new ApiError(failure.message || '请求失败。', { code: failure.code || 'REQUEST_FAILED', status: response.status });
  }
  if (response.status >= 500) {
    throw new ApiError('服务端没起来：请求已到达，但服务返回了 5xx，请看服务端日志。', { code: 'SERVER_ERROR', status: response.status });
  }
  if (!response.ok) {
    throw new ApiError(payload.message || `请求失败（HTTP ${response.status}）。`, { code: payload.code || 'HTTP_ERROR', status: response.status });
  }
  return payload?.success === true && payload.data !== undefined ? payload.data : payload;
}
