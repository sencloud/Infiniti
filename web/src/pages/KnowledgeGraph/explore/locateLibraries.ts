/**
 * 快速定位的库：当前图谱本体里的每个实体类型一个库（人物库 / 势力库 / 概念库 …）。
 * key 与后端本体 entity_type 编码一致，直接作为实体搜索接口的 type 参数。
 */
import { activeProfile } from '@/graph/profile'
import i18n from '@/i18n'

export type LocateLibrary = string

export function locateLibraries(): Array<{ key: LocateLibrary; label: string }> {
  return activeProfile().ontology.entity_types.map((t) => ({ key: t.code, label: i18n.t('explore.typeLibrary', { name: t.name }) }))
}
