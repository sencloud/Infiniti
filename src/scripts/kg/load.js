// 把抓取原文 + LLM 抽取结果整理成知识图谱写入 Neo4j（只清空该图谱自己的数据，所有节点带 graph_id）：
//   (:Chapter)  (:Segment)-[:IN_CHAPTER]->(:Chapter)
//   (:Entity)-[:APPEARS_IN {count}]->(:Chapter)            实体类型在 entity_type 属性里（不加 Person/Event 标签，避免与旧版人物库冲突）
//   (:Claim)-[:SUBJECT|OBJECT]->(:Entity)，(:Chapter)-[:SUPPORTS]->(:Claim)
//   (:Entity)-[:RELATES {predicate, claim_ids, support_count, ...}]->(:Entity)  聚合边
//   node src/scripts/kg/load.js <graph>
import crypto from 'node:crypto';
import path from 'node:path';
import { close } from '../../db.js';
import { getGraph } from '../../kg/domains/index.js';
import { exec as run, withGraph } from '../../kg/neo.js';
import { NameMatcher } from '../../kg/matcher.js';
import { loadDecisions } from '../../kg/review.js';
import { graphArg, graphPaths, isMain, readJson } from './paths.js';
import { loadSeeds } from './seeds.js';
import { isGenericName } from './extract.js';

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const SEGMENT_TARGET = { novel: 500, zhiguai: 420, history: 500, analects: 160, textbook: 420 };

// ───────────────────────── 实体归并 ─────────────────────────

// 「林冲娘子 / 林冲妻 / 林冲之妻 / 林冲浑家」是同一个人：归到同一个比对键
function spouseKey(name) {
  const m = /^(.{1,4}?)(?:的|之)?(?:娘子|妻子|浑家|老婆|妻)$/.exec(name);
  return m ? `${m[1]}#妻` : null;
}

class EntityRegistry {
  constructor(graph) {
    this.graph = graph;
    this.entities = new Map();
    this.index = new Map(graph.ontology.ENTITY_TYPES.map((t) => [t.code, new Map()]));
    this.useSpouseKey = graph.kind === 'novel';
  }

  entityId(type, name) {
    return `e_${hash(`${this.graph.id}:${type}:${name}`)}`;
  }

  validAlias(alias) {
    const min = this.graph.kind === 'textbook' ? 1 : 2;
    return alias && alias.length >= min && alias.length <= 20 && !isGenericName(alias, this.graph);
  }

  register(type, alias, id) {
    if (!this.validAlias(alias)) return;
    const idx = this.index.get(type);
    if (!idx.has(alias)) idx.set(alias, id);
    const key = this.useSpouseKey && type === 'Person' && spouseKey(alias);
    if (key && !idx.has(key)) idx.set(key, id);
  }

  create(type, name, extra = {}) {
    const id = this.entityId(type, name);
    if (!this.entities.has(id)) {
      this.entities.set(id, {
        id, type, name, aliases: new Set(), nickname: '', descriptions: [], chapters: new Set(), ...extra,
      });
    }
    this.register(type, name, id);
    return this.entities.get(id);
  }

  find(type, names, chapterNo) {
    const idx = this.index.get(type);
    for (const n of names) {
      const id = idx.get(n) || (this.useSpouseKey && type === 'Person' && idx.get(spouseKey(n)));
      if (id) return this.entities.get(id);
    }
    // 事件名常有详略之别（「拳打镇关西」/「鲁提辖拳打镇关西」），相邻单元内包含关系视为同一事件
    if (type === 'Event' && names[0]?.length >= 3) {
      for (const e of this.entities.values()) {
        if (e.type !== 'Event') continue;
        const last = Math.max(...e.chapters, 0);
        if (Math.abs(last - chapterNo) > 5) continue;
        if (e.name.includes(names[0]) || names[0].includes(e.name)) return e;
      }
    }
    return null;
  }

  upsert({ name, type, aliases = [], nickname = '', description = '' }, chapterNo) {
    const names = [name, ...aliases];
    if (type === 'Person' && nickname) names.push(nickname, `${nickname}${name}`);
    const ent = this.find(type, names, chapterNo) || this.create(type, name);
    for (const a of aliases) if (a !== ent.name && this.validAlias(a)) ent.aliases.add(a);
    if (name !== ent.name && this.validAlias(name)) ent.aliases.add(name);
    if (nickname && !ent.nickname) ent.nickname = nickname;
    if (description && ent.descriptions.length < 6) ent.descriptions.push(description);
    for (const n of names) this.register(type, n, ent.id);
    ent.chapters.add(chapterNo);
    return ent;
  }

