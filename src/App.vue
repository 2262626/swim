<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TopBar from './components/TopBar.vue'
import BottomPanel from './components/BottomPanel.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import LoadingOverlay from './components/LoadingOverlay.vue'
import { ElImage, ElDialog, ElTabs, ElTabPane, ElInput, ElSelect, ElOption, ElButton, ElMessage, ElMessageBox } from 'element-plus'
import { usePoseEngine } from './composables/usePoseEngine.js'
import { useSkeletonDraw } from './composables/useSkeletonDraw.js'
import { useSwimAnalysis } from './composables/useSwimAnalysis.js'
import { useMobileFeatures } from './composables/useMobileFeatures.js'
import { useAuthStore } from './store/auth.js'
import { listTeamsApi, listAthletesApi, createTeamApi, createAthleteApi, listTrainingTargetsApi, listPoolLengthsApi, listCameraTypesApi } from './api/swim.js'
import { uploadVideoFileApi, submitVideoAnalysisApi } from './api/videoAnalysis.js'
import { useSessionUploader } from './composables/useSessionUploader.js'

// ============ Refs ============
const video = ref(null)
const canvas = ref(null)
const videoFileInput = ref(null)
let ctx = null

// ============ State ============
const currentStream = ref(null)
const currentVideoURL = ref('')
const analysisMode = ref('camera') // camera | video
const facingMode = ref('environment')
const personDetected = ref(false)
let noPersonTimer = null
const noPersonHintVisible = ref(false)
const isSettingsOpen = ref(false)
const isLoading = ref(true)
const loadingProgress = ref(0)
const loadingText = ref('正在加载 MediaPipe 模型...')
const badgeState = ref('')
const badgeLabel = ref('初始化中')
const scanLineActive = ref(false)
const videoActive = ref(false)

const fps = ref(0)
const avgConfidence = ref(0)
const currentAssessment = ref({ score: null, items: [] })
const captureList = ref([])
const captureBuffer = ref([])
const captureSessionId = ref('')
const captureRootHandle = ref(null)
const isCaptureListCollapsed = ref(true)
const postRecordDialog = ref({ visible: false })
const pendingVideoBlob = ref(null)
const pendingVideoMimeType = ref('')
const isCompactLandscapeViewport = ref(false)
const isCoachContextCollapsed = ref(true)
const isBottomPanelCollapsed = ref(false)

const settings = ref({
  complexity: 2,
  detectConf: 0.70,
  trackConf: 0.70,
  cameraProfile: 'side',
  lineWidth: 3,
  lineColor: '#00FFFC',
  showLabels: true,
  upperOnly: false,
})

const HIGH_ACCURACY_PRESET = {
  complexity: 2,
  detectConf: 0.70,
  trackConf: 0.70,
}

const openQuickAdd = () => {
  quickAddVisible.value = true
  quickAddError.value = ''
  if (!quickAthleteForm.value.teamId && selectedTeamId.value) {
    quickAthleteForm.value.teamId = selectedTeamId.value
  }
}

const submitQuickAddTeam = async () => {
  const teamName = quickTeamName.value.trim()
  if (!teamName) {
    quickAddError.value = '请输入队伍名称'
    return
  }
  quickAddLoading.value = true
  quickAddError.value = ''
  try {
    const res = await createTeamApi({ teamName })
    if (res?.code !== 200) throw new Error(res?.msg || '新增队伍失败')
    await loadTeams()
    const target = [...teams.value].reverse().find((t) => t._teamName === teamName)
    if (target?._teamId) {
      selectedTeamId.value = target._teamId
      quickAthleteForm.value.teamId = target._teamId
    }
    quickTeamName.value = ''
    quickAddTab.value = 'athlete'
  } catch (err) {
    quickAddError.value = err?.message || '新增队伍失败'
  } finally {
    quickAddLoading.value = false
  }
}

const submitQuickAddAthlete = async () => {
  const athleteName = quickAthleteForm.value.athleteName.trim()
  const teamId = String(quickAthleteForm.value.teamId || '').trim()
  if (!teamId) {
    quickAddError.value = '请选择所属队伍'
    return
  }
  if (!athleteName) {
    quickAddError.value = '请输入学员姓名'
    return
  }

  quickAddLoading.value = true
  quickAddError.value = ''
  try {
    const res = await createAthleteApi({
      teamId: Number(teamId),
      athleteName,
      gender: quickAthleteForm.value.gender || '1',
    })
    if (res?.code !== 200) throw new Error(res?.msg || '新增学员失败')

    selectedTeamId.value = teamId
    await loadAthletes()
    const target = [...athletes.value].reverse().find((a) => a._athleteName === athleteName)
    if (target?._athleteId) selectedAthleteId.value = target._athleteId

    quickAthleteForm.value.athleteName = ''
    quickAddVisible.value = false
  } catch (err) {
    quickAddError.value = err?.message || '新增学员失败'
  } finally {
    quickAddLoading.value = false
  }
}

const appBooted = ref(false)
const teams = ref([])
const athletes = ref([])
const selectedTeamId = ref('')
const selectedAthleteId = ref('')
const athleteKeyword = ref('')
const loadingTeams = ref(false)
const loadingAthletes = ref(false)
const quickAddVisible = ref(false)
const quickAddTab = ref('team')
const quickAddLoading = ref(false)
const quickAddError = ref('')
const quickTeamName = ref('')
const quickAthleteForm = ref({
  teamId: '',
  athleteName: '',
  gender: '1',
})
const analysisSummary = ref({
  frameCount: 0,
  scoreSum: 0,
  pauseCount: 0,
  styleScoreMap: {},
  errorCountMap: {},
})
// ── 录制参数（与AI分析表单对齐） ──
const recordPoolLength = ref(25)
const recordTrainingTarget = ref('')
const recordCameraType = ref([])

const DEFAULT_POOL_LENGTH_OPTIONS = [
  { label: '25米', value: 25 },
  { label: '50米', value: 50 },
]
const DEFAULT_TRAINING_TARGET_OPTIONS = ['中考游泳', '等级考试', '竞技比赛', '减脂健身', '初学入门']
const DEFAULT_CAMERA_TYPE_OPTIONS = [
  { label: '正侧面固定机位', value: '正侧面固定机位' },
  { label: '泳道尽头正面机位', value: '泳道尽头正面机位' },
  { label: '水下侧机位', value: '水下侧机位' },
  { label: '顶部俯视机位', value: '顶部俯视机位' },
]
const poolLengthOptions = ref([...DEFAULT_POOL_LENGTH_OPTIONS])
const trainingTargetOptions = ref([...DEFAULT_TRAINING_TARGET_OPTIONS])
const cameraTypeOptions = ref([...DEFAULT_CAMERA_TYPE_OPTIONS])

// ── 摄像头录制 (MediaRecorder) ──
let mediaRecorder = null
let recordedChunks = []
const recordingElapsed = ref(0)
let recordingElapsedTimer = null
const isUploadingRecording = ref(false)
const uploadProgress = ref(0)

const autoPauseEnabled = ref(true)
const autoPauseDialog = ref({
  visible: false,
  eventId: '',
  severity: 'low',
  triggerType: '',
  title: '',
  summary: '',
  suggestion: '',
  drill: '',
  evidenceLabel: '',
  evidenceValue: '',
  targetRange: '',
  snapshot: '',
})

const swimStyleOptions = ['自由泳', '蛙泳', '蝶泳', '仰泳']
const cameraProfileOptions = [
  { value: 'side', label: '池边侧拍' },
  { value: 'diagonal', label: '斜侧拍' },
  { value: 'front', label: '正前/正后拍' },
  { value: 'underwater', label: '水下侧拍' },
]
const selectedSwimStyle = ref('蝶泳')
const recordingSwimStyle = ref('')
const activeTargetSwimStyle = computed(() => recordingSwimStyle.value || selectedSwimStyle.value)
const styleStandardTemplates = {
  自由泳: [
    { key: 'armAlternate', label: '双臂交替划水' },
    { key: 'armStraight', label: '移臂保持伸直' },
    { key: 'legAlternate', label: '膝踝交替打腿' },
    { key: 'hipLevel', label: '身体平直不塌腰' },
    { key: 'kneeFlex', label: '膝盖微屈不蜷缩' },
    { key: 'bodyRoll', label: '身体滚动转体' },
    { key: 'breathTiming', label: '转头呼吸不抬头' },
  ],
  蛙泳: [
    { key: 'armSync', label: '双臂对称划水' },
    { key: 'kneesWidth', label: '收腿宽度合理' },
    { key: 'legClamp', label: '蹬夹并拢到位' },
    { key: 'frontGlide', label: '前伸滑行充分' },
    { key: 'timing', label: '手腿配合时序' },
    { key: 'breathTiming', label: '抬头吸气时机' },
  ],
  蝶泳: [
    { key: 'armSync', label: '双臂同步划水' },
    { key: 'armStraight', label: '手臂前伸出水' },
    { key: 'bodyWave', label: '躯干波浪连贯' },
    { key: 'legClose', label: '双腿并拢打腿' },
    { key: 'legStraight', label: '腿部鞭状发力' },
    { key: 'breathTiming', label: '呼吸配合发力' },
  ],
  仰泳: [
    { key: 'faceUp', label: '仰卧姿态稳定' },
    { key: 'armAlternate', label: '双臂交替移臂' },
    { key: 'armStraight', label: '出水手臂伸直' },
    { key: 'legAlternate', label: '双腿交替打腿' },
    { key: 'kneeFlex', label: '膝盖弯曲幅度合理' },
    { key: 'bodyLine', label: '身体平直流线' },
    { key: 'headStable', label: '头部稳定放松' },
  ],
  准备姿势: [
    { key: 'prepBody', label: '身体准备' },
    { key: 'prepArms', label: '手臂放松' },
    { key: 'prepHead', label: '头部放松' },
    { key: 'prepFeet', label: '双脚站稳' },
  ],
  过渡动作: [
    { key: 'transitionState', label: '动作过渡' },
  ],
  起跳阶段: [
    { key: 'startState', label: '起跳发力' },
  ],
  水下阶段: [
    { key: 'underwaterState', label: '水下滑行' },
  ],
  证据不足: [
    { key: 'evidenceInsufficient', label: '当前帧不判定' },
  ],
  转身阶段: [
    { key: 'turnState', label: '转身团身' },
  ],
  结束阶段: [
    { key: 'finishState', label: '结束收势' },
  ],
}

