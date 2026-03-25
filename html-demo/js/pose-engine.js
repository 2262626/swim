/**
 * pose-engine.js
 * MediaPipe Pose 引擎封装
 * 游泳场景优化：低置信阈值、平滑、轻量模型
 */

const PoseEngine = (() => {

  let pose = null;
  let isReady = false;
  let isPaused = false;
  let animFrameId = null;

  // 当前配置
  let currentOptions = {
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.35,
    minTrackingConfidence: 0.30,
  };

  // 回调
  let onResultsCb = null;
  let onReadyCb   = null;
  let onErrorCb   = null;

  // FPS 计算
  let fpsSamples = [];
  let lastFrameTime = 0;

  // ── 初始化 ────────────────────────────────────────────────────────
  function init(callbacks = {}) {
    onResultsCb = callbacks.onResults || null;
    onReadyCb   = callbacks.onReady   || null;
    onErrorCb   = callbacks.onError   || null;

    try {
      const PoseClass = (typeof Pose !== 'undefined' ? Pose : window.Pose);
      if (!PoseClass) throw new Error('MediaPipe Pose 未加载，请检查网络连接');

      pose = new PoseClass({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions(currentOptions);
      pose.onResults(_handleResults);

      // 触发模型预热（首帧识别时自动加载 WASM/模型文件）
      isReady = true;
      if (onReadyCb) onReadyCb();

    } catch (err) {
      if (onErrorCb) onErrorCb(err);
    }
  }

  // ── 结果回调 ─────────────────────────────────────────────────────
  function _handleResults(results) {
    if (isPaused) return;

    const now = performance.now();
    const fps = _calcFPS(now);

    if (onResultsCb) {
      onResultsCb({
        landmarks: results.poseLandmarks || null,
        worldLandmarks: results.poseWorldLandmarks || null,
        image: results.image,
        fps,
      });
    }

    lastFrameTime = now;
  }

  function _calcFPS(now) {
    fpsSamples.push(now);
    if (fpsSamples.length > 30) fpsSamples.shift();
    if (fpsSamples.length < 2) return 0;
    const span = (fpsSamples[fpsSamples.length - 1] - fpsSamples[0]) / 1000;
    return Math.round((fpsSamples.length - 1) / span);
  }

  // ── 启动实时推流 ─────────────────────────────────────────────────
  function startLoop(videoEl) {
    if (!pose || !videoEl) return;

    async function loop() {
      if (!isPaused && videoEl.readyState >= 2) {
        try {
          await pose.send({ image: videoEl });
        } catch (e) {
          // 忽略单帧错误，继续循环
        }
      }
      animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // ── 停止循环 ─────────────────────────────────────────────────────
  function stopLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // ── 暂停 / 恢复 ──────────────────────────────────────────────────
  function pause()  { isPaused = true;  }
  function resume() { isPaused = false; }
  function togglePause() {
    isPaused = !isPaused;
    return isPaused;
  }

  // ── 更新识别参数（热更新，无需重载）────────────────────────────
  function updateOptions(opts) {
    Object.assign(currentOptions, opts);
    if (pose) {
      pose.setOptions(currentOptions);
    }
  }

  // ── 重新初始化（切换模型精度时） ────────────────────────────────
  async function reinit(opts = {}) {
    stopLoop();
    Object.assign(currentOptions, opts);

    if (pose) {
      try { await pose.close(); } catch (_) {}
    }

    const PoseClass = (typeof Pose !== 'undefined' ? Pose : window.Pose);
    pose = new PoseClass({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions(currentOptions);
    pose.onResults(_handleResults);
    isReady = true;
  }

  return {
    init,
    startLoop,
    stopLoop,
    pause,
    resume,
    togglePause,
    updateOptions,
    reinit,
    isReady: () => isReady,
    isPaused: () => isPaused,
  };
})();
