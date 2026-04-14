# 游泳AI训练系统 MVP（后端对接说明）

## 1. 文档目标

本说明面向后端开发，定义最小可上线方案：

- 前端必须先选择队伍与学员，再上传视频分析。
- 训练分析数据按 `athlete_id` 绑定上报并存储。
- 后端基于上报数据生成个人成长记录（单次/周/月）。
- PDF 报告由后端生成。

---

## 2. MVP业务流程

```text
教练登录
  -> 选择队伍（1队/2队/...）
  -> 按队伍筛选学员并选择学员
  -> 上传视频并开始分析
  -> 创建训练会话（绑定 team_id + athlete_id）
  -> 训练中增量上报帧/事件
  -> 训练结束上报汇总报告
  -> 后端入库并更新成长记录
  -> 可选：生成 PDF 报告
```

---

## 3. 核心实体与关系

- `team`：队伍信息（用于分组筛选）。
- `athlete`：学员主档（属于某队伍）。
- `analysis_session`：单次视频分析会话（绑定学员）。
- `frame_metric`：帧级采样数据（轻量明细）。
- `pause_event`：自动暂停事件。
- `coach_action_event`：教练干预/批注事件。
- `analysis_report`：单次训练结果摘要。
- `growth_record_daily`：按天沉淀的成长记录。
- `growth_record_weekly`：按周聚合的成长记录。
- `growth_record_monthly`：按月聚合的成长记录。

关系约束：

- `team 1 - n athlete`
- `athlete 1 - n analysis_session`
- `analysis_session 1 - n frame_metric`
- `analysis_session 1 - n pause_event`
- `analysis_session 1 - n coach_action_event`
- `analysis_session 1 - 1 analysis_report`

---

## 4. 最小数据表（建议）

## 4.1 `teams`

- `team_id` PK
- `team_name`
- `status`
- `created_at`

## 4.2 `athletes`

- `athlete_id` PK
- `team_id` FK
- `athlete_name`
- `gender`（可选）
- `birth_date`（可选）
- `status`
- `created_at`

## 4.3 `analysis_sessions`

- `session_id` PK
- `team_id` FK
- `athlete_id` FK
- `coach_id`
- `source_type`（camera/video）
- `stroke_target`
- `rule_version`
- `model_version`
- `started_at`
- `ended_at`
- `status`

## 4.4 `analysis_reports`

- `report_id` PK
- `session_id` FK UNIQUE
- `athlete_id` FK
- `overall_score`
- `style_scores_json`
- `top_errors_json`
- `pause_count`
- `pause_effective_rate`
- `next_focus_json`
- `created_at`

## 4.5 `pause_events`

- `event_id` PK
- `session_id` FK
- `athlete_id` FK
- `timestamp_ms`
- `frame_index`
- `severity`
- `trigger_type`
- `trigger_rule_id`
- `summary`
- `evidence_json`
- `user_action`
- `created_at`

## 4.6 `coach_action_events`

- `action_id` PK
- `session_id` FK
- `athlete_id` FK
- `timestamp_ms`
- `event_ref`
- `action_type`
- `action_text`
- `drill_assigned`
- `created_at`

## 4.7 `frame_metrics`（可冷热分层）

- `id` PK
- `session_id` FK
- `athlete_id` FK
- `frame_index`
- `timestamp_ms`
- `style`
- `phase`
- `score`
- `symmetry_score`
- `stroke_count`
- `stroke_rate`
- `confidence`
- `angles_json`
- `issues_json`
- `created_at`

## 4.8 成长记录聚合表

- `growth_record_daily`: `athlete_id`, `date`, `overall_score`, `style_scores_json`, `focus_issues_json`
- `growth_record_weekly`: `athlete_id`, `year_week`, `avg_score`, `style_trend_json`, `top_errors_json`
- `growth_record_monthly`: `athlete_id`, `year_month`, `avg_score`, `volatility`, `kpi_progress_json`

---

## 5. 接口清单（HTTP）

统一约束：

- 鉴权：`Authorization: Bearer <token>`
- 幂等：`X-Session-Id`、`X-Sequence-Id`
- 内容类型：`application/json`

## 5.1 队伍与学员查询

- `GET /api/v1/teams`
- `GET /api/v1/athletes?team_id={team_id}&keyword={name}`

返回最小字段：

- `team_id`, `team_name`
- `athlete_id`, `athlete_name`, `team_id`, `status`

## 5.2 分析会话与上报

- `POST /api/v1/swim-analysis/sessions`
- `POST /api/v1/swim-analysis/sessions/{session_id}/ingest`
- `POST /api/v1/swim-analysis/sessions/{session_id}/complete`

关键校验：

- `session` 创建时必须有 `team_id + athlete_id`。
- `ingest/complete` 必须校验 `session_id` 与 `athlete_id` 一致性。
- 同一 `X-Sequence-Id` 重复请求需要幂等返回。

## 5.3 成长记录与报告查询

- `GET /api/v1/athletes/{athlete_id}/growth/daily?date_from=&date_to=`
- `GET /api/v1/athletes/{athlete_id}/growth/weekly?year_week=`
- `GET /api/v1/athletes/{athlete_id}/growth/monthly?year_month=`
- `GET /api/v1/athletes/{athlete_id}/reports?date_from=&date_to=`

## 5.4 PDF生成

- `POST /api/v1/swim-analysis/reports/{report_id}/pdf`
- `GET /api/v1/swim-analysis/reports/{report_id}/pdf-status`

---

## 6. 成长记录计算规则（MVP）

日级：

- 取该学员当日所有 `analysis_report`。
- 输出当日平均分、最低分项、高频错误 Top3、下次训练重点。

周级：

- 基于当周日级汇总。
- 输出周均分、较上周变化、波动率、复发错误。

月级：

- 基于当月周级汇总。
- 输出月均分、稳定区间、KPI达成率、阶段建议。

---

## 7. 数据质量与容错

- 前端断网时允许延迟上报，后端按 `session_id + sequence_id` 去重。
- `frame_metrics` 建议按采样率存储，避免全帧入库导致膨胀。
- 若 `complete` 到达前未收到部分 `ingest`，允许补传并回算聚合。
- 报告计算与成长聚合建议异步任务化，避免阻塞写入接口。

---

## 8. MVP验收标准

- 队伍筛选学员可用，且创建会话必须绑定学员。
- 每次分析结果都能按 `athlete_id` 查询到。
- 单次报告、周报、月报可通过接口读取。
- 报告可触发后端 PDF 生成并返回可访问链接。
- 同一上报重试不会重复入库。

---

## 9. 需要你拍板的产品参数

- 队伍是单选归属还是支持多队伍挂靠。
- 学员是否允许跨队调拨后的历史归属策略。
- `frame_metrics` 保留周期（如 30/90/180 天）。
- 周报统计口径按自然周还是训练周。
- KPI 基线按“上月均值”还是“最近4周均值”。
