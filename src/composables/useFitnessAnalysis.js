import { ref, readonly } from 'vue'
import { KP } from './useSkeletonDraw.js'

export const FITNESS_AGE_GROUP_OPTIONS = [
  { value: 'youth', label: '6-18岁青少年' },
  { value: 'adult', label: '18岁以上成年人' },
]

export const FITNESS_EQUIPMENT_OPTIONS = [
  {
    value: 'smith_squat',
    label: '史密斯深蹲',
    shortLabel: '深蹲',
    recommendedView: '正前 / 斜侧',
    focus: '膝髋协同、躯干稳定、下蹲深度',
  },
  {
    value: 'seated_row',
    label: '坐姿划船',
    shortLabel: '划船',
    recommendedView: '侧面 / 斜侧',
    focus: '膝盖稳定、回拉平稳、躯干稳定',
  },
  // {
  //   value: 'leg_extension',
  //   label: '坐姿腿屈伸',
  //   shortLabel: '腿屈伸',
  //   recommendedView: '侧面',
  //   focus: '膝伸展幅度、大腿稳定、回程控制',
  // },
  // {
  //   value: 'cable_fly',
  //   label: '龙门架夹胸',
  //   shortLabel: '夹胸',
  //   recommendedView: '正面',
  //   focus: '双臂对称、肘角稳定、夹胸终点',
  // },
  // {
  //   value: 'roman_chair',
  //   label: '罗马椅挺身',
  //   shortLabel: '挺身',
  //   recommendedView: '侧面',
  //   focus: '髋铰链幅度、脊柱中立、不过伸',
  // },
]

const PHASES = {
  INVALID: 'INVALID',
  READY: 'READY',
  DESCENT: 'DESCENT',
  BOTTOM: 'BOTTOM',
  ASCENT: 'ASCENT',
  EXTEND: 'EXTEND',
  RETURN: 'RETURN',
  PULL: 'PULL',
  OPEN: 'OPEN',
  CLOSE: 'CLOSE',
  HOLD: 'HOLD',
  TOP: 'TOP',
}

const PHASE_LABELS = {
  [PHASES.INVALID]: '证据不足',
  [PHASES.READY]: '准备动作',
  [PHASES.DESCENT]: '离心下放',
  [PHASES.BOTTOM]: '动作底部',
  [PHASES.ASCENT]: '向上发力',
  [PHASES.EXTEND]: '主动伸展',
  [PHASES.RETURN]: '控制回程',
  [PHASES.PULL]: '向心拉回',
  [PHASES.OPEN]: '动作打开',
  [PHASES.CLOSE]: '动作闭合',
  [PHASES.HOLD]: '顶峰停顿',
  [PHASES.TOP]: '动作顶点',
}

const FRAME_MIN_PIXELS = 640 * 480
const MIN_CONFIDENCE = 0.38
const MIN_VISIBLE_COUNT = 10
const MIN_BODY_HEIGHT = 0.24
const MIN_EDGE_MARGIN = 0.02
const REP_COOLDOWN_MS = 700

const EQUIPMENT_REQUIRED_POINTS = {
  smith_squat: [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_HIP, KP.R_HIP, KP.L_KNEE, KP.R_KNEE, KP.L_ANKLE, KP.R_ANKLE],
  leg_extension: [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_HIP, KP.R_HIP, KP.L_KNEE, KP.R_KNEE, KP.L_ANKLE, KP.R_ANKLE],
  seated_row: [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_ELBOW, KP.R_ELBOW, KP.L_WRIST, KP.R_WRIST, KP.L_HIP, KP.R_HIP],
  cable_fly: [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_ELBOW, KP.R_ELBOW, KP.L_WRIST, KP.R_WRIST, KP.L_HIP, KP.R_HIP],
  roman_chair: [KP.L_SHOULDER, KP.R_SHOULDER, KP.L_HIP, KP.R_HIP, KP.L_KNEE, KP.R_KNEE, KP.NOSE],
}

