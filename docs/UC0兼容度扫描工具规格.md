# UC0 · uni-app 兼容度扫描工具规格

> 定位：**在写任何兼容实现之前，先用真实项目量化"到底要兼容多少东西"**
> 依赖：无（独立于其他方案，可立即开工）
> 产出：兼容性报告 + API 实现优先级表（该表是 UC4 的唯一输入）
> 本文档是《Proteus 兼容 uni-app 调研与落地方案》UC0 的详细规格


> ⚠ **实施状态：未实现（零代码，2026-09-28 核实）**
>
> UC0.1~UC0.5（结构/阻断项检测 · 条件编译扫描 · 组件与 API 扫描 · 报告与优先级算法 · 真实项目验证）
> **均无工具文件 / 无 CLI 命令 / 无测试**。本工具被 `Proteus兼容uni-app调研与落地方案.md` 引用为前置
> ⇒ **该前置尚未建立**，请勿把本文档当成"已有工具"引用。

---

## 0. 为什么必须先做这个

兼容层的工作量是**开放式的**：

- uni-app API 按官方分类有基础、网络、路由、缓存、位置、媒体、设备、worker、键盘、界面、上拉下拉、页面窗体、文件、绘画、广告、第三方服务、uniCloud、平台扩展、其它——**数百个**
- 内置组件数十个，且分 A/B/C 三档
- 配置项（pages.json / manifest.json / easycom）数量可观

**没有数据就开工 = 盲猜优先级。**

UC0 用 3–5 个真实项目跑一遍，产出的覆盖率基线会直接决定：
- UC2（组件层）先做哪些组件
- UC4（API 层）实现哪些 API、不实现哪些
- 整个兼容层的投入边界在哪里

**这是唯一能把"开放式工作量"变成"有界工作量"的手段。**

---

## 1. 工具形态

```bash
proteus compat scan <uni-app项目路径> [选项]

选项：
  --json              输出机器可读 JSON（供 CI 与批量扫描用）
  --out <file>        报告输出路径
  --platform <name>   目标平台（skyline / web / app），默认 skyline
  --verbose           输出逐文件明细
```

设计原则：
- **只读扫描**，不修改项目任何文件
- **纯静态分析**，不执行项目代码
- 可在 CI 中批量跑（批量扫描多个项目用于统计）

---

## 2. 扫描项清单

### 2.1 项目结构识别

| 项 | 检测内容 | 用途 |
|---|---|---|
| 入口文件 | `main.js` / `main.ts` | 判断 Vue2 / Vue3 |
| 页面目录 | `pages/` | 页面清单 |
| 配置 | `pages.json`、`manifest.json` | 路由与原生配置 |
| 插件目录 | `uni_modules/`（vue-cli 项目位于 `src/` 下） | 生态依赖 |
| 云开发 | `uniCloud/` 或 `cloudfunctions-*` | **硬阻断项** |
| 页面类型 | `.vue` / `.nvue` / `.uvue` | nvue 占比 |

### 2.2 🔴 阻断项检测（命中即判定"当前不可迁移"）

这些是最高优先级，必须最先扫描：

| # | 阻断项 | 检测方式 | 判定 |
|---|---|---|---|
| B1 | **uniCloud 依赖** | 存在 `uniCloud/` 目录；或源码中出现 `uniCloud.callFunction` / `uniCloud.importObject` / `uniCloud.database()` | 阻断 |
| B2 | **nvue 页面占比过高** | 存在 `.nvue` 文件，且占页面总数比例超阈值（默认 30%，可配） | 阻断 |
| B3 | **`renderer: native`** | `manifest.json` → `app-plus.renderer === 'native'` | **严重警告**（说明项目主体是原生渲染，迁移语义差异极大） |
| B4 | **uni-app x 项目** | 存在 `.uvue` / `.uts` 文件 | 阻断（v1 不支持 UTS） |
| B5 | **Vue2 项目** | `main.js` 使用 `new Vue()`；或 `manifest` / 依赖表明 vue2 | 阻断（Proteus 基于 Vue 3.4） |

> **B3 特别说明**：设了 `"renderer": "native"` 后，App 端启用纯原生渲染，**pages.json 注册的 vue 页面将被忽略**。这直接改变迁移策略，必须最先确认。

### 2.3 条件编译扫描

