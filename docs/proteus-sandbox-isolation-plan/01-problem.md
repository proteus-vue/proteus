# G-49 小程序运行时进程级沙箱隔离

> 原则 #0 第 13 次泛化：**不绑定隔离强度**
> 状态：Draft v1 · 依赖 G-27 / G-39 / G-42 / G-43 / G-45 / G-46 / G-47 / G-48
> 前置：G-48（兼容式小程序运行容器，AppID 级逻辑隔离）
> 后继：G-50（小程序开发者平台，**需要 G-49 L3 落地后才具备资格**）

---

## 0. TL;DR

**G-48 把"标准小程序"跑起来了，但隔离是 AppID 级的逻辑隔离（同一进程内、同一 JS 引擎上下文）。G-49 回答一个问题：当一个小程序是恶意的，宿主和其他小程序如何不受影响？**

答案不是"加个 V8 Isolate"（那是 L4，服务端思路），而是**分层递进的隔离强度**：

| 层级 | 隔离强度 | 技术 | 平台 | G-49 是否落地 |
|------|---------|------|------|:---:|
| **L1** | 逻辑隔离 | 独立 WebView 实例 + JS Context 隔离 | 全平台 | ✅ |
| **L2** | 存储/权限隔离 | 数据目录后缀 + CapabilityBridge 权限网关 | Android / iOS | ✅ |
| **L3** | 进程隔离 | `android:process` / 独立 Ability | Android / 鸿蒙 | ✅ |
| **L4** | 运行时隔离 | V8 Isolate / microVM / seccomp | 服务端 | ❌ → G-50 |

**G-49 = L1 + L2 + L3。L4 明确留给 G-50。**

---

## 1. 问题：G-48 的隔离够不够？

G-48 §07 的沙箱是 **L1 逻辑隔离（凭证/存储级）**：每个小程序有自己的 `appId` 命名空间、自己的 Cookie/Token、自己的缓存目录。**这在"受控第三方"（G-48 信任级别 L2）下够用。**

但一旦要走到 G-50（开放平台，任意开发者上传代码），威胁模型变了：

| 维度 | G-48（受控） | G-50（开放） |
|------|-------------|-------------|
| 小程序来源 | 自有 + 审核合作方 | 任意第三方 |
| 信任假设 | 代码基本可信 | **代码可能恶意** |
| 单小程序崩溃 | 可重启 | **不能拖垮宿主** |
| 跨小程序读数据 | 靠规范约束 | **靠机制强制** |
| 逃逸到原生层 | 罕见 | **核心攻击面 |

**反模式（业界真实踩坑，9/10 审计会出问题）**：
> 把小程序 JS 塞进 `WKWebView`/`WebView`，通过 `addJavascriptInterface` 暴露全部原生 API——然后管这叫"沙箱"。**这不是沙箱**：小程序内任意 XSS 都能拿到 bridge 对象，进而调用任意原生能力。

G-49 要解决的就是**把"规范约束"升级为"机制强制"**。

---

## 2. 分层架构

```
┌──────────────────────────────────────────────────────┐
│                  宿主 App（主进程）                    │
│  G-46 资源池 · G-39 HostRuntime · G-48 Runtime       │
└────────┬─────────────────────────────────────────────┘
         │ CapabilityBridge（声明式权限清单，非 open bridge）
         ▼
┌──────────────────────────────────────────────────────┐
│              Sandbox Manager（G-49 新增）              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ MiniPg A │  │ MiniPg B │  │ MiniPg C │  ...      │
│  │ Process  │  │ Process  │  │ (L1 同进程│           │
│  │ (L3)     │  │ (L3)     │  │  Context) │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  独立 WebView  独立 WebView  独立 JS Context          │
│  独立数据目录   独立数据目录  共享目录（受控）          │
│  独立内存配额   独立内存配额  ─                     │
└──────────────────────────────────────────────────────┘
```

### L1：逻辑隔离（全平台通用，G-48 已有 → 本份规范化）

- 每个小程序独立 `WebView` / `PageFrame` 实例
- 独立 JS Context（微信 AppBrand 的 `allocJsContext` / `destroyJsContext` 思路）
- **不共享闭包、不共享全局对象**
- 通过 `setData` 序列化通道通信（**无共享内存**）

