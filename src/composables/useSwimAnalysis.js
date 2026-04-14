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
  TRANSITION: '过渡动作',
  ENTRY: '入水',
  CATCH: '抱水',
  PULL: '推水',
  RECOVERY: '回臂',
  GLIDE: '滑行',
  UNKNOWN: '准备',
}

const ANALYSIS_STAGES = {
  INVALID: 'INVALID',
  PREP: 'PREP',
  START: 'START',
  UNDERWATER: 'UNDERWATER',
  TRANSITION: 'TRANSITION',
  TURN: 'TURN',
  FINISH: 'FINISH',
  SWIM_ACTIVE: 'SWIM_ACTIVE',
}

const STAGE_LABELS = {
  [ANALYSIS_STAGES.INVALID]: '证据不足',
  [ANALYSIS_STAGES.PREP]: '准备阶段',
  [ANALYSIS_STAGES.START]: '起跳阶段',
  [ANALYSIS_STAGES.UNDERWATER]: '水下阶段',
  [ANALYSIS_STAGES.TRANSITION]: '过渡阶段',
  [ANALYSIS_STAGES.TURN]: '转身阶段',
  [ANALYSIS_STAGES.FINISH]: '结束阶段',
  [ANALYSIS_STAGES.SWIM_ACTIVE]: '有效划水',
}

