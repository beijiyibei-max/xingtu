export const schemaVersion = 1;
export const labels = {pending:'待核验',passed:'已通过',blocked:'卡住',na:'不适用'};
export const blockReasons = ['等现场确认或变更窗口','物料、版本或权限缺失','安装/发布执行异常','验收不通过','需要研发或客户协助'];
export const skipReasons = ['本期实施清单未包含','本次版本或架构不使用','本项目采用不同技术方案'];
export const resolved = record => record?.status === 'passed' || record?.status === 'na';
const namespacePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const aliasPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u;
const referencePattern = /^[\p{L}\p{N}_.-]{0,40}$/u;

export function newPlan() {
  return {kind:'xingtu-deployment-progress',version:schemaVersion,scope:null,records:{}};
}

export function validateScope(scope) {
  if (!scope || typeof scope.alias !== 'string' || !aliasPattern.test(scope.alias) ||
      !['new','reuse'].includes(scope.cluster) || !['new','reuse'].includes(scope.manager) ||
      !['offline','approved-network'].includes(scope.network) || !['s3','nfs','mixed'].includes(scope.storage) ||
      typeof scope.ns !== 'string' || !namespacePattern.test(scope.ns) ||
      typeof scope.emNs !== 'string' || !namespacePattern.test(scope.emNs)) {
    throw Error('请填写项目代号和合法的 Namespace，并选择集群、EM、网络及存储方式。');
  }
  const {alias,cluster,manager,network,storage,ns,emNs} = scope;
  return {alias,cluster,manager,network,storage,ns,emNs};
}

export function emptyRecord() {
  return {status:'pending',checks:[],reason:'',ref:'',updatedAt:''};
}

export function validateReference(value) {
  if (typeof value !== 'string' || !referencePattern.test(value)) {
    throw Error('证据编号最多 40 字，可用汉字、字母、数字、短横线、下划线和点。');
  }
  return value;
}

export function readPlan(input, steps) {
  if (!input || input.kind !== 'xingtu-deployment-progress' || input.version !== schemaVersion ||
      !input.records || typeof input.records !== 'object' || Array.isArray(input.records)) {
    throw Error('请选择由部署向导导出的进度 JSON。');
  }
  const plan = newPlan();
  plan.scope = input.scope === null ? null : validateScope(input.scope);
  const byId = new Map(steps.map(step => [step.id,step]));
  for (const [id,record] of Object.entries(input.records)) {
    const step = byId.get(id);
    if (!step || !record || !plan.scope || !Object.hasOwn(labels,record.status) || !Array.isArray(record.checks)) {
      throw Error('进度文件有未知步骤或状态。');
    }
    const checks = [...new Set(record.checks)];
    if (checks.some(i => !Number.isInteger(i) || i < 0 || i >= step.checks.length)) {
      throw Error('进度文件的验收项不匹配当前向导。');
    }
    const {status,reason,updatedAt} = record;
    if ((status === 'passed' && checks.length !== step.checks.length) ||
        (status === 'na' && (!step.optional || !skipReasons.includes(reason))) ||
        (status === 'blocked' && !blockReasons.includes(reason)) ||
        (['pending','passed'].includes(status) && reason !== '') ||
        typeof updatedAt !== 'string' || (updatedAt !== '' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt))) {
      throw Error('进度文件的通过条件或原因无效。');
    }
    plan.records[id] = {status,checks,reason,ref:validateReference(record.ref),updatedAt};
  }
  const firstOpen = steps.findIndex(step => !resolved(plan.records[step.id]));
  if (firstOpen >= 0 && steps.slice(firstOpen + 1).some(step => plan.records[step.id]?.status === 'passed')) {
    throw Error('进度文件中有前置未完成却已通过的步骤。');
  }
  return plan;
}

export function earlierOpen(plan, steps, index) {
  return steps.slice(0,index).find(step => !resolved(plan.records[step.id]));
}

export function writeRecord(plan, steps, step, record) {
  const previous = plan.records[step.id];
  if (!plan.scope) throw Error('先保存本次部署设置。');
  const index = steps.indexOf(step);
  if (index < 0) throw Error('步骤不存在。');
  if (record.status === 'passed' && earlierOpen(plan,steps,index)) {
    throw Error('请先完成前置步骤的验收。');
  }
  const next = {...plan,records:{...plan.records,[step.id]:{...record,updatedAt:new Date().toISOString()}}};
  let resetCount = 0;
  if (resolved(previous) && !resolved(record)) {
    for (const later of steps.slice(index+1)) {
      if (next.records[later.id]?.status === 'passed') {
        next.records[later.id] = emptyRecord();
        resetCount++;
      }
    }
  }
  return {plan:readPlan(next,steps),resetCount};
}