const freestyleStandardTemplate = [
  { key: 'armAlternate', label: '双臂交替划水' },
  { key: 'armStraight', label: '移臂保持伸直' },
  { key: 'legAlternate', label: '膝踝交替打腿' },
  { key: 'hipLevel', label: '身体平直不塌腰' },
  { key: 'kneeFlex', label: '膝盖微屈不蜷缩' },
  { key: 'bodyRoll', label: '身体滚动转体' },
  { key: 'breathTiming', label: '转头呼吸不抬头' },
]

function createIdleAnalysisState(reason = '等待识别到稳定人体骨骼') {
  return {
    timestamp: Date.now(),
    stage: 'INVALID',
    stageLabel: '证据不足',
    style: '未知',
    phase: '准备',
    strokeCount: 0,
    strokeRate: 0,
    symmetry: null,
    angles: {
      leftElbow: null,
      rightElbow: null,
      leftShoulder: null,
      rightShoulder: null,
      leftKnee: null,
      rightKnee: null,
    },
    judgeable: false,
    rejectionReason: reason,
    assessment: {
      score: null,
      items: [
        {
          key: 'evidenceInsufficient',
          label: '当前帧不判定',
          ok: null,
          detail: reason,
        },
      ],
    },
    quality: {
      score: null,
      label: '待判定',
      reasons: [],
      warnings: [],
      cameraProfile: settings.value.cameraProfile,
      cameraProfileLabel: cameraProfileOptions.find((item) => item.value === settings.value.cameraProfile)?.label || '池边侧拍',
    },
    metricsEligible: false,
    captureEligible: false,
    autoPauseEligible: false,
    styleSource: 'unknown',
  }
}

const currentAnalysis = ref(createIdleAnalysisState())

// ============ Composables ============
const poseEngine = usePoseEngine()
const { draw, getJointAngles, setConfig: setSkeletonConfig } = useSkeletonDraw()
const router = useRouter()
const authStore = useAuthStore()
const {
  analyze,
  reset,
  toggleRecording,
  isRecording,
  strokeCount,
  detectedStroke,
  setUnknownDetection,
} = useSwimAnalysis()
const { 
  isOnline, 
  deviceType, 
  vibrate,
  requestWakeLock 
} = useMobileFeatures()
const {
  sessionId: uploadSessionId,
  running: uploadRunning,
  uploading,
  pendingCount,
  lastError: uploadError,
  startSession,
  queueFrameMetric,
  queuePauseEvent,
  queueCoachAction,
  queueSnapshot,
  flush,
  completeSession,
  abortSession,
} = useSessionUploader()

// ============ Joint Angles ============
const jointAngles = ref({
  leftElbow: null,
  rightElbow: null,
  leftShoulder: null,
  rightShoulder: null,
})

const CAPTURE_INTERVAL_MS = 700
const MAX_CAPTURE_ITEMS = 120
const CAPTURE_JPEG_QUALITY = 0.96
const CAPTURE_SCALE = 1
const TEACHING_SNAPSHOT_JPEG_QUALITY = 0.94
const AUTO_PAUSE_CONSECUTIVE = 3
const AUTO_PAUSE_COOLDOWN_MS = 1200
const AUTO_PAUSE_LOW_RESUME_MS = 1000
let lastCaptureTime = 0
let lastCaptureStrokeCount = 0
let autoPauseResumeTimer = null
const autoPauseTracker = {
  key: '',
  count: 0,
  lastTriggerAt: 0,
}


// 性能优化：UI 更新节流控制
let lastUIUpdate = 0
const UI_UPDATE_INTERVAL = 150  // 每 150ms 更新一次 UI，而非每帧

// 用于节流的临时存储
const pendingJointAngles = ref(null)
const pendingFps = ref(0)
const pendingConfidence = ref(0)

// 批量更新 UI，减少高频响应触发
const throttledUIUpdate = () => {
  const now = performance.now()
  if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
    if (pendingJointAngles.value) {
      jointAngles.value = { ...pendingJointAngles.value }
      pendingJointAngles.value = null
    }
    if (pendingFps.value) {
      fps.value = pendingFps.value
      pendingFps.value = 0
    }
    if (pendingConfidence.value) {
      avgConfidence.value = pendingConfidence.value
      pendingConfidence.value = 0
    }
    lastUIUpdate = now
  }
}

const resetCaptureBuffer = () => {
  captureBuffer.value = []
  captureSessionId.value = formatSessionId(new Date())
  lastCaptureTime = 0
  lastCaptureStrokeCount = strokeCount.value
}

const finalizeCaptureList = async () => {
  const finalizedList = captureBuffer.value.filter(
    (item) => typeof item.image === 'string' && item.image.startsWith('data:image/')
  )
  if (!finalizedList.length) return

  captureList.value = finalizedList
  isCaptureListCollapsed.value = false
  await saveCaptureListToLocal()
}

const clearPlaybackDisplay = () => {
  captureBuffer.value = []
  captureList.value = []
  isCaptureListCollapsed.value = true
}

const clearImportedVideo = () => {
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.srcObject = null
    video.value.load()
  }

  if (currentVideoURL.value) {
    URL.revokeObjectURL(currentVideoURL.value)
    currentVideoURL.value = ''
  }
}

const tryCaptureFrame = (analysisResult, fpsValue, confidenceValue, sourceImage = null) => {
  if (!canvas.value || !analysisResult) return

  const now = Date.now()
  const strokeChanged = analysisResult.strokeCount > lastCaptureStrokeCount
  if (!strokeChanged && now - lastCaptureTime < CAPTURE_INTERVAL_MS) return

  if (!canvas.value.width || !canvas.value.height) return

  let imageData = ''
  try {
    const baseW = Math.max(video.value?.videoWidth || 0, sourceImage?.width || 0, canvas.value.width || 0)
    const baseH = Math.max(video.value?.videoHeight || 0, sourceImage?.height || 0, canvas.value.height || 0)
    if (!baseW || !baseH) return

    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = Math.round(baseW * CAPTURE_SCALE)
    snapCanvas.height = Math.round(baseH * CAPTURE_SCALE)
    const snapCtx = snapCanvas.getContext('2d')
    if (!snapCtx) return
    snapCtx.imageSmoothingEnabled = true
    snapCtx.imageSmoothingQuality = 'high'

    // 优先使用原始视频帧，避免直接截取低分辨率处理帧导致发糊
    if (video.value && video.value.readyState >= 2) {
      snapCtx.drawImage(video.value, 0, 0, snapCanvas.width, snapCanvas.height)
    } else if (sourceImage) {
      snapCtx.drawImage(sourceImage, 0, 0, snapCanvas.width, snapCanvas.height)
    } else {
      snapCtx.fillStyle = '#000'
      snapCtx.fillRect(0, 0, snapCanvas.width, snapCanvas.height)
    }

    snapCtx.drawImage(canvas.value, 0, 0, snapCanvas.width, snapCanvas.height)
    imageData = snapCanvas.toDataURL('image/jpeg', CAPTURE_JPEG_QUALITY)
  } catch (err) {
    console.warn('[Capture] snapshot failed:', err)
    return
  }

  if (!imageData || imageData === 'data:,') return

  const item = {
    id: `cap-${now}-${analysisResult.strokeCount}`,
    image: imageData,
    time: new Date(now).toLocaleTimeString('zh-CN', { hour12: false }),
    style: analysisResult.style,
    phase: analysisResult.phase,
    score: analysisResult.assessment?.score ?? null,
    confidence: Math.round((confidenceValue || 0) * 100),
    fps: Math.round(fpsValue || 0),
    strokeCount: analysisResult.strokeCount,
  }

  captureBuffer.value.unshift(item)
  if (captureBuffer.value.length > MAX_CAPTURE_ITEMS) {
    captureBuffer.value.length = MAX_CAPTURE_ITEMS
  }

  lastCaptureTime = now
  lastCaptureStrokeCount = analysisResult.strokeCount

  if (uploadRunning.value) {
    queueSnapshot({
      snapshotId: item.id,
      frameIndex: analysisSummary.value.frameCount,
      timestampMs: now,
      style: item.style,
      phase: item.phase,
      score: item.score,
      confidence: item.confidence,
      imageData: imageData,
      imageType: 'image/jpeg',
    })
  }
}

const formatSessionId = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}

const buildFrameMetric = (analysisResult, confidenceValue, frameIndex) => ({
  frameIndex: frameIndex,
  timestampMs: analysisResult?.timestamp || Date.now(),
  stage: analysisResult?.stage || 'INVALID',
  stageLabel: analysisResult?.stageLabel || '证据不足',
  style: analysisResult?.style || '未知',
  phase: analysisResult?.phase || '准备',
  judgeable: analysisResult?.judgeable === true,
  rejectionReason: analysisResult?.rejectionReason || '',
  qualityScore: analysisResult?.quality?.score ?? null,
  qualityLabel: analysisResult?.quality?.label || '',
  qualityReasons: Array.isArray(analysisResult?.quality?.reasons) ? analysisResult.quality.reasons : [],
  metricsEligible: analysisResult?.metricsEligible === true,
  captureEligible: analysisResult?.captureEligible === true,
  score: analysisResult?.assessment?.score ?? null,
  symmetryScore: analysisResult?.symmetry ?? null,
  strokeCount: analysisResult?.strokeCount ?? 0,
  strokeRate: analysisResult?.strokeRate ?? 0,
  confidence: Number((confidenceValue || 0).toFixed(4)),
  angles: {
    leftElbow: analysisResult?.angles?.leftElbow ?? null,
    rightElbow: analysisResult?.angles?.rightElbow ?? null,
    leftShoulder: analysisResult?.angles?.leftShoulder ?? null,
    rightShoulder: analysisResult?.angles?.rightShoulder ?? null,
    leftKnee: analysisResult?.angles?.leftKnee ?? null,
    rightKnee: analysisResult?.angles?.rightKnee ?? null,
  },
  issues: (analysisResult?.assessment?.items || [])
    .filter((item) => item?.ok === false)
    .map((item) => item.key),
})