  /** 关系端点：优先用同一窗口里抽取到的类型，其次按谓词允许的类型依次查找 */
  resolve(name, allowedTypes, windowTypes, chapterNo) {
    const hinted = windowTypes.get(name) || [];
    const order = [...hinted.filter((t) => allowedTypes.includes(t)), ...allowedTypes];
    for (const type of new Set(order)) {
      const ent = this.find(type, [name], chapterNo);
      if (ent) return ent;
    }
    if (isGenericName(name, this.graph)) return null;
    const type = hinted.find((t) => allowedTypes.includes(t)) || (allowedTypes.length === 1 ? allowedTypes[0] : null);
    return type ? this.upsert({ name, type }, chapterNo) : null;
  }
}

function seedEntities(registry, seeds) {
  for (const h of seeds) {
    if (!h.name) continue;
    const ent = registry.create('Person', h.name, {
      rank: h.rank || null, star: h.star || '', role: h.role || '', nickname: h.nickname || '', is_hero: true,
    });
    for (const a of h.aliases || []) if (a !== h.name) ent.aliases.add(a);
    const names = [...(h.aliases || []), h.nickname];
    if (h.nickname) names.push(`${h.nickname}${h.name}`);
    for (const a of names) registry.register('Person', a, ent.id);
  }
}

// ───────────────────────── 片段切分 ─────────────────────────

/** 切成约 target 字的片段，返回 [{text, para}]，para 是片段起始段落下标（教材用它定位页码） */
function splitSegments(paragraphs, target) {
  const pieces = [];
  paragraphs.forEach((p, para) => {
    if (p.length <= target * 1.6) {
      pieces.push({ text: p, para });
      return;
    }
    let buf = '';
    for (const s of p.split(/(?<=[。！？」”])/)) {
      if (buf.length + s.length > target && buf) {
        pieces.push({ text: buf, para });
        buf = '';
      }
      buf += s;
    }
    if (buf) pieces.push({ text: buf, para });
  });
  const segments = [];
  let buf = [];
  let len = 0;
  for (const p of pieces) {
    buf.push(p);
    len += p.text.length;
    if (len >= target * 0.8) {
      segments.push({ text: buf.map((x) => x.text).join('\n'), para: buf[0].para });
      buf = [];
      len = 0;
    }
  }
  if (buf.length) {
    const text = buf.map((x) => x.text).join('\n');
    if (segments.length && len < target * 0.4) segments[segments.length - 1].text += `\n${text}`;
    else segments.push({ text, para: buf[0].para });
  }
  return segments;
}

// ───────────────────────── 构建 ─────────────────────────

