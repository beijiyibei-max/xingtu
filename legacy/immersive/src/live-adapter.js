const GROUP_COLORS = {
  application: '#5ca7ff',
  service: '#52d6c8',
  engine: '#e9778e',
  foundation: '#f0bd5f',
  plugin: '#a98cff'
};

const FOUNDATION = new Set(['DTBase', 'Hadoop', 'Hive', 'Nacos', 'StarRocks', 'Haproxy', 'DTFront']);
const ENGINE = new Set(['Spark', 'Flink', 'DTSpark2.4', 'DTSpark3.2', 'DTFlinkSql1.16', 'DTAgentshell']);
const PLUGIN = new Set(['DTEnginePlugin', 'DTDatasourceX', 'DTSqlParser', 'ChunJun1.12']);
const SERVICE = new Set(['DTGateway', 'DTPublicService', 'DTSchedulex']);

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function groupFor(productName) {
  if (FOUNDATION.has(productName)) return 'foundation';
  if (ENGINE.has(productName)) return 'engine';
  if (PLUGIN.has(productName)) return 'plugin';
  if (SERVICE.has(productName)) return 'service';
  return 'application';
}

function layoutProducts(products) {
  const groups = new Map();
  products.forEach(product => {
    const group = groupFor(product.productName);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(product);
  });
  const layout = {
    foundation: { radius: 150, yScale: .7, offset: -.35 },
    service: { radius: 245, yScale: .72, offset: .25 },
    engine: { radius: 315, yScale: .72, offset: 1.05 },
    plugin: { radius: 390, yScale: .7, offset: 2.25 },
    application: { radius: 460, yScale: .68, offset: -1.25 }
  };
  const result = new Map();
  groups.forEach((items, group) => {
    const spec = layout[group];
    items.sort((a, b) => a.productName.localeCompare(b.productName));
    items.forEach((item, index) => {
      const angle = spec.offset + index / items.length * Math.PI * 2;
      result.set(item.productName, {
        x: 550 + Math.cos(angle) * spec.radius,
        y: 385 + Math.sin(angle) * spec.radius * spec.yScale
      });
    });
  });
  return result;
}

export function parseVersion(rawVersion = '') {
  const raw = String(rawVersion);
  const version = raw.match(/\d+(?:\.\d+){1,3}/)?.[0] || raw;
  const tags = [];
  if (/x86_64|amd64/i.test(raw)) tags.push('x86_64');
  else if (/(^|_)x86($|_)/i.test(raw)) tags.push('x86');
  if (/arm/i.test(raw)) tags.push('ARM');
  const os = raw.match(/centos[-_]?\d+(?:\.\d+)?/i)?.[0];
  if (os) tags.push(os.replace('_', '-'));
  const hadoop = raw.match(/hadoopv?\d+(?:\.\d+)?/i)?.[0];
  if (hadoop) tags.push(hadoop);
  const zookeeper = raw.match(/zookeeperv?\d+(?:\.\d+)?/i)?.[0];
  if (zookeeper) tags.push(zookeeper.replace('zookeeper', 'zk'));
  return { raw, version, tags };
}

function healthFor(instances) {
  const unhealthy = instances.filter(instance => instance.healthState === 0 || /fail/i.test(instance.lifecycleStatus || '')).length;
  const healthy = instances.filter(instance => instance.healthState === 1 && !/fail/i.test(instance.lifecycleStatus || '')).length;
  const unknown = Math.max(0, instances.length - unhealthy - healthy);
  const state = unhealthy ? 'unhealthy' : instances.length && healthy ? 'healthy' : 'unknown';
  return { state, healthy, unhealthy, unknown, total: instances.length };
}

