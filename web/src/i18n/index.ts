import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localeFromPath } from './locale'
import zhCN from '../locales/zh-CN.json'
import en from '../locales/en.json'

const locale = localeFromPath()
document.documentElement.lang = locale

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: locale,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false,
})

export default i18n

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}
