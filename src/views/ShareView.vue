<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'

const route = useRoute()
const shareCode = computed(() => route.params.shareCode)

const loading = ref(true)
const error = ref('')
const shareData = ref(null)
const posterCanvas = ref(null)
const generatingPoster = ref(false)
const showPosterPreview = ref(false)
const posterUrl = ref('')
const annotationCanvas = ref(null)
const annotationLoaded = ref(false)

const API_BASE = (import.meta.env.VITE_RUOYI_API_BASE_URL || '').replace(/\/$/, '')

const task = computed(() => shareData.value?.task || {})
const parsedAnalysis = computed(() => {
  const raw = task.value?.analysisData
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
})

const getByPath = (obj, path) => {
  if (!obj || !path) return null
  return path.split('.').reduce((acc, key) => (acc == null ? null : acc[key]), obj)
}

const fmt = (v, suffix = '') => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return `${Number(v).toFixed(2).replace(/\.00$/, '')}${suffix}`
  return `${v}${suffix}`
}

const verifiedMetrics = computed(() => {
  const a = parsedAnalysis.value
  const list = [
    { label: '平均配速', value: fmt(getByPath(a, 'performance_fitness_data.core_efficiency_index.average_pace'), ' s/100m') },
    { label: 'SWOLF(全程)', value: fmt(getByPath(a, 'performance_fitness_data.core_efficiency_index.SWOLF_score.full_course')) },
    { label: '划频', value: fmt(getByPath(a, 'stroke_technique_quant_data.stroke_action_full_cycle_data.stroke_basic_index.stroke_rate'), ' 次/min') },
    { label: '划距均值', value: fmt(getByPath(a, 'stroke_technique_quant_data.stroke_action_full_cycle_data.stroke_basic_index.stroke_distance_per_cycle.average_value'), ' m') },
    { label: '停顿次数', value: fmt(getByPath(a, 'performance_fitness_data.fitness_consumption_data.pause_count'), ' 次') },
    { label: '停顿总时长', value: fmt(getByPath(a, 'performance_fitness_data.fitness_consumption_data.pause_total_duration'), ' s') },
    { label: '最大没入时长', value: fmt(getByPath(a, 'error_action_risk_warning.drowning_safety_risk.max_underwater_duration'), ' s') },
    { label: '对标总分', value: fmt(getByPath(a, 'benchmark_evaluation_data.standard_template_matching_score.total_score')) },
  ].filter(item => item.value != null)

  if (!list.length) {
    return [
      { label: '综合评分', value: task.value?.overallScore != null ? `${Math.round(task.value.overallScore)} 分` : '—' },
      { label: '数据置信度', value: task.value?.confidenceScore != null ? `${Math.round(task.value.confidenceScore)} 分` : '—' },
      { label: '风险等级', value: task.value?.riskLevel || '—' },
    ]
  }
  return list.slice(0, 8)
})

const summaryText = computed(() => {
  const text = task.value?.markdownSummary
  if (!text) return ''
  return String(text).trim()
})

const escapeHtml = (text) => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const renderInlineMarkdown = (text) => {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return html
}

const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line)
const splitTableRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isTableDivider = (cells) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s+/g, '')))

const renderMarkdownToHtml = (md) => {
  const src = String(md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = src.split('\n')
  const out = []
  let i = 0
  let inUl = false
  let inOl = false

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

    if (!line) {
      closeLists()
      i++
      continue
    }

    if (isTableLine(raw)) {
      closeLists()
      const tableLines = []
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines.map(splitTableRow)
      if (rows.length >= 2 && isTableDivider(rows[1])) {
        const head = rows[0]
        const body = rows.slice(2)
        out.push('<table class="summary-evidence-table"><thead><tr>')
        head.forEach((h) => out.push(`<th>${renderInlineMarkdown(h)}</th>`))
        out.push('</tr></thead><tbody>')
        body.forEach((row) => {
          out.push('<tr>')
          row.forEach((c) => out.push(`<td>${renderInlineMarkdown(c)}</td>`))
          out.push('</tr>')
        })
        out.push('</tbody></table>')
      } else {
        tableLines.forEach((t) => out.push(`<p>${renderInlineMarkdown(t)}</p>`))
      }
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      closeLists()
      const lv = h[1].length
      out.push(`<h${lv}>${renderInlineMarkdown(h[2])}</h${lv}>`)
      i++
      continue
    }

    const ul = line.match(/^[-*+]\s+(.+)$/)
    if (ul) {
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${renderInlineMarkdown(ul[1])}</li>`)
      i++
      continue
    }

    const ol = line.match(/^\d+[.)]\s+(.+)$/)
    if (ol) {
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${renderInlineMarkdown(ol[1])}</li>`)
      i++
      continue
    }

    closeLists()
    out.push(`<p>${renderInlineMarkdown(line)}</p>`)
    i++
  }

  closeLists()
  return out.join('')
}

