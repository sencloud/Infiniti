/* =====================================================================
   无限连接 · 3D 时间图谱引擎（Three.js 手写力导向，无外部图库依赖）
   ---------------------------------------------------------------------
   布局设计：
   - Y 轴 = 出生年份（时间地层）：唐代在上，清代在下，一眼看朝代分布
   - X/Z 平面 = 关系力导向（斥力+引力+向心），同代人物自然聚拢
   - 节点 = 发光球体（已确认=蓝光，待确认=暗灰）；边 = 关系色线段
   交互：
   - OrbitControls 风格自实现：左键旋转 / 右键平移 / 滚轮缩放
   - Raycaster 拾取节点：单击弹详情卡 / 双击展开邻域（无限生长）
   ===================================================================== */
import * as THREE from '/vendor/three.module.min.js'; // 直接 URL 导入（不依赖 importmap，兼容旧内核）

/* ================= 基础工具 ================= */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 关系类型 -> 颜色（与 UI 图例一致）
const REL_COLORS = {
  '父亲': '#f59e0b', '母亲': '#f59e0b', '子女': '#f59e0b', '兄弟姐妹': '#f59e0b',
  '祖父母': '#f59e0b', '孙辈': '#f59e0b', '亲属': '#f59e0b',
  '配偶': '#ef4444',
  '师生': '#a78bfa', '同学': '#a78bfa',
  '同事': '#34d399', '合作者': '#34d399',
  '朋友': '#4d9fff',
  '竞争对手': '#fb923c',
  // 【本体 v2】人—事件边：金色（与事件节点同色系）
  '参与': '#f5b942', '主持': '#f5b942', '发起': '#f5b942', '组织': '#f5b942',
  '涉及': '#f5b942', '牵连': '#f5b942',
  // 【v4】知识—知识边：绿色系（与主题节点同色系）
  '包含': '#34d399', '前置': '#10b981', '属于': '#059669', '应用': '#2dd4bf', '相关': '#6ee7b7',
};

// 出生年 -> Y 坐标：千年压缩到 ~400 单位；无年份的放中位数层
const YEAR_MIN = 900, YEAR_MAX = 2000, Y_SPAN = 420;
function yearToY(year) {
  if (!year || isNaN(year)) return 0; // 未知年份放中央平面
  const t = (Math.min(Math.max(year, YEAR_MIN), YEAR_MAX) - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  return -t * Y_SPAN + Y_SPAN / 2; // 年份越大（越近代）Y 越小（越靠下）
}
// 【本体 v2】节点定位用的时间：事件用发生年，人物用出生年；主题无时间概念放中央层
function timeOf(n) {
  if (n.entity === 'event') return n.year;
  if (n.entity === 'topic') return null; // 主题不参与时间分层
  return n.birthYear;
}

/* ---------- 家族分组着色（v3.1 新增） ----------
   中国人物网络里"族"最自然的代理是姓氏：同姓大概率同族。
   方案：姓氏哈希到 24 个预设"家族色"（色环双圈采样：同色相两档明度），
   同姓人物节点同色，一眼看出家族聚落；中心节点保留蓝色高亮。
   【实测反馈】11 色时"苏"与"程"碰撞同色，扩到 24 色降低碰撞率。 */
const FAMILY_COLORS = (() => {
  const colors = [];
  for (let i = 0; i < 24; i++) {
    const hue = Math.round((i % 12) * 30);           // 12 个色相档
    const sat = 72, light = i < 12 ? 58 : 42;        // 两圈：亮圈 + 深圈
    colors.push(`hsl(${hue}, ${sat}%, ${light}%)`);
  }
  return colors;
})();

// 姓氏提取：中文取第一个字；非中文（如西文人名）取首字母
function familyKeyOf(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  return /[a-zA-Z]/.test(s[0]) ? s[0].toUpperCase() : s[0];
}

// 姓氏 -> 稳定颜色（按首次出现顺序依次分配调色板颜色）
// 【迭代】哈希取模会异姓碰撞（实测 章/张 同色），改为顺序分配：
// 新姓氏取下一个色，同姓永远同色，24 个姓氏内保证零碰撞
const familyColorIndex = new Map(); // 姓氏 -> 调色板下标
function familyColorOf(name) {
  const k = familyKeyOf(name);
  if (!familyColorIndex.has(k)) {
    familyColorIndex.set(k, familyColorIndex.size % FAMILY_COLORS.length);
  }
  return FAMILY_COLORS[familyColorIndex.get(k)];
}

/* ================= 场景初始化 ================= */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070d, 0.0016); // 深空雾：远处节点渐隐，层次感

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(0, 60, 520);

// 环境光 + 两个彩色点光：科技感冷光
scene.add(new THREE.AmbientLight(0x334, 0.9));
const key = new THREE.PointLight(0x4d9fff, 1.2, 2000); key.position.set(300, 400, 300); scene.add(key);
const fill = new THREE.PointLight(0x7c3aed, 0.7, 2000); fill.position.set(-400, -200, -300); scene.add(fill);

/* ---------- 星尘背景：2000 个远景点，缓慢旋转 ---------- */
{
  const n = 2000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 900 + Math.random() * 1400, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.6;
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0x7aa2e0, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .55 });
  window.__stars = new THREE.Points(g, m);
  scene.add(window.__stars);
}

/* ---------- 时间地层网格：每 100 年一个淡蓝圆环 ---------- */
const strataGroup = new THREE.Group();
scene.add(strataGroup);
function buildStrata() {
  // 清空重建（展开新数据后年份范围可能变化）
  while (strataGroup.children.length) {
    const c = strataGroup.children.pop();
    c.geometry.dispose(); c.material.dispose();
  }
  for (let y = Math.ceil(YEAR_MIN / 100) * 100; y <= YEAR_MAX; y += 100) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(238, 240, 96),
      new THREE.MeshBasicMaterial({ color: 0x4d9fff, transparent: true, opacity: y % 500 === 0 ? .28 : .12, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = yearToY(y);
    strataGroup.add(ring);
    // 百年标签（Sprite，始终面向相机）
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 40;
    const cx = cv.getContext('2d');
    cx.font = '22px Consolas, monospace'; cx.fillStyle = 'rgba(122,162,224,.75)';
    cx.textAlign = 'left'; cx.fillText(String(y) + '年', 6, 28);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .8 }));
    sp.position.set(-255, yearToY(y) + 4, 0);
    sp.scale.set(56, 17, 1);
    strataGroup.add(sp);
  }
}
buildStrata();

