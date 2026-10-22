// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h
// ★★★#1187：**鸿蒙宿主 `savePath` 落盘**（从 `proteus_http.h` 抽出）。
//
// 【为什么单列一个文件】
//   ① `proteus_http.h` 抽出前 1050 行，已超 `check:file-size` 的 1000 硬上限；
//   ② 职责不同：那个文件管"一次 HTTP 请求怎么走"，本文件只负责"响应体怎么安全落到沙箱文件"。
//   ★与 Android `HttpCapability.performSaveToFile` / iOS `sandboxFile` 同一职责边界。
//
// 【为什么同步模型下可行（而 `stream` 不行）】落盘**不需要回推 JS**：写完后把
//   `{path,size}` 摘要放进回程帧即可。而 `stream` 的 `onChunk` 要求"边收边回推"，
//   在一次性 VM + 同步 napi 下没有接收方（见 `proteus_http.h` 的 `stream` 如实拒绝）。
//
// 【安全判据（与 iOS `sandboxFile` 逐条对齐）】
//   ① 非空 ② 不以 `/` 开头（拒绝绝对路径）③ 任一段是 `..` ⇒ 拒绝
//   ⇒ 返回空串 = 非法，调用方**必须如实报错**（不得回落到"写到别处"）。
#pragma once
#include <sys/stat.h>   // ★#1187：递归建父目录（mkdir）

#include <cstdio>
#include <string>

namespace proteus {
namespace http {

/** 落盘上限（1 GiB）——与 Android / iOS 的 `MAX_SAVE_BYTES` **同值** */
constexpr size_t MAX_SAVE_BYTES_H = 1024u * 1024u * 1024u;

/** 最小 JSON 字符串转义（本文件自足，不依赖顶层 helpers——保持职责单一） */
inline std::string jsonEscapeH(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default: o += c;
    }
  }
  return o;
}

/**
 * **沙箱根目录**（`filesDir`）——由 ArkTS 侧注入（`setHttpSandboxRoot`）。
 *
 * 【为什么必须由外层注入】C++ 层拿不到 `getContext(this).filesDir`（那是 ArkTS/Ability 的上下文）。
 *   与 `hostAppBoot(…{filesDir})` 同一手法：**上下文归壳，语义归 C++**。
 * 【未设置时的语义】`savePath` 请求**如实报错**（不静默忽略——那是"业务以为落盘了、
 *   实际什么都没写"的假绿，本仓最忌的形态）。
 */
inline std::string& httpSandboxRoot() {
  static std::string r;
  return r;
}

/** 由 ArkTS 侧设置沙箱根（空 = 复位） */
inline void setHttpSandboxRoot(const std::string& dir) { httpSandboxRoot() = dir; }

/** 沙箱相对路径 → 绝对路径（返回空串 = 非法，调用方须如实报错） */
inline std::string resolveSandboxPath(const std::string& rel) {
  const std::string& root = httpSandboxRoot();
  if (root.empty() || rel.empty() || rel[0] == '/') return "";
  size_t start = 0;
  while (start <= rel.size()) {
    const size_t slash = rel.find('/', start);
    const size_t end = (slash == std::string::npos) ? rel.size() : slash;
    if (rel.compare(start, end - start, "..") == 0) return "";
    if (slash == std::string::npos) break;
    start = slash + 1;
  }
  return root + "/" + rel;
}

/**
 * 一个落盘会话：打开文件、逐块写、收尾给 `{path,size}` 摘要。
 *
 * ★★★#1191（独立验证 B1/B3 抓出的两个真缺陷，修复见下）：
 *   · **B1 早退泄漏**：原实现只有 `finish()` 会 `fclose`+`remove`，而 `handle()` 有 4 个出口
 *     （受理失败 / 超时 / 越线 / 网络错误）都不调它 ⇒ 实测连续 64 次失败 **fd +64**、
 *     磁盘留半截包。修法 = **析构函数兜底**（`~SaveSession`）：未 `completed` 就关句柄 + 删临时文件。
 *   · **B1 二次伤害**：原实现直接 `fopen(absPath,"wb")` ⇒ **请求还没发出就把用户已存在的同名
 *     文件截成 0 字节**（Android 是响应成功后才建、iOS 是首块才建）。修法 = **写 `.part` 临时文件，
 *     成功后 `rename`**（同时获得原子性：业务永远看不到半个文件）。
 *   · **B3 flush 失败被吞**：原实现 `fclose` 返回值丢弃 ⇒ 磁盘满时仍回"成功摘要"。
 *     修法 = `fflush` + `ferror` + 检查 `fclose` 返回码。
 */
struct SaveSession {
  FILE* fp = nullptr;
  std::string absPath;    // 最终路径（rename 目标）
  std::string partPath;   // 临时写路径（absPath + ".part"）
  std::string relPath;
  size_t written = 0;
  bool writeFailed = false;
  bool exceeded = false;
  size_t limit = MAX_SAVE_BYTES_H;
  /** ★B1：收尾已完成（成功 rename）。未完成 ⇒ 析构会清掉临时文件。 */
  bool completed = false;

