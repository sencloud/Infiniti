// 各类图谱的本体预设：章回小说 / 语录 / 志怪 / 史传 / 教材

export const NOVEL_TYPES = [
  { code: 'Person', name: '人物', description: '书中出场的具名人物（主角、官员、百姓、神魔等）' },
  { code: 'Organization', name: '势力', description: '山寨、官军、朝廷机构、家族府第、国度等群体' },
  { code: 'Place', name: '地点', description: '州府县、山寨、村庄、关隘、建筑等具体地点' },
  { code: 'Event', name: '事件', description: '有名目的情节事件（智取生辰纲、三打祝家庄等）' },
  { code: 'Item', name: '器物', description: '有名目的兵器、宝物、文书（天书、雁翎甲等）' },
];

const P = ['Person'];
const PO = ['Person', 'Organization'];

const NOVEL_PREDICATES = [
  { code: 'SWORN_BROTHER', name: '结义', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 结拜为兄弟' },
  { code: 'KIN', name: '亲属', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 有血缘或姻亲关系（父子、兄弟、叔侄、姑表等）' },
  { code: 'SPOUSE', name: '夫妻', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 是夫妻' },
  { code: 'MASTER_OF', name: '师徒', domain: P, range: P, tone: 'positive', hint: 'A 是 B 的师父（主语是师父）' },
  { code: 'FRIEND', name: '交好', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 交情深厚、相互结识敬重' },
  { code: 'RECOMMENDED', name: '举荐', domain: P, range: P, tone: 'positive', hint: 'A 推荐、引荐 B' },
  { code: 'RESCUED', name: '搭救', domain: PO, range: P, tone: 'positive', hint: 'A 救了 B 或替 B 解围' },
  { code: 'SERVED', name: '投奔', domain: P, range: P, tone: 'positive', hint: 'A 投奔、追随、效力于 B' },
  { code: 'RECRUITED', name: '招降', domain: PO, range: P, hint: 'A 招安、收服、说降 B' },
  { code: 'FOUGHT', name: '交战', domain: PO, range: PO, symmetric: true, tone: 'hostile', hint: 'A 与 B 交手、对阵' },
  { code: 'DEFEATED', name: '击败擒获', domain: PO, range: PO, tone: 'hostile', hint: 'A 打败或活捉 B' },
  { code: 'KILLED', name: '杀死', domain: P, range: P, tone: 'hostile', hint: 'A 杀死 B（片段明确写出死亡）' },
  { code: 'FRAMED', name: '陷害', domain: P, range: P, tone: 'hostile', hint: 'A 设计陷害、诬告、暗算 B' },
  { code: 'MEMBER_OF', name: '归属', domain: P, range: ['Organization'], hint: 'A 属于势力 B' },
  { code: 'LEADS', name: '统领', domain: P, range: ['Organization'], hint: 'A 是势力 B 的首领' },
  { code: 'SURRENDERED_TO', name: '归顺', domain: PO, range: ['Organization', 'Person'], hint: 'A 投降、归顺 B' },
  { code: 'NATIVE_OF', name: '籍贯', domain: P, range: ['Place'], functional: true, hint: 'A 是 B 地人氏' },
  { code: 'STATIONED_AT', name: '据守', domain: PO, range: ['Place'], hint: 'A 驻扎、据守、盘踞于 B' },
  { code: 'PARTICIPATED_IN', name: '参与', domain: PO, range: ['Event'], hint: 'A 参与事件 B' },
  { code: 'MASTERMINDED', name: '主谋', domain: P, range: ['Event'], hint: 'A 策划、主导事件 B' },
  { code: 'OCCURRED_AT', name: '发生于', domain: ['Event'], range: ['Place'], hint: '事件 A 发生在 B' },
  { code: 'OWNS', name: '持有', domain: PO, range: ['Item'], hint: 'A 持有、使用器物 B' },
  { code: 'ATTACKED', name: '攻打', domain: PO, range: ['Organization', 'Place'], tone: 'hostile', hint: 'A 攻打势力或地点 B' },
  { code: 'ALLIED_WITH', name: '联合', domain: ['Organization'], range: ['Organization'], symmetric: true, hint: '势力 A 与势力 B 联手' },
];

/** 章回小说谓词：在水浒传基础上按书增删改名 */
export function novelPredicates({ extra = [], drop = [], rename = {} } = {}) {
  const dropSet = new Set(drop);
  return [
    ...NOVEL_PREDICATES.filter((p) => !dropSet.has(p.code)).map((p) => (rename[p.code] ? { ...p, name: rename[p.code] } : p)),
    ...extra,
  ];
}

export const FOREIGN_TYPES = [
  { code: 'Person', name: '人物', description: '书中有名有姓或有固定称呼的角色（含会说话的动物、扑克牌人物等拟人角色）' },
  { code: 'Organization', name: '家族', description: '家族、府邸、团体与机构（如班纳特家、蒙太古家族、苏格兰场）' },
  { code: 'Place', name: '地点', description: '庄园、城镇、宅邸、街道等具体地点' },
  { code: 'Event', name: '事件', description: '有名目的情节事件（舞会、求婚、决斗、案件、婚礼）' },
  { code: 'Item', name: '物品', description: '推动情节的关键物品（信件、照片、宝石、毒药）' },
];

const FOREIGN_PREDICATES = [
  { code: 'KIN', name: '亲属', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 有血缘或姻亲关系（父女、姐妹、姨甥、表亲等）' },
  { code: 'SPOUSE', name: '婚配', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 是夫妻或订婚' },
  { code: 'LOVES', name: '爱慕', domain: P, range: P, tone: 'positive', hint: 'A 爱慕、钟情于 B' },
  { code: 'PROPOSED_TO', name: '求婚', domain: P, range: P, hint: 'A 向 B 求婚' },
  { code: 'FRIEND', name: '交好', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 是朋友或关系亲近' },
  { code: 'GUARDIAN_OF', name: '监护', domain: P, range: P, tone: 'positive', hint: 'A 抚养、监护或教导 B（如姨妈抚养外甥女、家庭教师教学生）' },
  { code: 'SERVANT_OF', name: '雇佣', domain: P, range: PO, hint: 'A 是 B 的仆人、雇员或家庭教师（主语是被雇的一方）' },
  { code: 'HELPED', name: '帮助', domain: PO, range: P, tone: 'positive', hint: 'A 帮助、救助、资助 B' },
  { code: 'DECEIVED', name: '欺骗', domain: P, range: P, tone: 'hostile', hint: 'A 欺骗、诱骗、隐瞒 B' },
  { code: 'QUARRELED', name: '冲突', domain: P, range: P, symmetric: true, tone: 'hostile', hint: 'A 与 B 争吵、敌对、结怨' },
  { code: 'HARMED', name: '加害', domain: P, range: P, tone: 'hostile', hint: 'A 伤害、迫害、虐待 B' },
  { code: 'KILLED', name: '致死', domain: P, range: P, tone: 'hostile', hint: 'A 杀死 B 或直接导致 B 死亡（片段明确写死）' },
  { code: 'MEMBER_OF', name: '归属', domain: P, range: ['Organization'], hint: 'A 属于家族或团体 B' },
  { code: 'LIVES_AT', name: '居住', domain: PO, range: ['Place'], hint: 'A 住在、拥有宅邸 B' },
  { code: 'VISITED', name: '造访', domain: P, range: ['Place'], hint: 'A 前往、拜访、到过 B' },
  { code: 'NATIVE_OF', name: '出身', domain: P, range: ['Place'], functional: true, hint: 'A 出生或来自 B' },
  { code: 'PARTICIPATED_IN', name: '参与', domain: PO, range: ['Event'], hint: 'A 参加事件 B' },
  { code: 'OCCURRED_AT', name: '发生于', domain: ['Event'], range: ['Place'], hint: '事件 A 发生在 B' },
  { code: 'OWNS', name: '持有', domain: PO, range: ['Item'], hint: 'A 拥有、持有物品 B' },
];

/** 外国小说谓词：通用一套，按书增删改名 */
export function foreignPredicates({ extra = [], drop = [], rename = {} } = {}) {
  const dropSet = new Set(drop);
  return [
    ...FOREIGN_PREDICATES.filter((p) => !dropSet.has(p.code)).map((p) => (rename[p.code] ? { ...p, name: rename[p.code] } : p)),
    ...extra,
  ];
}

export const LUNYU_ONTOLOGY = {
  version: 'lunyu-v1',
  entityTypes: [
    { code: 'Person', name: '人物', description: '孔子、弟子与时人（国君、大夫、隐者）' },
    { code: 'Concept', name: '概念', description: '儒家核心范畴：仁、礼、义、孝、君子等' },
    { code: 'Organization', name: '邦国', description: '鲁、卫、齐、陈、蔡等国' },
    { code: 'Text', name: '典籍', description: '诗、书、礼、乐、易等经典与乐章' },
  ],
  predicates: [
    { code: 'DISCIPLE_OF', name: '师从', domain: P, range: P, tone: 'positive', hint: 'A 是 B 的弟子（主语是弟子）' },
    { code: 'ASKED', name: '请教', domain: P, range: P, hint: 'A 向 B 发问请教' },
    { code: 'PRAISED', name: '称许', domain: P, range: P, tone: 'positive', hint: 'A 称赞、肯定 B' },
    { code: 'CRITICIZED', name: '批评', domain: P, range: P, tone: 'hostile', hint: 'A 批评、责备、讥讽 B' },
    { code: 'KIN', name: '亲属', domain: P, range: P, symmetric: true, hint: 'A 与 B 有亲属关系' },
    { code: 'DISCUSSED', name: '论述', domain: P, range: ['Concept'], hint: 'A 阐述、谈论概念 B' },
    { code: 'EXEMPLIFIES', name: '体现', domain: P, range: ['Concept'], hint: 'A 被称为某德行 B 的典范' },
    { code: 'CITED', name: '引述', domain: P, range: ['Text'], hint: 'A 引用、评论典籍 B' },
    { code: 'SERVED', name: '出仕', domain: P, range: ['Organization', 'Person'], hint: 'A 仕于某国或某人' },
    { code: 'VISITED', name: '适', domain: P, range: ['Organization'], hint: 'A 到过某国' },
    { code: 'NATIVE_OF', name: '国别', domain: P, range: ['Organization'], functional: true, hint: 'A 是某国人' },
    { code: 'RELATED', name: '相关', domain: ['Concept'], range: ['Concept'], symmetric: true, hint: '两个概念在同一章里互相阐发' },
    { code: 'CONTRASTED', name: '对举', domain: ['Concept'], range: ['Concept'], symmetric: true, hint: '两个概念被对照论述（君子/小人、义/利）' },
  ],
};

export const LIAOZHAI_ONTOLOGY = {
  version: 'liaozhai-v1',
  entityTypes: [
    { code: 'Person', name: '人物', description: '书生、官吏、百姓等凡人' },
    { code: 'Spirit', name: '精怪', description: '狐、鬼、仙、妖、神等非人角色' },
    { code: 'Place', name: '地点', description: '州县、寺庙、宅院、冥府等' },
    { code: 'Item', name: '器物', description: '有名目的宝物、法器、书画' },
    { code: 'Event', name: '事件', description: '科考、冤案、婚嫁等有名目的事件' },
  ],
  predicates: [
    { code: 'LOVES', name: '相恋', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], symmetric: true, tone: 'positive', hint: 'A 与 B 相爱、私订终身' },
    { code: 'SPOUSE', name: '婚配', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], symmetric: true, tone: 'positive', hint: 'A 与 B 结为夫妻' },
    { code: 'KIN', name: '亲属', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], symmetric: true, hint: 'A 与 B 有亲属关系' },
    { code: 'FRIEND', name: '交好', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], symmetric: true, tone: 'positive', hint: 'A 与 B 结交为友' },
    { code: 'HELPED', name: '相助', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], tone: 'positive', hint: 'A 帮助、搭救或报答 B' },
    { code: 'HARMED', name: '加害', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], tone: 'hostile', hint: 'A 迫害、作祟、迷惑 B' },
    { code: 'KILLED', name: '杀死', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], tone: 'hostile', hint: 'A 杀死 B' },
    { code: 'PUNISHED', name: '惩治', domain: ['Person', 'Spirit'], range: ['Person', 'Spirit'], tone: 'hostile', hint: 'A 审断、惩罚 B（官员断案、冥府判罚）' },
    { code: 'LIVES_AT', name: '居于', domain: ['Person', 'Spirit'], range: ['Place'], hint: 'A 住在 B' },
    { code: 'NATIVE_OF', name: '籍贯', domain: ['Person'], range: ['Place'], functional: true, hint: 'A 是 B 地人' },
    { code: 'OWNS', name: '持有', domain: ['Person', 'Spirit'], range: ['Item'], hint: 'A 拥有器物 B' },
    { code: 'PARTICIPATED_IN', name: '参与', domain: ['Person', 'Spirit'], range: ['Event'], hint: 'A 参与事件 B' },
    { code: 'OCCURRED_AT', name: '发生于', domain: ['Event'], range: ['Place'], hint: '事件 A 发生在 B' },
  ],
};