const summaryHtml = computed(() => {
  if (!summaryText.value) return ''
  return renderMarkdownToHtml(summaryText.value)
})

const riskRaw = computed(() => parsedAnalysis.value?.error_action_risk_warning || {})
const drowningRisk = computed(() => riskRaw.value?.drowning_safety_risk || {})
const injuryRisk = computed(() => riskRaw.value?.sports_injury_risk || {})

const riskOverview = computed(() => {
  return [
    { label: '综合风险等级', value: fmt(drowningRisk.value?.comprehensive_risk_level) || task.value?.riskLevel || '—' },
    { label: '口鼻没入超时次数', value: fmt(drowningRisk.value?.mouth_nose_underwater_overtime_count, ' 次') || '—' },
    { label: '最长没入时长', value: fmt(drowningRisk.value?.max_underwater_duration, ' s') || '—' },
    { label: '速度骤降次数', value: fmt(drowningRisk.value?.speed_sudden_drop_count, ' 次') || '—' }
  ]
})

const abnormalPostureRows = computed(() => {
  const rows = drowningRisk.value?.abnormal_posture_recognition
  return Array.isArray(rows) ? rows : []
})

const injuryRows = computed(() => {
  return [
    { part: '肩部', level: injuryRisk.value?.shoulder_injury_risk?.risk_level || '—', reason: injuryRisk.value?.shoulder_injury_risk?.reason || '—' },
    { part: '膝部', level: injuryRisk.value?.knee_injury_risk?.risk_level || '—', reason: injuryRisk.value?.knee_injury_risk?.reason || '—' },
    { part: '腰部', level: injuryRisk.value?.lumbar_injury_risk?.risk_level || '—', reason: injuryRisk.value?.lumbar_injury_risk?.reason || '—' },
  ]
})

const annotationImageUrl = computed(() => shareData.value?.annotationImageUrl || '')
const annotationData = computed(() => {
  const raw = shareData.value?.annotationData
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
})

const scoreColor = computed(() => {
  const s = task.value?.overallScore
  if (s == null) return '#94a3b8'
  if (s >= 85) return '#10b981'
  if (s >= 70) return '#f59e0b'
  return '#ef4444'
})

const riskBadgeClass = computed(() => {
  const r = task.value?.riskLevel || ''
  if (r.includes('高')) return 'risk-high'
  if (r.includes('中')) return 'risk-mid'
  return 'risk-low'
})

const scoreCircleOffset = computed(() => {
  const s = Math.min(100, Math.max(0, task.value?.overallScore || 0))
  const circumference = 2 * Math.PI * 52
  return circumference - (s / 100) * circumference
})

const normalizeLoopbackMediaUrl = (inputUrl) => {
  const raw = String(inputUrl || '').trim()
  if (!raw) return ''
  const browserHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const browserPort = typeof window !== 'undefined' ? window.location.port : ''
  const browserProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const isLoopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1'

  try {
    const parsed = new URL(raw, window.location.origin)
    if (isLoopback(parsed.hostname) && browserHost && !isLoopback(browserHost)) {
      parsed.hostname = browserHost
      if (browserPort) parsed.port = browserPort
      if (browserProtocol) parsed.protocol = browserProtocol
      return parsed.toString()
    }
    return parsed.toString()
  } catch {
    return raw
  }
}

const resolveVideoUrl = (url) => {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return normalizeLoopbackMediaUrl(value)
  return normalizeLoopbackMediaUrl(`${API_BASE}${value.startsWith('/') ? '' : '/'}${value}`)
}

