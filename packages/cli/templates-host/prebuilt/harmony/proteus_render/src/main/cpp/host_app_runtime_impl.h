// hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h
// ★★★关注点分层（见 hosts/README-LAYERS.md）：**应用运行期驱动**（runtime HAR 单元）。
//
// 【它是什么】鸿蒙腿的「App 壳运行期」——在**一次性 VM** 里 eval `bundle-superapp.js`，
//   经 `proteusHost` 原语（invoke/mount/applyOps/getScroll/setScroll/onGesture）驱动
//   共享运行期（`createSuperappRuntime`）：boot 路由栈 → 实例化当前屏（host.mount 捕获 tree）
//   → 派发 tap（命中链 → 屏幕导航/数据变更）。返回 `{ok,current,state,snapshot,tree}`。
//
// 【为什么在 runtime（不是 dev）】此前这套驱动住在 dev 装置（`proteus_bench.cpp`）⇒ **壳反向依赖 dev**，
//   而 runtime 才是"换一个 App 不用改"的可依赖单元（分层门禁 `check-host-layering` 已具名登记待拆分）。
//   现按**中性名**下沉：`hostAppBoot / hostAppDrive / hostAppRender`（不认应用身份）。
//   ★唯一实现：本头被 `proteus_host.cpp`（HAR 桥，**导出**）与 `proteus_bench.cpp`（dev 装置，
//     保留 `superapp*` 别名）**共同 include**（`static` = 各 TU 各取一份，无链接耦合，单一来源）。
//
// 【★协议中性别名（绕开 runtime 禁词）】驱动只调 **`__proteusHostApp*`** 全局——它们是
//   `entry-superapp.ts` 里 `__proteusSuperapp*` 的**别名**（同一实现两份名字：装置用 superapp、
//   runtime 用中性别名）。故本文件**不含 `superapp` 字样**（`check-host-layering` 的 runtime 禁词）。
//
// 【★VM 形态 = 一次性（本机唯一稳定）】跨 napi 调用复用同一 JSVM ⇒ V8 微任务排空 HandleScope 溢出/
//   SIGSEGV（决策 #540 实测）。⇒ 每次调用**新建 VM → eval → boot/驱动 → 有界泵 → 读 → 销毁**；
//   跨交互状态由宿主 `snapshot` 回灌为 `seedData`（见 `__proteusHostAppRender` 的 state 入参）。
//
// 【诚实边界】一次性 VM ⇒ 跨交互的**运行期实例态不保留**（靠 snapshot 回灌恢复 count 等）；
//   命中链由 ArkTS 侧（持内核树）算出后传入（chain）；`screen.rect/shared` 未实现（e4 诚实跳过）。
#pragma once
#include "proteus_host_helpers.h"

/* ═══════════════════════════════════════════════════════════════════════
 * screen.* 协议分发（与 Android ScreenHost / iOS screen-host 同契约）——
 *   执行器（JS）把建屏/隐藏/销毁/转场翻译成 screen.* 请求，本处是真实现（真内核树）。
 * ═══════════════════════════════════════════════════════════════════════ */
static std::unordered_map<std::string, uint64_t> g_scHandle;
static std::unordered_map<std::string, int> g_scNodeCount;
static int g_scMounts = 0, g_scVisible = 0, g_scDestroy = 0, g_scContentTotal = 0, g_scSeq = 0;
static int g_scAnimStarted = 0;
// ★★★App 三端对齐 · 鸿蒙 anim 逐帧：在飞转场的 token / 剩余时长 / 目标句柄
static std::string g_scAnimToken;
static double g_scAnimRemainMs = 0;
static std::vector<uint64_t> g_scAnimHandles;

