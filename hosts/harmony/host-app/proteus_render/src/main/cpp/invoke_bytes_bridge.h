// hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_bytes_bridge.h
// ★★★能力通道的**二进制腿**（`proteusHost.invokeBytes`）—— T-app-fetch · 决策 #903 的鸿蒙宿主落点
//
// 【为什么单列一个头（而不是塞进 host_app_runtime_impl.h）】
//   后者已 ~980 行（`pnpm check:file-size` 硬上限 1000）⇒ 新增一段 70 行的回调必然破限。
//   本头只被它 include 一次，职责单一：**帧的搬运与分发**（编解码在 `invoke_wire.h`，
//   HTTP 语义在 `proteus_http.h`）——与 iOS `invoke-bytes-bridge.swift` 同样切分。
//
// 【为什么同步完成整次往返（诚实边界，不粉饰为"三端一致"）】
//   鸿蒙 superapp 路径是**一次性 VM**（`hostAppRender` 每次新建 VM、同步跑完、返回即销毁）。
//   JS 侧 `useFetch` 的 `invokeBytes` 调用发生在该 napi 调用**内部**：交回 ArkTS 或异步回推都
//   没有接收方。⇒ 唯一合法形态 = 在本回调内同步完成（`HMS_Rcp_FetchSync`）。
//   ★与 Android/iOS 的差别：那边是"受理即返、网络线程完成再回推主线程"；这边阻塞调用线程。
//     错误码/取数**形状**一致，**调度语义**不一致（如实登记）。
//
// 【★线程纪律】本回调只在 JSVM 调用线程（ArkTS 主线程）执行 —— `HMS_Rcp_FetchSync` 本身阻塞该线程，
//   期间不会有第二个 JS 调用进来（单线程语义天然成立）。
#pragma once
#include <cstring>
#include <string>
#include <vector>

#include "invoke_wire.h"
#include "proteus_http.h"
#include "proteus_host_helpers.h"

/**
 * ★★2026-10-19（用户：「能力通道也去 JSON 化」）：**通用能力分发钩子**。
 *
 * 【为什么用函数指针而不是直接调 `screenInvokeDispatch`】后者是 `static`（各 TU 各一份），且定义在
 *   `host_app_runtime_impl.h` **包含本头之后**；本头也被 `http_probe.h`（不含能力分发）单独包含
 *   ⇒ 直接引用会编译/链接失败。钩子让"能力语义只有一份"（就是 JSON 腿那份 `screenInvokeDispatch`），
 *   而字节腿只负责**载荷形态**。
 * 【未注册时的语义】回 `missing` 帧（桥给 `*.unsupported`）——**不伪造成功**。
 */
typedef std::string (*ProteusGenericInvokeFn)(const std::string& method, const std::string& argsJson);
static ProteusGenericInvokeFn g_proteusGenericInvoke = nullptr;

/** 注册通用能力分发（由 `host_app_runtime_impl.h` 在 `screenInvokeDispatch` 定义后调用一次）。 */
static inline void setInvokeBytesGenericHandler(ProteusGenericInvokeFn fn) {
    g_proteusGenericInvoke = fn;
}

/**
 * JSVM 回调：`proteusHost.invokeBytes(frame: Uint8Array) → Uint8Array`（同步返回回程帧）。
 *
 * 【覆盖】`http.request` 走 `proteus_http`（大载荷裸字节）；其余能力走**通用分发**（已注册的
 *   `screenInvokeDispatch` ⇒ 与 JSON 腿同一份能力语义；帧 body = JSON 字节）。
 *   未注册 / 方法不存在 ⇒ `missing` 帧（桥据此给 `*.unsupported`，**不伪造成功**）。
 * 【坏帧】解不出帧 ⇒ 拿不到 reqId；JS 侧 `invokeHostAsyncBytes` 按**本次调用自己的 reqId** 结算
 *   （不依赖帧内 reqId）⇒ reason 仍能如实到达调用方（与 Android 同口径）。
 */
