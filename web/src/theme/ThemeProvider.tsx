import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { currentTheme, palette, type ThemeName } from './palette'

const STORAGE_KEY = 'infiniti-theme'

interface ThemeCtx {
  theme: ThemeName
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} })

export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(currentTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette(theme).bg)
  }, [theme])

  // 同步写 data-theme：子组件（3D 节点、ECharts）在本次渲染里调用 palette() 就要拿到新主题
  const toggle = useCallback(() => setTheme((t) => {
    const next: ThemeName = t === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    return next
  }), [])
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])

  const p = palette(theme)
  const antdTheme = useMemo(() => ({
    algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.accent,
      colorInfo: theme === 'dark' ? '#8fb0d4' : '#3c5a78',
      colorLink: p.accent,
      colorBgBase: theme === 'dark' ? '#14181f' : '#fdfcf9',
      colorBgContainer: theme === 'dark' ? '#1a1f28' : '#fdfcf9',
      colorBgElevated: theme === 'dark' ? '#1d222c' : '#fdfcf9',
      colorBgLayout: p.bg,
      colorTextBase: p.ink,
      colorBorder: theme === 'dark' ? 'rgba(232,234,239,0.18)' : 'rgba(39,44,52,0.16)',
      colorBorderSecondary: theme === 'dark' ? 'rgba(232,234,239,0.09)' : 'rgba(39,44,52,0.08)',
      borderRadius: 8,
      fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    },
  }), [theme, p])

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </Ctx.Provider>
  )
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" className="icon-btn" onClick={toggle} title={theme === 'dark' ? '切换到明亮' : '切换到暗色'} aria-label="切换主题">
      {theme === 'dark' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      )}
    </button>
  )
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <circle className="ring-a" cx="17" cy="22" r="11" strokeWidth="2.2" />
      <circle className="ring-b" cx="27" cy="22" r="11" strokeWidth="2.2" />
      <circle className="n-focus" cx="22" cy="22" r="3.4" />
      <circle className="n-person" cx="9.4" cy="16.8" r="2.4" />
      <circle className="n-event" cx="27" cy="11" r="2.4" />
      <circle className="n-topic" cx="34.6" cy="27.2" r="2.4" />
    </svg>
  )
}
