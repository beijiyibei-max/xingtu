import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { adaptLiveSnapshot } from './live-adapter.js';
import { initCapabilityOverlay } from './capability-overlay.js';
import { adaptK8sSnapshot } from './k8s-adapter.js';
import { initBlackbox } from './blackbox-overlay.js';
import capsData from './capabilities.json';

const TYPE_NAMES = {
  runtime: '运行依赖',
  deploy: '部署顺序',
  colocate: '同机约束',
  manage: '管理关系',
  conflict: '冲突关系'
};

const TYPE_COLORS = {
  runtime: '#4aa8ff',
  deploy: '#f0bb58',
  colocate: '#bb7cff',
  manage: '#52d7b0',
  conflict: '#ff647c'
};

const UPGRADE_COLORS = {
  target: '#ffd36a',
  prerequisite: '#5bd7ff',
  impacted: '#ff7fc8'
};

const KNOWLEDGE_DATA = {
  baseline: '数栈 6.3（首版资料基线）',
  defaultSource: '待补充内部产品资料来源',
  components: [
    { id: 'em', name: 'EM', fullName: 'EasyManager', group: 'management', x: 550, y: 72, color: '#ffd36a', size: 18, summary: '组件部署、管理与运维入口。具体管理边界和版本能力待内部资料确认。', ports: ['待确认'], modules: ['部署管理', '集群管理', '运维入口'], status: 'pending' },
    { id: 'dtbatch', name: 'DTBatch', fullName: '离线开发', group: 'application', x: 125, y: 200, color: '#56a7ff', size: 16, summary: '面向离线任务开发与执行管理。模块名称和准确职责待内部资料确认。', ports: ['9020（待确认）'], modules: ['Batch', 'BatchFront', 'BatchSql'], status: 'pending' },
    { id: 'dtstream', name: 'DTStream', fullName: '实时开发', group: 'application', x: 285, y: 130, color: '#38d5d0', size: 16, summary: '面向实时任务开发与执行管理。模块名称和准确职责待内部资料确认。', ports: ['9021（待确认）'], modules: ['Stream', 'StreamFront', 'StreamSql'], status: 'pending' },
    { id: 'dtapi', name: 'DTApi', fullName: '数据服务', group: 'application', x: 815, y: 130, color: '#4bd19b', size: 15, summary: '用于数据服务 API 的开发、发布或管理，准确边界待内部资料确认。', ports: ['8087 / 8092（待确认）'], modules: ['Api', 'ApiFront', 'ApiSql'], status: 'pending' },
    { id: 'dtmetadata', name: 'DTMetadata', fullName: '元数据中心', group: 'application', x: 970, y: 205, color: '#a67cff', size: 16, summary: '承载元数据相关能力，具体模块、采集链路和对外关系待内部资料确认。', ports: ['8875（待确认）'], modules: ['Metadata', 'MetadataFront', 'MetadataSql'], status: 'pending' },
    { id: 'dtassets', name: 'DTAssets', fullName: '数据资产', group: 'application', x: 1010, y: 365, color: '#f284c6', size: 16, summary: '面向数据资产管理与展示，和元数据等组件的准确关系待内部资料确认。', ports: ['8876（待确认）'], modules: ['Assets', 'AssetsFront', 'AssetsSql'], status: 'pending' },
    { id: 'dttag', name: 'DTTag', fullName: '数据标签', group: 'application', x: 955, y: 525, color: '#ff78ad', size: 14, summary: '内部资料将其列为应用服务；具体职责、模块和数栈 6.3 适用情况待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（组件分类清单）' },
    { id: 'dtvalid', name: 'DTValid', fullName: '数据质量', group: 'application', x: 825, y: 640, color: '#7ae1a8', size: 14, summary: '内部资料将其列为应用服务；具体职责、模块和数栈 6.3 适用情况待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（组件分类清单）' },
    { id: 'dteasyindex', name: 'DTEasyIndex', fullName: '指标管理', group: 'application', x: 680, y: 700, color: '#f5b75f', size: 14, summary: '内部资料将其列为应用服务；具体职责、模块和数栈 6.3 适用情况待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（组件分类清单）' },
    { id: 'dtuic', name: 'DTUic', fullName: '用户中心', group: 'service', x: 285, y: 315, color: '#65bfff', size: 17, summary: '提供用户、登录和认证相关能力。与公共服务的调用细节待内部资料确认。', ports: ['8006（待确认）'], modules: ['Uic', 'UicFront', 'UicSql'], status: 'pending' },
    { id: 'dtpublicservice', name: 'DTPublicService', fullName: '公共服务', group: 'service', x: 430, y: 245, color: '#5de2cf', size: 19, summary: '为其他应用提供公共能力或 SDK 服务，准确依赖边界待内部资料确认。', ports: ['8077（待确认）'], modules: ['PublicService', 'PublicServiceSql'], status: 'pending' },
    { id: 'dtschedulex', name: 'DTSchedulex', fullName: '调度引擎', group: 'service', x: 670, y: 245, color: '#50b7f2', size: 17, summary: '负责任务调度相关能力。离线主链路中的位置待内部资料确认。', ports: ['8090（待确认）'], modules: ['Schedulex', 'Engine', 'SchedulexSql'], status: 'pending' },
    { id: 'dtgateway', name: 'DTGateway', fullName: '公共网关', group: 'service', x: 815, y: 315, color: '#4fc9e8', size: 14, summary: '内部资料将其列为公共组件；具体职责、端口和调用边界待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（组件分类清单）' },
    { id: 'dtfront', name: 'DTFront', fullName: '基础前端服务', group: 'service', x: 285, y: 470, color: '#8fb7ff', size: 14, summary: '内部资料将其列为基础服务；具体承载范围和版本适用情况待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（组件分类清单）' },
    { id: 'spark', name: 'Spark', fullName: '批计算引擎', group: 'engine', x: 425, y: 495, color: '#ff9b5c', size: 18, summary: '批处理计算引擎。数栈组件对 Spark 的具体提交与版本关系待确认。', ports: ['按部署确认'], modules: ['Driver', 'Executor', 'History Server'], status: 'pending' },
    { id: 'flink', name: 'Flink', fullName: '流计算引擎', group: 'engine', x: 675, y: 495, color: '#e86d86', size: 18, summary: '流处理计算引擎。数栈组件对 Flink 的具体提交与版本关系待确认。', ports: ['按部署确认'], modules: ['JobManager', 'TaskManager', 'History Server'], status: 'pending' },
    { id: 'hadoop', name: 'Hadoop', fullName: '资源与存储底座', group: 'foundation', x: 550, y: 660, color: '#9a82ff', size: 21, summary: '提供 HDFS、YARN 等底层能力。实际部署角色与版本以环境为准。', ports: ['按部署确认'], modules: ['HDFS', 'YARN', 'ZKFC', 'JobHistory'], status: 'pending' },
    { id: 'dtbase', name: 'DTBase', fullName: '基础中间件', group: 'foundation', x: 550, y: 385, color: '#f3bd57', size: 23, summary: '基础中间件集合。不同环境可能裁剪或复用外部中间件，实际清单待确认。', ports: ['按模块确认'], modules: ['MySQL', 'Redis', 'Kafka', 'ZooKeeper', 'Nacos', 'Prometheus'], status: 'pending' },
    { id: 'dtengineplugin', name: 'DTEnginePlugin', fullName: '计算引擎插件', group: 'plugin', x: 360, y: 625, color: '#ba8cff', size: 13, summary: '内部资料将其列为插件包；所含引擎适配范围和版本组合待确认。', ports: ['不适用 / 待确认'], modules: [], status: 'pending', source: '升级教程.md（插件包清单）' },
    { id: 'dtdatasourcex', name: 'DTDatasourceX', fullName: '数据源插件', group: 'plugin', x: 205, y: 580, color: '#45d6b2', size: 13, summary: '内部资料将其列为插件包；具体数据源类型和版本组合待确认。', ports: ['不适用 / 待确认'], modules: [], status: 'pending', source: '升级教程.md（插件包清单）' },
    { id: 'dtsqlparser', name: 'DTSqlParser', fullName: 'SQL 解析组件', group: 'plugin', x: 120, y: 445, color: '#f09aff', size: 13, summary: '内部资料将其列为插件包；解析能力边界和版本适用情况待确认。', ports: ['待确认'], modules: [], status: 'pending', source: '升级教程.md（插件包清单）' },
    { id: 'chunjun', name: 'ChunJun', fullName: '数据同步插件体系', group: 'plugin', x: 810, y: 500, color: '#ff8a72', size: 14, summary: '内部资料同时出现 DTFlinkX 与 ChunJun 包名；准确命名、版本映射和运行关系待确认。', ports: ['不适用 / 待确认'], modules: ['DTFlinkX 1.10', 'DTFlinkX 1.12'], status: 'pending', source: '升级教程.md（插件升级清单）' }
  ],
  relations: [
    { id: 'r01', from: 'dtuic', to: 'dtpublicservice', type: 'runtime', label: 'DTUic 调用公共服务能力', status: 'pending' },
    { id: 'r02', from: 'dtbatch', to: 'dtschedulex', type: 'runtime', label: '离线任务进入调度链路', status: 'pending' },
    { id: 'r03', from: 'dtschedulex', to: 'spark', type: 'runtime', label: '调度提交批计算任务', status: 'pending' },
    { id: 'r04', from: 'spark', to: 'hadoop', type: 'runtime', label: 'Spark 使用资源管理或存储能力', status: 'pending' },
    { id: 'r05', from: 'dtstream', to: 'flink', type: 'runtime', label: '实时任务进入 Flink 执行链路', status: 'pending' },
    { id: 'r06', from: 'flink', to: 'hadoop', type: 'runtime', label: 'Flink 与底层资源能力的关系', status: 'pending' },
    { id: 'r07', from: 'dtassets', to: 'dtmetadata', type: 'runtime', label: '数据资产使用元数据能力', status: 'pending' },
    { id: 'r08', from: 'dtuic', to: 'dtpublicservice', type: 'deploy', label: '公共服务先于用户中心部署', status: 'pending' },
    { id: 'r09', from: 'dtbatch', to: 'dtbase', type: 'runtime', label: '离线开发使用基础中间件', status: 'pending' },
    { id: 'r10', from: 'dtstream', to: 'dtbase', type: 'runtime', label: '实时开发使用基础中间件', status: 'pending' },
    { id: 'r11', from: 'dtapi', to: 'dtbase', type: 'runtime', label: '数据服务使用基础中间件', status: 'pending' },
    { id: 'r12', from: 'dtmetadata', to: 'dtbase', type: 'runtime', label: '元数据中心使用基础中间件', status: 'pending' },
    { id: 'r13', from: 'em', to: 'dtbase', type: 'manage', label: 'EM 管理基础中间件', status: 'pending' },
    { id: 'r14', from: 'em', to: 'hadoop', type: 'manage', label: 'EM 管理计算与存储底座', status: 'pending' },
    { id: 'r15', from: 'em', to: 'dtbatch', type: 'manage', label: 'EM 管理应用组件', status: 'pending' },
    { id: 'r16', from: 'em', to: 'dtstream', type: 'manage', label: 'EM 管理应用组件', status: 'pending' },
    { id: 'r17', from: 'spark', to: 'hadoop', type: 'colocate', label: '是否存在同机约束', status: 'pending' },
    { id: 'r18', from: 'em', to: 'dttag', type: 'manage', label: 'EM 部署中心管理该组件', status: 'confirmed', source: '升级教程.md（升级操作入口）' },
    { id: 'r19', from: 'em', to: 'dtvalid', type: 'manage', label: 'EM 部署中心管理该组件', status: 'confirmed', source: '升级教程.md（升级操作入口）' },
    { id: 'r20', from: 'em', to: 'dteasyindex', type: 'manage', label: 'EM 部署中心管理该组件', status: 'confirmed', source: '升级教程.md（升级操作入口）' },
    { id: 'r21', from: 'em', to: 'dtgateway', type: 'manage', label: 'EM 部署中心管理该组件', status: 'confirmed', source: '升级教程.md（升级操作入口）' },
    { id: 'r22', from: 'em', to: 'dtfront', type: 'manage', label: 'EM 部署中心管理该组件', status: 'confirmed', source: '升级教程.md（升级操作入口）' },
    { id: 'r23', from: 'em', to: 'dtengineplugin', type: 'manage', label: 'EM 部署中心管理插件包', status: 'confirmed', source: '升级教程.md（插件升级操作）' },
    { id: 'r24', from: 'em', to: 'dtdatasourcex', type: 'manage', label: 'EM 部署中心管理插件包', status: 'confirmed', source: '升级教程.md（插件升级操作）' },
    { id: 'r25', from: 'em', to: 'dtsqlparser', type: 'manage', label: 'EM 部署中心管理插件包', status: 'confirmed', source: '升级教程.md（插件升级操作）' },
    { id: 'r26', from: 'em', to: 'chunjun', type: 'manage', label: 'EM 部署中心管理插件包', status: 'confirmed', source: '升级教程.md（插件升级操作）' }
  ],
  paths: {
    offline: { name: '离线任务航线', nodes: ['dtbatch', 'dtschedulex', 'spark', 'hadoop'], relations: ['r02', 'r03', 'r04'], color: '#62b8ff' },
    realtime: { name: '实时任务航线', nodes: ['dtstream', 'flink', 'hadoop'], relations: ['r05', 'r06'], color: '#51e1c1' }
  }
};

