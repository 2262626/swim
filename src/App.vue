<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import TopBar from './components/TopBar.vue'
import BottomPanel from './components/BottomPanel.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import LoadingOverlay from './components/LoadingOverlay.vue'
import { ElImage } from 'element-plus'
import { usePoseEngine } from './composables/usePoseEngine.js'
import { useSkeletonDraw } from './composables/useSkeletonDraw.js'
import { useSwimAnalysis } from './composables/useSwimAnalysis.js'
import { useMobileFeatures } from './composables/useMobileFeatures.js'

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

const settings = ref({
  complexity: 1,
  detectConf: 0.35,
  trackConf: 0.30,
  lineWidth: 3,
  lineColor: '#00FFFC',
  showLabels: true,
  upperOnly: false,
})

const swimStyleOptions = ['自由泳', '蛙泳', '蝶泳', '仰泳']
const selectedSwimStyle = ref('蝶泳')
const styleStandardTemplates = {
  自由泳: [
    { key: 'armAlternate', label: '双臂交替划水' },
    { key: 'armStraight', label: '移臂保持伸直' },
    { key: 'legAlternate', label: '双腿交替打腿' },
    { key: 'bodyRoll', label: '身体滚动转体' },
    { key: 'breathTiming', label: '转头呼吸控制' },
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
    { key: 'bodyLine', label: '身体平直流线' },
    { key: 'headStable', label: '头部稳定放松' },
  ],
  准备姿势: [
    { key: 'prepBody', label: '身体准备' },
    { key: 'prepArms', label: '手臂放松' },
    { key: 'prepHead', label: '头部放松' },
    { key: 'prepFeet', label: '双脚站稳' },
  ],
}

const freestyleStandardTemplate = [
  { key: 'armAlternate', label: '双臂交替划水' },
  { key: 'armStraight', label: '移臂保持伸直' },
  { key: 'legAlternate', label: '双腿交替打腿' },
  { key: 'bodyRoll', label: '身体滚动转体' },
  { key: 'breathTiming', label: '转头呼吸控制' },
]

// ============ Composables ============
const poseEngine = usePoseEngine()
const { draw, getJointAngles, setConfig: setSkeletonConfig } = useSkeletonDraw()
const {
  analyze,
  reset,
  exportJSON,
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

// ============ Joint Angles ============
const jointAngles = ref({
  leftElbow: null,
  rightElbow: null,
  leftShoulder: null,
  rightShoulder: null,
})

const CAPTURE_INTERVAL_MS = 700
const MAX_CAPTURE_ITEMS = 120
let lastCaptureTime = 0
let lastCaptureStrokeCount = 0

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
  captureList.value = []
  captureSessionId.value = formatSessionId(new Date())
  lastCaptureTime = 0
  lastCaptureStrokeCount = strokeCount.value
}

const finalizeCaptureList = async () => {
  captureList.value = captureBuffer.value.filter(
    (item) => typeof item.image === 'string' && item.image.startsWith('data:image/')
  )
  await saveCaptureListToLocal()
}

