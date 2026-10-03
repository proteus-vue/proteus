# Proteus 高频原生能力组件任务卡清单

> 代号 **Hephaestus** · 关联方案：`Proteus_高频原生能力组件方案.md`
> 版本 v1 · P0 批次共 22 张卡
> **入库**：2026-10-03（决策 #467）
>
> ## ★★验收标准基准：**超级应用标准**（用户 2026-10-03 明示——不是 demo 级）
>
> **"超级应用标准"在本清单里的可执行含义**（每张卡都按此判，不达标不算完成）：
>
> | # | 要求 | 反面（demo 级做法——不算完成） |
> |---|---|---|
> | **S1** | **真机矩阵**：多品牌 × 多版本 × 多 ROM（量级见各卡） | 模拟器跑通就勾选；单机单版本 |
> | **S2** | **静默失败项必有单测**（本方案共 7 类：iOS 强引用/音频会话/restore、Android `onPause`、宽高比区间、鸿蒙节点泄漏、小程序前置属性） | "实测没报错所以没问题"（静默失败本身就是**没现象**） |
> | **S3** | **支持度矩阵含"是否需打原生基座"列** | 只写"支持/不支持"（丢掉与 uni-app 的分水岭指标） |
> | **S4** | **`unsupported` 编译期报错**（禁静默空白/运行时变空） | 运行时返回空、控制台一声不吭 |
> | **S5** | **允许差异显式登记**（进 `allow-differences.json`） | 当 bug 反复修（改不掉又反复投入）**或**视而不见（对外宣称一致） |
> | **S6** | **降级路径必须声明且可验**（`@fallback`） | "不支持就没办法"（业务到真机才发现） |
> | **S7** | **存量对账先做**（本方案不是 20 项从零建——见方案 §0.0①）：已有且达标的卡**引既有实现**，不重写 | 重写既有组件（制造两套实现——本仓为这类分叉付过代价） |
>
> ★**S7 的取证命令**（逐卡第一步就跑，别凭印象）：
> ```bash
> # 该能力是否已有原语/Hook（按语义键查）
> grep -nE "semantic: '(ui|capability)\.<name>|cap\('[A-Z0-9]+', '<name>'" packages/component-ir/src/primitives.ts
> # 是否已有组件形态（按目录名查）
> ls -d packages/components/p-<name> 2>/dev/null
> ```
> ★**S1/S2 是"超级应用标准"与"demo 级"最主要的两个分界**——本仓既有纪律
> （"先取证再断言" / "静默失效是最危险失效模式"）在此直接适用。

---

## 使用说明

- 每张卡含：ID / 依赖 / 现状 / 实现要求 / 验收标准（可勾选）
- 验收标准**必须逐条实测**，不得基于文档推断
- 勾选框用于执行回执

---

## 第一批：HP0 五端实测（必须先做）

### 卡 HP0-a · Android PiP 实测

- [ ] **依赖**：无
- [ ] **现状**：未开工

**实现要求**

在真机上验证 Android `PictureInPictureParams` 的实际行为，重点验证 §1.2 的语义分裂。

**验收标准**

- [ ] 验证进入 PiP 后**是整个 Activity 缩小**（而非仅播放内容）
- [ ] 验证 Activity 进入 PiP 时处于 `paused` 但播放继续
- [ ] 验证在 `onPause()` 中暂停播放会导致进 PiP 后黑屏（**反向验证**）
- [ ] 验证宽高比 ∈ [2.39:1, 1:2.39] 之外会被**静默忽略**
- [ ] 验证 `setExpandedAspectRatio` 的区间是**互补区间**（∉ [2.39:1, 1:2.39]）
- [ ] 验证 action 数量超过 `getMaxNumPictureInPictureActions()` 会**静默截断**
- [ ] 验证 `setAutoEnterEnabled`（API 31+）在按 Home 键时生效
- [ ] 验证 API 26–30 上 `setAutoEnterEnabled` **不可用**（需降级路径）
- [ ] 验证 PiP 窗口**不接收触摸事件**，需经 `MediaSession.setCallback()`
- [ ] 验证内存不足设备上 `hasSystemFeature(FEATURE_PICTURE_IN_PICTURE)` 返回 false
- [ ] 记录真机矩阵（至少 3 个品牌，覆盖不同 Android 版本）

---

### 卡 HP0-b · iOS PiP 实测

- [ ] **依赖**：无
- [ ] **现状**：未开工

**实现要求**

在真机上验证 `AVPictureInPictureController`，重点验证四个静默失败项。

**验收标准**

