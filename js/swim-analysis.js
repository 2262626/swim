/**
 * swim-analysis.js
 * 游泳动作分析模块
 * 功能：先泳姿识别，再按泳姿做阶段拆解 + 划臂计数 + JSON数据输出
 */

const SwimAnalysis = (() => {

  // ── 状态 ─────────────────────────────────────────────────────────
  let strokeCount = 0;
  let strokeHistory = [];
  let lastStrokeTime = 0;

  let detectedStyle = '未知';
  let detectedPhase = '准备';
  let detectedStroke = '未知·准备';

  let frameBuffer = [];
  const BUFFER_SIZE = 30;
  const STROKE_COOLDOWN_MS = 450;

  // ── 泳姿枚举 ─────────────────────────────────────────────────────
  const STROKE_TYPES = {
    FREESTYLE: '自由泳',
    BREASTSTROKE: '蛙泳',
    BACKSTROKE: '仰泳',
    BUTTERFLY: '蝶泳',
    UNKNOWN: '未知',
  };

  // ── 阶段枚举 ─────────────────────────────────────────────────────
  const STROKE_PHASES = {
    ENTRY: '入水',
    CATCH: '抱水',
    PULL: '推水',
    RECOVERY: '回臂',
    GLIDE: '滑行',
    UNKNOWN: '准备',
  };

  // ── 导出数据缓冲 ─────────────────────────────────────────────────
  let exportBuffer = [];
  const MAX_EXPORT = 500;

  // ── 重置 ─────────────────────────────────────────────────────────
  function reset() {
    strokeCount = 0;
    strokeHistory = [];
    lastStrokeTime = 0;
    detectedStyle = STROKE_TYPES.UNKNOWN;
    detectedPhase = STROKE_PHASES.UNKNOWN;
    detectedStroke = `${detectedStyle}·${detectedPhase}`;
    frameBuffer = [];
    exportBuffer = [];
  }

  // ── 主分析入口 ───────────────────────────────────────────────────
  function analyze(landmarks, angles) {
    if (!landmarks) return null;

    const now = Date.now();

    frameBuffer.push({ now, landmarks: serializeLandmarks(landmarks) });
    if (frameBuffer.length > BUFFER_SIZE) frameBuffer.shift();

    // 1) 先泳姿分类
    detectedStyle = classifyStyle(landmarks, angles);

    // 2) 再按泳姿拆阶段
    detectedPhase = classifyPhaseByStyle(detectedStyle, landmarks, angles);

    detectedStroke = `${detectedStyle}·${detectedPhase}`;

    // 3) 划臂计数
    if (frameBuffer.length >= 4) {
      detectArmStroke(landmarks, now);
    }

    // 4) 速率 / 对称性
    const rate = calcStrokeRate();
    const symmetry = calcSymmetry(angles);

    const result = {
      style: detectedStyle,
      phase: detectedPhase,
      stroke: detectedStroke,
      strokeCount,
      strokeRate: rate,
      symmetry,
      angles,
      timestamp: now,
    };

    if (exportBuffer.length < MAX_EXPORT) {
      exportBuffer.push(result);
    }

    return result;
  }

  // ── 泳姿分类（简化实战规则）──────────────────────────────────────
  function classifyStyle(landmarks, angles) {
    const kp = SkeletonDraw.KP;

    const ls = landmarks[kp.L_SHOULDER];
    const rs = landmarks[kp.R_SHOULDER];
    const lw = landmarks[kp.L_WRIST];
    const rw = landmarks[kp.R_WRIST];
    const nose = landmarks[kp.NOSE];

    if (!ls || !rs || !lw || !rw) return STROKE_TYPES.UNKNOWN;
    if (ls.visibility < 0.35 || rs.visibility < 0.35 || lw.visibility < 0.3 || rw.visibility < 0.3) {
      return STROKE_TYPES.UNKNOWN;
    }

    const shoulderMidY = (ls.y + rs.y) / 2;

    // 仰泳：头部显著高于肩线
    if (nose && nose.visibility > 0.35 && nose.y < shoulderMidY - 0.08) {
      return STROKE_TYPES.BACKSTROKE;
    }

    const wristYDiff = Math.abs(lw.y - rw.y);
    const wristXSpan = Math.abs(lw.x - rw.x);
    const elbowBent = (angles.leftElbow ?? 180) < 120 || (angles.rightElbow ?? 180) < 120;

    // 蝶泳：双臂同高 + 展宽明显
    if (wristYDiff < 0.06 && wristXSpan > 0.32) {
      return STROKE_TYPES.BUTTERFLY;
    }

    // 蛙泳：双腕居中 + 肘屈明显
    const shoulderMidX = (ls.x + rs.x) / 2;
    const wristMidX = (lw.x + rw.x) / 2;
    const wristsCentered = Math.abs(wristMidX - shoulderMidX) < 0.10;
    if (wristsCentered && wristXSpan < 0.30 && elbowBent) {
      return STROKE_TYPES.BREASTSTROKE;
    }

    return STROKE_TYPES.FREESTYLE;
  }

  // ── 按泳姿分类阶段 ───────────────────────────────────────────────
  function classifyPhaseByStyle(style, landmarks, angles) {
    const kp = SkeletonDraw.KP;

    const ls = landmarks[kp.L_SHOULDER];
    const rs = landmarks[kp.R_SHOULDER];
    const lw = landmarks[kp.L_WRIST];
    const rw = landmarks[kp.R_WRIST];

    if (!ls || !rs || !lw || !rw) return STROKE_PHASES.UNKNOWN;

    const shoulderY = (ls.y + rs.y) / 2;
    const leftDy = lw.y - shoulderY;
    const rightDy = rw.y - shoulderY;
    const minDy = Math.min(leftDy, rightDy);
    const maxDy = Math.max(leftDy, rightDy);

    const leftElbow = angles.leftElbow ?? 180;
    const rightElbow = angles.rightElbow ?? 180;
    const minElbow = Math.min(leftElbow, rightElbow);
    const maxElbow = Math.max(leftElbow, rightElbow);

    if (style === STROKE_TYPES.BREASTSTROKE) {
      if (maxDy < -0.02) return STROKE_PHASES.ENTRY;
      if (minElbow < 115 && Math.abs(leftDy - rightDy) < 0.08) return STROKE_PHASES.CATCH;
      if (maxElbow > 130 && minDy > -0.02) return STROKE_PHASES.PULL;
      return STROKE_PHASES.GLIDE;
    }

    if (style === STROKE_TYPES.BUTTERFLY) {
      if (maxDy < -0.05) return STROKE_PHASES.ENTRY;
      if (minElbow < 125 && Math.abs(leftDy - rightDy) < 0.07) return STROKE_PHASES.CATCH;
      if (maxDy > 0.04 && maxElbow > 130) return STROKE_PHASES.PULL;
      return STROKE_PHASES.RECOVERY;
    }

    if (style === STROKE_TYPES.BACKSTROKE) {
      if (minDy < -0.06) return STROKE_PHASES.RECOVERY;
      if (minElbow < 120 && maxDy <= 0.03) return STROKE_PHASES.CATCH;
      if (maxDy > 0.03 && maxElbow > 130) return STROKE_PHASES.PULL;
      return STROKE_PHASES.ENTRY;
    }

    // 自由泳
    if (minDy < -0.06) return STROKE_PHASES.RECOVERY;
    if (minElbow < 120 && maxDy < 0.04) return STROKE_PHASES.CATCH;
    if (maxDy > 0.04 && maxElbow > 125) return STROKE_PHASES.PULL;
    return STROKE_PHASES.ENTRY;
  }

  // ── 划臂计数：检测手腕过肩线 ───────────────────────────────────
  function detectArmStroke(landmarks, now) {
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return;
    if (frameBuffer.length < 3) return;

    const kp = SkeletonDraw.KP;
    const lw = landmarks[kp.L_WRIST];
    const rw = landmarks[kp.R_WRIST];
    const ls = landmarks[kp.L_SHOULDER];
    const rs = landmarks[kp.R_SHOULDER];

    const prev = frameBuffer[frameBuffer.length - 3];
    const prevLW = prev.landmarks[kp.L_WRIST];
    const prevRW = prev.landmarks[kp.R_WRIST];

    let counted = false;

    if (lw && ls && prevLW && lw.visibility > 0.35 && ls.visibility > 0.35) {
      const crossed = prevLW.y < ls.y && lw.y >= ls.y;
      if (crossed) {
        strokeCount++;
        counted = true;
      }
    }

    if (!counted && rw && rs && prevRW && rw.visibility > 0.35 && rs.visibility > 0.35) {
      const crossed = prevRW.y < rs.y && rw.y >= rs.y;
      if (crossed) {
        strokeCount++;
        counted = true;
      }
    }

    if (counted) {
      lastStrokeTime = now;
      strokeHistory.push(now);
      if (strokeHistory.length > 20) strokeHistory.shift();
    }
  }

  // ── 划臂速率（次/分） ────────────────────────────────────────────
  function calcStrokeRate() {
    if (strokeHistory.length < 2) return 0;
    const span = (strokeHistory[strokeHistory.length - 1] - strokeHistory[0]) / 1000;
    if (span <= 0) return 0;
    const rate = ((strokeHistory.length - 1) / span) * 60;
    return Math.round(rate);
  }

  // ── 身体对称性评分 (0-100，聚焦上肢) ───────────────────────────
  function calcSymmetry(angles) {
    if (!angles) return null;

    const pairs = [
      ['leftElbow', 'rightElbow'],
      ['leftShoulder', 'rightShoulder'],
    ];

    let total = 0;
    let count = 0;
    for (const [l, r] of pairs) {
      if (angles[l] != null && angles[r] != null) {
        const diff = Math.abs(angles[l] - angles[r]);
        total += Math.max(0, 100 - diff);
        count++;
      }
    }

    return count > 0 ? Math.round(total / count) : null;
  }

  // ── 轻量序列化关键点（只保存坐标+置信度）────────────────────────
  function serializeLandmarks(landmarks) {
    return landmarks.map(lm => lm ? { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility } : null);
  }

  // ── 导出 JSON ───────────────────────────────────────────────────
  function exportJSON() {
    const data = {
      exportTime: new Date().toISOString(),
      totalStrokes: strokeCount,
      detectedStyle,
      detectedPhase,
      detectedStroke,
      frames: exportBuffer,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swim-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 手动加一（演示模式）─────────────────────────────────────────
  function addStroke() { strokeCount++; }

  return {
    analyze,
    reset,
    exportJSON,
    addStroke,
    getCount: () => strokeCount,
    getStyle: () => detectedStyle,
    getPhase: () => detectedPhase,
    getStroke: () => detectedStroke,
  };
})();
