# 转场事务（Transition Transaction）

> 类比：`PageTeardownTransaction`（内存方案 §3）—— 销毁有事务，转场也应有事务。

## 1. 为什么需要转场事务

转场是**跨越多帧、涉及两个页面、必须原子化**的操作：

- 入场页 mount + 出场页 unmount
- 导航栏动画 + 安全区插值
- 玻璃效果转场（`UIGlassEffect` 随导航栏移动）

如果让开发者手动组合，极易出现：**转场中断导致页面栈不一致、内存泄漏、玻璃效果错位**。

## 2. 事务模型

```typescript
interface TransitionTransaction {
  id: string
  from: RouteRecord        // 出场页
  to: RouteRecord          // 入场页
  type: TransitionType     // slide/fade/flip/none
  gesture: boolean         // 是否手势驱动
  safeArea: SafeAreaConfig // 安全区插值
  glass: GlassConfig       // 玻璃转场
  duration: number
  // 生命周期
  onStart(): void
  onProgress(progress: number): void  // 0→1
  onComplete(): void
  onCancel(): void  // 手势中断回滚
}
```

## 3. 手势驱动转场

| 平台 | 手势源 | 进度同步 |
|------|--------|---------|
| iOS | `UIPercentDrivenInteractiveTransition` + `interactivePopGestureRecognizer` | 系统驱动，`onProgress` 回调 |
| Android | `SwipeBackLayout`（自定义 `ViewDragHelper`） | touch 事件 → JSI → progress |
| 鸿蒙 | `NavPathStack` 侧滑返回 | 系统驱动 |

**手势中断（cancel）**：框架自动回滚栈状态 + 反向动画 —— 开发者不写一行代码。

## 4. 与 Safe Area / Glass 协同（集成点）

转场过程中样式/布局通过 **Custom Renderer 的 patchStyle / patchProp** 驱动插值：

```
progress: 0 → 1
  ├─ patchStyle(el, { paddingTop: safeArea.top })  // 安全区插值
  ├─ patchProp(glassEl, 'blur', 0 → 20)            // 玻璃模糊度
  └─ iOS additionalSafeAreaInsets: 动画过渡
```

> 这些 `patchStyle` / `patchProp` 调用**走 Style Safety G-16 的 Validator**（联动 `06-integration.md`），确保转场中设置的 `paddingTop` / `blur` 值合法 —— 转场动画不会因非法值 crash。

**灵动岛融合**：`<pg-glass>` 的 `containerRelativeAnchor` 在转场中保持相对容器 —— 玻璃与灵动岛持续融合（G-09）。

## 5. 事务调度

- 转场期间**锁定路由栈**（禁止新的 push/pop，ROUTE005 队列化）
- 转场完成后释放 + 执行队列
- 异常时自动 cancel + 回滚到一致状态

## 6. 性能预算

| 指标 | 预算 |
|------|------|
| 转场帧率 | ≥ 120fps（ProMotion） |
| 转场主线程耗时 | < 16ms |
| 转场内存增量 | < 5MB |
| 手势响应延迟 | < 8ms |