const VOICE_PROMPTS = {
  youth: {
    invalid_frame: '先让主要身体部位完整进入画面，准备好以后我们再开始。',
    smith_squat: {
      READY: '像坐小椅子一样慢慢蹲下去，肚子收紧。',
      completed: '这一组很稳，继续保持这个节奏。',
      depth_ok: '真棒，你做对了。',
      stance_stable: '双脚站稳，脚距和肩膀差不多宽。',
      torso_neutral: '胸口抬起来，背不要塌。',
      knee_track: '膝盖跟着脚尖方向走，不要往里夹。',
      squat_depth: '再蹲深一点，大腿快到平行地面。',
      ankle_stable: '脚跟踩稳，不要左右晃。',
    },
    leg_extension: {
      READY: '先坐稳，小腿再慢慢抬起来。',
      completed: '这次伸得很好，继续控制速度。',
      seated_stable: '后背贴住靠垫，先把坐姿坐稳。',
      thigh_stable: '大腿不要晃，只让小腿动起来。',
      top_extension: '再把小腿抬高一点，顶端停一下。',
      controlled_return: '回来的时候慢一点，不要甩下来。',
    },
    seated_row: {
      invalid_frame: '请保持坐姿上半身完整入镜，看到肩膀、手肘和手腕后就能开始判断。',
      READY: '先坐稳踩实，再把把手平稳拉向腹部。',
      completed: '这次划船很稳，继续保持这个节奏。',
      torso_stable: '躯干先稳住，不要前后大幅晃动。',
      knee_stable: '膝盖位置尽量固定，不要跟着大幅移动。',
      pull_stable: '慢一点拉回来，不要一下子猛拽。',
    },
    cable_fly: {
      READY: '手臂像抱大球一样往中间合。',
      completed: '夹胸很到位，继续按这个轨迹。',
      fly_symmetry: '左右手要一样高，别一高一低。',
      elbow_soft: '手肘微微弯，不要夹得太死。',
      close_enough: '终点再合近一点，让胸口发力。',
      shoulder_relaxed: '肩膀放松，别耸肩。',
      trunk_stable: '身体站稳，别左右晃。',
    },
    roman_chair: {
      READY: '先夹紧核心，再从髋部折叠下去。',
      completed: '起身很稳，记得不要往后仰太多。',
      hip_hinge: '再往下折一点，用髋部发力。',
      no_overextend: '到身体成一直线就够了，不要过度后仰。',
      neck_neutral: '脖子放松，眼睛看斜前方就好。',
      tempo_stable: '节奏慢一点，不要借惯性甩起来。',
    },
  },
  adult: {
    invalid_frame: '请让主要身体关键点完整入镜，确认机位后再开始。',
    smith_squat: {
      READY: '开始下蹲，保持核心收紧和髋部后坐。',
      completed: '当前节奏和姿态不错，继续保持。',
      depth_ok: '下蹲深度正确，继续保持。',
      stance_stable: '调整站距到肩宽附近，重心均匀分布。',
      torso_neutral: '躯干前倾偏大，先把胸椎立住。',
      knee_track: '膝线偏移，保持膝盖与脚尖同向。',
      squat_depth: '下蹲深度不足，目标到大腿接近平行。',
      ankle_stable: '踝部稳定性不足，脚跟保持压实地面。',
    },
    leg_extension: {
      READY: '保持骨盆稳定，小腿向前上方伸展。',
      completed: '伸膝质量不错，继续控制回程速度。',
      seated_stable: '后背离垫过多，先把坐姿固定住。',
      thigh_stable: '股四头肌发力时，大腿不要跟着摆动。',
      top_extension: '顶端伸膝不足，再完成最后一段伸展。',
      controlled_return: '离心回程过快，放下时再慢一些。',
    },
    seated_row: {
      invalid_frame: '请保持坐姿上半身完整入镜，确保肩、肘、腕和躯干关键点清晰可见。',
      READY: '先固定坐姿和脚底支撑，再把握把平稳拉向下腹。',
      completed: '本次回拉稳定且到位，继续保持。',
      torso_stable: '躯干移动幅度偏大，先稳定骨盆和躯干再发力。',
      knee_stable: '膝盖位置移动偏大，先固定下肢支撑。',
      pull_stable: '回拉过猛，先降速，避免借惯性猛拽。',
    },
    cable_fly: {
      READY: '保持胸廓稳定，双臂沿弧线向中线合拢。',
      completed: '夹胸轨迹稳定，继续保持张力。',
      fly_symmetry: '左右臂高度不一致，保持对称轨迹。',
      elbow_soft: '肘角变化过大，维持微屈即可。',
      close_enough: '终点收缩不足，双手再向胸前靠拢一些。',
      shoulder_relaxed: '肩部代偿明显，先放松上斜方。',
      trunk_stable: '躯干晃动偏大，先稳定核心再做。',
    },
    roman_chair: {
      READY: '保持核心张力，从髋部折叠完成下放。',
      completed: '动作轨迹稳定，继续避免腰椎过伸。',
      hip_hinge: '动作幅度偏小，髋铰链再充分一点。',
      no_overextend: '顶端过伸风险偏高，回到身体一条线即可。',
      neck_neutral: '颈部代偿明显，保持颈椎中立。',
      tempo_stable: '借力和惯性偏多，放慢节奏再做。',
    },
  },
}

VOICE_PROMPTS.youth.seated_row.rep_ok = '真棒，这次划船膝盖稳，身体也稳，拉得很平顺。'
VOICE_PROMPTS.adult.seated_row.rep_ok = '本次坐姿划船动作正确，膝盖稳定、躯干稳定、回拉平稳。'

