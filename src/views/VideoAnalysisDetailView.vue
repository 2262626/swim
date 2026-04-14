<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getVideoTaskApi, downloadReportApi, listVideoTasksApi, getAnnotationApi, getAnnotationContentApi, createShareLinkApi, getShareHistoryApi, getShareLinkApi } from '../api/videoAnalysis.js'
import VideoAnnotator from '../components/VideoAnnotator.vue'

const route = useRoute()
const router = useRouter()

const task = ref(null)
const tasks = ref([])
const loadingTasks = ref(false)
const loading = ref(false)
const loadError = ref('')
const downloading = ref(false)
const downloadError = ref('')
const activeResultTab = ref('evidence')
const showAnnotator = ref(false)
const annotationStrokes = ref([])
const annotationContent = ref(null)
const loadingAnnotation = ref(false)
const shareHistory = ref([])
const creatingShare = ref(false)
const loadingShareHistory = ref(false)
const shareError = ref('')
const showShareModal = ref(false)
let pollTimer = null

const taskId = computed(() => Number(route.params.taskId))

const parseDateSafe = (input) => {
  if (!input) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  if (typeof input === 'number') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const raw = String(input).trim()
  if (!raw) return null
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const hh = Number(m[4] || 0)
  const mm = Number(m[5] || 0)
  const ss = Number(m[6] || 0)
  const parsed = new Date(y, mo, d, hh, mm, ss)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const mediaApiPrefix = (() => {
  const rawBase = String(import.meta.env.VITE_RUOYI_API_BASE_URL || '').trim()
  if (!rawBase) return '/dev-api'
  try {
    const parsed = new URL(rawBase, window.location.origin)
    const pathname = (parsed.pathname || '').replace(/\/$/, '')
    return pathname || ''
  } catch {
    return rawBase.replace(/\/$/, '')
  }
})()

const formatTime = (t) => {
  const d = parseDateSafe(t)
  if (!d) return '—'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const shortName = (url) => {
  if (!url) return '未知视频'
  const name = url.split('/').pop().split('?')[0]
  return name.length > 28 ? name.slice(0, 28) + '…' : name
}

const SECTION_LABEL_MAP = {
  evidence: '视频汇总',
  baseInfo: '基础信息',
  keyPoint: '关键点时序',
  strokeTech: '泳姿技术',
  performance: '运动表现',
  risk: '风险预警',
  benchmark: '对标评估',
  business: '业务应用',
}

const TAB_SECTION_KEY_MAP = {
  baseInfo: 'output_base_info',
  keyPoint: 'key_point_timing_data',
  strokeTech: 'stroke_technique_quant_data',
  performance: 'performance_fitness_data',
  risk: 'error_action_risk_warning',
  benchmark: 'benchmark_evaluation_data',
  business: 'business_application_output',
}

const statusLabel = (s) =>
  ({ PENDING: '排队中', RUNNING: '分析中', SUCCESS: '完成', FAILED: '失败' })[s] || s

const statusClass = (s) =>
  ({ PENDING: 'status-pending', RUNNING: 'status-running', SUCCESS: 'status-success', FAILED: 'status-failed' })[s] || ''

const riskClass = (r) => {
  if (!r) return ''
  if (r.includes('高')) return 'risk-high'
  if (r.includes('中')) return 'risk-mid'
  return 'risk-low'
}

const isSuccess = computed(() => task.value?.status === 'SUCCESS')
const isFailed = computed(() => task.value?.status === 'FAILED')
const isRunning = computed(() => task.value?.status === 'PENDING' || task.value?.status === 'RUNNING')

const headerTitle = computed(() => {
  const athlete = task.value?.athleteName || '学员—'
  const stroke = task.value?.strokeType || '泳姿—'
  const pool = task.value?.poolLength != null ? `${task.value.poolLength}m` : '—m'
  return `${athlete} - ${stroke} - ${pool}`
})

const loadTasks = async () => {
  loadingTasks.value = true
  try {
    const res = await listVideoTasksApi({ pageNum: 1, pageSize: 60 })
    tasks.value = res?.rows || res?.data?.rows || []
  } catch {
    tasks.value = []
  } finally {
    loadingTasks.value = false
  }
}

const parsedData = computed(() => {
  if (!task.value?.analysisData) return null
  try { return JSON.parse(task.value.analysisData) } catch { return null }
})

const baseInfo = computed(() => parsedData.value?.output_base_info || null)
const videoDescription = computed(() => baseInfo.value?.video_description || '')

const SWIM_KEYWORDS = ['游泳', '泳姿', '泳池', '水中', '蝶泳', '蛙泳', '自由泳', '仰泳', '划水', '泳者', '运动员']
const isInvalidSwimVideo = computed(() => {
  if (!isSuccess.value || !parsedData.value) return false
  const desc = videoDescription.value
  if (!desc) return false
  const validSwimDur = baseInfo.value?.valid_swim_duration
  const zeroSwimTime = !validSwimDur || Number(validSwimDur) === 0
  const hasSwimKw = SWIM_KEYWORDS.some((kw) => desc.includes(kw))
  return zeroSwimTime && !hasSwimKw
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

const displayTaskVideoUrl = computed(() => {
  const url = task.value?.videoUrl
  if (!url) return ''
  return resolveMediaUrl(url)
})

const originalVideoCoverUrl = computed(() => {
  const candidates = [
    baseInfo.value?.video_cover_url,
    businessVisual.value?.original_video_cover_url,
  ]
  for (const raw of candidates) {
    const value = String(raw || '').trim()
    if (value) return resolveMediaUrl(value)
  }
  return ''
})

const issueList = computed(() => {
  const cards = parsedData.value?.business_application_output
    ?.visual_material_output?.metric_evidence_cards || []
  return cards.filter((card) => {
    const section = String(card?.section || '').toLowerCase()
    const sectionLabel = String(SECTION_LABEL_MAP[card?.section] || '').toLowerCase()
    const metricLabel = String(card?.metric_label || '').toLowerCase()
    const metricKey = String(card?.metric_key || '').toLowerCase()
    const summary = String(card?.issue_summary || '').toLowerCase()

    const hitBySection = section.includes('skeleton') || section.includes('bone') || section.includes('realtime')
    const hitByText = [sectionLabel, metricLabel, metricKey, summary]
      .some((text) => text.includes('骨骼实时识别') || text.includes('骨骼识别') || text.includes('实时骨骼'))

    return !(hitBySection || hitByText)
  })
})

const evidenceCards = computed(() => issueList.value)

const sectionCardsMap = computed(() => {
  const map = {}
  evidenceCards.value.forEach((card) => {
    const section = card?.section || 'other'
    if (!map[section]) map[section] = []
    map[section].push(card)
  })
  return map
})

const currentTabSectionData = computed(() => {
  const key = TAB_SECTION_KEY_MAP[activeResultTab.value]
  return key ? parsedData.value?.[key] : null
})

const currentTabEvidenceCards = computed(() => {
  return sectionCardsMap.value[activeResultTab.value] || []
})

const getByPath = (obj, path) => {
  if (!obj || !path) return null
  return path.split('.').reduce((acc, key) => (acc == null ? null : acc[key]), obj)
}

const toPairs = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj)
}

const formatPrimitive = (v) => {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return Number(v).toFixed(2)
  if (Array.isArray(v)) return v.join('、') || '—'
  if (typeof v === 'object') return '结构化数据'
  return String(v)
}

const BASE_INFO_LABELS = {
  video_id: '视频ID',
  student_id: '学员ID',
  stroke_type: '泳姿',
  pool_length: '泳池长度',
  camera_type: '机位',
  shoot_date: '拍摄日期',
  data_confidence_score: '置信度',
  video_duration: '视频总时长',
  valid_swim_duration: '有效游进时长',
  training_target: '训练目标',
  video_cover_url: '视频封面',
  video_description: '视频描述',
  unavailable_data_items: '不可用数据项'
}

const baseInfoLabel = (key) => BASE_INFO_LABELS[key] || key || '—'

const baseInfoPairs = computed(() =>
  toPairs(baseInfo.value).filter(([k]) => k !== 'video_description' && k !== 'unavailable_data_items')
)

const unavailableDataItems = computed(() => {
  const raw = baseInfo.value?.unavailable_data_items
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (entry && typeof entry === 'object') {
      return { item: baseInfoLabel(entry.item || entry.name) || '—', reason: entry.reason || entry.description || '' }
    }
    return { item: baseInfoLabel(String(entry)) || '—', reason: '' }
  }).filter((e) => e.item && e.item !== '—')
})
const keyPointData = computed(() => parsedData.value?.key_point_timing_data || null)
const strokeTechData = computed(() => parsedData.value?.stroke_technique_quant_data || null)
const performanceData = computed(() => parsedData.value?.performance_fitness_data || null)
const riskData = computed(() => parsedData.value?.error_action_risk_warning || null)
const benchmarkData = computed(() => parsedData.value?.benchmark_evaluation_data || null)
const businessData = computed(() => parsedData.value?.business_application_output || null)

