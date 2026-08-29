# 02 · Adapter 注册与选择（M2）

## 目标

> **统一管理“哪个平台用哪个实现”，业务不感知。**

---

## 1. Adapter 结构

```ts
export interface Adapter<T extends CapabilityAPI> {
  capability: string
  platform: 'web' | 'skyline' | 'app'
  priority?: number

  isSupported(): boolean | Promise<boolean>
  create(): T
}
```

---

## 2. 注册方式

```ts
// platforms/skyline/share.adapter.ts
export default defineAdapter({
  capability: 'share',
  platform: 'skyline',
  priority: 10,

  isSupported() {
    return wx.canIUse('shareAppMessage')
  },

  create() {
    return {
      isSupported: () => true,
      share(options) {
        return wx.shareAppMessage(options)
      },
    }
  },
})
```

---

## 3. Registry（注册中心）

```ts
class CapabilityRegistry {
  private map = new Map<string, Adapter[]>()

  register(adapter: Adapter) {
    const list = this.map.get(adapter.capability) || []
    list.push(adapter)
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    this.map.set(adapter.capability, list)
  }

  resolve(id: string): Adapter | undefined {
    const list = this.map.get(id)
    return list?.find(a => a.isSupported())
  }
}
```

---

## 4. 选择策略

1. 按 `platform` 过滤
2. 按 `priority` 排序
3. 调用 `isSupported()`
4. 命中第一个
5. 无命中 → 使用 fallback（如配置）

---

## 5. 多实例隔离

- 每个能力实例 **绑定当前运行时环境**
- SSR / Worker 场景使用独立 registry
- 禁止全局可变副作用

---

## 6. Skyline 注意事项

- Adapter 不得在模块顶层执行 `wx.*`
- 所有探测延后到 `isSupported()`
- Worklet 能力需标注 `runsInWorklet: true`

---

## 7. 编译期约束

CLI 检查：

- 同一 capability + platform 只能有一个 adapter
- 每个 capability 至少存在一个 adapter
- fallback 必须真实存在

---

## 8. 验收

- [ ] Adapter 可动态注册
- [ ] 优先级生效
- [ ] 缺失能力返回 fallback
- [ ] 单测覆盖 Web / Skyline / App