- [ ] 验证进入 PiP 时**ViewController 仍留在屏幕上**（仅内容进小窗）
- [ ] **验证弱引用导致静默 dealloc**：controller 设为局部变量后 `startPictureInPicture()` 无反应且无 delegate 回调
- [ ] 验证音频 session 为 `.ambient` 时 **PiP 静音**
- [ ] 验证 `.playback`（点播）与 `.playAndRecord + .videoChat`（通话）下正常
- [ ] **验证不实现 `restoreUserInterface` 时用户回到错误页面**
- [ ] 验证 PiP 窗口**只能渲染一个视频层**（多人会议需另做处理）
- [ ] 验证 SwiftUI `VideoPlayer` **不支持 PiP**（须包 `UIViewControllerRepresentable`）
- [ ] 验证 `MTKView` / `GLKView` **不被 PiP 支持**
- [ ] 验证 iOS 15+ 视频通话 PiP 的 `AVSampleBufferDisplayLayer` 路径
- [ ] 验证 iOS 18+ 多任务相机访问（`voip` background mode + `isMultitaskingCameraAccessEnabled`）
- [ ] **验证 iOS 26 下行为是否变更**（专项，见方案 §9 第 5 项）

---

### 卡 HP0-c · 鸿蒙 PiP 实测

- [ ] **依赖**：鸿蒙宿主主线 HM0–HM2
- [ ] **现状**：未开工

**实现要求**

验证 `@ohos.PiPWindow`（API 11+），重点验证后台约束与两种开发模式。

**验收标准**

- [ ] 验证 `canIUse` + `isPiPEnabled()` **两道检测**均需通过
- [ ] **验证后台调用 `startPiP` 被拒**（应改用 `setAutoStartEnabled(true)`）
- [ ] 验证 XComponent 模式（适合 Navigation 管理或单页面）
- [ ] 验证 typeNode 模式（推荐，全场景，需自管页面）
- [ ] 验证 XComponent 的 type 必须为 `SURFACE`
- [ ] 验证使用 Navigation 时**必须设置 id 并传给 PiP 控制器**（否则恢复回错页面）
- [ ] 验证关闭 PiP 时**不释放自定义组件节点会导致内存泄漏**
- [ ] 记录 HarmonyOS 6.0 前后设备支持差异（6.0 前仅 Phone/Tablet）
- [ ] **核实 C-API 是否有 PiPWindow 对应接口**（方案 §9 第 1 项）

---

### 卡 HP0-d · Web PiP 实测

- [ ] **依赖**：无
- [ ] **现状**：未开工

**实现要求**

验证 Video PiP 与 Document PiP **两套 API** 的实际可用性。

**验收标准**

- [ ] 验证 `requestPictureInPicture()` **需要瞬态用户激活**（无手势时抛 `NotAllowedError`）
- [ ] 验证不支持时抛 `NotSupportedError`（Firefox / 用户偏好 / 平台限制）
- [ ] 验证退出必须用 `document.exitPictureInPicture()`（**video 上无此方法**）
- [ ] 验证同一时刻**只能有一个 PiP 窗口**
- [ ] 验证旧版 Chrome 中方法存在但不可用——**不得只用方法存在性做能力检测**
- [ ] 验证 Android WebView **不支持**
- [ ] 验证 Firefox 桌面（153 预览）与 Firefox Android 的实际情况
- [ ] 验证 Document PiP（Chrome 116+）可渲染任意 DOM
- [ ] 验证 Document PiP 需 `createPortal` + **手动复制样式表**
- [ ] 记录完整的浏览器兼容矩阵

---

### 卡 HP0-e · 小程序 PiP 实测

- [ ] **依赖**：无
- [ ] **现状**：未开工

**实现要求**

验证 `video` 组件 `picture-in-picture-mode`（基础库 2.11.0+）。

**验收标准**

- [ ] 验证 `push` / `pop` / 两者 三种模式行为
- [ ] **验证缺失 `enable-play-gesture` 等前置属性时静默拒绝**（仅日志 `pip: context not ready`）
- [ ] 验证必须处于 **playing 状态**（否则 `fail not in playing state`）
- [ ] 验证 Android 需"显示在其他应用上层"权限
- [ ] 验证 iOS 需系统画中画开关开启（**无法 API 检测**，需引导跳转设置）
- [ ] 验证小窗尺寸根据原组件尺寸自动判断
- [ ] 验证点击小窗会导航回播放器页面
- [ ] 验证进入小窗后页面为 `onHide`（**不销毁**），关闭后 `onUnload`
- [ ] **核实 Skyline 渲染下的支持情况**（官方仅描述 WebView 渲染）
- [ ] 核实鸿蒙 OS 下"暂不支持"的具体事件范围