const depthByGroup = { management: -8, application: -1, service: 3, engine: 7, foundation: 11, plugin: -5 };
let DATA = KNOWLEDGE_DATA;
let componentById = Object.fromEntries(DATA.components.map(component => [component.id, component]));
const nodeVisuals = new Map();
const stars = [];
let selectedNode = null;
let hoveredNode = null;
let activePath = null;
let activeStep = -1;
let completedEdges = new Set();
let missionTimers = [];
let soundEnabled = false;
let audioContext = null;
let satelliteOrbit = null;
let selectedModuleName = null;
let suppressNodeClickUntil = 0;
let currentMode = 'knowledge';
let warpSequence = 0;
let warpStartedAt = 0;
let focusTransitionTimer = null;
let focusFadeTimer = null;
let upgradeViewActive = false;
let k8sScope = 'product';

const els = {
  universe: document.getElementById('universe'),
  details: document.getElementById('detailsPanel'),
  filter: document.getElementById('relationFilter'),
  search: document.getElementById('searchInput'),
  searchResults: document.getElementById('searchResults'),
  sound: document.getElementById('soundBtn'),
  upgradeView: document.getElementById('upgradeViewBtn'),
  home: document.getElementById('homeBtn'),
  hover: document.getElementById('hoverHud'),
  timeline: document.getElementById('timeline'),
  timelineTitle: document.getElementById('timelineTitle'),
  timelineStage: document.getElementById('timelineStage'),
  timelineTrack: document.getElementById('timelineTrack'),
  stop: document.getElementById('stopMissionBtn'),
  loading: document.getElementById('loadingScreen'),
  warp: document.getElementById('warpTransition'),
  warpTitle: document.getElementById('warpTitle'),
  warpSubtitle: document.getElementById('warpSubtitle'),
  focusTransition: document.getElementById('focusTransition'),
  focusKicker: document.getElementById('focusKicker'),
  focusTitle: document.getElementById('focusTitle'),
  focusSubtitle: document.getElementById('focusSubtitle')
};
els.dataStatus = document.getElementById('dataStatus');
els.dataStatusTitle = document.getElementById('dataStatusTitle');
els.dataStatusMetrics = document.getElementById('dataStatusMetrics');
els.sync = document.getElementById('syncBtn');
els.modeButtons = [...document.querySelectorAll('[data-mode]')];
els.versionButtons = [...document.querySelectorAll('[data-version]')];
els.healthyCount = document.getElementById('healthyCount');
els.unhealthyCount = document.getElementById('unhealthyCount');
els.unknownCount = document.getElementById('unknownCount');
els.liveDockNote = document.getElementById('liveDockNote');
const satelliteHitLayer = document.createElement('div');
satelliteHitLayer.className = 'satellite-hit-layer';
satelliteHitLayer.setAttribute('aria-label', '当前产品的模块卫星');
document.body.append(satelliteHitLayer);

function hashSeed(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return seed >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}

function statusText(status) {
  return status === 'confirmed' ? '已确认' : status === 'contextual' ? '环境相关' : '待确认';
}

function sourceText(item) {
  return item.source || DATA.defaultSource;
}

function makeCanvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function planetTexture(node) {
  const base = new THREE.Color(node.color);
  const random = seededRandom(hashSeed(node.id));
  return makeCanvasTexture(256, (ctx, size) => {
    ctx.fillStyle = `#${base.clone().multiplyScalar(.44).getHexString()}`;
    ctx.fillRect(0, 0, size, size);
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, `#${base.clone().lerp(new THREE.Color('#ffffff'), .58).getHexString()}`);
    gradient.addColorStop(.38, `#${base.getHexString()}`);
    gradient.addColorStop(1, `#${base.clone().multiplyScalar(.28).getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'screen';
    for (let band = 0; band < 13; band += 1) {
      ctx.globalAlpha = .06 + random() * .12;
      ctx.fillStyle = band % 2 ? '#ffffff' : `#${base.clone().offsetHSL((random() - .5) * .08, .05, -.05).getHexString()}`;
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 18) ctx.lineTo(x, y + Math.sin(x * .04 + random() * 4) * (4 + random() * 10));
      ctx.lineTo(size, y + 12 + random() * 18);
      ctx.lineTo(0, y + 12 + random() * 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let crater = 0; crater < 26; crater += 1) {
      ctx.globalAlpha = .08 + random() * .15;
      ctx.fillStyle = random() > .5 ? '#020914' : '#ffffff';
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 1 + random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function glowTexture(color = '#ffffff') {
  return makeCanvasTexture(128, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(.08, color);
    gradient.addColorStop(.35, `${color}88`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

function labelSprite(text, color, scale = 1) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 36;
  ctx.font = `500 ${fontSize}px "Microsoft YaHei", sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width + 42);
  canvas.width = Math.max(128, Math.min(512, width));
  canvas.height = 72;
  ctx.font = `500 ${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 9;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: .92 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((canvas.width / canvas.height) * 3.8 * scale, 3.8 * scale, 1);
  sprite.userData.isLabel = true;
  return sprite;
}

function createPlanet(node) {
  const group = new THREE.Group();
  const radius = node.size * .092;
  const material = new THREE.MeshStandardMaterial({
    map: planetTexture(node),
    color: new THREE.Color(node.color),
    emissive: new THREE.Color(node.color),
    emissiveIntensity: .32,
    roughness: .58,
    metalness: .12,
    transparent: true
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), material);
  planet.rotation.z = (hashSeed(node.id) % 24 - 12) * Math.PI / 180;
  group.add(planet);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.09, 32, 20),
    new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: .1, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  group.add(atmosphere);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(node.color), color: node.color, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(radius * 5.5, radius * 5.5, 1);
  group.add(glow);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.48, .025, 8, 96), ringMaterial);
  ring.rotation.x = Math.PI * .57;
  ring.rotation.y = Math.PI * .1;
  group.add(ring);

  if (node.group === 'foundation' || node.group === 'management') {
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.82, .018, 8, 112), ringMaterial.clone());
    outerRing.material.opacity = .22;
    outerRing.rotation.x = Math.PI * .68;
    outerRing.rotation.z = Math.PI * .18;
    group.add(outerRing);
  }

  const labelText = node.name.length > 24 ? node.name.slice(0, 21) + '…' : node.name;
  const label = labelSprite(labelText, '#eaf6ff', labelText.length > 12 ? .64 : .86);
  label.position.set(0, -(radius + 1.55), 0);
  group.add(label);
  group.userData.planet = planet;
  group.userData.atmosphere = atmosphere;
  group.userData.glow = glow;
  group.userData.rings = group.children.filter(child => child.geometry?.type === 'TorusGeometry');
  group.userData.radius = radius;
  group.userData.baseColor = node.color;
  nodeVisuals.set(node.id, group);
  return group;
}

function addStars(scene) {
  const random = seededRandom(914027);
  [1700, 700, 230].forEach((count, layerIndex) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const radius = 55 + random() * (100 + layerIndex * 70);
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      const tint = new THREE.Color(random() > .78 ? '#8dbdff' : random() > .92 ? '#c79aff' : '#ffffff');
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: [.12, .22, .38][layerIndex], vertexColors: true, transparent: true, opacity: [.56, .72, .92][layerIndex], depthWrite: false, sizeAttenuation: true }));
    points.userData.rotationSpeed = [.000025, -.00004, .00007][layerIndex];
    scene.add(points);
    stars.push(points);
  });
}

function addNebula(scene, color, position, scale, opacity) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(color), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  sprite.position.copy(position);
  sprite.scale.set(scale, scale * .58, 1);
  scene.add(sprite);
}

function addOrbitGuide(scene, radius, rotation, color) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, .022, 6, 240),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  ring.rotation.set(...rotation);
  scene.add(ring);
}

function makeGraphData(data) {
  const graphNodes = data.components.map((component, index) => {
    const px = (component.x - 550) / 13;
    const py = (385 - component.y) / 13;
    const pz = component.z != null ? component.z : (depthByGroup[component.group] ?? 0) + ((index % 5) - 2) * 1.15;
    return { ...component, x: px, y: py, z: pz, fx: px, fy: py, fz: pz };
  });
  const graphLinks = data.relations.map(relation => ({ ...relation, source: relation.from, target: relation.to }));
  return { graphNodes, graphLinks };
}

