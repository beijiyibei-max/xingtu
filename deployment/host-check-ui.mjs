import {hostReportLimit,readHostReport,interpretHost,makeHostCommand} from './host-check.mjs';

const labels={fix:'优先处理',verify:'还要核对',seen:'已读到'};

export function initHostCheck(script,download) {
  const dialog=document.getElementById('host-check');
  const byId=id=>dialog.querySelector('#'+id);
  const paste=byId('host-result-input');
  const file=byId('host-result-file');
  const command=byId('host-command');
  const status=byId('host-status');
  const results=byId('host-results');
  let generation=0;
  byId('host-source').textContent=script;

  function showCommand() {
    command.textContent=makeHostCommand(script,byId('host-k8s').checked);
  }

  function render(raw) {
    results.replaceChildren();
    try {
      const findings=interpretHost(readHostReport(raw));
      const fixes=findings.filter(item=>item.level==='fix').length;
      status.textContent=fixes?`当前结果有 ${fixes} 项需要优先处理。处理后在同一台机器重新检测。`:'已读到本机结果，请按下方清单复核待查项。';
      for (const finding of findings) {
        const item=document.createElement('li');
        item.className='host-result '+finding.level;
        const label=document.createElement('span');
        label.textContent=labels[finding.level];
        const title=document.createElement('strong');
        title.textContent=finding.title;
        const detail=document.createElement('p');
        detail.textContent=finding.detail;
        item.append(label,title,detail);
        results.append(item);
      }
    } catch(error) {
      status.textContent=error.message;
    } finally {
      paste.value='';
    }
  }

  byId('host-k8s').onchange=showCommand;
  byId('host-copy').onclick=async()=>{
    try {
      await navigator.clipboard.writeText(command.textContent);
      status.textContent='已复制。到客户允许的 Linux 终端执行。';
    } catch {
      command.closest('details').open=true;
      command.scrollIntoView({block:'nearest'});
      const range=document.createRange();
      range.selectNodeContents(command);
      const selection=getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent='已选中命令，按 Ctrl+C 复制。';
    }
  };
  byId('host-download').onclick=()=>download('xt-preflight.sh',script,'text/plain;charset=utf-8');
  byId('host-import').onclick=()=>file.click();
  file.onchange=async()=>{
    const picked=file.files[0];
    file.value='';
    if(!picked) return;
    const sequence=++generation;
    results.replaceChildren();
    if(picked.size>hostReportLimit) {
      status.textContent='文件过大，请选只包含检测结果一行的文件。';
      return;
    }
    try {
      const raw=await picked.text();
      if(sequence===generation) render(raw);
    } catch {
      if(sequence===generation) status.textContent='无法读取文件，请粘贴终端最后一行。';
    }
  };
  byId('host-interpret').onclick=()=>{
    generation++;
    render(paste.value);
  };
  byId('host-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    generation++;
    paste.value='';
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-host-check]')&&!dialog.open) {
      showCommand();
      dialog.showModal();
    }
  });
}
