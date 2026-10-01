// 本体工厂：每个图谱（domains/*）定义自己的实体类型与受控谓词，
// 抽取提示词、入库校验、前端图例与分析规则都以对应图谱的本体为准。
//
// 谓词字段：domain/range 约束主宾类型；symmetric 表示无方向（入库时按 id 排序规范化）；
// functional 表示同一主体只应有一个取值（用于「单值冲突」线索）；
// tone 用于「关系反转」线索：positive 亲近、hostile 敌对。

export const CLAIM_STATUSES = ['proposed', 'auto_verified', 'human_verified', 'rejected', 'superseded'];
export const PUBLISHED_STATUSES = ['auto_verified', 'human_verified'];

export function makeOntology({ version, entityTypes, predicates }) {
  const byCode = new Map(predicates.map((p) => [p.code, p]));
  const typeCodes = new Set(entityTypes.map((t) => t.code));
  const predicateName = (code) => byCode.get(code)?.name || code;
  return {
    version,
    ENTITY_TYPES: entityTypes,
    ENTITY_TYPE_CODES: typeCodes,
    PREDICATES: predicates,
    PREDICATE_BY_CODE: byCode,
    predicateName,
    payload() {
      return {
        version,
        entity_types: entityTypes,
        predicates: predicates.map(({ code, name, domain, range, symmetric, functional, tone }) => ({
          code, name, domain, range, symmetric: Boolean(symmetric), functional: Boolean(functional), tone: tone || '',
        })),
        claim_statuses: CLAIM_STATUSES,
        published_statuses: PUBLISHED_STATUSES,
      };
    },
    /** 抽取提示词里的谓词说明（一行一个） */
    predicateGuide() {
      return predicates.map((p) => {
        const dir = p.symmetric ? '无方向' : '有方向';
        return `- ${p.code}（${p.name}，${p.domain.join('/')} → ${p.range.join('/')}，${dir}）：${p.hint}`;
      }).join('\n');
    },
    entityGuide() {
      return entityTypes.map((t) => `- ${t.code}（${t.name}）：${t.description}`).join('\n');
    },
  };
}
