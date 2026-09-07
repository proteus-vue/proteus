# 统一导航模式（p-nav 家族）

> 依赖：G-17（Router）/ G-24（语义原语）/ G-25（全终端）
> 目标：**一套导航语义，跨六类终端映射到各端原生导航容器**

---

## 1. 导航的本质

路由（G-17）解决"**去哪**"（路径 → 页面组件）。
导航模式解决"**怎么呈现**"（栈 / 分栏 / 标签 / 抽屉 / 焦点 / 语音）。

**同一份路由配置，不同终端呈现不同形态**——这正是 `p-adaptive` 的导航版。

---

## 2. p-nav 家族

```
p-nav 家族：
  p-nav-stack        → 手机 Push/Pop
  p-nav-master-detail → 平板 SplitView（G-24）
  p-nav-tab          → 手机/车机 TabBar
  p-nav-rail         → 折叠态侧栏（TV/车机竖屏）
  p-nav-drawer       → 平板/车机 Drawer
  p-nav-cursor       → ★ TV/PC 焦点导航（G-25 新增）
  p-nav-voice        → ★ 车机语音导航（G-25 新增）
```

---

## 3. 按终端自动选形态

```vue
<p-nav
  :modes="[
    { mode: 'stack', w: '0-600' },
    { mode: 'master-detail', w: '600-∞' },
    { mode: 'cursor', f: 'remote' },    ← TV 强制焦点导航
    { mode: 'voice', f: 'voice' }       ← 车机语音
  ]"
>
  <router-view />
</p-nav>
```

| 终端 | 默认导航模式 | 原生映射 |
|------|-------------|----------|
| 手机 | stack + tab | `UINavigationController` / `UITabBarController` |
| 平板 | master-detail | `UISplitViewController` |
| PC | stack + drawer | 浏览器历史 / 侧栏 |
| **车机** | tab + voice | `CPTabBarTemplate` / `SiriKit` |
| **TV** | **cursor** | `UIFocusSystem` / `FocusFinder` |
| **手表** | stack（单列） | `WKInterfaceController` push |

---

## 4. 焦点导航（p-nav-cursor，TV 专属）

```vue
<p-nav-cursor :initial-focus="0">
  <p-focus-scope mode="grid" :wrap="true">
    <p-nav-item to="/home">首页</p-nav-item>
    <p-nav-item to="/search">搜索</p-nav-item>
    <p-nav-item to="/settings">设置</p-nav-item>
  </p-focus-scope>
</p-nav-cursor>
```

遥控器 5 向导航 → 焦点在 `<p-nav-item>` 间移动 → 确认键触发 `router.push`。

映射：Leanback `BrowseSupportFragment` / Apple TV `UITabBarController` + `UIFocusSystem`。

---

## 5. 语音导航（p-nav-voice，车机专属）

```vue
<p-nav-voice
  command="导航到{{destination}}"
  @resolve="(dest) => router.push('/nav/' + dest)"
/>
```

映射：SiriKit `INSendMessageIntent` / 鸿蒙语音助手 / Android Assistant Intent。

---

## 6. 跨设备不变式

> **业务代码只写一次 `<p-nav>`，框架根据容器特征选形态。**

```vue
<!-- 同一份代码，六端呈现不同 -->
<p-nav :modes="auto">
  <p-nav-item to="/a">A</p-nav-item>
  <p-nav-item to="/b">B</p-nav-item>
</p-nav>
```

| 端 | 呈现 |
|----|------|
| 手机 | 底部 TabBar |
| 平板 | 左侧 SplitView |
| PC | 顶部 + Drawer |
| 车机 | 底部大按钮 Tab + 语音 |
| TV | **焦点导航（5 向）** |
| 手表 | 单列堆叠 |

---

## 7. 与 Router（G-17）的关系

```
G-17 Router  ──→  路径 → 页面组件（声明式路由表）
G-25 p-nav   ──→  页面如何呈现（导航形态）
                      ↓
              两者组合 = 完整的"路由 + 导航"体验
```

`p-nav` 消费 Router 的 `router-view`，不改路由配置。

---

## 8. 降级策略

| 场景 | 降级 |
|------|------|
| 端不支持某导航形态 | 退化为 `stack`（最通用） |
| TV 未声明 `p-nav-cursor` | 默认 `stack` + 焦点模拟 |
| 语音不可用 | `<p-nav-voice>` 隐藏 |

---

## 9. 严格规则

| 规则 | 级别 | 说明 |
|------|------|------|
| NAV001 | warning | 建议显式声明 `:modes`，避免默认推断 |
| NAV002 | error | TV 端导航必须可焦点驱动（TV001） |
| NAV003 | error | 车机导航须支持 voice 或 driving-safe |

---

## 10. 小结

`p-nav` 家族 = **导航形态的 `p-adaptive`**。
它让"一套路由配置，六端原生导航"成为可能——
再一次证明：**Proteus 不是跨端 UI 框架，而是操作系统导航能力的语义层。**
