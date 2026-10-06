// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp
// ★★★关注点分层（见 hosts/README-LAYERS.md）：**宿主桥运行时**（HAR runtime 的第二原生模块）。
//   内容 = 「内容 → 内核树 → RenderCmd」桥（appScreenCommands）+ 滚动读数 + 真触摸命中 +
//   **壳生命周期桥**（hostRtShellInstall/Event：真 Ability 生命周期 → JS 运行时）。
//   ★此前错放在 dev 装置（proteus_bench.cpp）⇒ 壳（shell）反向依赖 dev；现归位 runtime（HAR）。
//   ★诚实边界：hostBoot/hostDrive（应用启动驱动）仍留 dev——与 dev 的 screen.* 执行器簇
//     （g_sc*/screenInvokeDispatch/InvokeCb/g_scAnim*）深度耦合、带项目身份（superapp），
//     已在 scripts/check-host-layering.mjs 具名登记（待后端拆分）。
//   NAPI 模块名 `proteus_host`（.so = libproteus_host.so）；ArkTS 侧 `import ... from 'proteus_host'`。
#include "proteus_host_helpers.h"
#include <arkui/native_node_napi.h>

#define PROTEUS_HOST_DOMAIN 0x0003
#define PROTEUS_HOST_TAG "ProteusHostBridge"
// 迁移前代码用了 bench 的宏名——就地别名（语义 = 同一 log 域）
#define PROTEUS_BENCH_DOMAIN PROTEUS_HOST_DOMAIN
#define PROTEUS_BENCH_TAG PROTEUS_HOST_TAG

/* ── 矩阵 #18 C 组：**持久 VM**（壳转发用——跨事件存活，不销毁；与 Android 的 shellRt 同构） ──
 *
 * 【为什么持久】壳转发的运行时代表"App 进程"本身（Android 注释同语）：它要跨多次
 *   onBackground/onForeground 存活，事件之间状态机保持（suspend 之后 resume 才是同一实例）。
 *   探针 VM（hostRuntimeProbe）是一次性的；本 VM 由 `hostRtShellInstall` 建立后**不销毁**。
 */
static JSVM_VM g_shellVm = nullptr;
static JSVM_Env g_shellEnv = nullptr;
static JSVM_HandleScope g_shellScope = nullptr;
static JSVM_VMScope g_shellVmVScope = nullptr;
static std::string g_shellDir;
static int g_shellAttempts = 0;   // 真事件回调次数（宿主侧计数）
static int g_shellPushes = 0;     // 成功推入 JS 次数
static std::string g_shellHookState = "none";  // none / installed / no-hook

static napi_value HostRtShellInstall(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len);
        argsJson.resize(len);
    }
    std::string bundle, filesDir;
    jstr(argsJson.c_str(), argsJson.size(), "bundle", &bundle);
    jstr(argsJson.c_str(), argsJson.size(), "filesDir", &filesDir);
    if (!filesDir.empty()) g_shellDir = filesDir;

    if (g_shellEnv != nullptr) {
        napi_value out;
        std::string r = "{\"ok\":true,\"already\":true,\"hook\":\"" + g_shellHookState + "\"}";
        napi_create_string_utf8(env, r.c_str(), NAPI_AUTO_LENGTH, &out);
        return out;
    }
    std::string err;
    if (bundle.empty()) err = "缺 bundle";
    JSVM_InitOptions io;
    memset(&io, 0, sizeof(io));
    OH_JSVM_Init(&io);
    JSVM_CreateVMOptions vo;
    memset(&vo, 0, sizeof(vo));
    if (err.empty()) {
        if (OH_JSVM_CreateVM(&vo, &g_shellVm) != JSVM_OK || g_shellVm == nullptr) {
            err = "CreateVM 失败";
        } else if (OH_JSVM_OpenVMScope(g_shellVm, &g_shellVmVScope) != JSVM_OK) {
            err = "OpenVMScope 失败";
        } else if (OH_JSVM_CreateEnv(g_shellVm, 0, nullptr, &g_shellEnv) != JSVM_OK || g_shellEnv == nullptr) {
            err = "CreateEnv 失败";
        } else if (OH_JSVM_OpenHandleScope(g_shellEnv, &g_shellScope) != JSVM_OK) {
            err = "OpenHandleScope 失败";
        } else if (OH_JSVM_SetMicrotaskPolicy(g_shellVm, JSVM_MICROTASK_EXPLICIT) != JSVM_OK) {
            err = "microtask-policy 失败";
        }
    }
    if (err.empty()) {
        jsvmEvalStr(g_shellEnv,
                    "globalThis.__PROTEUS_HOST_ID__ = 'harmony';"
                    "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'VSync(postFrameCallback)';", nullptr);
        JSVM_Value host = nullptr;
        OH_JSVM_CreateObject(g_shellEnv, &host);
        struct NamedFn { const char* name; JSVM_CallbackStruct cb; };
        NamedFn fns[] = {{"memUsage", {HostMemUsageCb, nullptr}}, {"gc", {HostGcCb, nullptr}}};
        for (auto& f : fns) {
            JSVM_Value fn = nullptr;
            OH_JSVM_CreateFunction(g_shellEnv, f.name, JSVM_AUTO_LENGTH, &f.cb, &fn);
            OH_JSVM_SetNamedProperty(g_shellEnv, host, f.name, fn);
        }
        JSVM_Value global = nullptr;
        OH_JSVM_GetGlobal(g_shellEnv, &global);
        OH_JSVM_SetNamedProperty(g_shellEnv, global, "proteusHost", host);
        // eval bundle（IIFE——加载即注册钩子）
        JSVM_Value src = nullptr;
        OH_JSVM_CreateStringUtf8(g_shellEnv, bundle.c_str(), bundle.size(), &src);
        JSVM_Script script = nullptr;
        bool cr = false;
        if (OH_JSVM_CompileScript(g_shellEnv, src, nullptr, 0, false, &cr, &script) != JSVM_OK) {
            err = "bundle 编译失败";
        } else {
            JSVM_Value rr = nullptr;
            if (OH_JSVM_RunScript(g_shellEnv, script, &rr) != JSVM_OK) err = "bundle 执行失败";
        }
    }
    if (err.empty()) {
        std::string hook;
        jsvmEvalStr(g_shellEnv, "typeof __proteusHostShellLifecycle", &hook);
        g_shellHookState = (hook == "function") ? "installed" : "no-hook";
    }
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"ok\":%s,\"hook\":\"%s\"%s%s}",
             err.empty() ? "true" : "false", g_shellHookState.c_str(),
             err.empty() ? "" : ",\"error\":\"", err.empty() ? "" : (jsonEscape(err) + "\"").c_str());
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_SHELLINSTALL %{public}s", buf);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

