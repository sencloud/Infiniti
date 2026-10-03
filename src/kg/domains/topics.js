// 专题：学习者自己导入的一组资料（标准规范、制度文件、讲义…），每个专题是一个图谱，配置不写在代码里，
// 存在 data/topics/<id>/topic.json：{id, name, description, preset, created_at}。
// 一份文件是一个单元；文件所在的子文件夹就是它的分类（Chapter.part）。
import fs from 'node:fs';
import path from 'node:path';
import { makeOntology } from '../ontology.js';

export const TOPIC_ROOT = path.resolve('data', 'topics');
export const TOPIC_ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

export function topicDir(id) {
  return path.join(TOPIC_ROOT, id);
}

// ───────────── 标准编号 ─────────────
// 文件名和正文里的写法五花八门：「GBT 18894-2016」「GB/T18894—2016」「DAT 105一2025」「DB32T+4708—2024」，
// 统一成「GB/T 18894-2016」「DA/T 105-2025」「DB32/T 4708-2024」。

const CODE_RE = /^(GB|DA|DB\d{2}|SJ|YD|GA|WS|JR|HJ|QX|JGJ|CJJ|MZ|WH|SL|JT|TB|DL|AQ)\s*\/?\s*([TZ])?\s*\+?\s*(\d+(?:\s*\.\s*\d+)*)(?:\s*[-—–一－~?]\s*(\d{2,4}))?/i;

