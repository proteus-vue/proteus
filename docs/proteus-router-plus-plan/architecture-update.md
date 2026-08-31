# Architecture 规约更新（G-17）

> 合并说明：将路由方案的关键变更同步进 Architecture 规约（`proteus-architecture.md`）。

## 1. 新增执行位

| 编号 | 名称 | 优先级 | 依赖 |
|------|------|--------|------|
| **G-17** | Router（声明式路由 + 原生导航映射） | P0 | G-05, G-09, G-07 |

## 2. 新增原则

### 原则 #11：路由语义收敛

> **路由配置即页面组件（单一事实源）。框架定义统一的转场/栈/手势语义，各端映射到各自最优的原生导航实现。禁止组件开发者直接调用平台导航 API。**

反例：
- ❌ 业务代码调用 `UINavigationController.pushViewController`
- ❌ 调用 `uni.navigateTo` / `wx.navigateTo` 绕过 `router`
- ❌ 在 `<route>` 外维护第二份路由配置

## 3. 全景图补充

```
Layer 4  应用能力  ─── Router(G-17) ──┬─→ 页面栈 diff
                    Theme/Font/Cache  │
                    Memorial/Skeleton │
                                       ↓
Layer 3  渲染层    App Renderer ───────┤
                    Glass / Safe Area  │
                                       ↓
Layer 2  运行时    Vue Reconciler + JSI
Layer 1  语义层    Layout / Style / Router 语义
Layer 0  IR        统一中间表示
```

## 4. 铁律补充

- **G-17**：所有导航必须通过 `router` API；转场由框架生成事务；手势/安全区/玻璃自动集成。

## 5. 关联更新

- `proteus-positioning.md`：杀手特性清单新增「声明式路由 + 原生转场」
- CSS 矩阵：路由组件样式同样受 G-16 管控（无新增属性）
- Memory Plan：转场内存增量预算（< 5MB）
