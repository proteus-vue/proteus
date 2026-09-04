# G-48 架构设计：标准运行时 + Platform Adapter

## 1. 三层架构总览

```
┌──────────────────────────────────────────────────────┐
│         任意标准小程序（微信语法，存量数百万）          │
│   AppService.js + Pages + .wxml/.wxss + app.json      │
└──────────────────────┬───────────────────────────────┘
                       │ ① 标准小程序运行时（寄宿于 G-39 HostRuntime）
                       ▼
┌──────────────────────────────────────────────────────┐
│       StandardMiniProgramRuntime（标准运行时内核）      │
│  ┌──────────────────────────────────────────────┐    │
│  │ · AppService（逻辑层，JS Engine）             │    │
│  │ · PageFrame（视图层，WebView/渲染后端）        │    │
│  │ · setData 通信通道（逻辑↔视图，序列化）        │    │
│  │ · 生命周期调度（onLaunch/onShow/onHide）       │    │
│  │ · 代码包加载 / 分包（G-45 DynamicModule）      │    │
│  │ · 安全沙箱（AppID 级 L1 逻辑隔离）              │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────┘
                       │ ② Platform Adapter SPI（G-28 NativeBackend 特化）
                       ▼
┌──────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┬──────────────┐  │
│  │ WeChat   │ Alipay   │ Douyin   │  HarmonyOS   │  │
│  │ Adapter  │ Adapter  │ Adapter  │   Adapter    │  │
│  └──────────┴──────────┴──────────┴──────────────┘  │
│   抹平平台差异：login/pay/share + 原生 UI 组件         │
│   通过 G-46 ResourcePool 共享登录态 / 凭证             │
└──────────────────────────────────────────────────────┘
```

**关键**：标准运行时**只认标准接口**，不认识任何具体平台。平台差异**全部封装在 Adapter 里**——这就是"不绑定运行时形态"的落地。

---

## 2. 两个 SPI 的分工

| SPI | 接口定义 | 后端实现 | 来源 |
|-----|---------|---------|------|
| **Runtime SPI**（内核） | `AppService` / `PageFrame` / `setData` / 生命周期 / 代码包 | 各宿主提供**运行时实现**（WebView / ArkUI / Flutter） | **G-48 新增** |
| **PlatformAdapter SPI**（能力） | `login` / `pay` / `share` / `getLocation` ... | 微信 / 支付宝 / 抖音 / 鸿蒙 | **G-28 NativeBackend 特化** |

**分工原则**：

- **Runtime SPI**：解决"**小程序怎么跑**"（结构 / 生命周期 / 通信）
- **PlatformAdapter SPI**：解决"**小程序怎么调原生能力**"（API / 组件）

**两者正交，组合测试（G-47 接缝测试）。**

---

## 3. 双线程模型（硬约束）

微信/支付宝小程序**强制双线程**：逻辑层（AppService）不可操作 DOM，通过 `setData` 与视图层（WebView）通信。

```
┌────────────────────┐         setData (序列化)        ┌────────────────────┐
│   AppService       │  ──────────────────────────▶   │   PageFrame(s)     │
│  (逻辑层 / JS)     │  ◀──────────────────────────   │  (视图层 / Web)    │
│  · 业务逻辑        │        事件回调 (序列化)         │  · WXML 渲染       │
│  · 不可操作 DOM    │                                │  · 可触发事件      │
└────────────────────┘                                └────────────────────┘
        │                                                    │
        └────────── 通过 PlatformAdapter 调原生能力 ◀────────┘
```

**MVP 实现策略**（已确认）：单进程**模拟**双线程——逻辑层与视图层在**同一进程但严格隔离**（独立的 JS 上下文 + 消息队列），**语义与真双线程一致**，性能隔离后置 G-49。**关键：架构语义必须正确，即使运行在同一线程。**

---

## 4. setData 通信通道

