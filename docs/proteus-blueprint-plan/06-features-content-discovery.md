# 功能域 4：内容发现（SSR + 瀑布流 + 虚拟滚动）

> **目标**：验证 Component(ListView 虚拟滚动) + Lifecycle(SSR) + API(流式加载) + Performance 四层
> **说服力**：首页瀑布流是"首屏性能 + 无限滚动"的双重压力测试

---

## 6.1 页面清单

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页推荐 | `/` | **SSR + 瀑布流** |
| 排行榜 | `/discover/top` | 分类切换 + 虚拟滚动 |
| 搜索 | `/discover/search` | 防抖 + 历史 |
| 视频详情 | `/video/:id` | 沉浸式滑动 |

## 6.2 SSR 首屏（Web 端）

```ts
// server-entry.ts
export default defineApp({
  // Lifecycle 阶段化：SSR 只跑 bootstrap + coreReady
  bootstrap(ctx) {
    // 服务端不执行 onShow（无页面可见概念）
  },
  coreReady(ctx) {
    // hydrate Pinia state → 内联到 HTML <script>
    ctx.hydrate = serializePinia(ctx.pinia)
  },
})
```

**验收点**：
- [ ] Web 首屏 FCP < 1.5s（SSR HTML 直出）
- [ ] Skyline：无 SSR（MPA 天然首屏快），但首屏数据请求并行
- [ ] hydration 后状态一致（无 hydration mismatch 警告）
- [ ] `--trace-lifecycle` 显示 SSR 阶段耗时

## 6.3 无限瀑布流 + 虚拟滚动

```vue
<!-- pages/discover/top.vue -->
<template>
  <p-list-view
    :items="feeds"
    item-key="id"
    :virtual="true"
    :recycle="true"
    @reach-bottom="loadMore"
    @scroll="onScroll"
  >
    <template #item="{ item }">
      <feed-card
        :cover="item.cover"
        :lazy="true"
        :placeholder="true"
      />
    </template>
  </p-list-view>
</template>
```

**验收点**：
- [ ] 图片懒加载：进入视口才请求（Network 面板验证）
- [ ] 骨架屏占位：数据加载前不闪烁
- [ ] 触底加载：第 2、3、4... 页数据追加，无重复
- [ ] 万条瀑布流滚动 60fps（DevTools Performance 面板）
- [ ] 内存：滚动 100 页后内存稳定（不持续增长）
- [ ] `recycleManager` 复用节点（DOM 节点数 < 200）

## 6.4 流式加载 + 防抖（API）

```ts
// api/feed.ts
export async function* loadFeedStream(category: string) {
  let page = 1
  while (true) {
    const { items, hasMore } = await request.get('/api/feed', {
      params: { category, page },
      // 防抖：避免快速切换分类导致竞态
      debounce: 300,
    })
    yield items
    if (!hasMore) break
    page++
  }
}
```

**验收点**：
- [ ] 快速切换分类 → 只保留最后一次请求结果（竞态取消）
- [ ] 搜索输入防抖 300ms → 不每字请求
- [ ] 离线缓存：上次数据秒开 + 后台刷新

## 6.5 性能预算（对齐 Build M7）

| 指标 | 基线 | 验证工具 |
|------|------|---------|
| 首屏 FCP | < 1.5s | Lighthouse / Skyline Trace |
| 瀑布流首屏渲染 | < 500ms | DevTools Performance |
| 滚动帧率 | 60fps | DevTools FPS Meter |
| 内存（万条） | < 150MB | 真机 Memory |
| 图片请求数 | 视口内 ≤ 10 | Network 面板 |

**验收点**：
- [ ] 性能预算进 CI（超标 → 失败）
- [ ] `--measure` 输出结构化 JSON → DevTools dashboard
- [ ] 性能趋势图（每次 PR 对比）

---

## 跨功能域依赖

```
内容发现 ─→ user (作者信息)
          ─→ player (点击播放)
          ─→ social (点赞/评论)
```

**验收**：`proteus audit module` 确认 content → user → auth 链无环

---