/* ================= 图数据模型 ================= */
const nodeMap = new Map();  // key -> {key,name,occupation,birthYear,status, pos:Vector3, vel:Vector3, obj:Mesh}
const linkMap = new Map();  // "src|tgt|type" -> {source,target,type}
const linkObjs = [];        // Line 对象数组（与 linkMap 顺序一致，重建用）
let centerKey = null;

/* ---------- 节点/边的 Three 对象工厂 ---------- */
const sphereGeo = new THREE.SphereGeometry(1, 20, 16); // 单位球，scale 控制大小
const octaGeo = new THREE.OctahedronGeometry(1.3, 0);  // 【本体 v2】事件用八面体（◆）
const boxGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);   // 【v4】知识主题用立方体（📗）

function makeNodeMesh(n) {
  const isCenter = n.key === centerKey;
  const deg = degreeOf(n.key);
  const isEvent = n.entity === 'event';
  const isTopic = n.entity === 'topic';
  const size = isCenter ? 11 : Math.min(4.5 + deg * 1.1, 10);
  // 【v4】主题节点：绿色立方体（知识=绿）；事件金色八面体；人物按家族色球体
  let color;
  if (isTopic) {
    color = 0x34d399; // 翡翠绿：知识主题
  } else if (isEvent) {
    color = 0xf5b942; // 金色：事件的视觉锚点
  } else if (isCenter) {
    color = 0x4d9fff;
  } else {
    const fam = new THREE.Color(familyColorOf(n.name));
    if (n.status === 'mentioned') fam.multiplyScalar(0.62); // 待确认：家族色柔和暗化
    color = fam.getHex();
  }
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color,
    roughness: .35, metalness: isEvent ? .6 : .1,
    transparent: true, opacity: n.status === 'mentioned' ? .85 : 1,
  });
  // 事件八面体 / 主题立方体 / 人物球体
  const geo = isTopic ? boxGeo : isEvent ? octaGeo : sphereGeo;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(size);
  // 【v3.2】记录基准值：hover/聚焦时按比例放大 + 发光增强，退出时还原
  const emi = n.status === 'mentioned' ? .25 : (isCenter ? 1.4 : .8);
  mesh.userData = { key: n.key, baseSize: size, baseEmi: emi }; // Raycaster 拾取后查 key
  scene.add(mesh);
  // 名字标签：距离远时透明（在 render loop 里按距离动态调）
  const label = makeLabel(n.name, isCenter);
  label.position.y = size + 2.2; // 【v3.3】标签贴节点上方
  mesh.add(label);
  n.label = label;
  return mesh;
}

// 名字标签：canvas 绘制文字转 Sprite
// 【v3.2 再调】用户反馈仍太大——字号 20→14（中心 24→17），世界 30x7.5→21x5.2
function makeLabel(text, big) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = (big ? 'bold ' : '') + (big ? 17 : 14) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 8;
  c.fillStyle = big ? '#dceaff' : '#9aa8bd';
  c.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(21, 5.2, 1);
  return sp;
}

// Line2 太重，用 LineSegments 一次画所有边（每帧更新顶点）
const lineGeo = new THREE.BufferGeometry();
const MAX_LINKS = 5000;
lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 6), 3));
lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 6), 3));
const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55 });
const lines = new THREE.LineSegments(lineGeo, lineMat);
scene.add(lines);

function relColor3(type) {
  const c = new THREE.Color(REL_COLORS[type] || '#64748b');
  return [c.r, c.g, c.b];
}

/* ================= 力导向模拟（3D，Y 轴受时间约束） ================= */
// 每帧迭代一次简单 N-body：斥力(O(n^2)，n<600 可接受) + 边引力 + XZ 向心 + Y 回弹到时间层
function simulate() {
  const nodes = [...nodeMap.values()];
  const n = nodes.length;
  // 斥力
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      const dx = a.pos.x - b.pos.x, dy = a.pos.z - b.pos.z, dz = a.pos.y - b.pos.y;
      // XZ 平面斥力为主；Y 只弱斥力（让时间层保持干净）
      const d2 = dx * dx + dy * dy + dz * dz + .01;
      if (d2 > 3600) continue; // 距离>60 斥力忽略（省 CPU）
      const f = 1400 / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f, fz = (dy / d) * f, fy = (dz / d) * f * .25;
      a.vel.x += fx; a.vel.z += fz; a.vel.y += fy;
      b.vel.x -= fx; b.vel.z -= fz; b.vel.y -= fy;
    }
  }
  // 边引力 + Y 时间层回弹 + XZ 向心 + 阻尼
  const targetY = (nd) => yearToY(timeOf(nd));
  for (const nd of nodes) {
    for (const l of linkMap.values()) {
      if (l.source === nd.key || l.target === nd.key) {
        const other = nodeMap.get(l.source === nd.key ? l.target : l.source);
        if (!other) continue;
        const dx = other.pos.x - nd.pos.x, dz = other.pos.z - nd.pos.z, dy = other.pos.y - nd.pos.y;
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy) + .01;
        const f = (d - 62) * .012; // 弹簧：目标边长 62
        nd.vel.x += (dx / d) * f; nd.vel.z += (dz / d) * f; nd.vel.y += (dy / d) * f * .3; // Y 弱引力（层内保持）
      }
    }
    nd.vel.y += (targetY(nd) - nd.pos.y) * .06;   // Y 回弹到出生年层
    nd.vel.x += -nd.pos.x * .0025;                // XZ 轻向心，防飞散
    nd.vel.z += -nd.pos.z * .0025;
    nd.vel.multiplyScalar(.82);                   // 阻尼
  }
  // 应用
  for (const nd of nodes) nd.pos.add(nd.vel);
}