export function adaptLiveSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.relations) || !Array.isArray(snapshot.instances)) {
    throw new Error('EM 快照结构不完整');
  }

  const instanceCountByProductId = new Map();
  snapshot.instances.forEach(instance => {
    const key = String(instance.productId ?? '');
    instanceCountByProductId.set(key, (instanceCountByProductId.get(key) || 0) + 1);
  });
  const productGroups = new Map();
  snapshot.products.forEach(product => {
    if (!productGroups.has(product.productName)) productGroups.set(product.productName, []);
    productGroups.get(product.productName).push(product);
  });
  const products = [...productGroups.values()].map(candidates => {
    const selected = [...candidates].sort((a, b) => {
      const instanceDelta = (instanceCountByProductId.get(String(b.id)) || 0) - (instanceCountByProductId.get(String(a.id)) || 0);
      if (instanceDelta) return instanceDelta;
      const currentDelta = Number(Boolean(b.isCurrentVersion)) - Number(Boolean(a.isCurrentVersion));
      if (currentDelta) return currentDelta;
      return Number(b.id || 0) - Number(a.id || 0);
    })[0];
    return { ...selected, availableVersions: [...new Set(candidates.map(item => item.version).filter(Boolean))] };
  });

  const productNames = new Set(products.map(product => product.productName));
  const layout = layoutProducts(products);
  const instancesByProduct = new Map();
  snapshot.instances.forEach(instance => {
    if (!instancesByProduct.has(instance.productName)) instancesByProduct.set(instance.productName, []);
    instancesByProduct.get(instance.productName).push(instance);
  });

  const servicesByProduct = new Map();
  function rememberService(productName, serviceName) {
    if (!productNames.has(productName) || !serviceName) return;
    if (!servicesByProduct.has(productName)) servicesByProduct.set(productName, new Set());
    servicesByProduct.get(productName).add(serviceName);
  }
  snapshot.relations.forEach(relation => {
    rememberService(relation.sourceProduct, relation.sourceService);
    rememberService(relation.targetProduct, relation.targetService);
  });
  snapshot.instances.forEach(instance => rememberService(instance.productName, instance.serviceDisplayName || instance.serviceName));

  const components = products.map(product => {
    const instances = instancesByProduct.get(product.productName) || [];
    const health = healthFor(instances);
    const group = groupFor(product.productName);
    const position = layout.get(product.productName) || { x: 550, y: 385 };
    const services = [...(servicesByProduct.get(product.productName) || [])].sort();
    const versionInfo = parseVersion(product.version);
    const color = health.state === 'unhealthy' ? '#ff647c' : health.state === 'unknown' ? GROUP_COLORS[group] : GROUP_COLORS[group];
    return {
      id: slug(product.productName),
      name: product.displayName || product.productName,
      fullName: product.productName,
      productName: product.productName,
      group,
      x: position.x,
      y: position.y,
      color,
      size: Math.min(23, 13 + Math.sqrt(Math.max(1, services.length)) * 2.2),
      summary: `来自 EM 的实况产品数据，包含 ${services.length} 个服务、${instances.length} 个当前实例。`,
      ports: [],
      modules: services,
      services,
      instances,
      health,
      status: health.state === 'unhealthy' ? 'error' : health.state === 'healthy' ? 'confirmed' : 'contextual',
      source: snapshot.source || 'EM Database',
      version: product.version,
      availableVersions: product.availableVersions,
      versionInfo,
      packageStatus: product.packageStatus,
      productType: product.productType,
      isCurrentVersion: product.isCurrentVersion
    };
  });

  const idByProduct = new Map(components.map(component => [component.productName, component.id]));
  const aggregated = new Map();
  const unresolvedRelations = [];
  snapshot.relations.forEach(relation => {
    const sourceId = idByProduct.get(relation.sourceProduct);
    const targetId = idByProduct.get(relation.targetProduct);
    if (!sourceId || !targetId) {
      unresolvedRelations.push(relation);
      return;
    }
    const relationType = relation.type === 'conflict' ? 'conflict' : 'runtime';
    const key = `${sourceId}\u0000${targetId}\u0000${relationType}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        id: `live-${aggregated.size + 1}`,
        from: sourceId,
        to: targetId,
        type: relationType,
        label: relationType === 'conflict' ? '模块冲突关系' : '由模块依赖汇总',
        status: 'confirmed',
        source: snapshot.source || 'EM Database',
        rawRelations: []
      });
    }
    aggregated.get(key).rawRelations.push(relation);
  });

  return {
    mode: 'live',
    baseline: `EM 实况快照 · ${new Date(snapshot.capturedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })}`,
    defaultSource: snapshot.source || 'EM Database',
    components,
    relations: [...aggregated.values()],
    rawRelationCount: snapshot.relations.length,
    unresolvedRelations,
    paths: {},
    capturedAt: snapshot.capturedAt,
    meta: {
      ...snapshot.meta,
      productCount: components.length,
      relationCount: snapshot.relations.length,
      aggregatedRelationCount: aggregated.size,
      unresolvedRelationCount: unresolvedRelations.length,
      healthyCount: components.filter(component => component.health.state === 'healthy').length,
      unhealthyCount: components.filter(component => component.health.state === 'unhealthy').length,
      unknownCount: components.filter(component => component.health.state === 'unknown').length
    }
  };
}