const buildUnjudgeableFrameResult = (reason, confidenceValue = 0, overrides = {}) => ({
  ...createIdleAnalysisState(reason),
  timestamp: Date.now(),
  strokeCount: strokeCount.value,
  confidence: Number((confidenceValue || 0).toFixed(4)),
  quality: {
    ...createIdleAnalysisState(reason).quality,
    ...(overrides.quality || {}),
  },
  ...overrides,
})

const getTeamId = (item) => item?.team_id ?? item?.teamId ?? item?.id ?? ''
const getTeamName = (item) => item?.team_name ?? item?.teamName ?? item?.name ?? ''
const getAthleteId = (item) => item?.athlete_id ?? item?.athleteId ?? item?.userId ?? item?.id ?? ''
const getAthleteName = (item) =>
  item?.athlete_name ?? item?.athleteName ?? item?.nickName ?? item?.name ?? item?.userName ?? ''

const ISSUE_SUGGESTIONS = {
  armStraight: {
    title: '移臂伸直不足',
    summary: '肘部弯曲偏大，移臂效率下降',
    suggestion: '保持高肘前伸，手臂出水后尽量拉长',
    drill: '弹力带高肘前伸 3组*12次',
    targetRange: '肘角建议 >= 145°',
    evidenceLabel: '肘角',
  },
  breathTiming: {
    title: '呼吸时机不匹配',
    summary: '呼吸与动作节奏不同步，影响推进',
    suggestion: '呼吸与回臂阶段配合，避免抬头抢气',
    drill: '3次划臂1次呼吸配合 8组',
    targetRange: '回臂阶段完成转头吸气',
    evidenceLabel: '呼吸配合',
  },
  legAlternate: {
    title: '打腿交替不足',
    summary: '双腿交替节奏弱，推进连续性下降',
    suggestion: '强化髋部驱动的交替打腿',
    drill: '扶板打腿 6*25m',
    targetRange: '左右踝交替幅度达标',
    evidenceLabel: '踝部位移',
  },
  hipLevel: {
    title: '身体线型下沉',
    summary: '髋部下沉导致阻力增加',
    suggestion: '收紧核心，保持肩髋踝一条线',
    drill: '流线漂浮 + 轻打腿 6组',
    targetRange: '肩髋纵向偏差 <= 阈值',
    evidenceLabel: '肩髋偏差',
  },
  timing: {
    title: '手腿时序异常',
    summary: '手腿配合重叠或错位',
    suggestion: '拆分动作节奏后再整合全程配合',
    drill: '分解节奏练习 4组',
    targetRange: '手腿时序匹配',
    evidenceLabel: '时序差',
  },
}

const formatElapsed = (secs) => {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

const startMediaRecording = () => {
  if (!currentStream.value) return
  recordedChunks = []
  recordingElapsed.value = 0
  const mimeType = ['video/mp4', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm'
  try {
    mediaRecorder = new MediaRecorder(currentStream.value, { mimeType })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data)
    }
    mediaRecorder.start(2000)
    recordingElapsedTimer = setInterval(() => { recordingElapsed.value += 1 }, 1000)
  } catch (err) {
    console.warn('[MediaRecorder] 不支持录制:', err)
    mediaRecorder = null
  }
}

const cleanupMediaRecorder = () => {
  if (recordingElapsedTimer) {
    clearInterval(recordingElapsedTimer)
    recordingElapsedTimer = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop() } catch (_) {}
  }
  mediaRecorder = null
  recordedChunks = []
  recordingElapsed.value = 0
}

const collectAndStopMediaRecorder = () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return Promise.resolve(null)
  clearInterval(recordingElapsedTimer)
  recordingElapsedTimer = null
  recordingElapsed.value = 0
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const chunks = [...recordedChunks]
      recordedChunks = []
      mediaRecorder = null
      if (!chunks.length) { resolve(null); return }
      const mimeType = chunks[0]?.type || 'video/webm'
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType })
    }
    mediaRecorder.stop()
  })
}

const uploadAndSubmitRecording = async (blob, mimeType, navigate = false) => {
  if (!blob) return
  isUploadingRecording.value = true
  uploadProgress.value = 0
  updateBadge('', '视频上传中…')
  try {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const file = new File([blob], `swim-rec-${Date.now()}.${ext}`, { type: mimeType })
    const res = await uploadVideoFileApi(file, (p) => {
      uploadProgress.value = p
      updateBadge('', `视频上传中 ${p}%`)
    })
    const videoUrl = res?.data?.url || res?.url
    if (!videoUrl) throw new Error('未获取到视频URL')
    updateBadge('', '提交AI分析中…')
    await submitVideoAnalysisApi({
      videoUrl,
      strokeType: activeTargetSwimStyle.value || selectedSwimStyle.value || '自由泳',
      athleteId: selectedAthleteId.value || undefined,
      teamId: selectedTeamId.value || undefined,
      sessionId: uploadSessionId.value ? Number(uploadSessionId.value) : undefined,
      poolLength: recordPoolLength.value,
      trainingTarget: recordTrainingTarget.value || undefined,
      modelChoice: 'qwen-vl-plus',
      cameraType: recordCameraType.value.length ? recordCameraType.value : undefined,
      includeMarkdown: true,
    })
    updateBadge('live', navigate ? '分析已提交' : '后台分析中')
    if (navigate) router.push('/analysis')
  } catch (err) {
    console.error('[VideoRecord] 上传/提交失败:', err)
    ElMessage.error(err?.message || '视频上传或提交失败')
    updateBadge('error', '上传失败')
  } finally {
    isUploadingRecording.value = false
    uploadProgress.value = 0
  }
}

const handlePostRecordAnalyze = async (navigate) => {
  const blob = pendingVideoBlob.value
  const mimeType = pendingVideoMimeType.value
  postRecordDialog.value.visible = false
  pendingVideoBlob.value = null
  pendingVideoMimeType.value = ''
  await uploadAndSubmitRecording(blob, mimeType, navigate)
}

const handlePostRecordDiscard = () => {
  postRecordDialog.value.visible = false
  pendingVideoBlob.value = null
  pendingVideoMimeType.value = ''
  updateBadge('', '已丢弃录制')
}

const clearAutoPauseTimer = () => {
  if (autoPauseResumeTimer) {
    window.clearTimeout(autoPauseResumeTimer)
    autoPauseResumeTimer = null
  }
}

const normalizeSeverity = (severity) => {
  if (severity === 'high' || severity === 'medium') return severity
  return 'low'
}

const pickAutoPauseCandidate = (analysisResult, confidenceValue) => {
  if (!analysisResult?.autoPauseEligible) return null
  if (analysisResult?.styleSource === 'target_fallback') return null
  const score = analysisResult?.assessment?.score
  const issues = (analysisResult?.assessment?.items || []).filter((item) => item?.ok === false)
  const firstIssue = issues[0]

  if ((confidenceValue ?? 1) < 0.35) {
    return {
      ruleKey: 'pose_lost',
      triggerType: 'pose_lost',
      severity: 'medium',
      issueKey: firstIssue?.key || 'pose_lost',
      evidenceLabel: '置信度',
      evidenceValue: `${Math.round((confidenceValue || 0) * 100)}%`,
    }
  }

  if (typeof score === 'number' && score < 55) {
    return {
      ruleKey: 'score_low',
      triggerType: 'score_below_threshold',
      severity: 'high',
      issueKey: firstIssue?.key || 'score_low',
      evidenceLabel: '评分',
      evidenceValue: `${score}`,
    }
  }

  if (!firstIssue) return null

  const angleIssueSet = new Set(['armStraight', 'kneeFlex', 'hipLevel', 'bodyLine'])
  const triggerType = angleIssueSet.has(firstIssue.key) ? 'angle_out_of_range' : 'timing_mismatch'
  return {
    ruleKey: `${triggerType}:${firstIssue.key}`,
    triggerType,
    severity: triggerType === 'angle_out_of_range' ? 'medium' : 'low',
    issueKey: firstIssue.key,
    evidenceLabel: ISSUE_SUGGESTIONS[firstIssue.key]?.evidenceLabel || '问题项',
    evidenceValue: firstIssue.label || firstIssue.key,
  }
}

const snapshotFromCanvas = () => {
  if (!canvas.value) return ''
  try {
    const baseW = Math.max(video.value?.videoWidth || 0, canvas.value.width || 0)
    const baseH = Math.max(video.value?.videoHeight || 0, canvas.value.height || 0)
    if (!baseW || !baseH) return ''

    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = baseW
    snapCanvas.height = baseH
    const snapCtx = snapCanvas.getContext('2d')
    if (!snapCtx) return ''

    snapCtx.imageSmoothingEnabled = true
    snapCtx.imageSmoothingQuality = 'high'

    if (video.value && video.value.readyState >= 2) {
      snapCtx.drawImage(video.value, 0, 0, snapCanvas.width, snapCanvas.height)
    } else {
      snapCtx.fillStyle = '#000'
      snapCtx.fillRect(0, 0, snapCanvas.width, snapCanvas.height)
    }

    snapCtx.drawImage(canvas.value, 0, 0, snapCanvas.width, snapCanvas.height)
    return snapCanvas.toDataURL('image/jpeg', TEACHING_SNAPSHOT_JPEG_QUALITY)
  } catch (_) {
    return ''
  }
}

