import {baselineFields,inspectYaml,maxYamlBytes,readBaseline} from './yaml-review.mjs';

const escape = value => String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[char]);
const labels={change:'需要调整',verify:'待现场核对',note:'说明'};
const maxFiles=8;

export function initYamlReview(getScope) {
  const dialog=document.getElementById('yaml-review');
  const byId=id=>dialog.querySelector('#'+id);
  const fileInput=byId('yaml-files');
  const results=byId('yaml-results');
  const status=byId('yaml-status');
  const baseline=byId('yaml-baseline');
  const filters=byId('yaml-filters');
  let files=[];
  let reports=[];
  let generation=0;
  let filter='all';
  let isExample=false;

  baseline.innerHTML=baselineFields.map(field=>`<label>${escape(field.label)}
    <input name="${field.id}" maxlength="240" autocomplete="off" spellcheck="false" placeholder="${escape(field.hint)}"></label>`).join('');

  function render() {
    const counts={change:0,verify:0,note:0};
    for (const report of reports) for (const section of report.sections) {
      for (const finding of section.findings) counts[finding.severity]++;
    }
    const options=[['all','全部',counts.change+counts.verify+counts.note],...Object.entries(labels).map(([key,label])=>[key,label,counts[key]])];
    filters.hidden=!reports.length;
    filters.innerHTML=options.map(([key,label,count])=>`<button type="button" data-yaml-filter="${key}" aria-pressed="${filter===key}">
      ${label} <span>${count}</span></button>`).join('');
    results.innerHTML=reports.map(report=>`<article class="yaml-file">
      <h3>${escape(report.name)}</h3>
      ${report.limited?'<p class="yaml-limit">部分文档超出检查范围。可拆成较小的 YAML 再检查。</p>':''}
      ${report.sections.map(section=>{
        const matches=section.findings.filter(finding=>filter==='all'||finding.severity===filter);
        if (filter!=='all'&&!matches.length) return '';
        return `<section class="yaml-section"><h4>${escape(section.label)}</h4>${
          matches.map(finding=>`<div class="yaml-finding ${finding.severity}">
            <div class="yaml-finding-top"><span class="yaml-severity">${labels[finding.severity]}</span>
              <code>${escape(finding.path)}</code>${finding.line?`<small>第 ${finding.line} 行</small>`:''}</div>
            <strong>${escape(finding.title)}</strong>
            <p><b>修改建议</b> ${escape(finding.advice)}</p>
            ${finding.expected?`<p class="yaml-expected"><b>已填现场值</b> <code>${escape(finding.expected)}</code></p>`:''}
            <p><b>怎么复验</b> ${escape(finding.verify)}</p>
          </div>`).join('') || '<p class="yaml-empty">未触发当前检查规则。请对照本批部署方案核验实际值。</p>'
        }</section>`;
      }).join('') || '<p class="yaml-empty">当前分类下没有检查项。</p>'}
    </article>`).join('');
  }

  function clear() {
    generation++;
    files=[];
    reports=[];
    isExample=false;
    filter='all';
    fileInput.value='';
    for (const field of baseline.querySelectorAll('input')) field.value='';
    status.textContent='选一个或多个 YAML 开始检查。';
    render();
  }

  async function scan() {
    const sequence=++generation;
    const queued=files.slice();
    const input=Object.fromEntries([...baseline.querySelectorAll('input')].map(field=>[field.name,field.value]));
    const {values,invalid}=readBaseline(input);
    reports=[];
    filter='all';
    render();
    if (invalid.length) {
      status.textContent='请先核对已填现场值的格式：'+invalid.join('、')+'。未确认的字段可留空。';
      return;
    }
    if (!queued.length) {
      status.textContent='先选 YAML 文件，再对照现场值复查。';
      return;
    }
    status.textContent='正在本机读取和检查 YAML…';
    const next=[];
    const scope=getScope();
    for (const file of queued) {
      const name=file.webkitRelativePath||file.name;
      try {
        if (!/\.ya?ml$/i.test(file.name) || file.size>maxYamlBytes) {
          const problem=file.size>maxYamlBytes?'文件超过 512 KiB':'请选择 .yaml 或 .yml 文件';
          next.push({name,sections:[{label:'读取限制',findings:[{path:'YAML',severity:'change',title:problem,
            advice:'选择本次要检查的 YAML 配置，必要时先拆分。',verify:'选择符合限制的 UTF-8 YAML 后重新检查。'}]}]});
        } else {
          const decoded=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
          if (sequence!==generation) return;
          next.push({name,...inspectYaml(name,decoded,{baseline:values,storage:scope?.storage})});
        }
      } catch {
        next.push({name,sections:[{label:'读取失败',findings:[{path:'YAML',severity:'change',title:'无法读取文件或不是 UTF-8 编码',
          advice:'在本机编辑器确认文件编码，再选择 UTF-8 YAML。',verify:'重新选择文件并读取。'}]}]});
      }
    }
    if (sequence!==generation) return;
    reports=next;
    status.textContent=`已检查 ${next.length} 份${isExample?'演示':'本地'}文件${Object.keys(values).length?'，已对照填写的现场值':''}。`;
    render();
  }

  fileInput.addEventListener('change',()=>{
    const picked=Array.from(fileInput.files);
    fileInput.value='';
    if (!picked.length) return;
    if (picked.length>maxFiles) {
      status.textContent='一次最多检查 8 份 YAML，请分批选择。';
      return;
    }
    files=picked;
    isExample=false;
    void scan();
  });
  byId('yaml-choose').onclick=()=>fileInput.click();
  byId('yaml-close').onclick=()=>dialog.close();
  byId('yaml-clear').onclick=clear;
  byId('yaml-rescan').onclick=()=>void scan();
  byId('yaml-example').onclick=()=>{
    clear();
    isExample=true;
    files=[
      new File(['IP: 192.0.2.18\nport: 30080\nstorage:\n  em:\n    pvc: local\n    local:\n      path: /etc/kubernetes/pv/dtstack/data\n      nodeLabelKey: kubernetes.io/hostname\n      nodeLableVal: work01\n'],'EM-模板示例.yaml'),
      new File(['global:\n  domain: portal.example.com\n  redis:\n    host: 127.0.0.1\n  minio:\n    endpoint: \"<填写 S3 地址>\"\n  plugin:\n    jobCount: 0\n'],'common-config-模板示例.yaml'),
    ];
    void scan();
  };
  filters.addEventListener('click',event=>{
    const button=event.target.closest('[data-yaml-filter]');
    if (!button) return;
    filter=button.dataset.yamlFilter;
    render();
    filters.querySelector(`[data-yaml-filter="${filter}"]`)?.focus();
  });
  document.addEventListener('click',event=>{
    if (event.target.closest('[data-yaml-review]') && !dialog.open) dialog.showModal();
  });
}
