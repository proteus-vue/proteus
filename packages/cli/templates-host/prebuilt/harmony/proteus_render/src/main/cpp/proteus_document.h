// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_document.h
// ★★★#1384 App 能力 C84：`document.open` —— 文档预览（鸿蒙侧，**校验 + 入队**）。
//
// 【为什么单独成文件】`proteus_device.h` 已经承载 12 项设备能力 + phone/share，
//   再往里加文档预览会让它继续变长（反巨型化：新能力落新文件，决策 #870 三层范式）。
//
// 【★★★为什么走动作队列（与 phone.call / share 同一约束）】
//   鸿蒙的 `filePreview.openPreview()` 是 **Promise** 调用，且要 `UIAbilityContext`；
//   而本函数在**同步 napi** 内执行（一次性 VM 的必然形态，见 #540/#1344）
//   ⇒ 这里只做**校验 + 入队**，由 ArkTS 在渲染后 `runDeviceActions()` 里 drain 执行。
//   回执 `{accepted:true}` = **已入队**，不是"预览器已拉起"——
//   真正拉起的证据是设备日志 `PROTEUS_DOC_PREVIEW_OK`（由 run-document-probe.sh 取证）。
//
// 【★API 出处（已取证，不是猜的）】
//   `filePreview` 在 **HMS kit**：`hms/ets/api/@hms.filemanagement.filepreview.d.ts`
//   经 `@kit.PreviewKit` 导出，`@since 4.1.0(11)`；本机 SDK = API 24。
//      · `openPreview(context, { uri, mimeType, title? })` → Promise<void>
//      · `canPreview(context, uri)` → Promise<boolean>
//   ★与 #1336 的 `systemShare` 同一条取证教训：HMS 的 API 在 `hms/ets/api/`，
//     只搜 `openharmony/ets/api` 会得出"没有"的错误结论（"搜不到" ≠ "不存在"）。
//
// 【★★契约（与 Android/iOS/JS **同一集**，改一处要改四处）】
//   ① 只接受**沙箱相对路径**（`/` 开头拒绝）；`..` 段拒绝（目录穿越）——与 `proteus_fs.h` 同一纪律；
//   ② 扩展名白名单：pdf/doc/docx/xls/xlsx/ppt/pptx/txt；不在白名单**直接报错**（不猜 MIME、不降级）；
//   ③ 单文件上限 64 MiB（与 fs.readBytes / Android / iOS 同值）。
//   ★校验必须在**入队之前**：入队后才失败的话，回执已经说了 `accepted:true`（假成功）。
//
// 【诚实边界】
//   · 本文件**不做**文件存在性检查：路径解析与存在性在 ArkTS 侧（那里有 `fileIo` 与沙箱上下文）。
//     入队载荷带上相对路径，ArkTS 用 `fileUri.getUriFromPath(filesDir + '/' + path)` 造 URI。
//   · `canPreview` 由 ArkTS 侧调用；不支持的类型 ⇒ `PROTEUS_DOC_PREVIEW_UNSUPPORTED` 日志
//     （判据据此判红，不静默）。
#ifndef PROTEUS_DOCUMENT_H
#define PROTEUS_DOCUMENT_H

#include <cstddef>
#include <string>

#include "proteus_host_helpers.h"   // jstr / jsonEscape