/* ================= 渲染循环 ================= */
let simHot = 40; // 展开后前 N 帧全速模拟，之后降频节能
function animate() {
  requestAnimationFrame(animate);
  if (nodeMap.size && simHot > 0) { simulate(); simHot--; }
  else if (nodeMap.size && simHot === 0 && frame % 10 === 0) simulate(); // 低频维持
  frame++;

  // 节点 mesh 跟随模拟坐标
  for (const nd of nodeMap.values()) {
    if (nd.obj) nd.obj.position.copy(nd.pos);
    // 标签透明度按相机距离：太远的淡出，避免糊成一团
    if (nd.label) {
      const d = camera.position.distanceTo(nd.pos);
      nd.label.material.opacity = Math.max(0, 1 - d / 900);
    }
  }
  // 边顶点刷新
  updateLineBuffer();

  window.__stars.rotation.y += 0.00035; // 星尘缓转
  applyCamera();
  renderer.render(scene, camera);
}
let frame = 0;

function updateLineBuffer() {
  const pos = lineGeo.attributes.position.array;
  const col = lineGeo.attributes.color.array;
  let i = 0;
  for (const l of linkMap.values()) {
    const a = nodeMap.get(l.source), b = nodeMap.get(l.target);
    // 【v3.2】过滤：类型被关闭 / 两端任一节点隐藏 -> 不画
    if (!a || !b || !a.pos || !b.pos || i >= MAX_LINKS) continue;
    if (typeHidden(l.type) || (a.obj && !a.obj.visible) || (b.obj && !b.obj.visible)) continue;
    pos[i * 6] = a.pos.x; pos[i * 6 + 1] = a.pos.y; pos[i * 6 + 2] = a.pos.z;
    pos[i * 6 + 3] = b.pos.x; pos[i * 6 + 4] = b.pos.y; pos[i * 6 + 5] = b.pos.z;
    const [r, g, bl] = relColor3(l.type);
    col[i * 6] = r; col[i * 6 + 1] = g; col[i * 6 + 2] = bl;
    col[i * 6 + 3] = r; col[i * 6 + 4] = g; col[i * 6 + 5] = bl;
    i++;
  }
  lineGeo.setDrawRange(0, i * 2);
  lineGeo.attributes.position.needsUpdate = true;
  lineGeo.attributes.color.needsUpdate = true;
}

/* ================= 过滤引擎（v3.2）：聚焦 / 关系开关 / 时间范围 =================
   三种过滤条件合并计算每个节点的可见性：
   1. 聚焦模式：只显示选中节点 + 直接邻居（其他隐藏）
   2. 时间轴范围：出生年在手柄范围外的隐藏
   3. 关系类型开关：某类型的边全部隐藏后，只挂该类型的节点也隐藏
   边的可见性 = 两端节点都可见 且 类型未被关闭 */
const hiddenRelGroups = new Set();  // 已关闭的关系分组名（如图例里的"亲属"）
let focusKey = null;                // 聚焦模式下的中心节点 key
let hoverKey = null;                // 当前悬停节点 key
let yearLo = YEAR_MIN, yearHi = YEAR_MAX; // 时间轴手柄范围

// 图例分组 -> 实际关系类型（同一行图例控制多种同色关系）
// 【本体 v2】新增“事件”组：人—事件边（参与/主持/发起/组织/涉及/牵连）
// 【v4】新增“知识结构”组：知识—知识边（包含/前置/属于/应用/相关）
const REL_GROUPS = {
  '亲属': ['父亲', '母亲', '子女', '兄弟姐妹', '祖父母', '孙辈', '亲属'],
  '配偶': ['配偶'],
  '师生': ['师生', '同学'],
  '同事': ['同事', '合作者'],
  '朋友': ['朋友'],
  '竞争对手': ['竞争对手'],
  '参与': ['参与', '主持', '发起', '组织', '涉及', '牵连'],
  '包含': ['包含', '前置', '属于', '应用', '相关'],
};
// 类型 -> 分组 反查表
const TYPE_TO_GROUP = {};
for (const [g, types] of Object.entries(REL_GROUPS)) types.forEach(t => TYPE_TO_GROUP[t] = g);

// 某关系类型是否被图例关闭
function typeHidden(type) {
  const g = TYPE_TO_GROUP[type];
  return g ? hiddenRelGroups.has(g) : false;
}

// 直接邻居集合（含自身）
function neighborsOf(key) {
  const s = new Set([key]);
  for (const l of linkMap.values()) {
    if (l.source === key) s.add(l.target);
    else if (l.target === key) s.add(l.source);
  }
  return s;
}

// 统一应用全部过滤器（节点可见性 + 高亮 + 边缓冲重建）
function applyFilters() {
  const focusSet = focusKey ? neighborsOf(focusKey) : null;
  for (const nd of nodeMap.values()) {
    if (!nd.obj) continue;
    let vis = true;
    if (focusSet && !focusSet.has(nd.key)) vis = false;                    // 聚焦：非邻居隐藏
    if (vis && nd.key !== focusKey) {
      const t = timeOf(nd); // 事件用发生年，人物用出生年
      if (t && (t < yearLo || t > yearHi)) vis = false;                     // 时间范围（聚焦点豁免）
    }
    if (vis && hiddenRelGroups.size) {                                     // 关系全关 -> 节点隐藏
      // 【本体 v2】事件节点：挂在"参与"组上（关闭事件参与则事件节点全隐藏）
      // 【v4】主题节点：挂在"包含"组上（关闭知识结构则主题节点全隐藏）
      if (nd.entity === 'event' && typeHidden('参与')) vis = false;
      else if (nd.entity === 'topic' && typeHidden('包含')) vis = false;
      else {
        let hasAny = false, hasVis = false;
        for (const l of linkMap.values()) {
          if (l.source !== nd.key && l.target !== nd.key) continue;
          hasAny = true;
          if (!typeHidden(l.type)) { hasVis = true; break; }
        }
        if (hasAny && !hasVis) vis = false;
      }
    }
    nd.obj.visible = vis;
    // 高亮：聚焦节点放大 1.45x，悬停节点放大 1.28x，其余恢复基准
    const u = nd.obj.userData;
    const hot = nd.key === focusKey ? 1.45 : nd.key === hoverKey ? 1.28 : 1;
    nd.obj.scale.setScalar(u.baseSize * hot);
    nd.obj.material.emissiveIntensity = u.baseEmi * (hot > 1 ? 1.7 : 1);
  }
  updateLineBuffer();
}