const CAMERA_PROFILE_CONFIG = {
  side: {
    key: 'side',
    label: '池边侧拍',
    motionAxis: 'y',
    minPixels: 960 * 540,
    minVisibleCount: 12,
    minConfidence: 0.42,
    minBodyHeight: 0.22,
    minEdgeMargin: 0.03,
    startMotionMultiplier: 1.25,
    horizontalTorsoMax: 0.14,
  },
  diagonal: {
    key: 'diagonal',
    label: '斜侧拍',
    motionAxis: 'y',
    minPixels: 960 * 540,
    minVisibleCount: 12,
    minConfidence: 0.42,
    minBodyHeight: 0.24,
    minEdgeMargin: 0.03,
    startMotionMultiplier: 1.28,
    horizontalTorsoMax: 0.16,
  },
  front: {
    key: 'front',
    label: '正前/正后拍',
    motionAxis: 'x',
    minPixels: 1280 * 720,
    minVisibleCount: 13,
    minConfidence: 0.45,
    minBodyHeight: 0.26,
    minEdgeMargin: 0.04,
    startMotionMultiplier: 1.32,
    horizontalTorsoMax: 0.18,
  },
  underwater: {
    key: 'underwater',
    label: '水下侧拍',
    motionAxis: 'y',
    minPixels: 1280 * 720,
    minVisibleCount: 12,
    minConfidence: 0.36,
    minBodyHeight: 0.22,
    minEdgeMargin: 0.03,
    startMotionMultiplier: 1.2,
    horizontalTorsoMax: 0.16,
  },
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
      kneeStraightDeg: 145,
      bodyLineMax: 0.16,
      headShakeAmp: 0.03,
    },
  },
  [STROKE_TYPES.FREESTYLE]: {
    name: '自由泳标准 v1',
    thresholds: {
      armAltYDiff: 0.07,
      armStraightDeg: 145,
      kneeAltYDiff: 0.02,
      legAltYDiff: 0.035,
      bodyRollAmp: 0.03,
      bodyRollHipAmp: 0.025,
      bodyLineMax: 0.16,
      hipLineDevMax: 0.08,
      kneeStraightDeg: 145,
      breathTurnXAmp: 0.015,
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
  let lastStableStage = ANALYSIS_STAGES.INVALID
  const counterState = {
    freestyle: { armed: true, lastSide: '' },
    backstroke: { armed: true, lastSide: '' },
    breaststroke: { loaded: false },
    butterfly: { loaded: false },
  }

  const BUFFER_SIZE = 30
  const STROKE_COOLDOWN_MS = 450
  const MAX_EXPORT = 2000
  const EXPORT_SAMPLE_MS = 220
  const MOTION_WINDOW = 10
  const WRIST_ACTIVE_MOTION = 0.05
  const ANKLE_ACTIVE_MOTION = 0.035
  const MOTION_ACTIVE_CONFIRM_FRAMES = 3
  const MOTION_INACTIVE_CONFIRM_FRAMES = 3
  const TRANSITION_MAX_HOLD_FRAMES = 8
  const UNDERWATER_CONFIRM_FRAMES = 2
  const TURN_CONFIRM_FRAMES = 2
  const FINISH_CONFIRM_FRAMES = 6

  let lastExportTime = 0
  let lastExportStrokeCount = 0
  let motionActiveStreak = 0
  let motionInactiveStreak = 0
  let transitionHoldFrames = 0
  let underwaterStreak = 0
  let turnStreak = 0
  let finishStreak = 0

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

    const extremityReadyCount = [KP.L_WRIST, KP.R_WRIST, KP.L_ANKLE, KP.R_ANKLE]
      .reduce((count, idx) => count + ((landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.26) ? 1 : 0), 0)
    if (extremityReadyCount < 2) return false

    const visibleCount = landmarks.reduce((count, lm) => count + ((lm && (lm.visibility ?? 0) > 0.28) ? 1 : 0), 0)
    return visibleCount >= 10
  }

  const getCameraProfile = (cameraProfile) => CAMERA_PROFILE_CONFIG[cameraProfile] || CAMERA_PROFILE_CONFIG.side

  const formatStrokeLabel = (style, phase) => `${style}·${phase}`

  const calcAverageVisibility = (landmarks) => {
    const visible = landmarks.filter((lm) => lm && (lm.visibility ?? 0) > 0)
    if (!visible.length) return 0
    return visible.reduce((sum, lm) => sum + (lm.visibility ?? 0), 0) / visible.length
  }

  const calcBounds = (landmarks, indexes) => {
    const points = indexes
      .map((idx) => landmarks[idx])
      .filter((point) => point && (point.visibility ?? 0) > 0.2)

    if (!points.length) return null

    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  const assessFrameQuality = (landmarks, options = {}) => {
    const profile = getCameraProfile(options.cameraProfile)
    const frameWidth = Number(options.frameWidth || 0)
    const frameHeight = Number(options.frameHeight || 0)
    const visibleCount = landmarks.reduce((count, lm) => count + ((lm && (lm.visibility ?? 0) > 0.28) ? 1 : 0), 0)
    const avgConfidence = calcAverageVisibility(landmarks)
    const criticalIndexes = [
      KP.L_SHOULDER,
      KP.R_SHOULDER,
      KP.L_HIP,
      KP.R_HIP,
      KP.L_WRIST,
      KP.R_WRIST,
      KP.L_ANKLE,
      KP.R_ANKLE,
    ]
    const bounds = calcBounds(landmarks, criticalIndexes)
    const bodyHeight = bounds ? bounds.maxY - bounds.minY : 0
    const edgeMargin = bounds
      ? Math.min(bounds.minX, 1 - bounds.maxX, bounds.minY, 1 - bounds.maxY)
      : 0
    const limbReadyCount = [KP.L_WRIST, KP.R_WRIST, KP.L_ANKLE, KP.R_ANKLE]
      .reduce((count, idx) => count + ((landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.26) ? 1 : 0), 0)
    const reasons = []
    const warnings = []

    if (frameWidth && frameHeight && frameWidth * frameHeight < profile.minPixels) {
      reasons.push('视频分辨率不足，建议至少 960x540')
    }
    if (visibleCount < profile.minVisibleCount) {
      reasons.push('有效关键点不足，当前帧不适合判定')
    }
    if (avgConfidence < profile.minConfidence) {
      reasons.push('骨骼置信度不足，当前帧不适合判定')
    }
    if (bodyHeight < profile.minBodyHeight) {
      reasons.push('人物在画面中占比过小，建议拍近一些')
    }
    if (limbReadyCount < 2) {
      reasons.push('关键肢体遮挡严重，当前帧不适合判定')
    }
    if (edgeMargin < profile.minEdgeMargin) {
      reasons.push('人物过于贴近画面边缘')
    }
    if (profile.key !== 'side') {
      warnings.push(`当前机位为${profile.label}，稳定性通常低于标准侧拍`)
    }

    const penalties = [
      reasons.length * 18,
      warnings.length * 6,
      visibleCount < profile.minVisibleCount ? 12 : 0,
      avgConfidence < profile.minConfidence ? Math.round((profile.minConfidence - avgConfidence) * 100) : 0,
      bodyHeight < profile.minBodyHeight ? Math.round((profile.minBodyHeight - bodyHeight) * 160) : 0,
    ]
    const qualityScore = Math.max(0, 100 - penalties.reduce((sum, value) => sum + value, 0))
    const qualityLabel =
      qualityScore >= 80
        ? '高'
        : qualityScore >= 60
          ? '中'
          : '低'

    return {
      judgeable: reasons.length === 0,
      score: qualityScore,
      label: qualityLabel,
      reasons,
      warnings,
      cameraProfile: profile.key,
      cameraProfileLabel: profile.label,
      metrics: {
        visibleCount,
        avgConfidence: Number(avgConfidence.toFixed(4)),
        bodyHeight: Number(bodyHeight.toFixed(4)),
        edgeMargin: Number(edgeMargin.toFixed(4)),
        frameWidth,
        frameHeight,
      },
    }
  }

  const makeNeutralAssessment = (key, label, detail) => ({
    score: null,
    items: [
      {
        key,
        label,
        ok: null,
        detail,
      },
    ],
  })

  const buildAnalysisResult = ({
    style = STROKE_TYPES.UNKNOWN,
    phase = STROKE_PHASES.UNKNOWN,
    stage = ANALYSIS_STAGES.INVALID,
    angles = {},
    standardName = '通用规则',
    assessment = { score: null, items: [] },
    timestamp = Date.now(),
    judgeable = false,
    rejectionReason = '',
    quality = null,
    styleSource = 'unknown',
  }) => {
    detectedStyle.value = style
    detectedPhase.value = phase
    detectedStroke.value = formatStrokeLabel(style, phase)
    lastStableStage = stage

    return {
      style,
      phase,
      stage,
      stageLabel: STAGE_LABELS[stage] || STAGE_LABELS[ANALYSIS_STAGES.INVALID],
      styleSource,
      stroke: detectedStroke.value,
      strokeCount: strokeCount.value,
      strokeRate: calcStrokeRate(),
      symmetry: calcSymmetry(angles),
      angles,
      standardName,
      assessment,
      timestamp,
      judgeable,
      rejectionReason,
      quality,
      metricsEligible: judgeable && stage === ANALYSIS_STAGES.SWIM_ACTIVE,
      captureEligible: judgeable && stage === ANALYSIS_STAGES.SWIM_ACTIVE,
      autoPauseEligible: judgeable && stage === ANALYSIS_STAGES.SWIM_ACTIVE,
    }
  }

  const reset = () => {
    strokeCount.value = 0
    strokeHistory.value = []
    lastStrokeTime = 0
    lastStableStage = ANALYSIS_STAGES.INVALID
    detectedStyle.value = STROKE_TYPES.UNKNOWN
    detectedPhase.value = STROKE_PHASES.UNKNOWN
    detectedStroke.value = `${detectedStyle.value}·${detectedPhase.value}`
    frameBuffer.length = 0
    exportBuffer.length = 0
    isRecording.value = false
    lastExportTime = 0
    lastExportStrokeCount = 0
    motionActiveStreak = 0
    motionInactiveStreak = 0
    transitionHoldFrames = 0
    underwaterStreak = 0
    turnStreak = 0
    finishStreak = 0
    counterState.freestyle = { armed: true, lastSide: '' }
    counterState.backstroke = { armed: true, lastSide: '' }
    counterState.breaststroke = { loaded: false }
    counterState.butterfly = { loaded: false }
  }

  const getStagePhase = (stage) => {
    if (stage === ANALYSIS_STAGES.PREP) return STROKE_PHASES.PREP
    if (stage === ANALYSIS_STAGES.UNDERWATER) return STROKE_PHASES.ENTRY
    if (stage === ANALYSIS_STAGES.FINISH) return STROKE_PHASES.GLIDE
    return STROKE_PHASES.TRANSITION
  }

  const getStageAssessment = (stage, landmarks, angles) => {
    if (stage === ANALYSIS_STAGES.PREP) {
      return {
        assessment: evaluatePrepPose(landmarks, angles),
        standardName: '准备姿势规则',
      }
    }

    if (stage === ANALYSIS_STAGES.START) {
      return {
        assessment: makeNeutralAssessment('startState', '起跳发力', '检测到起跳准备或爆发发力，当前不进行泳姿评分'),
        standardName: '起跳阶段规则',
      }
    }

    if (stage === ANALYSIS_STAGES.UNDERWATER) {
      return {
        assessment: makeNeutralAssessment('underwaterState', '水下滑行', '检测到入水后水下滑行阶段，当前不进行泳姿评分'),
        standardName: '水下阶段规则',
      }
    }

    if (stage === ANALYSIS_STAGES.TURN) {
      return {
        assessment: makeNeutralAssessment('turnState', '转身动作', '检测到靠壁转身或团身动作，当前不进行泳姿评分'),
        standardName: '转身阶段规则',
      }
    }

    if (stage === ANALYSIS_STAGES.FINISH) {
      return {
        assessment: makeNeutralAssessment('finishState', '结束收势', '检测到收势或触壁结束阶段，当前不进行泳姿评分'),
        standardName: '结束阶段规则',
      }
    }

    return {
      assessment: makeNeutralAssessment('transitionState', '动作过渡', '检测到起跳、转身或出水过渡，当前不进行泳姿评分'),
      standardName: '过渡阶段规则',
    }
  }

  const analyze = (landmarks, angles, options = null) => {
    const targetStyle = typeof options === 'string' ? null : options?.targetStyle ?? null
    const cameraProfile = typeof options === 'string' ? 'side' : options?.cameraProfile ?? 'side'
    const frameWidth = typeof options === 'string' ? 0 : options?.frameWidth ?? 0
    const frameHeight = typeof options === 'string' ? 0 : options?.frameHeight ?? 0

    if (!landmarks || !hasReliablePose(landmarks)) {
      setUnknownDetection()
      return buildAnalysisResult({
        stage: ANALYSIS_STAGES.INVALID,
        angles,
        quality: {
          judgeable: false,
          score: 0,
          label: '低',
          reasons: ['关键点不足，当前帧无法判定'],
          warnings: [],
          cameraProfile,
          cameraProfileLabel: getCameraProfile(cameraProfile).label,
          metrics: {
            visibleCount: 0,
            avgConfidence: 0,
            bodyHeight: 0,
            edgeMargin: 0,
            frameWidth,
            frameHeight,
          },
        },
        rejectionReason: '关键点不足，当前帧不做评分',
        assessment: makeNeutralAssessment('evidenceInsufficient', '证据不足', '当前帧关键点不足，暂不进行动作评分'),
      })
    }

    const now = Date.now()

    frameBuffer.push({ now, landmarks: serializeLandmarks(landmarks) })
    if (frameBuffer.length > BUFFER_SIZE) frameBuffer.shift()

    const quality = assessFrameQuality(landmarks, {
      cameraProfile,
      frameWidth,
      frameHeight,
    })
    const motionGate = isSwimMotionActive(landmarks, angles, cameraProfile)

    if (motionGate.stage !== ANALYSIS_STAGES.SWIM_ACTIVE) {
      const stageAssessment = getStageAssessment(motionGate.stage, landmarks, angles)

      return buildAnalysisResult({
        style: STROKE_TYPES.UNKNOWN,
        phase: getStagePhase(motionGate.stage),
        stage: motionGate.stage,
        angles,
        assessment: stageAssessment.assessment,
        standardName: stageAssessment.standardName,
        timestamp: now,
        quality,
        rejectionReason: motionGate.reason || '等待进入有效划水阶段',
      })
    }

    if (!quality.judgeable) {
      return buildAnalysisResult({
        stage: ANALYSIS_STAGES.INVALID,
        angles,
        quality,
        rejectionReason: quality.reasons[0] || '证据不足，当前不做评分',
        assessment: makeNeutralAssessment(
          'evidenceInsufficient',
          '证据不足',
          quality.reasons[0] || '当前帧证据不足，暂不进行动作评分'
        ),
      })
    }

    const detectedStyleCandidate = classifyStyle(landmarks, angles)
    const styleSource =
      detectedStyleCandidate !== STROKE_TYPES.UNKNOWN
        ? 'detected'
        : targetStyle
          ? 'target_fallback'
          : 'unknown'
    const style =
      detectedStyleCandidate !== STROKE_TYPES.UNKNOWN
        ? detectedStyleCandidate
        : targetStyle || STROKE_TYPES.UNKNOWN
    const phase =
      style !== STROKE_TYPES.UNKNOWN
        ? classifyPhaseByStyle(style, landmarks, angles)
        : STROKE_PHASES.UNKNOWN

    if (frameBuffer.length >= 4 && phase !== STROKE_PHASES.PREP && style !== STROKE_TYPES.UNKNOWN) {
      detectArmStroke(style, phase, landmarks, angles, now, true)
    }

    const standardStyle = targetStyle || style
    const standard = STYLE_STANDARDS[standardStyle] || null
    const assessment = evaluateTechnique(standardStyle, phase, landmarks, angles, standard)

    const result = buildAnalysisResult({
      style,
      phase,
      stage: ANALYSIS_STAGES.SWIM_ACTIVE,
      styleSource,
      angles,
      standardName: standard?.name || '通用规则',
      assessment,
      timestamp: now,
      judgeable: true,
      quality,
    })

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

  const isStartSetupPose = (landmarks, angles) => {
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

    if (!ls || !rs || !lh || !rh || !lk || !rk || !la || !ra) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const ankleY = (la.y + ra.y) / 2
    const avgKnee = average(angles.leftKnee, angles.rightKnee)
    const torsoStanding = ankleY - shoulderY > 0.16
    const hipsLoaded = hipY > shoulderY + 0.05
    const kneesLoaded = avgKnee != null ? avgKnee < 155 : false
    const handsPrimedCount = [lw, rw].reduce((count, wrist) => {
      if (!wrist || (wrist.visibility ?? 0) < 0.25) return count
      return count + (wrist.y < hipY + 0.03 ? 1 : 0)
    }, 0)
    const elbowsLoaded = (angles.leftElbow ?? 180) < 145 || (angles.rightElbow ?? 180) < 145

    return torsoStanding && hipsLoaded && kneesLoaded && (handsPrimedCount >= 1 || elbowsLoaded)
  }

  const isUnderwaterGlidePose = (landmarks, angles, cameraProfile = 'side') => {
    const profile = getCameraProfile(cameraProfile)
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const nose = landmarks[KP.NOSE]

    if (!ls || !rs || !lw || !rw || !lh || !rh) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const shoulderMidX = (ls.x + rs.x) / 2
    const wristMidX = (lw.x + rw.x) / 2
    const shoulderWidth = Math.max(Math.abs(ls.x - rs.x), 0.08)
    const wristDistance = Math.hypot(lw.x - rw.x, lw.y - rw.y)
    const bodyHorizontal = Math.abs(shoulderY - hipY) <= profile.horizontalTorsoMax
    const wristsStacked = wristDistance <= Math.max(shoulderWidth * 0.9, 0.14)
    const elbowsStraight = (angles.leftElbow ?? 180) >= 150 && (angles.rightElbow ?? 180) >= 150
    const armsExtended = Math.abs(wristMidX - shoulderMidX) >= Math.max(shoulderWidth * 0.55, 0.08)
    const headNeutral = nose ? Math.abs(nose.y - shoulderY) <= 0.12 : true

    return bodyHorizontal && wristsStacked && elbowsStraight && armsExtended && headNeutral
  }

  const isTurnPose = (landmarks, angles, cameraProfile = 'side') => {
    const profile = getCameraProfile(cameraProfile)
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

    if (!ls || !rs || !lh || !rh || !lk || !rk || !la || !ra || !lw || !rw) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const shoulderMidX = (ls.x + rs.x) / 2
    const hipMidX = (lh.x + rh.x) / 2
    const kneeMidX = (lk.x + rk.x) / 2
    const ankleMidX = (la.x + ra.x) / 2
    const wristMidX = (lw.x + rw.x) / 2
    const avgKnee = average(angles.leftKnee, angles.rightKnee)
    const bodyHorizontal = Math.abs(shoulderY - hipY) <= profile.horizontalTorsoMax * 1.15
    const kneesLoaded = avgKnee != null && avgKnee < 120
    const legsCompressed =
      Math.abs(kneeMidX - hipMidX) <= 0.15 &&
      Math.abs(ankleMidX - hipMidX) <= 0.18
    const handsNearCore = Math.abs(wristMidX - shoulderMidX) <= 0.16
    const headTucked = nose ? Math.abs(nose.x - shoulderMidX) <= 0.18 : true

    return bodyHorizontal && kneesLoaded && legsCompressed && handsNearCore && headTucked
  }

  const isFinishPose = (landmarks, angles, cameraProfile = 'side') => {
    const profile = getCameraProfile(cameraProfile)
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]

    if (!ls || !rs || !lw || !rw || !lh || !rh) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const shoulderMidX = (ls.x + rs.x) / 2
    const shoulderWidth = Math.max(Math.abs(ls.x - rs.x), 0.08)
    const wristsExtendedCount = [lw, rw].reduce((count, wrist) => (
      count + (Math.abs(wrist.x - shoulderMidX) >= Math.max(shoulderWidth * 0.45, 0.08) ? 1 : 0)
    ), 0)
    const bodyHorizontal = Math.abs(shoulderY - hipY) <= profile.horizontalTorsoMax * 1.15
    const elbowsExtended = (angles.leftElbow ?? 180) >= 145 || (angles.rightElbow ?? 180) >= 145

    return bodyHorizontal && elbowsExtended && wristsExtendedCount >= 1
  }

  const isUprightPose = (landmarks) => {
    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]

    if (!ls || !rs || !lh || !rh || !la || !ra) return false

    const shoulderY = (ls.y + rs.y) / 2
    const hipY = (lh.y + rh.y) / 2
    const ankleY = (la.y + ra.y) / 2
    const torsoVertical = Math.abs(hipY - shoulderY)
    const legVertical = Math.abs(ankleY - hipY)

    return torsoVertical > 0.11 && legVertical > 0.17 && ankleY > hipY
  }

  const calcRecentMotionAmplitude = (idx, axis = 'y', window = MOTION_WINDOW) => {
    if (frameBuffer.length < 6) return 0

    const values = frameBuffer
      .slice(-window)
      .map((frame) => {
        const point = frame.landmarks[idx]
        if (!point || (point.visibility ?? 0) < 0.25) return null
        return point[axis]
      })
      .filter((value) => value != null)

    if (values.length < 5) return 0
    return Math.abs(Math.max(...values) - Math.min(...values))
  }

  const calcProfileMotionAmplitude = (idx, profileKey, window = MOTION_WINDOW) => {
    const profile = getCameraProfile(profileKey)
    if (profile.motionAxis === 'x') {
      return calcRecentMotionAmplitude(idx, 'x', window)
    }
    return calcRecentMotionAmplitude(idx, 'y', window)
  }

  const isSwimMotionActive = (landmarks, angles, cameraProfile = 'side') => {
    const profile = getCameraProfile(cameraProfile)
    if (isPrepPose(landmarks, angles)) {
      motionActiveStreak = 0
      motionInactiveStreak = 0
      transitionHoldFrames = 0
      underwaterStreak = 0
      turnStreak = 0
      finishStreak = 0
      return {
        active: false,
        stage: ANALYSIS_STAGES.PREP,
        reason: '准备姿势阶段，当前不进行泳姿评分',
      }
    }

    if (isStartSetupPose(landmarks, angles)) {
      motionActiveStreak = 0
      motionInactiveStreak = 0
      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)
      underwaterStreak = 0
      turnStreak = 0
      finishStreak = 0
      lastStableStage = ANALYSIS_STAGES.START
      return {
        active: false,
        stage: ANALYSIS_STAGES.START,
        reason: '检测到起跳准备姿态，当前不进行泳姿评分',
      }
    }

    const upright = isUprightPose(landmarks)

    const ls = landmarks[KP.L_SHOULDER]
    const rs = landmarks[KP.R_SHOULDER]
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]

    const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : null
    const hipY = lh && rh ? (lh.y + rh.y) / 2 : null
    const torsoDelta = shoulderY != null && hipY != null ? Math.abs(shoulderY - hipY) : null
    const bodyLikelyHorizontal = torsoDelta != null ? torsoDelta <= profile.horizontalTorsoMax : true

    const wristMotion = Math.max(
      calcProfileMotionAmplitude(KP.L_WRIST, cameraProfile),
      calcProfileMotionAmplitude(KP.R_WRIST, cameraProfile),
    )
    const ankleMotion = Math.max(
      calcProfileMotionAmplitude(KP.L_ANKLE, cameraProfile),
      calcProfileMotionAmplitude(KP.R_ANKLE, cameraProfile),
    )
    const startThresholdWrist = WRIST_ACTIVE_MOTION * profile.startMotionMultiplier
    const startThresholdAnkle = ANKLE_ACTIVE_MOTION * profile.startMotionMultiplier
    const launchLike = upright && (wristMotion >= startThresholdWrist || ankleMotion >= startThresholdAnkle)
    const underwaterLike = isUnderwaterGlidePose(landmarks, angles, cameraProfile)
    const turnLike = isTurnPose(landmarks, angles, cameraProfile)
    const finishLike = isFinishPose(landmarks, angles, cameraProfile)

    const candidateActive =
      !upright &&
      bodyLikelyHorizontal &&
      (wristMotion >= WRIST_ACTIVE_MOTION || ankleMotion >= ANKLE_ACTIVE_MOTION)

    const movingButNotStable =
      (wristMotion >= WRIST_ACTIVE_MOTION * 0.72 || ankleMotion >= ANKLE_ACTIVE_MOTION * 0.72) &&
      (!bodyLikelyHorizontal || upright)

    if (launchLike) {
      motionActiveStreak = 0
      motionInactiveStreak = 0
      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)
      underwaterStreak = 0
      turnStreak = 0
      finishStreak = 0
      lastStableStage = ANALYSIS_STAGES.START
      return {
        active: false,
        stage: ANALYSIS_STAGES.START,
        reason: '检测到起跳或爆发发力，当前不进行泳姿评分',
      }
    }

    if (
      turnLike &&
      (lastStableStage === ANALYSIS_STAGES.SWIM_ACTIVE ||
        lastStableStage === ANALYSIS_STAGES.TRANSITION ||
        lastStableStage === ANALYSIS_STAGES.TURN)
    ) {
      turnStreak += 1
      underwaterStreak = 0
      finishStreak = 0
      motionActiveStreak = 0
      motionInactiveStreak = Math.max(motionInactiveStreak, 1)
      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)

      if (turnStreak >= TURN_CONFIRM_FRAMES) {
        lastStableStage = ANALYSIS_STAGES.TURN
        return {
          active: false,
          stage: ANALYSIS_STAGES.TURN,
          reason: '检测到靠壁转身动作，当前不进行泳姿评分',
        }
      }
    } else {
      turnStreak = 0
    }

    if (
      underwaterLike &&
      (lastStableStage === ANALYSIS_STAGES.START ||
        lastStableStage === ANALYSIS_STAGES.TRANSITION ||
        lastStableStage === ANALYSIS_STAGES.UNDERWATER ||
        profile.key === 'underwater') &&
      wristMotion < WRIST_ACTIVE_MOTION * 1.15
    ) {
      underwaterStreak += 1
      turnStreak = 0
      finishStreak = 0
      motionActiveStreak = 0
      motionInactiveStreak = 0
      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)

      if (underwaterStreak >= UNDERWATER_CONFIRM_FRAMES) {
        lastStableStage = ANALYSIS_STAGES.UNDERWATER
        return {
          active: false,
          stage: ANALYSIS_STAGES.UNDERWATER,
          reason: '检测到入水后水下滑行阶段，当前不进行泳姿评分',
        }
      }
    } else {
      underwaterStreak = 0
    }

    if (candidateActive) {
      motionActiveStreak += 1
      motionInactiveStreak = 0
      underwaterStreak = 0
      turnStreak = 0
      finishStreak = 0

      if (motionActiveStreak >= MOTION_ACTIVE_CONFIRM_FRAMES) {
        transitionHoldFrames = 0
        lastStableStage = ANALYSIS_STAGES.SWIM_ACTIVE
        return {
          active: true,
          stage: ANALYSIS_STAGES.SWIM_ACTIVE,
          reason: '',
        }
      }

      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)
      lastStableStage = ANALYSIS_STAGES.TRANSITION
      return {
        active: false,
        stage: ANALYSIS_STAGES.TRANSITION,
        reason: '动作正在进入有效划水阶段',
      }
    }

    motionInactiveStreak += 1
    motionActiveStreak = 0

    if (
      finishLike &&
      wristMotion < WRIST_ACTIVE_MOTION * 0.8 &&
      ankleMotion < ANKLE_ACTIVE_MOTION * 0.8 &&
      (lastStableStage === ANALYSIS_STAGES.SWIM_ACTIVE || lastStableStage === ANALYSIS_STAGES.FINISH)
    ) {
      finishStreak += 1
      underwaterStreak = 0
      turnStreak = 0
      if (finishStreak >= FINISH_CONFIRM_FRAMES) {
        transitionHoldFrames = 0
        lastStableStage = ANALYSIS_STAGES.FINISH
        return {
          active: false,
          stage: ANALYSIS_STAGES.FINISH,
          reason: '检测到结束收势阶段，当前不进行泳姿评分',
        }
      }
    } else {
      finishStreak = 0
    }

    if (movingButNotStable || (lastStableStage === ANALYSIS_STAGES.START && transitionHoldFrames < TRANSITION_MAX_HOLD_FRAMES)) {
      transitionHoldFrames = Math.min(TRANSITION_MAX_HOLD_FRAMES, transitionHoldFrames + 1)
      lastStableStage = ANALYSIS_STAGES.TRANSITION
      return {
        active: false,
        stage: ANALYSIS_STAGES.TRANSITION,
        reason: '动作处于过渡阶段，当前不进行泳姿评分',
      }
    }

    if (upright || motionInactiveStreak >= MOTION_INACTIVE_CONFIRM_FRAMES) {
      transitionHoldFrames = 0
      lastStableStage = ANALYSIS_STAGES.INVALID
      return {
        active: false,
        stage: ANALYSIS_STAGES.INVALID,
        reason: '尚未进入有效划水阶段',
      }
    }

    if (transitionHoldFrames < TRANSITION_MAX_HOLD_FRAMES) {
      transitionHoldFrames += 1
      lastStableStage = ANALYSIS_STAGES.TRANSITION
      return {
        active: false,
        stage: ANALYSIS_STAGES.TRANSITION,
        reason: '动作仍处于过渡阶段',
      }
    }

    lastStableStage = ANALYSIS_STAGES.INVALID
    return {
      active: false,
      stage: ANALYSIS_STAGES.INVALID,
      reason: '当前阶段证据不足，暂不评分',
    }
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
    const avgKnee = average(angles.leftKnee, angles.rightKnee)
    const kneeFlex = avgKnee != null ? avgKnee >= t.kneeStraightDeg : false
    const bodyLine = bodyLineDelta != null ? bodyLineDelta <= t.bodyLineMax : false
    const headStable = calcHeadStability(t.headShakeAmp)
    const faceUp = nose && shoulderMidY != null ? nose.y < shoulderMidY : false

    return makeAssessment([
      createItem('faceUp', '仰卧姿态', faceUp, '头部保持仰卧方向', '头部朝向不稳定'),
      createItem('armAlternate', '交替划臂', armAlternate, '双臂交替节奏清晰', '双臂同向动作较多'),
      createItem('armStraight', '出水伸直', armStraight, '出水移臂较伸直', '移臂时肘部弯曲偏大'),
      createItem('legAlternate', '交替打腿', legAlternate, '双腿交替打腿有效', '双腿交替幅度不足'),
      createItem('kneeFlex', '膝盖弯曲控制', kneeFlex, '膝盖弯曲幅度合理', '膝盖弯曲过大，影响打腿连贯性'),
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
    const lh = landmarks[KP.L_HIP]
    const rh = landmarks[KP.R_HIP]
    const lk = landmarks[KP.L_KNEE]
    const rk = landmarks[KP.R_KNEE]
    const la = landmarks[KP.L_ANKLE]
    const ra = landmarks[KP.R_ANKLE]
    const nose = landmarks[KP.NOSE]

    const armAlternate = lw && rw ? Math.abs(lw.y - rw.y) >= t.armAltYDiff : false
    const armStraight =
      (angles.leftElbow ?? null) != null && (angles.rightElbow ?? null) != null
        ? Math.max(angles.leftElbow, angles.rightElbow) >= t.armStraightDeg
        : false

    const ankleAlt = la && ra ? Math.abs(la.y - ra.y) >= t.legAltYDiff : false
    const kneeAlt = lk && rk ? Math.abs(lk.y - rk.y) >= t.kneeAltYDiff : false
    const legAlternate = ankleAlt || kneeAlt || calcRecentPairAlternation(KP.L_ANKLE, KP.R_ANKLE, t.legAltYDiff * 0.85) || calcRecentPairAlternation(KP.L_KNEE, KP.R_KNEE, t.kneeAltYDiff * 0.85)

    const shoulderRollAmp = calcBodyRollAmplitude()
    const hipRollAmp = calcHipRollAmplitude()
    const bodyRoll = shoulderRollAmp >= t.bodyRollAmp && hipRollAmp >= t.bodyRollHipAmp

    const shoulderMidY = ls && rs ? (ls.y + rs.y) / 2 : null
    const hipMidY = lh && rh ? (lh.y + rh.y) / 2 : null
    const ankleMidY = la && ra ? (la.y + ra.y) / 2 : null
    let hipLevel = false
    if (shoulderMidY != null && hipMidY != null && ankleMidY != null) {
      const shoulderHipDelta = Math.abs(shoulderMidY - hipMidY)
      const hipLineDeviation = Math.abs(hipMidY - ((shoulderMidY + ankleMidY) / 2))
      hipLevel = shoulderHipDelta <= t.bodyLineMax && hipLineDeviation <= t.hipLineDevMax
    }

    const avgKnee = average(angles.leftKnee, angles.rightKnee)
    const kneeFlex = avgKnee != null ? avgKnee >= t.kneeStraightDeg : false

    let breathTiming = false
    if (nose && shoulderMidY != null) {
      const liftedTooMuch = nose.y < shoulderMidY - t.maxHeadLift
      const headTurnAmp = calcHeadTurnAmplitude()
      const turnedHead = headTurnAmp >= t.breathTurnXAmp
      const inBreathWindow = phase === STROKE_PHASES.RECOVERY || phase === STROKE_PHASES.PULL
      breathTiming = !liftedTooMuch && turnedHead && (inBreathWindow || bodyRoll)
    }

    return makeAssessment([
      createItem('armAlternate', '交替划臂', armAlternate, '双臂交替节奏清晰', '双臂交替不明显'),
      createItem('armStraight', '移臂伸直', armStraight, '移臂阶段手臂较伸直', '移臂阶段肘部弯曲偏大'),
      createItem('legAlternate', '交替打腿', legAlternate, '打腿节奏连续', '打腿幅度或节奏不足'),
      createItem('hipLevel', '身体平直', hipLevel, '肩髋踝纵向关系稳定', '髋部下沉或身体线条不稳定'),
      createItem('kneeFlex', '膝盖弯曲控制', kneeFlex, '膝盖弯曲幅度合理', '膝盖弯曲过大，打腿推进不足'),
      createItem('bodyRoll', '身体滚动', bodyRoll, '转体滚动幅度合适', '身体过僵，滚动不足'),
      createItem('breathTiming', '转头呼吸', breathTiming, '转头呼吸且未过度抬头', '呼吸时未转头或存在抬头问题'),
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

  const calcRecentPairAlternation = (leftIdx, rightIdx, threshold) => {
    if (frameBuffer.length < 6) return false

    const diffs = frameBuffer
      .slice(-10)
      .map((frame) => {
        const left = frame.landmarks[leftIdx]
        const right = frame.landmarks[rightIdx]
        if (!left || !right) return null
        return Math.abs(left.y - right.y)
      })
      .filter((value) => value != null)

    if (diffs.length < 5) return false
    const amplitude = Math.max(...diffs) - Math.min(...diffs)
    return amplitude >= threshold
  }

  const calcHipRollAmplitude = () => {
    if (frameBuffer.length < 8) return 0
    const values = frameBuffer
      .slice(-12)
      .map((frame) => {
        const lh = frame.landmarks[KP.L_HIP]
        const rh = frame.landmarks[KP.R_HIP]
        if (!lh || !rh) return null
        return lh.x - rh.x
      })
      .filter((value) => value != null)

    if (values.length < 6) return 0
    return Math.abs(Math.max(...values) - Math.min(...values))
  }

  const calcHeadTurnAmplitude = () => {
    if (frameBuffer.length < 8) return 0
    const values = frameBuffer
      .slice(-12)
      .map((frame) => {
        const nose = frame.landmarks[KP.NOSE]
        const ls = frame.landmarks[KP.L_SHOULDER]
        const rs = frame.landmarks[KP.R_SHOULDER]
        if (!nose || !ls || !rs) return null
        const shoulderMidX = (ls.x + rs.x) / 2
        return nose.x - shoulderMidX
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

  const commitStrokeCount = (now) => {
    strokeCount.value += 1
    lastStrokeTime = now
    strokeHistory.value.push(now)
    if (strokeHistory.value.length > 20) strokeHistory.value.shift()
  }

  const getDominantPullSide = (landmarks) => {
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    if (!lw || !rw) return ''
    if ((lw.visibility ?? 0) < 0.3 || (rw.visibility ?? 0) < 0.3) return ''
    const diff = lw.y - rw.y
    if (Math.abs(diff) < 0.03) return ''
    return diff > 0 ? 'left' : 'right'
  }

  const detectAlternatingStroke = (state, phase, landmarks, now) => {
    const pullLike = phase === STROKE_PHASES.CATCH || phase === STROKE_PHASES.PULL
    if (!pullLike) {
      state.armed = true
      return
    }

    if (!state.armed) return
    const activeSide = getDominantPullSide(landmarks)
    if (!activeSide) return
    if (activeSide === state.lastSide) return

    state.lastSide = activeSide
    state.armed = false
    commitStrokeCount(now)
  }

  const detectBreaststrokeCycle = (phase, landmarks, now) => {
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    if (!lw || !rw) return
    const handSpan = Math.abs(lw.x - rw.x)
    const pullLike = phase === STROKE_PHASES.CATCH || phase === STROKE_PHASES.PULL
    const glideLike = phase === STROKE_PHASES.GLIDE || phase === STROKE_PHASES.ENTRY

    if (pullLike && handSpan > 0.12) {
      counterState.breaststroke.loaded = true
      return
    }

    if (counterState.breaststroke.loaded && glideLike && handSpan < 0.1) {
      counterState.breaststroke.loaded = false
      commitStrokeCount(now)
    }
  }

  const detectButterflyCycle = (phase, landmarks, now) => {
    const lw = landmarks[KP.L_WRIST]
    const rw = landmarks[KP.R_WRIST]
    if (!lw || !rw) return
    const armSync = Math.abs(lw.y - rw.y) < 0.08
    if (phase === STROKE_PHASES.PULL) {
      counterState.butterfly.loaded = true
      return
    }

    if (counterState.butterfly.loaded && armSync && (phase === STROKE_PHASES.ENTRY || phase === STROKE_PHASES.RECOVERY)) {
      counterState.butterfly.loaded = false
      commitStrokeCount(now)
    }
  }

  const detectArmStroke = (style, phase, landmarks, angles, now, allowCount = true) => {
    if (!allowCount) return
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return
    if (frameBuffer.length < 4) return

    if (style === STROKE_TYPES.FREESTYLE) {
      detectAlternatingStroke(counterState.freestyle, phase, landmarks, now)
      return
    }

    if (style === STROKE_TYPES.BACKSTROKE) {
      detectAlternatingStroke(counterState.backstroke, phase, landmarks, now)
      return
    }

    if (style === STROKE_TYPES.BREASTSTROKE) {
      detectBreaststrokeCycle(phase, landmarks, now)
      return
    }

    if (style === STROKE_TYPES.BUTTERFLY) {
      detectButterflyCycle(phase, landmarks, now)
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
