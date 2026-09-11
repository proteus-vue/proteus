---
title: useFileSystem（capability.file-system）
group: 存储与文件
order: 2003
---

# useFileSystem

useFileSystem：文件系统句柄（wx.getFileSystemManager / web 内存降级）

> 能力原语 C43 · `capability.file-system` · 返回 `FSAdapter` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useFileSystem(): FSAdapter
```

## 返回值

返回 `FSAdapter`（同步句柄——无 Promise、无 await，结构见下）。

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`readFile`](#readfile) | `readFile(path: string): Promise<CapResult<string>>` | 读取文本文件（UTF-8）。 |
| [`writeFile`](#writefile) | `writeFile(path: string, data: string): Promise<CapResult<void>>` | 写入文件（覆盖；不存在则创建）。 |
| [`appendFile`](#appendfile) | `appendFile(path: string, data: string): Promise<CapResult<void>>` | 追加写入（在文件尾部追加）。 |
| [`copyFile`](#copyfile) | `copyFile(src: string, dest: string): Promise<CapResult<void>>` | 复制文件。 |
| [`rename`](#rename) | `rename(oldPath: string, newPath: string): Promise<CapResult<void>>` | 重命名 / 移动。 |
| [`remove`](#remove) | `remove(path: string): Promise<CapResult<void>>` | 删除文件。 |
| [`exists`](#exists) | `exists(path: string): Promise<CapResult<boolean>>` | 文件 / 目录是否存在。 |
| [`stat`](#stat) | `stat(path: string): Promise<CapResult<FileStat>>` | 获取文件 / 目录信息（大小 / 时间 / 类型）。 |
| [`mkdir`](#mkdir) | `mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>` | 创建目录。 |
| [`rmdir`](#rmdir) | `rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>` | 删除目录。 |
| [`readdir`](#readdir) | `readdir(path: string): Promise<CapResult<string[]>>` | 读取目录，返回条目名列表。 |
| [`getFileInfo`](#getfileinfo) | `getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>` | 获取文件摘要（大小 + 摘要值）。 |
| [`saveFile`](#savefile) | `saveFile(tempPath: string): Promise<CapResult<string>>` | 保存临时文件到本地（返回持久路径）。 |
| [`getSavedFileList`](#getsavedfilelist) | `getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>` | 已保存文件列表 |
| [`removeSavedFile`](#removesavedfile) | `removeSavedFile(path: string): Promise<CapResult<void>>` | 删除已保存文件。 |
| [`unzip`](#unzip) | `unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>` | 解压 zip。 |
| [`readFileSync`](#readfilesync) | `readFileSync(path: string): CapResult<string>` | 同步读文件（阻塞主线程——仅小文件/启动期用） |
| [`writeFileSync`](#writefilesync) | `writeFileSync(path: string, data: string): CapResult<void>` | 同步写文件（阻塞主线程） |
| [`existsSync`](#existssync) | `existsSync(path: string): CapResult<boolean>` | 同步判断存在 |
| [`statSync`](#statsync) | `statSync(path: string): CapResult<FileStat>` | 同步取文件信息 |
| [`readdirSync`](#readdirsync) | `readdirSync(path: string): CapResult<string[]>` | 同步读目录 |
| [`mkdirSync`](#mkdirsync) | `mkdirSync(path: string, recursive?: boolean): CapResult<void>` | 同步创建目录 |
| [`renameSync`](#renamesync) | `renameSync(oldPath: string, newPath: string): CapResult<void>` | 同步重命名 |
| [`unlinkSync`](#unlinksync) | `unlinkSync(path: string): CapResult<void>` | 同步删除 |
| [`copyFileSync`](#copyfilesync) | `copyFileSync(src: string, dest: string): CapResult<void>` | 同步复制 |
| [`appendFileSync`](#appendfilesync) | `appendFileSync(path: string, data: string): CapResult<void>` | 同步追加 |

### `readFile`

```ts
readFile(path: string): Promise<CapResult<string>>
```

**说明**：读取文本文件（UTF-8）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径（本地路径 / USER_DATA_PATH） |

**返回值**：`Promise<CapResult<string>>`

### `writeFile`

```ts
writeFile(path: string, data: string): Promise<CapResult<void>>
```

**说明**：写入文件（覆盖；不存在则创建）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径 |
| `data` | `string` | 是 | 文本内容 |

**返回值**：`Promise<CapResult<void>>`

### `appendFile`

```ts
appendFile(path: string, data: string): Promise<CapResult<void>>
```

**说明**：追加写入（在文件尾部追加）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径 |
| `data` | `string` | 是 | 追加内容 |

**返回值**：`Promise<CapResult<void>>`

### `copyFile`

```ts
copyFile(src: string, dest: string): Promise<CapResult<void>>
```

**说明**：复制文件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `src` | `string` | 是 | 源路径 |
| `dest` | `string` | 是 | 目标路径 |

**返回值**：`Promise<CapResult<void>>`

### `rename`

```ts
rename(oldPath: string, newPath: string): Promise<CapResult<void>>
```

**说明**：重命名 / 移动。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `oldPath` | `string` | 是 | 原路径 |
| `newPath` | `string` | 是 | 新路径 |

**返回值**：`Promise<CapResult<void>>`

### `remove`

```ts
remove(path: string): Promise<CapResult<void>>
```

**说明**：删除文件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径 |

**返回值**：`Promise<CapResult<void>>`

### `exists`

```ts
exists(path: string): Promise<CapResult<boolean>>
```

**说明**：文件 / 目录是否存在。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`Promise<CapResult<boolean>>`

### `stat`

```ts
stat(path: string): Promise<CapResult<FileStat>>
```

**说明**：获取文件 / 目录信息（大小 / 时间 / 类型）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`Promise<CapResult<FileStat>>`

### `mkdir`

```ts
mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>
```

**说明**：创建目录。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 目录路径 |
| `recursive` | `boolean` | 否 | 是否递归创建父目录（缺省 false） |

**返回值**：`Promise<CapResult<void>>`

### `rmdir`

```ts
rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>
```

**说明**：删除目录。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 目录路径 |
| `recursive` | `boolean` | 否 | 是否递归删除（缺省 false） |

**返回值**：`Promise<CapResult<void>>`

### `readdir`

```ts
readdir(path: string): Promise<CapResult<string[]>>
```

**说明**：读取目录，返回条目名列表。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 目录路径 |

**返回值**：`Promise<CapResult<string[]>>`

### `getFileInfo`

```ts
getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>
```

**说明**：获取文件摘要（大小 + 摘要值）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径 |
| `digestAlgorithm` | `string` | 否 | 摘要算法（缺省 md5） |

**返回值**：`Promise<CapResult<{ size: number; digest: string }>>`

### `saveFile`

```ts
saveFile(tempPath: string): Promise<CapResult<string>>
```

**说明**：保存临时文件到本地（返回持久路径）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tempPath` | `string` | 是 | 临时文件路径（如拍照/下载产出） |