static napi_value HostRtShellEvent(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string evt = "pause";
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        evt.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &evt[0], len + 1, &len);
        evt.resize(len);
    }
    g_shellAttempts++;
    std::string out = "{\"ok\":false,\"reason\":\"shell-not-installed\"}";
    if (g_shellEnv != nullptr && g_shellHookState == "installed") {
        std::string expr = "String(__proteusHostShellLifecycle('" + evt + "'))";
        std::string n;
        if (jsvmEvalStr(g_shellEnv, expr.c_str(), &n)) {
            bool pushed = !n.empty() && n != "no-hook";
            if (pushed) g_shellPushes++;
            OH_JSVM_PerformMicrotaskCheckpoint(g_shellVm);   // 宿主 job 泵（壳转发语义）
            std::string q;
            if (jsvmEvalStr(g_shellEnv, "__proteusHostShellQuery()", &q) && !q.empty()) {
                if (!g_shellDir.empty()) {
                    std::string path = g_shellDir + "/host-shell.json";
                    FILE* f = fopen(path.c_str(), "w");
                    if (f != nullptr) {
                        fwrite(q.data(), 1, q.size(), f);
                        fclose(f);
                    }
                }
                char b[220];
                snprintf(b, sizeof(b),
                         "{\"ok\":true,\"evt\":\"%s\",\"count\":%s,\"pushed\":%s,\"attempts\":%d,\"pushes\":%d}",
                         evt.c_str(), n.c_str(), pushed ? "true" : "false", g_shellAttempts, g_shellPushes);
                out = b;
            }
        } else {
            out = "{\"ok\":false,\"reason\":\"eval-failed\"}";
        }
    }
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_SHELLEVENT evt=%{public}s attempts=%{public}d pushes=%{public}d",
                 evt.c_str(), g_shellAttempts, g_shellPushes);
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), NAPI_AUTO_LENGTH, &r);
    return r;
}

/* ══════════════ App 三端对齐 · 鸿蒙视觉合成 + 真实触摸（2026-10-04） ══════════════
 *
 * 【要证明什么】App 屏内容（项目路由→真实 SFC→编译器）→ 内核树 → RenderCmd 真上屏；
 *   且**真实触摸**（`uitest uiInput` 系统输入栈真注入 → ArkTS `.onTouch`）能驱动内核 hitTest。
 * 【与上一版的分界】此前合成页的"可命中"是**装置内直调** `proteus_layout_hit_test`（绕过平台
 *   事件通道）——只能证明内核能命中。本版保留内核树并暴露 `appScreenHitAt`，由**真触摸**喂坐标
 *   ⇒ 与 Android 真 `MotionEvent`、iOS `classifyAndEmit` 真触摸序列同族（三端一致：真事件驱动交互）。
 * 【落地形态】`AppScreenCommands` 建树后**保留句柄**（g_appTouchTree）供真实触摸复用（不再 destroy）；
 *   ArkTS 默认场景 `attach + renderCommands` 真上屏；`.onTouch` 每个 DOWN → `appScreenHitAt(vp坐标)`。
 */

/** App 合成页的持久内核树（真实触摸命中用；`AppScreenCommands` 建、`AppScreenHitAt` 打） */
static uint64_t g_appTouchTree = 0;
static std::string g_appTouchPage;
static std::string g_appTouchFilesDir;
static int g_appTouchContentNodes = 0;
/// ★★★鸿蒙滚动对齐（2026-10-05 · 用户抓出「内容变长后看不到下面」）：**内容高（vp）**——
///   由 AppScreenCommands 建树后从内核 rects 的 maxBottom 算出；供 ArkTS 侧钳制滚动范围。
static double g_appContentHeightVp = 0;
static int g_appTouchCmdCount = 0;
static int g_appTouchHitCount = 0;      // 装置内命中（合成时 20 点，向后兼容旧读数）
static int g_appTouchTransformCount = 0; // ★批次 39：带静态变换的节点数（编译期 CSS transform）
static int g_appTouchOriginCount = 0;    // ★批次 40：带 transform-origin 的节点数
static int g_appTouchCssAnimNodes = 0;   // ★批次 42：带 CSS animation 的节点数（编译期折叠）
static int g_appTouchHitFirst = -1;
static int g_appTouchRealCount = 0;     // ★真实触摸事件数（.onTouch → appScreenHitAt）
static int g_appTouchRealHits = 0;      // ★真实触摸命中数
static int g_appTouchRealFirst = -1;    // ★首个真实命中目标

static int launchAppScreenAnimations(uint64_t handle, const std::vector<std::string>& items) {
    if (handle == 0) return 0;
    std::string anims = "["; int started = 0; int nodes = 0; bool first = true;
    for (const auto& it : items) {
        std::string arr = extractValueAfterKey(it, "animation", '[', ']');
        if (arr.empty()) continue;
        double id = -1; jnum(it.c_str(), it.size(), "id", &id);
        bool any = false;
        for (const auto& ch : splitJsonObjects(arr)) {
            std::string kf = extractValueAfterKey(ch, "keyframes", '[', ']');
            if (kf.empty()) continue;
            std::vector<std::string> segs = splitJsonObjects(kf);
            if (segs.empty()) continue;
            double kind = 0, from = 0, total = 0, lastTo = 0;
            jnum(ch.c_str(), ch.size(), "kind", &kind);
            jnum(ch.c_str(), ch.size(), "from", &from);
            lastTo = from;
            for (const auto& sg : segs) {
                double d = 0, t = 0;
                jnum(sg.c_str(), sg.size(), "durMs", &d);
                jnum(sg.c_str(), sg.size(), "to", &t);
                total += d; lastTo = t;
            }
            char b[400];
            snprintf(b, sizeof(b),
                     "%s{\"nodeId\":%d,\"kind\":%d,\"from\":%.6f,\"to\":%.6f,\"durMs\":%.6f,\"keyframes\":%s}",
                     first ? "" : ",", (int)id, (int)kind, from, lastTo, total, kf.c_str());
            anims += b; first = false; any = true; started++;
        }
        if (any) nodes++;
    }
    anims += "]";
    if (started == 0) return 0;
    std::string req = std::string("{\"anims\":") + anims + "}";
    char* r = proteus_layout_anim_start(handle, req.c_str());
    if (r) proteus_layout_free_string(r);
    return nodes;
}

