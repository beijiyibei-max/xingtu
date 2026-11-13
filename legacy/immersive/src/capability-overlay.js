/**
 * 能力矩阵 · 沉浸版集成模块
 *
 * 在 3D 宇宙之上提供一个玻璃质感的能力矩阵面板，两套形态：
 *   7.0 K8s      —— 依赖对象就绪 × 配置指向（数据来自 xt-blackbox 采集）
 *   6.3 主机化   —— 进程/端口/配置三类判据（数据待主机化采集器接入）
 *
 * 面板不联网，除了可选的「从服务器同步」（同源 /api/latest）。
 */

const TONE = {
  '已启用': 'ok', '已部署': 'ok',
  '装了没用': 'warn', '未达高可用': 'warn',
  '配了没生效': 'bad', '配置悬空': 'bad',
  '需人工核验': 'idle', '未部署': 'idle', '未采集': 'idle', '未导入': 'idle'
};

/* 没有采集结果时用的示例数据（脱敏，仅用于看清界面） */
const DEMO = {
  generatedAt: '示例数据',
  capabilities: [
    { id: 'redis-single', state: '已启用' }, { id: 'nacos-cluster', state: '未达高可用' },
    { id: 'kafka-ha', state: '未达高可用' }, { id: 'platform-ha', state: '配了没生效' },
    { id: 'ai-capability', state: '装了没用' }, { id: 's3-backend', state: '已启用' },
    { id: 'es-cluster', state: '已部署' }, { id: 'cert-manager', state: '已部署' },
    { id: 'mysql-ha', state: '未达高可用' }, { id: 'redis-ha', state: '未部署' }
  ],
  workloads: [
    { ns: 'multimodal', name: 'nacos', kind: 'StatefulSet', ready: '1/1' },
    { ns: 'multimodal', name: 'redis-standalone-master', kind: 'StatefulSet', ready: '1/1' },
    { ns: 'multimodal', name: 'kafka', kind: 'StatefulSet', ready: '1/1' },
    { ns: 'multimodal', name: 'mysql', kind: 'StatefulSet', ready: '1/1' },
    { ns: 'minio', name: 'minio', kind: 'StatefulSet', ready: '1/1' }
  ],
  pods: [
    { ns: 'multimodal', name: 'nacos-0', node: 'node-a', phase: 'Running', ready: '1/1', restarts: 0 },
    { ns: 'multimodal', name: 'redis-standalone-master-0', node: 'node-b', phase: 'Running', ready: '1/1', restarts: 2 },
    { ns: 'multimodal', name: 'kafka-0', node: 'node-a', phase: 'Running', ready: '1/1', restarts: 0 },
    { ns: 'multimodal', name: 'mysql-0', node: 'node-c', phase: 'Running', ready: '1/1', restarts: 1 },
    { ns: 'multimodal', name: 'aiworks-0', node: 'node-c', phase: 'Running', ready: '1/1', restarts: 0 },
    { ns: 'multimodal', name: 'zookeeper-0', node: 'node-a', phase: 'Running', ready: '1/1', restarts: 2 },
    { ns: 'minio', name: 'minio-0', node: 'node-b', phase: 'Running', ready: '1/1', restarts: 0 },
    { ns: 'multimodal', name: 'gateway-7d9f-abc', node: 'node-d', phase: 'Running', ready: '1/1', restarts: 0 },
    { ns: 'multimodal', name: 'batch-8c1e-xyz', node: 'node-d', phase: 'Pending', ready: '0/1', restarts: 0 },
    { ns: 'kube-starrocks', name: 'kube-starrocks-be-0', node: 'node-c', phase: 'Running', ready: '1/1', restarts: 0 }
  ]
};
const state = {
  form: 'k8s',
  view: 'pods',
  open: false,
  selected: null,
  live: null,
  error: ''
};

let caps = [];
let hostCaps = [];
let els = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

function stateOf(id) {
  if (!state.live) return '未导入';
  return state.live.states[id] || '未导入';
}

function toneOf(id) {
  return TONE[stateOf(id)] || 'idle';
}

function currentCaps() {
  return state.form === 'k8s' ? caps : hostCaps;
}

