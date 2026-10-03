// 图谱目录：每个图谱一份配置（本体 / 单元叫法 / 术语 / 提示词 / 线索规则 / 前端文案），
// 服务端查询、构建任务、数据管线和前端都从这里取各图谱的差异。
import path from 'node:path';
import { localizeProfile } from '../locale.js';
import { makeOntology } from '../ontology.js';
import {
  FOREIGN_TYPES, MATH_ONTOLOGY, NOVEL_TYPES, LUNYU_ONTOLOGY, LIAOZHAI_ONTOLOGY, SHIJI_ONTOLOGY, foreignPredicates, novelPredicates,
} from './presets.js';
import { purposeOf, setPurpose } from './purpose.js';
import { readTopicMeta, readTopicMetas, topicGraph } from './topics.js';

export const GRAPH_ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

const NOVEL_PROPS = [
  { key: 'nickname', label: '绰号' },
  { key: 'role', label: '身份' },
  { key: 'description', label: '简介' },
];

const NOVEL_RULES = {
  R1: { name: '关系反转', hint: '同一对人物既有亲近关系又有敌对关系' },
  R2: { name: '死后再现', hint: '被杀之后仍出现在后续章回的事实里' },
  R3: { name: '出场断档', hint: '主要人物两次出场之间隔了很多回' },
  R4: { name: '籍贯冲突', hint: '籍贯等单值关系出现多种说法' },
};

function novel({ id, name, book, description, cover, units, periodSize = 10, extraPredicates = [], dropPredicates = [], rename = {},
  rules = ['R1', 'R2', 'R3', 'R4'], examples, props = NOVEL_PROPS, prompts, extract, sourceUrl, seedNoun = '主要人物' }) {
  return {
    id,
    name,
    book,
    category: 'literature',
    kind: 'novel',
    description,
    cover,
    source: { name: '5000言', url: sourceUrl },
    ontology: makeOntology({
      version: `${id}-v1`,
      entityTypes: NOVEL_TYPES,
      predicates: novelPredicates({ extra: extraPredicates, drop: dropPredicates, rename }),
    }),
    unit: { name: '回', axis: '章回', total: units, template: '第{n}回' },
    periodSize,
    terms: {
      segment: '段', segments: '段原文', cluster: '情节群', community: '团伙', hub: '枢纽人物',
      primary: '人物', secondary: '地点', evidence: '原文',
    },
    galaxy: { primaryTypes: ['Person'], secondaryTypes: ['Place', 'Organization'] },
    rules: Object.fromEntries(rules.map((r) => [r, NOVEL_RULES[r]])),
    gapUnits: Math.max(8, Math.round(units * 0.2)),
    examples,
    props,
    prompts: {
      role: `《${book}》研究者`,
      clusterExamples: prompts.cluster,
      communityExamples: prompts.community,
    },
    extract: {
      role: `《${book}》知识图谱抽取器`,
      rules: extract,
      seedNoun,
    },
  };
}

const SHUIHU = novel({
  id: 'shuihu',
  name: '水浒传',
  book: '水浒传',
  description: '一百单八将聚义梁山、受招安、征四寇。理清好汉的来历、座次与恩怨，120 回全本。',
  cover: '/media/covers/shuihu.jpg',
  units: 120,
  sourceUrl: 'https://shuihu.5000yan.com/',
  examples: { search: '及时雨、景阳冈', from: '林冲', to: '高俅' },
  props: [
    { key: 'nickname', label: '绰号' },
    { key: 'star', label: '星号' },
    { key: 'rank', label: '座次' },
    { key: 'role', label: '梁山职司' },
    { key: 'description', label: '简介' },
  ],
  prompts: {
    cluster: '「武松复仇」「梁山排座次」「征辽战事」',
    community: '「二龙山一伙」「祝家庄之战」「高俅集团」',
  },
  extract: [
    '人物一律用规范本名（如「宋公明」「及时雨」都写「宋江」；「武二郎」写「武松」）；绰号放 nickname，其它称呼放 aliases。',
    '「梁山泊」作地点，「梁山泊好汉/山寨」作势力时写「梁山泊」势力。',
    '事件实体用简洁的情节名（如「智取生辰纲」「景阳冈打虎」），只在片段叙述该事件时抽取。',
    '例：史进说「我的师父王教头」→ {"subject":"王进","predicate":"MASTER_OF","object":"史进"}；「林冲投奔柴进庄上」→ {"subject":"林冲","predicate":"SERVED","object":"柴进"}。',
  ],
  seedNoun: '梁山好汉',
});

