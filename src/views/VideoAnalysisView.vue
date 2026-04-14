<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElInput, ElSelect, ElOption, ElMessageBox } from 'element-plus'
import {
  uploadVideoFileApi,
  submitVideoAnalysisApi,
  listVideoTasksApi,
  listAthletesForAnalysisApi,
} from '../api/videoAnalysis.js'
import { listTeamsApi, listCameraTypesApi, listTrainingTargetsApi, listPoolLengthsApi } from '../api/swim.js'
import { useAuthStore } from '../store/auth.js'

const router = useRouter()
const auth = useAuthStore()

// ── Form state ────────────────────────────────────────────────────────
const fileInput = ref(null)
const uploadedFileName = ref('')
const uploading = ref(false)
const uploadProgress = ref(0)
const submitting = ref(false)
const submitError = ref('')

const todayStr = () => new Date().toISOString().slice(0, 10)

const form = ref({
  videoUrl: '',
  strokeType: '',
  trainingTarget: '',
  poolLength: 25,
  athleteId: null,
  shootDate: todayStr(),
  cameraType: [],
})

const STROKE_OPTIONS = ['自由泳', '蛙泳', '仰泳', '蝶泳']
const DEFAULT_TRAINING_TARGETS = ['中考游泳', '等级考试', '竞技比赛', '减脂健身', '初学入门']
const TRAINING_TARGETS = ref([...DEFAULT_TRAINING_TARGETS])
const DEFAULT_POOL_LENGTHS = [25, 50]
const POOL_LENGTHS = ref([...DEFAULT_POOL_LENGTHS])
const DEFAULT_CAMERA_OPTIONS = ['正侧面固定', '水下正面', '水下侧面', '俯拍', '斜上方', '出发台']
const CAMERA_OPTIONS = ref([...DEFAULT_CAMERA_OPTIONS])

const parseDateSafe = (input) => {
  if (!input) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  if (typeof input === 'number') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const raw = String(input).trim()
  if (!raw) return null

  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct

  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const hh = Number(m[4] || 0)
  const mm = Number(m[5] || 0)
  const ss = Number(m[6] || 0)
  const parsed = new Date(y, mo, d, hh, mm, ss)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// ── Athlete / Team ────────────────────────────────────────────────────
const teams = ref([])
const athletes = ref([])
const selectedTeamId = ref('')

onMounted(async () => {
  await loadTasks({ reset: true })
  if (hasActiveTask.value) startPoll()
  try {
    teams.value = await listTeamsApi()
  } catch {}
  try {
    const rows = await listCameraTypesApi()
    const names = (Array.isArray(rows) ? rows : [])
      .map((item) => item?.cameraName || item?.camera_code || item?.cameraCode)
      .filter(Boolean)
    CAMERA_OPTIONS.value = names
  } catch {
    CAMERA_OPTIONS.value = [...DEFAULT_CAMERA_OPTIONS]
  }
  try {
    const rows = await listTrainingTargetsApi()
    const labels = (Array.isArray(rows) ? rows : [])
      .map((item) => item?.targetName || item?.trainingTarget || item?.name || item?.label)
      .filter(Boolean)
    TRAINING_TARGETS.value = labels
  } catch {
    TRAINING_TARGETS.value = [...DEFAULT_TRAINING_TARGETS]
  }
  try {
    const rows = await listPoolLengthsApi()
    const values = (Array.isArray(rows) ? rows : [])
      .map((item) => Number(item?.dictValue ?? item?.dict_value ?? item?.value ?? item?.poolLength))
      .filter((v) => Number.isFinite(v) && v > 0)
    POOL_LENGTHS.value = values
  } catch {
    POOL_LENGTHS.value = [...DEFAULT_POOL_LENGTHS]
  }
})

const loadAthletes = async () => {
  athletes.value = []
  form.value.athleteId = null
  if (!selectedTeamId.value) return
  try {
    const data = await listAthletesForAnalysisApi({ teamId: selectedTeamId.value })
    athletes.value = Array.isArray(data) ? data : (data?.rows || data?.data || [])
  } catch {}
}

// ── Upload ────────────────────────────────────────────────────────────
const triggerFileInput = () => fileInput.value?.click()

const handleFileChange = async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  uploadedFileName.value = file.name
  uploading.value = true
  uploadProgress.value = 0
  submitError.value = ''
  try {
    const res = await uploadVideoFileApi(file, (p) => { uploadProgress.value = p })
    form.value.videoUrl = res.data?.url || res.url || ''
  } catch (err) {
    submitError.value = `上传失败: ${err.message}`
    uploadedFileName.value = ''
  } finally {
    uploading.value = false
    e.target.value = ''
  }
}

