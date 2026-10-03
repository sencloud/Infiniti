// 逐单元抽取实体与关系事实：每个单元按段落切成 ≤ WINDOW_CHARS 的窗口分别调用 LLM，
// 结果按单元缓存到 data/<graph>/extract/NNN.json，重跑时跳过已完成的单元。
//   node src/scripts/kg/extract.js <graph> [单元序号…]
import fs from 'node:fs';
import { chatJson } from '../../kg/llm.js';
import { getGraph, unitLabel } from '../../kg/domains/index.js';
import { graphArg, graphPaths, isMain, readJson, writeJson } from './paths.js';
import { loadSeeds } from './seeds.js';
import { purposePrompt } from '../../kg/domains/purpose.js';

const WINDOW_CHARS = 6000;
const EN_WINDOW_CHARS = 8000;
const CONCURRENCY = Number(process.env.KG_EXTRACT_CONCURRENCY || 8);
const WINDOW_CONCURRENCY = 3;
/** two-pass：每个窗口先对照已知实体分析一遍称呼与新角色，再带着结论抽三元组（LLM 调用翻倍） */
const DEFAULT_MODE = process.env.KG_EXTRACT_MODE === 'two-pass' ? 'two-pass' : 'single';

/** 按段落切窗口，返回每个窗口包含的段落下标 */
export function splitWindows(paragraphs, limit = WINDOW_CHARS) {
  const windows = [];
  let buf = [];
  let len = 0;
  paragraphs.forEach((p, i) => {
    if (len + p.length > limit && buf.length) {
      windows.push(buf);
      buf = [];
      len = 0;
    }
    buf.push(i);
    len += p.length;
  });
  if (buf.length) windows.push(buf);
  return windows;
}

/** 只把本窗口里提到的种子人物放进提示词，控制长度 */
function seedHints(text, seeds) {
  return seeds
    .filter((h) => [h.name, h.nickname, ...(h.aliases || [])].some((n) => n && n.length >= 2 && text.includes(n)))
    .map((h) => {
      const other = [h.nickname, ...(h.aliases || []).filter((a) => a !== h.name && !a.endsWith(h.name))].filter(Boolean);
      return other.length ? `${h.name}（${other.join('/')}）` : h.name;
    })
    .join('、');
}

// 泛指群体（「两个都头」「众好汉」「一个庄客」）不作为实体
const GENERIC_NAME = /^(?:[一二两三四五六七八九十百千数几众诸那这此各]|大小|许多|一伙|一群)|(?:们|等人|人等|众人)$/;

const BARE_TITLES = new Set([
  '都头', '府尹', '知府', '知县', '知州', '县尉', '太尉', '观察', '提辖', '教头', '庄客', '庄主', '店小二', '小二',
  '酒保', '军汉', '公人', '差人', '头领', '喽啰', '小喽啰', '好汉', '官军', '军士', '和尚', '长老', '员外',
  '太公', '老儿', '妇人', '娘子', '丫鬟', '使女', '皇帝', '天子', '圣上', '朝廷', '相公', '押司', '节级', '牢子',
  '书生', '秀才', '老翁', '老妪', '女子', '少年', '道士', '仆人', '童子', '使者', '将军', '丞相', '大夫', '国君',
]);

/** 实体主要是概念而不是人物的图谱（教材、专题）：不套用人物的泛称过滤 */
export function isConceptual(graph) {
  return graph?.kind === 'textbook' || graph?.kind === 'topic';
}

const TOPIC_GENERIC = /^(?:本(?:标准|规范|文件|办法|规定|条例|细则|部分|章|节|条)|附录|表\s*[A-Z]?\d|图\s*[A-Z]?\d|示例|注$|第[一二三四五六七八九十\d]+[章节条款])/;

