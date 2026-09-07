# 02 Native Binding 规范（JSI）

## 1. Host Object 接口（三端统一）

```cpp
// ProteusHostObject.h（C++，iOS/Android 共享）
class ProteusHostObject : public jsi::HostObject {
public:
  // 视图生命周期
  jsi::Value createView(jsi::Runtime&, const jsi::Value* args, size_t count);
  jsi::Value updateProp(jsi::Runtime&, const jsi::Value* args, size_t count);
  jsi::Value appendChild(jsi::Runtime&, const jsi::Value* args, size_t count);
  jsi::Value removeView(jsi::Runtime&, const jsi::Value* args, size_t count);
  jsi::Value measure(jsi::Runtime&, const jsi::Value* args, size_t count);

  // 能力调用（Glass 等横切能力走这里）
  jsi::Value invokeCapability(jsi::Runtime&, const jsi::Value* args, size_t count);
};
```

## 2. JS 侧入口

```ts
// @proteus-vue/app-renderer
export interface NativeBridge {
  createView(type: string): number        // 返回 viewId
  updateProp(viewId: number, key: string, value: unknown): void
  appendChild(parentId: number, childId: number): void
  removeView(viewId: number): void
  measure(viewId: number): { width: number; height: number }
  invokeCapability(name: string, params: unknown): unknown
}
```

## 3. 同步 vs 异步边界

| 操作 | 方式 | 理由 |
|------|------|------|
| createView / updateProp | **同步** | diff 阶段需立即拿到 viewId |
| appendChild / removeView | **同步** | 树结构必须一致 |
| measure / layout | **同步** | 布局依赖 |
| 网络 / 文件 IO | **异步** | 耗时操作不让步 UI |

**铁律 A-02**：视图操作必须同步；IO 必须异步。

## 4. 线程安全

- JSI 调用默认在 **JS 线程**执行
- 所有 Native View 操作**自动派发到 UI 线程**（通过 `runOnUI`）
- Worklet 中可直接调用（已在 UI 线程）

```ts
// 隐式派发（推荐）
native.createView('view')

// 显式 UI 线程（Worklet/手势）
runOnUI(() => {
  native.updateProp(viewId, 'opacity', 0.5)
})
```

## 5. 类型映射

Native 方法签名 → 自动生成 `.d.ts`（详见 08）：

```ts
// 自动生成（禁止手写）
declare class UIGlassEffect {
  static regular(): UIGlassEffect
  setCornerRadius(radius: number): void
}
```

## 6. 降级：旧端 Bridge 兜底

JSI 不可用时（极低版本），自动降级为 **JSON Bridge**（对齐 React Native 旧架构）：

```ts
const bridge = jsiAvailable() ? new JSIBridge() : new JSONBridge()
// 同一接口，内部实现不同
```

详见 `11-degradation-bridge.md`。