const resumeFromAutoPause = async (actionType) => {
  clearAutoPauseTimer()
  if (uploadRunning.value && autoPauseDialog.value.eventId) {
    queueCoachAction({
      actionId: `act_${Date.now()}`,
      timestampMs: Date.now(),
      eventRef: autoPauseDialog.value.eventId,
      actionType: actionType,
      actionText: actionType === 'ignore_pause' ? '忽略自动暂停' : '继续播放',
      drillAssigned: autoPauseDialog.value.drill || '',
      interactive: true,
    })
  }
  autoPauseDialog.value.visible = false
  poseEngine.resume()
  if (video.value && video.value.paused) {
    try {
      await video.value.play()
    } catch (_) {}
  }
  updateBadge('live', analysisMode.value === 'video' ? '视频分析中' : '识别中')
}

const triggerAutoPause = (candidate, analysisResult, options = {}) => {
  const interactive = options.interactive !== false
  const severity = normalizeSeverity(candidate.severity)
  const eventId = `evt_pause_${Date.now()}`
  const suggestionTpl = ISSUE_SUGGESTIONS[candidate.issueKey] || {
    title: '动作异常',
    summary: '当前动作存在明显偏差',
    suggestion: '请根据提示调整动作节奏和发力路径',
    drill: '分解动作练习 3组',
    targetRange: '保持连续稳定输出',
    evidenceLabel: '问题',
  }
  const evidenceValue = candidate.evidenceValue || '--'
  autoPauseDialog.value = {
    visible: interactive && severity !== 'low',
    eventId,
    severity,
    triggerType: candidate.triggerType,
    title: suggestionTpl.title,
    summary: suggestionTpl.summary,
    suggestion: suggestionTpl.suggestion,
    drill: suggestionTpl.drill,
    evidenceLabel: candidate.evidenceLabel || suggestionTpl.evidenceLabel,
    evidenceValue,
    targetRange: suggestionTpl.targetRange,
    snapshot: snapshotFromCanvas(),
  }
  analysisSummary.value.pauseCount += 1

  const evidenceMetric = candidate.evidenceLabel || suggestionTpl.evidenceLabel || 'metric'
  queuePauseEvent({
    eventId,
    frameIndex: analysisSummary.value.frameCount,
    timestampMs: Date.now(),
    severity,
    triggerType: candidate.triggerType,
    triggerRuleId: candidate.ruleKey,
    summary: suggestionTpl.summary,
    evidence: {
      metric: evidenceMetric,
      value: evidenceValue,
      expectedRange: [0, 1],
    },
    userAction: interactive ? 'pending' : 'saved',
    interactive,
  })

  if (interactive) {
    poseEngine.pause()
    if (video.value && !video.value.paused) {
      video.value.pause()
    }
    updateBadge('', severity === 'low' ? '短暂停纠错中' : '自动暂停纠错')
  }

  if (interactive && severity === 'low') {
    clearAutoPauseTimer()
    autoPauseResumeTimer = window.setTimeout(() => {
      void resumeFromAutoPause('auto_resume')
    }, AUTO_PAUSE_LOW_RESUME_MS)
  }

  if (analysisResult) {
    queueCoachAction({
      actionId: `act_${Date.now()}_${Math.round(Math.random() * 1000)}`,
      timestampMs: Date.now(),
      eventRef: eventId,
      actionType: interactive ? 'auto_pause_triggered' : 'auto_pause_logged',
      actionText: `${candidate.triggerType}:${candidate.issueKey || ''}`,
      drillAssigned: suggestionTpl.drill,
      interactive,
    })
  }
}

const tryAutoPause = (analysisResult, confidenceValue) => {
  if (!isRecording.value || !uploadRunning.value) return
  if (autoPauseDialog.value.visible || poseEngine.isPaused.value) return

  const candidate = pickAutoPauseCandidate(analysisResult, confidenceValue)
  if (!candidate) {
    autoPauseTracker.key = ''
    autoPauseTracker.count = 0
    return
  }

  const now = Date.now()
  if (candidate.ruleKey === autoPauseTracker.key) {
    autoPauseTracker.count += 1
  } else {
    autoPauseTracker.key = candidate.ruleKey
    autoPauseTracker.count = 1
  }

  if (autoPauseTracker.count < AUTO_PAUSE_CONSECUTIVE) return
  if (now - autoPauseTracker.lastTriggerAt < AUTO_PAUSE_COOLDOWN_MS) return

  autoPauseTracker.lastTriggerAt = now
  autoPauseTracker.count = 0
  triggerAutoPause(candidate, analysisResult, { interactive: autoPauseEnabled.value })
}

const selectedAthlete = computed(() =>
  athletes.value.find((item) => String(item._athleteId || getAthleteId(item)) === selectedAthleteId.value) || null
)

const selectedTeam = computed(() =>
  teams.value.find((item) => String(item._teamId || getTeamId(item)) === selectedTeamId.value) || null
)

const getStartRecordValidationError = () => {
  if (!selectedTeamId.value) return '请先选择队伍'
  if (!selectedAthleteId.value) return '请先选择学员'
  if (!selectedSwimStyle.value) return '请选择泳姿'
  if (!recordPoolLength.value) return '请选择泳池长度'
  if (!recordCameraType.value?.length) return '请选择机位'
  if (!recordTrainingTarget.value) return '请选择训练目标'
  return ''
}

const canStartAnalysis = computed(() => !getStartRecordValidationError() && !loadingAthletes.value)

const resetSummary = () => {
  analysisSummary.value = {
    frameCount: 0,
    scoreSum: 0,
    pauseCount: 0,
    styleScoreMap: {},
    errorCountMap: {},
  }
}

const pushSummary = (analysisResult) => {
  if (!analysisResult?.metricsEligible) return
  const summary = analysisSummary.value
  summary.frameCount += 1
  const score = analysisResult?.assessment?.score
  if (typeof score === 'number') {
    summary.scoreSum += score
    const styleKey = analysisResult.style || '未知'
    if (!summary.styleScoreMap[styleKey]) {
      summary.styleScoreMap[styleKey] = { scoreSum: 0, count: 0 }
    }
    summary.styleScoreMap[styleKey].scoreSum += score
    summary.styleScoreMap[styleKey].count += 1
  }

  const issues = (analysisResult?.assessment?.items || []).filter((item) => item?.ok === false)
  for (const issue of issues) {
    summary.errorCountMap[issue.key] = (summary.errorCountMap[issue.key] || 0) + 1
  }
}

const buildFinalReport = () => {
  const summary = analysisSummary.value
  const frameCount = summary.frameCount || 1
  const overallScore = Math.round(summary.scoreSum / frameCount) || 0
  const styleScores = {}
  Object.entries(summary.styleScoreMap).forEach(([key, value]) => {
    if (!value.count) return
    styleScores[key] = Math.round(value.scoreSum / value.count)
  })
  const topErrors = Object.entries(summary.errorCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([errorType, count]) => ({
      errorType,
      count,
      severity: count >= 6 ? 'high' : count >= 3 ? 'medium' : 'low',
    }))

  return {
    reportId: `rep_${formatSessionId(new Date())}`,
    overallScore: overallScore,
    styleScores: styleScores,
    topErrors: topErrors,
    pauseCount: summary.pauseCount,
    pauseEffectiveRate: summary.pauseCount ? Number((0.7).toFixed(2)) : 0,
    nextFocus: topErrors.map((item) => item.errorType).slice(0, 2),
    createdAt: new Date().toISOString(),
  }
}

const loadTeams = async () => {
  loadingTeams.value = true
  try {
    const list = await listTeamsApi()
    teams.value = list
      .map((item) => ({
        ...item,
        _teamId: String(getTeamId(item)),
        _teamName: getTeamName(item),
      }))
      .filter((item) => item._teamId && item._teamId !== 'undefined' && item._teamName)

    if (!selectedTeamId.value && teams.value.length > 0) {
      selectedTeamId.value = teams.value[0]._teamId
    }
  } catch (err) {
    ElMessage.error(err?.message || '队伍加载失败')
    teams.value = []
  } finally {
    loadingTeams.value = false
  }
}

const loadAthletes = async () => {
  const teamIdValue = String(selectedTeamId.value || '').trim()
  if (!teamIdValue || teamIdValue === 'undefined' || teamIdValue === 'null') {
    athletes.value = []
    selectedAthleteId.value = ''
    return
  }
  loadingAthletes.value = true
  try {
    const list = await listAthletesApi({
      teamId: teamIdValue,
      keyword: athleteKeyword.value.trim(),
    })
    athletes.value = list
      .map((item) => ({
        ...item,
        _athleteId: String(getAthleteId(item)),
        _athleteName: getAthleteName(item),
      }))
      .filter((item) => item._athleteId && item._athleteId !== 'undefined' && item._athleteName)
    if (!athletes.value.find((item) => item._athleteId === selectedAthleteId.value)) {
      selectedAthleteId.value = athletes.value.length ? athletes.value[0]._athleteId : ''
    }
  } catch (err) {
    ElMessage.error(err?.message || '学员加载失败')
    athletes.value = []
    selectedAthleteId.value = ''
  } finally {
    loadingAthletes.value = false
  }
}

const startUploadSession = async (strokeTarget = selectedSwimStyle.value) => {
  const validationError = getStartRecordValidationError()
  if (validationError) throw new Error(validationError)
  const payload = {
    teamId: selectedTeamId.value,
    athleteId: selectedAthleteId.value,
    coachId: authStore.loginForm.value?.username || 'coach',
    sourceType: analysisMode.value,
    strokeTarget,
    ruleVersion: 'rule_v1.2.0',
    modelVersion: 'mediapipe_pose_web',
    startedAt: new Date().toISOString(),
  }
  await startSession(payload)
}

