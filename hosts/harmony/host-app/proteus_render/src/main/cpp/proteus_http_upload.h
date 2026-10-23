// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_upload.h
// ★★★#1205：鸿蒙 **multipart 流式上传**（`upload` 的真实现；此前是如实拒绝）。
//
// 【为什么要做】`useFetch` 的上传在 Android/iOS 都已实现（宿主自读沙箱文件、自拼 multipart、
//   JS 完全不碰字节），只有鸿蒙此前回 `fetch.unsupported`。这是 useFetch 面上最后一块端差异。
//
// 【★为什么用 RCP 的 multipart API，而不是像 Android/iOS 那样自己拼帧】
//   RCP 提供 `HMS_Rcp_CreateMultipartForm` + `SetMultipartFormValue`，其中
//   `Rcp_FormFieldFileValue.contentOrPathOrCb` 支持 `RCP_FILE_VALUE_TYPE_PATH`
//   ⇒ **把路径交给平台，由 RCP 自己流式读文件**（内存与文件大小无关）。
//   而"自己拼帧"需要把整个 multipart 体读进内存（或走 `Rcp_GetDataCallback` 拉取式回调，
//   其 `0` 返回值的语义是"stop transfer"，文档没写清是"正常结束"还是"中止"——风险不可控）。
//   ⇒ 选平台 API：内存有界 + 不需要猜测回调语义。
//
// 【★★必须登记的语义差异（与 Android/iOS **不一致**，不粉饰）】
//   ① **boundary 由 RCP 生成，不是 JS 传入的那个**。JS 侧的 `UploadSpec.boundary` 是
//     "写进 `Content-Type` 头"的契约（Android/iOS 用它拼体，头与体同源）。鸿蒙用 RCP multipart
//     ⇒ 平台自己生成 boundary 并（预期）自己写 `Content-Type`。因此：
//     **宿主必须剔除调用方传来的 `Content-Type: multipart/form-data; boundary=…`**，
//     否则头里是 JS 的 boundary、体里是 RCP 的 boundary ⇒ 服务端必然解析失败。
//   ② **表单字段顺序由平台的 Map 决定**（`SetMultipartFormValue` 的注释是
//     "Map<String, Rcp_FormFieldValue>"）⇒ 线上字节顺序可能与 JS 给的 `formData` 顺序不同。
//     ★对绝大多数服务端无影响（按 name 取值），但**不是逐字节等价**——如实登记。
//   ⇒ 判据因此只看**服务端解析出的结构**（字段名/值、文件名、文件 sha256），不看字节序。
//
// 【★路径长度硬约束】`Rcp_ContentOrPathOrCallback.data.path` 是 `char[128]`：
//   沙箱绝对路径可能超长（长文件名 + 深目录）⇒ **必须显式报错，绝不静默截断**
//   （截断 = 读到另一个文件或根本打不开，比报错危险）。
#pragma once
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "invoke_wire.h"
#include "proteus_http_rcpapi.h"
#include "proteus_http_save.h"   // resolveSandboxPath（沙箱相对路径 → 绝对路径，三层校验）

#if defined(__has_include)
#if __has_include(<RemoteCommunicationKit/rcp.h>)
#include <RemoteCommunicationKit/rcp.h>
#define PROTEUS_UPLOAD_HAVE_H 1
#endif
#endif
#ifndef PROTEUS_UPLOAD_HAVE_H
#define PROTEUS_UPLOAD_HAVE_H 0
#endif

