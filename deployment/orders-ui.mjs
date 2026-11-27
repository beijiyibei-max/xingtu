import {parameters} from './command-params.mjs';
import {request} from '../web/api.mjs';
import {readProject,rememberProject} from './state.mjs';

export function initDeploymentOrders(getScope) {
  const root=document.createElement('section');
  root.id='deployment-orders';root.className='surface order-workspace';
  root.innerHTML='<div class="order-heading"><div><p class="eyebrow">PROJECT RUNBOOK</p><h2>我的部署操作单</h2><p>把当前项目变成逐步核对的操作单，换电脑后也能接着做。</p></div><span class="order-badge">项目草稿 · 人工核对</span></div>'+
    '<details id="order-setup"><summary>生成或重新生成</summary><form id="order-create">'+
    '<p>使用上面已保存的项目设置；这里只补目标标识和集群 context。现场值只交给当前星图服务器。</p>'+
    '<div class="fields"><label>操作目标标识<input name="target" required maxlength="80" placeholder="从现场规划表填写节点名或代号"></label>'+
    '<label>集群 context（未安装可留空）<input name="context" maxlength="253" placeholder="集群建立后从 kubectl config current-context 核对"></label></div>'+
    '<label class="check"><input name="confirmed" type="checkbox"><span>已确认当前项目的目标、context 和 Namespace</span></label>'+
    '<label class="check"><input name="allowAssistant" type="checkbox"><span>本项目允许使用问星图外部助手（每次提问还需单独确认）</span></label>'+
    '<label class="check"><input name="storeConsent" type="checkbox" required><span>允许当前星图服务器保存此项目的设置和核对记录</span></label>'+
    '<button class="primary" type="submit">生成我的操作单</button> <button id="order-new" type="button">另建项目</button></form></details>'+
    '<div class="order-controls"><label>切换版本<select id="order-list"><option value="">选择项目</option></select></label><button id="order-refresh" type="button" class="quiet small">刷新项目</button></div>'+
    '<p id="order-message" role="status"></p><div id="order-content"></div>';
  document.querySelector('#walk-screen').after(root);
  const find=id=>root.querySelector('#'+id);
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  let active=null,selected='',sequence=0,busy=false;
  let cardIndex=0;
  const cardCache=new Map();      // revision::stepId -> Promise<cards>，避免来回翻页重复请求
  const paramStore=new Map();     // stepId::cardIndex -> 已填参数，翻页和切步骤都不丢
  const offline=location.protocol==='file:';
  const announce=text=>{find('order-message').textContent=text;};
  const publish=()=>document.dispatchEvent(new CustomEvent('deployment-plan-selected',{detail:active?{id:active.id,allowAssistant:active.allowAssistant}:null}));
  async function api(action,body){
    return request('/api/deployment/plans'+action,body?{method:'POST',body}:{});
  }
  function syncProjectChip(){
    const chip=document.querySelector('[data-project-chip]');
    if(!chip)return;
    const project=readProject();
    if(!project){chip.textContent='选择项目 →';chip.title='选择或切换当前项目';return;}
    chip.textContent=project.name+' · '+project.lock;
    chip.title='当前项目：'+project.name+'，点击切换版本';
  }
  function emptyState(text,actionLabel,onAction){
    const box=node('div',undefined,'xt-empty');
    box.append(node('p',text,'xt-empty-text'));
    if(actionLabel){const button=node('button',actionLabel,'ghost small');button.type='button';button.onclick=onAction;box.append(button);}
    return box;
  }
  async function list(){
    const result=await api('');const select=find('order-list');select.replaceChildren(node('option','选择项目'));
    for(const item of result.plans){const option=node('option',item.alias+' · 第 '+item.revision+' 版');option.value=item.id;select.append(option);}
    if(active)select.value=active.id;
    return result.plans;
  }
  function setActive(value){
    sequence++;active=value;publish();
    const form=find('order-create');for(const key of ['target','context'])form.elements[key].value=value[key];
    for(const key of ['confirmed','allowAssistant'])form.elements[key].checked=value[key];
    form.elements.storeConsent.checked=false;
    selected=value.nextStepId||value.steps[0].id;cardIndex=0;
    try{sessionStorage.setItem('xingtu-active-order',value.id);}catch{}
    rememberProject({id:value.id,name:value.scope.alias,lock:'第 '+value.revision+' 版'});
    syncProjectChip();
    render();
  }
  function render(){
    const content=find('order-content');content.replaceChildren();
    if(!active)return;
    const summary=node('div',undefined,'order-summary');
    summary.append(node('h3',active.scope.alias+' · 第 '+active.revision+' 版'),
      node('p','目标 '+active.target+' · context '+(active.context||'待集群建立后登记')+' · '+active.scope.ns),
      node('p',active.notice,'order-notice'));
    const select=node('select');select.id='order-step';select.setAttribute('aria-label','选择操作单步骤');
    for(const step of active.steps){const option=node('option',(step.record.status==='stale'?'模板变化，待重验 · ':step.record.status==='recorded'?'已人工核对 · ':step.record.status==='not-applicable'?'范围外 · ':step.record.status==='blocked'?'卡住 · ':'待核对 · ')+step.title);option.value=step.id;select.append(option);}
    select.value=selected;select.onchange=()=>{selected=select.value;cardIndex=0;render();};
    const next=node('button','回到下一步');next.type='button';next.className='quiet small';next.onclick=()=>{selected=active.nextStepId||active.steps[0].id;cardIndex=0;render();};
    summary.append(select,next);content.append(summary);
    const step=active.steps.find(s=>s.id===selected);
    document.dispatchEvent(new CustomEvent('deployment-step',{detail:step.id}));
    const cards=node('div',undefined,'order-cards');content.append(cards);
    const thisSequence=++sequence;
    loadCards(step).then(list=>{if(thisSequence!==sequence)return;paintCards(step,list,cards);})
      .catch(error=>{if(thisSequence===sequence)announce(error.message);});
    const form=node('form');form.id='order-checks';form.append(node('h3','这一步完成后，逐项核对'));
    step.checks.forEach((text,index)=>{const label=node('label',undefined,'check');const input=node('input');input.type='checkbox';input.name='check';input.value=String(index);input.checked=step.record.checks?.includes(index)||false;label.append(input,node('span',text));form.append(label);});
    const label=node('label','证据或现场记录编号（不填原始输出）');const reference=node('input');reference.name='reference';reference.required=true;reference.maxLength=80;reference.value=step.record.reference||'';label.append(reference);form.append(label);
    const done=node('button','记录已核对，进入下一步','primary');done.type='submit';const blocked=node('button','记录卡点');blocked.type='button';
    form.append(done,blocked);
    async function record(status){
      if(busy||!form.reportValidity())return;busy=true;done.disabled=blocked.disabled=true;
      try{const value=await api('/record',{id:active.id,revision:active.revision,stepId:step.id,status,
        checks:Array.from(form.querySelectorAll('input[name=check]:checked'),input=>Number(input.value)),reference:reference.value.trim()});
        setActive(value);announce(status==='recorded'?'已保存人工核对记录。':status==='not-applicable'?'已按实施单编号记录范围外项目。':'已记录卡点，后续步骤的旧记录已失效。');
      }catch(error){announce(error.message);}finally{busy=false;done.disabled=blocked.disabled=false;}
    }
    form.onsubmit=event=>{event.preventDefault();record('recorded');};blocked.onclick=()=>record('blocked');
    if(step.optional){const skip=node('button','按实施单标记为范围外');skip.type='button';skip.onclick=()=>record('not-applicable');form.append(skip);}
    content.append(form,node('p','来源 '+step.sources.map(source=>source.ref||source.file||source.type).join('；'),'muted'));
  }
  const cardKey=(step,card)=>step.id+'::'+card.index;
  function loadCards(step){
    const key=active.revision+'::'+step.id;
    if(!cardCache.has(key))cardCache.set(key,api('/cards',{id:active.id,revision:active.revision,stepId:step.id}).then(data=>data.cards));
    return cardCache.get(key);
  }
  async function goCard(delta){
    const position=active.steps.findIndex(item=>item.id===selected);
    const list=await loadCards(active.steps[position]);
    const target=cardIndex+delta;
    if(target>=0&&target<list.length){cardIndex=target;render();return;}
    const neighbour=active.steps[position+delta];
    if(!neighbour){announce(delta>0?'已是最后一项。':'已是第一项。');return;}
    selected=neighbour.id;
    const nextList=await loadCards(neighbour);
    cardIndex=delta>0?0:Math.max(0,nextList.length-1);
    render();
  }
  function paintCards(step,list,container){
    container.replaceChildren();
    if(!list.length){container.append(emptyState('这一步没有需要执行的卡片。'));return;}
    cardIndex=Math.max(0,Math.min(cardIndex,list.length-1));
    const card=list[cardIndex];
    const position=active.steps.findIndex(item=>item.id===step.id);
    const nav=node('div',undefined,'order-nav');
    const prev=node('button','上一项');prev.type='button';prev.disabled=position===0&&cardIndex===0;prev.onclick=()=>goCard(-1);
    const next=node('button','下一项');next.type='button';next.onclick=()=>goCard(1);
    nav.append(prev,node('span','第 '+(cardIndex+1)+' / '+list.length+' 项'),next);
    container.append(nav,renderCard(step,card));
  }
  function renderCard(step,card){
    const section=node('details',undefined,'order-card');section.open=true;const title=node('summary',card.title);section.append(title);
    section.append(node('p','在哪里做 · '+card.target));
    const command=node('div',undefined,'order-cmd-wrap');
    const output=node('pre',card.kind==='terminal'?card.text:(card.actions||[]).join('\n'),'order-cmd');command.append(output);section.append(command);
    const store=paramStore.get(cardKey(step,card))||{};
    for(const key of card.missing){const label=node('label',parameters[key]?.label||key);const input=node('input');input.maxLength=256;input.autocomplete='off';input.value=store[key]||'';input.oninput=()=>{store[key]=input.value.trim();paramStore.set(cardKey(step,card),store);};label.append(input);section.append(label);}
    if(card.kind==='terminal'){
      const copy=node('button','复制','order-copy');copy.type='button';copy.title='核验并复制检查命令';
      copy.disabled=Boolean(card.change)||!active.confirmed||card.blockedReason.includes('复用');
      copy.onclick=async()=>{
        copy.disabled=true;
        const requested={id:active.id,revision:active.revision,stepId:step.id};
        try{const data=await api('/command',{...requested,cardIndex:card.index,inputs:store});
          if(!active||active.id!==requested.id||active.revision!==requested.revision||selected!==requested.stepId)return;
          output.textContent=data.command;
          try{await navigator.clipboard.writeText(data.command);announce('检查命令已复制。执行前核对窗口所在机器与「'+data.target+'」一致。');}
          catch{announce('浏览器未允许自动复制，请从命令框手动复制。');}
        }catch(error){announce(error.message);}finally{copy.disabled=false;}
      };
      command.append(copy);
    }
    if(card.blockedReason)section.append(node('p',card.blockedReason,'order-warning'));
    section.append(node('h4','什么反馈算正常'),node('p',card.normal),node('span','正常输出长这样','order-expect-label'),node('pre',card.sample,'order-expect'));
    for(const error of card.errors||[]){const detail=node('details');detail.append(node('summary',error.signal),node('p','先查 · '+error.check),node('p','处理 · '+error.fix),node('p','复验 · '+error.verify));section.append(detail);}
    return section;
  }
  find('order-create').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const scope=getScope();if(!scope){announce('先在部署陪跑中选好新装或复用路线并保存项目设置。');return;}
    const form=event.target;if(!form.reportValidity())return;
    if(active&&!confirm('重新生成会清空这份操作单的人工记录，旧页面立即失效。继续？'))return;
    busy=true;const button=form.querySelector('button[type=submit]');button.disabled=true;
    try{setActive(await api('/generate',{scope,target:form.elements.target.value.trim(),context:form.elements.context.value.trim(),
      confirmed:form.elements.confirmed.checked,allowAssistant:form.elements.allowAssistant.checked,...(active?{id:active.id,revision:active.revision}:{})}));
      find('order-setup').open=false;await list();announce('操作单已生成。');
    }catch(error){announce(error.message);}finally{busy=false;button.disabled=false;}
  };
  find('order-new').onclick=()=>{sequence++;active=null;publish();find('order-create').reset();find('order-content').replaceChildren();announce('已切换为新建操作单，原项目仍保留。');};
  find('order-list').onchange=async event=>{if(!event.target.value||busy)return;try{setActive(await api('/open',{id:event.target.value}));announce('已恢复服务器保存的操作单。');}catch(error){announce(error.message);}};
  find('order-refresh').onclick=async()=>{try{await list();if(active)setActive(await api('/open',{id:active.id}));announce('已刷新。');}catch(error){announce(error.message);}};
  if(offline){find('order-setup').hidden=true;find('order-refresh').disabled=true;announce('服务器操作单需登录星图后使用；当前离线教学和本机进度仍可使用。');return;}
  syncProjectChip();
  list().then(async plans=>{
    let saved;try{saved=sessionStorage.getItem('xingtu-active-order');}catch{}
    if(saved){setActive(await api('/open',{id:saved}));return;}
    if(!plans.length){find('order-content').append(emptyState('还没有操作单。先生成一份，再按步骤逐项核对。','生成我的操作单',()=>{find('order-setup').open=true;}));return;}
    find('order-setup').open=true;
  }).catch(error=>announce(error.message));
}
