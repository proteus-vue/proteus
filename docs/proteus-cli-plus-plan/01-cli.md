# Proteus CLI & 工程化 —— 开发者入口体验

> 执行位：**G-33**（P0）· 第 34 份 plan
> 依赖：`proteus-compiler-plan`（B1 产物）、`proteus-router`（G-32）、Architecture 原则 #10
> 目标：让 `proteus create` / `dev` / `build` 成为开发者接触框架的第一面，**配置即类型安全**、**构建即五端产物**。

---

## 1. 问题定义

### 1.1 为什么 CLI 是 P0

32 份 plan 再完美，如果开发者无法 `proteus create my-app && proteus dev` 跑起 hello world，框架就只是"设计文档"。**CLI 是框架从设计到可用的第一道门**。

### 1.2 竞品 CLI 痛点

| 方案 | CLI | 缺陷 |
|------|-----|------|
| uni-app | `vue create` + HBuilderX | 黑盒构建，配置碎片化（pages.json/manifest.json/...） |
| uni-app x | HBuilderX 一键 | 强绑定 IDE，无独立 CLI，CI 困难 |
| RN | `react-native-cli` / Expo | iOS/Android 原生工程手动维护，升级痛苦 |
| Flutter | `flutter create/build` | 完整但自绘，无 Web/小程序 |
| Vite | `vite create/dev/build` | ✅ 体验标杆（Proteus 借鉴） |

**Proteus 目标**：Vite 的开发体验 + uni-app 的五端能力 + RN 的原生桥接。

---

## 2. 核心命令

```bash
# 创建项目（模板即类型安全配置）
proteus create my-app --template default  # 含 Web + Skyline + App(iOS/Android/鸿蒙)

# 开发（多端并行，HMR）
proteus dev --targets web,skyline,ios,android,harmony

# 构建（五端产物）
proteus build --targets all --mode production

# 单端产物
proteus build --target ios       # .ipa
proteus build --target android   # .apk / .aab
proteus build --target harmony   # .hap
proteus build --target web       # dist/
proteus build --target skyline   # 小程序包

# 校验（联动所有 --strict-*）
proteus check --strict-css --strict-style --strict-router
```

---

## 3. 配置文件：`proteus.config.ts`（类型安全）

```typescript
import { defineProteus } from '@proteus-vue/config'

export default defineProteus({
  // 五端统一入口（单一事实源）
  entry: 'src/main.ts',

  // 各端配置（语义层，框架映射到原生）
  targets: {
    web: { output: 'dist' },
    skyline: { appid: 'wx-xxx' },
    ios: { bundleId: 'vue.proteus.demo', teamId: 'ABC' },
    android: { package: 'vue.proteus.demo' },
    harmony: { bundleName: 'vue.proteus.demo' }
  },

  // 能力开关（联动横切层）
  features: {
    glass: true,        // G-07
    safeArea: true,     // G-09
    memorial: true,     // G-11
    skeleton: true,     // G-12
    styleSafety: true,  // G-31
    strictRouter: true  // G-32
  },

  // 主题/字体/缓存（联动 G-13/14/15）
  theme: { default: 'light', tokens: './theme.tokens' },
  fontScale: { enabled: true, min: 0.8, max: 2.0 },
  cache: { budget: '50mb' },

  // 路由（联动 G-32）
  router: { deepLink: { scheme: 'proteusdemo' } }
})
```

**`defineProteus` 提供完整 TS 类型推导 + 默认值 + 校验** —— 配置错误在 IDE 即时报错（借鉴 Vite）。

---

## 4. 项目模板

```
my-app/
├─ proteus.config.ts          # 类型安全配置（单一事实源）
├─ src/
│  ├─ main.ts                # 入口
│  ├─ App.vue
│  ├─ pages/                 # 页面（含 <route> 块）
│  ├─ components/            # p-* 组件
│  ├─ theme.tokens.ts        # 主题 token（G-13）
│  └─ platform/              # 各端原生扩展（JSI binding）
│     ├─ ios/
│     ├─ android/
│     └─ harmony/
├─ .proteus/                 # 构建缓存 + 各端工程（自动生成，可删）
│  ├─ ios/                   # Xcode 工程（自动同步）
│  ├─ android/               # Gradle 工程
│  └─ harmony/               # DevEco 工程
└─ package.json
```

