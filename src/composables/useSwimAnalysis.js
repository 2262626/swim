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

const STYLE_STANDARDS = {
  蝶泳: {
    name: '蝶泳标准 v1',
    thresholds: {
      armSyncYDiff: 0.07,
      armStraightDeg: 150,
      legCloseXDiff: 0.12,
      legStraightDeg: 155,
      waveAmplitude: 0.03,
      breathNoseLift: 0.02,
    },
  },
}

export function useSwimAnalysis() {
  const strokeCount = ref(0)
  const detectedStyle = ref(STROKE_TYPES.UNKNOWN)
  const detectedPhase = ref(STROKE_PHASES.UNKNOWN)
  const detectedStroke = ref(`${STROKE_TYPES.UNKNOWN}·${STROKE_PHASES.UNKNOWN}`)
  const strokeHistory = ref([])

  const exportBuffer = []
  const frameBuffer = []

  let lastStrokeTime = 0

  const BUFFER_SIZE = 30
  const STROKE_COOLDOWN_MS = 450
  const MAX_EXPORT = 2000

  const reset = () => {
    strokeCount.value = 0
    strokeHistory.value = []
    lastStrokeTime = 0
    detectedStyle.value = STROKE_TYPES.UNKNOWN
    detectedPhase.value = STROKE_PHASES.UNKNOWN
    detectedStroke.value = `${detectedStyle.value}·${detectedPhase.value}`
    frameBuffer.length = 0
    exportBuffer.length = 0
  }

  const analyze = (landmarks, angles, forcedStyle = null) => {
    if (!landmarks) return null

    const now = Date.now()

    frameBuffer.push({ now, landmarks: serializeLandmarks(landmarks) })
    if (frameBuffer.length > BUFFER_SIZE) frameBuffer.shift()

    const style = forcedStyle || classifyStyle(landmarks, angles)
    const phase = classifyPhaseByStyle(style, landmarks, angles)

    detectedStyle.value = style
    detectedPhase.value = phase
    detectedStroke.value = `${style}·${phase}`

    if (frameBuffer.length >= 4) {
      detectArmStroke(landmarks, now)
    }

    const standard = STYLE_STANDARDS[style] || null
    const assessment = evaluateTechnique(style, phase, landmarks, angles, standard)

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
      standardName: standard?.name || '通用规则',
      assessment,
      timestamp: now,
    }

    if (exportBuffer.length < MAX_EXPORT) {
      exportBuffer.push(result)
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

    if (nose && nose.visibility > 0.35 && nose.y < shoulderMidY - 0.08) {
      return STROKE_TYPES.BACKSTROKE
    }

    const wristYDiff = Math.abs(lw.y - rw.y)
    const wristXSpan = Math.abs(lw.x - rw.x)
    const elbowBent = (angles.leftElbow ?? 180) < 120 || (angles.rightElbow ?? 180) < 120

    if (wristYDiff < 0.06 && wristXSpan > 0.32) {
      return STROKE_TYPES.BUTTERFLY
    }

    const shoulderMidX = (ls.x + rs.x) / 2
    const wristMidX = (lw.x + rw.x) / 2
    const wristsCentered = Math.abs(wristMidX - shoulderMidX) < 0.1
    if (wristsCentered && wristXSpan < 0.3 && elbowBent) {
      return STROKE_TYPES.BREASTSTROKE
    }

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

    if (minDy < -0.06) return STROKE_PHASES.RECOVERY
    if (minElbow < 120 && maxDy < 0.04) return STROKE_PHASES.CATCH
    if (maxDy > 0.04 && maxElbow > 125) return STROKE_PHASES.PULL
    return STROKE_PHASES.ENTRY
  }

  const evaluateTechnique = (style, phase, landmarks, angles, standard) => {
    if (style !== STROKE_TYPES.BUTTERFLY || !standard) {
      return {
        score: null,
        items: [],
      }
    }

    const t = standard.thresholds

    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const lk = landmarks[KP.L_KNEE]
    const rk = landmarks[KP.R_KNEE]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    const leftElbow = angles.leftElbow ?? null
    const rightElbow = angles.rightElbow ?? null
    const leftKnee = angles.leftKnee ?? null
    const rightKnee = angles.rightKnee ?? null

    const armSync = lw && rw ? Math.abs(lw.y - rw.y) <= t.armSyncYDiff : false
    const armStraight =
      leftElbow != null && rightElbow != null
        ? leftElbow >= t.armStraightDeg && rightElbow >= t.armStraightDeg
        : false

    const legClose =
      lk && rk && la && ra
        ? Math.abs(lk.x - rk.x) <= t.legCloseXDiff && Math.abs(la.x - ra.x) <= t.legCloseXDiff
        : false

    const legStraight =
      leftKnee != null && rightKnee != null
        ? leftKnee >= t.legStraightDeg && rightKnee >= t.legStraightDeg
        : false

    const bodyWave = calcButterflyBodyWave(standard)

    let breathTiming = false
    if (nose && ls && rs) {
      const shoulderMidY = (ls.y + rs.y) / 2
      const lifted = nose.y < shoulderMidY - t.breathNoseLift
      breathTiming = phase === STROKE_PHASES.PULL ? lifted : !lifted
    }

    const items = [
      {
        key: 'armSync',
        label: '双臂同步',
        ok: armSync,
        detail: armSync ? '双臂基本同高' : '双臂不同步，一高一低',
      },
      {
        key: 'armStraight',
        label: '手臂伸直',
        ok: armStraight,
        detail: armStraight ? '出水与前伸较直' : '肘关节弯曲偏大',
      },
      {
        key: 'bodyWave',
        label: '躯干波浪',
        ok: bodyWave,
        detail: bodyWave ? '髋肩起伏有波浪' : '躯干起伏不足，偏僵硬',
      },
      {
        key: 'legClose',
        label: '双腿并拢',
        ok: legClose,
        detail: legClose ? '膝踝间距正常' : '双腿分离偏大',
      },
      {
        key: 'legStraight',
        label: '腿部伸直',
        ok: legStraight,
        detail: legStraight ? '鞭状打腿较直' : '膝关节弯曲偏大',
      },
      {
        key: 'breathTiming',
        label: '呼吸配合',
        ok: breathTiming,
        detail: breathTiming ? '抬头时机匹配阶段' : '呼吸抬头时机不匹配',
      },
    ]

    const okCount = items.filter((i) => i.ok).length
    const score = Math.round((okCount / items.length) * 100)

    return {
      score,
      items,
    }
  }

  const calcButterflyBodyWave = (standard) => {
    const t = standard.thresholds
    if (frameBuffer.length < 8) return false

    const deltas = frameBuffer
      .slice(-12)
      .map((f) => {
        const ls = f.landmarks[KP.L_SHOULDER]
        const rs = f.landmarks[KP.R_SHOULDER]
        const lh = f.landmarks[KP.L_HIP]
        const rh = f.landmarks[KP.R_HIP]
        if (!ls || !rs || !lh || !rh) return null
        const shoulderMidY = (ls.y + rs.y) / 2
        const hipMidY = (lh.y + rh.y) / 2
        return shoulderMidY - hipMidY
      })
      .filter((v) => v != null)

    if (deltas.length < 6) return false

    const maxD = Math.max(...deltas)
    const minD = Math.min(...deltas)
    return Math.abs(maxD - minD) >= t.waveAmplitude
  }

  const detectArmStroke = (landmarks, now) => {
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return
    if (frameBuffer.length < 3) return

    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]

    const prev = frameBuffer[frameBuffer.length - 3]
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
      frames: exportBuffer,
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
