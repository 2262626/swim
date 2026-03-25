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
const loadingText = ref('正在加载 MediaPipe 模型...')
const badgeState = ref('')
const badgeLabel = ref('初始化中')
const scanLineActive = ref(false)
const videoActive = ref(false)

const fps = ref(0)
const avgConfidence = ref(0)

const settings = ref({
  complexity: 1,
  detectConf: 0.35,
  trackConf: 0.30,
  lineWidth: 3,
  lineColor: '#00FFFC',
  showLabels: true,
  upperOnly: false,
})

// ============ Composables ============
const poseEngine = usePoseEngine()
const { draw, getJointAngles, setConfig: setSkeletonConfig } = useSkeletonDraw()
const { analyze, reset, exportJSON, strokeCount, detectedStroke } = useSwimAnalysis()
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

// 性能优化：UI 更新节流控制
let lastUIUpdate = 0
const UI_UPDATE_INTERVAL = 150  // 每 150ms 更新一次 UI，而非每帧

// 用于节流的临时存储
const pendingJointAngles = ref(null)
const pendingFps = ref(0)
const pendingConfidence = ref(0)

// 性能优化：批量更新 UI，减少 Vue 响应式触发频率
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
    updateBadge('live', '识别中')
    scanLineActive.value = false

    poseEngine.startLoop(video.value)

    // 请求屏幕常亮 (移动端训练时不熄屏)
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
  exportJSON()
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
      
      // 泳姿分析（保持流畅，用于计数）
      analyze(landmarks, angles)
      
      // 检测划臂计数变化，触发震动反馈
      if (strokeCount.value > prevStrokeCount) {
        vibrate(40)
        prevStrokeCount = strokeCount.value
      }

      // 节流：将数据存入待更新队列，而非立即更新 UI
      pendingFps.value = fpsValue
      pendingJointAngles.value = {
        leftElbow: angles.leftElbow ?? null,
        rightElbow: angles.rightElbow ?? null,
        leftShoulder: angles.leftShoulder ?? null,
        rightShoulder: angles.rightShoulder ?? null,
      }
      pendingConfidence.value = calcAvgConfidence(landmarks)
      
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
</script>

<template>
  <div id="app">
    <!-- 视频 + 骨骼画布区域 -->
    <div class="video-wrapper">
      <video ref="video" id="video" autoplay muted playsinline :class="{ active: videoActive }"></video>
      <canvas ref="canvas" id="output-canvas"></canvas>

      <!-- 扫描线动画 -->
      <div class="scan-line" :class="{ active: scanLineActive }"></div>

      <!-- 右上角徽章 -->
      <div class="corner-badge">
        <span class="badge-dot" :class="badgeState"></span>
        <span>{{ badgeLabel }}</span>
      </div>

      <!-- 无人提示 -->
      <div class="no-person-hint" :class="{ show: noPersonHintVisible }">
        <div class="hint-icon">🏊</div>
        <p>请将相机对准游泳者</p>
      </div>

      <!-- 网络离线提示 -->
      <div v-if="!isOnline" class="offline-hint">
        <div class="hint-icon">📡</div>
        <p>网络已断开，部分功能可能受限</p>
      </div>

      <!-- 横屏建议提示 (仅在竖屏且非全屏时显示) -->
      <div v-if="isPortrait && !isLoading" class="orientation-hint">
        <p>💡 横屏可获得更佳体验</p>
      </div>

      <!-- 水波纹背景 -->
      <div class="water-bg"></div>
    </div>

    <!-- 顶部栏 -->
    <TopBar @settings="toggleSettings" @export="handleExport" @import-video="openVideoImporter" />

    <!-- 底部数据面板 -->
    <BottomPanel
      :stroke="detectedStroke"
      :stroke-count="strokeCount"
      :fps="fps"
      :confidence="confidencePercent"
      :joint-angles="jointAngles"
      :angle-bars="angleBars"
      :pause-btn-text="pauseBtnText"
      @reset="handleReset"
      @camera="toggleCamera"
      @pause="togglePause"
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
