// hosts/ios/ProteusHost/runtime/file-transfer-capability.swift
// ★★★决策 #1095（2026-10-19）：C29/C30 上传/下载的 **iOS 文件系统腿**
//   （`fs.writeBytes` / `fs.readBytes` / `fs.remove`）。
//
// 【沙箱纪律（与 Android 版逐条对齐——同一套拒绝规则）】
//   · 只接受 **Documents 下的相对路径**；绝对路径 / 含 `..` 一律拒绝（防目录穿越）；
//   · 目录不存在自动创建；
//   · `fs.remove` **幂等**（不存在也算成功）。
//
// 【诚实边界】
//   · 整块读写（Data 一次性进内存），上限 64 MiB——与 Android 同值；分块协议属后续批次。
//   · 覆盖写，非原子替换——中断可能留半截文件（已在能力页端边界写明）。

import Foundation
import CryptoKit   // ★#1228 getFileInfo 的摘要（iOS 13+ 系统框架，不需 bridging header）

enum FileTransferCapability {

    /// 沙箱根（Documents）。
    static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// 解析沙箱相对路径（拒绝绝对路径与 `..`）。
    private static func resolve(_ path: String) throws -> URL {
        guard !path.isEmpty else { throw WsError.invalid("fs: path 为空") }
        guard !path.hasPrefix("/") else { throw WsError.invalid("fs: 只接受沙箱相对路径（收到绝对路径 \(path)）") }
        for seg in path.split(separator: "/") where seg == ".." {
            throw WsError.invalid("fs: 路径不得含 '..'（拒绝目录穿越）：\(path)")
        }
        return root.appendingPathComponent(path)
    }

    /// `fs.writeBytes`：`{ path, bytes: number[] }` → `{ path, size }`
    static func writeBytes(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        guard let arr = args["bytes"] as? [Int] else {
            throw WsError.invalid("fs.writeBytes 需要 { path, bytes: number[] }")
        }
        let url = try resolve(path)
        let dir = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let data = Data(arr.map { UInt8($0 & 0xFF) })
        try data.write(to: url, options: .atomic)   // ★iOS 侧用原子写（系统支持，比 Android 的裸覆盖更安全）
        return ["path": path, "size": data.count]
    }

    /// `fs.readBytes`：`{ path }` → `{ bytes: number[], size }`
    static func readBytes(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let url = try resolve(path)
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        let MAX = 64 * 1024 * 1024
        guard size <= MAX else {
            throw WsError.invalid("fs.readBytes: 文件过大（\(size)B > \(MAX)B）——分块读取属后续批次")
        }
        let data = try Data(contentsOf: url)
        return ["bytes": data.map { Int($0) }, "size": data.count]
    }

    /// ★★★#1226 `fs.exists`：`{ path }` → `{ exists, isFile, isDir }`
    ///   为 `getFileSystem` 基础面补最后一个方法；路径非法仍拒（复用 resolve 的沙箱校验）。
    static func exists(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let url = try resolve(path)
        var isDir: ObjCBool = false
        let ok = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        return ["exists": ok, "isFile": ok && !isDir.boolValue, "isDir": ok && isDir.boolValue]
    }

    // ── ★★★#1227 `getFileSystem` **目录面**（stat/readdir/mkdir/rmdir）──
    //   ★沙箱校验全部走 `resolve()`（不开第二份）。

    /// `fs.stat`：`{ path }` → FileStat。
    ///   ★诚实边界：`lastAccessedTime` 在 iOS 上**不保证可用**（`contentAccessDate` 常 nil）
    ///     ⇒ 拿不到就回 0，**不拿 mtime 冒充**。
    static func stat(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let url = try resolve(path)
        let keys: Set<URLResourceKey> = [.fileSizeKey, .isDirectoryKey, .isRegularFileKey,
                                        .contentModificationDateKey, .contentAccessDateKey]
        let v = try url.resourceValues(forKeys: keys)
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        let mode = (attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0
        let mtime = (v.contentModificationDate ?? (attrs[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0))
        let atime = v.contentAccessDate ?? Date(timeIntervalSince1970: 0)
        return [
            "size": (v.fileSize ?? (attrs[.size] as? NSNumber)?.intValue) ?? 0,
            "mode": mode,
            "lastAccessedTime": Int(atime.timeIntervalSince1970 * 1000),
            "lastModifiedTime": Int(mtime.timeIntervalSince1970 * 1000),
            "isDirectory": v.isDirectory ?? false,
            "isFile": v.isRegularFile ?? false,
        ]
    }

    /// `fs.readdir`：`{ path }` → `{ entries: string[] }`（只返名字）。非目录 ⇒ 报错。
    static func readdir(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let url = try resolve(path)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else {
            throw WsError.invalid("fs.readdir: 不是目录 \(path)")
        }
        let names = try FileManager.default.contentsOfDirectory(atPath: url.path)
        return ["entries": names.sorted()]
    }

    /// `fs.mkdir`：`{ path, recursive? }` → `{}`。★幂等（已存在且是目录 ⇒ 成功）。
    static func mkdir(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let recursive = (args["recursive"] as? Bool) ?? false
        let url = try resolve(path)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) {
            if isDir.boolValue { return [:] }   // 幂等
            throw WsError.invalid("fs.mkdir: 同名文件已存在 \(path)")
        }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: recursive)
        return [:]
    }

