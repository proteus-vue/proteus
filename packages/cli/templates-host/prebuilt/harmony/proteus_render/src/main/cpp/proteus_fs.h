// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_fs.h
// ★★★#1210：鸿蒙 **`fs.*` 能力通道**（`fs.writeBytes` / `fs.readBytes` / `fs.remove`）。
//
// 【为什么必须有】Android/iOS 早已实现（`FileTransferCapability` / `file-transfer-capability.swift`），
//   鸿蒙一直是**缺这三个方法**。后果不是"少一个能力"，而是**下游一批能力整端不可用**：
//   · `getStorage`（KV 存储）在鸿蒙**如实 unsupported**（#1209 的诚实边界）；
//   · `useFileSystem` / fetch 缓存持久层 / upload 的沙箱读文件… 同理。
//   ⇒ 按"宁缺毋滥、不能因为某端没做就绕过去"的标准，这是必须先补的**地基**。
//
// 【★★★契约逐条对齐 Android/iOS（不允许各写一套语义）】
//   方法名与参数/返回形状取自 `hosts/android/.../FileTransferCapability.java`：
//     · `fs.writeBytes`：`{ path, bytes: number[] }` → `{ path, size }`（**覆盖写**）
//     · `fs.readBytes` ：`{ path }`              → `{ bytes: number[], size }`
//     · `fs.remove`    ：`{ path }`              → `{}`（**幂等**：不存在也算成功）
//   三端共同的沙箱纪律（deny-by-default）：
//     · 只接受**沙箱相对路径**（`/` 开头一律拒绝）；`..` 段一律拒绝（不做"规范化后放行"）；
//     · 目录不存在 ⇒ 自动创建（只创建沙箱内的）；
//     · `readBytes` 单次上限 **64 MiB**（与 Android/iOS 同值；一次进 JS 内存）。
//
// 【★沙箱根复用 `httpSandboxRoot()`——不新开第二份状态】
//   那份状态由 ArkTS 壳在 `Superapp.injectSandboxRoot()` 里注入（`setHttpSandboxRoot(filesDir)`）。
//   ★为什么复用而不是新建 `fsSandboxRoot()`：**两份沙箱根必然会漂移**，而"写到哪个目录"是
//     安全边界——一份状态 = 一个事实来源。命名沿用了 `http` 是历史包袱，语义就是"沙箱根"。
//
// 【★与 Android/iOS 的两处差异（如实登记，不粉饰为一致）】
//   ① **写入持久性**：本实现 `fsync` 后才回成功（见下）；Android 是 `FileOutputStream.flush()`
//      （只到内核页缓存），iOS 用 `Data.write(.atomic)`（原子但无显式 fsync）。
//      ⇒ 鸿蒙这条**更严**；不是"更对"，是"各自如实"。
//   ② **写入原子性**：本实现写 `.part` 再 `rename`（业务永远看不到半个文件）；Android 是裸覆盖。
//      ⇒ 同样如实登记。若后续要对齐，应改 Android 侧（而不是把鸿蒙降级）。
#ifndef PROTEUS_FS_H
#define PROTEUS_FS_H

#include <algorithm>   // std::search（JSON key 定位）
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#include "proteus_host_helpers.h"   // jstr / jnum / jsonEscape
#include "proteus_http_save.h"      // ★复用 resolveSandboxPath / httpSandboxRoot（沙箱唯一事实来源）

