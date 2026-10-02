// 关系探索「找线索」预计算：边强度 → 社区（Louvain）→ 枢纽实体 → 社区画像/桥接 → 线索，结果写回 Neo4j。
// 线索规则由图谱配置决定：小说/史传用 R1–R4，教材用 M1–M4。
import crypto from 'node:crypto';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { chatJson } from './llm.js';
import { unitLabel } from './domains/index.js';
import { currentGraph, ensureUnitLabels, exec as run } from './neo.js';
import { percentileRank, seededRandom } from './mathutil.js';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 12);
const recordOf = (no) => `ch-${String(no).padStart(3, '0')}`;

async function exportGraph() {
  const entities = (await run(
    `MATCH (e:Entity {graph_id: $g}) RETURN e.entity_id AS id, e.canonical_name AS name, e.entity_type AS type,
       e.is_hero AS hero, e.rank AS rank`,
  )).map((r) => ({ id: r.get('id'), name: r.get('name'), type: r.get('type'), hero: r.get('hero'), rank: r.get('rank') }));

  const edges = (await run(
    `MATCH (s:Entity {graph_id: $g})-[r:RELATES]->(o:Entity)
     RETURN s.entity_id AS src, o.entity_id AS dst, r.predicate AS predicate, r.claim_ids AS claim_ids,
            r.chapters AS chapters, r.confidence AS confidence`,
  )).map((r) => ({
    src: r.get('src'), dst: r.get('dst'), predicate: r.get('predicate'), claim_ids: r.get('claim_ids'),
    chapters: r.get('chapters').map(Number), confidence_max: r.get('confidence'),
  }));

  const claims = (await run(
    `MATCH (s:Entity)<-[:SUBJECT]-(c:Claim {graph_id: $g})-[:OBJECT]->(o:Entity)
     WHERE coalesce(c.status, '') <> 'rejected'
     RETURN c.claim_id AS id, c.predicate AS predicate, c.chapter_no AS ch, c.confidence AS conf,
            c.evidence_text AS ev, s.entity_id AS src, o.entity_id AS dst`,
  )).map((r) => ({
    id: r.get('id'), predicate: r.get('predicate'), ch: Number(r.get('ch')), conf: r.get('conf'),
    ev: r.get('ev'), src: r.get('src'), dst: r.get('dst'),
  }));

  const appears = new Map();
  for (const r of await run('MATCH (e:Entity {graph_id: $g})-[a:APPEARS_IN]->(c:Chapter) RETURN e.entity_id AS id, collect(c.no) AS chs')) {
    appears.set(r.get('id'), new Set(r.get('chs').map(Number)));
  }
  return { entities, edges, claims, appears };
}

function computeEdgeMetrics({ edges, claims, appears }) {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  for (const e of edges) {
    const cs = e.claim_ids.map((id) => claimById.get(id)).filter(Boolean);
    const a = appears.get(e.src) || new Set();
    const b = appears.get(e.dst) || new Set();
    let co = 0;
    for (const ch of a) if (b.has(ch)) co++;
    e.claim_count = cs.length;
    e.archive_count = new Set(e.chapters).size;
    e.co_mention = co;
    e.confidence_avg = cs.length ? cs.reduce((s, c) => s + c.conf, 0) / cs.length : e.confidence_max;
    e.first_year = Math.min(...e.chapters);
    e.last_year = Math.max(...e.chapters);
    e.raw = Math.log1p(e.claim_count) + 1.2 * Math.log1p(e.archive_count) + 0.5 * Math.log1p(co) + e.confidence_avg;
    e.edge_key = `${e.src}::${e.predicate}::${e.dst}`;
  }
  const rank = percentileRank(edges.map((e) => e.raw));
  for (const e of edges) e.weight = Number(rank(e.raw).toFixed(4));
}

function detectCommunities({ entities, edges }) {
  const g = new Graph({ type: 'undirected' });
  for (const e of entities) g.addNode(e.id);
  for (const e of edges) {
    if (e.src === e.dst) continue;
    if (g.hasEdge(e.src, e.dst)) g.updateEdgeAttribute(e.src, e.dst, 'weight', (w) => w + e.weight);
    else g.addEdge(e.src, e.dst, { weight: e.weight });
  }
  const assignment = louvain(g, { getEdgeWeight: 'weight', resolution: 1.0, rng: seededRandom(3) });
  return { g, assignment };
}

