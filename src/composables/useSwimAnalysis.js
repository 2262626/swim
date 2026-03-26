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
  PREP: '准备姿势',
  ENTRY: '入水',
  CATCH: '抱水',
  PULL: '推水',
  RECOVERY: '回臂',
  GLIDE: '滑行',
  UNKNOWN: '准备',
}

const STYLE_STANDARDS = {
  [STROKE_TYPES.BUTTERFLY]: {
    name: '蝶泳标准 v2',
    thresholds: {
      armSyncYDiff: 0.07,
      armStraightDeg: 150,
      legCloseXDiff: 0.12,
      legStraightDeg: 155,
      waveAmplitude: 0.03,
      breathNoseLift: 0.02,
    },
  },
  [STROKE_TYPES.BREASTSTROKE]: {
    name: '蛙泳标准 v1',
    thresholds: {
      armSyncYDiff: 0.07,
      kneesWidthRatioMax: 1.15,
      ankleCloseXDiff: 0.16,
      handCloseXDiff: 0.12,
      pullBreathLift: 0.01,
      glideHeadDown: 0.0,
    },
  },
  [STROKE_TYPES.BACKSTROKE]: {
    name: '仰泳标准 v1',
    thresholds: {
      armAltYDiff: 0.08,
      armStraightDeg: 150,
      legAltYDiff: 0.035,
      bodyLineMax: 0.16,
      headShakeAmp: 0.03,
    },
  },
  [STROKE_TYPES.FREESTYLE]: {
    name: '自由泳标准 v1',
    thresholds: {
      armAltYDiff: 0.07,
      armStraightDeg: 145,
      legAltYDiff: 0.035,
      bodyRollAmp: 0.03,
      maxHeadLift: 0.065,
    },
  },
}

