# Proteus Music — 应用规格

> **150 页超级应用完整 PRD，作为全能力验证的"被验证对象"**

---

## 1.1 模块与页面分布（150 页）

### 核心模块（30 页）
```
player/  播放器：home / player / lyric / playlist / album / artist / radio (7)
discover/ 发现：recommend / top / category / search / history (5)
social/  社交：conversations / chat / contacts / feed (4)
```
> **注意**：此处列出的是代表性页面，完整 150 页通过"模块 × 子功能"组合生成（如 playlist 含创建/编辑/收藏/分享等子页）

### 交易模块（25 页）
```
trade/ 会员：vip / renew / benefits / invoice (4)
       商城：product / cart / checkout / order / refund / logistics (6)
       含子状态页（订单详情/物流跟踪/退款进度等 → 共 25 页）
```

### 内容模块（40 页）
```
video/   视频：feed / detail / collection / live (4)
podcast/ 播客：channel / episode / subscribe (3)
         含分类页/标签页/专题页等 → 共 40 页
```

### 设置/账户（20 页）
```
account/ 登录/注册/安全/通知/隐私 (5)
settings/ 主题/语言/存储/关于 (4)
         含子配置页 → 共 20 页
```

### 运营/活动（35 页）
```
campaign/ 活动/专题/广告落地/分享/邀请 (6)
          动态下发页 → 共 35 页（验证 Module 按需加载）
```

**总计 ≈ 150 页**

## 1.2 模块依赖关系（验证 Module 循环检测）

```
account ──→ user ──→ auth ──→ security
   ↑           ↑         ↑
trade ────────┘         │
   ↑                     │
social ──────────────────┘
   
content ─→ user (作者信息)
campaign ─→ trade (活动商品) + content (活动内容)
```

**关键交叉引用**（故意制造复杂度）：
- `trade → user → auth`：交易依赖用户信息，用户依赖鉴权
- `campaign → trade + content`：运营活动同时引用交易和内容模块
- **验收**：`proteus audit module` 检测出这条链无环 ✅

## 1.3 全局需求（贯穿所有页面）

| 需求 | 涉及层 | 说明 |
|------|--------|------|
| 全局播放条 | Component + Lifecycle + Pinia + API | appBar 常驻 |
| i18n（中/英/阿） | i18n + Component | RTL 支持 |
| 暗色模式 | Component + i18n | 运行时切换无闪烁 |
| 登录态 | Pinia + Security + Router | token 刷新 + 权限守卫 |
| 网络感知 | Platform + API | WiFi/4G 切换降级 |
| 性能预算 | Build + DevTools | 主包 < 500KB |

## 1.4 非功能需求（超级应用基线）

- **首屏 FCP** < 1.5s（Web SSR / Skyline 分包预加载）
- **长列表** 60fps 稳定（万条消息/瀑布流）
- **内存** < 150MB（万条消息场景）
- **冷启动到可交互** < 3s
- **分包下载** < 2s (4G)
- **全量审计** < 30s（150 页规模）

> 这些数字进 CI 性能预算，超标即失败（见 09-e2e-verification.md）

---
