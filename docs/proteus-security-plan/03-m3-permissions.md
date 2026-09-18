# M3 - Permission System（权限最小化 + 守卫）

> capability 调用 / 路由跳转前必须 `withPermission`；缺权限 → 显式 `PermissionDenied`，不静默失败。对接 Router 权限树、Platform capability。

## 1. 权限模型

```
permission = `${resource}:${action}`   // e.g. "user:read", "trade:create"
role       = permission[]              // e.g. "admin" / "guest"
```

## 2. API

```ts
// 声明依赖权限（组件 / 函数）
export const useCamera = defineCapability('camera', {
  permissions: ['camera:use'],
  scope: 'scope.camera',   // 小程序 wx.authorize 的 scope
})

// 调用前守卫
const camera = useCamera()
await camera.withPermission(async () => {
  return camera.capture()
})
// 缺权限 → throw PermissionDenied（UI 层 catch → 引导授权弹窗）
```

## 3. Router 权限树对接（M8.1 回顾）

```ts
// route meta
definePage({
  path: '/trade/create',
  meta: { permissions: ['trade:create'] },   // ← M3 自动生成守卫
})
```

编译期 / 运行时生成 `beforeEach`：
```ts
router.beforeEach((to) => {
  const required = to.meta.permissions ?? []
  if (!auth.hasAll(required)) {
    return { name: 'forbidden', query: { from: to.path } }
  }
})
```

## 4. Platform Capability 权限映射

| Capability | Web | Skyline | App |
|-----------|-----|---------|-----|
| camera | `getUserMedia` + HTTPS | `wx.authorize('scope.camera')` | `AVCaptureDevice` |
| location | Geolocation API | `scope.userLocation` | CLLocationManager |
| storage-write | 默认允许 | 需在 `app.json` 声明 | 运行时弹窗 |

`defineCapability({ permissions, scope })` 的 `scope` 字段编译期映射到各平台授权 API。

## 5. 运行时：PermissionRegistry

```ts
class PermissionRegistry {
  granted = new Set<string>()
  async request(perms: string[]): Promise<GrantResult>
  has(perm: string): boolean
  hasAll(perms: string[]): boolean
}
```

状态持久化：`granted` 集合存 `encrypted`（对接 M1），但仅存 permission key，不存凭证。

## 6. UI 降级策略（缺权限不白屏）

```vue
<PermissionGate :requires="['camera:use']">
  <CameraCapture />
  <template #fallback>
    <button @click="requestCamera">开启相机权限</button>
  </template>
</PermissionGate>
```

## 7. 编译期规则

- 业务代码直接调 `wx.authorize` / `navigator.geolocation` → 报错，要求走 `defineCapability`
- Router `meta.permissions` 未声明但组件用了 capability → warning（建议声明）
- `audit security` 输出权限矩阵：`capability × page × role`

## 8. 测试

- 缺权限调用 → throw `PermissionDenied`，UI 显示 fallback
- 授权后再次调用 → 成功（granted 缓存生效）
- 权限变更（登出/切换角色）→ registry 清空
- 权限矩阵快照 diff（回归：新增 capability 是否在所有页面声明）

## 9. 验收

- [ ] 所有敏感 capability 必经 `withPermission`
- [ ] 缺权限不静默、不白屏（fallback UI）
- [ ] Router 守卫自动生成，无需手写 `beforeEach`
- [ ] 权限矩阵 `audit security --report=permissions` 可导出
