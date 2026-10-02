import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Dropdown, Result, Button, Spin, type MenuProps } from 'antd'
import { ClusterOutlined, CompassOutlined, DownOutlined, LeftOutlined } from '@ant-design/icons'
import { getGraphProfile, listGraphs, type GraphCategory } from '@/api/kg-explore'
import { setActiveProfile, type GraphProfile, type GraphSummary } from '@/graph/profile'
import { BrandMark, LocaleToggle, ThemeToggle } from '@/theme/ThemeProvider'
import i18n from '@/i18n'
import { useIsMobile } from '@/hooks/useIsMobile'
import './tokens.css'
import './graph.css'
import './layout.css'

/**
 * 单个图谱的外壳：顶栏（品牌 / 图谱切换 / 语义星图 · 关系探索 / 计数 / 主题）+ 全高画布。
 * 先拉取图谱配置并设为激活图谱，再挂载页面；切换图谱时以 graphId 为 key 整体重挂载，
 * 页面里的模块级缓存与 ECharts 实例都随之重建。
 */
function KnowledgeGraphLayout() {
  const { graphId = '' } = useParams()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const onGalaxy = pathname.endsWith('/galaxy')
  const [profile, setProfile] = useState<GraphProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<{ categories: GraphCategory[]; items: GraphSummary[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError(null)
    setActiveProfile(null)
    getGraphProfile(graphId)
      .then((p) => {
        if (cancelled) return
        setActiveProfile(p)
        setProfile(p)
        document.title = i18n.t('graph.docTitle', { name: p.name })
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : i18n.t('error.graph_missing')) })
    return () => { cancelled = true }
  }, [graphId])

  useEffect(() => {
    listGraphs().then(setCatalog).catch(() => {})
  }, [])

  const switchMenu = useMemo<MenuProps | null>(() => {
    if (!catalog) return null
    return {
      selectedKeys: [graphId],
      items: catalog.categories
        .map((cat) => ({
          type: 'group' as const,
          key: cat.id,
          label: cat.name,
          children: catalog.items
            .filter((g) => g.category === cat.id)
            .map((g) => ({
              key: g.id,
              disabled: !g.ready,
              label: <span className="kg-switch-item">{g.name}{!g.ready && <em>{i18n.t('graph.pending')}</em>}</span>,
            })),
        }))
        .filter((group) => group.children.length),
      onClick: ({ key }) => navigate(`/g/${key}/${onGalaxy ? 'galaxy' : 'explore'}`),
    }
  }, [catalog, graphId, navigate, onGalaxy])

  const stats = profile?.stats
  const t = profile?.terms
  const mobile = useIsMobile()
  const view = onGalaxy
    ? 'galaxy'
    : new URLSearchParams(search).get('mode') === 'clue' ? 'clue' : 'explore'

  const title = switchMenu ? (
    <Dropdown menu={switchMenu} trigger={['click']} placement={mobile ? 'bottom' : 'bottomLeft'}>
      <button type="button" className="kg-appbar-switch" aria-label={i18n.t('graph.switch')}>
        <b>{profile?.name || '…'}</b>
        <DownOutlined />
      </button>
    </Dropdown>
  ) : <b>{profile?.name || '…'}</b>

  return (
    <div className="kg-shell kg-scope">
      {mobile ? (
        <header className="kg-mbar">
          <div className="kg-mbar-row">
            <Link className="kg-mbar-back" to="/" aria-label={i18n.t('graph.back')}><LeftOutlined /></Link>
            <div className="kg-mbar-title">{title}</div>
            <LocaleToggle />
            <ThemeToggle />
          </div>
          <nav className="kg-mbar-seg" aria-label={i18n.t('graph.views')}>
            <Link to={`/g/${graphId}/explore`} className={view === 'explore' ? 'on' : ''} aria-current={view === 'explore' ? 'page' : undefined}>{i18n.t('graph.rel')}</Link>
            <Link to={`/g/${graphId}/galaxy`} className={view === 'galaxy' ? 'on' : ''} aria-current={view === 'galaxy' ? 'page' : undefined}>{i18n.t('graph.galaxyShort')}</Link>
            <Link to={`/g/${graphId}/explore?mode=clue`} className={view === 'clue' ? 'on' : ''} aria-current={view === 'clue' ? 'page' : undefined}>{i18n.t('graph.clue')}</Link>
          </nav>
        </header>
      ) : (
      <header className="kg-appbar">
        <Link className="kg-appbar-home" to="/" title={i18n.t('graph.back')}>
          <BrandMark size={30} />
        </Link>
        <div className="kg-appbar-brand">
          {title}
          <span className="kg-appbar-sub">{i18n.t('graph.subtitle')}</span>
        </div>
        <nav className="kg-appbar-tabs">
          <NavLink to={`/g/${graphId}/galaxy`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <ClusterOutlined /> <span>{i18n.t('graph.navGalaxy')}</span>
          </NavLink>
          <NavLink to={`/g/${graphId}/explore`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <CompassOutlined /> <span>{i18n.t('graph.navExplore')}</span>
          </NavLink>
        </nav>
        <div className="kg-appbar-stats">
          {stats && t && (
            <>
              <span><b>{stats.units}</b> {profile?.unit.name}</span>
              {stats.clusters > 0 && <span><b>{stats.clusters}</b> {t.cluster}</span>}
              {stats.entities > 0 && <span><b>{stats.entities.toLocaleString()}</b> {i18n.t('common.entryNoun', { count: stats.entities })}</span>}
              {stats.claims > 0 && <span><b>{stats.claims.toLocaleString()}</b> {i18n.t('common.relationNoun', { count: stats.claims })}</span>}
            </>
          )}
        </div>
        <LocaleToggle />
        <ThemeToggle />
      </header>
      )}
      <main className="kg-shell-body">
        {error ? (
          <Result
            status="404"
            title={i18n.t('graph.notFound')}
            subTitle={error}
            extra={<Button type="primary" onClick={() => navigate('/')}>{i18n.t('graph.home')}</Button>}
          />
        ) : !profile || profile.id !== graphId ? (
          <div className="kg-shell-loading"><Spin /></div>
        ) : !profile.stats?.claims ? (
          <Result
            status="info"
            title={i18n.t('graph.preparing', { name: profile.name })}
            subTitle={i18n.t('graph.preparingSub')}
            extra={<Button onClick={() => navigate('/')}>{i18n.t('graph.other')}</Button>}
          />
        ) : (
          <Outlet key={graphId} />
        )}
      </main>
    </div>
  )
}

export default KnowledgeGraphLayout
