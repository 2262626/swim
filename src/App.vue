<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import TopBar from './components/TopBar.vue'
import BottomPanel from './components/BottomPanel.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import LoadingOverlay from './components/LoadingOverlay.vue'
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
const loadingText = ref('姝ｅ湪鍔犺浇 MediaPipe 妯″瀷...')
const badgeState = ref('')
const badgeLabel = ref('鍒濆鍖栦腑')
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
} = useSwimAnalysis()
const { 
  isOnline, 
  deviceType, 
  isPortrait, 
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

// 鎬ц兘浼樺寲锛歎I 鏇存柊鑺傛祦鎺у埗
let lastUIUpdate = 0
const UI_UPDATE_INTERVAL = 150  // 姣?150ms 鏇存柊涓€娆?UI锛岃€岄潪姣忓抚

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
    updateBadge('', '绛夊緟鍏ラ暅')
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
      throw new Error('娴忚鍣ㄤ笉鏀寔鐩告満 API')
    }

    if (!window.isSecureContext) {
      throw new Error('请使用 HTTPS 或 localhost 访问，才能调用相机')
    }

    if (currentStream.value) {
      currentStream.value.getTracks().forEach(t => t.stop())
    }

    // 检查网络状态
    if (!isOnline.value) {
      loadingText.value = '璇锋鏌ョ綉缁滆繛鎺ュ悗閲嶈瘯'
      updateBadge('error', '无网络')
      return
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

    // iOS/Safari 瀵圭害鏉熸敮鎸佷笉绋冲畾锛屾寜鈥滀粠涓ユ牸鍒板鏉锯€濋€愮骇闄嶇骇
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
        if (!done) reject(new Error('瑙嗛鍔犺浇瓒呮椂'))
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
    updateBadge('live', '识别中')
    scanLineActive.value = false

    poseEngine.startLoop(video.value)

    // 璇锋眰灞忓箷甯镐寒 (绉诲姩绔缁冩椂涓嶇唲灞?
    requestWakeLock()
  } catch (err) {
    console.error('[Camera Error]', err?.name, err?.message, err)

    let errorMsg = '鐩告満鍚姩澶辫触'

    if (err.message && err.message.includes('HTTPS')) {
      errorMsg = '请使用 HTTPS 打开页面（iPhone 必须）'
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorMsg = deviceType.value === 'ios'
        ? '请在 iPhone 设置 > Safari > 相机 里允许访问，并刷新页面'
        : '璇峰厑璁哥浉鏈烘潈闄愬悗鍒锋柊椤甸潰'
    } else if (err.name === 'NotFoundError') {
      errorMsg = '未找到相机设备'
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      errorMsg = '鐩告満琚崰鐢紝璇峰叧闂叾浠栫浉鏈哄簲鐢ㄥ悗閲嶈瘯'
    } else if (err.name === 'OverconstrainedError') {
      errorMsg = '当前相机参数不支持，已建议改用默认相机'
    } else if (err.message && err.message.includes('瓒呮椂')) {
      errorMsg = '鐩告満鍚姩瓒呮椂锛岃鍒锋柊閲嶈瘯'
    }

    updateBadge('error', '鐩告満閿欒')
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
    poseEngine.startLoop(video.value)
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
      const timeout = setTimeout(() => reject(new Error('瑙嗛鍔犺浇瓒呮椂')), 10000)
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
    poseEngine.startLoop(video.value)
  } catch (err) {
    console.error('[Video Import Error]', err)
    updateBadge('error', '瑙嗛瀵煎叆澶辫触')
    loadingText.value = '瑙嗛瀵煎叆澶辫触锛岃鏇存崲鏂囦欢閲嶈瘯'
  }
}

const handleVideoImport = async (event) => {
  const file = event?.target?.files?.[0]
  if (!file) return

  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name)
  if (!isVideo) {
    updateBadge('error', '鏂囦欢鏍煎紡閿欒')
    loadingText.value = '请选择视频文件（mp4/mov/webm）'
    return
  }

  await switchToVideoMode(file)
}

const handleReset = () => {
  reset()
  // 闇囧姩鍙嶉
  vibrate([50, 30, 50])
}

const recordBtnText = computed(() => (isRecording.value ? '停止录制' : '开始录制'))