    /// `fs.rmdir`：`{ path, recursive? }` → `{}`。★幂等（不存在 ⇒ 成功）。
    ///   ★★**关键差异**：本平台的 `removeItem` **天然递归** ⇒ `recursive:false` 时必须
    ///     **先检查目录为空**；否则会静默删掉整棵树（与 POSIX `rmdir` 语义相反）。
    static func rmdir(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let recursive = (args["recursive"] as? Bool) ?? false
        let url = try resolve(path)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return [:] }
        guard isDir.boolValue else { throw WsError.invalid("fs.rmdir: 不是目录 \(path)（文件请用 fs.remove）") }
        if !recursive {
            let kids = try FileManager.default.contentsOfDirectory(atPath: url.path)
            guard kids.isEmpty else { throw WsError.invalid("fs.rmdir: 目录非空 \(path)（需 recursive=true）") }
        }
        try FileManager.default.removeItem(at: url)
        return [:]
    }

    // ── ★★★#1228 `getFileSystem` **复合面**（copyFile/rename/getFileInfo）──
    //   ★★沙箱校验：`src` 与 `dest` **两端都**过 `resolve()`。

    /// `fs.copy`：`{ src, dest }` → `{ dest, size }`。★**不覆盖已存在的 dest**。
    static func copy(_ args: [String: Any]) throws -> [String: Any] {
        let src = (args["src"] as? String) ?? ""
        let dest = (args["dest"] as? String) ?? ""
        let s = try resolve(src)
        let d = try resolve(dest)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: s.path, isDirectory: &isDir), !isDir.boolValue else {
            throw WsError.invalid("fs.copy: 源不是文件 \(src)")
        }
        guard !FileManager.default.fileExists(atPath: d.path) else {
            throw WsError.invalid("fs.copy: 目标已存在 \(dest)（拒绝静默覆盖）")
        }
        try FileManager.default.createDirectory(at: d.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: s, to: d)
        let size = (try? d.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ["dest": dest, "size": size]
    }

    /// `fs.rename`：`{ oldPath, newPath }` → `{ newPath }`。★目标已存在 ⇒ 报错。
    static func rename(_ args: [String: Any]) throws -> [String: Any] {
        let oldPath = (args["oldPath"] as? String) ?? ""
        let newPath = (args["newPath"] as? String) ?? ""
        let s = try resolve(oldPath)
        let d = try resolve(newPath)
        guard FileManager.default.fileExists(atPath: s.path) else {
            throw WsError.invalid("fs.rename: 源不存在 \(oldPath)")
        }
        guard !FileManager.default.fileExists(atPath: d.path) else {
            throw WsError.invalid("fs.rename: 目标已存在 \(newPath)")
        }
        try FileManager.default.moveItem(at: s, to: d)
        return ["newPath": newPath]
    }

    /// `fs.getFileInfo`：`{ path, digestAlgorithm? }` → `{ size, digest }`。
    ///   ★默认 sha256；不认识的算法 ⇒ **报错**（不静默当 md5）。边读边算（不全读入内存）。
    static func getFileInfo(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let alg = ((args["digestAlgorithm"] as? String) ?? "sha256").lowercased()
        let url = try resolve(path)
        guard let h = try? FileHandle(forReadingFrom: url) else {
            throw WsError.invalid("fs.getFileInfo: 不是文件 \(path)")
        }
        defer { try? h.close() }
        var total = 0
        var digest = ""
        switch alg {
        case "sha256":
            var hasher = SHA256()
            while let chunk = try h.read(upToCount: 64 * 1024), !chunk.isEmpty { total += chunk.count; hasher.update(data: chunk) }
            digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        case "sha1":
            var hasher = Insecure.SHA1()
            while let chunk = try h.read(upToCount: 64 * 1024), !chunk.isEmpty { total += chunk.count; hasher.update(data: chunk) }
            digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        case "md5":
            var hasher = Insecure.MD5()
            while let chunk = try h.read(upToCount: 64 * 1024), !chunk.isEmpty { total += chunk.count; hasher.update(data: chunk) }
            digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        default:
            throw WsError.invalid("fs.getFileInfo: 不支持的 digestAlgorithm「\(alg)」（仅 sha256/sha1/md5）")
        }
        return ["size": total, "digest": digest]
    }

    /// `fs.remove`：`{ path }` → `{}`（幂等）
    static func remove(_ args: [String: Any]) throws -> [String: Any] {
        let path = (args["path"] as? String) ?? ""
        let url = try resolve(path)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        return [:]
    }
}
