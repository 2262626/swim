<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import TopBar from '../components/TopBar.vue'
import LoadingOverlay from '../components/LoadingOverlay.vue'
import { usePoseEngine } from '../composables/usePoseEngine.js'
import { useSkeletonDraw } from '../composables/useSkeletonDraw.js'
import {
  FITNESS_AGE_GROUP_OPTIONS,
  FITNESS_EQUIPMENT_OPTIONS,
  useFitnessAnalysis,
} from '../composables/useFitnessAnalysis.js'
import { useMobileFeatures } from '../composables/useMobileFeatures.js'
import { useAuthStore } from '../store/auth.js'

const router = useRouter()
const authStore = useAuthStore()
const poseEngine = usePoseEngine()
const { draw, getJointAngles, setConfig: setSkeletonConfig, KP } = useSkeletonDraw()
const { analyze, reset, setEquipment } = useFitnessAnalysis()
const { requestWakeLock, vibrate } = useMobileFeatures()

const video = ref(null)
const canvas = ref(null)
const videoFileInput = ref(null)
let ctx = null

const currentStream = ref(null)
const currentVideoURL = ref('')
const analysisMode = ref('camera')
const facingMode = ref('environment')
const analysisRunning = ref(false)
const pauseText = ref('暂停')
const badgeState = ref('')
const badgeLabel = ref('初始化中')
const videoActive = ref(false)
const isLoading = ref(true)
const loadingProgress = ref(0)
const loadingText = ref('正在加载体能训练识别模型...')

const selectedEquipment = ref(FITNESS_EQUIPMENT_OPTIONS[0].value)
const selectedAgeGroup = ref(FITNESS_AGE_GROUP_OPTIONS[0].value)
const voiceEnabled = ref(true)
const showGuideLines = ref(true)
const controlPanelExpanded = ref(false)
const controlPanelSection = ref('overview')
const currentAnalysis = ref(createIdleFitnessState())
const fps = ref(0)
const avgConfidence = ref(0)
const latestLandmarks = ref(null)
const availableSpeechVoices = ref([])
const jointAngles = ref({
  leftElbow: null,
  rightElbow: null,
  leftShoulder: null,
  rightShoulder: null,
  leftKnee: null,
  rightKnee: null,
})

let lastSpokenKey = ''

function createIdleFitnessState(reason = '点击开始分析') {
  return {
    phase: 'INVALID',
    phaseLabel: '待开始',
    repCount: 0,
    judgeable: false,
    rejectionReason: reason,
    quality: {
      score: null,
      label: '待判定',
      reasons: [],
    },
    assessment: { score: null, items: [] },
    cueText: reason,
    cueTone: 'info',
    voiceText: '',
    voiceKey: '',
  }
}

const stopCameraStream = () => {
  if (currentStream.value) {
    currentStream.value.getTracks().forEach((track) => track.stop())
    currentStream.value = null
  }
}

const clearImportedVideo = () => {
  if (video.value) {
    video.value.pause()
    video.value.loop = false
    video.value.currentTime = 0
    video.value.removeAttribute('src')
    video.value.srcObject = null
    video.value.load()
  }
  if (currentVideoURL.value) {
    URL.revokeObjectURL(currentVideoURL.value)
    currentVideoURL.value = ''
  }
  if (videoFileInput.value) {
    videoFileInput.value.value = ''
  }
}

const clearVideoContent = () => {
  clearImportedVideo()
  latestLandmarks.value = null
  if (ctx && canvas.value) {
    ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  }
}

const calcAvgConfidence = (landmarks) => {
  const visible = landmarks.filter((point) => point && (point.visibility ?? 0) > 0)
  if (!visible.length) return 0
  return visible.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / visible.length
}

const canUseCamera = () => (
  typeof window !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia
  && !!window.isSecureContext
)

const isValidPersonPose = (landmarks) => {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return false
  const coreIndexes = [11, 12, 23, 24]
  const coreReady = coreIndexes.every((idx) => (landmarks[idx]?.visibility ?? 0) > 0.35)
  if (!coreReady) return false
  return calcAvgConfidence(landmarks) >= 0.32
}

const GUIDE_LABELS = {
  smith_squat: ['身体中线', '目标髋部线', '站距建议区'],
  leg_extension: ['躯干中立线', '伸膝轨迹', '顶端目标区'],
  seated_row: ['脚部稳定区', '回拉目标区', '平稳回拉线'],
  cable_fly: ['身体中线', '夹胸合拢区', '双臂参考轨迹'],
  roman_chair: ['身体一条线', '下放目标线', '过伸警戒线'],
}

const CONTROL_PANEL_SECTIONS = [
  { key: 'overview', label: '总览', shortLabel: '总', hint: '数据与主控' },
  { key: 'mode', label: '模式', shortLabel: '模', hint: '实时与视频' },
  { key: 'equipment', label: '器械', shortLabel: '器', hint: '训练项目' },
  { key: 'voice', label: '提示', shortLabel: '音', hint: '年龄与语音' },
  { key: 'checks', label: '检查', shortLabel: '检', hint: '动作细项' },
]

const pointToCanvas = (point, width, height, minVisibility = 0.22) => {
  if (!point || (point.visibility ?? 0) < minVisibility) return null
  return {
    x: point.x * width,
    y: point.y * height,
    visibility: point.visibility ?? 0,
  }
}

const getCanvasPoint = (landmarks, idx, width, height, minVisibility = 0.22) => (
  pointToCanvas(landmarks?.[idx], width, height, minVisibility)
)

const midpoint = (a, b) => {
  if (!a || !b) return null
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

const averagePoint = (points) => {
  const valid = points.filter(Boolean)
  if (!valid.length) return null
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  }
}

const distance = (a, b) => {
  if (!a || !b) return 0
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const isChineseVoice = (voice) => {
  const lang = `${voice?.lang || ''}`.toLowerCase()
  const name = `${voice?.name || ''}`.toLowerCase()
  return /^(zh|cmn)/.test(lang) || /(chinese|mandarin|xiao|yun|hui|ting|sin-ji|mei-jia|yaoyao)/.test(name)
}

const scoreVoice = (voice, ageGroup) => {
  const lang = `${voice?.lang || ''}`.toLowerCase()
  const name = `${voice?.name || ''}`.toLowerCase()
  let score = 0

  if (isChineseVoice(voice)) score += 40
  if (/zh-cn|cmn-cn/.test(lang)) score += 16
  if (voice?.localService) score += 6
  if (voice?.default) score += 4

  if (ageGroup === 'youth') {
    if (/(xiaoxiao|yaoyao|ting-?ting|meijia|mei-jia|sin-?ji|huihui|female|girl)/.test(name)) score += 28
    if (/(yunxi|yunyang|male)/.test(name)) score -= 6
  } else {
    if (/(yunxi|yunyang|xiaoyi|yunhao|zhiyu|male|professional)/.test(name)) score += 22
    if (/(yaoyao|girl|child)/.test(name)) score -= 4
  }

  return score
}

const loadSpeechVoices = () => {
  if (!('speechSynthesis' in window)) return
  const voices = window.speechSynthesis.getVoices()
  availableSpeechVoices.value = Array.isArray(voices) ? voices : []
}

const waitForVideoReady = (videoElement, minimumReadyState = 1) => new Promise((resolve, reject) => {
  if (!videoElement) {
    reject(new Error('视频元素不可用'))
    return
  }

  if (videoElement.readyState >= minimumReadyState) {
    resolve()
    return
  }

  const readyEvent = minimumReadyState >= 2 ? 'loadeddata' : 'loadedmetadata'
  let timeoutId = null

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    videoElement.removeEventListener(readyEvent, handleReady)
    videoElement.removeEventListener('error', handleError)
  }

  const handleReady = () => {
    cleanup()
    resolve()
  }

  const handleError = () => {
    cleanup()
    reject(videoElement.error || new Error('视频加载失败'))
  }

  timeoutId = setTimeout(() => {
    cleanup()
    reject(new Error('视频加载超时'))
  }, 10000)

  videoElement.addEventListener(readyEvent, handleReady, { once: true })
  videoElement.addEventListener('error', handleError, { once: true })
})

