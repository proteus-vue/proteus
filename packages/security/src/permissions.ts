// packages/security/src/permissions.ts
// ★security-plan M3：PermissionRegistry 权限最小化 + withPermission 守卫 + PermissionDenied
// permission = `${resource}:${action}`（如 user:read）；granted 持久化（存 permission key，不存凭证）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

import type { StorageLike } from './secret-storage'

/** 缺权限异常（UI 层 catch → 引导授权/fallback；不静默失败，M3 铁律） */
export class PermissionDenied extends Error {
  permission: string
  constructor(permission: string) {
    super(`[proteus-security] 权限不足：${permission}`)
    this.permission = permission
    this.name = 'PermissionDenied'
  }
}

export interface PermissionRegistryOptions {
  /** 初始已授权集合 */
  initial?: string[]
  /** granted 持久化存储（默认不持久化；仅存 permission key） */
  storage?: StorageLike
  /** 持久化 key（默认 proteus.permissions） */
  key?: string
}

export interface GrantResult {
  granted: string[]
  denied: string[]
}

export class PermissionRegistry {
  private granted: Set<string>
  private storage?: StorageLike
  private key: string

  constructor(options: PermissionRegistryOptions = {}) {
    this.granted = new Set(options.initial ?? [])
    this.storage = options.storage
    this.key = options.key ?? 'proteus.permissions'
    this.load()
  }

  /** 从 storage 恢复（登出后 clear + 重新登录恢复） */
  load(): void {
    if (!this.storage) return
    const raw = this.storage.getItem(this.key)
    if (!raw) return
    try {
      const list = JSON.parse(raw) as string[]
      for (let i = 0; i < list.length; i++) this.granted.add(list[i])
    } catch {
      // 损坏 → 忽略（下次 grant 覆盖）
    }
  }

  private persist(): void {
    if (!this.storage) return
    const list: string[] = []
    this.granted.forEach((p) => list.push(p))
    this.storage.setItem(this.key, JSON.stringify(list))
  }

  has(permission: string): boolean {
    return this.granted.has(permission)
  }

  hasAll(permissions: string[]): boolean {
    for (let i = 0; i < permissions.length; i++) {
      if (!this.granted.has(permissions[i])) return false
    }
    return true
  }

  /** 授权（返回实际新增；自动持久化） */
  grant(permissions: string[]): void {
    for (let i = 0; i < permissions.length; i++) this.granted.add(permissions[i])
    this.persist()
  }

  /** 撤销（登出/角色切换） */
  revoke(permissions: string[]): void {
    for (let i = 0; i < permissions.length; i++) this.granted.delete(permissions[i])
    this.persist()
  }

  /** 清空（登出/角色切换全量） */
  clear(): void {
    this.granted.clear()
    this.persist()
  }

  /** 批量请求授权（结果分 granted/denied；授权策略由调用方注入——如 wx.authorize 弹窗） */
  request(permissions: string[], grantFn: (p: string) => boolean | Promise<boolean> = (p) => this.granted.has(p)): Promise<GrantResult> {
    return this.requestAsync(permissions, grantFn)
  }

  private async requestAsync(permissions: string[], grantFn: (p: string) => boolean | Promise<boolean>): Promise<GrantResult> {
    const granted: string[] = []
    const denied: string[] = []
    for (let i = 0; i < permissions.length; i++) {
      const p = permissions[i]
      if (this.granted.has(p)) {
        granted.push(p)
        continue
      }
      const ok = await grantFn(p)
      if (ok) {
        this.granted.add(p)
        granted.push(p)
      } else {
        denied.push(p)
      }
    }
    this.persist()
    return { granted, denied }
  }
}

/** 权限标识：`${resource}:${action}` */
export function permissionFor(resource: string, action: string): string {
  return resource + ':' + action
}

/**
 * withPermission 守卫：缺任一权限 → throw PermissionDenied（不执行 fn）
 * 用法：await withPermission(registry, ['camera:use'], () => capture())
 */
export async function withPermission<T>(registry: PermissionRegistry, permissions: string[], fn: () => T | Promise<T>): Promise<T> {
  if (permissions.length === 0) return fn()
  for (let i = 0; i < permissions.length; i++) {
    if (!registry.has(permissions[i])) throw new PermissionDenied(permissions[i])
  }
  return fn()
}