let { graphNodes: nodes, graphLinks: links } = makeGraphData(DATA);

const graph = ForceGraph3D()(els.universe, { controlType: 'orbit' })
  .width(window.innerWidth)
  .height(window.innerHeight)
  .backgroundColor('#01030a')
  .showNavInfo(false)
  .graphData({ nodes, links })
  .nodeThreeObject(createPlanet)
  .nodeLabel(() => '')
  .nodeRelSize(1)
  .linkColor(link => TYPE_COLORS[link.type])
  .linkOpacity(.28)
  .linkWidth(link => link.type === 'runtime' ? .07 : .035)
  .linkCurvature(link => link.type === 'manage' ? .1 : link.type === 'deploy' ? -.13 : link.type === 'colocate' || link.type === 'conflict' ? .18 : 0)
  .linkDirectionalArrowLength(1.5)
  .linkDirectionalArrowRelPos(.94)
  .linkDirectionalArrowColor(link => TYPE_COLORS[link.type])
  .linkDirectionalParticles(link => link.type === 'runtime' ? 2 : link.type === 'manage' ? 1 : 0)
  .linkDirectionalParticleWidth(.65)
  .linkDirectionalParticleSpeed(.004)
  .linkDirectionalParticleColor(link => TYPE_COLORS[link.type])
  .enableNodeDrag(true)
  .onNodeClick(node => {
    if (performance.now() < suppressNodeClickUntil) return;
    selectNode(node, true);
  })
  .onNodeHover(node => setHover(node))
  .onBackgroundClick(() => {
    if (selectedNode) goHome(true);
  })
  .onNodeDragEnd(node => {
    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;
  })
  .onLinkClick(link => selectNode(typeof link.source === 'object' ? link.source : componentById[link.from], true));