const XIYOUJI = novel({
  id: 'xiyouji',
  name: '西游记',
  book: '西游记',
  description: '唐僧师徒西天取经、历经九九八十一难。看清各路妖怪的来历与师徒分合，100 回全本。',
  cover: '/media/covers/xiyouji.jpg',
  units: 100,
  sourceUrl: 'https://xiyouji.5000yan.com/',
  rules: ['R1', 'R3', 'R4'],
  rename: { DEFEATED: '降伏', STATIONED_AT: '盘踞', NATIVE_OF: '出身', SERVED: '效力' },
  dropPredicates: ['SWORN_BROTHER', 'RECRUITED'],
  extraPredicates: [
    { code: 'ORIGIN_OF', name: '来历', domain: ['Person'], range: ['Person'], hint: 'A 原是 B 的坐骑/童子/宠物/门下（妖怪的来历）' },
    { code: 'TRANSFORMED', name: '变化', domain: ['Person'], range: ['Person', 'Item'], hint: 'A 变化成 B 的模样（假扮）' },
  ],
  examples: { search: '孙悟空、火焰山', from: '孙悟空', to: '牛魔王' },
  props: [
    { key: 'nickname', label: '名号' },
    { key: 'role', label: '身份' },
    { key: 'description', label: '简介' },
  ],
  prompts: { cluster: '「三打白骨精」「大闹天宫」「女儿国」', community: '「取经团队」「天庭众神」「狮驼岭三魔」' },
  extract: [
    '角色一律用最通行的名字（「美猴王」「齐天大圣」「行者」「悟空」都写「孙悟空」；「三藏」「唐长老」写「唐僧」；「八戒」「呆子」写「猪八戒」）；名号放 nickname，其它称呼放 aliases。',
    '神佛、妖怪、凡人都作 Person；天庭、灵山、妖洞、国度作 Organization；法宝兵器作 Item；每一难作 Event（如「三打白骨精」）。',
    '「降伏」指 A 收服或打败 B；妖怪被菩萨收回本相时用 ORIGIN_OF 记来历。',
  ],
  seedNoun: '主要角色',
});

const HONGLOUMENG = novel({
  id: 'hongloumeng',
  name: '红楼梦',
  book: '红楼梦',
  description: '贾史王薛四大家族的兴衰与宝黛爱情悲剧。分清人物的亲缘、主仆与情感关系，120 回全本。',
  cover: '/media/covers/hongloumeng.jpg',
  units: 120,
  sourceUrl: 'https://hongloumeng.5000yan.com/',
  rules: ['R1', 'R2', 'R3', 'R4'],
  rename: { SPOUSE: '婚配', FRIEND: '交好', RESCUED: '帮衬', FRAMED: '陷害', STATIONED_AT: '居住', MEMBER_OF: '归属', LEADS: '当家', KILLED: '致死' },
  dropPredicates: ['SWORN_BROTHER', 'RECRUITED', 'FOUGHT', 'DEFEATED', 'ATTACKED', 'SURRENDERED_TO', 'ALLIED_WITH'],
  extraPredicates: [
    { code: 'LOVES', name: '爱慕', domain: ['Person'], range: ['Person'], tone: 'positive', hint: 'A 爱慕/钟情于 B' },
    { code: 'SERVANT_OF', name: '主仆', domain: ['Person'], range: ['Person'], hint: 'A 是 B 的丫鬟/小厮/奶娘等仆从' },
    { code: 'QUARRELED', name: '争执', domain: ['Person'], range: ['Person'], symmetric: true, tone: 'hostile', hint: 'A 与 B 口角、争吵、结怨' },
  ],
  examples: { search: '林黛玉、大观园', from: '贾宝玉', to: '薛宝钗' },
  props: [
    { key: 'nickname', label: '字号' },
    { key: 'role', label: '身份' },
    { key: 'description', label: '简介' },
  ],
  prompts: { cluster: '「黛玉葬花」「元妃省亲」「抄检大观园」', community: '「宁国府」「大观园诗社」「王熙凤一系」' },
  extract: [
    '人物一律用规范全名（「宝玉」「宝二爷」写「贾宝玉」；「凤姐」「琏二奶奶」写「王熙凤」；「颦儿」写「林黛玉」）；字号放 nickname，其它称呼放 aliases。',
    '府第、家族作 Organization（如「荣国府」「贾府」），园林院落作 Place（如「大观园」「潇湘馆」）。',
    'SERVANT_OF 的主语是仆从：「袭人是宝玉的丫鬟」→ {"subject":"袭人","predicate":"SERVANT_OF","object":"贾宝玉"}。',
  ],
});