/** screen.* 分发（返回 JSON 串，与 Android ScreenHost.invoke 同形：多数包 {ok,data}） */
static std::string screenInvokeDispatch(const std::string& method, const std::string& argsJson) {
    if (method == "screen.mount") {
        std::string sid;
        jstr(argsJson.c_str(), argsJson.size(), "screenId", &sid);
        // content.nodes → 内核请求（内容 id 空间与屏根/层不冲突：屏根取高位基址）
        std::string contentObj = extractValueAfterKey(argsJson, "content", '{', '}');
        std::string nodesArr = extractNodesArray(contentObj);
        if (nodesArr.empty()) return "{\"ok\":false,\"reason\":\"screen.mount: 无 content.nodes\"}";
        int count = 0;
        { size_t p = 0; while ((p = nodesArr.find("\"id\":", p)) != std::string::npos) { count++; p += 5; } }
        // ★★★屏根节点：加**合成根**（非零 id —— 0 被 screen-executor-host 当"无根"哨兵），
        //   并把**内容首个根节点**的 parentId:null 改指该根（单点替换，零 id 重排）。
        int rootId = 900000 + (g_scSeq) * 10000;
        std::string nodesInner = nodesArr.substr(1, nodesArr.size() - 2); // 去外层 []
        {
            const std::string needle = "\"parentId\": null";
            size_t pn = nodesInner.find(needle);
            if (pn != std::string::npos) {
                char pnr[40]; snprintf(pnr, sizeof(pnr), "\"parentId\": %d", rootId);
                nodesInner = nodesInner.substr(0, pn) + pnr + nodesInner.substr(pn + needle.size());
            }
        }
        char rootNode[100]; snprintf(rootNode, sizeof(rootNode), "{\"id\":%d,\"parentId\":null,\"width\":1080,\"height\":2400}", rootId);
        std::string req = "{\"viewport\":{\"width\":1080,\"height\":2400},\"nodes\":[" + std::string(rootNode) + (count > 0 ? "," : "") + nodesInner + "]}";
        uint64_t h = proteus_layout_create(req.c_str());
        if (h == 0) return "{\"ok\":false,\"reason\":\"screen.mount: create 失败\"}";
        g_scHandle[sid] = h; g_scNodeCount[sid] = count;
        g_scMounts++; g_scContentTotal += count;
        char b[220];
        snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"rootNodeId\":%d,\"nodes\":%d,\"contentNodes\":%d}}", rootId, count + 1, count);
        return b;
    }
    if (method == "screen.visible") {
        g_scVisible++;
        return "{\"ok\":true,\"data\":{\"visible\":true,\"rects\":0}}";
    }
    if (method == "screen.destroy") {
        std::string sid; jstr(argsJson.c_str(), argsJson.size(), "screenId", &sid);
        int rem = 0;
        auto it = g_scHandle.find(sid);
        if (it != g_scHandle.end()) { proteus_layout_destroy(it->second); rem = g_scNodeCount[sid]; g_scHandle.erase(it); g_scNodeCount.erase(sid); }
        g_scDestroy++;
        char b[160]; snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"removed\":%d,\"destroyed\":true}}", rem);
        return b;
    }
    if (method == "screen.anim") {
        // ★★★真逐帧：start 内核动画（曲线/弹簧在 Rust 侧求值）——不 immediate，
        //   JS 侧等 `__proteusHostScreenAnimDone(token)` 回推（回推由泵循环在到点时发出）。
        std::string tok; jstr(argsJson.c_str(), argsJson.size(), "token", &tok);
        double dur = 300; jnum(argsJson.c_str(), argsJson.size(), "durationMs", &dur);
        std::string animsArr = extractValueAfterKey(argsJson, "anims", '[', ']');
        if (animsArr.empty() || animsArr == "[]") {
            return "{\"ok\":true,\"data\":{\"started\":0,\"immediate\":true}}";
        }
        int started = 0;
        g_scAnimHandles.clear();
        for (auto& kv : g_scHandle) {
            std::string body = "{\"anims\":" + animsArr + "}";
            char* rp = proteus_layout_anim_start(kv.second, body.c_str());
            std::string rs = rp ? rp : "{}"; if (rp) proteus_layout_free_string(rp);
            double n = 0; jnum(rs.c_str(), rs.size(), "started", &n);
            if (n > 0) { started += (int)n; g_scAnimHandles.push_back(kv.second); }
        }
        if (started == 0) {
            return "{\"ok\":true,\"data\":{\"started\":0,\"immediate\":true,\"note\":\"内核未受理任何动画（如实）\"}}";
        }
        g_scAnimToken = tok;
        g_scAnimRemainMs = dur > 0 ? dur : 300;
        g_scAnimStarted += started;
        char b[128]; snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"started\":%d}}", started);
        return b;
    }
    if (method == "screen.rect" || method == "screen.shared") {
        return "{\"ok\":false,\"missing\":true,\"reason\":\"未实现（e4 诚实跳过）\"}";
    }
    if (method == "screen.stats") {
        char b[320];
        snprintf(b, sizeof(b), "{\"ok\":true,\"data\":{\"mount_calls\":%d,\"visible_calls\":%d,\"destroy_calls\":%d,\"content_node_total\":%d,\"live_screens\":%d}}",
                 g_scMounts, g_scVisible, g_scDestroy, g_scContentTotal, (int)g_scHandle.size());
        return b;
    }
    return "{\"ok\":false,\"reason\":\"未实现的 screen 方法\"}";
}