| 项 | 检测内容 |
|---|---|
| 条件编译总数 | 按文件统计 `#ifdef` / `#ifndef` 出现次数 |
| 平台标识分布 | 各标识出现次数与文件位置 |
| 三种注释语法覆盖 | js `//`、css `/* */`、模板 `<!-- -->` — **必须全部识别** |
| 未被条件编译包裹的平台特有代码 | **重点**：裸写的 `plus.xxx`、`wx.xxx` |

输出示例：

```
条件编译分布：
  APP-PLUS          142 处   ← Proteus 不声明，自动剔除
  MP-WEIXIN          88 处   ← 声明，复用
  H5                 31 处   ← 声明，复用
  MP-ALIPAY          12 处   ← 不声明，剔除
  APP-PLUS-NVUE       7 处   ← 不声明，剔除

⚠ 未被条件编译包裹的平台特有调用：
  plus.runtime.*     3 处  (src/utils/push.js:12, src/pages/index.vue:47, ...)
  wx.login           1 处  (src/api/auth.js:8)
```

**最后一类是最有价值的输出**——它们无法靠条件编译自动剔除，必须人工处理。

### 2.4 组件扫描

扫描所有模板中的组件标签，按 A/B/C 档分类：

| 档 | 组件 | 处理方式 |
|---|---|---|
| **A 档**（自研映射） | view、text、image、scroll-view、swiper、button、input、textarea、rich-text、icon、progress、navigator、checkbox、radio、switch、slider、picker、form、label、movable-area、movable-view | 映射到 IR kind |
| **B 档**（原生宿主） | map、video、camera、canvas、web-view、ad、ad-draw、live-player、live-pusher、audio、editor、cover-view、cover-image、match-media、page-meta、navigation-bar、custom-tab-bar | 原生组件宿主，低优先级 |
| **C 档**（不支持） | 平台专有组件（open-data 等）、unicloud-db | 编译期报错 |
| **未知** | 未在清单中的标签 | 需人工判定，可能是自定义组件 |

**重要**：要区分「uni 内置组件」与「用户自定义组件」——自定义组件（含 easycom 自动引入的 `uni-*` 前缀组件）**不在兼容范围内**，应单独归类。

输出示例：

```
组件统计（共 47 个不同标签，1243 处使用）：
  A 档  12 个 /  986 处   覆盖率（按使用次数） 79.3%
  B 档   4 个 /   41 处   3.3%    ← map(2) video(1) web-view(1)
  C 档   1 个 /    3 处   0.2%    ← open-data
  自定义 30 个 /  213 处  17.1%   ← 需人工确认
```

### 2.5 API 扫描（★ 核心输出）

扫描所有 `uni.xxx` 调用，输出**带调用位置与频次**的清单。

**识别要求**：
- 直接调用：`uni.request(...)`
- 属性访问：`uni.getSystemInfoSync`
- 解构或别名引入需尽力识别（无法静态确定时归为"不确定"）
- 区分**调用点数量**与**去重后 API 数量**（前者反映改造工作量，后者反映实现工作量）

输出示例：

```
API 统计：共 63 个不同 API，412 处调用

  频次排名（按调用点数）：
   1. uni.showToast          47 处
   2. uni.request            38 处
   3. uni.navigateTo         31 处
   4. uni.getStorageSync     29 处
   5. uni.setStorageSync     24 处
   ...
  63. uni.createMapContext    1 处

  累计覆盖率：
   Top 10  → 61.2% 调用点
   Top 20  → 78.4%
   Top 30  → 88.6%
   Top 40  → 94.2%
```

### 2.6 生命周期扫描

统计应用生命周期与页面生命周期使用情况：

- 应用级：`onLaunch` / `onShow` / `onHide`
- 页面级：`onLoad` / `onShow` / `onReady` / `onHide` / `onUnload` / `onPullDownRefresh` / `onReachBottom` / `onPageScroll` 等

用于确定 UC3 的实现范围与优先级。

### 2.7 配置项扫描

| 配置 | 检测内容 |
|---|---|
| `pages.json` | pages 数量、globalStyle 字段、tabBar（含 midButton）、subPackages、preloadRule、easycom、condition、entryPagePath |
| `manifest.json` | appid、权限声明、隐私描述、`app-plus.renderer`、`nvueCompiler`、uniCloud 配置 |
| 样式 | rpx 使用量、CSS 预处理器（scss/less/stylus） |

> 注意：uni-app x **不再支持** app-plus 专用配置与 tabbar 的 midButton。若对标 x 行为，这两项可不实现——扫描时要单独标出，因为它们会影响迁移决策。

---

## 3. 报告格式

### 3.1 人类可读报告（默认输出）