async function profileCommunities({ entities, claims }, g, assignment, job) {
  const graph = currentGraph();
  const predicateName = graph.ontology.predicateName;
  const label = (no) => unitLabel(graph, no);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const groups = new Map();
  for (const [id, cid] of Object.entries(assignment)) {
    if (!g.degree(id)) continue;
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(id);
  }
  const wdeg = new Map();
  g.forEachNode((id) => {
    let s = 0;
    g.forEachEdge(id, (_, attr) => { s += attr.weight; });
    wdeg.set(id, s);
  });

  const communities = [...groups.entries()]
    .filter(([, ids]) => ids.length >= 3)
    .map(([cid, ids]) => {
      ids.sort((a, b) => wdeg.get(b) - wdeg.get(a));
      const set = new Set(ids);
      const inner = claims.filter((c) => set.has(c.src) && set.has(c.dst));
      const predCount = new Map();
      for (const c of inner) predCount.set(c.predicate, (predCount.get(c.predicate) || 0) + 1);
      const chs = inner.map((c) => c.ch);
      const top = ids.slice(0, 10).map((id) => ({ id, name: byId.get(id).name, type: byId.get(id).type }));
      return {
        raw_id: Number(cid),
        community_key: md5(ids.slice(0, 5).sort().join('|')),
        ids,
        size: ids.length,
        year_from: chs.length ? Math.min(...chs) : 0,
        year_to: chs.length ? Math.max(...chs) : 0,
        rep_entity_id: ids[0],
        rep_name: byId.get(ids[0]).name,
        top_entities: top,
        top_predicates: [...predCount].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([predicate, count]) => ({ predicate, count })),
        samples: inner.sort((a, b) => b.conf - a.conf).slice(0, 8).map((c) => `${byId.get(c.src).name} ${predicateName(c.predicate)} ${byId.get(c.dst).name}：${c.ev}`),
      };
    })
    .sort((a, b) => b.size - a.size);
  communities.forEach((c, i) => { c.community_id = i; });

  const named = communities.slice(0, 40);
  const queue = [...named];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const span = c.year_from ? `，集中在${label(c.year_from)}到${label(c.year_to)}` : '';
        const res = await chatJson({
          system: `你是${graph.prompts.role}，为《${graph.name}》关系网络中的${graph.terms.community}起名，只输出 JSON。`,
          user: `这个${graph.terms.community}有 ${c.size} 个实体${span}。
核心成员：${c.top_entities.map((t) => t.name).join('、')}
主要关系：${c.top_predicates.map((p) => `${predicateName(p.predicate)}×${p.count}`).join('、')}
关系样例：
${c.samples.join('\n')}
给出 name（≤8字，如${graph.prompts.communityExamples}）、summary（≤50字）、keywords（3~6个词）。
输出 {"name":"","summary":"","keywords":[]}`,
          maxTokens: 400,
          temperature: 0.3,
        });
        c.name = String(res.name || '').trim().slice(0, 12);
        c.summary = String(res.summary || '').trim().slice(0, 100);
        c.keywords = (res.keywords || []).map(String).slice(0, 6);
      } catch {
        /* 命名失败用代表实体兜底 */
      }
      done++;
      job.progress = 40 + Math.round((done / named.length) * 30);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const c of communities) {
    c.name = c.name || `${c.rep_name}等${c.size}个`;
    c.summary = c.summary || `以${c.top_entities.slice(0, 3).map((t) => t.name).join('、')}为核心的关系群`;
    c.keywords = c.keywords?.length ? c.keywords : c.top_entities.slice(0, 4).map((t) => t.name);
  }
  return { communities, wdeg };
}

function computeHubs({ entities }, g, memberKey, wdeg) {
  const hubs = [];
  for (const e of entities) {
    if (!g.hasNode(e.id) || !g.degree(e.id)) continue;
    const span = new Set(g.neighbors(e.id).map((nb) => memberKey.get(nb)).filter(Boolean)).size;
    hubs.push({ entity_id: e.id, entity_type: e.type, weighted_degree: wdeg.get(e.id), community_span: span });
  }
  const maxW = Math.max(...hubs.map((h) => h.weighted_degree), 1);
  for (const h of hubs) h.hub_score = Number(((h.weighted_degree / maxW) * (1 + Math.log(1 + h.community_span))).toFixed(4));
  hubs.sort((a, b) => b.hub_score - a.hub_score).forEach((h, i) => { h.rank_no = i + 1; });
  return hubs;
}