const normalizeVector = (dx, dy) => {
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

const rotateVector = (vector, rad) => ({
  x: vector.x * Math.cos(rad) - vector.y * Math.sin(rad),
  y: vector.x * Math.sin(rad) + vector.y * Math.cos(rad),
})

const projectPoint = (origin, vector, length) => {
  if (!origin || !vector) return null
  return {
    x: origin.x + vector.x * length,
    y: origin.y + vector.y * length,
  }
}

const calcBoundsFromPoints = (points, width, height, padding = 22) => {
  const valid = points.filter(Boolean)
  if (!valid.length) return null
  const xs = valid.map((point) => point.x)
  const ys = valid.map((point) => point.y)
  const minX = clamp(Math.min(...xs) - padding, 0, width)
  const maxX = clamp(Math.max(...xs) + padding, 0, width)
  const minY = clamp(Math.min(...ys) - padding, 0, height)
  const maxY = clamp(Math.max(...ys) + padding, 0, height)
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function drawRoundedRectPath(targetCtx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  targetCtx.beginPath()
  targetCtx.moveTo(x + r, y)
  targetCtx.lineTo(x + width - r, y)
  targetCtx.quadraticCurveTo(x + width, y, x + width, y + r)
  targetCtx.lineTo(x + width, y + height - r)
  targetCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  targetCtx.lineTo(x + r, y + height)
  targetCtx.quadraticCurveTo(x, y + height, x, y + height - r)
  targetCtx.lineTo(x, y + r)
  targetCtx.quadraticCurveTo(x, y, x + r, y)
  targetCtx.closePath()
}

function drawGuideLabel(targetCtx, text, x, y, accent, align = 'center') {
  if (!text) return
  targetCtx.save()
  targetCtx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  targetCtx.textAlign = align
  targetCtx.textBaseline = 'middle'
  const paddingX = 8
  const paddingY = 5
  const textWidth = targetCtx.measureText(text).width
  const width = textWidth + paddingX * 2
  const height = 24
  const drawX = align === 'left' ? x : align === 'right' ? x - width : x - width / 2
  const drawY = y - height / 2

  drawRoundedRectPath(targetCtx, drawX, drawY, width, height, 12)
  targetCtx.fillStyle = 'rgba(2, 10, 18, 0.78)'
  targetCtx.fill()
  targetCtx.lineWidth = 1
  targetCtx.strokeStyle = accent
  targetCtx.stroke()

  targetCtx.fillStyle = '#eafcff'
  targetCtx.fillText(
    text,
    align === 'left' ? drawX + paddingX : align === 'right' ? drawX + width - paddingX : x,
    y,
  )
  targetCtx.restore()
}

function drawGuideLine(targetCtx, x1, y1, x2, y2, options = {}) {
  const {
    color = 'rgba(0, 229, 255, 0.8)',
    width = 2,
    dash = [8, 8],
    alpha = 1,
  } = options

  targetCtx.save()
  targetCtx.setLineDash(dash)
  targetCtx.lineWidth = width
  targetCtx.lineCap = 'round'
  targetCtx.globalAlpha = alpha
  targetCtx.strokeStyle = color
  targetCtx.shadowColor = color
  targetCtx.shadowBlur = 10
  targetCtx.beginPath()
  targetCtx.moveTo(x1, y1)
  targetCtx.lineTo(x2, y2)
  targetCtx.stroke()
  targetCtx.restore()
}

function drawGuideBox(targetCtx, x, y, width, height, options = {}) {
  const {
    color = 'rgba(0, 229, 255, 0.8)',
    fill = 'rgba(0, 229, 255, 0.08)',
    lineWidth = 1.6,
    dash = [10, 8],
  } = options

  targetCtx.save()
  targetCtx.setLineDash(dash)
  targetCtx.lineWidth = lineWidth
  targetCtx.strokeStyle = color
  targetCtx.fillStyle = fill
  targetCtx.shadowColor = color
  targetCtx.shadowBlur = 10
  drawRoundedRectPath(targetCtx, x, y, width, height, 16)
  targetCtx.fill()
  targetCtx.stroke()
  targetCtx.restore()
}

function drawStaticGuideOverlay(targetCtx, width, height, equipment, analysisResult) {
  const blocked = analysisResult?.judgeable === false
  const accent = blocked ? 'rgba(255, 213, 79, 0.88)' : 'rgba(0, 229, 255, 0.86)'
  const softAccent = blocked ? 'rgba(255, 213, 79, 0.22)' : 'rgba(0, 229, 255, 0.18)'

  drawGuideBox(
    targetCtx,
    width * 0.08,
    height * 0.08,
    width * 0.84,
    height * 0.78,
    { color: softAccent, fill: 'rgba(255, 255, 255, 0.02)', lineWidth: 1, dash: [6, 10] },
  )

  if (equipment === 'leg_extension') {
    drawGuideLine(targetCtx, width * 0.32, height * 0.2, width * 0.32, height * 0.8, { color: accent })
    drawGuideLabel(targetCtx, '躯干中立线', width * 0.32, height * 0.16, accent)
    drawGuideLine(targetCtx, width * 0.34, height * 0.58, width * 0.8, height * 0.48, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '伸膝轨迹', width * 0.57, height * 0.43, accent)
    drawGuideBox(targetCtx, width * 0.63, height * 0.42, width * 0.16, height * 0.12, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '顶端目标区', width * 0.71, height * 0.39, accent)
    return
  }

  if (equipment === 'seated_row') {
    drawGuideLine(targetCtx, width * 0.3, height * 0.22, width * 0.3, height * 0.8, { color: accent })
    drawGuideLabel(targetCtx, '躯干参考线', width * 0.3, height * 0.18, accent)
    drawGuideLine(targetCtx, width * 0.24, height * 0.58, width * 0.72, height * 0.58, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '拉柄路径', width * 0.48, height * 0.54, accent)
    drawGuideBox(targetCtx, width * 0.36, height * 0.49, width * 0.18, height * 0.16, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '回拉目标区', width * 0.45, height * 0.46, accent)
    return
  }

  if (equipment === 'cable_fly') {
    drawGuideLine(targetCtx, width * 0.5, height * 0.14, width * 0.5, height * 0.84, { color: accent })
    drawGuideLabel(targetCtx, '身体中线', width * 0.5, height * 0.1, accent)
    drawGuideLine(targetCtx, width * 0.22, height * 0.33, width * 0.5, height * 0.58, { color: accent, dash: [12, 8] })
    drawGuideLine(targetCtx, width * 0.78, height * 0.33, width * 0.5, height * 0.58, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '双臂参考轨迹', width * 0.5, height * 0.29, accent)
    drawGuideBox(targetCtx, width * 0.455, height * 0.34, width * 0.09, height * 0.3, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '夹胸合拢区', width * 0.5, height * 0.68, accent)
    return
  }

  if (equipment === 'roman_chair') {
    drawGuideLine(targetCtx, width * 0.24, height * 0.61, width * 0.74, height * 0.46, { color: accent })
    drawGuideLabel(targetCtx, '身体一条线', width * 0.51, height * 0.42, accent)
    drawGuideLine(targetCtx, width * 0.26, height * 0.71, width * 0.62, height * 0.76, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '下放目标线', width * 0.47, height * 0.81, accent)
    drawGuideLine(targetCtx, width * 0.23, height * 0.52, width * 0.72, height * 0.37, { color: accent, dash: [4, 7], alpha: 0.8 })
    drawGuideLabel(targetCtx, '过伸警戒线', width * 0.54, height * 0.33, accent)
    return
  }

  drawGuideLine(targetCtx, width * 0.5, height * 0.12, width * 0.5, height * 0.9, { color: accent })
  drawGuideLabel(targetCtx, '身体中线', width * 0.5, height * 0.08, accent)
  drawGuideLine(targetCtx, width * 0.22, height * 0.62, width * 0.78, height * 0.62, { color: accent, dash: [12, 8] })
  drawGuideLabel(targetCtx, '下蹲深度线', width * 0.5, height * 0.58, accent)
  drawGuideBox(targetCtx, width * 0.29, height * 0.79, width * 0.42, height * 0.1, { color: accent, fill: softAccent })
  drawGuideLabel(targetCtx, '站距建议区', width * 0.5, height * 0.92, accent)
}

function drawDynamicGuideOverlay(targetCtx, width, height, equipment, analysisResult, landmarks) {
  if (!landmarks?.length) return false

  const blocked = analysisResult?.judgeable === false
  const accent = blocked ? 'rgba(255, 213, 79, 0.9)' : 'rgba(0, 229, 255, 0.88)'
  const softAccent = blocked ? 'rgba(255, 213, 79, 0.18)' : 'rgba(0, 229, 255, 0.14)'

  if (equipment === 'smith_squat') {
    const ls = getCanvasPoint(landmarks, KP.L_SHOULDER, width, height)
    const rs = getCanvasPoint(landmarks, KP.R_SHOULDER, width, height)
    const lh = getCanvasPoint(landmarks, KP.L_HIP, width, height)
    const rh = getCanvasPoint(landmarks, KP.R_HIP, width, height)
    const lk = getCanvasPoint(landmarks, KP.L_KNEE, width, height)
    const rk = getCanvasPoint(landmarks, KP.R_KNEE, width, height)
    const la = getCanvasPoint(landmarks, KP.L_ANKLE, width, height)
    const ra = getCanvasPoint(landmarks, KP.R_ANKLE, width, height)
    const shoulderMid = midpoint(ls, rs)
    const kneeMid = midpoint(lk, rk)
    const ankleMid = midpoint(la, ra)
    const bounds = calcBoundsFromPoints([ls, rs, lh, rh, lk, rk, la, ra], width, height)
    if (!bounds || !shoulderMid || !kneeMid || !la || !ra) return false

    drawGuideBox(targetCtx, bounds.x, bounds.y, bounds.width, bounds.height, { color: softAccent, fill: 'rgba(255,255,255,0.02)', lineWidth: 1, dash: [6, 10] })
    if (ankleMid) {
      drawGuideLine(targetCtx, shoulderMid.x, bounds.y + 6, ankleMid.x, bounds.y + bounds.height - 6, { color: accent })
      drawGuideLabel(targetCtx, '身体中线', shoulderMid.x, Math.max(22, bounds.y - 10), accent)
    }
    const targetDepthY = analysisResult?.meta?.targetDepthY != null
      ? analysisResult.meta.targetDepthY * height
      : kneeMid.y
    const lowestHipY = analysisResult?.meta?.lowestHipY != null
      ? analysisResult.meta.lowestHipY * height
      : midpoint(lh, rh)?.y

    drawGuideLine(targetCtx, bounds.x + 10, targetDepthY, bounds.x + bounds.width - 10, targetDepthY, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '目标髋部深度线', bounds.x + bounds.width / 2, targetDepthY - 18, accent)

    if (typeof lowestHipY === 'number') {
      drawGuideLine(targetCtx, shoulderMid.x - 26, lowestHipY, shoulderMid.x + 26, lowestHipY, {
        color: 'rgba(105, 255, 71, 0.92)',
        dash: [5, 6],
        width: 2.4,
      })
      drawGuideLabel(targetCtx, '本次最低髋点', shoulderMid.x, lowestHipY + 20, 'rgba(105, 255, 71, 0.95)')
    }

    const stanceX = Math.min(la.x, ra.x) - 18
    const stanceW = Math.abs(la.x - ra.x) + 36
    const stanceY = Math.max(la.y, ra.y) - 16
    drawGuideBox(targetCtx, stanceX, stanceY, stanceW, 34, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '站距建议区', stanceX + stanceW / 2, stanceY + 46, accent)
    return true
  }

  if (equipment === 'leg_extension') {
    const ls = getCanvasPoint(landmarks, KP.L_SHOULDER, width, height)
    const rs = getCanvasPoint(landmarks, KP.R_SHOULDER, width, height)
    const lh = getCanvasPoint(landmarks, KP.L_HIP, width, height)
    const rh = getCanvasPoint(landmarks, KP.R_HIP, width, height)
    const lk = getCanvasPoint(landmarks, KP.L_KNEE, width, height)
    const rk = getCanvasPoint(landmarks, KP.R_KNEE, width, height)
    const la = getCanvasPoint(landmarks, KP.L_ANKLE, width, height)
    const ra = getCanvasPoint(landmarks, KP.R_ANKLE, width, height)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const kneeMid = midpoint(lk, rk)
    const ankleMid = midpoint(la, ra)
    const bounds = calcBoundsFromPoints([ls, rs, lh, rh, lk, rk, la, ra], width, height)
    if (!bounds || !shoulderMid || !hipMid || !kneeMid || !ankleMid) return false

    drawGuideBox(targetCtx, bounds.x, bounds.y, bounds.width, bounds.height, { color: softAccent, fill: 'rgba(255,255,255,0.02)', lineWidth: 1, dash: [6, 10] })
    drawGuideLine(targetCtx, shoulderMid.x, shoulderMid.y, hipMid.x, hipMid.y, { color: accent })
    drawGuideLabel(targetCtx, '躯干中立线', shoulderMid.x, Math.max(24, shoulderMid.y - 26), accent)

    const calfLen = Math.max(36, distance(kneeMid, ankleMid))
    const direction = Math.sign((ankleMid.x - kneeMid.x) || 1)
    const targetPoint = {
      x: kneeMid.x + direction * calfLen * 0.92,
      y: kneeMid.y - calfLen * 0.06,
    }
    drawGuideLine(targetCtx, kneeMid.x, kneeMid.y, targetPoint.x, targetPoint.y, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '伸膝轨迹', (kneeMid.x + targetPoint.x) / 2, Math.min(kneeMid.y, targetPoint.y) - 18, accent)

    drawGuideBox(targetCtx, targetPoint.x - 26, targetPoint.y - 18, 52, 36, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '顶端目标区', targetPoint.x, targetPoint.y - 28, accent)
    return true
  }

  if (equipment === 'seated_row') {
    const ls = getCanvasPoint(landmarks, KP.L_SHOULDER, width, height)
    const rs = getCanvasPoint(landmarks, KP.R_SHOULDER, width, height)
    const lw = getCanvasPoint(landmarks, KP.L_WRIST, width, height)
    const rw = getCanvasPoint(landmarks, KP.R_WRIST, width, height)
    const lh = getCanvasPoint(landmarks, KP.L_HIP, width, height)
    const rh = getCanvasPoint(landmarks, KP.R_HIP, width, height)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const wristMid = averagePoint([lw, rw])
    const bounds = calcBoundsFromPoints([ls, rs, lw, rw, lh, rh], width, height)
    if (!bounds || !shoulderMid || !hipMid || !wristMid) return false

    drawGuideBox(targetCtx, bounds.x, bounds.y, bounds.width, bounds.height, { color: softAccent, fill: 'rgba(255,255,255,0.02)', lineWidth: 1, dash: [6, 10] })
    drawGuideLine(targetCtx, shoulderMid.x, shoulderMid.y, hipMid.x, hipMid.y, { color: accent })
    drawGuideLabel(targetCtx, '躯干参考线', shoulderMid.x, Math.max(24, shoulderMid.y - 24), accent)

    const pullTarget = {
      x: hipMid.x,
      y: hipMid.y - Math.abs(hipMid.y - shoulderMid.y) * 0.18,
    }
    drawGuideLine(targetCtx, wristMid.x, wristMid.y, pullTarget.x, pullTarget.y, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '拉柄路径', (wristMid.x + pullTarget.x) / 2, Math.min(wristMid.y, pullTarget.y) - 18, accent)

    drawGuideBox(targetCtx, pullTarget.x - 28, pullTarget.y - 22, 56, 44, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '回拉目标区', pullTarget.x, pullTarget.y - 30, accent)
    return true
  }

  if (equipment === 'cable_fly') {
    const ls = getCanvasPoint(landmarks, KP.L_SHOULDER, width, height)
    const rs = getCanvasPoint(landmarks, KP.R_SHOULDER, width, height)
    const lw = getCanvasPoint(landmarks, KP.L_WRIST, width, height)
    const rw = getCanvasPoint(landmarks, KP.R_WRIST, width, height)
    const lh = getCanvasPoint(landmarks, KP.L_HIP, width, height)
    const rh = getCanvasPoint(landmarks, KP.R_HIP, width, height)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const bounds = calcBoundsFromPoints([ls, rs, lw, rw, lh, rh], width, height)
    if (!bounds || !shoulderMid || !hipMid || !lw || !rw) return false

    const chestCenter = {
      x: shoulderMid.x,
      y: shoulderMid.y + Math.abs(hipMid.y - shoulderMid.y) * 0.32,
    }

    drawGuideBox(targetCtx, bounds.x, bounds.y, bounds.width, bounds.height, { color: softAccent, fill: 'rgba(255,255,255,0.02)', lineWidth: 1, dash: [6, 10] })
    drawGuideLine(targetCtx, chestCenter.x, shoulderMid.y - 18, chestCenter.x, hipMid.y + 12, { color: accent })
    drawGuideLabel(targetCtx, '身体中线', chestCenter.x, Math.max(24, shoulderMid.y - 34), accent)

    drawGuideLine(targetCtx, lw.x, lw.y, chestCenter.x, chestCenter.y, { color: accent, dash: [12, 8] })
    drawGuideLine(targetCtx, rw.x, rw.y, chestCenter.x, chestCenter.y, { color: accent, dash: [12, 8] })
    drawGuideLabel(targetCtx, '双臂参考轨迹', chestCenter.x, Math.min(lw.y, rw.y, chestCenter.y) - 18, accent)

    drawGuideBox(targetCtx, chestCenter.x - 24, chestCenter.y - 42, 48, 84, { color: accent, fill: softAccent })
    drawGuideLabel(targetCtx, '夹胸合拢区', chestCenter.x, chestCenter.y + 56, accent)
    return true
  }

  if (equipment === 'roman_chair') {
    const leftRaw = [
      landmarks?.[KP.L_SHOULDER],
      landmarks?.[KP.L_HIP],
      landmarks?.[KP.L_KNEE],
    ]
    const rightRaw = [
      landmarks?.[KP.R_SHOULDER],
      landmarks?.[KP.R_HIP],
      landmarks?.[KP.R_KNEE],
    ]
    const leftScore = leftRaw.reduce((sum, point) => sum + (point?.visibility ?? 0), 0)
    const rightScore = rightRaw.reduce((sum, point) => sum + (point?.visibility ?? 0), 0)
    const useLeft = leftScore >= rightScore
    const shoulder = getCanvasPoint(landmarks, useLeft ? KP.L_SHOULDER : KP.R_SHOULDER, width, height)
    const hip = getCanvasPoint(landmarks, useLeft ? KP.L_HIP : KP.R_HIP, width, height)
    const knee = getCanvasPoint(landmarks, useLeft ? KP.L_KNEE : KP.R_KNEE, width, height)
    const nose = getCanvasPoint(landmarks, KP.NOSE, width, height, 0.18)
    const bounds = calcBoundsFromPoints([shoulder, hip, knee, nose], width, height)
    if (!bounds || !shoulder || !hip || !knee) return false

    const trunkLen = Math.max(34, distance(shoulder, hip))
    const thighVector = normalizeVector(hip.x - knee.x, hip.y - knee.y)
    const straightShoulder = projectPoint(hip, thighVector, trunkLen)
    const torsoSide = Math.sign((shoulder.x - hip.x) || 1)
    const foldVector = rotateVector(thighVector, torsoSide * 0.62)
    const foldShoulder = projectPoint(hip, foldVector, trunkLen)
    const warnVector = rotateVector(thighVector, -torsoSide * 0.2)
    const warnShoulder = projectPoint(hip, warnVector, trunkLen * 1.02)

    drawGuideBox(targetCtx, bounds.x, bounds.y, bounds.width, bounds.height, { color: softAccent, fill: 'rgba(255,255,255,0.02)', lineWidth: 1, dash: [6, 10] })
    if (straightShoulder) {
      drawGuideLine(targetCtx, straightShoulder.x, straightShoulder.y, knee.x, knee.y, { color: accent })
      drawGuideLabel(targetCtx, '身体一条线', (straightShoulder.x + knee.x) / 2, straightShoulder.y - 16, accent)
    }
    if (foldShoulder) {
      drawGuideLine(targetCtx, hip.x, hip.y, foldShoulder.x, foldShoulder.y, { color: accent, dash: [12, 8] })
      drawGuideLabel(targetCtx, '下放目标线', foldShoulder.x, foldShoulder.y + 18, accent)
    }
    if (warnShoulder) {
      drawGuideLine(targetCtx, hip.x, hip.y, warnShoulder.x, warnShoulder.y, { color: accent, dash: [4, 7], alpha: 0.75 })
      drawGuideLabel(targetCtx, '过伸警戒线', warnShoulder.x, warnShoulder.y - 18, accent)
    }
    return true
  }

  return false
}

function drawGuideOverlay(targetCtx, width, height, equipment, analysisResult, landmarks = null) {
  if (!showGuideLines.value) return
  const usedDynamic = drawDynamicGuideOverlay(targetCtx, width, height, equipment, analysisResult, landmarks)
  if (!usedDynamic) {
    drawStaticGuideOverlay(targetCtx, width, height, equipment, analysisResult)
  }
}

const redrawGuideOverlay = () => {
  if (!ctx || !canvas.value) return
  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  drawGuideOverlay(
    ctx,
    canvas.value.width,
    canvas.value.height,
    selectedEquipment.value,
    currentAnalysis.value,
    latestLandmarks.value,
  )
}

const resizeCanvas = () => {
  if (!canvas.value || !video.value) return
  const width = video.value.videoWidth || window.innerWidth
  const height = video.value.videoHeight || Math.round(window.innerWidth * 1.1)
  canvas.value.width = width
  canvas.value.height = height
  redrawGuideOverlay()
}

const updateBadge = (state, label) => {
  badgeState.value = state
  badgeLabel.value = label
}

const cancelSpeech = () => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

const speakPrompt = (analysisResult) => {
  if (!voiceEnabled.value || !analysisRunning.value) return
  if (!('speechSynthesis' in window)) return

  const voiceText = analysisResult?.voiceText?.trim()
  const voiceKey = `${selectedAgeGroup.value}:${analysisResult?.voiceKey || ''}`
  if (!voiceText || !voiceKey) return

  if (voiceKey === lastSpokenKey) return

  lastSpokenKey = voiceKey

  const utterance = new SpeechSynthesisUtterance(voiceText)
  utterance.lang = preferredSpeechVoice.value?.lang || 'zh-CN'
  if (preferredSpeechVoice.value) {
    utterance.voice = preferredSpeechVoice.value
  }
  utterance.rate = selectedAgeGroup.value === 'youth' ? 1.03 : 0.96
  utterance.pitch = selectedAgeGroup.value === 'youth' ? 1.05 : 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

const resetAnalysisState = (reason = '点击开始分析') => {
  reset()
  setEquipment(selectedEquipment.value)
  currentAnalysis.value = createIdleFitnessState(reason)
  latestLandmarks.value = null
  fps.value = 0
  avgConfidence.value = 0
  jointAngles.value = {
    leftElbow: null,
    rightElbow: null,
    leftShoulder: null,
    rightShoulder: null,
    leftKnee: null,
    rightKnee: null,
  }
  lastSpokenKey = ''
  cancelSpeech()
  redrawGuideOverlay()
}

const stopAnalysis = (reason = '已停止分析') => {
  analysisRunning.value = false
  poseEngine.stopLoop()
  poseEngine.resume()
  pauseText.value = '暂停'
  if (analysisMode.value === 'video' && video.value) {
    video.value.loop = false
    if (!video.value.paused) {
      video.value.pause()
    }
  }
  updateBadge('', reason)
  currentAnalysis.value = createIdleFitnessState(reason)
  latestLandmarks.value = null
  redrawGuideOverlay()
}

const startCamera = async (facing) => {
  try {
    clearImportedVideo()
    analysisMode.value = 'camera'

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('浏览器不支持相机能力')
    }
    if (!window.isSecureContext) {
      throw new Error('请使用 HTTPS 或 localhost 打开页面')
    }

    stopCameraStream()

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const candidates = isIOS
      ? [
          { video: { facingMode: { ideal: facing } }, audio: false },
          { video: { facingMode: facing }, audio: false },
          { video: true, audio: false },
        ]
      : [
          {
            video: {
              facingMode: { ideal: facing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
          },
          { video: { facingMode: facing }, audio: false },
          { video: true, audio: false },
        ]

    let stream = null
    let lastError = null
    for (const constraints of candidates) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (err) {
        lastError = err
      }
    }

    if (!stream) throw lastError || new Error('未获取到相机流')

    currentStream.value = stream
    video.value.muted = true
    video.value.setAttribute('muted', 'true')
    video.value.playsInline = true
    video.value.setAttribute('playsinline', 'true')
    video.value.setAttribute('webkit-playsinline', 'true')
    video.value.loop = false
    video.value.srcObject = stream

    await waitForVideoReady(video.value, 1)
    await video.value.play()
    /* await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('视频加载超时')), 10000)
      video.value.onloadedmetadata = () => {
        clearTimeout(timeout)
        video.value.play().then(resolve).catch(reject)
      }
      video.value.onerror = reject
    }) */

    videoActive.value = true
    resizeCanvas()
    requestWakeLock()
    updateBadge('', analysisRunning.value ? '体能分析中' : '相机已就绪')

    if (analysisRunning.value) {
      poseEngine.startLoop(video.value)
    }
  } catch (err) {
    console.error('[Fitness Camera Error]', err)
    updateBadge('error', '相机错误')
    loadingText.value = err?.message || '相机启动失败'
  }
}

const switchToVideoMode = async (file) => {
  if (!file || !video.value) return

  try {
    stopAnalysis('视频已加载')
    stopCameraStream()

    if (currentVideoURL.value) {
      URL.revokeObjectURL(currentVideoURL.value)
      currentVideoURL.value = ''
    }

    analysisMode.value = 'video'
    const objectURL = URL.createObjectURL(file)
    currentVideoURL.value = objectURL
    video.value.muted = true
    video.value.setAttribute('muted', 'true')
    video.value.playsInline = true
    video.value.setAttribute('playsinline', 'true')
    video.value.setAttribute('webkit-playsinline', 'true')
    video.value.loop = false
    video.value.pause()
    video.value.srcObject = null
    video.value.src = objectURL

    await waitForVideoReady(video.value, 2)
    video.value.currentTime = 0
    video.value.pause()
    /* await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('视频加载超时')), 10000)
      video.value.onloadedmetadata = () => {
        clearTimeout(timeout)
        resolve()
      }
      video.value.onerror = reject
    }) */

    videoActive.value = true
    resizeCanvas()
    resetAnalysisState('视频已加载，点击开始分析')
    updateBadge('', '视频已加载，点击开始分析')
  } catch (err) {
    console.error('[Fitness Video Error]', err)
    updateBadge('error', '视频导入失败')
    loadingText.value = err?.message || '视频导入失败'
  }
}

const handleVideoImport = async (event) => {
  const file = event?.target?.files?.[0]
  if (!file) return
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name)
  if (!isVideo) {
    updateBadge('error', '文件格式错误')
    loadingText.value = '请选择视频文件（mp4 / mov / webm）'
    return
  }
  await switchToVideoMode(file)
}

const openVideoImporter = () => {
  if (!videoFileInput.value) return
  videoFileInput.value.value = ''
  videoFileInput.value.click()
}

const startAnalysis = async () => {
  if (!video.value) return
  resetAnalysisState('正在建立动作基线')
  analysisRunning.value = true
  pauseText.value = '暂停'
  vibrate(24)

  if (analysisMode.value === 'video') {
    if (!currentVideoURL.value) {
      analysisRunning.value = false
      updateBadge('error', '请先导入视频')
      currentAnalysis.value = createIdleFitnessState('请先导入训练视频')
      return
    }
    video.value.loop = true
    video.value.currentTime = 0
    await video.value.play().catch(() => {})
  }

  poseEngine.resume()
  poseEngine.startLoop(video.value)
  updateBadge('live', analysisMode.value === 'camera' ? '体能实时分析中' : '体能视频分析中')
}

const toggleAnalysis = async () => {
  if (analysisRunning.value) {
    stopAnalysis('已停止分析')
    return
  }
  await startAnalysis()
}

const togglePause = async () => {
  if (!analysisRunning.value) return
  const paused = poseEngine.togglePause()
  pauseText.value = paused ? '继续' : '暂停'
  if (analysisMode.value === 'video' && video.value) {
    if (paused) {
      video.value.loop = false
      video.value.pause()
    } else {
      video.value.loop = true
      await video.value.play().catch(() => {})
    }
  }
  updateBadge(paused ? '' : 'live', paused ? '已暂停' : '分析中')
}

const toggleCamera = async () => {
  if (analysisMode.value !== 'camera') {
    resetAnalysisState('已切换到实时模式')
    await startCamera(facingMode.value)
    return
  }
  facingMode.value = facingMode.value === 'environment' ? 'user' : 'environment'
  await startCamera(facingMode.value)
}

const switchMode = async (mode) => {
  if (analysisMode.value === mode) return

  clearVideoContent()

  stopAnalysis(mode === 'camera' ? '已切换到实时模式' : '已切换到视频模式')
  resetAnalysisState(mode === 'camera' ? '实时预览已就绪，点击开始分析' : '请选择训练视频')

  if (mode === 'camera') {
    await startCamera(facingMode.value)
    return
  }

  analysisMode.value = 'video'
  stopCameraStream()
  videoActive.value = false
  updateBadge('', '请选择训练视频')
}

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    stopAnalysis('退出登录')
    stopCameraStream()
    clearImportedVideo()
    await authStore.logoutWithApi()
    router.replace('/login')
  } catch {
    // 用户取消，不做任何操作
  }
}

