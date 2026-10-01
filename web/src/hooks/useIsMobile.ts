import { useEffect, useState } from 'react'

/** 与 CSS 断点一致：≤768px 视为手机布局 */
export const MOBILE_QUERY = '(max-width: 768px)'

export const isMobileNow = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(isMobileNow)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