// 英文：小写开头或冠词开头的是泛称（「the servant」「a gentleman」），单独的称谓不算人名
const EN_TITLES = new Set([
  'Mr.', 'Mrs.', 'Miss', 'Sir', 'Lady', 'Lord', 'Madam', 'Madame', 'Master', 'Doctor', 'Dr.', 'Captain', 'Colonel',
  'Servant', 'Servants', 'Footman', 'Maid', 'Housekeeper', 'Gentleman', 'Gentlemen', 'Ladies', 'Stranger', 'Visitor',
  'Officer', 'Officers', 'Man', 'Woman', 'Boy', 'Girl', 'Child', 'Children', 'Father', 'Mother', 'Uncle', 'Aunt',
  'Reader', 'Narrator', 'Everyone', 'Somebody', 'People', 'Guests', 'Citizens', 'Watchmen',
  'House', 'Place', 'Room', 'Garden', 'Hall', 'Court', 'Door', 'Table', 'Street', 'Town', 'Village', 'Church', 'Park',
  'Road', 'Wood', 'Forest', 'Kitchen', 'Library', 'Parlour', 'Home', 'Country', 'City', 'Window', 'Letter', 'Ball',
]);

export function isGenericEnglish(name) {
  const n = String(name || '').trim();
  return n.length < 2 || /^[a-z]/.test(n) || /^(?:The|A|An|Some|Two|Three|Several|All|Other|His|Her|Their|My|Our)\s+[a-z]/.test(n) || EN_TITLES.has(n);
}

/** 教材知识点名可以只有一个字（「圆」「角」），不套用人物的泛称过滤 */
export function isGenericName(name, graph) {
  if (graph?.kind === 'textbook') return !name || /^(?:例|练习|习题|问题|思考|探索|阅读)/.test(name);
  if (graph?.kind === 'topic') return !name || name.length < 2 || TOPIC_GENERIC.test(name);
  if (graph?.lang === 'en') return !/[\u4e00-\u9fa5]/.test(name || '') && isGenericEnglish(name);
  return name.length < 2 || BARE_TITLES.has(name) || GENERIC_NAME.test(name);
}

const EN_RULES = [
  '原文是英文。name、aliases、subject、object 一律用英文原文里的写法，不要翻译成中文；nickname 填该实体通行的中文译名（如「伊丽莎白」「彭伯里」）；description 用中文写。',
  '人物书中给出名和姓的，name 写「名 姓」（如 Elizabeth Bennet）；只有称谓加姓的保留称谓（如 Mrs. Bennet、Lady Catherine de Bourgh 照原文）；其它称呼（Lizzy、Mr. Darcy）放 aliases。',
  'evidence 必须从英文原文里原样照抄连续的一句或半句（≤200 个字符），不要翻译、不要改写。',
  '无名的仆人、路人（如 the footman、a gentleman）和只有称谓没有姓名的人不要作为实体；代词 he/she/I 要换成所指的人名。',
];

function systemPrompt(graph) {
  const o = graph.ontology;
  const en = graph.lang === 'en';
  const rules = [
    ...(en ? EN_RULES : []),
    ...graph.extract.rules,
    '只抽取片段中明确发生或明确交代的事实，不要凭常识补充片段外的内容。',
    en ? '' : 'evidence 必须是原文中连续的一句或半句（≤60字），能直接支撑该关系。',
    isConceptual(graph) || en ? '' : '无名路人（如「一个庄客」「店小二」）和只有官职没有姓名的人（如「府尹」「知县」）不要作为实体。',
    '有方向的谓词严格按「A 谓词 B」的语义填 subject=A、object=B，不要颠倒。',
    'confidence 取 0.5~1.0，明确叙述取 0.9 以上。',
  ].filter(Boolean);
  return `你是${graph.extract.role}。从给定的原文片段中抽取实体与关系事实，只输出 JSON。
${purposePrompt(graph.id)}
抽取时优先保证上面这类关系完整、方向正确。
实体类型：
${o.entityGuide()}
关系谓词（只能用下列代码）：
${o.predicateGuide()}
规则：
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
输出格式：
{"entities":[{"name":"","type":"${o.ENTITY_TYPES[0].code}","aliases":[],"nickname":"","description":"≤30字"}],
 "relations":[{"subject":"","predicate":"","object":"","evidence":"","confidence":0.9}]}`;
}