const handleVideoEnded = () => {
  if (analysisMode.value !== 'video') return
  if (analysisRunning.value && pauseText.value !== '继续' && video.value) {
    video.value.currentTime = 0
    video.value.play().catch(() => {})
    return
  }
  stopAnalysis('视频播放结束')
}

const finishLoading = () => {
  loadingProgress.value = 100
  loadingText.value = '体能训练模块已就绪'
  setTimeout(() => {
    isLoading.value = false
  }, 500)
}

const equipmentMeta = computed(() => (
  FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === selectedEquipment.value) || FITNESS_EQUIPMENT_OPTIONS[0]
))
const currentPanelSectionMeta = computed(() => (
  CONTROL_PANEL_SECTIONS.find((item) => item.key === controlPanelSection.value) || CONTROL_PANEL_SECTIONS[0]
))
const guideLegend = computed(() => GUIDE_LABELS[selectedEquipment.value] || GUIDE_LABELS.smith_squat)
const guideLegendText = computed(() => guideLegend.value.join(' / '))
const controlPanelToggleTitle = computed(() => (controlPanelExpanded.value ? '收起参数面板' : '展开参数面板'))
const preferredSpeechVoice = computed(() => {
  const voices = availableSpeechVoices.value || []
  if (!voices.length) return null
  const chineseVoices = voices.filter(isChineseVoice)
  const pool = chineseVoices.length ? chineseVoices : voices
  return [...pool].sort((a, b) => scoreVoice(b, selectedAgeGroup.value) - scoreVoice(a, selectedAgeGroup.value))[0] || null
})
const currentVoiceLabel = computed(() => (
  preferredSpeechVoice.value
    ? `${preferredSpeechVoice.value.name} · ${preferredSpeechVoice.value.lang || '系统语音'}`
    : '系统默认语音'
))

