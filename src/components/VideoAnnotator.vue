<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { saveAnnotationApi } from '../api/videoAnalysis.js'

const props = defineProps({
  videoUrl: { type: String, required: true },
  taskId: { type: Number, required: true },
  initialStrokes: { type: Array, default: () => [] },
})
const emit = defineEmits(['save', 'close'])

/* ── state ── */
const videoRef = ref(null)
const canvasRef = ref(null)
const wrapRef = ref(null)
const tool = ref('pen')
const color = ref('#ff3333')
const lineWidth = ref(3)
const isDrawing = ref(false)
const strokes = ref([])
const currentStroke = ref(null)
const saving = ref(false)
const saveMsg = ref('')
const showTextModal = ref(false)
const textInput = ref('')
const pendingTextPos = ref({ x: 0, y: 0 })
const isPaused = ref(true)
const hasStartedPlayback = ref(false)
const duration = ref(0)
const currentTime = ref(0)

let msgTimer = null
const setSaveMsg = (msg, timeout = 2500) => {
  saveMsg.value = msg
  if (msgTimer) clearTimeout(msgTimer)
  if (timeout > 0) {
    msgTimer = setTimeout(() => { saveMsg.value = '' }, timeout)
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const buildSnapshotWithRetry = async (maxTry = 6) => {
  for (let i = 0; i < maxTry; i += 1) {
    const snap = buildSnapshot()
    if (snap) return snap
    await wait(70)
  }
  return ''
}

const COLORS = [
  '#ff3333', '#ff9500', '#ffe600', '#33cc55',
  '#1e90ff', '#cc33ff', '#ffffff', '#1a1a1a',
]
const TOOLS = [
  { id: 'pen',   label: '✏️ 笔' },
  { id: 'arrow', label: '➡ 箭头' },
  { id: 'rect',  label: '▭ 矩形' },
  { id: 'text',  label: '🔤 文字' },
]

/* ── init ── */
onMounted(async () => {
  strokes.value = props.initialStrokes ? [...props.initialStrokes] : []
  await nextTick()
  syncCanvas()
})

watch(() => props.initialStrokes, (v) => {
  strokes.value = v ? [...v] : []
  redraw()
}, { deep: true })

/* ── canvas sizing ── */
const syncCanvas = () => {
  const video = videoRef.value
  const canvas = canvasRef.value
  if (!canvas || !video) return
  const w = video.clientWidth || 640
  const h = video.clientHeight || 360
  canvas.width = w
  canvas.height = h
  redraw()
}

const onVideoLoaded = () => {
  syncCanvas()
  onTimeUpdate()
  const video = videoRef.value
  if (video) {
    isPaused.value = video.paused
  }
}

let ro = null
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && wrapRef.value) {
    ro = new ResizeObserver(syncCanvas)
    ro.observe(wrapRef.value)
  }
})
onUnmounted(() => { if (ro) ro.disconnect() })
onUnmounted(() => { if (msgTimer) clearTimeout(msgTimer) })

const onVideoPlay = () => {
  hasStartedPlayback.value = true
  isPaused.value = false
  if (strokes.value.length || currentStroke.value) {
    strokes.value = []
    currentStroke.value = null
    redraw()
    setSaveMsg('已清除上一轮标注，请在暂停后重新标注', 1800)
  }
}

const onVideoPause = () => {
  isPaused.value = true
}

const onTimeUpdate = () => {
  const video = videoRef.value
  if (!video) return
  currentTime.value = Number(video.currentTime || 0)
  duration.value = Number(video.duration || 0)
}

const togglePlayPause = () => {
  const video = videoRef.value
  if (!video) return
  if (video.paused) {
    video.play().catch(() => {})
  } else {
    video.pause()
  }
}

const seekBy = (deltaSec) => {
  const video = videoRef.value
  if (!video) return
  const max = Number(video.duration || 0)
  if (!Number.isFinite(max) || max <= 0) return
  const next = Math.min(max, Math.max(0, Number(video.currentTime || 0) + deltaSec))
  video.currentTime = next
  currentTime.value = next
}

const formatClock = (sec) => {
  const n = Math.max(0, Math.floor(Number(sec || 0)))
  const m = Math.floor(n / 60).toString().padStart(2, '0')
  const s = Math.floor(n % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/* ── coordinate helper ── */
const getPos = (e) => {
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const src = e.touches ? e.touches[0] : e
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top) * scaleY,
  }
}