static napi_value AppScreenAnimTick(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    double dt = 16.7;
    std::string js;
    if (argc >= 1 && args[0] != nullptr) {
        size_t l = 0; napi_get_value_string_utf8(env, args[0], nullptr, 0, &l);
        js.resize(l + 1); napi_get_value_string_utf8(env, args[0], &js[0], l + 1, &l); js.resize(l);
        const char* p = js.c_str();
        while (*p && (*p == ' ' || *p == '{' || *p == '"')) p++;
        char* end = nullptr; double v = strtod(p, &end); if (end != p) dt = v;
    }
    char buf[128];
    if (g_appTouchTree == 0) {
        snprintf(buf, sizeof(buf), "{\"ok\":false,\"active\":-1,\"error\":\"未建树\"}");
    } else {
        char* rt = proteus_layout_anim_tick(g_appTouchTree, (float)dt);
        if (rt) proteus_layout_free_string(rt);
        char* ra = proteus_layout_anim_active(g_appTouchTree);
        int active = -1;
        if (ra) { std::string a(ra); size_t q = a.find("\"active\":"); if (q != std::string::npos) active = atoi(a.c_str() + q + 9); proteus_layout_free_string(ra); }
        snprintf(buf, sizeof(buf), "{\"ok\":true,\"active\":%d}", active);
    }
    napi_value out; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out); return out;
}

static void writeAppScreenComposite() {
    if (g_appTouchFilesDir.empty()) return;
    char sum[440];
    snprintf(sum, sizeof(sum),
             "{\"ok\":%s,\"page\":\"%s\",\"content_nodes\":%d,\"cmds\":%d,\"render_nodes\":%d,"
             "\"hit_points_hit\":%d,\"hit_first_target\":%d,"
             "\"real_touch\":true,\"touch_count\":%d,\"real_touch_hits\":%d,\"real_touch_first_target\":%d,"
             "\"transformed_nodes\":%d,\"transform_origin_nodes\":%d,\"css_anim_nodes\":%d}",
             g_appTouchCmdCount > 0 ? "true" : "false", g_appTouchPage.c_str(), g_appTouchContentNodes,
             g_appTouchCmdCount, g_appTouchCmdCount, g_appTouchHitCount, g_appTouchHitFirst,
             g_appTouchRealCount, g_appTouchRealHits, g_appTouchRealFirst, g_appTouchTransformCount, g_appTouchOriginCount, g_appTouchCssAnimNodes);
    std::string path = g_appTouchFilesDir + "/app-screen-composite.json";
    FILE* f = fopen(path.c_str(), "w"); if (f) { fwrite(sum, 1, strlen(sum), f); fclose(f); }
}

static napi_value AppScreenHitAt(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    double x = 0, y = 0;
    if (argc >= 2) { napi_get_value_double(env, args[0], &x); napi_get_value_double(env, args[1], &y); }
    std::string rj = "{\"ok\":false,\"error\":\"未建树（先 AppScreenCommands）\"}";
    if (g_appTouchTree != 0) {
        char* raw = proteus_layout_hit_test(g_appTouchTree, (float)x, (float)y);
        if (raw != nullptr) { rj = raw; proteus_layout_free_string(raw); }
        g_appTouchRealCount++;
        double t = -1;
        if (jnum(rj.c_str(), rj.size(), "target", &t) && t >= 0) {
            g_appTouchRealHits++;
            if (g_appTouchRealFirst < 0) g_appTouchRealFirst = (int)t;
        }
        writeAppScreenComposite();
        OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                     "PROTEUS_APP_TOUCH x=%{public}.2f y=%{public}.2f %{public}s", x, y, rj.c_str());
    }
    napi_value out; napi_create_string_utf8(env, rj.c_str(), rj.size(), &out); return out;
}

/** 把长度串里的 `<n>px` 数值 ×scale（CSS 逻辑 px → 物理 px；%、auto、关键字不动） */
static std::string scalePxInCssLengths(const std::string& s, double scale) {
    if (scale == 1.0 || s.empty()) return s;
    std::string out; out.reserve(s.size() + 8);
    for (size_t i = 0; i < s.size();) {
        char c = s[i];
        if ((c >= '0' && c <= '9') || c == '.' || (c == '-' && i + 1 < s.size() && (s[i+1] >= '0' && s[i+1] <= '9'))) {
            size_t j = i;
            while (j < s.size() && ((s[j] >= '0' && s[j] <= '9') || s[j] == '.' || s[j] == '-')) j++;
            if (j + 1 < s.size() && s[j] == 'p' && s[j+1] == 'x') {
                double v = atof(s.substr(i, j - i).c_str()) * scale;
                char buf[32]; snprintf(buf, sizeof(buf), "%.4gpx", v);
                out += buf; i = j + 2;
                continue;
            }
            out += s.substr(i, j - i); i = j; continue;
        }
        out += c; i++;
    }
    return out;
}

