// entry/src/main/cpp/proteus_bench.cpp
// ★★★Proteus 鸿蒙宿主 —— **4050 元素应用级基准**（方案 M5，对标 Android/iOS 同口径）
//
// 【口径（逐条照搬 Android `app4050Run`——三端数字可比的前提）】
//   同一份夹具（真 SFC 编译产物 `app-4050-tree.json`：2050 view + 2000 text = 4050 元素 + 1 根）；
//   起点 = 触发时刻；终点 = **主线程侧渲染指令全部编码完毕**（Android 用 RenderNode.endRecording
//   作"送达"判定；鸿蒙对应物 = RenderNode 树构建完成）。
//   分段：建树+排版（Rust 核）→ 几何提取 + 直绘树构建。
//
// 【诚实边界（写进报告）】
//   ① 本宿主无 JS 引擎参与基准链路 ⇒ 编译+模板实例化在构建期完成（与 Android 宿主同）；
//   ② 鸿蒙的"录制"语义与 Android DisplayList 不同（RenderNode 是渲染节点树）——分段不逐段可比，
//      **总耗时 / 对原生比值** 才是三端口径对齐的指标；
//   ③ 文本绘制未实现（本里程碑只有 background 直绘）⇒ 直绘树只建"带背景色"的节点
//      （2050 view 格）；文本节点参与**排版**但不参与直绘——如实标注，不假装画了文字。
//
// 【Rust 核】链接 `libproteus_layout_core.a`（aarch64-unknown-linux-ohos 交叉编译；
//   与 Android/iOS 同一份 Rust 源码——"排版核心写一遍"的再次兑现）。
#include <string>
#include <vector>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cstdlib>
#include <chrono>
#include <unordered_map>
#include <hilog/log.h>

#include <napi/native_api.h>
#include <arkui/native_interface.h>
#include <arkui/native_type.h>
#include <arkui/native_node.h>
#include <arkui/native_render.h>
#include <arkui/native_node_napi.h>

#define PROTEUS_BENCH_DOMAIN 0x0003
#define PROTEUS_BENCH_TAG "ProteusBench"

// ── Rust 核 C ABI（与 iOS `@_silgen_name` / Android JNI 同一组函数）──
extern "C" {
uint64_t proteus_layout_create(const char* request_json);
char* proteus_layout_rects(uint64_t handle);
char* proteus_layout_hit_test(uint64_t handle, float x, float y);
char* proteus_layout_version(void);
void proteus_layout_free_string(char* ptr);
bool proteus_layout_destroy(uint64_t handle);
}

using Clock = std::chrono::steady_clock;
static double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

/** 提取 JSON 数字字段（原型级解析——结构与夹具固定） */
static bool jnum(const char* s, size_t segLen, const char* key, double* out) {
    std::string seg(s, segLen);
    std::string needle = std::string("\"") + key + "\":";
    size_t p = seg.find(needle);
    if (p == std::string::npos) return false;
    p += needle.size();
    const char* base = seg.c_str() + p;
    char* end = nullptr;
    *out = strtod(base, &end);
    return end != base;
}

/** 几何记录 */
struct Rect { float x, y, w, h; };

/**
 * 单遍解析 rects JSON → map<id, Rect>
 *   ★为什么必须单遍（首版隐患）：对每个节点在整串里 `find` 是 O(n²)——
 *     4051 节点 × ~600KB ≈ 2.4GB 扫描，会把"几何提取"段推高到秒级、污染计时。
 *   结构固定：{"rects":{"<id>":{"x":..,"y":..,"width":..,"height":..},...}}
 */
static void parseRects(const std::string& s, std::unordered_map<int, Rect>& out) {
    size_t p = 0;
    while (true) {
        size_t q = s.find("\":{", p);
        if (q == std::string::npos) break;
        size_t e = q, b = e;
        while (b > 0 && isdigit((unsigned char)s[b - 1])) b--;
        if (b == e) { p = q + 1; continue; }
        int id = atoi(s.substr(b, e - b).c_str());
        size_t segEnd = s.find('}', q);
        if (segEnd == std::string::npos) break;
        double x = 0, y = 0, w = 0, h = 0;
        jnum(s.c_str() + q, segEnd - q, "x", &x);
        jnum(s.c_str() + q, segEnd - q, "y", &y);
        jnum(s.c_str() + q, segEnd - q, "width", &w);
        jnum(s.c_str() + q, segEnd - q, "height", &h);
        out[id] = Rect{(float)x, (float)y, (float)w, (float)h};
        p = segEnd + 1;
    }
}

/**
 * bench4050(fixtureJson, viewportW, viewportH, depthLimit): string(JSON)
 *   depthLimit: 直绘树构建的节点上限（0 = 全量）
 */