// 进入聚焦模式：隐藏无关节点 + 显示顶部提示条
function enterFocus(key) {
  focusKey = key;
  const n = nodeMap.get(key);
  document.getElementById('fbName').textContent = n ? n.name : key;
  document.getElementById('focusBar').style.display = 'flex';
  applyFilters();
}
// 退出聚焦：恢复全部显示
function exitFocus() {
  if (!focusKey) return;
  focusKey = null;
  document.getElementById('focusBar').style.display = 'none';
  applyFilters();
}
document.getElementById('fbExit').onclick = exitFocus;
window.addEventListener('keydown', e => { if (e.key === 'Escape') exitFocus(); });

/* ================= 相机控制（自实现轨道控制） ================= */
// 球坐标环绕目标点：左键旋转 / 右键或 Shift 平移 / 滚轮缩放
const camCtl = {
  target: new THREE.Vector3(0, 0, 0),
  dist: 520, theta: Math.PI / 5, phi: Math.PI / 2.6,
  vTheta: 0, vPhi: 0, vDist: 0, panX: 0, panY: 0,
};
function applyCamera() {
  camCtl.theta += camCtl.vTheta; camCtl.phi += camCtl.vPhi;
  camCtl.dist = Math.min(Math.max(camCtl.dist * (1 + camCtl.vDist), 90), 1800);
  camCtl.vTheta *= .82; camCtl.vPhi *= .82; camCtl.vDist *= .8; // 惯性衰减
  camCtl.phi = Math.min(Math.max(camCtl.phi, .15), Math.PI - .15);
  const sp = Math.sin(camCtl.phi), cp = Math.cos(camCtl.phi);
  camera.position.set(
    camCtl.target.x + camCtl.dist * sp * Math.sin(camCtl.theta),
    camCtl.target.y + camCtl.dist * cp,
    camCtl.target.z + camCtl.dist * sp * Math.cos(camCtl.theta)
  );
  camera.lookAt(camCtl.target);
}

// 指针交互
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragMode = null, lastX = 0, lastY = 0, moved = 0;
const dom = renderer.domElement;
dom.style.touchAction = 'none';

// 【v3.2】悬停拾取：每帧（或 pointermove 时）检测，高亮节点 + 手型光标
function pickNode(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [...nodeMap.values()].map(n => n.obj).filter(m => m && m.visible);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].object.userData.key : null;
}

let hoverRaf = 0;
dom.addEventListener('pointermove', e => {
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  // 拖拽中：旋转 / 平移相机
  if (dragMode === 'rotate') {
    camCtl.vTheta -= dx * .00042; camCtl.vPhi -= dy * .00034;
  } else if (dragMode === 'pan') {
    const k = camCtl.dist / 900;
    // 沿相机右/上向量平移
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    camCtl.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  } else if (!hoverRaf) {
    // 【v3.2】非拖拽时做悬停检测（节流到每帧一次）
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const k = pickNode(e);
      if (k !== hoverKey) {
        hoverKey = k;
        dom.style.cursor = k ? 'pointer' : ''; // 手型光标（超链接感）
        applyFilters(); // 重算高亮
      }
    });
  }
});

dom.addEventListener('pointerdown', e => {
  dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
  lastX = e.clientX; lastY = e.clientY; moved = 0;
  dom.setPointerCapture(e.pointerId);
});
dom.addEventListener('pointerdown', e => {
  dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
  lastX = e.clientX; lastY = e.clientY; moved = 0;
  dom.setPointerCapture(e.pointerId);
});
dom.addEventListener('pointerup', e => {
  if (moved < 6) handleTap(e); // 几乎没移动 = 点击
  dragMode = null;
});
dom.addEventListener('wheel', e => {
  e.preventDefault();
  camCtl.vDist += e.deltaY * .0009;
}, { passive: false });
dom.addEventListener('contextmenu', e => e.preventDefault());

/* ================= 节点拾取：单击聚焦+详情 / 双击展开 ================= */
let clickTimer = null;
function handleTap(e) {
  const key = pickNode(e);
  if (!key) { closeCard(); exitFocus(); return; } // 点空白：关卡 + 退出聚焦
  clearTimeout(clickTimer);
  // 【v3.2】单击 = 聚焦该节点：隐藏无关节点 + 高亮选中与邻居
  clickTimer = setTimeout(() => { enterFocus(key); openCard(key, e.clientX, e.clientY); }, 230);
}
dom.addEventListener('dblclick', e => {
  const key = pickNode(e);
  if (key) {
    clearTimeout(clickTimer);
    expand(key);
  }
});

/* ================= 展开邻域（无限生长） ================= */
function degreeOf(key) {
  let d = 0;
  for (const l of linkMap.values()) if (l.source === key || l.target === key) d++;
  return d;
}

