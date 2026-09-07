# 埋点与反馈（Analytics & Feedback）

## 目标

官网自身作为**可观测性最佳实践示范**（对齐 observability-plan），同时收集用户行为改进文档。

## 埋点（Observability）

### 复用 TraceBus（devtools-plan）
- 官网内的交互事件统一走 TraceBus：
  - `page_view` `playground_run` `doc_search` `locale_switch` `feedback_submit`
- 事件结构统一（对齐 observability-plan traceId 协议）：
  ```ts
  { traceId, spanId, name, timestamp, props, platform }
  ```

### 采集内容
- 页面访问（路由变化）
- Playground 运行次数 / 报错 / 分享
- 搜索词（热门搜索 → 优化文档）
- 代码示例"复制" / "在 Playground 运行"点击
- 外链点击（GitHub / npm）

### 上报
- 批量 + 空闲上报（`navigator.sendBeacon`）
- 开发环境不发送

### 隐私（对齐 security-plan）
- **默认匿名**，不采集个人信息
- traceId 不含 PII
- 提供"禁用统计"开关（尊重 `Do Not Track`）
- 对齐 security-plan M7 脱敏规则

## 错误监控

- 全局 `error` + `unhandledrejection`
- Playground Worker 错误单独捕获
- Source Map 上传（构建期，对齐 build-plan sourcemap）
- 错误含 traceId，可在 DevTools 复盘（devtools-plan）

## 用户反馈

- 每页文档底部"反馈"按钮（`p-callout` + 弹层）
- 类型：🐛 错误 / 💡 建议 / ❓ 疑问
- 一键提交 GitHub Issue（预填 traceId + 页面 + 版本）
- 感谢页 + 后续邮件通知（可选）

## 数据看板（dogfooding）

- 内部 dashboard（用 Proteus + p-chart 构建）
- 指标：PV / 搜索热词 / Playground 使用率 / 反馈处理时长
- **展示透明编译哲学**：看板本身的开源实现可参考

## 合规

- Cookie / 本地存储最小化
- 隐私政策页（含埋点说明）
- 对齐 security-plan 合规要求

## 验收

- [ ] 所有埋点走 TraceBus，无散落 `track()` 调用
- [ ] 错误带 traceId，可完整复盘
- [ ] 禁用统计后零请求发送
- [ ] 反馈一键创建 GitHub Issue（含上下文）

## 依赖

- `devtools-plan`（TraceBus）
- `observability-plan`（traceId 协议 / 采样）
- `security-plan`（隐私 / 脱敏）
- `08-design-system.md`（`p-callout` / 反馈 UI）
