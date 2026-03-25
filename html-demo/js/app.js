/**
 * app.js
 * 主控制器 — 连接 PoseEngine / SkeletonDraw / SwimAnalysis 与 UI
 */

window.addEventListener('load', function () {
(function () {
  'use strict';

  // ── DOM 引用 ───────────────────────────────────────────────────────
  const video          = document.getElementById('video');
  const canvas         = document.getElementById('output-canvas');
  const ctx            = canvas.getContext('2d');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText    = document.getElementById('loading-text');
  const loadingBar     = document.getElementById('loading-bar');
  const scanLine       = document.getElementById('scan-line');
  const badgeDot       = document.getElementById('badge-dot');
  const badgeLabel     = document.getElementById('badge-label');

  // 统计
  const valStroke   = document.getElementById('val-stroke');
  const valCount    = document.getElementById('val-count');
  const valFps      = document.getElementById('val-fps');
  const valConf     = document.getElementById('val-conf');

  // 角度条
  const barLE  = document.getElementById('bar-left-elbow');
  const barRE  = document.getElementById('bar-right-elbow');
  const barLS  = document.getElementById('bar-left-shoulder');
  const barRS  = document.getElementById('bar-right-shoulder');
  const numLE  = document.getElementById('num-left-elbow');
  const numRE  = document.getElementById('num-right-elbow');
  const numLS  = document.getElementById('num-left-shoulder');
  const numRS  = document.getElementById('num-right-shoulder');

  // 按钮
  const btnSettings      = document.getElementById('btn-settings');
  const btnExport        = document.getElementById('btn-export');
  const btnReset         = document.getElementById('btn-reset');
  const btnCamera        = document.getElementById('btn-camera');
  const btnPause         = document.getElementById('btn-pause');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnApplySettings = document.getElementById('btn-apply-settings');

  // 设置抽屉
  const settingsDrawer = document.getElementById('settings-drawer');
  const overlay        = document.getElementById('overlay');

  // 设置控件
  const segComplexity  = document.getElementById('seg-complexity');
  const rangeDetect    = document.getElementById('range-detect');
  const rangeTrack     = document.getElementById('range-track');
  const rangeLinewidth = document.getElementById('range-linewidth');
  const lblDetect      = document.getElementById('lbl-detect');
  const lblTrack       = document.getElementById('lbl-track');
  const lblLinewidth   = document.getElementById('lbl-linewidth');
  const chkShowLabels  = document.getElementById('chk-show-labels');
  const chkUpperOnly   = document.getElementById('chk-upper-only');
  const colorSwatches  = document.querySelectorAll('.color-swatch');

  // ── 状态 ──────────────────────────────────────────────────────────
  let currentStream = null;
  let facingMode = 'environment';   // 后置相机优先
  let personDetected = false;
  let noPersonTimer = null;

  // 无人提示 DOM（懒创建）
  let noPersonHint = null;

  // ── 加载进度动画 ──────────────────────────────────────────────────
  let loadPct = 0;
  const loadInterval = setInterval(() => {
    loadPct = Math.min(loadPct + Math.random() * 12, 85);
    loadingBar.style.width = loadPct + '%';
  }, 300);

  function finishLoading() {
    clearInterval(loadInterval);
    loadingBar.style.width = '100%';
    loadingText.textContent = '模型加载完成，相机启动中…';
    setTimeout(() => {
      loadingOverlay.classList.add('hidden');
    }, 600);
  }

  // ── 相机启动 ──────────────────────────────────────────────────────
  async function startCamera(facing) {
    try {
      if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: {
          facingMode: { ideal: facing },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = currentStream;

      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      video.classList.add('active');
      resizeCanvas();
      updateBadge('live', '识别中');
      scanLine.classList.remove('active');

      // 启动推理循环
      PoseEngine.startLoop(video);

    } catch (err) {
      updateBadge('error', '相机错误');
      loadingText.textContent = '相机权限被拒绝：' + err.message;
      console.error('[Camera]', err);
    }
  }

  // ── Canvas 尺寸同步 ───────────────────────────────────────────────
  function resizeCanvas() {
    const vw = video.videoWidth  || window.innerWidth;
    const vh = video.videoHeight || window.innerHeight;
    canvas.width  = vw;
    canvas.height = vh;
  }

  window.addEventListener('resize', resizeCanvas);

  // ── PoseEngine 回调 ───────────────────────────────────────────────
  PoseEngine.init({
    onReady: () => {
      startCamera(facingMode);
      finishLoading();
    },

    onResults: ({ landmarks, image, fps }) => {
      // 清除画布并绘制视频帧
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image) {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }

      // FPS 更新
      valFps.textContent = fps + ' fps';

      if (!landmarks) {
        // 无人检测
        handleNoPerson();
        return;
      }

      // 有人 → 隐藏无人提示
      handlePersonDetected();

      // 骨骼绘制
      SkeletonDraw.draw(ctx, landmarks, canvas.width, canvas.height);

      // 关节角度
      const angles = SkeletonDraw.getJointAngles(landmarks);

      // 游泳分析
      const result = SwimAnalysis.analyze(landmarks, angles);
      if (result) updateStats(result);

      // 平均置信度
      const avgConf = calcAvgConfidence(landmarks);
      valConf.textContent = (avgConf * 100).toFixed(0) + '%';
    },

    onError: (err) => {
      console.error('[PoseEngine]', err);
      updateBadge('error', '引擎错误');
    },
  });

  // ── 状态徽章 ─────────────────────────────────────────────────────
  function updateBadge(state, label) {
    badgeDot.className = 'badge-dot';
    if (state) badgeDot.classList.add(state);
    badgeLabel.textContent = label;
  }

  // ── 无人 / 有人状态切换 ──────────────────────────────────────────
  function handleNoPerson() {
    if (personDetected) {
      personDetected = false;
      updateBadge('', '等待入镜');
    }
    if (!noPersonHint) createNoPersonHint();
    clearTimeout(noPersonTimer);
    noPersonTimer = setTimeout(() => {
      noPersonHint && noPersonHint.classList.add('show');
    }, 1500);
  }

  function handlePersonDetected() {
    if (!personDetected) {
      personDetected = true;
      updateBadge('live', '已检测到游泳者');
    }
    clearTimeout(noPersonTimer);
    noPersonHint && noPersonHint.classList.remove('show');
  }

  function createNoPersonHint() {
    noPersonHint = document.createElement('div');
    noPersonHint.className = 'no-person-hint';
    noPersonHint.innerHTML = `
      <div class="hint-icon">🏊</div>
      <p>请将相机对准游泳者</p>
    `;
    document.querySelector('.video-wrapper').appendChild(noPersonHint);
  }

  // ── 统计更新 ─────────────────────────────────────────────────────
  function updateStats(result) {
    valStroke.textContent = result.stroke || '—';
    valCount.textContent  = result.strokeCount;

    const a = result.angles || {};
    setAngle(barLE, numLE, a.leftElbow);
    setAngle(barRE, numRE, a.rightElbow);
    setAngle(barLS, numLS, a.leftShoulder);
    setAngle(barRS, numRS, a.rightShoulder);
  }

  function setAngle(bar, num, deg) {
    if (deg == null) { bar.style.width = '0%'; num.textContent = '—°'; return; }
    bar.style.width = Math.min(100, (deg / 180) * 100) + '%';
    num.textContent = deg + '°';
  }

  // ── 平均置信度 ───────────────────────────────────────────────────
  function calcAvgConfidence(landmarks) {
    const visible = landmarks.filter(lm => lm && lm.visibility > 0);
    if (!visible.length) return 0;
    return visible.reduce((s, lm) => s + lm.visibility, 0) / visible.length;
  }

  // ── 按钮事件 ─────────────────────────────────────────────────────
  btnSettings.addEventListener('click', () => {
    settingsDrawer.classList.add('open');
    overlay.classList.add('visible');
  });

  btnCloseSettings.addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);

  function closeSettings() {
    settingsDrawer.classList.remove('open');
    overlay.classList.remove('visible');
  }

  btnExport.addEventListener('click', () => {
    SwimAnalysis.exportJSON();
  });

  btnReset.addEventListener('click', () => {
    SwimAnalysis.reset();
    valCount.textContent = '0';
    valStroke.textContent = '—';
  });

  btnCamera.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    PoseEngine.stopLoop();
    startCamera(facingMode);
  });

  btnPause.addEventListener('click', () => {
    const paused = PoseEngine.togglePause();
    btnPause.textContent = paused ? '继续' : '暂停';
    updateBadge(paused ? '' : 'live', paused ? '已暂停' : '识别中');
  });

  // ── 设置应用 ─────────────────────────────────────────────────────
  btnApplySettings.addEventListener('click', async () => {
    const complexity = parseInt(segComplexity.querySelector('.seg-btn.active').dataset.val);
    const detectConf = parseFloat(rangeDetect.value);
    const trackConf  = parseFloat(rangeTrack.value);
    const lineWidth  = parseInt(rangeLinewidth.value);
    const showLabels = chkShowLabels.checked;
    const upperOnly  = chkUpperOnly.checked;
    const activeColor = document.querySelector('.color-swatch.active');
    const lineColor  = activeColor ? activeColor.dataset.color : null;

    // 更新骨骼绘制配置
    SkeletonDraw.setConfig({
      lineWidth,
      showLabels,
      upperOnly,
      lineColor: lineColor || null,
    });

    // 如果模型精度变了，需要重新初始化（会重新加载模型）
    const prevComplexity = PoseEngine._complexity;
    if (complexity !== prevComplexity) {
      loadingOverlay.classList.remove('hidden');
      loadingText.textContent = '切换模型精度，重新加载中…';
      loadingBar.style.width = '30%';
      PoseEngine.stopLoop();
      await PoseEngine.reinit({
        modelComplexity: complexity,
        minDetectionConfidence: detectConf,
        minTrackingConfidence:  trackConf,
      });
      PoseEngine._complexity = complexity;
      PoseEngine.startLoop(video);
      finishLoading();
    } else {
      PoseEngine.updateOptions({
        minDetectionConfidence: detectConf,
        minTrackingConfidence:  trackConf,
      });
    }

    closeSettings();
  });

  // 分段控件
  segComplexity.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      segComplexity.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 滑块实时显示
  rangeDetect.addEventListener('input', () => { lblDetect.textContent = rangeDetect.value; });
  rangeTrack.addEventListener('input',  () => { lblTrack.textContent  = rangeTrack.value; });
  rangeLinewidth.addEventListener('input', () => {
    lblLinewidth.textContent = rangeLinewidth.value;
    SkeletonDraw.setConfig({ lineWidth: parseInt(rangeLinewidth.value) });
  });

  // 颜色选择
  colorSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      SkeletonDraw.setConfig({ lineColor: sw.dataset.color });
    });
  });

  // ── 初始精度标记 ─────────────────────────────────────────────────
  PoseEngine._complexity = 1;

})();
});