async function expand(key, { makeCenter = true } = {}) {
  showToast('正在展开…');
  try {
    const data = await fetch('/api/graph/' + encodeURIComponent(key)).then(r => r.json());
    if (data.error) { showToast(data.error, true); return; }

    // 锚点：已在画布取其坐标，否则视野中心
    const anchor = nodeMap.get(key);
    const ax = anchor ? anchor.pos.x : camCtl.target.x;
    const ay = anchor ? anchor.pos.y : yearToY(timeOf(data.center));
    const az = anchor ? anchor.pos.z : camCtl.target.z;

    if (!anchor) {
      nodeMap.set(key, {
        key, ...data.center, pos: new THREE.Vector3(ax, ay, az),
        vel: new THREE.Vector3(), obj: null,
      });
    } else if (data.center?.status) {
      anchor.status = data.center.status;
    }

    for (const n of data.nodes) {
      if (nodeMap.has(n.key)) continue;
      const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 50;
      nodeMap.set(n.key, {
        ...n, pos: new THREE.Vector3(ax + Math.cos(a) * r, yearToY(timeOf(n)), az + Math.sin(a) * r),
        vel: new THREE.Vector3(), obj: null,
      });
    }
    for (const l of data.links) {
      const k = [l.source, l.target, l.type].sort().join('|');
      if (!linkMap.has(k)) linkMap.set(k, l);
    }

    if (makeCenter) setCenter(key);
    rebuildMeshes();
    simHot = 60; // 新数据进来，全速模拟铺开
    hideToast(); hideWelcome();
    // 相机对准新中心
    const t = nodeMap.get(key)?.pos;
    if (t) camCtl.target.lerp(t, .9);
  } catch (e) {
    showToast('加载失败：' + e.message, true);
  }
}

// 全量重建 mesh（节点数不大，简单可靠）
function rebuildMeshes() {
  for (const nd of nodeMap.values()) {
    if (nd.obj) { scene.remove(nd.obj); nd.obj = null; }
  }
  for (const nd of nodeMap.values()) nd.obj = makeNodeMesh(nd);
  applyFilters(); // 【v3.2】重建后恢复过滤状态（新节点也遵守聚焦/时间/关系开关）
}

function setCenter(key) {
  centerKey = key;
  const n = nodeMap.get(key);
  document.getElementById('brandSub').textContent = n ? `探索 · ${n.name}` : 'INFINITI · TEMPORAL GRAPH';
}

/* ================= 节点详情卡 ================= */
const ncard = document.getElementById('ncard');
let cardKey = null;

async function openCard(key, px, py) {
  cardKey = key;
  try {
    const d = await fetch('/api/person/' + encodeURIComponent(key)).then(r => r.json());
    if (d.error || cardKey !== key) return;
    const p = d.person;
    const isEvent = String(key).startsWith('evt:');
    const isTopic = String(key).startsWith('topic:');
    // 主题显示学科徽章；事件显示类型徽章；人物显示确认状态
    document.getElementById('ncName').innerHTML =
      esc(p.name) + (isTopic
        ? `<span class="badge crawled">📗 ${esc(p.subject || p.kind || '主题')}</span>`
        : isEvent
        ? `<span class="badge crawled">◆ ${esc(p.category || '事件')}</span>`
        : `<span class="badge ${p.status}">${p.status === 'crawled' ? '已确认' : '待确认'}</span>`);
    const bits = [];
    if (isTopic) {
      if (p.grade) bits.push(p.grade);
      if (p.kind) bits.push({ subject: '学科', unit: '单元', concept: '概念' }[p.kind] || p.kind);
    } else if (isEvent) {
      if (p.year) bits.push(`${p.year}年`);
    } else {
      if (p.birthYear) bits.push(`${p.birthYear}${p.deathYear ? '–' + p.deathYear : '至今'}`);
      if (p.occupation) bits.push(p.occupation);
      if ((p.aliases || []).length) bits.push('别名：' + p.aliases.join('、'));
    }
    document.getElementById('ncMeta').textContent = bits.join(' · ');
    const sum = document.getElementById('ncSum');
    sum.textContent = p.summary || p.description || '暂无摘要（管道尚未处理）';
    sum.className = 'nc-sum' + (p.summary || p.description ? '' : ' empty');
    const src = document.getElementById('ncSrc');
    if (p.anchorUrl) { src.href = p.anchorUrl; src.style.display = ''; } else src.style.display = 'none';
    // 【本体 v2】直接关系列表：人物与事件分开展示，最多 8 条
    const rels = (d.rels || []).slice(0, 8);
    const relEl = document.getElementById('ncRels');
    if (rels.length) {
      relEl.innerHTML = rels.map(x => {
        const color = REL_COLORS[x.type] || '#64748b';
        const tag = x.entity === 'event' ? '◆' : '';
        return `<div class="nc-rel"><span class="nc-rel-t" style="color:${color}">${esc(x.type)}</span><span>${tag}${esc(x.name)}</span></div>`;
      }).join('');
      relEl.style.display = '';
    } else relEl.style.display = 'none';
    // 定位：点击点右侧，越界翻左
    const W = 272, H = 210;
    let left = px + 20; if (left + W > innerWidth - 12) left = Math.max(px - W - 20, 12);
    let top = Math.min(Math.max(py - 40, 12), innerHeight - H - 12);
    ncard.style.left = left + 'px'; ncard.style.top = top + 'px';
    ncard.style.display = 'block';
  } catch { showToast('详情加载失败', true); }
}
function closeCard() { ncard.style.display = 'none'; cardKey = null; }
document.getElementById('ncClose').onclick = closeCard;
document.getElementById('ncExpand').onclick = () => { if (cardKey) expand(cardKey); closeCard(); };

/* ================= 搜索 ================= */
const q = document.getElementById('q'), drop = document.getElementById('drop');
let debounce = null, selIdx = -1;
q.addEventListener('input', () => {
  clearTimeout(debounce);
  const kw = q.value.trim();
  if (!kw) { drop.style.display = 'none'; return; }
  debounce = setTimeout(() => doSearch(kw), 300);
});
q.addEventListener('keydown', e => {
  const items = drop.querySelectorAll('.drop-item');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    selIdx = e.key === 'ArrowDown' ? (selIdx + 1) % items.length : (selIdx - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === selIdx));
  } else if (e.key === 'Enter') {
    if (selIdx >= 0 && items[selIdx]) items[selIdx].click();
    else if (q.value.trim()) doSearch(q.value.trim());
  } else if (e.key === 'Escape') drop.style.display = 'none';
});
document.getElementById('goBtn').onclick = () => q.value.trim() && doSearch(q.value.trim());
document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) drop.style.display = 'none'; });

