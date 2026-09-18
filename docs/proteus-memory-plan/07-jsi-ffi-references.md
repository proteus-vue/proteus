# JSI/FFI 跨运行时引用策略

> **Proteus App 端 JSI 直调路线的特有风险**——也是 NativeScript 已踩过的坑。
> 调用越快，生命周期越容易被忽略。**本文件是整套内存方案最关键的差异化设计。**

---

## 问题本质

Bridge 序列化模型中数据经 JSON 拷贝，调用完成后**容易切断对象关系**。

**JSI / HostObject / FFI 直接调用则允许 C++/Java/OC 同步持有 JS handle，也允许 JS 长期持有 Native 对象**。跨层对象不再依赖通信消息存活，而**直接依赖彼此引用关系**——把"JS 对象—Native 对象—回调闭包"压进同一条强引用图。

---

## 直接类比：NativeScript 官方模型

### Android：V8 + ART 双托管堆

- JS 对象是 Java 对象的**代理**
- 即使 JS 侧对象已不可达，只要 Java 对象仍持大量 Bitmap/String/Buffer 而 JS 堆无压力，V8 **未必触发 GC** → `OutOfMemoryError`
- 生命周期管理不当的后果是**双向的**：
  - **回收过晚** → 泄漏
  - **回收过早** → `Attempt to use cleared object reference id=...`

### iOS：引用计数 + JSC 保护耦合

- 无 GC，靠引用计数
- `splice` 将原生实例与 JS 实例绑定，可能把 JS 引用**从弱引用改为强引用**
- `Block` / `Delegate` / `KVO` / `WKScriptMessageHandler` / `JSValue` 保护都可能形成**双向存活链**

### 对 Proteus 的责任清单

若 JSI 直接把 `NativeView`/`Activity`/`ViewController`/`Bitmap`/GPU texture **暴露给 JS**，须同时承担：
- JS GC **不会**自动扫描 native 根
- Native RC **也不会**自动扫描 JS 闭包
- **任意一侧的强引用都可能使另一侧继续存活**

---

## 三原则

| 引用方向 | 默认策略 | 必须禁止的模式 |
|---------|---------|--------------|
| **JS → Native** | 短生命周期本地句柄；调用完成后**释放 global ref** | JS 全局 Map 长期持有 Native 对象 |
| **Native → JS** | `WeakRef` / 受保护回调 / owner epoch | Block/Listener 强引用 JS 页面闭包 |
| **双向资源** | owner 明确为 JS 或 Native **一侧** | A 持有 B，B 又通过闭包持有 A |

---

## IDL 所有权标注（编译期护栏）

**禁止任意对象自由跨边界**，IDL 明确标注所有权：

| 标注 | 语义 | 生成代码 |
|------|------|---------|
| `[value]` | 按值拷贝 | JSON / 结构体拷贝 |
| `[borrow]` | 短生命周期借用 | 栈上局部引用，调用结束自动释放 |
| `[owned]` | 转移所有权 | JS 侧持有 → dispose 时释放 native |
| `[callback]` | 生成**弱引用 safe callback** | 包装为 WeakRef，owner 失效自动 no-op |

```idl
// 示例：禁止直接暴露 Activity/View/Canvas 为持久 JS 对象
[nolonger] interface NativeView { ... }   // ← IDL 层面禁止映射

[owned] interface GLBuffer {
  void upload([value] ArrayBuffer data);
  [callback] void onComplete(([borrow] JSValue result) => void);
  void dispose();   // ← 必有
}
```

**代码生成器自动插入**：peer map、引用方向标记、`release` 桩。

---

## 生成代码形态

```ts
// 生成后的 JS 侧包装（示意）
class GLBuffer implements Resource {
  private __peer: number   // native global ref id
  private __ownerEpoch: number

  upload(data: ArrayBuffer) {
    native.call(this.__peer, 'upload', data)  // [value] 拷贝
  }

  dispose() {
    if (this.__peer !== 0) {
      native.releaseGlobalRef(this.__peer)    // ← 显式释放
      this.__peer = 0
    }
  }
}
```

- 绑定生成代码**不得隐式创建 global 引用**
- 跨层对象附加 `owner / createdStack / lastUsed / releaseReason`
- 开发模式下，**GC 后扫描超过阈值的 native-peer** → 疑似泄漏告警

---

## Owner Epoch：拒绝陈旧回调

```ts
// Native 侧持有 epoch
interface NativeHandler {
  ownerEpoch: number
  callback: WeakRef<JSFunction>
}

// 旧组件 View 收到事件 → 拒绝回调已失效版本
onEvent(handler: NativeHandler, payload: any) {
  if (handler.ownerEpoch !== currentEpoch) {
    return   // 陈旧回调，直接丢弃
  }
  handler.callback.deref()?.(payload)
}
```

HMR / 页面重建时 `currentEpoch++`，旧回调自动失效，无需手动清理。

---

## 参考实现（借鉴 NativeScript-Vue）

对照 App Renderer 附录 A（`14-reference-nativescript-vue.md`）：
- NativeScript metadata-generator 在构建期扫描 ObjC/Java 头文件 → 生成绑定元数据 + `.d.ts`
- **Proteus 在其基础上增加**：`[owned]`/`[callback]` 所有权标注 + peer map 自动释放 + owner epoch

→ 即：**借 NS-Vue 的 binding 机制，加 Proteus 的 ownership 护栏**，规避其双堆泄漏风险。

---

## 验收

| 场景 | 断言 |
|------|------|
| 创建 1000 个 NativePeer 后 dispose | GC 后 native global ref 计数 = 0 |
| 页面销毁 | 该页所有 JSI peer 的 `releaseNativePeer` 已调用 |
| HMR 热替换 | 旧 epoch 回调不再执行（无 use-after-free） |
| 内存压力 | non-essential native peer 已 release |

CI 通过 `proteus memory --jsi-peer-leak` 自动检测（详见 `09-diagnostics-ci.md`）。
