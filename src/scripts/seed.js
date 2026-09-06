// 种子脚本：注入初始人物，启动 BFS 扩散
// 用法: node src/scripts/seed.js 苏轼
import { initSchema, close } from '../db.js';
import * as graph from '../services/graphService.js';

const names = process.argv.slice(2);

if (!names.length) {
  console.error('用法: npm run seed -- <人名> [更多人名]');
  process.exit(1);
}

for (const name of names) {
  await graph.enqueueTask(name, { priority: 1000, depth: 0, reason: '种子' });
  console.log(`[seed] 已入队: ${name}`);
}

// 显示当前队列概况
const stats = await graph.taskStats();
console.log(`[seed] 队列状态:`, stats);
await close();
