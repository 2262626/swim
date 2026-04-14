# 游泳 AI 训练系统

基于 `Vue 3 + Vite + MediaPipe Pose` 的游泳动作识别与训练辅助系统，支持实时摄像头分析、视频导入分析、动作评分、划臂计数、数据导出与抓拍回放。

## 当前已实现功能（按代码现状）

### 1) 登录与鉴权

- 登录页：`/login`
- 鉴权路由：未登录自动跳转登录页，登录后进入 `/swim`
- 登录流程：账号密码 + 验证码（可由后端控制是否开启验证码）
- Token 持久化：`localStorage`（键名：`ruoyi_token`）
- 退出登录：支持调用后端退出接口并清理本地状态

相关文件：

- `src/router/index.js`
- `src/store/auth.js`
- `src/views/LoginView.vue`
- `src/api/auth.js`
- `src/api/http.js`

### 2) 实时姿态识别（摄像头模式）

- 自动启动相机并进入识别流程
- 支持前后摄像头切换
- iOS/Safari 相机约束降级策略（提升兼容性）
- 常见相机错误提示（权限、HTTPS、设备占用、超时等）
- 人体离开画面提示与状态徽章

### 3) 本地视频导入分析（视频模式）

- 顶栏一键导入视频（`mp4/mov/m4v/webm/avi`）
- 导入后自动切换为视频分析模式并开始识别
- 视频结束自动停止分析并整理抓拍结果
- 可从视频模式切回实时摄像头模式

### 4) 泳姿识别与阶段判断

- 支持泳姿：`自由泳`、`蛙泳`、`蝶泳`、`仰泳`
- 支持阶段识别（如准备姿势、入水/抱水/划水/移臂等）
- 支持手动选择当前泳姿作为分析目标
- 实时显示识别结果：`泳姿·阶段`

核心分析文件：`src/composables/useSwimAnalysis.js`

### 5) 动作评分与技术面板

- 根据不同泳姿模板进行动作质量评估
- 技术项逐条展示：正确 / 错误 / 待识别
- 展示综合评分（分数）
- 支持技术面板折叠/展开

### 6) 划臂计数与运动指标

- 实时划臂计数
- 关节角度（左/右肘、左/右肩）
- 帧率（FPS）与姿态置信度
- 支持“重置计数”

### 7) 录制、抓拍、回放与本地保存

- 开始/停止录制
- 录制中按时间与动作变化自动抓拍关键帧
- 停止后显示右侧抓拍回放列表
- 支持图片大图预览
- 支持将抓拍结果写入本地文件夹（若浏览器支持 `showDirectoryPicker`）：
  - 图片序列（jpg）
  - `metadata.json`

### 8) 数据导出

- 导出录制分析结果为 JSON 文件
- 导出格式：`compact-v2`
- 包含内容：时间戳、泳姿/阶段、划臂数、评分、对称性、关键角度等

### 9) 骨骼渲染与识别引擎优化

- 自定义骨骼线宽、颜色、标签显示
- 支持上半身重点显示
- 骨骼点与连线分区着色
- 关节角度计算
- 识别引擎包含多项稳定性优化：
  - 移动端跳帧降负载
  - 姿态缓冲与平滑
  - 快速动作抑制拖影
  - 遮挡场景短时补偿
  - 结构异常约束回退

相关文件：

- `src/composables/usePoseEngine.js`
- `src/composables/useSkeletonDraw.js`

### 10) 移动端能力与 PWA

- 网络在线/离线状态监听
- 震动反馈（移动端）
- 屏幕常亮请求（Wake Lock）
- 设备类型检测（iOS/Android/Desktop）
- PWA 基础能力：`manifest + service worker`
- 生产环境自动注册 `sw.js`

相关文件：

- `src/composables/useMobileFeatures.js`
- `src/main.js`
- `public/manifest.json`
- `public/sw.js`

## 技术栈

- `Vue 3`（Composition API）
- `Vite 5`
- `Vue Router 4`
- `Element Plus`
- `@mediapipe/pose`

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 开发运行

```bash
npm run dev
```

> `dev`/`build` 会先执行 `scripts/sync-mediapipe.mjs`，将 `@mediapipe/pose` 资源同步到 `public/vendor/mediapipe/pose`。

### 3. 生产构建与预览

```bash
npm run build
npm run preview
```

## 环境变量

后端 API 基地址通过以下变量配置：

- `VITE_RUOYI_API_BASE_URL`

示例：

```env
VITE_RUOYI_API_BASE_URL=http://your-api-host/dev-api
```

说明：`src/api/http.js` 会自动拼接请求路径，如 `/login`、`/captchaImage`、`/logout`。

## 部署说明

- 已包含 `vercel.json`，可直接用于 Vercel 静态部署
- 构建产物目录：`dist`

## 主要目录结构

```text
.
├─ public/
│  ├─ manifest.json
│  ├─ sw.js
│  └─ vendor/mediapipe/pose/
├─ scripts/
│  └─ sync-mediapipe.mjs
├─ src/
│  ├─ api/
│  │  ├─ auth.js
│  │  └─ http.js
│  ├─ assets/styles.css
│  ├─ components/
│  │  ├─ TopBar.vue
│  │  ├─ BottomPanel.vue
│  │  ├─ SettingsDrawer.vue
│  │  └─ LoadingOverlay.vue
│  ├─ composables/
│  │  ├─ usePoseEngine.js
│  │  ├─ useSkeletonDraw.js
│  │  ├─ useSwimAnalysis.js
│  │  └─ useMobileFeatures.js
│  ├─ router/index.js
│  ├─ store/auth.js
│  ├─ views/LoginView.vue
│  ├─ App.vue
│  └─ main.js
├─ files/                     # 各泳姿标准说明文档
├─ package.json
├─ vite.config.js
└─ vercel.json
```

## 使用流程（建议）

1. 启动项目并登录
2. 允许相机权限，进入实时识别
3. 选择当前泳姿，点击“开始录制”
4. 训练结束后点击“停止录制”查看抓拍回放
5. 需要留档时点击“导出数据”下载 JSON
6. 也可从顶部导入历史训练视频进行离线分析

## 运行要求与注意事项

- 建议使用现代 Chromium 浏览器（Chrome/Edge）
- 相机调用需在安全上下文（`HTTPS` 或 `localhost`）下进行
- 本地目录写入依赖 `File System Access API`（部分浏览器不支持）
- 默认登录表单中存在演示账号初始值（见 `src/store/auth.js`），实际部署请替换