namespace proteus {
namespace http {

#if PROTEUS_UPLOAD_HAVE_H
/* ★★★没有 HMS 头时整段不编译（`Rcp_MultipartForm` 等类型不存在）。
 *   与 `proteus_http.h` 的 `#if !PROTEUS_HAVE_RCP` 同一策略：缺库诚实回 unsupported，不伪造。 */

/**
 * 一次上传的 multipart 构件。
 * ★**必须活到 fetch 结束**（RCP 可能在发送时才去读这些对象里的 `char*`——#1204 的
 *   session 配置崩溃就是这个教训）⇒ 调用方在 `handle()` 作用域内声明，不放内层块。
 */
struct MultipartUpload {
  Rcp_MultipartForm* form = nullptr;
  /** ★保活：`Rcp_Buffer::buffer` 明确写着 "Buffer will not be copied"。 */
  std::vector<std::string> fieldValues;
  bool ok = false;
  std::string err;
  /** 诊断读数（进探针回执，便于归因） */
  int fieldCount = 0;
  unsigned long long fileBytes = 0;
  std::string absPath;
};

/**
 * 构造 multipart 构件（不发送，只装配）。
 *
 * @param api 符号表（`createMultipartForm`/`destroyMultipartForm`/`setMultipartFormValue` 必须可用）
 * @param up  去程帧里的上传规格
 * @return `ok=false` ⇒ `err` 里是**可读原因**（调用方必须如实报错，不得降级成"发空请求"）
 */
inline MultipartUpload buildMultipartUpload(const RcpApi& api, const proteus::wire::UploadSpec& up) {
  MultipartUpload m;
  if (api.createMultipartForm == nullptr || api.setMultipartFormValue == nullptr ||
      api.destroyMultipartForm == nullptr) {
    m.err = "http.unsupported: librcp_c.so 缺 multipart 符号（版本过旧？）";
    return m;
  }
  // ① 沙箱路径解析（复用 savePath 的三层校验：非空 / 非绝对 / 无 `..`）
  const std::string abs = resolveSandboxPath(up.path);
  if (abs.empty()) {
    m.err = "http.failed: upload 路径非法（须为沙箱相对路径、非绝对、不含 ..）：" + up.path;
    return m;
  }
  m.absPath = abs;
  // ② 路径长度硬约束（`Rcp_ContentOrPathOrCallback.data.path` 是 char[128]）——超长如实报错
  if (abs.size() + 1 > static_cast<size_t>(RCP_MAX_PATH_LEN)) {
    m.err = "http.failed: upload 文件绝对路径过长（" + std::to_string(abs.size()) + " 字节，RCP 上限 " +
            std::to_string(RCP_MAX_PATH_LEN - 1) + "）⇒ 请缩短文件名或目录深度";
    return m;
  }
  // ③ 本地先确认文件存在且可读（否则平台报的错不可读，也拿不到大小）
  FILE* probe = std::fopen(abs.c_str(), "rb");
  if (probe == nullptr) {
    m.err = "http.failed: upload 文件打不开（不存在或无权限）：" + up.path;
    return m;
  }
  std::fseek(probe, 0, SEEK_END);
  const long sz = std::ftell(probe);
  std::fclose(probe);
  if (sz < 0) {
    m.err = "http.failed: upload 文件大小读取失败：" + up.path;
    return m;
  }
  m.fileBytes = static_cast<unsigned long long>(sz);

  if (up.fieldName.empty()) {
    m.err = "http.failed: upload 缺 fieldName（表单字段名）";
    return m;
  }
  // filename：优先用调用方给的；缺省回落到路径 basename（与 HTTP 客户端惯例一致）
  std::string filename = up.filename;
  if (filename.empty()) {
    const size_t slash = abs.find_last_of('/');
    filename = (slash == std::string::npos) ? abs : abs.substr(slash + 1);
  }
  if (filename.size() + 1 > static_cast<size_t>(RCP_MAX_FILENAME_LEN)) {
    m.err = "http.failed: upload 文件名过长（" + std::to_string(filename.size()) + " 字节，RCP 上限 " +
            std::to_string(RCP_MAX_FILENAME_LEN - 1) + "）";
    return m;
  }

  m.form = api.createMultipartForm();
  if (m.form == nullptr) {
    m.err = "http.failed: 建 RCP multipart form 失败";
    return m;
  }

  // ④ 普通表单字段（值必须保活——Rcp_Buffer 不拷贝）
  m.fieldValues.reserve(up.formData.size());
  for (const auto& kv : up.formData) {
    m.fieldValues.push_back(kv.second);
    Rcp_FormFieldValue fv{};
    fv.type = RCP_FORM_VALUE_TYPE_STRING;
    fv.data.varStr.buffer = m.fieldValues.back().c_str();
    fv.data.varStr.length = static_cast<uint32_t>(m.fieldValues.back().size());
    fv.next = nullptr;
    Rcp_MultipartFormFieldValue mv{};
    mv.type = RCP_TYPE_FORM_FIELD_VALUE;
    mv.data.formValue = fv;
    mv.next = nullptr;
    const uint32_t rc = api.setMultipartFormValue(m.form, kv.first.c_str(), &mv);
    if (rc != 0) {
      m.err = "http.failed: 设置 multipart 字段失败（" + kv.first + " · rc " + std::to_string(rc) + "）";
      return m;
    }
    m.fieldCount++;
  }

  // ⑤ 文件字段：把**绝对路径**交给平台，由 RCP 自己流式读（内存有界）
  Rcp_MultipartFormFieldValue fileField{};
  fileField.type = RCP_TYPE_FORM_FIELD_FILE_VALUE;
  ::snprintf(fileField.data.formFileValue.contentType,
             sizeof(fileField.data.formFileValue.contentType), "%s", "application/octet-stream");
  ::snprintf(fileField.data.formFileValue.remoteFileName,
             sizeof(fileField.data.formFileValue.remoteFileName), "%s", filename.c_str());
  fileField.data.formFileValue.contentOrPathOrCb.type = RCP_FILE_VALUE_TYPE_PATH;
  ::snprintf(fileField.data.formFileValue.contentOrPathOrCb.data.path,
             sizeof(fileField.data.formFileValue.contentOrPathOrCb.data.path), "%s", abs.c_str());
  fileField.next = nullptr;
  const uint32_t rc = api.setMultipartFormValue(m.form, up.fieldName.c_str(), &fileField);
  if (rc != 0) {
    m.err = "http.failed: 设置 multipart 文件字段失败（" + up.fieldName + " · rc " + std::to_string(rc) + "）";
    return m;
  }
  m.ok = true;
  return m;
}

/** 销毁构件（幂等）。★调用方在 `handle()` 的所有出口都要调（用 RAII 守卫更稳）。 */
inline void destroyMultipartUpload(const RcpApi& api, MultipartUpload* m) {
  if (m->form != nullptr && api.destroyMultipartForm != nullptr) {
    api.destroyMultipartForm(m->form);
  }
  m->form = nullptr;
}

#endif  // PROTEUS_UPLOAD_HAVE_H

}  // namespace http
}  // namespace proteus