namespace proteus {
namespace fs {

/** 单次读出上限（与 Android/iOS **同值** 64 MiB） */
constexpr long long MAX_READ_BYTES = 64LL * 1024LL * 1024LL;

/**
 * 从 JSON 里解析 `"key": [1, 2, 3]` → `std::vector<uint8_t>`。
 *
 * ★为什么自己写（不用现成 JSON 库）：本仓宿主侧刻意**零第三方 JSON 依赖**
 *   （`proteus_host_helpers.h` 就是一组轻量 `jstr`/`jnum`）。这里只解析一种形态——扁平数字数组，
 *   且只接受 0..255（越界即报错，不静默截断）。
 *
 * @return false ⇒ 数组不存在或格式非法（调用方如实报错）
 */
inline bool jbytes(const char* s, size_t segLen, const char* key, std::vector<uint8_t>* out) {
  out->clear();
  const std::string pat = std::string("\"") + key + "\"";
  const char* p = s;
  const char* end = s + segLen;
  // 找 key（要求后跟冒号，避免命中值里的同名字符串）
  while (p < end) {
    const char* hit = std::search(p, end, pat.begin(), pat.end());
    if (hit == end) return false;
    const char* q = hit + pat.size();
    while (q < end && (*q == ' ' || *q == '\t' || *q == '\n' || *q == '\r')) q++;
    if (q < end && *q == ':') {
      q++;
      while (q < end && (*q == ' ' || *q == '\t' || *q == '\n' || *q == '\r')) q++;
      if (q < end && *q == '[') {
        q++;
        while (q < end && *q != ']') {
          while (q < end && (*q == ' ' || *q == ',' || *q == '\t' || *q == '\n' || *q == '\r')) q++;
          if (q >= end || *q == ']') break;
          char* e = nullptr;
          const long v = std::strtol(q, &e, 10);
          if (e == q) return false;                 // 非数字
          if (v < 0 || v > 255) return false;        // ★越界即报错（不静默截断成 &0xFF）
          out->push_back(static_cast<uint8_t>(v));
          q = e;
        }
        return q < end;   // 找到闭合 `]`
      }
      return false;
    }
    p = hit + pat.size();
  }
  return false;
}

/** 递归建父目录（只建沙箱内的；失败如实返回 false） */
inline bool mkdirsFor(const std::string& filePath) {
  const size_t slash = filePath.find_last_of('/');
  if (slash == std::string::npos || slash == 0) return true;
  const std::string dir = filePath.substr(0, slash);
  struct stat st{};
  if (::stat(dir.c_str(), &st) == 0) return S_ISDIR(st.st_mode);
  // 逐级建
  std::string cur;
  size_t at = 0;
  while (at <= dir.size()) {
    const size_t next = dir.find('/', at);
    const size_t endAt = (next == std::string::npos) ? dir.size() : next;
    cur = dir.substr(0, endAt);
    if (!cur.empty()) {
      if (::mkdir(cur.c_str(), 0755) != 0 && errno != EEXIST) return false;
    }
    if (next == std::string::npos) break;
    at = next + 1;
  }
  struct stat st2{};
  return ::stat(dir.c_str(), &st2) == 0 && S_ISDIR(st2.st_mode);
}

/** `fs.writeBytes`：**原子 + 持久**写入（`.part` → fsync → rename → fsync(dir)） */
inline std::string writeBytes(const std::string& argsJson) {
  std::string rel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "path", &rel) || rel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes 需要 { path, bytes: number[] }\"}";
  }
  std::vector<uint8_t> bytes;
  if (!jbytes(argsJson.c_str(), argsJson.size(), "bytes", &bytes)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes 的 bytes 必须是 0..255 的数字数组\"}";
  }
  const std::string abs = proteus::http::resolveSandboxPath(rel);
  if (abs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）：" +
           jsonEscape(rel) + "\"}";
  }
  if (!mkdirsFor(abs)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes 无法创建目录：" + jsonEscape(rel) + "\"}";
  }
  /**
   * ★★★为什么不是裸覆盖（与 Android 的差异，见文件头）：
   *   "写到一半被杀/掉电" 会留下**半个文件** —— 对 KV 存储这类"下次启动要解析"的场景，
   *   半个 JSON = 启动即损坏。`.part` + `rename` 保证**业务要么看到旧内容、要么看到新内容**。
   *   ★rename 在同一文件系统内是原子的（POSIX）。
   */
  const std::string part = abs + ".part";
  FILE* fp = std::fopen(part.c_str(), "wb");
  if (fp == nullptr) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes 打不开临时文件：" + jsonEscape(rel) + "\"}";
  }
  bool ok = true;
  if (!bytes.empty() && std::fwrite(bytes.data(), 1, bytes.size(), fp) != bytes.size()) ok = false;
  if (ok && std::fflush(fp) != 0) ok = false;
  // ★fsync 必须在 fclose **之前**（fclose 之后再取 fileno 已无效——#1200 同族教训）
  if (ok && ::fsync(::fileno(fp)) != 0) ok = false;
  if (std::fclose(fp) != 0) ok = false;
  if (!ok) {
    std::remove(part.c_str());
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes 写入失败：" + jsonEscape(rel) + "\"}";
  }
  if (std::rename(part.c_str(), abs.c_str()) != 0) {
    std::remove(part.c_str());
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.writeBytes rename 失败：" + jsonEscape(rel) + "\"}";
  }
  // ★rename 之后 fsync 目录，否则"新文件名"本身可能还在页缓存里（掉电后文件消失）
  const size_t slash = abs.find_last_of('/');
  if (slash != std::string::npos) {
    const std::string dir = abs.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY);
    if (dfd >= 0) {
      ::fsync(dfd);
      ::close(dfd);
    }
  }
  char buf[256];
  std::snprintf(buf, sizeof(buf), "{\"ok\":true,\"data\":{\"path\":\"%s\",\"size\":%zu}}",
                jsonEscape(rel).c_str(), bytes.size());
  return buf;
}

