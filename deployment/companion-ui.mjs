import {prepareCommand,commandKeys,parameters} from './command-params.mjs';
import {resolved,emptyRecord,skipReasons} from './state.mjs';
import {walkCards,walkIssues} from './companion-flow.mjs';

const cursorKey='xingtu-walkthrough-cursor-v1';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const routeOptions=[
  ['fresh','K8s 和 EM 都没有'],
  ['k8s','已有 K8s，要新装 EM'],
  ['reuse','K8s 和 EM 都要复用'],
];
const storageOptions=[['s3','S3 / MinIO'],['nfs','NFS'],['mixed','两种都用']];
const button=(action,title,value='',primary=false)=>`<button type="button" data-walk="${action}" data-value="${value}"${primary?' class="primary"':''}>${escape(title)}</button>`;

export function initCompanion({steps,getPlan,saveScope,commit,openFull,exportReport}) {
  const root=document.getElementById('walk-screen');
  let setupRoute='';
  let needsStorage=false;
  let cursor=null;
  let issueIndex=-1;
  let showSkip=false;
  let inputs={};
  let note='';
  try {
    cursor=JSON.parse(localStorage.getItem(cursorKey));
    if(Number.isInteger(cursor?.issue)) issueIndex=cursor.issue;
  } catch {}

  function remember() {
    try { if(cursor) localStorage.setItem(cursorKey,JSON.stringify({...cursor,issue:issueIndex})); else localStorage.removeItem(cursorKey); } catch {}
  }

  function state() {
    const plan=getPlan();
    const index=steps.findIndex(step=>!resolved(plan.records[step.id]));
    const step=steps[index];
    if(!plan.scope||!step) return {plan,index};
    const cards=walkCards(step,plan.scope);
    const key=JSON.stringify([plan.scope,step.id]);
    if(cursor?.key!==key||!Number.isInteger(cursor.action)||cursor.action<0||cursor.action>=cards.length||typeof cursor.review!=='boolean') {
      cursor={key,action:0,review:false};
      issueIndex=-1;showSkip=false;inputs={};note='';
    }
    const card=cards[cursor.action];
    const issues=walkIssues(step,card,plan.scope);
    if(issueIndex<0||issueIndex>=issues.length) issueIndex=-1;
    return {plan,index,step,cards,card,issues,record:plan.records[step.id]||emptyRecord()};
  }

  function commandMarkup(command) {
    const local=commandKeys(command.text).filter(key=>!parameters[key].scope);
    return `
      ${command.change?'<label class="check approval"><input type="checkbox" id="walk-approve"><span>我已确认变更授权、目标、目录和回退方式</span></label>':''}
      ${local.length?`<div class="command-params">${local.map(key=>`<label>${escape(parameters[key].label)}
        <input data-walk-param="${key}" maxlength="256" autocomplete="off" spellcheck="false"
          placeholder="${escape(parameters[key].hint)}" value="${escape(inputs[key]||'')}"></label>`).join('')}</div>`:''}
      <div class="command">
        <div><span>${command.change?'现场变更':'终端检查'}</span><button id="walk-copy" data-walk="copy" type="button" class="small" disabled>复制命令</button></div>
        <pre id="walk-command"></pre>
      </div><p id="walk-command-hint" class="command-feedback" role="status" hidden></p>`;
  }

  function fillCommand(command,plan) {
    if(!command?.text) return;
    const output=root.querySelector('#walk-command');
    if(!output) return;
    const approval=Boolean(root.querySelector('#walk-approve')?.checked);
    const ready=!command.change||approval;
    const result=prepareCommand(command.text,plan.scope,inputs);
    output.textContent=ready?result.text:'请先核对现场变更条件。';
    root.querySelector('#walk-copy').disabled=!ready||result.invalid.length>0||result.missing.length>0;
    const next=root.querySelector('#walk-normal');
    if(next&&command.change) next.disabled=!approval;
    const hint=root.querySelector('#walk-command-hint');
    hint.textContent=result.invalid.length?'核对格式：'+result.invalid.join('、'):
      result.missing.length?'先填：'+result.missing.join('、'):'';
    hint.hidden=!hint.textContent||!ready;
  }

  function renderSetup() {
    root.innerHTML=`<div class="walk-top"><span>数栈 7.0 · 部署陪跑</span></div>
      <h1 tabindex="-1">${setupRoute?'这个项目用什么存储？':'你现在从哪里开始？'}</h1>
      <p>${setupRoute?'按实施单选择。使用非默认 Namespace 或现场网络时，先核对完整设置。':'选你现场已经有的环境，向导会跳过对应的新装命令。'}</p>
      <div class="walk-choices">${(setupRoute?storageOptions:routeOptions).map(([key,label])=>button(setupRoute?'storage':'route',label,key)).join('')}
        ${setupRoute?button('storage-help','我不知道')+button('setup-back','上一个问题'):''}
      </div>
      ${needsStorage?'<p class="callout">查看实施单的存储章节，或问现场负责人是 S3、NFS 还是混用。确认后回来选。</p>':''}
      <p class="walk-small">快速开始使用离线物料、产品 dtstack 和 EM easymanager。<button type="button" data-walk="full" class="quiet">核对完整设置</button></p>`;
  }

  function render(focus=false) {
    const current=state();
    const {plan,index,step,card,cards,issues,record}=current;
    if(step) document.dispatchEvent(new CustomEvent('deployment-step',{detail:step.id}));
    if(!plan.scope) {
      renderSetup();
      if(focus) root.querySelector('h1').focus();
      return;
    }
    if(!step) {
      root.innerHTML=`<div class="walk-top"><span>数栈 7.0 · 部署陪跑</span></div><h1 tabindex="-1">已走完本次部署流程</h1>
        <p>导出清单交给现场负责人复核验收记录与不适用项。</p>${button('report','导出交接清单','',true)}`;
      if(focus) root.querySelector('h1').focus();
      return;
    }
    const issue=issues[issueIndex];
    const normal=card.change?'这条命令已执行，反馈正常':'我看到正常反馈';
    let body='';
    if(issue) {
      body=`<div class="walk-recovery">
        <h2 tabindex="-1">${escape(issue.signal)}</h2>
        <p><strong>先查：</strong>${escape(issue.check)}</p>
        ${issue.diagnostic?`<p class="lesson-target">${escape(issue.diagnostic.target)}</p>
          ${commandMarkup(issue.diagnostic)}<div class="result result-ok"><span class="result-label">这条检查的反馈示例</span><pre>${escape(issue.diagnostic.sample)}</pre></div>`:''}
        <p><strong>处理：</strong>${escape(issue.fix)}</p>
        <p><strong>复验：</strong>${escape(issue.verify)}</p>
        ${issue.source?`<small class="walk-small">${escape(issue.source)}</small>`:''}
        <div class="walk-actions">${button('retry','回原动作复查','',true)}${button('block','还没解决，记为卡住')}</div>
      </div>`;
    } else if(cursor.review) {
      body=`<div class="walk-task">
        <h2 tabindex="-1">这些条件都满足了吗？</h2>
        <ul class="instructions">${step.checks.map(check=>`<li>${escape(check)}</li>`).join('')}</ul>
        <div class="walk-actions">${button('confirm-check','都符合，去下一步','',true)}
        ${button('back-action','回看刚才的操作')}${button('block','这项还没通过')}</div>
      </div>`;
    } else {
      body=`<div class="walk-task">
        <div class="walk-meta">${card.kind==='terminal'?(card.change?'现场变更':'终端检查'):'页面 / 人工操作'} · 本步第 ${cursor.action+1} 项，共 ${cards.length} 项</div>
        <h2 tabindex="-1">${escape(card.title)}</h2><p class="lesson-target">在哪里做 · ${escape(card.target)}</p>
        ${card.kind==='terminal'?commandMarkup(card):`<ol class="instructions">${card.actions.map(line=>`<li>${escape(line)}</li>`).join('')}</ol>`}
        ${step.id==='config'||step.id==='em-install'||step.id==='common'?'<button type="button" class="yaml-entry" data-yaml-review>检查手上的 YAML</button>':''}
        ${step.id==='host'||step.id==='disk'?'<button type="button" class="yaml-entry" data-host-check>检查这台服务器</button>':''}
        <div class="result result-ok"><span class="result-label">看到这样的反馈才继续 · 示例</span>
          <pre>${escape(card.sample)}</pre><p>${escape(card.normal)}</p>
        </div>
        <div class="walk-actions"><button type="button" class="primary" id="walk-normal" data-walk="normal">${normal}</button>
          ${cursor.action>0?button('previous-action','回到上一项'):''}</div>
        <details class="callout walk-errors"><summary>我的结果不一样</summary>
          <div class="walk-choices">${issues.map((entry,index)=>button('issue',entry.signal,index)).join('')}
          </div>
        </details>
      </div>`;
    }
    root.innerHTML=`<div class="walk-top"><span>第 ${index+1} / ${steps.length} 步</span>
        <span>${record.status==='blocked'?'已记录卡点，处理后可复查':'部署陪跑'}</span></div>
      <h1 tabindex="-1">${escape(step.title)}</h1>
      <p class="walk-note" role="status"${note?'':' hidden'}>${escape(note)}</p>
      ${body}
      ${step.optional?`<div class="walk-skip">${showSkip?`<p>为什么这步不需要做？</p><div class="walk-actions">
        ${skipReasons.map((reason,index)=>button('skip-reason',reason,index)).join('')}${button('skip-toggle','取消')}</div>`:
        button('skip-toggle','本项目没有这一项')}</div>`:''}`;
    fillCommand(issue?.diagnostic||(!cursor.review&&card.kind==='terminal'?card:null),plan);
    if(focus) (root.querySelector('h2')||root.querySelector('h1')).focus();
  }

  function refreshCommand() {
    const {plan,card,issues}=state();
    if(!card) return;
    fillCommand(issues[issueIndex]?.diagnostic||(!cursor.review&&card.kind==='terminal'?card:null),plan);
  }

  root.addEventListener('input',event=>{
    const key=event.target.dataset.walkParam;
    if(key&&Object.hasOwn(parameters,key)) { inputs[key]=event.target.value;refreshCommand(); }
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='walk-approve') refreshCommand();
  });
  root.addEventListener('click',async event=>{
    const control=event.target.closest('button[data-walk]');
    if(!control||control.disabled) return;
    const action=control.dataset.walk;
    const value=control.dataset.value;
    if(action==='full') return openFull();
    if(action==='report') return exportReport();
    if(action==='route'&&routeOptions.some(([key])=>key===value)) { setupRoute=value;needsStorage=false;return render(true); }
    if(action==='setup-back') { setupRoute='';return render(true); }
    if(action==='storage-help') { needsStorage=true;return render(true); }
    if(action==='storage'&&setupRoute&&storageOptions.some(([key])=>key===value)) {
      saveScope({alias:'现场部署',cluster:setupRoute==='fresh'?'new':'reuse',manager:setupRoute==='reuse'?'reuse':'new',
        network:'offline',storage:value,ns:'dtstack',emNs:'easymanager'});
      return render(true);
    }
    const {step,cards,issues,record}=state();
    if(!step) return;
    if(action==='copy') {
      const block=root.querySelector('#walk-command');
      try { await navigator.clipboard.writeText(block.textContent);note='命令已复制。到标注的终端执行。'; }
      catch {
        const range=document.createRange();
        range.selectNodeContents(block);
        const selection=getSelection();
        selection.removeAllRanges();selection.addRange(range);
        note='已选中命令，按 Ctrl+C 复制。';
      }
      const status=root.querySelector('.walk-note');
      status.textContent=note;status.hidden=false;
      return;
    }
    note='';
    if(action==='issue'&&issues[Number(value)]) { issueIndex=Number(value);inputs={}; }
    if(action==='retry') { issueIndex=-1;inputs={}; }
    if(action==='previous-action') { cursor.action=Math.max(0,cursor.action-1);inputs={}; }
    if(action==='back-action') cursor.review=false;
    if(action==='normal') {
      if(cursor.action===cards.length-1) cursor.review=true;
      else { cursor.action++;inputs={}; }
    }
    if(action==='confirm-check') {
      if(cursor.review&&!issues[issueIndex]) commit(step,{...record,checks:step.checks.map((_,index)=>index),status:'passed',reason:''});
    }
    if(action==='block') {
      note='卡点已记录。处理完后从这里复查。';
      commit(step,{...record,status:'blocked',reason:'验收不通过'});
    }
    if(action==='skip-toggle') showSkip=!showSkip;
    if(action==='skip-reason'&&step.optional&&skipReasons[Number(value)]) {
      commit(step,{...record,status:'na',reason:skipReasons[Number(value)]});
    }
    remember();
    render(true);
  });
  return {render,reset(){cursor=null;issueIndex=-1;showSkip=false;inputs={};setupRoute='';needsStorage=false;note='';remember();}};
}