const average = (...values) => {
  const valid = values.filter((value) => typeof value === 'number' && !Number.isNaN(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

const getPoint = (landmarks, idx, threshold = 0.22) => {
  const point = landmarks?.[idx]
  if (!point || (point.visibility ?? 0) < threshold) return null
  return point
}

const midpoint = (a, b) => {
  if (!a || !b) return null
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: average(a.visibility ?? 0, b.visibility ?? 0) ?? 0,
  }
}

const distance = (a, b) => {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const calcAngle = (a, b, c) => {
  if (!a || !b || !c) return null
  const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let deg = Math.abs(rad * (180 / Math.PI))
  if (deg > 180) deg = 360 - deg
  return deg
}

const angleFromVertical = (topPoint, bottomPoint) => {
  if (!topPoint || !bottomPoint) return null
  return Math.abs(Math.atan2(bottomPoint.x - topPoint.x, bottomPoint.y - topPoint.y) * (180 / Math.PI))
}

const createItem = (key, label, ok, passDetail, failDetail, pendingDetail = '等待动作进入目标阶段') => ({
  key,
  label,
  ok,
  detail: ok == null ? pendingDetail : ok ? passDetail : failDetail,
})

const makeAssessment = (items) => {
  const validItems = items.filter((item) => item.ok !== null)
  if (!validItems.length) {
    return {
      score: null,
      items,
    }
  }
  const okCount = validItems.filter((item) => item.ok === true).length
  return {
    score: Math.round((okCount / validItems.length) * 100),
    items,
  }
}

const getPrimaryIssue = (assessment) => assessment?.items?.find((item) => item.ok === false)?.key || ''

const createSeatedRowCounterState = () => ({
  pulled: false,
  lastDistance: null,
  lastPullDelta: null,
  repStarted: false,
  repMaxTorsoLean: null,
  repStartKneeMid: null,
  repMaxKneeTravel: null,
  repMaxPullDelta: null,
  repMaxPullJerk: null,
})

const resetSeatedRowRepWindow = (state) => {
  state.repStarted = false
  state.repMaxTorsoLean = null
  state.repStartKneeMid = null
  state.repMaxKneeTravel = null
  state.repMaxPullDelta = null
  state.repMaxPullJerk = null
}

const updateSeatedRowRepWindow = (state, metrics = {}) => {
  const {
    torsoLean,
    kneeMid,
    pullDelta,
    pullJerk,
  } = metrics

  if (typeof torsoLean === 'number') {
    state.repMaxTorsoLean = state.repMaxTorsoLean == null
      ? torsoLean
      : Math.max(state.repMaxTorsoLean, torsoLean)
  }
  if (kneeMid && !state.repStartKneeMid) {
    state.repStartKneeMid = { x: kneeMid.x, y: kneeMid.y }
  }
  const kneeTravel = kneeMid && state.repStartKneeMid
    ? distance(kneeMid, state.repStartKneeMid)
    : null
  if (typeof kneeTravel === 'number') {
    state.repMaxKneeTravel = state.repMaxKneeTravel == null
      ? kneeTravel
      : Math.max(state.repMaxKneeTravel, kneeTravel)
  }
  if (typeof pullDelta === 'number') {
    state.repMaxPullDelta = state.repMaxPullDelta == null
      ? pullDelta
      : Math.max(state.repMaxPullDelta, pullDelta)
  }
  if (typeof pullJerk === 'number') {
    state.repMaxPullJerk = state.repMaxPullJerk == null
      ? pullJerk
      : Math.max(state.repMaxPullJerk, pullJerk)
  }
}

const buildSeatedRowRepAssessment = (state, thresholds) => makeAssessment([
  createItem(
    'torso_stable',
    '躯干稳定',
    state.repMaxTorsoLean != null ? state.repMaxTorsoLean <= thresholds.maxTorsoLean : null,
    '本次回拉时躯干比较稳定，没有明显前后晃动借力',
    '本次回拉时躯干移动偏大，存在借力完成动作的情况',
  ),
  createItem(
    'knee_stable',
    '膝盖稳定',
    state.repMaxKneeTravel != null ? state.repMaxKneeTravel <= thresholds.maxKneeTravel : null,
    '本次回拉时膝盖位置比较稳定，没有明显大范围移动',
    '本次回拉时膝盖移动偏大，下肢支撑不够稳定',
    '当前膝盖关键点不够稳定，露出膝盖后可继续判断是否大范围移动',
  ),
  createItem(
    'pull_stable',
    '回拉平稳',
    state.repMaxPullDelta != null
      ? state.repMaxPullDelta <= thresholds.maxPullDelta
        && (state.repMaxPullJerk == null || state.repMaxPullJerk <= thresholds.maxPullJerk)
      : null,
    '回拉速度比较均匀，没有明显猛拽',
    '回拉出现明显猛拽或突然发力，存在借惯性完成动作的情况',
  ),
])

const serializeLandmarks = (landmarks) => landmarks.map((point) => (
  point ? { x: point.x, y: point.y, z: point.z ?? 0, visibility: point.visibility ?? 0 } : null
))

export function useFitnessAnalysis() {
  const repCount = ref(0)
  const currentPhase = ref(PHASES.INVALID)
  const currentEquipment = ref(FITNESS_EQUIPMENT_OPTIONS[0].value)
  const latestAssessment = ref({ score: null, items: [] })

  const frameBuffer = []
  let lastRepAt = 0
  const counterState = {
    smith_squat: {
      depthReached: false,
      lastKneeAngle: null,
      repMinKneeAngle: null,
      repLowestHipY: null,
      depthPraiseSent: false,
    },
    leg_extension: { loaded: false, lastKneeAngle: null },
    seated_row: createSeatedRowCounterState(),
    cable_fly: { closed: false, lastSpan: null },
    roman_chair: { folded: false, lastHipAngle: null },
  }

  const pushFrame = (landmarks) => {
    frameBuffer.push(serializeLandmarks(landmarks))
    if (frameBuffer.length > 18) frameBuffer.shift()
  }

  const calcAverageVisibility = (landmarks) => {
    const visible = landmarks.filter((point) => point && (point.visibility ?? 0) > 0)
    if (!visible.length) return 0
    return visible.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / visible.length
  }

  const calcBounds = (landmarks, indexes) => {
    const points = indexes.map((idx) => landmarks[idx]).filter((point) => point && (point.visibility ?? 0) > 0.2)
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

  const assessFrameQuality = (landmarks, equipment, frameWidth = 0, frameHeight = 0) => {
    const requiredIndexes = EQUIPMENT_REQUIRED_POINTS[equipment] || EQUIPMENT_REQUIRED_POINTS.smith_squat
    const isSeatedRow = equipment === 'seated_row'
    const minVisibleCount = isSeatedRow ? 8 : MIN_VISIBLE_COUNT
    const minConfidence = isSeatedRow ? 0.32 : MIN_CONFIDENCE
    const minBodyHeight = isSeatedRow ? 0.16 : MIN_BODY_HEIGHT
    const minEdgeMargin = isSeatedRow ? 0.005 : MIN_EDGE_MARGIN
    const requiredRatio = isSeatedRow ? 0.62 : 0.75
    const visibleCount = landmarks.reduce((count, point) => count + ((point && (point.visibility ?? 0) > 0.28) ? 1 : 0), 0)
    const enteredFrame = visibleCount > 0
    const avgConfidence = calcAverageVisibility(landmarks)
    const reliableRequired = requiredIndexes.reduce((count, idx) => (
      count + (((landmarks[idx]?.visibility ?? 0) > 0.28) ? 1 : 0)
    ), 0)
    const bounds = calcBounds(landmarks, requiredIndexes)
    const bodyHeight = bounds ? bounds.maxY - bounds.minY : 0
    const edgeMargin = bounds ? Math.min(bounds.minX, 1 - bounds.maxX, bounds.minY, 1 - bounds.maxY) : 0
    const reasons = []

    if (frameWidth && frameHeight && frameWidth * frameHeight < FRAME_MIN_PIXELS) {
      reasons.push('视频分辨率不足，建议至少 640x480')
    }
    if (visibleCount < minVisibleCount) {
      reasons.push('有效关键点数量不足')
    }
    if (avgConfidence < minConfidence) {
      reasons.push('骨骼置信度不足')
    }
    if (reliableRequired < Math.ceil(requiredIndexes.length * requiredRatio)) {
      reasons.push('器械动作所需关键点缺失较多')
    }
    if (bodyHeight < minBodyHeight) {
      reasons.push('人物在画面中占比过小')
    }
    if (edgeMargin < minEdgeMargin) {
      reasons.push('人物过于贴近画面边缘')
    }

    const scorePenalty = reasons.length * 16
    const score = Math.max(0, 100 - scorePenalty)
    const label = score >= 82 ? '高' : score >= 62 ? '中' : '低'

    return {
      enteredFrame,
      judgeable: enteredFrame,
      score,
      label,
      reasons,
      metrics: {
        visibleCount,
        avgConfidence: Number(avgConfidence.toFixed(4)),
        reliableRequired,
        bodyHeight: Number(bodyHeight.toFixed(4)),
        edgeMargin: Number(edgeMargin.toFixed(4)),
        frameWidth,
        frameHeight,
      },
    }
  }

  const commitRep = (now) => {
    if (now - lastRepAt < REP_COOLDOWN_MS) return false
    repCount.value += 1
    lastRepAt = now
    return true
  }

  const buildPrompt = (equipment, ageGroup, issueKey, phase, completed, eventKey = '') => {
    const agePrompts = VOICE_PROMPTS[ageGroup] || VOICE_PROMPTS.youth
    const equipmentPrompts = agePrompts[equipment] || {}
    if (issueKey === 'invalid_frame') {
      return {
        voiceText: equipmentPrompts.invalid_frame || agePrompts.invalid_frame,
        voiceKey: equipmentPrompts.invalid_frame ? `${equipment}:invalid_frame` : `${ageGroup}:invalid_frame`,
      }
    }
    if (eventKey && equipmentPrompts[eventKey]) {
      return {
        voiceText: equipmentPrompts[eventKey],
        voiceKey: `${equipment}:${eventKey}`,
      }
    }

    if (completed && equipmentPrompts.completed) {
      return {
        voiceText: equipmentPrompts.completed,
        voiceKey: `${equipment}:completed`,
      }
    }

    if (issueKey && equipmentPrompts[issueKey]) {
      return {
        voiceText: equipmentPrompts[issueKey],
        voiceKey: `${equipment}:${issueKey}`,
      }
    }

    if (equipmentPrompts[phase]) {
      return {
        voiceText: equipmentPrompts[phase],
        voiceKey: `${equipment}:${phase}`,
      }
    }

    return {
      voiceText: '',
      voiceKey: '',
    }
  }

  const analyzeSmithSquat = (landmarks, angles, now) => {
    const ls = getPoint(landmarks, KP.L_SHOULDER)
    const rs = getPoint(landmarks, KP.R_SHOULDER)
    const lh = getPoint(landmarks, KP.L_HIP)
    const rh = getPoint(landmarks, KP.R_HIP)
    const lk = getPoint(landmarks, KP.L_KNEE)
    const rk = getPoint(landmarks, KP.R_KNEE)
    const la = getPoint(landmarks, KP.L_ANKLE)
    const ra = getPoint(landmarks, KP.R_ANKLE)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const kneeMid = midpoint(lk, rk)
    const ankleMid = midpoint(la, ra)
    const kneeAngle = average(angles.leftKnee, angles.rightKnee)
    const state = counterState.smith_squat
    const shoulderWidth = Math.max(Math.abs((ls?.x ?? 0) - (rs?.x ?? 0)), 0.12)
    const ankleWidth = Math.abs((la?.x ?? 0) - (ra?.x ?? 0))
    const thighLength = average(distance(lh, lk), distance(rh, rk)) ?? 0
    const torsoLean = angleFromVertical(shoulderMid, hipMid)
    const kneeTrack = kneeMid && ankleMid ? Math.abs(kneeMid.x - ankleMid.x) <= shoulderWidth * 0.35 : null
    const targetDepthY = kneeMid ? kneeMid.y - Math.min(0.03, Math.max(0.012, thighLength * 0.08)) : null

    if (kneeAngle != null) {
      state.repMinKneeAngle = state.repMinKneeAngle == null ? kneeAngle : Math.min(state.repMinKneeAngle, kneeAngle)
    }
    if (hipMid) {
      state.repLowestHipY = state.repLowestHipY == null ? hipMid.y : Math.max(state.repLowestHipY, hipMid.y)
    }

    const bottomByAngle = state.repMinKneeAngle != null ? state.repMinKneeAngle <= 110 : false
    const bottomByHip = state.repLowestHipY != null && targetDepthY != null ? state.repLowestHipY >= targetDepthY : false
    const depthReached = bottomByAngle || bottomByHip
    const topReached = kneeAngle != null && hipMid && kneeMid
      ? kneeAngle >= 156 && hipMid.y < kneeMid.y - 0.07
      : false
    let phase = PHASES.READY

    if (depthReached) {
      phase = PHASES.BOTTOM
      state.depthReached = true
    } else if (kneeAngle != null && state.lastKneeAngle != null) {
      if (kneeAngle < state.lastKneeAngle - 1.2) phase = PHASES.DESCENT
      if (kneeAngle > state.lastKneeAngle + 1.2) phase = PHASES.ASCENT
    }
    if (topReached) phase = PHASES.TOP

    const depthValidatedNow = depthReached && !state.depthPraiseSent
    if (depthValidatedNow) {
      state.depthPraiseSent = true
    }

    const completed = topReached && state.depthReached ? commitRep(now) : false
    if (completed || topReached) {
      state.depthReached = false
      state.depthPraiseSent = false
      state.repMinKneeAngle = null
      state.repLowestHipY = null
    }
    state.lastKneeAngle = kneeAngle

    const assessment = makeAssessment([
      createItem('stance_stable', '站距稳定', ankleWidth >= shoulderWidth * 0.8 && ankleWidth <= shoulderWidth * 1.6, '站距稳定，支撑面合理', '站距偏窄或偏宽，重心不稳'),
      createItem('torso_neutral', '躯干稳定', torsoLean != null ? torsoLean <= 24 : null, '躯干保持中立，胸廓稳定', '躯干前倾偏大，容易借腰代偿'),
      createItem('knee_track', '膝盖朝向', kneeTrack, '膝盖朝向与脚尖基本一致', '膝盖轨迹偏移，存在内扣风险'),
      createItem('squat_depth', '下蹲深度', phase === PHASES.DESCENT || phase === PHASES.BOTTOM || phase === PHASES.ASCENT ? depthReached : null, '下蹲深度达到目标区间', '下蹲深度不足，股髋协同不够'),
      createItem('ankle_stable', '脚底稳定', ankleMid && shoulderWidth ? Math.abs((la?.x ?? 0) - (ra?.x ?? 0)) >= shoulderWidth * 0.75 : null, '双脚支撑稳定，踝部控制良好', '脚底支撑不稳，建议先稳住踝部'),
    ])

    return {
      phase,
      assessment,
      completed,
      eventKey: depthValidatedNow ? 'depth_ok' : '',
      meta: {
        kneeAngle,
        minKneeAngle: state.repMinKneeAngle,
        targetDepthY,
        lowestHipY: state.repLowestHipY,
        depthReached,
      },
    }
  }

  const analyzeLegExtension = (landmarks, angles, now) => {
    const ls = getPoint(landmarks, KP.L_SHOULDER)
    const rs = getPoint(landmarks, KP.R_SHOULDER)
    const lh = getPoint(landmarks, KP.L_HIP)
    const rh = getPoint(landmarks, KP.R_HIP)
    const lk = getPoint(landmarks, KP.L_KNEE)
    const rk = getPoint(landmarks, KP.R_KNEE)
    const la = getPoint(landmarks, KP.L_ANKLE)
    const ra = getPoint(landmarks, KP.R_ANKLE)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const kneeMid = midpoint(lk, rk)
    const ankleMid = midpoint(la, ra)
    const kneeAngle = average(angles.leftKnee, angles.rightKnee)
    const state = counterState.leg_extension
    const topReached = kneeAngle != null ? kneeAngle >= 160 : false
    const loadReached = kneeAngle != null ? kneeAngle <= 105 : false
    let phase = PHASES.READY

    if (topReached) {
      phase = PHASES.EXTEND
    } else if (loadReached) {
      phase = PHASES.RETURN
      state.loaded = true
    } else if (kneeAngle != null && state.lastKneeAngle != null) {
      phase = kneeAngle > state.lastKneeAngle ? PHASES.EXTEND : PHASES.RETURN
    }

    const completed = topReached && state.loaded ? commitRep(now) : false
    if (completed || topReached) state.loaded = false
    const delta = kneeAngle != null && state.lastKneeAngle != null ? Math.abs(kneeAngle - state.lastKneeAngle) : 0
    state.lastKneeAngle = kneeAngle

    const assessment = makeAssessment([
      createItem('seated_stable', '坐姿稳定', shoulderMid && hipMid ? Math.abs(shoulderMid.x - hipMid.x) <= 0.2 : null, '后背贴垫，坐姿稳定', '坐姿前后晃动明显，影响发力'),
      createItem('thigh_stable', '大腿固定', hipMid && kneeMid ? Math.abs(hipMid.y - kneeMid.y) <= 0.18 : null, '大腿基本固定，只动小腿', '大腿跟着摆动，目标肌群不够集中'),
      createItem('top_extension', '伸展到位', phase === PHASES.EXTEND || phase === PHASES.RETURN ? topReached : null, '顶端伸展到位，股四头肌收缩明显', '顶端伸展不足，动作幅度偏小'),
      createItem('controlled_return', '回程控制', phase === PHASES.RETURN ? delta <= 20 : null, '回程速度可控，离心质量较好', '回程过快，存在借惯性风险'),
      createItem('lower_leg_path', '小腿轨迹', kneeMid && ankleMid ? Math.abs(kneeMid.x - ankleMid.x) <= 0.22 : null, '小腿抬起轨迹稳定', '小腿轨迹偏斜，建议减轻重量'),
    ])

    return { phase, assessment, completed }
  }

  const analyzeSeatedRow = (landmarks, angles, now) => {
    const ls = getPoint(landmarks, KP.L_SHOULDER)
    const rs = getPoint(landmarks, KP.R_SHOULDER)
    const lw = getPoint(landmarks, KP.L_WRIST)
    const rw = getPoint(landmarks, KP.R_WRIST)
    const lh = getPoint(landmarks, KP.L_HIP)
    const rh = getPoint(landmarks, KP.R_HIP)
    const lk = getPoint(landmarks, KP.L_KNEE)
    const rk = getPoint(landmarks, KP.R_KNEE)
    const la = getPoint(landmarks, KP.L_ANKLE)
    const ra = getPoint(landmarks, KP.R_ANKLE)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const kneeMid = midpoint(lk, rk)
    const ankleMid = midpoint(la, ra)
    const handDistance = average(
      lw && hipMid ? Math.abs(lw.x - hipMid.x) : null,
      rw && hipMid ? Math.abs(rw.x - hipMid.x) : null,
    )
    const shoulderWidth = Math.max(Math.abs((ls?.x ?? 0) - (rs?.x ?? 0)), 0.12)
    const pullReached = handDistance != null ? handDistance <= shoulderWidth * 0.55 : false
    const extendReached = handDistance != null ? handDistance >= shoulderWidth * 1.15 : false
    const torsoLean = angleFromVertical(shoulderMid, hipMid)
    const state = counterState.seated_row
    const pullDelta = handDistance != null && state.lastDistance != null ? Math.abs(handDistance - state.lastDistance) : null
    const pullJerk = pullDelta != null && state.lastPullDelta != null ? Math.abs(pullDelta - state.lastPullDelta) : null
    const upperLegAnchor = Math.max(average(distance(lh, lk), distance(rh, rk)) ?? 0, 0.12)
    const kneeTravelThreshold = Math.max(0.035, upperLegAnchor * 0.11)
    const pullDeltaThreshold = Math.max(0.016, shoulderWidth * 0.14)
    const pullJerkThreshold = Math.max(0.011, shoulderWidth * 0.1)
    const torsoStable = torsoLean != null ? torsoLean <= 20 : null
    const currentKneeTravel = kneeMid && state.repStartKneeMid
      ? distance(kneeMid, state.repStartKneeMid)
      : null
    const kneeStable = currentKneeTravel != null ? currentKneeTravel <= kneeTravelThreshold : null
    const pullStableNow = pullDelta != null
      ? pullDelta <= pullDeltaThreshold && (pullJerk == null || pullJerk <= pullJerkThreshold)
      : null
    const pullStable = phase => phase === PHASES.PULL || phase === PHASES.RETURN
      ? pullStableNow
      : null
    let phase = PHASES.READY

    if (!state.repStarted && handDistance != null && !extendReached) {
      state.repStarted = true
      state.repMaxTorsoLean = torsoLean
      state.repStartKneeMid = kneeMid ? { x: kneeMid.x, y: kneeMid.y } : null
      state.repMaxKneeTravel = 0
      state.repMaxPullDelta = pullDelta ?? 0
      state.repMaxPullJerk = pullJerk ?? 0
    } else if (state.repStarted) {
      updateSeatedRowRepWindow(state, {
        torsoLean,
        kneeMid,
        pullDelta,
        pullJerk,
      })
    }

    if (pullReached) {
      phase = PHASES.PULL
      state.pulled = true
    } else if (extendReached) {
      phase = PHASES.RETURN
    } else if (handDistance != null && state.lastDistance != null) {
      phase = handDistance < state.lastDistance ? PHASES.PULL : PHASES.RETURN
    }

    const completed = extendReached && state.pulled ? commitRep(now) : false

    let assessment = makeAssessment([
      createItem('torso_stable', '躯干稳定', torsoStable, '躯干较稳定，回拉时没有明显前后晃动', '躯干前后移动偏大，建议先稳定身体再回拉'),
      createItem('knee_stable', '膝盖稳定', kneeStable, '膝盖位置比较稳定，没有明显大范围移动', '膝盖位置移动偏大，建议固定下肢支撑'),
      createItem('pull_stable', '回拉平稳', pullStable(phase), '回拉速度比较均匀，没有明显猛拽', '检测到明显猛拽或突然发力，建议放慢速度控制回拉'),
    ])

    let eventKey = ''
    let eventRepOffset = 1

    if (completed) {
      const repAssessment = buildSeatedRowRepAssessment(state, {
        maxTorsoLean: 22,
        maxKneeTravel: kneeTravelThreshold,
        maxPullDelta: pullDeltaThreshold,
        maxPullJerk: pullJerkThreshold,
      })
      const repIssueKey = getPrimaryIssue(repAssessment)
      const repQualified = (repAssessment.score ?? 0) >= 67
        && repAssessment.items.find((item) => item.key === 'pull_stable')?.ok !== false
        && repAssessment.items.find((item) => item.key === 'torso_stable')?.ok !== false

      assessment = repAssessment
      eventKey = repQualified ? 'rep_ok' : repIssueKey
      eventRepOffset = 0
    }

    if (completed || extendReached) {
      state.pulled = false
      resetSeatedRowRepWindow(state)
    }
    state.lastDistance = handDistance
    state.lastPullDelta = pullDelta

    return { phase, assessment, completed, eventKey, eventRepOffset }
  }

  const analyzeCableFly = (landmarks, angles, now) => {
    const nose = getPoint(landmarks, KP.NOSE)
    const ls = getPoint(landmarks, KP.L_SHOULDER)
    const rs = getPoint(landmarks, KP.R_SHOULDER)
    const lw = getPoint(landmarks, KP.L_WRIST)
    const rw = getPoint(landmarks, KP.R_WRIST)
    const lh = getPoint(landmarks, KP.L_HIP)
    const rh = getPoint(landmarks, KP.R_HIP)
    const shoulderMid = midpoint(ls, rs)
    const hipMid = midpoint(lh, rh)
    const shoulderWidth = Math.max(Math.abs((ls?.x ?? 0) - (rs?.x ?? 0)), 0.12)
    const wristSpan = lw && rw ? Math.abs(lw.x - rw.x) : null
    const closeReached = wristSpan != null ? wristSpan <= shoulderWidth * 0.55 : false
    const openReached = wristSpan != null ? wristSpan >= shoulderWidth * 1.55 : false
    const state = counterState.cable_fly
    let phase = PHASES.READY

    if (closeReached) {
      phase = PHASES.CLOSE
      state.closed = true
    } else if (openReached) {
      phase = PHASES.OPEN
    } else if (wristSpan != null && state.lastSpan != null) {
      phase = wristSpan < state.lastSpan ? PHASES.CLOSE : PHASES.OPEN
    }

    const completed = openReached && state.closed ? commitRep(now) : false
    if (completed || openReached) state.closed = false
    state.lastSpan = wristSpan

    const shoulderRelaxed = nose && shoulderMid ? shoulderMid.y - nose.y >= 0.1 : null

    const assessment = makeAssessment([
      createItem('fly_symmetry', '双臂对称', lw && rw ? Math.abs(lw.y - rw.y) <= 0.08 : null, '双臂高度基本一致，轨迹对称', '左右手高度差偏大，夹胸路线不稳'),
      createItem('elbow_soft', '肘角稳定', average(angles.leftElbow, angles.rightElbow) != null ? average(angles.leftElbow, angles.rightElbow) >= 135 && average(angles.leftElbow, angles.rightElbow) <= 175 : null, '肘角微屈稳定，张力持续', '肘角过大或过小，容易变成推举'),
      createItem('close_enough', '终点夹紧', phase === PHASES.CLOSE || phase === PHASES.OPEN ? closeReached : null, '终点夹胸到位，胸肌收缩明显', '终点夹胸不足，还没有完全合到中线'),
      createItem('shoulder_relaxed', '肩部放松', shoulderRelaxed, '肩部位置稳定，没有明显耸肩', '肩部上提明显，建议先减轻负荷'),
      createItem('trunk_stable', '躯干稳定', shoulderMid && hipMid ? Math.abs(shoulderMid.x - hipMid.x) <= 0.08 : null, '核心稳定，躯干没有借力晃动', '躯干晃动偏大，存在借力夹胸'),
    ])

    return { phase, assessment, completed }
  }

  const analyzeRomanChair = (landmarks, now) => {
    const nose = getPoint(landmarks, KP.NOSE)
    const leftSet = [getPoint(landmarks, KP.L_SHOULDER), getPoint(landmarks, KP.L_HIP), getPoint(landmarks, KP.L_KNEE)]
    const rightSet = [getPoint(landmarks, KP.R_SHOULDER), getPoint(landmarks, KP.R_HIP), getPoint(landmarks, KP.R_KNEE)]
    const leftScore = leftSet.reduce((sum, point) => sum + (point?.visibility ?? 0), 0)
    const rightScore = rightSet.reduce((sum, point) => sum + (point?.visibility ?? 0), 0)
    const [shoulder, hip, knee] = leftScore >= rightScore ? leftSet : rightSet
    const hipAngle = calcAngle(shoulder, hip, knee)
    const state = counterState.roman_chair
    const topReached = hipAngle != null ? hipAngle >= 160 && hipAngle <= 178 : false
    const bottomReached = hipAngle != null ? hipAngle <= 145 : false
    let phase = PHASES.READY

    if (bottomReached) {
      phase = PHASES.DESCENT
      state.folded = true
    } else if (topReached) {
      phase = PHASES.TOP
    } else if (hipAngle != null && state.lastHipAngle != null) {
      phase = hipAngle > state.lastHipAngle ? PHASES.ASCENT : PHASES.DESCENT
    }

    const completed = topReached && state.folded ? commitRep(now) : false
    if (completed || topReached) state.folded = false
    const delta = hipAngle != null && state.lastHipAngle != null ? Math.abs(hipAngle - state.lastHipAngle) : 0
    state.lastHipAngle = hipAngle

    const assessment = makeAssessment([
      createItem('hip_hinge', '髋部折叠', phase === PHASES.DESCENT || phase === PHASES.ASCENT || phase === PHASES.TOP ? bottomReached : null, '髋部折叠幅度达到训练要求', '下放幅度不足，髋铰链不够明显'),
      createItem('no_overextend', '顶端不过伸', hipAngle != null ? hipAngle <= 178 : null, '顶端控制在身体一条线附近', '顶端后仰偏多，腰椎过伸风险上升'),
      createItem('neck_neutral', '颈部中立', nose && shoulder ? Math.abs(nose.y - shoulder.y) <= 0.12 : null, '颈部中立，头部跟随躯干', '抬头过多，颈部代偿明显'),
      createItem('tempo_stable', '节奏稳定', phase === PHASES.ASCENT || phase === PHASES.DESCENT ? delta <= 18 : null, '节奏平稳，没有明显甩动', '动作借力偏多，建议放慢节奏'),
    ])

    return { phase, assessment, completed }
  }

  const analyzeEquipment = (equipment, landmarks, angles, now) => {
    if (equipment === 'leg_extension') return analyzeLegExtension(landmarks, angles, now)
    if (equipment === 'seated_row') return analyzeSeatedRow(landmarks, angles, now)
    if (equipment === 'cable_fly') return analyzeCableFly(landmarks, angles, now)
    if (equipment === 'roman_chair') return analyzeRomanChair(landmarks, now)
    return analyzeSmithSquat(landmarks, angles, now)
  }

  const reset = () => {
    repCount.value = 0
    currentPhase.value = PHASES.INVALID
    latestAssessment.value = { score: null, items: [] }
    frameBuffer.length = 0
    lastRepAt = 0
    currentEquipment.value = FITNESS_EQUIPMENT_OPTIONS[0].value
    counterState.smith_squat = {
      depthReached: false,
      lastKneeAngle: null,
      repMinKneeAngle: null,
      repLowestHipY: null,
      depthPraiseSent: false,
    }
    counterState.leg_extension = { loaded: false, lastKneeAngle: null }
    counterState.seated_row = createSeatedRowCounterState()
    counterState.cable_fly = { closed: false, lastSpan: null }
    counterState.roman_chair = { folded: false, lastHipAngle: null }
  }

  const setEquipment = (equipment) => {
    currentEquipment.value = equipment
    repCount.value = 0
    currentPhase.value = PHASES.READY
    latestAssessment.value = { score: null, items: [] }
    frameBuffer.length = 0
    lastRepAt = 0
    counterState.smith_squat = {
      depthReached: false,
      lastKneeAngle: null,
      repMinKneeAngle: null,
      repLowestHipY: null,
      depthPraiseSent: false,
    }
    counterState.leg_extension = { loaded: false, lastKneeAngle: null }
    counterState.seated_row = createSeatedRowCounterState()
    counterState.cable_fly = { closed: false, lastSpan: null }
    counterState.roman_chair = { folded: false, lastHipAngle: null }
  }

  const analyze = (landmarks, angles, options = {}) => {
    const equipment = options.equipment || currentEquipment.value
    const ageGroup = options.ageGroup || 'youth'
    const frameWidth = Number(options.frameWidth || 0)
    const frameHeight = Number(options.frameHeight || 0)
    const now = Date.now()

    currentEquipment.value = equipment

    if (!Array.isArray(landmarks) || landmarks.length < 29) {
      currentPhase.value = PHASES.INVALID
      latestAssessment.value = { score: null, items: [] }
      const quality = {
        judgeable: false,
        score: 0,
        label: '低',
        reasons: ['未检测到稳定人体骨骼'],
        metrics: {
          visibleCount: 0,
          avgConfidence: 0,
          reliableRequired: 0,
          bodyHeight: 0,
          edgeMargin: 0,
          frameWidth,
          frameHeight,
        },
      }
      const prompt = buildPrompt(equipment, ageGroup, 'invalid_frame', PHASES.INVALID, false)
      return {
        equipment,
        equipmentLabel: FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === equipment)?.label || '',
        phase: PHASES.INVALID,
        phaseLabel: PHASE_LABELS[PHASES.INVALID],
        repCount: repCount.value,
        judgeable: false,
        rejectionReason: '未检测到稳定人体骨骼',
        quality,
        assessment: { score: null, items: [] },
        cueText: quality.reasons[0],
        cueTone: 'warning',
        voiceText: prompt.voiceText,
        voiceKey: prompt.voiceKey,
      }
    }

    pushFrame(landmarks)
    const quality = assessFrameQuality(landmarks, equipment, frameWidth, frameHeight)
    if (!quality.enteredFrame) {
      currentPhase.value = PHASES.INVALID
      latestAssessment.value = { score: null, items: [] }
      const prompt = buildPrompt(equipment, ageGroup, 'invalid_frame', PHASES.INVALID, false)
      return {
        equipment,
        equipmentLabel: FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === equipment)?.label || '',
        phase: PHASES.INVALID,
        phaseLabel: PHASE_LABELS[PHASES.INVALID],
        repCount: repCount.value,
        judgeable: false,
        rejectionReason: quality.reasons[0] || '当前帧不具备判定条件',
        quality,
        assessment: { score: null, items: [] },
        cueText: quality.reasons[0] || '当前帧不具备判定条件',
        cueTone: 'warning',
        voiceText: prompt.voiceText,
        voiceKey: prompt.voiceKey,
      }
    }

    const equipmentResult = analyzeEquipment(equipment, landmarks, angles || {}, now)
    currentPhase.value = equipmentResult.phase
    latestAssessment.value = equipmentResult.assessment
    const primaryIssue = getPrimaryIssue(equipmentResult.assessment)
    const prompt = buildPrompt(
      equipment,
      ageGroup,
      primaryIssue,
      equipmentResult.phase,
      equipmentResult.completed,
      equipmentResult.eventKey || '',
    )
    const voiceKey = !prompt.voiceKey
      ? ''
      : equipmentResult.eventKey
        ? `${prompt.voiceKey}:${repCount.value + 1}`
        : equipmentResult.completed
          ? `${prompt.voiceKey}:${repCount.value}`
          : prompt.voiceKey

    return {
      equipment,
      equipmentLabel: FITNESS_EQUIPMENT_OPTIONS.find((item) => item.value === equipment)?.label || '',
      phase: equipmentResult.phase,
      phaseLabel: PHASE_LABELS[equipmentResult.phase] || equipmentResult.phase,
      repCount: repCount.value,
      judgeable: true,
      rejectionReason: '',
      quality,
      assessment: equipmentResult.assessment,
      cueTone: primaryIssue ? 'warning' : equipmentResult.eventKey === 'depth_ok' || equipmentResult.completed ? 'success' : 'info',
      cueText: primaryIssue
        ? equipmentResult.assessment.items.find((item) => item.key === primaryIssue)?.detail || ''
        : equipmentResult.eventKey === 'depth_ok'
          ? '下蹲深度正确，继续稳定起身'
          : equipmentResult.completed
            ? '动作完成一次，继续按当前节奏训练'
            : quality.reasons[0] || '当前动作轨迹稳定，可以继续训练',
      voiceText: prompt.voiceText,
      voiceKey,
      meta: equipmentResult.meta || {},
    }
  }

  return {
    repCount: readonly(repCount),
    currentPhase: readonly(currentPhase),
    latestAssessment: readonly(latestAssessment),
    analyze,
    reset,
    setEquipment,
  }
}