async function doSearch(kw) {
  drop.innerHTML = '<div class="drop-status">搜索中…</div>';
  drop.style.display = 'block';
  try {
    const list = await fetch('/api/search?q=' + encodeURIComponent(kw)).then(r => r.json());
    selIdx = -1;
    if (!list.length) {
      // 【v4】找不到 = 双按钮：抓取人物资料 OR 构建知识主题
      drop.innerHTML = `<div class="drop-none">图谱中还没有「${esc(kw)}」
        <button class="seed-btn" id="seedBtn">👤 抓取「${esc(kw)}」的人物资料</button>
        <button class="seed-btn" id="topicBtn">📚 自动构建「${esc(kw)}」知识图谱</button></div>`;
      document.getElementById('seedBtn').onclick = () => addSeed(kw);
      document.getElementById('topicBtn').onclick = () => buildTopic(kw);
      return;
    }
    drop.innerHTML = '';
    for (const p of list.slice(0, 8)) {
      const div = document.createElement('div');
      div.className = 'drop-item';
      // 【v4】实体图标：👤 人物 / ◆ 事件 / 📗 主题
      const icon = p.entity === 'topic' ? '📗' : p.entity === 'event' ? '◆' : '👤';
      div.innerHTML = `<div><div class="n">${icon} ${esc(p.name)}</div>
        <div class="o">${esc(p.occupation || p.definition || '暂无描述')}</div></div>
        <div class="d">${p.degree} 连接</div>`;
      div.onclick = () => jumpTo(p.key);
      drop.appendChild(div);
    }
  } catch { drop.innerHTML = '<div class="drop-status">搜索失败，请重试</div>'; }
}

// 【v4】构建知识主题：POST /api/topics -> worker plan 阶段自动拆解
async function buildTopic(name) {
  const btn = document.getElementById('topicBtn');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    const resp = await fetch('/api/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json());
    drop.innerHTML = `<div class="drop-none">${resp.ok
      ? `已开始构建「${esc(name)}」：正在规划课程单元 -> 抓取知识点 -> 构建图谱（约需几分钟，可点右下角队列查看进度）`
      : '提交失败：' + esc(resp.error || '未知错误')}</div>`;
  } catch { drop.innerHTML = '<div class="drop-none">提交失败，请检查网络</div>'; }
}

function jumpTo(key) {
  drop.style.display = 'none';
  if (nodeMap.has(key)) {
    setCenter(key); rebuildMeshes();
    const nd = nodeMap.get(key);
    camCtl.target.lerp(nd.pos, 1); camCtl.dist = Math.min(camCtl.dist, 380);
    openCard(key, innerWidth / 2 + 40, innerHeight / 2);
  } else expand(key);
}

async function addSeed(name) {
  const btn = document.getElementById('seedBtn');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    const resp = await fetch('/api/seed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json());
    drop.innerHTML = `<div class="drop-none">${resp.ok
      ? `已提交「${esc(name)}」，管道抓取分析后即可探索（约 1–2 分钟）`
      : '提交失败：' + esc(resp.error || '未知错误')}</div>`;
  } catch { drop.innerHTML = '<div class="drop-none">提交失败，请检查网络</div>'; }
}

/* ================= 空状态快捷词 ================= */
const SUGGEST = ['苏轼', '李白', '牛顿', '爱因斯坦'];
const chips = document.getElementById('chips');
SUGGEST.forEach(name => {
  const c = document.createElement('div');
  c.className = 'chip'; c.textContent = name;
  c.onclick = async () => {
    hideWelcome();
    const list = await fetch('/api/search?q=' + encodeURIComponent(name)).then(r => r.json()).catch(() => []);
    if (list.length) expand(list[0].key);
    else addSeed(name);
  };
  chips.appendChild(c);
});
function hideWelcome() { document.getElementById('welcome').classList.add('hide'); }

/* ================= HUD：统计轮询 + 队列面板 ================= */
let panelOpen = false;
document.getElementById('statsBar').onclick = togglePanel;
document.getElementById('qpClose').onclick = togglePanel;
function togglePanel() {
  panelOpen = !panelOpen;
  document.getElementById('qpanel').style.display = panelOpen ? 'block' : 'none';
  if (panelOpen) loadTaskList();
}

async function loadStats() {
  try {
    const [s, t] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()),
    ]);
    document.getElementById('stP').textContent = s.persons;
    document.getElementById('stE').textContent = s.events ?? 0;
    document.getElementById('stR').textContent = s.relations;
    document.getElementById('stQ').textContent = t.pending + t.processing;
    if (panelOpen) loadTaskList(); // 面板开着时同步刷新明细
  } catch { /* 静默 */ }
}
loadStats(); setInterval(loadStats, 5000);

// 任务明细列表（processing 置顶 + 失败原因可看 + 行内操作按钮）
async function loadTaskList() {
  const list = await fetch('/api/tasks/list').then(r => r.json()).catch(() => null);
  const el = document.getElementById('qpList');
  if (!list) { el.innerHTML = '<div class="qp-empty">加载失败</div>'; return; }
  if (!list.length) { el.innerHTML = '<div class="qp-empty">队列为空 · 管道空闲中</div>'; return; }
  const stLabel = { pending: '等待', processing: '处理中', failed: '失败' };
  el.innerHTML = list.map(t => `
    <div class="qp-item">
      <div class="qp-row1">
        <span class="qp-name">${esc(t.name)}</span>
        <span class="qp-st ${t.status}">${stLabel[t.status] || t.status}</span>
      </div>
      <div class="qp-row2">
        深度${t.depth ?? '-'} · 优先级${Math.round(t.priority ?? 0)} · 来源：${esc(t.reason || '-')}
        ${t.error ? `<br>错误：${esc(String(t.error).slice(0, 80))}` : ''}
      </div>
      <div class="qp-ops">
        <button data-op="retry" data-name="${esc(t.name)}">重试</button>
        <button data-op="top" data-name="${esc(t.name)}">置顶</button>
        <button class="op-del" data-op="del" data-name="${esc(t.name)}">删除</button>
      </div>
    </div>`).join('');
  // 行内操作：事件委托，一次绑定查表分发
  el.querySelectorAll('button[data-op]').forEach(btn => {
    btn.onclick = async () => {
      const op = btn.dataset.op, name = btn.dataset.name;
      btn.disabled = true;
      try {
        if (op === 'retry') await fetch(`/api/tasks/${encodeURIComponent(name)}/retry`, { method: 'POST' });
        else if (op === 'del') await fetch(`/api/tasks/${encodeURIComponent(name)}`, { method: 'DELETE' });
        else if (op === 'top') await fetch(`/api/tasks/${encodeURIComponent(name)}/priority`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: 2000 }),
        });
        loadTaskList(); loadStats();
      } catch { showToast('操作失败', true); btn.disabled = false; }
    };
  });
}