const displayScore = computed(() => {
  const score = currentAnalysis.value?.assessment?.score
  return typeof score === 'number' ? `${score}分` : '待判定'
})

const qualityLabel = computed(() => {
  const quality = currentAnalysis.value?.quality
  if (!quality) return '待判定'
  if (quality.score == null) return quality.label || '待判定'
  return `${quality.label} (${quality.score})`
})

const confidenceLabel = computed(() => `${Math.round(avgConfidence.value * 100)}%`)
const analysisButtonText = computed(() => (analysisRunning.value ? '停止分析' : '开始分析'))
const currentCue = computed(() => currentAnalysis.value?.cueText || '点击开始分析')
const assessmentItems = computed(() => currentAnalysis.value?.assessment?.items || [])

const openControlPanel = (section = 'overview') => {
  controlPanelSection.value = section
  controlPanelExpanded.value = true
}

watch(selectedEquipment, (value) => {
  setEquipment(value)
  resetAnalysisState(`已切换到 ${FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === value)?.label || '新器械'}，点击开始分析`)
})

watch(selectedEquipment, (value, oldValue) => {
  if (value === oldValue) return
  stopAnalysis(`已切换到 ${FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === value)?.label || '新器械'}`)
  if (analysisMode.value === 'video') {
    clearVideoContent()
    videoActive.value = false
    return
  }
  latestLandmarks.value = null
  videoActive.value = !!currentStream.value
  redrawGuideOverlay()
})

