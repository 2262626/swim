import { ref, readonly } from 'vue'

const MEDIAPIPE_POSE_ASSET_BASE = '/vendor/mediapipe/pose'
const MEDIAPIPE_POSE_SCRIPT_URL = `${MEDIAPIPE_POSE_ASSET_BASE}/pose.js`
let poseScriptPromise = null

const getGlobalPoseCtor = () => {
  if (typeof window !== 'undefined' && typeof window.Pose === 'function') return window.Pose
  if (typeof globalThis !== 'undefined' && typeof globalThis.Pose === 'function') return globalThis.Pose
  return null
}

const loadPoseCtor = async () => {
  const existingCtor = getGlobalPoseCtor()
  if (existingCtor) return existingCtor

  if (!poseScriptPromise) {
    poseScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[data-mediapipe-pose="true"]`)
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          const ctor = getGlobalPoseCtor()
          if (ctor) resolve(ctor)
          else reject(new Error('MediaPipe Pose script loaded, but Pose constructor is unavailable'))
        }, { once: true })
        existingScript.addEventListener('error', () => reject(new Error('Failed to load MediaPipe Pose script')), { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = MEDIAPIPE_POSE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.dataset.mediapipePose = 'true'
      script.onload = () => {
        const ctor = getGlobalPoseCtor()
        if (ctor) resolve(ctor)
        else reject(new Error('MediaPipe Pose script loaded, but Pose constructor is unavailable'))
      }
      script.onerror = () => reject(new Error(`Failed to load MediaPipe Pose script: ${MEDIAPIPE_POSE_SCRIPT_URL}`))
      document.head.appendChild(script)
    })
  }

  return poseScriptPromise
}

const createPoseInstance = async (options) => {
  const PoseCtor = await loadPoseCtor()
  return new PoseCtor(options)
}

// 水花场景参数
const POSE_POINT_COUNT = 33
const POSE_BUFFER_SIZE = 5
const VISIBILITY_THRESHOLD_UPPER = 0.55
const VISIBILITY_THRESHOLD_LOWER = 0.28
const MAX_OCCLUDED_FRAMES = 6
const STRUCTURE_ANOMALY_CONFIRM_FRAMES = 2
const FAST_MOTION_DIST = 0.025

const KP = {
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_WRIST: 15,
  R_WRIST: 16,
  L_ANKLE: 27,
  R_ANKLE: 28,
}

export function usePoseEngine() {
  let pose = null
  const isReady = ref(false)
  const isPaused = ref(false)
  let animFrameId = null

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

  let frameCount = 0
  const skipFrames = isMobile ? 2 : 0
  let isProcessing = false

  const currentOptions = ref({
    modelComplexity: isMobile ? 0 : 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  })

  const _complexity = ref(isMobile ? 0 : 1)

  let onResultsCb = null
  let onReadyCb = null
  let onErrorCb = null

  const fpsSamples = []
  const poseBuffer = []
  const lastValidPoints = new Array(POSE_POINT_COUNT).fill(null)
  const structureAnomalyCounts = new Map()
  let occludedFrameCount = 0

  const _calcFPS = (now) => {
    fpsSamples.push(now)
    if (fpsSamples.length > 30) fpsSamples.shift()
    if (fpsSamples.length < 2) return 0
    const span = (fpsSamples[fpsSamples.length - 1] - fpsSamples[0]) / 1000
    return Math.round((fpsSamples.length - 1) / span)
  }

  const _clonePoint = (point, visibility = point?.visibility ?? 0) => {
    if (!point) return null
    return {
      x: point.x,
      y: point.y,
      z: point.z ?? 0,
      visibility,
    }
  }

  const _serializeLandmarks = (landmarks) => {
    if (!Array.isArray(landmarks)) return null
    return landmarks.map((point) => _clonePoint(point))
  }

  const _pushPoseFrame = (landmarks) => {
    if (!Array.isArray(landmarks) || landmarks.length < POSE_POINT_COUNT) return
    poseBuffer.push(_serializeLandmarks(landmarks))
    if (poseBuffer.length > POSE_BUFFER_SIZE) poseBuffer.shift()
  }

  const _pointThreshold = (idx) => {
    if (
      idx === KP.L_HIP ||
      idx === KP.R_HIP ||
      idx === KP.L_KNEE ||
      idx === KP.R_KNEE ||
      idx === KP.L_ANKLE ||
      idx === KP.R_ANKLE
    ) {
      return VISIBILITY_THRESHOLD_LOWER
    }
    return VISIBILITY_THRESHOLD_UPPER
  }

  const _applyStructureConstraints = (landmarks) => {
    const constrained = landmarks.map((point) => _clonePoint(point))

    // 连续两帧都异常才回退，避免“一帧误判”把腿锁死
    const pairRules = [
      { key: 'wrist', left: KP.L_WRIST, right: KP.R_WRIST, maxXDiff: 0.72 },
      { key: 'ankle', left: KP.L_ANKLE, right: KP.R_ANKLE, maxXDiff: 0.62 },
    ]

    for (const rule of pairRules) {
      const left = constrained[rule.left]
      const right = constrained[rule.right]
      if (!left || !right) continue

      const xDiff = Math.abs(left.x - right.x)
      if (xDiff <= rule.maxXDiff) {
        structureAnomalyCounts.set(rule.key, 0)
        continue
      }

      const currentCount = (structureAnomalyCounts.get(rule.key) ?? 0) + 1
      structureAnomalyCounts.set(rule.key, currentCount)
      if (currentCount < STRUCTURE_ANOMALY_CONFIRM_FRAMES) continue

      if (lastValidPoints[rule.left]) {
        constrained[rule.left] = _clonePoint(lastValidPoints[rule.left], left.visibility * 0.9)
      }
      if (lastValidPoints[rule.right]) {
        constrained[rule.right] = _clonePoint(lastValidPoints[rule.right], right.visibility * 0.9)
      }
    }

    return constrained
  }

  const _smoothPosePoints = () => {
    if (!poseBuffer.length) return null

    const result = new Array(POSE_POINT_COUNT).fill(null)
    const latestFrame = poseBuffer[poseBuffer.length - 1]
    const prevFrame = poseBuffer.length > 1 ? poseBuffer[poseBuffer.length - 2] : null

    for (let idx = 0; idx < POSE_POINT_COUNT; idx++) {
      let sumX = 0
      let sumY = 0
      let sumZ = 0
      let sumVisibility = 0
      let sumWeight = 0
      const threshold = _pointThreshold(idx)

      for (let i = 0; i < poseBuffer.length; i++) {
        const frame = poseBuffer[i]
        const point = frame?.[idx]
        if (!point || (point.visibility ?? 0) < threshold) continue

        // 使用二次权重，强化最新帧占比，降低“骨骼滞后导致点位偏离身体”的视觉问题
        const recencyWeight = (i + 1) * (i + 1)
        sumX += point.x * recencyWeight
        sumY += point.y * recencyWeight
        sumZ += (point.z ?? 0) * recencyWeight
        sumVisibility += Math.min(1, point.visibility ?? 0) * recencyWeight
        sumWeight += recencyWeight
      }

      if (sumWeight > 0) {
        const latest = latestFrame?.[idx]
        const prev = prevFrame?.[idx]
        const latestValid = latest && (latest.visibility ?? 0) >= threshold
        const prevValid = prev && (prev.visibility ?? 0) >= threshold
        let fastMotion = false
        if (latestValid && prevValid) {
          const dx = latest.x - prev.x
          const dy = latest.y - prev.y
          fastMotion = Math.hypot(dx, dy) >= FAST_MOTION_DIST
        }

        // 快速运动时提升当前帧权重，避免动作激烈阶段骨骼明显拖尾
        if (fastMotion && latestValid) {
          result[idx] = {
            x: latest.x * 0.86 + (sumX / sumWeight) * 0.14,
            y: latest.y * 0.86 + (sumY / sumWeight) * 0.14,
            z: (latest.z ?? 0) * 0.86 + (sumZ / sumWeight) * 0.14,
            visibility: Math.min(1, Math.max(latest.visibility ?? 0, (sumVisibility / sumWeight) * 0.95)),
          }
          continue
        }

        result[idx] = {
          x: sumX / sumWeight,
          y: sumY / sumWeight,
          z: sumZ / sumWeight,
          visibility: Math.min(1, sumVisibility / sumWeight),
        }
        continue
      }

      if (lastValidPoints[idx]) {
        const fadedVisibility = Math.max(0.2, (lastValidPoints[idx].visibility ?? 0.8) * 0.9)
        result[idx] = _clonePoint(lastValidPoints[idx], fadedVisibility)
      }
    }

    return result
  }

  const _processLandmarks = (rawLandmarks) => {
    if (Array.isArray(rawLandmarks) && rawLandmarks.length >= POSE_POINT_COUNT) {
      occludedFrameCount = 0
      _pushPoseFrame(rawLandmarks)

      const smoothed = _smoothPosePoints()
      if (!smoothed) return rawLandmarks

      const constrained = _applyStructureConstraints(smoothed)
      for (let i = 0; i < constrained.length; i++) {
        const point = constrained[i]
        if (point && (point.visibility ?? 0) >= 0.24) {
          lastValidPoints[i] = _clonePoint(point)
        }
      }
      return constrained
    }

    occludedFrameCount += 1
    if (occludedFrameCount <= MAX_OCCLUDED_FRAMES) {
      const smoothed = _smoothPosePoints()
      if (smoothed) return _applyStructureConstraints(smoothed)
    }
    return null
  }

  const _handleResults = (results) => {
    if (isPaused.value) return

    const now = performance.now()
    const fps = _calcFPS(now)
    const processedLandmarks = _processLandmarks(results.poseLandmarks || null)

    if (onResultsCb) {
      onResultsCb({
        landmarks: processedLandmarks,
        worldLandmarks: results.poseWorldLandmarks || null,
        image: results.image,
        fps,
      })
    }
  }

  const init = async (callbacks = {}) => {
    onResultsCb = callbacks.onResults || null
    onReadyCb = callbacks.onReady || null
    onErrorCb = callbacks.onError || null

    try {
      pose = await createPoseInstance({
        locateFile: (file) => `${MEDIAPIPE_POSE_ASSET_BASE}/${file}`,
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

    stopLoop()
    frameCount = 0
    isProcessing = false

    async function loop() {
      frameCount += 1
      const shouldSkip = skipFrames > 0 && frameCount % (skipFrames + 1) !== 0

      if (!isPaused.value && videoEl.readyState >= 2 && !shouldSkip && !isProcessing) {
        isProcessing = true
        try {
          await pose.send({ image: videoEl })
        } finally {
          isProcessing = false
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
    if (pose) pose.setOptions(currentOptions.value)
  }

  const reinit = async (opts = {}) => {
    stopLoop()
    Object.assign(currentOptions.value, opts)

    if (pose) {
      try { await pose.close() } catch (_) {}
    }

    pose = await createPoseInstance({
      locateFile: (file) => `${MEDIAPIPE_POSE_ASSET_BASE}/${file}`,
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
