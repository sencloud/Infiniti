/** 管理口令（服务端 KG_ADMIN_TOKEN）：不在服务器本机上管理专题、核对事实时填一次，存在本机浏览器里 */
const TOKEN_KEY = 'infiniti-admin-token'

export function adminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setAdminToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
