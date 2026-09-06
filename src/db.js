// Neo4j 驱动单例 + 数据库初始化
// 整个进程（网站 / 管道 worker）共用一个驱动连接池
import neo4j from 'neo4j-driver';
import config from './config.js';

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

// 启动时检查连通性：连不上直接抛错，给出明确提示而不是静默失败
export async function verifyConnection() {
  await driver.verifyConnectivity();
}

// 执行一条 Cypher 语句，返回记录数组
// 每次独立开 session，用完即关，简单且足够（本应用查询量不大）
export async function run(cypher, params = {}) {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

// 建表（幂等，重复执行不报错）：约束保证唯一性，索引加速查询
export async function initSchema() {
  // 人物节点：key 全局唯一（key = 'tmp:' + 名字，见 graphService 的说明）
  await run(`CREATE CONSTRAINT person_key IF NOT EXISTS FOR (p:Person) REQUIRE p.key IS UNIQUE`);
  await run(`CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)`);
  // 【本体 v2】事件节点：key 全局唯一（key = 'evt:' + slug）
  await run(`CREATE CONSTRAINT event_key IF NOT EXISTS FOR (e:Event) REQUIRE e.key IS UNIQUE`);
  await run(`CREATE INDEX event_name IF NOT EXISTS FOR (e:Event) ON (e.name)`);
  // 【v4】知识主题节点：key 全局唯一（key = 'topic:' + 名称路径）
  await run(`CREATE CONSTRAINT topic_key IF NOT EXISTS FOR (t:Topic) REQUIRE t.key IS UNIQUE`);
  await run(`CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name)`);
  // 【v4】数据源注册表：id 唯一
  await run(`CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.id IS UNIQUE`);
  // 任务节点：name 唯一（同一人物不会重复入队），status 索引加速取任务
  await run(`CREATE CONSTRAINT task_name IF NOT EXISTS FOR (t:Task) REQUIRE t.name IS UNIQUE`);
  await run(`CREATE INDEX task_status IF NOT EXISTS FOR (t:Task) ON (t.status)`);
}

export async function close() {
  await driver.close();
}