---

## 第二批：HP1 语义层定义

### 卡 HP1-a · L2 五语义定义

- [ ] **依赖**：HP0 五卡全部完成
- [ ] **现状**：未开工

**实现要求**

定义跨端统一的五个语义：enter / exit / autoEnter / restore / state。

**验收标准**

- [ ] 五个语义各自有明确定义文档
- [ ] **Android/iOS 语义分裂被 L2 吸收，未上浮到 L3**（逐条对照验证）
- [ ] state 归一为 `idle / starting / active / stopping / error`
- [ ] 每个语义列出五端各自的触发条件对照表
- [ ] **autoEnter 明确标注 Web 端不支持**（不得静默降级为"不生效"）

---

### 卡 HP1-b · 语义分裂验证用例

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 编写用例：同一份声明，Android 上 Activity 缩小、iOS 上内容缩小
- [ ] 用例断言：**两端对外表现一致（都是"视频挂成小窗"）**
- [ ] 用例断言：**内部路径不同**（Android 走 Activity、iOS 走内容）
- [ ] 该用例进入 CI

---

## 第三批：HP2 组件实现

### 卡 HP2-a · `<pip>` Android 实现

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] manifest 自动注入 `supportsPictureInPicture`（编译期）
- [ ] **不在 `onPause` 暂停播放**（专项回归）
- [ ] 宽高比参数校验（普通 / expanded 互补区间）
- [ ] 触摸事件经 `MediaSession.setCallback()`
- [ ] action 数量超限给警告（不静默截断）
- [ ] API 26–30 的 autoEnter 降级路径

---

### 卡 HP2-b · `<pip>` iOS 实现

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] controller **强引用**（单测覆盖）
- [ ] 音频 session 按场景配置（点播 `.playback` / 通话 `.playAndRecord+.videoChat`）
- [ ] **内建默认 restore 行为**（回到触发页面），开发者不可忽略
- [ ] 自动注入 `UIBackgroundModes: audio`
- [ ] PiP 激活时主播放器 UI 收起（官方要求）
- [ ] **不暴露"程序化立即进入"的裸调用**（Apple 审核红线）

---

### 卡 HP2-c · `<pip>` 鸿蒙实现

- [ ] **依赖**：HP1-a、鸿蒙宿主 HM0–HM2
- [ ] **现状**：未开工

**验收标准**

- [ ] `canIUse` + `isPiPEnabled()` 两道检测
- [ ] **后台路径走 `setAutoStartEnabled(true)`，不调 `startPiP`**
- [ ] XComponent type = `SURFACE`
- [ ] Navigation id 传递（编译期强制，缺失则报错）
- [ ] 关闭时释放自定义组件节点

---

### 卡 HP2-d · `<pip>` Web 实现

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 能力检测**不依赖方法存在性**
- [ ] 退出用 `document.exitPictureInPicture()`
- [ ] 监听 `leavepictureinpicture` 重置 UI（不用轮询）
- [ ] 用户手势绑定（无手势时明确报错，不静默失败）
- [ ] Document PiP 作为可选扩展（若目标浏览器支持）

---

### 卡 HP2-e · `<pip>` 小程序实现

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 前置属性自动注入（`enable-play-gesture` 等）
- [ ] playing 状态校验（非 playing 时明确报错）
- [ ] Android 权限引导
- [ ] iOS 系统开关引导（无法检测，需提示跳转设置）
- [ ] 页面生命周期对接（`onHide` 不销毁 / 关闭后 `onUnload`）

---

## 第四批：HP3 硬约束静态检查

### 卡 HP3-a · iOS 三项静默失败检查

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 编译期检查：controller 为强引用
- [ ] 编译期检查：音频 session 已配置
- [ ] 编译期检查：restore 处理已声明（或使用框架默认）
- [ ] 三项各有专项单测

---

### 卡 HP3-b · Android 参数区间检查

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 编译期校验 `aspectRatio` ∈ [2.39:1, 1:2.39]
- [ ] 编译期校验 `expandedAspectRatio` ∉ [2.39:1, 1:2.39]
- [ ] action 数量超限警告
- [ ] `onPause` 中暂停播放的检测（或至少文档强约束 + 回归用例）

---

