/**
 * 还可以看谁：和当前条目没有直接关系、但共同关系人多的条目。点一下以它为中心展开。
 * 没有推荐时整块不渲染。
 */
import { useEffect, useState } from 'react'
import { getRelatedEntities, type RelatedEntity } from '@/api/kg-learn'
import { nodeColor } from '@/utils/graphStyle'
import i18n from '@/i18n'

interface Props {
  entityId: string
  limit?: number
  onLocate: (entityId: string) => void
}

export default function RelatedEntities({ entityId, limit = 6, onLocate }: Props) {
  const [items, setItems] = useState<{ for: string; list: RelatedEntity[] }>({ for: '', list: [] })

  useEffect(() => {
    let alive = true
    getRelatedEntities(entityId, limit)
      .then((list) => { if (alive) setItems({ for: entityId, list }) })
      .catch(() => { if (alive) setItems({ for: entityId, list: [] }) })
    return () => { alive = false }
  }, [entityId, limit])

  if (items.for !== entityId || !items.list.length) return null
  const sep = i18n.language.startsWith('en') ? ', ' : '、'
  return (
    <div className="inf-related">
      <div className="inf-nc-sec-title">{i18n.t('learn.related.title')}</div>
      <ul>
        {items.list.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onLocate(r.id)}>
              <span className="inf-related-dot" style={{ background: nodeColor(r.label).main }} />
              <span className="inf-related-name">{r.name}</span>
              {r.via.length > 0 && <span className="inf-related-via">{i18n.t('learn.related.via', { names: r.via.join(sep) })}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