/* ── pointer events ── */
const onDown = (e) => {
  if (!isPaused.value) {
    setSaveMsg('请先暂停视频，再进行标注', 1800)
    return
  }
  e.preventDefault()
  const pos = getPos(e)
  if (tool.value === 'text') {
    pendingTextPos.value = pos
    showTextModal.value = true
    textInput.value = ''
    return
  }
  isDrawing.value = true
  if (tool.value === 'pen') {
    currentStroke.value = { tool: 'pen', color: color.value, width: lineWidth.value, points: [[pos.x, pos.y]] }
  } else {
    currentStroke.value = { tool: tool.value, color: color.value, width: lineWidth.value, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
  }
}

const onMove = (e) => {
  if (!isDrawing.value || !currentStroke.value) return
  e.preventDefault()
  const pos = getPos(e)
  if (tool.value === 'pen') {
    currentStroke.value.points.push([pos.x, pos.y])
  } else {
    currentStroke.value.x2 = pos.x
    currentStroke.value.y2 = pos.y
  }
  redraw()
}

const onUp = (e) => {
  if (!isDrawing.value) return
  e.preventDefault()
  isDrawing.value = false
  if (currentStroke.value) {
    strokes.value.push({ ...currentStroke.value })
    currentStroke.value = null
    redraw()
  }
}

const confirmText = () => {
  const txt = textInput.value.trim()
  if (txt) {
    strokes.value.push({
      tool: 'text', color: color.value, size: 20,
      x: pendingTextPos.value.x,
      y: pendingTextPos.value.y,
      text: txt,
    })
    redraw()
  }
  showTextModal.value = false
  textInput.value = ''
}

/* ── drawing ── */
const drawStroke = (ctx, s, scaleX = 1, scaleY = 1) => {
  const lwScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2
  ctx.save()
  ctx.strokeStyle = s.color || '#ff3333'
  ctx.fillStyle = s.color || '#ff3333'
  ctx.lineWidth = (s.width || 2) * lwScale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.tool === 'pen' && s.points?.length) {
    ctx.beginPath()
    s.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x * scaleX, y * scaleY) : ctx.lineTo(x * scaleX, y * scaleY))
    ctx.stroke()
  } else if (s.tool === 'arrow') {
    drawArrow(ctx, s.x1 * scaleX, s.y1 * scaleY, s.x2 * scaleX, s.y2 * scaleY)
  } else if (s.tool === 'rect') {
    ctx.strokeRect(s.x1 * scaleX, s.y1 * scaleY, (s.x2 - s.x1) * scaleX, (s.y2 - s.y1) * scaleY)
  } else if (s.tool === 'text' && s.text) {
    ctx.font = `bold ${(s.size || 20) * lwScale}px sans-serif`
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 4
    ctx.fillText(s.text, s.x * scaleX, s.y * scaleY)
  }
  ctx.restore()
}

const drawArrow = (ctx, x1, y1, x2, y2) => {
  const dist = Math.hypot(x2 - x1, y2 - y1)
  if (dist < 2) return
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.min(22, dist * 0.35)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

const redraw = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  strokes.value.forEach(s => drawStroke(ctx, s))
  if (currentStroke.value) drawStroke(ctx, currentStroke.value)
}

/* ── actions ── */
const undo = () => { strokes.value.pop(); redraw() }
const clearAll = () => { strokes.value = []; currentStroke.value = null; redraw() }

const buildSnapshot = () => {
  const video = videoRef.value
  const canvas = canvasRef.value
  if (!video || !canvas) return ''
  if (video.readyState < 2) return ''

  const w = video.videoWidth || canvas.width
  const h = video.videoHeight || canvas.height
  if (!w || !h) return ''

  try {
    const shot = document.createElement('canvas')
    shot.width = w
    shot.height = h
    const ctx = shot.getContext('2d')

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(video, 0, 0, w, h)

    const scaleX = w / (canvas.width || w)
    const scaleY = h / (canvas.height || h)
    strokes.value.forEach((s) => drawStroke(ctx, s, scaleX, scaleY))

    return shot.toDataURL('image/png')
  } catch {
    return ''
  }
}