graph.cooldownTicks(0);
graph.cameraPosition({ x: 6, y: 1, z: 102 }, { x: 6, y: -1, z: 1 }, 0);
graph.controls().autoRotate = false;
graph.controls().enableDamping = true;
graph.controls().dampingFactor = .06;
graph.controls().minDistance = 10;
graph.controls().maxDistance = 155;
graph.scene().fog = new THREE.FogExp2(0x01030a, .0062);
graph.scene().add(new THREE.AmbientLight(0x8db8ff, 1.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(-18, 32, 44);
graph.scene().add(keyLight);
const rimLight = new THREE.PointLight(0x7168ff, 48, 130, 1.7);
rimLight.position.set(26, -10, 22);
graph.scene().add(rimLight);
graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
graph.renderer().toneMapping = THREE.ACESFilmicToneMapping;
graph.renderer().toneMappingExposure = 1.12;
graph.renderer().outputColorSpace = THREE.SRGBColorSpace;
addStars(graph.scene());
addNebula(graph.scene(), '#194dff', new THREE.Vector3(-46, 26, -42), 100, .15);
addNebula(graph.scene(), '#9b36ff', new THREE.Vector3(45, -26, -58), 122, .11);
addNebula(graph.scene(), '#14b8a6', new THREE.Vector3(4, 9, -70), 76, .075);
addOrbitGuide(graph.scene(), 16, [Math.PI * .52, .1, .12], '#4d8fff');
addOrbitGuide(graph.scene(), 29, [Math.PI * .58, -.18, -.2], '#4dd9d3');
addOrbitGuide(graph.scene(), 41, [Math.PI * .5, .08, .3], '#9c75ff');

function sourceNode(link) {
  return typeof link.source === 'object' ? link.source : componentById[link.from];
}

function targetNode(link) {
  return typeof link.target === 'object' ? link.target : componentById[link.to];
}

function connectedIds(nodeId) {
  const result = new Set([nodeId]);
  DATA.relations.forEach(relation => {
    if (relation.from === nodeId) result.add(relation.to);
    if (relation.to === nodeId) result.add(relation.from);
  });
  return result;
}

function upgradeAnalysisFor(node) {
  if (!node) return null;
  const allowedTypes = new Set(DATA.mode === 'live' ? ['runtime'] : ['runtime', 'deploy']);
  const eligibleRelations = DATA.relations.filter(relation => allowedTypes.has(relation.type));

  function traverse(direction) {
    const depths = new Map();
    const edges = new Set();
    const queue = [{ id: node.id, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      eligibleRelations.forEach(relation => {
        const matches = direction === 'out' ? relation.from === current.id : relation.to === current.id;
        if (!matches) return;
        const nextId = direction === 'out' ? relation.to : relation.from;
        if (nextId === node.id) return;
        edges.add(relation.id);
        const nextDepth = current.depth + 1;
        if (!depths.has(nextId) || nextDepth < depths.get(nextId)) {
          depths.set(nextId, nextDepth);
          queue.push({ id: nextId, depth: nextDepth });
        }
      });
    }
    return { depths, edges };
  }

  const prerequisites = traverse('out');
  const impacted = traverse('in');
  return {
    prerequisites: prerequisites.depths,
    impacted: impacted.depths,
    prerequisiteEdges: prerequisites.edges,
    impactEdges: impacted.edges,
    allEdges: new Set([...prerequisites.edges, ...impacted.edges])
  };
}

function upgradeRoleFor(nodeId, analysis) {
  if (!analysis || !selectedNode) return null;
  if (nodeId === selectedNode.id) return 'target';
  if (analysis.prerequisites.has(nodeId)) return 'prerequisite';
  if (analysis.impacted.has(nodeId)) return 'impacted';
  return null;
}

function updateVisualState() {
  const filter = els.filter.value;
  const focusIds = selectedNode ? connectedIds(selectedNode.id) : null;
  const path = activePath ? DATA.paths[activePath] : null;
  const upgradeAnalysis = upgradeViewActive && selectedNode ? upgradeAnalysisFor(selectedNode) : null;

  nodeVisuals.forEach((visual, nodeId) => {
    const isSelected = selectedNode?.id === nodeId;
    const inPath = path?.nodes.includes(nodeId);
    const inFocus = focusIds?.has(nodeId);
    const upgradeRole = upgradeRoleFor(nodeId, upgradeAnalysis);
    const dimmed = upgradeAnalysis ? !upgradeRole : (selectedNode && !inFocus) || (path && !inPath);
    const roleColor = upgradeRole ? UPGRADE_COLORS[upgradeRole] : visual.userData.baseColor;
    visual.userData.planet.material.emissive.set(roleColor);
    visual.userData.atmosphere.material.color.set(roleColor);
    visual.userData.glow.material.color.set(roleColor);
    visual.userData.rings.forEach(ring => ring.material.color.set(roleColor));
    visual.userData.planet.material.opacity = dimmed ? .23 : 1;
    visual.userData.planet.material.emissiveIntensity = upgradeRole ? (upgradeRole === 'target' ? 1.2 : .88) : isSelected ? 1.05 : inPath ? .72 : .32;
    visual.userData.atmosphere.material.opacity = upgradeRole ? .27 : isSelected ? .3 : inPath ? .2 : dimmed ? .025 : .1;
    visual.userData.glow.userData.baseOpacity = upgradeRole ? (upgradeRole === 'target' ? 1 : .78) : isSelected ? .94 : inPath ? .72 : dimmed ? .1 : .5;
    visual.userData.glow.material.opacity = visual.userData.glow.userData.baseOpacity;
    visual.userData.rings.forEach(ring => { ring.material.opacity = upgradeRole ? .7 : isSelected ? .86 : inPath ? .54 : dimmed ? .03 : .3; });
    const label = visual.children.find(child => child.userData?.isLabel);
    if (label) label.material.opacity = dimmed ? .18 : isSelected || inPath ? 1 : .85;
    visual.userData.targetScale = upgradeRole ? (upgradeRole === 'target' ? 1.24 : 1.1) : isSelected ? 1.2 : inPath ? 1.08 : 1;
  });

  graph
    .linkVisibility(link => upgradeAnalysis ? upgradeAnalysis.allEdges.has(link.id) : path?.relations.includes(link.id) || filter === 'all' || link.type === filter)
    .linkColor(link => upgradeAnalysis?.prerequisiteEdges.has(link.id) ? UPGRADE_COLORS.prerequisite : upgradeAnalysis?.impactEdges.has(link.id) ? UPGRADE_COLORS.impacted : path?.relations.includes(link.id) ? path.color : TYPE_COLORS[link.type])
    .linkDirectionalArrowColor(link => upgradeAnalysis?.prerequisiteEdges.has(link.id) ? UPGRADE_COLORS.prerequisite : upgradeAnalysis?.impactEdges.has(link.id) ? UPGRADE_COLORS.impacted : TYPE_COLORS[link.type])
    .linkDirectionalParticleColor(link => upgradeAnalysis?.prerequisiteEdges.has(link.id) ? UPGRADE_COLORS.prerequisite : upgradeAnalysis?.impactEdges.has(link.id) ? UPGRADE_COLORS.impacted : TYPE_COLORS[link.type])
    .linkOpacity(link => {
      if (upgradeAnalysis) return upgradeAnalysis.allEdges.has(link.id) ? .92 : .02;
      if (path) return path.relations.includes(link.id) ? .94 : .025;
      if (selectedNode) return link.from === selectedNode.id || link.to === selectedNode.id ? .78 : .07;
      return .28;
    })
    .linkWidth(link => upgradeAnalysis?.allEdges.has(link.id) ? .24 : path?.relations.includes(link.id) ? .27 : selectedNode && (link.from === selectedNode.id || link.to === selectedNode.id) ? .14 : link.type === 'runtime' ? .07 : .035)
    .linkDirectionalParticles(link => {
      if (upgradeAnalysis?.allEdges.has(link.id)) return 4;
      if (path?.relations.includes(link.id)) return completedEdges.has(link.id) ? 5 : 3;
      return link.type === 'runtime' ? 2 : link.type === 'manage' ? 1 : 0;
    })
    .linkDirectionalParticleWidth(link => upgradeAnalysis?.allEdges.has(link.id) ? 1.4 : path?.relations.includes(link.id) ? 1.65 : .65)
    .linkDirectionalParticleSpeed(link => upgradeAnalysis?.allEdges.has(link.id) ? .0065 : path?.relations.includes(link.id) ? .008 : .004);
}

function clearSatelliteOrbit() {
  selectedModuleName = null;
  satelliteHitLayer.replaceChildren();
  if (!satelliteOrbit) return;
  satelliteOrbit.parent?.remove(satelliteOrbit);
  satelliteOrbit.traverse(child => {
    child.geometry?.dispose?.();
    if (child.material?.map) child.material.map.dispose();
    child.material?.dispose?.();
  });
  satelliteOrbit = null;
}

function createSatelliteOrbit(node) {
  clearSatelliteOrbit();
  const visual = nodeVisuals.get(node.id);
  if (!visual || !node.modules.length) return;
  const orbit = new THREE.Group();
  orbit.rotation.x = Math.PI * .16;
  orbit.scale.setScalar(.36);
  orbit.userData.targetScale = 1;
  const orbitRadius = Math.max(visual.userData.radius * 3.2, 6.2);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(orbitRadius, .018, 6, 100),
    new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: .24, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  ring.userData.baseOpacity = .24;
  ring.material.opacity = 0;
  ring.rotation.x = Math.PI / 2;
  orbit.add(ring);
  node.modules.forEach((moduleName, index) => {
    const angle = index / node.modules.length * Math.PI * 2;
    const satellite = new THREE.Group();
    const moduleData = { nodeId: node.id, moduleName };
    satellite.userData.moduleData = moduleData;
    satellite.position.set(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius, Math.sin(angle * 2) * .55);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.24, 16, 12), new THREE.MeshBasicMaterial({ color: node.color }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(node.color), color: node.color, transparent: true, opacity: .65, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.7, 1.7, 1);
    const label = labelSprite(moduleName, '#bcd7f1', .48);
    label.position.set(0, -.85, 0);
    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 12, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    dot.userData.moduleData = moduleData;
    halo.userData.moduleData = moduleData;
    label.userData.moduleData = moduleData;
    hitArea.userData.moduleData = moduleData;
    satellite.userData.dot = dot;
    satellite.userData.halo = halo;
    satellite.userData.targetScale = 1;
    satellite.add(dot, halo, label, hitArea);
    const hitButton = document.createElement('button');
    hitButton.type = 'button';
    hitButton.className = 'satellite-hit-target';
    hitButton.setAttribute('aria-label', `查看 ${moduleName} 模块部署节点`);
    hitButton.title = `${moduleName} · 点击查看部署节点`;
    hitButton.addEventListener('click', event => {
      suppressNodeClickUntil = performance.now() + 700;
      event.preventDefault();
      event.stopPropagation();
      selectModule(node, moduleName);
    });
    satellite.userData.hitButton = hitButton;
    satelliteHitLayer.append(hitButton);
    orbit.add(satellite);
  });
  visual.add(orbit);
  satelliteOrbit = orbit;
}

const satelliteScreenPoint = new THREE.Vector3();
function updateSatelliteHitTargets() {
  if (!satelliteOrbit) return;
  const canvasRect = graph.renderer().domElement.getBoundingClientRect();
  satelliteOrbit.children.forEach(satellite => {
    const button = satellite.userData?.hitButton;
    if (!button) return;
    satellite.getWorldPosition(satelliteScreenPoint);
    satelliteScreenPoint.project(graph.camera());
    const visible = satelliteScreenPoint.z > -1 && satelliteScreenPoint.z < 1;
    button.hidden = !visible;
    if (!visible) return;
    button.style.left = `${canvasRect.left + (satelliteScreenPoint.x + 1) * canvasRect.width / 2}px`;
    button.style.top = `${canvasRect.top + (1 - satelliteScreenPoint.y) * canvasRect.height / 2}px`;
  });
}

function highlightModuleSatellite(moduleName) {
  if (!satelliteOrbit) return;
  satelliteOrbit.children.forEach(child => {
    if (!child.userData?.moduleData) return;
    const selected = child.userData.moduleData.moduleName === moduleName;
    child.userData.targetScale = selected ? 1.55 : 1;
    if (child.userData.dot) child.userData.dot.material.color.set(selected ? '#ffffff' : selectedNode.color);
    if (child.userData.halo) child.userData.halo.material.opacity = selected ? 1 : .65;
  });
}

function moduleInstances(node, moduleName) {
  return (node.instances || []).filter(instance => {
    const names = [instance.serviceDisplayName, instance.serviceName].filter(Boolean);
    return names.includes(moduleName);
  });
}

function moduleRelationRows(node, moduleName) {
  const relations = DATA.relations.flatMap(relation => relation.rawRelations || []);
  const matches = relations.filter(relation =>
    (relation.sourceProduct === node.productName && relation.sourceService === moduleName)
    || (relation.targetProduct === node.productName && relation.targetService === moduleName)
  );
  if (!matches.length) return '<div class="chip">暂无已录入的模块关系</div>';
  return matches.map(relation => {
    const outbound = relation.sourceProduct === node.productName && relation.sourceService === moduleName;
    const peer = outbound
      ? `${relation.targetProduct} / ${relation.targetService}`
      : `${relation.sourceProduct} / ${relation.sourceService}`;
    return `<div class="module-relation"><strong>${outbound ? '依赖' : '被依赖于'} · ${escapeHtml(peer)}</strong><span>${escapeHtml(relation.type === 'conflict' ? '冲突关系' : '模块依赖')}</span></div>`;
  }).join('');
}

function instanceState(instance) {
  if (instance.healthState === 0 || /fail/i.test(instance.lifecycleStatus || '')) return { className: 'unhealthy', label: '异常' };
  if (instance.healthState === 1) return { className: 'healthy', label: '健康' };
  return { className: '', label: '未设置' };
}

function formatInstanceTime(value, fallback) {
  const date = value ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 2000) {
    return date.toLocaleString('zh-CN', { hour12: false });
  }
  const fallbackDate = fallback ? new Date(fallback) : null;
  if (fallbackDate && !Number.isNaN(fallbackDate.getTime()) && fallbackDate.getFullYear() >= 2000) {
    return `未上报 · 记录更新 ${fallbackDate.toLocaleString('zh-CN', { hour12: false })}`;
  }
  return '未上报';
}

function instanceRows(instances) {
  if (!instances.length) return '<div class="module-empty">该模块当前没有映射到 deploy_instance_list 中的部署实例。</div>';
  return instances.map(instance => {
    const state = instanceState(instance);
    const deployProgress = instance.lastDeployProgress == null ? '—' : `${instance.lastDeployProgress}%`;
    return `<article class="instance-row">
      <div class="service-row-head"><i class="state-dot ${state.className}"></i><strong>${escapeHtml(instance.hostLabel || '未知节点')}</strong><em>${escapeHtml(state.label)}</em></div>
      <div class="instance-grid">
        <span>服务版本<strong>${escapeHtml(instance.serviceVersion || '待同步')}</strong></span>
        <span>运行状态<strong>${escapeHtml(instance.lifecycleStatus || '待同步')}</strong></span>
        <span>最近部署<strong>${escapeHtml(instance.lastDeployStatus || '无记录')} · ${escapeHtml(deployProgress)}</strong></span>
        <span>心跳时间<strong>${escapeHtml(formatInstanceTime(instance.heartTime, instance.updateTime))}</strong></span>
        ${instance.prometheusPort ? `<span>监控端口<strong>${escapeHtml(instance.prometheusPort)}</strong></span>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderModuleDetails(node, moduleName) {
  selectedNode = node;
  selectedModuleName = moduleName;
  highlightModuleSatellite(moduleName);
  const instances = moduleInstances(node, moduleName);
  const healthy = instances.filter(instance => instanceState(instance).className === 'healthy').length;
  const unhealthy = instances.filter(instance => instanceState(instance).className === 'unhealthy').length;
  const versions = [...new Set(instances.map(instance => instance.serviceVersion).filter(Boolean))];
  const hosts = [...new Set(instances.map(instance => instance.hostLabel).filter(Boolean))];
  const isLive = DATA.mode === 'live';
  els.details.innerHTML = `
    <button class="module-back" id="moduleBack">← 返回 ${escapeHtml(node.name)} 产品详情</button>
    <div class="detail-kicker">${isLive ? 'EM LIVE · SERVICE ORBIT' : 'KNOWLEDGE · MODULE ORBIT'}</div>
    <div class="detail-title"><span class="detail-orb" style="color:${escapeHtml(node.color)}"></span><h2>${escapeHtml(moduleName)}</h2></div>
    <div class="detail-subtitle">所属产品 · ${escapeHtml(node.name)}</div>
    <span class="status-pill">● ${isLive ? `${instances.length} 个部署实例` : '知识图模块'}</span>
    ${isLive ? `
      <div class="detail-meta module-meta">
        <div><span>服务版本</span><strong>${escapeHtml(versions.join(' / ') || '待同步')}</strong></div>
        <div><span>部署节点</span><strong>${escapeHtml(hosts.join('、') || '暂无当前节点')}</strong></div>
        <div><span>数据来源</span><strong>${escapeHtml(sourceText(node))}</strong></div>
      </div>
      <div class="health-summary"><div><strong>${healthy}</strong><span>健康实例</span></div><div><strong>${unhealthy}</strong><span>异常实例</span></div><div><strong>${Math.max(0, instances.length - healthy - unhealthy)}</strong><span>未设置</span></div></div>
      <div class="detail-section"><h3>部署节点明细</h3>${instanceRows(instances)}</div>
      <div class="detail-section"><h3>模块级关系</h3>${moduleRelationRows(node, moduleName)}</div>
    ` : `
      <p class="detail-summary">知识图只记录模块归属；部署节点、实例版本和健康状态需要切换到 EM 实况图查看。</p>
      <div class="module-empty">当前为本地知识资料，不包含环境节点信息。</div>
    `}
    <button class="focus-again" id="focusAgain">重新聚焦 ${escapeHtml(moduleName)} 轨道</button>`;
  document.getElementById('moduleBack')?.addEventListener('click', () => {
    returnToProduct(node, moduleName);
  });
  document.getElementById('focusAgain')?.addEventListener('click', () => focusNode(node));
}

function focusNode(node, duration = 1150) {
  const distance = 29 + node.size * .18;
  const vector = new THREE.Vector3(node.x, node.y, node.z);
  const direction = graph.camera().position.clone().sub(vector).normalize();
  const cameraPosition = vector.clone().add(direction.multiplyScalar(distance));
  cameraPosition.y += 2;
  graph.cameraPosition(cameraPosition, vector, duration);
}

const focusProjection = new THREE.Vector3();
function screenPointForNode(node) {
  const rect = graph.renderer().domElement.getBoundingClientRect();
  focusProjection.set(node.x || 0, node.y || 0, node.z || 0).project(graph.camera());
  return {
    x: Math.max(34, Math.min(rect.width - 34, rect.left + (focusProjection.x + 1) * rect.width / 2)),
    y: Math.max(82, Math.min(rect.height - 82, rect.top + (1 - focusProjection.y) * rect.height / 2))
  };
}

function screenPointForModule(node, moduleName) {
  const satellite = satelliteOrbit?.children.find(child => child.userData?.moduleData?.moduleName === moduleName);
  const button = satellite?.userData?.hitButton;
  if (button && !button.hidden) {
    const rect = button.getBoundingClientRect();
    if (rect.width && rect.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return screenPointForNode(node);
}

function clearFocusTransition() {
  if (focusTransitionTimer) window.clearTimeout(focusTransitionTimer);
  if (focusFadeTimer) window.clearTimeout(focusFadeTimer);
  focusTransitionTimer = null;
  focusFadeTimer = null;
  els.focusTransition.className = 'focus-transition';
  els.focusTransition.setAttribute('aria-hidden', 'true');
}

function finishFocusTransition() {
  focusTransitionTimer = null;
  els.focusTransition.classList.add('leaving');
  focusFadeTimer = window.setTimeout(clearFocusTransition, 150);
}

function playFocusTransition(kind, kicker, title, subtitle, point) {
  clearFocusTransition();
  els.focusTransition.style.setProperty('--focus-x', `${point.x}px`);
  els.focusTransition.style.setProperty('--focus-y', `${point.y}px`);
  els.focusKicker.textContent = kicker;
  els.focusTitle.textContent = title;
  els.focusSubtitle.textContent = subtitle;
  void els.focusTransition.offsetWidth;
  els.focusTransition.classList.add('active', kind);
  els.focusTransition.setAttribute('aria-hidden', 'false');
  focusTransitionTimer = window.setTimeout(finishFocusTransition, kind === 'universe-return' ? 720 : 640);
}

function animateDetailsPanel() {
  els.details.classList.remove('detail-switch');
  void els.details.offsetWidth;
  els.details.classList.add('detail-switch');
}

let podDiagState = { ns: '', pod: '', tab: 'current', tail: 500, data: null, loading: false };

function logText(text) {
  return text ? escapeHtml(text) : '';
}

async function showPodLogs(ns, pod, tab, tail) {
  podDiagState.ns = ns;
  podDiagState.pod = pod;
  if (tab) podDiagState.tab = tab;
  if (tail) podDiagState.tail = tail;
  document.body.classList.add('pod-log-mode');

  if (!podDiagState.data || podDiagState.loading) {
    els.details.innerHTML = `<div class="empty-detail"><div class="empty-planet"></div><h2>${escapeHtml(pod)}</h2><p>正在读取诊断信息…</p></div>`;
  }
  podDiagState.loading = true;
  try {
    const url = `/api/pod-diagnose?ns=${encodeURIComponent(ns)}&pod=${encodeURIComponent(pod)}&tail=${podDiagState.tail}`;
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `返回 ${response.status}`);
    podDiagState.data = payload;
    renderPodDiag();
  } catch (error) {
    els.details.innerHTML = `<div class="empty-detail"><div class="empty-planet"></div><h2>读不到诊断信息</h2><p>${escapeHtml(error.message || '')}</p></div>`;
  } finally {
    podDiagState.loading = false;
  }
}

function renderPodDiag() {
  const d = podDiagState.data;
  if (!d) return;
  const containers = (d.containers || []).map(c => {
    const bad = c.waiting || c.termReason || c.lastReason;
    return `<div class="diag-container ${bad ? 'bad' : 'ok'}">
      <strong>${escapeHtml(c.name)}</strong>
      <span>重启 ${c.restarts}</span>
      ${c.waiting ? `<em>${escapeHtml(c.waiting)}</em>` : ''}
      ${c.termReason ? `<em>退出 ${escapeHtml(c.termReason)}${c.exitCode ? '(' + escapeHtml(c.exitCode) + ')' : ''}</em>` : ''}
      ${c.lastReason ? `<em>上次 ${escapeHtml(c.lastReason)}${c.lastExit ? '(' + escapeHtml(c.lastExit) + ')' : ''}</em>` : ''}
    </div>`;
  }).join('');

  const fastDeath = (d.containers || []).some(c => c.restarts > 0 || c.lastReason) || !d.current;
  const tabs = [
    ['current', '当前日志'],
    ['previous', '上一次容器'],
    ['events', '事件']
  ];
  const tabBar = tabs.map(([key, label]) => {
    const disabled = key === 'previous' && !d.hasPrevious;
    return `<button class="diag-tab ${podDiagState.tab === key ? 'active' : ''}" data-tab="${key}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  }).join('');

  const body = podDiagState.tab === 'events' ? d.events
    : podDiagState.tab === 'previous' ? d.previous : d.current;

  const emptyHint = podDiagState.tab === 'current' && !d.current
    ? `<div class="diag-empty">这个容器还没有输出日志。${fastDeath ? '它是快速退出型，请看「上一次容器」和「事件」。' : ''}</div>`
    : '';

  els.details.innerHTML = `
    <div class="detail-kicker">${escapeHtml(d.ns)} · POD DIAGNOSE</div>
    <div class="detail-title"><h2>${escapeHtml(d.pod)}</h2></div>
    <div class="detail-subtitle">${escapeHtml(d.phase || '')} · 节点 ${escapeHtml(d.node || '—')} · ${escapeHtml(d.ip || '')}</div>
    ${fastDeath ? '<div class="diag-warn">这个 Pod 有重启或快速退出，优先看退出原因和事件。</div>' : ''}
    <div class="diag-containers">${containers}</div>
    <div class="diag-toolbar">
      <div class="diag-tabs">${tabBar}</div>
      <select id="diagTail">
        ${[200, 500, 2000, 5000].map(n => `<option value="${n}" ${podDiagState.tail === n ? 'selected' : ''}>${n} 行</option>`).join('')}
      </select>
    </div>
    ${emptyHint}
    <pre class="diag-pre">${logText(body) || '（空）'}</pre>
    <div class="diag-actions">
      <button id="diagCopy">复制</button>
      <button id="diagReload">重新拉取</button>
      <button id="diagBack">返回</button>
    </div>`;

  els.details.querySelectorAll('[data-tab]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => { podDiagState.tab = b.dataset.tab; renderPodDiag(); });
  });
  const tailSelect = document.getElementById('diagTail');
  tailSelect?.addEventListener('change', () => showPodLogs(d.ns, d.pod, podDiagState.tab, Number(tailSelect.value)));
  document.getElementById('diagReload')?.addEventListener('click', () => showPodLogs(d.ns, d.pod, podDiagState.tab, podDiagState.tail));
  document.getElementById('diagBack')?.addEventListener('click', () => {
    document.body.classList.remove('pod-log-mode');
    podDiagState.data = null;
    const node = nodes.find(n => n.pods && n.pods.some(p => p.name === d.pod));
    if (node) renderNodeDetails(node); else renderDefaultDetails();
  });
  document.getElementById('diagCopy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(body || '');
      const btn = document.getElementById('diagCopy');
      if (btn) { btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制'; }, 1500); }
    } catch (e) {
      document.getElementById('diagCopy').textContent = '复制失败';
    }
  });
  const pre = els.details.querySelector('.diag-pre');
  if (pre) pre.scrollTop = 0;
  animateDetailsPanel();
}
function selectModule(node, moduleName) {
  if (DATA.mode === 'k8s') {
    playFocusTransition('module-dive', 'POD LOGS', `${node.name} → ${moduleName}`, '读取容器日志', screenPointForModule(node, moduleName));
    showPodLogs(node.namespace || node.group, moduleName);
    playTone(310 + node.size * 5, .08, 'sine');
    return;
  }
  const point = screenPointForModule(node, moduleName);
  playFocusTransition('module-dive', 'MODULE DIVE', `${node.name} → ${moduleName}`, '进入模块部署轨道', point);
  renderModuleDetails(node, moduleName);
  animateDetailsPanel();
  playTone(310 + node.size * 5, .08, 'sine');
}

function returnToProduct(node, moduleName) {
  playFocusTransition('module-return', 'ORBIT RETURN', `${moduleName} → ${node.name}`, '返回产品主轨道', screenPointForNode(node));
  selectedModuleName = null;
  highlightModuleSatellite(null);
  renderNodeDetails(node);
  animateDetailsPanel();
  playTone(260 + node.size * 6, .07, 'sine');
}

function renderDefaultDetails() {
  if (upgradeViewActive) {
    els.details.innerHTML = `
      <div class="empty-detail upgrade-empty">
        <div class="upgrade-radar" aria-hidden="true"><i></i><b></b></div>
        <h2>升级视角已开启</h2>
        <p>选择一个产品作为升级目标。青色显示升级前置依赖，粉色显示可能受影响的下游范围。</p>
        <div class="upgrade-legend"><span class="prerequisite">前置依赖</span><span class="target">升级目标</span><span class="impacted">影响范围</span></div>
      </div>`;
    return;
  }
  if (DATA.mode === 'live') {
    const meta = DATA.meta || {};
    els.details.innerHTML = `
      <div class="empty-detail">
        <div class="empty-planet" aria-hidden="true"></div>
        <h2>EM 实况宇宙</h2>
        <p>大星代表产品，小星代表服务。产品级连线由 EM 中的模块依赖汇总；点击产品查看服务版本、实例和健康状态。</p>
        <div class="universe-summary">
          <div><strong>${DATA.components.length}</strong><span>真实产品</span></div>
          <div><strong>${meta.relationCount ?? DATA.rawRelationCount ?? 0}</strong><span>模块关系</span></div>
          <div><strong>${meta.instanceCount ?? 0}</strong><span>当前实例</span></div>
          <div><strong>${meta.hostCount ?? 0}</strong><span>${meta.hostsMasked ? '脱敏节点' : '部署节点'}</span></div>
        </div>
      </div>`;
    return;
  }
  els.details.innerHTML = `
    <div class="empty-detail">
      <div class="empty-planet" aria-hidden="true"></div>
      <h2>进入组件宇宙</h2>
      <p>拖动旋转星系，滚轮穿行，点击任意星球进入组件轨道。关系方向由流动粒子显示。</p>
      <div class="universe-summary">
        <div><strong>${DATA.components.length}</strong><span>已收录组件</span></div>
        <div><strong>${DATA.relations.length}</strong><span>已录入关系</span></div>
      </div>
    </div>`;
}

function upgradeScopeItems(depths, role) {
  const items = [...depths.entries()]
    .map(([id, depth]) => ({ node: componentById[id], depth }))
    .filter(item => item.node)
    .sort((a, b) => a.depth - b.depth || a.node.name.localeCompare(b.node.name));
  if (!items.length) return '<span class="upgrade-none">未发现已录入关系</span>';
  return items.map(({ node, depth }) => `<button class="upgrade-node ${role}" data-target="${escapeHtml(node.id)}"><strong>${escapeHtml(node.name)}</strong><small>${depth === 1 ? '直接关系' : `${depth} 跳关系`}</small></button>`).join('');
}

function upgradeImpactHtml(node) {
  if (!upgradeViewActive) return '';
  const analysis = upgradeAnalysisFor(node);
  const caveat = DATA.mode === 'live'
    ? '按当前 EM 模块依赖聚合推演；不包含表外隐式依赖与历史部署记录。'
    : '按已录入的运行依赖与部署顺序推演；待确认关系不能替代正式升级方案。';
  return `
    <div class="upgrade-impact-card">
      <div class="upgrade-impact-head"><span>UPGRADE IMPACT</span><strong>${analysis.prerequisites.size} 项前置 · ${analysis.impacted.size} 项影响</strong></div>
      <div class="upgrade-lane prerequisite"><h3>升级前置依赖</h3><p>升级 ${escapeHtml(node.name)} 前应优先核查</p><div>${upgradeScopeItems(analysis.prerequisites, 'prerequisite')}</div></div>
      <div class="upgrade-lane impacted"><h3>可能受影响范围</h3><p>${escapeHtml(node.name)} 变更后建议回归验证</p><div>${upgradeScopeItems(analysis.impacted, 'impacted')}</div></div>
      <p class="upgrade-caveat">${escapeHtml(caveat)}</p>
    </div>`;
}

function bindUpgradeNavigation() {
  els.details.querySelectorAll('.upgrade-node[data-target]').forEach(button => button.addEventListener('click', () => {
    selectNode(nodes.find(item => item.id === button.dataset.target), true);
  }));
}

function relationRows(node, outbound) {
  const relations = DATA.relations.filter(relation => outbound ? relation.from === node.id : relation.to === node.id);
  if (!relations.length) return '<div class="chip">暂无已录入关系</div>';
  return relations.map(relation => {
    const otherId = outbound ? relation.to : relation.from;
    const other = componentById[otherId];
    const direction = outbound ? `${node.name} → ${other.name}` : `${other.name} → ${node.name}`;
    const raw = relation.rawRelations?.map(item => `${item.sourceService} → ${item.targetService}`).join('；');
    return `<div class="relation-row" data-target="${escapeHtml(otherId)}"><strong>${escapeHtml(direction)} · ${escapeHtml(TYPE_NAMES[relation.type])}</strong><span>${escapeHtml(relation.label)} · ${escapeHtml(statusText(relation.status))}</span>${raw ? `<div class="relation-raw">${escapeHtml(raw)}</div>` : ''}</div>`;
  }).join('');
}

function serviceRows(node) {
  if (!node.services?.length) return '<div class="chip">暂无服务数据</div>';
  return node.services.map(serviceName => {
    const instances = (node.instances || []).filter(instance => (instance.serviceDisplayName || instance.serviceName) === serviceName || instance.serviceName === serviceName);
    const unhealthy = instances.some(instance => instance.healthState === 0 || /fail/i.test(instance.lifecycleStatus || ''));
    const healthy = instances.some(instance => instance.healthState === 1) && !unhealthy;
    const stateClass = unhealthy ? 'unhealthy' : healthy ? 'healthy' : '';
    const versions = [...new Set(instances.map(instance => instance.serviceVersion).filter(Boolean))];
    const hosts = [...new Set(instances.map(instance => instance.hostLabel).filter(Boolean))];
    return `<button class="service-row" data-service="${escapeHtml(serviceName)}"><div class="service-row-head"><i class="state-dot ${stateClass}"></i><strong>${escapeHtml(serviceName)}</strong><em>${instances.length} 实例 · 查看节点 ›</em></div><small>${escapeHtml(versions.join(' / ') || '版本待同步')}${hosts.length ? ` · ${escapeHtml(hosts.join('、'))}` : ''}</small></button>`;
  }).join('');
}

function renderNodeDetails(node) {
  if (Array.isArray(node.pods) && node.pods.length) {
    renderPodDetails(node);
    return;
  }
  if (DATA.mode === 'live') {
    const health = node.health || { healthy: 0, unhealthy: 0, unknown: 0, total: 0 };
    const tags = node.versionInfo?.tags || [];
    els.details.innerHTML = `
      <div class="detail-kicker">EM LIVE · ${escapeHtml(node.group.toUpperCase())}</div>
      <div class="detail-title"><span class="detail-orb" style="color:${escapeHtml(node.color)}"></span><h2>${escapeHtml(node.name)}</h2></div>
      <div class="detail-subtitle">产品版本 · ${escapeHtml(node.version || '待同步')}</div>
      <span class="status-pill">● ${health.unhealthy ? '存在异常' : health.healthy ? '运行正常' : '健康状态待确认'}</span>
      <p class="detail-summary">${escapeHtml(node.summary)}</p>
      ${upgradeImpactHtml(node)}
      <div class="detail-meta"><div><span>当前版本</span><strong>${escapeHtml(node.versionInfo?.raw || node.version || '待同步')}</strong></div><div><span>可用版本</span><strong>${escapeHtml((node.availableVersions || [node.version]).filter(Boolean).join(' / ') || '待同步')}</strong></div><div><span>版本标签</span><strong>${escapeHtml(tags.join(' · ') || '无额外架构标签')}</strong></div><div><span>包记录状态</span><strong>${escapeHtml(node.packageStatus || '待同步')}</strong></div><div><span>数据来源</span><strong>${escapeHtml(sourceText(node))}</strong></div></div>
      <div class="health-summary"><div><strong>${health.healthy}</strong><span>健康</span></div><div><strong>${health.unhealthy}</strong><span>异常</span></div><div><strong>${health.unknown}</strong><span>未设置</span></div></div>
      <div class="detail-section"><h3>服务与当前实例</h3>${serviceRows(node)}</div>
      <div class="detail-section"><h3>从本产品出发</h3>${relationRows(node, true)}</div>
      <div class="detail-section"><h3>指向本产品</h3>${relationRows(node, false)}</div>
      <button class="focus-again" id="focusAgain">重新进入 ${escapeHtml(node.name)} 轨道</button>`;
    els.details.querySelectorAll('.relation-row').forEach(row => row.addEventListener('click', () => selectNode(nodes.find(item => item.id === row.dataset.target), true)));
    bindUpgradeNavigation();
    els.details.querySelectorAll('[data-service]').forEach(row => row.addEventListener('click', () => selectModule(node, row.dataset.service)));
    document.getElementById('focusAgain')?.addEventListener('click', () => focusNode(node));
    return;
  }
  const moduleHtml = node.modules.length ? node.modules.map(name => `<span class="chip">${escapeHtml(name)}</span>`).join('') : '<span class="chip">模块清单待确认</span>';
  const portHtml = node.ports.map(port => `<span class="chip">${escapeHtml(port)}</span>`).join('');
  els.details.innerHTML = `
    <div class="detail-kicker">${escapeHtml(node.group.toUpperCase())} · COMPONENT ORBIT</div>
    <div class="detail-title"><span class="detail-orb" style="color:${escapeHtml(node.color)}"></span><h2>${escapeHtml(node.name)}</h2></div>
    <div class="detail-subtitle">${escapeHtml(node.fullName)}</div>
    <span class="status-pill">● 信息${escapeHtml(statusText(node.status))}</span>
    <p class="detail-summary">${escapeHtml(node.summary)}</p>
    ${upgradeImpactHtml(node)}
    <div class="detail-meta"><div><span>资料基线</span><strong>${escapeHtml(DATA.baseline)}</strong></div><div><span>信息来源</span><strong>${escapeHtml(sourceText(node))}</strong></div></div>
    <div class="detail-section"><h3>关键端口</h3><div class="chips">${portHtml}</div></div>
    <div class="detail-section"><h3>轨道模块</h3><div class="chips">${moduleHtml}</div></div>
    <div class="detail-section"><h3>从本组件出发</h3>${relationRows(node, true)}</div>
    <div class="detail-section"><h3>指向本组件</h3>${relationRows(node, false)}</div>
    <button class="focus-again" id="focusAgain">重新进入 ${escapeHtml(node.name)} 轨道</button>`;
  els.details.querySelectorAll('.relation-row').forEach(row => row.addEventListener('click', () => selectNode(nodes.find(item => item.id === row.dataset.target), true)));
  bindUpgradeNavigation();
  document.getElementById('focusAgain')?.addEventListener('click', () => focusNode(node));
}

function renderPodDetails(node) {
  const rows = node.pods.map(pod => `
    <div class="pod-row ${pod.tone}" data-pod="${escapeHtml(pod.name)}" title="点击查看日志">
      <span class="pod-dot ${pod.tone}"></span>
      <strong>${escapeHtml(pod.name)}</strong>
      <em>${escapeHtml(pod.phase)} ${escapeHtml(pod.ready)}</em>
      <small>${escapeHtml(pod.node || '')}${Number(pod.restarts) ? ' · 重启 ' + pod.restarts : ''}</small>
    </div>`).join('');

  const withLogs = node.pods.filter(pod => pod.logs);
  const logHtml = withLogs.length
    ? withLogs.map(pod => `
      <div class="pod-log">
        <div class="pod-log-head">${escapeHtml(pod.name)} · 最近 15 行</div>
        <pre>${escapeHtml(String(pod.logs).replace(/\u001e/g, '\n'))}</pre>
      </div>`).join('')
    : '<p class="detail-hint">这些 Pod 都正常，采集器只对异常的 Pod 抓日志；出问题时日志会自动带上来。</p>';

  const toneText = node.tone === 'ok' ? '运行正常' : node.tone === 'warn' ? '需注意' : '异常';

  els.details.innerHTML = `
    <div class="detail-kicker">${escapeHtml(node.namespace || node.group)} · K8S WORKLOAD</div>
    <div class="detail-title"><span class="detail-orb" style="color:${escapeHtml(node.color)}"></span><h2>${escapeHtml(node.name)}</h2></div>
    <div class="detail-subtitle">${escapeHtml(node.fullName)}</div>
    <span class="status-pill ${node.tone}">${toneText}</span>
    <p class="detail-summary">${escapeHtml(node.summary)}</p>
    <div class="detail-section"><h3>Pod（${node.pods.length}）</h3><div class="pod-list">${rows}</div></div>
    <div class="detail-section"><h3>日志情况</h3>${logHtml}</div>
    <div class="detail-section"><h3>从本工作负载出发</h3>${relationRows(node, true)}</div>
    <div class="detail-section"><h3>指向本工作负载</h3>${relationRows(node, false)}</div>
    <button class="focus-again" id="focusAgain">重新进入 ${escapeHtml(node.name)} 轨道</button>`;
  els.details.querySelectorAll('.relation-row').forEach(row => row.addEventListener('click', () => selectNode(nodes.find(item => item.id === row.dataset.target), true)));
  els.details.querySelectorAll('[data-pod]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => showPodLogs(node.namespace || node.group, row.dataset.pod));
  });
  document.getElementById('focusAgain')?.addEventListener('click', () => focusNode(node));
  animateDetailsPanel();
}
function selectNode(node, fly = false) {
  if (!node) return;
  const previousNode = selectedNode;
  const previousModule = selectedModuleName;
  const changingPlanet = previousNode && previousNode.id !== node.id;
  if (fly && (changingPlanet || previousModule || !previousNode)) {
    const kind = previousModule ? 'module-return' : changingPlanet ? 'planet-hop' : 'planet-enter';
    const title = previousModule
      ? `${previousModule} → ${node.name}`
      : changingPlanet ? `${previousNode.name} → ${node.name}` : `进入 ${node.name} 轨道`;
    playFocusTransition(kind, changingPlanet ? 'ORBIT SHIFT' : 'TARGET LOCK', title, changingPlanet ? '正在切换产品主轨道' : '正在锁定产品坐标', screenPointForNode(node));
  }
  stopMission(true);
  selectedNode = node;
  selectedModuleName = null;
  renderNodeDetails(node);
  animateDetailsPanel();
  updateVisualState();
  createSatelliteOrbit(node);
  if (fly) focusNode(node, changingPlanet ? 860 : 1020);
  playTone(220 + node.size * 9, .08, 'sine');
  els.searchResults.classList.remove('open');
}

function setHover(node) {
  hoveredNode = node || null;
  els.universe.style.cursor = node ? 'pointer' : 'grab';
  if (!node) {
    els.hover.classList.remove('show');
    return;
  }
  els.hover.innerHTML = `<strong>${escapeHtml(node.name)}</strong> · ${escapeHtml(node.fullName)} · 点击进入轨道`;
  els.hover.classList.add('show');
}

function goHome(withTransition = true) {
  const previousNode = selectedNode;
  if (previousNode && withTransition) {
    playFocusTransition('universe-return', 'UNIVERSE MAP', `${previousNode.name} → 宇宙总览`, '正在拉远镜头并恢复全局关系', screenPointForNode(previousNode));
  }
  stopMission(true);
  selectedNode = null;
  clearSatelliteOrbit();
  renderDefaultDetails();
  animateDetailsPanel();
  graph.cameraPosition({ x: 6, y: 1, z: currentMode === 'live' ? 115 : 102 }, { x: 6, y: -1, z: 1 }, previousNode ? 880 : 700);
  updateVisualState();
}

function setFilterOptions(mode) {
  const options = mode === 'live'
    ? [['runtime', '模块依赖'], ['conflict', '冲突关系'], ['all', '全部关系']]
    : [['runtime', '运行依赖'], ['deploy', '部署顺序'], ['colocate', '同机约束'], ['manage', '管理关系'], ['all', '全部关系']];
  els.filter.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  els.filter.value = mode === 'live' ? 'all' : 'runtime';
}

function setDataStatus(state, title, metrics) {
  const light = els.dataStatus.querySelector('.status-light');
  light.className = `status-light ${state}`;
  els.dataStatusTitle.textContent = title;
  els.dataStatusMetrics.textContent = metrics;
}

function updateModeChrome(mode) {
  currentMode = mode;
  document.body.classList.toggle('live-mode', mode === 'live');
  document.body.classList.toggle('k8s-mode', mode === 'k8s');
  els.versionButtons.forEach(button => {
    const isSeven = button.dataset.version === '7.0';
    const active = mode === 'k8s' ? isSeven : !isSeven;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  els.modeButtons.forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  setFilterOptions(mode);
  if (typeof updateScopeButton === 'function') updateScopeButton();
  const statsMode = document.querySelector('.dock-stats em');
  if (statsMode) statsMode.textContent = mode === 'k8s' ? 'K8S LIVE' : mode === 'live' ? 'EM LIVE' : 'OFFLINE';
  els.search.placeholder = mode === 'k8s' ? '定位 Pod、工作负载或命名空间' : mode === 'live' ? '定位产品、服务、版本或状态' : '定位组件、模块、端口或功能';
}

function setUpgradeView(active) {
  upgradeViewActive = Boolean(active);
  document.body.classList.toggle('upgrade-view-active', upgradeViewActive);
  els.upgradeView.classList.toggle('active', upgradeViewActive);
  els.upgradeView.setAttribute('aria-pressed', String(upgradeViewActive));
  els.upgradeView.textContent = upgradeViewActive ? '⇧ 升级视角已开' : '⇧ 升级视角';
  stopMission(true);
  if (selectedNode) renderNodeDetails(selectedNode);
  else renderDefaultDetails();
  animateDetailsPanel();
  updateVisualState();
}

function beginWarpTransition(title, subtitle) {
  warpSequence += 1;
  warpStartedAt = performance.now();
  els.warpTitle.textContent = title;
  els.warpSubtitle.textContent = subtitle;
  els.warp.classList.remove('leaving');
  els.warp.classList.add('active');
  els.warp.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-transitioning');
  document.body.setAttribute('aria-busy', 'true');
  els.modeButtons.forEach(button => { button.disabled = true; });
  return warpSequence;
}

function waitForWarpPaint() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

async function endWarpTransition(sequence) {
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  const remaining = Math.max(0, 720 - (performance.now() - warpStartedAt));
  if (remaining) await new Promise(resolve => window.setTimeout(resolve, remaining));
  if (sequence !== warpSequence) return;
  els.warp.classList.add('leaving');
  document.body.classList.remove('is-transitioning');
  await new Promise(resolve => window.setTimeout(resolve, 300));
  if (sequence !== warpSequence) return;
  els.warp.classList.remove('active', 'leaving');
  els.warp.setAttribute('aria-hidden', 'true');
  document.body.removeAttribute('aria-busy');
  els.modeButtons.forEach(button => { button.disabled = false; });
}

function applyData(data, mode) {
  stopMission(true);
  clearFocusTransition();
  clearSatelliteOrbit();
  selectedNode = null;
  activePath = null;
  DATA = data;
  componentById = Object.fromEntries(DATA.components.map(component => [component.id, component]));
  const nextGraphData = makeGraphData(DATA);
  nodes = nextGraphData.graphNodes;
  links = nextGraphData.graphLinks;
  nodeVisuals.clear();
  updateModeChrome(mode);
  graph.graphData({ nodes, links });
  graph.cameraPosition({ x: 6, y: 1, z: mode === 'live' ? 115 : 102 }, { x: 6, y: -1, z: 1 }, 900);
  document.getElementById('componentCount').textContent = DATA.components.length;
  document.getElementById('relationCount').textContent = mode === 'live' ? (DATA.meta?.relationCount ?? DATA.rawRelationCount ?? DATA.relations.length) : DATA.relations.length;
  els.healthyCount.textContent = DATA.meta?.healthyCount ?? 0;
  els.unhealthyCount.textContent = DATA.meta?.unhealthyCount ?? 0;
  els.unknownCount.textContent = DATA.meta?.unknownCount ?? 0;
  els.liveDockNote.textContent = mode === 'live'
    ? `${DATA.meta?.instanceCount ?? 0} 当前实例 · ${DATA.meta?.hostCount ?? 0} ${DATA.meta?.hostsMasked ? '脱敏节点' : '节点'} · ${DATA.meta?.unresolvedRelationCount ?? 0} 条关系未映射到当前产品`
    : '等待连接 EM 数据源';
  renderDefaultDetails();
  updateVisualState();
}

async function loadLiveData() {
  const warp = beginWarpTransition(
    currentMode === 'live' ? '正在刷新 EM 星系坐标' : '正在跃迁至 EM 实况宇宙',
    '同步产品、服务、实例与模块关系'
  );
  setDataStatus('syncing', '正在同步 EM 实况', '读取产品、服务关系与当前实例…');
  els.sync.disabled = true;
  try {
    await waitForWarpPaint();
    const response = await fetch('/api/live/snapshot', { cache: 'no-store', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `连接器返回 ${response.status}`);
    const liveData = adaptLiveSnapshot(payload);
    applyData(liveData, 'live');
    const captured = new Date(liveData.capturedAt || Date.now()).toLocaleString('zh-CN', { hour12: false });
    setDataStatus('live', 'EM 实况 · 已同步', `${liveData.components.length} 产品 · ${liveData.meta.relationCount} 模块关系 · ${liveData.meta.instanceCount} 实例 · ${captured}`);
    els.sync.textContent = '↻ 重新同步';
  } catch (error) {
    setDataStatus('error', 'EM 实况连接失败', error.message || '请启动本地连接器');
    els.details.innerHTML = `<div class="empty-detail"><div class="empty-planet"></div><h2>尚未连接 EM</h2><p>${escapeHtml(error.message || '请先启动本地连接器。')}<br>离线双击 HTML 时仍可使用知识图；实况图需要通过 connector 启动。</p></div>`;
  } finally {
    els.sync.disabled = false;
    await endWarpTransition(warp);
  }
}

let k8sNamespaces = [];

function updateScopeButton() {
  const select = document.getElementById('nsSelect');
  if (!select) return;
  select.hidden = currentMode !== 'k8s';
  const current = select.value;
  const options = [`<option value="product">业务命名空间（推荐）</option>`, `<option value="all">全部 ${k8sNamespaces.length} 个命名空间</option>`];
  for (const ns of k8sNamespaces) {
    options.push(`<option value="${ns.name}">${ns.name}（${ns.count}）</option>`);
  }
  select.innerHTML = options.join('');
  select.value = current && [...select.options].some(o => o.value === current) ? current : k8sScope;
}

function ensureScopeButton() {
  if (document.getElementById('nsSelect')) return;
  const select = document.createElement('select');
  select.id = 'nsSelect';
  select.className = 'ns-select';
  select.hidden = true;
  select.setAttribute('aria-label', '命名空间');
  select.addEventListener('change', () => {
    k8sScope = select.value;
    loadK8sData();
  });
  els.dataStatus.append(select);
}
async function loadK8sData() {
  const warp = beginWarpTransition('正在接入 7.0 集群', '读取 Pod、工作负载与配置引用关系');
  setDataStatus('syncing', '正在读取 7.0 集群', 'Pod 状态 · 工作负载 · 依赖关系…');
  try {
    await waitForWarpPaint();
    if (!(location.protocol === 'http:' || location.protocol === 'https:')) {
      throw new Error('离线打开读不到集群数据，请用服务器地址访问。');
    }
    const response = await fetch('/api/latest', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? '服务器上还没有采集结果。'
        : `服务器返回 ${response.status}`);
    }
    const snapshot = await response.json();
    const counts = new Map();
    for (const w of snapshot.workloads || []) counts.set(w.ns, (counts.get(w.ns) || 0) + 1);
    k8sNamespaces = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    const data = adaptK8sSnapshot(snapshot, capsData.capabilities || [], { scope: k8sScope });
    if (!data.components.length) throw new Error('采集结果里没有工作负载，确认采集器跑成功了。');
    applyData(data, 'k8s');
    const bad = data.components.filter(component => component.tone === 'bad').length;
    const warn = data.components.filter(component => component.tone === 'warn').length;
    setDataStatus('live', '7.0 K8s · 实采',
      `${data.components.length} 工作负载 · ${(snapshot.pods || []).length} Pod · ${data.relations.length} 条依赖 · 异常 ${bad} / 需注意 ${warn}`);
    els.sync.textContent = '↻ 刷新 7.0';
  } catch (error) {
    setDataStatus('error', '7.0 集群未接入', error.message || '读取失败');
    els.details.innerHTML = `<div class="empty-detail"><div class="empty-planet"></div><h2>还没有 7.0 集群数据</h2><p>${escapeHtml(error.message || '')}</p><p>在集群节点上执行：<br><code>./xt-blackbox capabilities --push=http://本机:22648/api/ingest</code></p></div>`;
  } finally {
    await endWarpTransition(warp);
  }
}
async function loadKnowledgeData(animateTransition = true) {
  const warp = animateTransition
    ? beginWarpTransition('正在返回知识图宇宙', '恢复本地组件、链路与资料基线')
    : null;
  if (warp) await waitForWarpPaint();
  applyData(KNOWLEDGE_DATA, 'knowledge');
  setDataStatus('knowledge', '知识图 · 本地资料', `${KNOWLEDGE_DATA.components.length} 组件 · ${KNOWLEDGE_DATA.relations.length} 关系 · 不含环境信息`);
  els.sync.textContent = '↻ 同步实况';
  if (warp) await endWarpTransition(warp);
}

function playTone(frequency, duration = .12, type = 'sine') {
  if (!soundEnabled) return;
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, audioContext.currentTime + duration);
  gain.gain.setValueAtTime(.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.055, audioContext.currentTime + .015);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration + .02);
}

function renderTimeline(path, step) {
  els.timeline.classList.add('show');
  els.timelineTitle.textContent = path.name.toUpperCase();
  els.timelineStage.textContent = step < 0 ? '链路即将启动' : step >= path.nodes.length ? '航线演示完成' : `正在抵达 ${componentById[path.nodes[step]].name}`;
  els.timelineTrack.innerHTML = path.nodes.map((id, index) => `<div class="timeline-step ${index < step ? 'done' : index === step ? 'active' : ''}"><i></i><span>${escapeHtml(componentById[id].name)}</span></div>`).join('');
}

function startMission(pathId) {
  if (!DATA.paths?.[pathId] || DATA.mode === 'live') return;
  stopMission(false);
  activePath = pathId;
  activeStep = -1;
  completedEdges = new Set();
  selectedNode = null;
  clearSatelliteOrbit();
  els.search.value = '';
  els.searchResults.classList.remove('open');
  const path = DATA.paths[pathId];
  els.filter.value = 'runtime';
  document.querySelectorAll('.mission-btn').forEach(button => button.classList.toggle('active', button.dataset.path === pathId));
  renderTimeline(path, -1);
  updateVisualState();
  playTone(164, .18, 'triangle');

  path.nodes.forEach((id, index) => {
    const timer = window.setTimeout(() => {
      activeStep = index;
      if (index > 0) completedEdges.add(path.relations[index - 1]);
      const node = nodes.find(item => item.id === id);
      selectedNode = node;
      renderNodeDetails(node);
      renderTimeline(path, index);
      focusNode(node, 1250);
      updateVisualState();
      createSatelliteOrbit(node);
      playTone(210 * Math.pow(1.18, index), .14, index % 2 ? 'sine' : 'triangle');
    }, 500 + index * 1850);
    missionTimers.push(timer);
  });

  missionTimers.push(window.setTimeout(() => {
    activeStep = path.nodes.length;
    path.relations.forEach(id => completedEdges.add(id));
    renderTimeline(path, activeStep);
    updateVisualState();
    playTone(520, .3, 'sine');
  }, 650 + path.nodes.length * 1850));
}

function stopMission(hideTimeline = true) {
  missionTimers.forEach(timer => window.clearTimeout(timer));
  missionTimers = [];
  activePath = null;
  activeStep = -1;
  completedEdges = new Set();
  document.querySelectorAll('.mission-btn').forEach(button => button.classList.remove('active'));
  if (hideTimeline) els.timeline.classList.remove('show');
  updateVisualState();
}

function searchableText(component) {
  return [component.name, component.fullName, component.summary, ...component.ports, ...component.modules].join(' ').toLowerCase();
}

function updateSearch() {
  const query = els.search.value.trim().toLowerCase();
  if (!query) {
    els.searchResults.classList.remove('open');
    return;
  }
  const matches = DATA.components.filter(component => searchableText(component).includes(query)).slice(0, 8);
  els.searchResults.innerHTML = matches.length ? matches.map(component => `<div class="search-result" data-id="${component.id}"><strong>${escapeHtml(component.name)}</strong><small>${escapeHtml(component.fullName)}</small></div>`).join('') : '<div class="search-result"><small>没有找到匹配内容</small></div>';
  els.searchResults.classList.add('open');
  els.searchResults.querySelectorAll('[data-id]').forEach(row => row.addEventListener('click', () => {
    const node = nodes.find(item => item.id === row.dataset.id);
    els.search.value = node.name;
    selectNode(node, true);
  }));
}

els.filter.addEventListener('change', () => {
  stopMission(true);
  updateVisualState();
});
els.upgradeView.addEventListener('click', () => setUpgradeView(!upgradeViewActive));
els.search.addEventListener('input', updateSearch);
els.search.addEventListener('keydown', event => {
  if (event.key === 'Escape') els.searchResults.classList.remove('open');
  if (event.key === 'Enter') {
    const first = els.searchResults.querySelector('[data-id]');
    if (first) selectNode(nodes.find(item => item.id === first.dataset.id), true);
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.search-wrap')) els.searchResults.classList.remove('open');
});

const moduleRaycaster = new THREE.Raycaster();
const modulePointer = new THREE.Vector2();
function moduleHitFromEvent(event) {
  if (!satelliteOrbit) return null;
  const canvas = graph.renderer().domElement;
  const rect = canvas.getBoundingClientRect();
  modulePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  modulePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  moduleRaycaster.setFromCamera(modulePointer, graph.camera());
  const hits = moduleRaycaster.intersectObjects(satelliteOrbit.children, true);
  for (const hit of hits) {
    let object = hit.object;
    while (object && object !== satelliteOrbit) {
      if (object.userData?.moduleData) return object.userData.moduleData;
      object = object.parent;
    }
  }
  return null;
}

graph.renderer().domElement.addEventListener('click', event => {
  const moduleData = moduleHitFromEvent(event);
  if (!moduleData) return;
  suppressNodeClickUntil = performance.now() + 700;
  event.preventDefault();
  event.stopImmediatePropagation();
  const node = nodes.find(item => item.id === moduleData.nodeId);
  if (!node) return;
  selectModule(node, moduleData.moduleName);
}, true);

graph.renderer().domElement.addEventListener('pointerdown', event => {
  if (moduleHitFromEvent(event)) suppressNodeClickUntil = performance.now() + 700;
}, true);
document.querySelectorAll('.mission-btn').forEach(button => button.addEventListener('click', () => startMission(button.dataset.path)));
els.stop.addEventListener('click', () => stopMission(true));
els.home.addEventListener('click', goHome);
els.sound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  els.sound.setAttribute('aria-pressed', String(soundEnabled));
  els.sound.classList.toggle('active', soundEnabled);
  els.sound.textContent = soundEnabled ? '◉ 声音已开' : '◌ 声音';
  playTone(440, .12, 'sine');
});
els.modeButtons.forEach(button => button.addEventListener('click', () => {
  if (currentMode === 'k8s') loadKnowledgeData();
  else if (button.dataset.mode === currentMode) return;
  else if (button.dataset.mode === 'live') loadLiveData();
  else loadKnowledgeData();
}));
els.versionButtons.forEach(button => button.addEventListener('click', () => {
  const seven = button.dataset.version === '7.0';
  if (seven && currentMode !== 'k8s') loadK8sData();
  else if (!seven && currentMode === 'k8s') loadKnowledgeData();
}));
els.sync.addEventListener('click', () => {
  if (currentMode === 'k8s') loadK8sData();
  else loadLiveData();
});
window.addEventListener('resize', () => graph.width(window.innerWidth).height(window.innerHeight));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') goHome();
});

loadKnowledgeData(false);

const clock = new THREE.Clock();
function animate() {
  const elapsed = clock.getElapsedTime();
  nodeVisuals.forEach((visual, id) => {
    visual.userData.planet.rotation.y += .0012 + (hashSeed(id) % 7) * .00008;
    visual.userData.rings.forEach((ring, index) => { ring.rotation.z += .0009 * (index % 2 ? -1 : 1); });
    const baseOpacity = visual.userData.glow.userData.baseOpacity ?? .5;
    visual.userData.glow.material.opacity = Math.max(.06, baseOpacity + Math.sin(elapsed * 1.2 + hashSeed(id) % 9) * .035);
    const targetScale = visual.userData.targetScale ?? 1;
    const nextScale = visual.scale.x + (targetScale - visual.scale.x) * .12;
    visual.scale.setScalar(nextScale);
  });
  stars.forEach(layer => { layer.rotation.y += layer.userData.rotationSpeed; });
  if (satelliteOrbit) {
    satelliteOrbit.rotation.z += .0008;
    const orbitTarget = satelliteOrbit.userData.targetScale ?? 1;
    const orbitScale = satelliteOrbit.scale.x + (orbitTarget - satelliteOrbit.scale.x) * .1;
    satelliteOrbit.scale.setScalar(orbitScale);
    const orbitRing = satelliteOrbit.children[0];
    if (orbitRing?.material) orbitRing.material.opacity += ((orbitRing.userData.baseOpacity ?? .24) - orbitRing.material.opacity) * .1;
    satelliteOrbit.children.forEach(satellite => {
      if (!satellite.userData?.moduleData) return;
      const target = satellite.userData.targetScale ?? 1;
      const scale = satellite.scale.x + (target - satellite.scale.x) * .16;
      satellite.scale.setScalar(scale);
    });
  }
  updateSatelliteHitTargets();
  window.requestAnimationFrame(animate);
}
animate();

window.setTimeout(() => els.loading.classList.add('hidden'), 900);
window.XINGTU_IMMERSIVE = { get data() { return DATA; }, graph, selectNode: id => selectNode(nodes.find(node => node.id === id), true), startMission, loadLiveData, loadKnowledgeData, setUpgradeView };
// ---- 能力矩阵叠层：7.0 K8s 用采集数据，6.3 主机化用组件知识 ----
ensureScopeButton();
initBlackbox();
initCapabilityOverlay({
  k8s: capsData.capabilities || [],
  host: (KNOWLEDGE_DATA.components || []).map(component => ({
    id: 'host-' + component.id,
    name: component.name,
    brief: component.fullName || '',
    group: component.group || '',
    ports: component.ports || [],
    modules: component.modules || [],
    source: component.source || '内部产品资料'
  }))
});