watch(selectedAgeGroup, () => {
  lastSpokenKey = ''
  cancelSpeech()
})

watch(showGuideLines, () => {
  redrawGuideOverlay()
})

onMounted(() => {
  setSkeletonConfig({
    showLabels: false,
    upperOnly: false,
    lineWidth: 3,
    lineColor: '#00e5ff',
  })

  if (canvas.value) {
    ctx = canvas.value.getContext('2d')
  }

  loadSpeechVoices()
  if ('speechSynthesis' in window) {
    window.speechSynthesis.addEventListener('voiceschanged', loadSpeechVoices)
  }

  const loadInterval = setInterval(() => {
    if (loadingProgress.value < 85) {
      loadingProgress.value += Math.random() * 10
    }
  }, 260)

  poseEngine.init({
    onReady: async () => {
      if (canUseCamera()) {
        await startCamera(facingMode.value)
      } else {
        analysisMode.value = 'video'
        videoActive.value = false
        resetAnalysisState('当前环境不支持实时相机，已切换为视频分析模式，请先导入训练视频')
        updateBadge('', '请导入训练视频开始分析')
      }
      clearInterval(loadInterval)
      finishLoading()
    },
    onResults: ({ landmarks, image, fps: fpsValue }) => {
      if (!ctx || !canvas.value || !analysisRunning.value) return

      if (!landmarks || !isValidPersonPose(landmarks)) {
        currentAnalysis.value = createIdleFitnessState('未检测到稳定人体骨骼')
        latestLandmarks.value = null
        avgConfidence.value = 0
        fps.value = fpsValue || 0
        redrawGuideOverlay()
        return
      }

      const angles = getJointAngles(landmarks)
      const analysisResult = analyze(landmarks, angles, {
        equipment: selectedEquipment.value,
        ageGroup: selectedAgeGroup.value,
        frameWidth: video.value?.videoWidth || canvas.value.width || 0,
        frameHeight: video.value?.videoHeight || canvas.value.height || 0,
      })

      currentAnalysis.value = analysisResult
      latestLandmarks.value = landmarks
      fps.value = fpsValue || 0
      avgConfidence.value = calcAvgConfidence(landmarks)
      jointAngles.value = {
        leftElbow: angles.leftElbow ?? null,
        rightElbow: angles.rightElbow ?? null,
        leftShoulder: angles.leftShoulder ?? null,
        rightShoulder: angles.rightShoulder ?? null,
        leftKnee: angles.leftKnee ?? null,
        rightKnee: angles.rightKnee ?? null,
      }

      ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
      drawGuideOverlay(
        ctx,
        canvas.value.width,
        canvas.value.height,
        selectedEquipment.value,
        analysisResult,
        landmarks,
      )
      draw(ctx, landmarks, canvas.value.width, canvas.value.height)

      speakPrompt(analysisResult)
    },
    onError: (err) => {
      console.error('[Fitness PoseEngine]', err)
      updateBadge('error', '引擎错误')
    },
  })

  window.addEventListener('resize', resizeCanvas)
})

