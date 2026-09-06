// 图数据服务：所有对 Person / Relation / Task 的读写都封装在这里
// 上层（网站 API、数据管道）只调用本模块的函数，不直接写 Cypher
import { run } from '../db.js';
import neo4j from 'neo4j-driver';

// ---------- 人物（Person） ----------

/**
 * 创建或更新人物节点
 * key 是全局唯一标识。页面已爬到的人物用 'baike:' + 百科词条 ID；
 * 仅被提及、还没爬到的人物用 'tmp:' + 名字（待消歧的临时节点）。
 * MERGE 按 key 幂等：已存在则更新资料，不存在则新建。
 */
export async function upsertPerson(p) {
  const result = await run(
    `
    MERGE (person:Person {key: $key})
    SET person.name        = $name,
        person.aliases     = $aliases,
        person.gender      = $gender,
        person.birthYear   = $birthYear,
        person.deathYear   = $deathYear,
        person.occupation  = $occupation,
        person.summary     = $summary,
        person.anchorUrl   = $anchorUrl,
        person.status      = $status,
        person.updatedAt   = datetime()
    RETURN person
    `,
    {
      key: p.key,
      name: p.name,
      aliases: p.aliases || [],
      gender: p.gender || '',
      birthYear: p.birthYear ?? null,
      deathYear: p.deathYear ?? null,
      occupation: p.occupation || '',
      summary: p.summary || '',
      anchorUrl: p.anchorUrl || '',
      status: p.status || 'crawled',
    }
  );
  return result[0].get('person');
}

// 按名字查找人物（消歧 / 详情页跳转用）
export async function findPersonsByName(name) {
  const records = await run(`MATCH (p:Person) WHERE p.name = $name OR $name IN p.aliases RETURN p`, { name });
  return records.map((r) => r.get('p').properties);
}

// 统计当前收录人数（判断是否达到规模上限）
export async function countPersons() {
  const records = await run(`MATCH (p:Person) RETURN count(p) AS total`);
  return Number(records[0].get('total'));
}

/**
 * 创建关系边（幂等）
 * 【本体 v2】节点端点不再限定 Person：Person—Person、Person—Event 边都走这里。
 * 无向语义的关系（夫妻/朋友/合作）用 MERGE 一次即可；
 * 有向语义（父子/师生）按 from -> to 存储，由抽取时的方向决定。
 */
export async function upsertRelation(fromKey, toKey, type, extra = {}) {
  await run(
    `
    MATCH (a {key: $fromKey}), (b {key: $toKey})
    MERGE (a)-[r:RELATES {type: $type}]->(b)
    SET r.description = $description,
        r.confidence  = $confidence,
        r.sourceUrl   = $sourceUrl
    `,
    {
      fromKey,
      toKey,
      type,
      description: extra.description || '',
      confidence: extra.confidence ?? 0.8,
      sourceUrl: extra.sourceUrl || '',
    }
  );
}

// ---------- 任务（Task，管道队列） ----------

// 新建爬取任务（已存在同名任务则只刷新优先级，不重复入队）
// 【v4】options.kind：'person'（默认，旧流程）| 'knowledge'（知识构建）
// 【v4】options.phase：knowledge 任务的阶段（plan/unit/concept）
// 【v4】options.meta：附加数据（单元的概念清单等），对象或 JSON 字符串
export async function enqueueTask(name, { priority = 100, depth = 0, reason = '', kind = 'person', phase = '', meta = null } = {}) {
  await run(
    `
    MERGE (t:Task {name: $name})
    ON CREATE SET t.status = 'pending', t.attempts = 0
    SET t.priority = CASE WHEN t.status = 'pending' THEN $priority ELSE t.priority END,
        t.depth    = CASE WHEN t.status = 'pending' THEN $depth ELSE t.depth END,
        t.reason   = CASE WHEN t.status = 'pending' THEN $reason ELSE t.reason END,
        t.kind     = CASE WHEN t.status = 'pending' THEN $kind ELSE t.kind END,
        t.phase    = CASE WHEN t.status = 'pending' THEN $phase ELSE t.phase END,
        t.meta     = CASE WHEN t.status = 'pending' THEN $meta ELSE t.meta END
    `,
    { name, priority, depth, reason, kind, phase, meta: meta ? JSON.stringify(meta) : null }
  );
}

// 取出一条优先级最高的待处理任务，并原子地标记为 processing（防并发重复处理）
export async function claimNextTask() {
  const records = await run(
    `
    MATCH (t:Task {status: 'pending'})
    WITH t ORDER BY t.priority DESC, t.priorityId ASC LIMIT 1
    SET t.status = 'processing'
    RETURN t
    `
  );
  return records.length ? records[0].get('t').properties : null;
}

// 标记任务完成
export async function completeTask(name) {
  await run(`MATCH (t:Task {name: $name}) SET t.status = 'done'`, { name });
}

// 标记任务失败；尝试次数用尽则标记 failed，否则退回 pending 等待重试
export async function failTask(name, error) {
  await run(
    `
    MATCH (t:Task {name: $name})
    SET t.attempts = t.attempts + 1,
        t.error = $error,
        t.status = CASE WHEN t.attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END
    `,
    { name, error: String(error).slice(0, 500) }
  );
}

