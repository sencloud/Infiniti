// 命令行建专题：从本机文件夹导入资料（子文件夹即分类），可选直接跑完整管线。
//   node src/scripts/topic/import.js <专题id> <文件夹> [--name 名称] [--preset standards|general] [--desc 简介] [--run]
//   例：npm run topic:import -- dangan "D:\资料\标准" --name 档案标准规范 --run
// 再次运行同一个 id 是增量导入：新文件追加，改过的文件重转写，没变的跳过。
import { close } from '../../db.js';
import { hasGraph, registerTopic } from '../../kg/domains/index.js';
import { PRESETS, TOPIC_ID_RE, writeTopicMeta } from '../../kg/domains/topics.js';
import { importFolder, readManifest } from '../../topic/manifest.js';
import { attachLog, externalRun } from '../../topic/runner.js';
import { isMain } from '../kg/paths.js';
import { runGraph } from '../kg/run.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

export async function importTopic(id, dir, { name, preset = 'standards', description = '', run = false } = {}) {
  if (!TOPIC_ID_RE.test(id)) throw new Error(`专题 id 只能用小写字母开头的字母、数字、下划线：${id}`);
  if (hasGraph(id) && externalRun(id)) throw new Error('这个专题正在别处处理（网页或另一个命令行），等它跑完或先停止');
  if (!hasGraph(id)) {
    if (!PRESETS[preset]) throw new Error(`没有这个预设：${preset}（可选 ${Object.keys(PRESETS).join(' / ')}）`);
    const meta = { id, name: name || id, description, preset, created_at: new Date().toISOString() };
    writeTopicMeta(meta);
    registerTopic(meta);
    console.log(`[topic:${id}] 新建专题「${meta.name}」（${PRESETS[preset].name}）`);
  }
  const r = await importFolder(id, dir, {
    onFile: (rel, status) => { if (status !== 'unchanged') console.log(`[topic:${id}] ${status === 'added' ? '新增' : status === 'replaced' ? '更新' : '重复跳过'} ${rel}`); },
  });
  const total = readManifest(id).files.length;
  console.log(`[topic:${id}] 找到 ${r.found} 份：新增 ${r.added}，更新 ${r.replaced}，重复 ${r.duplicate}，未变 ${r.unchanged}，跳过 ${r.skipped}；专题共 ${total} 份`);
  if (run) {
    attachLog(id);
    await runGraph(id);
  }
  return r;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const [id, dir] = args._;
  if (!id || !dir) {
    console.error('用法：node src/scripts/topic/import.js <专题id> <文件夹> [--name 名称] [--preset standards|general] [--desc 简介] [--run]');
    process.exit(1);
  }
  importTopic(id, dir, { name: args.name, preset: args.preset, description: args.desc, run: args.run })
    .catch((e) => {
      console.error(`[topic:${id}] 失败:`, e.message || e);
      process.exitCode = 1;
    })
    .finally(() => close());
}
