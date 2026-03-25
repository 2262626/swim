/**
 * skeleton-draw.js
 * 骨骼绘制模块 — 游泳场景固定关键点渲染
 * 支持：固定关键点、连线、置信度标签
 */

const SkeletonDraw = (() => {

  // ── MediaPipe Pose 33 个关键点索引 ──────────────────────────────
  const KP = {
    NOSE: 0,
    L_EYE_INNER: 1, L_EYE: 2, L_EYE_OUTER: 3,
    R_EYE_INNER: 4, R_EYE: 5, R_EYE_OUTER: 6,
    L_EAR: 7, R_EAR: 8,
    L_MOUTH: 9, R_MOUTH: 10,
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_ELBOW: 13,    R_ELBOW: 14,
    L_WRIST: 15,    R_WRIST: 16,
    L_PINKY: 17,    R_PINKY: 18,
    L_INDEX: 19,    R_INDEX: 20,
    L_THUMB: 21,    R_THUMB: 22,
    L_HIP: 23,      R_HIP: 24,
    L_KNEE: 25,     R_KNEE: 26,
    L_ANKLE: 27,    R_ANKLE: 28,
    L_HEEL: 29,     R_HEEL: 30,
    L_FOOT: 31,     R_FOOT: 32,
  };

  // ── 固定关键连线（上肢 + 躯干核心）──────────────────────────────
  const CONNECTIONS_SWIM_FIXED = [
    [KP.L_SHOULDER, KP.R_SHOULDER],
    [KP.L_HIP, KP.R_HIP],
    [KP.L_SHOULDER, KP.L_HIP],
    [KP.R_SHOULDER, KP.R_HIP],
    [KP.L_SHOULDER, KP.L_ELBOW],
    [KP.L_ELBOW, KP.L_WRIST],
    [KP.R_SHOULDER, KP.R_ELBOW],
    [KP.R_ELBOW, KP.R_WRIST],
  ];

  const POINTS_SWIM_FIXED = [
    KP.L_SHOULDER, KP.R_SHOULDER,
    KP.L_ELBOW, KP.R_ELBOW,
    KP.L_WRIST, KP.R_WRIST,
    KP.L_HIP, KP.R_HIP,
  ];

  const SEGMENT_COLORS = {
    face:    '#b2ebf2',
    torso:   '#00e5ff',
    leftArm: '#69ff47',
    rightArm:'#ffea00',
    leftLeg: '#ea80fc',
    rightLeg:'#ff6e40',
  };

  const faceSet = new Set([KP.NOSE, KP.L_EYE, KP.R_EYE, KP.L_EAR, KP.R_EAR,
                            KP.L_EYE_INNER, KP.R_EYE_INNER, KP.L_EYE_OUTER, KP.R_EYE_OUTER]);
  const torsoSet = new Set([KP.L_SHOULDER, KP.R_SHOULDER, KP.L_HIP, KP.R_HIP]);
  const leftArmSet = new Set([KP.L_SHOULDER, KP.L_ELBOW, KP.L_WRIST, KP.L_INDEX, KP.L_PINKY, KP.L_THUMB]);
  const rightArmSet = new Set([KP.R_SHOULDER, KP.R_ELBOW, KP.R_WRIST, KP.R_INDEX, KP.R_PINKY, KP.R_THUMB]);
  const leftLegSet = new Set([KP.L_HIP, KP.L_KNEE, KP.L_ANKLE, KP.L_HEEL, KP.L_FOOT]);

  function getSegmentColor(start, end) {
    if (faceSet.has(start) && faceSet.has(end)) return SEGMENT_COLORS.face;
    if (torsoSet.has(start) && torsoSet.has(end)) return SEGMENT_COLORS.torso;
    if (leftArmSet.has(start) || leftArmSet.has(end)) return SEGMENT_COLORS.leftArm;
    if (rightArmSet.has(start) || rightArmSet.has(end)) return SEGMENT_COLORS.rightArm;
    if (leftLegSet.has(start) || leftLegSet.has(end)) return SEGMENT_COLORS.leftLeg;
    return SEGMENT_COLORS.rightLeg;
  }

  // ── 配置 ─────────────────────────────────────────────────────────
  let config = {
    lineColor: null,
    lineWidth: 3,
    dotColor: '#ffffff',
    dotRadius: 5,
    showLabels: true,
    upperOnly: true,
    minVisibility: 0.35,
    enableShadow: !(/Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)),
  };

  function setConfig(opts) {
    Object.assign(config, opts);
  }

  // ── 工具：计算三点夹角（度） ─────────────────────────────────────
  function calcAngle(a, b, c) {
    const rad = Math.atan2(c.y - b.y, c.x - b.x)
              - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180 / Math.PI));
    if (deg > 180) deg = 360 - deg;
    return Math.round(deg);
  }

  // ── 主绘制函数 ───────────────────────────────────────────────────
  function draw(ctx, landmarks, canvasW, canvasH) {
    if (!landmarks || landmarks.length === 0) return;

    const connections = CONNECTIONS_SWIM_FIXED;

    // 1. 连线
    connections.forEach(([si, ei]) => {
      const s = landmarks[si];
      const e = landmarks[ei];
      if (!s || !e) return;
      if (s.visibility < config.minVisibility || e.visibility < config.minVisibility) return;

      const sx = s.x * canvasW;
      const sy = s.y * canvasH;
      const ex = e.x * canvasW;
      const ey = e.y * canvasH;

      const color = config.lineColor || getSegmentColor(si, ei);

      ctx.save();
      if (config.enableShadow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = config.lineWidth;
      ctx.lineCap = 'round';
      ctx.globalAlpha = Math.min(1, (s.visibility + e.visibility) / 2 + 0.3);
      ctx.stroke();
      ctx.restore();
    });

    // 2. 固定关键点
    POINTS_SWIM_FIXED.forEach((idx) => {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < config.minVisibility) return;

      const x = lm.x * canvasW;
      const y = lm.y * canvasH;
      const alpha = Math.min(1, lm.visibility + 0.2);

      ctx.save();
      ctx.globalAlpha = alpha;

      const r = config.dotRadius + 2;
      const dotColor = config.lineColor || '#ffffff';

      if (config.enableShadow) {
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 8;
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = dotColor;
      ctx.globalAlpha = alpha * 0.35;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    });

    if (config.showLabels) {
      drawLabels(ctx, landmarks, canvasW, canvasH);
    }
  }

  function drawLabels(ctx, landmarks, w, h) {
    const labelMap = {
      [KP.L_SHOULDER]: '左肩', [KP.R_SHOULDER]: '右肩',
      [KP.L_ELBOW]:    '左肘', [KP.R_ELBOW]:    '右肘',
      [KP.L_WRIST]:    '左腕', [KP.R_WRIST]:    '右腕',
    };

    ctx.save();
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';

    for (const [idxStr, name] of Object.entries(labelMap)) {
      const idx = parseInt(idxStr);
      const lm = landmarks[idx];
      if (!lm || lm.visibility < 0.5) continue;

      const x = lm.x * w;
      const y = lm.y * h - 12;
      const pct = Math.round(lm.visibility * 100);

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 14, y - 11, 28, 13);

      ctx.fillStyle = pct > 70 ? '#69ff47' : pct > 50 ? '#ffea00' : '#ff6e40';
      ctx.fillText(`${pct}%`, x, y);
    }

    ctx.restore();
  }

  // ── 获取关节角度集合 ─────────────────────────────────────────────
  function getJointAngles(landmarks) {
    if (!landmarks) return {};

    const lm = landmarks;
    const result = {};

    const safe = (i) => lm[i] && lm[i].visibility > 0.3 ? lm[i] : null;

    const ls = safe(KP.L_SHOULDER), le = safe(KP.L_ELBOW), lw = safe(KP.L_WRIST);
    const rs = safe(KP.R_SHOULDER), re = safe(KP.R_ELBOW), rw = safe(KP.R_WRIST);
    const lh = safe(KP.L_HIP),      lk = safe(KP.L_KNEE),  la = safe(KP.L_ANKLE);
    const rh = safe(KP.R_HIP),      rk = safe(KP.R_KNEE),  ra = safe(KP.R_ANKLE);

    if (ls && le && lw) result.leftElbow     = calcAngle(ls, le, lw);
    if (rs && re && rw) result.rightElbow    = calcAngle(rs, re, rw);
    if (le && ls && lh) result.leftShoulder  = calcAngle(le, ls, lh);
    if (re && rs && rh) result.rightShoulder = calcAngle(re, rs, rh);
    if (lh && lk && la) result.leftKnee      = calcAngle(lh, lk, la);
    if (rh && rk && ra) result.rightKnee     = calcAngle(rh, rk, ra);

    return result;
  }

  return { draw, setConfig, getJointAngles, KP };
})();
