---
title: 路由转场
order: 4
group: 使用
---

# 路由转场

同一份源码里的 `meta: { transition: 'halfScreen' }`，在三个端上有三种兑现方式——但**枚举是同一份**。

## 统一枚举与三端兑现

| 端 | 兑现方式 | 实现位置 |
|---|---|---|
| Web | CSS 转场名（`slide-up` / `slide-down` / `halfscreen` / `scale`） | `WEB_TRANSITION_MAP` |
| 微信小程序 | `navigateTo({ routeType })` 平台标识 | `MP_ROUTE_TYPE_MAP` |
| App | **Morpheus 自己驱动**（不是报名字给平台） | `APP_TRANSITION_MAP` → 内核动画 |

三张表的键集**逐端交叉核对**（测试里同时加载三张表比对）——枚举增员时任何一端漏掉都会当场红。

## 方向语义：push 与 pop 是镜像对

`routeTransitionBatches()` 把统一枚举编译成执行器可用的两页批次，并且**内建方向语义**：

| 方向 | 进入的页 | 离开的页 |
|---|---|---|
| `forward`（push / replace） | 播 `spec.enter`（原样） | 播 `spec.exit`（原样） |
| `back`（pop / 返回） | 播 **`reverse(spec.exit)`** | 播 **`reverse(spec.enter)`** |

`reverse` 的含义是 `from` / `to` 互换——`slideUp` 的「`800 → 0` 推入」反向后就是「`0 → 800` 滑出」。真机判据对这一点做的是**镜像对**断言：

```ts
// forward.incoming 的 from/to 恰好是 back.outgoing 的 to/from
forward:  incoming 800 → 0    outgoing 0 → -240
back:     incoming -240 → 0   outgoing 0 → 800
```

同一转场下两组数值精确互逆——**方向语义只有一处实现**，执行器不再各写一份。

## 执行器：命令流 → 真树操作 + 真动画

路由栈（M5 虚拟栈）只产出**命令流**，执行器负责编排：

```
栈命令（mount / enter / exit / unmount）
    ↓  createScreenExecutor（编排：顺序 / 可见性 / 方向 / 事务）
端口：ScreenTreeHost（树操作） + ScreenAnimHost（动画播放）
    ↓  生产实现经宿主通道 → 真内核树（建屏/销毁）+ 真帧循环动画
```

**两个编排决策**（契约没写死、由执行器定，都写进了代码注释）：

- **退场销毁延迟到转场播完**——退场命令到达时不立即销毁，否则旧页会在滑出动画**中途消失**（闪断）；改为转场结束后再销毁，树保留语义不变；
- **方向推导三值表**——本事务 `mount` 且非重建 ⇒ `forward`；其余（含冻结后重建的回程）⇒ `back`。冻结屏返回时用反向规格，观感才是"回程复位"。

## 真机读数（双端）

| 判据 | 读数 |
|---|---|
| push 命令序 | `mount(detail) → visible(detail) → visible(home,off)`（3 步 · 树保留零销毁） |
| 方向分档 | 首屏与 push = `forward` · pop = `back` |
| 镜像对 | `forward.in 800→0` ↔ `back.out 0→800`（判据侧独立复算） |
| 销毁时机 | `visible(home) → destroy(detail)`（转场播完后销毁） |
| 宿主真动作 | `mount=2 · visible=4 · destroy=1 · anim=3/完成 3 · 零钩子缺失` |

判据脚本 `check-app-stack.py` **双端共用**（Android QuickJS / iOS JavaScriptCore），宿主侧动作以**宿主记账**为证据、不以桥自述为准。

## 下一步

- [证据与诚实边界](/docs/animation/04-boundaries)——真机读数与未做清单
