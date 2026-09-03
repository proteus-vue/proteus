# @proteus-vue/dev-host

> **G-45 B2（proteus-dev-host-plan）**：调试基座即宿主（Install-Once Host）——打破 uni-app 式「自定义基座循环」（改原生插件 → 云打包基座 → 重装 → 循环往复）。

## 一句话

**基座是常驻宿主，不是构建产物——装一次，换插件，永不重打（渲染与原生能力走可插拔后端，不是 WebView 套壳）。**

## 能力

- **DevHost**：动态后端模块装载门禁链——manifest 完整性 → 签名（G45_SIGN）→ conformance 覆盖率（每能力 ≥1 例）→ conformance 快检（shape 契约）→ 注册 → pending 回放；任一 FAIL 拒绝装载 + 降级兜底
- **ForwardingStub**：转发桩——后端就绪直调 / 未装载进 pending（禁止同步抛异常，G-45.2）/ 装载成功按 seq 序回放 / 失败转降级
- **BuildCache + planBuild**：双层构建计划器——基座 cacheKey = f(框架版本, ABI) 与页面数/插件数无关（CMP086），构建 O(改动) 非 O(规模)
- **全链可观测**：loaded/upgraded/rejected/fallback/pending/replay 事件（G-45.5，TraceBus 同源）

## 用法

```ts
import { createDevHost, checkResultShape } from '@proteus-vue/dev-host'

const host = createDevHost()
host.registerFallback('scanQR', async () => ({ text: null, degraded: true }))

// 业务侧（编译器生成的转发桩形态）——后端未推送时调用进 pending
const stub = host.createStub('scanQR', 'scanQR')
const p = stub.call({ format: 'qr' })

// dev server push 插件模块 → 装载即验证 → pending 自动回放
const report = await host.loadModule({
  manifest: { id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-demo' },
  conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
  factory: () => ({ scanQR: async () => ({ text: 'CODE-123' }) }),
})
console.log(report.ok, report.replayed) // true 1
console.log(await p) // { text: 'CODE-123' }
```

完整方法论见 `docs/proteus-dev-host-plan/`（B1 参考实现 + 铁律 + NAT-C 套件）。
