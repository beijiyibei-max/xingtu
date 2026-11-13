/**
 * 把 xt-blackbox 采集到的 K8s 快照，转成星图宇宙能吃的 { components, relations }。
 *
 * 映射关系：
 *   工作负载（Deployment/StatefulSet/DaemonSet）→ 星球
 *   该工作负载下的 Pod                          → 卫星
 *   配置里引用了别的组件                        → 运行依赖边
 *
 * 这样 7.0 和 6.3 共用同一套 3D 渲染、详情面板、搜索和航线。
 */

const TONE_COLOR = {
  ok: '#4fe3a6',
  warn: '#ffc46b',
  bad: '#ff7793',
  idle: '#6b86ad'
};

const NS_COLORS = ['#62b8ff', '#52e2cf', '#a67cff', '#f284c6', '#ffc46b', '#7ae1a8', '#ff9aae', '#6fa8ff'];

const KIND_COLORS = {
  StatefulSet: '#52e2cf',
  Deployment: '#5aa0ff',
  DaemonSet: '#a67cff',
  Job: '#f0bb58',
  CronJob: '#f0bb58',
  Pod: '#7b93b8'
};

function readyFull(ready) {
  const parts = String(ready || '').split('/');
  return parts.length === 2 && parts[0] === parts[1];
}

function podTone(p) {
  if (p.phase === 'Succeeded') return 'idle';
  if (p.phase !== 'Running') return 'bad';
  return readyFull(p.ready) ? 'ok' : 'warn';
}

function workloadTone(w, pods) {
  if (!readyFull(w.ready)) return 'warn';
  if (pods.some((p) => podTone(p) === 'bad')) return 'bad';
  if (pods.some((p) => podTone(p) === 'warn')) return 'warn';
  return 'ok';
}

/** 按 owner 名称前缀把 Pod 挂到工作负载下 */
function groupPods(workloads, pods) {
  const map = new Map();
  const orphans = [];
  const sorted = [...workloads].sort((a, b) => b.name.length - a.name.length);
  for (const p of pods) {
    const owner = sorted.find((w) => w.ns === p.ns && String(p.name).startsWith(w.name));
    if (owner) {
      const key = owner.ns + '/' + owner.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    } else {
      orphans.push(p);
    }
  }
  return { map, orphans };
}

