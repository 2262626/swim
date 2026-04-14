import { requestWithAuth } from './http.js'
import { getAccessToken } from '../store/authToken.js'

const apiBase = () => (import.meta.env.VITE_RUOYI_API_BASE_URL || '').replace(/\/$/, '')
const BASE = '/swim/video'

const toAbsoluteHttpUrl = (rawUrl) => {
  const input = String(rawUrl || '').trim()
  if (!input) return ''

  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const base = apiBase()

  let apiOrigin = ''
  try {
    if (base) {
      apiOrigin = new URL(base, browserOrigin || 'http://localhost').origin
    }
  } catch {
    apiOrigin = ''
  }

  const host = apiOrigin || browserOrigin

  if (/^https?:\/\//i.test(input)) {
    // If backend runs behind nginx without forward-headers, ServerConfig.getUrl() may
    // return http://127.0.0.1:8088/... — replace with the real public origin so that
    // DashScope (external service) can actually download the video file.
    if (host && !/(localhost|127\.0\.0\.1)/i.test(host)) {
      try {
        const parsed = new URL(input)
        if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
          return host + parsed.pathname + (parsed.search || '') + (parsed.hash || '')
        }
      } catch { /* ignore malformed URL */ }
    }
    return input
  }

  if (!host) return input

  if (input.startsWith('/')) {
    return `${host}${input}`
  }

  return `${host}/${input}`
}

// ── 文件上传（XHR for progress） ──────────────────────────────────────
export const uploadVideoFileApi = (file, onProgress) => {
  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiBase()}/common/upload`)

    const token = (getAccessToken() || '').trim()
    if (token) {
      xhr.setRequestHeader(
        'Authorization',
        /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
      )
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
    }

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText)
        if (res.code === 200) resolve(res)
        else reject(new Error(res.msg || '上传失败'))
      } catch {
        reject(new Error('响应解析失败'))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(formData)
  })
}

// ── 提交分析任务 ──────────────────────────────────────────────────────
export const submitVideoAnalysisApi = (form) => {
  const payload = {
    ...form,
    videoUrl: toAbsoluteHttpUrl(form?.videoUrl),
  }
  return requestWithAuth(`${BASE}/analysis/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload),
  })
}

// ── 任务列表（支持分页/过滤参数） ─────────────────────────────────────
export const listVideoTasksApi = (params = {}) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') q.set(k, v)
  })
  const qs = q.toString()
  return requestWithAuth(`${BASE}/analysis/list${qs ? '?' + qs : ''}`, { method: 'GET' })
}

// ── 单任务详情 ────────────────────────────────────────────────────────
export const getVideoTaskApi = (taskId) =>
  requestWithAuth(`${BASE}/analysis/${taskId}`, { method: 'GET' })

// ── 下载HTML报告（自动触发浏览器下载） ────────────────────────────────
export const downloadReportApi = async (taskId) => {
  const token = (getAccessToken() || '').trim()
  const url = `${apiBase()}${BASE}/analysis/${taskId}/report`
  const headers = {}
  if (token) {
    headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.msg || `下载失败: HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = `swim-report-${taskId}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

// ── 学员列表（复用已有接口路径） ──────────────────────────────────────
export const listAthletesForAnalysisApi = (params = {}) => {
  const q = new URLSearchParams()
  const normalized = { ...params }
  if (normalized.teamId != null && normalized.team_id == null) {
    normalized.team_id = normalized.teamId
    delete normalized.teamId
  }
  Object.entries(normalized).forEach(([k, v]) => {
    if (v != null && v !== '') q.set(k, v)
  })
  const qs = q.toString()
  return requestWithAuth(`/api/v1/athletes${qs ? '?' + qs : ''}`, { method: 'GET' })
}

// ── 可用模型列表 ───────────────────────────────────────────────────────
export const listModelsApi = () =>
  requestWithAuth(`${BASE}/analysis/models`, { method: 'GET' })

// ── 视频标注 ──────────────────────────────────────────────────────────
export const getAnnotationApi = (taskId) =>
  requestWithAuth(`/swim/annotation/${taskId}`, { method: 'GET' })

export const getAnnotationContentApi = (taskId) =>
  requestWithAuth(`/swim/annotation/${taskId}`, { method: 'GET' })

export const saveAnnotationApi = (taskId, strokes, annotationImageUrl) =>
  requestWithAuth(`/swim/annotation/${taskId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ annotationData: JSON.stringify(strokes), annotationImageUrl: annotationImageUrl || '' }),
  })

// ── 分享链接 ──────────────────────────────────────────────────────────
export const getShareLinkApi = (taskId) =>
  requestWithAuth(`/swim/share/task/${taskId}`, { method: 'GET' })

export const getShareHistoryApi = (taskId) =>
  requestWithAuth(`/swim/share/history/${taskId}`, { method: 'GET' })

export const createShareLinkApi = (taskId) =>
  requestWithAuth(`/swim/share/create/${taskId}`, { method: 'POST' })

// ── 公开分享数据（免登录）── 直接 fetch 不带 token ──────────────────
export const getPublicShareDataApi = async (shareCode) => {
  const base = (import.meta.env.VITE_RUOYI_API_BASE_URL || '').replace(/\/$/, '')
  const res = await fetch(`${base}/swim/public/share/${shareCode}`)
  const json = await res.json().catch(() => ({}))
  if (json.code !== 200) throw new Error(json.msg || '链接无效')
  return json
}
