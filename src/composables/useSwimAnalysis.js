import { ref, readonly } from 'vue'
import { KP } from './useSkeletonDraw.js'

const STROKE_TYPES = {
  FREESTYLE: '自由泳',
  BREASTSTROKE: '蛙泳',
  BACKSTROKE: '仰泳',
  BUTTERFLY: '蝶泳',
  UNKNOWN: '未知',
}

const STROKE_PHASES = {
  ENTRY: '入水',
  CATCH: '抱水',
  PULL: '推水',
  RECOVERY: '回臂',
  GLIDE: '滑行',
  UNKNOWN: '准备',
}

export function useSwimAnalysis() {
  const strokeCount = ref(0)
  const detectedStyle = ref(STROKE_TYPES.UNKNOWN)
  const detectedPhase = ref(STROKE_PHASES.UNKNOWN)
  const detectedStroke = ref(`${STROKE_TYPES.UNKNOWN}·${STROKE_PHASES.UNKNOWN}`)
  const strokeHistory = ref([])
  const exportBuffer = ref([])
  const frameBuffer = ref([])

  let lastStrokeTime = 0

  const BUFFER_SIZE = 30
  const STROKE_COOLDOWN_MS = 450
  const MAX_EXPORT = 500

  const reset = () => {
    strokeCount.value = 0
    strokeHistory.value = []
    lastStrokeTime = 0
    detectedStyle.value = STROKE_TYPES.UNKNOWN
    detectedPhase.value = STROKE_PHASES.UNKNOWN
    detectedStroke.value = `${detectedStyle.value}·${detectedPhase.value}`
    frameBuffer.value = []
    exportBuffer.value = []
  }

  const analyze = (landmarks, angles) => {
    if (!landmarks) return null

    const now = Date.now()

    frameBuffer.value.push({ now, landmarks: serializeLandmarks(landmarks) })
    if (frameBuffer.value.length > BUFFER_SIZE) frameBuffer.value.shift()

    const style = classifyStyle(landmarks, angles)
    const phase = classifyPhaseByStyle(style, landmarks, angles)

    detectedStyle.value = style
    detectedPhase.value = phase
    detectedStroke.value = `${style}·${phase}`

    if (frameBuffer.value.length >= 4) {
      detectArmStroke(landmarks, now)
    }

    const rate = calcStrokeRate()
    const symmetry = calcSymmetry(angles)

    const result = {
      style,
      phase,
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

  const classifyStyle = (landmarks, angles) => {
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const nose = landmarks[KP.NOSE]

    if (!ls || !rs || !lw || !rw) return STROKE_TYPES.UNKNOWN
    if (ls.visibility < 0.35 || rs.visibility < 0.35 || lw.visibility < 0.3 || rw.visibility < 0.3) {
      return STROKE_TYPES.UNKNOWN
    }

    const shoulderMidY = (ls.y + rs.y) / 2

    // 仰泳：头部明显高于肩线（画面中 y 更小）
    if (nose && nose.visibility > 0.35 && nose.y < shoulderMidY - 0.08) {
      return STROKE_TYPES.BACKSTROKE
    }

    const wristYDiff = Math.abs(lw.y - rw.y)
    const wristXSpan = Math.abs(lw.x - rw.x)
    const elbowBent = (angles.leftElbow ?? 180) < 120 || (angles.rightElbow ?? 180) < 120

    // 蝶泳：双手基本同高且展宽明显
    if (wristYDiff < 0.06 && wristXSpan > 0.32) {
      return STROKE_TYPES.BUTTERFLY
    }

    // 蛙泳：双手更居中、肘屈明显
    const shoulderMidX = (ls.x + rs.x) / 2
    const wristMidX = (lw.x + rw.x) / 2
    const wristsCentered = Math.abs(wristMidX - shoulderMidX) < 0.10
    if (wristsCentered && wristXSpan < 0.30 && elbowBent) {
      return STROKE_TYPES.BREASTSTROKE
    }

    // 默认按自由泳
    return STROKE_TYPES.FREESTYLE
  }

  const classifyPhaseByStyle = (style, landmarks, angles) => {
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]

    if (!ls || !rs || !lw || !rw) return STROKE_PHASES.UNKNOWN

    const shoulderY = (ls.y + rs.y) / 2
    const leftDy = lw.y - shoulderY
    const rightDy = rw.y - shoulderY
    const minDy = Math.min(leftDy, rightDy)
    const maxDy = Math.max(leftDy, rightDy)

    const leftElbow = angles.leftElbow ?? 180
    const rightElbow = angles.rightElbow ?? 180
    const minElbow = Math.min(leftElbow, rightElbow)
    const maxElbow = Math.max(leftElbow, rightElbow)

    if (style === STROKE_TYPES.BREASTSTROKE) {
      if (maxDy < -0.02) return STROKE_PHASES.ENTRY
      if (minElbow < 115 && Math.abs(leftDy - rightDy) < 0.08) return STROKE_PHASES.CATCH
      if (maxElbow > 130 && minDy > -0.02) return STROKE_PHASES.PULL
      return STROKE_PHASES.GLIDE
    }

    if (style === STROKE_TYPES.BUTTERFLY) {
      if (maxDy < -0.05) return STROKE_PHASES.ENTRY
      if (minElbow < 125 && Math.abs(leftDy - rightDy) < 0.07) return STROKE_PHASES.CATCH
      if (maxDy > 0.04 && maxElbow > 130) return STROKE_PHASES.PULL
      return STROKE_PHASES.RECOVERY
    }

    if (style === STROKE_TYPES.BACKSTROKE) {
      if (minDy < -0.06) return STROKE_PHASES.RECOVERY
      if (minElbow < 120 && maxDy <= 0.03) return STROKE_PHASES.CATCH
      if (maxDy > 0.03 && maxElbow > 130) return STROKE_PHASES.PULL
      return STROKE_PHASES.ENTRY
    }

    // 自由泳
    if (minDy < -0.06) return STROKE_PHASES.RECOVERY
    if (minElbow < 120 && maxDy < 0.04) return STROKE_PHASES.CATCH
    if (maxDy > 0.04 && maxElbow > 125) return STROKE_PHASES.PULL
    return STROKE_PHASES.ENTRY
  }

  const detectArmStroke = (landmarks, now) => {
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return
    if (frameBuffer.value.length < 3) return

    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]

    const prev = frameBuffer.value[frameBuffer.value.length - 3]
    const prevLW = prev.landmarks[KP.L_WRIST]
    const prevRW = prev.landmarks[KP.R_WRIST]

    let counted = false

    if (lw && ls && prevLW && lw.visibility > 0.35 && ls.visibility > 0.35) {
      const crossed = prevLW.y < ls.y && lw.y >= ls.y
      if (crossed) {
        strokeCount.value++
        counted = true
      }
    }

    if (!counted && rw && rs && prevRW && rw.visibility > 0.35 && rs.visibility > 0.35) {
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
    ]

    let total = 0
    let count = 0
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
    return landmarks.map((lm) => (lm ? { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility } : null))
  }

  const exportJSON = () => {
    const data = {
      exportTime: new Date().toISOString(),
      totalStrokes: strokeCount.value,
      detectedStyle: detectedStyle.value,
      detectedPhase: detectedPhase.value,
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
    detectedStyle: readonly(detectedStyle),
    detectedPhase: readonly(detectedPhase),
    strokeHistory: readonly(strokeHistory),
    analyze,
    reset,
    exportJSON,
    addStroke,
  }
}