const keyPointRows = computed(() => {
  const timing = keyPointData.value?.timing_data
  return Array.isArray(timing) ? timing.slice(0, 30) : []
})

const keyPointHeaders = computed(() => {
  const first = keyPointRows.value[0]
  if (!first?.key_points) return []
  return Object.keys(first.key_points).slice(0, 6)
})

const briefCards = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj)
    .filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 8)
    .map(([k, v]) => ({ label: k, value: formatPrimitive(v) }))
}

const strokeTechCards = computed(() => briefCards(strokeTechData.value?.body_posture_basic_data || strokeTechData.value))
const performanceCards = computed(() => briefCards(performanceData.value?.core_efficiency_index || performanceData.value))
const riskCards = computed(() => briefCards(riskData.value?.drowning_safety_risk || riskData.value))
const benchmarkCards = computed(() => briefCards(benchmarkData.value?.standard_template_matching_score || benchmarkData.value))
const businessCards = computed(() => briefCards(businessData.value?.teaching_management_data || businessData.value))

const strokeTechMetrics = computed(() => {
  const data = strokeTechData.value || {}
  return [
    { label: '躯干夹角均值', value: formatPrimitive(getByPath(data, 'body_posture_basic_data.trunk_water_angle.average_value')) },
    { label: '夹角波动范围', value: formatPrimitive(getByPath(data, 'body_posture_basic_data.trunk_water_angle.fluctuation_range')) },
    { label: '髋部水面高度', value: formatPrimitive(getByPath(data, 'body_posture_basic_data.hip_height_data.relative_water_height_avg')) },
    { label: '划频(次/min)', value: formatPrimitive(getByPath(data, 'stroke_action_full_cycle_data.stroke_basic_index.stroke_rate')) },
    { label: '划距均值(m)', value: formatPrimitive(getByPath(data, 'stroke_action_full_cycle_data.stroke_basic_index.stroke_distance_per_cycle.average_value')) },
    { label: '高肘保持比(%)', value: formatPrimitive(getByPath(data, 'stroke_action_full_cycle_data.stroke_phase_data.high_elbow_hold_duration_ratio')) },
    { label: '打腿频率(次/min)', value: formatPrimitive(getByPath(data, 'kicking_action_refined_data.kicking_basic_index.kicking_frequency')) },
    { label: '打腿幅度均值(m)', value: formatPrimitive(getByPath(data, 'kicking_action_refined_data.kicking_basic_index.kicking_amplitude_avg')) },
  ]
})

const performanceMetrics = computed(() => {
  const data = performanceData.value || {}
  return [
    { label: '平均配速(s/100m)', value: formatPrimitive(getByPath(data, 'core_efficiency_index.average_pace')) },
    { label: 'SWOLF(单趟均值)', value: formatPrimitive(getByPath(data, 'core_efficiency_index.SWOLF_score.single_lap_avg')) },
    { label: 'SWOLF(全程)', value: formatPrimitive(getByPath(data, 'core_efficiency_index.SWOLF_score.full_course')) },
    { label: '速度衰减率(%)', value: formatPrimitive(getByPath(data, 'core_efficiency_index.speed_attenuation_rate')) },
    { label: '有效游进距离(m)', value: formatPrimitive(getByPath(data, 'fitness_consumption_data.effective_swim_distance')) },
    { label: '卡路里消耗(kcal)', value: formatPrimitive(getByPath(data, 'fitness_consumption_data.calorie_consumption_estimate')) },
    { label: '停顿次数', value: formatPrimitive(getByPath(data, 'fitness_consumption_data.pause_count')) },
    { label: '停顿总时长(s)', value: formatPrimitive(getByPath(data, 'fitness_consumption_data.pause_total_duration')) },
  ]
})

const splitPaceRows = computed(() => {
  const rows = getByPath(performanceData.value, 'core_efficiency_index.split_pace')
  return Array.isArray(rows) ? rows : []
})

const riskMetrics = computed(() => {
  const data = riskData.value || {}
  return [
    { label: '综合风险等级', value: formatPrimitive(getByPath(data, 'drowning_safety_risk.comprehensive_risk_level')) },
    { label: '口鼻没入超时次数', value: formatPrimitive(getByPath(data, 'drowning_safety_risk.mouth_nose_underwater_overtime_count')) },
    { label: '最长没入时长(s)', value: formatPrimitive(getByPath(data, 'drowning_safety_risk.max_underwater_duration')) },
    { label: '速度骤降次数', value: formatPrimitive(getByPath(data, 'drowning_safety_risk.speed_sudden_drop_count')) },
    { label: '肩部损伤风险', value: formatPrimitive(getByPath(data, 'sports_injury_risk.shoulder_injury_risk.risk_level')) },
    { label: '膝部损伤风险', value: formatPrimitive(getByPath(data, 'sports_injury_risk.knee_injury_risk.risk_level')) },
    { label: '腰部损伤风险', value: formatPrimitive(getByPath(data, 'sports_injury_risk.lumbar_injury_risk.risk_level')) },
  ]
})

const abnormalPostureRows = computed(() => {
  const rows = getByPath(riskData.value, 'drowning_safety_risk.abnormal_posture_recognition')
  return Array.isArray(rows) ? rows : []
})

