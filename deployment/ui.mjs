import {newPlan,readPlan,validateScope,validateReference,emptyRecord,writeRecord,earlierOpen,resolved,labels,blockReasons,skipReasons} from './state.mjs';
import {parameters,commandKeys,prepareCommand} from './command-params.mjs';
import {initYamlReview} from './yaml-review-ui.mjs';
import {initHostCheck} from './host-check-ui.mjs';
import {initCompanion} from './companion-ui.mjs';
import {initDeploymentAssistant} from './assistant-ui.mjs';

const phases = DEPLOYMENT_FLOW;
const steps = phases.flatMap(phase => phase.steps);
const stepText = new Map(phases.flatMap(phase => phase.steps.map(step => [step,[
  phase.title,step.title,step.id,...step.actions,...(step.pitfalls||[]),
  ...(step.reference?.chart||[]),...(step.reference?.packages||[]),
  ...step.tutorial.flatMap(card=>[card.title,card.text,...card.errors.map(item=>item.signal)]),
].join(' ').toLowerCase()])));
const storageKey = 'xingtu-deployment-progress-v1';
const configSteps = new Set(['config','materials','em-install','em-bind','common','placement','charts']);
const hostSteps = new Set(['host','disk','install-k8s','k8s-check']);
const byId = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[char]);
const escList = items => items.map(item => `<li>${escape(item)}</li>`).join('');
const codeOptions = items => '<option value="">选择原因</option>'+items.map(item =>
  `<option value="${escape(item)}">${escape(item)}</option>`).join('');

let plan = newPlan();
let companion;
let selected = 0;
let selectedLesson = 0;
let outputView = 'normal';
let commandInputs = {};
let storageAvailable = true;
const offline = location.protocol === 'file:';
byId('main-links').hidden = offline;
byId('total-count').textContent = steps.length;

function announce(message, error = false) {
  const node = byId('message');
  node.textContent = message;
  node.classList.toggle('error',error);
}

try {
  const raw = localStorage.getItem(storageKey);
  if (raw) plan = readPlan(JSON.parse(raw),steps);
} catch (error) {
  storageAvailable = false;
  announce('无法读取浏览器中保存的进度。可以导入此前下载的进度文件。',true);
}