function computeBridges(edges, memberKey) {
  const bridges = [];
  for (const e of edges) {
    const a = memberKey.get(e.src);
    const b = memberKey.get(e.dst);
    if (!a || !b || a === b) continue;
    bridges.push({
      src_community_key: a, dst_community_key: b, edge_key: e.edge_key, predicate: e.predicate,
      weight: e.weight, archive_count: e.archive_count, src_entity_id: e.src, dst_entity_id: e.dst,
    });
  }
  return bridges.sort((x, y) => y.weight - x.weight).slice(0, 3000).map((b, i) => ({ id: i + 1, ...b }));
}

/* ---------------- 线索规则 ---------------- */

/** R1 关系反转：同一对实体既有亲近关系又有敌对关系 */
function ruleR1(ctx) {
  const { claims, byId, push, pred, label } = ctx;
  const pairs = new Map();
  for (const c of claims) {
    const tone = pred(c.predicate)?.tone;
    if (!tone) continue;
    const key = [c.src, c.dst].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push({ ...c, tone });
  }
  for (const list of pairs.values()) {
    const pos = list.filter((c) => c.tone === 'positive');
    const neg = list.filter((c) => c.tone === 'hostile');
    if (!pos.length || !neg.length) continue;
    const firstPos = pos.reduce((a, b) => (a.ch <= b.ch ? a : b));
    const firstNeg = neg.reduce((a, b) => (a.ch <= b.ch ? a : b));
    const lastPos = pos.reduce((a, b) => (a.ch >= b.ch ? a : b));
    const lastNeg = neg.reduce((a, b) => (a.ch >= b.ch ? a : b));
    const [x, y] = [byId.get(firstPos.src), byId.get(firstPos.dst)];
    const betrayal = lastNeg.ch > firstPos.ch && lastNeg.ch >= lastPos.ch;
    const later = betrayal ? lastNeg : lastPos;
    push({
      rule_code: 'R1',
      severity: betrayal ? 'high' : 'medium',
      anchor_entity_id: x.id,
      anchor_name: x.name,
      title: betrayal
        ? `${x.name} 与 ${y.name}：先${label.pred(firstPos.predicate)}，后${label.pred(lastNeg.predicate)}`
        : `${x.name} 与 ${y.name}：由敌转友（${label.pred(firstNeg.predicate)} → ${label.pred(lastPos.predicate)}）`,
      detail: {
        positive: pos.map((c) => ({ predicate: c.predicate, chapter: c.ch })),
        hostile: neg.map((c) => ({ predicate: c.predicate, chapter: c.ch })),
        counterpart_id: y.id,
      },
      claim_id: later.id,
      record_id: recordOf(later.ch),
      evidence_text: later.ev,
    });
  }
}

/** R2 死后再现：被杀之后仍作为主语出现在后续单元的事实里 */
function ruleR2(ctx) {
  const { claims, byId, push, label } = ctx;
  const deaths = new Map();
  for (const c of claims) {
    if (c.predicate !== 'KILLED') continue;
    const prev = deaths.get(c.dst);
    if (!prev || c.ch < prev.ch) deaths.set(c.dst, c);
  }
  for (const [id, death] of deaths) {
    const later = claims.filter((c) => c.src === id && c.ch > death.ch + 1 && c.predicate !== 'KIN' && c.predicate !== 'NATIVE_OF');
    if (!later.length) continue;
    const e = byId.get(id);
    const first = later.reduce((a, b) => (a.ch <= b.ch ? a : b));
    push({
      rule_code: 'R2',
      severity: later.length >= 3 ? 'high' : 'medium',
      anchor_entity_id: id,
      anchor_name: e.name,
      title: `${e.name} ${label.unit(death.ch)}被${byId.get(death.src).name}所杀，${label.unit(first.ch)}仍有「${label.pred(first.predicate)}」`,
      detail: {
        death_chapter: death.ch,
        killer: byId.get(death.src).name,
        later_chapters: [...new Set(later.map((c) => c.ch))].sort((a, b) => a - b),
        later_predicate: first.predicate,
        death_claim_id: death.id,
      },
      claim_id: first.id,
      record_id: recordOf(first.ch),
      evidence_text: first.ev,
    });
  }
}