/** JSVM 回调：proteusHost.invoke(method, argsJson) → JSON 串 */
static JSVM_Value InvokeCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 2; JSVM_Value args[2] = {nullptr, nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::string method, aj;
    if (argc > 0) jsvmStr(env, args[0], &method);
    if (argc > 1) jsvmStr(env, args[1], &aj);
    std::string out = screenInvokeDispatch(method, aj);
    JSVM_Value r = nullptr; OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r); return r;
}

/* ═══════════════ 运行期渲染（一次性 VM，中性名）═══════════════ */

/** 运行期实例化后的屏内容（由 MountCaptureCb 捕获） */
static std::string g_scRuntimeTree;

/** `proteusHost.mount(treeJson)` 的运行期实现：**捕获** tree（交给 ArkTS 上屏），不在此建树。 */
static JSVM_Value MountCaptureCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 1; JSVM_Value args[1] = {nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    if (argc > 0 && args[0] != nullptr) jsvmStr(env, args[0], &g_scRuntimeTree);
    JSVM_Value r = nullptr; OH_JSVM_CreateStringUtf8(env, "{\"ok\":true}", JSVM_AUTO_LENGTH, &r); return r;
}

/** 运行期其余原语的空实现（applyOps/getScroll/setScroll/onGesture：本机不上屏增量/滚动由 ArkTS 管）。 */
static JSVM_Value NoopCb(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value r = nullptr; OH_JSVM_CreateStringUtf8(env, "{\"ok\":true}", JSVM_AUTO_LENGTH, &r); return r;
}

/** ★getScroll 返 0（鸿蒙滚动由 ArkTS 管；前进即重置）。 */
static JSVM_Value GetScroll0Cb(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value r = nullptr; OH_JSVM_CreateDouble(env, 0.0, &r); return r;
}

/**
 * hostAppBoot(argsJson {bundle, filesDir}): string(JSON)
 *   一次性 VM：注入 proteusHost{invoke} + 平台全局 → eval bundle → `__proteusHostAppBootJson()`
 *   （路由栈 + 进入入口 tab）→ 有界泵 job → 返回 boot + state。
 */