onUnmounted(() => {
  cancelSpeech()
  stopAnalysis('页面已退出')
  stopCameraStream()
  clearImportedVideo()
  poseEngine.stopLoop()
  if ('speechSynthesis' in window) {
    window.speechSynthesis.removeEventListener('voiceschanged', loadSpeechVoices)
  }
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <div class="fitness-page">
    <TopBar
      title="体能训练姿势识别"
      :show-settings="false"
      :show-export="false"
      @import-video="openVideoImporter"
      @logout="handleLogout"
    />

    <main class="fitness-shell">
      <section class="fitness-video-panel">
        <video
          ref="video"
          class="fitness-video"
          muted
          playsinline
          :class="{ active: videoActive }"
          @ended="handleVideoEnded"
        ></video>
        <canvas ref="canvas" class="fitness-canvas"></canvas>

        <div class="fitness-corner-badge">
          <span class="badge-dot" :class="badgeState"></span>
          <span>{{ badgeLabel }}</span>
        </div>

        <div v-if="showGuideLines" class="fitness-guide-pill">
          <strong>辅助线</strong>
          <span>{{ guideLegendText }}</span>
        </div>

        <div class="fitness-video-meta">
          <span>{{ analysisMode === 'camera' ? '实时分析' : '视频分析' }}</span>
          <span>{{ equipmentMeta.label }}</span>
          <span>{{ currentAnalysis.phaseLabel }}</span>
        </div>

        <div class="fitness-cue-card" :class="[`tone-${currentAnalysis.cueTone || 'info'}`]">
          <strong>{{ currentCue }}</strong>
          <p>推荐机位：{{ equipmentMeta.recommendedView }} · 年龄组：{{ selectedAgeGroup === 'youth' ? '青少年' : '成年人' }}</p>
        </div>

        <div v-if="!analysisRunning" class="fitness-start-mask">
          <div class="fitness-start-card">
            <h2>{{ equipmentMeta.label }}</h2>
            <p>{{ equipmentMeta.focus }}</p>
            <button class="fitness-primary-btn" @click="toggleAnalysis">{{ analysisButtonText }}</button>
          </div>
        </div>
      </section>

      <div
        v-if="controlPanelExpanded"
        class="fitness-panel-backdrop"
        @click="controlPanelExpanded = false"
      ></div>

      <button
        class="fitness-panel-toggle"
        :class="{ active: controlPanelExpanded }"
        :title="controlPanelToggleTitle"
        @click="controlPanelExpanded ? (controlPanelExpanded = false) : openControlPanel('overview')"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="7" x2="20" y2="7"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="17" x2="20" y2="17"/>
          <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>
          <circle cx="11" cy="17" r="2" fill="currentColor" stroke="none"/>
        </svg>
      </button>

      <section class="fitness-control-panel" :class="{ expanded: controlPanelExpanded }">
        <div class="fitness-panel-header">
          <div class="fitness-panel-title">
            <strong>参数面板</strong>
            <span>{{ currentPanelSectionMeta.label }} · {{ currentPanelSectionMeta.hint }} · {{ equipmentMeta.label }}</span>
          </div>
          <button class="fitness-panel-close" title="收起参数面板" @click="controlPanelExpanded = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="fitness-panel-tabs">
          <button
            v-for="item in CONTROL_PANEL_SECTIONS"
            :key="item.key"
            :class="{ active: controlPanelSection === item.key }"
            @click="controlPanelSection = item.key"
          >
            {{ item.label }}
          </button>
        </div>

        <div v-if="controlPanelSection === 'overview'" class="fitness-stats">
          <div class="fitness-stat-card">
            <span>相位</span>
            <strong>{{ currentAnalysis.phaseLabel }}</strong>
          </div>
          <div class="fitness-stat-card">
            <span>评分</span>
            <strong>{{ displayScore }}</strong>
          </div>
          <div class="fitness-stat-card">
            <span>次数</span>
            <strong>{{ currentAnalysis.repCount ?? 0 }}</strong>
          </div>
          <div class="fitness-stat-card">
            <span>质量</span>
            <strong>{{ qualityLabel }}</strong>
          </div>
          <div class="fitness-stat-card">
            <span>置信度</span>
            <strong>{{ confidenceLabel }}</strong>
          </div>
          <div class="fitness-stat-card">
            <span>帧率</span>
            <strong>{{ fps }} fps</strong>
          </div>
        </div>

        <div v-if="controlPanelSection === 'overview' || controlPanelSection === 'mode'" class="fitness-actions fitness-actions-tight">
          <button class="fitness-primary-btn" @click="toggleAnalysis">{{ analysisButtonText }}</button>
          <button class="fitness-secondary-btn" :disabled="!analysisRunning" @click="togglePause">{{ pauseText }}</button>
          <button class="fitness-secondary-btn" @click="toggleCamera">{{ analysisMode === 'camera' ? '切换摄像头' : '回到相机' }}</button>
          <button class="fitness-secondary-btn" @click="openVideoImporter">导入视频</button>
          <button class="fitness-secondary-btn" :class="{ active: showGuideLines }" @click="showGuideLines = !showGuideLines">
            {{ showGuideLines ? '辅助线已开' : '辅助线已关' }}
          </button>
          <button class="fitness-secondary-btn" @click="controlPanelSection = 'checks'">查看检查项</button>
        </div>

        <div v-if="controlPanelSection === 'mode'" class="fitness-block">
          <div class="fitness-block-header">
            <span>分析模式</span>
            <small>仅本地分析，不依赖后端</small>
          </div>
          <div class="fitness-segment">
            <button :class="{ active: analysisMode === 'camera' }" @click="switchMode('camera')">实时分析</button>
            <button :class="{ active: analysisMode === 'video' }" @click="switchMode('video')">视频分析</button>
          </div>
        </div>

        <div v-if="controlPanelSection === 'equipment'" class="fitness-block">
          <div class="fitness-block-header">
            <span>训练器械</span>
            <small>首批支持高确定性固定动作</small>
          </div>
          <div class="fitness-equipment-grid">
            <button
              v-for="item in FITNESS_EQUIPMENT_OPTIONS"
              :key="item.value"
              class="fitness-equipment-btn"
              :class="{ active: selectedEquipment === item.value }"
              @click="selectedEquipment = item.value"
            >
              <strong>{{ item.shortLabel }}</strong>
              <span>{{ item.recommendedView }}</span>
            </button>
          </div>
        </div>

        <div v-if="controlPanelSection === 'voice'" class="fitness-block">
          <div class="fitness-block-header">
            <span>提示人群</span>
            <small>同一动作，双年龄段语音提示</small>
          </div>
          <div class="fitness-segment">
            <button :class="{ active: selectedAgeGroup === 'youth' }" @click="selectedAgeGroup = 'youth'">6-18岁</button>
            <button :class="{ active: selectedAgeGroup === 'adult' }" @click="selectedAgeGroup = 'adult'">18岁以上</button>
          </div>
        </div>

        <div v-if="controlPanelSection === 'voice'" class="fitness-actions">
          <button class="fitness-secondary-btn" :class="{ active: voiceEnabled }" @click="voiceEnabled = !voiceEnabled">
            {{ voiceEnabled ? '语音已开' : '语音已关' }}
          </button>
          <button class="fitness-secondary-btn" @click="controlPanelSection = 'overview'">返回总览</button>
        </div>

        <div v-if="controlPanelSection === 'voice'" class="fitness-voice-note">
          <span>当前音色</span>
          <strong>{{ currentVoiceLabel }}</strong>
        </div>

        <div v-if="controlPanelSection === 'checks'" class="fitness-block">
          <div class="fitness-block-header">
            <span>动作检查项</span>
            <small>{{ equipmentMeta.focus }}</small>
          </div>
          <div class="fitness-check-list">
            <div
              v-for="item in assessmentItems"
              :key="item.key"
              class="fitness-check-item"
              :class="{ ok: item.ok === true, bad: item.ok === false, pending: item.ok === null }"
            >
              <div class="fitness-check-head">
                <span>{{ item.label }}</span>
                <strong>{{ item.ok === true ? '正确' : item.ok === false ? '纠正' : '待判定' }}</strong>
              </div>
              <p>{{ item.detail }}</p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <input
      ref="videoFileInput"
      type="file"
      accept="video/*,.mp4,.mov,.m4v,.webm,.avi"
      style="display: none"
      @change="handleVideoImport"
    >

    <LoadingOverlay :is-loading="isLoading" :progress="loadingProgress" :text="loadingText" />
  </div>
</template>

<style scoped>
.fitness-page {
  min-height: 100dvh;
  background:
    radial-gradient(circle at 20% 10%, rgba(0, 229, 255, 0.18), transparent 28%),
    radial-gradient(circle at 80% 0%, rgba(105, 255, 71, 0.12), transparent 24%),
    #07111d;
  color: #e7fbff;
}

.fitness-shell {
  width: min(1400px, 100%);
  margin: 0 auto;
  padding:
    calc(86px + env(safe-area-inset-top))
    calc(14px + env(safe-area-inset-right))
    calc(20px + env(safe-area-inset-bottom))
    calc(14px + env(safe-area-inset-left));
  min-height: 100dvh;
  display: grid;
  gap: 14px;
}

.fitness-video-panel {
  position: relative;
  min-height: calc(100dvh - 120px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  height: calc(100dvh - 120px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  border-radius: 28px;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 12%, rgba(0, 229, 255, 0.12), transparent 28%),
    rgba(1, 8, 18, 0.92);
  border: 1px solid rgba(0, 229, 255, 0.18);
  box-shadow: 0 24px 54px rgba(0, 0, 0, 0.32);
}

.fitness-video,
.fitness-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fitness-canvas {
  pointer-events: none;
}

.fitness-video {
  opacity: 0;
  transition: opacity 0.25s ease;
}

.fitness-video.active {
  opacity: 1;
}

.fitness-corner-badge {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(3, 12, 24, 0.82);
  border: 1px solid rgba(0, 229, 255, 0.22);
  backdrop-filter: blur(8px);
  font-size: 12px;
}

.fitness-guide-pill {
  position: absolute;
  top: 66px;
  right: 18px;
  z-index: 2;
  max-width: min(48vw, 260px);
  padding: 10px 12px;
  border-radius: 18px;
  background: rgba(3, 12, 24, 0.82);
  border: 1px solid rgba(0, 229, 255, 0.18);
  backdrop-filter: blur(8px);
  display: grid;
  gap: 4px;
}

.fitness-guide-pill strong {
  font-size: 12px;
  color: #eafcff;
}

.fitness-guide-pill span {
  color: #9ad9e7;
  font-size: 11px;
  line-height: 1.45;
}

.fitness-video-meta {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: min(62vw, 620px);
}

.fitness-video-meta span {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(3, 12, 24, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
}

.fitness-cue-card {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 2;
  display: grid;
  gap: 6px;
  width: min(380px, calc(100% - 36px));
  padding: 14px 16px;
  border-radius: 20px;
  background: rgba(4, 16, 28, 0.84);
  border: 1px solid rgba(0, 229, 255, 0.16);
  backdrop-filter: blur(16px);
}

.fitness-cue-card strong {
  display: block;
  font-size: 17px;
  line-height: 1.45;
}

.fitness-cue-card p {
  margin: 0;
  color: #89d8e9;
  font-size: 12px;
  line-height: 1.55;
}

.fitness-cue-card.tone-warning {
  border-color: rgba(255, 215, 64, 0.34);
}

.fitness-cue-card.tone-success {
  border-color: rgba(105, 255, 71, 0.34);
}

.fitness-start-mask {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: linear-gradient(180deg, rgba(4, 10, 18, 0.12), rgba(4, 10, 18, 0.7));
}

.fitness-start-card {
  width: min(380px, 92%);
  padding: 22px;
  border-radius: 24px;
  background: rgba(5, 14, 25, 0.9);
  border: 1px solid rgba(0, 229, 255, 0.18);
  text-align: center;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.32);
}

.fitness-start-card h2 {
  margin: 0;
  font-size: 22px;
}

.fitness-start-card p {
  margin: 10px 0 16px;
  color: #9ad9e7;
  line-height: 1.5;
}

.fitness-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9;
  background: rgba(2, 9, 17, 0.48);
  backdrop-filter: blur(3px);
}

.fitness-panel-toggle {
  position: fixed;
  right: calc(14px + env(safe-area-inset-right));
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 12;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  border: 1px solid rgba(0, 229, 255, 0.36);
  background: rgba(4, 14, 24, 0.92);
  color: #effcff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(10px);
}

.fitness-panel-toggle.active {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.28), rgba(105, 255, 71, 0.22));
  border-color: rgba(0, 229, 255, 0.82);
  transform: translateY(-2px);
}

