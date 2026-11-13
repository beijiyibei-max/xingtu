/**
 * 黑匣子叠层：变更前后的指纹时间线，任选两条比对差异。
 *
 * 指纹是 xt-blackbox mark 输出的 TSV：
 *   kind <TAB> ns <TAB> name <TAB> value
 * 比对就是按 kind|ns|name 做键，看新增 / 删除 / 值变化。
 */

const state = { open: false, records: [], a: null, b: null, loading: false, error: '', cache: new Map(), filter: 'all' };
let els = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

function parseFingerprint(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    // cmk 行是 配置项：kind ns cm 路径 值 —— 键必须带上路径，否则同文件的多项会互相覆盖
    if (cols[0] === 'cmk') {
      if (cols.length < 5) continue;
      map.set('cmk|' + cols[1] + '|' + cols[2] + '|' + cols[3], cols.slice(4).join('\t'));
      continue;
    }
    map.set(cols[0] + '|' + cols[1] + '|' + cols[2], cols.slice(3).join('\t'));
  }
  return map;
}

function humanTime(ts) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts || '');
  if (!m) return ts || '';
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function build() {
  const root = document.createElement('div');
  root.className = 'bb-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="bb-shell">
      <header class="bb-head">
        <div class="bb-title">
          <span class="bb-glyph">▣</span>
          <div><strong>证据黑匣子</strong><small>变更前后的指纹，零差异才算安全</small></div>
        </div>
        <div class="bb-actions">
          <button id="bbDiffBtn" class="bb-btn">比对选中的两条</button>
          <button id="bbRefresh" class="bb-btn">↻ 刷新</button>
          <button id="bbClose" class="bb-btn ghost">关闭</button>
        </div>
      </header>
      <div class="bb-note" id="bbNote"></div>
      <div class="bb-body">
        <nav class="bb-list" id="bbList"></nav>
        <section class="bb-detail" id="bbDetail"></section>
      </div>
    </div>`;
  document.body.append(root);
  els = {
    root,
    note: root.querySelector('#bbNote'),
    list: root.querySelector('#bbList'),
    detail: root.querySelector('#bbDetail'),
    diff: root.querySelector('#bbDiffBtn'),
    refresh: root.querySelector('#bbRefresh'),
    close: root.querySelector('#bbClose')
  };
}

async function loadList() {
  state.loading = true;
  state.error = '';
  render();
  try {
    const response = await fetch('/api/blackbox?limit=200', { cache: 'no-store' });
    if (!response.ok) throw new Error(`返回 ${response.status}`);
    const payload = await response.json();
    state.records = payload.records || [];
  } catch (error) {
    state.error = '读不到黑匣子记录：' + (error.message || '');
    state.records = [];
  } finally {
    state.loading = false;
    render();
  }
}

async function loadRecord(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const response = await fetch(`/api/blackbox/get?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`读取记录失败 ${response.status}`);
  const record = await response.json();
  state.cache.set(id, record);
  return record;
}

function render() {
  if (!els) return;
  els.note.className = 'bb-note';
  if (state.error) {
    els.note.classList.add('error');
    els.note.textContent = state.error;
  } else if (state.loading) {
    els.note.textContent = '正在读取…';
  } else if (!state.records.length) {
    els.note.innerHTML = '还没有记录。在集群节点上执行 <code>./xt-blackbox mark --full --push=http://本机:22648/api/blackbox</code> 即可存一条。';
  } else {
    els.note.textContent = `共 ${state.records.length} 条记录 · 选两条比对（先选变更前，再选变更后）`;
  }

  els.list.innerHTML = state.records.map((r) => {
    const picked = r.id === state.a || r.id === state.b;
    const tag = r.id === state.a ? 'A' : r.id === state.b ? 'B' : '';
    return `<button class="bb-item ${picked ? 'active' : ''}" data-id="${esc(r.id)}">
      <span class="bb-badge ${esc(r.kind)}">${esc(r.kind === 'mark' ? '指纹' : r.kind)}</span>
      <span class="bb-item-copy">
        <strong>${esc(humanTime(r.ts))}</strong>
        <small>${esc(r.scope)} · ${r.lines} 行</small>
      </span>
      ${tag ? `<em class="bb-tag">${tag}</em>` : ''}
    </button>`;
  }).join('');

  els.list.querySelectorAll('[data-id]').forEach((button) => {
    button.addEventListener('click', () => pick(button.dataset.id));
  });
  renderDiff();
}

async function pick(id) {
  if (state.a === id) { state.a = null; }
  else if (state.b === id) { state.b = null; }
  else if (!state.a) { state.a = id; }
  else { state.b = id; }
  render();
}