const SANGUO = novel({
  id: 'sanguo',
  name: '三国演义',
  book: '三国演义',
  description: '东汉末年群雄逐鹿、三分天下直至归晋。追踪人物的效力、归降与反目，120 回全本。',
  cover: '/media/covers/sanguo.jpg',
  units: 120,
  sourceUrl: 'https://sanguo.5000yan.com/',
  rename: { SERVED: '效力', STATIONED_AT: '镇守', MASTERMINDED: '谋划', SURRENDERED_TO: '归降' },
  dropPredicates: ['RECRUITED'],
  extraPredicates: [
    { code: 'BETRAYED', name: '背叛', domain: ['Person'], range: ['Person', 'Organization'], tone: 'hostile', hint: 'A 背叛/反叛 B' },
  ],
  examples: { search: '诸葛亮、赤壁', from: '关羽', to: '曹操' },
  props: [
    { key: 'nickname', label: '表字' },
    { key: 'role', label: '官职' },
    { key: 'description', label: '简介' },
  ],
  prompts: { cluster: '「赤壁之战」「三顾茅庐」「六出祁山」', community: '「蜀汉集团」「江东孙氏」「董卓集团」' },
  extract: [
    '人物一律用姓名（「孔明」「卧龙」「诸葛丞相」写「诸葛亮」；「玄德」「刘皇叔」写「刘备」）；表字放 nickname，其它称呼放 aliases。',
    '魏、蜀、吴、各路诸侯军马作 Organization；战役作 Event（如「官渡之战」「火烧赤壁」）。',
    'SERVED 表示 A 效力于主公 B；BETRAYED 表示 A 背叛 B。',
  ],
});

const FOREIGN_RULES = {
  R1: { name: '关系反转', hint: '同一对人物既有亲近关系又有敌对关系，常是误会或转变的地方' },
  R2: { name: '死后再现', hint: '已经死去的人物在后面的章节里仍有事实' },
  R3: { name: '出场断档', hint: '主要人物两次出场之间隔了很多章' },
};

const FOREIGN_PROPS = [
  { key: 'nickname', label: '译名' },
  { key: 'role', label: '身份' },
  { key: 'description', label: '简介' },
];

/** 外国名著：Project Gutenberg 英文原文；实体用英文规范名对得上原文，译名给中文读者 */
function foreign({ id, name, book, title, author, description, cover, ebook, unit, units, periodSize, rules = ['R1', 'R2', 'R3'],
  extraPredicates = [], dropPredicates = [], rename = {}, examples, prompts, extract, seedNoun = '主要人物', terms = {} }) {
  return {
    id,
    name,
    book,
    title,
    author,
    category: 'foreign',
    kind: 'novel',
    lang: 'en',
    description,
    cover,
    ebook,
    source: { name: 'Project Gutenberg', url: `https://www.gutenberg.org/ebooks/${ebook}` },
    ontology: makeOntology({
      version: `${id}-v1`,
      entityTypes: FOREIGN_TYPES,
      predicates: foreignPredicates({ extra: extraPredicates, drop: dropPredicates, rename }),
    }),
    unit: { name: unit, axis: unit, total: units, template: `第{n}${unit}` },
    periodSize,
    terms: {
      segment: '段', segments: '段原文', cluster: '情节群', community: '人物圈', hub: '枢纽人物',
      primary: '人物', secondary: '地点', evidence: '原文', ...terms,
    },
    galaxy: { primaryTypes: ['Person'], secondaryTypes: ['Place', 'Organization'] },
    rules: Object.fromEntries(rules.map((r) => [r, FOREIGN_RULES[r]])),
    gapUnits: Math.max(3, Math.round(units * 0.25)),
    examples,
    props: FOREIGN_PROPS,
    prompts: {
      role: `${author}《${book}》研究者`,
      clusterExamples: prompts.cluster,
      communityExamples: prompts.community,
    },
    extract: {
      role: `《${book}》知识图谱抽取器`,
      rules: extract,
      seedNoun,
    },
  };
}

const PRIDE = foreign({
  id: 'pride',
  name: '傲慢与偏见',
  book: '傲慢与偏见',
  title: 'Pride and Prejudice',
  author: '简·奥斯汀',
  description: '班纳特家五姐妹的婚事与伊丽莎白和达西的误会与和解。理清乡绅家族的亲缘、求婚与偏见，英文原著 61 章，附 Hugh Thomson 插图。',
  cover: '/media/covers/pride.jpg',
  ebook: 1342,
  unit: '章',
  units: 61,
  periodSize: 6,
  examples: { search: 'Elizabeth、彭伯里', from: 'Elizabeth Bennet', to: 'Fitzwilliam Darcy' },
  prompts: { cluster: '「尼日斐舞会」「亨斯福德求婚」「莉迪亚私奔」', community: '「班纳特一家」「宾利姐妹」「罗新斯庄园」' },
  extract: [
    '「Mr. Darcy」「Darcy」写「Fitzwilliam Darcy」；「Lizzy」「Eliza」「Miss Bennet（指伊丽莎白时）」写「Elizabeth Bennet」；「Miss Bennet」在书中通常指长女 Jane Bennet，按上下文判断。',
    '庄园宅邸作 Place（Longbourn、Netherfield、Pemberley、Rosings），家族作 Organization（如 Bennet family）。',
  ],
});