```
════════════════════════════════════════════════
 Proteus 兼容性扫描报告
 项目：/path/to/uni-app-project
 目标平台：skyline
 扫描时间：2026-09-28
════════════════════════════════════════════════

【总体判定】🟡 可迁移，需改造
   阻断项：0
   严重警告：1（renderer: native）

【阻断项】
   ✅ 无 uniCloud 依赖
   ✅ nvue 占比 0%（0/28 页面）
   ✅ 非 uni-app x 项目
   ✅ Vue 3 项目

   ⚠️ manifest.json 设置了 "renderer": "native"
      → App 端启用纯原生渲染，vue 页面被忽略
      → 需确认项目实际渲染模式

【条件编译】   共 280 处
   APP-PLUS  142  ← 不声明，自动剔除
   MP-WEIXIN  88  ← 声明，复用
   H5          31 ← 声明，复用
   其他        19 ← 剔除

   ⚠️ 裸写平台 API（未包裹）：plus.runtime 3 处、wx.login 1 处

【组件】  47 个标签 / 1243 处
   A 档（自研映射）  12 个 /  986 处   79.3%  ✅
   B 档（原生宿主）   4 个 /   41 处    3.3%  ⚠️
   C 档（不支持）     1 个 /    3 处    0.2%  ❌
   自定义            30 个 /  213 处   17.1%  — 需人工确认

【API】  63 个 / 412 处调用
   Top 10  覆盖 61.2%
   Top 20  覆盖 78.4%
   Top 30  覆盖 88.6%

   未识别/不确定：2 个（uni.$emit、uni.$on — 事件总线，需单独实现）

【生命周期】
   应用级：onLaunch(1) onShow(1) onHide(1)
   页面级：onLoad(28) onShow(12) onReady(5) onReachBottom(6) onPullDownRefresh(3)

【配置】
   pages: 28 条   subPackages: 2   tabBar: 是（含 midButton ❌）
   easycom: 是   rpx: 1842 处   预处理器: scss

【预估迁移成本】
   组件层：≈ 2 人天（A 档 12 个）
   API 层：≈ 8 人天（Top 30 覆盖 88.6%）
   配置层：≈ 1 人天
   人工改造：≈ 3 人天（裸写 plus 3 处、tabBar midButton、自定义组件确认）
   ────────────────────────────
   合计：≈ 14 人天
════════════════════════════════════════════════
```

### 3.2 机器可读 JSON（`--json`）

```json
{
  "project": "/path/to/project",
  "targetPlatform": "skyline",
  "verdict": "MIGRATABLE_WITH_EFFORT",
  "blockers": [],
  "warnings": [
    { "code": "B3", "severity": "high",
      "message": "manifest.json 设置 renderer: native",
      "location": "manifest.json" }
  ],
  "conditionalCompile": {
    "total": 280,
    "byPlatform": { "APP-PLUS": 142, "MP-WEIXIN": 88, "H5": 31, "MP-ALIPAY": 12, "APP-PLUS-NVUE": 7 },
    "unwrappedPlatformApi": [
      { "symbol": "plus.runtime", "count": 3,
        "locations": ["src/utils/push.js:12", "src/pages/index.vue:47"] },
      { "symbol": "wx.login", "count": 1, "locations": ["src/api/auth.js:8"] }
    ]
  },
  "components": {
    "tiers": {
      "A": { "kinds": 12, "usages": 986, "ratio": 0.793 },
      "B": { "kinds": 4, "usages": 41, "ratio": 0.033 },
      "C": { "kinds": 1, "usages": 3, "ratio": 0.002 },
      "custom": { "kinds": 30, "usages": 213, "ratio": 0.171 }
    },
    "details": {
      "A": [{ "name": "view", "usages": 402 }, { "name": "text", "usages": 287 }],
      "B": [{ "name": "map", "usages": 2 }],
      "C": [{ "name": "open-data", "usages": 3 }]
    }
  },
  "apis": {
    "uniqueCount": 63,
    "callSites": 412,
    "ranked": [
      { "name": "uni.showToast", "callSites": 47, "files": 12 },
      { "name": "uni.request", "callSites": 38, "files": 5 }
    ],
    "cumulativeCoverage": { "top10": 0.612, "top20": 0.784, "top30": 0.886, "top40": 0.942 },
    "uncertain": ["uni.$emit", "uni.$on"]
  },
  "lifecycle": {
    "app": { "onLaunch": 1, "onShow": 1, "onHide": 1 },
    "page": { "onLoad": 28, "onShow": 12, "onReady": 5, "onReachBottom": 6, "onPullDownRefresh": 3 }
  },
  "config": {
    "pages": 28, "subPackages": 2,
    "tabBar": true, "tabBarMidButton": true,
    "easycom": true, "rpxUsages": 1842, "preprocessor": "scss"
  },
  "estimate": { "componentDays": 2, "apiDays": 8, "configDays": 1, "manualDays": 3, "totalDays": 14 }
}
```

