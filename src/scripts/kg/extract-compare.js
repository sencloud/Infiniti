// 同一个单元分别用单步、两步抽取跑一遍，对比实体与关系的差异（只打印，不写缓存）。
//   node src/scripts/kg/extract-compare.js <graph> <单元序号>
import { getGraph, unitLabel } from '../../kg/domains/index.js';
import { extractUnit } from './extract.js';
import { graphArg, isMain } from './paths.js';

function summarize(result) {
  const entities = new Map();
  const relations = new Set();
  for (const w of result.windows) {
    for (const e of w.entities) entities.set(e.name, e);
    for (const r of w.relations) relations.add(`${r.subject} ${r.predicate} ${r.object}`);
  }
  return { entities, relations, analysis: result.windows.map((w) => w.analysis).filter(Boolean) };
}

function only(a, b) {
  return [...a].filter((x) => !b.has(x));
}

export async function compareUnit(graphId, no) {
  const graph = getGraph(graphId);
  const label = unitLabel(graph, no);
  console.log(`[compare:${graphId}] ${label}：单步抽取…`);
  const single = summarize(await extractUnit(graphId, no, { mode: 'single' }));
  console.log(`[compare:${graphId}] ${label}：两步抽取…`);
  const twoPass = summarize(await extractUnit(graphId, no, { mode: 'two-pass' }));

  const names = (s) => new Set(s.entities.keys());
  console.log(`\n实体 单步 ${single.entities.size} / 两步 ${twoPass.entities.size}；关系 单步 ${single.relations.size} / 两步 ${twoPass.relations.size}`);
  console.log(`只在单步里的实体：${only(names(single), names(twoPass)).join('、') || '无'}`);
  console.log(`只在两步里的实体：${only(names(twoPass), names(single)).join('、') || '无'}`);
  console.log(`\n只在单步里的关系（前 15）：\n  ${only(single.relations, twoPass.relations).slice(0, 15).join('\n  ') || '无'}`);
  console.log(`\n只在两步里的关系（前 15）：\n  ${only(twoPass.relations, single.relations).slice(0, 15).join('\n  ') || '无'}`);
  console.log(`\n两步抽取第一步的分析：\n${twoPass.analysis.join('\n---\n') || '（无）'}`);
}

if (isMain(import.meta.url)) {
  const { id, rest } = graphArg();
  const no = Number(rest[0]);
  if (!no) {
    console.error('用法：node src/scripts/kg/extract-compare.js <graph> <单元序号>');
    process.exit(1);
  }
  compareUnit(id, no).catch((e) => {
    console.error(`[compare:${id}] 异常:`, e);
    process.exit(1);
  });
}
