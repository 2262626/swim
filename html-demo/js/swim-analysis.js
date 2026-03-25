/**
 * swim-analysis.js
 * 游泳动作分析模块
 * 功能：泳姿识别、划臂计数、动作节律检测、JSON数据输出
 */

const SwimAnalysis = (() => {

  // ── 状态 ─────────────────────────────────────────────────────────
  let strokeCount = 0;
  let strokeHistory = [];       // { time, wristY_left, wristY_right }
  let lastStrokeTime = 0;
  let detectedStroke = '未知';
  let frameBuffer = [];         // 最近 N 帧关键点缓存（用于动作分类）
  const BUFFER_SIZE = 30;
  const STROKE_COOLDOWN_MS = 400;

  // ── 泳姿特征枚举 ──────────────────────────────────────────────────
  const STROKE_TYPES = {
    FREESTYLE:   '自由泳',
    BREASTSTROKE:'蛙泳',
    BACKSTROKE:  '仰泳',
    BUTTERFLY:   '蝶泳',
    UNKNOWN:     '未知',
  };

  // ── 导出数据缓冲 ─────────────────────────────────────────────────
  let exportBuffer = [];
  const MAX_EXPORT = 500;

  // ── 重置 ─────────────────────────────────────────────────────────
  function reset() {
    strokeCount = 0;
    strokeHistory = [];
    lastStrokeTime = 0;
    detectedStroke = '未知';
    frameBuffer = [];
    exportBuffer = [];
  }

  // ── 主分析入口 ───────────────────────────────────────────────────
  function analyze(landmarks, angles) {
    if (!landmarks) return null;

    const kp = SkeletonDraw.KP;
    const now = Date.now();

    const lw = landmarks[kp.L_WRIST];
    const rw = landmarks[kp.R_WRIST];
    const ls = landmarks[kp.L_SHOULDER];
    const rs = landmarks[kp.R_SHOULDER];
    const lh = landmarks[kp.L_HIP];
    const rh = landmarks[kp.R_HIP];

    // 过滤低置信度帧
    const leftVisible  = lw && lw.visibility > 0.35;
    const rightVisible = rw && rw.visibility > 0.35;

    // 缓存帧
    frameBuffer.push({ now, landmarks: serializeLandmarks(landmarks) });
    if (frameBuffer.length > BUFFER_SIZE) frameBuffer.shift();

    // ── 1. 泳姿识别 ────────────────────────────────────────────────
    detectedStroke = classifyStroke(landmarks, angles);

    // ── 2. 划臂计数 ────────────────────────────────────────────────
    if ((leftVisible || rightVisible) && frameBuffer.length >= 4) {
      detectArmStroke(landmarks, now);
    }

    // ── 3. 平均速率（次/分） ────────────────────────────────────────
    const rate = calcStrokeRate();

    // ── 4. 身体对称性评分 ──────────────────────────────────────────
    const symmetry = calcSymmetry(landmarks, angles);

    const result = {
      stroke: detectedStroke,
      strokeCount,
      strokeRate: rate,
      symmetry,
      angles,
      timestamp: now,
    };

    // 缓存导出数据
    if (exportBuffer.length < MAX_EXPORT) {
      exportBuffer.push(result);
    }

    return result;
  }

  // ── 泳姿分类（基于身体姿态特征）────────────────────────────────
  function classifyStroke(landmarks, angles) {
    if (!landmarks || frameBuffer.length < 5) return STROKE_TYPES.UNKNOWN;

    const kp = SkeletonDraw.KP;

    const nose  = landmarks[kp.NOSE];
    const ls    = landmarks[kp.L_SHOULDER];
    const rs    = landmarks[kp.R_SHOULDER];
    const lh    = landmarks[kp.L_HIP];
    const rh    = landmarks[kp.R_HIP];
    const lw    = landmarks[kp.L_WRIST];
    const rw    = landmarks[kp.R_WRIST];

    if (!ls || !rs || !lh || !rh) return STROKE_TYPES.UNKNOWN;

    // 肩部 Y 均值与髋部 Y 均值 → 仰泳时 nose.y < shoulder.y（面朝上）
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;

    // 仰泳：鼻子 Y 值明显低于肩部（视角下方），且手腕基本在肩部外侧
    if (nose && nose.visibility > 0.4) {
      if (nose.y < shoulderMidY - 0.08) {
        return STROKE_TYPES.BACKSTROKE;
      }
    }

    // 蝶泳：双臂同时对称动作 → 左右腕 Y 差值极小
    if (lw && rw && lw.visibility > 0.35 && rw.visibility > 0.35) {
      const wristYDiff = Math.abs(lw.y - rw.y);
      const wristXSpan = Math.abs(lw.x - rw.x);
      if (wristYDiff < 0.06 && wristXSpan > 0.35) {
        return STROKE_TYPES.BUTTERFLY;
      }

      // 蛙泳：双腕在胸前聚拢，且肘部角度较小
      const wristXDiff = Math.abs(lw.x - rw.x);
      const midShoulderX = (ls.x + rs.x) / 2;
      const wristMidX = (lw.x + rw.x) / 2;
      const isWristCentered = Math.abs(wristMidX - midShoulderX) < 0.12;
      const isElbowBent = (angles.leftElbow && angles.leftElbow < 120)
                        || (angles.rightElbow && angles.rightElbow < 120);
      if (isWristCentered && isElbowBent && wristXDiff < 0.3) {
        return STROKE_TYPES.BREASTSTROKE;
      }
    }

    // 自由泳：单臂交替，肩部有侧滚
    const shoulderXDiff = Math.abs(ls.x - rs.x);
    if (shoulderXDiff > 0.08) {
      return STROKE_TYPES.FREESTYLE;
    }

    return detectedStroke !== STROKE_TYPES.UNKNOWN ? detectedStroke : STROKE_TYPES.FREESTYLE;
  }

  // ── 划臂计数：检测手腕过肩上缘（入水峰值）─────────────────────
  function detectArmStroke(landmarks, now) {
    if (now - lastStrokeTime < STROKE_COOLDOWN_MS) return;

    const kp = SkeletonDraw.KP;
    const lw = landmarks[kp.L_WRIST];
    const rw = landmarks[kp.R_WRIST];
    const ls = landmarks[kp.L_SHOULDER];
    const rs = landmarks[kp.R_SHOULDER];

    if (frameBuffer.length < 3) return;

    // 取前3帧的腕部Y均值
    const prev = frameBuffer[frameBuffer.length - 3];
    const prevLW = prev.landmarks[kp.L_WRIST];
    const prevRW = prev.landmarks[kp.R_WRIST];

    let counted = false;

    // 左腕：从上方经过肩部水平线（y 坐标由小变大，表示手从上入水）
    if (lw && ls && prevLW && lw.visibility > 0.4 && ls.visibility > 0.4) {
      const crossed = prevLW.y < ls.y && lw.y >= ls.y;
      if (crossed) {
        strokeCount++;
        counted = true;
      }
    }

    // 右腕
    if (!counted && rw && rs && prevRW && rw.visibility > 0.4 && rs.visibility > 0.4) {
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

  // ── 身体对称性评分 (0-100) ───────────────────────────────────────
  function calcSymmetry(landmarks, angles) {
    if (!angles) return null;

    const pairs = [
      ['leftElbow', 'rightElbow'],
      ['leftShoulder', 'rightShoulder'],
      ['leftKnee', 'rightKnee'],
    ];

    let total = 0, count = 0;
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

  return { analyze, reset, exportJSON, addStroke, getCount: () => strokeCount };
})();