**返回值**：`Promise<CapResult<string>>`

### `getSavedFileList`

```ts
getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>
```

**说明**：已保存文件列表

**返回值**：`Promise<CapResult<SavedFileInfo[]>>`

### `removeSavedFile`

```ts
removeSavedFile(path: string): Promise<CapResult<void>>
```

**说明**：删除已保存文件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 文件路径 |

**返回值**：`Promise<CapResult<void>>`

### `unzip`

```ts
unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>
```

**说明**：解压 zip。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `zipPath` | `string` | 是 | zip 文件路径 |
| `targetPath` | `string` | 是 | 解压目标目录 |

**返回值**：`Promise<CapResult<void>>`

### `readFileSync`

```ts
readFileSync(path: string): CapResult<string>
```

**说明**：同步读文件（阻塞主线程——仅小文件/启动期用）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`CapResult<string>`

### `writeFileSync`

```ts
writeFileSync(path: string, data: string): CapResult<void>
```

**说明**：同步写文件（阻塞主线程）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |
| `data` | `string` | 是 | 数据 |

**返回值**：`CapResult<void>`

### `existsSync`

```ts
existsSync(path: string): CapResult<boolean>
```

**说明**：同步判断存在

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`CapResult<boolean>`

### `statSync`

```ts
statSync(path: string): CapResult<FileStat>
```

