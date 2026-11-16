import {parameters} from './command-params.mjs';

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
    '<div class="order-controls"><label>打开已有操作单<select id="order-list"><option value="">选择项目</option></select></label><button id="order-refresh" type="button">刷新项目</button></div>'+
    '<p id="order-message" role="status"></p><div id="order-content"></div>';
  document.querySelector('#walk-screen').after(root);
  const find=id=>root.querySelector('#'+id);
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  let active=null,selected='',sequence=0,busy=false;
  const offline=location.protocol==='file:';
  const announce=text=>{find('order-message').textContent=text;};
  const publish=()=>document.dispatchEvent(new CustomEvent('deployment-plan-selected',{detail:active?{id:active.id,allowAssistant:active.allowAssistant}:null}));
  async function api(action,body){
    const response=await fetch('/api/deployment/plans'+action,{method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error?.message||'操作单服务未就绪');
    return result;
  }
  async function list(){
    const result=await api('');const select=find('order-list');select.replaceChildren(node('option','选择项目'));
    for(const item of result.plans){const option=node('option',item.alias+' · 第 '+item.revision+' 版');option.value=item.id;select.append(option);}
    if(active)select.value=active.id;
  }
  function setActive(value){
    sequence++;active=value;publish();
    const form=find('order-create');for(const key of ['target','context'])form.elements[key].value=value[key];
    for(const key of ['confirmed','allowAssistant'])form.elements[key].checked=value[key];
    form.elements.storeConsent.checked=false;
    selected=value.nextStepId||value.steps[0].id;
    try{sessionStorage.setItem('xingtu-active-order',value.id);}catch{}
    render();
  }
  function render(){
    const content=find('order-content');content.replaceChildren();
    if(!active)return;
    const summary=node('div',undefined,'order-summary');
    summary.append(node('h3',active.scope.alias+' · 第 '+active.revision+' 版'),
      node('p','目标 '+active.target+' · context '+(active.context||'待集群建立后登记')+' · '+active.scope.ns),
      node('p',active.notice,'muted'));
    const select=node('select');select.id='order-step';select.setAttribute('aria-label','选择操作单步骤');
    for(const step of active.steps){const option=node('option',(step.record.status==='stale'?'模板变化，待重验 · ':step.record.status==='recorded'?'已人工核对 · ':step.record.status==='not-applicable'?'范围外 · ':step.record.status==='blocked'?'卡住 · ':'待核对 · ')+step.title);option.value=step.id;select.append(option);}
    select.value=selected;select.onchange=()=>{selected=select.value;render();};
    const next=node('button','回到下一步');next.type='button';next.onclick=()=>{selected=active.nextStepId||active.steps[0].id;render();};
    summary.append(select,next);content.append(summary);
    const step=active.steps.find(s=>s.id===selected);
    document.dispatchEvent(new CustomEvent('deployment-step',{detail:step.id}));
    const cards=node('div',undefined,'order-cards');content.append(cards);
    const thisSequence=++sequence;
    api('/cards',{id:active.id,revision:active.revision,stepId:step.id}).then(data=>{
      if(thisSequence!==sequence)return;
      for(const card of data.cards)cards.append(renderCard(step,card));
    }).catch(error=>{if(thisSequence===sequence)announce(error.message);});
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
  function renderCard(step,card){
    const section=node('details',undefined,'order-card');const title=node('summary',card.title);section.append(title);
    section.append(node('p','在哪里做 · '+card.target));
    const output=node('pre',card.kind==='terminal'?card.text:(card.actions||[]).join('\n'));section.append(output);
    const inputs={};
    for(const key of card.missing){const label=node('label',parameters[key]?.label||key);const input=node('input');input.maxLength=256;input.autocomplete='off';input.oninput=()=>{inputs[key]=input.value.trim();};label.append(input);section.append(label);}
    if(card.kind==='terminal'){
      const copy=node('button','核验并复制检查命令');copy.type='button';
      copy.disabled=Boolean(card.change)||!active.confirmed||card.blockedReason.includes('复用');
      copy.onclick=async()=>{
        copy.disabled=true;
        const requested={id:active.id,revision:active.revision,stepId:step.id};
        try{const data=await api('/command',{...requested,cardIndex:card.index,inputs});
          if(!active||active.id!==requested.id||active.revision!==requested.revision||selected!==requested.stepId)return;
          output.textContent=data.command;
          try{await navigator.clipboard.writeText(data.command);announce('检查命令已复制。执行前核对窗口所在机器与「'+data.target+'」一致。');}
          catch{announce('浏览器未允许自动复制，请从命令框手动复制。');}
        }catch(error){announce(error.message);}finally{copy.disabled=false;}
      };
      section.append(copy);
    }
    if(card.blockedReason)section.append(node('p',card.blockedReason,'order-warning'));
    section.append(node('h4','什么反馈算正常'),node('p',card.normal),node('pre',card.sample));
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
      find('order-setup').open=false;await list();announce('操作单已生成。展开教学卡，按正常反馈和报错分支逐步核对。');
    }catch(error){announce(error.message);}finally{busy=false;button.disabled=false;}
  };
  find('order-new').onclick=()=>{sequence++;active=null;publish();find('order-create').reset();find('order-content').replaceChildren();announce('已切换为新建操作单，原项目仍保留。');};
  find('order-list').onchange=async event=>{if(!event.target.value||busy)return;try{setActive(await api('/open',{id:event.target.value}));announce('已恢复服务器保存的操作单。');}catch(error){announce(error.message);}};
  find('order-refresh').onclick=async()=>{try{await list();if(active)setActive(await api('/open',{id:active.id}));announce('已刷新。');}catch(error){announce(error.message);}};
  if(offline){find('order-setup').hidden=true;find('order-refresh').disabled=true;announce('服务器操作单需登录星图后使用；当前离线教学和本机进度仍可使用。');return;}
  list().then(async()=>{let saved;try{saved=sessionStorage.getItem('xingtu-active-order');}catch{}if(saved)setActive(await api('/open',{id:saved}));else find('order-setup').open=true;}).catch(error=>announce(error.message));
}