const beginRecordingSession = async () => {
  const validationError = getStartRecordValidationError()
  if (validationError) throw new Error(validationError)
  const styleForSession = selectedSwimStyle.value
  if (!uploadRunning.value) {
    await startUploadSession(styleForSession)
  }
  if (!isRecording.value) {
    recordingSwimStyle.value = styleForSession
    toggleRecording()
    resetCaptureBuffer()
    if (analysisMode.value === 'camera' && video.value) {
      // 骨骼数据收集已关闭
      // poseEngine.startLoop(video.value)
      startMediaRecording()
    }
  }
}

const completeUploadSession = async () => {
  if (!uploadRunning.value) return
  const report = buildFinalReport()
  await completeSession({
    analysisReport: report,
    keyFrames: captureBuffer.value.slice(0, 8).map((item, index) => ({
      rank: index + 1,
      time: item.time,
      style: item.style,
      phase: item.phase,
      score: item.score,
    })),
    endedAt: new Date().toISOString(),
  })
  await flush().catch(() => {})
  resetSummary()
  updateBadge('live', '记录已上报')
}

watch(selectedTeamId, () => {
  void loadAthletes()
})

const dataURLToBlob = async (dataURL) => {
  const response = await fetch(dataURL)
  return response.blob()
}

const saveCaptureListToLocal = async () => {
  if (!captureList.value.length) return
  if (!window.showDirectoryPicker) return

  try {
    if (!captureRootHandle.value) {
      captureRootHandle.value = await window.showDirectoryPicker({ mode: 'readwrite' })
    }

    const sessionId = captureSessionId.value || formatSessionId(new Date())
    const sessionDir = await captureRootHandle.value.getDirectoryHandle(`capture-${sessionId}`, {
      create: true,
    })

    for (let index = 0; index < captureList.value.length; index++) {
      const item = captureList.value[index]
      const fileName = `${String(index + 1).padStart(3, '0')}-${item.style}-${item.phase}.jpg`
      const fileHandle = await sessionDir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      const blob = await dataURLToBlob(item.image)
      await writable.write(blob)
      await writable.close()
    }

    const metaHandle = await sessionDir.getFileHandle('metadata.json', { create: true })
    const metaWritable = await metaHandle.createWritable()
    await metaWritable.write(JSON.stringify(captureList.value, null, 2))
    await metaWritable.close()
  } catch (err) {
    console.warn('[Capture] save local failed:', err)
  }
}

const isRecognitionRunning = () => isRecording.value

const handleVideoEnded = () => {
  if (analysisMode.value !== 'video') return

  poseEngine.stopLoop()
  updateBadge('', '视频已结束')

  if (isRecording.value) {
    toggleRecording()
    void completeUploadSession().catch((err) => {
      updateBadge('error', '上报失败')
      loadingText.value = err?.message || '结束上报失败'
    })
  }
  void finalizeCaptureList()
}

// ============ Methods ============
const updateBadge = (state, label) => {
  badgeState.value = state
  badgeLabel.value = label
}

const handleNoPerson = () => {
  if (personDetected.value) {
    personDetected.value = false
    updateBadge('', '等待入镜')
  }
  clearTimeout(noPersonTimer)
  noPersonTimer = setTimeout(() => {
    noPersonHintVisible.value = true
  }, 1500)
}

const handlePersonDetected = () => {
  if (!personDetected.value) {
    personDetected.value = true
    updateBadge('live', '已检测到游泳者')
  }
  clearTimeout(noPersonTimer)
  noPersonHintVisible.value = false
}

const calcAvgConfidence = (landmarks) => {
  const visible = landmarks.filter(lm => lm && lm.visibility > 0)
  if (!visible.length) return 0
  return visible.reduce((s, lm) => s + lm.visibility, 0) / visible.length
}

const isValidPersonPose = (landmarks) => {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return false

  const coreIndexes = [11, 12, 23, 24]
  const coreReady = coreIndexes.every((idx) => (landmarks[idx]?.visibility ?? 0) > 0.4)
  if (!coreReady) return false

  const avg = calcAvgConfidence(landmarks)
  return avg >= 0.35
}

const resizeCanvas = () => {
  if (!canvas.value || !video.value) return
  const vw = video.value.videoWidth || window.innerWidth
  const vh = video.value.videoHeight || window.innerHeight
  canvas.value.width = vw
  canvas.value.height = vh
}

const startCamera = async (facing) => {
  try {
    const wasVideoMode = analysisMode.value === 'video'
    analysisMode.value = 'camera'

    if (currentVideoURL.value) {
      URL.revokeObjectURL(currentVideoURL.value)
      currentVideoURL.value = ''
    }

    if (video.value) {
      video.value.pause()
      video.value.removeAttribute('src')
      video.value.load()
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('浏览器不支持相机 API')
    }

    if (!window.isSecureContext) {
      throw new Error('请使用 HTTPS 或 localhost 访问，才能调用相机')
    }

    if (currentStream.value) {
      currentStream.value.getTracks().forEach(t => t.stop())
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

    // iOS/Safari 对约束支持不稳定，按“从严格到宽松”逐级降级
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
              width: { ideal: 1920 },
              height: { ideal: 1080 },
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
        console.log('[Camera] Trying constraints:', JSON.stringify(constraints))
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (err) {
        lastError = err
      }
    }

    if (!stream) {
      throw lastError || new Error('未能获取相机流')
    }

    // 先设置属性再挂流，提升 iOS 成功率
    video.value.muted = true
    video.value.setAttribute('muted', 'true')
    video.value.playsInline = true
    video.value.setAttribute('playsinline', 'true')
    video.value.setAttribute('webkit-playsinline', 'true')

    currentStream.value = stream
    video.value.srcObject = currentStream.value

    await new Promise((resolve, reject) => {
      let done = false
      const timeout = setTimeout(() => {
        if (!done) reject(new Error('视频加载超时'))
      }, 10000)

      video.value.onloadedmetadata = () => {
        video.value.play().then(() => {
          done = true
          clearTimeout(timeout)
          resolve()
        }).catch(reject)
      }
      video.value.onerror = reject
    })

    videoActive.value = true
    resizeCanvas()
    scanLineActive.value = false

    if (wasVideoMode && isRecording.value) {
      toggleRecording()
      cleanupMediaRecorder()
      void completeUploadSession().catch(() => {})
      void finalizeCaptureList()
    }

    // 骨骼数据收集已关闭
    // if (isRecognitionRunning()) {
    //   updateBadge('live', '识别中')
    //   poseEngine.startLoop(video.value)
    // } else {
    updateBadge('', '待开始录制')
    //   poseEngine.stopLoop()
    // }

    // 请求屏幕常亮（移动端训练时不熄屏）
    requestWakeLock()
  } catch (err) {
    console.error('[Camera Error]', err?.name, err?.message, err)

    let errorMsg = '相机启动失败'

    if (err.message && err.message.includes('HTTPS')) {
      errorMsg = '请使用 HTTPS 打开页面（iPhone 必须）'
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorMsg = deviceType.value === 'ios'
        ? '请在 iPhone 设置 > Safari > 相机 里允许访问，并刷新页面'
        : '请允许相机权限后刷新页面'
    } else if (err.name === 'NotFoundError') {
      errorMsg = '未找到相机设备'
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      errorMsg = '相机被占用，请关闭其他相机应用后重试'
    } else if (err.name === 'OverconstrainedError') {
      errorMsg = '当前相机参数不支持，已建议改用默认相机'
    } else if (err.message && err.message.includes('超时')) {
      errorMsg = '相机启动超时，请刷新重试'
    }

    updateBadge('error', '相机错误')
    loadingText.value = errorMsg
    loadingProgress.value = 0
  }
}

const finishLoading = () => {
  loadingProgress.value = 100
  loadingText.value = '模型加载完成，相机启动中…'
  setTimeout(() => {
    isLoading.value = false
  }, 600)
}

const toggleSettings = () => {
  const nextOpenState = !isSettingsOpen.value
  isSettingsOpen.value = nextOpenState
  if (nextOpenState) {
    isCaptureListCollapsed.value = true
  }
}

const applySettings = async (newSettings) => {
  settings.value = { ...newSettings }
  isCaptureListCollapsed.value = true
  
  setSkeletonConfig({
    lineWidth: settings.value.lineWidth,
    showLabels: settings.value.showLabels,
    upperOnly: settings.value.upperOnly,
    lineColor: settings.value.lineColor || null,
  })

  const prevComplexity = poseEngine._complexity.value
  if (settings.value.complexity !== prevComplexity) {
    isLoading.value = true
    loadingProgress.value = 30
    loadingText.value = '切换模型精度，重新加载中…'
    poseEngine.stopLoop()
    await poseEngine.reinit({
      modelComplexity: settings.value.complexity,
      minDetectionConfidence: settings.value.detectConf,
      minTrackingConfidence: settings.value.trackConf,
    })
    poseEngine._complexity.value = settings.value.complexity
    if (isRecognitionRunning()) {
      poseEngine.startLoop(video.value)
    }
    finishLoading()
  } else {
    poseEngine.updateOptions({
      minDetectionConfidence: settings.value.detectConf,
      minTrackingConfidence: settings.value.trackConf,
    })
  }
  isSettingsOpen.value = false
}

const handleApplyHighAccuracy = async () => {
  await applySettings({
    ...settings.value,
    ...HIGH_ACCURACY_PRESET,
  })
}

const handleExport = () => {
  if (!uploadRunning.value) {
    updateBadge('error', '无会话')
    loadingText.value = '当前没有进行中的分析会话'
    return
  }
  void flush()
    .then(() => {
      updateBadge('live', '上报成功')
    })
    .catch((err) => {
      updateBadge('error', '上报失败')
      loadingText.value = err?.message || '数据上报失败'
    })
}

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    cleanupMediaRecorder()
    if (uploadRunning.value) {
      abortSession()
    }
    poseEngine.stopLoop()
    stopCameraStream()
    clearImportedVideo()
    clearPlaybackDisplay()
    await authStore.logoutWithApi()
    router.replace('/login')
  } catch {
    // 用户取消，不做任何操作
  }
}

