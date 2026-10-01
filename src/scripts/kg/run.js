// 一个图谱的完整管线：抓取 → 种子 → 抽取 → 入库 → 星图与关系分析。每一步都可续跑（已完成的部分跳过）。
//   node src/scripts/kg/run.js <graph>                       全流程
//   node src/scripts/kg/run.js <graph> extract load build    只跑指定步骤
// 进度写到 data/<graph>/status.json，首页和批处理脚本据此展示。
import { close } from '../../db.js';
import { graphArg, graphPaths, isMain, readJson, writeJson } from './paths.js';
import { canCrawl, crawlBook } from './crawl.js';
import { loadSeeds } from './seeds.js';
import { extractAll } from './extract.js';
import { loadGraph } from './load.js';
import { buildAll } from './build.js';

export const STEPS = ['crawl', 'seeds', 'extract', 'load', 'build'];

function status(graphId, patch) {
  const file = `${graphPaths(graphId).DATA_DIR}/status.json`;
  const next = { ...readJson(file, {}), ...patch, updated_at: new Date().toISOString() };
  writeJson(file, next);
  return next;
}

async function crawlStep(graphId) {
  if (canCrawl(graphId)) return crawlBook(graphId);
  if (graphId === 'math') {
    const { fetchMath } = await import('../math/fetch.js');
    return fetchMath();
  }
  throw new Error(`${graphId} 没有抓取步骤`);
}

export async function runGraph(graphId, steps = STEPS) {
  const t0 = Date.now();
  status(graphId, { state: 'running', steps, error: null, started_at: new Date().toISOString() });
  try {
    for (const step of steps) {
      status(graphId, { step });
      console.log(`\n[run:${graphId}] ── ${step} ──`);
      if (step === 'crawl') await crawlStep(graphId);
      if (step === 'seeds') await loadSeeds(graphId);
      if (step === 'extract') {
        // LLM 偶发超时：失败的单元再补抽两轮
        for (let pass = 1; pass <= 3; pass++) {
          const r = await extractAll(graphId);
          status(graphId, { extracted: r.finished, units: r.total });
          if (!r.failed.length) break;
          if (pass === 3) throw new Error(`仍有 ${r.failed.length} 个单元抽取失败：${r.failed.join(',')}`);
        }
      }
      if (step === 'load') await loadGraph(graphId);
      if (step === 'build') await buildAll(graphId);
    }
    status(graphId, { state: 'done', step: null, finished_at: new Date().toISOString() });
    console.log(`[run:${graphId}] 全部完成，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  } catch (e) {
    status(graphId, { state: 'failed', error: String(e.message || e) });
    throw e;
  }
}

if (isMain(import.meta.url)) {
  const { id, rest } = graphArg();
  const steps = rest.length ? rest.filter((s) => STEPS.includes(s)) : STEPS;
  runGraph(id, steps)
    .catch((e) => {
      console.error(`[run:${id}] 失败:`, e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