/** 从能力卡的 deps/wires 推组件之间的引用关系：配置键里提到谁，就依赖谁 */
function deriveRelations(capabilities, workloads) {
  const edges = [];
  const seen = new Set();
  const push = (from, to, type) => {
    if (!from || !to || from === to) return;
    const key = from + '>' + to + '>' + type;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type, label: '配置引用' });
  };

  const SKIP = ['global', 'config', 'common', 'value', 'true', 'false', 'sentinel', 'master', 'cluster'];
  const tokensOf = (key) => String(key).toLowerCase().split(/[.\-_/[\]'"{}:]+/)
    .filter((token) => token.length >= 3 && !SKIP.includes(token));

  const findWorkload = (name) => {
    const lower = String(name).toLowerCase();
    return workloads.find((w) => w.name.toLowerCase() === lower)
      || workloads.find((w) => w.name.toLowerCase().includes(lower))
      || null;
  };

  for (const cap of capabilities) {
    const wires = (cap.wires || []).map((w) => String(w).split(/[=!~>+\s]+/)[0]).filter(Boolean);
    const depNames = (cap.deps || [])
      .map((d) => String(d).split('/')[1] || '')
      .map((s) => s.replace(/\*/g, '').trim())
      .filter(Boolean);
    if (!wires.length || !depNames.length) continue;

    const targets = depNames.map(findWorkload).filter(Boolean);
    if (!targets.length) continue;

    for (const wire of wires) {
      for (const token of tokensOf(wire)) {
        const source = findWorkload(token);
        if (!source) continue;
        for (const target of targets) {
          push('w:' + source.ns + '/' + source.name, 'w:' + target.ns + '/' + target.name, 'runtime');
        }
      }
    }

    // 同一个能力依赖的多个组件，彼此也是关联的（共同服务同一个能力）
    for (let i = 0; i < targets.length; i += 1) {
      for (let j = i + 1; j < targets.length; j += 1) {
        push('w:' + targets[i].ns + '/' + targets[i].name, 'w:' + targets[j].ns + '/' + targets[j].name, 'manage');
      }
    }
  }
  return edges;
}
/** 业务命名空间：有状态副本，或有 3 个以上工作负载的 */
function productNamespaces(workloads) {
  const stat = new Map();
  for (const w of workloads) stat.set(w.ns, (stat.get(w.ns) || 0) + 1);
  const ranked = [...stat.entries()].sort((a, b) => b[1] - a[1]);
  // 工作负载最多的命名空间就是产品本身；EM 自己所在的那个一并保留
  return new Set(ranked.slice(0, 2).map(([ns]) => ns));
}

export function adaptK8sSnapshot(snapshot, cardDefs = [], options = {}) {
  const scope = options.scope || 'product';
  const allPods = Array.isArray(snapshot.pods) ? snapshot.pods : [];
  const allWorkloads = Array.isArray(snapshot.workloads) ? snapshot.workloads : [];
  const isPreset = scope === 'all' || scope === 'product';
  const keepNs = scope === 'all' ? null : (isPreset ? productNamespaces(allWorkloads) : new Set([scope]));
  const workloads = keepNs ? allWorkloads.filter((w) => keepNs.has(w.ns)) : allWorkloads;
  const allowed = new Set(workloads.map((w) => w.ns));
  const pods = keepNs ? allPods.filter((p) => allowed.has(p.ns)) : allPods;
  // 采集结果里的 deps 只有 "0/3" 这种计数，依赖名要用打包进来的能力卡定义
  const capabilities = Array.isArray(cardDefs) && cardDefs.length
    ? cardDefs
    : (Array.isArray(snapshot.capabilities) ? snapshot.capabilities : []);

  const { map: podsByOwner, orphans } = groupPods(workloads, pods);
  const podLogs = snapshot.podLogs || {};

  const namespaces = [...new Set([
    ...workloads.map((w) => w.ns),
    ...pods.map((p) => p.ns)
  ])].sort();

  const nsIndex = new Map(namespaces.map((ns, i) => [ns, i]));
  const nsCount = Math.max(1, namespaces.length);

  const components = [];
  const seenIds = new Set();

  // 螺旋星系摆位：黄金角 + 中心密外围疏，星星不会扎堆
  const KIND_ORDER = { StatefulSet: 0, Deployment: 1, DaemonSet: 2 };
  const totalNodes = workloads.length + orphans.length;
  let nodeIndex = 0;
  const GOLDEN = 2.399963229728653;
  const placeNode = (ns) => {
    const i = nodeIndex;
    nodeIndex += 1;
    const t = totalNodes > 1 ? i / (totalNodes - 1) : 0;
    const radius = 55 + 400 * Math.sqrt(t);
    const angle = i * GOLDEN;
    const layer = ((nsIndex.get(ns) || 0) % 3) - 1;
    return {
      x: 550 + Math.cos(angle) * radius,
      y: 385 + Math.sin(angle) * radius * 0.82,
      z: layer * 5 + ((i % 7) - 3) * 1.3
    };
  };

  workloads.sort((a, b) => {
    const ka = KIND_ORDER[a.kind] ?? 3;
    const kb = KIND_ORDER[b.kind] ?? 3;
    return ka !== kb ? ka - kb : String(a.name).localeCompare(String(b.name));
  });

  for (const w of workloads) {
    const id = 'w:' + w.ns + '/' + w.name;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const myPods = podsByOwner.get(w.ns + '/' + w.name) || [];
    const tone = workloadTone(w, myPods);
    const pos = placeNode(w.ns);

    components.push({
      id,
      name: w.name,
      fullName: `${w.kind} · ${w.ns}`,
      group: w.ns,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color: tone === 'ok' ? (KIND_COLORS[w.kind] || NS_COLORS[nsIndex.get(w.ns) % NS_COLORS.length]) : TONE_COLOR[tone],
      tone,
      size: w.kind === 'StatefulSet' ? 15 : 13,
      status: tone,
      summary: `${w.kind}，就绪 ${w.ready || '—'}，${myPods.length} 个 Pod`,
      ports: [],
      modules: myPods.map((p) => p.name),
      pods: myPods.map((p) => ({
        name: p.name,
        phase: p.phase,
        ready: p.ready,
        node: p.node,
        restarts: p.restarts,
        tone: podTone(p),
        logs: podLogs[p.ns + '/' + p.name] || p.logs || ''
      })),
      namespace: w.ns
    });
  }

  // 没有 owner 的 Pod（裸 Pod、Job 等）单独成星
  for (const p of orphans) {
    const id = 'p:' + p.ns + '/' + p.name;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const pos = placeNode(p.ns);
    const tone = podTone(p);
    components.push({
      id,
      name: p.name,
      fullName: `Pod · ${p.ns}`,
      group: p.ns,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color: tone === 'ok' ? NS_COLORS[nsIndex.get(p.ns) % NS_COLORS.length] : TONE_COLOR[tone],
      tone,
      size: 10,
      status: tone,
      summary: `Pod，${p.phase} ${p.ready}`,
      ports: [],
      modules: [],
      pods: [{ name: p.name, phase: p.phase, ready: p.ready, node: p.node, restarts: p.restarts, tone, logs: podLogs[p.ns + '/' + p.name] || p.logs || '' }],
      namespace: p.ns
    });
  }

  const relations = deriveRelations(capabilities, workloads);

  return {
    mode: 'k8s',
    baseline: '数栈 7.0 · K8s 多模态（实采）',
    defaultSource: `xt-blackbox @ ${snapshot.generatedAt || '刚刚'}`,
    components,
    relations,
    pods,
    meta: { podCount: pods.length, workloadCount: workloads.length, scope }
  };
}