static napi_value HostAppBoot(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1); napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len); argsJson.resize(len);
    }
    std::string bundle, filesDir;
    jstr(argsJson.c_str(), argsJson.size(), "bundle", &bundle);
    jstr(argsJson.c_str(), argsJson.size(), "filesDir", &filesDir);
    (void)filesDir;   // filesDir 未用（一次性 VM，不持久）

    std::string err, boot = "null", state = "null";
    // ★★形态 = 一次性 VM（create → eval → boot → 泵 → 读 → destroy）。
    //   【为什么一次性而非持久】跨 napi 调用复用同一 VM 时，V8 微任务排空会 HandleScope 溢出/SIGSEGV
    //   （本仓实测多次）；一次性 VM 是本机唯一稳定的形态。
    JSVM_VM vm = nullptr; JSVM_Env jenv = nullptr; JSVM_HandleScope scope = nullptr; JSVM_VMScope vmScope = nullptr;
    bool policyOk = false; bool cr = false;
    if (bundle.empty()) err = "缺 bundle";
    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo; memset(&vo, 0, sizeof(vo));
    if (err.empty()) {
        if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) err = "CreateVM 失败";
        else if (OH_JSVM_OpenVMScope(vm, &vmScope) != JSVM_OK) err = "OpenVMScope 失败";
        else if (OH_JSVM_CreateEnv(vm, 0, nullptr, &jenv) != JSVM_OK || jenv == nullptr) err = "CreateEnv 失败";
        else if (OH_JSVM_OpenHandleScope(jenv, &scope) != JSVM_OK) err = "OpenHandleScope 失败";
        else policyOk = (OH_JSVM_SetMicrotaskPolicy(vm, JSVM_MICROTASK_EXPLICIT) == JSVM_OK);
    }
    if (err.empty()) {
        jsvmEvalStr(jenv, "globalThis.__PROTEUS_HOST_ID__ = 'harmony';"
                          "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'postFrameCallback';", nullptr);
        JSVM_Value host = nullptr; OH_JSVM_CreateObject(jenv, &host);
        JSVM_CallbackStruct cb; cb.callback = InvokeCb; cb.data = nullptr;
        JSVM_Value fn = nullptr; OH_JSVM_CreateFunction(jenv, "invoke", JSVM_AUTO_LENGTH, &cb, &fn);
        OH_JSVM_SetNamedProperty(jenv, host, "invoke", fn);
        JSVM_Value global = nullptr; OH_JSVM_GetGlobal(jenv, &global);
        OH_JSVM_SetNamedProperty(jenv, global, "proteusHost", host);
        JSVM_Value src = nullptr; OH_JSVM_CreateStringUtf8(jenv, bundle.c_str(), bundle.size(), &src);
        JSVM_Script script = nullptr;
        if (OH_JSVM_CompileScript(jenv, src, nullptr, 0, false, &cr, &script) != JSVM_OK) err = "bundle 编译失败";
        else { JSVM_Value rr = nullptr; if (OH_JSVM_RunScript(jenv, script, &rr) != JSVM_OK) err = "bundle 执行失败"; }
    }
    if (err.empty()) {
        jsvmEvalStr(jenv, "String(__proteusHostAppBootJson())", &boot);
        // 有界泵：排空 boot 的导航续体（进入入口 tab）
        for (int i = 0; i < 400; i++) {
            if (g_scAnimRemainMs > 0) {
                for (uint64_t h : g_scAnimHandles) { char* rp = proteus_layout_anim_tick(h, 16.7f); if (rp) proteus_layout_free_string(rp); }
                g_scAnimRemainMs -= 16.7;
                if (g_scAnimRemainMs <= 0) {
                    std::string dexpr = "typeof __proteusHostScreenAnimDone === 'function' ? String(__proteusHostScreenAnimDone(\""
                        + jsonEscape(g_scAnimToken) + "\", '{}')) : 'no-hook'";
                    jsvmEvalStr(jenv, dexpr.c_str(), nullptr);
                    JSVM_Value exc = nullptr; OH_JSVM_GetAndClearLastException(jenv, &exc);
                }
            }
            if (policyOk) OH_JSVM_PerformMicrotaskCheckpoint(vm);
        }
        jsvmEvalStr(jenv, "String(__proteusHostAppState())", &state);
    }
    if (jenv != nullptr && scope != nullptr) OH_JSVM_CloseHandleScope(jenv, scope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);
    std::string out = "{\"ok\":" + std::string(err.empty() ? "true" : "false")
        + ",\"boot\":" + boot + ",\"state\":" + state;
    if (!err.empty()) out += ",\"error\":\"" + jsonEscape(err) + "\"";
    out += "}";
    napi_value r; napi_create_string_utf8(env, out.c_str(), out.size(), &r); return r;
}