// 添加任务：输入名字直接入队（高优先级 1000，与种子同待遇）
document.getElementById('qpAdd').onclick = qpAddTask;
document.getElementById('qpInput').addEventListener('keydown', e => { if (e.key === 'Enter') qpAddTask(); });
async function qpAddTask() {
  const input = document.getElementById('qpInput');
  const name = input.value.trim();
  if (!name) return;
  const resp = await fetch('/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, priority: 1000, depth: 0 }),
  }).then(r => r.json()).catch(() => null);
  if (resp?.ok) { showToast(`已添加「${name}」`); input.value = ''; loadTaskList(); loadStats(); }
  else showToast(resp?.error || '添加失败', true);
}

// 工具栏：清空待处理 / 清理失败 / 清理孤立节点
document.querySelectorAll('.qp-tools button').forEach(btn => {
  btn.onclick = async () => {
    const act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === 'clear-pending') {
        const r = await fetch('/api/tasks?status=pending', { method: 'DELETE' }).then(r => r.json());
        showToast(`已清空 ${r.deleted} 个待处理任务`);
      } else if (act === 'clear-failed') {
        const r = await fetch('/api/tasks?status=failed', { method: 'DELETE' }).then(r => r.json());
        showToast(`已清理 ${r.deleted} 个失败任务`);
      } else if (act === 'purge') {
        const r = await fetch('/api/purge', { method: 'POST' }).then(r => r.json());
        showToast(r.purged ? `已清理 ${r.purged} 个孤立节点` : '没有孤立节点');
      }
      loadTaskList(); loadStats();
    } catch { showToast('操作失败', true); }
    btn.disabled = false;
  };
});

/* ================= 缩放控件 ================= */
document.getElementById('zIn').onclick = () => camCtl.vDist -= .18;
document.getElementById('zOut').onclick = () => camCtl.vDist += .18;
document.getElementById('zFit').onclick = () => {
  camCtl.target.set(0, 0, 0); camCtl.dist = 520; camCtl.theta = Math.PI / 5; camCtl.phi = Math.PI / 2.6;
};

/* ================= 图例 ================= */
const lgGrid = document.getElementById('lgGrid');
// 【v3.2】图例行可点击：开关对应关系类型（隐藏/显示相关节点和边）
// 【本体 v2】新增“事件参与”行：控制人—事件边与事件节点
// 【v4】新增“知识结构”行：控制知识—知识边与主题节点
const lgNames = { '父亲': '亲属', '配偶': '配偶', '师生': '师生', '同事': '同事', '朋友': '朋友', '竞争对手': '竞争', '参与': '事件参与', '包含': '知识结构' };
const lgRows = {}; // 分组名 -> DOM 行（切换样式用）
for (const [t, label] of Object.entries(lgNames)) {
  const row = document.createElement('div');
  row.className = 'lg-row lg-toggle';
  row.title = '点击隐藏/显示';
  row.innerHTML = `<span class="dot" style="background:${REL_COLORS[t]};color:${REL_COLORS[t]}"></span>${label}`;
  row.onclick = () => {
    // 注意：hiddenRelGroups 统一存"分组名"（如"亲属"），与 typeHidden 查询一致
    const g = TYPE_TO_GROUP[t] || t;
    if (hiddenRelGroups.has(g)) hiddenRelGroups.delete(g);
    else hiddenRelGroups.add(g);
    row.classList.toggle('off', hiddenRelGroups.has(g));
    applyFilters();
  };
  lgGrid.appendChild(row);
  lgRows[t] = row; // 记录行元素（样式切换用）
}

/* ================= toast ================= */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, isErr = false) {
  toastEl.textContent = msg; toastEl.className = 'toast' + (isErr ? ' err' : ''); toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  if (isErr) toastTimer = setTimeout(() => toastEl.style.display = 'none', 3000);
}
function hideToast() { toastEl.style.display = 'none'; }

/* ================= 时间轴手柄（v3.2）：拖动缩放年代范围 ================= */
const taRail = document.getElementById('taRail'),
      taBand = document.getElementById('taBand'),
      taTop = document.getElementById('taTop'),
      taBot = document.getElementById('taBot'),
      taTopLabel = document.getElementById('taTopLabel'),
      taBotLabel = document.getElementById('taBotLabel'),
      taReset = document.getElementById('taReset');

