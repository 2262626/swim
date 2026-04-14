export type StrokeType = 'freestyle' | 'breaststroke' | 'butterfly' | 'backstroke'
export type PhaseType = 'prep' | 'entry' | 'catch' | 'pull' | 'recovery' | 'glide' | 'unknown'
export type TaskStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed'
export type Severity = 'low' | 'medium' | 'high'

export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data: T
}

export interface AnalysisTask {
  task_id: string
  athlete_id: string
  video_id: string
  stroke_type: StrokeType
  status: TaskStatus
  auto_pause_enabled: boolean
  created_at: string
}

export interface LandmarkPoint {
  idx: number
  x: number
  y: number
  z?: number
  visibility: number
}

export interface JointAngles {
  left_elbow?: number
  right_elbow?: number
  left_shoulder?: number
  right_shoulder?: number
  left_knee?: number
  right_knee?: number
  left_hip?: number
  right_hip?: number
}

export interface FrameMetric {
  task_id: string
  frame_index: number
  timestamp_ms: number
  phase: PhaseType
  score: number
  symmetry_score: number
  confidence: number
  angles: JointAngles
  pose_landmarks: LandmarkPoint[]
}

export interface PauseEvidence {
  metric: string
  value: number
  expected_range?: [number, number]
}

export interface PauseEvent {
  event_id: string
  task_id: string
  frame_index: number
  timestamp_ms: number
  severity: Severity
  trigger_type:
    | 'low_score'
    | 'angle_out_of_range'
    | 'timing_abnormal'
    | 'pose_lost'
    | 'phase_transition'
  trigger_rule_id: string
  summary: string
  evidence: PauseEvidence
  user_action?: 'saved' | 'ignored' | 'pending'
  interactive?: boolean
}

export interface CoachActionEvent {
  action_id: string
  task_id: string
  timestamp_ms: number
  action_type: string
  action_text: string
  event_ref?: string
  drill_assigned?: string
  interactive?: boolean
}

export interface ErrorItem {
  error_id: string
  stroke_type: StrokeType
  phase: PhaseType
  error_type: string
  severity: Severity
  impact: string
  count: number
  first_seen_ms: number
  last_seen_ms: number
}

export interface CorrectionSuggestion {
  suggestion_id: string
  error_type: string
  title: string
  cue: string
  target_range?: {
    metric: string
    min: number
    max: number
    unit: 'degree' | 'score' | 'ratio'
  }
  dryland_drill?: string
  water_drill?: string
  recheck_rule?: string
}

export interface StrokeScores {
  freestyle?: number
  breaststroke?: number
  butterfly?: number
  backstroke?: number
}

export interface AnalysisReport {
  report_id: string
  task_id: string
  athlete_id: string
  overall_score: number
  stroke_scores: StrokeScores
  top_errors: string[]
  pause_events: string[]
  next_focus: string[]
  created_at: string
}

export interface ProgressPayload {
  status: TaskStatus
  progress: number
  current_time_ms: number
  error_count: number
  pause_count: number
}

export interface CreateTaskRequest {
  athlete_id: string
  video_id: string
  stroke_type: StrokeType
  auto_pause_enabled?: boolean
}

export interface AddAnnotationRequest {
  frame_index: number
  annotation_type: 'arrow' | 'circle' | 'rect' | 'text'
  points: Array<{ x: number; y: number }>
  text?: string
}

export interface UpdatePauseEventRequest {
  user_action: 'saved' | 'ignored'
  reason?: string
}

export interface SaveGrowthRecordRequest {
  report_id: string
  weekly_tag: string
  coach_summary?: string
  next_targets?: Array<{
    metric: string
    target: string
  }>
}