.fitness-control-panel {
  position: fixed;
  left: calc(12px + env(safe-area-inset-left));
  right: calc(12px + env(safe-area-inset-right));
  bottom: calc(86px + env(safe-area-inset-bottom));
  z-index: 11;
  max-height: min(72dvh, 720px);
  overflow: auto;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  border-radius: 24px;
  background: rgba(5, 14, 25, 0.96);
  border: 1px solid rgba(0, 229, 255, 0.2);
  box-shadow: 0 28px 56px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(18px);
  gap: 10px;
  display: grid;
  transform: translateY(calc(100% + 28px));
  opacity: 0;
  pointer-events: none;
  transition: transform 0.28s ease, opacity 0.22s ease;
}

.fitness-control-panel.expanded {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}

.fitness-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
}

.fitness-panel-title {
  display: grid;
  gap: 2px;
}

.fitness-panel-title strong {
  font-size: 16px;
  line-height: 1.1;
}

.fitness-panel-title span {
  color: #88d1e2;
  font-size: 11px;
  line-height: 1.35;
}

.fitness-panel-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 0 10px;
}

.fitness-panel-tabs button {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 8px 6px;
  background: rgba(255, 255, 255, 0.04);
  color: #cceef5;
  font-size: 11px;
}

.fitness-panel-tabs button.active {
  border-color: rgba(0, 229, 255, 0.72);
  background: rgba(0, 229, 255, 0.16);
  color: #f4feff;
}