export function useSwimAnalysis() {
  const strokeCount = ref(0)
  const isRecording = ref(false)
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
  const EXPORT_SAMPLE_MS = 220

  let lastExportTime = 0
  let lastExportStrokeCount = 0

  const setUnknownDetection = () => {
    detectedStyle.value = STROKE_TYPES.UNKNOWN
    detectedPhase.value = STROKE_PHASES.UNKNOWN
    detectedStroke.value = `${detectedStyle.value}·${detectedPhase.value}`
  }

  const hasReliablePose = (landmarks) => {
    if (!Array.isArray(landmarks) || landmarks.length < 29) return false

    const mustHave = [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_HIP, KP.R_HIP]
    const coreReady = mustHave.every((idx) => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.38)
    if (!coreReady) return false

    const visibleCount = landmarks.reduce((count, lm) => count + ((lm && (lm.visibility ?? 0) > 0.28) ? 1 : 0), 0)
    return visibleCount >= 8
  }

  const reset = () => {
    strokeCount.value = 0
    strokeHistory.value = []
    lastStrokeTime = 0
    detectedStyle.value = STROKE_TYPES.UNKNOWN
    detectedPhase.value = STROKE_PHASES.UNKNOWN
    detectedStroke.value = `${detectedStyle.value}·${detectedPhase.value}`
    frameBuffer.length = 0
    exportBuffer.length = 0
    isRecording.value = false
    lastExportTime = 0
    lastExportStrokeCount = 0
  }

  const analyze = (landmarks, angles, forcedStyle = null) => {
    if (!landmarks || !hasReliablePose(landmarks)) {
      setUnknownDetection()
      return {
        style: STROKE_TYPES.UNKNOWN,
        phase: STROKE_PHASES.UNKNOWN,
        stroke: detectedStroke.value,
        strokeCount: strokeCount.value,
        strokeRate: calcStrokeRate(),
        symmetry: calcSymmetry(angles),
        angles,
        standardName: '通用规则',
        assessment: { score: null, items: [] },
        timestamp: Date.now(),
      }
    }

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

    const result = {
      style,
      phase,
      stroke: detectedStroke.value,
      strokeCount: strokeCount.value,
      strokeRate: calcStrokeRate(),
      symmetry: calcSymmetry(angles),
      angles,
      standardName: standard?.name || '通用规则',
      assessment,
      timestamp: now,
    }

    if (isRecording.value && exportBuffer.length < MAX_EXPORT) {
      const strokeChanged = strokeCount.value > lastExportStrokeCount
      const samplingDue = now - lastExportTime >= EXPORT_SAMPLE_MS

      if (samplingDue || strokeChanged) {
        exportBuffer.push(compactFrame(result))
        lastExportTime = now
        lastExportStrokeCount = strokeCount.value
      }
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

    if (!ls || !rs) return STROKE_PHASES.UNKNOWN

    if (isPrepPose(landmarks, angles)) {
      return STROKE_PHASES.PREP
    }

    if (!lw || !rw) return STROKE_PHASES.UNKNOWN

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

  const isPrepPose = (landmarks, angles) => {
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    if (!ls || !rs || !lh || !rh || !la || !ra) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const ankleY = (la.y + ra.y) / 2
    const torsoStanding = ankleY - shoulderY > 0.16
    const hipBelowShoulders = hipY > shoulderY + 0.05

    const leftWristReady =
      !!lw &&
      lw.y > shoulderY + 0.06 &&
      lw.y < ankleY + 0.1 &&
      Math.abs(lw.x - ls.x) < 0.34
    const rightWristReady =
      !!rw &&
      rw.y > shoulderY + 0.06 &&
      rw.y < ankleY + 0.1 &&
      Math.abs(rw.x - rs.x) < 0.34
    const wristReadyCount = (leftWristReady ? 1 : 0) + (rightWristReady ? 1 : 0)

    const leftElbow = angles.leftElbow ?? null
    const rightElbow = angles.rightElbow ?? null
    const leftElbowRelaxed = leftElbow == null || leftElbow > 100
    const rightElbowRelaxed = rightElbow == null || rightElbow > 100
    const elbowsRelaxed = leftElbowRelaxed && rightElbowRelaxed
    const headRelaxed = nose ? nose.y > shoulderY - 0.06 : true

    return (
      wristReadyCount >= 1 &&
      torsoStanding &&
      hipBelowShoulders &&
      elbowsRelaxed &&
      headRelaxed
    )
  }

  const evaluateTechnique = (style, phase, landmarks, angles, standard) => {
    if (phase === STROKE_PHASES.PREP) {
      return evaluatePrepPose(landmarks, angles)
    }

    if (!standard) return { score: null, items: [] }

    if (style === STROKE_TYPES.BUTTERFLY) {
      return evaluateButterfly(phase, landmarks, angles, standard)
    }
    if (style === STROKE_TYPES.BREASTSTROKE) {
      return evaluateBreaststroke(phase, landmarks, angles, standard)
    }
    if (style === STROKE_TYPES.BACKSTROKE) {
      return evaluateBackstroke(landmarks, angles, standard)
    }
    if (style === STROKE_TYPES.FREESTYLE) {
      return evaluateFreestyle(phase, landmarks, angles, standard)
    }

    return { score: null, items: [] }
  }

  const evaluatePrepPose = (landmarks, angles) => {
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    if (!ls || !rs || !lw || !rw || !lh || !rh || !la || !ra) {
      return { score: null, items: [] }
    }

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const ankleY = (la.y + ra.y) / 2
    const ankleWidth = Math.abs(la.x - ra.x)
    const shoulderWidth = Math.abs(ls.x - rs.x)

    const handsDown = lw.y > shoulderY + 0.08 && rw.y > shoulderY + 0.08
    const armsRelaxed = (angles.leftElbow ?? 180) > 130 && (angles.rightElbow ?? 180) > 130
    const headRelaxed = nose ? nose.y > shoulderY - 0.06 : true
    const feetStable = shoulderWidth > 0 ? ankleWidth >= shoulderWidth * 0.45 && ankleWidth <= shoulderWidth * 1.45 : false
    const bodyReady = ankleY - shoulderY > 0.16 && hipY > shoulderY + 0.05

    return makeAssessment([
      createItem('prepBody', '身体准备', bodyReady, '站姿稳定，重心准备充分', '身体姿态不稳或未进入准备站姿'),
      createItem('prepArms', '手臂放松', handsDown && armsRelaxed, '手臂自然下垂并保持放松', '手臂抬起或过度弯曲'),
      createItem('prepHead', '头部放松', headRelaxed, '头部放松，目视下方', '头部抬起较多，颈部偏紧'),
      createItem('prepFeet', '双脚站稳', feetStable, '双脚间距合理，站立稳定', '双脚间距异常或站姿不稳定'),
    ])
  }

  const evaluateButterfly = (phase, landmarks, angles, standard) => {
    const t = standard.thresholds
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
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

    return makeAssessment([
      createItem('armSync', '双臂同步', armSync, '双臂高度基本同步', '双臂不同步，一高一低'),
      createItem('armStraight', '手臂伸直', armStraight, '手臂出水与前伸较直', '肘部弯曲偏大'),
      createItem('bodyWave', '躯干波浪', bodyWave, '躯干起伏波浪感良好', '躯干起伏不足，动作偏僵硬'),
      createItem('legClose', '双腿并拢', legClose, '膝踝间距控制良好', '双腿分离偏大'),
      createItem('legStraight', '腿部伸直', legStraight, '鞭状打腿较完整', '膝关节弯曲偏大'),
      createItem('breathTiming', '呼吸时机', breathTiming, '呼吸时机与发力阶段匹配', '呼吸时机偏早或偏晚'),
    ])
  }

  const evaluateBreaststroke = (phase, landmarks, angles, standard) => {
    const t = standard.thresholds
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lk = landmarks[KP.L_KNEE]
    const rk = landmarks[KP.R_KNEE]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    const shoulderWidth = ls && rs ? Math.abs(ls.x - rs.x) : null
    const kneeWidth = lk && rk ? Math.abs(lk.x - rk.x) : null
    const ankleWidth = la && ra ? Math.abs(la.x - ra.x) : null
    const handSpan = lw && rw ? Math.abs(lw.x - rw.x) : null
    const avgKnee = average(angles.leftKnee, angles.rightKnee)

    const armSync = lw && rw ? Math.abs(lw.y - rw.y) <= t.armSyncYDiff : false
    const kneesWidthOk =
      shoulderWidth != null && kneeWidth != null ? kneeWidth <= shoulderWidth * t.kneesWidthRatioMax : false
    const legClamp = ankleWidth != null ? ankleWidth <= t.ankleCloseXDiff : false
    const frontGlide = handSpan != null ? handSpan <= t.handCloseXDiff : false

    let timingOk = false
    if (avgKnee != null) {
      const pullPhase = phase === STROKE_PHASES.CATCH || phase === STROKE_PHASES.PULL
      timingOk = pullPhase ? avgKnee > 130 : avgKnee < 145 || legClamp
    }

    let breathTiming = false
    if (nose && ls && rs) {
      const shoulderMidY = (ls.y + rs.y) / 2
      const lifted = nose.y < shoulderMidY - t.pullBreathLift
      breathTiming = phase === STROKE_PHASES.PULL ? lifted : nose.y >= shoulderMidY - t.glideHeadDown
    }

    return makeAssessment([
      createItem('armSync', '双臂对称', armSync, '双臂划水节奏同步', '双臂节奏不同步'),
      createItem('kneesWidth', '收腿宽度', kneesWidthOk, '膝盖未明显外翻', '膝盖外开过大'),
      createItem('legClamp', '蹬夹到位', legClamp, '蹬夹后双腿能并拢', '蹬夹后双腿未并拢'),
      createItem('frontGlide', '前伸滑行', frontGlide, '双手前伸收拢较好', '前伸不足，滑行不明显'),
      createItem('timing', '手腿配合', timingOk, '手腿时序基本正确', '手腿时序重叠明显'),
      createItem('breathTiming', '呼吸配合', breathTiming, '抬头吸气时机合理', '抬头时机与动作阶段不匹配'),
    ])
  }

  const evaluateBackstroke = (landmarks, angles, standard) => {
    const t = standard.thresholds
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    const shoulderMidY = ls && rs ? (ls.y + rs.y) / 2 : null
    const hipMidY = lh && rh ? (lh.y + rh.y) / 2 : null
    const bodyLineDelta = shoulderMidY != null && hipMidY != null ? Math.abs(shoulderMidY - hipMidY) : null
    const armAlternate = lw && rw ? Math.abs(lw.y - rw.y) >= t.armAltYDiff : false
    const armStraight =
      (angles.leftElbow ?? null) != null && (angles.rightElbow ?? null) != null
        ? Math.max(angles.leftElbow, angles.rightElbow) >= t.armStraightDeg
        : false
    const legAlternate = la && ra ? Math.abs(la.y - ra.y) >= t.legAltYDiff : false
    const bodyLine = bodyLineDelta != null ? bodyLineDelta <= t.bodyLineMax : false
    const headStable = calcHeadStability(t.headShakeAmp)
    const faceUp = nose && shoulderMidY != null ? nose.y < shoulderMidY : false

    return makeAssessment([
      createItem('faceUp', '仰卧姿态', faceUp, '头部保持仰卧方向', '头部朝向不稳定'),
      createItem('armAlternate', '交替划臂', armAlternate, '双臂交替节奏清晰', '双臂同向动作较多'),
      createItem('armStraight', '出水伸直', armStraight, '出水移臂较伸直', '移臂时肘部弯曲偏大'),
      createItem('legAlternate', '交替打腿', legAlternate, '双腿交替打腿有效', '双腿交替幅度不足'),
      createItem('bodyLine', '身体平直', bodyLine, '肩髋连线稳定', '身体起伏或折腰较明显'),
      createItem('headStable', '头部稳定', headStable, '头部晃动较小', '头部晃动偏大'),
    ])
  }

  const evaluateFreestyle = (phase, landmarks, angles, standard) => {
    const t = standard.thresholds
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    const armAlternate = lw && rw ? Math.abs(lw.y - rw.y) >= t.armAltYDiff : false
    const armStraight =
      (angles.leftElbow ?? null) != null && (angles.rightElbow ?? null) != null
        ? Math.max(angles.leftElbow, angles.rightElbow) >= t.armStraightDeg
        : false
    const legAlternate = la && ra ? Math.abs(la.y - ra.y) >= t.legAltYDiff : false
    const bodyRoll = calcBodyRollAmplitude() >= t.bodyRollAmp

    let breathTiming = false
    if (nose && ls && rs) {
      const shoulderMidY = (ls.y + rs.y) / 2
      const liftedTooMuch = nose.y < shoulderMidY - t.maxHeadLift
      breathTiming = phase === STROKE_PHASES.RECOVERY ? !liftedTooMuch : !liftedTooMuch
    }

    return makeAssessment([
      createItem('armAlternate', '交替划臂', armAlternate, '双臂交替节奏清晰', '双臂交替不明显'),
      createItem('armStraight', '移臂伸直', armStraight, '移臂阶段手臂较伸直', '移臂阶段肘部弯曲偏大'),
      createItem('legAlternate', '交替打腿', legAlternate, '打腿节奏连续', '打腿幅度或节奏不足'),
      createItem('bodyRoll', '身体滚动', bodyRoll, '转体滚动幅度合适', '身体过僵，滚动不足'),
      createItem('breathTiming', '呼吸控制', breathTiming, '呼吸抬头幅度控制良好', '抬头过高，影响流线型'),
    ])
  }

  const createItem = (key, label, ok, okDetail, badDetail) => ({
    key,
    label,
    ok,
    detail: ok ? okDetail : badDetail,
  })

  const makeAssessment = (items) => {
    const okCount = items.filter((item) => item.ok).length
    return {
      score: Math.round((okCount / items.length) * 100),
      items,
    }
  }

  const calcButterflyBodyWave = (standard) => {
    const t = standard.thresholds
    if (frameBuffer.length < 8) return false

    const deltas = frameBuffer
      .slice(-12)
      .map((frame) => {
        const ls = frame.landmarks[KP.L_SHOULDER]
        const rs = frame.landmarks[KP.R_SHOULDER]
        const lh = frame.landmarks[KP.L_HIP]
        const rh = frame.landmarks[KP.R_HIP]
        if (!ls || !rs || !lh || !rh) return null
        const shoulderMidY = (ls.y + rs.y) / 2
        const hipMidY = (lh.y + rh.y) / 2
        return shoulderMidY - hipMidY
      })
      .filter((value) => value != null)

    if (deltas.length < 6) return false

    const maxD = Math.max(...deltas)
    const minD = Math.min(...deltas)
    return Math.abs(maxD - minD) >= t.waveAmplitude
  }

  const calcBodyRollAmplitude = () => {
    if (frameBuffer.length < 8) return 0
    const values = frameBuffer
      .slice(-12)
      .map((frame) => {
        const ls = frame.landmarks[KP.L_SHOULDER]
        const rs = frame.landmarks[KP.R_SHOULDER]
        if (!ls || !rs) return null
        return ls.x - rs.x
      })
      .filter((value) => value != null)

    if (values.length < 6) return 0
    return Math.abs(Math.max(...values) - Math.min(...values))
  }

  const calcHeadStability = (maxAmplitude) => {
    if (frameBuffer.length < 8) return false
    const values = frameBuffer
      .slice(-12)
      .map((frame) => {
        const nose = frame.landmarks[KP.NOSE]
        return nose ? nose.x : null
      })
      .filter((value) => value != null)

    if (values.length < 6) return false
    const amp = Math.abs(Math.max(...values) - Math.min(...values))
    return amp <= maxAmplitude
  }

  const average = (a, b) => {
    if (a == null || b == null) return null
    return (a + b) / 2
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
    for (const [leftKey, rightKey] of pairs) {
      if (angles[leftKey] != null && angles[rightKey] != null) {
        const diff = Math.abs(angles[leftKey] - angles[rightKey])
        total += Math.max(0, 100 - diff)
        count++
      }
    }

    return count > 0 ? Math.round(total / count) : null
  }

  const serializeLandmarks = (landmarks) => {
    return landmarks.map((lm) => (lm ? { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility } : null))
  }

  const pickAngle = (value) => (value == null ? null : Math.round(value))

  const compactFrame = (result) => {
    const issues = (result.assessment?.items || []).filter((item) => !item.ok).map((item) => item.key)
    return {
      t: result.timestamp,
      style: result.style,
      phase: result.phase,
      strokeCount: result.strokeCount,
      strokeRate: result.strokeRate,
      symmetry: result.symmetry,
      score: result.assessment?.score ?? null,
      issues,
      angles: {
        leftElbow: pickAngle(result.angles?.leftElbow),
        rightElbow: pickAngle(result.angles?.rightElbow),
        leftShoulder: pickAngle(result.angles?.leftShoulder),
        rightShoulder: pickAngle(result.angles?.rightShoulder),
        leftKnee: pickAngle(result.angles?.leftKnee),
        rightKnee: pickAngle(result.angles?.rightKnee),
      },
    }
  }

  const startRecording = () => {
    exportBuffer.length = 0
    isRecording.value = true
    lastExportTime = 0
    lastExportStrokeCount = strokeCount.value
  }

  const stopRecording = () => {
    isRecording.value = false
  }

  const toggleRecording = () => {
    if (isRecording.value) {
      stopRecording()
    } else {
      startRecording()
    }
    return isRecording.value
  }

  const exportJSON = () => {
    if (!exportBuffer.length) return false

    const data = {
      exportTime: new Date().toISOString(),
      formatVersion: 'compact-v2',
      sampleIntervalMs: EXPORT_SAMPLE_MS,
      frameCount: exportBuffer.length,
      totalStrokes: strokeCount.value,
      detectedStyle: detectedStyle.value,
      detectedPhase: detectedPhase.value,
      frames: exportBuffer,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `swim-data-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    return true
  }

  const addStroke = () => {
    strokeCount.value++
  }

  return {
    strokeCount: readonly(strokeCount),
    isRecording: readonly(isRecording),
    detectedStroke: readonly(detectedStroke),
    detectedStyle: readonly(detectedStyle),
    detectedPhase: readonly(detectedPhase),
    strokeHistory: readonly(strokeHistory),
    analyze,
    reset,
    exportJSON,
    startRecording,
    stopRecording,
    toggleRecording,
    addStroke,
    setUnknownDetection,
  }
}
