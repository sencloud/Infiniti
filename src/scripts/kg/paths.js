// 知识图谱数据管线的本地缓存目录（按图谱分目录）：抓取与 LLM 抽取结果都落盘，重跑时跳过已完成部分
//   data/<graph>/chapters/NNN.json   单元原文（回 / 篇 / 节）
//   data/<graph>/extract/NNN.json    LLM 抽取结果
//   data/<graph>/seeds.json          主要人物（知识点）种子表；水浒传沿用 heroes.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasGraph } from '../../kg/domains/index.js';

/** 当前模块是否作为命令行入口运行（被 import 时为 false） */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

/** 命令行第一个参数是图谱 id */
export function graphArg(argv = process.argv.slice(2)) {
  const id = argv[0];
  if (!id || !hasGraph(id)) {
    console.error(`用法：node <script> <graph> …（graph 取值：shuihu xiyouji hongloumeng sanguo liaozhai lunyu shiji math）`);
    process.exit(1);
  }
  return { id, rest: argv.slice(1) };
}

const pad = (no) => String(no).padStart(3, '0');

export function graphPaths(graphId) {
  const DATA_DIR = path.resolve('data', graphId);
  const CHAPTER_DIR = path.join(DATA_DIR, 'chapters');
  const EXTRACT_DIR = path.join(DATA_DIR, 'extract');
  return {
    DATA_DIR,
    CHAPTER_DIR,
    EXTRACT_DIR,
    SEEDS_FILE: path.join(DATA_DIR, graphId === 'shuihu' ? 'heroes.json' : 'seeds.json'),
    chapterFile: (no) => path.join(CHAPTER_DIR, `${pad(no)}.json`),
    extractFile: (no) => path.join(EXTRACT_DIR, `${pad(no)}.json`),
    ensureDirs() {
      for (const dir of [DATA_DIR, CHAPTER_DIR, EXTRACT_DIR]) fs.mkdirSync(dir, { recursive: true });
    },
    listChapters() {
      if (!fs.existsSync(CHAPTER_DIR)) return [];
      return fs
        .readdirSync(CHAPTER_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => readJson(path.join(CHAPTER_DIR, f)))
        .filter(Boolean);
    },
  };
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8');
}