const clearVideo = () => {
  form.value.videoUrl = ''
  uploadedFileName.value = ''
  uploadProgress.value = 0
}

const toggleCamera = (c) => {
  const idx = form.value.cameraType.indexOf(c)
  if (idx >= 0) form.value.cameraType.splice(idx, 1)
  else form.value.cameraType.push(c)
}

// ── Submit ────────────────────────────────────────────────────────────
const getSubmitValidationError = () => {
  if (!form.value.videoUrl) return '请先上传视频'
  if (!selectedTeamId.value) return '请先选择队伍'
  if (!form.value.athleteId) return '请先选择学员'
  if (!form.value.strokeType) return '请选择泳姿'
  if (!form.value.poolLength) return '请选择泳池长度'
  if (!form.value.cameraType?.length) return '请选择机位'
  if (!form.value.trainingTarget) return '请选择训练目标'
  return ''
}

const canSubmit = computed(() =>
  !getSubmitValidationError() && !submitting.value && !uploading.value
)

const submitAnalysis = async () => {
  const validationError = getSubmitValidationError()
  if (validationError) {
    submitError.value = validationError
    return
  }
  submitting.value = true
  submitError.value = ''
  try {
    const payload = {
      videoUrl: form.value.videoUrl,
      strokeType: form.value.strokeType,
      trainingTarget: form.value.trainingTarget || undefined,
      poolLength: form.value.poolLength,
      athleteId: form.value.athleteId || undefined,
      teamId: selectedTeamId.value || undefined,
      shootDate: form.value.shootDate || todayStr(),
      cameraType: form.value.cameraType.length ? form.value.cameraType : undefined,
      modelChoice: 'qwen-vl-plus',
      includeMarkdown: true,
    }
    await submitVideoAnalysisApi(payload)
    // clear form after submit
    form.value = { videoUrl: '', strokeType: '', trainingTarget: '', poolLength: 25,
      athleteId: null, shootDate: todayStr(), cameraType: [] }
    uploadedFileName.value = ''
    selectedTeamId.value = ''
    athletes.value = []
    await loadTasks({ reset: true })
    startPoll()
  } catch (err) {
    submitError.value = err.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

// ── Task List + Polling ───────────────────────────────────────────────
const tasks = ref([])
const loadingTasks = ref(false)
const loadingMoreTasks = ref(false)
const taskListEl = ref(null)
const taskPageSize = 20
const loadedPages = ref(1)
const taskTotal = ref(0)
let pollTimer = null

const hasMoreTasks = computed(() => {
  if (!taskTotal.value) return false
  return tasks.value.length < taskTotal.value
})

const taskSearchKeyword = ref('')
const taskStrokeFilter = ref('')

const buildTaskQuery = (pageNum, pageSize) => ({
  pageNum,
  pageSize,
  athleteName: taskSearchKeyword.value.trim() || undefined,
  strokeType: taskStrokeFilter.value || undefined,
})

const mergeTasksById = (base = [], incoming = []) => {
  const map = new Map()
  base.forEach((item) => {
    if (item?.taskId != null) map.set(item.taskId, item)
  })
  incoming.forEach((item) => {
    if (item?.taskId != null) map.set(item.taskId, item)
  })
  return [...map.values()].sort((a, b) => {
    const ta = parseDateSafe(a?.createTime)?.getTime() || 0
    const tb = parseDateSafe(b?.createTime)?.getTime() || 0
    return tb - ta
  })
}

const loadTasks = async ({ reset = false, append = false, silent = false } = {}) => {
  if (append && (loadingTasks.value || loadingMoreTasks.value || !hasMoreTasks.value)) return
  if (!append && loadingTasks.value) return

  if (append) {
    loadingMoreTasks.value = true
  } else {
    if (reset) loadedPages.value = 1
    if (!silent) loadingTasks.value = true
  }

  try {
    if (append) {
      const nextPage = loadedPages.value + 1
      const res = await listVideoTasksApi(buildTaskQuery(nextPage, taskPageSize))
      const rows = res?.rows || res?.data?.rows || []
      const total = Number(res?.total ?? res?.data?.total ?? 0)
      taskTotal.value = Number.isFinite(total) ? total : taskTotal.value
      if (rows.length) {
        tasks.value = mergeTasksById(tasks.value, rows)
        loadedPages.value = nextPage
      }
    } else {
      const fetchSize = Math.max(taskPageSize, loadedPages.value * taskPageSize)
      const res = await listVideoTasksApi(buildTaskQuery(1, fetchSize))
      const rows = res?.rows || res?.data?.rows || []
      const total = Number(res?.total ?? res?.data?.total ?? rows.length)
      taskTotal.value = Number.isFinite(total) ? total : rows.length
      tasks.value = rows
    }

    if (!hasActiveTask.value) clearPoll()
  } catch {} finally {
    if (append) {
      loadingMoreTasks.value = false
    } else if (!silent) {
      loadingTasks.value = false
    }
  }
}

const handleTaskListScroll = () => {
  const el = taskListEl.value
  if (!el) return
  const remain = el.scrollHeight - el.scrollTop - el.clientHeight
  if (remain < 80) {
    loadTasks({ append: true })
  }
}

const handleRefreshTasks = () => {
  loadTasks({ reset: true })
}

const handleTaskSearch = () => {
  loadTasks({ reset: true })
}

const resetTaskSearch = () => {
  taskSearchKeyword.value = ''
  taskStrokeFilter.value = ''
  loadTasks({ reset: true })
}

const hasActiveTask = computed(() =>
  tasks.value.some(t => t.status === 'PENDING' || t.status === 'RUNNING')
)

const startPoll = () => {
  clearPoll()
  pollTimer = setInterval(async () => {
    await loadTasks({ silent: true })
    if (!hasActiveTask.value) clearPoll()
  }, 5000)
}

const clearPoll = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onUnmounted(() => clearPoll())

const openTaskDetail = (task) => {
  if (!task?.taskId) return
  router.push(`/analysis/${task.taskId}`)
}

// ── Helpers ───────────────────────────────────────────────────────────
const shortName = (url) => {
  if (!url) return '未知视频'
  const name = url.split('/').pop().split('?')[0]
  return name.length > 28 ? name.slice(0, 28) + '…' : name
}

const statusLabel = (s) =>
  ({ PENDING: '排队中', RUNNING: '分析中', SUCCESS: '已完成', FAILED: '失败' })[s] || s

const statusClass = (s) =>
  ({ PENDING: 'status-pending', RUNNING: 'status-running', SUCCESS: 'status-success', FAILED: 'status-failed' })[s] || ''

const riskClass = (r) => {
  if (!r) return ''
  if (r.includes('高')) return 'risk-high'
  if (r.includes('中')) return 'risk-mid'
  return 'risk-low'
}

const formatTime = (t) => {
  const d = parseDateSafe(t)
  if (!d) return '—'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const goBack = () => router.push('/swim')
const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    auth.logout?.()
    router.push('/login')
  } catch {
    // 用户取消，不做任何操作
  }
}
</script>

<template>
  <div class="ai-analysis-view">
    <!-- ── Header ──────────────────────────────────────────────────── -->
    <header class="ai-header">
      <button class="back-btn" @click="goBack">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        返回
      </button>
      <div class="ai-title">
        <span>AI 视频分析</span>
      </div>
      <div class="header-right">
        <span v-if="hasActiveTask" class="polling-badge">
          <span class="pulse-dot"></span> 分析中
        </span>
        <button class="icon-btn-sm" title="退出" @click="handleLogout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>

    <!-- ── Body (single column scroll) ─────────────────────────── -->
    <div class="ai-body">
      <div class="ai-body-inner">

        <!-- ─── Upload + Form ──────────────────────────────────── -->
        <section class="upload-panel">
          <div class="panel-title">提交分析</div>

          <div class="form-row">
            <!-- Upload zone -->
            <div
              class="upload-zone"
              :class="{ uploaded: form.videoUrl, uploading }"
              @click="!uploading && triggerFileInput()"
            >
              <template v-if="uploading">
                <div class="upload-progress-ring">
                  <svg viewBox="0 0 36 36" class="ring-svg">
                    <circle class="ring-bg" cx="18" cy="18" r="15.9" />
                    <circle class="ring-fg" cx="18" cy="18" r="15.9" :stroke-dasharray="`${uploadProgress} 100`" />
                  </svg>
                  <span class="ring-label">{{ uploadProgress }}%</span>
                </div>
                <p class="upload-hint">上传中…</p>
              </template>
              <template v-else-if="form.videoUrl">
                <div class="upload-check">✓</div>
                <p class="upload-filename">{{ uploadedFileName }}</p>
                <button class="reupload-btn" @click.stop="clearVideo">重新上传</button>
              </template>
              <template v-else>
                <div class="upload-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p class="upload-hint">点击选择视频文件</p>
                <p class="upload-sub">支持 MP4 · MOV · AVI</p>
              </template>
            </div>
            <input ref="fileInput" type="file" accept="video/*,.mp4,.mov,.avi,.m4v" style="display:none" @change="handleFileChange" />

            <!-- Form fields (right of upload zone) -->
            <div class="form-fields">
              <div class="form-field">
                <label>泳姿类型 <span class="required">*</span></label>
                <div class="chip-group">
                  <button v-for="s in STROKE_OPTIONS" :key="s" class="chip" :class="{ active: form.strokeType === s }" @click="form.strokeType = s">{{ s }}</button>
                </div>
              </div>

              <div class="form-field">
                <label>泳池长度 <span class="required">*</span></label>
                <div class="chip-group">
                  <button v-for="p in POOL_LENGTHS" :key="p" class="chip" :class="{ active: form.poolLength === p }" @click="form.poolLength = p">{{ p }}m</button>
                </div>
              </div>

              <div class="form-field">
                <label>机位 <span class="required">*</span></label>
                <div class="chip-group">
                  <button
                    v-for="c in CAMERA_OPTIONS" :key="c"
                    class="chip"
                    :class="{ active: form.cameraType.includes(c) }"
                    @click="toggleCamera(c)"
                  >{{ c }}</button>
                </div>
              </div>

              <div class="form-field-grid">
                <div class="form-field">
                  <label>训练目标 <span class="required">*</span></label>
                  <ElSelect v-model="form.trainingTarget" class="ai-select" placeholder="请选择训练目标">
                    <ElOption v-for="t in TRAINING_TARGETS" :key="t" :label="t" :value="t" />
                  </ElSelect>
                </div>
                <div class="form-field">
                  <label>队伍 <span class="required">*</span></label>
                  <ElSelect v-model="selectedTeamId" class="ai-select" placeholder="请选择队伍" @change="loadAthletes">
                    <ElOption
                      v-for="t in teams"
                      :key="t.teamId ?? t.id"
                      :label="t.teamName ?? t.name"
                      :value="t.teamId ?? t.id"
                    />
                  </ElSelect>
                </div>
                <div class="form-field">
                  <label>学员 <span class="required">*</span></label>
                  <ElSelect v-model="form.athleteId" class="ai-select" placeholder="请选择学员" :disabled="!selectedTeamId || !athletes.length">
                    <ElOption
                      v-for="a in athletes"
                      :key="a.athleteId ?? a.id"
                      :label="a.athleteName ?? a.name"
                      :value="a.athleteId ?? a.id"
                    />
                  </ElSelect>
                </div>
              </div>
            </div>
          </div>

          <p v-if="submitError" class="error-msg">{{ submitError }}</p>

          <button
            class="submit-btn"
            :disabled="!canSubmit"
            :class="{ loading: submitting }"
            @click="submitAnalysis"
          >
            <span v-if="submitting">提交中…</span>
            <span v-else>提交分析</span>
          </button>
        </section>

        <!-- ─── Task Queue (below form) ────────────────────────── -->
        <section class="task-panel">
          <div class="task-panel-header">
            <div class="task-panel-title-row">
              <span class="panel-title">分析列表</span>
              <span v-if="tasks.length" class="task-count-badge">{{ tasks.length }} 条</span>
            </div>
            <button class="refresh-btn" :class="{ spinning: loadingTasks }" @click="handleRefreshTasks" title="刷新">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>

          <div class="task-search-row">
            <ElInput
              v-model.trim="taskSearchKeyword"
              class="task-search-input"
              placeholder="请输入学员名称"
              clearable
              @keyup.enter="handleTaskSearch"
            />
            <ElSelect
              v-model="taskStrokeFilter"
              class="task-search-select"
              placeholder="请选择泳姿"
              clearable
            >
              <ElOption v-for="s in STROKE_OPTIONS" :key="s" :label="s" :value="s" />
            </ElSelect>
            <button class="search-btn" @click="handleTaskSearch">搜索</button>
            <button class="search-btn ghost" @click="resetTaskSearch">重置</button>
          </div>

          <div v-if="loadingTasks && !tasks.length" class="loading-tasks">
            <div class="spinner"></div>
            <p>加载中…</p>
          </div>

          <div v-else-if="!tasks.length" class="empty-tasks">
            <p>暂无分析任务，提交后将在此显示排队状态</p>
          </div>

          <div v-else ref="taskListEl" class="task-list" @scroll="handleTaskListScroll">
            <div
              v-for="task in tasks"
              :key="task.taskId"
              class="task-card"
              :class="[statusClass(task.status)]"
              @click="openTaskDetail(task)"
            >
              <div class="task-status-icon" :class="statusClass(task.status)">
                <span v-if="task.status === 'PENDING'">⏳</span>
                <span v-else-if="task.status === 'RUNNING'" class="spin-icon">⟳</span>
                <span v-else-if="task.status === 'SUCCESS'">✓</span>
                <span v-else>✗</span>
              </div>
              <div class="task-info">
                <div class="task-video">{{ shortName(task.videoUrl) }}</div>
                <div class="task-meta">
                  <span class="tag-stroke">{{ task.strokeType }}</span>
                  <span v-if="task.athleteName" class="tag-athlete">{{ task.athleteName }}</span>
                  <span class="tag-time">{{ formatTime(task.createTime) }}</span>
                </div>
              </div>
              <div class="task-right">
                <!-- <span v-if="task.overallScore != null && task.status === 'SUCCESS'" class="task-score">{{ task.overallScore }}</span> -->
                <span class="status-pill" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
              </div>
            </div>
            <div v-if="loadingMoreTasks" class="loading-more-tasks">
              <div class="spinner"></div>
              <span>加载更多…</span>
            </div>
            <div v-else-if="!hasMoreTasks && tasks.length > 5" class="tasks-end-tip">已加载全部任务</div>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ───────────────────────────────────────────────────────────── */
.ai-analysis-view {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #0a0a0f;
  color: #e8eaf6;
  font-family: 'PingFang SC', 'Heiti SC', -apple-system, sans-serif;
  overflow: hidden;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(20, 20, 32, 0.95);
  border-bottom: 1px solid rgba(0, 229, 255, 0.15);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
  z-index: 10;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: #00e5ff;
  font-size: 14px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background 0.2s;
}
.back-btn:hover { background: rgba(0, 229, 255, 0.1); }
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.ai-icon { font-size: 20px; }
.header-right { display: flex; align-items: center; gap: 12px; }
.polling-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ffd54f;
  background: rgba(255, 213, 79, 0.12);
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 213, 79, 0.25);
}
.pulse-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #ffd54f;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}
.icon-btn-sm {
  background: none;
  border: none;
  color: #9094b0;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: color 0.2s;
}
.icon-btn-sm:hover { color: #e8eaf6; }

/* ── Body layout (left-right split) ──────────────────────────────────── */
.ai-body {
  flex: 1;
  overflow: hidden;
}

.ai-body-inner {
  display: flex;
  gap: 0;
  height: 100%;
}

/* ── Upload Panel (left side) ──────────────────────────────────────── */
.upload-panel {
  width: 420px;
  flex-shrink: 0;
  background: #141420;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}

.form-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #00e5ff;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Upload zone */
.upload-zone {
  width: 100%;
  border: 2px dashed rgba(0, 229, 255, 0.25);
  border-radius: 14px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: rgba(0, 229, 255, 0.03);
  transition: border-color 0.25s, background 0.25s;
  min-height: 120px;
  justify-content: center;
}
.upload-zone:hover:not(.uploading) {
  border-color: rgba(0, 229, 255, 0.5);
  background: rgba(0, 229, 255, 0.06);
}
.upload-zone.uploaded {
  border-color: rgba(105, 240, 174, 0.4);
  background: rgba(105, 240, 174, 0.04);
}
.upload-icon { color: rgba(0, 229, 255, 0.6); }
.upload-hint { font-size: 13px; color: #9094b0; margin: 0; }
.upload-sub { font-size: 11px; color: #6064808; margin: 0; color: #606480; }
.upload-filename { font-size: 12px; color: #e8eaf6; text-align: center; margin: 0; word-break: break-all; }
.upload-check {
  font-size: 28px;
  color: #69f0ae;
}
.reupload-btn {
  margin-top: 4px;
  background: none;
  border: 1px solid rgba(0, 229, 255, 0.3);
  color: #00e5ff;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}
.reupload-btn:hover { background: rgba(0, 229, 255, 0.1); }

/* Progress ring */
.upload-progress-ring {
  position: relative;
  width: 56px;
  height: 56px;
}
.ring-svg { width: 56px; height: 56px; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: rgba(0, 229, 255, 0.15); stroke-width: 3; }
.ring-fg {
  fill: none;
  stroke: #00e5ff;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s;
}
.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #00e5ff;
}

/* Form fields */
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label {
  font-size: 12px;
  color: #9094b0;
  font-weight: 500;
}
.required { color: #ff5252; }
.form-field-row { flex-direction: row; align-items: center; }
.form-field-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: #9094b0; }
.form-field-row input[type=checkbox] { width: 16px; height: 16px; accent-color: #00e5ff; }

.chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #9094b0;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.chip:hover { border-color: rgba(0, 229, 255, 0.4); color: #c8cadb; }
.chip.active {
  border-color: #00e5ff;
  background: rgba(0, 229, 255, 0.15);
  color: #00e5ff;
  font-weight: 600;
}

.ai-select {
  width: 100%;
  font-size: 13px;
}

.ai-select :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.ai-select :deep(.el-select__placeholder),
.ai-select :deep(.el-select__selected-item) {
  color: #e8eaf6;
  font-size: 13px;
}

.ai-select :deep(.is-focus) {
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.5) inset;
}

.error-msg { font-size: 12px; color: #ff5252; margin: 0; }

.submit-btn {
  padding: 13px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #00e5ff, #00b4d8);
  color: #0a0a0f;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  margin-top: 4px;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.submit-btn:not(:disabled):hover { opacity: 0.9; }
.submit-btn:not(:disabled):active { transform: scale(0.98); }
.submit-btn.loading { opacity: 0.7; cursor: not-allowed; }

/* ── Task Panel (right side) ─────────────────────────────────────────── */
.task-panel {
  flex: 1;
  min-width: 0;
  background: #0e0e18;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.task-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px 76px 76px;
  gap: 10px;
  padding: 10px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.task-search-input,
.task-search-select {
  height: 34px;
}

.task-search-row :deep(.el-input__wrapper),
.task-search-row :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  border-radius: 8px;
}

.task-search-row :deep(.el-input__inner),
.task-search-row :deep(.el-select__selected-item),
.task-search-row :deep(.el-input__placeholder),
.task-search-row :deep(.el-select__placeholder) {
  font-size: 12px;
  color: #e8eaf6;
}

.task-search-row :deep(.is-focus) {
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.5) inset;
}

.search-btn {
  height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(0, 229, 255, 0.35);
  background: rgba(0, 229, 255, 0.14);
  color: #00e5ff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.search-btn.ghost {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #b7bdd8;
}

.task-panel-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-count-badge {
  font-size: 11px;
  color: #9094b0;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 10px;
}

.refresh-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #9094b0;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: color 0.2s;
}
.refresh-btn:hover { color: #00e5ff; border-color: rgba(0, 229, 255, 0.3); }
.refresh-btn.spinning svg { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Task list */
.task-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 0.2s;
}
.task-card:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.12); }
.task-card.task-active {
  border-color: rgba(0, 229, 255, 0.4);
  background: rgba(0, 229, 255, 0.05);
}

.task-status-icon {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}
.task-status-icon.status-pending { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.task-status-icon.status-running { background: rgba(0, 229, 255, 0.15); color: #00e5ff; }
.task-status-icon.status-success { background: rgba(105, 240, 174, 0.15); color: #69f0ae; }
.task-status-icon.status-failed  { background: rgba(255, 82, 82, 0.15); color: #ff5252; }
.spin-icon { display: inline-block; animation: spin 1.2s linear infinite; }

.task-info { flex: 1; min-width: 0; }
.task-video { font-size: 13px; font-weight: 500; color: #e8eaf6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-meta { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.tag-stroke { font-size: 11px; color: #00e5ff; background: rgba(0,229,255,0.1); padding: 1px 7px; border-radius: 4px; }
.tag-athlete { font-size: 11px; color: #b39ddb; background: rgba(179,157,219,0.1); padding: 1px 7px; border-radius: 4px; }
.tag-time { font-size: 11px; color: #606480; }

.task-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.status-pill { font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
.status-pill.status-pending { background: rgba(255,193,7,0.15); color: #ffc107; }
.status-pill.status-running { background: rgba(0,229,255,0.15); color: #00e5ff; }
.status-pill.status-success { background: rgba(105,240,174,0.15); color: #69f0ae; }
.status-pill.status-failed  { background: rgba(255,82,82,0.15); color: #ff5252; }
.task-score { font-size: 18px; font-weight: 800; color: #ffd54f; }

.empty-tasks {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 28px 16px;
  color: #606480;
  font-size: 13px;
}
.loading-tasks { display: flex; align-items: center; gap: 10px; padding: 24px 20px; color: #9094b0; font-size: 13px; }
.loading-more-tasks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 10px;
  color: #9094b0;
  font-size: 12px;
}
.tasks-end-tip {
  text-align: center;
  padding: 8px 0 10px;
  color: #606480;
  font-size: 11px;
}
.spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(0, 229, 255, 0.2);
  border-top-color: #00e5ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ── Result panel ────────────────────────────────────────────────────── */
.result-panel {
  border-top: none;
  padding: 16px 20px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pdf-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(0, 229, 255, 0.4);
  background: rgba(0, 229, 255, 0.1);
  color: #00e5ff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.pdf-btn:hover { background: rgba(0, 229, 255, 0.2); }
.pdf-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.result-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.metric-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}
.metric-label { font-size: 11px; color: #9094b0; margin-bottom: 6px; }
.metric-value { font-size: 20px; font-weight: 800; color: #e8eaf6; }
.score-value { color: #ffd54f; }
.risk-high { color: #ff5252; }
.risk-mid  { color: #ffc107; }
.risk-low  { color: #69f0ae; }

.result-section { display: flex; flex-direction: column; gap: 8px; }
.section-title { font-size: 12px; font-weight: 600; color: #9094b0; text-transform: uppercase; letter-spacing: 1px; }

.video-preview-panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.video-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: #c8cadb;
}

.video-link {
  color: #00e5ff;
  text-decoration: none;
}

.video-preview-player {
  width: 100%;
  max-height: 340px;
  background: #000;
  display: block;
}

.result-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-tab-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #9094b0;
  border-radius: 8px;
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}

.result-tab-btn.active {
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.45);
  background: rgba(0, 229, 255, 0.12);
}

.video-desc-box {
  border: 1px solid rgba(0, 229, 255, 0.3);
  background: rgba(0, 229, 255, 0.08);
  color: #c9f8ff;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.evidence-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.evidence-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.evidence-section {
  font-size: 11px;
  color: #00e5ff;
  white-space: nowrap;
}

.evidence-metric {
  font-size: 12px;
  color: #e8eaf6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.evidence-video-wrap {
  height: 180px;
  background: #000;
}

.evidence-video,
.section-evidence-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.evidence-placeholder {
  width: 100%;
  height: 100%;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #606480;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.evidence-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px 0;
  font-size: 11px;
  color: #9094b0;
}

.evidence-value,
.evidence-block {
  margin: 8px 10px 0;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.6;
}

.evidence-value { background: rgba(0, 229, 255, 0.08); color: #c9f8ff; }
.evidence-block { background: rgba(255, 255, 255, 0.06); color: #c8cadb; }

.evidence-card .evidence-block:last-child,
.evidence-card .evidence-value:last-child {
  margin-bottom: 10px;
}

.section-evidence-strip {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.section-evidence-list {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.section-evidence-item {
  flex: 0 0 220px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
}

.section-evidence-item .evidence-placeholder {
  height: 124px;
}

.section-evidence-video {
  height: 124px;
}

.section-evidence-label {
  padding: 6px 8px;
  font-size: 11px;
  color: #c8cadb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-tips {
  font-size: 12px;
  color: #606480;
  text-align: center;
  padding: 20px 0;
}
.kv-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 13px;
}
.kv-key { color: #9094b0; white-space: nowrap; }
.kv-val { color: #e8eaf6; word-break: break-word; }

.issue-list { display: flex; flex-direction: column; gap: 6px; }
.issue-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  border-left: 3px solid rgba(255, 213, 79, 0.5);
}
.issue-num {
  min-width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 213, 79, 0.2);
  color: #ffd54f;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.issue-metric { font-size: 12px; font-weight: 600; color: #e8eaf6; }
.issue-summary { font-size: 12px; color: #9094b0; margin-top: 2px; }

.detail-accordion {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-block {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.detail-block summary {
  cursor: pointer;
  padding: 10px 12px;
  color: #00e5ff;
  font-size: 13px;
  font-weight: 600;
  user-select: none;
}

.json-block {
  margin: 0;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.18);
  color: #d8def8;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow: auto;
}

.result-failed {
  align-items: center;
  text-align: center;
  background: rgba(255, 82, 82, 0.04);
  border-top-color: rgba(255, 82, 82, 0.2);
}
.fail-icon { font-size: 32px; color: #ff5252; }
.fail-title { font-size: 16px; font-weight: 700; color: #ff5252; margin: 0; }
.fail-msg { font-size: 13px; color: #9094b0; margin: 0; word-break: break-all; }

.result-waiting {
  align-items: center;
  text-align: center;
}
.wait-spinner {
  width: 32px; height: 32px;
  border: 3px solid rgba(0, 229, 255, 0.15);
  border-top-color: #00e5ff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
.wait-title { font-size: 15px; font-weight: 600; color: #00e5ff; margin: 0; }
.wait-sub { font-size: 12px; color: #606480; margin: 0; }

@media (max-width: 860px) {
  .ai-body {
    overflow-y: auto;
    overflow-x: hidden;
  }
  .ai-body-inner {
    flex-direction: column;
    height: auto;
    min-height: 100%;
  }
  .upload-panel {
    width: 100%;
    flex-shrink: initial;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    overflow-y: visible;
    max-height: none;
  }
  .task-panel {
    min-height: 60vh;
    flex: none;
  }
  .task-list {
    overflow-y: visible;
    max-height: none;
  }
  .task-search-row { grid-template-columns: 1fr; }
  .upload-zone { min-height: 100px; }
  .form-field-grid { grid-template-columns: 1fr; }
}
</style>