const ALICE = foreign({
  id: 'alice',
  name: '爱丽丝梦游仙境',
  book: '爱丽丝梦游仙境',
  title: 'Alice’s Adventures in Wonderland',
  author: '刘易斯·卡罗尔',
  description: '爱丽丝掉进兔子洞，遇见柴郡猫、疯帽匠与红心王后。看清奇境角色在 12 章里的出场与交集，附 Arthur Rackham 插图。',
  cover: '/media/covers/alice.jpg',
  ebook: 11,
  unit: '章',
  units: 12,
  periodSize: 2,
  rules: ['R1', 'R3'],
  extraPredicates: [
    { code: 'TRANSFORMED', name: '变化', domain: ['Person'], range: ['Person', 'Item'], hint: 'A 变大变小或变成 B（如婴儿变成小猪）' },
  ],
  examples: { search: 'Cheshire Cat、茶会', from: 'Alice', to: 'Queen of Hearts' },
  prompts: { cluster: '「疯狂茶会」「槌球比赛」「审判红桃杰克」', community: '「红心王室」「茶会三人组」「海边的伙伴」' },
  extract: [
    '会说话的动物和扑克牌都作 Person，用书中带定冠词以外的称呼（「the White Rabbit」写「White Rabbit」，「the Hatter」写「Hatter」，「the Queen」指红心王后时写「Queen of Hearts」）。',
    '「Alice」就写「Alice」，不要补姓。',
    '红心王后的园丁写全名「Two of Spades」「Five of Spades」「Seven of Spades」；公爵夫人怀里的婴儿写「Duchess’s Baby」；白兔家门牌上的「W. RABBIT」是白兔的房子，写「White Rabbit’s house」。',
  ],
  seedNoun: '主要角色',
});

const SHERLOCK = foreign({
  id: 'sherlock',
  name: '福尔摩斯冒险史',
  book: '福尔摩斯冒险史',
  title: 'The Adventures of Sherlock Holmes',
  author: '阿瑟·柯南·道尔',
  description: '福尔摩斯与华生的 12 个探案故事。按案件把委托人、嫌疑人与线索物品连起来，附 Sidney Paget 插图与格拉纳达版剧集对照。',
  cover: '/media/covers/sherlock.jpg',
  ebook: 1661,
  unit: '篇',
  units: 12,
  periodSize: 3,
  rules: ['R1', 'R2'],
  extraPredicates: [
    { code: 'INVESTIGATED', name: '侦办', domain: ['Person'], range: ['Event', 'Person'], hint: 'A 调查案件或调查某人 B' },
    { code: 'CLIENT_OF', name: '委托', domain: ['Person'], range: ['Person'], hint: 'A 向侦探 B 求助、委托 B 办案' },
    { code: 'SUSPECTED', name: '怀疑', domain: ['Person'], range: ['Person'], hint: 'A 怀疑 B 有罪' },
    { code: 'STOLE', name: '盗取', domain: ['Person'], range: ['Item'], tone: 'hostile', hint: 'A 偷走、盗取物品 B' },
  ],
  examples: { search: 'Irene Adler、蓝宝石', from: 'Sherlock Holmes', to: 'Irene Adler' },
  prompts: { cluster: '「波希米亚丑闻」「红发会」「斑点带子」', community: '「贝克街 221B」「斯托纳家」「警方」' },
  extract: [
    '「Holmes」写「Sherlock Holmes」；叙述者「I」「Doctor」写「John Watson」。',
    '每个故事的案件作 Event（如「A Scandal in Bohemia」案），委托人与侦探之间用 CLIENT_OF，侦探与案件之间用 INVESTIGATED。',
    '各篇相互独立，同名不同人的配角（如两个不同的 Mr. Windibank）在 description 里写明所在篇名。',
  ],
  seedNoun: '各篇主要人物',
  terms: { cluster: '案件群', community: '案件圈' },
});