function userPrompt(graph, chapter, label, text, hints, reference, analysis = '') {
  const where = [chapter.part, `${chapter.label || unitLabel(graph, chapter.no)}「${chapter.title}」`].filter(Boolean).join(' · ');
  return `${where}（片段 ${label}）
${hints ? `本片段涉及的${graph.extract.seedNoun}规范名：${hints}\n` : ''}${analysis ? `${analysis}\n` : ''}
原文：
${text}${reference ? `\n\n白话译文（仅供理解，evidence 必须取自原文）：\n${reference.slice(0, 4000)}` : ''}`;
}

function clean(raw, graph) {
  const o = graph.ontology;
  const personLike = new Set(['Person', 'Spirit']);
  const norm = graph.normalizeName || ((s) => String(s || '').trim().replace(/\s+/g, ' '));
  const maxLen = graph.kind === 'topic' || graph.lang === 'en' ? 40 : 20;
  const evidenceMax = graph.lang === 'en' ? 300 : 120;
  const entities = [];
  for (const e of raw?.entities || []) {
    const name = norm(e?.name);
    const type = String(e?.type || '').trim();
    if (!name || name.length > maxLen || !o.ENTITY_TYPE_CODES.has(type)) continue;
    if ((personLike.has(type) || isConceptual(graph)) && isGenericName(name, graph)) continue;
    entities.push({
      name,
      type,
      aliases: (Array.isArray(e.aliases) ? e.aliases : []).map((a) => String(a).trim()).filter((a) => a && a !== name && a.length <= maxLen),
      nickname: String(e.nickname || '').trim(),
      description: String(e.description || '').trim().slice(0, 80),
    });
  }
  const namedNonPerson = new Set(entities.filter((e) => !personLike.has(e.type)).map((e) => e.name));
  const relations = [];
  for (const r of raw?.relations || []) {
    const predicate = String(r?.predicate || '').trim().toUpperCase();
    const subject = norm(r?.subject);
    const object = norm(r?.object);
    if (!o.PREDICATE_BY_CODE.has(predicate) || !subject || !object || subject === object) continue;
    const generic = (n) => isGenericName(n, graph) && !namedNonPerson.has(n);
    if (generic(subject) || generic(object)) continue;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0.8));
    relations.push({ subject, predicate, object, evidence: String(r.evidence || '').trim().slice(0, evidenceMax), confidence });
  }
  return { entities, relations };
}

/** 已抽取单元里的实体（名 → 类型/别名/简介），两步抽取的第一步拿它对照 */
function loadKnown(paths, seeds) {
  const known = new Map();
  const add = (name, type, aliases = [], description = '') => {
    if (!name) return;
    const cur = known.get(name) || { name, type, aliases: new Set(), description };
    for (const a of aliases) if (a && a !== name) cur.aliases.add(a);
    if (!cur.description && description) cur.description = description;
    known.set(name, cur);
  };
  for (const s of seeds) add(s.name, s.type || 'Person', [s.nickname, ...(s.aliases || [])], s.description || '');
  for (const c of paths.listChapters()) {
    const cached = readJson(paths.extractFile(c.no));
    for (const w of cached?.windows || []) for (const e of w.entities) add(e.name, e.type, [e.nickname, ...e.aliases], e.description);
  }
  return [...known.values()];
}

function mentionedKnown(text, known, graph) {
  const minLen = graph.kind === 'textbook' ? 1 : 2;
  return known
    .filter((k) => [k.name, ...k.aliases].some((n) => n.length >= minLen && text.includes(n)))
    .slice(0, 80);
}