// 年份 <-> 轨道像素（顶部 = YEAR_MIN，底部 = YEAR_MAX）
function yearToPct(y) {
  return (Math.min(Math.max(y, YEAR_MIN), YEAR_MAX) - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
}
function pctToYear(p) {
  return Math.round(YEAR_MIN + p * (YEAR_MAX - YEAR_MIN));
}

// 根据当前 yearLo/yearHi 刷新手柄位置、高亮区段、标签
function renderTimeAxis() {
  const pLo = yearToPct(yearLo), pHi = yearToPct(yearHi);
  // 手柄语义与 3D Y 轴对齐：上=早年，下=晚年
  taTop.style.top = (pLo * 100) + '%';   // yearLo（早）在上
  taBot.style.top = (pHi * 100) + '%';   // yearHi（晚）在下
  taTopLabel.style.top = (pLo * 100) + '%';
  taBotLabel.style.top = (pHi * 100) + '%';
  taTopLabel.textContent = yearLo + '年';
  taBotLabel.textContent = yearHi + '年';
  taBand.style.top = (pLo * 100) + '%';
  taBand.style.height = ((pHi - pLo) * 100) + '%';
}

// 拖动手柄：把指针 Y 映射到年份，限制不越过另一柄
function bindHandle(el, isTop) {
  el.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.add('drag');
    el.setPointerCapture(ev.pointerId);
    const move = e2 => {
      const rect = taRail.getBoundingClientRect();
      let p = (e2.clientY - rect.top) / rect.height;
      p = Math.min(Math.max(p, 0), 1);
      if (isTop) yearLo = Math.min(pctToYear(p), yearHi - 10); // 上柄不越过下柄
      else yearHi = Math.max(pctToYear(p), yearLo + 10);      // 下柄不越过上柄
      renderTimeAxis();
      applyFilters();
    };
    const up = () => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', el.__mv);
      el.removeEventListener('pointerup', el.__up);
    };
    el.__mv = move; el.__up = up;
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}
bindHandle(taTop, true);
bindHandle(taBot, false);

// 重置时间范围
taReset.onclick = () => {
  yearLo = YEAR_MIN; yearHi = YEAR_MAX;
  renderTimeAxis(); applyFilters();
  showToast('时间范围已重置');
};

renderTimeAxis();

/* ================= 【v4】配置面板 ================= */
const cpanel = document.getElementById('cpanel');
document.getElementById('configBtn').onclick = async () => {
  const show = cpanel.style.display !== 'block';
  cpanel.style.display = show ? 'block' : 'none';
  if (show) await loadConfigPanel();
};
document.getElementById('cpClose').onclick = () => cpanel.style.display = 'none';

// 渲染数据源列表
async function loadConfigPanel() {
  // 1. 数据源库
  const srcs = await fetch('/api/sources').then(r => r.json()).catch(() => []);
  const box = document.getElementById('cpSources');
  if (!srcs.length) { box.innerHTML = '<div class="cp-tip">加载失败</div>'; return; }
  box.innerHTML = srcs.map(s => `
    <div class="cp-src" data-id="${esc(s.id)}">
      <span>${esc(s.name)}</span>
      <span class="pri">${Number(s.priority)}</span>
      <span class="kinds">${(s.for || []).join('/')}</span>
      ${['baike', 'wiki-zh'].includes(s.id)
        ? '<button class="del" disabled title="内置源">内置</button>'
        : '<button class="del" title="删除">✕</button>'}
    </div>`).join('');
  // 删除自定义源
  box.querySelectorAll('.del:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('.cp-src').dataset.id;
      await fetch('/api/sources/' + encodeURIComponent(id), { method: 'DELETE' });
      loadConfigPanel();
      showToast(`已删除数据源 ${id}`);
    };
  });
  // 2. 构建规模（从 /api/settings 读）
  const st = await fetch('/api/settings').then(r => r.json()).catch(() => ({}));
  document.getElementById('cpMax').value = st.maxNodes ?? 500;
  document.getElementById('cpDepth').value = st.maxDepth ?? 6;
  document.getElementById('cpDelay').value = st.requestDelayMs ?? 2000;
  // 3. LLM
  document.getElementById('cpModel').value = st.model ?? '';
}

// 添加数据源
document.getElementById('cpSrcAdd').onclick = async () => {
  const id = document.getElementById('cpSrcId').value.trim();
  const name = document.getElementById('cpSrcName').value.trim();
  const priority = Number(document.getElementById('cpSrcPri').value) || 50;
  if (!id || !name) { showToast('ID 和名称必填', true); return; }
  const resp = await fetch('/api/sources', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, priority, forKinds: ['person', 'knowledge'] }),
  }).then(r => r.json()).catch(() => null);
  if (resp?.ok) {
    showToast(`已添加数据源「${name}」`);
    document.getElementById('cpSrcId').value = '';
    document.getElementById('cpSrcName').value = '';
    loadConfigPanel();
  } else showToast(resp?.error || '添加失败', true);
};

// 保存构建配置
document.getElementById('cpSave').onclick = async () => {
  const body = {
    maxNodes: Number(document.getElementById('cpMax').value),
    maxDepth: Number(document.getElementById('cpDepth').value),
    requestDelayMs: Number(document.getElementById('cpDelay').value),
  };
  const resp = await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => null);
  showToast(resp?.ok ? '构建配置已保存（重启 worker 生效）' : '保存失败', !resp?.ok);
};

// 保存 LLM 配置
document.getElementById('cpSaveLLM').onclick = async () => {
  const body = { model: document.getElementById('cpModel').value.trim() };
  const resp = await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => null);
  showToast(resp?.ok ? 'LLM 配置已保存（重启 worker 生效）' : '保存失败', !resp?.ok);
};

/* ================= 启动 ================= */
// 调试钩子：挂在 window 上供控制台/自动化检查（生产无副作用）
// 【v3.2】补充 setTimeRange（时间轴测试）/ enterFocus / exitFocus（聚焦测试）
function setTimeRange(lo, hi) {
  yearLo = Math.max(YEAR_MIN, Math.min(lo, hi - 10));
  yearHi = Math.min(YEAR_MAX, Math.max(hi, lo + 10));
  renderTimeAxis(); applyFilters();
}
window.__infiniti = { nodeMap, linkMap, expand, camCtl, camera, setTimeRange, enterFocus, exitFocus, applyFilters };

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.getElementById('boot').remove(); // 引擎就绪，撤下加载屏
animate();

// 深链支持：?key=xxx 直接展开（分享探索现场）
const urlKey = new URLSearchParams(location.search).get('key');
if (urlKey) expand(urlKey);