### 卡 HP3-c · 用户手势约束检查

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] **禁止"程序化立即进入 PiP"的裸调用**（iOS 端编译期报错或强警告）
- [ ] 允许的 `autoEnter` 路径明确白名单（系统级触发，非程序化）
- [ ] 文档明确引用 Apple 审核要求原文

---

## 第五批：HP4 支持度矩阵接入

### 卡 HP4-a · `<pip>` 支持度矩阵

- [ ] **依赖**：VC1-d、HP0 五卡
- [ ] **现状**：未开工

**验收标准**

- [ ] 五端 × 版本门槛 × 权限要求矩阵
- [ ] **必须含"是否需打原生基座"列**（本组件为否）
- [ ] 数据写入 VC1-d 统一体系，**不得另起 schema**
- [ ] `unsupported` 编译期报错

---

### 卡 HP4-b · 编译期门禁

- [ ] **依赖**：HP4-a、VC2-e
- [ ] **现状**：未开工

**验收标准**

- [ ] `requires os / min-api` 声明支持
- [ ] 不满足时编译期报错或走声明式降级
- [ ] **不得引入运行时查表**
- [ ] 与 CSS 支持度矩阵可联合校验（防降级链断裂）

---

## 第六批：HP5 P0 其余组件

### 卡 HP5-a · 扫码组件

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] 五端实现
- [ ] 小程序端处理 `camera` 原生组件层级最高问题（接层级规范）
- [ ] 权限申请统一封装
- [ ] `@support` 矩阵

---

### 卡 HP5-b · 定位组件

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] Android 前后台权限分离处理
- [ ] iOS 精确定位 / 模糊定位分级
- [ ] 鸿蒙定位权限模型
- [ ] 小程序 `scope.userLocation` 流程
- [ ] `@support` 矩阵

---

### 卡 HP5-c · 生物识别组件

- [ ] **依赖**：HP1-a
- [ ] **现状**：未开工

**验收标准**

- [ ] Face ID / 指纹 / 鸿蒙生物认证统一语义
- [ ] **错误码归一**（各端错误码差异极大）
- [ ] 降级路径（无生物识别 → 密码）
- [ ] `@support` 矩阵

---

### 卡 HP5-d · 状态栏与安全区组件

- [ ] **依赖**：无
- [ ] **现状**：未开工

**验收标准**

- [ ] 刘海 / 挖孔 / 手势条统一处理
- [ ] 各端安全区获取方式封装
- [ ] 与《单位系统与舍入规范》对接（物理像素整数）
- [ ] `@support` 矩阵

---

## 第七批：HP6/HP7 收尾

### 卡 HP6-a · 允许差异清单登记

- [ ] **依赖**：HP0 五卡
- [ ] **现状**：未开工

**验收标准**

- [ ] §6.4 四条差异登记进 VC5-d
- [ ] 每条写明"设计使然"的理由
- [ ] **特别标注：不得为统一 Android/iOS 行为而自绘悬浮窗**（撞 SAW 禁令）
- [ ] 清单外差异一律当 bug

---

### 卡 HP7-a · 对外对照表

- [ ] **依赖**：HP2 五卡
- [ ] **现状**：未开工

**验收标准**

- [ ] 三栏对照：uni-app（装插件 + 打基座）/ Flutter（关掉 autoEnter）/ Proteus（一行声明）
- [ ] 每个分句标注出处
- [ ] **禁用 §7.2 四条禁语**
- [ ] 通过禁语检查

---

## 全局硬约束（所有卡片适用）

- [ ] 所有第三方 API 能力声明**以官方文档为准**，不得凭常识推断
- [ ] 所有静默失败项**必须写单测**，不得依赖现象发现
- [ ] 所有组件**不得引入运行时查表**
- [ ] `unsupported` **一律编译期报错**，禁止静默空白
- [ ] 每个组件产出 `@support` 矩阵并接入 VC1-d
- [ ] 鸿蒙相关卡**排在鸿蒙宿主主线 HM0–HM2 之后**
- [ ] ★**逐卡第一步：存量对账**（S7——`grep primitives.ts` + `ls p-<name>`；已有则引实现不重写）
- [ ] ★**真机矩阵达标才算完成**（S1——各卡的"记录真机矩阵"条目不是可选项）
- [ ] ★**允许差异进 `docs/allow-differences.json`**（S5——沿用既有 schema，不另起；禁止"为让测试过"加条目）

---

## 执行顺序

```
HP0（五卡并行）→ HP1 → HP2（五端并行）+ HP3（并行）→ HP4 → HP5 → HP6 → HP7
```

**HP0 不可压缩、不可跳过**——它是 §1.2 语义分裂的唯一实证来源。