const ANALYSIS_SYSTEM = (graph) => `你是${graph.extract.role}。正式抽取前先通读片段，对照「已知实体」判断片段里每个称呼指的是谁，只输出 JSON。
${purposePrompt(graph.id)}
要求：
1. mentions 列出片段里出现的重要${graph.terms.primary}/概念称呼：surface 是原文写法，canonical 是已知实体里的规范名；确实是新出现的，canonical 写你认为的规范名并标 is_new=true。
2. 同一实体的不同称呼必须归到同一个 canonical；不确定时宁可标新，不要硬并。
3. notes 写 0~3 条与已知信息冲突或容易抽错的地方（如同名不同人、身份变化），每条 ≤40 字。
输出 {"mentions":[{"surface":"","canonical":"","is_new":false}],"notes":[]}`;

async function analyzeWindow(ctx, text) {
  const near = mentionedKnown(text, ctx.known, ctx.graph);
  const list = near.map((k) => {
    const aka = [...k.aliases].slice(0, 4);
    return `- ${k.name}（${k.type}${aka.length ? `；又称 ${aka.join('/')}` : ''}${k.description ? `；${k.description.slice(0, 30)}` : ''}）`;
  }).join('\n');
  const res = await chatJson({
    system: ANALYSIS_SYSTEM(ctx.graph),
    user: `已知实体：\n${list || '（暂无）'}\n\n原文：\n${text}`,
    maxTokens: 3000,
    temperature: 0.1,
  });
  const mapped = (res.mentions || [])
    .map((m) => ({ surface: String(m?.surface || '').trim(), canonical: String(m?.canonical || '').trim(), isNew: Boolean(m?.is_new) }))
    .filter((m) => m.surface && m.canonical);
  const merges = mapped.filter((m) => m.surface !== m.canonical).map((m) => `${m.surface}→${m.canonical}`);
  const fresh = mapped.filter((m) => m.isNew).map((m) => m.canonical);
  const notes = (res.notes || []).map((n) => String(n).trim()).filter(Boolean).slice(0, 3);
  const lines = [];
  if (merges.length) lines.push(`称呼对应（抽取时统一用箭头右边的规范名）：${[...new Set(merges)].join('、')}`);
  if (fresh.length) lines.push(`本片段新出现的实体：${[...new Set(fresh)].join('、')}`);
  if (notes.length) lines.push(`注意：${notes.join('；')}`);
  return lines.join('\n');
}

/** 输出被截断（关系太多）时把窗口对半切开重抽 */
async function extractWindow(ctx, chapter, label, idxs, depth = 0, hot = false) {
  const { graph, seeds, system } = ctx;
  const text = idxs.map((i) => chapter.paragraphs[i]).join('\n');
  const reference = chapter.references ? idxs.map((i) => chapter.references[i]).filter(Boolean).join('\n') : '';
  try {
    const analysis = ctx.mode === 'two-pass' ? await analyzeWindow(ctx, text).catch(() => '') : '';
    const raw = await chatJson({
      system,
      user: userPrompt(graph, chapter, label, text, seedHints(text, seeds), reference, analysis),
      maxTokens: 16000,
      retries: depth === 0 ? 2 : 3,
      ...(hot ? { temperature: 0.7 } : {}),
    });
    return [{ chars: text.length, ...clean(raw, graph), ...(analysis ? { analysis } : {}) }];
  } catch (e) {
    if (depth >= 3 || idxs.length < 2) {
      // 切到这么小还被截断，多半是模型陷进了重复输出，换个温度再试一次
      if (e.code === 'LENGTH' && !hot) return extractWindow(ctx, chapter, label, idxs, depth, true);
      e.message = `片段 ${label}（${text.length} 字）：${e.message}`;
      throw e;
    }
    const mid = Math.ceil(idxs.length / 2);
    const out = [];
    for (const [i, part] of [idxs.slice(0, mid), idxs.slice(mid)].entries()) {
      out.push(...(await extractWindow(ctx, chapter, `${label}-${i + 1}`, part, depth + 1)));
    }
    return out;
  }
}

