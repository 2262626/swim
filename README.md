# 游泳AI训练系统 (Vue 3 工程化版本)

基于 Vue 3 + Vite 重构的游泳AI骨骼识别系统。

## 项目结构

```
swim-ai-system/
├── index.html              # 入口 HTML
├── package.json            # 项目依赖
├── vite.config.js          # Vite 配置
├── src/
│   ├── main.js             # 应用入口
│   ├── App.vue             # 根组件
│   ├── assets/
│   │   └── styles.css      # 全局样式
│   ├── components/
│   │   ├── TopBar.vue      # 顶部栏组件
│   │   ├── BottomPanel.vue # 底部数据面板
│   │   ├── SettingsDrawer.vue  # 设置抽屉
│   │   └── LoadingOverlay.vue  # 加载遮罩
│   └── composables/
│       ├── usePoseEngine.js    # MediaPipe 姿态引擎
│       ├── useSkeletonDraw.js  # 骨骼绘制
│       └── useSwimAnalysis.js  # 游泳分析
```

## 与原项目的对比

| 特性 | 原项目 | Vue 3 工程化版本 |
|------|--------|------------------|
| 架构 | 原生 JS + DOM 操作 | Vue 3 Composition API |
| 构建工具 | 无 | Vite |
| 状态管理 | 全局变量 | Vue Reactive |
| 组件复用 | 无 | 组件化 |
| 类型安全 | 无 | 部分类型推断 |

## 安装和运行

```bash
# 进入项目目录
cd swim-ai-system

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview
```

## 主要功能

- **实时骨骼识别**: 使用 MediaPipe Pose 进行人体姿态检测
- **泳姿识别**: 自动识别自由泳、蛙泳、仰泳、蝶泳
- **划臂计数**: 实时统计划臂次数
- **关节角度**: 显示肘部、肩部等关键关节角度
- **设置面板**: 可调整模型精度、置信度阈值、骨骼样式等

## 浏览器要求

- 支持 WebRTC 的现代浏览器 (Chrome, Firefox, Safari, Edge)
- 需要摄像头权限

## 技术栈

- Vue 3 (Composition API)
- Vite
- MediaPipe Pose
- CSS Variables