const handleRecord = () => {
  const recording = toggleRecording()
  if (recording) {
    resetCaptureBuffer()
  } else {
    void finalizeCaptureList()
  }
  updateBadge(recording ? 'live' : '', recording ? '录制中' : '已停止录制')
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

  // 鍔犺浇杩涘害鍔ㄧ敾
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
      
      // Canvas 缁樺埗锛堜繚鎸佹祦鐣咃紝涓嶈妭娴侊級
      ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
      if (image) {
        ctx.drawImage(image, 0, 0, canvas.value.width, canvas.value.height)
      }

      if (!landmarks) {
        handleNoPerson()
        // 鏃犱汉鏃剁珛鍗虫竻绌?UI
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

      // 楠ㄩ缁樺埗锛堜繚鎸佹祦鐣咃級
      draw(ctx, landmarks, canvas.value.width, canvas.value.height)

      const angles = getJointAngles(landmarks)
      
      // 娉冲Э鍒嗘瀽锛氫娇鐢ㄧ敤鎴锋墜鍔ㄩ€夋嫨鐨勬吵濮匡紝涓嶅啀鑷姩璇嗗埆娉冲Э绫诲瀷
      const analysisResult = analyze(landmarks, angles, selectedSwimStyle.value)
      if (analysisResult?.assessment) {
        currentAssessment.value = analysisResult.assessment
      }
      
      // 妫€娴嬪垝鑷傝鏁板彉鍖栵紝瑙﹀彂闇囧姩鍙嶉
      if (strokeCount.value > prevStrokeCount) {
        vibrate(40)
        prevStrokeCount = strokeCount.value
      }

      // 鑺傛祦锛氬皢鏁版嵁瀛樺叆寰呮洿鏂伴槦鍒楋紝鑰岄潪绔嬪嵆鏇存柊 UI
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
      
      // 鎵归噺鏇存柊 UI锛堣妭娴侊級
      throttledUIUpdate()
    },
    onError: (err) => {
      console.error('[PoseEngine]', err)
      updateBadge('error', '寮曟搸閿欒')
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
</script>

<template>
  <div id="app">
    <!-- 瑙嗛 + 楠ㄩ鐢诲竷鍖哄煙 -->
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

      <!-- 鎵弿绾垮姩鐢?-->
      <div class="scan-line" :class="{ active: scanLineActive }"></div>

      <!-- 鍙充笂瑙掑窘绔?-->
      <div class="corner-badge">
        <span class="badge-dot" :class="badgeState"></span>
        <span>{{ badgeLabel }}</span>
      </div>

      <div
        v-if="selectedSwimStyle === '蝶泳' && currentAssessment.items.length"
        class="butterfly-technique-panel"
      >
        <div class="technique-header">
          <span>蝶泳动作标准</span>
          <strong>{{ currentAssessment.score ?? 0 }}分</strong>
        </div>
        <div class="technique-items">
          <div
            v-for="item in currentAssessment.items"
            :key="item.key"
            class="technique-item"
            :class="{ ok: item.ok, bad: !item.ok }"
          >
            <span class="name">{{ item.label }}</span>
            <span class="status">{{ item.ok ? '✓ 正确' : '✕ 错误' }}</span>
          </div>
        </div>
      </div>

      <!-- 鏃犱汉鎻愮ず -->
      <div class="no-person-hint" :class="{ show: noPersonHintVisible }">
        <div class="hint-icon">馃強</div>
        <p>请将相机对准游泳者</p>
      </div>

      <!-- 缃戠粶绂荤嚎鎻愮ず -->
      <div v-if="!isOnline" class="offline-hint">
        <div class="hint-icon">馃摗</div>
        <p>网络已断开，部分功能可能受限</p>
      </div>

      <!-- 妯睆寤鸿鎻愮ず (浠呭湪绔栧睆涓旈潪鍏ㄥ睆鏃舵樉绀? -->
      <div v-if="isPortrait && !isLoading" class="orientation-hint">
        <p>💡 横屏可获得更佳体验</p>
      </div>

      <!-- 姘存尝绾硅儗鏅?-->
      <div class="water-bg"></div>
    </div>

    <!-- 椤堕儴鏍?-->
    <TopBar @settings="toggleSettings" @export="handleExport" @import-video="openVideoImporter" />

    <div v-if="showCaptureList" class="capture-list-panel">
      <div class="capture-list-scroll">
        <div
          v-for="item in captureList"
          :key="item.id"
          class="capture-item"
        >
          <img :src="item.image" alt="capture frame">
          <div class="capture-item-meta">
            <span>{{ item.time }} · 第{{ item.strokeCount }}次</span>
            <span>{{ item.style }}·{{ item.phase }}</span>
            <span>准确度 {{ item.confidence }}% · FPS {{ item.fps }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 搴曢儴鏁版嵁闈㈡澘 -->
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
      :assessment="currentAssessment"
      :hide-assessment="selectedSwimStyle === '蝶泳'"
      @reset="handleReset"
      @record="handleRecord"
      @camera="toggleCamera"
      @pause="togglePause"
      @select-style="selectedSwimStyle = $event"
    />

    <!-- 璁剧疆鎶藉眽 -->
    <SettingsDrawer
      :is-open="isSettingsOpen"
      :settings="settings"
      @close="isSettingsOpen = false"
      @apply="applySettings"
      @update-skeleton="setSkeletonConfig"
    />

    <!-- 閬僵 -->
    <div class="overlay" :class="{ visible: isSettingsOpen }" @click="isSettingsOpen = false"></div>

    <input
      ref="videoFileInput"
      type="file"
      accept="video/*,.mp4,.mov,.m4v,.webm,.avi"
      style="display: none"
      @change="handleVideoImport"
    >

    <!-- 鍔犺浇閬僵 -->
    <LoadingOverlay
      :is-loading="isLoading"
      :progress="loadingProgress"
      :text="loadingText"
    />
  </div>
</template>