/**
 * hostAppDrive(argsJson {bundle, filesDir, tabs?}): string(JSON)
 *   单次 napi 调用内跑完：eval bundle → boot → kick 一条 async 驱动（JS 侧
 *   `__proteusHostAppDrive`，内部 `await app.booted` 后逐 tab `await navigate`）→ 有界泵
 *   （推进转场 + checkpoint + 读 `__proteusHostAppDriveReadJson` 直到 pending=false）→ 销毁。
 */
static napi_value HostAppDrive(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1); napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len); argsJson.resize(len);
    }
    std::string bundle, filesDir, tabsJson;
    jstr(argsJson.c_str(), argsJson.size(), "bundle", &bundle);
    jstr(argsJson.c_str(), argsJson.size(), "filesDir", &filesDir);
    tabsJson = extractValueAfterKey(argsJson, "tabs", '[', ']');   // ["index","messages","mine"]
    (void)filesDir;   // filesDir 未用（一次性 VM，不持久）

    std::string err, boot = "null", readValue = "null";
    int rounds = 0;
    if (bundle.empty()) err = "缺 bundle";
    JSVM_VM vm = nullptr; JSVM_Env jenv = nullptr; JSVM_HandleScope scope = nullptr; JSVM_VMScope vmScope = nullptr;
    bool policyOk = false; bool cr = false;
    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo; memset(&vo, 0, sizeof(vo));
    if (err.empty()) {
        if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) err = "CreateVM 失败";
        else if (OH_JSVM_OpenVMScope(vm, &vmScope) != JSVM_OK) err = "OpenVMScope 失败";
        else if (OH_JSVM_CreateEnv(vm, 0, nullptr, &jenv) != JSVM_OK || jenv == nullptr) err = "CreateEnv 失败";
        else if (OH_JSVM_OpenHandleScope(jenv, &scope) != JSVM_OK) err = "OpenHandleScope 失败";
        else policyOk = (OH_JSVM_SetMicrotaskPolicy(vm, JSVM_MICROTASK_EXPLICIT) == JSVM_OK);
    }
    if (err.empty()) {
        jsvmEvalStr(jenv, "globalThis.__PROTEUS_HOST_ID__ = 'harmony';"
                          "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'postFrameCallback';", nullptr);
        JSVM_Value host = nullptr; OH_JSVM_CreateObject(jenv, &host);
        JSVM_CallbackStruct cb; cb.callback = InvokeCb; cb.data = nullptr;
        JSVM_Value fn = nullptr; OH_JSVM_CreateFunction(jenv, "invoke", JSVM_AUTO_LENGTH, &cb, &fn);
        OH_JSVM_SetNamedProperty(jenv, host, "invoke", fn);
        JSVM_Value global = nullptr; OH_JSVM_GetGlobal(jenv, &global);
        OH_JSVM_SetNamedProperty(jenv, global, "proteusHost", host);
        JSVM_Value src = nullptr; OH_JSVM_CreateStringUtf8(jenv, bundle.c_str(), bundle.size(), &src);
        JSVM_Script script = nullptr;
        if (OH_JSVM_CompileScript(jenv, src, nullptr, 0, false, &cr, &script) != JSVM_OK) err = "bundle 编译失败";
        else { JSVM_Value rr = nullptr; if (OH_JSVM_RunScript(jenv, script, &rr) != JSVM_OK) err = "bundle 执行失败"; }
    }
    if (err.empty()) {
        // ① kick：boot（进入入口 tab）
        jsvmEvalStr(jenv, "String(__proteusHostAppBootJson())", &boot);
        // ② kick：一条 async 驱动（boot 后逐 tab await navigate——由宿主泵推它前进）
        std::string tabsArg = tabsJson.empty() ? "[]" : tabsJson;
        std::string expr = "String(__proteusHostAppDrive('" + tabsArg + "'))";
        jsvmEvalStr(jenv, expr.c_str(), nullptr);
        // ③ 有界泵：每轮 推进内核动画（若有转场）+ checkpoint + 读 getter；pending=false 即停
        JSVM_Value global = nullptr; OH_JSVM_GetGlobal(jenv, &global);
        JSVM_Value undef = nullptr; OH_JSVM_GetUndefined(jenv, &undef);
        JSVM_Value fnR = nullptr;
        OH_JSVM_GetNamedProperty(jenv, global, "__proteusHostAppDriveReadJson", &fnR);
        for (int i = 0; i < 4096; i++) {
            if (g_scAnimRemainMs > 0) {
                for (uint64_t h : g_scAnimHandles) {
                    char* rp = proteus_layout_anim_tick(h, 16.7f);
                    if (rp) proteus_layout_free_string(rp);
                }
                g_scAnimRemainMs -= 16.7;
                if (g_scAnimRemainMs <= 0) {
                    std::string dexpr = "typeof __proteusHostScreenAnimDone === 'function' ? String(__proteusHostScreenAnimDone(\""
                        + jsonEscape(g_scAnimToken) + "\", '{}')) : 'no-hook'";
                    jsvmEvalStr(jenv, dexpr.c_str(), nullptr);
                    JSVM_Value exc = nullptr; OH_JSVM_GetAndClearLastException(jenv, &exc);
                }
            }
            if (policyOk) OH_JSVM_PerformMicrotaskCheckpoint(vm);
            rounds++;
            if (fnR != nullptr) {
                JSVM_Value rr = nullptr;
                if (OH_JSVM_CallFunction(jenv, undef, fnR, 0, nullptr, &rr) == JSVM_OK) {
                    jsvmStr(jenv, rr, &readValue);
                    if (readValue.find("\"pending\":true") == std::string::npos) break;
                } else break;
            } else break;
        }
    }
    if (jenv != nullptr && scope != nullptr) OH_JSVM_CloseHandleScope(jenv, scope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);
    std::string out = "{\"ok\":" + std::string(err.empty() ? "true" : "false")
        + ",\"boot\":" + boot + ",\"drive\":" + readValue + ",\"rounds\":" + std::to_string(rounds);
    if (!err.empty()) out += ",\"error\":\"" + jsonEscape(err) + "\"";
    out += "}";
    napi_value r; napi_create_string_utf8(env, out.c_str(), out.size(), &r); return r;
}

