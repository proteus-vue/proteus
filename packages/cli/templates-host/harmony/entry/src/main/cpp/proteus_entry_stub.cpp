// {{appName}} —— 最小宿主 native 桩（本模块无原生逻辑）。
// 作用：让 hvigor 跨模块 native 聚合把所依赖 HAR（proteus_render）的原生库链接/打包进本 HAP。
extern "C" int proteus_entry_stub(void) { return 0; }