**关键**：`src/` 是开发者唯一需要维护的；`.proteus/` 下的原生工程**由 CLI 自动同步生成**（类比 RN 的 codegen，但更彻底）。

---

## 5. 构建流水线

```
src/ (SFC + <route> + p-*) + proteus.config.ts
    ↓ Compiler（多 target 并行）
    ├─ Web       → JS + CSS (Vite/Rollup)
    ├─ Skyline   → WXML + WXSS
    ├─ iOS       → JSI binding + Swift + IR → AOT
    ├─ Android   → JSI binding + Kotlin + IR → AOT
    └─ Harmony   → JSI binding + ArkTS + IR → AOT
    ↓
各端产物（.ipa/.apk/.hap/dist/小程序包）
```

**每个 target 复用同一份 IR**，只换后端（原则 #10）。

---

## 6. 严格规则（--strict-cli）

| 编号 | 规则 | 处理 |
|------|------|------|
| CLI001 | `proteus.config.ts` 校验失败 | error |
| CLI002 | 缺失必要 target 配置 | error |
| CLI003 | 能力开关冲突（如 glass:true 但 target 不支持） | warn |

`proteus check` 聚合所有 strict 开关（CSS/Style/Router），**一键全量校验**。

---

## 7. 分批策略

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| **M1** | CLI Core：`create`/`dev`/`build` 骨架 + `defineProteus` 类型 | Compiler B1 | ✅ 纯逻辑 |
| **M2** | Web + Skyline 构建（复用 Vite/Rollup） | Compiler M1 | ✅ |
| **M3** | 原生工程自动同步（iOS/Android/鸿蒙） | App Renderer M2/M3 | 🔶（★鸿蒙样板已打通：`create host` + `build --package`；见 §10） |
| **M4** | CI/CD 模板 + 发布流水线 | all | 🔶 |

**M1 零依赖可单测** —— `create` 模板拷贝 + 配置校验，纯 Node.js。

---

## 8. 对标

| 能力 | uni-app | RN | Flutter | Vite | **Proteus** |
|------|---------|----|---------|----|----|------|
| 独立 CLI | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 类型安全配置 | ❌ JSON | ❌ | ❌ | ✅ | ✅ |
| 五端一键构建 | ✅(HBuilderX) | ❌ | ❌(仅移动) | ❌ | ✅ |
| 原生工程自动同步 | ⚠️ | ❌ 手动 | ✅ | — | ✅ |

---

## 9. 关联

- Compiler（B1 产物）、Router（G-32）、所有横切能力（G-07~G-16）
- Architecture 原则 #10：配置语义 → 各端构建产物

---

## 10. 宿主生成 / 打包（hosts 第二刀 Stage 2，2026-10-07）

> **背景**：此前 hosts/* 把「项目无关的引擎/运行时」与「项目身份 + 验证装置」混在一起（见 hosts/README-LAYERS.md），
> 对 CLI 生成宿主、正式打包、安全维护都不利。分层落地（第一刀）+ runtime 抽为可依赖单元（第二刀）后，
> 「宿主」可由 CLI 生成。

**命令**
```bash
proteus create host harmony <dir> [--name <应用名>] [--bundle <包名>] [--project <项目根>]
proteus build --target harmony --package --host-dir <dir>   # 编译项目内容 + 调 hvigorw 打包 .hap
```

**生成形态**（`packages/cli/templates-host/harmony`）：`AppScope/` + `entry/`（最小壳：EntryAbility + MainPage）
+ `proteus_render/`（runtime HAR，从框架同源复制）+ `proteus.host.json` + `build-profile.template.json5`。
**壳零项目身份**：EntryAbility 只交生命周期给 runtime + 上报 READY；MainPage 只渲染 rawfile 编译产物。
**打包**：`--package` 只「壳调 hvigorw」（不自研工具链）；先 `ohpm install`（file: 依赖 → 跨模块 native 聚合）。

**诚实边界**：① 只做**鸿蒙样板**（Android/iOS 留下一轮）；② runtime 发布形态仍是"框架 checkout 同源复制"
（可注入 `PROTEUS_HOST_RUNTIME_DIR`；独立发布包列为后续）；③ **华为 CA 签名属机器本地**——模板给
`signingConfigs: []`（unsigned 可构建、不能装机），装机需在 DevEco 勾选一次 "Automatically generate signature"。
**安全**：`check:secret-scan` 门禁扫 git 跟踪面（签名/密钥/明文口令不得入库）。