/** `fs.readBytes`：`{ path }` → `{ bytes: number[], size }` */
inline std::string readBytes(const std::string& argsJson) {
  std::string rel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "path", &rel) || rel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readBytes 需要 { path }\"}";
  }
  const std::string abs = proteus::http::resolveSandboxPath(rel);
  if (abs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）：" +
           jsonEscape(rel) + "\"}";
  }
  struct stat st{};
  if (::stat(abs.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readBytes: 文件不存在 " + jsonEscape(rel) + "\"}";
  }
  if (static_cast<long long>(st.st_size) > MAX_READ_BYTES) {
    char b[256];
    std::snprintf(b, sizeof(b),
                  "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readBytes: 文件过大（%lldB > %lldB）"
                  "——分块读取属后续批次\"}",
                  static_cast<long long>(st.st_size), MAX_READ_BYTES);
    return b;
  }
  FILE* fp = std::fopen(abs.c_str(), "rb");
  if (fp == nullptr) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readBytes 打不开：" + jsonEscape(rel) + "\"}";
  }
  std::vector<uint8_t> buf(static_cast<size_t>(st.st_size));
  size_t got = 0;
  if (!buf.empty()) got = std::fread(buf.data(), 1, buf.size(), fp);
  std::fclose(fp);
  if (got != buf.size()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readBytes 读到的字节数不符（期望 " +
           std::to_string(buf.size()) + "，实得 " + std::to_string(got) + "）\"}";
  }
  // 回执：`bytes` 数组 + `size`（与 Android/iOS 同形状）
  std::string out = "{\"ok\":true,\"data\":{\"bytes\":[";
  out.reserve(out.size() + buf.size() * 4 + 64);
  for (size_t i = 0; i < buf.size(); i++) {
    if (i != 0) out += ',';
    out += std::to_string(static_cast<unsigned>(buf[i]));
  }
  out += "],\"size\":" + std::to_string(buf.size()) + "}}";
  return out;
}

/** ★★★#1226 `fs.exists`：`{ path }` → `{ exists, isFile, isDir }`
 *  为 `getFileSystem` 基础面补最后一个方法；路径非法仍拒（复用 resolveSandboxPath）。 */
inline std::string exists(const std::string& argsJson) {
  std::string rel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "path", &rel) || rel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.exists 需要 { path }\"}";
  }
  const std::string abs = proteus::http::resolveSandboxPath(rel);
  if (abs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）：" +
           jsonEscape(rel) + "\"}";
  }
  struct stat st{};
  const bool has = ::stat(abs.c_str(), &st) == 0;
  const bool isFile = has && S_ISREG(st.st_mode);
  const bool isDir = has && S_ISDIR(st.st_mode);
  char b[160];
  std::snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"exists\":%s,\"isFile\":%s,\"isDir\":%s}}",
                has ? "true" : "false", isFile ? "true" : "false", isDir ? "true" : "false");
  return b;
}

