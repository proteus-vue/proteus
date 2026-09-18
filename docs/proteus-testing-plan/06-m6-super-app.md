# M6 — 超级应用加固 (stress / 内存 / 稳定性)

## 1. 压测 (stress)
- 千级 store 全量 hydrate 耗时基线 < 200ms
- 万级节点长列表滚动帧率 ≥ 55fps
- 并发请求池上限 + 超时兜底

## 2. 内存
- store 泄漏检测：$dispose 后引用归零
- 图片 / 缓存 LRU 上限
- 小程序页面栈深度监控（> 10 告警）

## 3. 稳定性
- 连续 1h 操作无崩溃
- 弱网（3G throttling）下降级路径
- OOM 前主动释放非关键资源

## 4. 性能预算 (performance budget)
- 首屏 JS < 200KB gzipped
- 单 store 持久化 < 50KB
- 启动到 interactive < 1s

## 5. 验证
- vitest bench 跑基准
- Chrome devtools memory snapshot 对比
- CI 跑 performance budget 门禁