function save() {
  try {
    localStorage.setItem(storageKey,JSON.stringify(plan));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

function firstOpen() {
  const index = steps.findIndex(step => !resolved(plan.records[step.id]));
  return index === -1 ? steps.length - 1 : index;
}

function fillScope() {
  const form = byId('scope-form');
  form.reset();
  for (const [key,value] of Object.entries(plan.scope || {})) form.elements.namedItem(key).value = value;
  byId('settings').open = !plan.scope;
}

function renderProgress() {
  const records = Object.values(plan.records);
  const passed = records.filter(r => r.status === 'passed').length;
  const skipped = records.filter(r => r.status === 'na').length;
  const blocked = records.filter(r => r.status === 'blocked').length;
  byId('progress-label').textContent = `通过 ${passed} / ${steps.length} · 不适用 ${skipped} · 卡住 ${blocked}`;
  const meter = byId('progress');
  meter.max = steps.length;
  meter.value = passed+skipped;
  byId('handled-count').textContent = String(passed+skipped).padStart(2,'0');
  byId('storage-status').textContent = storageAvailable ? '当前浏览器保存进度' : '当前仅保存在内存，请下载进度文件';
  byId('scope-summary').textContent = plan.scope ? `· ${plan.scope.alias} · ${plan.scope.ns}` : '· 待确认';
  byId('phase-map').innerHTML = phases.map((phase,index)=>{
    const count = phase.steps.filter(step=>resolved(plan.records[step.id])).length;
    const active = phase.steps.includes(steps[selected]);
    return `<button type="button" data-phase="${index}" ${active?'aria-current="step"':''}
      class="${count===phase.steps.length?'complete':''}"><span>${escape(phase.title)}</span><small>${count}/${phase.steps.length}</small></button>`;
  }).join('');
}

function renderOutline() {
  const query = byId('search').value.trim().toLowerCase();
  byId('steps').innerHTML = phases.map((phase,i) => {
    const matching = phase.steps.filter(step => !query || stepText.get(step).includes(query));
    if (!matching.length) return '';
    const count = phase.steps.filter(step => resolved(plan.records[step.id])).length;
    return `<section class="phase"><h2><span>${i+1}. ${escape(phase.title)}</span><small>${count}/${phase.steps.length}</small></h2><ul>${
      matching.map(step => {
        const index = steps.indexOf(step);
        const state = plan.records[step.id]?.status || 'pending';
        const suffix = step.number ? `SOP ${step.number}` : state === 'pending' && step.optional ? '按范围' : '';
        return `<li><button type="button" data-step="${index}" class="step-link ${state}" ${index===selected?'aria-current="step"':''}>
          <i aria-hidden="true"></i><span>${escape(step.title)}</span><small>${escape(state==='pending'?suffix:labels[state])}</small>
        </button></li>`;
      }).join('')
    }</ul></section>`;
  }).join('') || '<p class="muted">没有匹配的步骤。</p>';
}

function canShowChange(step, card) {
  const mode = card.mode==='newCluster' ? plan.scope?.cluster : plan.scope?.manager;
  return mode==='new' && !earlierOpen(plan,steps,selected) && !resolved(plan.records[step.id]);
}

function renderOutput(card) {
  const normal = outputView==='normal';
  const query = byId('search').value.trim().toLowerCase();
  return `<div class="output-tabs" role="group" aria-label="输出判读">
    <button type="button" data-output="normal" aria-pressed="${normal}">正常反馈</button>
    <button type="button" data-output="errors" aria-pressed="${!normal}">报错处置 <span>${card.errors.length}</span></button>
  </div>
  ${normal ? `<div class="result result-ok"><span class="result-label">示例输出</span>
    <pre>${escape(card.sample)}</pre><p>${escape(card.normal)}</p></div>` :
    `<div class="error-cases">${card.errors.map((item,index)=>`<details class="error-case" ${
      (query ? item.signal.toLowerCase().includes(query) : index===0)?'open':''}>
      <summary>${escape(item.signal)}</summary><dl>
        <dt>先查哪里</dt><dd>${escape(item.check)}</dd>
        <dt>如何处理</dt><dd>${escape(item.fix)}</dd>
        <dt>怎么复验</dt><dd>${escape(item.verify)}</dd>
      </dl></details>`).join('')}</div>`}`;
}

function renderLesson() {
  const step = steps[selected];
  const card = step.tutorial[selectedLesson];
  const isTerminal = card.kind==='terminal';
  const locked = card.change && !canShowChange(step,card);
  byId('lesson-console').innerHTML = `
    <div class="lesson-toolbar">
      <h3>分步教学</h3>
      <div class="lesson-nav pro-only" role="group" aria-label="本步操作">
        ${step.tutorial.map((item,index)=>`<button type="button" data-lesson="${index}"
          aria-label="第 ${index+1} 项 · ${escape(item.title)}" title="${escape(item.title)}"
          aria-pressed="${index===selectedLesson}">${String(index+1).padStart(2,'0')}</button>`).join('')}
      </div>
    </div>
    <div class="lesson-body">
      <div class="lesson-type">${isTerminal?(card.change?'终端变更':'终端只读'):'操作指引'} <span>${selectedLesson+1} / ${step.tutorial.length}</span></div>
      <h4 tabindex="-1">${escape(card.title)}</h4>
      <p class="lesson-target"><span>执行位置</span> ${escape(card.target)}</p>
      ${!isTerminal ? `<ol class="instructions">${escList(card.actions)}</ol>` : locked ?
        '<p class="callout">选择对应的新装方案并完成前置验收后，可查看变更命令。</p>' :
        `${card.change?`<label class="check approval"><input type="checkbox" id="approve-copy">
          <span>目标、工作目录、变更窗口和回退方式已确认</span></label>`:''}
          ${renderParameters(card)}
          <div class="command">
            <div><span><b aria-hidden="true">›_</b> 现场终端</span><button id="copy-command" type="button" class="small" data-copy disabled>复制命令</button></div>
            <pre id="command-text"></pre>
          </div>
          <p id="command-feedback" class="command-feedback" role="status"></p>`}
      <div id="lesson-output">${renderOutput(card)}</div>
      <div class="lesson-footer">
        <button type="button" data-lesson="${selectedLesson-1}" ${selectedLesson===0?'disabled':''}>← 上一项操作</button>
        <button type="button" data-lesson="${selectedLesson+1}" ${selectedLesson===step.tutorial.length-1?'disabled':''}>下一项操作 →</button>
      </div>
    </div>`;
  refreshCommand();
}

function renderParameters(card) {
  const local = commandKeys(card.text).filter(key=>!parameters[key].scope);
  if (!local.length) return '';
  return `<div class="command-params">${local.map(key=>{
    const field = parameters[key];
    return `<label>${escape(field.label)}<input data-param="${key}" maxlength="256" autocomplete="off"
      spellcheck="false" value="${escape(commandInputs[key]||'')}" placeholder="${escape(field.hint)}"></label>`;
  }).join('')}</div>`;
}

function refreshCommand() {
  const block = byId('command-text');
  if (!block) return;
  const card = steps[selected].tutorial[selectedLesson];
  const {text,missing,invalid} = prepareCommand(card.text,plan.scope,commandInputs);
  block.textContent = text;
  byId('copy-command').disabled = !plan.scope || Boolean(missing.length||invalid.length) ||
    (card.change && !byId('approve-copy')?.checked);
  const pending = !plan.scope ? '先保存本次部署设置，确认目标环境。' : invalid.length ?
    `请核对格式：${invalid.join('、')}。` : missing.length ?
    `先填写${missing.join('、')}，再复制。参数仅在当前步骤内使用。` : '';
  byId('command-feedback').textContent = pending;
  byId('command-feedback').hidden = !pending;
}

function renderReference(step) {
  const ref = step.reference;
  if (!ref) return '';
  const rows = [['Chart',ref.chart.join('、')],['物料名',ref.packages.join('、')],['落点键',ref.placement],['Service',ref.services.join('、')]];
  return `<details class="callout"><summary>查看组件参考名和落点</summary><p>${escape(ref.scope)}</p>
    <dl>${rows.filter(([,value])=>value).map(([label,value])=>`<dt>${label}</dt><dd>${escape(value)}</dd>`).join('')}</dl></details>`;
}

function renderDetail() {
  const step = steps[selected];
  const record = plan.records[step.id] || emptyRecord();
  const earlier = earlierOpen(plan,steps,selected);
  const unlocked = Boolean(plan.scope && !earlier);
  const editable = unlocked && !resolved(record);
  const tag = step.number ? `SOP §7 · 第 ${step.number} 项` : '部署检查';
  const phase = phases.find(item=>item.steps.includes(step));
  byId('detail').innerHTML = `
    <div class="step-meta"><span>${escape(phase.title)} · ${selected+1}/${steps.length}</span><span class="badge ${record.status}">${labels[record.status]}</span></div>
    <h2 id="step-title" tabindex="-1">${escape(step.title)}</h2>
    <p class="target"><span>操作位置</span> ${escape(step.target)}</p>
    <div class="source-kind">${escape(tag)}${step.optional?' · 按项目范围确认':''}</div>
    ${configSteps.has(step.id)?'<button type="button" class="yaml-entry yaml-step" data-yaml-review>体检本步 YAML →</button>':''}
    ${hostSteps.has(step.id)?'<button type="button" class="yaml-entry yaml-step" data-host-check>检查这台服务器 →</button>':''}
    ${!plan.scope?'<p class="callout pro-only">先展开「本次部署设置」，保存当前项目。</p>':''}
    ${earlier?`<p class="callout">可以先查看。请完成前置步骤「${escape(earlier.title)}」后再记录本步通过。</p>`:''}
    ${record.reason?`<p class="callout"><strong>${labels[record.status]}</strong> · ${escape(record.reason)}</p>`:''}
    <div class="step-grid"><div class="lesson-column">
    <div id="lesson-console" class="lesson-console"></div>
    <details class="callout pro-only"><summary>本步操作总览</summary><ol class="instructions">${escList(step.actions)}</ol></details>
    ${renderReference(step)}
    <details class="callout sources pro-only"><summary>依据与现场记录</summary><ul>
      ${step.sources.map(source=>`<li><strong>${escape(source.type)}</strong> · ${escape(source.ref)}</li>`).join('')}
    </ul></details></div><aside class="checkpoint" aria-label="本步验收">
    <section class="verification"><h3>通过条件</h3><div id="checks">
    ${step.checks.map((check,index)=>`<label class="check">
      <input type="checkbox" data-check="${index}" ${record.checks.includes(index)?'checked':''} ${editable?'':'disabled'}>
      <span>${escape(check)}</span>
    </label>`).join('')}
    </div>
    <p class="muted">${escape(step.evidence)}</p>
    <label class="evidence pro-only">证据编号（可选）<input id="evidence" placeholder="例如 TEST-01" maxlength="40"
      value="${escape(record.ref)}" ${editable?'':'disabled'}></label>
    <div class="actions">
      <button id="pass" class="primary" type="button" ${editable && record.checks.length===step.checks.length?'':'disabled'}>通过本步</button>
      ${resolved(record)?'<button id="reopen" type="button">重新核验</button>':''}
      ${selected>0?'<button id="previous" class="pro-only" type="button">上一步</button>':''}
      ${selected<steps.length-1?'<button id="next" class="pro-only" type="button">查看下一步</button>':''}
    </div>
    ${editable?`<details class="callout reasons"><summary>登记卡点${step.optional?'或不适用':''}</summary>
      <div><label>卡点原因<select id="block-reason">${codeOptions(blockReasons)}</select></label><button id="block" type="button">标记卡住</button></div>
      ${step.optional?`<div><label>不适用原因<select id="skip-reason">${codeOptions(skipReasons)}</select></label><button id="skip" type="button">记录不适用</button></div>`:''}
    </details>`:''}
    </section>
    ${step.pitfalls?.length?`<section class="field-notes pro-only"><h3>现场经验</h3><ul>${escList(step.pitfalls)}</ul></section>`:''}
    </aside></div>`;
  renderLesson();
}

function show(index,focus = false,matchError = false) {
  selected = index;
  if(steps[index]) document.dispatchEvent(new CustomEvent('deployment-step',{detail:steps[index].id}));
  selectedLesson = 0;
  outputView = 'normal';
  commandInputs = {};
  const query = byId('search').value.trim().toLowerCase();
  if (query && matchError) {
    const match = steps[index].tutorial.findIndex(card=>card.errors.some(item=>item.signal.toLowerCase().includes(query)));
    if (match>=0) {
      selectedLesson = match;
      outputView = 'errors';
    }
  }
  renderOutline();
  renderDetail();
  renderProgress();
  companion?.render();
  if (focus) byId('step-title').focus();
}

function run(action) {
  try { action(); } catch (error) { announce(error.message,true); }
}

function update(step, record) {
  const result = writeRecord(plan,steps,step,record);
  plan = result.plan;
  save();
  return result.resetCount;
}

async function copy() {
  const source = byId('command-text');
  if (!source) return;
  try {
    await navigator.clipboard.writeText(source.textContent);
    announce('已复制命令。请在标注的现场终端逐条核对。');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    announce('已选中命令，按 Ctrl+C 复制。');
  }
}

function saveScope(raw) {
  const scope = validateScope(raw);
  if (JSON.stringify(plan.scope) !== JSON.stringify(scope)) {
    if (Object.keys(plan.records).length && !confirm('部署设置已改变。是否清空现有步骤记录并开始新一轮核验？')) return;
    plan = {...newPlan(),scope};
    selected = 0;
    companion?.reset();
  }
  save();
  fillScope();
  show(selected);
  announce('已保存本次部署设置。');
}

byId('scope-form').addEventListener('submit',event => {
  event.preventDefault();
  run(()=>saveScope(Object.fromEntries(new FormData(event.currentTarget))));
});
byId('view-mode').onclick=()=>{
  const main=byId('deployment-main');
  const full=main.dataset.view!=='full';
  main.dataset.view=full?'full':'beginner';
  byId('view-mode').textContent=full?'回到部署陪跑':'完整步骤和设置';
  if(full) byId('settings').open=true;
  else show(firstOpen());
};

byId('search').addEventListener('input',renderOutline);
byId('quick-symptoms').addEventListener('click',event=>{
  const button = event.target.closest('[data-symptom]');
  if (!button) return;
  byId('search').value = button.dataset.symptom;
  renderOutline();
  byId('search').focus();
});
byId('phase-map').addEventListener('click',event=>{
  const button = event.target.closest('[data-phase]');
  if (!button) return;
  const phase = phases[Number(button.dataset.phase)];
  byId('search').value = '';
  show(steps.indexOf(phase.steps.find(step=>!resolved(plan.records[step.id]))||phase.steps[0]),true);
});
byId('steps').addEventListener('click',event => {
  const button = event.target.closest('button[data-step]');
  if (button) show(Number(button.dataset.step),true,true);
});
byId('resume').onclick = () => show(firstOpen(),true);

byId('detail').addEventListener('change',event => {
  const input = event.target;
  if (input.id === 'approve-copy') refreshCommand();
  if (!Object.hasOwn(input.dataset,'check')) return;
  run(() => {
    const step = steps[selected];
    const old = plan.records[step.id] || emptyRecord();
    const checks = [...byId('checks').querySelectorAll('input:checked')].map(box=>Number(box.dataset.check));
    update(step,{...old,checks});
    byId('pass').disabled = checks.length !== step.checks.length;
    renderProgress();
  });
});

byId('detail').addEventListener('input',event => {
  const key = event.target.dataset.param;
  if (key && Object.hasOwn(parameters,key)) {
    commandInputs[key] = event.target.value;
    refreshCommand();
    return;
  }
  if (event.target.id !== 'evidence') return;
  const step = steps[selected];
  try {
    const ref = validateReference(event.target.value);
    update(step,{...(plan.records[step.id]||emptyRecord()),ref});
    event.target.setCustomValidity('');
  } catch (error) {
    event.target.setCustomValidity(error.message);
  }
});

byId('detail').addEventListener('click',event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const step = steps[selected];
  const old = plan.records[step.id] || emptyRecord();
  if (Object.hasOwn(button.dataset,'lesson')) {
    selectedLesson = Number(button.dataset.lesson);
    outputView = 'normal';
    renderLesson();
    const focus=byId('deployment-main').dataset.view==='full'?
      byId('lesson-console').querySelector(`.lesson-nav [data-lesson="${selectedLesson}"]`):
      byId('lesson-console').querySelector('.lesson-body h4');
    focus?.focus();
    return;
  }
  if (Object.hasOwn(button.dataset,'output')) {
    outputView = button.dataset.output;
    byId('lesson-output').innerHTML = renderOutput(step.tutorial[selectedLesson]);
    byId('lesson-output').querySelector(`[data-output="${outputView}"]`)?.focus();
    return;
  }
  if (Object.hasOwn(button.dataset,'copy')) {
    void copy();
    return;
  }
  if (button.id === 'previous') return show(selected-1,true);
  if (button.id === 'next') return show(selected+1,true);
  run(() => {
    if (button.id === 'reopen') {
      const hasLater = steps.slice(selected+1).some(item=>plan.records[item.id]?.status==='passed');
      if (hasLater && !confirm('重新核验本步会清除后续已通过的验收结果。是否继续？')) return;
      const cleared = update(step,emptyRecord());
      show(selected);
      announce(cleared ? `本步已重新打开，后续 ${cleared} 项需要复验。` : '本步已重新打开。');
      return;
    }
    if (!['pass','block','skip'].includes(button.id)) return;
    const ref = validateReference(byId('evidence').value);
    const status = {pass:'passed',block:'blocked',skip:'na'}[button.id];
    const reason = status === 'passed' ? '' : byId(status === 'blocked'?'block-reason':'skip-reason').value;
    if (status !== 'passed' && !reason) throw Error('请选择对应原因。');
    update(step,{...old,status,reason,ref});
    show(status==='blocked'?selected:firstOpen(),status!=='blocked');
    announce(`${step.title} · ${labels[status]}`);
  });
});

function download(name,content,type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

byId('download').onclick = () => {
  if (!plan.scope) return announce('先保存本次部署设置。',true);
  download(`星图部署进度-${plan.scope.alias}.json`,JSON.stringify(plan,null,2),'application/json;charset=utf-8');
  announce('进度文件已生成，可在这台电脑或获准设备上导入。');
};
byId('import').onclick = () => byId('import-file').click();
byId('import-file').addEventListener('change',async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size>262144) throw Error('进度文件超过 256 KB。');
    const imported = readPlan(JSON.parse(await file.text()),steps);
    if (plan.scope && !confirm(`导入「${imported.scope?.alias || '空白计划'}」会替换当前进度。是否继续？`)) return;
    plan = imported;
    companion?.reset();
    save();
    fillScope();
    show(firstOpen());
    announce('已恢复导入的步骤和证据编号。');
  } catch (error) {
    announce('导入失败。'+error.message,true);
  }
});
byId('fresh').onclick = () => {
  if (plan.scope && !confirm('新建会清空当前浏览器中的部署计划。确认已保存所需进度后继续。')) return;
  plan = newPlan();
  companion?.reset();
  save();
  fillScope();
  show(0);
  byId('scope-form').elements.namedItem('alias').focus();
  announce('已新建空白计划。');
};
byId('report').onclick = () => {
  if (!plan.scope) return announce('先保存本次部署设置。',true);
  const {alias,ns,emNs,cluster,manager,storage} = plan.scope;
  const lines = ['# 星图部署交接清单','',`项目代号 ${alias}`,
    `Kubernetes ${cluster==='new'?'新装':'复用'} · EasyManager ${manager==='new'?'新装':'复用'}`,
    `产品 Namespace ${ns} · EM Namespace ${emNs} · 存储 ${storage.toUpperCase()}`,
    `生成时间 ${new Date().toISOString()}`,'','## 待跟进',''];
  for (const step of steps) {
    const record = plan.records[step.id];
    if (!resolved(record)) lines.push(`- ${step.title} · ${labels[record?.status || 'pending']}${record?.reason?' · '+record.reason:''}`);
  }
  for (const phase of phases) {
    lines.push('',`## ${phase.title}`,'');
    for (const step of phase.steps) {
      const record = plan.records[step.id] || emptyRecord();
      lines.push(`- ${step.title} · ${labels[record.status]}${record.reason?' · '+record.reason:''}${record.ref?' · 证据 '+record.ref:''}`);
    }
  }
  download(`星图部署交接-${alias}.md`,lines.join('\n')+'\n','text/markdown;charset=utf-8');
  announce('已生成交接清单，包含卡点和证据编号。');
};

initYamlReview(()=>plan.scope);
initHostCheck(HOST_PROBE,download);
companion=initCompanion({
  steps,getPlan:()=>plan,saveScope:scope=>run(()=>saveScope(scope)),
  commit:(step,record)=>run(()=>{update(step,record);show(firstOpen());}),
  openFull:()=>byId('view-mode').click(),
  exportReport:()=>byId('report').click(),
});
initDeploymentAssistant(steps);
fillScope();
show(firstOpen());