/** 解析标准编号，返回 {base: 'GB/T 18894', year: '2016', code: 'GB/T 18894-2016', rest}；不是标准编号返回 null */
export function parseStandardCode(text) {
  const m = CODE_RE.exec(String(text || '').trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const kind = m[2] ? `/${m[2].toUpperCase()}` : '';
  const no = m[3].replace(/\s+/g, '');
  // 「DAT 101-202」这类文件名里的年份残缺，宁可不写年份；老标准的两位年份（DA/T 9-94）补全，免得和「DA/T 9-1994」各算一份
  let year = m[4] && m[4].length !== 3 ? m[4] : '';
  if (year.length === 2) year = `${Number(year) > 50 ? '19' : '20'}${year}`;
  const base = `${prefix}${kind} ${no}`;
  return { base, year, code: year ? `${base}-${year}` : base, rest: String(text).trim().slice(m[0].length) };
}

/** 以标准编号开头的实体名只留统一写法的编号（标题由抽取放进 aliases），其它名称原样返回 */
export function normalizeStandardName(name) {
  const s = String(name || '').trim();
  const p = parseStandardCode(s);
  return p ? p.code : s;
}

/** 从文件名拆出编号与标题：「GBT 18894-2016《电子文件归档与电子档案管理规范》.pdf」 */
export function parseDocName(fileName) {
  const stem = path.basename(fileName).replace(/\.[a-z0-9]+$/i, '').trim();
  const book = stem.match(/《([^》]+)》/);
  const p = parseStandardCode(stem.replace(/^《/, ''));
  let title = book ? book[1] : (p ? p.rest : stem);
  title = title.replace(/[_＿].*$/, '').replace(/^[\s:：、\-—]+|[\s\d]+$/g, '').trim() || stem;
  return { code: p ? p.code : '', base: p ? p.base : '', title };
}

// ───────────── 预设 ─────────────

const STD = ['Standard'];
const CONCEPTS = ['Term', 'RecordType', 'Process', 'Element', 'Technology'];

const STANDARDS = {
  id: 'standards',
  name: '标准规范与制度',
  description: '国家标准、行业标准、地方标准与法规制度：理清各份文件管什么、互相怎么引用，术语怎么定义，业务环节有哪些要求。',
  ontology: (id) => ({
    version: `${id}-standards-v1`,
    entityTypes: [
      { code: 'Standard', name: '规范文件', description: '标准、法律、法规、规章、办法、规定等规范性文件；标准用编号作名称（如「GB/T 18894-2016」「DA/T 22-2015」），法规用全称（如「中华人民共和国档案法」）' },
      { code: 'Term', name: '术语', description: '文件中定义或反复使用的专业概念（电子档案、元数据、归档、真实性、保管期限…）' },
      { code: 'RecordType', name: '门类', description: '档案、文件、数据的门类与对象（文书档案、照片档案、录音录像档案、会计档案、电子文件、纸质档案…）' },
      { code: 'Process', name: '业务环节', description: '业务活动与工作环节（收集、整理、归档、著录、鉴定、移交、保管、利用、销毁、数字化、迁移…）' },
      { code: 'Element', name: '著录项', description: '著录项目、元数据元素、数据字段（题名、责任者、档号、保管期限、文件形成时间…）' },
      { code: 'Technology', name: '技术载体', description: '格式、系统、设备、载体与技术手段（OFD、PDF/A、XML、光盘、磁带、电子档案管理系统、数字签名…）' },
      { code: 'Organization', name: '机构', description: '机关、单位、部门与角色（国家档案局、档案馆、立档单位、档案部门、形成部门…）' },
    ],
    predicates: [
      { code: 'CITES', name: '引用', domain: STD, range: STD, hint: 'A 引用、依据 B（规范性引用文件、「根据《档案法》制定」、「应参照 B 执行」）' },
      { code: 'SUPERSEDES', name: '代替', domain: STD, range: STD, hint: 'A 代替或废止 B（新版代替旧版：「本标准代替 DA/T 22-2000」）' },
      { code: 'DEFINES', name: '定义', domain: STD, range: CONCEPTS, hint: 'A 在「术语和定义」等条款里给出 B 的定义' },
      { code: 'SPECIFIES', name: '规定', domain: STD, range: [...CONCEPTS, 'Organization'], hint: 'A 对 B 提出要求或作出规定（如某标准规定归档范围、整理方法、元数据）' },
      { code: 'APPLIES_TO', name: '适用于', domain: STD, range: ['RecordType', 'Organization', 'Process'], hint: 'A 适用于 B（「本标准适用于……」的范围条款）' },
      { code: 'ISSUED_BY', name: '发布', domain: STD, range: ['Organization'], hint: 'A 由 B 发布、提出或归口' },
      { code: 'RESPONSIBLE_FOR', name: '负责', domain: ['Organization'], range: ['Process', 'RecordType', 'Technology'], hint: '机构 A 负责 B（「档案部门负责……」）' },
      { code: 'IS_A', name: '属于', domain: CONCEPTS, range: CONCEPTS, hint: 'A 是 B 的一种（下位概念：「照片档案」属于「档案」）' },
      { code: 'PART_OF', name: '组成', domain: CONCEPTS, range: CONCEPTS, hint: 'A 是 B 的组成部分或子环节（「组件」组成「电子档案」，「编目」是「整理」的环节）' },
      { code: 'PRECEDES', name: '先于', domain: ['Process'], range: ['Process'], hint: '业务流程中 A 在 B 之前（「整理」先于「归档」）' },
      { code: 'PRODUCES', name: '形成', domain: ['Process', 'Organization'], range: ['RecordType', 'Element', 'Term'], hint: 'A 形成、产生 B（「归档」形成「归档数据包」）' },
      { code: 'USES', name: '采用', domain: ['Process', 'RecordType', 'Technology', 'Organization'], range: ['Technology', 'Element'], hint: 'A 采用、使用、存储于 B（「电子档案」采用「OFD」格式）' },
      { code: 'HAS_ELEMENT', name: '著录', domain: ['RecordType', 'Process', 'Technology'], range: ['Element'], hint: 'A 需要著录或包含著录项/元数据 B' },
      { code: 'RELATED', name: '相关', domain: CONCEPTS, range: CONCEPTS, symmetric: true, hint: '两个概念在条文里相互关联、并列或需要对照理解' },
    ],
  }),
  terms: {
    segment: '段', segments: '段原文', cluster: '主题群', community: '知识板块', hub: '核心条目',
    primary: '条目', secondary: '文件', evidence: '原文',
  },
  galaxy: { primaryTypes: ['Term', 'Process', 'RecordType'], secondaryTypes: ['Standard', 'Element', 'Technology', 'Organization'] },
  noteTypes: ['Standard', 'Term', 'Process', 'RecordType'],
  rules: {
    S1: { name: '引用缺口', hint: '被几份文件引用、专题里却没有的标准，值得补上' },
    S2: { name: '版本滞后', hint: '引用的是旧版本，而专题里已经有新版' },
    S3: { name: '定义并存', hint: '同一个术语在几份文件里各有定义，值得对照着读' },
  },
  props: [
    { key: 'role', label: '分类' },
    { key: 'description', label: '说明' },
  ],
  examples: { search: '电子档案、归档', from: '归档', to: '移交' },
  prompts: { cluster: '「电子文件归档」「档案数字化」「档案保管与保护」', community: '「元数据标准族」「纸质档案整理」「档案法规体系」' },
  extractRules: [
    '标准一律用编号作名称，写成「GB/T 18894-2016」「DA/T 22-2015」「DB32/T 4708-2024」这种格式（斜杠、空格、半角连字符）；正文只写了不带年份的编号（如「DA/T 31」）就照写不带年份的；标准名称放 aliases。',
    '法律法规、规章制度用全称作名称（「档案法」写「中华人民共和国档案法」）；当前文件自身在原文里称「本标准」「本规范」「本办法」时，写成片段开头给出的本文件编号（没有编号的写全称）。',
    '术语与概念用文件里的规范说法（「电子文件」「电子档案」「归档」），英文对应词放 aliases；description 写定义的要点（≤40字）。',
    '「规范性引用文件」一节里列出的每份文件都要抽 CITES；「代替」「废止」写 SUPERSEDES。',
    '条款编号（「5.2.1」）、表号图号、示例里的具体数据不作为实体。',
  ],
  seedNoun: '文件',
  purpose: {
    zh: {
      goal: '弄清每份文件管什么、适用于谁，术语怎么定义，业务环节有哪些要求，文件之间怎么引用和代替。',
      focus: '标准之间的引用与代替、术语的定义出处、业务环节的要求与先后、门类适用的标准',
      questions: ['电子档案归档要遵循哪些标准？', '「电子档案」在不同标准里是怎么定义的？', '纸质档案数字化涉及哪些环节和要求？', '哪些文件规定了保管期限？'],
    },
    en: {
      goal: 'See what each document governs and who it applies to, how terms are defined, what each step of the work requires, and how documents cite or replace each other.',
      focus: 'citations and replacements between standards, where each term is defined, requirements and order of work steps',
      questions: ['Which standards govern archiving electronic records?', 'How do different standards define "electronic records"?', 'What steps and requirements does digitizing paper archives involve?', 'Which documents set retention periods?'],
    },
  },
  normalizeName: normalizeStandardName,
};

const GENERAL = {
  id: 'general',
  name: '通用资料',
  description: '讲义、报告、技术文档等：把资料里的概念、人物、机构和方法连成一张网。',
  ontology: (id) => ({
    version: `${id}-general-v1`,
    entityTypes: [
      { code: 'Concept', name: '概念', description: '资料中的核心概念、术语、主题' },
      { code: 'Method', name: '方法', description: '方法、技术、流程、工具' },
      { code: 'Person', name: '人物', description: '具名的人物' },
      { code: 'Organization', name: '机构', description: '机构、单位、组织、项目团队' },
      { code: 'Document', name: '文献', description: '书、论文、标准、文件等被提到的文献' },
      { code: 'Event', name: '事件', description: '有名目的事件、会议、项目' },
    ],
    predicates: [
      { code: 'IS_A', name: '属于', domain: ['Concept', 'Method'], range: ['Concept', 'Method'], hint: 'A 是 B 的一种' },
      { code: 'PART_OF', name: '组成', domain: ['Concept', 'Method'], range: ['Concept', 'Method'], hint: 'A 是 B 的组成部分' },
      { code: 'PREREQUISITE', name: '前置', domain: ['Concept', 'Method'], range: ['Concept', 'Method'], hint: '理解 B 之前要先掌握 A' },
      { code: 'USES', name: '采用', domain: ['Concept', 'Method', 'Organization', 'Person'], range: ['Method', 'Concept'], hint: 'A 采用、使用 B' },
      { code: 'PROPOSED', name: '提出', domain: ['Person', 'Organization', 'Document'], range: ['Concept', 'Method'], hint: 'A 提出或定义 B' },
      { code: 'AUTHORED', name: '撰写', domain: ['Person', 'Organization'], range: ['Document'], hint: 'A 撰写、发布 B' },
      { code: 'CITES', name: '引用', domain: ['Document'], range: ['Document'], hint: '文献 A 引用 B' },
      { code: 'MEMBER_OF', name: '归属', domain: ['Person'], range: ['Organization'], hint: 'A 属于机构 B' },
      { code: 'PARTICIPATED_IN', name: '参与', domain: ['Person', 'Organization'], range: ['Event'], hint: 'A 参与事件 B' },
      { code: 'RELATED', name: '相关', domain: ['Concept', 'Method'], range: ['Concept', 'Method'], symmetric: true, hint: '两个概念相互关联' },
      { code: 'CONTRASTS', name: '对照', domain: ['Concept', 'Method'], range: ['Concept', 'Method'], symmetric: true, hint: '两个概念被对照比较' },
    ],
  }),
  terms: {
    segment: '段', segments: '段原文', cluster: '主题群', community: '知识板块', hub: '核心条目',
    primary: '概念', secondary: '人物与机构', evidence: '原文',
  },
  galaxy: { primaryTypes: ['Concept', 'Method'], secondaryTypes: ['Person', 'Organization', 'Document', 'Event'] },
  noteTypes: ['Concept', 'Method'],
  rules: {},
  props: [
    { key: 'role', label: '类别' },
    { key: 'description', label: '说明' },
  ],
  examples: { search: '', from: '', to: '' },
  prompts: { cluster: '「核心概念」「方法与流程」', community: '「同一主题的概念群」' },
  extractRules: [
    '概念与方法用资料里的规范说法，英文对应词放 aliases；description 写定义要点（≤40字）。',
    '章节编号、图表编号、示例里的具体数据不作为实体。',
  ],
  seedNoun: '文件',
  purpose: {
    zh: { goal: '弄清资料里的核心概念怎么定义、彼此怎么关联，以及依据哪些原文。', focus: '概念的定义、组成、前置与应用', questions: [] },
    en: { goal: 'Understand how the key ideas in the material are defined and connected, and which passages support each link.', focus: 'definitions, parts, prerequisites and uses of the key ideas', questions: [] },
  },
  normalizeName: (s) => String(s || '').trim(),
};

export const PRESETS = { standards: STANDARDS, general: GENERAL };

export function presetList() {
  return Object.values(PRESETS).map((p) => ({ id: p.id, name: p.name, description: p.description }));
}

/** topic.json → 图谱配置（结构与 domains/index.js 里的固定图谱一致） */
export function topicGraph(meta) {
  const preset = PRESETS[meta.preset] || GENERAL;
  const name = meta.name || meta.id;
  return {
    id: meta.id,
    name,
    book: name,
    category: 'topic',
    kind: 'topic',
    topic: true,
    preset: preset.id,
    description: meta.description || preset.description,
    cover: meta.cover || null,
    source: { name: '本地资料', url: '' },
    created_at: meta.created_at,
    dataDir: topicDir(meta.id),
    ontology: makeOntology(preset.ontology(meta.id)),
    unit: { name: '份', axis: '文件', total: 0, template: '第{n}份' },
    periodSize: 10,
    terms: preset.terms,
    galaxy: preset.galaxy,
    noteTypes: preset.noteTypes,
    rules: { ...preset.rules },
    gapUnits: 30,
    examples: meta.examples || preset.examples,
    props: preset.props,
    prompts: {
      role: `「${name}」专题研究者`,
      clusterExamples: preset.prompts.cluster,
      communityExamples: preset.prompts.community,
    },
    extract: {
      role: `「${name}」专题知识图谱抽取器`,
      rules: preset.extractRules,
      seedNoun: preset.seedNoun,
    },
    normalizeName: preset.normalizeName,
    purpose: meta.purpose || preset.purpose,
  };
}

/** 启动时读全部专题配置（同步：模块加载阶段就要注册好图谱） */
export function readTopicMeta(id) {
  if (!TOPIC_ID_RE.test(String(id || ''))) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(TOPIC_ROOT, id, 'topic.json'), 'utf8'));
    return meta?.id === id ? meta : null;
  } catch {
    // 没有 topic.json 的目录不是专题
    return null;
  }
}

export function readTopicMetas() {
  if (!fs.existsSync(TOPIC_ROOT)) return [];
  return fs.readdirSync(TOPIC_ROOT).sort().map(readTopicMeta).filter(Boolean);
}

export function writeTopicMeta(meta) {
  const file = path.join(topicDir(meta.id), 'topic.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