const openVideoImporter = () => {
  if (videoFileInput.value) {
    videoFileInput.value.value = ''
    videoFileInput.value.click()
  }
}

const stopCameraStream = () => {
  if (currentStream.value) {
    currentStream.value.getTracks().forEach(t => t.stop())
    currentStream.value = null
  }
}

const switchToVideoMode = async (file) => {
  if (!file || !video.value) return

  try {
    if (isRecording.value) {
      toggleRecording()
      void completeUploadSession().catch(() => {})
      await finalizeCaptureList()
    }

    poseEngine.stopLoop()
    stopCameraStream()

    if (currentVideoURL.value) {
      URL.revokeObjectURL(currentVideoURL.value)
      currentVideoURL.value = ''
    }

    const objectURL = URL.createObjectURL(file)
    currentVideoURL.value = objectURL
    analysisMode.value = 'video'

    video.value.muted = true
    video.value.setAttribute('muted', 'true')
    video.value.playsInline = true
    video.value.setAttribute('playsinline', 'true')
    video.value.setAttribute('webkit-playsinline', 'true')
    video.value.loop = false
    video.value.srcObject = null
    video.value.src = objectURL

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('视频加载超时')), 10000)
      video.value.onloadedmetadata = () => {
        clearTimeout(timeout)
        resolve()
      }
      video.value.onerror = reject
    })

    await video.value.play()

    videoActive.value = true
    resizeCanvas()
    updateBadge('live', '视频分析中')
    noPersonHintVisible.value = false
    scanLineActive.value = false

    reset()
    resetCaptureBuffer()
    resetSummary()
    // 骨骼数据收集已关闭
    // poseEngine.startLoop(video.value)

    try {
      await beginRecordingSession()
      updateBadge('live', '视频分析中')
    } catch (err) {
      ElMessage.warning(err?.message || '请先选择队伍和学员')
      updateBadge('', '视频已加载，等待开始录制')
    }
  } catch (err) {
    console.error('[Video Import Error]', err)
    updateBadge('error', '视频导入失败')
    loadingText.value = '视频导入失败，请更换文件重试'
  }
}

const handleVideoImport = async (event) => {
  const file = event?.target?.files?.[0]
  if (!file) return

  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name)
  if (!isVideo) {
    updateBadge('error', '文件格式错误')
    loadingText.value = '请选择视频文件（mp4/mov/webm）'
    return
  }

  await switchToVideoMode(file)
}

const handleReset = () => {
  reset()
  recordingSwimStyle.value = ''
  currentAnalysis.value = createIdleAnalysisState('已重置，等待有效游泳动作')
  // 震动反馈
  vibrate([50, 30, 50])
}

const recordBtnText = computed(() => (isRecording.value ? '停止录制' : '开始录制'))

const handleRecord = async () => {
  if (!isRecording.value) {
    const validationError = getStartRecordValidationError()
    if (validationError) {
      ElMessage.warning(validationError)
      return
    }
  }

  if (!isRecording.value && !canStartAnalysis.value) {
    ElMessage.warning('参数不完整，请检查队伍、学员、泳姿选择')
    return
  }

  if (!isRecording.value) {
    clearAutoPauseTimer()
    autoPauseDialog.value.visible = false
    autoPauseTracker.key = ''
    autoPauseTracker.count = 0
    try {
      await beginRecordingSession()
      resetSummary()
    } catch (err) {
      ElMessage.error(err?.message || '创建会话失败')
      updateBadge('error', '会话创建失败')
      return
    }
    updateBadge('live', analysisMode.value === 'video' ? '视频分析中' : '识别中')
    vibrate([20, 40, 20])
  } else {
    const wasCamera = analysisMode.value === 'camera'
    toggleRecording()
    recordingSwimStyle.value = ''
    if (wasCamera) {
      poseEngine.stopLoop()
      updateBadge('', '处理录制中…')
      collectAndStopMediaRecorder().then((result) => {
        if (result) {
          pendingVideoBlob.value = result.blob
          pendingVideoMimeType.value = result.mimeType
          postRecordDialog.value.visible = true
        } else {
          updateBadge('', '录制内容为空')
        }
      })
    } else {
      updateBadge('', '已停止分析')
    }
    void completeUploadSession().catch((err) => {
      updateBadge('error', '结束上报失败')
      loadingText.value = err?.message || '结束上报失败'
    })
    void finalizeCaptureList()
    vibrate(20)
  }
}

const toggleCamera = () => {
  if (analysisMode.value === 'video') {
    startCamera(facingMode.value)
    vibrate(30)
    return
  }

  if (isRecording.value) {
    cleanupMediaRecorder()
  }
  facingMode.value = facingMode.value === 'environment' ? 'user' : 'environment'
  poseEngine.stopLoop()
  startCamera(facingMode.value)
  vibrate(30)
}

const pauseBtnText = ref('暂停')

const togglePause = () => {
  if (autoPauseDialog.value.visible) return
  const paused = poseEngine.togglePause()
  pauseBtnText.value = paused ? '继续' : '暂停'
  updateBadge(paused ? '' : 'live', paused ? '已暂停' : '识别中')
  if (uploadRunning.value) {
    if (paused) {
      analysisSummary.value.pauseCount += 1
      queuePauseEvent({
        eventId: `evt_pause_${Date.now()}`,
        frameIndex: analysisSummary.value.frameCount,
        timestampMs: Date.now(),
        severity: 'low',
        triggerType: 'manual_pause',
        triggerRuleId: 'manual_pause',
        summary: '教练手动暂停',
        evidence: { metric: 'manual', value: 1, expectedRange: [0, 1] },
        userAction: 'saved',
        interactive: true,
      })
    }
    queueCoachAction({
      actionId: `act_${Date.now()}`,
      timestampMs: Date.now(),
      actionType: paused ? 'manual_pause' : 'manual_resume',
      actionText: paused ? '手动暂停' : '手动继续',
      drillAssigned: '',
      interactive: true,
    })
  }
  vibrate(20)
}

const handleAutoPauseContinue = () => {
  void resumeFromAutoPause('resume_after_pause')
}

const handleAutoPauseIgnore = () => {
  void resumeFromAutoPause('ignore_pause')
}

const updateViewportLayoutState = () => {
  if (typeof window === 'undefined') return
  const nextCompactLandscape = window.innerWidth > window.innerHeight
  isCompactLandscapeViewport.value = nextCompactLandscape
  if (!nextCompactLandscape) {
    isBottomPanelCollapsed.value = false
  }
}

const handleViewportResize = () => {
  resizeCanvas()
  updateViewportLayoutState()
}

const bootRecognitionApp = () => {
  if (appBooted.value) return
  appBooted.value = true

  if (canvas.value) {
    ctx = canvas.value.getContext('2d')
  }

  const loadInterval = setInterval(() => {
    if (loadingProgress.value < 85) {
      loadingProgress.value += Math.random() * 12
    }
  }, 300)

  let prevStrokeCount = 0
  poseEngine.init({
    onReady: () => {
      startCamera(facingMode.value)
      clearInterval(loadInterval)
      finishLoading()
    },
    onResults: ({ landmarks, image, fps: fpsValue }) => {
      if (!ctx || !canvas.value) return
      ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)

      const personValid = landmarks && isValidPersonPose(landmarks)
      if (!personValid) {
        const confidenceNow = Array.isArray(landmarks) ? calcAvgConfidence(landmarks) : 0
        const insufficientResult = buildUnjudgeableFrameResult('未检测到稳定人体骨骼', confidenceNow, {
          quality: {
            judgeable: false,
            score: 0,
            label: '低',
            reasons: ['未检测到稳定人体骨骼'],
            warnings: [],
            cameraProfile: settings.value.cameraProfile,
            cameraProfileLabel: cameraProfileOptions.find((item) => item.value === settings.value.cameraProfile)?.label || '池边侧拍',
            metrics: {
              visibleCount: Array.isArray(landmarks) ? landmarks.filter((point) => point && (point.visibility ?? 0) > 0.28).length : 0,
              avgConfidence: Number((confidenceNow || 0).toFixed(4)),
              bodyHeight: 0,
              edgeMargin: 0,
              frameWidth: video.value?.videoWidth || canvas.value.width || 0,
              frameHeight: video.value?.videoHeight || canvas.value.height || 0,
            },
          },
        })
        handleNoPerson()
        setUnknownDetection()
        currentAnalysis.value = insufficientResult
        currentAssessment.value = insufficientResult.assessment
        jointAngles.value = {
          leftElbow: null,
          rightElbow: null,
          leftShoulder: null,
          rightShoulder: null,
        }
        pendingJointAngles.value = {
          leftElbow: null,
          rightElbow: null,
          leftShoulder: null,
          rightShoulder: null,
        }
        pendingFps.value = fpsValue
        pendingConfidence.value = confidenceNow
        avgConfidence.value = confidenceNow
        if (isRecording.value) {
          tryCaptureFrame(insufficientResult, fpsValue, confidenceNow, image)
          if (uploadRunning.value) {
            const frameMetric = buildFrameMetric(insufficientResult, confidenceNow, analysisSummary.value.frameCount + 1)
            queueFrameMetric(frameMetric)
          }
        }
        return
      }

      handlePersonDetected()
      // 实时骨骼绘制已关闭（开始录制后不再需要）
      // draw(ctx, landmarks, canvas.value.width, canvas.value.height)
      const angles = getJointAngles(landmarks)
      const targetSwimStyle = activeTargetSwimStyle.value
      const analysisResult = analyze(landmarks, angles, {
        targetStyle: targetSwimStyle,
        cameraProfile: settings.value.cameraProfile,
        frameWidth: video.value?.videoWidth || canvas.value.width || 0,
        frameHeight: video.value?.videoHeight || canvas.value.height || 0,
      })
      currentAnalysis.value = analysisResult
      currentAssessment.value = analysisResult?.assessment || { score: null, items: [] }

      if (strokeCount.value > prevStrokeCount) {
        vibrate(40)
        prevStrokeCount = strokeCount.value
      }

      pendingFps.value = fpsValue
      const confidenceNow = calcAvgConfidence(landmarks)
      pendingJointAngles.value = {
        leftElbow: angles.leftElbow ?? null,
        rightElbow: angles.rightElbow ?? null,
        leftShoulder: angles.leftShoulder ?? null,
        rightShoulder: angles.rightShoulder ?? null,
      }
      pendingConfidence.value = confidenceNow

      if (isRecording.value) {
        if (analysisResult?.metricsEligible) {
          pushSummary(analysisResult)
        }
        tryCaptureFrame(analysisResult, fpsValue, confidenceNow, image)
        if (uploadRunning.value) {
          const frameMetric = buildFrameMetric(
            analysisResult,
            confidenceNow,
            analysisResult?.metricsEligible ? analysisSummary.value.frameCount : analysisSummary.value.frameCount + 1,
          )
          queueFrameMetric(frameMetric)
        }
      }
      tryAutoPause(analysisResult, confidenceNow)
      throttledUIUpdate()
    },
    onError: (err) => {
      console.error('[PoseEngine]', err)
      updateBadge('error', '引擎错误')
    },
  })

  window.addEventListener('resize', handleViewportResize)
}