const formatDate = (t) => {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

/* ── fetch share data ── */
onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/swim/public/share/${shareCode.value}`)
    const json = await res.json()
    if (json.code === 200) {
      shareData.value = json.data
    } else {
      error.value = json.msg || '链接无效'
    }
  } catch {
    error.value = '网络错误，请稍后重试'
  } finally {
    loading.value = false
  }
})

/* ── render annotation canvas ── */
const initAnnotationCanvas = () => {
  if (annotationLoaded.value || !annotationCanvas.value || !annotationData.value?.length) return
  const canvas = annotationCanvas.value
  const ctx = canvas.getContext('2d')
  canvas.width = 640
  canvas.height = 360

  const drawArrow = (ctx, x1, y1, x2, y2) => {
    const dist = Math.hypot(x2 - x1, y2 - y1)
    if (dist < 2) return
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.min(22, dist * 0.35)
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
    ctx.closePath(); ctx.fill()
  }

  annotationData.value.forEach(s => {
    ctx.save()
    ctx.strokeStyle = s.color || '#ff3333'
    ctx.fillStyle = s.color || '#ff3333'
    ctx.lineWidth = s.width || 2
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (s.tool === 'pen' && s.points?.length) {
      ctx.beginPath()
      s.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
      ctx.stroke()
    } else if (s.tool === 'arrow') {
      drawArrow(ctx, s.x1, s.y1, s.x2, s.y2)
    } else if (s.tool === 'rect') {
      ctx.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1)
    } else if (s.tool === 'text' && s.text) {
      ctx.font = `bold ${s.size || 20}px sans-serif`
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4
      ctx.fillText(s.text, s.x, s.y)
    }
    ctx.restore()
  })
  annotationLoaded.value = true
}

/* ── poster generation ── */
const generatePoster = () => {
  generatingPoster.value = true
  const canvas = document.createElement('canvas')
  canvas.width = 750
  canvas.height = 1334
  const ctx = canvas.getContext('2d')

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 1334)
  grad.addColorStop(0, '#0ea5e9')
  grad.addColorStop(0.45, '#6366f1')
  grad.addColorStop(1, '#7c3aed')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 750, 1334)

  // Wave decoration top
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.beginPath()
  ctx.moveTo(0, 200)
  for (let x = 0; x <= 750; x += 10) {
    ctx.lineTo(x, 200 + Math.sin(x / 60) * 30)
  }
  ctx.lineTo(750, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill()

  // Card background
  const cardY = 60
  const cardH = 1220
  ctx.fillStyle = 'rgba(255,255,255,0.13)'
  roundRect(ctx, 30, cardY, 690, cardH, 24)
  ctx.fill()

  // Emoji swimmer
  ctx.font = '72px serif'
  ctx.textAlign = 'center'
  ctx.fillText('🏊', 375, 160)

  // Title
  ctx.font = 'bold 34px sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('游泳AI分析报告', 375, 220)

  ctx.font = '20px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(shareData.value?.shareTitle || '', 375, 256)

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(80, 278); ctx.lineTo(670, 278); ctx.stroke()

  // Student name
  ctx.font = 'bold 42px sans-serif'
  ctx.fillStyle = '#fde68a'
  ctx.fillText(task.value.athleteName || '泳泳小将', 375, 344)

  ctx.font = '22px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  const tags = [task.value.strokeType, task.value.poolLength ? task.value.poolLength + 'm泳池' : null].filter(Boolean).join('  ·  ')
  ctx.fillText(tags || '', 375, 380)

  // Score circle
  const cx = 375, cy = 490, r = 70
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fill()
  const score = task.value.overallScore
  if (score != null) {
    ctx.beginPath()
    const start = -Math.PI / 2
    ctx.arc(cx, cy, r - 8, start, start + (score / 100) * 2 * Math.PI)
    ctx.strokeStyle = score >= 85 ? '#34d399' : score >= 70 ? '#fbbf24' : '#f87171'
    ctx.lineWidth = 10
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.font = 'bold 48px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.fillText(Math.round(score), cx, cy + 10)
    ctx.font = '18px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText('综合评分', cx, cy + 36)
  } else {
    ctx.font = 'bold 30px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillText('暂无评分', cx, cy + 10)
  }

  // Risk badge
  const risk = task.value.riskLevel || '—'
  ctx.font = 'bold 20px sans-serif'
  const riskW = ctx.measureText(risk).width + 32
  const riskColor = risk.includes('高') ? '#ef4444' : risk.includes('中') ? '#f59e0b' : '#10b981'
  ctx.fillStyle = riskColor
  roundRect(ctx, 375 - riskW / 2, 576, riskW, 36, 18)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(risk, 375, 601)

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(80, 632); ctx.lineTo(670, 632); ctx.stroke()

  // Key metrics
  ctx.font = 'bold 22px sans-serif'
  ctx.fillStyle = '#a5f3fc'
  ctx.textAlign = 'center'
  ctx.fillText('📊 核心指标', 375, 668)

  const metrics = [
    { label: '置信度', value: task.value.confidenceScore != null ? Math.round(task.value.confidenceScore) + '分' : '—' },
    { label: '泳姿', value: task.value.strokeType || '—' },
    { label: '泳池', value: task.value.poolLength ? task.value.poolLength + 'm' : '—' },
    { label: '风险', value: task.value.riskLevel || '—' },
  ]
  const mW = 160, mH = 70, mStartX = 55, mY = 692
  metrics.forEach((m, i) => {
    const mx = mStartX + i * (mW + 10)
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    roundRect(ctx, mx, mY, mW, mH, 12)
    ctx.fill()
    ctx.font = '14px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.textAlign = 'center'
    ctx.fillText(m.label, mx + mW / 2, mY + 24)
    ctx.font = 'bold 20px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(m.value, mx + mW / 2, mY + 52)
  })

  // Analysis summary text
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(80, 778); ctx.lineTo(670, 778); ctx.stroke()

  ctx.font = 'bold 22px sans-serif'
  ctx.fillStyle = '#c4b5fd'
  ctx.textAlign = 'center'
  ctx.fillText('🤖 AI分析摘要', 375, 814)

  const summary = task.value.markdownSummary || '暂无分析报告'
  const lines = wrapText(ctx, summary.replace(/[#*`]/g, '').replace(/\n+/g, ' '), 590, '16px sans-serif')
  ctx.font = '16px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.textAlign = 'left'
  lines.slice(0, 18).forEach((line, i) => {
    ctx.fillText(line, 80, 840 + i * 26)
  })

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '16px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`由 ${shareData.value?.coachName || '教练'} 生成 · ${formatDate(shareData.value?.createTime)}`, 375, 1290)
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.fillText('🏊‍♂️ 游泳AI智能训练系统', 375, 1316)

  posterUrl.value = canvas.toDataURL('image/png')
  showPosterPreview.value = true
  generatingPoster.value = false
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapText(ctx, text, maxWidth, font) {
  ctx.font = font
  const words = text.split(' ')
  const lines = []
  let cur = ''
  words.forEach(w => {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > maxWidth) {
      if (cur) lines.push(cur)
      cur = w
    } else {
      cur = test
    }
  })
  if (cur) lines.push(cur)
  return lines
}