// 统计各状态任务数量（给首页看板用）
export async function taskStats() {
  const records = await run(`MATCH (t:Task) RETURN t.status AS status, count(t) AS n`);
  const stats = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of records) stats[r.get('status')] = Number(r.get('n'));
  return stats;
}

// 任务明细列表（给队列状态面板用）：processing 优先展示，其余按优先级排序
export async function taskList(limit = 30) {
  const records = await run(
    `
    MATCH (t:Task)
    WHERE t.status IN ['pending', 'processing', 'failed']
    WITH t ORDER BY t.status = 'processing' DESC, t.priority DESC, t.priorityId ASC LIMIT $limit
    RETURN t.name AS name, t.status AS status, t.priority AS priority,
           t.depth AS depth, t.reason AS reason, t.error AS error, t.attempts AS attempts,
           t.kind AS kind, t.phase AS phase
    `,
    { limit: neo4j.int(limit) } // LIMIT 必须是整数：JS number 会被序列化成 float 而报错
  );
  return records.map((r) => ({
    name: r.get('name'),
    status: r.get('status'),
    priority: r.get('priority') === null ? null : Number(r.get('priority')),
    depth: r.get('depth') === null ? null : Number(r.get('depth')),
    reason: r.get('reason'),
    error: r.get('error'),
    attempts: r.get('attempts') === null ? 0 : Number(r.get('attempts')),
    kind: r.get('kind') || 'person',
    phase: r.get('phase') || '',
  }));
}

/* ============ 【本体 v2】事件（Event） ============ */

/**
 * 创建或更新事件节点（幂等）
 * key = 'evt:' + 事件名（如 'evt:乌台诗案'）。
 */
export async function upsertEvent(e) {
  const result = await run(
    `
    MERGE (event:Event {key: $key})
    SET event.name = $name,
        event.year = $year,
        event.category = $category,
        event.description = $description,
        event.updatedAt = datetime()
    RETURN event
    `,
    {
      key: e.key,
      name: e.name,
      year: e.year ?? null,
      category: e.category || '其他',
      description: e.description || '',
    }
  );
  return result[0].get('event');
}

// 事件总数（统计用）
export async function countEvents() {
  const records = await run(`MATCH (e:Event) RETURN count(e) AS total`);
  return Number(records[0].get('total'));
}

/* ============ 【v4】知识主题（Topic） ============ */

/**
 * 创建或更新知识主题节点（幂等）
 * key = 'topic:' + 名称（可带路径，如 'topic:小学数学3年级/分数'）。
 */
export async function upsertTopic(t) {
  const result = await run(
    `
    MERGE (topic:Topic {key: $key})
    SET topic.name = $name,
        topic.kind = $kind,
        topic.subject = $subject,
        topic.grade = $grade,
        topic.definition = $definition,
        topic.anchorUrl = $anchorUrl,
        topic.source = $source,
        topic.updatedAt = datetime()
    RETURN topic
    `,
    {
      key: t.key,
      name: t.name,
      kind: t.kind || 'concept',
      subject: t.subject || '通用',
      grade: t.grade || '',
      definition: t.definition || '',
      anchorUrl: t.anchorUrl || '',
      source: t.source || '',
    }
  );
  return result[0].get('topic');
}

// 主题总数（统计用）
export async function countTopics() {
  const records = await run(`MATCH (t:Topic) RETURN count(t) AS total`);
  return Number(records[0].get('total'));
}

/* ============ 【队列管理 v2】任务增删改查 ============ */

// 删除任务（取消排队/清理已完成）
export async function deleteTask(name) {
  await run(`MATCH (t:Task {name: $name}) DELETE t`, { name });
}

// 批量删除某状态的全部任务（清空队列/清理失败任务用）
export async function deleteTasksByStatus(status) {
  const records = await run(
    `MATCH (t:Task {status: $status}) DELETE t RETURN count(t) AS n`,
    { status }
  );
  return Number(records[0]?.get('n') ?? 0);
}

// 重试任务：failed -> pending，重置尝试次数并提升优先级（插队）
export async function retryTask(name) {
  await run(
    `
    MATCH (t:Task {name: $name})
    SET t.status = 'pending', t.attempts = 0, t.error = null,
        t.priority = CASE WHEN t.priority >= 1000 THEN t.priority ELSE t.priority + 200 END
    `,
    { name }
  );
}

// 调整优先级（插队/降级用）
export async function setTaskPriority(name, priority) {
  await run(
    `MATCH (t:Task {name: $name}) SET t.priority = $priority`,
    { name, priority: Number(priority) || 100 }
  );
}

// 清理无效节点：删除所有"仅被提及"且没有任何关系的孤立 Person
export async function purgeOrphanMentioned() {
  const records = await run(
    `
    MATCH (p:Person {status: 'mentioned'})
    WHERE NOT (p)--()
    DELETE p
    RETURN count(p) AS n
    `,
    {}
  );
  return Number(records[0]?.get('n') ?? 0);
}