export async function buildGraphData(graphId) {
  const graph = getGraph(graphId);
  const o = graph.ontology;
  const paths = graphPaths(graphId);
  const seeds = await loadSeeds(graphId);
  const chapters = paths.listChapters();
  const registry = new EntityRegistry(graph);
  seedEntities(registry, seeds);

  const claims = new Map();
  let rawRelations = 0;
  let dropped = 0;

  for (const ch of chapters) {
    const ext = readJson(paths.extractFile(ch.no));
    if (!ext) {
      console.warn(`[load:${graphId}] 单元 ${ch.no} 尚未抽取，跳过`);
      continue;
    }
    for (const win of ext.windows) {
      const windowTypes = new Map();
      for (const e of win.entities) {
        if (!o.ENTITY_TYPE_CODES.has(e.type)) continue;
        const ent = registry.upsert(e, ch.no);
        const list = windowTypes.get(e.name) || [];
        list.push(ent.type);
        windowTypes.set(e.name, list);
      }
      for (const r of win.relations) {
        rawRelations++;
        const pred = o.PREDICATE_BY_CODE.get(r.predicate);
        if (!pred) {
          dropped++;
          continue;
        }
        const s = registry.resolve(r.subject, pred.domain, windowTypes, ch.no);
        const ob = registry.resolve(r.object, pred.range, windowTypes, ch.no);
        if (!s || !ob || s.id === ob.id || !pred.domain.includes(s.type) || !pred.range.includes(ob.type)) {
          dropped++;
          continue;
        }
        let [a, b] = [s, ob];
        if (pred.symmetric && a.id > b.id) [a, b] = [b, a];
        a.chapters.add(ch.no);
        b.chapters.add(ch.no);
        const key = `${a.id}|${pred.code}|${b.id}|${ch.no}`;
        const prev = claims.get(key);
        if (!prev) {
          claims.set(key, {
            claim_id: `c_${hash(`${graphId}|${key}`)}`,
            subject_id: a.id,
            object_id: b.id,
            predicate: pred.code,
            confidence: r.confidence,
            evidence_text: r.evidence,
            chapter_no: ch.no,
            mentions: 1,
          });
        } else {
          prev.mentions++;
          if (r.confidence > prev.confidence) {
            prev.confidence = r.confidence;
            prev.evidence_text = r.evidence || prev.evidence_text;
          }
        }
      }
    }
  }

  // 重放人工核对：驳回的事实不入库，确认的标为 human_verified
  const decisions = loadDecisions(graphId);
  let rejected = 0;
  for (const [key, c] of claims) {
    if (decisions[c.claim_id]?.action === 'reject') {
      claims.delete(key);
      rejected++;
    }
  }

  // 只保留参与了关系事实的实体（以及全部种子人物）
  const claimCount = new Map();
  for (const c of claims.values()) {
    claimCount.set(c.subject_id, (claimCount.get(c.subject_id) || 0) + 1);
    claimCount.set(c.object_id, (claimCount.get(c.object_id) || 0) + 1);
  }
  const entities = [...registry.entities.values()].filter((e) => claimCount.has(e.id) || e.is_hero);

  // 原文提及统计：名称 + 别称 + 绰号，单遍最长匹配（教材里单字知识点太容易误配，只按 ≥2 字的名称统计）
  const minLen = graph.kind === 'textbook' ? 2 : 1;
  const matcher = new NameMatcher(
    entities.map((e) => ({
      id: e.id,
      names: [e.name, ...e.aliases, ...(e.type === 'Person' && e.nickname ? [e.nickname] : [])].filter((n) => n.length >= minLen),
    })),
  );
  const target = SEGMENT_TARGET[graph.kind] || 500;
  const appears = [];
  const mentionTotal = new Map();
  const chapterRows = [];
  const segmentRows = [];
  for (const ch of chapters) {
    const text = ch.paragraphs.join('\n');
    chapterRows.push({
      no: ch.no,
      // 「第七回」由单元标签统一给出，标题里只留回目
      title: ch.title.replace(/^第[一二三四五六七八九十百零〇]+回\s*/, ''),
      url: ch.url || '',
      text,
      char_count: text.length,
      label: ch.label || null,
      part: ch.part || null,
      pages: ch.pages ? JSON.stringify(ch.pages) : null,
    });
    const matched = new Set();
    for (const [id, count] of matcher.count(text)) {
      appears.push({ id, no: ch.no, count });
      matched.add(id);
      mentionTotal.set(id, (mentionTotal.get(id) || 0) + count);
      registry.entities.get(id).chapters.add(ch.no);
    }
    // 实体在抽取窗口里出现过、但名称未在原文逐字匹配上（如教材的单字概念），也记一次出场
    for (const e of entities) {
      if (e.chapters.has(ch.no) && !matched.has(e.id)) appears.push({ id: e.id, no: ch.no, count: 1 });
    }
    splitSegments(ch.paragraphs, target).forEach((seg, idx) => {
      segmentRows.push({
        seg_id: `s-${String(ch.no).padStart(3, '0')}-${String(idx + 1).padStart(2, '0')}`,
        chapter_no: ch.no,
        idx: idx + 1,
        text: seg.text,
        char_count: seg.text.length,
        page: ch.para_pages ? ch.para_pages[seg.para] ?? null : null,
      });
    });
  }

  const entityRows = entities.map((e) => {
    const chs = [...e.chapters].sort((x, y) => x - y);
    return {
      entity_id: e.id,
      entity_type: e.type,
      canonical_name: e.name,
      name: e.name,
      normalized_name: e.name,
      aliases: [...e.aliases].slice(0, 12),
      nickname: e.nickname || '',
      star: e.star || '',
      rank: e.rank || null,
      role: e.role || '',
      is_hero: Boolean(e.is_hero),
      description: e.descriptions[0] || '',
      first_chapter: chs[0] ?? null,
      last_chapter: chs[chs.length - 1] ?? null,
      chapter_count: chs.length,
      mention_count: mentionTotal.get(e.id) || 0,
      claim_count: claimCount.get(e.id) || 0,
      status: 'crawled',
    };
  });

  const claimRows = [...claims.values()].map((c) => ({
    ...c,
    status: decisions[c.claim_id]?.action === 'confirm' ? 'human_verified' : 'auto_verified',
    record_id: `ch-${String(c.chapter_no).padStart(3, '0')}`,
  }));

  // 聚合边：同一对实体 + 同一谓词合成一条 RELATES
  const edgeMap = new Map();
  for (const c of claimRows) {
    const key = `${c.subject_id}|${c.predicate}|${c.object_id}`;
    const e = edgeMap.get(key) || {
      source: c.subject_id, target: c.object_id, predicate: c.predicate, type: o.predicateName(c.predicate),
      claim_ids: [], chapters: new Set(), confidence: 0,
    };
    e.claim_ids.push(c.claim_id);
    e.chapters.add(c.chapter_no);
    e.confidence = Math.max(e.confidence, c.confidence);
    edgeMap.set(key, e);
  }
  const edgeRows = [...edgeMap.values()].map((e) => {
    const chs = [...e.chapters].sort((x, y) => x - y);
    return {
      source: e.source, target: e.target, predicate: e.predicate, type: e.type,
      claim_ids: e.claim_ids, support_count: e.claim_ids.length, confidence: e.confidence,
      chapters: chs, first_chapter: chs[0], last_chapter: chs[chs.length - 1],
    };
  });

  return { chapterRows, segmentRows, entityRows, claimRows, edgeRows, appears, stats: { rawRelations, dropped, rejected } };
}

