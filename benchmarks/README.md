# 功能基准（Benchmarks）

性能回归门禁（performance-plan G-30 工具链落地）——`npm run bench`（CI 已接入，>1.5x 基线阻断）。

## 用法

```bash
npm run bench            # 跑 + 对比基线（回归 >1.5x → exit 1；>1.2x → warn）
npm run bench:update     # 跑 + 写回基线（功能显著变化 / 新基准项时执行）
npx tsx scripts/benchmark.ts --json   # JSON 输出（CI 友好）
```

## 基准项

| 项 | 场景 | 说明 |
|----|------|------|
| `compile-vue-sfc` | 单 SFC 编译 | template→wxml + script→逻辑层 + style→wxss（30 轮中位数） |
| `setdata-deep-diff-1000` | 1000 项列表全量变更 | setDataBridge 深层 diff → 叶路径补丁（★当前 ~330ms，潜在优化点） |
| `hmr-apply-batch-1000` | 1000 payload 批量应用 | HMR Runtime applyBatch（同文件合并，G-34 §6 预算 <100ms 达标） |
| `style-gate-collect-100` | 100 条样式 × 五端映射 | Style Safety 可视化闸门链（G-34 M2） |
| `trace-redact-1000` | 1000 键对象脱敏 | TraceBus redactValue |

## 门禁语义

- 功能级回归防护：防 O(n²) 引入等**明显劣化**（>1.5x 阻断）
- 非真机指标：启动/帧率/内存等真机矩阵见 `docs/proteus-performance-plan/07-benchmark-baseline.md`（待原生/真机环境）
- 基线存 `benchmarks/baseline.json`（提交入库）；中位数抗 CI 环境抖动

## 踩坑

- `@proteus-vue/runtime` 模块初始化需要浏览器全局（shared web-adapter + vue runtime-dom）→ 脚本内用 happy-dom `Window` 提供（与测试环境一致），且必须**先设全局再动态 import** runtime
