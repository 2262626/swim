import { ref, readonly } from 'vue'
import {
  createSwimSessionApi,
  completeSwimSessionApi,
} from '../api/swim.js'

const FLUSH_INTERVAL_MS = 3000
const MAX_BATCH = 120
const MAX_SNAPSHOT_BATCH = 4

export function useSessionUploader() {
  const sessionId = ref('')
  const athleteId = ref('')
  const teamId = ref('')
  const running = ref(false)
  const uploading = ref(false)
  const lastError = ref('')
  const pendingCount = ref(0)

  const frameQueue = []
  const pauseQueue = []
  const coachQueue = []
  const snapshotQueue = []

  let timer = null
  let sequence = 1

  const updatePendingCount = () => {
    pendingCount.value = frameQueue.length + pauseQueue.length + coachQueue.length + snapshotQueue.length
  }

  const nextSequence = () => {
    const current = sequence
    sequence += 1
    return current
  }

  const ensureActive = () => running.value && !!sessionId.value

  const startFlushTimer = () => {
    if (timer) return
    timer = window.setInterval(() => {
      void flush()
    }, FLUSH_INTERVAL_MS)
  }

  const stopFlushTimer = () => {
    if (!timer) return
    window.clearInterval(timer)
    timer = null
  }

  const startSession = async (meta) => {
    lastError.value = ''
    const payload = {
      sessionMeta: meta,
      teamId: meta.teamId,
      athleteId: meta.athleteId,
      coachId: meta.coachId,
      sourceType: meta.sourceType,
      strokeTarget: meta.strokeTarget,
      ruleVersion: meta.ruleVersion,
      modelVersion: meta.modelVersion,
      startedAt: meta.startedAt,
    }
    const data = await createSwimSessionApi(payload)
    const serverSessionIdRaw = data?.data?.sessionId ?? data?.sessionId
    const serverSessionId = serverSessionIdRaw == null ? '' : String(serverSessionIdRaw)
    if (!serverSessionId) {
      throw new Error('服务端未返回 sessionId')
    }
    sessionId.value = serverSessionId
    athleteId.value = meta.athleteId
    teamId.value = meta.teamId
    running.value = true
    sequence = 1
    frameQueue.length = 0
    pauseQueue.length = 0
    coachQueue.length = 0
    snapshotQueue.length = 0
    updatePendingCount()
    startFlushTimer()
    return serverSessionId
  }

  const queueFrameMetric = (item) => {
    if (!ensureActive()) return
    frameQueue.push(item)
    updatePendingCount()
  }

  const queuePauseEvent = (item) => {
    if (!ensureActive()) return
    pauseQueue.push(item)
    updatePendingCount()
  }

  const queueCoachAction = (item) => {
    if (!ensureActive()) return
    coachQueue.push(item)
    updatePendingCount()
  }

  const queueSnapshot = (item) => {
    if (!ensureActive()) return
    if (!item?.imageData) return
    snapshotQueue.push(item)
    updatePendingCount()
  }

  const flush = async () => {
    frameQueue.length = 0
    pauseQueue.length = 0
    coachQueue.length = 0
    snapshotQueue.length = 0
    updatePendingCount()
  }

  const completeSession = async (payload) => {
    if (!ensureActive()) return false
    await flush().catch(() => {})
    await completeSwimSessionApi(
      sessionId.value,
      {
        athleteId: athleteId.value,
        ...payload,
      },
      nextSequence()
    )
    stopFlushTimer()
    running.value = false
    return true
  }

  const abortSession = () => {
    stopFlushTimer()
    running.value = false
    sessionId.value = ''
    athleteId.value = ''
    teamId.value = ''
    frameQueue.length = 0
    pauseQueue.length = 0
    coachQueue.length = 0
    snapshotQueue.length = 0
    updatePendingCount()
  }

  return {
    sessionId: readonly(sessionId),
    athleteId: readonly(athleteId),
    teamId: readonly(teamId),
    running: readonly(running),
    uploading: readonly(uploading),
    lastError: readonly(lastError),
    pendingCount: readonly(pendingCount),
    startSession,
    queueFrameMetric,
    queuePauseEvent,
    queueCoachAction,
    queueSnapshot,
    flush,
    completeSession,
    abortSession,
  }
}