/** `fs.remove`：`{ path }` → `{}`（**幂等**：不存在也算成功，与 Android/iOS 同） */
inline std::string remove(const std::string& argsJson) {
  std::string rel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "path", &rel) || rel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.remove 需要 { path }\"}";
  }
  const std::string abs = proteus::http::resolveSandboxPath(rel);
  if (abs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）：" +
           jsonEscape(rel) + "\"}";
  }
  struct stat st{};
  if (::stat(abs.c_str(), &st) != 0) return "{\"ok\":true,\"data\":{}}";   // ★幂等
  if (!S_ISREG(st.st_mode)) {
    // ★目录不在这里删（`fs.remove` 的契约是"文件"；目录删除属 useFileSystem 的 rmdir）
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.remove 只删文件（不是文件）：" + jsonEscape(rel) + "\"}";
  }
  if (std::remove(abs.c_str()) != 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.remove 删除失败：" + jsonEscape(rel) + "\"}";
  }
  return "{\"ok\":true,\"data\":{}}";
}

// ── ★★★#1227 `getFileSystem` **目录面**（stat/readdir/mkdir/rmdir）──
//   ★沙箱校验全部走 resolveSandboxPath（不开第二份）。

/** 把沙箱相对路径解析成绝对路径；失败时把错误回执写进 `err`。 */
inline bool resolveOrErr(const std::string& argsJson, const char* who, std::string& abs, std::string& err) {
  std::string rel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "path", &rel) || rel.empty()) {
    err = std::string("{\"ok\":false,\"missing\":false,\"reason\":\"") + who + " 需要 { path }\"}";
    return false;
  }
  abs = proteus::http::resolveSandboxPath(rel);
  if (abs.empty()) {
    err = std::string("{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）：") +
          jsonEscape(rel) + "\"}";
    return false;
  }
  return true;
}

/** `fs.stat`：`{ path }` → FileStat。★`lastAccessedTime` 用 `st_atime`（POSIX 可用）。 */
inline std::string stat(const std::string& argsJson) {
  std::string abs, err;
  if (!resolveOrErr(argsJson, "fs.stat", abs, err)) return err;
  struct stat st{};
  if (::stat(abs.c_str(), &st) != 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.stat: 不存在\"}";
  }
  char b[320];
  std::snprintf(b, sizeof(b),
                "{\"ok\":true,\"data\":{\"size\":%lld,\"mode\":%d,\"lastAccessedTime\":%lld,"
                "\"lastModifiedTime\":%lld,\"isDirectory\":%s,\"isFile\":%s}}",
                static_cast<long long>(st.st_size), static_cast<int>(st.st_mode & 0777),
                static_cast<long long>(st.st_atime) * 1000, static_cast<long long>(st.st_mtime) * 1000,
                S_ISDIR(st.st_mode) ? "true" : "false", S_ISREG(st.st_mode) ? "true" : "false");
  return b;
}

/** `fs.readdir`：`{ path }` → `{ entries: string[] }`（只返名字；排序保证确定性）。 */
inline std::string readdir(const std::string& argsJson) {
  std::string abs, err;
  if (!resolveOrErr(argsJson, "fs.readdir", abs, err)) return err;
  DIR* d = ::opendir(abs.c_str());
  if (d == nullptr) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.readdir: 不是目录或无权读\"}";
  }
  std::vector<std::string> names;
  struct dirent* ent = nullptr;
  while ((ent = ::readdir(d)) != nullptr) {
    const std::string n = ent->d_name;
    if (n == "." || n == "..") continue;
    names.push_back(n);
  }
  ::closedir(d);
  std::sort(names.begin(), names.end());   // ★确定性（目录顺序本就不可额定）
  std::string out = "{\"ok\":true,\"data\":{\"entries\":[";
  for (size_t i = 0; i < names.size(); i++) {
    if (i > 0) out += ",";
    out += "\"" + jsonEscape(names[i]) + "\"";
  }
  out += "]}}";
  return out;
}