const tryCaptureFrame = (analysisResult, fpsValue, confidenceValue, sourceImage = null) => {
  if (!canvas.value || !analysisResult) return

  const now = Date.now()
  const strokeChanged = analysisResult.strokeCount > lastCaptureStrokeCount
  if (!strokeChanged && now - lastCaptureTime < CAPTURE_INTERVAL_MS) return

  if (!canvas.value.width || !canvas.value.height) return

  let imageData = ''
  try {
    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = canvas.value.width
    snapCanvas.height = canvas.value.height
    const snapCtx = snapCanvas.getContext('2d')
    if (!snapCtx) return

    if (sourceImage) {
      snapCtx.drawImage(sourceImage, 0, 0, snapCanvas.width, snapCanvas.height)
    } else if (video.value && video.value.readyState >= 2) {
      snapCtx.drawImage(video.value, 0, 0, snapCanvas.width, snapCanvas.height)
    } else {
      snapCtx.fillStyle = '#000'
      snapCtx.fillRect(0, 0, snapCanvas.width, snapCanvas.height)
    }

    snapCtx.drawImage(canvas.value, 0, 0, snapCanvas.width, snapCanvas.height)
    imageData = snapCanvas.toDataURL('image/jpeg', 0.72)
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

    // 检查网络状态
    if (!isOnline.value) {
      loadingText.value = '请检查网络连接后重试'
      updateBadge('error', '无网络')
      return
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
              width: { ideal: 1280 },
              height: { ideal: 720 },
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
      void finalizeCaptureList()
    }

    if (isRecognitionRunning()) {
      updateBadge('live', '识别中')
      poseEngine.startLoop(video.value)
    } else {
      updateBadge('', '待开始录制')
      poseEngine.stopLoop()
    }

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
  isSettingsOpen.value = !isSettingsOpen.value
}

const applySettings = async (newSettings) => {
  settings.value = { ...newSettings }
  
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

const handleExport = () => {
  const exported = exportJSON()
  if (!exported) {
    updateBadge('error', '未录制')
    loadingText.value = '请先点击“开始录制”，再导出 JSON 数据'
    return
  }
  updateBadge('live', '导出成功')
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
    toggleRecording()
    resetCaptureBuffer()
    poseEngine.startLoop(video.value)
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
  // 震动反馈
  vibrate([50, 30, 50])
}

const recordBtnText = computed(() => (isRecording.value ? '停止录制' : '开始录制'))

const handleRecord = () => {
  const recording = toggleRecording()
  if (recording) {
    resetCaptureBuffer()
    if (analysisMode.value === 'camera' && video.value) {
      poseEngine.startLoop(video.value)
    }
  } else {
    if (analysisMode.value === 'camera') {
      poseEngine.stopLoop()
    }
    void finalizeCaptureList()
  }
  if (recording) {
    updateBadge('live', analysisMode.value === 'video' ? '视频分析中' : '识别中')
  } else {
    updateBadge('', analysisMode.value === 'video' ? '已停止分析' : '已停止录制')
  }
  vibrate(recording ? [20, 40, 20] : 20)
}

const toggleCamera = () => {
  if (analysisMode.value === 'video') {
    startCamera(facingMode.value)
    vibrate(30)
    return
  }

  facingMode.value = facingMode.value === 'environment' ? 'user' : 'environment'
  poseEngine.stopLoop()
  startCamera(facingMode.value)
  vibrate(30)
}

const pauseBtnText = ref('暂停')

const togglePause = () => {
  const paused = poseEngine.togglePause()
  pauseBtnText.value = paused ? '继续' : '暂停'
  updateBadge(paused ? '' : 'live', paused ? '已暂停' : '识别中')
  vibrate(20)
}

// ============ Lifecycle ============
onMounted(() => {
  if (canvas.value) {
    ctx = canvas.value.getContext('2d')
  }

  // 加载进度动画
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
      
      // Canvas 绘制（保持流畅，不节流）
      ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
      if (image) {
        ctx.drawImage(image, 0, 0, canvas.value.width, canvas.value.height)
      }

      if (!landmarks) {
        handleNoPerson()
        setUnknownDetection()
        currentAssessment.value = { score: null, items: [] }
        // 无人时立即清空 UI
        jointAngles.value = {
          leftElbow: null,
          rightElbow: null,
          leftShoulder: null,
          rightShoulder: null,
        }
        avgConfidence.value = 0
        return
      }

      handlePersonDetected()

      // 骨骼绘制（保持流畅）
      draw(ctx, landmarks, canvas.value.width, canvas.value.height)

      const angles = getJointAngles(landmarks)
      
      // 泳姿分析：使用用户手动选择的泳姿，不再自动识别泳姿类型
      const analysisResult = analyze(landmarks, angles, selectedSwimStyle.value)
      currentAssessment.value = analysisResult?.assessment || { score: null, items: [] }
      
      // 检测划臂计数变化，触发震动反馈
      if (strokeCount.value > prevStrokeCount) {
        vibrate(40)
        prevStrokeCount = strokeCount.value
      }

      // 节流：将数据存入待更新队列，而非立即更新 UI
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
        tryCaptureFrame(analysisResult, fpsValue, confidenceNow, image)
      }
      
      // 批量更新 UI（节流）
      throttledUIUpdate()
    },
    onError: (err) => {
      console.error('[PoseEngine]', err)
      updateBadge('error', '引擎错误')
    },
  })

  window.addEventListener('resize', resizeCanvas)
})