.fitness-panel-close {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #effcff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

@media (min-width: 420px) {
  .fitness-panel-tabs {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

.fitness-block,
.fitness-stats,
.fitness-actions {
  margin: 0 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(6, 16, 28, 0.9);
  border: 1px solid rgba(0, 229, 255, 0.14);
}

.fitness-block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.fitness-block-header span {
  font-size: 14px;
  font-weight: 600;
}

.fitness-block-header small {
  color: #87cfe0;
  font-size: 11px;
}

.fitness-segment {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.fitness-segment button,
.fitness-equipment-btn,
.fitness-secondary-btn,
.fitness-primary-btn {
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #effcff;
  cursor: pointer;
}

.fitness-segment button.active,
.fitness-equipment-btn.active,
.fitness-secondary-btn.active {
  border-color: rgba(0, 229, 255, 0.76);
  background: rgba(0, 229, 255, 0.16);
}

.fitness-equipment-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.fitness-equipment-btn {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 64px;
}

.fitness-equipment-btn strong {
  font-size: 14px;
}

.fitness-equipment-btn span {
  color: #9ad9e7;
  font-size: 11px;
}

.fitness-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.fitness-stat-card {
  padding: 10px 11px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.fitness-stat-card span {
  display: block;
  color: #89d8e9;
  font-size: 11px;
  margin-bottom: 4px;
}

.fitness-stat-card strong {
  font-size: 16px;
  line-height: 1.1;
}

.fitness-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.fitness-actions-tight {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fitness-voice-note {
  margin: 0 10px;
  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: grid;
  gap: 3px;
}

.fitness-voice-note span {
  color: #8fd6e6;
  font-size: 12px;
}

.fitness-voice-note strong {
  font-size: 13px;
  line-height: 1.45;
  color: #effcff;
}

.fitness-primary-btn {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.22), rgba(105, 255, 71, 0.18));
  border-color: rgba(0, 229, 255, 0.8);
  color: #f4feff;
  font-weight: 700;
}

.fitness-check-list {
  display: grid;
  gap: 8px;
}

.fitness-check-item {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.fitness-check-item.ok {
  border-color: rgba(105, 255, 71, 0.3);
  background: rgba(105, 255, 71, 0.08);
}

.fitness-check-item.bad {
  border-color: rgba(255, 64, 129, 0.28);
  background: rgba(255, 64, 129, 0.08);
}

.fitness-check-item.pending {
  border-color: rgba(255, 215, 64, 0.18);
}

.fitness-check-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.fitness-check-head strong {
  font-size: 12px;
}

.fitness-check-item p {
  margin: 0;
  color: #bfe9f3;
  font-size: 12px;
  line-height: 1.5;
}

@media (min-width: 820px) {
  .fitness-shell {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .fitness-video-panel {
    min-height: calc(100dvh - 112px);
    height: calc(100dvh - 112px);
  }

  .fitness-control-panel {
    left: auto;
    top: calc(92px + env(safe-area-inset-top));
    right: calc(14px + env(safe-area-inset-right));
    bottom: calc(14px + env(safe-area-inset-bottom));
    width: min(396px, 40vw);
    max-height: none;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
    transform: translateX(calc(100% + 28px));
  }

  .fitness-control-panel.expanded {
    transform: translateX(0);
  }

  .fitness-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .fitness-guide-pill {
    max-width: 240px;
  }

}

@media (max-width: 960px) {
  .fitness-shell {
    padding-top: calc(98px + env(safe-area-inset-top));
  }

  .fitness-video-panel {
    min-height: calc(100dvh - 146px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    height: calc(100dvh - 146px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }

}

@media (max-width: 720px) {
  .fitness-shell {
    padding:
      calc(96px + env(safe-area-inset-top))
      calc(10px + env(safe-area-inset-right))
      calc(18px + env(safe-area-inset-bottom))
      calc(10px + env(safe-area-inset-left));
  }

  .fitness-video-panel {
    min-height: calc(100dvh - 194px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    height: calc(100dvh - 194px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    border-radius: 24px;
  }

  .fitness-video-meta {
    top: 14px;
    left: 14px;
    right: 14px;
    max-width: none;
  }

  .fitness-corner-badge {
    top: auto;
    right: 14px;
    bottom: 14px;
  }

  .fitness-guide-pill {
    top: 14px;
    right: 14px;
    max-width: min(56vw, 220px);
  }

  .fitness-cue-card {
    left: 14px;
    right: 14px;
    bottom: 64px;
    width: auto;
    padding: 12px 14px;
  }

  .fitness-panel-toggle {
    width: 52px;
    height: 52px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    right: calc(10px + env(safe-area-inset-right));
  }

  .fitness-control-panel {
    left: calc(10px + env(safe-area-inset-left));
    right: calc(10px + env(safe-area-inset-right));
    bottom: calc(76px + env(safe-area-inset-bottom));
    max-height: min(62dvh, 620px);
    border-radius: 24px;
  }

  .fitness-panel-tabs {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .fitness-stats,
  .fitness-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fitness-actions-tight {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .fitness-video-panel {
    min-height: calc(100dvh - 220px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    height: calc(100dvh - 220px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }

  .fitness-video-meta span,
  .fitness-corner-badge,
  .fitness-guide-pill strong,
  .fitness-guide-pill span {
    font-size: 11px;
  }

  .fitness-guide-pill {
    max-width: 180px;
    padding: 8px 10px;
  }

  .fitness-cue-card {
    bottom: 56px;
  }

  .fitness-panel-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fitness-stats,
  .fitness-actions,
  .fitness-equipment-grid,
  .fitness-segment {
    grid-template-columns: 1fr;
  }
}
</style>