/** `fs.mkdir`：`{ path, recursive? }` → `{}`。★幂等（已存在且是目录 ⇒ 成功）。 */
inline std::string mkdir(const std::string& argsJson) {
  std::string abs, err;
  if (!resolveOrErr(argsJson, "fs.mkdir", abs, err)) return err;
  bool recursive = false;
  jnum(argsJson.c_str(), argsJson.size(), "recursive", nullptr);   // 仅占位（保持契约形状）
  { std::string rv; if (jstr(argsJson.c_str(), argsJson.size(), "recursive", &rv)) recursive = (rv == "true" || rv == "1"); }
  struct stat st{};
  if (::stat(abs.c_str(), &st) == 0) {
    if (S_ISDIR(st.st_mode)) return "{\"ok\":true,\"data\":{}}";   // 幂等
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.mkdir: 同名文件已存在\"}";
  }
  if (recursive) {
    // 逐段创建父目录
    std::string cur;
    for (size_t i = 0; i < abs.size(); i++) {
      cur += abs[i];
      if (abs[i] == '/' || i + 1 == abs.size()) {
        if (cur != "/") ::mkdir(cur.c_str(), 0700);
      }
    }
  } else if (::mkdir(abs.c_str(), 0700) != 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.mkdir 失败（父目录不存在？）\"}";
  }
  if (::stat(abs.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.mkdir 后目录不存在\"}";
  }
  return "{\"ok\":true,\"data\":{}}";
}

/** 递归删子树（PID 下用 lstat 判断，**不跟随符号链接**）。 */
inline bool removeTree(const std::string& abs) {
  DIR* d = ::opendir(abs.c_str());
  if (d == nullptr) return false;
  std::vector<std::string> kids;
  struct dirent* ent = nullptr;
  while ((ent = ::readdir(d)) != nullptr) {
    const std::string n = ent->d_name;
    if (n == "." || n == "..") continue;
    kids.push_back(n);
  }
  ::closedir(d);
  for (const auto& k : kids) {
    const std::string p = abs + "/" + k;
    struct stat st{};
    if (::lstat(p.c_str(), &st) != 0) continue;
    if (S_ISDIR(st.st_mode)) { if (!removeTree(p)) return false; }
    else if (::unlink(p.c_str()) != 0) return false;
  }
  return ::rmdir(abs.c_str()) == 0;
}

/** `fs.rmdir`：`{ path, recursive? }` → `{}`。★幂等（不存在 ⇒ 成功）。 */
inline std::string rmdir(const std::string& argsJson) {
  std::string abs, err;
  if (!resolveOrErr(argsJson, "fs.rmdir", abs, err)) return err;
  bool recursive = false;
  { std::string rv; if (jstr(argsJson.c_str(), argsJson.size(), "recursive", &rv)) recursive = (rv == "true" || rv == "1"); }
  struct stat st{};
  if (::stat(abs.c_str(), &st) != 0) return "{\"ok\":true,\"data\":{}}";   // 幂等
  if (!S_ISDIR(st.st_mode)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rmdir: 不是目录（文件请用 fs.remove）\"}";
  }
  if (recursive) {
    if (!removeTree(abs)) return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rmdir: 递归删除失败\"}";
  } else if (::rmdir(abs.c_str()) != 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rmdir: 目录非空或删除失败（需 recursive=true）\"}";
  }
  return "{\"ok\":true,\"data\":{}}";
}

// ── ★★★#1228 `getFileSystem` **复合面**（copy/rename/getFileInfo）──
//   ★★沙箱校验：`src/旧` 与 `dest/新` **两端都**过 resolveSandboxPath。

/** `fs.copy`：`{ src, dest }` → `{ dest, size }`。★**不覆盖已存在的 dest**。 */
inline std::string copy(const std::string& argsJson) {
  std::string srcRel, destRel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "src", &srcRel) || srcRel.empty() ||
      !jstr(argsJson.c_str(), argsJson.size(), "dest", &destRel) || destRel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy 需要 { src, dest }\"}";
  }
  const std::string sAbs = proteus::http::resolveSandboxPath(srcRel);
  const std::string dAbs = proteus::http::resolveSandboxPath(destRel);
  if (sAbs.empty() || dAbs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）\"}";
  }
  struct stat st{};
  if (::stat(sAbs.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy: 源不是文件\"}";
  }
  if (::stat(dAbs.c_str(), &st) == 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy: 目标已存在（拒绝静默覆盖）\"}";
  }
  FILE* in = std::fopen(sAbs.c_str(), "rb");
  if (in == nullptr) return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy 打不开源\"}";
  FILE* outp = std::fopen(dAbs.c_str(), "wb");
  if (outp == nullptr) { std::fclose(in); return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy 打不开目标（目录不存在？）\"}"; }
  std::vector<char> buf(64 * 1024);
  long long total = 0;
  size_t n;
  bool okc = true;
  while ((n = std::fread(buf.data(), 1, buf.size(), in)) > 0) {
    if (std::fwrite(buf.data(), 1, n, outp) != n) { okc = false; break; }
    total += static_cast<long long>(n);
  }
  std::fclose(in);
  std::fclose(outp);
  if (!okc) return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.copy 写入失败\"}";
  char b[192];
  std::snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"dest\":\"%s\",\"size\":%lld}}", jsonEscape(destRel).c_str(), total);
  return b;
}