onUnmounted(() => {
  stopCameraStream()

  if (currentVideoURL.value) {
    URL.revokeObjectURL(currentVideoURL.value)
    currentVideoURL.value = ''
  }

  poseEngine.stopLoop()
  window.removeEventListener('resize', resizeCanvas)
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
const showCaptureList = computed(() => !isRecording.value && captureList.value.length > 0)
const capturePreviewImages = computed(() => captureList.value.map((item) => item.image).filter(Boolean))
const getCapturePreviewIndex = (id) => {
  const index = captureList.value.findIndex((item) => item.id === id)
  return index < 0 ? 0 : index
}
const panelTitle = computed(() => {
  const phase = detectedStroke.value?.split('·')?.[1] || ''
  if (phase === '准备姿势') return '预备姿势标准'
  return `${selectedSwimStyle.value}动作标准`
})
const techniquePanelItems = computed(() => {
  const phase = detectedStroke.value?.split('·')?.[1] || ''
  const template =
    phase === '准备姿势'
      ? styleStandardTemplates['准备姿势']
      : styleStandardTemplates[selectedSwimStyle.value] || freestyleStandardTemplate
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
</script>

<template>
  <div id="app">
    <!-- 视频 + 骨骼画布区域 -->
    <div class="video-wrapper" :class="{ 'with-capture-list': showCaptureList }">
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

      <!-- 右上角徽章 -->
      <div class="corner-badge">
        <span class="badge-dot" :class="badgeState"></span>
        <span>{{ badgeLabel }}</span>
      </div>

      <div class="freestyle-technique-panel">
        <div class="technique-header">
          <span>{{ panelTitle }}</span>
          <strong>{{ currentAssessment.score ?? 0 }}分</strong>
        </div>
        <div class="technique-items">
          <div
            v-for="item in techniquePanelItems"
            :key="item.key"
            class="technique-item"
            :class="{ ok: item.ok === true, bad: item.ok === false, pending: item.ok === null }"
          >
            <span class="name">{{ item.label }}</span>
            <span class="status">
              {{ item.ok === true ? '✓ 正确' : item.ok === false ? '✕ 错误' : '· 待识别' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 无人提示 -->
      <div class="no-person-hint" :class="{ show: noPersonHintVisible }">
        <div class="hint-icon">🏊</div>
        <p>请将相机对准游泳者</p>
      </div>

      <!-- 网络离线提示 -->
      <div v-if="!isOnline" class="offline-hint">
        <div class="hint-icon">📴</div>
        <p>网络已断开，部分功能可能受限</p>
      </div>

      <!-- 水波纹背景 -->
      <div class="water-bg"></div>
    </div>

    <!-- 顶部栏 -->
    <TopBar @settings="toggleSettings" @export="handleExport" @import-video="openVideoImporter" />

    <div v-if="showCaptureList" class="capture-list-panel">
      <div class="capture-list-scroll">
        <div
          v-for="item in captureList"
          :key="item.id"
          class="capture-item"
        >
          <ElImage
            class="capture-item-image"
            :src="item.image"
            fit="cover"
            :preview-src-list="capturePreviewImages"
            :initial-index="getCapturePreviewIndex(item.id)"
            preview-teleported
            hide-on-click-modal
          />
          <div class="capture-item-meta">
            <span>{{ item.time }} · 第{{ item.strokeCount }}次</span>
            <span>{{ item.style }}·{{ item.phase }}</span>
            <span>准确度 {{ item.confidence }}% · FPS {{ item.fps }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部数据面板 -->
    <BottomPanel
      :stroke="detectedStroke"
      :stroke-count="strokeCount"
      :fps="fps"
      :confidence="confidencePercent"
      :joint-angles="jointAngles"
      :angle-bars="angleBars"
      :pause-btn-text="pauseBtnText"
      :record-btn-text="recordBtnText"
      :selected-swim-style="selectedSwimStyle"
      :swim-style-options="swimStyleOptions"
      @reset="handleReset"
      @record="handleRecord"
      @camera="toggleCamera"
      @pause="togglePause"
      @select-style="selectedSwimStyle = $event"
    />

    <!-- 设置抽屉 -->
    <SettingsDrawer
      :is-open="isSettingsOpen"
      :settings="settings"
      @close="isSettingsOpen = false"
      @apply="applySettings"
      @update-skeleton="setSkeletonConfig"
    />

    <!-- 遮罩 -->
    <div class="overlay" :class="{ visible: isSettingsOpen }" @click="isSettingsOpen = false"></div>

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