/** R3 出场断档：主要人物（种子名单）两次出场之间隔了很多单元 */
function ruleR3(ctx) {
  const { entities, appears, claims, push, label, graph } = ctx;
  const minGap = graph.gapUnits;
  for (const e of entities) {
    if (!e.hero) continue;
    const chs = [...(appears.get(e.id) || [])].sort((a, b) => a - b);
    let gap = { len: 0 };
    for (let i = 1; i < chs.length; i++) {
      if (chs[i] - chs[i - 1] > gap.len) gap = { len: chs[i] - chs[i - 1], from: chs[i - 1], to: chs[i] };
    }
    if (gap.len < minGap) continue;
    const back = claims.filter((c) => (c.src === e.id || c.dst === e.id) && c.ch === gap.to)[0];
    push({
      rule_code: 'R3',
      severity: gap.len >= minGap * 1.8 ? 'medium' : 'low',
      anchor_entity_id: e.id,
      anchor_name: e.name,
      title: `${e.name} ${label.unit(gap.from)}后隐去，直到${label.unit(gap.to)}才再出场（间隔 ${gap.len - 1} ${graph.unit.name}）`,
      detail: { gap: gap.len - 1, from_chapter: gap.from, to_chapter: gap.to, appearances: chs.length },
      claim_id: back?.id || '',
      record_id: recordOf(gap.to),
      evidence_text: back?.ev || '',
    });
  }
}

/** R4 单值冲突：籍贯等单值谓词出现多个取值 */
function ruleR4(ctx) {
  const { claims, byId, push, graph } = ctx;
  for (const pred of graph.ontology.PREDICATES.filter((p) => p.functional)) {
    const bySubject = new Map();
    for (const c of claims) {
      if (c.predicate !== pred.code) continue;
      if (!bySubject.has(c.src)) bySubject.set(c.src, []);
      bySubject.get(c.src).push(c);
    }
    for (const [id, list] of bySubject) {
      const values = [...new Set(list.map((c) => c.dst))];
      if (values.length < 2) continue;
      const names = values.map((v) => byId.get(v).name);
      // 「郓城县」与「济州郓城县」这类包含关系不算冲突
      const maximal = names.filter((n) => !names.some((m) => m !== n && m.includes(n)));
      if (maximal.length < 2) continue;
      const e = byId.get(id);
      const c = list[list.length - 1];
      push({
        rule_code: 'R4',
        severity: 'medium',
        anchor_entity_id: id,
        anchor_name: e.name,
        title: `${e.name} 的${pred.name}有 ${names.length} 种说法：${names.join(' / ')}`,
        detail: { predicate: pred.code, values: list.map((x) => ({ value: byId.get(x.dst).name, chapter: x.ch, claim_id: x.id })) },
        claim_id: c.id,
        record_id: recordOf(c.ch),
        evidence_text: c.ev,
      });
    }
  }
}

/** 教材知识点首次出现的节次 */
function firstSeen(appears, id) {
  const s = appears.get(id);
  return s && s.size ? Math.min(...s) : null;
}

