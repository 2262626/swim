import { ref, readonly } from 'vue'

export function usePoseEngine() {
  let pose = null
  const isReady = ref(false)
  const isPaused = ref(false)
  let animFrameId = null

  // 检测是否为移动设备
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  
  // 跳帧控制
  let frameCount = 0
  const skipFrames = isMobile ? 2 : 0  // 移动端每 3 帧处理一次

  const currentOptions = ref({
    modelComplexity: isMobile ? 0 : 1,  // 移动端默认快速模式
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.35,
    minTrackingConfidence: 0.30,
  })

  const _complexity = ref(isMobile ? 0 : 1)

  let onResultsCb = null
  let onReadyCb = null
  let onErrorCb = null

  const fpsSamples = ref([])
  let lastFrameTime = 0

  const _calcFPS = (now) => {
    fpsSamples.value.push(now)
    if (fpsSamples.value.length > 30) fpsSamples.value.shift()
    if (fpsSamples.value.length < 2) return 0
    const span = (fpsSamples.value[fpsSamples.value.length - 1] - fpsSamples.value[0]) / 1000
    return Math.round((fpsSamples.value.length - 1) / span)
  }

  const _handleResults = (results) => {
    if (isPaused.value) return

    frameCount++
    
    // 跳帧逻辑：移动端降低处理频率
    if (skipFrames > 0 && frameCount % (skipFrames + 1) !== 0) {
      return
    }

    const now = performance.now()
    const fps = _calcFPS(now)

    if (onResultsCb) {
      onResultsCb({
        landmarks: results.poseLandmarks || null,
        worldLandmarks: results.poseWorldLandmarks || null,
        image: results.image,
        fps,
      })
    }

    lastFrameTime = now
  }

  const init = (callbacks = {}) => {
    onResultsCb = callbacks.onResults || null
    onReadyCb = callbacks.onReady || null
    onErrorCb = callbacks.onError || null

    try {
      const PoseClass = (typeof Pose !== 'undefined' ? Pose : window.Pose)
      if (!PoseClass) throw new Error('MediaPipe Pose 未加载，请检查网络连接')

      pose = new PoseClass({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      })

      pose.setOptions(currentOptions.value)
      pose.onResults(_handleResults)

      isReady.value = true
      if (onReadyCb) onReadyCb()

    } catch (err) {
      if (onErrorCb) onErrorCb(err)
    }
  }

  const startLoop = (videoEl) => {
    if (!pose || !videoEl) return

    async function loop() {
      if (!isPaused.value && videoEl.readyState >= 2) {
        try {
          await pose.send({ image: videoEl })
        } catch (e) {
        }
      }
      animFrameId = requestAnimationFrame(loop)
    }

    animFrameId = requestAnimationFrame(loop)
  }

  const stopLoop = () => {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  const pause = () => { isPaused.value = true }
  const resume = () => { isPaused.value = false }
  const togglePause = () => {
    isPaused.value = !isPaused.value
    return isPaused.value
  }

  const updateOptions = (opts) => {
    Object.assign(currentOptions.value, opts)
    if (pose) {
      pose.setOptions(currentOptions.value)
    }
  }

  const reinit = async (opts = {}) => {
    stopLoop()
    Object.assign(currentOptions.value, opts)

    if (pose) {
      try { await pose.close() } catch (_) {}
    }

    const PoseClass = (typeof Pose !== 'undefined' ? Pose : window.Pose)
    pose = new PoseClass({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    })

    pose.setOptions(currentOptions.value)
    pose.onResults(_handleResults)
    isReady.value = true
  }

  return {
    isReady: readonly(isReady),
    isPaused: readonly(isPaused),
    currentOptions: readonly(currentOptions),
    _complexity,
    init,
    startLoop,
    stopLoop,
    pause,
    resume,
    togglePause,
    updateOptions,
    reinit,
  }
}