  /** ★B1：任何出口（含早退/异常展开）都保证不留残包、不泄漏 fd。 */
  ~SaveSession() { abortUnfinished(); }

  /** 关句柄 + 删临时文件（幂等）。 */
  void abortUnfinished() {
    if (fp != nullptr) {
      std::fclose(fp);
      fp = nullptr;
    }
    if (!completed && !partPath.empty()) {
      std::remove(partPath.c_str());
      partPath.clear();
    }
  }

  /** 打开落盘文件。返回 false ⇒ 路径非法或打不开（`err` 里给可读原因）。 */
  bool open(const std::string& rel, std::string* err) {
    relPath = rel;
    absPath = resolveSandboxPath(rel);
    if (absPath.empty()) {
      if (err) *err = "fetch.failed: savePath 非法（必须是沙箱内的相对路径，不得为绝对路径或含 ..）：" + rel;
      return false;
    }
    // ★★★#1187 真机踩坑：`fopen("wb")` **不会建父目录** ⇒ `savePath=download/x.txt`
    //   在真机上直接失败（实测 `fetch.failed: 无法创建落盘文件`）。
    //   Android/iOS 的 `savePath` 支持子目录 ⇒ 本端必须对齐：递归建父目录。
    mkdirParents(absPath);
    // ★B1：写临时文件（`.part`），成功才 rename——否则会先把用户已有文件截断。
    partPath = absPath + ".part";
    fp = std::fopen(partPath.c_str(), "wb");
    if (fp == nullptr) {
      if (err) *err = "fetch.failed: 无法创建落盘文件：" + rel;
      partPath.clear();
      return false;
    }
    return true;
  }

  /** 递归创建文件的父目录（已存在则跳过；失败不致命，交给 fopen 报错） */
  static void mkdirParents(const std::string& absPath) {
    const size_t slash = absPath.rfind('/');
    if (slash == std::string::npos || slash == 0) return;
    const std::string dir = absPath.substr(0, slash);
    for (size_t i = 1; i <= dir.size(); i++) {
      if (i == dir.size() || dir[i] == '/') {
        const std::string part = dir.substr(0, i);
        ::mkdir(part.c_str(), 0755);   // EEXIST 也当成功
      }
    }
  }

  /** 写一块。返回 false ⇒ 该中止（调用方据此 cancel 传输）。 */
  bool write(const uint8_t* p, size_t n) {
    if (fp == nullptr) return false;
    if (limit != 0 && written + n > limit) {
      exceeded = true;
      return false;
    }
    if (std::fwrite(p, 1, n, fp) != n) {
      writeFailed = true;
      return false;
    }
    written += n;
    return true;
  }

  /**
   * 收尾：flush + 关文件 + 判定 + （成功时）rename `.part` → 目标。
   * @param ok 传出：是否成功（失败时临时文件已删、目标文件保持原样）
   * @return `{path,size}` 摘要（成功时）；失败时为空
   */
  std::string finish(bool* ok, std::string* err) {
    // ★B3：`fwrite` 成功只代表进了 stdio 缓冲 ⇒ 磁盘满在 flush 时才暴露，必须显式检查。
    if (fp != nullptr) {
      const bool flushOk = (std::fflush(fp) == 0);
      const bool errFlag = (std::ferror(fp) != 0);
      const int closeRc = std::fclose(fp);
      fp = nullptr;
      if (!flushOk || errFlag || closeRc != 0) writeFailed = true;
    }
    if (writeFailed) {
      abortUnfinished();
      if (ok) *ok = false;
      if (err) *err = "fetch.failed: 落盘写文件失败：" + relPath;
      return "";
    }
    if (exceeded) {
      abortUnfinished();
      if (ok) *ok = false;
      if (err) *err = "fetch.tooLarge: 落盘超过上限（" + std::to_string(written) + " B）";
      return "";
    }
    // ★B1：成功才把 `.part` 换成目标名（业务永远看不到半个文件）
    if (!partPath.empty()) {
      std::remove(absPath.c_str());   // rename 不覆盖（POSIX 会覆盖，但显式更稳）
      if (std::rename(partPath.c_str(), absPath.c_str()) != 0) {
        abortUnfinished();
        if (ok) *ok = false;
        if (err) *err = "fetch.failed: 落盘收尾失败（rename）：" + relPath;
        return "";
      }
      partPath.clear();
    }
    completed = true;
    if (ok) *ok = true;
    char buf[64];
    std::snprintf(buf, sizeof(buf), "\"size\":%llu", static_cast<unsigned long long>(written));
    return "{" + std::string("\"path\":\"") + jsonEscapeH(relPath) + "\"," + buf + "}";
  }
};

}  // namespace http
}  // namespace proteus