// ============ Lifecycle ============
onMounted(() => {
  updateViewportLayoutState()
  void loadTeams().then(() => loadAthletes())
  bootRecognitionApp()
  // fetch dynamic options with fallback
  try {
    listTrainingTargetsApi().then((rows) => {
      const labels = (Array.isArray(rows) ? rows : [])
        .map((item) => item?.targetName || item?.trainingTarget || item?.name || item?.label)
        .filter(Boolean)
      trainingTargetOptions.value = labels
    }).catch(() => { trainingTargetOptions.value = [...DEFAULT_TRAINING_TARGET_OPTIONS] })
  } catch {}
  try {
    listPoolLengthsApi().then((rows) => {
      const values = (Array.isArray(rows) ? rows : [])
        .map((item) => Number(item?.dictValue ?? item?.dict_value ?? item?.value ?? item?.poolLength))
        .filter((v) => Number.isFinite(v) && v > 0)
      poolLengthOptions.value = values.length
        ? values.map((v) => ({ label: `${v}米`, value: v }))
        : []
    }).catch(() => { poolLengthOptions.value = [...DEFAULT_POOL_LENGTH_OPTIONS] })
  } catch {}
  try {
    listCameraTypesApi().then((rows) => {
      const options = (Array.isArray(rows) ? rows : [])
        .map((item) => {
          const value = item?.cameraName || item?.camera_code || item?.cameraCode
          if (!value) return null
          return { label: value, value }
        })
        .filter(Boolean)
      cameraTypeOptions.value = options
    }).catch(() => { cameraTypeOptions.value = [...DEFAULT_CAMERA_TYPE_OPTIONS] })
  } catch {}
})

onUnmounted(() => {
  clearAutoPauseTimer()
  if (uploadRunning.value) {
    abortSession()
  }
  stopCameraStream()

  if (currentVideoURL.value) {
    URL.revokeObjectURL(currentVideoURL.value)
    currentVideoURL.value = ''
  }

  poseEngine.stopLoop()
  window.removeEventListener('resize', handleViewportResize)
  clearTimeout(noPersonTimer)
})

// ============ Computed ============
const angleBars = computed(() => ({
  leftElbow: jointAngles.value.leftElbow ? Math.min(100, (jointAngles.value.leftElbow / 180) * 100) : 0,
  rightElbow: jointAngles.value.rightElbow ? Math.min(100, (jointAngles.value.rightElbow / 180) * 100) : 0,
  leftShoulder: jointAngles.value.leftShoulder ? Math.min(100, (jointAngles.value.leftShoulder / 180) * 100) : 0,
  rightShoulder: jointAngles.value.rightShoulder ? Math.min(100, (jointAngles.value.rightShoulder / 180) * 100) : 0,
}))

const confidencePercent = computed(() => Math.round(avgConfidence.value * 100) + '%')
const showCaptureList = computed(() => !isRecording.value && captureList.value.length > 0 && !isSettingsOpen.value)
const shiftVideoForCaptureList = computed(() => showCaptureList.value && !isCaptureListCollapsed.value)
const coachContextToggleText = computed(() => (isCoachContextCollapsed.value ? '展开' : '收起'))
const capturePreviewImages = computed(() => captureList.value.map((item) => item.image).filter(Boolean))
const getCapturePreviewIndex = (id) => {
  const index = captureList.value.findIndex((item) => item.id === id)
  return index < 0 ? 0 : index
}
const isTechniquePanelCollapsed = ref(true)
const techniqueToggleText = computed(() => (isTechniquePanelCollapsed.value ? '展开' : '收起'))

const toggleCoachContextPanel = () => {
  const nextCollapsed = !isCoachContextCollapsed.value
  isCoachContextCollapsed.value = nextCollapsed
  if (!nextCollapsed) {
    isTechniquePanelCollapsed.value = true
  }
}

const toggleTechniquePanel = () => {
  const nextCollapsed = !isTechniquePanelCollapsed.value
  isTechniquePanelCollapsed.value = nextCollapsed
  if (!nextCollapsed) {
    isCoachContextCollapsed.value = true
  }
}
const currentStage = computed(() => currentAnalysis.value?.stage || 'INVALID')
const displayScoreText = computed(() => (
  currentStage.value === 'SWIM_ACTIVE' && typeof currentAssessment.value?.score === 'number'
    ? `${currentAssessment.value.score}分`
    : '待判定'
))
const displayStrokeLabel = computed(() => (
  currentStage.value === 'SWIM_ACTIVE' ? '识别结果' : '当前状态'
))
const displayStrokeText = computed(() => (
  currentStage.value === 'SWIM_ACTIVE'
    ? detectedStroke.value || '—'
    : currentAnalysis.value?.stageLabel || '待判定'
))
const currentStageLabel = computed(() => currentAnalysis.value?.stageLabel || '证据不足')
const qualityScoreLabel = computed(() => {
  const quality = currentAnalysis.value?.quality
  if (!quality) return '待判定'
  if (quality.score == null) return quality.label || '待判定'
  return `${quality.label} (${quality.score})`
})
const qualityReasonText = computed(() => {
  const analysis = currentAnalysis.value
  const messages = []
  if (!analysis?.judgeable) {
    messages.push(analysis?.rejectionReason || analysis?.quality?.reasons?.[0] || '等待有效游泳动作')
  } else {
    const warnings = analysis?.quality?.warnings || []
    if (warnings[0]) {
      messages.push(warnings[0])
    }
  }
  if (analysis?.judgeable && analysis?.styleSource === 'target_fallback') {
    messages.push(`当前帧泳姿识别未稳定，暂按目标泳姿“${activeTargetSwimStyle.value}”做辅助评分`)
  }
  if (!messages.length) {
    messages.push('当前帧满足判定条件')
  }
  return messages.join('；')
})
const cameraProfileLabel = computed(
  () => cameraProfileOptions.find((item) => item.value === settings.value.cameraProfile)?.label || '池边侧拍'
)
const styleSourceLabel = computed(() => {
  const source = currentAnalysis.value?.styleSource
  if (source === 'detected') return '检测泳姿'
  if (source === 'target_fallback') return '目标泳姿回退'
  return '待判定'
})
const panelTitle = computed(() => {
  if (currentStage.value === 'PREP') return '预备姿势标准'
  if (currentStage.value === 'START') return '起跳阶段提示'
  if (currentStage.value === 'UNDERWATER') return '水下阶段提示'
  if (currentStage.value === 'TRANSITION') return '过渡动作提示'
  if (currentStage.value === 'TURN') return '转身阶段提示'
  if (currentStage.value === 'FINISH') return '结束阶段提示'
  if (currentStage.value === 'INVALID') return '证据不足'
  return `${activeTargetSwimStyle.value}动作标准`
})
const techniquePanelItems = computed(() => {
  const template =
    currentStage.value === 'PREP'
      ? styleStandardTemplates['准备姿势']
      : currentStage.value === 'START'
        ? styleStandardTemplates['起跳阶段']
      : currentStage.value === 'UNDERWATER'
        ? styleStandardTemplates['水下阶段']
      : currentStage.value === 'TRANSITION'
        ? styleStandardTemplates['过渡动作']
      : currentStage.value === 'TURN'
        ? styleStandardTemplates['转身阶段']
      : currentStage.value === 'FINISH'
        ? styleStandardTemplates['结束阶段']
      : currentStage.value === 'INVALID'
        ? styleStandardTemplates['证据不足']
        : styleStandardTemplates[activeTargetSwimStyle.value] || freestyleStandardTemplate
  const itemMap = new Map((currentAssessment.value?.items || []).map((item) => [item.key, item]))
  return template.map((base) => {
    const matched = itemMap.get(base.key)
    return {
      key: base.key,
      label: base.label,
      ok: matched?.ok ?? null,
      detail: matched?.detail || '等待识别',
    }
  })
})
const uploadStatusText = computed(() => {
  if (!uploadRunning.value) return '未开始会话'
  if (uploading.value) return '上报中...'
  return `会话中 · 待上传 ${pendingCount.value}`
})
const selectedAthleteName = computed(
  () => selectedAthlete.value?._athleteName || getAthleteName(selectedAthlete.value) || '未选择学员'
)
const selectedTeamName = computed(
  () => selectedTeam.value?._teamName || getTeamName(selectedTeam.value) || '未选择队伍'
)

</script>

