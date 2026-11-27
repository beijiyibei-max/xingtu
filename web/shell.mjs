/* 全站外壳：顶栏 56 + 左栏 200 + 内容区 max-width 1100。
   构建期注入，不引框架、不做响应式。 */

export const SHELL_VERSION = 'v3.4';

export const ENTRIES = [
  { id: 'workbench', href: '/workbench', label: '工作台', hint: '项目与验收' },
  { id: 'deployment', href: '/deployment', label: '现场部署', hint: '62 步向导' },
  { id: 'criteria', href: '/criteria', label: '排障体检', hint: '判据与质检' },
  { id: 'operations', href: '/operations', label: '运维', hint: '环境与日志' },
  { id: 'universe', href: '/universe', label: '三维关系', hint: '组件宇宙' },
  { id: 'confidential', href: '/confidential', label: '保密现场', hint: 'L0 / L1' },
];

const esc = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const labelOf = active => (ENTRIES.find(entry => entry.id === active) || {}).label || '星图';

/**
 * 生成外壳标记。页面正文由调用方传入，原样放进内容区。
 * @param {{active?:string,title?:string,subtitle?:string,actions?:string,body?:string}} parts
 * @returns {string} 外壳 HTML
 */
export function renderShell({ active = '', title = '', subtitle = '', actions = '', body = '' } = {}) {
  const rail = ENTRIES.map(entry => `<a href="${entry.href}"${entry.id === active ? ' aria-current="page"' : ''}>`
    + `<span>${entry.label}</span><em>${entry.hint}</em></a>`).join('');
  const head = title
    ? `<header class="xt-page-head"><p class="xt-eyebrow">${esc(labelOf(active))}</p><h1>${esc(title)}</h1>`
      + `${subtitle ? `<p>${esc(subtitle)}</p>` : ''}`
      + `${actions ? `<div class="xt-page-actions">${actions}</div>` : ''}</header>`
    : '';
  return `<div class="xt-shell xt-global" data-active="${esc(active)}">`
    + '<header class="xt-topbar">'
    + `<a class="xt-brand" href="/">星图 · 部署副驾驶 <small>${SHELL_VERSION}</small></a>`
    + '<a class="xt-project" href="/deployment" title="在部署页选择当前项目">项目：未选择 ▾</a>'
    + '<div class="xt-topbar-right">'
    + '<strong class="xt-source-note"><!--XT-SOURCE-MODE--></strong>'
    + '<button class="ghost" type="button" title="帮助入口暂未接入">帮助</button>'
    + '<a class="xt-btn ghost" href="/login">账号</a>'
    + '</div></header>'
    + `<nav class="xt-rail" aria-label="主菜单">${rail}</nav>`
    + `<main class="xt-main"><div class="xt-content">${head}${body}</div></main>`
    + '</div>';
}

/**
 * 把一份完整页面文档接进外壳：补 body 类、包一层内容区、按需注入样式。
 * @param {string} html 完整 HTML 文档
 * @param {{active?:string,title?:string,subtitle?:string,actions?:string,css?:string,injectCss?:boolean}} options
 * @returns {string} 接入外壳后的文档
 */
export function applyShell(html, { active = '', title = '', subtitle = '', actions = '', css = '', injectCss = true } = {}) {
  let out = html;
  if (injectCss && css) {
    const style = `<style data-xt-shell>\n${css}\n</style>\n`;
    if (!out.includes('</head>')) throw new Error('页面缺少 head 结束标签');
    out = out.replace('</head>', `${style}</head>`);
  }
  const open = out.match(/<body([^>]*)>/i);
  if (!open) throw new Error('页面缺少 body 标签');
  const start = open.index + open[0].length;
  const end = out.lastIndexOf('</body>');
  if (end < start) throw new Error('页面 body 未闭合');
  const bodyHtml = out.slice(start, end);
  const attrs = /\sclass="/i.test(open[1])
    ? open[1].replace(/\sclass="([^"]*)"/i, (_, value) => ` class="${value} xt-shell"`)
    : `${open[1]} class="xt-shell"`;
  return out.slice(0, open.index) + `<body${attrs}>` + renderShell({ active, title, subtitle, actions, body: bodyHtml }) + out.slice(end);
}