async function extractChapter(ctx, chapter) {
  const windows = splitWindows(chapter.paragraphs, ctx.graph.lang === 'en' ? EN_WINDOW_CHARS : WINDOW_CHARS);
  // 专题里一份标准可能上百页：窗口并行抽，免得最长的那份拖住整批
  const parallel = ctx.graph.kind === 'topic' ? WINDOW_CONCURRENCY : 1;
  const parts = new Array(windows.length);
  await pool(windows.map((w, i) => i), parallel, async (i) => {
    parts[i] = await extractWindow(ctx, chapter, `${i + 1}/${windows.length}`, windows[i]);
  });
  const results = parts.flat();
  return {
    no: chapter.no,
    title: chapter.title,
    windows: results.map((w, idx) => ({ idx, ...w })),
    extracted_at: new Date().toISOString(),
  };
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function makeContext(graphId, mode) {
  const graph = getGraph(graphId);
  const paths = graphPaths(graphId);
  const seeds = await loadSeeds(graphId);
  return { graph, paths, seeds, mode, system: systemPrompt(graph), known: mode === 'two-pass' ? loadKnown(paths, seeds) : [] };
}

/** 只抽一个单元、不写缓存：用来对比两种抽取方式 */
export async function extractUnit(graphId, no, { mode = DEFAULT_MODE } = {}) {
  const ctx = await makeContext(graphId, mode);
  const chapter = ctx.paths.listChapters().find((c) => c.no === Number(no));
  if (!chapter) throw new Error(`没有第 ${no} 个单元`);
  return extractChapter(ctx, chapter);
}

export async function extractAll(graphId, { only, mode = DEFAULT_MODE, signal, onUnit } = {}) {
  const ctx = await makeContext(graphId, mode);
  const { graph, paths } = ctx;
  paths.ensureDirs();
  const chapters = paths.listChapters().filter((c) => !only || only.includes(c.no));
  const todo = chapters.filter((c) => !fs.existsSync(paths.extractFile(c.no)));
  const tag = `[extract:${graphId}]`;
  console.log(`${tag} 共 ${chapters.length} 个${graph.unit.name}，待抽取 ${todo.length}，并发 ${CONCURRENCY}${mode === 'two-pass' ? '，两步抽取' : ''}`);
  let done = 0;
  const failed = [];
  const before = chapters.length - todo.length;
  onUnit?.(before, chapters.length);
  await pool(todo, CONCURRENCY, async (chapter) => {
    if (signal?.aborted) return;
    try {
      const t0 = Date.now();
      const out = await extractChapter(ctx, chapter);
      writeJson(paths.extractFile(chapter.no), out);
      const nE = out.windows.reduce((s, w) => s + w.entities.length, 0);
      const nR = out.windows.reduce((s, w) => s + w.relations.length, 0);
      done++;
      onUnit?.(before + done, chapters.length);
      console.log(`${tag} ${done}/${todo.length} ${chapter.label || unitLabel(graph, chapter.no)} 实体${nE} 关系${nR} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      failed.push(chapter.no);
      console.error(`${tag} ${chapter.label || unitLabel(graph, chapter.no)} 失败: ${e.message}`);
    }
  });
  const finished = chapters.filter((c) => readJson(paths.extractFile(c.no))).length;
  console.log(`${tag} 完成 ${finished}/${chapters.length}${failed.length ? `，失败：${failed.join(',')}（重跑即可续抽）` : ''}`);
  return { finished, failed, total: chapters.length };
}

if (isMain(import.meta.url)) {
  const { id, rest } = graphArg();
  const only = rest.map(Number).filter(Boolean);
  extractAll(id, { only: only.length ? only : undefined }).catch((e) => {
    console.error(`[extract:${id}] 异常:`, e);
    process.exit(1);
  });
}