static napi_value AppScreenCommands(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1); napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len); argsJson.resize(len);
    }
    std::string nodes, page, filesDir; double density = 1.0, vpW = 390, vpH = 844;
    jstr(argsJson.c_str(), argsJson.size(), "nodes", &nodes);
    jstr(argsJson.c_str(), argsJson.size(), "page", &page);
    jstr(argsJson.c_str(), argsJson.size(), "filesDir", &filesDir);
    jnum(argsJson.c_str(), argsJson.size(), "density", &density);
    jnum(argsJson.c_str(), argsJson.size(), "vpW", &vpW);
    jnum(argsJson.c_str(), argsJson.size(), "vpH", &vpH);
    if (density <= 0) density = 1.0;
    // ★★★内置环境变量（2026-10-08 · 决策 #593）：解析宿主采集的 env 表（vp），并把 nodes 里的
    //   `"env:<name>[+N|-N][~F]"` token 就地替换为 **vp 数值**（Stage 1：宿主侧解析）。
    std::map<std::string, double> envTable;
    parseEnvObject(argsJson, envTable);
    substituteEnvTokens(nodes, envTable);
    // ★★第五轮修复（2026-10-05 · 右缘 1px 缝的**唯一收敛修法**）：**视口向上取整到整物理像素**——
    //   ArkTS 侧 vp↔px 往返会丢小数（实测页根 cmd 宽 1319.5px vs 屏 1320px ⇒ 最右 1px 列
    //   露宿主深色底，第四轮复评实测 x=1319 全高 #0f1018）。
    //   在**此处**（所有 cmd 几何的唯一出口）把 vpW 上调到 ceil(vpW×density)/density：
    //   无论上游给 377 还是 377.14vp，页根宽都恰为 1320px（超出部分被窗口裁掉，不足才会露底）。
    vpW = std::ceil(vpW * density) / density;
    if (nodes.empty()) { napi_value o; napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &o); return o; }
    // 建树（内容节点扁平键与内核 create 契约同源——直接透传）。★必须注入 textMeasures
    //   （与 Android/iOS 同）：否则文本节点 0 高 ⇒ 布局塌缩 ⇒ 命中落空（本仓实测：无测量 hit 全 miss）。
    std::vector<std::string> nItems = splitJsonObjects(nodes);
    std::string measures = "{"; int mc = 0;
    // ★★第三轮（2026-10-05）：首遍（单行）高度记账——二遍（折行）比较用
    std::unordered_map<int, double> firstHpx;
    for (const auto& it : nItems) {
        std::string tx; if (!jstr(it.c_str(), it.size(), "text", &tx) || tx.empty()) continue;
        double id = -1, fs = 14;
        jnum(it.c_str(), it.size(), "id", &id);
        jnum(it.c_str(), it.size(), "fontSize", &fs);
        double wpx = 0, hpx = 0;
        double lsDesign = 0; jnum(it.c_str(), it.size(), "letterSpacing", &lsDesign);   // ★批次 20：字距（设计 px）
        measureTextTypoPx(tx, fs * density, &wpx, &hpx, lsDesign * density);
        // ★批次 13：line-height ⇒ 行盒高覆盖字形高
        std::string lhTok; jstr(it.c_str(), it.size(), "lineHeight", &lhTok);
        double lhDesign = lineHeightDesignPx(lhTok, fs);
        if (lhDesign > 0) hpx = lhDesign * density;
        firstHpx[(int)id] = hpx;
        char mb[160]; snprintf(mb, sizeof(mb), "%s\"%d\":{\"width\":%.2f,\"height\":%.2f}", mc > 0 ? "," : "", (int)id, wpx / density, hpx / density);
        measures += mb; mc++;
    }
    measures += "}";
    char vpb[96]; snprintf(vpb, sizeof(vpb), "{\"width\":%.2f,\"height\":%.2f}", vpW, vpH);
    std::string req = "{\"viewport\":" + std::string(vpb) + ",\"nodes\":" + nodes + ",\"textMeasures\":" + measures + "}";
    uint64_t handle = proteus_layout_create(req.c_str());
    if (handle == 0) { napi_value o; napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &o); return o; }
    // ★★第三轮复评修复（2026-10-05）：**wrap 文本二遍测量**——首遍只有单行度量 ⇒ 折行文本
    //   盒高偏小（副标题尾部丢失/与 Web 不等高）。流程：读首遍盒宽 → 按盒宽折行重测 →
    //   有变化则重建（与 Android/iOS 宿主同源）。
    {
        char* rp0 = proteus_layout_rects(handle);
        std::unordered_map<int, Rect> rect0; parseRects(rp0 ? rp0 : "{}", rect0);
        if (rp0) proteus_layout_free_string(rp0);
        std::string measures2 = "{"; int mc2 = 0; bool changed = false;
        for (const auto& it : nItems) {
            std::string tx; if (!jstr(it.c_str(), it.size(), "text", &tx) || tx.empty()) continue;
            double id = -1, fs = 14;
            jnum(it.c_str(), it.size(), "id", &id);
            jnum(it.c_str(), it.size(), "fontSize", &fs);
            double lsDesign = 0; jnum(it.c_str(), it.size(), "letterSpacing", &lsDesign);
            std::string ws; jstr(it.c_str(), it.size(), "whiteSpace", &ws);
            const bool single = (ws == "nowrap" || ws == "pre");
            int clampLines = 0;   // ★★★line-clamp 项（2026-10-08）：多行截断行数
            std::string wbM; jstr(it.c_str(), it.size(), "wordBreak", &wbM);
            std::string lhTok; jstr(it.c_str(), it.size(), "lineHeight", &lhTok);
            double lhDesign = lineHeightDesignPx(lhTok, fs);
            double wpx = 0, hpx = 0;
            auto rit = rect0.find((int)id);
            const double boxWpx = rit != rect0.end() ? rit->second.w * density : 0.0;
            // ★★★line-clamp 项（2026-10-08）：多行截断行数（测量封顶用）
            { double lcD = 0; jnum(it.c_str(), it.size(), "lineClamp", &lcD); clampLines = (int)(lcD + 0.5); }
            if (!single && boxWpx > 1.0) {
                measureTextWrappedTypoPx(tx, fs * density, boxWpx, &wpx, &hpx, lsDesign * density, wbM);
                if (lhDesign > 0 || clampLines > 0) {
                    double nW = 0, nH = 0;
                    measureTextTypoPx(tx, fs * density, &nW, &nH, lsDesign * density);
                    if (nH > 0.5) {
                        int lines = (int)((hpx / nH) + 0.5);
                        if (lines < 1) lines = 1;
                        // ★★★line-clamp 项（2026-10-08）：测量封顶——行数 = min(自然行数, clamp)。
                        //   与绘制同源（渲染侧 maxLines + 尾部省略号），否则盒高与墨迹打架。
                        if (clampLines > 0 && lines > clampLines) lines = clampLines;
                        hpx = (lhDesign > 0) ? (lines * lhDesign * density) : (lines * nH);
                    }
                }
            } else {
                measureTextTypoPx(tx, fs * density, &wpx, &hpx, lsDesign * density);
                if (lhDesign > 0) hpx = lhDesign * density;
            }
            double fH = 0;
            { auto fit = firstHpx.find((int)id); if (fit != firstHpx.end()) fH = fit->second; }
            if (hpx > fH + 0.5) changed = true;
            char mb[160]; snprintf(mb, sizeof(mb), "%s\"%d\":{\"width\":%.2f,\"height\":%.2f}", mc2 > 0 ? "," : "", (int)id, wpx / density, hpx / density);
            measures2 += mb; mc2++;
        }
        measures2 += "}";
        if (changed) {
            std::string req2 = "{\"viewport\":" + std::string(vpb) + ",\"nodes\":" + nodes + ",\"textMeasures\":" + measures2 + "}";
            proteus_layout_destroy(handle);
            handle = proteus_layout_create(req2.c_str());
            if (handle == 0) { napi_value o; napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &o); return o; }
        }
    }
    // ★★真实触摸（2026-10-04）：**保留句柄**供真实触摸（`.onTouch` → `appScreenHitAt`）复用
    //   （旧版此处 `proteus_layout_destroy` ⇒ 句柄释放后无法由真触摸驱动命中）。
    if (g_appTouchTree != 0) proteus_layout_destroy(g_appTouchTree);
    g_appTouchTree = handle;
    g_appTouchPage = page;
    g_appTouchFilesDir = filesDir;
    g_appTouchContentNodes = (int)nItems.size();
    g_appTouchRealCount = 0; g_appTouchRealHits = 0; g_appTouchRealFirst = -1;
    // ★批次 42（动效）：启动编译期折叠的 CSS animation（启动读数入 composite）
    g_appTouchCssAnimNodes = launchAppScreenAnimations(handle, nItems);
    char* rp = proteus_layout_rects(handle);
    std::string rects = rp ? rp : "{}";
    if (rp) proteus_layout_free_string(rp);
    std::unordered_map<int, Rect> rectMap; parseRects(rects, rectMap);
    // ★★★鸿蒙滚动对齐：内容高 = 内核 rects 的 maxBottom（设计单位；与 Android applyContentScrollRange 同口径）
    {
        double maxBottom = 0;
        for (const auto& kv : rectMap) {
            const double b = kv.second.y + kv.second.h;
            if (b > maxBottom) maxBottom = b;
        }
        g_appContentHeightVp = maxBottom;
    }
    // ★装置内命中（20 点，用真实 rects 中心）——保留为**旧读数**（向后兼容）；真实触摸读数另计。
    //   ★命中点用**真实 rects 的中心**（几何真源——不猜坐标空间；本仓"命中必须与核心同源"纪律）。
    g_appTouchHitCount = 0; g_appTouchHitFirst = -1;
    {
        int n = 0;
        for (const auto& kv : rectMap) {
            if (n >= 20) break;
            float cx = kv.second.x + kv.second.w * 0.5f;
            float cy = kv.second.y + kv.second.h * 0.5f;
            char* hRaw = proteus_layout_hit_test(handle, cx, cy);
            if (hRaw) {
                std::string hs = hRaw; proteus_layout_free_string(hRaw);
                double t = -1; if (jnum(hs.c_str(), hs.size(), "target", &t) && t >= 0) { g_appTouchHitCount++; if (g_appTouchHitFirst < 0) g_appTouchHitFirst = (int)t; }
            }
            n++;
        }
    }
    std::vector<std::string> items = splitJsonObjects(nodes);
    std::string arr = "["; int emitted = 0; int tfCount = 0; int toCount = 0;
    for (const auto& it : items) {
        double id = -1; jnum(it.c_str(), it.size(), "id", &id);
        auto ri = rectMap.find((int)id); if (ri == rectMap.end()) continue;
        // ★★第五轮修复（2026-10-05 · 右缘 0.5px 缝的**根因修法**）：内核 rects 按整数 dp 吸附
        //   （377.14dp → 377dp ⇒ ×3.5 = 1319.5px vs 屏 1320px，右缘 0.5px 露宿主底）。
        //   铺满视口的节点 = **页面画布**：其几何按定义就是视口 ⇒ 钳到视口精确值
        //   （其余节点**分毫不动**——布局语义零变化，只修画布铺满）。
        Rect rClamped = ri->second;
        if (rClamped.x <= 0.5 && rClamped.y <= 0.5 && rClamped.w >= vpW - 2.0 && rClamped.h >= vpH - 2.0) {
            if (rClamped.w < vpW) rClamped.w = vpW;
            if (rClamped.h < vpH) rClamped.h = vpH;
        }
        const Rect& r = rClamped;
        // ★批次 25（CSS 兼容对齐 · 以 Web 为基准）：visibility:hidden ⇒ 仍占位、不绘制
        std::string visv; jstr(it.c_str(), it.size(), "visibility", &visv);
        const bool isHidden = (visv == "hidden");
        uint32_t bg = 0; std::string bgCss; if (jstr(it.c_str(), it.size(), "backgroundColor", &bgCss)) bg = hexToArgb(bgCss);
        double radius = 0; jnum(it.c_str(), it.size(), "borderRadius", &radius);
        { double rp = 0; jnum(it.c_str(), it.size(), "borderRadiusPct", &rp); if (rp > 0) radius = rp * (r.w < r.h ? r.w : r.h); } // ★批次 18
        // ★批次 34：逐角圆角掩码（borderRadiusCorners → bit0=TL/1=TR/2=BR/3=BL；0/15 ⇒ 不发射）
        int rcMask = 0;
        {
            std::string rcSub = extractValueAfterKey(it, "borderRadiusCorners", '{', '}');
            if (!rcSub.empty()) {
                if (rcSub.find("\"topLeft\":true") != std::string::npos) rcMask |= 1;
                if (rcSub.find("\"topRight\":true") != std::string::npos) rcMask |= 2;
                if (rcSub.find("\"bottomRight\":true") != std::string::npos) rcMask |= 4;
                if (rcSub.find("\"bottomLeft\":true") != std::string::npos) rcMask |= 8;
            }
        }
        std::string text; jstr(it.c_str(), it.size(), "text", &text);
        double fs = 24; jnum(it.c_str(), it.size(), "fontSize", &fs);
        double fw = 400; jnum(it.c_str(), it.size(), "fontWeight", &fw);   // ★批次 3：字重
        std::string ta; jstr(it.c_str(), it.size(), "textAlign", &ta);      // ★批次 4：对齐
        uint32_t tc = 0xFFFFFFFFu; std::string tcCss; if (jstr(it.c_str(), it.size(), "color", &tcCss)) tc = hexToArgb(tcCss);
        // ★批次 5：uniform 边框（宽度 + 颜色）
        double bw = 0; jnum(it.c_str(), it.size(), "borderWidth", &bw);
        if (isHidden) { bg = 0; radius = 0; text.clear(); bw = 0; }   // ★批次 25：hidden ⇒ 不绘制
        uint32_t bc = 0; std::string bcCss; if (jstr(it.c_str(), it.size(), "borderColor", &bcCss)) bc = hexToArgb(bcCss);
        char head[320];
        snprintf(head, sizeof(head), "%s{\"kind\":\"background\",\"x\":%.2f,\"y\":%.2f,\"w\":%.2f,\"h\":%.2f,\"color\":%u,\"radius\":%.2f",
                 emitted > 0 ? "," : "", r.x * density, r.y * density, r.w * density, r.h * density, bg, radius * density);
        arr += head;
        // ★★★overflow-x 项（2026-10-06）：有效裁剪矩形（物理 px——与几何同乘 density；render 侧 SetClip）
        if (ri->second.hasClip) {
            char cb[128];
            snprintf(cb, sizeof(cb), ",\"clipX\":%.2f,\"clipY\":%.2f,\"clipW\":%.2f,\"clipH\":%.2f",
                     ri->second.cx * density, ri->second.cy * density, ri->second.cw * density, ri->second.ch * density);
            arr += cb;
        }
        // ★批次 10：盒阴影（扁平数值键）
        {
            std::string shSub = extractValueAfterKey(it, "boxShadow", '{', '}');
            if (!shSub.empty()) {
                double sdx = 0, sdy = 0, sblur = 0, scolor = 0; std::string scc;
                jnum(shSub.c_str(), shSub.size(), "dx", &sdx);
                jnum(shSub.c_str(), shSub.size(), "dy", &sdy);
                jnum(shSub.c_str(), shSub.size(), "blur", &sblur);
                if (jstr(shSub.c_str(), shSub.size(), "color", &scc)) scolor = hexToArgb(scc);
                if (sblur > 0 && scolor > 0) {
                    char sb[128]; snprintf(sb, sizeof(sb), ",\"shadowDx\":%.2f,\"shadowDy\":%.2f,\"shadowBlur\":%.2f,\"shadowColor\":%u",
                             sdx * density, sdy * density, sblur * density, (uint32_t)scolor);
                    arr += sb;
                }
            }
        }
        // ★★★背景定位家族（2026-10-07）：**渐变 + 图像盒几何**进 cmd——渲染层 `proteus_render.cpp`
        //   的 `grad` 解析器据此真画（此前 app-content 路径**不产 grad 键** ⇒ 鸿蒙应用内容不渲染渐变）。
        //   形态与 dev 基准同源：`grad:{kind,angle,stops:[{offset,color(ARGB)}]}` + size/position/repeat 串。
        {
            std::string fgSub = extractValueAfterKey(it, "fillGradient", '{', '}');
            if (!fgSub.empty()) {
                std::string gk; jstr(fgSub.c_str(), fgSub.size(), "kind", &gk); if (gk.empty()) gk = "linear";
                double gang = 90; jnum(fgSub.c_str(), fgSub.size(), "angle", &gang);
                std::string stopsArr = extractValueAfterKey(fgSub, "stops", '[', ']');
                std::vector<std::string> stops = splitJsonObjects(stopsArr);
                if (stops.size() >= 2) {
                    std::string g = ",\"grad\":{\"kind\":\"" + jsonEscape(gk) + "\",\"angle\":" + std::to_string((int)gang) + ",\"stops\":[";
                    for (size_t si = 0; si < stops.size(); si++) {
                        double goff = 0; jnum(stops[si].c_str(), stops[si].size(), "offset", &goff);
                        std::string gcol; jstr(stops[si].c_str(), stops[si].size(), "color", &gcol);
                        uint32_t gargb = gcol.empty() ? 0u : hexToArgb(gcol);
                        g += (si ? "," : "");
                        g += "{\"offset\":" + std::to_string(goff) + ",\"color\":" + std::to_string((unsigned long)gargb) + "}";
                    }
                    g += "]}";
                    arr += g;
                }
            }
            // 图像盒几何（字符串原样；渲染层 `bgImageBox` 解析）
            const char* bgKeys[3] = {"backgroundSize", "backgroundPosition", "backgroundRepeat"};
            for (int bi = 0; bi < 3; bi++) {
                std::string bv; jstr(it.c_str(), it.size(), bgKeys[bi], &bv);
                // ★size/position 的 **px 值**是 CSS 逻辑 px ⇒ ×density 转物理 px（与节点 w/h 同口径）；
                //   % / auto / 关键字不含 px ⇒ 不动。repeat 是枚举 ⇒ 不动。
                if (bi < 2 && !bv.empty()) bv = scalePxInCssLengths(bv, density);
                if (!bv.empty()) arr += std::string(",\"") + bgKeys[bi] + "\":\"" + jsonEscape(bv) + "\"";
            }
        }
        if (bw > 0 && bc > 0) {
            char bb[96]; snprintf(bb, sizeof(bb), ",\"borderWidth\":%.2f,\"borderColor\":%u", bw * density, bc);
            arr += bb;
        }
        // ★★★text-shadow 项（2026-10-08）：文本阴影扁平键（dx/dy/blur ×density 物理 px；color ARGB）
        {
            std::string tsSub = extractValueAfterKey(it, "textShadow", '{', '}');
            if (!tsSub.empty()) {
                double tsdx = 0, tsdy = 0, tsblur = 0, tscolor = 0; std::string tscc;
                jnum(tsSub.c_str(), tsSub.size(), "dx", &tsdx);
                jnum(tsSub.c_str(), tsSub.size(), "dy", &tsdy);
                jnum(tsSub.c_str(), tsSub.size(), "blur", &tsblur);
                if (jstr(tsSub.c_str(), tsSub.size(), "color", &tscc)) tscolor = hexToArgb(tscc);
                if (tscolor > 0) {
                    char tb[160]; snprintf(tb, sizeof(tb), ",\"textShadowDx\":%.2f,\"textShadowDy\":%.2f,\"textShadowBlur\":%.2f,\"textShadowColor\":%u",
                             tsdx * density, tsdy * density, tsblur * density, (uint32_t)tscolor);
                    arr += tb;
                }
            }
        }
        // ★★★outline 族项（2026-10-08）：轮廓宽/色/线型/偏移（px ×density；offset 可负）
        {
            double ow = 0, ooff = 0; jnum(it.c_str(), it.size(), "outlineWidth", &ow); jnum(it.c_str(), it.size(), "outlineOffset", &ooff);
            std::string ocCss, osV; jstr(it.c_str(), it.size(), "outlineColor", &ocCss); jstr(it.c_str(), it.size(), "outlineStyle", &osV);
            if (ow > 0 && !ocCss.empty() && osV != "none") {
                uint32_t oc = hexToArgb(ocCss);
                char ob[160]; snprintf(ob, sizeof(ob), ",\"outlineWidth\":%.2f,\"outlineOffset\":%.2f,\"outlineColor\":%u,\"outlineStyle\":\"%s\"", ow * density, ooff * density, oc, osV.c_str());
                arr += ob;
            }
        }
        // ★★★逐边 border 批（2026-10-05）：逐边宽度/颜色透传（扁平键 `bwTop`/`bcTop`…；-1 = 未声明 ⇒ 回落 uniform）。
        //   宿主用 ArkUI 原生 `ARKUI_EDGE_DIRECTION_{TOP,RIGHT,BOTTOM,LEFT}` 逐边绘制。
        {
            const char* sn[4] = {"Top", "Right", "Bottom", "Left"};
            const char* wk[4] = {"borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"};
            const char* ck[4] = {"borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"};
            const char* stk[4] = {"borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"};
            bool anySide = false;
            for (int si = 0; si < 4; si++) { if (it.find(std::string("\"") + wk[si] + "\"") != std::string::npos || it.find(std::string("\"") + ck[si] + "\"") != std::string::npos || it.find(std::string("\"") + stk[si] + "\"") != std::string::npos) { anySide = true; break; } }
            if (anySide) {
                for (int si = 0; si < 4; si++) {
                    double sw = -1; jnum(it.c_str(), it.size(), wk[si], &sw);
                    uint32_t sc = 0; std::string scCss; if (jstr(it.c_str(), it.size(), ck[si], &scCss)) sc = hexToArgb(scCss);
                    std::string stv; jstr(it.c_str(), it.size(), stk[si], &stv);
                    if (sw < 0 && sc == 0 && stv.empty()) continue;
                    char sb2[160];
                    snprintf(sb2, sizeof(sb2), ",\"bw%s\":%.2f,\"bc%s\":%u", sn[si], sw < 0 ? -1.0 : sw * density, sn[si], sc);
                    arr += sb2;
                    // ★★★边框族收口批（2026-10-05）：线型（solid/dashed/dotted 原样字符串）
                    if (!stv.empty()) arr += std::string(",\"bws") + sn[si] + "\":\"" + jsonEscape(stv) + "\"";
                }
            }
        }
        if (rcMask > 0 && rcMask != 15) { char rcb[48]; snprintf(rcb, sizeof(rcb), ",\"radiusCorners\":%d", rcMask); arr += rcb; }
        // ★批次 39：静态变换（编译期 CSS transform）——位移分 px 与盒比例（% 按盒尺寸换算），等比缩放 + 旋转。
        {
            std::string tSub = extractValueAfterKey(it, "transform", '{', '}');
            if (!tSub.empty()) {
                double txPx = 0, tyPx = 0, txPct = 0, tyPct = 0, sx = 1, rot = 0;
                jnum(tSub.c_str(), tSub.size(), "txPx", &txPx);
                jnum(tSub.c_str(), tSub.size(), "tyPx", &tyPx);
                jnum(tSub.c_str(), tSub.size(), "txPct", &txPct);
                jnum(tSub.c_str(), tSub.size(), "tyPct", &tyPct);
                jnum(tSub.c_str(), tSub.size(), "sx", &sx);
                jnum(tSub.c_str(), tSub.size(), "rotate", &rot);
                double txD = (txPx + txPct * r.w) * density;
                double tyD = (tyPx + tyPct * r.h) * density;
                if (txD != 0 || tyD != 0 || sx != 1 || rot != 0) {
                    char tb[160];
                    snprintf(tb, sizeof(tb), ",\"tx\":%.2f,\"ty\":%.2f,\"scale\":%.4f,\"rotate\":%.3f", txD, tyD, sx, rot);
                    arr += tb;
                    tfCount++;
                }
            }
        }
        // ★批次 40：transform-origin（盒分数 toX/toY）——宿主 SetPivot 用（旋转/缩放锚点）
        {
            std::string oSub = extractValueAfterKey(it, "transformOrigin", '{', '}');
            if (!oSub.empty()) {
                double ox = 0.5, oy = 0.5;
                jnum(oSub.c_str(), oSub.size(), "x", &ox);
                jnum(oSub.c_str(), oSub.size(), "y", &oy);
                if (ox != 0.5 || oy != 0.5) {
                    char ob[64]; snprintf(ob, sizeof(ob), ",\"toX\":%.4f,\"toY\":%.4f", ox, oy);
                    arr += ob;
                    toCount++;
                }
            }
        }
        if (!text.empty()) {
            char tail[128]; snprintf(tail, sizeof(tail), ",\"fontSize\":%.2f,\"fontWeight\":%d,\"textColor\":%u", fs * density, (int)fw, tc);
            arr += tail;
            if (!ta.empty()) arr += ",\"textAlign\":\"" + jsonEscape(ta) + "\"";
            // ★批次 16：text-overflow:ellipsis ⇒ 扁平键（渲染侧据此设 maxLines=1 + 尾部省略号）
            { std::string to; if (jstr(it.c_str(), it.size(), "textOverflow", &to) && to == "ellipsis") arr += ",\"textOverflowEllipsis\":1"; }
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：换行模式 + overflow 透传渲染侧——
            //   wrap（normal/pre-wrap/pre-line）⇒ 盒宽折行；nowrap ⇒ 单行（省略号/裁切/溢出）。
            { std::string ws; if (jstr(it.c_str(), it.size(), "whiteSpace", &ws) && !ws.empty()) arr += ",\"whiteSpace\":\"" + jsonEscape(ws) + "\""; }
            // ★★★word-break 项（2026-10-06）：断词策略（渲染侧据此设 TypographyTextWordBreakType）
            { std::string wb; if (jstr(it.c_str(), it.size(), "wordBreak", &wb) && !wb.empty()) arr += ",\"wordBreak\":\"" + jsonEscape(wb) + "\""; }
            // ★★★line-clamp 项（2026-10-08）：多行截断行数（渲染侧据此设 maxLines + 尾部省略号）
            { double lc = 0; if (jnum(it.c_str(), it.size(), "lineClamp", &lc) && lc > 0) { char lb2[48]; snprintf(lb2, sizeof(lb2), ",\"lineClamp\":%d", (int)(lc + 0.5)); arr += lb2; } }
            { std::string ov; if (jstr(it.c_str(), it.size(), "overflow", &ov) && ov == "hidden") arr += ",\"clipText\":1"; }
            // ★★★text 内间距批（2026-10-09 · 用户抓出「App 端 text 的 padding-left 被丢弃」）：
            //   文本绘制内缩 = 盒内 padding（物理 px，×density）——渲染侧据此内缩折行宽与绘制原点
            //   （Web 真值：文字自 padding 内缘起排、折行宽 = 盒宽 − padding-left − padding-right）。
            {
                std::string psub = extractValueAfterKey(it, "padding", '{', '}');
                if (!psub.empty()) {
                    double pl = 0, pt = 0, pr = 0, pb = 0;
                    jnum(psub.c_str(), psub.size(), "left", &pl);
                    jnum(psub.c_str(), psub.size(), "top", &pt);
                    jnum(psub.c_str(), psub.size(), "right", &pr);
                    jnum(psub.c_str(), psub.size(), "bottom", &pb);
                    if (pl > 0 || pt > 0 || pr > 0 || pb > 0) {
                        char pb2[128];
                        snprintf(pb2, sizeof(pb2), ",\"padL\":%.2f,\"padT\":%.2f,\"padR\":%.2f,\"padB\":%.2f",
                                 pl * density, pt * density, pr * density, pb * density);
                        arr += pb2;
                    }
                }
            }
            // ★批次 35：文本装饰（underline / line-through）
            { std::string td; if (jstr(it.c_str(), it.size(), "textDecoration", &td) && td != "none") arr += ",\"textDecoration\":\"" + jsonEscape(td) + "\""; }
            // ★批次 36：字体角色（font-family → role；鸿蒙按可用字族映射，缺则回落默认）
            { std::string ff; if (jstr(it.c_str(), it.size(), "fontFamily", &ff) && !ff.empty()) arr += ",\"fontFamily\":\"" + jsonEscape(ff) + "\""; }
            // ★批次 13：行盒高（lineHeight token → 物理 px；倍数×fs 或 px）——半行距居中用
            {
                std::string lhTok; jstr(it.c_str(), it.size(), "lineHeight", &lhTok);
                double lhDesign = lineHeightDesignPx(lhTok, fs);
                if (lhDesign > 0) {
                    char lb[48]; snprintf(lb, sizeof(lb), ",\"lineHeightPx\":%.2f", lhDesign * density);
                    arr += lb;
                }
            // ★批次 20：字距（设计 px ⇒ 物理 px）
            { double lsD = 0; jnum(it.c_str(), it.size(), "letterSpacing", &lsD); if (lsD != 0) { char lsb[48]; snprintf(lsb, sizeof(lsb), ",\"letterSpacing\":%.2f", lsD * density); arr += lsb; } }
            }
            arr += ",\"text\":\"" + jsonEscape(text) + "\"";
        }
        arr += "}"; emitted++;
    }
    arr += "]";
    g_appTouchCmdCount = emitted;
    g_appTouchTransformCount = tfCount;
    g_appTouchOriginCount = toCount;
    char lb[128]; snprintf(lb, sizeof(lb), "PROTEUS_APP_SCREEN_CMDS page=%s nodes=%d", page.c_str(), emitted);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG, "%{public}s", lb);
    writeAppScreenComposite();
    napi_value out; napi_create_string_utf8(env, arr.c_str(), arr.size(), &out); return out;
}

static napi_value AppScreenContentHeight(napi_env env, napi_callback_info info) {
    napi_value out;
    napi_create_double(env, g_appContentHeightVp, &out);
    return out;
}
/* ── NAPI 注册（模块名 `proteus_host`）── */
EXTERN_C_START
static napi_value HostBridgeInit(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"appScreenCommands", nullptr, AppScreenCommands, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"appScreenContentHeight", nullptr, AppScreenContentHeight, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"appScreenHitAt", nullptr, AppScreenHitAt, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"appScreenAnimTick", nullptr, AppScreenAnimTick, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"hostRtShellInstall", nullptr, HostRtShellInstall, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"hostRtShellEvent", nullptr, HostRtShellEvent, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module hostBridgeModule = {
    .nm_version = 1, .nm_flags = 0, .nm_filename = nullptr,
    .nm_register_func = HostBridgeInit, .nm_modname = "proteus_host",
    .nm_priv = nullptr, .reserved = {0},
};
extern "C" __attribute__((constructor)) void RegisterProteusHostBridgeModule(void) {
    napi_module_register(&hostBridgeModule);
}