static napi_value Bench4050(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 3) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"参数不足\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t len = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
    std::string fixture(len + 1, '\0');
    napi_get_value_string_utf8(env, args[0], &fixture[0], len + 1, &len);
    fixture.resize(len);
    double W = 1080, H = 2400, depthLimit = 0;
    napi_get_value_double(env, args[1], &W);
    napi_get_value_double(env, args[2], &H);
    if (argc >= 4) napi_get_value_double(env, args[3], &depthLimit);

    size_t nodesKey = fixture.find("\"nodes\":[");
    if (nodesKey == std::string::npos) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"夹具无 nodes 数组\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t arrStart = nodesKey + strlen("\"nodes\":");
    size_t arrEnd = fixture.rfind(']');
    if (arrEnd <= arrStart) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"夹具 nodes 数组不完整\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    std::string nodes = fixture.substr(arrStart, arrEnd - arrStart + 1);

    int nodeCount = 0;
    std::vector<int> bgIds;
    {
        size_t p = 0;
        while ((p = nodes.find("\"id\":", p)) != std::string::npos) {
            double id = 0;
            if (jnum(nodes.c_str() + p, 24, "id", &id)) {
                nodeCount++;
                size_t next = nodes.find("\"id\":", p + 5);
                size_t segEnd = next == std::string::npos ? nodes.size() : next;
                std::string seg = nodes.substr(p, segEnd - p);
                if (seg.find("\"backgroundColor\"") != std::string::npos) bgIds.push_back((int)id);
            }
            p += 5;
        }
    }

    // ── ① 建树 + 排版（Rust 核；与 Android/iOS 同一份源码）──
    std::string req = "{\"viewport\":{\"width\":" + std::to_string((int)W) +
                      ",\"height\":" + std::to_string((int)H) +
                      "},\"nodes\":" + nodes + ",\"textMeasures\":{}}";
    auto t0 = Clock::now();
    uint64_t handle = proteus_layout_create(req.c_str());
    double layoutMs = msSince(t0);
    if (handle == 0) {
        OH_LOG_Print(LOG_APP, LOG_ERROR, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                     "PROTEUS_BENCH_ERROR proteus_layout_create 失败（nodes=%{public}d）", nodeCount);
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"proteus_layout_create 失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }

    // ── ② 几何提取（单遍）+ 直绘树构建 ──
    auto t1 = Clock::now();
    char* rectsRaw = proteus_layout_rects(handle);
    std::string rects = rectsRaw ? rectsRaw : "{}";
    if (rectsRaw) proteus_layout_free_string(rectsRaw);
    std::unordered_map<int, Rect> rectMap;
    rectMap.reserve(nodeCount * 2);
    parseRects(rects, rectMap);

    ArkUI_NativeNodeAPI_1* api = nullptr;
    OH_ArkUI_GetModuleInterface(ARKUI_NATIVE_NODE, ArkUI_NativeNodeAPI_1, api);
    int built = 0, processed = 0;
    for (int id : bgIds) {
        if (depthLimit > 0 && processed >= (int)depthLimit) break;
        processed++;
        auto it = rectMap.find(id);
        if (it == rectMap.end()) continue;
        ArkUI_RenderNodeHandle node = OH_ArkUI_RenderNodeUtils_CreateNode();
        if (node == nullptr) continue;
        OH_ArkUI_RenderNodeUtils_SetSize(node, (int32_t)it->second.w, (int32_t)it->second.h);
        OH_ArkUI_RenderNodeUtils_SetPosition(node, (int32_t)it->second.x, (int32_t)it->second.y);
        OH_ArkUI_RenderNodeUtils_SetBackgroundColor(node, 0xFF285AC8u);
        built++;
        OH_ArkUI_RenderNodeUtils_DisposeNode(node);
    }
    double emitMs = msSince(t1);

    double scopeMs = msSince(t0);
    char* verRaw = proteus_layout_version();
    std::string ver = verRaw ? verRaw : "unknown";
    if (verRaw) proteus_layout_free_string(verRaw);
    proteus_layout_destroy(handle);

    char buf[768];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"engine\":\"%s\",\"node_count\":%d,\"rect_count\":%d,\"bg_node_count\":%d,"
             "\"built_render_nodes\":%d,\"scope_ms\":%.2f,\"layout_ms\":%.2f,\"emit_ms\":%.2f,"
             "\"note\":\"鸿蒙腿：Rust 核（aarch64-unknown-linux-ohos）+ RenderNode 直绘树构建；"
             "文本绘制未实现（只建带背景色节点）\"}",
             ver.c_str(), nodeCount, (int)rectMap.size(), (int)bgIds.size(), built,
             scopeMs, layoutMs, emitMs);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_BENCH_DONE nodes=%{public}d rects=%{public}d built=%{public}d scope=%.2fms layout=%.2fms",
                 nodeCount, (int)rectMap.size(), built, scopeMs, layoutMs);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * hitProbe(): string(JSON) —— ★命中测试探针（与 Android `hitTestRun` / iOS `runHitProbes`
 *   **同一份场景与探针点**；三端共享核心的直接证据，要求**逐位相同**）。
 *
 * 场景（与两端完全一致）：
 *   root 300×300
 *     ├── 2 顶栏 300×60（在流）
 *     ├── 3 卡片 300×180（在流）
 *     │     ├── 4 absolute 240×140 @(30,20)
 *     │     └── 5 absolute 140×100 @(60,50)
 *     └── 6 底栏 300×60
 * 期望（纯几何，本文件独立声明）：
 *   (150,30)→2 · (150,90)→4 · (100,110)→5 · (150,140)→5 · (150,290)→6 · (400,400)→-1
 */
