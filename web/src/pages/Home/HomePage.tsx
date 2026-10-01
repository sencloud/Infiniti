/**
 * 首页：按分类浏览全部知识图谱（文学名著 / 经史典籍 / 学科知识 / 人物关系）+ 跨图谱总搜索。
 * 视觉沿用 /people 旧首页的纸墨风格：暖纸底、墨字、朱砂点缀、宋体标题。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listGraphs, searchAllGraphs, type GlobalSearchHit, type GraphCategory } from '@/api/kg-explore'
import type { GraphSummary } from '@/graph/profile'
import { BrandMark, ThemeToggle } from '@/theme/ThemeProvider'
import './home.css'

const PEOPLE_CATEGORY: GraphCategory = {
  id: 'people',
  name: '人物关系',
  description: '真实人物的 3D 时间图谱：从百科抓取人物、事件与主题，按年代铺开',
}

const STEP_LABELS: Record<string, string> = {
  crawl: '抓取原文',
  seeds: '整理人物表',
  extract: '抽取事实',
  load: '写入图谱',
  build: '构建星图',
}

function buildText(g: GraphSummary): string {
  const b = g.build
  if (!b) return '等待整理'
  if (b.state === 'failed') return '整理中断，稍后重试'
  if (b.step === 'extract' && b.units) return `抽取事实 ${b.extracted ?? 0}/${b.units}`
  return b.step ? STEP_LABELS[b.step] || b.step : '等待整理'
}

function buildPct(g: GraphSummary): number {
  const b = g.build
  if (!b?.step) return 4
  const order = ['crawl', 'seeds', 'extract', 'load', 'build']
  const i = order.indexOf(b.step)
  const within = b.step === 'extract' && b.units ? (b.extracted ?? 0) / b.units : 0.3
  return Math.round(((Math.max(i, 0) + within) / order.length) * 100)
}

/** 线装书题签式封面：没有封面图时用书名竖排 */
function BookCover({ graph }: { graph: GraphSummary }) {
  const [failed, setFailed] = useState(false)
  if (graph.cover && !failed) {
    return (
      <div className="hm-cover">
        <img src={graph.cover} alt={graph.name} loading="lazy" onError={() => setFailed(true)} />
      </div>
    )
  }
  return (
    <div className={`hm-cover hm-cover-type cat-${graph.category}`}>
      <span className="hm-cover-slip">{graph.book || graph.name}</span>
    </div>
  )
}

function GraphCard({ graph }: { graph: GraphSummary }) {
  const s = graph.stats
  return (
    <article className={`hm-card ${graph.ready ? '' : 'is-pending'}`}>
      {graph.ready ? (
        <Link to={`/g/${graph.id}/galaxy`} className="hm-card-cover-link" aria-label={`进入${graph.name}`}>
          <BookCover graph={graph} />
        </Link>
      ) : <BookCover graph={graph} />}
      <div className="hm-card-body">
        <h3>{graph.name}</h3>
        <p className="hm-card-desc">{graph.description}</p>
        {graph.ready ? (
          <>
            <div className="hm-card-stats">
              <span><b>{s.units}</b> {graph.unit.name}</span>
              <span><b>{s.entities.toLocaleString()}</b> 实体</span>
              <span><b>{s.claims.toLocaleString()}</b> 事实</span>
            </div>
            <div className="hm-card-actions">
              <Link to={`/g/${graph.id}/galaxy`} className="hm-btn main">语义星图</Link>
              <Link to={`/g/${graph.id}/explore`} className="hm-btn ghost">关系探索</Link>
            </div>
          </>
        ) : (
          <div className="hm-card-pending">
            <div className="hm-progress"><span style={{ width: `${buildPct(graph)}%` }} /></div>
            <span>{buildText(graph)}</span>
          </div>
        )}
      </div>
    </article>
  )
}

function PeopleCard({ persons }: { persons: number | null }) {
  return (
    <article className="hm-card">
      <a href="/people/" className="hm-card-cover-link" aria-label="进入人物关系 3D 图谱">
        <div className="hm-cover hm-cover-type cat-people">
          <span className="hm-cover-slip">人物关系</span>
        </div>
      </a>
      <div className="hm-card-body">
        <h3>人物关系 3D 图谱</h3>
        <p className="hm-card-desc">{PEOPLE_CATEGORY.description}</p>
        <div className="hm-card-stats">
          {persons != null && <span><b>{persons.toLocaleString()}</b> 位人物</span>}
          <span>搜索任意人物即时抓取</span>
        </div>
        <div className="hm-card-actions">
          <a href="/people/" className="hm-btn main">进入 3D 图谱</a>
        </div>
      </div>
    </article>
  )
}

function GlobalSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GlobalSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const kw = q.trim()
    const my = ++seq.current
    const timer = window.setTimeout(() => {
      if (!kw) { setHits([]); setLoading(false); return }
      setLoading(true)
      searchAllGraphs(kw, 4)
        .then((r) => { if (my === seq.current) { setHits(r.items); setSel(0) } })
        .catch(() => { if (my === seq.current) setHits([]) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [q])

  const go = (hit: GlobalSearchHit) => navigate(`/g/${hit.graph_id}/explore?entity=${encodeURIComponent(hit.entity_id)}`)

  return (
    <div className="hm-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <div className="hm-search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && hits[sel]) go(hits[sel])
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="在所有图谱里找人物、概念、地点…（如 诸葛亮、勾股定理、颜回）"
          aria-label="跨图谱搜索"
        />
        <button type="button" className="go" onClick={() => hits[sel] && go(hits[sel])}>搜索</button>
      </div>
      {open && q.trim() && (
        <div className="hm-search-drop" role="listbox">
          {loading && !hits.length && <div className="hm-drop-status">搜索中…</div>}
          {!loading && !hits.length && <div className="hm-drop-status">没有找到「{q.trim()}」</div>}
          {hits.map((hit, i) => (
            <button
              type="button"
              key={`${hit.graph_id}:${hit.entity_id}`}
              className={`hm-drop-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(hit)}
            >
              <span className="hm-drop-main">
                <span className="n">{hit.canonical_name}</span>
                {hit.title && hit.title !== hit.canonical_name && <span className="o">{hit.title}</span>}
              </span>
              <span className="d">{hit.graph_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const [catalog, setCatalog] = useState<{ categories: GraphCategory[]; items: GraphSummary[] } | null>(null)
  const [persons, setPersons] = useState<number | null>(null)
  const [active, setActive] = useState<string>('all')

  useEffect(() => {
    document.title = '无限连接 · 知识图谱'
    const load = () => listGraphs().then(setCatalog).catch(() => {})
    load()
    // 后台批处理还在跑时，卡片进度每 20 秒刷新一次
    const timer = window.setInterval(load, 20000)
    fetch('/api/stats').then((r) => r.json()).then((j) => setPersons(j?.persons ?? null)).catch(() => {})
    return () => window.clearInterval(timer)
  }, [])

  const categories = useMemo(() => [...(catalog?.categories || []), PEOPLE_CATEGORY], [catalog])
  const shown = active === 'all' ? categories : categories.filter((c) => c.id === active)
  const readyCount = catalog?.items.filter((g) => g.ready).length ?? 0

  return (
    <div className="hm-page">
      <div className="paper-nebula" />
      <header className="hm-header">
        <Link to="/" className="hm-brand">
          <BrandMark size={40} />
          <div>
            <div className="hm-brand-name">无限<b>连接</b></div>
            <div className="hm-brand-sub">INFINITI · KNOWLEDGE GRAPHS</div>
          </div>
        </Link>
        <div className="hm-header-actions">
          <a href="/people/" className="hm-header-link">人物 3D</a>
          <ThemeToggle />
        </div>
      </header>

      <section className="hm-hero">
        <h1>知识<b>图谱</b></h1>
        <p className="hm-tagline">从名著、典籍到教材，在关系里读书</p>
        <GlobalSearch />
        <nav className="hm-chips" aria-label="图谱分类">
          {[{ id: 'all', name: '全部' }, ...categories].map((c) => (
            <button
              type="button"
              key={c.id}
              className={`hm-chip ${active === c.id ? 'on' : ''}`}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
        </nav>
      </section>

      <main className="hm-main">
        {!catalog && <div className="hm-loading">正在载入图谱目录…</div>}
        {catalog && shown.map((cat) => {
          const graphs = cat.id === 'people' ? [] : catalog.items.filter((g) => g.category === cat.id)
          return (
            <section key={cat.id} className="hm-section">
              <div className="hm-section-head">
                <h2>{cat.name}</h2>
                <p>{cat.description}</p>
              </div>
              <div className="hm-grid">
                {cat.id === 'people'
                  ? <PeopleCard persons={persons} />
                  : graphs.map((g) => <GraphCard key={g.id} graph={g} />)}
              </div>
            </section>
          )
        })}
      </main>

      <footer className="hm-footer">
        {catalog && (
          <span>
            {readyCount < catalog.items.length
              ? `${readyCount} / ${catalog.items.length} 个图谱可浏览 · 其余正在后台整理`
              : `共 ${catalog.items.length} 个图谱`}
          </span>
        )}
        <span>原文来自 5000言 · 教材来自国家中小学智慧教育平台 · 图像来自维基共享资源</span>
      </footer>
    </div>
  )
}