async function renderDiff() {
  if (!state.a && !state.b) {
    els.detail.innerHTML = `<div class="bb-empty">
      <h2>变更前存一条，变更后再存一条</h2>
      <p>左边选中两条记录，点「比对选中的两条」，就能看到这次变更到底动了什么。</p>
      <pre class="bb-cmd">./xt-blackbox mark --full --push=http://本机:22648/api/blackbox
# … 执行变更 …
./xt-blackbox mark --full --push=http://本机:22648/api/blackbox</pre>
      <p class="bb-hint">零差异 = 这次变更没有改变集群状态；有差异 = 逐项列出新增、删除、值变化。</p>
    </div>`;
    return;
  }
  if (!state.a || !state.b) {
    const only = state.a || state.b;
    const record = await loadRecord(only).catch(() => null);
    els.detail.innerHTML = record ? `
      <div class="bb-detail-head"><h2>${esc(humanTime(record.ts))}</h2>
        <span class="bb-meta">${esc(record.scope)} · ${record.lines} 行</span></div>
      <p class="bb-hint">再选一条记录即可比对。</p>
      <pre class="bb-pre">${esc(record.snapshot || '')}</pre>` : '<div class="bb-empty">读取失败</div>';
    return;
  }
  const [ra, rb] = await Promise.all([loadRecord(state.a), loadRecord(state.b)]);
  const a = parseFingerprint(ra.snapshot);
  const b = parseFingerprint(rb.snapshot);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, value] of b) {
    if (!a.has(key)) added.push([key, value]);
    else if (a.get(key) !== value) changed.push([key, a.get(key), value]);
  }
  for (const [key, value] of a) if (!b.has(key)) removed.push([key, value]);

  const keep = (key) => state.filter === 'all' || (state.filter === 'cfg' ? key.startsWith('cmk|') : !key.startsWith('cmk|'));
  const addedF = added.filter(([k]) => keep(k));
  const removedF = removed.filter(([k]) => keep(k));
  const changedF = changed.filter(([k]) => keep(k));
  const total = addedF.length + removedF.length + changedF.length;

  const row = (label, key, cls, from, to) => {
    const parts = key.split('|');
    const isCfg = parts[0] === 'cmk';
    const kindText = isCfg ? '配置' : parts[0];
    const nameText = isCfg
      ? `${parts[1] === '-' ? '' : parts[1] + '/'}${parts[2]} · ${parts[3]}`
      : `${parts[1] === '-' ? '' : parts[1] + '/'}${parts[2]}`;
    return `<div class="bb-row ${cls}">
      <em>${label}</em>
      <code>${esc(kindText)}</code>
      <span class="bb-name">${esc(nameText)}</span>
      <span class="bb-val">${from != null ? esc(from) : ''}${to != null ? ' → ' + esc(to) : ''}</span>
    </div>`;
  };

  const filters = [
    ['all', `全部（${added.length + removed.length + changed.length}）`],
    ['cfg', `只看配置（${added.filter(([k]) => k.startsWith('cmk|')).length + removed.filter(([k]) => k.startsWith('cmk|')).length + changed.filter(([k]) => k.startsWith('cmk|')).length}）`],
    ['obj', '只看对象']
  ].map(([key, label]) => `<button class="bb-filter ${state.filter === key ? 'active' : ''}" data-filter="${key}">${label}</button>`).join('');

  els.detail.innerHTML = `
    <div class="bb-detail-head">
      <h2>${esc(humanTime(ra.ts))} → ${esc(humanTime(rb.ts))}</h2>
      <span class="bb-meta ${total ? 'bad' : 'ok'}">${total ? total + ' 处变化' : '零差异'}</span>
    </div>
    <div class="bb-filters">${filters}</div>
    <div class="bb-stats">
      <div><strong>${changedF.length}</strong><span>值变化</span></div>
      <div><strong>${addedF.length}</strong><span>新增</span></div>
      <div><strong>${removedF.length}</strong><span>消失</span></div>
    </div>
    ${total === 0 ? '<p class="bb-hint ok">这个范围内没有差异。</p>' : ''}
    ${changedF.length ? `<h3>值变化</h3>${changedF.map(([k, f, t]) => row('改', k, 'changed', f, t)).join('')}` : ''}
    ${addedF.length ? `<h3>新增</h3>${addedF.map(([k, v]) => row('增', k, 'added', null, v)).join('')}` : ''}
    ${removedF.length ? `<h3>消失</h3>${removedF.map(([k, v]) => row('减', k, 'removed', v, null)).join('')}` : ''}`;

  els.detail.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => { state.filter = b.dataset.filter; renderDiff(); });
  });
}

function bind() {
  els.close.addEventListener('click', close);
  els.refresh.addEventListener('click', () => { state.cache.clear(); loadList(); });
  els.diff.addEventListener('click', () => { renderDiff(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) close(); });
}

function open() {
  state.open = true;
  els.root.hidden = false;
  els.root.classList.add('show');
  loadList();
}

function close() {
  state.open = false;
  els.root.classList.remove('show');
  setTimeout(() => { if (!state.open) els.root.hidden = true; }, 200);
}

export function initBlackbox() {
  build();
  bind();
  const actions = document.querySelector('.top-actions');
  if (actions) {
    const button = document.createElement('button');
    button.id = 'blackboxBtn';
    button.className = 'bb-entry-btn';
    button.type = 'button';
    button.textContent = '▣ 黑匣子';
    button.addEventListener('click', open);
    const capBtn = actions.querySelector('#capMatrixBtn');
    if (capBtn && capBtn.nextSibling) actions.insertBefore(button, capBtn.nextSibling);
    else actions.insertBefore(button, actions.firstChild);
  }
  return { open, close };
}