const benchmarkMetrics = computed(() => {
  const data = benchmarkData.value || {}
  return [
    { label: '综合评分', value: formatPrimitive(getByPath(data, 'standard_template_matching_score.total_score')) },
    { label: '身体姿态评分', value: formatPrimitive(getByPath(data, 'standard_template_matching_score.sub_item_score.body_posture_score')) },
    { label: '划水动作评分', value: formatPrimitive(getByPath(data, 'standard_template_matching_score.sub_item_score.stroke_action_score')) },
    { label: '打腿动作评分', value: formatPrimitive(getByPath(data, 'standard_template_matching_score.sub_item_score.kicking_action_score')) },
    { label: '节奏匹配评分', value: formatPrimitive(getByPath(data, 'standard_template_matching_score.sub_item_score.rhythm_matching_score')) },
  ]
})

const benchmarkDeviationRows = computed(() => {
  const rows = getByPath(benchmarkData.value, 'standard_template_matching_score.matching_deviation_details')
  return Array.isArray(rows) ? rows : []
})

const businessTeachingSuggestion = computed(() => getByPath(businessData.value, 'personalized_teaching_suggestion') || {})
const normalizedCoreWeakItems = computed(() => {
  const raw = businessTeachingSuggestion.value?.core_weak_items

  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      if (entry && typeof entry === 'object') {
        return {
          item: entry.item || entry.name || '—',
          description: entry.description || entry.detail || '',
          priority: entry.priority || entry.level || ''
        }
      }
      return { item: String(entry || '—'), description: '', priority: '' }
    })
  }

  if (typeof raw !== 'string' || !raw.trim()) return []

  const text = raw.trim()
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => {
        if (entry && typeof entry === 'object') {
          return {
            item: entry.item || entry.name || '—',
            description: entry.description || entry.detail || '',
            priority: entry.priority || entry.level || ''
          }
        }
        return { item: String(entry || '—'), description: '', priority: '' }
      })
    }
    if (parsed && typeof parsed === 'object') {
      return [{
        item: parsed.item || parsed.name || '—',
        description: parsed.description || parsed.detail || '',
        priority: parsed.priority || parsed.level || ''
      }]
    }
  } catch {
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const list = []
  lines.forEach((line) => {
    try {
      const obj = JSON.parse(line)
      if (obj && typeof obj === 'object') {
        list.push({
          item: obj.item || obj.name || '—',
          description: obj.description || obj.detail || '',
          priority: obj.priority || obj.level || ''
        })
      }
    } catch {
      list.push({ item: line, description: '', priority: '' })
    }
  })
  return list
})
const businessRetention = computed(() => getByPath(businessData.value, 'student_retention_warning') || {})
const businessVisual = computed(() => getByPath(businessData.value, 'visual_material_output') || {})
const businessCourse = computed(() => getByPath(businessData.value, 'advanced_course_recommendation') || {})
const businessManagement = computed(() => getByPath(businessData.value, 'teaching_management_data') || {})

const classCommonIssues = computed(() => {
  const rows = businessManagement.value?.class_common_issues
  return Array.isArray(rows) ? rows : []
})

const resolveMediaUrl = (url) => {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      const profileIndex = parsed.pathname.indexOf('/profile/')
      if (profileIndex >= 0) {
        const profilePath = parsed.pathname.substring(profileIndex)
        return normalizeLoopbackMediaUrl(
          `${window.location.origin}${mediaApiPrefix}${profilePath}${parsed.search || ''}${parsed.hash || ''}`
        )
      }
    } catch {
      return normalizeLoopbackMediaUrl(value)
    }
    return normalizeLoopbackMediaUrl(value)
  }
  if (mediaApiPrefix && value.startsWith(`${mediaApiPrefix}/`)) {
    return normalizeLoopbackMediaUrl(`${window.location.origin}${value}`)
  }
  if (value.startsWith('/')) {
    return normalizeLoopbackMediaUrl(`${window.location.origin}${mediaApiPrefix}${value}`)
  }
  return normalizeLoopbackMediaUrl(`${window.location.origin}/${value}`)
}

const hasClip = (card) => {
  if (!card) return false
  if (card.video_clip_url && card.render_status === 'READY') return true
  const start = card.start_sec != null ? card.start_sec : card.clip_start_sec
  return start != null && !!displayTaskVideoUrl.value
}

const clipSrc = (card) => {
  if (!card) return ''
  if (card.video_clip_url && card.render_status === 'READY') {
    return resolveMediaUrl(card.video_clip_url)
  }
  const start = card.start_sec != null ? card.start_sec : card.clip_start_sec
  const end = card.end_sec != null ? card.end_sec : card.clip_end_sec
  const base = displayTaskVideoUrl.value
  if (start != null && base) {
    return end != null ? `${base}#t=${start},${end}` : `${base}#t=${start}`
  }
  return ''
}

const clipPoster = (card) => {
  const value = String(card?.video_cover_url || card?.clip_cover_url || '').trim()
  if (value) return resolveMediaUrl(value)
  return originalVideoCoverUrl.value
}

const formatSec = (val) => {
  if (val == null) return '-'
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}

// 获取可视化素材切片文件URL（优先使用后端生成的切片文件）
const visualClipSrc = (clip) => {
  if (!clip) return ''
  // 优先使用预生成的视频片段文件
  if (clip.video_clip_url) {
    return resolveMediaUrl(clip.video_clip_url)
  }
  return ''
}

// 获取可视化素材切片封面URL
const visualClipCover = (clip) => {
  if (!clip) return ''
  if (clip.video_cover_url) {
    return resolveMediaUrl(clip.video_cover_url)
  }
  return originalVideoCoverUrl.value || ''
}

const resolveMetricValue = (metricKey) => {
  if (!metricKey || !parsedData.value) return null
  try {
    const parts = metricKey.split('.')
    let obj = parsedData.value
    for (const p of parts) {
      if (obj == null || typeof obj !== 'object') return null
      obj = obj[p]
    }
    return obj != null && typeof obj !== 'object' ? obj : null
  } catch {
    return null
  }
}

const loadTask = async ({ silent = false } = {}) => {
  if (!taskId.value) {
    loadError.value = '任务ID无效'
    return
  }
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    const res = await getVideoTaskApi(taskId.value)
    task.value = res?.data || null
  } catch (err) {
    loadError.value = err.message || '加载任务详情失败'
  } finally {
    if (!silent) loading.value = false
  }
}

const startPoll = () => {
  clearPoll()
  pollTimer = setInterval(async () => {
    await loadTask({ silent: true })
    if (!isRunning.value) clearPoll()
  }, 5000)
}

const clearPoll = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const downloadReport = async () => {
  if (!task.value?.taskId || !isSuccess.value) return
  downloading.value = true
  downloadError.value = ''
  try {
    await downloadReportApi(task.value.taskId)
  } catch (err) {
    downloadError.value = err.message
  } finally {
    downloading.value = false
  }
}

const openAnnotator = async () => {
  if (!task.value?.taskId) return
  loadingAnnotation.value = true
  try {
    const res = await getAnnotationApi(task.value.taskId)
    const raw = res?.data?.annotationData
    annotationStrokes.value = raw ? JSON.parse(raw) : []
  } catch {
    annotationStrokes.value = []
  } finally {
    loadingAnnotation.value = false
  }
  showAnnotator.value = true
}

