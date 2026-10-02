/**
 * 快速定位面板（关系探索页右侧）
 *
 * 由顶部「快速定位」下拉打开，按库（人员 / 事件 / 组织机构）列出图谱实体，
 * 支持库内关键词筛选与分页加载；点选任一实体即以其为中心展开关系网络。
 * 面板常驻直到用户关闭，方便在多个实体之间来回切换比较。
 *
 * 父组件以 key={library} 渲染本组件：切库即重挂载，筛选词与分页自然归零。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Spin } from 'antd'
import { CloseOutlined, SearchOutlined } from '@ant-design/icons'

import { searchKnowledgeGraphEntities, type EntitySearchItem } from '@/api/knowledge-graph'
import { nodeColor } from '@/utils/graphStyle'
import { locateLibraries, type LocateLibrary } from './locateLibraries'

const PAGE_SIZE = 30

interface Props {
  library: LocateLibrary
  /** 当前探索中心，列表里高亮显示 */
  activeId: string | null
  onChangeLibrary: (library: LocateLibrary) => void
  onPick: (item: EntitySearchItem) => void
  onClose: () => void
}

export default function QuickLocatePanel({
  library, activeId, onChangeLibrary, onPick, onClose,
}: Props) {
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<EntitySearchItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // 已加载到的页码与生效中的关键词（「加载更多」沿用）
  const pageRef = useRef(1)
  const kwRef = useRef('')
  // 请求序号：改关键词时丢弃迟到的旧响应
  const seqRef = useRef(0)

  // 拉取某一页：page=1 覆盖列表，其余追加
  const fetchPage = useCallback((kw: string, page: number) => {
    const seq = ++seqRef.current
    setLoading(true)
    searchKnowledgeGraphEntities({ type: library, keyword: kw, page, page_size: PAGE_SIZE })
      .then((res) => {
        if (seq !== seqRef.current) return
        const next = res.data?.items || []
        setTotal(res.data?.total || 0)
        setItems((cur) => (page === 1 ? next : [...cur, ...next]))
        pageRef.current = page
      })
      .catch(() => {
        if (seq !== seqRef.current) return
        if (page === 1) { setItems([]); setTotal(0) }
      })
      .finally(() => { if (seq === seqRef.current) setLoading(false) })
  }, [library])

  // 关键词防抖 300ms 后回到第一页重查；首次挂载（空关键词）立即加载
  useEffect(() => {
    const kw = keyword.trim()
    const timer = window.setTimeout(() => {
      kwRef.current = kw
      listRef.current?.scrollTo({ top: 0 })
      fetchPage(kw, 1)
    }, kw ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [keyword, fetchPage])

  const loadMore = () => fetchPage(kwRef.current, pageRef.current + 1)

  const hasMore = items.length < total
  const libraries = locateLibraries()
  const current = libraries.find((lib) => lib.key === library)
  const color = nodeColor(library).main

  return (
    <div className="inf-locate-panel">
      <div className="inf-lp-head">
        <span className="inf-lp-dot" style={{ background: color }} />
        <h3>快速定位 · {current?.label}</h3>
        <button type="button" className="inf-nc-close" onClick={onClose} title="关闭" aria-label="关闭"><CloseOutlined /></button>
      </div>

      {/* 库切换：与顶部下拉同源，面板内也能直接换库 */}
      <div className="inf-lp-tabs">
        {libraries.map((lib) => (
          <button
            key={lib.key}
            type="button"
            className={`inf-lp-tab ${lib.key === library ? 'on' : ''}`}
            style={lib.key === library
              ? { borderColor: nodeColor(lib.key).main, color: nodeColor(lib.key).main }
              : undefined}
            onClick={() => onChangeLibrary(lib.key)}
          >
            {lib.label}
          </button>
        ))}
      </div>

      <div className="inf-lp-search">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: 'var(--kg-text-faint)' }} />}
          placeholder={`在${current?.label || ''}中筛选…`}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="inf-lp-list" ref={listRef}>
        {items.map((item) => {
          // 副标题：人物显示职务 + 隶属机构（同名人物靠这两项区分）；
          // 其它类型显示别名。identity_hint 是内部消歧标识，只进 tooltip
          const aliases = (item.aliases || []).filter((a) => a && a !== item.canonical_name)
          const orgs = item.organizations || []
          const isPerson = item.entity_type === 'Person'
          const detailLines = isPerson
            ? [item.title, orgs.slice(0, 2).join('、')].filter(Boolean)
            : (aliases.length ? [`又名 ${aliases.slice(0, 2).join('、')}`] : [])
          return (
            <div
              key={item.entity_id}
              className={`inf-lp-item ${item.entity_id === activeId ? 'active' : ''}`}
              onClick={() => onPick(item)}
              title={[item.canonical_name, item.title, ...orgs, item.identity_hint]
                .filter(Boolean).join(' · ')}
            >
              <div className="inf-lp-item-head">
                <span className="inf-lp-item-name">{item.canonical_name}</span>
                <span className="inf-lp-item-count">关系 {item.claim_count}</span>
              </div>
              {detailLines.length > 0 && (
                <div className="inf-lp-item-detail">
                  {isPerson && item.title && (
                    <span className="inf-lp-item-title">{item.title}</span>
                  )}
                  {isPerson && orgs.length > 0 && (
                    <span className="inf-lp-item-org">{orgs.slice(0, 2).join('、')}</span>
                  )}
                  {!isPerson && <span className="inf-lp-item-hint">{detailLines[0]}</span>}
                </div>
              )}
            </div>
          )
        })}
        {!loading && items.length === 0 && (
          <div className="inf-nc-empty" style={{ padding: '18px 0', textAlign: 'center' }}>
            {keyword.trim() ? '没有匹配的实体' : '该库暂无实体'}
          </div>
        )}
        {loading && (
          <div className="inf-lp-loading"><Spin size="small" /></div>
        )}
        {!loading && hasMore && (
          <button type="button" className="inf-lp-more" onClick={loadMore}>
            加载更多（{items.length} / {total}）
          </button>
        )}
      </div>

      <div className="inf-lp-foot">共 {total} 个实体 · 点选即以其为中心展开关系</div>
    </div>
  )
}
