// clone 后一键恢复全部图谱：用仓库自带的原文与抽取缓存入库，再跑星图与关系分析（不重新抓取、不重新抽取）。
//   node src/scripts/kg/restore.js                 全部图谱
//   node src/scripts/kg/restore.js hongloumeng     只恢复指定图谱
// 星图命名会调用 DeepSeek；本地向量模型首次运行时自动下载。
import { close } from '../../db.js';
import { listGraphs } from '../../kg/domains/index.js';
import { isMain } from './paths.js';
import { runGraph } from './run.js';

export async function restoreGraphs(ids = listGraphs().map((g) => g.id)) {
  const results = {};
  for (const id of ids) {
    try {
      await runGraph(id, ['load', 'build']);
      results[id] = 'done';
    } catch (e) {
      console.error(`[restore] ${id} 失败：${e.message}`);
      results[id] = `failed: ${e.message}`;
    }
  }
  console.log('[restore] 结果', results);
  return results;
}

if (isMain(import.meta.url)) {
  const ids = process.argv.slice(2);
  restoreGraphs(ids.length ? ids : undefined)
    .catch((e) => {
      console.error('[restore] 异常:', e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
