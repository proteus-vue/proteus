# 原生桥（JS ↔ Native Bridge）

> 配套：`01-host-runtime.md` §6
> 唯一拥有者：L4 Host Runtime（CMP035、CMP037）

---

## 1. 为什么必须统一

没有统一桥时，每个 Backend 自己写 JSBridge → 重复实现、序列化不一致、线程混乱、安全漏洞。

**Runtime 统一桥之后**：Backend 只调 `runtime.invokeNative(name, args)`，不感知底层通信机制。

---

## 2. 双向通信

```
JS 侧                    Host Runtime (L4)              Native 侧
  │                            │                            │
  │── invokeNative('scan') ──▶│── 序列化 + 线程切换 ──────▶│
  │                            │                            │
  │                            │◀── Result ────────────────│
  │◀── Promise<Result> ───────│                            │
  │                            │                            │
  │ registerNativeHandler      │                            │
  │  ('onPush', cb)           │─── 保存回调 ───────────────│
  │                            │                            │
  │                            │◀── Native 触发 ───────────│
  │  cb(payload)               │── 切 JS 线程 ─────────────▶│
  │                            │                            │
```

### 2.1 JS → Native（invokeNative）

```typescript
interface ProteusHostRuntime {
  invokeNative(name: string, args: any): Promise<any>;
  registerNativeHandler(name: string, handler: (args: any) => any): void;
}
```

- `invokeNative` 返回 `Promise<Result>`（统一异步，即使 Native 是同步）
- `registerNativeHandler` 注册 Native 可调用的 JS 回调（推送/事件）

---

## 3. 序列化协议

```jsonc
// JS → Native
{
  "reqId": "uuid",
  "name": "camera.scanQR",
  "args": { "format": "all" },
  "timeout": 30000
}

// Native → JS (result)
{
  "reqId": "uuid",
  "ok": true,
  "data": { "text": "https://..." },
  "error": null
}
```

- 参数：结构化克隆兼容（JSON + 特定二进制载体）
- 二进制（图片/文件）：`ArrayBuffer`，零拷贝优先

---

## 4. 安全规则（CMP037）

| 规则 | 说明 |
|------|------|
| **白名单** | 仅预注册能力名可调用，未知名 → 抛错 |
| **超时** | 每次调用有 timeout，到期自动 reject + 取消 |
| **线程切换** | Native → JS 回调必须切回 JS 线程，禁止任意线程回调 JS |
| **参数校验** | 参数 schema 校验，防注入 |
| **权限** | 敏感能力（相机/定位/通讯录）需运行时权限，未授权 → `Err('permission.denied')` |

### 4.1 防 prompt injection（对接 G-36）

能力名 + 参数来自框架/AI Agent 时，Runtime 只按白名单分发，**不 eval、不执行字符串代码**（CMP037 延伸）。

---

## 5. 线程切换细节

```
Native 回调线程（任意）
   │
   ▼ Runtime 桥接
主线程消息队列 enqueue
   │
   ▼ 事件循环
JS handler 执行（单线程安全）
```

**禁止**：在 Native 网络线程直接调用 JS（会崩或死锁）。

---

## 6. 宿主映射

| 宿主 | 底层通信机制 | invokeNative 实现 |
|------|------------|------------------|
| iOS | JavaScriptCore | `JSContext[name] = block` |
| Android | J2V8 / WebView | `addJavascriptInterface` / V8 |
| Web | 无需（同 JS） | 直接函数调用（capabilities.nativeBridge=false 时的降级） |
| Flutter | Dart ↔ JS Channel | MethodChannel |
| Harmony | ArkCompiler | Native API |
| Terminal | 进程内函数 | 直接调用（同进程） |

**Web/Terminal 退化**：同进程无跨语言边界，`invokeNative` 直接映射为函数调用——但**接口保持一致**，业务代码不分支。

---

## 7. 错误模型

```typescript
type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; error: {
      code: 'unsupported' | 'permission.denied' | 'timeout' | 'cancelled' | 'unknown';
      message: string;
    }
  };
```

- `unsupported`：当前宿主/Backend 无此能力（如 Terminal 无相机）→ 走降级
- `permission.denied`：未授权 → 引导授权
- `timeout`：超时 → 可重试
- `cancelled`：调用被取消（页面销毁）

详见 `05-conformance-suite.md` C-08（原生桥安全）。