// ───────────────────────── 写库 ─────────────────────────

async function batched(rows, size, fn) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/** 只删当前图谱的节点（分批事务，避免大图一次删除撑爆内存） */
export async function wipeGraph() {
  await run('MATCH (n {graph_id: $g}) CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS');
}

export async function initKgSchema() {
  // 旧版单图谱时代的唯一约束（章回号、片段号全库唯一）在多图谱下不成立
  for (const name of ['kg_chapter_no', 'kg_segment_id']) await run(`DROP CONSTRAINT ${name} IF EXISTS`);
  const stmts = [
    'CREATE CONSTRAINT kg_entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.entity_id IS UNIQUE',
    'CREATE CONSTRAINT kg_claim_id IF NOT EXISTS FOR (c:Claim) REQUIRE c.claim_id IS UNIQUE',
    'CREATE INDEX kg_chapter_graph_no IF NOT EXISTS FOR (c:Chapter) ON (c.graph_id, c.no)',
    'CREATE INDEX kg_segment_graph_id IF NOT EXISTS FOR (s:Segment) ON (s.graph_id, s.seg_id)',
    'CREATE INDEX kg_entity_graph IF NOT EXISTS FOR (e:Entity) ON (e.graph_id)',
    'CREATE INDEX kg_claim_graph IF NOT EXISTS FOR (c:Claim) ON (c.graph_id)',
    'CREATE INDEX kg_entity_name IF NOT EXISTS FOR (e:Entity) ON (e.canonical_name)',
    'CREATE INDEX kg_entity_type IF NOT EXISTS FOR (e:Entity) ON (e.entity_type)',
    'CREATE INDEX kg_claim_chapter IF NOT EXISTS FOR (c:Claim) ON (c.chapter_no)',
    'CREATE INDEX kg_segment_cluster IF NOT EXISTS FOR (s:Segment) ON (s.cluster_id)',
  ];
  for (const s of stmts) await run(s);
}

