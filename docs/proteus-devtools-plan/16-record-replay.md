# M14 — 操作录屏回放（已排期）

> 定位：把用户操作 + 应用状态变化**录制为可回放的会话**（SessionBundle），支持：
> ① **本地回放**——回放引擎按时间轴重放操作与状态（tap/输入/路由/状态恢复，可步进/倍速）；
> ② **中台/数据后台上行**——会话导出为标准 JSON/NDJSON，经注入钩子上行开发者自有中台（问题复现、用户行为分析、回归验证）。
> 状态：**已排期**（主线 M10/M11 之后启用；复用基础设施已就绪，见 §2 复用关系）。

## 1. 目标与验收

| 目标 | 验收 |
|------|------|
| 录制用户操作会话 | 录制 30s 操作（tap/输入/路由/API/状态变更）→ SessionBundle 完整可序列化 |
| 回放还原 | 回放结束后应用状态与录制末端一致（store 逐字段断言）；合成 tap 触发真实响应式更新 |
| 中台上行 | upload 钩子收到完整 SessionBundle（schema 校验通过）；token/password 字段不出现在 bundle（脱敏） |
| 面板可视化 | 回放视图：时间轴 scrubber + 事件列表 + 操作时刻状态快照 + 倍速/步进 |

## 2. 复用关系（基础已就绪，工程量主要在捕获/回放/上行）

| 现有能力 | 复用点 |
|---------|--------|
| **TraceBus**（devtools-runtime） | 会话事件主体——router/api/store/lifecycle/capability/hmr 事件**已经在流里**（含 timestamp/traceId/脱敏） |
| **storePatchHistory + restoreAt**（panel.ts） | 回放**状态恢复**——时间旅行已有「快照 → $patch 写回」链路，回放末端恢复即复用 |
| **时间旅行滑块语义**（#261-#265） | 回放 scrubber 复用 change 语义 + 回声去重门控 |
| **火焰图录制控制**（flame.start/stop） | 录制器 start/stop 模式同构（清空 + 基线） |
| **15-open-api 协议**（relay/ws-source/ws-bridge） | 新增 `Proteus.record/Proteus.replay/Proteus.session` 命令——**中台侧可实现协议客户端直接拉会话** |
| **redactValue / 采样 / 零开销门控** | 会话脱敏、超长会话降采样、生产零开销 |
| **M9 插件系统** | 回放面板可作插件视图（addView），不污染核心 |

## 3. 会话模型 SessionBundle（中台上行契约）

```ts
interface SessionBundle {
  kind: 'proteus-session'          // 判别字段（对齐 store-snapshot 的 kind 惯例）
  version: 1
  meta: {
    appId: string                   // 开发者标识自己的应用
    platform: string                // web / mp-weixin / app-*
    startedAt: number               // 录制起点（performance.now 语义）
    durationMs: number
    recorderVersion: string
  }
  ops: Array<{                      // ★新增 op source：结构化用户操作
    id: number
    type: 'tap' | 'input' | 'scroll' | 'route' | 'api' | 'store' | 'lifecycle'
    ts: number                      // 相对录制起点
    target?: string                 // 元素 handle（铁律 3：DOM → handle，可序列化）
    detail?: Record<string, unknown> // 输入值/滚动位置/路由目标/请求摘要……
    traceId?: string                // 跨源串联
  }>
  stateDeltas: Array<{              // 状态变更（对齐 storePatchHistory 形态）
    ts: number
    storeId: string
    state: Record<string, unknown>  // 变更后完整快照（回放恢复用）
  }>
}
```

- **纯 JSON**（铁律 3 可序列化）；体积控制：ops 环形缓冲上限（缺省 20000）+ 采样复用
- 不截屏（体积/隐私）——结构化交互已足够复现；可选扩展：弱引用 DOM 快照（`{ __handle: 'node', id }`）
- 中台消费：任意 JSON 后端直接落库；NDJSON 流式变体供大数据管线

## 4. 操作捕获（新增 op source）

