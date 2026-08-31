# 08 · 迁移指南与反例清单

## 1. 从 uni-app x 迁移

### 主题

```javascript
// Before: uni-app x
// manifest.json 各平台节点 + theme.json + App.vue 手动读 storage
export default {
  onLaunch() {
    const theme = uni.getStorageSync('theme') || 'light'
    // 手动设置，可能"来不及"
  }
}

// After: Proteus
export default defineApp({
  theme: { source: 'system', tokens: {...} },  // 单一配置
})
// 组件内：:class="$theme.card" —— 全自动，无样板
```

### 字体

```javascript
// Before: uni-app，仅跟随系统，无应用级 API
// 需手动监听系统变更 + 全局 state

// After: Proteus
$proteus.font.setScale(1.2)  // 一行
```

### 缓存

```javascript
// Before: uni-app
uni.setStorageSync('user', data)  // 单层，无预算，无淘汰

// After: Proteus
$proteus.cache.set('user:me', data, { ttl: 300_000 })  // 自动分层 + 字节预算
```

## 2. 从 React Native 迁移

```javascript
// Before: RN —— 手写 Provider + useMemo
const styles = useMemo(() => createStyles(theme, size), [theme, size])

// After: Proteus —— 编译期优化 + Proxy 追踪
<p-text class="body">  <!-- 自动响应式 -->
```

## 3. 反例清单（禁止面）

### 主题
- ❌ 硬编码色值 `#000`/`#FFF`（**CSS016**）
- ❌ `:root { @media prefers-color-scheme }` 期望五端生效（Skyline 不支持）
- ❌ 业务层直接读 storage 判断主题（交给框架）
- ❌ 用 `v-if="isDark"` 手写两套模板（用 `$theme` token）

### 字体
- ❌ `font-size: 16px` 写死（**FONT002**，除 1px 边框）
- ❌ 全局关闭缩放（accessibility anti-pattern，框架禁止）
- ❌ 固定高度容器包裹可缩放文本（**FONT001**，防截断）
- ❌ Android 用 `dp` 做字号（必须用 `sp`）

### 缓存
- ❌ 直接 `wx.setStorage` / `localStorage.setItem`（**CACHE001**，绕过分层）
- ❌ 无版本前缀的 key（**CACHE002**：`v1:user:123`）
- ❌ 缓存整棵大对象（**CACHE003**：拆 key 按需失效）
- ❌ 主线程大量序列化（**CACHE004**：Worker / Codable 异步）
- ❌ 明文存 token（**CACHE005**：MMKV/AES 加密）

## 4. FAQ

**Q：主题切换会重渲整棵树吗？**
A：不会。静态 token（`:class="$theme.card"`）编译期为静态样式表，运行时只切根节点 O(1)；动态 token 经 Vue Proxy 精确追踪到节点。

**Q：字体缩放卡吗？**
A：不卡。用 CSS 变量 `calc(base * var(--font-scale))`，改一个变量全树联动，**GPU 合成层处理，不进 JS 线程**（对比 RN 需重建 StyleSheet）。

**Q：缓存 L0 满了会 OOM 吗？**
A：不会。① LRU 自动淘汰 ② iOS `NSCache` 响应内存警告自动清空 ③ 字节预算由设备分级决定 ④ 对接 Memory Plan 的 LeakRegistry 验证回落。

**Q：Skyline 只有 10MB storage 怎么存大文件？**
A：大文件（图片/视频）走 `wx.saveFile` 文件系统，不走 KV。框架自动路由。

**Q：为什么不用 CSS-in-JS 全动态主题？**
A：性能差（RN 已验证需 useMemo 手动优化）。Proteus 用 **CSS 变量 + 编译期静态分析** → 兼顾动态性与性能。
