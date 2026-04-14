import { getAccessToken } from '../store/authToken.js'
import { clearAccessToken } from '../store/authToken.js'
const API_BASE = (import.meta.env.VITE_RUOYI_API_BASE_URL || '').replace(/\/$/, '')
let redirectingToLogin = false

const redirectToLogin = () => {
  clearAccessToken()
  if (!redirectingToLogin && window.location.pathname !== '/login') {
    redirectingToLogin = true
    const redirect = `${window.location.pathname}${window.location.search || ''}`
    const target = `/login?redirect=${encodeURIComponent(redirect)}`
    window.location.replace(target)
  }
}

const buildUrl = (path) => {
  if (!path.startsWith('/')) return `${API_BASE}/${path}`
  return `${API_BASE}${path}`
}

const normalizeHeaders = (headers = {}) => {
  const normalized = { ...headers }
  if (!normalized.Accept) {
    normalized.Accept = 'application/json'
  }
  return normalized
}

const assertBusinessCode = (payload) => {
  if (!payload || typeof payload !== 'object') return
  if (!Object.prototype.hasOwnProperty.call(payload, 'code')) return
  if (payload.code === 401) {
    redirectToLogin()
  }
  if (payload.code !== 200) {
    const msg = payload?.msg || `业务异常(code=${payload.code})`
    throw new Error(msg)
  }
}

export const request = async (path, options = {}) => {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: normalizeHeaders(options.headers),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      redirectToLogin()
    }
    throw new Error(data?.msg || `HTTP ${response.status}`)
  }
  assertBusinessCode(data)
  return data
}

export const requestWithAuth = async (path, options = {}) => {
  const token = (getAccessToken() || '').trim()
  const incomingHeaders = options.headers || {}
  const headers = {
    ...normalizeHeaders(incomingHeaders),
  }

  if (token && !headers.Authorization) {
    headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
  }

  return request(path, {
    ...options,
    headers,
  })
}
