// 查询服务：网站页面所需的图查询，与管道写入分离
import { run } from '../db.js';

/**
 * 取焦点实体 ego-network 子图（1 度邻域）。
 * 【v4】支持任意实体：Person / Event / Topic（按 key 前缀或标签自动识别）。
 * 分两步查，比一条巨型 Cypher 简单可靠：
 *   第 1 步：中心实体 + 直接邻居（任意标签）
 *   第 2 步：这个集合内部的所有关系边（含邻居之间的横向关系）
 */
export async function getNeighborhood(personKey, limit = 300) {
  // 第 1 步：节点 = 中心 + 1 度邻居（任意实体）
  const nodeRecords = await run(
    `
    MATCH (center {key: $key})
    WHERE center:Person OR center:Event OR center:Topic
    OPTIONAL MATCH (center)--(n)
    RETURN center, collect(DISTINCT n)[..toInteger($limit)] AS neighbors
    `,
    { key: personKey, limit }
  );
  if (!nodeRecords.length) return null;

  const centerRec = nodeRecords[0].get('center');
  const center = centerRec.properties;
  center.entity = entityOf(centerRec); // 【v4】标注实体类型给前端

  const neighbors = nodeRecords[0].get('neighbors').map((n) => ({
    ...n.properties,
    entity: entityOf(n),
  }));

  const nodeMap = new Map();
  nodeMap.set(center.key, { ...center, isCenter: true });
  for (const n of neighbors) nodeMap.set(n.key, { ...n, isCenter: false });

  // 第 2 步：节点集合内部的所有边
  // elementId(a) < elementId(b) 保证无向边只返回一次（成对的关系边会出现两次）
  const edgeRecords = await run(
    `
    MATCH (a)-[r:RELATES]-(b)
    WHERE a.key IN $keys AND b.key IN $keys AND elementId(a) < elementId(b)
    RETURN a.key AS source, b.key AS target, r.type AS type
    `,
    { keys: [...nodeMap.keys()] }
  );
  const links = edgeRecords.map((r) => ({
    source: r.get('source'),
    target: r.get('target'),
    type: r.get('type'),
  }));

  return { center, nodes: [...nodeMap.values()], links };
}

// Neo4j Node -> 实体类型字符串（前端渲染用）
function entityOf(node) {
  const labels = node.labels || [];
  if (labels.includes('Topic')) return 'topic';
  if (labels.includes('Event')) return 'event';
  return 'person';
}

// 实体详情：基本信息 + 所有直接关系（人物/事件/知识主题通用）
export async function getPersonDetail(personKey) {
  const records = await run(
    `
    MATCH (p {key: $key})
    WHERE p:Person OR p:Event OR p:Topic
    OPTIONAL MATCH (p)-[r:RELATES]-(other)
    RETURN p,
           collect(DISTINCT {person: properties(other), type: r.type}) AS rels
    `,
    { key: personKey }
  );
  if (!records.length) return null;
  const pRec = records[0].get('p');
  const person = pRec.properties;
  const entity = entityOf(pRec); // person / event / topic
  const rels = records[0]
    .get('rels')
    .filter((x) => x.person !== null)
    .map((x) => ({
      name: x.person.name,
      key: x.person.key,
      type: x.type,
      entity: String(x.person.key || '').startsWith('evt:') ? 'event'
        : String(x.person.key || '').startsWith('topic:') ? 'topic' : 'person',
      year: x.person.year ?? null,
      occupation: x.person.occupation || '',
    }));
  return { person, rels, entity };
}

// 搜索：按名字 / 别名模糊匹配，按关系数（热门度）排序【v4】覆盖三类实体
export async function searchPersons(q, limit = 20) {
  const records = await run(
    `
    MATCH (p)
    WHERE (p:Person OR p:Topic OR p:Event)
      AND (p.name CONTAINS $q
       OR ANY(a IN coalesce(p.aliases, []) WHERE a CONTAINS $q))
    OPTIONAL MATCH (p)--(other)
    RETURN p, count(other) AS degree
    ORDER BY degree DESC LIMIT toInteger($limit)
    `,
    { q, limit }
  );
  return records.map((r) => {
    const { name, key, occupation, summary, definition } = r.get('p').properties;
    return {
      name, key,
      occupation: occupation || definition || '',
      summary,
      degree: Number(r.get('degree')),
      entity: entityOf(r.get('p')),
    };
  });
}

// 全库概况：给首页看板（含事件数/主题数）
export async function getStats() {
  const records = await run(
    `
    MATCH (p:Person)
    WITH count(p) AS persons
    OPTIONAL MATCH (a)-[r:RELATES]->()
    WHERE NOT a:Entity
    RETURN persons, count(r) AS relations
    `
  );
  const events = await run(`MATCH (e:Event) RETURN count(e) AS n`);
  const topics = await run(`MATCH (t:Topic) RETURN count(t) AS n`);
  return {
    persons: Number(records[0].get('persons')),
    relations: Number(records[0].get('relations')),
    events: Number(events[0].get('n')),
    topics: Number(topics[0].get('n')),
  };
}
