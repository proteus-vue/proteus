# 03 · 宿主输入契约（remote key）

> 本文件定义**三端宿主的按键上行契约**。它是 B1 的唯一交付物，也是「输入归一」这一层的规格。
> 原则：**归一只做一次，在宿主**；JS 层只见语义键，不见平台键码。

---

## 1. 契约总览

```
平台键事件 ──► 宿主 dispatchKeyEvent / pressesBegan / onKeyEvent
                     │
                     ▼ 归一（本文 §2）
             KeyEvent { type:'key', key:RemoteKey, repeat:bool, raw:string, ts:number }
                     │
                     ▼ 既有通道（不新造）
             __proteusHostAppEvent('key', payload)
                     │
                     ▼ JS 层
             onRemoteKey(cb) ──► Hestia.handleKey(key)
```

---

## 2. 归一表（★ 必须实测，不得照抄文档）

| 语义键 | Android | tvOS | Web TV | Harmony | 陷阱 |
|---|---|---|---|---|---|
| `up` | 19 `DPAD_UP` | `UIPress.PressType.upArrow` | `ArrowUp`(38) | `KeyCode.KEYCODE_DPAD_UP` | — |
| `down` | 20 `DPAD_DOWN` | `.downArrow` | `ArrowDown`(40) | `..DPAD_DOWN` | — |
| `left` | 21 `DPAD_LEFT` | `.leftArrow` | `ArrowLeft`(37) | `..DPAD_LEFT` | — |
| `right` | 22 `DPAD_RIGHT` | `.rightArrow` | `ArrowRight`(39) | `..DPAD_RIGHT` | — |
| `confirm` | **23 `DPAD_CENTER`** + **66 `ENTER`** | `.select` | `Enter`(13) + 空格(32) | `..DPAD_CENTER` + `..ENTER` | ★**同义双码**，漏一个就有盒子的 OK 键无反应 |
| `back` | 4 `BACK` | `.menu`（短按） | `Escape`(27) | `..BACK` | ★tvOS 上 back/menu 同键 |
| `menu` | 82 `MENU` | `.menu`（**长按**） | — | `..MENU` | ★需按住时长阈值区分 |

### 2.1 「同义双码」必须都认（防真实事故）

`DPAD_CENTER(23)` 与 `ENTER(66)` **在真实盒子上并存**：遥控器 OK 键多发 23，而部分
蓝牙遥控/键鼠模拟发 66。**只认一个 = 某类盒子上"确认键完全无反应"**，且现场极难归因。
⇒ 归一表把两者映射到同一语义键，**并用判据锁住**（见 §5 D1）。

### 2.2 tvOS 的 back/menu 同键

`UIPress.PressType.menu` 一个键承担两个语义：
- **短按** ⇒ `back`（返回上一层）
- **长按**（≥0.8s） ⇒ `menu`（回到主屏/菜单）

**阈值不进归一表**（那是策略），但**必须记在 `KeyEvent.durationMs`**，由 JS 层决策：

```ts
interface KeyEvent { type:'key'; key: RemoteKey; repeat: boolean; raw?: string; ts: number; durationMs?: number }
```

---

## 3. repeat 语义

| 平台 | 来源 | `repeat` 取值 |
|---|---|---|
| Android | `KeyEvent.getRepeatCount() > 0` | 原生真实值 |
| Web | `KeyboardEvent.repeat` | 原生真实值 |
| tvOS | **系统不提供** | ⚠ 宿主合成（按住 ≥ 500ms 后按 `repeatInterval` 发；默认 100ms） |
| Harmony | 需实测 | 待 B5 |
| **adb 注入** | **不产生 repeat** | 恒 `false`（见 `04-verdict-and-harness.md` §2） |

**契约**：`repeat=true` 的事件**不得改变焦点语义**（与首次按下等价），只用于业务"加速"
（如长按翻页）。引擎里 `handleKey` 对 `repeat` 一视同仁——是否限速由业务给。

---

## 4. 假成功防护（本仓纪律）

| 风险 | 防护 |
|---|---|
| 宿主装了通道但 JS 没订阅 ⇒ 静默 | 宿主推送返回 `false`（JS 侧 `__proteusHostAppEvent` 不存在）时**记 warn 并计数**，报告里出 `key_push_dropped` |
| JS 订阅了但宿主没接线 | 报告出 `key_events_received`，为 0 ⇒ **判装置失败**（不是"框架不支持"） |
| 归一漏了一个键码 | 判据 D1 逐项测 §2 全表，**每个键码一条用例** |
| 事件风暴（长按 100ms 间隔） | 宿主侧**合并/限速**到 `repeatInterval`，不许把原始 auto-repeat 全推 |

---

## 5. 破坏性验证（B1 完成判据）

| # | 验证 | 期望 |
|---|---|---|
| **D1** | 删掉归一表里的 `ENTER(66)` ⇒ 用 66 注入 | P1 判据**必须红**并指出"confirm 未映射" |
| **D2** | 宿主推送时 JS 未订阅 | 报告出现 `key_push_dropped > 0`，**不静默** |
| **D3** | 注入表里每一个键码（19/20/21/22/23/66/4/82） | 逐个映射正确，共 8 条用例 |
| **D4** | 快速连发 100 次 `right` | 事件全达（计数=100）、无丢、无崩 |

---

## 6. 与能力原语的关系（G8 缺口）

「遥控输入」是**新能力原语**（现只有 C14 `useKeyboard` = 软键盘高度，语义不同）。
本方案**不预设编号**，按 A 链流程在 `packages/component-ir/src/primitives.ts` 增补，要求：

| 要求 | 说明 |
|---|---|
| 语义命名 | `useRemote()`（不叫 `useKey`——`key` 太泛，且与"按键"物理概念混淆） |
| 三端诚实降级 | 非 TV 端（无 remote 画像）返回 `supported:false`，**不伪造** |
| 事件形态 | 只出 §2 的 7 个语义键，**不出 `raw`**（`raw` 只进诊断字段） |
| 与 `F=remote` 的关系 | 能力可用性由形态画像推导；`F≠remote` 时调用 ⇒ 如实 `unsupported` |
