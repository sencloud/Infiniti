// 后台批处理：把 5000言 的四大名著（另三部）、论语、聊斋、史记都像水浒传一样跑完。
//   node src/scripts/kg/all.js                 默认书单，两本并行
//   node src/scripts/kg/all.js lunyu shiji     只跑指定的书
// 每本书独立续跑，失败不影响其它书；进度见 data/<graph>/status.json 与本进程日志。
import { close } from '../../db.js';
import { isMain } from './paths.js';
import { runGraph } from './run.js';

const DEFAULT_BOOKS = ['lunyu', 'xiyouji', 'sanguo', 'hongloumeng', 'liaozhai', 'shiji'];
const PARALLEL = Number(process.env.KG_BOOK_PARALLEL || 2);

export async function runBooks(books = DEFAULT_BOOKS) {
  const queue = [...books];
  const results = {};
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        await runGraph(id);
        results[id] = 'done';
      } catch (e) {
        console.error(`[all] ${id} 失败：${e.message}`);
        results[id] = `failed: ${e.message}`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, books.length) }, worker));
  // 失败的书再顺序续跑一轮：多数失败是限流或偶发截断，已完成的步骤会跳过
  for (const id of Object.keys(results).filter((k) => results[k] !== 'done')) {
    try {
      console.log(`[all] 重试 ${id}`);
      await runGraph(id);
      results[id] = 'done';
    } catch (e) {
      results[id] = `failed: ${e.message}`;
    }
  }
  console.log('[all] 结果', results);
  return results;
}

if (isMain(import.meta.url)) {
  const books = process.argv.slice(2);
  runBooks(books.length ? books : undefined)
    .catch((e) => {
      console.error('[all] 异常:', e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
