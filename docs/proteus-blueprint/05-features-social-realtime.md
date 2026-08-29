# 功能域 3 & 4：社交实时 + 内容发现

> **目标**：验证 Component(ListView 虚拟滚动) + Module(分包) + API(WebSocket) + Performance 四层
> **说服力**：IM 长列表 + 无限瀑布流是"超级应用性能"的经典考题

---

## 5.1 社交模块 — IM 长列表（功能域 3）

### 页面清单

| 页面 | 路径 | chunk | 说明 |
|------|------|-------|------|
| 会话列表 | `/social/conversations` | social | 首屏必需 |
| 聊天页 | `/social/chat/:id` | social | **万级消息长列表** |
| 联系人 | `/social/contacts` | social | 分页加载 |
| 动态广场 | `/social/feed` | social | 无限瀑布流 |

### 核心挑战：聊天页 10000 条消息

```vue
<!-- pages/social/chat/[id].vue -->
<template>
  <p-list-view
    :items="messages"
    item-key="id"
    :virtual="true"
    :recycle="true"
    @scroll="onScroll"
  >
    <template #item="{ item }">
      <message-bubble :msg="item" />
    </template>
  </p-list-view>
</template>
```

**验收点（Component M7 性能基线）**：
- [ ] 10000 条消息 → 首屏渲染 < 500ms
- [ ] 滚动 60fps 稳定（Skyline DevTools Performance 面板）
- [ ] 内存：渲染 10000 条后内存 < 150MB（自动回收离屏节点）
- [ ] 快速滚动到底部 → 不白屏、不丢消息
- [ ] `recycleManager` 复用 DOM 节点（DOM 节点数 < 200，不论列表多长）

### WebSocket 实时通信（API + Security）

```ts
// api/realtime.ts
export function connectRealtime() {
  const auth = useAuthStore()
  const socket = wx.connectSocket({
    url: `wss://api.example.com/ws?token=${auth.token}`,
  })

  // Security: token 过期自动刷新 + 重连
  socket.onClose(() => {
    if (auth.isTokenExpired) {
      await auth.refresh()  // ← Security B2 防重放
      connectRealtime()     // 用新 token 重连
    }
  })
}
```

**验收点**：
- [ ] token 过期 → 自动刷新 → 重连成功（无消息丢失）
- [ ] 断网 30s → 重连 → 补拉离线消息（消息序号连续性校验）
- [ ] Security: `proteus audit security` 无 `wx.connectSocket` 裸调用（必须走 capability）

### 分包策略（Module B5 + Router M7.1）

```ts
// proteus-module.config.ts
export default defineModule({
  name: 'social',
  chunk: 'social',           // ← 整个 social 模块 = 1 个分包
  preload: ['home'],          // 首页加载后再预加载
  dependencies: ['user'],     // 依赖 user 模块（必须 user 先就绪）
})
```

**验收点**：
- [ ] `dist/mp/subPackages/social/` 独立分包，主包不包含 social 代码
- [ ] 首次进入聊天页 → 触发分包下载 → 下载进度 UI
- [ ] `proteus audit module` 检测：social → user → auth 无循环依赖

---

## 6.1 内容模块 — 瀑布流发现（功能域 4）

### 页面清单

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页推荐 | `/` | **SSR + 瀑布流** |
| 排行榜 | `/discover/top` | 分类切换 |
| 搜索 | `/discover/search` | 防抖 + 历史 |
| 视频详情 | `/video/:id` | 沉浸式滑动 |

### SSR 首屏（Web 端）

```ts
// server-entry.ts
export default defineApp({
  // ← Lifecycle 阶段化：SSR 只跑 bootstrap + coreReady
  bootstrap(ctx) {
    // 不执行 onShow（服务端无页面可见概念）
  },
  coreReady(ctx) {
    // hydrate Pinia state → 内联到 HTML
  },
})
```

**验收点**：
- [ ] Web 首屏 FCP < 1.5s（SSR HTML 直出）
- [ ] Skyline：无 SSR（MPA 天然首屏快），但首屏数据请求并行
- [ ] hydration 后状态一致（无 hydration mismatch 警告）

### 无限瀑布流 + 图片优化

```vue
<p-list-view
  :items="feeds"
  :virtual="true"
  @reach-bottom="loadMore"
>
  <template #item="{ item }">
    <feed-card
      :cover="item.cover"
      :lazy="true"           <!-- ← 图片懒加载 -->
      :placeholder="true"    <!-- ← 骨架屏 -->
    />
  </template>
</template>
```

**验收点**：
- [ ] 图片懒加载：进入视口才请求（Network 面板验证）
- [ ] 骨架屏占位：数据加载前不闪烁
- [ ] 触底加载：第 2、3、4... 页数据追加，无重复
- [ ] 内存：滚动 100 页后内存稳定（不持续增长）

---

## 7.1 跨层集成契约（功能域 1-4 汇总）

> 对应 `07-cross-layer-integration.md` 的完整验证矩阵

### 覆盖矩阵（150 页 × 15 层）

| 层 | 验证页面 | 验收输出 |
|----|---------|---------|
| Compiler | 全部 150 页 | `--trace-transform` 产物映射 |
| Router | 交易 8 页 + 播放页 | 权限守卫自动生成 |
| Pinia | 播放器 + 订单 + 聊天 | 分片 hydrate + 状态恢复 |
| API | 支付 + WebSocket + 搜索 | 签名 + 重连 + 防抖 |
| Component | 聊天长列表 + 瀑布流 | 60fps + 内存稳定 |
| Platform | 后台音频 + WebSocket | capability 探测 |
| Lifecycle | 播放器 + 订单恢复 | 冷热启动 + recover |
| Module | social + trade + content | 分包 + 循环检测 |
| Security | 支付 + WebSocket | 签名 + token 刷新 |
| i18n | 交易 + 设置 | 复数 + RTL + 分包 |
| DevTools | 播放全流程 | 六泳道时间轴 |

### 全链路 trace 示例

```
用户在「首页」点击歌曲 → 播放 → 切到「聊天页」→ 收到消息 → 切后台 → 杀进程

DevTools 时间轴（60 秒跨度）：
──────────────────────────────────────────────────────────────
Lifecycle  │─onLaunch─│─coreReady─│──────────onShow──────────│
Router      │         │ / → /player │ /player → /social/chat │
Pinia       │         │ playerStore │          chatStore      │
            │         │  play(t123) │          ws.onmessage   │
API         │         │ audio.play │          ws.send        │
Platform    │         │ getBack... │          connectSocket  │
Component   │         │ <player-bar>│          <p-list-view>  │
──────────────────────────────────────────────────────────────
                                                    ↑ onHide → pause()
                                                    ↑ onDestroy → 紧急持久化
                                                    ↑ onRecover → 恢复播放 + 未读消息
```

**验收点**：
- [ ] 60 秒完整链路在 DevTools 可追溯
- [ ] `--trace-*` 六源数据可导出为 `.proteus-trace.json`
- [ ] 导入 trace 文件 → 完整复现 bug 现场

---
