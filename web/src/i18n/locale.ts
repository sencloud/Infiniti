/** 界面语言：中文走原路径，英文走 /en 前缀。只在用户切换时写入 localStorage。 */

export type AppLocale = 'zh-CN' | 'en'

export const LOCALE_STORAGE_KEY = 'infiniti-locale'

export function localeFromPath(pathname = window.location.pathname): AppLocale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh-CN'
}

export function isEnglish(language?: string): boolean {
  return (language ?? localeFromPath()).toLowerCase().startsWith('en')
}

/** 去掉 /en 前缀后的站内路径，供语言切换时改写地址 */
export function pathWithoutLocale(pathname = window.location.pathname): string {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, '')
  return stripped || '/'
}

export function switchLocale(next: AppLocale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, next)
  const bare = pathWithoutLocale()
  const target = next === 'en' ? (bare === '/' ? '/en' : `/en${bare}`) : bare
  window.location.assign(`${target}${window.location.search}${window.location.hash}`)
}

export function peopleHref(locale: AppLocale = localeFromPath()): string {
  return locale === 'en' ? '/en/people/' : '/people/'
}

export function importGuideUrl(locale: AppLocale = localeFromPath()): string {
  return locale === 'en'
    ? 'https://github.com/sencloud/Infiniti/blob/main/README.en.md#adding-material'
    : 'https://github.com/sencloud/Infiniti#%E6%B7%BB%E5%8A%A0%E5%AD%A6%E4%B9%A0%E6%9D%90%E6%96%99'
}