export const SHIJI_ONTOLOGY = {
  version: 'shiji-v1',
  entityTypes: [
    { code: 'Person', name: '人物', description: '帝王、诸侯、将相、游侠、刺客等' },
    { code: 'Organization', name: '邦国', description: '王朝、诸侯国、部族（秦、楚、匈奴等）' },
    { code: 'Place', name: '地点', description: '都城、封邑、战场、山川' },
    { code: 'Event', name: '史事', description: '战役、变法、会盟、政变' },
    { code: 'Office', name: '官职', description: '丞相、上将军、太史令等官爵' },
  ],
  predicates: [
    { code: 'KIN', name: '亲属', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 有血缘或姻亲关系' },
    { code: 'SPOUSE', name: '夫妻', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 是夫妻' },
    { code: 'SUCCEEDED', name: '继位', domain: P, range: P, hint: 'A 继承 B 的君位或爵位' },
    { code: 'SERVED', name: '臣事', domain: P, range: PO, tone: 'positive', hint: 'A 为 B 效力、做 B 的臣子' },
    { code: 'ADVISED', name: '进谏', domain: P, range: P, tone: 'positive', hint: 'A 向 B 献策、进谏' },
    { code: 'FRIEND', name: '交好', domain: P, range: P, symmetric: true, tone: 'positive', hint: 'A 与 B 交情深厚' },
    { code: 'MASTER_OF', name: '师徒', domain: P, range: P, tone: 'positive', hint: 'A 是 B 的老师' },
    { code: 'RULED', name: '统治', domain: P, range: ['Organization'], hint: 'A 是 B 国的君主' },
    { code: 'HELD_OFFICE', name: '任职', domain: P, range: ['Office'], hint: 'A 担任官职 B' },
    { code: 'ENFEOFFED', name: '受封', domain: P, range: ['Place'], hint: 'A 被封于 B' },
    { code: 'ENVOY_TO', name: '出使', domain: P, range: ['Organization'], hint: 'A 出使 B 国' },
    { code: 'FOUGHT', name: '攻伐', domain: PO, range: PO, symmetric: true, tone: 'hostile', hint: 'A 与 B 交战' },
    { code: 'DEFEATED', name: '击败', domain: PO, range: PO, tone: 'hostile', hint: 'A 打败、攻灭 B' },
    { code: 'KILLED', name: '诛杀', domain: P, range: P, tone: 'hostile', hint: 'A 杀死、处死、逼死 B' },
    { code: 'BETRAYED', name: '背叛', domain: P, range: PO, tone: 'hostile', hint: 'A 背叛、反叛 B' },
    { code: 'FRAMED', name: '谗害', domain: P, range: P, tone: 'hostile', hint: 'A 进谗言陷害 B' },
    { code: 'ALLIED_WITH', name: '联合', domain: PO, range: PO, symmetric: true, hint: 'A 与 B 结盟、合纵' },
    { code: 'NATIVE_OF', name: '籍贯', domain: P, range: ['Place', 'Organization'], functional: true, hint: 'A 是 B 人' },
    { code: 'PARTICIPATED_IN', name: '参与', domain: PO, range: ['Event'], hint: 'A 参与史事 B' },
    { code: 'OCCURRED_AT', name: '发生于', domain: ['Event'], range: ['Place'], hint: '史事 A 发生在 B' },
  ],
};

const K = ['Concept', 'Theorem', 'Formula', 'Method', 'Figure'];

export const MATH_ONTOLOGY = {
  version: 'math-v1',
  entityTypes: [
    { code: 'Concept', name: '概念', description: '定义类知识点（有理数、函数、相似三角形）' },
    { code: 'Theorem', name: '定理性质', description: '定理、性质、判定（勾股定理、平行线的性质）' },
    { code: 'Formula', name: '公式法则', description: '公式、法则、运算律（完全平方公式、去括号法则）' },
    { code: 'Method', name: '方法思想', description: '解题方法与数学思想（配方法、数形结合）' },
    { code: 'Figure', name: '图形', description: '几何图形（三角形、圆、平行四边形）' },
  ],
  predicates: [
    { code: 'PREREQUISITE', name: '前置', domain: K, range: K, hint: '学 B 之前要先掌握 A（主语是前置知识）' },
    { code: 'INCLUDES', name: '包含', domain: K, range: K, hint: 'A 包含 B（上位概念 → 下位概念、整体 → 组成部分）' },
    { code: 'DERIVES', name: '推出', domain: K, range: ['Theorem', 'Formula'], hint: '由 A 可以推导出 B' },
    { code: 'SPECIAL_CASE', name: '特例', domain: K, range: K, hint: 'A 是 B 的特殊情形（正方形是矩形的特例）' },
    { code: 'PROPERTY_OF', name: '性质', domain: ['Theorem', 'Formula'], range: ['Concept', 'Figure'], hint: '定理/公式 A 描述的是 B 的性质或判定' },
    { code: 'APPLIES_TO', name: '应用于', domain: K, range: K, hint: '方法/公式 A 用来解决 B 类问题' },
    { code: 'CONTRASTS', name: '对比', domain: K, range: K, symmetric: true, hint: '教材把 A 与 B 对照比较（异同）' },
    { code: 'RELATED', name: '相关', domain: K, range: K, symmetric: true, hint: 'A 与 B 在同一处被联系起来，但不属于以上关系' },
  ],
};