static napi_value HitProbe(napi_env env, napi_callback_info info) {
    const char* scene =
        "{\"viewport\":{\"width\":300,\"height\":300},\"nodes\":["
        "{\"id\":1,\"parentId\":null,\"width\":300.0,\"height\":300.0,\"flexDirection\":\"column\"},"
        "{\"id\":2,\"parentId\":1,\"width\":300.0,\"height\":60.0},"
        "{\"id\":3,\"parentId\":1,\"width\":300.0,\"height\":180.0},"
        "{\"id\":4,\"parentId\":3,\"position\":\"absolute\",\"top\":20.0,\"left\":30.0,\"width\":240.0,\"height\":140.0},"
        "{\"id\":5,\"parentId\":3,\"position\":\"absolute\",\"top\":50.0,\"left\":60.0,\"width\":140.0,\"height\":100.0},"
        "{\"id\":6,\"parentId\":1,\"width\":300.0,\"height\":60.0}"
        "],\"textMeasures\":{}}";
    uint64_t handle = proteus_layout_create(scene);
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    // ★期望值独立声明（不取自任何一端的结果——避免「共同错」被当成一致）
    const float probes[6][2] = {{150, 30}, {150, 90}, {100, 110}, {150, 140}, {150, 290}, {400, 400}};
    const int expect[6] = {2, 4, 5, 5, 6, -1};
    std::string results = "[";
    int mismatch = 0;
    for (int i = 0; i < 6; i++) {
        char* raw = proteus_layout_hit_test(handle, probes[i][0], probes[i][1]);
        std::string rj = raw ? raw : "{}";
        if (raw) proteus_layout_free_string(raw);
        // ★字段名以 Rust 侧返回为准（`{"ok":true,"target":<id|null>,"path":[...],"chain":[...]}`）——
        //   首版误写 `hit_node_id` ⇒ 恒 -1（假红 5 条），修正如实记：**接口字段名要读实现，不要猜**。
        // ★★`target` 可为 **null**（界外未命中）——必须显式判 null：
        //   直接数字解析会把 null 读成 0（strtod 不动指针 ⇒ 返回 false 但残留 0）⇒ 误报命中根节点。
        //   （Android 侧同语义：`!ho.isNull("target")` 才取值，否则 -1。）
        double hit = -1;
        if (rj.find("\"target\":null") == std::string::npos) {
            jnum(rj.c_str(), rj.size(), "target", &hit);
        }
        if (hit != expect[i]) mismatch++;
        char buf[96];
        snprintf(buf, sizeof(buf), "%s{\"x\":%.0f,\"y\":%.0f,\"hit\":%d,\"expect\":%d}",
                 i ? "," : "", probes[i][0], probes[i][1], (int)hit, expect[i]);
        results += buf;
    }
    results += "]";
    proteus_layout_destroy(handle);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_HIT_PROBE_DONE mismatch=%{public}d", mismatch);
    std::string out = "{\"ok\":" + std::string(mismatch == 0 ? "true" : "false")
        + ",\"mismatch\":" + std::to_string(mismatch) + ",\"probes\":" + results + "}";
    napi_value v;
    napi_create_string_utf8(env, out.c_str(), NAPI_AUTO_LENGTH, &v);
    return v;
}

/** version(): string —— Rust 核版本自报（仪器自检） */
static napi_value BenchVersion(napi_env env, napi_callback_info info) {
    char* v = proteus_layout_version();
    std::string ver = v ? v : "unknown";
    if (v) proteus_layout_free_string(v);
    napi_value out;
    napi_create_string_utf8(env, ver.c_str(), NAPI_AUTO_LENGTH, &out);
    return out;
}

EXTERN_C_START
static napi_value BenchInit(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"bench4050", nullptr, Bench4050, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"hitProbe", nullptr, HitProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"version", nullptr, BenchVersion, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module benchModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = BenchInit,
    .nm_modname = "proteus_bench",
    .nm_priv = nullptr,
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterProteusBenchModule(void) {
    napi_module_register(&benchModule);
}