const ROMEO = foreign({
  id: 'romeo',
  name: '罗密欧与朱丽叶',
  book: '罗密欧与朱丽叶',
  title: 'Romeo and Juliet',
  author: '威廉·莎士比亚',
  description: '维罗纳两大世仇家族之间的悲剧爱情。按 5 幕 24 场追踪两家人物的亲缘、决斗与死亡，附 1968 年电影对照。',
  cover: '/media/covers/romeo.jpg',
  ebook: 1513,
  unit: '场',
  units: 24,
  periodSize: 5,
  extraPredicates: [
    { code: 'FEUDS_WITH', name: '世仇', domain: ['Person', 'Organization'], range: ['Person', 'Organization'], symmetric: true, tone: 'hostile', hint: 'A 与 B 两家或两人是世仇' },
    { code: 'FOUGHT', name: '决斗', domain: ['Person'], range: ['Person'], symmetric: true, tone: 'hostile', hint: 'A 与 B 拔剑相斗' },
  ],
  examples: { search: 'Juliet、阳台', from: 'Romeo', to: 'Tybalt' },
  prompts: { cluster: '「凯普莱特家宴」「阳台相会」「墓穴殉情」', community: '「蒙太古家族」「凯普莱特家族」「维罗纳亲王府」' },
  extract: [
    '剧本台词前的大写人名（如「ROMEO.」「NURSE.」）是说话人，人物名用剧中通行写法（Romeo、Juliet、Nurse、Friar Lawrence、Lady Capulet）。',
    '两大家族作 Organization（House of Montague、House of Capulet）。',
  ],
  terms: { segment: '段', segments: '段台词' },
});

const GATSBY = foreign({
  id: 'gatsby',
  name: '了不起的盖茨比',
  book: '了不起的盖茨比',
  title: 'The Great Gatsby',
  author: 'F. 斯科特·菲茨杰拉德',
  description: '尼克眼中的盖茨比、黛西与汤姆在长岛的夏天。九章里人物的爱慕、欺瞒与那场车祸一目了然。',
  cover: '/media/covers/gatsby.jpg',
  ebook: 64317,
  unit: '章',
  units: 9,
  periodSize: 1,
  examples: { search: 'Daisy、西卵', from: 'Jay Gatsby', to: 'Tom Buchanan' },
  prompts: { cluster: '「盖茨比的派对」「广场饭店摊牌」「灰谷车祸」', community: '「布坎南夫妇」「东卵与西卵」「威尔逊夫妇」' },
  extract: [
    '叙述者「I」写「Nick Carraway」；「Gatsby」写「Jay Gatsby」；「Daisy」写「Daisy Buchanan」；「Tom」写「Tom Buchanan」。',
    '东卵、西卵、灰谷、纽约等作 Place。',
  ],
});

const JANE_EYRE = foreign({
  id: 'janeeyre',
  name: '简·爱',
  book: '简·爱',
  title: 'Jane Eyre',
  author: '夏洛蒂·勃朗特',
  description: '孤女简·爱从盖茨海德、劳渥德到桑菲尔德的成长与爱情。理清她与里德家、罗切斯特和里弗斯兄妹的关系，英文原著 38 章，附 F. H. Townsend 插图。',
  cover: '/media/covers/janeeyre.jpg',
  ebook: 1260,
  unit: '章',
  units: 38,
  periodSize: 5,
  examples: { search: 'Rochester、桑菲尔德', from: 'Jane Eyre', to: 'Edward Rochester' },
  prompts: { cluster: '「红房子」「桑菲尔德大火」「婚礼中断」', community: '「里德一家」「桑菲尔德府」「里弗斯兄妹」' },
  extract: [
    '叙述者「I」写「Jane Eyre」；「Mr. Rochester」写「Edward Rochester」；「St. John」写「St. John Rivers」。',
    '盖茨海德、劳渥德、桑菲尔德、沼泽居、芬丁庄园作 Place。',
  ],
});