```typescript
interface SetDataChannel {
  // 逻辑层 → 视图层：数据更新（diff + 序列化；签名以 reference-impl.cjs / 04 §4.1 为准）
  setData(pageId: string, change: DataChange): void;  // DataChange 定义见 04-standard-runtime.md §4.1
  // 视图层 → 逻辑层：事件回调
  postEvent(pageId: string, eventName: string, payload: unknown): void;
}
```

**约束**：

- **唯一通信通道**——逻辑层不得绕过 setData 直接操作视图（conformance 校验）
- **数据必须可序列化**（JSON-safe）——不可传递函数 / 循环引用（conformance 校验）
- **跨线程语义**：即使 MVP 单进程模拟，也须通过消息队列（不能直接引用）

---

## 5. 代码包加载（复用 G-45）

小程序代码包 = **DynamicBackendModule**（G-45）：

```
下载 → 校验（签名 + manifest 哈希，G-45.7/8）→ 装载 → 依赖解析 → pending 回放
```

- **主包 / 分包**：按需下载，装载即验证（conformance 快检）
- **装载失败**：降级后端兜底（降级不崩溃，原则 #4）
- **版本管理**：ABI 冻结（G-45 三态生命周期），运行时只加载兼容版本

---

## 6. 与 G-46 凭证共享的集成（★ 超级应用闭环）

```
宿主 App 登录 → G-46 ResourcePool (L1 登录态, sid/appToken)
                    │
                    ▼ (按 AppID 派生，隔离)
小程序运行时 ──→ 小程序专属凭证 (appId + userId → scopedToken)
                    │
                    ▼
Platform Adapter ──→ 平台 API 调用 (微信 wx.login 用 scopedToken)
```

**关键**：小程序**不持有原始登录态**（HttpOnly 隔离，RSC-01），只拿到**按 AppID 派生的受限凭证**——既实现"宿主登录后小程序免登"，又保证**凭证隔离不泄漏**。

详见 `07-sandbox-isolation.md`。

---

## 7. 接缝测试（G-47 组合一致）

| 不变量 | 验证场景 |
|--------|---------|
| INV-01 | 切 Platform Adapter（微信→鸿蒙），小程序业务逻辑零修改 |
| INV-02 | 切 Runtime 实现（WebView→ArkUI），setData 语义不变 |
| INV-03 | 宿主登出（G-46）→ 所有小程序凭证级联失效 |
| INV-04 | 小程序销毁（G-43 Drop 级联）→ 资源（定时器/监听）级联释放 |
| INV-05 | 同小程序代码，多 Adapter 下行为一致 |
| INV-06 | 缺 Adapter 能力时，降级不崩溃 |

---

## 8. 文件清单（G-48 交付物）

| 文件 | 内容 |
|------|------|
| `01-problem.md` | ★ 痛点 + 竞品横向 + 路线安排（G-48/49/50） |
| `02-architecture.md` | ★ 三层架构 + 双线程 + setData + 与既有体系集成 |
| `03-spi.md` | ★ Runtime SPI + PlatformAdapter SPI |
| `04-standard-runtime.md` | ★ 标准运行时内核（AppService/PageFrame/生命周期/代码包） |
| `05-adapter-pattern.md` | ★ Platform Adapter 规范 + **兼容矩阵** |
| `06-capability-bridge.md` | 能力桥接（Capability IR：login/pay/share...） |
| `07-sandbox-isolation.md` | **L1 基线**：AppID 级逻辑隔离（凭证派生 + 存储分桶 + 销毁级联） |
| `08-security.md` | 第三方小程序信任模型 + 攻击树 |
| `conformance.md` | CMP + 标准符合性 + 兼容矩阵验证 |
| `reference-impl.cjs` | ★ 可运行参考实现（标准运行时 + 多 Adapter + setData + 沙箱） |
| `verify.sh` | 自包含验证 |
| `rules.md` | G-48.1-8 + CMP（含 90% 兼容铁律） |
| `architecture-update.md` | 原则 #13.37-40 + G-48/49/50 分工 |
| `MANIFEST` / `pack.sh` / `README` | 清单 + 安全打包（`CHECKSUM` 不存在于目录：由 `pack.sh` 生成，完整性断言可选） |