function build() {
  const root = document.createElement('div');
  root.className = 'cap-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="cap-shell">
      <header class="cap-head">
        <div class="cap-title">
          <span class="cap-glyph">◈</span>
          <div><strong>能力矩阵</strong><small id="capSubtitle">7.0 K8s · 依赖就绪 × 配置指向</small></div>
        </div>
        <div class="cap-tabs" role="tablist">
          <button class="active" data-form="k8s" role="tab">7.0 K8s</button>
          <button data-form="host" role="tab">6.3 主机化</button>
        </div>
        <div class="cap-view" id="capView" role="tablist" aria-label="K8s 视图">
          <button class="active" data-view="caps" role="tab">按能力</button>
          <button data-view="pods" role="tab">按 Pod</button>
        </div>
        <div class="cap-actions">
          <button id="capSyncBtn" class="cap-btn">↻ 同步服务器</button>
          <label class="cap-btn">导入<input id="capFileInput" type="file" accept=".json,application/json" hidden></label>
          <button id="capCloseBtn" class="cap-btn ghost">关闭</button>
        </div>
      </header>
      <div class="cap-note" id="capNote"></div>
      <div class="cap-body">
        <nav class="cap-list" id="capList"></nav>
        <section class="cap-detail" id="capDetail"></section>
      </div>
    </div>`;
  document.body.append(root);
  els = {
    root,
    subtitle: root.querySelector('#capSubtitle'),
    note: root.querySelector('#capNote'),
    list: root.querySelector('#capList'),
    detail: root.querySelector('#capDetail'),
    tabs: [...root.querySelectorAll('[data-form]')],
    view: root.querySelector('#capView'),
    viewBtns: [...root.querySelectorAll('[data-view]')],
    sync: root.querySelector('#capSyncBtn'),
    file: root.querySelector('#capFileInput'),
    close: root.querySelector('#capCloseBtn')
  };
}

function render() {
  const list = currentCaps();
  const isK8s = state.form === 'k8s';
  els.subtitle.textContent = isK8s
    ? '7.0 K8s · 依赖就绪 × 配置指向'
    : '6.3 主机化 · 进程 / 端口 / 配置';
  els.tabs.forEach((b) => b.classList.toggle('active', b.dataset.form === state.form));
  els.viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  els.view.hidden = !isK8s;
  if (isK8s && state.view === 'pods') {
    renderPodView();
    return;
  }

  const counts = { ok: 0, warn: 0, bad: 0, idle: 0 };
  for (const c of list) counts[toneOf(c.id)] += 1;

  els.note.className = 'cap-note';
  if (state.error) {
    els.note.classList.add('error');
    els.note.textContent = state.error;
  } else if (!state.live) {
    els.note.innerHTML = isK8s
      ? '尚未导入采集结果。点「导入」选 <code>能力矩阵.json</code>，或在装了后端的服务器上点「同步服务器」。'
      : '6.3 主机化判据需要进程 / 端口 / 配置文件三类证据，采集器尚未接入；这里先给出组件清单与要核对的项。';
  } else {
    els.note.textContent = `已导入 ${state.live.at} · 已启用 ${counts.ok} · 需注意 ${counts.warn} · 有问题 ${counts.bad}`;
  }

  const order = ['bad', 'warn', 'ok', 'idle'];
  const sorted = [...list].sort((a, b) => {
    const d = order.indexOf(toneOf(a.id)) - order.indexOf(toneOf(b.id));
    return d !== 0 ? d : String(a.category || a.group || '').localeCompare(String(b.category || b.group || ''), 'zh');
  });

  if (!state.selected || !sorted.some((c) => c.id === state.selected)) {
    state.selected = sorted[0] ? sorted[0].id : null;
  }

  els.list.innerHTML = sorted.map((c) => `
    <button class="cap-item ${c.id === state.selected ? 'active' : ''}" data-cap="${esc(c.id)}">
      <span class="cap-dot ${toneOf(c.id)}"></span>
      <span class="cap-item-copy">
        <strong>${esc(c.name)}</strong>
        <small>${esc(c.brief || c.fullName || '')}</small>
      </span>
      <em class="cap-state ${toneOf(c.id)}">${esc(stateOf(c.id))}</em>
    </button>`).join('');

  const sel = sorted.find((c) => c.id === state.selected);
  els.detail.innerHTML = sel ? renderDetail(sel) : '<div class="cap-empty">没有可显示的能力</div>';
  bindRows();
}

function renderDetail(c) {
  if (state.form === 'host') {
    return `
      <div class="cap-detail-head">
        <div><h2>${esc(c.name)}</h2><p>${esc(c.brief || '')}</p></div>
        <em class="cap-state ${toneOf(c.id)}">${esc(stateOf(c.id))}</em>
      </div>
      ${c.modules && c.modules.length ? section('模块', `<div class="cap-tags">${c.modules.map((m) => `<span>${esc(m)}</span>`).join('')}</div>`) : ''}
      ${c.ports && c.ports.length ? section('端口', `<div class="cap-tags">${c.ports.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`) : ''}
      ${section('主机化怎么验', `
        <div class="cap-steps">
          <div><b>进程</b><code>systemctl status &lt;服务名&gt;</code></div>
          <div><b>端口</b><code>ss -lntp | grep &lt;端口&gt;</code></div>
          <div><b>配置</b><code>grep -n &lt;键&gt; &lt;配置文件&gt;</code></div>
        </div>
        <p class="cap-hint">主机化没有 K8s 对象可比对，判据是「进程在、端口通、配置值对」三件事。</p>`)}
      ${c.source ? section('来源', `<p class="cap-src">${esc(c.source)}</p>`) : ''}`;
  }

  const wires = (c.wires || []).map((w) => {
    const p = splitWire(w);
    return `<div class="cap-row"><code>${esc(p.key)}</code><span>${esc(p.need)}</span></div>`;
  }).join('');
  const params = (c.params || []).map((p) => `
    <div class="cap-row param">
      <code>${esc(p.key)}</code>
      <span class="cap-expect">改成 ${esc(p.expect || '—')}</span>
      <small>${esc(p.source)}${p.desc ? ' · ' + esc(p.desc) : ''}</small>
    </div>`).join('');
  const apply = (c.apply || []).map((a) => a.startsWith('!!')
    ? `<li class="warn">${esc(a.replace(/^!!\s*/, ''))}</li>`
    : `<li>${esc(a)}</li>`).join('');
  const verify = (c.verify || []).map((v) => `
    <div class="cap-verify"><code>${esc(v.cmd)}</code>${v.expect ? `<small>期望：<span class="cap-expect">${esc(v.expect)}</span></small>` : ''}</div>`).join('');

  return `
    <div class="cap-detail-head">
      <div><h2>${esc(c.name)}</h2><p>${esc(c.brief || '')}</p></div>
      <em class="cap-state ${toneOf(c.id)}">${esc(stateOf(c.id))}</em>
    </div>
    ${renderObjects(c)}
    ${c.deps && c.deps.length ? section('依赖的对象', `<div class="cap-tags">${c.deps.map((d) => `<span>${esc(d)}</span>`).join('')}</div>`) : ''}
    ${wires ? section('判定条件', `<div class="cap-table">${wires}</div>`) : ''}
    ${params ? section('要改的参数', `<div class="cap-table">${params}</div>`) : ''}
    ${apply ? section('怎么改才生效', `<ol class="cap-steps-list">${apply}</ol>`) : ''}
    ${verify ? section('改完怎么验证', `${verify}<p class="cap-hint">exec 必须指名 Pod，不要用 deploy/ 前缀。</p>`) : ''}
    ${(c.impact || c.note || c.fallback) ? section('影响面与回滚', `
      <div class="cap-kv">
        ${c.impact ? `<span>影响面</span><p>${esc(c.impact)}</p>` : ''}
        ${c.note ? `<span>风险</span><p>${esc(c.note)}</p>` : ''}
        ${c.fallback ? `<span>回滚</span><p>${esc(c.fallback)}</p>` : ''}
      </div>`) : ''}
    ${c.source ? section('来源', `<p class="cap-src">${esc(c.source)}</p>`) : ''}`;
}

function section(label, body) {
  return `<div class="cap-section"><h3>${esc(label)}</h3>${body}</div>`;
}

function splitWire(w) {
  const ops = [['>=', '不小于'], ['!~', '不包含'], ['~', '包含'], ['!=', '不等于'], ['=', '等于']];
  for (const [op, label] of ops) {
    const i = w.indexOf(op);
    if (i > 0) return { key: w.slice(0, i), need: `${label} ${w.slice(i + op.length)}` };
  }
  if (w.endsWith('+')) return { key: w.slice(0, -1), need: '存在且非空' };
  return { key: w, need: '—' };
}

/* ---------------- Pod / 对象 → 能力 的匹配 ---------------- */
function depTokens(c) {
  const tokens = [];
  for (const dep of c.deps || []) {
    const parts = String(dep).split('/').filter(Boolean);
    const name = parts.length >= 2 ? parts[1] : parts[0];
    const tok = String(name || '').replace(/\*/g, '').trim();
    if (tok) tokens.push(tok.toLowerCase());
  }
  return tokens;
}

function matchObjects(list, tokens) {
  if (!tokens.length) return [];
  return list.filter((o) => tokens.some((t) => String(o.name).toLowerCase().includes(t)));
}

function readyFull(ready) {
  const parts = String(ready || '').split('/');
  return parts.length === 2 && parts[0] === parts[1];
}

function podTone(p) {
  if (p.phase === 'Succeeded') return 'idle';
  if (p.phase !== 'Running') return 'bad';
  return readyFull(p.ready) ? 'ok' : 'warn';
}

function workloadTone(w) {
  return readyFull(w.ready) ? 'ok' : 'warn';
}

function objectRow(kind, ns, name, status, tone) {
  return `<div class="cap-obj"><em class="cap-dot ${tone}"></em><code>${esc(kind)}</code><span class="cap-obj-name">${esc(ns)}/${esc(name)}</span><span class="cap-obj-status">${esc(status)}</span></div>`;
}

function renderObjects(c) {
  const tokens = depTokens(c);
  const ws = matchObjects(state.live?.workloads || [], tokens).slice(0, 8);
  const ps = matchObjects(state.live?.pods || [], tokens).slice(0, 12);
  if (!ws.length && !ps.length) {
    return section('运行时对象', '<p class="cap-hint">没有匹配到对象 —— 该能力未部署，或者还没有导入采集结果。</p>');
  }
  const rows = [
    ...ws.map((w) => objectRow(w.kind, w.ns, w.name, w.ready, workloadTone(w))),
    ...ps.map((p) => objectRow('Pod', p.ns, p.name,
      `${p.phase} ${p.ready}${Number(p.restarts) > 0 ? ' · 重启 ' + p.restarts : ''}`, podTone(p)))
  ];
  return section(`运行时对象（${ws.length} 工作负载 · ${ps.length} Pod）`, `<div class="cap-objs">${rows.join('')}</div>`);
}

function renderPodView() {
  const pods = state.live?.pods || [];
  els.note.className = 'cap-note';
  if (!pods.length) {
    els.note.textContent = state.live
      ? '这次采集结果里没有 Pod 信息（采集器版本旧，请更新 xt-blackbox 后重新采集）'
      : '还没有采集结果 —— 点「同步服务器」或「导入」，也可以先看示例。';
    els.list.innerHTML = '<div class="cap-empty">没有 Pod 数据</div>';
    els.detail.innerHTML = `
      <div class="cap-demo">
        <h2>这里会显示每个 Pod 的名字和状态</h2>
        <p>导入采集结果后，左边就是集群里所有 Pod，异常的排最前面；点开能看到命名空间、节点、重启次数和关联的能力。</p>
        <div class="cap-demo-actions">
          <button id="capDemoBtn" class="cap-demo-btn">先看示例长什么样</button>
        </div>
        <div class="cap-demo-hint">采集命令：<code>./xt-blackbox capabilities --push=http://本机:22648/api/ingest</code></div>
      </div>`;
    els.detail.querySelector('#capDemoBtn')?.addEventListener('click', () => {
      applyImport(JSON.stringify(DEMO));
      state.demo = true;
      render();
    });
    return;
  }
  const nsSet = {};
  for (const p of pods) nsSet[p.ns] = 1;
  const order = ['bad', 'warn', 'ok', 'idle'];
  const flat = [...pods].sort((a, b) => {
    const d = order.indexOf(podTone(a)) - order.indexOf(podTone(b));
    return d !== 0 ? d : (a.ns + a.name).localeCompare(b.ns + b.name);
  });
  const bad = pods.filter((p) => podTone(p) === 'bad').length;
  els.note.textContent = `共 ${pods.length} 个 Pod · ${Object.keys(nsSet).length} 个命名空间 · 异常 ${bad} 个`;
  if (!state.selected || !flat.some((p) => p.ns + '/' + p.name === state.selected)) {
    state.selected = flat[0] ? flat[0].ns + '/' + flat[0].name : null;
  }
  els.list.innerHTML = flat.map((p) => {
    const id = p.ns + '/' + p.name;
    return `<button class="cap-item ${id === state.selected ? 'active' : ''}" data-pod="${esc(id)}">
      <span class="cap-dot ${podTone(p)}"></span>
      <span class="cap-item-copy"><strong>${esc(p.name)}</strong>
        <small>${esc(p.ns)}${Number(p.restarts) > 0 ? ' · 重启 ' + esc(p.restarts) : ''}</small></span>
      <em class="cap-state ${podTone(p)}">${esc(p.ready)}</em></button>`;
  }).join('');
  const sel = flat.find((p) => p.ns + '/' + p.name === state.selected);
  els.detail.innerHTML = sel ? renderPodDetail(sel) : '<div class="cap-empty">请选择 Pod</div>';
  els.list.querySelectorAll('[data-pod]').forEach((b) => {
    b.addEventListener('click', () => { state.selected = b.dataset.pod; render(); });
  });
}

function renderPodDetail(p) {
  const owner = (state.live?.workloads || []).find((w) => String(p.name).startsWith(w.name));
  const lower = String(p.name).toLowerCase();
  const related = caps.filter((c) => depTokens(c).some((t) => lower.includes(t)));
  return `
    <div class="cap-detail-head">
      <div><h2>${esc(p.name)}</h2><p>${esc(p.ns)} · ${esc(owner ? owner.kind + ' ' + owner.name : '—')}</p></div>
      <em class="cap-state ${podTone(p)}">${esc(p.phase)}</em>
    </div>
    ${section('运行状态', `<div class="cap-kv">
      <span>就绪</span><p>${esc(p.ready)}</p>
      <span>重启</span><p>${esc(p.restarts)}</p>
      <span>节点</span><p>${esc(p.node || '—')}</p>
    </div>`)}
    ${related.length ? section('关联能力', `<div class="cap-tags">${related.map((c) => `<span>${esc(c.name)} · ${esc(stateOf(c.id))}</span>`).join('')}</div>`) : ''}
    ${section('下一步', `<p class="cap-hint">看 Pod 起不来看 Events：<code>kubectl describe pod ${esc(p.name)} -n ${esc(p.ns)}</code></p>`)}`;
}
function applyImport(text) {
  state.error = '';
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    state.error = 'JSON 解析失败：' + e.message;
    return;
  }
  const list = Array.isArray(doc) ? doc : doc.capabilities;
  if (!Array.isArray(list)) {
    state.error = '找不到 capabilities 数组，请用 xt-blackbox capabilities --json 的输出。';
    return;
  }
  const known = new Set([...caps, ...hostCaps].map((c) => c.id));
  const states = {};
  let matched = 0;
  for (const item of list) {
    if (!item || !item.id || !known.has(item.id)) continue;
    states[item.id] = item.state || '未部署';
    matched += 1;
  }
  if (!matched) {
    state.error = '没有任何能力 id 对得上。';
    return;
  }
  state.live = {
    at: doc.generatedAt || new Date().toLocaleString('zh-CN'),
    states,
    form: doc.form || 'k8s',
    pods: Array.isArray(doc.pods) ? doc.pods : [],
    workloads: Array.isArray(doc.workloads) ? doc.workloads : []
  };
}

function syncFromServer(silent) {
  if (!(location.protocol === 'http:' || location.protocol === 'https:')) {
    if (!silent) { state.error = '离线打开时无法同步，请用「导入」选择文件。'; render(); }
    return;
  }
  fetch('/api/latest', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? '服务器上还没有采集结果' : '服务器返回 ' + r.status);
      return r.text();
    })
    .then((t) => { applyImport(t); render(); })
    .catch((e) => { if (!silent) { state.error = '同步失败：' + e.message; render(); } });
}

function bindRows() {
  els.list.querySelectorAll('[data-cap]').forEach((b) => {
    b.addEventListener('click', () => { state.selected = b.dataset.cap; render(); });
  });
}

function bind() {
  els.tabs.forEach((b) => b.addEventListener('click', () => {
    state.form = b.dataset.form;
    state.selected = null;
    render();
  }));
  els.viewBtns.forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  els.close.addEventListener('click', close);
  els.sync.addEventListener('click', () => { state.error = ''; syncFromServer(false); });
  els.file.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { applyImport(String(reader.result || '')); render(); };
    reader.readAsText(f);
    ev.target.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) close();
  });
}

function open() {
  state.open = true;
  els.root.hidden = false;
  els.root.classList.add('show');
  if (!state.live) syncFromServer(true);
  render();
}

function close() {
  state.open = false;
  els.root.classList.remove('show');
  setTimeout(() => { if (!state.open) els.root.hidden = true; }, 220);
}

/**
 * @param {{ k8s: object[], host: object[] }} data 两套形态的能力清单
 */
export function initCapabilityOverlay(data) {
  caps = data.k8s || [];
  hostCaps = data.host || [];
  build();
  bind();

  const actions = document.querySelector('.top-actions');
  if (actions) {
    const btn = document.createElement('button');
    btn.id = 'capMatrixBtn';
    btn.className = 'cap-entry-btn';
    btn.type = 'button';
    btn.textContent = '◈ 能力矩阵';
    btn.addEventListener('click', open);
    actions.insertBefore(btn, actions.firstChild);
  }
  return { open, close };
}