---

## 4. API 实现优先级算法（★ UC4 的唯一输入）

### 4.1 算法

单个项目扫描后，按以下步骤得出 API 优先级：

```
Step 1  频次排序
        按 callSites 降序排列所有 uni.xxx

Step 2  计算累计覆盖率
        cumulative[i] = Σ(callSites[0..i]) / Σ(all callSites)

Step 3  切分三档
        P0（必做）：累计覆盖率 ≤ 80% 的那批
        P1（应做）：累计覆盖率 80% ~ 95%
        P2（可延后）：剩余

Step 4  实现成本加权
        对每个 API 标注实现成本（S / M / L）：
          S — 纯转发到平台能力，< 0.5 人天（如 showToast）
          M — 需参数/返回值转换，0.5 ~ 2 人天（如 request）
          L — 需新建设施，> 2 人天（如 uploadFile、getLocation）

Step 5  性价比排序
        priority_score = callSites / cost_weight
        （cost_weight: S=1, M=3, L=8）
        按 score 降序，作为实现顺序

Step 6  跨项目聚合（多项目扫描时）
        total_callSites[api] = Σ 各项目 callSites
        项目覆盖数[api] = 有多少个项目用到它
        
        最终排序 = 项目覆盖数 优先，其次 total_callSites
        【理由：被 5 个项目都用到的 API，比只在 1 个项目出现 47 次的更重要】
```

### 4.2 跨项目聚合的重要性

**单项目数据会误导。** 某个 API 在 A 项目出现 47 次，可能只是那个项目的特化用法；而另一个 API 在 5 个项目各出现 5 次，说明它是**通用刚需**。

**所以 UC0 必须用 3–5 个项目扫描后聚合**，不能只看一个。

### 4.3 输出：API 实现优先级表

```
优先级表（基于 5 个项目聚合）：

 P0（必做，预期覆盖 80%+ 调用点）
   ┌─────────────────────┬────────┬──────────┬────────┐
   │ API                 │ 项目数 │ 调用点   │ 成本   │
   ├─────────────────────┼────────┼──────────┼────────┤
   │ uni.request         │  5/5   │  142     │ M      │
   │ uni.showToast       │  5/5   │   98     │ S      │
   │ uni.navigateTo      │  5/5   │   87     │ M      │
   │ uni.getStorageSync  │  4/5   │   76     │ S      │
   │ ...                 │        │          │        │
   └─────────────────────┴────────┴──────────┴────────┘

 P1（应做）
 P2（可延后 / 明确不实现）

 ❌ 明确不实现（编译期报错）：
   uniCloud.*  — 生态绑定
   plus.*      — 依赖 5+ runtime
   各 ext API  — 依赖 uni_modules 插件
```

---

## 5. 边界与已知局限

| 局限 | 说明 | 应对 |
|---|---|---|
| **动态调用无法静态识别** | `uni[methodName]()` 这类写法扫不出来 | 归为"不确定"，报告中单独列出，需人工确认 |
| **解构/别名** | `const { request } = uni` 后调 `request()` | 尽力识别，识别不了归"不确定" |
| **自定义组件 vs 内置组件** | easycom 的 `uni-*` 前缀组件与内置组件同名冲突 | 按 `pages.json.easycom` 规则 + 组件目录判定；冲突时告警 |
| **条件编译嵌套** | 多层嵌套的条件编译 | 按最外层判定；嵌套超过 2 层时告警 |
| **成本估算精度** | 人天估算必然粗糙 | 明确标注为"量级估算"，不作为承诺 |

**这些局限都要在报告里显式声明**，不能让使用者误以为报告是精确的。

---

## 6. 验收标准

| 指标 | 合格线 |
|---|---|
| 阻断项检测准确率 | 100%（漏检一个阻断项 = 严重缺陷） |
| 条件编译识别 | 三种注释语法全部覆盖，零漏检 |
| 组件分类准确率 | ≥ 95%（人工抽检 20 个标签） |
| API 扫描召回率 | ≥ 90%（人工抽检） |
| 报告可读性 | 非本项目成员能看懂并据此决策 |
| 扫描耗时（中型项目 ~30 页面） | < 10s |
| 只读性 | **零文件修改**（必须验证） |