const LUNYU = {
  id: 'lunyu',
  name: '论语',
  book: '论语',
  category: 'classics',
  kind: 'analects',
  description: '孔子及其弟子的言行录，20 篇。按人物和仁、礼、孝等核心概念串起语录，附白话译文参考。',
  cover: '/media/covers/lunyu.jpg',
  source: { name: '5000言', url: 'https://lunyu.5000yan.com/' },
  ontology: makeOntology(LUNYU_ONTOLOGY),
  unit: { name: '篇', axis: '篇', total: 20, template: '第{n}篇' },
  periodSize: 4,
  terms: {
    segment: '章', segments: '章原文', cluster: '议题群', community: '师门', hub: '核心人物',
    primary: '人物', secondary: '概念', evidence: '原文',
  },
  galaxy: { primaryTypes: ['Person'], secondaryTypes: ['Concept'] },
  rules: {
    R1: { name: '褒贬转向', hint: '对同一人先称许后批评（或相反）' },
    R4: { name: '国别冲突', hint: '同一人物出现多个国别' },
  },
  gapUnits: 8,
  examples: { search: '颜回、仁', from: '子路', to: '颜回' },
  props: [
    { key: 'nickname', label: '字' },
    { key: 'role', label: '身份' },
    { key: 'description', label: '简介' },
  ],
  prompts: { role: '《论语》研究者', clusterExamples: '「论仁」「为政以德」「孝悌之道」', communityExamples: '「孔门德行科」「鲁国君臣」' },
  extract: {
    role: '《论语》知识图谱抽取器',
    rules: [
      '人物一律用通行称呼（「子」「夫子」「仲尼」写「孔子」；「回」「颜渊」写「颜回」；「由」「仲由」写「子路」；「赐」写「子贡」）；字放 nickname。',
      '概念（Concept）只取儒家核心范畴：仁、礼、义、孝、悌、忠、恕、信、君子、小人、德、政、学、知、中庸等。',
      '「子曰」类语录：孔子阐述某概念 → {"subject":"孔子","predicate":"DISCUSSED","object":"仁"}；弟子问某事 → ASKED 指向孔子，并补一条 DISCUSSED。',
      '可参考译文理解，但 evidence 必须摘自原文。',
    ],
    seedNoun: '孔门弟子与重要人物',
  },
};

const LIAOZHAI = {
  id: 'liaozhai',
  name: '聊斋志异',
  book: '聊斋志异',
  category: 'literature',
  kind: 'zhiguai',
  description: '蒲松龄笔下的狐鬼花妖与人间世情。494 篇文言短篇按题材归类，快速找到同类故事。',
  cover: '/media/covers/liaozhai.jpg',
  source: { name: '5000言', url: 'https://liaozhai.5000yan.com/' },
  ontology: makeOntology(LIAOZHAI_ONTOLOGY),
  unit: { name: '篇', axis: '篇目', total: 494, template: '第{n}篇' },
  periodSize: 50,
  terms: {
    segment: '段', segments: '段原文', cluster: '题材群', community: '故事群', hub: '关键角色',
    primary: '人物', secondary: '精怪', evidence: '原文',
  },
  galaxy: { primaryTypes: ['Person'], secondaryTypes: ['Spirit', 'Place'] },
  rules: {
    R1: { name: '恩怨反转', hint: '同一对角色先亲后仇（或先仇后亲）' },
    R4: { name: '籍贯冲突', hint: '同一人物出现多个籍贯' },
  },
  gapUnits: 60,
  examples: { search: '聂小倩、狐', from: '宁采臣', to: '聂小倩' },
  props: [
    { key: 'nickname', label: '别称' },
    { key: 'role', label: '身份' },
    { key: 'description', label: '简介' },
  ],
  prompts: { role: '《聊斋志异》研究者', clusterExamples: '「狐女报恩」「科场讽刺」「冥府断案」', communityExamples: '「兰若寺」「婴宁一家」' },
  extract: {
    role: '《聊斋志异》知识图谱抽取器',
    rules: [
      '狐、鬼、仙、妖、神等非人角色作 Spirit（精怪），凡人作 Person；只有物种没有名字时，用篇中称呼（如「狐女」）只在该篇有明确个体时抽取。',
      '每篇是独立故事，同名不同篇的普通人物（如「王生」）在 description 里写明篇名以便区分。',
      '文末「异史氏曰」是作者评论，不抽取关系。',
    ],
    seedNoun: '各篇主角',
  },
};

const SHIJI = {
  id: 'shiji',
  name: '史记',
  book: '史记',
  category: 'classics',
  kind: 'history',
  description: '司马迁纪传体通史 130 篇。把散在各篇的人物互见串成一张网，理清政治集团与史事脉络。',
  cover: '/media/covers/shiji.jpg',
  source: { name: '5000言', url: 'https://shiji.5000yan.com/' },
  ontology: makeOntology(SHIJI_ONTOLOGY),
  unit: { name: '篇', axis: '篇序', total: 130, template: '第{n}篇' },
  periodSize: 10,
  terms: {
    segment: '段', segments: '段原文', cluster: '史事群', community: '政治集团', hub: '枢纽人物',
    primary: '人物', secondary: '邦国', evidence: '原文',
  },
  galaxy: { primaryTypes: ['Person'], secondaryTypes: ['Organization', 'Place'] },
  rules: {
    R1: { name: '关系反转', hint: '同一对人物先为君臣/盟友，后成仇敌' },
    R2: { name: '死后再现', hint: '某篇记其已死，他篇仍有其后续行事（互见矛盾）' },
    R3: { name: '互见断档', hint: '主要人物在相隔很远的篇目中再次出现' },
    R4: { name: '记载冲突', hint: '籍贯等单值记载在不同篇里不一致' },
  },
  gapUnits: 30,
  examples: { search: '项羽、鸿门', from: '项羽', to: '刘邦' },
  props: [
    { key: 'nickname', label: '字号' },
    { key: 'role', label: '身份' },
    { key: 'description', label: '简介' },
  ],
  prompts: { role: '先秦两汉史学者', clusterExamples: '「楚汉相争」「商鞅变法」「合纵连横」', communityExamples: '「刘邦功臣集团」「战国四公子」' },
  extract: {
    role: '《史记》知识图谱抽取器',
    rules: [
      '人物用最通行的姓名（「沛公」「汉王」「高祖」写「刘邦」；「项籍」写「项羽」）；字放 nickname，谥号/封号放 aliases。',
      '诸侯国、王朝、部族作 Organization（如「秦」「楚」「匈奴」）；官职作 Office；战役、变法、会盟作 Event。',
      '表、书类篇目里只抽取明确叙述的人物关系，不要把表格里的年份罗列当作事实。',
    ],
    seedNoun: '重要人物',
  },
};