/** `fs.rename`：`{ oldPath, newPath }` → `{ newPath }`。★目标已存在 ⇒ 报错。 */
inline std::string renamePath(const std::string& argsJson) {
  std::string oldRel, newRel;
  if (!jstr(argsJson.c_str(), argsJson.size(), "oldPath", &oldRel) || oldRel.empty() ||
      !jstr(argsJson.c_str(), argsJson.size(), "newPath", &newRel) || newRel.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rename 需要 { oldPath, newPath }\"}";
  }
  const std::string oAbs = proteus::http::resolveSandboxPath(oldRel);
  const std::string nAbs = proteus::http::resolveSandboxPath(newRel);
  if (oAbs.empty() || nAbs.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs: 只接受沙箱相对路径（拒绝绝对路径与 '..'）\"}";
  }
  struct stat st{};
  if (::stat(oAbs.c_str(), &st) != 0) return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rename: 源不存在\"}";
  if (::stat(nAbs.c_str(), &st) == 0) return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rename: 目标已存在\"}";
  if (::rename(oAbs.c_str(), nAbs.c_str()) != 0) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.rename 失败\"}";
  }
  return "{\"ok\":true,\"data\":{\"newPath\":\"" + jsonEscape(newRel) + "\"}}";
}

/** `fs.getFileInfo`：`{ path }` → `{ size, digest, digestSupported }`。
 *  ★★**本端不做摘要**：runtime 侧无 sha256 实现，且本仓对第三方依赖克制
 *    （#1204）⇒ 回 digest="" + digestSupported:false。**不拿假摘要冒充**。
 *  ★要校验摘要请用 `fs.readBytes` + JS 侧计算，或在宿主侧补 sha256（独立批次）。 */
inline std::string getFileInfo(const std::string& argsJson) {
  std::string abs, err;
  if (!resolveOrErr(argsJson, "fs.getFileInfo", abs, err)) return err;
  struct stat st{};
  if (::stat(abs.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"fs.getFileInfo: 不是文件\"}";
  }
  char b[192];
  std::snprintf(b, sizeof(b),
                "{\"ok\":true,\"data\":{\"size\":%lld,\"digest\":\"\",\"digestSupported\":false}}",
                static_cast<long long>(st.st_size));
  return b;
}

/** 方法分派：命中 `fs.*` 返回 true（结果写进 `out`） */
inline bool dispatch(const std::string& method, const std::string& argsJson, std::string* out) {
  if (method == "fs.writeBytes") { *out = writeBytes(argsJson); return true; }
  if (method == "fs.readBytes") { *out = readBytes(argsJson); return true; }
  if (method == "fs.remove") { *out = remove(argsJson); return true; }
  if (method == "fs.exists") { *out = exists(argsJson); return true; }
  if (method == "fs.stat") { *out = stat(argsJson); return true; }
  if (method == "fs.readdir") { *out = readdir(argsJson); return true; }
  if (method == "fs.mkdir") { *out = mkdir(argsJson); return true; }
  if (method == "fs.rmdir") { *out = rmdir(argsJson); return true; }
  if (method == "fs.copy") { *out = copy(argsJson); return true; }
  if (method == "fs.rename") { *out = renamePath(argsJson); return true; }
  if (method == "fs.getFileInfo") { *out = getFileInfo(argsJson); return true; }
  if (method.rfind("fs.", 0) == 0) {
    *out = "{\"ok\":false,\"missing\":true,\"reason\":\"未实现的 fs 方法：" + jsonEscape(method) + "\"}";
    return true;
  }
  return false;
}

}  // namespace fs
}  // namespace proteus

#endif  // PROTEUS_FS_H