/** M1 前置倒挂：A 是 B 的前置，但 A 首次出现晚于 B */
function ruleM1(ctx) {
  const { claims, byId, appears, push, label } = ctx;
  const seen = new Set();
  for (const c of claims) {
    if (c.predicate !== 'PREREQUISITE') continue;
    const key = `${c.src}|${c.dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fa = firstSeen(appears, c.src);
    const fb = firstSeen(appears, c.dst);
    if (fa === null || fb === null || fa <= fb) continue;
    const [a, b] = [byId.get(c.src), byId.get(c.dst)];
    push({
      rule_code: 'M1',
      severity: fa - fb >= 10 ? 'high' : 'medium',
      anchor_entity_id: b.id,
      anchor_name: b.name,
      title: `「${b.name}」以「${a.name}」为前置，但「${a.name}」到${label.unit(fa)}才首次出现（「${b.name}」在${label.unit(fb)}）`,
      detail: { prerequisite: a.name, prerequisite_first: fa, target_first: fb, counterpart_id: a.id },
      claim_id: c.id,
      record_id: recordOf(c.ch),
      evidence_text: c.ev,
    });
  }
}

/** M2 循环依赖：前置关系里的强连通分量（Tarjan） */
function ruleM2(ctx) {
  const { claims, byId, push } = ctx;
  const adj = new Map();
  const claimOf = new Map();
  for (const c of claims) {
    if (c.predicate !== 'PREREQUISITE' || c.src === c.dst) continue;
    if (!adj.has(c.src)) adj.set(c.src, new Set());
    adj.get(c.src).add(c.dst);
    claimOf.set(`${c.src}|${c.dst}`, c);
  }
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp);
    }
  };
  for (const v of adj.keys()) if (!idx.has(v)) strong(v);
  for (const comp of sccs) {
    const set = new Set(comp);
    const inner = [...claimOf.values()].filter((c) => set.has(c.src) && set.has(c.dst));
    const names = comp.map((id) => byId.get(id).name);
    const c = inner[0];
    push({
      rule_code: 'M2',
      severity: comp.length >= 3 ? 'high' : 'medium',
      anchor_entity_id: comp[0],
      anchor_name: names[0],
      title: `前置关系成环：${names.join(' ⇄ ')}`,
      detail: { members: names, claims: inner.map((x) => x.id) },
      claim_id: c?.id || '',
      record_id: c ? recordOf(c.ch) : '',
      evidence_text: c?.ev || '',
    });
  }
}

/** M3 孤立知识点：只在一节出现、且没有任何结构性关联 */
function ruleM3(ctx) {
  const { entities, appears, edges, push, label } = ctx;
  const structural = new Set(['PREREQUISITE', 'DERIVES', 'INCLUDES', 'SPECIAL_CASE', 'PROPERTY_OF']);
  const linked = new Set();
  for (const e of edges) {
    if (!structural.has(e.predicate)) continue;
    linked.add(e.src);
    linked.add(e.dst);
  }
  const lonely = entities
    .filter((e) => (appears.get(e.id)?.size || 0) === 1 && !linked.has(e.id))
    .slice(0, 120);
  for (const e of lonely) {
    const no = firstSeen(appears, e.id);
    push({
      rule_code: 'M3',
      severity: 'low',
      anchor_entity_id: e.id,
      anchor_name: e.name,
      title: `「${e.name}」只在${label.unit(no)}出现，没有前置或后续知识点与之相连`,
      detail: { chapter: no },
      claim_id: '',
      record_id: recordOf(no),
      evidence_text: '',
    });
  }
}

/** M4 跨册长跳：前置知识与使用它的知识点首次出现相隔很远 */
function ruleM4(ctx) {
  const { claims, byId, appears, push, label, graph } = ctx;
  const seen = new Set();
  for (const c of claims) {
    if (c.predicate !== 'PREREQUISITE') continue;
    const key = `${c.src}|${c.dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fa = firstSeen(appears, c.src);
    const fb = firstSeen(appears, c.dst);
    if (fa === null || fb === null || fb - fa < graph.gapUnits) continue;
    const [a, b] = [byId.get(c.src), byId.get(c.dst)];
    push({
      rule_code: 'M4',
      severity: fb - fa >= graph.gapUnits * 2 ? 'medium' : 'low',
      anchor_entity_id: a.id,
      anchor_name: a.name,
      title: `「${a.name}」在${label.unit(fa)}学过，直到${label.unit(fb)}的「${b.name}」才再用到`,
      detail: { prerequisite_first: fa, target_first: fb, counterpart_id: b.id, counterpart_name: b.name },
      claim_id: c.id,
      record_id: recordOf(c.ch),
      evidence_text: c.ev,
    });
  }
}

/** G1 意外连接：一个群体里很边缘的成员，直接连到另一个群体的核心，读的时候容易一笔带过 */
function ruleG1(ctx) {
  const { edges, claims, byId, push, pred, memberKey, hubs, communities, graph } = ctx;
  if (!memberKey || !hubs?.length) return;
  // 事件、地点天然只连着少数人，算不上「意外」；只看人物（教材看知识点）之间。
  // 阵前交手、斩将也排除：主将杀了一个无名敌将是战事常态，不是值得细读的牵连
  const primary = new Set(graph.galaxy.primaryTypes);
  const BATTLE = new Set(['FOUGHT', 'DEFEATED', 'KILLED']);
  const rank = new Map(hubs.filter((h) => primary.has(h.entity_type)).map((h, i) => [h.entity_id, i + 1]));
  const coreCut = Math.max(20, Math.round(rank.size * 0.03));
  const isPrimary = (id) => primary.has(byId.get(id)?.type);
  const neighbors = new Map();
  for (const e of edges) {
    if (e.src === e.dst || !isPrimary(e.src) || !isPrimary(e.dst)) continue;
    for (const [a, b] of [[e.src, e.dst], [e.dst, e.src]]) {
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      neighbors.get(a).add(b);
    }
  }
  const commName = new Map(communities.map((c) => [c.community_key, c.name]));
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const found = [];
  for (const e of edges) {
    const ka = memberKey.get(e.src);
    const kb = memberKey.get(e.dst);
    if (!ka || !kb || ka === kb) continue;
    if (!isPrimary(e.src) || !isPrimary(e.dst) || BATTLE.has(e.predicate)) continue;
    const [core, peri] = (rank.get(e.src) || Infinity) <= (rank.get(e.dst) || Infinity) ? [e.src, e.dst] : [e.dst, e.src];
    const coreRank = rank.get(core) || Infinity;
    const periDegree = neighbors.get(peri)?.size || 0;
    if (coreRank > coreCut || periDegree > 3 || (rank.get(peri) || Infinity) <= coreCut) continue;
    const evidence = e.claim_ids.map((id) => claimById.get(id)).filter(Boolean).sort((x, y) => y.conf - x.conf)[0];
    if (!evidence) continue;
    found.push({ e, core, peri, coreRank, periDegree, evidence, score: 1 / coreRank / periDegree });
  }
  found.sort((x, y) => y.score - x.score);
  const perPeri = new Set();
  const perCore = new Map();
  for (const f of found) {
    if (perPeri.has(f.peri) || (perCore.get(f.core) || 0) >= 3) continue;
    perPeri.add(f.peri);
    perCore.set(f.core, (perCore.get(f.core) || 0) + 1);
    const [p, c] = [byId.get(f.peri), byId.get(f.core)];
    const periComm = commName.get(memberKey.get(f.peri)) || '';
    const coreComm = commName.get(memberKey.get(f.core)) || '';
    const relation = `${byId.get(f.e.src).name} ${pred(f.e.predicate)?.name || f.e.predicate} ${byId.get(f.e.dst).name}`;
    push({
      rule_code: 'G1',
      severity: f.coreRank <= 10 ? 'medium' : 'low',
      anchor_entity_id: f.peri,
      anchor_name: p.name,
      title: `不起眼的「${p.name}」${periComm ? `（${periComm}）` : ''}直接连到${coreComm ? `「${coreComm}」的` : ''}核心「${c.name}」：${relation}`,
      detail: {
        peripheral: p.name, peripheral_degree: f.periDegree, peripheral_community: periComm,
        core: c.name, core_id: f.core, core_rank: f.coreRank, core_community: coreComm,
        predicate: f.e.predicate, src: byId.get(f.e.src).name, dst: byId.get(f.e.dst).name, counterpart_id: f.core,
      },
      claim_id: f.evidence.id,
      record_id: recordOf(f.evidence.ch),
      evidence_text: f.evidence.ev,
    });
    if (perPeri.size >= 30) break;
  }
}

const RULES = { R1: ruleR1, R2: ruleR2, R3: ruleR3, R4: ruleR4, M1: ruleM1, M2: ruleM2, M3: ruleM3, M4: ruleM4, G1: ruleG1 };

function detectAnomalies(data) {
  const graph = currentGraph();
  const byId = new Map(data.entities.map((e) => [e.id, e]));
  const out = [];
  const label = {
    unit: (no) => unitLabel(graph, no),
    pred: graph.ontology.predicateName,
  };
  const push = (a) => out.push({
    anomaly_id: md5(`${graph.id}|${a.rule_code}|${a.anchor_entity_id}|${a.claim_id}|${a.title}`),
    detected_at: new Date().toISOString(),
    ...a,
    archive_number: a.record_id ? label.unit(Number(a.record_id.slice(3))) : '',
    detail: JSON.stringify(a.detail || {}),
  });
  const ctx = { ...data, byId, push, label, graph, pred: (code) => graph.ontology.PREDICATE_BY_CODE.get(code) };
  for (const code of Object.keys(graph.rules)) RULES[code]?.(ctx);
  return out;
}

export async function buildAnalysis(job) {
  const step = (stage, progress) => {
    if (job.cancelled) throw new Error('任务已取消');
    job.stage = stage;
    job.progress = progress;
  };
  step('export', 5);
  await ensureUnitLabels();
  const data = await exportGraph();
  if (!data.edges.length) throw new Error('没有关系事实，请先入库');

  step('edges', 15);
  computeEdgeMetrics(data);
  for (let i = 0; i < data.edges.length; i += 1000) {
    await run(
      `UNWIND $rows AS r MATCH (s:Entity {entity_id: r.src})-[rel:RELATES {predicate: r.predicate}]->(o:Entity {entity_id: r.dst})
       SET rel.weight = r.weight, rel.claim_count = r.claim_count, rel.archive_count = r.archive_count,
           rel.co_mention = r.co_mention, rel.confidence_avg = r.confidence_avg, rel.edge_key = r.edge_key`,
      { rows: data.edges.slice(i, i + 1000).map(({ raw, claim_ids, chapters, ...e }) => e) },
    );
  }

  step('communities', 30);
  const { g, assignment } = detectCommunities(data);
  const { communities, wdeg } = await profileCommunities(data, g, assignment, job);
  const memberKey = new Map();
  for (const c of communities) for (const id of c.ids) memberKey.set(id, c.community_key);

  step('hubs', 72);
  const hubs = computeHubs(data, g, memberKey, wdeg);
  const communityIdByKey = new Map(communities.map((c) => [c.community_key, c.community_id]));

  step('persist', 80);
  await run('MATCH (n {graph_id: $g}) WHERE n:Community OR n:CommunityBridge OR n:Anomaly DETACH DELETE n');
  await run('MATCH (e:Entity {graph_id: $g}) REMOVE e.community_key, e.community_id, e.hub_score, e.hub_rank, e.weighted_degree, e.community_span');
  const hubRows = hubs.map((h) => ({
    ...h, community_key: memberKey.get(h.entity_id) || null, community_id: communityIdByKey.get(memberKey.get(h.entity_id)) ?? -1,
  }));
  for (let i = 0; i < hubRows.length; i += 1000) {
    await run(
      `UNWIND $rows AS r MATCH (e:Entity {entity_id: r.entity_id})
       SET e.community_key = r.community_key, e.community_id = r.community_id, e.hub_score = r.hub_score,
           e.hub_rank = r.rank_no, e.weighted_degree = r.weighted_degree, e.community_span = r.community_span`,
      { rows: hubRows.slice(i, i + 1000) },
    );
  }
  if (communities.length) {
    await run('UNWIND $rows AS r CREATE (c:Community) SET c = r, c.graph_id = $g', {
      rows: communities.map(({ ids, samples, raw_id, top_entities, top_predicates, ...c }) => ({
        ...c, member_ids: ids, top_entities: JSON.stringify(top_entities), top_predicates: JSON.stringify(top_predicates),
      })),
    });
  }

  step('timeline', 88);
  const bridges = computeBridges(data.edges, memberKey);
  for (let i = 0; i < bridges.length; i += 1000) {
    await run('UNWIND $rows AS r CREATE (b:CommunityBridge) SET b = r, b.graph_id = $g', { rows: bridges.slice(i, i + 1000) });
  }

  step('anomalies', 93);
  const anomalies = detectAnomalies({ ...data, memberKey, hubs, communities });
  for (let i = 0; i < anomalies.length; i += 1000) {
    await run('UNWIND $rows AS r CREATE (a:Anomaly) SET a = r, a.graph_id = $g', { rows: anomalies.slice(i, i + 1000) });
  }

  Object.assign(job, {
    edges: data.edges.length,
    hubs: hubs.length,
    communities: communities.length,
    timeline_rows: data.claims.length,
    anomalies: anomalies.length,
  });
  return job;
}