**说明**：同步取文件信息

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`CapResult<FileStat>`

### `readdirSync`

```ts
readdirSync(path: string): CapResult<string[]>
```

**说明**：同步读目录

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`CapResult<string[]>`

### `mkdirSync`

```ts
mkdirSync(path: string, recursive?: boolean): CapResult<void>
```

**说明**：同步创建目录

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |
| `recursive` | `boolean` | 否 | 布尔参数 |

**返回值**：`CapResult<void>`

### `renameSync`

```ts
renameSync(oldPath: string, newPath: string): CapResult<void>
```

**说明**：同步重命名

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `oldPath` | `string` | 是 | 字符串参数 |
| `newPath` | `string` | 是 | 字符串参数 |

**返回值**：`CapResult<void>`

### `unlinkSync`

```ts
unlinkSync(path: string): CapResult<void>
```

**说明**：同步删除

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |

**返回值**：`CapResult<void>`

### `copyFileSync`

```ts
copyFileSync(src: string, dest: string): CapResult<void>
```

**说明**：同步复制

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `src` | `string` | 是 | 字符串参数 |
| `dest` | `string` | 是 | 字符串参数 |

**返回值**：`CapResult<void>`

### `appendFileSync`

```ts
appendFileSync(path: string, data: string): CapResult<void>
```

**说明**：同步追加

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 路径 |
| `data` | `string` | 是 | 数据 |

**返回值**：`CapResult<void>`

## 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `supported` | `boolean` | 是 | 能力可用性（内存降级也算可用；false = 完全不可用） |

## 类型引用

### `FileStat`

文件/目录信息（wx.Stats 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `size` | `number` | — | 文件大小（字节） |
| `mode` | `number` | — | 权限位 |
| `lastAccessedTime` | `number` | — | 最后访问时间（ms 时间戳） |
| `lastModifiedTime` | `number` | — | 最后修改时间（ms 时间戳） |
| `isDirectory` | `boolean` | — | 是否目录 |
| `isFile` | `boolean` | — | 是否文件 |

### `SavedFileInfo`

已保存文件信息（wx.SavedFileInfo 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `filePath` | `string` | — | 保存后的文件路径 |
| `size` | `number` | — | 文件大小（字节） |
| `createTime` | `number` | — | 保存时间（ms 时间戳） |

## 错误码

| code | 说明 |
|---|---|
| `file-system.unsupported` | 桥未提供 getFileSystem（useFileSystem 不可用） |
| `file-system.read-failed` | 内存文件不存在: ${path} |
| `file-system.copy-failed` | 内存文件不存在: ${src} |
| `file-system.rename-failed` | 内存文件不存在: ${o} |
| `file-system.stat-failed` | 不存在: ${path} |
| `file-system.info-failed` | 内存文件不存在: ${path} |
| `file-system.write-failed` | wx 写文件失败 |
| `file-system.remove-failed` | wx unlink 失败 |
| `file-system.append-failed` | 追加失败 |
| `file-system.mkdir-failed` | 创建目录失败 |
| `file-system.rmdir-failed` | 删除目录失败 |
| `file-system.readdir-failed` | 读目录失败 |
| `file-system.save-failed` | saveFile 失败 |
| `file-system.list-failed` | getSavedFileList 失败 |
| `file-system.unzip-failed` | 解压失败 |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.getFileSystemManager |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——能力桥未接线 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const fs = useFileSystem() // 同步句柄——无 await、无 res.ok

const res = await fs.writeFile('logs/app.log', 'hello proteus')
if (res.ok) {
  const read = await fs.readFile('logs/app.log')
  if (read.ok) console.log('内容:', read.data)
}
// fs.exists(path) / fs.remove(path)；web 无 FS Access API → 内存降级（supported 仍为 true）
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->