// 命令行跑预计算：语义星图 + 关系分析（与页面上「重新分析」同一套逻辑）
//   node src/scripts/kg/build.js <graph>             两个都跑
//   node src/scripts/kg/build.js <graph> galaxy      只跑星图
//   node src/scripts/kg/build.js <graph> analysis    只跑关系分析
import { close } from '../../db.js';
import { buildGalaxy } from '../../kg/galaxyBuild.js';
import { buildAnalysis } from '../../kg/analysisBuild.js';
import { createJob, finishJob } from '../../kg/jobs.js';
import { withGraph } from '../../kg/neo.js';
import { graphArg, isMain } from './paths.js';

async function runJob(graphId, kind, builder) {
  const job = createJob(kind);
  const tag = `[${kind}:${graphId}]`;
  let last = '';
  const timer = setInterval(() => {
    const line = `${job.stage} ${job.progress}%`;
    if (line !== last) console.log(`${tag} ${line}`);
    last = line;
  }, 1500);
  const t0 = Date.now();
  try {
    await builder(job);
    await finishJob(job, 'completed');
    const { cancelled, ...summary } = job;
    console.log(`${tag} 完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`, summary);
  } catch (e) {
    await finishJob(job, 'failed', e);
    throw e;
  } finally {
    clearInterval(timer);
  }
}

export function buildAll(graphId, which = ['galaxy', 'analysis']) {
  return withGraph(graphId, async () => {
    if (which.includes('galaxy')) await runJob(graphId, 'galaxy', buildGalaxy);
    if (which.includes('analysis')) await runJob(graphId, 'analysis', buildAnalysis);
  });
}

if (isMain(import.meta.url)) {
  const { id, rest } = graphArg();
  buildAll(id, rest.length ? rest : undefined)
    .catch((e) => {
      console.error(`[build:${id}] 失败:`, e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