---

## 7. 里程碑

### UC0.1 · 项目结构与阻断项检测（≈0.5 人周）
- [ ] 目录结构识别（main / pages / pages.json / manifest.json / uni_modules / uniCloud）
- [ ] 五个阻断项检测（B1–B5）
- [ ] 页面类型统计（.vue / .nvue / .uvue）
- [ ] Vue 版本判定

### UC0.2 · 条件编译扫描（≈0.5 人周）
- [ ] 三种注释语法解析（js / css / 模板）
- [ ] 平台标识分类统计
- [ ] 嵌套条件编译处理
- [ ] **裸写平台 API 检测**（高价值输出）

### UC0.3 · 组件与 API 扫描（≈1 人周）
- [ ] 模板 AST 解析，组件提取
- [ ] A/B/C 档分类 + 自定义组件识别
- [ ] `uni.xxx` 调用提取（含位置与频次）
- [ ] 生命周期扫描
- [ ] 配置项扫描（含 rpx 计数、tabBar midButton）

### UC0.4 · 报告与优先级算法（≈0.5 人周）
- [ ] 人类可读报告
- [ ] JSON 输出
- [ ] 优先级算法（含成本加权）
- [ ] 跨项目聚合

### UC0.5 · 真实项目验证（≈0.5 人周）
- [ ] 用 3–5 个真实 uni-app 项目跑通
- [ ] 人工校验准确率（组件分类、API 召回）
- [ ] **产出《API 实现优先级表》作为 UC4 输入**

---

## 8. 给实现 LLM 的执行指令

1. **工具必须只读**，不得修改被扫描项目的任何文件。这是硬性要求。
2. **阻断项检测零漏检**。漏检一个阻断项，会导致后续所有工作基于错误前提。
3. **条件编译三种注释语法必须全部覆盖**，缺一即未完成。
4. **"裸写平台 API"是高价值输出**，不得省略——它们才是真正的改造工作量所在。
5. **动态调用识别不了就归"不确定"**，禁止猜测后计入统计。
6. **报告必须显式声明局限**，尤其是人天估算为量级估算。
7. **UC0.5 的真实项目验证不可跳过**。合成测试用例无法暴露真实项目的复杂情况。
8. **最终交付物是《API 实现优先级表》**，不是工具本身。工具只是手段。
9. 扫描目标优先级：**先选插件市场/开源的真实 uni-app 项目**，不要自己造 demo 项目。

---

## 附：关键事实依据

- uni-app 项目结构：vue-cli 项目的 `uni_modules` 位于 `src/` 下；uniCloud 目录位于项目根目录（`unicloud`，小写开头，非 `cloudfunctions`）
- 条件编译三种注释语法：js/uts 用 `//`，css 用 `/* */`，vue/nvue/uvue 模板用 `<!-- -->`
- 平台标识：APP-PLUS、APP-PLUS-NVUE / APP-NVUE、APP-ANDROID、APP-IOS、APP-HARMONY、H5 / WEB、MP-WEIXIN、MP-ALIPAY、MP-BAIDU、MP-TOUTIAO、MP-LARK、MP-QQ、MP-KUAISHOU、MP-JD、MP-360、MP-XHS、MP、QUICKAPP-*、VUE2 / VUE3、VUE3-VAPOR、UNI-APP-X、uniVersion
- `manifest.json` → `app-plus.renderer === 'native'` 时 App 端启用纯原生渲染，pages.json 注册的 vue 页面将被忽略；`app-plus.nvueCompiler` 区分 weex / uni-app 编译模式
- uni-app x 不再支持 uni-app 的 app-plus 专用配置以及 tabbar 的 midButton
- easycom 默认规则 `^uni-(.*)` → `@/components/uni-$1.vue`，支持 autoscan
- 原生组件清单（混合渲染语义）：map / video / camera / canvas / input / textarea / live-player / live-pusher / cover-view / cover-image / ad
- uni 扩展组件（uni-ui）为独立体系，与内置组件区分
- uniCloud 必须通过 HBuilderX 创建并关联服务空间，CLI 不支持；判定依据为存在 `uniCloud/` 目录或 `uniCloud.callFunction` 等调用
- nvue 与 vue 语义差异：不支持 v-html / transition / float；无 document / window / localStorage；Flexbox 为唯一布局模型且不支持 flex-shrink / flex-basis / align-content / flex 简写
