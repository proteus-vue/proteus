# G-60 架构

## 1. 整体形态：一个站点，四个区

```
proteus.dev
├─ /           营销落地页      （Studio 是什么 / 吉祥物 3D / 三大能力）
├─ /docs/      文档站          （★ Docusaurus，版本化）
│   ├─ /docs/latest/           别名 → 当前版本
│   ├─ /docs/0.4/              具体版本快照
│   └─ /docs/0.3/
├─ /api/       插件 API 参考    （★ 从 WIT 生成，非手写）
├─ /download   下载与更新       （平台矩阵 + 签名验证）
└─ /plugins    插件市场         （G-61，本份仅定义接口）
```

**关键结构决策**：`/api` 与 `/docs` 分离。
因为 `/api` 是**生成的**（renderer），`/docs` 是**人写的**（指南/教程）。
混在一起会导致"手写的被生成覆盖"或"生成的手工改过"。

## 2. 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 文档站 | **Docusaurus** | 版本化为**内置核心特性**，不押社区插件（P3） |
| 落地页 | Astro / 静态生成 | 与文档站解耦，可独立迭代 |
| API 参考 | **自研 WIT renderer** | 无现成方案；WIT 非 OpenAPI |
| 搜索 | Pagefind / 本地索引 | 免费、离线可用，OSS 项目够用 |
| 部署 | 静态托管 + CI | 快照由 tag 触发（P2.1） |

### 为什么是 Docusaurus 而不是 VitePress

不是因为流行度（两个来源的周下载量差 6 倍，不可靠），
而是因为**版本化是唯一无法妥协的需求**，而：

| 方案 | 版本化来源 | 风险 |
|------|-----------|------|
| Docusaurus | 平台内置 | 无 |
| VitePress | 自定义内容结构，**无等价插件** | 自建即维护 |
| Starlight | 社区插件 `starlight-versions` | 依赖第三方维护意愿 |

**这条判据与我们 G-59 的论证同构**：
G-59 主张"最关键的契约应当是平台级能力，不应依赖社区插件"。
我们对别人的生态提这个要求，自己选型时更要遵守。

## 3. ★ 插件 API 文档生成链（本份核心）

```
WIT 定义（唯一数据源，随代码走）
   │
   ├─→ 生成 Rust / TS 客户端绑定
   ├─→ 生成 /api 参考页          ← renderer，不是 copy
   ├─→ wit-lint                  ← 缺描述 / 缺错误码 → FAIL
   ├─→ wit-diff --breaking       ← 移除 API / 新增必填参数 / 收窄枚举 → FAIL
   └─→ 漂移检测                  ← 生成的 hash ≠ 当前 spec hash → FAIL
```

**四个闸门，全部在 PR 阶段执行**，不部署后才发现问题。

### 3.1 漂移检测的具体机制

```typescript
interface GeneratedDoc {
  sourceHash: string   // 生成时记录的 spec hash
  pages: DocPage[]
}

function checkDrift(spec: ApiSpec, doc: GeneratedDoc): DriftResult {
  return spec.hash() === doc.sourceHash
    ? { status: 'fresh' }
    : { status: 'stale', expected: spec.hash(), actual: doc.sourceHash }
}
```

> **这条的意义**：把"文档会不会过期"从**纪律问题**变成**机器可判定的事实**。
> 你没法靠自觉保证文档不漂移，但可以让 CI 在漂移的那一秒就报错。

### 3.2 破坏性变更分类

| 变更 | 分类 | 阻断 |
|------|------|------|
| 新增 API | added | 否 |
| 新增**可选**参数 | changed | 否 |
| 新增**必填**参数 | changed | **是** |
| 移除 API | removed | **是** |
| 收窄返回类型 | changed | **是** |
| 放宽返回类型 | changed | 否 |
| 仅改描述 | changed | 否 |

与 `oasdiff --breaking` 的判据一致（P4）。

## 4. 版本化架构

### 4.1 版本状态机

```
active ──→ maintenance ──→ deprecated ──→ archived
  │              │              │             │
  最新           仅修错误      EOL 倒计时     仅存档
```

存于 `versions.json`（**元数据驱动**，P2.4）：

```json
{
  "versions": [
    { "id": "0.4", "status": "active",      "released": "2026-08-01" },
    { "id": "0.3", "status": "maintenance", "released": "2026-05-01" },
    { "id": "0.2", "status": "deprecated",  "released": "2026-02-01", "eol": "2026-11-01" },
    { "id": "0.1", "status": "archived",    "released": "2025-11-01", "eol": "2026-05-01" }
  ],
  "policy": { "keepActive": 3 }
}
```

### 4.2 保留策略

业界通行：**当前 + 前两个 major**（P2.5）。
超出 `keepActive` 的版本自动成为 **archived 候选**，由 CI 提示，**不自动删除**
（删除是破坏性操作，需人工确认）。

### 4.3 每页注入（由元数据驱动，非手工）

| 状态 | 横幅 | noindex |
|------|------|---------|
| active | 无 | 否 |
| maintenance | 蓝色信息条 + 最新版链接 | 否 |
| deprecated | **黄色警告 + EOL 日期 + 最新版深链** | **是** |
| archived | 灰色存档提示 | **是** |

### 4.4 canonical URL

所有版本页的 `<link rel="canonical">` **一律指向 latest 等价页**（P2.6），
避免多版本重复内容稀释 SEO。

## 5. 下载与更新

```
浏览器访问 /download
   ↓ 检测 platform / arch
DownloadMatrix.pick(target, arch)
   ↓ 命中
返回 { url, signature, version, releaseNotes }
   ↓ 未命中
明确返回 null —— ★ 不猜测、不降级到近似平台
```

**Tauri updater endpoint**（官方变量）：

```
https://releases.proteus.dev/{{target}}/{{arch}}/{{current_version}}
```

生产模式**强制 TLS**（官方约束）。

### 私钥铁律（P5，不可降级）

> 私钥丢失 = **永久**失去向已安装用户推送更新的能力。

- 存 CI 加密 secret
- **离线冷备份**（异地多份）
- 轮换需走正式流程，且**旧公钥必须继续保留在旧版本 app 内**

## 6. 品牌一致性

官网必须与既有两个视觉资产同源：

| 资产 | 用法 |
|------|------|
| 小程序头像（E 竖版 SVG） | favicon / OG image / 小程序入口 |
| 3D 变形水滴 | 落地页右下角吉祥物 |
| 配色 `#00C7C9 → #019CB3 → #016F9A` | 全站主色 |

**吉祥物在官网的形态**：仍是可点击变形的 3D 组件，
但它同时承担一个额外职责——**点击形态切换时，落地页的能力介绍区同步切换**。
这样吉祥物不是装饰，而是导航。

## 7. 成熟度

| 阶段 | 内容 |
|------|------|
| L0 | 静态页 + 手写文档（**当前行业默认，也是漂移高发态**） |
| L1 | 版本化文档站 + 元数据驱动横幅 |
| **L2** | **★ API 文档从 WIT 生成 + 漂移阻断** |
| L3 | 插件市场 + 性能预算公示看板 |