namespace proteus {
namespace document {

/** 单文件上限 64 MiB（与 capability-app-document.ts / Android / iOS **同值**） */
constexpr long long MAX_BYTES = 64LL * 1024LL * 1024LL;
/** 路径长度上限（与 JS 层 `DOC_OPEN_MAX_PATH_LEN` 同值） */
constexpr std::size_t MAX_PATH_LEN = 512;

/** 小写化（只处理 ASCII；扩展名与 MIME 都在 ASCII 范围） */
inline std::string toLower(const std::string& s) {
  std::string o;
  o.reserve(s.size());
  for (char c : s) o += static_cast<char>((c >= 'A' && c <= 'Z') ? (c - 'A' + 'a') : c);
  return o;
}

/** 取小写扩展名（不含点）；没有则返回空串。 */
inline std::string extensionOf(const std::string& name) {
  const std::size_t dot = name.rfind('.');
  if (dot == std::string::npos || dot == 0 || dot + 1 >= name.size()) return "";
  return toLower(name.substr(dot + 1));
}

/** 取文件名（最后一个 '/' 之后）。 */
inline std::string baseName(const std::string& path) {
  const std::size_t i = path.rfind('/');
  return (i == std::string::npos) ? path : path.substr(i + 1);
}

/**
 * 扩展名 → MIME（白名单，与 JS 层 `DOC_OPEN_MIME` / Android / iOS 同一集）。
 * 不在白名单 ⇒ 返回空串（调用方据此报错，**不降级成 octet-stream**）。
 */
inline std::string mimeFor(const std::string& ext) {
  if (ext == "pdf")  return "application/pdf";
  if (ext == "doc")  return "application/msword";
  if (ext == "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext == "xls")  return "application/vnd.ms-excel";
  if (ext == "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext == "ppt")  return "application/vnd.ms-powerpoint";
  if (ext == "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext == "txt")  return "text/plain";
  return "";
}

/**
 * `document.open` 的校验部分：返回 `{ok, reason}` 形态的错误串；合法则返回空串。
 *
 * ★单独抽出来是为了让判据能**只测校验规则**（不经入队 / 不经 ArkTS），
 *   与 JS 层导出 `assertDocumentRequest` 同一意图：规则本身可被直接验证。
 *
 * @param path    出参：归一化后的沙箱相对路径
 * @param mime    出参：按扩展名推出的 MIME
 * @param title   出参：文件名去掉扩展名（预览器标题）
 * @return 空串 = 合法；否则为 `{"ok":false,...,"reason":"..."}` 的错误 JSON
 */
inline std::string validate(const std::string& rawPath, std::string* path, std::string* mime, std::string* title) {
  *path = rawPath;
  // ★trim（与 JS 层 `.trim()` 同口径；宿主层是第二道，不信任 JS）
  {
    const auto notSpace = [](unsigned char c) { return c != ' ' && c != '\t' && c != '\n' && c != '\r'; };
    auto b = path->begin(), e = path->end();
    while (b != e && !notSpace(static_cast<unsigned char>(*b))) ++b;
    while (b != e && !notSpace(static_cast<unsigned char>(*(e - 1)))) --e;
    *path = std::string(b, e);
  }
  if (path->empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open 需要 { path }\"}";
  }
  if (path->size() > MAX_PATH_LEN) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: path 过长（上限 512）\"}";
  }
  if ((*path)[0] == '/') {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 只接受沙箱相对路径（收到绝对路径）\"}";
  }
  // 控制字符 / 反斜杠：三端文件系统语义不同 ⇒ 一律拒（不猜）
  for (char c : *path) {
    const unsigned char u = static_cast<unsigned char>(c);
    if (c == '\\' || u < 0x20 || u == 0x7f) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 路径含非法字符（反斜杠或控制字符）\"}";
    }
  }
  // `..` 段（与 proteus_fs.h / resolveSandboxPath 同一判据）
  {
    std::size_t start = 0;
    while (start <= path->size()) {
      const std::size_t slash = path->find('/', start);
      const std::size_t end = (slash == std::string::npos) ? path->size() : slash;
      if (path->compare(start, end - start, "..") == 0) {
        return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 路径不得含 '..'（拒绝目录穿越）\"}";
      }
      if (slash == std::string::npos) break;
      start = slash + 1;
    }
  }
  const std::string name = baseName(*path);
  if (name.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 路径缺少文件名\"}";
  }
  const std::string ext = extensionOf(name);
  if (ext.empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 文件没有扩展名，无法判定预览类型\"}";
  }
  *mime = mimeFor(ext);
  if (mime->empty()) {
    return "{\"ok\":false,\"missing\":false,\"reason\":\"document.open: 不支持该扩展名（支持：pdf/doc/docx/xls/xlsx/ppt/pptx/txt）\"}";
  }
  const std::size_t dot = name.rfind('.');
  *title = name.substr(0, dot);
  return "";
}

/**
 * `document.open` 的分派实现：校验 + 入队。
 *
 * @param enqueue 入队回调（由调用方注入——`proteus_device.h` 的 `enqueue` 是文件内 static，
 *                而本头文件被它 include ⇒ 用回调注入避免"跨文件互相 include"的循环依赖）
 * @param n       出参：队列位置（>0 = 已入队条数）
 * @return 能力通道的 JSON 回执
 */
template <typename EnqueueFn>
inline std::string openDocument(const std::string& argsJson, EnqueueFn enqueue, int* n) {
  std::string rawPath;
  jstr(argsJson.c_str(), argsJson.size(), "path", &rawPath);
  std::string path, mime, title;
  const std::string bad = validate(rawPath, &path, &mime, &title);
  if (!bad.empty()) return bad;

  *n = enqueue(std::string("{\"action\":\"document.open\",\"path\":\"") + jsonEscape(path) +
               "\",\"mimeType\":\"" + jsonEscape(mime) + "\",\"title\":\"" + jsonEscape(title) + "\"}");
  char out[128];
  std::snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", *n);
  return out;
}

}  // namespace document
}  // namespace proteus

#endif  // PROTEUS_DOCUMENT_H
