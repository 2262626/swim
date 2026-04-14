# 需求04：前端 TypeScript 类型定义 + 后端 OpenAPI 3.0

本目录提供可直接用于前后端联调的契约文件：

- `types.d.ts`：前端类型声明，覆盖任务、帧、暂停事件、错误、建议、报告等核心实体
- `openapi.yaml`：后端接口草案（OpenAPI 3.0），覆盖任务、进度、暂停事件、批注、报告、导出与成长记录

## 使用建议

1. 前端先基于 `types.d.ts` 约束 API 数据结构
2. 后端以 `openapi.yaml` 生成/校验接口契约
3. 联调阶段先跑通 `create task -> progress -> pause-events -> report`
4. 对于算法输出，建议增加一层 `adapter` 映射到契约字段