const MATH = {
  id: 'math',
  name: '初中数学',
  book: '义务教育教科书·数学（苏科版）',
  category: 'subject',
  kind: 'textbook',
  description: '苏科版七至九年级 6 册。概念、定理、公式按前置与应用连成知识网，可翻到教材原页，适合预习与复习。',
  cover: '/media/covers/math.jpg',
  source: { name: '国家中小学智慧教育平台', url: 'https://basic.smartedu.cn/tchMaterial' },
  ontology: makeOntology(MATH_ONTOLOGY),
  unit: { name: '节', axis: '课时', total: 0, template: '第{n}节' },
  periodSize: 0,
  terms: {
    segment: '段', segments: '段教材', cluster: '知识群', community: '知识模块', hub: '核心知识点',
    primary: '概念', secondary: '方法', evidence: '教材原文',
  },
  galaxy: { primaryTypes: ['Concept', 'Theorem', 'Formula'], secondaryTypes: ['Method', 'Figure'] },
  rules: {
    M1: { name: '前置倒挂', hint: '前置知识反而在后面的章节才正式出现' },
    M2: { name: '循环依赖', hint: '知识点之间的前置关系成环' },
    M3: { name: '孤立知识点', hint: '只出现一次且没有前置/后继关联的知识点' },
    M4: { name: '跨册长跳', hint: '一个知识点在很久之后的册里才被再次用到' },
  },
  gapUnits: 40,
  examples: { search: '一元二次方程、相似', from: '有理数', to: '二次函数' },
  props: [
    { key: 'role', label: '类别' },
    { key: 'description', label: '定义/表述' },
  ],
  prompts: { role: '初中数学教研员', clusterExamples: '「方程求解」「三角形全等」「函数图像」', communityExamples: '「代数式运算」「圆的性质」' },
  extract: {
    role: '初中数学教材知识图谱抽取器',
    rules: [
      '只抽取教材明确给出或明确使用的数学知识点；例题、习题里的具体数字不作为实体。',
      '知识点用教材规范名称（如「一元二次方程」「勾股定理」「完全平方公式」「配方法」）。',
      'PREREQUISITE 表示学习 B 之前必须先掌握 A：{"subject":"有理数","predicate":"PREREQUISITE","object":"实数"}。',
      'description 写定义或定理的规范表述（≤40字）。',
    ],
    seedNoun: '知识点',
  },
};

const GRAPHS = [SHUIHU, XIYOUJI, HONGLOUMENG, SANGUO, LIAOZHAI, PRIDE, JANE_EYRE, SHERLOCK, GATSBY, ROMEO, ALICE, LUNYU, SHIJI, MATH];

// G1 不看题材：两个群体之间由边缘成员直接牵起的关系，每个图谱都检测
const SURPRISE_RULE = {
  literature: { name: '意外连接', hint: '不起眼的角色直接连到另一群体的核心人物，容易读漏' },
  foreign: { name: '意外连接', hint: '不起眼的角色直接连到另一群体的核心人物，容易读漏' },
  classics: { name: '意外连接', hint: '不起眼的人物直接连到另一群体的核心人物，容易读漏' },
  subject: { name: '意外连接', hint: '冷门知识点直接连到另一板块的核心知识点，容易学漏' },
  topic: { name: '意外连接', hint: '冷门条目直接连到另一板块的核心条目，容易学漏' },
};
for (const g of GRAPHS) g.rules = { ...g.rules, G1: SURPRISE_RULE[g.category] || SURPRISE_RULE.literature };

const BY_ID = new Map(GRAPHS.map((g) => [g.id, g]));

