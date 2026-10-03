# Proteus 超级应用（superapp）

> **框架最终验收场**：真实生产形态的超级应用——**所有超级应用级验收场景都在这里跑**。
> 首个验收模块 = **全局挂载八条场景**（GP5）。验收标准 = **生产可用**（不是 examples 的 demo 级）。

## 三个工程的分工（勿混用）

| 工程 | 定位 | 视觉标准 |
|---|---|---|
| `examples/` | **内部测试**全家桶（编译/渲染边界用例，被测试当 fixture） | 无要求（能验证即可） |
| `showcase/` | **对外官方演示**（信息架构 / 品牌视觉 / 能力全景） | 亮眼、品牌感 |
| **`superapp/`** | **框架最终验收场**（真实生产形态） | **生产可用**（见视觉规范） |

## 首个验收模块：全局挂载八条场景

| # | 场景 | 归层 | 本工程落点 |
|---|---|---|---|
| ① | 全局 Toast（队列/位置/样式） | Overlay | `pages/verify.vue`（构建期按需注入宿主） |
| ② | 全局 Loading（多实例/遮罩范围） | Overlay | 同上 |
| ③ | 登录失效拦截（不可取消） | Overlay | 同上（★手写宿主——需绑 onAction） |
| ④ | 客服悬浮球 | Global | `App.mp.vue` / `App.vue`（**声明一次**） |
| ⑤ | 音乐播放条 | Global | 同上 |
| ⑥ | 网络状态条 | Global | 同上 |
| ⑦ | 主题容器（深色切换免刷新） | Global | 同上（设置页开关驱动） |
| ⑧ | IM 未读角标（跨页同步） | Global + 状态 | 同上（消息页读写同一份状态） |

**验收面**：`pages/verify.vue`（验收控制台——逐条触发 + 实时读数 + 操作日志）。

## 验收判据（怎么算过）

1. **零每页引入**（源码层）：八条场景的宿主/内容**都不由业务页面声明**——
   Overlay 三条经构建期注入或根组件声明，Global 五条在 App 壳声明一次。
2. **业务形态真实**：场景不是占位元素，而是真实业务形态——
   悬浮球=客服入口（设置页可关）、音乐条=播客播放器（曲目+控制）、
   主题=设置页开关驱动全应用、角标=消息页未读数同源。
3. **跨页一致**：切页后 Global 层内容仍在且状态同步（共享状态一份；MP 实例每页一份）。
4. **生产级视觉**：符合《视觉设计规范》（对比度 AA / 信息密度 / 层级克制）。

## 工程结构

```
superapp/
├─ App.mp.vue          MP 壳（Global 层声明处——八条场景中的四条 Global 在此）
├─ App.vue             Web 根组件（同一套声明形态；Overlay 宿主挂在这里）
├─ global-state.ts     Web 端全局状态（模块单例——Web 无编译注入）
├─ styles/global.css   ★视觉规范唯一事实源（L1 token + L2 组件类）——两端同源
├─ pages/              index（工作台）/ messages（列表）/ mine（设置）/ verify（控制台）
├─ router/             RouterView.vue（Web 端渲染容器，由 showcase 镜像）
└─ shims/              小程序 API 类型垫片（由 showcase 镜像）
```

## 构建与运行

```bash
cd superapp
npx proteus build --target skyline   # MP 产物 → dist/mp-weixin（导入微信开发者工具）
npx proteus build --target web       # Web 产物 → dist/web
npx proteus dev --target skyline     # 开发模式
```

> ⚠️ `superapp/dist/` 已在 `.gitignore`（构建产物不入库；口径同 examples/showcase）。

## 视觉规范

**完整规范见 `docs/Proteus_超级应用视觉设计规范.md`**（三层：L1 token / L2 组件类 / L3 页面模式）。
核心纪律：
- 页面 CSS **只用 `var(--sa-*)`**（禁裸色值/裸圆角）
- 交互组件优先用框架 `p-*`；`.sa-*` 只做纯视觉骨架
- 深色主题：页根绑 `{'sa-dark': cond}`（**字面量键**——拼串会被编译期插 scopeId）

## 诚实边界

- MP 端 Global 层是**每页一份实例**（N = 页面栈）；跨页一致靠**状态一份**——
  **不得说"单实例跨页面存活"**（Web 端才是）
- 本工程当前**单一品牌**（无多品牌换肤）；字体缩放后的排版规则待定（见规范 §7）
