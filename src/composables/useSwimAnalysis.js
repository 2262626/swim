import { ref, readonly } from 'vue'
import { KP } from './useSkeletonDraw.js'

const STROKE_TYPES = {
  FREESTYLE:   '自由泳',
  BREASTSTROKE:'蛙泳',
  BACKSTROKE:  '仰泳',
  BUTTERFLY:   '蝶泳',
  UNKNOWN:     '未知',
}

export function useSwimAnalysis() {
  const strokeCount = ref(0)
  const detectedStroke = ref('未知')
  const strokeHistory = ref([])
  const exportBuffer = ref([])
  const frameBuffer = ref([])
  
  let lastStrokeTime = 0

  const BUFFER_SIZE = 30
  const STROKE_COOLDOWN_MS = 400
  const MAX_EXPORT = 500

  const reset = () => {
    strokeCount.value = 0
    strokeHistory.value = []
    lastStrokeTime = 0
    detectedStroke.value = '未知'
    frameBuffer.value = []
    exportBuffer.value = []
  }

  const analyze = (landmarks, angles) => {
    if (!landmarks) return null

    const now = Date.now()

    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]

    const leftVisible  = lw && lw.visibility > 0.35
    const rightVisible = rw && rw.visibility > 0.35

    frameBuffer.value.push({ now, landmarks: serializeLandmarks(landmarks) })
    if (frameBuffer.value.length > BUFFER_SIZE) frameBuffer.value.shift()

    detectedStroke.value = classifyStroke(landmarks, angles)

    if ((leftVisible || rightVisible) && frameBuffer.value.length >= 4) {
      detectArmStroke(landmarks, now)
    }

    const rate = calcStrokeRate()
    const symmetry = calcSymmetry(angles)

    const result = {
      stroke: detectedStroke.value,
      strokeCount: strokeCount.value,
      strokeRate: rate,
      symmetry,
      angles,
      timestamp: now,
    }

    if (exportBuffer.value.length < MAX_EXPORT) {
      exportBuffer.value.push(result)
    }

    return result
  }

  const classifyStroke = (landmarks, angles) => {
    if (!landmarks || frameBuffer.value.length < 5) return STROKE_TYPES.UNKNOWN

    const nose  = landmarks[KP.NOSE]
    const ls    = landmarks[KP.L_SHOULDER]
    const rs    = landmarks[KP.R_SHOULDER]
    const lh    = landmarks[KP.L_HIP]
    const rh    = landmarks[KP.R_HIP]
    const lw    = landmarks[KP.L_WRIST]
    const rw    = landmarks[KP.R_WRIST]

    if (!ls || !rs || !lh || !rh) return STROKE_TYPES.UNKNOWN

    const shoulderMidY = (ls.y + rs.y) / 2

    if (nose && nose.visibility > 0.4) {
      if (nose.y < shoulderMidY - 0.08) {
        return STROKE_TYPES.BACKSTROKE
      }
    }

    if (lw && rw && lw.visibility > 0.35 && rw.visibility > 0.35) {
      const wristYDiff = Math.abs(lw.y - rw.y)
      const wristXSpan = Math.abs(lw.x - rw.x)
      if (wristYDiff < 0.06 && wristXSpan > 0.35) {
        return STROKE_TYPES.BUTTERFLY
      }

      const wristXDiff = Math.abs(lw.x - rw.x)
      const midShoulderX = (ls.x + rs.x) / 2
      const wristMidX = (lw.x + rw.x) / 2
      const isWristCentered = Math.abs(wristMidX - midShoulderX) < 0.12
      const isElbowBent = (angles.leftElbow && angles.leftElbow < 120)
                        || (angles.rightElbow && angles.rightElbow < 120)
      if (isWristCentered && isElbowBent && wristXDiff < 0.3) {
        return STROKE_TYPES.BREASTSTROKE
      }
    }

    const shoulderXDiff = Math.abs(ls.x - rs.x)
    if (shoulderXDiff > 0.08) {
      return STROKE_TYPES.FREESTYLE
    }

    return detectedStroke.value !== STROKE_TYPES.UNKNOWN ? detectedStroke.value : STROKE_TYPES.FREESTYLE
  }

  const detectArmStroke = (landmarks, now) => {
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return

    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]

    if (frameBuffer.value.length < 3) return

    const prev = frameBuffer.value[frameBuffer.value.length - 3]
    const prevLW = prev.landmarks[KP.L_WRIST]
    const prevRW = prev.landmarks[KP.R_WRIST]

    let counted = false

    if (lw && ls && prevLW && lw.visibility > 0.4 && ls.visibility > 0.4) {
      const crossed = prevLW.y < ls.y && lw.y >= ls.y
      if (crossed) {
        strokeCount.value++
        counted = true
      }
    }

    if (!counted && rw && rs && prevRW && rw.visibility > 0.4 && rs.visibility > 0.4) {
      const crossed = prevRW.y < rs.y && rw.y >= rs.y
      if (crossed) {
        strokeCount.value++
        counted = true
      }
    }

    if (counted) {
      lastStrokeTime = now
      strokeHistory.value.push(now)
      if (strokeHistory.value.length > 20) strokeHistory.value.shift()
    }
  }

  const calcStrokeRate = () => {
    if (strokeHistory.value.length < 2) return 0
    const span = (strokeHistory.value[strokeHistory.value.length - 1] - strokeHistory.value[0]) / 1000
    if (span <= 0) return 0
    const rate = ((strokeHistory.value.length - 1) / span) * 60
    return Math.round(rate)
  }

  const calcSymmetry = (angles) => {
    if (!angles) return null

    const pairs = [
      ['leftElbow', 'rightElbow'],
      ['leftShoulder', 'rightShoulder'],
      ['leftKnee', 'rightKnee'],
    ]

    let total = 0, count = 0
    for (const [l, r] of pairs) {
      if (angles[l] != null && angles[r] != null) {
        const diff = Math.abs(angles[l] - angles[r])
        total += Math.max(0, 100 - diff)
        count++
      }
    }

    return count > 0 ? Math.round(total / count) : null
  }

  const serializeLandmarks = (landmarks) => {
    return landmarks.map(lm => lm ? { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility } : null)
  }

  const exportJSON = () => {
    const data = {
      exportTime: new Date().toISOString(),
      totalStrokes: strokeCount.value,
      detectedStroke: detectedStroke.value,
      frames: exportBuffer.value,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `swim-data-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addStroke = () => {
    strokeCount.value++
  }

  return {
    strokeCount: readonly(strokeCount),
    detectedStroke: readonly(detectedStroke),
    strokeHistory: readonly(strokeHistory),
    analyze,
    reset,
    exportJSON,
    addStroke,
  }
}
