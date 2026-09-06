// 数据库就绪等待脚本：从宿主机侧尝试真实 Bolt 连接
// 用途：start.bat 在启动网站/worker 前调用，确保 7687 端口映射真正可用
// （docker exec cypher-shell 在容器内执行，验证不了宿主机端口映射，这里补上）
import neo4j from 'neo4j-driver';
import config from '../config.js';

const TIMEOUT_MS = 60_000; // 最多等 1 分钟
const RETRY_MS = 2000;

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

const start = Date.now();
process.stdout.write('Waiting for Neo4j (bolt) ');

while (true) {
  try {
    await driver.verifyConnectivity();
    console.log(' OK');
    await driver.close();
    process.exit(0); // 连接成功，可以启动服务了
  } catch (e) {
    if (Date.now() - start > TIMEOUT_MS) {
      console.error(`\nTimeout: ${e.message}`);
      await driver.close();
      process.exit(1); // 超时退出，start.bat 会走失败分支
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}
