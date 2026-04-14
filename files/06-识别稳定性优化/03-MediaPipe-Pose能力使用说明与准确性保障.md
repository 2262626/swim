# MediaPipe Pose 能力使用说明与准确性保障

## 1. 结论（是否开启“大模型”）

结论：**当前项目没有开启或接入任何 LLM（大语言模型）能力**。

- 运行时姿态识别引擎为 `@mediapipe/pose`（Web 端 Pose 方案）。
- 代码仅使用 `Pose` 的标准接口：`new Pose(...)`、`setOptions(...)`、`onResults(...)`、`send(...)`。
- 项目中不存在 OpenAI/Claude/Gemini 等大模型 SDK、API 调用、或推理服务链路。

说明：`@mediapipe/pose` 的 `modelComplexity`（0/1/2）是 **姿态模型复杂度档位**，不是“LLM 大模型开关”。

## 2. 当前已使用的 @mediapipe/pose 功能（已核对代码）

### 2.1 核心调用链

- 初始化：`new Pose({ locateFile })`
- 参数设置：`pose.setOptions(currentOptions)`
- 结果回调：`pose.onResults(_handleResults)`
- 每帧推理：`pose.send({ image: videoEl })`
- 资源重建：`pose.close()` 后重新初始化（切换复杂度时）

以上调用均在：`src/composables/usePoseEngine.js`

### 2.2 已启用配置项

当前默认配置（见 `usePoseEngine.js`）：

- `modelComplexity`: 移动端默认 `0`，桌面端默认 `1`
- `smoothLandmarks`: `true`（启用官方关键点平滑）
- `minDetectionConfidence`: `0.6`
- `minTrackingConfidence`: `0.6`

并且在设置面板可动态调整：

- 模型复杂度：`0 / 1 / 2`（快速 / 标准 / 精准）
- 检测阈值：`detectConf`（0.1~0.9）
- 跟踪阈值：`trackConf`（0.1~0.9）

对应代码位置：

- `src/components/SettingsDrawer.vue`
- `src/App.vue` 中 `applySettings(...)`（调用 `poseEngine.updateOptions` 或 `poseEngine.reinit`）

### 2.3 明确未启用的功能

- `enableSegmentation: false`（未启用人体分割）
- `smoothSegmentation: false`（分割平滑未启用）
- `selfieMode` 未显式开启

## 3. 项目为准确性做的二次增强（在 MediaPipe 结果之上）

除 `@mediapipe/pose` 本身外，项目还做了以下后处理来提升稳定性：

1. **时序缓冲平滑**（`POSE_BUFFER_SIZE=5`）
   - 对关键点做多帧加权平均，减小抖动。
2. **快速运动自适应**（`FAST_MOTION_DIST`）
   - 快速动作时提高最新帧权重，减轻拖尾。
3. **结构约束回退**（双腕/双踝对称约束）
   - 连续异常才触发回退，避免单帧误判导致骨架跳变。
4. **遮挡容错**（`MAX_OCCLUDED_FRAMES=6`）
   - 短时丢点时用历史有效点衰减续接，减少“瞬断”。
5. **人像有效性门控**（App 层）
   - 躯干关键点可见度 + 平均可见度阈值，不满足则不进入后续动作评估。
6. **动作门控状态机**（分析层）
   - PREP / TRANSITION / SWIM_ACTIVE 分离，避免起跳/转身被当作完整泳姿。

## 4. 对“准确性保证”的边界说明

可保证项（工程层面）：

- 保证使用的是上文列出的 `@mediapipe/pose` 功能与参数链路；
- 保证当前版本未接入 LLM；
- 保证在设置项变更后，配置会真实生效（`setOptions` 或 `reinit`）。

不可绝对保证项（算法层面）：

- 在强遮挡、水花反光、极端机位下，单目 2D/3D 关键点仍可能漂移；
- 准确率受机位、光照、视频分辨率和动作速度显著影响。

## 5. 建议的精度优先配置（不改代码即可操作）

若你的目标是“优先准确性”：

1. 设置“模型精度”为 `精准(2)`；
2. `detectConf` 建议 `0.65~0.75`；
3. `trackConf` 建议 `0.65~0.75`；
4. 机位尽量侧拍且全身入镜，减少反光和遮挡；
5. 同一会话保持固定泳姿与固定机位，避免域切换。

## 6. 可进一步提升准确性的后续方向（可选）

- 按机位建立参数预设（侧拍/正拍/近景）；
- 增加基于质量分数的“低质帧剔除”；
- 对高难片段增加二次重算（高复杂度+较低帧率）；
- 引入多模型投票或轻量时序模型做阶段纠偏（不等于 LLM）。
