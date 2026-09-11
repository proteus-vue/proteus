---
title: useFileSystem (capability.file-system)
group: 存储与文件
order: 2003
---

# useFileSystem

useFileSystem: file system handle (wx.getFileSystemManager / web in-memory fallback)

> Capability primitive C43 · `capability.file-system` · returns `FSAdapter` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useFileSystem(): FSAdapter
```

## Returns

Returns `FSAdapter` (synchronous handle/state object).

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`readFile`](#readfile) | `readFile(path: string): Promise<CapResult<string>>` | — |
| [`writeFile`](#writefile) | `writeFile(path: string, data: string): Promise<CapResult<void>>` | — |
| [`appendFile`](#appendfile) | `appendFile(path: string, data: string): Promise<CapResult<void>>` | — |
| [`copyFile`](#copyfile) | `copyFile(src: string, dest: string): Promise<CapResult<void>>` | — |
| [`rename`](#rename) | `rename(oldPath: string, newPath: string): Promise<CapResult<void>>` | — |
| [`remove`](#remove) | `remove(path: string): Promise<CapResult<void>>` | — |
| [`exists`](#exists) | `exists(path: string): Promise<CapResult<boolean>>` | — |
| [`stat`](#stat) | `stat(path: string): Promise<CapResult<FileStat>>` | — |
| [`mkdir`](#mkdir) | `mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>` | — |
| [`rmdir`](#rmdir) | `rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>` | — |
| [`readdir`](#readdir) | `readdir(path: string): Promise<CapResult<string[]>>` | — |
| [`getFileInfo`](#getfileinfo) | `getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>` | — |
| [`saveFile`](#savefile) | `saveFile(tempPath: string): Promise<CapResult<string>>` | — |
| [`getSavedFileList`](#getsavedfilelist) | `getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>` | — |
| [`removeSavedFile`](#removesavedfile) | `removeSavedFile(path: string): Promise<CapResult<void>>` | — |
| [`unzip`](#unzip) | `unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>` | — |
| [`readFileSync`](#readfilesync) | `readFileSync(path: string): CapResult<string>` | — |
| [`writeFileSync`](#writefilesync) | `writeFileSync(path: string, data: string): CapResult<void>` | — |
| [`existsSync`](#existssync) | `existsSync(path: string): CapResult<boolean>` | — |
| [`statSync`](#statsync) | `statSync(path: string): CapResult<FileStat>` | — |
| [`readdirSync`](#readdirsync) | `readdirSync(path: string): CapResult<string[]>` | — |
| [`mkdirSync`](#mkdirsync) | `mkdirSync(path: string, recursive?: boolean): CapResult<void>` | — |
| [`renameSync`](#renamesync) | `renameSync(oldPath: string, newPath: string): CapResult<void>` | — |
| [`unlinkSync`](#unlinksync) | `unlinkSync(path: string): CapResult<void>` | — |
| [`copyFileSync`](#copyfilesync) | `copyFileSync(src: string, dest: string): CapResult<void>` | — |
| [`appendFileSync`](#appendfilesync) | `appendFileSync(path: string, data: string): CapResult<void>` | — |

### `readFile`

```ts
readFile(path: string): Promise<CapResult<string>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径（本地路径 / USER_DATA_PATH） |

**Returns**: `Promise<CapResult<string>>`

### `writeFile`

