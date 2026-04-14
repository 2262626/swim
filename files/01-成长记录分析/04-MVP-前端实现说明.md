# 游泳AI训练系统 MVP（前端双端实现说明）

## 1. 文档目标

本说明面向前端团队，明确两个端的职责与模块边界：

- 教练端：选择队伍/学员、上传视频分析、实时纠错、上报训练数据。
- 后台管理系统：组织与学员管理、数据查询、成长记录查看、报告管理、系统配置。

---

## 2. 角色与端划分

- 教练端用户：教练、助教（偏训练现场）。
- 管理后台用户：管理员、运营、教研负责人（偏管理与复盘）。

强约束：

- 教练端每次分析前必须先选 `team_id + athlete_id`。
- 所有上报记录必须绑定 `session_id + athlete_id`。

---

## 3. 教练端模块（训练现场端）

## 3.1 队伍与学员选择模块

- 队伍下拉：`1队/2队/...`
- 学员下拉：按 `team_id` 过滤
- 学员搜索：按姓名关键字筛选
- 约束：未选学员时禁止开始分析

## 3.2 视频分析模块

- 上传视频或摄像头实时分析
- 自动暂停 + 圈点纠错 + 建议展示
- 显示当前会话信息：队伍、学员、会话ID、状态

## 3.3 数据上报模块

- 创建会话：`POST /api/v1/swim-analysis/sessions`
- 过程上报：`POST /api/v1/swim-analysis/sessions/{session_id}/ingest`
- 结束上报：`POST /api/v1/swim-analysis/sessions/{session_id}/complete`
- 失败重试：本地队列 + 指数退避 + 幂等 `sequence_id`

## 3.4 单次结果模块

- 展示本次总分、Top错误、下次训练重点
- 提交后显示“已写入成长记录”
- 支持触发 PDF：`POST /api/v1/swim-analysis/reports/{report_id}/pdf`

---

## 4. 后台管理系统模块（管理运营端）

## 4.1 组织与队伍管理

- 队伍列表：新增、编辑、启停（如 `1队/2队`）
- 队伍成员管理：将学员分配/移出队伍
- 队伍维度看板：队伍均分、周趋势、问题Top

## 4.2 学员档案管理

- 学员基础信息：姓名、性别、年龄段、所属队伍、状态
- 学员变更记录：调队历史、状态变更历史
- 学员搜索与筛选：按队伍、姓名、状态

## 4.3 训练记录管理

- 会话列表：按队伍/学员/日期筛选
- 单次训练详情：会话信息、关键事件、关键帧、报告摘要
- 上报状态监控：成功/失败/待补传

## 4.4 成长记录中心

- 日/周/月记录查询
- 趋势图：总分、分项分、稳定性、复发错误
- KPI跟踪：目标值、当前值、达成率

## 4.5 报告管理

- 报告列表：按学员、日期、队伍过滤
- PDF生成状态：待生成/生成中/完成/失败
- PDF重试与下载

## 4.6 系统配置管理

- 规则版本管理：`rule_version` 生效与回滚
- 模型版本登记：`model_version` 对应说明
- 阈值配置：自动暂停阈值、评分阈值、采样策略

## 4.7 权限与账号管理（MVP最小）

- 角色：管理员、教练、助教、查看者
- 权限控制：
- 教练只能看所属队伍/学员
- 管理员可看全部数据并管理配置

---

## 5. 后台管理系统页面清单（MVP）

- `登录页`
- `工作台/看板`
- `队伍管理页`
- `学员管理页`
- `训练记录页`
- `成长记录页`
- `报告管理页`
- `系统配置页`
- `账号与权限页`

---

## 6. 双端接口依赖（前端视角）

教练端常用：

- `GET /api/v1/teams`
- `GET /api/v1/athletes?team_id=&keyword=`
- `POST /api/v1/swim-analysis/sessions`
- `POST /api/v1/swim-analysis/sessions/{session_id}/ingest`
- `POST /api/v1/swim-analysis/sessions/{session_id}/complete`

后台管理端常用：

- `GET /api/v1/teams`
- `GET /api/v1/athletes`
- `GET /api/v1/athletes/{athlete_id}/growth/daily`
- `GET /api/v1/athletes/{athlete_id}/growth/weekly`
- `GET /api/v1/athletes/{athlete_id}/growth/monthly`
- `GET /api/v1/athletes/{athlete_id}/reports`
- `POST /api/v1/swim-analysis/reports/{report_id}/pdf`
- `GET /api/v1/swim-analysis/reports/{report_id}/pdf-status`

---

## 7. 前端状态与权限建议

- 教练端与后台管理系统建议拆成两个路由域或两个应用入口。
- 统一登录态与角色信息，按角色动态控制菜单与页面访问。
- 所有写接口必须带 `session_id` 或 `operator_id` 便于审计。

---

## 8. MVP验收标准（双端）

- 教练端：未选学员无法开始分析，且数据全链路上报成功。
- 管理后台：可按队伍筛选学员并查询训练/成长记录。
- 报告中心：可查看报告并触发 PDF 生成。
- 权限隔离：教练看不到非授权队伍数据。
- 配置可追踪：规则版本与模型版本可查可回溯。

---

## 9. 下一步实现建议

- 先落教练端“队伍-学员-会话上报”主流程。
- 后台优先上线 `队伍管理 + 学员管理 + 训练记录 + 成长记录` 四个核心模块。
- 报告与系统配置作为第二阶段，权限细分第三阶段完善。
