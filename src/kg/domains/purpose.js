// 每个图谱的学习目的：读这本书想弄懂什么。抽取、解说、问答的提示词都带上它，
// 前端把 questions 当作推荐提问。focus 只给模型看，告诉它哪些关系最值得写清楚。
const PURPOSES = {
  shuihu: {
    zh: {
      goal: '弄清一百单八将各自为什么上梁山、靠谁上山，以及梁山从聚义到招安后的分化。',
      focus: '投奔、结义、仇杀、招安前后立场的变化',
      questions: ['林冲为什么会上梁山？', '宋江和晁盖的关系是怎么变化的？', '招安之后好汉们的结局如何？', '高俅和梁山之间有哪些恩怨？'],
    },
    en: {
      goal: 'Understand why each of the 108 heroes ended up at Liangshan, who brought them there, and how the band split after amnesty.',
      focus: 'joining, sworn brotherhood, vendettas, and shifting loyalties around the amnesty',
      questions: ['Why did Lin Chong end up at Liangshan?', 'How did the relationship between Song Jiang and Chao Gai change?', 'What happened to the heroes after the amnesty?', 'What feuds connect Gao Qiu and Liangshan?'],
    },
  },
  xiyouji: {
    zh: {
      goal: '理清取经路上每一难的来历：妖怪出自哪里、背后靠山是谁、最后被谁收服。',
      focus: '妖怪的出身与靠山、降伏者、师徒之间的冲突与和解',
      questions: ['哪些妖怪背后有神仙靠山？', '孙悟空和唐僧之间闹过几次矛盾？', '牛魔王一家和取经团队有哪些纠葛？', '观音在取经路上帮过哪些忙？'],
    },
    en: {
      goal: 'Trace each trial on the journey west: where the demon came from, who backed it, and who finally subdued it.',
      focus: 'demons’ origins and patrons, who subdued them, and quarrels within the pilgrim group',
      questions: ['Which demons had a celestial patron?', 'How many times did Sun Wukong and Tang Sanzang fall out?', 'How is the Bull Demon King’s family tangled up with the pilgrims?', 'How did Guanyin help along the way?'],
    },
  },
  hongloumeng: {
    zh: {
      goal: '看清贾府上下的亲缘、主仆与情感关系，以及这些关系怎样随家族由盛转衰。',
      focus: '亲缘与婚配、主仆、情感纠葛、当家权的转移',
      questions: ['贾宝玉、林黛玉和薛宝钗之间是怎样的关系？', '王熙凤是怎么当家的，又得罪了谁？', '大观园里有哪些主仆关系值得注意？', '贾府的衰败是从哪些事情开始的？'],
    },
    en: {
      goal: 'See the kinship, master–servant and emotional ties in the Jia household, and how they shift as the family declines.',
      focus: 'kinship and marriage, servants, love entanglements, and who runs the household',
      questions: ['What is the relationship between Jia Baoyu, Lin Daiyu and Xue Baochai?', 'How did Wang Xifeng run the household, and whom did she offend?', 'Which master–servant ties in the Grand View Garden matter most?', 'Which events mark the start of the Jia family’s decline?'],
    },
  },
  sanguo: {
    zh: {
      goal: '理清魏蜀吴三方的人物归属、谋略与战事，看懂谁在什么时候投靠了谁。',
      focus: '效力与归降、战役中的对阵、谋划者、镇守之地',
      questions: ['关羽和曹操之间发生过什么？', '诸葛亮出山后主导了哪些谋划？', '哪些将领先后换过阵营？', '赤壁之战各方是怎样站队的？'],
    },
    en: {
      goal: 'Sort out who served Wei, Shu and Wu, their strategies and battles, and who switched sides when.',
      focus: 'service and defection, battlefield opponents, strategists, and garrisons',
      questions: ['What happened between Guan Yu and Cao Cao?', 'Which plans did Zhuge Liang lead after joining Liu Bei?', 'Which generals changed sides?', 'How did each side line up at Red Cliffs?'],
    },
  },
  liaozhai: {
    zh: {
      goal: '读懂每篇故事里人与狐鬼精怪的关系，以及故事借这些关系讽刺了什么。',
      focus: '人与异类的情缘、报恩与复仇、科场与官场',
      questions: ['聂小倩和宁采臣的故事里，燕赤霞起了什么作用？', '哪些故事写了狐女报恩？', '书里有哪些讽刺科举的篇目？', '冥府断案的故事里谁是判官？'],
    },
    en: {
      goal: 'Understand the bonds between humans and fox spirits, ghosts and other beings, and what each tale satirises through them.',
      focus: 'romance with the supernatural, repaying kindness and revenge, exams and officialdom',
      questions: ['What role does Yan Chixia play in the story of Nie Xiaoqian and Ning Caichen?', 'Which tales are about a fox spirit repaying kindness?', 'Which stories satirise the imperial exams?', 'Who sits in judgment in the underworld trials?'],
    },
  },
  lunyu: {
    zh: {
      goal: '把孔子和弟子的问答串起来，看清每个核心概念被谁问起、孔子怎样因人作答。',
      focus: '谁向谁问了什么、概念的阐述与对照、师生评价',
      questions: ['孔子是怎样回答不同弟子问「仁」的？', '子路和颜回分别得到过孔子怎样的评价？', '「孝」在论语里有哪几种说法？', '孔子和鲁国君臣有哪些对话？'],
    },
    en: {
      goal: 'Link the dialogues between Confucius and his disciples to see who asked about each core idea and how Confucius tailored his answers.',
      focus: 'who asked whom about what, how ideas are explained and contrasted, and how the master judged his students',
      questions: ['How did Confucius answer different disciples who asked about ren?', 'How did Confucius judge Zilu and Yan Hui?', 'How many ways is filial piety described in the Analects?', 'What did Confucius discuss with the rulers of Lu?'],
    },
  },
  shiji: {
    zh: {
      goal: '把史记各篇里的人物和史事连起来，看清同一件事在不同篇里怎样被记下来。',
      focus: '君臣与效力、交战、谋划、同一史事在多篇中的互见',
      questions: ['项羽和刘邦之间有哪些关键交锋？', '商鞅变法牵连了哪些人？', '战国四公子分别养了哪些门客？', '韩信是怎样一步步立功又被杀的？'],
    },
    en: {
      goal: 'Connect the people and events across the chapters of the Shiji, and see how the same event is recorded in different chapters.',
      focus: 'rulers and their servants, wars, schemes, and cross-references between chapters',
      questions: ['What were the key clashes between Xiang Yu and Liu Bang?', 'Who was caught up in Shang Yang’s reforms?', 'Which retainers did the Four Lords of the Warring States keep?', 'How did Han Xin rise and then get killed?'],
    },
  },
  math: {
    zh: {
      goal: '弄清每个知识点要先学什么、能推出什么、在后面哪里被用到，找到薄弱的前置环节。',
      focus: '前置、推导、特例、方法的适用对象',
      questions: ['学二次函数之前需要先掌握哪些知识？', '勾股定理在后面哪些地方被用到？', '一元二次方程有哪些解法，各自依据什么？', '相似三角形和全等三角形是什么关系？'],
    },
    en: {
      goal: 'Work out what each idea requires, what it leads to, and where it is used later, so weak prerequisites stand out.',
      focus: 'prerequisites, derivations, special cases, and where each method applies',
      questions: ['What should be learned before quadratic functions?', 'Where is the Pythagorean theorem used later on?', 'What methods solve a quadratic equation, and what does each rely on?', 'How are similar triangles related to congruent triangles?'],
    },
  },
};

const FALLBACK = {
  zh: { goal: '弄清书中人物与概念之间的关系，以及这些关系依据哪些原文。', focus: '关键关系及其原文依据', questions: [] },
  en: { goal: 'Understand how the people and ideas in the book relate, and which passages support each link.', focus: 'key relations and their sources', questions: [] },
};

/** 专题的学习目的随配置注册进来 */
const EXTRA = new Map();

export function setPurpose(graphId, purpose) {
  if (purpose) EXTRA.set(graphId, purpose);
  else EXTRA.delete(graphId);
}

export function purposeOf(graphId, locale = 'zh') {
  const lang = locale === 'en' ? 'en' : 'zh';
  return (PURPOSES[graphId] || EXTRA.get(graphId))?.[lang] || FALLBACK[lang];
}

/** 写进提示词的一段「学习目的」说明 */
export function purposePrompt(graphId) {
  const p = purposeOf(graphId, 'zh');
  return `学习者读这本书的目的：${p.goal}\n最值得写清楚的关系：${p.focus}`;
}
