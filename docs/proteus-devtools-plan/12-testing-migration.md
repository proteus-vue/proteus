# 测试与迁移

## 测试策略（对齐 Testing plan 四层金字塔）

### L1 单元（70%）
- TraceBus：emit/订阅/缓冲/采样/脱敏（vitest）
- Span 构建：start/end 配对、孤儿处理
- 快照序列化：Date/Map/Set/BigInt/循环引用
- 插件 Registry：注册/激活/循环依赖检测

### L2 组件（20%）
- 时间轴泳道渲染（虚拟滚动 + canvas 降级）
- 火焰图格子交互 + 源码定位
- 根因链路树构建

### L3 编译快照（5%）
- 面板构建产物结构快照
- 源码定位 source map fixture

### L4 集成（5%）
- 六源接入 → 面板完整链路（mock 层对象）
- 快照导入导出往返
- traceId 跨源传播

## Fixture

```ts
// testing/fixtures/trace-events.ts
export const sampleSpans = [/* 10000 spans，覆盖六源 */]
export const errorChain = [/* api.error → store → guard → lifecycle */]
```

## 迁移（存量接入）

### 阶段 1：只装 Runtime
```ts
// 任何入口加两行
import { createDevTools } from '@proteus-vue/devtools-runtime'
createDevTools({ enabled: true })
```
无侵入，仅开启采集，面板可后续接。

### 阶段 2：接面板
```ts
import { connectPanel } from '@proteus-vue/devtools-panel'
connectPanel()
```

### 阶段 3：逐源开启
```ts
createDevTools({
  sources: ['store', 'api'],  // 先开这两个，验证后再全开
})
```

### 阶段 4：生产灰度
`enabled: false` 默认，按用户/版本灰度开启。

## 验收

- L1 覆盖率 ≥ 85%，L4 覆盖所有跨源场景
- 存量项目迁移 ≤ 10 行改动（铁律：框架层零业务改动）
- 性能预算 CI 全绿