```ts
writeFile(path: string, data: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径 |
| `data` | `string` | Yes | 文本内容 |

**Returns**: `Promise<CapResult<void>>`

### `appendFile`

```ts
appendFile(path: string, data: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径 |
| `data` | `string` | Yes | 追加内容 |

**Returns**: `Promise<CapResult<void>>`

### `copyFile`

```ts
copyFile(src: string, dest: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `src` | `string` | Yes | 源路径 |
| `dest` | `string` | Yes | 目标路径 |

**Returns**: `Promise<CapResult<void>>`

### `rename`

```ts
rename(oldPath: string, newPath: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `oldPath` | `string` | Yes | 原路径 |
| `newPath` | `string` | Yes | 新路径 |

**Returns**: `Promise<CapResult<void>>`

### `remove`

```ts
remove(path: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径 |

**Returns**: `Promise<CapResult<void>>`

### `exists`

```ts
exists(path: string): Promise<CapResult<boolean>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 路径 |

**Returns**: `Promise<CapResult<boolean>>`

### `stat`

```ts
stat(path: string): Promise<CapResult<FileStat>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 路径 |

**Returns**: `Promise<CapResult<FileStat>>`

### `mkdir`

```ts
mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 目录路径 |
| `recursive` | `boolean` | No | 是否递归创建父目录（缺省 false） |

**Returns**: `Promise<CapResult<void>>`

### `rmdir`

```ts
rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 目录路径 |
| `recursive` | `boolean` | No | 是否递归删除（缺省 false） |

**Returns**: `Promise<CapResult<void>>`

### `readdir`

```ts
readdir(path: string): Promise<CapResult<string[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 目录路径 |

**Returns**: `Promise<CapResult<string[]>>`

### `getFileInfo`

```ts
getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径 |
| `digestAlgorithm` | `string` | No | 摘要算法（缺省 md5） |

**Returns**: `Promise<CapResult<{ size: number; digest: string }>>`

### `saveFile`

```ts
saveFile(tempPath: string): Promise<CapResult<string>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `tempPath` | `string` | Yes | 临时文件路径（如拍照/下载产出） |

**Returns**: `Promise<CapResult<string>>`

### `getSavedFileList`

```ts
getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>
```

**Returns**: `Promise<CapResult<SavedFileInfo[]>>`

### `removeSavedFile`

```ts
removeSavedFile(path: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | 文件路径 |

**Returns**: `Promise<CapResult<void>>`

### `unzip`

```ts
unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `zipPath` | `string` | Yes | zip 文件路径 |
| `targetPath` | `string` | Yes | 解压目标目录 |

**Returns**: `Promise<CapResult<void>>`

### `readFileSync`

```ts
readFileSync(path: string): CapResult<string>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |

**Returns**: `CapResult<string>`

### `writeFileSync`

```ts
writeFileSync(path: string, data: string): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |
| `data` | `string` | Yes | — |

**Returns**: `CapResult<void>`

### `existsSync`

```ts
existsSync(path: string): CapResult<boolean>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |

**Returns**: `CapResult<boolean>`

### `statSync`

```ts
statSync(path: string): CapResult<FileStat>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |

**Returns**: `CapResult<FileStat>`

### `readdirSync`

```ts
readdirSync(path: string): CapResult<string[]>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |

**Returns**: `CapResult<string[]>`

### `mkdirSync`

```ts
mkdirSync(path: string, recursive?: boolean): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |
| `recursive` | `boolean` | No | — |

**Returns**: `CapResult<void>`

### `renameSync`

```ts
renameSync(oldPath: string, newPath: string): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `oldPath` | `string` | Yes | — |
| `newPath` | `string` | Yes | — |

**Returns**: `CapResult<void>`

### `unlinkSync`

```ts
unlinkSync(path: string): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |

**Returns**: `CapResult<void>`

### `copyFileSync`

```ts
copyFileSync(src: string, dest: string): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `src` | `string` | Yes | — |
| `dest` | `string` | Yes | — |

**Returns**: `CapResult<void>`

### `appendFileSync`

```ts
appendFileSync(path: string, data: string): CapResult<void>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `path` | `string` | Yes | — |
| `data` | `string` | Yes | — |

**Returns**: `CapResult<void>`

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `supported` | `boolean` | Yes | 能力可用性（内存降级也算可用；false = 完全不可用） |

## Referenced types

### `FileStat`

文件/目录信息（wx.Stats 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `size` | `number` | — | 文件大小（字节） |
| `mode` | `number` | — | 权限位 |
| `lastAccessedTime` | `number` | — | 最后访问时间（ms 时间戳） |
| `lastModifiedTime` | `number` | — | 最后修改时间（ms 时间戳） |
| `isDirectory` | `boolean` | — | 是否目录 |
| `isFile` | `boolean` | — | 是否文件 |

### `SavedFileInfo`

已保存文件信息（wx.SavedFileInfo 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `filePath` | `string` | — | 保存后的文件路径 |
| `size` | `number` | — | 文件大小（字节） |
| `createTime` | `number` | — | 保存时间（ms 时间戳） |

## Error codes

| code | Doc |
|---|---|
| `file-system.unsupported` | Bridge does not provide getFileSystem (useFileSystem unavailable) |
| `file-system.read-failed` | — |
| `file-system.copy-failed` | — |
| `file-system.rename-failed` | — |
| `file-system.stat-failed` | — |
| `file-system.info-failed` | — |
| `file-system.write-failed` | — |
| `file-system.remove-failed` | — |
| `file-system.append-failed` | — |
| `file-system.mkdir-failed` | — |
| `file-system.rmdir-failed` | — |
| `file-system.readdir-failed` | — |
| `file-system.save-failed` | — |
| `file-system.list-failed` | — |
| `file-system.unzip-failed` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.getFileSystemManager |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const fs = useFileSystem() // synchronous handle — no await, no res.ok

const res = await fs.writeFile('logs/app.log', 'hello proteus')
if (res.ok) {
  const read = await fs.readFile('logs/app.log')
  if (read.ok) console.log('content:', read.data)
}
// fs.exists(path) / fs.remove(path); web has no FS Access API → in-memory fallback (supported stays true)
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->