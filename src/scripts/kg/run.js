// 一个图谱的完整管线：抓取 → 种子 → 抽取 → 入库 → 星图与关系分析。每一步都可续跑（已完成的部分跳过）。
//   node src/scripts/kg/run.js <graph>                       全流程
//   node src/scripts/kg/run.js <graph> extract load build    只跑指定步骤
// 进度写到 data/<graph>/status.json，首页和批处理脚本据此展示。
import { close } from '../../db.js';
import { clearUnitLabels, getGraph } from '../../kg/domains/index.js';
import { graphArg, graphPaths, isMain, readJson, writeJson } from './paths.js';
import { canCrawl, crawlBook } from './crawl.js';
import { loadSeeds } from './seeds.js';
import { extractAll } from './extract.js';
import { loadGraph } from './load.js';
import { buildAll } from './build.js';

export const STEPS = ['crawl', 'seeds', 'extract', 'load', 'build'];

export function readStatus(graphId) {
  return readJson(`${graphPaths(graphId).DATA_DIR}/status.json`, {});
}

export function status(graphId, patch) {
  const file = `${graphPaths(graphId).DATA_DIR}/status.json`;
  const next = { ...readJson(file, {}), ...patch, updated_at: new Date().toISOString() };
  writeJson(file, next);
  return next;
}

function checkStop(signal) {
  if (signal?.aborted) throw Object.assign(new Error('已停止'), { code: 'aborted' });
}

async function crawlStep(graphId, signal) {
  if (getGraph(graphId).topic) {
    const { ingestTopic } = await import('../../topic/ingest.js');
    let last = 0;
    return ingestTopic(graphId, {
      signal,
      onProgress: (p) => {
        // 转写一页就回调一次，状态文件两秒写一回就够首页和专题页看进度
        if (Date.now() - last < 2000 && p.files_done < p.files_total) return;
        last = Date.now();
        status(graphId, { ingest: { ...p } });
      },
    });
  }
  if (canCrawl(graphId)) return crawlBook(graphId);
  if (graphId === 'math') {
    const { fetchMath } = await import('../math/fetch.js');
    return fetchMath();
  }
  throw new Error(`${graphId} 没有抓取步骤`);
}

export async function runGraph(graphId, steps = STEPS, { signal } = {}) {
  const t0 = Date.now();
  status(graphId, {
    state: 'running', steps, error: null, error_code: null, started_at: new Date().toISOString(), finished_at: null, pid: process.pid,
  });
  try {
    for (const step of steps) {
      checkStop(signal);
      status(graphId, { step });
      console.log(`\n[run:${graphId}] ── ${step} ──`);
      if (step === 'crawl') await crawlStep(graphId, signal);
      if (step === 'seeds') await loadSeeds(graphId, { refresh: Boolean(getGraph(graphId).topic) });
      if (step === 'extract') {
        // LLM 偶发超时：失败的单元再补抽两轮
        for (let pass = 1; pass <= 3; pass++) {
          const r = await extractAll(graphId, {
            signal,
            onUnit: (done, total) => status(graphId, { extracted: done, units: total }),
          });
          status(graphId, { extracted: r.finished, units: r.total });
          checkStop(signal);
          if (!r.failed.length) break;
          if (pass === 3) throw new Error(`仍有 ${r.failed.length} 个单元抽取失败：${r.failed.join(',')}`);
        }
      }
      if (step === 'load') {
        await loadGraph(graphId);
        clearUnitLabels(graphId);
      }
      if (step === 'build') await buildAll(graphId);
    }
    status(graphId, { state: 'done', step: null, finished_at: new Date().toISOString() });
    console.log(`[run:${graphId}] 全部完成，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  } catch (e) {
    const stopped = e.code === 'aborted';
    status(graphId, {
      state: stopped ? 'stopped' : 'failed',
      error: stopped ? null : String(e.message || e),
      error_code: stopped ? null : e.code || null,
      finished_at: new Date().toISOString(),
    });
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