- **捕获层**：document capture 阶段监听 `tap`（click/pointerup 归一）/ `input` / `scroll`（节流）→ 元素 handle 化（`buildDomTree` 已有的 handle 思路）→ `bus.emit('op', 'point', ...)`
- **handle 注册表**：元素 → id 映射（弱引用，防泄漏；`component-trace` 的 registry 模式同构）
- **与既有事件合并**：route（router.nav）/ api（request）/ store（patch）已是独立 source——回放时**统一时间轴**（ops 与既有事件按 ts 归并）
- **隐私**：input 值默认脱敏（`password` 等键 + `input[type=password]` 直判）；可配置 `recordInputs: false`

## 5. 回放引擎 SessionPlayer

- **虚拟时钟**：录制用 `performance.now` 偏移重放（与 timeline/flamegraph 同语义）——`now() = startTs + elapsed * rate`
- **状态恢复**：末端 `$patch`（复用 restoreAt）；步进回放逐 stateDelta 应用（对齐时间旅行滑块语义）
- **DOM 事件重放**：handle → 元素查找 → `dispatchEvent(new MouseEvent('tap'...))`——合成事件触发真实响应式更新（Web 端；MP 端触发 `triggerEvent`）
- **路由重放**：`router.push` 按 nav 记录序列
- **控制**：play/pause/step/rate（0.5×-4×）/scrubber（change 语义，复用 #264 坑位）
- **范围**：只重放业务可见交互（op/router/api/store/lifecycle），**不模拟渲染管线**（明确边界）

## 6. 中台上行（接入自有数据后台）

```ts
// 录制器选项注入（结构类型零硬依赖；缺省仅本地面板 + 下载）
sessionRecorder({
  upload: async (bundle) => {
    await fetch('https://my-ops.example.com/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    })
  },
  maxOps: 20000,
  recordInputs: true,      // 隐私：可关
  appId: 'my-app',
})
```

- 导出：`session.toJSON()` → Blob 下载（对齐 snapshot export）；`toNDJSON()` 流式变体
- **协议扩展**（15-open-api 表新增）：`Proteus.record`（面板命令开始/停止录制）/ `Proteus.session`（拉取当前会话）——中台侧按开放协议实现客户端即可

## 7. 面板可视化（回放视图 / 插件）

- 时间轴 scrubber + ops 事件列表（tap/input 图标区分）+ 操作时刻状态快照（复用 state inspector 渲染）
- 录制中实时预览（op 事件进 timeline 新增 `op` 泳道）；回放时隐藏实时面板避免回声
- 建议插件形态（M9 addView）交付，核心零侵入

## 8. 里程碑拆分（排期时启用）

| 批 | 内容 | 验收 |
|----|------|------|
| R1 | op source 捕获 + SessionRecorder + SessionBundle 序列化 | 30s 操作 → bundle JSON 完整；脱敏字段不出现；缓冲上限生效 |
| R2 | SessionPlayer 回放引擎（虚拟时钟 + $patch 恢复 + 合成事件） | 回放后 store 与录制末端一致；tap 重放触发真实更新；倍速/步进 |
| R3 | 导出/上行（toJSON/toNDJSON + upload 钩子）+ 协议命令 | upload 收到 schema 合法 bundle；Proteus.session 协议客户端可拉取 |
| R4 | 回放面板（插件视图：scrubber + 事件列表 + 状态快照 + op 泳道） | 面板回放 30s 会话流畅；播放中无回声污染 |

## 9. 边界与约束（沿用铁律）

- 铁律 1：回放引擎不直接碰运行时——状态恢复走 `$patch`（对齐时间旅行）、事件重放走合成 DOM 事件
- 铁律 3：元素引用必须 handle 化（可序列化）；DOM 快照可选且弱引用
- 生产零开销：recorder 复用 TraceBus enabled 门控；未开启零捕获
- 隐私：input 脱敏 + `recordInputs` 开关；不截屏
- 体积：ops 环形缓冲 + 采样；超长会话降采样（对齐 trace 采样）