const loadAnnotationContent = async () => {
  if (!task.value?.taskId) {
    annotationContent.value = null
    return
  }
  try {
    const res = await getAnnotationContentApi(task.value.taskId)
    annotationContent.value = res?.data || null
  } catch {
    annotationContent.value = null
  }
}

const handleAnnotationSave = (strokes) => {
  annotationStrokes.value = strokes
  loadAnnotationContent()
}

const openShareModal = async () => {
  shareError.value = ''
  loadingShareHistory.value = true
  showShareModal.value = true
  try {
    const res = await getShareHistoryApi(task.value.taskId)
    const history = Array.isArray(res?.data)
      ? res.data.filter((item) => item && typeof item === 'object')
      : []

    if (history.length) {
      shareHistory.value = history
      return
    }

    const fallback = await getShareLinkApi(task.value.taskId)
    const single = fallback?.data && typeof fallback.data === 'object' ? fallback.data : null
    shareHistory.value = single ? [single] : []
  } catch (err) {
    shareHistory.value = []
    shareError.value = err?.message || '历史链接加载失败，请检查后端是否已重启并包含 /swim/share/history 接口'
  } finally {
    loadingShareHistory.value = false
  }
}

const createShare = async () => {
  creatingShare.value = true
  shareError.value = ''
  try {
    const res = await createShareLinkApi(task.value.taskId)
    if (res?.data && typeof res.data === 'object') {
      shareHistory.value = [res.data, ...shareHistory.value]
    }
  } catch (err) {
    shareError.value = err.message || '生成失败'
  } finally {
    creatingShare.value = false
  }
}

const shareLimitReached = computed(() => shareHistory.value.length >= 3)

const shareUrlByCode = (shareCode) => {
  if (!shareCode) return ''
  return `${window.location.origin}/share/${shareCode}`
}

