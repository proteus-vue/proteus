# G-45-E2：核心架构——基座即宿主，插件即动态后端

---

## 1. 分层视角：G-45 在体系中的位置

```
┌─ 业务层                useNative().scanQR()（语义调用，零原生耦合——G-28 铁律）
│
├─ 转发桩层（★ G-45 新增）  编译器生成 ForwardingStub：就绪直调 / 未就绪 pending / 失败降级
│
├─ 基座层（★ G-45 新增）   DevHost：SPI 宿主 + 能力注册表 + 装载门禁链 + 推送通道
│                          ↑ 它是 G-39 HostRuntime 的「调试形态」
│
├─ 动态模块层（★ G-45 新增） DynamicBackendModule：manifest + 签名 + conformance + factory
│
└─ 原生实现层              插件的真实 Swift/Kotlin/ArkTS 代码（G-28 NativeBackend SPI 实现）
```

**基座的职责边界**（对齐 G-41 三方正交）：

| 基座拥有 | 基座禁止 |
|---------|---------|
| 模块装载/卸载/升级协议 | 静态依赖任何具体插件（G-45.1） |
| 能力注册表（capability → module） | 解析 IR / 干预 Diff（G-41.2 同源） |
| 装载门禁（签名 + conformance） | 实现任何业务语义 |
| pending 队列与回放 | 绕过 SPI 暴露原生对象给 JS |
| 降级兜底（degraded impl） | 静默降级（必须发事件，G-45.5） |

---

## 2. 插件模块：DynamicBackendModule 契约

一个原生插件在 G-45 世界里的完整形态：

```
scanner-plugin/
├── proteus.plugin.json        # manifest：id / version / capabilities / signature / minHostVersion / priority
├── src/                       # 原生实现（Android: Kotlin + .so / iOS: Swift framework / 鸿蒙: ArkTS）
├── conformance/               # ★ 语义快检用例（每能力 ≥1 例，CMP087）
│   └── scanQR.tir.json        #   Test IR 形态（G-44），装载时在设备上跑
└── dist/                      # 构建产物：plugin-scanner-1.0.0.bundle（动态库 + manifest + 用例）
```

**装载门禁链**（顺序执行，任一失败拒绝装载，参考实现 C-04/C-05 机器证明）：

```
push → ① manifest 完整性（CMP084）
     → ② 签名校验（CMP084，G-42 安全网关同源）
     → ③ conformance 覆盖率：每能力 ≥1 用例（CMP087）
     → ④ conformance 快检：语义 shape 契约逐例执行（CMP085）
     → ⑤ 注册能力（capability → {id, version, source: 'dynamic'}）
     → ⑥ pending 回放（CMP083 的另一半）
```

---

## 3. 转发桩：让 JS 循环与原生循环彻底解耦

编译器扫描业务的 capability import → 自动生成转发桩（业务无感）：

```ts
// 业务代码（不变，仍是语义调用）
const { text } = await native.scanQR({ format: 'qr' })

// 编译器生成的运行时形态（示意）
const scanQR = host.createStub('scanQR', 'scanQR')
```

转发桩三分支语义（参考实现 C-02/C-04 机器证明）：

| 状态 | 行为 | 事件 |
|------|------|------|
| 后端就绪 | 直调后端 | — |
| 后端未装载 | **进 pending 队列**（禁止同步抛异常，G-45.2），装载成功按 seq 序回放 | `stub:pending` → `stub:replay` |
| 装载失败/无后端 | 转内置降级后端（degraded 结果，降级不崩溃） | `fallback` |

**这解决了「改插件必须重启 JS 上下文」**：插件热升级期间 JS 侧调用要么直调新实现、要么短暂 pending 后回放——页面状态、登录态、导航栈全程无损。

---

## 4. 双层产物：构建时间 O(改动) 而非 O(规模)

```
稳定层（基座）   cacheKey = f(框架版本, ABI)          ← 与页面数/插件数无关
变化层          JS bundle      cacheKey = f(源码哈希)   ← G-38 IncrementalSession 增量
                插件模块       cacheKey = f(插件id, 版本) ← 每插件独立
```

- 基座每框架版本构建一次，团队级远端缓存共享（一次构建全组复用，与业务规模无关）——**150 页项目与 20 页项目的基座构建成本完全相同：0 次**
- 页面增长只影响 JS 层增量（G-29/G-38 已有增量会话设计）
- 参考实现 C-07 机器证明：20→80→150 页 + 插件两轮迭代，base 构建恒为 1 次首建

---

## 5. 三端装载分级 + 发布诚实边界

| Tier | 平台 | 机制 | 开发循环 | 商店发布 |
|------|------|------|---------|---------|
| **A 全热替换** | Android | DexClassLoader 装载插件 DEX + System.load 装载 .so（Shadow/RePlugin 成熟路线）；鸿蒙 HSP 动态共享包 | 秒级 push | Android：Dynamic Feature 按需交付 或 静态链接一次性打包 |
| **B 增量重签** | iOS | 代码签名硬约束（App Store 2.5.2）：稳定层基座缓存 + 插件 target 增量编译 + 模拟先行（conformance + mock 让 JS 循环不等原生） | 秒~分钟级（本地，无云打包排队） | 静态链接（每版本一次） |
| **C 模拟先行** | 全端通用 | 插件未就绪时业务对着 conformance 契约 + mock 后端开发（G-44 Test IR），原生就绪后无缝切换真实现 | JS 循环与原生循环**零等待** | — |

**诚实边界**（与 README「已知限制」同纪律）：

1. iOS 全热替换不可行（平台签名机制决定），G-45 给 iOS 的是「把分钟级云打包变成秒~分钟级本地增量」+ 模拟先行，不是虚假的「iOS 也热替换」
2. 商店发布包**必须**回静态链接——动态通道只服务开发/内部分发（G-45.6 合规铁律：禁止用于规避审核）
3. Android 动态装载需遵守 Play 动态代码政策（内部分发/企业分发不受影响）；Magisk/Root 场景不在支持范围

---

## 6. 与既有决策的互锁

| 既有决策 | G-45 复用点 |
|---------|------------|
| G-39 HostRuntime | DevHost = 其调试形态；bootstrap/事件/线程归属不变 |
| G-28 NativeBackend SPI | 插件 factory 返回物就是 NativeBackend；Top-30 内置后端随基座预装 |
| G-38 getCacheKey/getArtifactHash | 双层构建 cacheKey 的接口来源 |
| G-42 安全网关 | 签名校验同源（G45_SIGN 与 G39_SIGN 同思路） |
| G-44 Test IR | conformance 快检用例 = .tir.json 可序列化断言，跑在统一 runner 上 |
| G-40 批处理/零拷贝 | pending 回放跨界走 commitBatch；大块数据（图片/音频）走 ArrayBuffer |
| G-36 MCP/TraceBus | 装载/降级/回放事件全链入 TraceBus，MCP 工具可查询设备端插件状态 |
