const dnsName = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const namespace = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const valid = pattern => value => pattern.test(value);
export const parameters = {
  ns:{label:'产品 Namespace',scope:true,valid:valid(namespace)},
  emNs:{label:'EM Namespace',scope:true,valid:valid(namespace)},
  objectNs:{label:'组件实际 Namespace',hint:'例如 ingress-nginx',valid:valid(namespace)},
  pod:{label:'Pod 名',hint:'从 get pods 结果复制',valid:valid(dnsName)},
  node:{label:'节点名',hint:'从 kubectl get nodes 结果复制',valid:valid(dnsName)},
  container:{label:'容器名',hint:'从 describe 的 Containers 段复制',valid:valid(namespace)},
  service:{label:'Service 名',hint:'从 get svc 结果复制',valid:valid(namespace)},
  claim:{label:'PVC 名',hint:'从 get pvc 结果复制',valid:valid(dnsName)},
  job:{label:'Job 名',hint:'从 get jobs 结果复制',valid:valid(dnsName)},
  workload:{label:'StatefulSet 名',hint:'从 get statefulsets 结果复制',valid:valid(dnsName)},
  archive:{label:'物料文件路径',hint:'例如 ./approved-package.tar',valid:valid(/^[a-zA-Z0-9_.\/][a-zA-Z0-9_.\/-]{0,255}$/)},
  path:{label:'实际挂载路径',hint:'例如 /data',valid:valid(/^\/[a-zA-Z0-9_.\/-]{0,255}$/)},
  host:{label:'目标地址',hint:'使用获批主机名或 IP',valid:valid(/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/)},
  port:{label:'目标端口',hint:'1–65535',valid:value=>/^\d{1,5}$/.test(value)&&Number(value)>0&&Number(value)<=65535},
};

export function commandKeys(template) {
  const keys = [...new Set(Array.from(template.matchAll(/\{\{([a-zA-Z]+)\}\}/g), match=>match[1]))];
  for (const key of keys) if (!Object.hasOwn(parameters,key)) throw Error('未知命令参数：'+key);
  return keys;
}

export function prepareCommand(template,scope,inputs) {
  const missing = [];
  const invalid = [];
  const text = template.replace(/\{\{([a-zA-Z]+)\}\}/g,(_match,key)=>{
    const field = parameters[key];
    const value = (field.scope ? scope?.[key] : inputs[key])?.trim() || '';
    if (!value) missing.push(field.label);
    else if (!field.valid(value)) invalid.push(field.label);
    else return value;
    return `‹${field.label}›`;
  });
  return {text,missing,invalid};
}
