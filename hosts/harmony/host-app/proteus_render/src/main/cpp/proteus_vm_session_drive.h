// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_vm_session_drive.h
// ★★★#1344 B-4：**会话内的 app drive（带泵）** —— 从 `proteus_vm_session.h` 拆出。
//
// 【为什么单列（两条硬理由）】
//   ① `check:file-size`：`proteus_vm_session.h` 加完本函数后 1076 行 ≥ 1000 上限；
//   ② 职责原本就不该混：`proteus_vm_session.h` 管「生命周期 + tick + 回推搬运」，
//      而本文件管「**在会话里跑一条 await 链并把泵推进它**」——后者是渲染/导航语义，
//      与 VM 生命周期是两件事。
//
// 【它解决什么（真机定位的根因，不是推测）】
//   `sessionEval` 只做**一次** checkpoint，而 `__proteusHostAppDrive` 内部是
//   `await app.booted` + 逐 tab `await navigate`，navigate 还要等**路由转场动画**
//   （`g_scAnimRemainMs` / `g_scAnimHandles` 那套）。
//   没有泵 ⇒ Promise 永不结算；而一次 checkpoint 硬推整条 await 链 ⇒ 微任务栈撑爆。
//
// 【真机证据（落盘诊断，因为 hilog 会被系统丢弃）】
//   `0-enter → 2-before-open → 3-after-open(113B) → 4-after-parse(ok) → s1..s5 全过`
//   → **`s6-before-drive` 之后无 `s7`** ⇒ 死在 `trySessionDrive` 那次调用里。
//   改用本文件的带泵入口后：`d1-before-hostDrive → d2-after-hostDrive(788B)` → `s7/s8` 全过。
//
// 【设计：与一次性 VM 的 `hostAppDrive` 逐项同构】
//   kick async 驱动 → 有界泵（推进转场 + checkpoint + 读 getter，最多 4096 轮）→ 返回同形回执。
//   ★**上界 4096 不是"等多久"，是"最多推多少轮"**（确定性上界，不是盲等）。
//   ★只能由 ArkTS 主线程调用（与 open/tick/close 同纪律：`JSVM_Env` 绑定创建它的线程）。
#ifndef PROTEUS_VM_SESSION_DRIVE_H
#define PROTEUS_VM_SESSION_DRIVE_H

#include "proteus_vm_session.h"

namespace proteus {
namespace vmsess {

/**
 * 会话内的 app drive（带泵）。
 *
 * @param argsJson `{"tabs"?:["index",…]}`（`bundle`/`filesDir` 在 open 时已用过，无需重传）
 * @returns 与 `hostAppDrive` **同形**的 JSON 串：`{"ok":true,"drive":…,"rounds":N}`
 */
inline std::string sessionDrive(const std::string& argsJson) {
    SessionState& S = state();
    if (!S.open || S.env == nullptr) return "{\"ok\":false,\"error\":\"会话未打开\"}";

    /* ① 读 tabs（缺省 ⇒ 传 undefined，让 JS 侧走"全部 tab"） */
    std::string tabsArg;
    {
        const size_t k = argsJson.find("\"tabs\"");
        if (k != std::string::npos) {
            const size_t lb = argsJson.find('[', k);
            const size_t rb = argsJson.find(']', lb == std::string::npos ? k : lb);
            if (lb != std::string::npos && rb != std::string::npos && rb > lb) {
                tabsArg = argsJson.substr(lb, rb - lb + 1);
            }
        }
    }

    /* ② kick：一条 async 驱动（boot 已在 open 时做过，这里只驱动导航） */
    {
        JSVM_HandleScope sc = nullptr;
        if (OH_JSVM_OpenHandleScope(S.env, &sc) != JSVM_OK) {
            return "{\"ok\":false,\"error\":\"OpenHandleScope(kick) 失败\"}";
        }
        std::string expr = "String(__proteusHostAppDrive(" +
            (tabsArg.empty() ? std::string("undefined") : ("'" + tabsArg + "'")) + "))";
        std::string why;
        const bool ok = vmsEval(S.env, expr.c_str(), why);
        if (ok) OH_JSVM_PerformMicrotaskCheckpoint(S.vm);
        OH_JSVM_CloseHandleScope(S.env, sc);
        if (!ok) return "{\"ok\":false,\"error\":\"drive kick 失败：" + jsonEscape(why) + "\"}";
    }

    /* ③ 有界泵：与 hostAppDrive 的循环逐项同构（推进转场 + checkpoint + 读 getter） */
    std::string readValue = "null";
    int rounds = 0;
    for (int i = 0; i < 4096; i++) {
        if (g_scAnimRemainMs > 0) {
            for (uint64_t h : g_scAnimHandles) {
                char* rp = proteus_layout_anim_tick(h, 16.7f);
                if (rp) proteus_layout_free_string(rp);
            }
            g_scAnimRemainMs -= 16.7;
            if (g_scAnimRemainMs <= 0) {
                std::string dexpr = "typeof __proteusHostScreenAnimDone === 'function' ? String(__proteusHostScreenAnimDone(\"" +
                    jsonEscape(g_scAnimToken) + "\", '{}')) : 'no-hook'";
                JSVM_HandleScope sc = nullptr;
                if (OH_JSVM_OpenHandleScope(S.env, &sc) == JSVM_OK) {
                    std::string dw;
                    vmsEval(S.env, dexpr.c_str(), dw);
                    OH_JSVM_CloseHandleScope(S.env, sc);
                }
            }
        }
        OH_JSVM_PerformMicrotaskCheckpoint(S.vm);
        rounds++;
        JSVM_HandleScope sc = nullptr;
        if (OH_JSVM_OpenHandleScope(S.env, &sc) != JSVM_OK) break;
        std::string rv, rw;
        const bool rok = vmsToString(
            S.env,
            "typeof __proteusHostAppDriveReadJson === 'function' ? String(__proteusHostAppDriveReadJson()) : 'null'",
            rv, rw);
        OH_JSVM_CloseHandleScope(S.env, sc);
        if (!rok) break;
        readValue = rv;
        if (readValue.find("\"pending\":true") == std::string::npos) break;
    }

    return "{\"ok\":true,\"drive\":" + readValue + ",\"rounds\":" + std::to_string(rounds) + "}";
}

}  // namespace vmsess
}  // namespace proteus

/**
 * `hostVmSessionDrive(argsJson)` → `{ok,drive,rounds}`（napi 入口）。
 *
 * 【与 `hostVmSessionEval` 的区别】后者只做**一次** checkpoint 就返回，跑不动 await 链；
 *   本入口在宿主侧跑**有界泵**（推进转场 + checkpoint + 读 getter，最多 4096 轮）。
 *   ★这是 #1344 B-4 的真机崩点修复：`s6-before-drive` 之后无 `s7` ⇒ 死在裸 sessionEval。
 */
inline napi_value HostVmSessionDrive(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson = "{}", out;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0;
        if (napi_get_value_string_utf8(env, args[0], nullptr, 0, &len) == napi_ok) {
            argsJson.resize(len + 1, '\0');
            napi_get_value_string_utf8(env, args[0], &argsJson[0], argsJson.size(), &len);
            argsJson.resize(len);
        }
    }
    out = proteus::vmsess::sessionDrive(argsJson);
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

#endif  // PROTEUS_VM_SESSION_DRIVE_H
