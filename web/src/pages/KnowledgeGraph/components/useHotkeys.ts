/**
 * 知识图谱探索页键盘快捷键
 *
 * 用法：在页面组件里调用 useHotkeys({ '/': focusSearch, Escape: onEscape, ... })
 * 输入框聚焦时不拦截（用户在打字），除 Escape 外。
 * '/' 在中文输入法下不可用属预期，快捷键是补充不是唯一路径。
 */
import { useEffect } from 'react'

export interface HotkeyHandlers {
  /** 聚焦搜索框 */
  '/'?: () => void
  /** 返回上一层 / 关闭浮层 */
  Escape?: () => void
  /** 重置视图 */
  r?: () => void
  /** 打开快捷键说明 */
  '?'?: () => void
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function useHotkeys(handlers: HotkeyHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) && e.key !== 'Escape') return
      const key = e.key === 'Escape' ? 'Escape' : e.key.toLowerCase()
      const handler = (handlers as Record<string, (() => void) | undefined>)[key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