export const CATEGORIES = [
  { id: 'literature', name: '文学名著', description: '读名著：理清人物、势力与情节的来龙去脉' },
  { id: 'foreign', name: '外国名著', description: '读英文原著：人物用原文名字，配中文译名与简介，证据直接回到原文段落' },
  { id: 'classics', name: '经史典籍', description: '读经史：把语录与史传里的人物、思想和史事串起来' },
  { id: 'subject', name: '学科知识', description: '学课程：知识点的前置、推导与应用一目了然；导入教材、讲义或技术文档也能生成' },
  { id: 'topic', name: '专题', description: '导入自己的资料：标准规范、制度文件、讲义，按分类整理成一张可追溯原文的知识网' },
];

/** 专题配置注册成图谱；同 id 再注册即更新（改名、改简介） */
export function registerTopic(meta) {
  const graph = topicGraph(meta);
  graph.rules = { ...graph.rules, G1: SURPRISE_RULE.topic };
  setPurpose(graph.id, graph.purpose);
  const i = GRAPHS.findIndex((g) => g.id === graph.id);
  if (i >= 0) GRAPHS[i] = graph;
  else GRAPHS.push(graph);
  BY_ID.set(graph.id, graph);
  unitLabels.delete(graph.id);
  return graph;
}

export function unregisterGraph(id) {
  const i = GRAPHS.findIndex((g) => g.id === id);
  if (i >= 0) GRAPHS.splice(i, 1);
  BY_ID.delete(id);
  unitLabels.delete(id);
  setPurpose(id, null);
}

/** 图谱的本地数据目录：固定图谱在 data/<id>/，专题在 data/topics/<id>/ */
export function graphDataDir(id) {
  return BY_ID.get(id)?.dataDir || path.resolve('data', id);
}

export function listGraphs() {
  return GRAPHS;
}

/** 命令行（另一个进程）新建的专题，本进程第一次用到时从磁盘补登记 */
function adoptTopic(id) {
  if (BY_ID.has(id)) return;
  const meta = readTopicMeta(id);
  if (meta) registerTopic(meta);
}

/** 列表类接口调用：补上别的进程新建的专题，去掉已删的 */
export function syncTopics() {
  for (const meta of readTopicMetas()) adoptTopic(meta.id);
  for (const g of GRAPHS.filter((x) => x.topic)) if (!readTopicMeta(g.id)) unregisterGraph(g.id);
}

export function getGraph(id) {
  adoptTopic(id);
  const g = BY_ID.get(id);
  if (!g) throw Object.assign(new Error(`未知图谱：${id}`), { status: 404 });
  return g;
}

export function hasGraph(id) {
  adoptTopic(id);
  return BY_ID.has(id);
}

// 有名称的单元（数学的「七上·1.2」、史记的「项羽本纪」）由入库时写到 Chapter.label，这里缓存
const unitLabels = new Map();

for (const meta of readTopicMetas()) registerTopic(meta);

export function setUnitLabels(graphId, map) {
  unitLabels.set(graphId, map);
}

export function hasUnitLabels(graphId) {
  return unitLabels.has(graphId);
}

/** 重新入库后单元可能变了，下次请求时重读 */
export function clearUnitLabels(graphId) {
  unitLabels.delete(graphId);
}

export function unitLabel(graph, no) {
  const named = unitLabels.get(graph.id)?.get(Number(no));
  if (named) return named;
  return graph.unit.template.replace('{n}', no);
}

export function periodSpan(graph, no) {
  const size = graph.periodSize || Math.max(5, Math.ceil((graph.unit.total || 100) / 10));
  const start = Math.floor((no - 1) / size) * size + 1;
  const end = start + size - 1;
  const named = unitLabels.get(graph.id);
  const label = named?.size
    ? `${unitLabel(graph, start)}–${unitLabel(graph, Math.min(end, Math.max(...named.keys())))}`
    : `第${start}–${end}${graph.unit.name}`;
  return { start, end, label };
}

/** 给前端的配置摘要（不含函数）。locale 为 en 时覆盖显示名，代码与示例检索词不变。 */
export function profileOf(graph, locale = 'zh') {
  return localizeProfile({
    id: graph.id,
    name: graph.name,
    book: graph.book,
    category: graph.category,
    kind: graph.kind,
    lang: graph.lang || 'zh',
    author: graph.author || null,
    description: graph.description,
    cover: graph.cover,
    source: graph.source,
    unit: graph.unit,
    period_size: graph.periodSize,
    terms: graph.terms,
    galaxy: graph.galaxy,
    rules: graph.rules,
    examples: graph.examples,
    props: graph.props,
    ontology: graph.ontology.payload(),
    purpose: purposeOf(graph.id, locale),
  }, locale);
}
