# API 与配置设计

两份能力的**业务侧接口**——共同遵循"业务代码零改动"原则。

## 1. 纪念日灰度 API

### 1.1 配置（单一事实源）

```ts
// app.config.ts
export default defineProteus({
  memorial: {
    dates: ['04-04', '12-13'], // 本地兜底日期表
    intensity: 1,              // 0-1
    scope: 'all',              // 'all' | 'except-camera' | 'except-video'
    remote: 'https://cdn.example.com/memorial.json',
    includeSplash: true,       // 是否作用于启动页
  },
})
```

### 1.2 远端配置（优先级最高）

```json
{ "active": true, "dates": ["04-04"], "intensity": 1, "updatedAt": 1234567890 }
```

CLI / Runtime 在启动时 + 进入前台时拉取，命中即覆盖本地。

### 1.3 组合式 API（极少用，框架自动管理）

```ts
import { useMemorial } from '@proteus-vue/runtime'
const { active, intensity, setActive } = useMemorial()
// active 变化由框架自动驱动五端灰度层挂载/卸载
```

### 1.4 隐式组件（编译期识别，运行期挂载）

```vue
<!-- 框架自动包裹根节点，开发者不感知 -->
<p-view> ... </p-view>
```

编译产物中，Compiler 检测到 `memorial` 配置启用时，自动在页面根 IR 追加灰度指令，**业务代码零改动**。

## 2. 骨架屏 API

### 2.1 配置

```ts
export default defineProteus({
  skeleton: {
    routes: ['/', '/list', '/detail'], // 空 = 自动扫描 Vue Router
    mode: 'static',                    // static | hybrid
    appearance: { color: '#eee', animation: 'shimmer', radius: 8 },
    fixtures: { '/detail': { id: 1 } },
  },
})
```

### 2.2 运行时包裹（业务侧极简）

```vue
<p-skeleton :for="route" :loading="isLoading">
  <PageContent v-if="!isLoading" />
</p-skeleton>
```

- `:for` 关联路由，Compiler 据此生成对应骨架 IR；
- `:loading` 控制显隐；真实节点与骨架节点通过 `refKey` 对齐，过渡无闪屏。

### 2.3 手动精修（可选）

```vue
<p-skeleton override>
  <!-- 自动骨架不满足时，手动描述骨架结构 -->
  <p-block width="100%" height="200" radius="12" />
  <p-text :lines="3" />
</p-skeleton>
```

`<p-block>` / `<p-text>` / `<p-circle>` / `<p-image>` 是骨架语义原语，编译期映射到五端真实占位节点。

## 3. 组合能力（差异化卖点）

```vue
<!-- 纪念日 + 骨架屏 + Glass 一次声明 -->
<pg-glass preset="navigationBar">
  <p-skeleton :for="$route" :loading="loading">
    <NavContent />
  </p-skeleton>
</pg-glass>
```

悼念日：导航栏玻璃 + 全站灰度 + 骨架屏 **三者统一收敛**——这是 Proteus 相对 uni-app / RN / Flutter 独有的"声明式组合"体验。

## 4. 类型定义（Types plan 补充）

```ts
// @proteus-vue/types
export interface MemorialConfig {
  dates: string[]
  intensity: number
  scope: 'all' | 'except-camera' | 'except-video'
  remote?: string
  includeSplash?: boolean
}

export interface SkeletonConfig {
  routes?: string[]
  mode: 'static' | 'hybrid'
  appearance: { color: string; animation: 'shimmer' | 'pulse'; radius: number }
  fixtures?: Record<string, Record<string, unknown>>
}
```

全部纳入 `--strict-css` + `proteus doctor` 校验。