<template>
  <div
    id="app"
    :class="{
      'compact-landscape-layout': isCompactLandscapeViewport,
      'compact-landscape-bottom-collapsed': isCompactLandscapeViewport && isBottomPanelCollapsed,
    }"
  >
    <!-- 视频 + 骨骼画布区域 -->
    <div
      class="video-wrapper"
      :class="{
        'bottom-panel-collapsed-landscape': isCompactLandscapeViewport && isBottomPanelCollapsed,
      }"
    >
      <video
        ref="video"
        id="video"
        autoplay
        muted
        playsinline
        :class="{ active: videoActive }"
        @ended="handleVideoEnded"
      ></video>
      <canvas ref="canvas" id="output-canvas"></canvas>

      <!-- 扫描线动画 -->
      <div class="scan-line" :class="{ active: scanLineActive }"></div>

      <div class="video-overlay video-overlay-right">
        <!-- 右上角徽章 -->
        <div class="corner-badge">
          <span class="badge-dot" :class="badgeState"></span>
          <span>{{ badgeLabel }}</span>
        </div>

        <!-- 录制计时徽章 -->
        <div v-if="isRecording && analysisMode === 'camera'" class="recording-timer-badge">
          <span class="rec-blink-dot"></span>
          <span>REC {{ formatElapsed(recordingElapsed) }}</span>
        </div>

      </div>

      <!-- 无人提示 -->
      <div class="no-person-hint" :class="{ show: noPersonHintVisible }">
        <div class="hint-icon">🏊</div>
        <p>请将相机对准游泳者</p>
      </div>

      <!-- 视频上传遗罩 -->
      <div v-if="isUploadingRecording" class="upload-recording-overlay">
        <div class="upload-recording-content">
          <div class="upload-recording-spinner"></div>
          <span>{{ uploadProgress > 0 ? `上传中 ${uploadProgress}%` : '处理视频中…' }}</span>
          <span class="upload-recording-sub">正在拼接并提交AI分析，请稍候</span>
        </div>
      </div>

      <!-- 网络离线提示 -->
      <div v-if="!isOnline" class="offline-hint">
        <div class="hint-icon">📴</div>
        <p>网络已断开，部分功能可能受限</p>
      </div>

      <!-- 水波纹背景 -->
      <div class="water-bg"></div>

      <!-- 右侧悬浮操作按钮（居中于摄像区域） -->
      <div class="bp-floating-actions">
        <button class="action-btn record" @click="handleRecord">{{ recordBtnText }}</button>
        <button class="action-btn primary" @click="toggleCamera">翻转摄像头</button>
        <button class="action-btn" @click="togglePause">{{ pauseBtnText }}</button>
        <span v-if="strokeCount" class="stroke-count-badge">{{ strokeCount }}</span>
      </div>
    </div>

    <!-- 顶部栏 -->
    <TopBar
      @settings="toggleSettings"
      @export="handleExport"
      @import-video="openVideoImporter"
      @logout="handleLogout"
      @quick-add="openQuickAdd"
    />

    <!-- 停止录制后确认弹框 -->
    <div v-if="postRecordDialog.visible" class="post-record-mask">
      <div class="post-record-dialog">
        <div class="prd-icon">🎬</div>
        <div class="prd-title">录制已完成</div>
        <div class="prd-desc">是否提交 AI 分析？</div>
        <div class="prd-actions">
          <button
            class="prd-btn prd-bg"
            :disabled="isUploadingRecording"
            @click="handlePostRecordAnalyze(false)"
          >
            <span v-if="isUploadingRecording" class="prd-spinner"></span>
            <span>{{ isUploadingRecording ? (uploadProgress > 0 ? `上传中 ${uploadProgress}%` : '处理中…') : '后台分析' }}</span>
            <br><small>不跳转，继续录制</small>
          </button>
          <button
            class="prd-btn prd-nav"
            :disabled="isUploadingRecording"
            @click="handlePostRecordAnalyze(true)"
          >
            <span v-if="isUploadingRecording" class="prd-spinner"></span>
            <span>{{ isUploadingRecording ? (uploadProgress > 0 ? `上传中 ${uploadProgress}%` : '处理中…') : '分析并查看' }}</span>
            <br><small>提交后跳转结果页</small>
          </button>
          <button
            class="prd-btn prd-discard"
            :disabled="isUploadingRecording"
            @click="handlePostRecordDiscard"
          >不分析<br><small>丢弃本段录制</small></button>
        </div>
      </div>
    </div>

    <!-- 底部数据面板 -->
    <BottomPanel
      :stroke-count="strokeCount"
      :pause-btn-text="pauseBtnText"
      :record-btn-text="recordBtnText"
      :selected-swim-style="selectedSwimStyle"
      :swim-style-options="swimStyleOptions"
      :analysis-mode="analysisMode"
      :is-recording="isRecording"
      :pool-length="recordPoolLength"
      :training-target="recordTrainingTarget"
      :camera-type="recordCameraType"
      :pool-length-options="poolLengthOptions"
      :training-target-options="trainingTargetOptions"
      :camera-type-options="cameraTypeOptions"
      :teams="teams"
      :athletes="athletes"
      :selected-team-id="selectedTeamId"
      :selected-athlete-id="selectedAthleteId"
      :loading-teams="loadingTeams"
      :loading-athletes="loadingAthletes"
      :collapsible="isCompactLandscapeViewport"
      :collapsed="isCompactLandscapeViewport && isBottomPanelCollapsed"
      @record="handleRecord"
      @camera="toggleCamera"
      @pause="togglePause"
      @select-style="selectedSwimStyle = $event"
      @toggle-collapse="isBottomPanelCollapsed = !isBottomPanelCollapsed"
      @update:poolLength="recordPoolLength = $event"
      @update:trainingTarget="recordTrainingTarget = $event"
      @update:cameraType="recordCameraType = $event"
      @update:teamId="selectedTeamId = $event; loadAthletes()"
      @update:athleteId="selectedAthleteId = $event"
    />

    <!-- 设置抽屉 -->
    <SettingsDrawer
      :is-open="isSettingsOpen"
      :settings="settings"
      @close="isSettingsOpen = false"
      @apply="applySettings"
      @apply-high-accuracy="handleApplyHighAccuracy"
      @update-skeleton="setSkeletonConfig"
    />

    <ElDialog
      v-model="quickAddVisible"
      title="新增队伍 / 学员"
      width="460px"
      class="quick-add-dialog"
      :close-on-click-modal="false"
    >
      <ElTabs v-model="quickAddTab" stretch>
        <ElTabPane label="新增队伍" name="team">
          <div class="quick-add-form-row">
            <label>队伍名称</label>
            <ElInput v-model="quickTeamName" placeholder="请输入队伍名称" maxlength="20" show-word-limit />
          </div>
          <div class="quick-add-actions">
            <ElButton type="primary" :loading="quickAddLoading" @click="submitQuickAddTeam">创建队伍</ElButton>
          </div>
        </ElTabPane>
        <ElTabPane label="新增学员" name="athlete">
          <div class="quick-add-form-row">
            <label>所属队伍</label>
            <ElSelect v-model="quickAthleteForm.teamId" placeholder="请选择队伍">
              <ElOption v-for="team in teams" :key="team._teamId" :label="team._teamName" :value="team._teamId" />
            </ElSelect>
          </div>
          <div class="quick-add-form-row">
            <label>学员姓名</label>
            <ElInput v-model="quickAthleteForm.athleteName" placeholder="请输入学员姓名" maxlength="20" show-word-limit />
          </div>
          <div class="quick-add-form-row">
            <label>性别</label>
            <ElSelect v-model="quickAthleteForm.gender" placeholder="请选择性别">
              <ElOption label="男" value="1" />
              <ElOption label="女" value="2" />
              <ElOption label="未知" value="0" />
            </ElSelect>
          </div>
          <div class="quick-add-actions">
            <ElButton type="primary" :loading="quickAddLoading" @click="submitQuickAddAthlete">创建学员</ElButton>
          </div>
        </ElTabPane>
      </ElTabs>
      <p v-if="quickAddError" class="quick-add-error">{{ quickAddError }}</p>
    </ElDialog>

    <!-- 遮罩 -->
    <div class="overlay" :class="{ visible: isSettingsOpen }" @click="isSettingsOpen = false"></div>

    <div v-if="autoPauseDialog.visible" class="teaching-frame-mask">
      <div class="teaching-frame-dialog">
        <div class="teaching-left">
          <img v-if="autoPauseDialog.snapshot" :src="autoPauseDialog.snapshot" alt="teaching-frame">
          <div v-else class="teaching-empty">教学帧加载中</div>
        </div>
        <div class="teaching-right">
          <h3>{{ autoPauseDialog.title }}</h3>
          <p class="severity">等级：{{ autoPauseDialog.severity }}</p>
          <p>{{ autoPauseDialog.summary }}</p>
          <p><strong>证据：</strong>{{ autoPauseDialog.evidenceLabel }} = {{ autoPauseDialog.evidenceValue }}</p>
          <p><strong>建议：</strong>{{ autoPauseDialog.suggestion }}</p>
          <p><strong>训练：</strong>{{ autoPauseDialog.drill }}</p>
          <p><strong>目标区间：</strong>{{ autoPauseDialog.targetRange }}</p>
          <div class="teaching-actions">
            <button class="action-btn primary" @click="handleAutoPauseContinue">继续播放</button>
            <button class="action-btn danger" @click="handleAutoPauseIgnore">忽略本次</button>
          </div>
        </div>
      </div>
    </div>

    <input
      ref="videoFileInput"
      type="file"
      accept="video/*,.mp4,.mov,.m4v,.webm,.avi"
      style="display: none"
      @change="handleVideoImport"
    >

    <!-- 加载遮罩 -->
    <LoadingOverlay
      :is-loading="isLoading"
      :progress="loadingProgress"
      :text="loadingText"
    />
  </div>
</template>
