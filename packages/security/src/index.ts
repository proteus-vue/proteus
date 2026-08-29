// packages/security/src/index.ts
// @proteus/security —— 三端统一安全基线（security-plan B1-B2）
// M1：SecretStorage 敏感字段加密存储（cipher.ts + secret-storage.ts）
// M3：PermissionRegistry 权限最小化 + withPermission（permissions.ts）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 _proteus/security 进 MP）
export type { Cipher } from './cipher'
export { createWebCipher, createDemoCipher, createCipher, hasWebCrypto } from './cipher'
export type { FieldDescriptor, StorageLike, SecretStorageOptions } from './secret-storage'
export { SecretStorage } from './secret-storage'
export type { PermissionRegistryOptions, GrantResult } from './permissions'
export { PermissionRegistry, PermissionDenied, permissionFor, withPermission } from './permissions'