const copyShareUrl = (shareCode) => {
  const url = shareUrlByCode(shareCode)
  if (!url) return
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

const goBack = () => router.push('/analysis')
const openTask = (item) => {
  if (!item?.taskId || item.taskId === taskId.value) return
  router.push(`/analysis/${item.taskId}`)
}

onMounted(async () => {
  await Promise.all([loadTask(), loadTasks()])
  await loadAnnotationContent()
  if (isRunning.value) startPoll()
})

watch(() => route.params.taskId, async () => {
  clearPoll()
  activeResultTab.value = 'evidence'
  await loadTask()
  await loadAnnotationContent()
  if (isRunning.value) startPoll()
})

onUnmounted(() => clearPoll())
</script>

<template>
  <div class="detail-view">
    <header class="detail-header">
      <button class="back-btn" @click="goBack">
        <svg width="18" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        返回
      </button>
      <div class="detail-title">{{ headerTitle }}</div>
      <div class="header-spacer"></div>
    </header>

    <main class="detail-main">
      <aside class="task-side">
        <div class="task-side-header">任务列表</div>
        <div v-if="loadingTasks" class="task-side-empty">加载中...</div>
        <div v-else-if="!tasks.length" class="task-side-empty">暂无任务</div>
        <div v-else class="task-side-list">
          <div
            v-for="item in tasks"
            :key="item.taskId"
            class="task-card"
            :class="[{ 'task-active': item.taskId === taskId }, statusClass(item.status)]"
            @click="openTask(item)"
          >
            <div class="task-status-icon" :class="statusClass(item.status)">
              <span v-if="item.status === 'PENDING'">⏳</span>
              <span v-else-if="item.status === 'RUNNING'" class="spin-icon">⟳</span>
              <span v-else-if="item.status === 'SUCCESS'">✓</span>
              <span v-else>✗</span>
            </div>
            <div class="task-info">
              <div class="task-video">{{ shortName(item.videoUrl) }}</div>
              <div class="task-meta">
                <span class="tag-stroke">{{ item.strokeType || '—' }}</span>
                <span v-if="item.athleteName" class="tag-athlete">{{ item.athleteName }}</span>
                <span class="tag-time">{{ formatTime(item.createTime) }}</span>
              </div>
            </div>
            <div class="task-right">
              <span class="status-pill" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
            </div>
          </div>
        </div>
      </aside>

      <section class="detail-content">
      <div v-if="loading" class="state-panel">加载中...</div>
      <div v-else-if="loadError" class="state-panel state-error">{{ loadError }}</div>

      <section v-else-if="task" class="detail-panel">
        <div class="detail-static">
          <div class="panel-top">
            <span class="status-pill" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
            <div class="panel-top-actions">
              <!-- <button v-if="isSuccess" class="top-btn btn-annotate" :disabled="loadingAnnotation" @click="openAnnotator">
                {{ loadingAnnotation ? '加载中…' : '✏️ 标注视频' }}
              </button> -->
              <button v-if="isSuccess" class="top-btn btn-share" @click="openShareModal">
                分享给家长
              </button>
              <button class="top-btn btn-pdf" :disabled="!isSuccess || downloading" @click="downloadReport">
                {{ downloading ? '下载中…' : '下载PDF报告' }}
              </button>
            </div>
          </div>

          <div class="metrics-row">
            <div class="metric-card"><div class="label">综合评分</div><div class="value">{{ task.overallScore ?? '—' }}</div></div>
            <div class="metric-card"><div class="label">风险等级</div><div class="value" :class="riskClass(task.riskLevel)">{{ task.riskLevel || '—' }}</div></div>
            <div class="metric-card"><div class="label">数据置信度</div><div class="value">{{ task.confidenceScore != null ? (task.confidenceScore).toFixed(0) + '分' : '—' }}</div></div>
            <div class="metric-card"><div class="label">耗时</div><div class="value">{{ task.processingTimeMs ? (task.processingTimeMs / 1000).toFixed(1) + 's' : '—' }}</div></div>
          </div>
        </div>

        <div class="detail-scroll">
          <div v-if="isRunning" class="state-panel">任务进行中，系统每 5 秒自动刷新。</div>
          <div v-if="isFailed" class="state-panel state-error">{{ task.errorMessage || '分析失败' }}</div>

          <div v-if="isSuccess && isInvalidSwimVideo" class="invalid-video-banner">
            <span class="invalid-icon">⚠️</span>
            <span><b>视频内容不符</b>：未检测到有效游泳画面，分析数据不可用。AI描述：{{ videoDescription }}</span>
          </div>

          <div v-if="isSuccess" class="result-tabs">
            <button class="result-tab-btn" :class="{ active: activeResultTab === 'evidence' }" @click="activeResultTab = 'evidence'">视频汇总 ({{ evidenceCards.length }})</button>
            <!-- <button class="result-tab-btn" :class="{ active: activeResultTab === 'annotation' }" @click="activeResultTab = 'annotation'">标注内容</button> -->
            <template v-if="!isInvalidSwimVideo">
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'baseInfo' }" @click="activeResultTab = 'baseInfo'">基础信息</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'keyPoint' }" @click="activeResultTab = 'keyPoint'">关键点时序</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'strokeTech' }" @click="activeResultTab = 'strokeTech'">泳姿技术</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'performance' }" @click="activeResultTab = 'performance'">运动表现</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'risk' }" @click="activeResultTab = 'risk'">风险预警</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'benchmark' }" @click="activeResultTab = 'benchmark'">对标评估</button>
              <button class="result-tab-btn" :class="{ active: activeResultTab === 'business' }" @click="activeResultTab = 'business'">业务应用</button>
            </template>
          </div>

        <div v-if="isSuccess">
          <div v-if="activeResultTab === 'evidence'" class="result-section">
            <div v-if="displayTaskVideoUrl" class="video-preview-panel">
              <div class="video-preview-header"><span>原始视频</span></div>
              <video class="video-preview-player" :src="displayTaskVideoUrl" :poster="originalVideoCoverUrl || undefined" controls preload="metadata"></video>
            </div>
            <div v-if="videoDescription" class="video-desc-box">{{ videoDescription }}</div>
            <div v-if="evidenceCards.length" class="evidence-grid">
              <div v-for="(card, idx) in evidenceCards" :key="idx" class="evidence-card">
                <div class="evidence-topbar">
                  <span class="evidence-section">{{ SECTION_LABEL_MAP[card.section] || card.section || '其他' }}</span>
                  <span class="evidence-metric">{{ card.metric_label || card.metric_key }}</span>
                </div>
                <div class="evidence-video-wrap">
                  <video v-if="hasClip(card)" :src="clipSrc(card)" :poster="clipPoster(card) || undefined" class="evidence-video" controls preload="metadata"></video>
                  <div v-else class="evidence-placeholder">视频片段生成中</div>
                </div>
                <div class="evidence-meta-row">
                  <span>可信度：{{ card.evidence_strength || '中' }}</span>
                  <span>片段：{{ formatSec(card.clip_start_sec != null ? card.clip_start_sec : card.start_sec) }}s ~ {{ formatSec(card.clip_end_sec != null ? card.clip_end_sec : card.end_sec) }}s</span>
                </div>
                <div v-if="resolveMetricValue(card.metric_key) != null" class="evidence-value">指标值：{{ resolveMetricValue(card.metric_key) }}</div>
                <div v-if="card.issue_summary" class="evidence-block">问题说明：{{ card.issue_summary }}</div>
                <div v-if="card.reasoning" class="evidence-block">AI 判断依据：{{ card.reasoning }}</div>
              </div>
            </div>
            <div v-else class="state-panel">暂无视频片段</div>
          </div>

          <div v-else-if="activeResultTab === 'annotation'" class="result-section">
            <div class="section-title">标注内容</div>
            <div v-if="annotationContent?.annotationImageUrl" class="annotation-tab-wrap">
              <img :src="annotationContent.annotationImageUrl" class="annotation-tab-image" alt="标注图片" />
              <div class="annotation-tab-meta">
                <span>标注教练：{{ annotationContent.coachName || '—' }}</span>
                <span>更新时间：{{ formatTime(annotationContent.updateTime || annotationContent.createTime) || '—' }}</span>
              </div>
            </div>
            <div v-else class="state-panel">暂无已保存的标注图片，请先点击“标注视频”并保存。</div>
          </div>

          <div v-else class="result-section">
            <div class="section-title">{{ SECTION_LABEL_MAP[activeResultTab] }}</div>

            <div v-if="activeResultTab === 'baseInfo'">
              <div class="kv-grid">
                <div v-for="(item, idx) in baseInfoPairs" :key="idx" class="kv-card">
                  <div class="kv-key">{{ baseInfoLabel(item[0]) }}</div>
                  <div class="kv-val">{{ formatPrimitive(item[1]) }}</div>
                </div>
              </div>
              <div v-if="unavailableDataItems.length" style="margin-top:12px;">
                <div class="section-title" style="font-size:13px;margin-bottom:6px;">不可用数据项说明</div>
                <div v-for="(entry, idx) in unavailableDataItems" :key="idx" class="kv-card" style="margin-bottom:6px;">
                  <div class="kv-key">{{ entry.item }}</div>
                  <div class="kv-val">{{ entry.reason || '—' }}</div>
                </div>
              </div>
            </div>

            <div v-else-if="activeResultTab === 'keyPoint'" class="table-wrap">
              <div class="table-head">
                <span>帧率: {{ formatPrimitive(keyPointData?.frame_rate) }} fps</span>
                <span>关键帧数: {{ keyPointRows.length }}</span>
              </div>
              <div class="table-scroll" v-if="keyPointRows.length">
                <table class="mini-table">
                  <thead>
                    <tr>
                      <th>时间戳</th>
                      <th>帧号</th>
                      <th v-for="h in keyPointHeaders" :key="h">{{ h }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, idx) in keyPointRows" :key="idx">
                      <td>{{ formatSec(row.timestamp) }}s</td>
                      <td>{{ row.frame_number ?? '—' }}</td>
                      <td v-for="h in keyPointHeaders" :key="h">
                        {{ row.key_points?.[h]?.coordinate ? `(${formatSec(row.key_points[h].coordinate[0])}, ${formatSec(row.key_points[h].coordinate[1])})` : '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="state-panel">暂无关键点数据</div>
            </div>

            <div v-else-if="activeResultTab === 'strokeTech'" class="kv-grid">
              <div v-for="(item, idx) in strokeTechMetrics" :key="idx" class="kv-card">
                <div class="kv-key">{{ item.label }}</div>
                <div class="kv-val">{{ item.value }}</div>
              </div>
            </div>

            <div v-else-if="activeResultTab === 'performance'" class="kv-grid">
              <div v-for="(item, idx) in performanceMetrics" :key="idx" class="kv-card">
                <div class="kv-key">{{ item.label }}</div>
                <div class="kv-val">{{ item.value }}</div>
              </div>
            </div>

            <div v-if="activeResultTab === 'performance' && splitPaceRows.length" class="table-wrap">
              <div class="table-head"><span>百米分段配速</span><span>共 {{ splitPaceRows.length }} 条</span></div>
              <div class="table-scroll">
                <table class="mini-table">
                  <thead><tr><th>距离</th><th>配速(s/100m)</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, idx) in splitPaceRows" :key="idx">
                      <td>{{ row.split_distance }}m</td>
                      <td>{{ formatPrimitive(row.pace) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-else-if="activeResultTab === 'risk'" class="kv-grid">
              <div v-for="(item, idx) in riskMetrics" :key="idx" class="kv-card">
                <div class="kv-key">{{ item.label }}</div>
                <div class="kv-val">{{ item.value }}</div>
              </div>
            </div>

            <div v-if="activeResultTab === 'risk' && abnormalPostureRows.length" class="table-wrap">
              <div class="table-head"><span>异常姿态事件时间线</span><span>{{ abnormalPostureRows.length }} 条</span></div>
              <div class="table-scroll">
                <table class="mini-table">
                  <thead><tr><th>时间戳</th><th>风险等级</th><th>描述</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, idx) in abnormalPostureRows" :key="idx">
                      <td>{{ formatSec(row.timestamp) }}s</td>
                      <td>{{ row.risk_level || '—' }}</td>
                      <td>{{ row.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-else-if="activeResultTab === 'benchmark'" class="kv-grid">
              <div v-for="(item, idx) in benchmarkMetrics" :key="idx" class="kv-card">
                <div class="kv-key">{{ item.label }}</div>
                <div class="kv-val">{{ item.value }}</div>
              </div>
            </div>

            <div v-if="activeResultTab === 'benchmark' && benchmarkDeviationRows.length" class="table-wrap">
              <div class="table-head"><span>核心偏差明细</span><span>{{ benchmarkDeviationRows.length }} 条</span></div>
              <div class="table-scroll">
                <table class="mini-table">
                  <thead><tr><th>项目</th><th>偏差值</th><th>说明</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, idx) in benchmarkDeviationRows" :key="idx">
                      <td>{{ row.item || '—' }}</td>
                      <td>{{ formatPrimitive(row.deviation) }}</td>
                      <td>{{ row.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-else-if="activeResultTab === 'business'" class="business-wrap">
              <div class="biz-block">
                <div class="biz-title">个性化教学建议</div>
                <div class="biz-grid">
                  <div class="biz-card">
                    <div class="biz-subtitle">核心薄弱项</div>
                    <div v-if="normalizedCoreWeakItems.length" class="list-wrap">
                      <div v-for="(item, idx) in normalizedCoreWeakItems" :key="idx" class="list-item">
                        <b>{{ item.item || '—' }}</b>
                        <span v-if="item.priority" class="muted">（优先级：{{ item.priority }}）</span>
                        <div v-if="item.description" class="muted">{{ item.description }}</div>
                      </div>
                    </div>
                    <div v-else class="state-panel">暂无</div>
                  </div>
                  <div class="biz-card">
                    <div class="biz-subtitle">下节课训练重点</div>
                    <div v-if="(businessTeachingSuggestion.next_course_training_focus || []).length" class="list-wrap">
                      <div v-for="(item, idx) in businessTeachingSuggestion.next_course_training_focus" :key="idx" class="list-item">
                        <b>{{ item.focus || '—' }}</b>
                        <span class="muted" v-if="item.drill_plan"> — {{ item.drill_plan }}</span>
                      </div>
                    </div>
                    <div v-else class="state-panel">暂无</div>
                  </div>
                </div>
              </div>

              <div class="biz-block">
                <div class="biz-title">学员留存预警</div>
                <div class="kv-grid">
                  <div class="kv-card"><div class="kv-key">学习瓶颈预警</div><div class="kv-val">{{ businessRetention.growth_bottleneck_warning ? '已触发' : '正常' }}</div></div>
                  <div class="kv-card"><div class="kv-key">兴趣衰减预警</div><div class="kv-val">{{ businessRetention.learning_interest_attenuation_warning ? '预警' : '正常' }}</div></div>
                  <div class="kv-card"><div class="kv-key">课程续报建议</div><div class="kv-val">{{ businessRetention.course_renewal_suggestion || '—' }}</div></div>
                </div>
              </div>

              <div class="biz-block">
                <div class="biz-title">精彩时刻</div>
                <div v-if="(businessVisual.highlight_moment_timestamps || []).length" class="clip-grid">
                  <div v-for="(clip, idx) in businessVisual.highlight_moment_timestamps" :key="idx" class="clip-card">
                    <video v-if="visualClipSrc(clip)" :src="visualClipSrc(clip)" :poster="visualClipCover(clip) || undefined" class="clip-video" controls preload="metadata" playsinline muted></video>
                    <div v-else-if="clip.video_cover_url" class="clip-cover-wrapper">
                      <img :src="resolveMediaUrl(clip.video_cover_url)" class="clip-cover-img" />
                      <div class="clip-cover-badge">片段生成中</div>
                    </div>
                    <div v-else class="evidence-placeholder">片段生成中</div>
                    <div class="clip-info">
                      <span class="clip-time">{{ formatSec(clip.start) }}s ~ {{ formatSec(clip.end) }}s</span>
                      <span v-if="clip.description" class="clip-desc">{{ clip.description }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="state-panel">暂无</div>
              </div>

              <div class="biz-block">
                <div class="biz-title">错误动作片段</div>
                <div v-if="(businessVisual.error_action_clip_timestamps || []).length" class="clip-grid">
                  <div v-for="(clip, idx) in businessVisual.error_action_clip_timestamps" :key="idx" class="clip-card clip-card-error">
                    <video v-if="visualClipSrc(clip)" :src="visualClipSrc(clip)" :poster="visualClipCover(clip) || undefined" class="clip-video" controls preload="metadata" playsinline muted></video>
                    <div v-else-if="clip.video_cover_url" class="clip-cover-wrapper clip-cover-wrapper-error">
                      <img :src="resolveMediaUrl(clip.video_cover_url)" class="clip-cover-img" />
                      <div class="clip-cover-badge">片段生成中</div>
                    </div>
                    <div v-else class="evidence-placeholder">片段生成中</div>
                    <div class="clip-info">
                      <span class="clip-time">{{ formatSec(clip.start) }}s ~ {{ formatSec(clip.end) }}s</span>
                      <span v-if="clip.description" class="clip-desc">{{ clip.description }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="state-panel">暂无</div>
              </div>

              <div v-if="(businessVisual.progress_comparison_clip_timestamps || []).length" class="biz-block">
                <div class="biz-title">进步对比片段</div>
                <div class="clip-grid">
                  <div v-for="(clip, idx) in businessVisual.progress_comparison_clip_timestamps" :key="idx" class="clip-card">
                    <video v-if="visualClipSrc(clip)" :src="visualClipSrc(clip)" :poster="visualClipCover(clip) || undefined" class="clip-video" controls preload="metadata" playsinline muted></video>
                    <div v-else-if="clip.video_cover_url" class="clip-cover-wrapper clip-cover-wrapper-progress">
                      <img :src="resolveMediaUrl(clip.video_cover_url)" class="clip-cover-img" />
                      <div class="clip-cover-badge">片段生成中</div>
                    </div>
                    <div v-else class="evidence-placeholder">片段生成中</div>
                    <div class="clip-info">
                      <span class="clip-time">{{ formatSec(clip.start) }}s ~ {{ formatSec(clip.end) }}s</span>
                      <span v-if="clip.description" class="clip-desc">{{ clip.description }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="biz-block">
                <div class="biz-title">进阶课程推荐</div>
                <div class="kv-grid">
                  <div class="kv-card"><div class="kv-key">匹配课程</div><div class="kv-val">{{ (businessCourse.matched_course_type || []).join('、') || '—' }}</div></div>
                  <div class="kv-card"><div class="kv-key">推荐原因</div><div class="kv-val">{{ businessCourse.recommendation_reason || '—' }}</div></div>
                </div>
              </div>

              <div class="biz-block" v-if="classCommonIssues.length">
                <div class="biz-title">班级共性问题</div>
                <div class="table-wrap">
                  <div class="table-scroll">
                    <table class="mini-table">
                      <thead><tr><th>问题</th><th>影响占比(%)</th><th>建议训练</th></tr></thead>
                      <tbody>
                        <tr v-for="(row, idx) in classCommonIssues" :key="idx">
                          <td>{{ row.issue || '—' }}</td>
                          <td>{{ formatPrimitive(row.affected_ratio_percent) }}</td>
                          <td>{{ row.suggested_drill || '—' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="currentTabEvidenceCards.length && activeResultTab !== 'evidence'" class="section-evidence-strip">
              <div class="section-title">相关视频片段 ({{ currentTabEvidenceCards.length }})</div>
              <div class="clip-grid">
                <div v-for="(card, idx) in currentTabEvidenceCards" :key="idx" class="clip-card">
                  <video v-if="hasClip(card)" :src="clipSrc(card)" :poster="clipPoster(card) || undefined" class="clip-video" controls preload="metadata"></video>
                  <div v-else class="evidence-placeholder">无可播放片段</div>
                  <div class="clip-info">
                    <span class="clip-time">{{ formatSec(card.start_sec) }}s ~ {{ formatSec(card.end_sec) }}s</span>
                    <span class="clip-desc">{{ card.metric_label || card.metric_key }}</span>
                    <span v-if="card.issue_summary" class="clip-desc muted">{{ card.issue_summary }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <p v-if="downloadError" class="error-msg">{{ downloadError }}</p>
        </div>
      </section>
      </section>
    </main>
  </div>

  <!-- Annotation Tool Modal -->
  <VideoAnnotator
    v-if="showAnnotator && task"
    :videoUrl="displayTaskVideoUrl"
    :taskId="task.taskId"
    :initialStrokes="annotationStrokes"
    @save="handleAnnotationSave"
    @close="showAnnotator = false"
  />

  <!-- Share Link Modal -->
  <div v-if="showShareModal" class="share-modal-overlay" @click.self="showShareModal = false">
    <div class="share-modal">
      <div class="share-modal-header">
        <span>🔗 分享给家长</span>
        <button class="share-close-btn" @click="showShareModal = false">✕</button>
      </div>
      <div class="share-modal-body">
        <p class="share-desc">每个报告最多生成 3 个链接。可查看历史链接并快捷复制给家长。</p>

        <div class="share-limit-tip" :class="{ reached: shareLimitReached }">
          已生成 {{ shareHistory.length }}/3 个分享链接
        </div>

        <div v-if="loadingShareHistory" class="share-history-loading">
          <span class="spin-icon">⏳</span> 加载历史链接中…
        </div>
        <div v-else-if="shareHistory.length" class="share-history-list">
          <div v-for="(item, idx) in shareHistory" :key="item?.shareId || item?.shareCode || idx" class="share-history-item">
            <div class="share-url-box">
              <span class="share-url-text">{{ shareUrlByCode(item?.shareCode) }}</span>
              <button class="share-copy-btn" @click="copyShareUrl(item?.shareCode)">复制</button>
            </div>
            <div class="share-meta">创建于 {{ formatTime(item?.createTime) }} · 访问 {{ item?.viewCount || 0 }} 次</div>
          </div>
        </div>

        <p v-if="shareError" class="share-err">{{ shareError }}</p>
        <button class="share-gen-btn" :disabled="creatingShare || shareLimitReached" @click="createShare">
          {{ creatingShare ? '生成中…' : shareLimitReached ? '已达3次上限' : '✨ 新建分享链接' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-view { height: 100dvh; display: flex; flex-direction: column; background: #0a0a0f; color: #e8eaf6; }
.detail-header { position: relative; height: 56px; padding: 0 16px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
.detail-title { font-size: 15px; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 62%; }
.back-btn { position: absolute; left: 16px; background: none; border: none; color: #00e5ff; cursor: pointer; font-size: 14px; }
.header-spacer { position: absolute; right: 16px; width: 92px; }
.detail-main { flex: 1; min-height: 0; display: flex; gap: 12px; overflow: hidden; padding: 12px; }
.task-side { width: 280px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.02); display: flex; flex-direction: column; min-height: 0; }
.task-side-header { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #9094b0; }
.task-side-empty { padding: 14px 12px; font-size: 12px; color: #606480; }
.task-side-list { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.task-card { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); cursor: pointer; transition: all 0.2s; }
.task-card:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12); }
.task-card.task-active { border-color: rgba(0,229,255,0.4); background: rgba(0,229,255,0.05); }
.task-status-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.task-status-icon.status-pending { background: rgba(255,193,7,0.15); color: #ffc107; }
.task-status-icon.status-running { background: rgba(0,229,255,0.15); color: #00e5ff; }
.task-status-icon.status-success { background: rgba(105,240,174,0.15); color: #69f0ae;}
.task-status-icon.status-failed { background: rgba(255,82,82,0.15); color: #ff5252; }
.spin-icon { display: inline-block; animation: spin 1.2s linear infinite; }
.task-info { flex: 1; min-width: 0; }
.task-video { font-size: 12px; font-weight: 500; color: #e8eaf6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-meta { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.tag-stroke { font-size: 10px; color: #00e5ff; background: rgba(0,229,255,0.1); padding: 1px 6px; border-radius: 4px; }
.tag-athlete { font-size: 10px; color: #b39ddb; background: rgba(179,157,219,0.1); padding: 1px 6px; border-radius: 4px; }
.tag-time { font-size: 10px; color: #606480; }
.task-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.status-pill { font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 600; }
.status-pill.status-pending { background: rgba(255,193,7,0.15); color: #ffc107; }
.status-pill.status-running { background: rgba(0,229,255,0.15); color: #00e5ff; }
.status-pill.status-failed { background: rgba(255,82,82,0.15); color: #ff5252; }
.task-score { font-size: 16px; font-weight: 800; color: #ffd54f; }
.detail-content { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.detail-panel { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.detail-static { flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
.detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px; display: flex; flex-direction: column; gap: 10px; }
.panel-top { position: sticky; top: 0; z-index: 8; display: flex; align-items: center; background: #0a0a0f; padding-top: 2px; }
.state-panel { padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.05); color: #c8cadb; }
.state-error { border: 1px solid rgba(255,82,82,0.35); color: #ff8a8a; background: rgba(255,82,82,0.08); }
.invalid-video-banner { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(255,180,0,0.4); background: rgba(255,180,0,0.08); color: #ffd060; font-size: 13px; line-height: 1.6; }
.invalid-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.metrics-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.metric-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px; }
.label { font-size: 11px; color: #9094b0; }
.value { margin-top: 6px; font-size: 18px; font-weight: 700; }
.risk-high { color: #ff5252; }
.risk-mid { color: #ffc107; }
.risk-low { color: #69f0ae; }
.panel-top .status-pill { font-size: 11px; padding: 3px 10px; border-radius: 7px; font-weight: 700; }
.status-pill.status-pending { background: rgba(255,193,7,0.15); color: #ffc107; }
.status-pill.status-running { background: rgba(0,229,255,0.15); color: #00e5ff; }
.status-pill.status-failed { background: rgba(255,82,82,0.15); color: #ff5252; }
.panel-top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.top-btn { border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; }
.top-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-annotate { background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.45); color: #c4b5fd; }
.btn-annotate:hover:not(:disabled) { background: rgba(139,92,246,0.25); }
.btn-share { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.4); color: #6ee7b7; }
.btn-share:hover { background: rgba(16,185,129,0.22); }
.btn-pdf { background: rgba(0,229,255,0.1); border-color: rgba(0,229,255,0.4); color: #00e5ff; }
.btn-pdf:hover:not(:disabled) { background: rgba(0,229,255,0.18); }
.share-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 800; display: flex; align-items: center; justify-content: center; padding: 16px; }
.share-modal { background: #1a1d24; border: 1px solid #2a2d36; border-radius: 14px; width: min(460px, 100%); overflow: hidden; }
.share-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #2a2d36; font-size: 15px; font-weight: 700; color: #e0e6ff; }
.share-close-btn { background: none; border: none; color: #8899aa; font-size: 16px; cursor: pointer; }
.share-modal-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
.share-desc { font-size: 13px; color: #8899aa; margin: 0; }
.share-limit-tip { font-size: 12px; color: #6ee7b7; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.35); border-radius: 8px; padding: 7px 10px; }
.share-limit-tip.reached { color: #fbbf24; background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.35); }
.share-history-loading { font-size: 13px; color: #8899aa; text-align: center; padding: 20px 0; }
.share-history-list { display: flex; flex-direction: column; gap: 10px; }
.share-history-item { background: rgba(255,255,255,0.03); border: 1px solid #2a2d36; border-radius: 8px; padding: 8px; }
.share-url-box { display: flex; align-items: center; gap: 8px; background: #12141a; border: 1px solid #2a2d36; border-radius: 8px; padding: 10px 12px; }
.share-url-text { flex: 1; font-size: 12px; color: #c9d1e0; word-break: break-all; }
.share-copy-btn { flex-shrink: 0; padding: 4px 12px; border-radius: 6px; background: #2563eb; color: #fff; border: none; font-size: 12px; cursor: pointer; font-weight: 600; }
.share-copy-btn:hover { background: #1d4ed8; }
.share-meta { font-size: 11px; color: #606480; margin-top: 6px; }
.share-gen-btn { width: 100%; padding: 12px; border-radius: 10px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; border: none; font-size: 14px; font-weight: 700; cursor: pointer; }
.share-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.share-gen-btn:hover:not(:disabled) { opacity: 0.92; }
.share-err { color: #ff8a8a; font-size: 13px; margin: 0; }
.result-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.result-tab-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #9094b0; border-radius: 8px; font-size: 12px; padding: 6px 10px; cursor: pointer; }
.result-tab-btn.active { color: #00e5ff; border-color: rgba(0,229,255,0.45); background: rgba(0,229,255,0.12); }
.video-preview-panel { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; }
.video-preview-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #c8cadb; }
.video-link { color: #00e5ff; text-decoration: none; }
.video-preview-player { width: 100%; max-height: 340px; background: #000; display: block; }
.annotation-tab-wrap { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; }
.annotation-tab-image { width: 100%; max-height: 560px; object-fit: contain; display: block; background: #000; }
.annotation-tab-meta { display: flex; gap: 14px; flex-wrap: wrap; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.08); color: #9094b0; font-size: 12px; }
.result-section { display: flex; flex-direction: column; gap: 8px; }
.section-title { font-size: 12px; font-weight: 600; color: #9094b0; text-transform: uppercase; letter-spacing: 1px; }
.kv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.kv-card { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px; background: rgba(255,255,255,0.03); }
.kv-key { font-size: 11px; color: #9094b0; margin-bottom: 6px; }
.kv-val { font-size: 13px; color: #e8eaf6; line-height: 1.5; word-break: break-word; }
.table-wrap { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; }
.table-head { display: flex; justify-content: space-between; padding: 10px 12px; font-size: 12px; color: #c8cadb; border-bottom: 1px solid rgba(255,255,255,0.08); }
.table-scroll { overflow: auto; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mini-table th, .mini-table td { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 8px 10px; text-align: left; white-space: nowrap; }
.mini-table th { color: #9094b0; font-weight: 600; }
.mini-table td { color: #d8def8; }
.business-wrap { display: flex; flex-direction: column; gap: 10px; }
.biz-block { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.03); padding: 10px; }
.biz-title { font-size: 12px; font-weight: 700; color: #00e5ff; margin-bottom: 8px; }
.biz-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.biz-card { border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.02); padding: 8px; }
.biz-subtitle { font-size: 11px; font-weight: 600; color: #c8cadb; margin-bottom: 6px; }
.list-wrap { display: flex; flex-direction: column; gap: 4px; }
.list-item { font-size: 12px; color: #d8def8; line-height: 1.6; }
.list-item.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
.muted { color: #9094b0; }
.video-desc-box { border: 1px solid rgba(0,229,255,0.3); background: rgba(0,229,255,0.08); color: #c9f8ff; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.6; }
.evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.evidence-card { border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; }
.evidence-topbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.evidence-section { font-size: 11px; color: #00e5ff; white-space: nowrap; }
.evidence-metric { font-size: 12px; color: #e8eaf6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evidence-video-wrap { height: 180px; background: #000; }
.evidence-video, .section-evidence-video { width: 100%; height: 100%; object-fit: contain; display: block; }
.evidence-placeholder { width: 100%; height: 100%; min-height: 80px; display: flex; align-items: center; justify-content: center; color: #606480; font-size: 12px; background: rgba(255,255,255,0.04); }
.evidence-meta-row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 10px 0; font-size: 11px; color: #9094b0; }
.evidence-value, .evidence-block { margin: 8px 10px 0; padding: 7px 9px; border-radius: 7px; font-size: 12px; line-height: 1.6; }
.evidence-value { background: rgba(0,229,255,0.08); color: #c9f8ff; }
.evidence-block { background: rgba(255,255,255,0.06); color: #c8cadb; }
.section-evidence-strip { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
.clip-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.clip-card { border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.03); }
.clip-card-error { border-color: rgba(255,82,82,0.25); }
.clip-video { width: 100%; height: 160px; object-fit: contain; display: block; background: #000; }
.clip-info { padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; }
.clip-time { font-size: 11px; color: #9094b0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.clip-cover-wrapper { position: relative; width: 100%; height: 160px; background: #000; overflow: hidden; }
.clip-cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.clip-cover-badge { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); padding: 4px 10px; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px; border-radius: 12px; }
.clip-cover-wrapper-error .clip-cover-badge { background: rgba(255,82,82,0.8); }
.clip-cover-wrapper-progress .clip-cover-badge { background: rgba(64,158,255,0.8); }
.clip-desc { font-size: 12px; color: #c8cadb; line-height: 1.5; }
.detail-accordion { display: flex; flex-direction: column; gap: 8px; }
.detail-block { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; }
.detail-block summary { cursor: pointer; padding: 10px 12px; color: #00e5ff; font-size: 13px; font-weight: 600; user-select: none; }
.json-block { margin: 0; padding: 10px 12px 12px; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.18); color: #d8def8; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; }
.error-msg { color: #ff8a8a; font-size: 12px; margin: 0; }

@media (max-width: 1200px) {
  .kv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 960px) {
  .detail-main {
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    height: auto;
    min-height: 0;
    flex: 1;
  }
  .task-side {
    width: 100%;
    max-height: 260px;
    flex-shrink: 0;
  }
  .detail-content {
    flex: none;
    min-height: 0;
    overflow: visible;
    width: 100%;
  }
  .detail-panel {
    height: auto;
  }
  .detail-scroll {
    overflow-y: visible;
    max-height: none;
    flex: none;
  }
  .metrics-row { grid-template-columns: repeat(2, 1fr); }
  .biz-grid { grid-template-columns: 1fr; }
  .kv-grid { grid-template-columns: 1fr; }
  .clip-grid { grid-template-columns: 1fr; }
  .evidence-grid { grid-template-columns: 1fr; }
}
</style>
