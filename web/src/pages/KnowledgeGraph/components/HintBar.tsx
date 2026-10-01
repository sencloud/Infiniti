/**
 * 画布底部交互提示条（Marble 式常驻引导）
 *
 * Marble 的做法是把交互方式直接写在界面上：
 * "Drag to spin · Scroll to zoom · Tap a dot, then follow its prerequisites"。
 * 用户首次与画布交互后淡出，不用手动关闭。
 */
import { useEffect, useState } from 'react'

interface Props {
  /** 提示片段，用 · 分隔展示 */
  hints: string[]
  /** 底部有别的时间面板等占位元素时，提示条上移避让 */
  avoidBottom?: boolean
}

export default function HintBar({ hints, avoidBottom = false }: Props) {
  const [hidden, setHidden] = useState(false)

  // 首次交互后 3 秒淡出。用 pointerdown 而不是 click：
  // 拖拽平移也是交互，click 捕捉不到。
  useEffect(() => {
    if (hidden) return
    const dismiss = () => setHidden(true)
    window.addEventListener('pointerdown', dismiss, { once: true })
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [hidden])

  if (hidden || !hints.length) return null

  return (
    <div
      className={`kg-hint-bar${hidden ? ' kg-hint-bar-hidden' : ''}${avoidBottom ? ' kg-hint-bar-raised' : ''}`}
    >
      {hints.map((h, i) => (
        <span key={h}>
          {i > 0 && <span className="kg-hint-sep"> · </span>}
          {h}
        </span>
      ))}
    </div>
  )
}