static JSVM_Value InvokeBytesCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 1;
    JSVM_Value args[1] = {nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::vector<uint8_t> in;
    if (argc > 0 && args[0] != nullptr) {
        JSVM_TypedarrayType t = JSVM_UINT8_ARRAY;
        size_t len = 0;
        void* data = nullptr;
        JSVM_Value ab = nullptr;
        size_t off = 0;
        if (OH_JSVM_GetTypedarrayInfo(env, args[0], &t, &len, &data, &ab, &off) == JSVM_OK && data != nullptr) {
            const uint8_t* p = static_cast<const uint8_t*>(data);
            in.assign(p, p + len);
        }
    }

    std::vector<uint8_t> outBytes;
    proteus::wire::InvokeFrame f;
    bool decoded = false;
    try {
        f = proteus::wire::decodeInvoke(in);
        decoded = true;
    } catch (const std::exception& e) {
        OH_LOG_ERROR(LOG_APP, "PROTEUS_INVOKE_BYTES_DECODE_FAIL err=%{public}s bytes=%{public}zu",
                     e.what(), in.size());
        outBytes = proteus::wire::encodeResolve(
            proteus::wire::ResolveFrame::err("", std::string("invokeBytes 宿主侧失败：") + e.what()));
    }
    if (decoded) {
        if (f.method == "http.request") {
            proteus::wire::ResolveFrame rf = proteus::http::handle(f);
            outBytes = proteus::wire::encodeResolve(rf);
            OH_LOG_INFO(LOG_APP,
                        "PROTEUS_HTTP_REQUEST req=%{public}s ok=%{public}d status=%{public}u body=%{public}zu url=%{public}.160s",
                        f.reqId.c_str(), rf.ok ? 1 : 0, rf.status ? *rf.status : 0u, rf.body.size(),
                        f.url ? f.url.v.c_str() : "");
        } else {
            // ★通用能力：帧 body = JSON 字节 ⇒ 交已注册的能力分发（与 JSON 腿**同一份**实现）⇒
            //   返回值（既有 `{"ok":…}` JSON 串）原样作回程 body。
            if (g_proteusGenericInvoke == nullptr) {
                OH_LOG_INFO(LOG_APP, "PROTEUS_INVOKE_BYTES_MISSING method=%{public}s reason=no-handler", f.method.c_str());
                outBytes = proteus::wire::encodeResolve(proteus::wire::ResolveFrame::missingMethod(
                    f.reqId, "二进制通道未注册通用能力分发（该入口不支持：" + f.method + "）"));
            } else {
                std::string argsJson = f.body.empty() ? std::string("{}")
                                                      : std::string(reinterpret_cast<const char*>(f.body.data()), f.body.size());
                std::string out = g_proteusGenericInvoke(f.method, argsJson);
                proteus::wire::ResolveFrame rf = proteus::wire::ResolveFrame::okOf(f.reqId);
                rf.body.assign(out.begin(), out.end());
                outBytes = proteus::wire::encodeResolve(rf);
                OH_LOG_INFO(LOG_APP, "PROTEUS_INVOKE_BYTES_GENERIC method=%{public}s body=%{public}zu",
                            f.method.c_str(), out.size());
            }
        }
    }

    // 造 JS `Uint8Array`（**拷贝**进 JS 堆——回调返回后栈上的字节即失效）
    void* outData = nullptr;
    JSVM_Value ab = nullptr;
    if (OH_JSVM_CreateArraybuffer(env, outBytes.size(), &outData, &ab) != JSVM_OK || ab == nullptr) {
        JSVM_Value undef = nullptr;
        OH_JSVM_GetUndefined(env, &undef);
        return undef;
    }
    if (outData != nullptr && !outBytes.empty()) memcpy(outData, outBytes.data(), outBytes.size());
    JSVM_Value ta = nullptr;
    if (OH_JSVM_CreateTypedarray(env, JSVM_UINT8_ARRAY, outBytes.size(), ab, 0, &ta) != JSVM_OK) {
        JSVM_Value undef = nullptr;
        OH_JSVM_GetUndefined(env, &undef);
        return undef;
    }
    return ta;
}

/**
 * 把 `invokeBytes` 挂到 **已建好的** `proteusHost` 对象上（一次性 VM 的所有注入形态共用）。
 * 抽成函数的理由：`host_app_runtime_impl.h` 里有 5 处建 `proteusHost`（3 处单方法 + 2 处 NamedFn 数组），
 * 逐处复制注册代码会把该文件推过 1000 行硬上限，也容易漏一处（**漏一处 ⇒ 该入口静默回落 JSON**）。
 */
static inline bool installInvokeBytes(JSVM_Env env, JSVM_Value host) {
    // ★★★必须 static（真机实测崩溃）：`JSVM_CallbackStruct` 的地址会被引擎**长期持有**——
    //   用局部变量时本函数一返回指针即悬空，后续 JS 调 invokeBytes 读到被覆写的回调指针 ⇒ cppcrash。
    //   （既有 `invoke`/`mount` 用调用方函数帧里的数组侥幸存活；本函数是独立帧，必须显式 static。）
    static JSVM_CallbackStruct cb;
    cb.callback = InvokeBytesCb;
    cb.data = nullptr;
    JSVM_Value fn = nullptr;
    if (OH_JSVM_CreateFunction(env, "invokeBytes", JSVM_AUTO_LENGTH, &cb, &fn) != JSVM_OK) return false;
    return OH_JSVM_SetNamedProperty(env, host, "invokeBytes", fn) == JSVM_OK;
}