const save = async () => {
  saving.value = true
  saveMsg.value = ''
  const video = videoRef.value
  const wasPlaying = !!video && !video.paused
  if (wasPlaying) {
    video.pause()
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  try {
    let annotationImageUrl = await buildSnapshotWithRetry()
    let fallbackUsed = false
    if (!annotationImageUrl) {
      const canvas = canvasRef.value
      annotationImageUrl = canvas ? canvas.toDataURL('image/png') : ''
      fallbackUsed = true
    }

    if (!annotationImageUrl) {
      throw new Error('保存失败')
    }

    await saveAnnotationApi(props.taskId, strokes.value, annotationImageUrl)
    emit('save', strokes.value)
    if (fallbackUsed) {
      setSaveMsg('✅ 已保存标注（当前浏览器未捕获到视频画面）')
    } else {
      setSaveMsg('✅ 保存成功')
    }
  } catch {
    setSaveMsg('❌ 保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="annotator-overlay" @click.self="$emit('close')">
    <div class="annotator-panel">
      <!-- Header -->
      <div class="ann-header">
        <span class="ann-title">📝 视频标注工具</span>
        <div class="ann-header-actions">
          <span v-if="saveMsg" class="save-msg">{{ saveMsg }}</span>
          <button class="ann-btn ann-btn-ghost" @click="undo" :disabled="!strokes.length">↩ 撤销</button>
          <button class="ann-btn ann-btn-danger" @click="clearAll" :disabled="!strokes.length">🗑 清空</button>
          <button class="ann-btn ann-btn-close" @click="$emit('close')">✕ 关闭</button>
        </div>
      </div>

      <!-- Video + Canvas -->
      <div class="ann-video-wrap" ref="wrapRef">
        <video
          ref="videoRef"
          class="ann-video"
          :src="videoUrl"
          controls
          preload="metadata"
          @loadedmetadata="onVideoLoaded"
          @timeupdate="onTimeUpdate"
          @play="onVideoPlay"
          @pause="onVideoPause"
        ></video>
        <div v-if="!isPaused" class="ann-pause-tip">播放中（请先暂停再标注）</div>
        <canvas
          v-show="isPaused && hasStartedPlayback"
          ref="canvasRef"
          class="ann-canvas"
          :style="{ cursor: tool === 'text' ? 'text' : 'crosshair' }"
          @mousedown="onDown"
          @mousemove="onMove"
          @mouseup="onUp"
          @mouseleave="onUp"
          @touchstart.prevent="onDown"
          @touchmove.prevent="onMove"
          @touchend.prevent="onUp"
        ></canvas>
      </div>

      <!-- Toolbar -->
      <div class="ann-toolbar">
        <div class="toolbar-group playback-group">
          <span class="toolbar-label">进度</span>
          <button class="ann-tool-btn" @click="seekBy(-5)">-5s</button>
          <button class="ann-tool-btn" @click="seekBy(-1)">-1s</button>
          <button class="ann-tool-btn" @click="seekBy(-0.2)">-0.2s</button>
          <button class="ann-tool-btn" @click="togglePlayPause">{{ isPaused ? '▶ 播放' : '⏸ 暂停' }}</button>
          <button class="ann-tool-btn" @click="seekBy(0.2)">+0.2s</button>
          <button class="ann-tool-btn" @click="seekBy(1)">+1s</button>
          <button class="ann-tool-btn" @click="seekBy(5)">+5s</button>
          <span class="time-label">{{ formatClock(currentTime) }} / {{ formatClock(duration) }}</span>
        </div>

        <div class="toolbar-group">
          <span class="toolbar-label">工具</span>
          <button
            v-for="t in TOOLS" :key="t.id"
            class="ann-tool-btn"
            :class="{ active: tool === t.id }"
            @click="tool = t.id"
          >{{ t.label }}</button>
        </div>

        <div class="toolbar-group">
          <span class="toolbar-label">颜色</span>
          <button
            v-for="c in COLORS" :key="c"
            class="color-dot"
            :class="{ selected: color === c }"
            :style="{ background: c, border: c === '#ffffff' ? '2px solid #aaa' : '2px solid transparent' }"
            @click="color = c"
          ></button>
        </div>

        <div class="toolbar-group">
          <span class="toolbar-label">粗细</span>
          <input type="range" min="1" max="8" v-model.number="lineWidth" class="width-slider" />
          <span class="width-val">{{ lineWidth }}px</span>
        </div>

        <div class="toolbar-group toolbar-save">
          <button class="ann-btn ann-btn-primary" :disabled="saving || !strokes.length" @click="save">
            {{ saving ? '保存中…' : '💾 保存标注' }}
          </button>
          <span class="stroke-count">已绘制 {{ strokes.length }} 个笔画</span>
        </div>
      </div>
    </div>

    <!-- Text input modal -->
    <div v-if="showTextModal" class="text-modal-overlay" @click.self="showTextModal = false">
      <div class="text-modal">
        <div class="text-modal-title">输入标注文字</div>
        <input
          v-model="textInput"
          class="text-modal-input"
          placeholder="输入内容（如：注意手臂姿势）"
          @keyup.enter="confirmText"
          autofocus
        />
        <div class="text-modal-actions">
          <button class="ann-btn ann-btn-ghost" @click="showTextModal = false">取消</button>
          <button class="ann-btn ann-btn-primary" @click="confirmText">确定添加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.annotator-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.annotator-panel {
  background: #1a1d24;
  border-radius: 14px;
  width: min(960px, 100%);
  max-height: 96vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}

.ann-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: #0f1117;
  border-bottom: 1px solid #2a2d36;
  flex-shrink: 0;
}

.ann-title {
  font-size: 15px;
  font-weight: 700;
  color: #e0e6ff;
}

.ann-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.save-msg {
  font-size: 13px;
  color: #6ee7b7;
}

.ann-video-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ann-video {
  max-width: 100%;
  max-height: 100%;
  display: block;
  object-fit: contain;
}

.ann-canvas {
  position: absolute;
  top: -6px;
  left: 0;
  width: 100%;
  height: calc(100% - 48px);
  touch-action: none;
}
.ann-canvas-disabled { pointer-events: none; opacity: 0.35; }

.ann-pause-tip {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #e2e8f0;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  z-index: 2;
}

.ann-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  background: #0f1117;
  border-top: 1px solid #2a2d36;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.playback-group { flex-wrap: wrap; }
.time-label { font-size: 12px; color: #94a3b8; min-width: 92px; text-align: right; }

.toolbar-label {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.toolbar-save {
  margin-left: auto;
  gap: 10px;
}

.ann-tool-btn {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  background: #252830;
  border: 1.5px solid #3a3d4a;
  color: #c9d1e0;
  transition: all 0.15s;
  white-space: nowrap;
}
.ann-tool-btn:hover { background: #2e3140; border-color: #4a8cff; }
.ann-tool-btn.active { background: #1a3a6e; border-color: #4a8cff; color: #7eb8ff; }

.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s;
}
.color-dot:hover { transform: scale(1.2); }
.color-dot.selected { transform: scale(1.3); box-shadow: 0 0 0 2.5px #4a8cff; }

.width-slider {
  width: 72px;
  accent-color: #4a8cff;
}
.width-val { font-size: 12px; color: #8899aa; min-width: 28px; }

.ann-btn {
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  white-space: nowrap;
}
.ann-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ann-btn-primary { background: #2563eb; color: #fff; }
.ann-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.ann-btn-ghost { background: #252830; color: #c9d1e0; border: 1px solid #3a3d4a; }
.ann-btn-ghost:hover:not(:disabled) { background: #2e3140; }
.ann-btn-danger { background: #3d1a1a; color: #ff6b6b; border: 1px solid #5a2222; }
.ann-btn-danger:hover:not(:disabled) { background: #5a2222; }
.ann-btn-close { background: #252830; color: #8899aa; border: 1px solid #3a3d4a; }
.ann-btn-close:hover { background: #333; color: #ccc; }

.stroke-count { font-size: 12px; color: #6b7280; }

/* Text modal */
.text-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.text-modal {
  background: #1e2130;
  border: 1px solid #2e3345;
  border-radius: 12px;
  padding: 24px;
  width: min(380px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.text-modal-title { font-size: 15px; font-weight: 700; color: #e0e6ff; }
.text-modal-input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1.5px solid #3a3d4a;
  background: #12141a;
  color: #e0e6ff;
  font-size: 14px;
  outline: none;
}
.text-modal-input:focus { border-color: #4a8cff; }
.text-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
