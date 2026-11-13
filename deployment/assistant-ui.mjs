export function initDeploymentAssistant(steps) {
  const panel=document.createElement('section');
  panel.className='surface settings';
  panel.innerHTML=`<details><summary>问星图 · 当前部署步骤</summary>
    <p id="ask-step"></p>
    <p>描述操作和现象即可。现场 IP、配置、日志和凭据请留在现场。</p>
    <label><input id="ask-consent" type="checkbox">本次允许发送脱敏问题给已配置的助手服务</label>
    <form id="ask-form"><label for="ask-question">这一步哪里卡住了</label>
    <textarea id="ask-question" maxlength="600" rows="3" required placeholder="例如，上传显示完成，但列表里少了一个 Chart"></textarea>
    <button class="primary" type="submit">问星图</button></form>
    <div id="ask-answer" class="assistant-answer" role="status"></div></details>
    <details><summary>检查本次操作单</summary>
    <p>依次选择操作单、manifest.json 和 evidence.json，校验后查看各步骤的状态。</p>
    <form id="contract-form"><label>操作单<input name="order" type="file" accept=".json" required></label>
    <label>物料清单<input name="manifest" type="file" accept=".json" required></label>
    <label>证据包<input name="evidence" type="file" accept=".json" required></label>
    <label><input name="consent" type="checkbox" required>本次允许将这三份文件交给当前星图服务器校验</label>
    <button type="submit">校验操作单</button></form>
    <div id="contract-answer" class="assistant-answer" role="status"></div></details>`;
  document.querySelector('#walk-screen').after(panel);
  const find=id=>panel.querySelector('#'+id);
  let current=steps[0],controller,sequence=0;
  const setStep=step=>{
    if(!step)return;
    if(current.id!==step.id){sequence++;controller?.abort();find('ask-answer').textContent='';find('ask-question').value='';}
    current=step;find('ask-step').textContent='当前步骤 · '+step.title;
  };
  setStep(current);
  document.addEventListener('deployment-step',event=>setStep(steps.find(step=>step.id===event.detail)));
  const fallback=()=>{
    const card=current.tutorial?.[0];
    return card ? '本地步骤建议\n执行位置　'+card.target+'\n正常反馈　'+card.normal+
      '\n先检查　'+(card.errors?.[0]?.check||'按当前教学卡核对结果。') : '请展开当前步骤的正常反馈和报错分支。';
  };
  find('ask-form').onsubmit=async event=>{
    event.preventDefault();
    const out=find('ask-answer');
    if(location.protocol==='file:'||!find('ask-consent').checked){out.textContent=fallback();return;}
    const requestId=++sequence;
    controller?.abort();controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),28000);
    const button=event.target.querySelector('button');button.disabled=true;
    out.textContent='正在核对这一步…';
    try{
      const response=await fetch('/api/deployment/ask',{method:'POST',headers:{'Content-Type':'application/json'},
        signal:controller.signal,body:JSON.stringify({question:find('ask-question').value.trim(),stepId:current.id,
          stepVersion:'2.1.0',symptomOptionIds:[]})});
      const data=await response.json();
      if(requestId!==sequence)return;
      if(data.status==='answered'){
        out.textContent='先做什么\n'+data.nextCheck+'\n\n在哪里做\n'+data.where+
          '\n\n正常结果\n'+data.expected+'\n\n结果不同时\n'+data.ifDifferent+
          '\n\n依据　'+data.references.map(ref=>ref.sourceId).join('、');
      }else{
        const reasons={'sensitive-content':'问题中含可能的现场信息，请改成不含具体值的描述。',
          'consent-required':'助手服务的使用授权尚未配置或已过期。','rate-limited':'提问较多，请稍后重试。',
          offline:'助手服务尚未启用。','provider-not-approved':'助手服务的权限需要管理员核对。'};
        out.textContent=(reasons[data.reason]||data.error?.message||'本次未取得可核验的助手回答。')+'\n\n'+fallback();
      }
    }catch(error){if(requestId===sequence)out.textContent='服务暂时不可用。\n\n'+fallback();}
    finally{clearTimeout(timeout);button.disabled=false;}
  };
  find('contract-form').onsubmit=async event=>{
    event.preventDefault();const out=find('contract-answer'),form=event.target;
    if(location.protocol==='file:'){out.textContent='请通过 Java 服务的部署页面校验操作单。';return;}
    const button=form.querySelector('button');button.disabled=true;
    try{
      const parts=[];
      for(const name of ['order','manifest','evidence']){
        const file=form.elements[name].files[0];
        if(!file||file.size>170000)throw Error('每份文件需小于 170 KB。');
        parts.push(JSON.stringify(name)+':'+await file.text());
      }
      out.textContent='正在校验文件、版本和证据…';
      const response=await fetch('/api/deployment/validate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:'{'+parts.join(',')+'}',signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if(!data.valid)throw Error(data.error?.message||'校验未通过 · '+data.code);
      out.textContent=(data.fixture?'模拟操作单校验通过':'操作单文件校验通过')+
        '。现场执行还需核验当前目标、发布记录和批准条件。\n\n'+data.steps.map(step=>
          step.stepId+'　'+step.status+'　'+step.target.join('、')+(step.reason?'　'+step.reason:'')).join('\n');
    }catch(error){out.textContent=error.message;}
    finally{button.disabled=false;}
  };
}
