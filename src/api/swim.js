import { requestWithAuth } from './http.js'

const asArray = (data) => {
  if (Array.isArray(data?.rows)) return data.rows
  if (Array.isArray(data?.data?.rows)) return data.data.rows
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data)) return data
  return []
}

export const listTeamsApi = () =>
  requestWithAuth('/api/v1/teams', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).then(asArray)

export const createTeamApi = (payload) =>
  requestWithAuth('/api/v1/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload || {}),
  })

export const listCameraTypesApi = () =>
  requestWithAuth('/swim/cameraType/list?pageNum=1&pageSize=100', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).then(asArray)

export const listAthletesApi = ({ teamId, keyword = '' }) => {
  const params = new URLSearchParams()
  const teamValue = String(teamId ?? '').trim()
  if (teamValue && teamValue !== 'undefined' && teamValue !== 'null') {
    params.set('teamId', teamValue)
  }
  if (keyword) params.set('keyword', keyword)
  const query = params.toString()
  return requestWithAuth(`/api/v1/athletes${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).then(asArray)
}

export const createAthleteApi = (payload) =>
  requestWithAuth('/api/v1/athletes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload || {}),
  })

export const createSwimSessionApi = (payload) =>
  {
    const meta = payload?.sessionMeta || {}
    const merged = {
      teamId: payload?.teamId ?? meta?.teamId,
      athleteId: payload?.athleteId ?? meta?.athleteId,
      coachId: payload?.coachId ?? meta?.coachId,
      sourceType: payload?.sourceType ?? meta?.sourceType,
      strokeTarget: payload?.strokeTarget ?? meta?.strokeTarget,
      ruleVersion: payload?.ruleVersion ?? meta?.ruleVersion,
      modelVersion: payload?.modelVersion ?? meta?.modelVersion,
      startedAt: payload?.startedAt ?? meta?.startedAt,
    }
    return requestWithAuth('/api/v1/swim-analysis/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(merged),
    })
  }

export const ingestSwimSessionApi = (sessionId, payload, sequenceId) =>
  requestWithAuth(`/api/v1/swim-analysis/sessions/${sessionId}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Session-Id': sessionId,
      'X-Sequence-Id': String(sequenceId),
    },
    body: JSON.stringify(payload),
  })

export const completeSwimSessionApi = (sessionId, payload, sequenceId) =>
  requestWithAuth(`/api/v1/swim-analysis/sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Session-Id': sessionId,
      'X-Sequence-Id': String(sequenceId),
    },
    body: JSON.stringify(payload),
  })

export const uploadSwimSnapshotsApi = (sessionId, payload, sequenceId) =>
  requestWithAuth(`/api/v1/swim-analysis/sessions/${sessionId}/snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Session-Id': sessionId,
      'X-Sequence-Id': String(sequenceId),
    },
    body: JSON.stringify(payload),
  })

export const listTrainingTargetsApi = () =>
  requestWithAuth('/swim/trainingTarget/list?pageNum=1&pageSize=100', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).then(asArray)

export const listPoolLengthsApi = () =>
  requestWithAuth('/system/dict/data/type/swim_pool_length', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).then(asArray)

export const createSwimPdfApi = (reportId, payload) =>
  requestWithAuth(`/api/v1/swim-analysis/reports/${reportId}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload),
  })