export async function writeGraph(data) {
  const { chapterRows, segmentRows, entityRows, claimRows, edgeRows, appears } = data;

  await batched(chapterRows, 50, (rows) => run('UNWIND $rows AS r CREATE (c:Chapter) SET c = r, c.graph_id = $g', { rows }));

  await batched(segmentRows, 500, (rows) => run(
    `UNWIND $rows AS r MATCH (c:Chapter {graph_id: $g, no: r.chapter_no})
     CREATE (s:Segment) SET s = r, s.graph_id = $g CREATE (s)-[:IN_CHAPTER]->(c)`,
    { rows },
  ));

  await batched(entityRows, 500, (rows) => run('UNWIND $rows AS r CREATE (e:Entity) SET e = r, e.graph_id = $g', { rows }));

  await batched(appears, 2000, (rows) => run(
    `UNWIND $rows AS r MATCH (e:Entity {entity_id: r.id}), (c:Chapter {graph_id: $g, no: r.no})
     CREATE (e)-[:APPEARS_IN {count: r.count}]->(c)`,
    { rows },
  ));

  await batched(claimRows, 1000, (rows) => run(
    `UNWIND $rows AS r
     MATCH (s:Entity {entity_id: r.subject_id}), (o:Entity {entity_id: r.object_id}), (c:Chapter {graph_id: $g, no: r.chapter_no})
     CREATE (cl:Claim {claim_id: r.claim_id, graph_id: $g, predicate: r.predicate, confidence: r.confidence,
       evidence_text: r.evidence_text, chapter_no: r.chapter_no, status: r.status, record_id: r.record_id,
       mentions: r.mentions})
     CREATE (cl)-[:SUBJECT]->(s) CREATE (cl)-[:OBJECT]->(o) CREATE (c)-[:SUPPORTS]->(cl)`,
    { rows },
  ));

  await batched(edgeRows, 1000, (rows) => run(
    `UNWIND $rows AS r MATCH (s:Entity {entity_id: r.source}), (o:Entity {entity_id: r.target})
     CREATE (s)-[rel:RELATES]->(o)
     SET rel.type = r.type, rel.predicate = r.predicate, rel.claim_ids = r.claim_ids,
         rel.support_count = r.support_count, rel.confidence = r.confidence, rel.chapters = r.chapters,
         rel.first_chapter = r.first_chapter, rel.last_chapter = r.last_chapter`,
    { rows },
  ));
}

/**
 * 把媒体侧表（data/<graph>/media.json，由各图谱的媒体脚本生成）写到实体与单元上：
 *   { entities: {名称: {avatar, gallery:[…]}}, chapters: {序号: {episode…}} }
 */
export async function applyMedia(graphId) {
  const media = readJson(path.join(graphPaths(graphId).DATA_DIR, 'media.json'));
  if (!media) return { entities: 0, chapters: 0 };
  const entityRows = Object.entries(media.entities || {}).map(([name, m]) => ({ name, media: JSON.stringify(m) }));
  const chapterRows = Object.entries(media.chapters || {}).map(([no, m]) => ({ no: Number(no), media: JSON.stringify(m) }));
  await run('MATCH (e:Entity {graph_id: $g}) WHERE e.media IS NOT NULL REMOVE e.media');
  let n = 0;
  await batched(entityRows, 500, async (rows) => {
    const r = await run(
      `UNWIND $rows AS r MATCH (e:Entity {graph_id: $g, canonical_name: r.name})
       SET e.media = r.media RETURN count(e) AS n`,
      { rows },
    );
    n += Number(r[0]?.get('n') || 0);
  });
  await batched(chapterRows, 200, (rows) => run(
    'UNWIND $rows AS r MATCH (c:Chapter {graph_id: $g, no: r.no}) SET c.media = r.media',
    { rows },
  ));
  return { entities: n, chapters: chapterRows.length };
}

export async function loadGraph(graphId) {
  const t0 = Date.now();
  const tag = `[load:${graphId}]`;
  const data = await buildGraphData(graphId);
  const byType = {};
  for (const e of data.entityRows) byType[e.entity_type] = (byType[e.entity_type] || 0) + 1;
  console.log(`${tag} 单元 ${data.chapterRows.length}，片段 ${data.segmentRows.length}，实体 ${data.entityRows.length}`, byType);
  console.log(`${tag} 事实 ${data.claimRows.length}（原始关系 ${data.stats.rawRelations}，类型不符丢弃 ${data.stats.dropped}${data.stats.rejected ? `，核对驳回 ${data.stats.rejected}` : ''}），聚合边 ${data.edgeRows.length}`);
  await withGraph(graphId, async () => {
    console.log(`${tag} 清空该图谱旧数据 …`);
    await wipeGraph();
    await initKgSchema();
    console.log(`${tag} 写入 …`);
    await writeGraph(data);
    const m = await applyMedia(graphId);
    if (m.entities || m.chapters) console.log(`${tag} 媒体：实体 ${m.entities}，单元 ${m.chapters}`);
  });
  console.log(`${tag} 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return data;
}

if (isMain(import.meta.url)) {
  const { id } = graphArg();
  loadGraph(id)
    .catch((e) => {
      console.error(`[load:${id}] 失败:`, e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
