import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ExploreGraphPage, GalaxyPage, KnowledgeGraphLayout } from './pages/KnowledgeGraph'
import HomePage from './pages/Home/HomePage'
import { ThemeProvider } from './theme/ThemeProvider'
import './theme/theme.css'

/** 旧链接 /kg/galaxy、/kg/explore?... 只有水浒传一个图谱，原样转到 /g/shuihu/... */
function LegacyKgRedirect() {
  const { pathname, search } = useLocation()
  const rest = pathname.replace(/^\/kg\/?/, '') || 'galaxy'
  return <Navigate to={`/g/shuihu/${rest}${search}`} replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/g/:graphId" element={<KnowledgeGraphLayout />}>
            <Route index element={<Navigate to="galaxy" replace />} />
            <Route path="galaxy" element={<GalaxyPage />} />
            <Route path="explore" element={<ExploreGraphPage />} />
          </Route>
          <Route path="/kg/*" element={<LegacyKgRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