const downloadPoster = () => {
  const a = document.createElement('a')
  a.href = posterUrl.value
  a.download = `swim-report-${task.value.athleteName || 'student'}.png`
  a.click()
}

const copyLink = () => {
  const url = window.location.href
  const fallbackCopy = (text) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  }

  navigator.clipboard?.writeText(url)
    .then(() => ElMessage.success('复制成功'))
    .catch(() => {
      const ok = fallbackCopy(url)
      if (ok) ElMessage.success('复制成功')
      else ElMessage.error('复制失败，请手动复制')
    })
}
</script>

<template>
  <div class="share-page">
    <!-- Loading -->
    <div v-if="loading" class="share-loading">
      <div class="loading-wave">🌊🌊🌊</div>
      <p>加载报告中…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="share-error">
      <div class="error-emoji">😢</div>
      <h2>链接无效</h2>
      <p>{{ error }}</p>
    </div>

    <!-- Content -->
    <template v-else-if="shareData">
      <!-- Hero Header -->
      <header class="share-hero">
        <div class="hero-wave"></div>
        <div class="hero-content">
          <h1 class="hero-title">游泳训练分析报告</h1>
          <p class="hero-subtitle">{{ shareData.shareTitle }}</p>
        </div>
      </header>

      <main class="share-main">
        <!-- Student Card -->
        <div class="card student-card">
          <div class="student-info">
            <div class="student-name">{{ task.athleteName || '泳泳小将' }}</div>
            <div class="student-tags">
              <span v-if="task.strokeType" class="tag tag-stroke">泳姿：{{ task.strokeType }}</span>
              <span v-if="task.poolLength" class="tag tag-pool">泳池：{{ task.poolLength }}m</span>
              <span v-if="task.shootDate" class="tag tag-date">拍摄：{{ task.shootDate }}</span>
            </div>
            <div v-if="task.trainingTarget" class="student-target">训练目标：{{ task.trainingTarget }}</div>
          </div>
        </div>
        <!-- Video Preview -->
        <div v-if="task.videoUrl && task.status === 'SUCCESS'" class="card video-card">
          <div class="card-title">🎬 视频回放</div>
          <video class="share-video" :src="resolveVideoUrl(task.videoUrl)" controls preload="metadata"></video>
        </div>

        <!-- Coach Annotations -->
        <div v-if="annotationImageUrl || annotationData.length" class="card annotation-card">
          <div class="card-title">🖊️ 教练标注</div>
          <div class="annotation-coach">
            <span class="coach-tag">{{ shareData.annotationCoach || shareData.coachName }} 教练</span>
            <template v-if="annotationImageUrl">已保存标注图片</template>
            <template v-else>标注了 {{ annotationData.length }} 个笔画</template>
          </div>
          <div v-if="annotationImageUrl" class="annotation-image-wrap">
            <img :src="annotationImageUrl" class="annotation-image" alt="标注图片" />
          </div>
          <div v-else class="annotation-canvas-wrap">
            <video
              v-if="task.videoUrl && task.status === 'SUCCESS'"
              class="ann-bg-video"
              :src="resolveVideoUrl(task.videoUrl)"
              muted
              preload="metadata"
              @loadedmetadata="initAnnotationCanvas"
            ></video>
            <canvas ref="annotationCanvas" class="ann-overlay-canvas"></canvas>
          </div>
        </div>

        <!-- AI Summary -->
        <div v-if="summaryText" class="card summary-card">
          <div class="summary-text markdown-body" v-html="summaryHtml"></div>
        </div>

        <div v-if="riskOverview.length" class="card risk-card">
          <div class="card-title">风险预警与安全分析</div>
          <div class="risk-level-row">
            <span class="risk-chip" :class="riskBadgeClass">{{ task.riskLevel || '—' }}</span>
            <span class="risk-tip">建议结合教练观察，重点关注高风险动作片段与疲劳阶段。</span>
          </div>

          <div class="risk-grid">
            <div v-for="(item, idx) in riskOverview" :key="idx" class="risk-item">
              <div class="risk-item-label">{{ item.label }}</div>
              <div class="risk-item-value">{{ item.value }}</div>
            </div>
          </div>

          <div v-if="abnormalPostureRows.length" class="risk-table-wrap">
            <div class="risk-table-title">异常姿态事件时间线（{{ abnormalPostureRows.length }}条）</div>
            <table class="risk-table">
              <thead>
                <tr>
                  <th>时间戳(s)</th>
                  <th>风险等级</th>
                  <th>描述</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in abnormalPostureRows" :key="idx">
                  <td>{{ fmt(row.timestamp) || '—' }}</td>
                  <td>{{ row.risk_level || '—' }}</td>
                  <td>{{ row.description || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="risk-table-wrap">
            <div class="risk-table-title">运动损伤风险</div>
            <table class="risk-table">
              <thead>
                <tr>
                  <th>部位</th>
                  <th>风险等级</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in injuryRows" :key="idx">
                  <td>{{ row.part }}</td>
                  <td>{{ row.level }}</td>
                  <td>{{ row.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Actions -->
        <!--<div class="card actions-card">
          <button class="action-btn btn-poster" :disabled="generatingPoster" @click="generatePoster">
            {{ generatingPoster ? '生成中…' : '🖼️ 生成海报图' }}
          </button>
          <button class="action-btn btn-share" @click="copyLink">
            🔗 复制分享链接
          </button>
        </div>-->

        <!-- Footer -->
        <div class="share-footer">
          <p>由 <strong>{{ shareData.coachName }}</strong> 教练分享 · {{ formatDate(shareData.createTime) }}</p>
          <p>已被查看 {{ (shareData.viewCount || 0) + 1 }} 次 · 游泳AI智能训练系统</p>
        </div>
      </main>
    </template>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.share-page {
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  background: radial-gradient(circle at top right, #dbeafe 0%, #f0f9ff 42%, #eef2ff 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

/* Loading / Error */
.share-loading, .share-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  color: #334155;
  gap: 12px;
  text-align: center;
}
.loading-wave {
  font-size: 36px;
  animation: wave 1.2s infinite alternate;
}
@keyframes wave { from { letter-spacing: 0; } to { letter-spacing: 8px; } }
.error-emoji { font-size: 64px; }
.share-error h2 { font-size: 24px; margin: 0; }
.share-error p { opacity: 0.75; }

/* Hero */
.share-hero {
  position: relative;
  text-align: center;
  padding: 34px 20px 24px;
  overflow: hidden;
}
.hero-wave {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 60px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 60'%3E%3Cpath fill='rgba(255,255,255,0.08)' d='M0,30 C360,60 1080,0 1440,30 L1440,60 L0,60 Z'/%3E%3C/svg%3E") no-repeat bottom;
  background-size: cover;
}
.hero-emoji { font-size: 56px; }
.hero-title {
  font-size: 28px;
  font-weight: 900;
  color: #0f172a;
  margin: 8px 0 4px;
  letter-spacing: 1px;
}
.hero-subtitle {
  font-size: 14px;
  color: #475569;
  margin: 0;
}

/* Main */
.share-main {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 14px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid #dbeafe;
  border-radius: 16px;
  padding: 20px;
  color: #0f172a;
  box-shadow: 0 10px 28px rgba(30, 64, 175, 0.08);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 14px;
  color: #1d4ed8;
}

/* Student Card */
.student-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.student-avatar {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  flex-shrink: 0;
}
.student-info { flex: 1; }
.student-name { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.student-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.tag {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #334155;
}
.student-target { font-size: 13px; color: #475569; }

.metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.metric-item { border: 1px solid #bfdbfe; border-radius: 12px; padding: 10px 12px; background: #eff6ff; }
.metric-label { font-size: 12px; color: #1e40af; margin-bottom: 4px; }
.metric-value { font-size: 16px; font-weight: 700; color: #0f172a; word-break: break-word; }

/* Score Card */
.score-card { text-align: center; }
.score-title { font-size: 14px; color: #64748b; margin-bottom: 12px; }
.score-ring-wrap { display: flex; justify-content: center; }
.score-svg { width: 130px; height: 130px; }
.risk-badge {
  display: inline-block;
  margin: 10px auto 0;
  padding: 5px 18px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 700;
}
.risk-low { background: rgba(16,185,129,0.14); color: #047857; border: 1px solid rgba(16,185,129,0.35); }
.risk-mid { background: rgba(245,158,11,0.14); color: #b45309; border: 1px solid rgba(245,158,11,0.35); }
.risk-high { background: rgba(239,68,68,0.14); color: #b91c1c; border: 1px solid rgba(239,68,68,0.35); }
.score-detail { margin-top: 14px; display: flex; justify-content: center; }
.score-item { text-align: center; }
.si-label { display: block; font-size: 12px; color: #64748b; margin-bottom: 2px; }
.si-val { font-size: 20px; font-weight: 700; }

/* Video */
.video-card {}
.share-video {
  width: 100%;
  border-radius: 12px;
  background: #000;
}

/* Annotation */
.annotation-card {}
.annotation-coach {
  font-size: 13px;
  color: #475569;
  margin-bottom: 12px;
}
.coach-tag {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(99,102,241,0.35);
  border-radius: 6px;
  font-weight: 600;
  margin-right: 6px;
  color: #c7d2fe;
}
.annotation-canvas-wrap {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}
.annotation-image-wrap {
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}
.annotation-image {
  width: 100%;
  display: block;
  object-fit: contain;
  background: #000;
}
.ann-bg-video {
  width: 100%;
  display: block;
}
.ann-overlay-canvas {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}

/* Summary */
.summary-text {
  background: linear-gradient(180deg, #f8fbff 0%, #eff6ff 100%);
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  padding: 12px;
  color: #1f2937;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 10px 0 8px;
  color: #1d4ed8;
  line-height: 1.45;
}

.markdown-body :deep(p) {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.8;
  color: #334155;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 8px 0 10px;
  padding-left: 20px;
  color: #334155;
}

.markdown-body :deep(li) {
  margin: 4px 0;
  line-height: 1.7;
}

.markdown-body :deep(code) {
  background: #dbeafe;
  color: #1e3a8a;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 12px;
}

.markdown-body :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.summary-evidence-table {
  width: 100%;
  border-collapse: collapse;
  border-radius: 8px;
  overflow-x: auto;
  display: block;
}

.summary-evidence-table thead,
.summary-evidence-table tbody {
  display: table;
  width: 100%;
  min-width: 640px;
}

.summary-evidence-table th,
.summary-evidence-table td {
  border: 1px solid #bfdbfe;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  font-size: 13px;
  color: #1f2937;
  max-width: 220px;
  overflow-wrap: break-word;
  word-break: break-all;
}

.summary-evidence-table th {
  background: #dbeafe;
  color: #1e3a8a;
  font-weight: 700;
}

.summary-evidence-table td {
  background: rgba(255, 255, 255, 0.9);
}

.risk-card {
  border-color: #93c5fd;
  background: linear-gradient(180deg, #f8fbff 0%, #f0f9ff 100%);
}

.risk-level-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.risk-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.risk-tip {
  color: #334155;
  font-size: 13px;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.risk-item {
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  border-radius: 10px;
  padding: 10px;
}

.risk-item-label {
  color: #1e3a8a;
  font-size: 12px;
  margin-bottom: 4px;
}

.risk-item-value {
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.risk-table-wrap {
  margin-top: 12px;
}

.risk-table-title {
  font-size: 13px;
  font-weight: 700;
  color: #1d4ed8;
  margin-bottom: 8px;
}

.risk-table {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border-radius: 10px;
}

.risk-table th,
.risk-table td {
  border: 1px solid #bfdbfe;
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  vertical-align: top;
}

.risk-table th {
  background: #dbeafe;
  color: #1e3a8a;
  font-weight: 700;
}

.risk-table td {
  background: #f8fbff;
  color: #1f2937;
}

/* Actions */
.actions-card {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.action-btn {
  flex: 1;
  min-width: 140px;
  padding: 14px 20px;
  border-radius: 14px;
  border: none;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-poster {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
  box-shadow: 0 4px 20px rgba(239,68,68,0.4);
}
.btn-poster:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(239,68,68,0.5); }
.btn-share {
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  color: #fff;
  box-shadow: 0 4px 20px rgba(14,165,233,0.35);
}
.btn-share:hover { transform: translateY(-2px); }

/* Footer */
.share-footer {
  text-align: center;
  font-size: 12px;
  color: #64748b;
  line-height: 1.8;
}

@media (max-width: 640px) {
  .metrics-grid { grid-template-columns: 1fr; }
  .risk-grid { grid-template-columns: 1fr; }
  .share-main { padding: 0 12px 32px; }
  .card { padding: 16px; }
}

/* Poster Modal */
.poster-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.poster-modal-box {
  background: #1a1d24;
  border-radius: 16px;
  padding: 20px;
  max-width: 420px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 90vh;
  overflow-y: auto;
}
.poster-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #e0e6ff;
  font-weight: 600;
  font-size: 14px;
}
.poster-close {
  background: none;
  border: none;
  color: #8899aa;
  font-size: 16px;
  cursor: pointer;
}
.poster-img {
  width: 100%;
  border-radius: 10px;
}
</style>