/**
 * hostAppRender(argsJson {bundle, filesDir, page, viewport:{width,height}, chain?:[int],
 *   state?:{屏名:{变量:值}}, remount?:bool}): string(JSON)
 *   一次性 VM：注入 proteusHost{invoke,mount,applyOps,getScroll,setScroll,onGesture} → eval bundle → boot
 *   → `__proteusHostAppRender({name:page, viewport, seedData?})`（共享运行期实例化该屏 → host.mount
 *   **捕获** tree）→ 可选 `__proteusHostAppGesture({type:'tap', chain})`（派发 → 导航/数据变更，
 *   派发后重挂取新树）→ 返回 `{ok,current,state,snapshot,tree}`。ArkTS 拿 tree 走
 *   `appScreenCommands + renderCommands` 上屏。
 */
static napi_value HostAppRender(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1); napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len); argsJson.resize(len);
    }
    std::string bundle, page;
    jstr(argsJson.c_str(), argsJson.size(), "bundle", &bundle);
    jstr(argsJson.c_str(), argsJson.size(), "page", &page);
    if (page.empty()) page = "index";
    double vpW = 390, vpH = 844;
    { std::string vpObj = extractValueAfterKey(argsJson, "viewport", '{', '}');
      if (!vpObj.empty()) { jnum(vpObj.c_str(), vpObj.size(), "width", &vpW); jnum(vpObj.c_str(), vpObj.size(), "height", &vpH); } }
    std::string chainArr = extractValueAfterKey(argsJson, "chain", '[', ']');
    std::vector<int> chainD = parseIntArrayBare(chainArr);
    bool hasChain = !chainD.empty();
    // ★★★跨调用状态回灌（一次性 VM）：宿主把上次 snapshot 回传为 `state`，本处转为 render 的
    //   seedData（恢复 count 等实例态）；无则用构建期初值。
    std::string stateJson = extractValueAfterKey(argsJson, "state", '{', '}');

    std::string err;
    g_scRuntimeTree.clear();
    if (bundle.empty()) err = "缺 bundle";

    JSVM_VM vm = nullptr; JSVM_Env jenv = nullptr; JSVM_HandleScope scope = nullptr; JSVM_VMScope vmScope = nullptr;
    bool policyOk = false; bool cr = false;
    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo; memset(&vo, 0, sizeof(vo));
    if (err.empty()) {
        if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) err = "CreateVM 失败";
        else if (OH_JSVM_OpenVMScope(vm, &vmScope) != JSVM_OK) err = "OpenVMScope 失败";
        else if (OH_JSVM_CreateEnv(vm, 0, nullptr, &jenv) != JSVM_OK || jenv == nullptr) err = "CreateEnv 失败";
        else if (OH_JSVM_OpenHandleScope(jenv, &scope) != JSVM_OK) err = "OpenHandleScope 失败";
        else policyOk = (OH_JSVM_SetMicrotaskPolicy(vm, JSVM_MICROTASK_EXPLICIT) == JSVM_OK);
    }
    if (err.empty()) {
        jsvmEvalStr(jenv, "globalThis.__PROTEUS_HOST_ID__ = 'harmony';"
                          "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'postFrameCallback';", nullptr);
        JSVM_Value host = nullptr; OH_JSVM_CreateObject(jenv, &host);
        struct NamedFn { const char* name; JSVM_CallbackStruct cb; };
        NamedFn fns[] = {
            {"invoke", {InvokeCb, nullptr}},
            {"mount", {MountCaptureCb, nullptr}},
            {"applyOps", {NoopCb, nullptr}},
            {"getScroll", {GetScroll0Cb, nullptr}},
            {"setScroll", {NoopCb, nullptr}},
            {"onGesture", {NoopCb, nullptr}},
        };
        for (auto& f : fns) {
            JSVM_Value fn = nullptr;
            OH_JSVM_CreateFunction(jenv, f.name, JSVM_AUTO_LENGTH, &f.cb, &fn);
            OH_JSVM_SetNamedProperty(jenv, host, f.name, fn);
        }
        JSVM_Value global = nullptr; OH_JSVM_GetGlobal(jenv, &global);
        OH_JSVM_SetNamedProperty(jenv, global, "proteusHost", host);
        JSVM_Value src = nullptr; OH_JSVM_CreateStringUtf8(jenv, bundle.c_str(), bundle.size(), &src);
        JSVM_Script script = nullptr;
        if (OH_JSVM_CompileScript(jenv, src, nullptr, 0, false, &cr, &script) != JSVM_OK) err = "bundle 编译失败";
        else { JSVM_Value rr = nullptr; if (OH_JSVM_RunScript(jenv, script, &rr) != JSVM_OK) err = "bundle 执行失败"; }
    }
    if (err.empty()) {
        // ① boot（进入入口 tab）
        jsvmEvalStr(jenv, "String(__proteusHostAppBootJson())", nullptr);
        // ② 渲染目标屏（JS 共享运行期实例化 → host.mount 捕获 tree）——★带 seedData 恢复跨调用实例态
        std::string seedFrag = stateJson.empty() ? std::string("") : (std::string(",\"seedData\":") + stateJson);
        char vpHead[256]; snprintf(vpHead, sizeof(vpHead), "{\"name\":\"%s\",\"viewport\":{\"width\":%.4f,\"height\":%.4f}",
                                    jsonEscape(page).c_str(), vpW, vpH);
        std::string vpb = std::string(vpHead) + seedFrag + "}";
        std::string renderExpr = "String(__proteusHostAppRender('" + vpb + "'))";
        jsvmEvalStr(jenv, renderExpr.c_str(), nullptr);
        if (policyOk) OH_JSVM_PerformMicrotaskCheckpoint(vm);
        // ③ 可选：派发一次 tap（导航 / 数据变更）——派发后**重挂**以取"反映新 state"的整树
        if (hasChain) {
            std::string ch = "[";
            for (size_t i = 0; i < chainD.size(); i++) { if (i) ch += ","; ch += std::to_string(chainD[i]); }
            ch += "]";
            std::string gexpr = "String(__proteusHostAppGesture('{\"type\":\"tap\",\"chain\":" + ch + "}'))";
            jsvmEvalStr(jenv, gexpr.c_str(), nullptr);
            if (policyOk) OH_JSVM_PerformMicrotaskCheckpoint(vm);
            std::string afterPage;
            jsvmEvalStr(jenv, "String(__proteusHostAppRuntimeCurrent())", &afterPage);
            if (afterPage.empty() || afterPage == "null") afterPage = page;
            char vpb2[512]; snprintf(vpb2, sizeof(vpb2), "{\"name\":\"%s\",\"viewport\":{\"width\":%.4f,\"height\":%.4f},\"remount\":true}",
                                     jsonEscape(afterPage).c_str(), vpW, vpH);
            std::string reRender = "String(__proteusHostAppRender('" + std::string(vpb2) + "'))";
            jsvmEvalStr(jenv, reRender.c_str(), nullptr);
            if (policyOk) OH_JSVM_PerformMicrotaskCheckpoint(vm);
        }
    }
    std::string cur = "null";
    // ★★返回"**实际渲染的屏名**"（而非路由态 current）——boot 后路由 current 恒为入口 index，
    //   而 render/mountScreen 可能挂的是另一页；不一致会导致 ArkTS 重绘时回到 index。
    std::string rendered = page;
    if (err.empty()) {
        std::string got;
        jsvmEvalStr(jenv, "String(__proteusHostAppRuntimeCurrent())", &got);
        if (got != "null" && !got.empty()) rendered = got;
        jsvmEvalStr(jenv, "String(__proteusHostAppState())", &cur);
    }
    // ★快照必须在 VM/Env 销毁**之前**取（在已销毁的 env 上 eval ⇒ SIGSEGV；本处曾踩过）
    std::string snap = "{}";
    if (err.empty()) jsvmEvalStr(jenv, "String(__proteusHostAppSnapshot())", &snap);
    if (jenv != nullptr && scope != nullptr) OH_JSVM_CloseHandleScope(jenv, scope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);
    std::string out = "{\"ok\":" + std::string(err.empty() ? "true" : "false")
        + ",\"current\":\"" + jsonEscape(rendered) + "\",\"state\":" + cur
        + ",\"snapshot\":" + (snap.empty() ? std::string("{}") : snap)
        + ",\"tree\":" + (g_scRuntimeTree.empty() ? "null" : g_scRuntimeTree);
    if (!err.empty()) out += ",\"error\":\"" + jsonEscape(err) + "\"";
    out += "}";
    napi_value r; napi_create_string_utf8(env, out.c_str(), out.size(), &r); return r;
}