### L2：存储与权限隔离（★ G-49 核心增量）

**存储**：每个小程序独立数据目录，路径含 `appId` 后缀
```
Android: WebView.setDataDirectorySuffix("mp_" + appId)
iOS:     WKWebsiteDataStore 按 appId 分桶
鸿蒙:    Context.getFilesDir(appId)
```

**权限**：声明式 CapabilityBridge（替代 `addJavascriptInterface`）
```json
// mini-program.manifest.json
{
  "permissions": ["storage.read", "network.fetch", "location.get"],
  "capabilities": {
    "payment": { "provider": "wechat", "merchantId": "..." }
  }
}
```
每次 API 调用经网关校验 `manifest.hasPermission(cap)`，**无权限 → PERMISSION_DENIED，并记录审计日志**。

### L3：进程隔离（★ G-49 核心增量，平台差异最大）

| 平台 | 机制 | 关键约束 |
|------|------|---------|
| **Android** | `android:process=":mp_${appId}"` | 每个小程序独立进程、独立堆；崩溃不拖垮宿主 |
| **iOS** | `WKProcessPool` **必须单例** + 独立 `WKWebView` | iOS 不支持应用内多进程，靠 WebContent 进程隔离（系统级） |
| **鸿蒙** | 独立 UIAbility / ServiceExtensionAbility | "一个进程一个 VM"，`EcmaVM` 独立堆 |

**诚实边界（★ 关键）**：
> **iOS 无法在应用内做"每小程序一个进程"**（系统限制）。iOS 的隔离靠 `WKWebView` 的 WebContent 进程（系统级，跨 WebView 隔离）+ 权限网关。**G-49 承诺"三平台达到各平台最高可行隔离级别"，不承诺"三平台机制完全一致"。**

这是 CMP-117 要验证的核心：各平台**隔离语义等价**（一个崩溃不影响其他），**实现机制允许不同**。

---

## 3. 与既有体系的关系（互校，无冲突）

| 依赖项 | G-49 复用 / 新增 |
|--------|----------------|
| G-42 容器 + 安全网关 | **复用**：能力调用过网关，此处升级为 CapabilityBridge（崩溃隔离/配额语义承接 G-42 host-container，以引用不重述） |
| G-43 所有权 | **复用**：`AppHandle` 唯一强引用，退出即销毁（Drop 级联，五阶段已落地） |
| G-45 动态装载 | 复用签名校验（小程序包须签名 + manifest 哈希） |
| G-46 资源池 | **扩展**：Cookie/Token **按 appId 隔离**（复用 origin 命名空间） |
| G-47 组合一致 | 新增：切换小程序 / 崩溃重启 → 宿主状态不丢 |
| G-48 Runtime | **扩展**：PageFrame 升级为 IsolatedPageFrame（含进程归属） |

> **崩溃隔离 / 配额 / Drop 级联语义承接**：G-42（host-container）与 G-43（ownership）——本包以引用不重述（详见 architecture-update.md §3）。

---

## 4. 不承诺什么（诚实边界，CMP 级）

1. **不承诺"任意第三方代码安全运行"**——那是 L4（V8 Isolate/microVM），**留给 G-50**
2. **不承诺 iOS 与 Android 机制一致**——只承诺隔离语义等价
3. **不承诺防内核态攻击**（root/越狱环境不在威胁模型内）
4. **权限清单是"允许列表"**——未声明即拒绝（deny-by-default）
5. **进程隔离有启动成本**（Android 新进程 ~100-200ms）——提供"预热池"策略，conformance 验证冷启动预算

---

## 5. 参考实现覆盖（reference-impl.cjs）

模拟 L1/L2/L3 三层，重点验证：
- 跨小程序**无法读取**对方存储（L2）
- 未声明权限的 API 调用被**拒绝**（CapabilityBridge）
- 一个小程序**崩溃**（模拟 throw）→ 其他小程序与宿主**不受影响**（L3，单进程模拟）
- `appId` 派生路径**无碰撞**（规范化校验）
- 进程归属查询 / 资源配额（CPU/内存/网络）**超限拒绝**

详见 `conformance.md` 与 `reference-impl.cjs`。
