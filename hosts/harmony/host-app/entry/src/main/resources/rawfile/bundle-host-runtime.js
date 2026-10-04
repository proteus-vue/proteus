"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/api/src/capability-app.ts
  var capability_app_exports = {};
  __export(capability_app_exports, {
    APP_EVENTS: () => APP_EVENTS,
    APP_EVENT_KEY: () => APP_EVENT_KEY,
    APP_EVENT_META: () => APP_EVENT_META,
    APP_NATIVE_METHODS: () => APP_NATIVE_METHODS,
    HOST_ID_KEY: () => HOST_ID_KEY,
    HOST_INVOKE_KEY: () => HOST_INVOKE_KEY,
    HOST_LIFECYCLE_BUS_KEY: () => HOST_LIFECYCLE_BUS_KEY,
    PAGE_EMIT_KEY: () => PAGE_EMIT_KEY,
    PAGE_EVENTS: () => PAGE_EVENTS,
    PAGE_EVENT_META: () => PAGE_EVENT_META,
    PLATFORM_TOPICS: () => PLATFORM_TOPICS,
    PLATFORM_TOPIC_ORDER: () => PLATFORM_TOPIC_ORDER,
    appNativeAvailable: () => appNativeAvailable,
    createAppLifecycleCapabilities: () => createAppLifecycleCapabilities,
    createAppNativeCapabilities: () => createAppNativeCapabilities,
    createHostLifecycleBus: () => createHostLifecycleBus,
    createStackPageSource: () => createStackPageSource,
    detectAppHost: () => detectAppHost,
    getHostInvoke: () => getHostInvoke,
    getHostLifecycleBus: () => getHostLifecycleBus,
    installAppEventSource: () => installAppEventSource,
    installPageEmitBridge: () => installPageEmitBridge,
    installWebEventSources: () => installWebEventSources,
    installWxAppEventBridge: () => installWxAppEventBridge,
    invokeHost: () => invokeHost
  });
  function installPageEmitBridge(bus) {
    const g2 = globalThis;
    g2[PAGE_EMIT_KEY] = (evt, payload) => {
      if (typeof evt !== "string") return;
      bus.emit({ topic: "page", kind: evt, payload });
    };
  }
  function installWxAppEventBridge(bus, wx) {
    const bridgeDiag = (msg) => {
      try {
        ;
        globalThis.console?.warn?.(msg);
      } catch {
      }
    };
    const tryOn = (fn, label) => {
      if (typeof fn !== "function") {
        bridgeDiag(`[proteus/lifecycle] wx.${label} \u7F3A\u5931\uFF08\u8BE5\u4E8B\u4EF6\u5728\u672C\u7AEF\u4E0D\u53EF\u7528\uFF09`);
        return;
      }
      try {
        fn();
      } catch {
        bridgeDiag(`[proteus/lifecycle] wx.${label} \u6CE8\u518C\u5931\u8D25\uFF08\u65E7\u57FA\u7840\u5E93\uFF1F\uFF09`);
      }
    };
    tryOn(wx.onAppShow && (() => wx.onAppShow(() => bus.emit({ topic: "app", kind: "show" }))), "onAppShow");
    tryOn(wx.onAppHide && (() => wx.onAppHide(() => bus.emit({ topic: "app", kind: "hide" }))), "onAppHide");
    const arg0 = (...args) => args[0];
    tryOn(wx.onError && (() => wx.onError((...a) => {
      const e = arg0(...a);
      bus.emit({ topic: "app", kind: "error", payload: { error: typeof e === "string" ? e : String(e?.message ?? "") } });
    })), "onError");
    tryOn(wx.onUnhandledRejection && (() => wx.onUnhandledRejection((...a) => {
      const r = arg0(...a);
      bus.emit({ topic: "app", kind: "unhandled-rejection", payload: { reason: String(r?.reason ?? "") } });
    })), "onUnhandledRejection");
    tryOn(wx.onMemoryWarning && (() => wx.onMemoryWarning((...a) => {
      const r = arg0(...a);
      bus.emit({ topic: "app", kind: "memory-warning", payload: { level: Number(r?.level ?? 0) } });
    })), "onMemoryWarning");
    tryOn(wx.onThemeChange && (() => wx.onThemeChange((...a) => {
      const r = arg0(...a);
      bus.emit({ topic: "app", kind: "theme-change", payload: { theme: r?.theme === "dark" ? "dark" : "light" } });
    })), "onThemeChange");
    tryOn(wx.onWindowResize && (() => wx.onWindowResize((...a) => {
      const r = arg0(...a);
      bus.emit({ topic: "app", kind: "resize", payload: r?.size ?? {} });
    })), "onWindowResize");
    tryOn(wx.onPageNotFound && (() => wx.onPageNotFound((...a) => {
      const r = arg0(...a);
      bus.emit({ topic: "app", kind: "page-not-found", payload: { path: String(r?.path ?? "") } });
    })), "onPageNotFound");
    tryOn(wx.onAudioInterruptionBegin && (() => wx.onAudioInterruptionBegin(() => bus.emit({ topic: "app", kind: "audio-interruption-begin" }))), "onAudioInterruptionBegin");
    tryOn(wx.onAudioInterruptionEnd && (() => wx.onAudioInterruptionEnd(() => bus.emit({ topic: "app", kind: "audio-interruption-end" }))), "onAudioInterruptionEnd");
  }
  function getHostInvoke() {
    const g2 = globalThis;
    const f = g2[HOST_INVOKE_KEY];
    return typeof f === "function" ? f : null;
  }
  function invokeHost(method, args) {
    const f = getHostInvoke();
    const ph = globalThis.proteusHost;
    if (!f && typeof ph?.invoke !== "function") {
      return { ok: false, reason: `\u58F3\u672A\u6CE8\u518C ${HOST_INVOKE_KEY} \u4E14\u65E0 proteusHost.invoke\uFF08App \u7AEF\u539F\u751F\u901A\u9053\uFF09`, missing: true };
    }
    try {
      const out = f ? f(method, JSON.stringify(args ?? null)) : ph.invoke(method, JSON.stringify(args ?? null));
      const parsed = JSON.parse(out);
      if (parsed && parsed.ok === false) {
        return { ok: false, reason: String(parsed.reason ?? "\u539F\u751F\u8C03\u7528\u5931\u8D25"), missing: !!parsed.missing };
      }
      return { ok: true, data: parsed?.data ?? parsed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const missing = /unsupported|missing|not implemented|no such/i.test(msg);
      return { ok: false, reason: msg, missing };
    }
  }
  function appNativeAvailable(method) {
    const r = invokeHost(method, { probe: true });
    return r.ok || !r.missing;
  }
  function createAppNativeCapabilities(CapError) {
    const call = (method, args, capSlug) => Promise.resolve().then(() => {
      const r = invokeHost(method, args);
      if (r.ok) return { ok: true, data: r.data };
      const code = r.missing ? `${capSlug}.unsupported` : `${capSlug}.failed`;
      return errNow(code, `${capSlug}: ${r.reason}`);
    });
    const errNow = (code, message) => {
      const err = new CapError(code, message);
      if (typeof err.code !== "string") {
        Object.defineProperty(err, "code", { value: code, enumerable: true, configurable: true });
      }
      return { ok: false, error: err };
    };
    return {
      /** C47 跳其他小程序（App 端无此概念——除非壳提供；★桥合同是 Promise<void>，失败即抛） */
      navigateMiniProgram: (options) => call(APP_NATIVE_METHODS.navigateMiniProgram, options, "mini-program").then((r) => {
        if (!r.ok) throw r.error;
      }),
      /** C48 宙主上下文（App 端：provider = 壳标识 + 应用版本 + 能力清单） */
      getHostContext: () => {
        const r = invokeHost(APP_NATIVE_METHODS.hostContext);
        if (r.ok && r.data && typeof r.data === "object") {
          const d = r.data;
          return { provider: d.provider ?? "app", version: d.version, capabilities: d.capabilities };
        }
        const hostId = globalThis.__PROTEUS_HOST_ID__;
        return { provider: typeof hostId === "string" ? hostId : "app" };
      },
      /** C50 扩展加载（App：壳动态装载原生模块 —— G-45 调试基座同机制） */
      loadExtension: (extensionId) => call(APP_NATIVE_METHODS.extensionLoad, { id: extensionId }, "extension"),
      /** C51 热更新（App：壳转发原生更新管理器——iOS App Store / Android 内更新） */
      getUpdateManager: () => ({
        checkUpdate: async () => {
          const r = await call(APP_NATIVE_METHODS.updateCheck, {}, "update");
          return r.ok ? { ok: true, data: { hasUpdate: !!r.data?.hasUpdate, currentVersion: r.data?.currentVersion } } : r;
        },
        applyUpdate: async () => {
          const r = await call(APP_NATIVE_METHODS.updateApply, {}, "update");
          return r.ok ? { ok: true, data: void 0 } : r;
        },
        // App 端事件由壳推（同生命周期事件渠道）——该句柄上诚实空订阅
        onCheckForUpdate: () => () => void 0,
        onUpdateReady: () => () => void 0,
        onUpdateFailed: () => () => void 0
      }),
      /** C53 Worker（App：壳创建后台线程 —— G-39 runOnThread） */
      createWorker: (scriptPath) => {
        const r = invokeHost(APP_NATIVE_METHODS.workerCreate, { scriptPath });
        if (!r.ok) throw new CapError(r.missing ? "worker.unsupported" : "worker.failed", `worker: ${r.reason}`);
        const created = r.data ?? {};
        const workerId = Number(created.id ?? 0);
        return {
          postMessage: (msg) => {
            const p = invokeHost(APP_NATIVE_METHODS.workerPost, { workerId, msg });
            return p.ok ? { ok: true, data: void 0 } : errNow(p.missing ? "worker.unsupported" : "worker.failed", p.reason);
          },
          onMessage: () => () => void 0,
          // 壳推知通过生命周期事件渠道
          terminate: () => {
            const p = invokeHost(APP_NATIVE_METHODS.workerTerminate, { workerId });
            return p.ok ? { ok: true, data: void 0 } : errNow(p.missing ? "worker.unsupported" : "worker.failed", p.reason);
          }
        };
      },
      /** C67 预加载（App：壳预初始化模块） */
      getPreload: () => ({
        assets: (data) => call(APP_NATIVE_METHODS.preloadAssets, { data }, "preload"),
        skylineView: () => call(APP_NATIVE_METHODS.preloadAssets, { kind: "view" }, "preload"),
        webview: () => call(APP_NATIVE_METHODS.preloadAssets, { kind: "webview" }, "preload"),
        subpackage: (packageType) => Promise.resolve(errNow("preload.unsupported", `App \u7AEF\u65E0\u5C0F\u7A0B\u5E8F\u5206\u5305\u6982\u5FF5\uFF08\u6536\u5230 ${packageType}\uFF09\u2014\u2014\u8BF7\u7528\u58F3\u9884\u521D\u59CB\u5316\u6A21\u5757`))
      }),
      /** C73 空闲回调（App：壳提供主线程空闲时机） */
      getIdle: () => ({
        request: (cb, timeout) => call(APP_NATIVE_METHODS.idleRequest, { timeout }, "idle").then((r) => {
          if (!r.ok) return r;
          try {
            cb({ timeRemaining: () => Number(r.data?.timeRemaining ?? 0), didTimeout: false });
          } catch {
          }
          return { ok: true, data: Number(r.data?.id ?? 0) };
        }),
        cancel: (id) => call(APP_NATIVE_METHODS.idleCancel, { id }, "idle")
      }),
      /** C74 窗体管理（App：原生窗口 API —— iPad 分屏 / 折叠屏 / 桌面端） */
      getWindow: () => ({
        setSize: (width, height) => call(APP_NATIVE_METHODS.windowSetSize, { width, height }, "window")
      }),
      /** C75 导航卸载拦截（App：虚拟栈 pop 拦截 —— M5 栈命令链） */
      getNavigationGuard: () => {
        let guardMessage = null;
        const g2 = globalThis;
        const apply = () => {
          g2.__proteusNavGuardMessage = guardMessage;
        };
        apply();
        return {
          enable: (message) => {
            guardMessage = message;
            apply();
            return Promise.resolve({ ok: true, data: void 0 });
          },
          disable: () => {
            guardMessage = null;
            apply();
            return Promise.resolve({ ok: true, data: void 0 });
          }
        };
      },
      /**
       * C82 WebAssembly。
       *
       * 【★★两条实现路径（真机取证后的正确形态）】
       *   ① **宿主侧 wasm 运行时**（wasm3，经 `webassembly.*` 通道）——iOS/Android 的 QuickJS **内建无 WASM**
       *      （实测：`qjs -e "typeof WebAssembly"` → undefined；源码零命中）⇒ 宿主提供引擎；
       *   ② **引擎内建 WebAssembly**（若 JS 引擎自带，如 JSC 完整版）——直接用，零跨边界开销。
       *   优先级：**宿主优先**（能力更全：支持 limits/gas 治理；且端上实测可达）→ 回落引擎内建。
       */
      getWebAssembly: () => {
        const hostWasm = invokeHost("webassembly.validate", { bytes: [0, 97, 115, 109, 1, 0, 0, 0] });
        const hostAvailable = hostWasm.ok && hostWasm.data === true;
        if (hostAvailable) {
          return {
            supportsStreaming: false,
            // 宿主通道是"字节数组"形态（无 fetch/stream 语义）
            supportsPathLoad: false,
            // ★options 用宽形态（`unknown` 再窄化）——与 `WasmInstantiateOptions` 结构兼容即可：
            //   收窄成具体形状会与 capability.ts 的声明不匹配（tsc 当场抓出）
            instantiate: (source, options) => Promise.resolve().then(() => {
              const bytes = source.bytes;
              if (!bytes) {
                return errNow("webassembly.unsupported", "\u5BBF\u4E3B\u901A\u9053\u9700\u8981 { bytes }\uFF08\u65E0\u4EE3\u7801\u5305\u8DEF\u5F84\u6982\u5FF5\uFF09");
              }
              const arr = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
              const r = invokeHost("webassembly.instantiate", { bytes: arr, limits: options?.limits });
              if (!r.ok) return errNow(r.missing ? "webassembly.unsupported" : "webassembly.failed", `\u5BBF\u4E3B\u5BFC\u51FA wasm\uFF1A${r.reason}`);
              const d = r.data ?? {};
              const handle = Number(d.handle ?? 0);
              return {
                ok: true,
                data: {
                  exports: {},
                  fromPath: false,
                  /** ★stub exports（宿主侧按导出函数名调用）——真实 memory/exports 面属后续批次 */
                  dispose: () => {
                    invokeHost("webassembly.release", { handle });
                  },
                  // ★宿主 cannel 的调用入口（非标准语义——见类型注；标准 `exports.fn()` 面属后续批次）
                  ...{ __hostHandle: handle, __engine: d.engine }
                }
              };
            }),
            compile: (bytes) => Promise.resolve().then(() => {
              const arr = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
              const v = invokeHost("webassembly.validate", { bytes: arr });
              return v.ok && v.data === true ? { ok: true, data: { engine: "host-wasm3", validated: true } } : errNow("webassembly.failed", `\u5BBF\u4E3B wasm validate \u672A\u901A\u8FC7\uFF1A${v.ok ? "false" : v.reason}`);
            }),
            validate: (bytes) => Promise.resolve().then(() => {
              const arr = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
              const r = invokeHost("webassembly.validate", { bytes: arr });
              return r.ok ? { ok: true, data: r.data === true } : errNow("webassembly.failed", r.reason);
            })
          };
        }
        const WASM = globalThis.WebAssembly;
        if (!WASM) {
          return {
            supportsStreaming: false,
            supportsPathLoad: false,
            instantiate: () => Promise.resolve(errNow("webassembly.unsupported", "\u5F53\u524D JS \u5F15\u64CE\u65E0 WebAssembly\uFF08App \u7AEF\u5E94\u7528 JSC/QuickJS\uFF09")),
            compile: () => Promise.resolve(errNow("webassembly.unsupported", "\u65E0 WebAssembly")),
            validate: () => Promise.resolve(errNow("webassembly.unsupported", "\u65E0 WebAssembly"))
          };
        }
        return {
          supportsStreaming: typeof WASM.instantiateStreaming === "function",
          supportsPathLoad: false,
          instantiate: (source, options) => Promise.resolve().then(async () => {
            const bytes = source.bytes;
            if (!bytes) {
              return errNow("webassembly.unsupported", 'App \u7AEF\u8BF7\u4F20 { bytes }\uFF08\u65E0"\u4EE3\u7801\u5305\u8DEF\u5F84"\u6982\u5FF5\u2014\u2014\u90A3\u662F\u5C0F\u7A0B\u5E8F\u5F62\u6001\uFF09');
            }
            const res = await WASM.instantiate(bytes, options);
            const exportsObj = res?.instance?.exports ?? {};
            return {
              ok: true,
              data: { exports: exportsObj, fromPath: false, dispose: () => void 0 }
            };
          }).catch((e) => errNow("webassembly.failed", `WebAssembly \u5B9E\u4F8B\u5316\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`)),
          // ★诚实边界（真机实测抓到）：**不是所有 JS 引擎都实现 compile/validate**
          //   （Android QuickJS 只有 instantiate——Node/V8 三者齐全）⇒ 缺方法时明确 Err
          //   （`webassembly.unsupported` + 指出引擎差异），不假装"校验通过"。
          compile: (bytes) => Promise.resolve().then(async () => {
            if (typeof WASM.compile !== "function") {
              return errNow("webassembly.unsupported", "\u5F53\u524D JS \u5F15\u64CE\u672A\u5B9E\u73B0 WebAssembly.compile\uFF08Android QuickJS \u53EA\u6709 instantiate\uFF09");
            }
            return { ok: true, data: await WASM.compile(bytes) };
          }).catch((e) => errNow("webassembly.failed", `compile \u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`)),
          validate: (bytes) => Promise.resolve().then(async () => {
            if (typeof WASM.validate !== "function") {
              return errNow("webassembly.unsupported", "\u5F53\u524D JS \u5F15\u64CE\u672A\u5B9E\u73B0 WebAssembly.validate\uFF08Android QuickJS \u53EA\u6709 instantiate\uFF09");
            }
            return { ok: true, data: await WASM.validate(bytes) };
          }).catch(() => errNow("webassembly.failed", "validate \u5931\u8D25\uFF08\u5B57\u8282\u975E\u6CD5\uFF1F\uFF09"))
        };
      }
    };
  }
  function installAppEventSource(bus) {
    const g2 = globalThis;
    const handler = (evt, payload) => {
      if (typeof evt !== "string") return "bad-event";
      if (!APP_EVENTS.includes(evt)) {
        return `unknown-event:${evt}`;
      }
      bus.emit({ topic: "app", kind: evt, payload });
      return "ok";
    };
    const KEY = "__proteusHostAppEvent";
    try {
      g2[KEY] = handler;
      return true;
    } catch {
      try {
        Object.defineProperty(g2, KEY, { value: handler, writable: true, configurable: true });
        return true;
      } catch {
        try {
          ;
          globalThis.console?.warn?.(
            `[proteus] ${KEY} \u88C5\u914D\u5931\u8D25\uFF08\u5BBF\u4E3B\u5168\u5C40\u4E0D\u53EF\u5199\uFF09\u2014\u2014\u5E94\u7528\u7EA7\u7CFB\u7EDF\u4E8B\u4EF6\u5C06\u4E0D\u53EF\u8FBE`
          );
        } catch {
        }
        return false;
      }
    }
  }
  function installWebEventSources(bus, g2) {
    const doc = g2.document;
    const win = g2;
    if (typeof win.addEventListener !== "function") return;
    win.addEventListener("visibilitychange", () => {
      const hidden = doc ? doc.visibilityState === "hidden" : false;
      bus.emit({ topic: "app", kind: hidden ? "hide" : "show" });
      bus.emit({ topic: "page", kind: hidden ? "hide" : "show" });
    });
    win.addEventListener("resize", () => {
      const size = { windowWidth: Number(win.innerWidth ?? 0), windowHeight: Number(g2.innerHeight ?? 0) };
      bus.emit({ topic: "app", kind: "resize", payload: size });
      bus.emit({ topic: "page", kind: "resize", payload: { size } });
    });
    const onLoad = () => {
      bus.emit({ topic: "app", kind: "show" });
      bus.emit({ topic: "page", kind: "load" });
      bus.emit({ topic: "page", kind: "show" });
      const markReady = () => bus.emit({ topic: "page", kind: "ready" });
      if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(markReady);
      else markReady();
    };
    win.addEventListener("load", onLoad);
    let scrollRaf = 0;
    let reachBottomFired = false;
    const REACH_BOTTOM_PX = 50;
    const onScroll = () => {
      const emitScroll = () => {
        scrollRaf = 0;
        const el = doc?.documentElement;
        const scrollTop = Number(el?.scrollTop ?? 0);
        bus.emit({ topic: "page", kind: "page-scroll", payload: { scrollTop, scrollLeft: 0 } });
        const scrollHeight = Number(el?.scrollHeight ?? 0);
        const clientHeight = Number(el?.clientHeight ?? g2.innerHeight ?? 0);
        const atBottom = scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - REACH_BOTTOM_PX;
        if (atBottom && !reachBottomFired) {
          reachBottomFired = true;
          bus.emit({ topic: "page", kind: "reach-bottom" });
        } else if (!atBottom && reachBottomFired) {
          reachBottomFired = false;
        }
      };
      if (typeof win.requestAnimationFrame === "function") {
        if (scrollRaf !== 0) return;
        scrollRaf = 1;
        win.requestAnimationFrame(emitScroll);
      } else {
        emitScroll();
      }
    };
    win.addEventListener("scroll", onScroll);
    const onBeforeUnload = (e) => {
      bus.emit({ topic: "page", kind: "unload" });
      const providers = globalThis.__proteusPageProviders;
      if (providers?.saveExitState) {
        try {
          const ret = providers.saveExitState();
          if (ret !== void 0 && e && typeof e === "object") e.returnValue = ret;
        } catch {
        }
      }
    };
    win.addEventListener("beforeunload", onBeforeUnload);
  }
  function detectAppHost() {
    const g2 = globalThis;
    const id = g2[HOST_ID_KEY];
    return typeof id === "string" && id.length > 0;
  }
  function getHostLifecycleBus() {
    const g2 = globalThis;
    const KEY = "__proteusHostLifecycleBus";
    const existing = g2[KEY];
    if (existing) return existing;
    const created = createHostLifecycleBus();
    g2[KEY] = created;
    return created;
  }
  function createHostLifecycleBus() {
    const subs = /* @__PURE__ */ new Map();
    let appPhase = "PENDING";
    let pagePhase = "IDLE";
    let currentScreen = null;
    let launchOptions = {};
    let enterOptions = {};
    const fire = (topic, payload) => {
      const set = subs.get(topic);
      if (!set) return;
      for (const cb of [...set]) cb(payload);
    };
    const bus = {
      snapshot: () => ({
        app: appPhase,
        page: pagePhase,
        currentScreen,
        launchOptions: { ...launchOptions },
        enterOptions: { ...enterOptions }
      }),
      emit(event) {
        if (event.topic === "app") {
          if (event.kind === "launch") {
            if (appPhase !== "PENDING") return;
            appPhase = "LAUNCH";
            fire("app:launch", event.payload);
            return;
          }
          if (event.kind === "show") {
            if (appPhase === "PENDING") {
              appPhase = "LAUNCH";
              fire("app:launch", void 0);
            }
            appPhase = "SHOW";
            fire("app:show", event.payload);
            return;
          }
          if (event.kind === "hide") {
            appPhase = "HIDE";
            fire("app:hide", event.payload);
            return;
          }
          fire(`app:${event.kind}`, event.payload);
          return;
        }
        if (event.topic === "page") {
          switch (event.kind) {
            case "load":
              pagePhase = "LOAD";
              if (event.screen) currentScreen = event.screen;
              break;
            case "show":
              pagePhase = "SHOW";
              if (event.screen) currentScreen = event.screen;
              break;
            case "hide":
              pagePhase = "HIDE";
              break;
            case "unload":
              pagePhase = "IDLE";
              break;
            default:
              break;
          }
          const payload = event.payload ?? (event.screen !== void 0 ? { screen: event.screen } : { screen: currentScreen });
          fire(`page:${event.kind}`, payload);
          if (event.kind === "unload") currentScreen = null;
          return;
        }
        fire(event.topic, event);
      },
      on(topic, cb) {
        let set = subs.get(topic);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          subs.set(topic, set);
        }
        set.add(cb);
        return () => {
          set.delete(cb);
        };
      },
      setLaunchOptions(options) {
        launchOptions = { ...options };
      },
      setEnterOptions(options) {
        enterOptions = { ...options };
      },
      get subscriberCount() {
        let n = 0;
        for (const set of subs.values()) n += set.size;
        return n;
      }
    };
    return bus;
  }
  function createStackPageSource(bus) {
    const screenNames = /* @__PURE__ */ new Map();
    let count = 0;
    return {
      apply(command) {
        if (command.op === "mount") {
          const name = command.name ?? command.screenId;
          screenNames.set(command.screenId, name);
          bus.emit({ topic: "page", kind: "load", screen: name });
          count++;
          return;
        }
        if (command.op === "enter") {
          bus.emit({ topic: "page", kind: "show", screen: screenNames.get(command.screenId) });
          count++;
          return;
        }
        if (command.op === "exit") {
          bus.emit({ topic: "page", kind: "hide" });
          count++;
          return;
        }
        if (command.reason === "freeze") return;
        bus.emit({ topic: "page", kind: "unload" });
        screenNames.delete(command.screenId);
        count++;
      },
      get count() {
        return count;
      }
    };
  }
  function createAppLifecycleCapabilities(bus, CapError) {
    void CapError;
    const sub = (topic, cb) => bus.on(topic, () => cb());
    const appNotify = (topic) => (cb) => bus.on(topic, (p) => cb(p));
    return {
      getAppLifecycle() {
        const handle = {
          get phase() {
            return bus.snapshot().app;
          },
          onLaunch(cb) {
            if (bus.snapshot().app !== "PENDING") {
              cb();
              return () => void 0;
            }
            return sub("app:launch", cb);
          },
          onShow(cb) {
            return sub("app:show", cb);
          },
          onHide(cb) {
            return sub("app:hide", cb);
          },
          // 应用级专属事件（C25 useBackground 不提供的那些——见接口注释的职责边界）
          onPageNotFound(cb) {
            return bus.on("app:page-not-found", (p) => cb({ path: String(p?.path ?? "") }));
          },
          onAudioInterruptionBegin: appNotify("app:audio-interruption-begin"),
          onAudioInterruptionEnd: appNotify("app:audio-interruption-end")
        };
        return handle;
      },
      getPageLifecycle() {
        const providers = {};
        try {
          ;
          globalThis.__proteusPageProviders = providers;
        } catch {
        }
        const handle = {
          get phase() {
            return bus.snapshot().page;
          },
          onLoad(cb) {
            const p = bus.snapshot().page;
            if (p === "LOAD" || p === "SHOW" || p === "HIDE") {
              cb();
              return () => void 0;
            }
            return sub("page:load", cb);
          },
          onShow(cb) {
            return sub("page:show", cb);
          },
          onHide(cb) {
            return sub("page:hide", cb);
          },
          onReady(cb) {
            return sub("page:ready", cb);
          },
          onUnload(cb) {
            return sub("page:unload", cb);
          },
          onRouteDone(cb) {
            return bus.on("page:route-done", (p) => cb(p ?? {}));
          },
          onPullDownRefresh(cb) {
            return sub("page:pull-down-refresh", cb);
          },
          onReachBottom(cb) {
            return sub("page:reach-bottom", cb);
          },
          onPageScroll(cb) {
            return bus.on("page:page-scroll", (p) => {
              const e = p ?? { scrollTop: 0 };
              cb({ scrollTop: Number(e.scrollTop ?? 0), scrollLeft: e.scrollLeft });
            });
          },
          onResize(cb) {
            return bus.on("page:resize", (p) => {
              const e = p;
              cb(e?.size ? e : { size: { windowWidth: 0, windowHeight: 0 } });
            });
          },
          onTabItemTap(cb) {
            return bus.on("page:tab-item-tap", (p) => {
              const e = p ?? { index: -1 };
              cb(e);
            });
          },
          // —— 决策型（单处理器：后设覆盖前设——语义上只能有一个返回值）——
          setShareAppMessageProvider(fn) {
            providers.shareAppMessage = fn;
          },
          setShareTimelineProvider(fn) {
            providers.shareTimeline = fn;
          },
          setAddToFavoritesProvider(fn) {
            providers.addToFavorites = fn;
          },
          setSaveExitStateProvider(fn) {
            providers.saveExitState = fn;
          }
        };
        return handle;
      },
      getBackground() {
        return {
          onEvent(cb) {
            const offHide = bus.on("app:hide", () => cb({ type: "enter-background", time: Date.now() }));
            const offShow = bus.on("app:show", () => cb({ type: "enter-foreground", time: Date.now() }));
            return () => {
              offHide();
              offShow();
            };
          },
          onMemoryWarning(cb) {
            return bus.on("app:memory-warning", (p) => cb(p.level));
          },
          onThemeChange(cb) {
            return bus.on("app:theme-change", (p) => cb(p.theme));
          },
          onWindowResize(cb) {
            return bus.on("app:resize", (p) => {
              const s = p;
              cb({ windowWidth: s.windowWidth, windowHeight: s.windowHeight });
            });
          },
          onError(cb) {
            return bus.on("app:error", (p) => cb(p.error));
          },
          onUnhandledRejection(cb) {
            return bus.on("app:unhandled-rejection", (p) => {
              const r = p;
              cb({ reason: r.reason, promise: Promise.resolve() });
            });
          },
          onNetworkStatusChange(cb) {
            return bus.on("network-change", (p) => {
              const s = p;
              cb({ isConnected: s.isConnected, networkType: s.networkType });
            });
          },
          async getLaunchOptions() {
            return { ok: true, data: bus.snapshot().launchOptions };
          },
          async getEnterOptions() {
            return { ok: true, data: bus.snapshot().enterOptions };
          }
        };
      }
    };
  }
  var PAGE_EVENTS, APP_EVENTS, PAGE_EMIT_KEY, PAGE_EVENT_META, APP_EVENT_META, HOST_INVOKE_KEY, APP_NATIVE_METHODS, PLATFORM_TOPICS, PLATFORM_TOPIC_ORDER, APP_EVENT_KEY, HOST_LIFECYCLE_BUS_KEY, HOST_ID_KEY;
  var init_capability_app = __esm({
    "packages/api/src/capability-app.ts"() {
      "use strict";
      PAGE_EVENTS = [
        "load",
        "show",
        "ready",
        "hide",
        "unload",
        "route-done",
        "pull-down-refresh",
        "reach-bottom",
        "page-scroll",
        "resize",
        "tab-item-tap",
        "share-app-message",
        "share-timeline",
        "add-to-favorites",
        "save-exit-state"
      ];
      APP_EVENTS = [
        "launch",
        "show",
        "hide",
        "error",
        "unhandled-rejection",
        "memory-warning",
        "theme-change",
        "resize",
        "page-not-found",
        "audio-interruption-begin",
        "audio-interruption-end"
      ];
      PAGE_EMIT_KEY = "__proteusEmitPage";
      PAGE_EVENT_META = {
        load: {
          doc: "\u9875\u9762\u52A0\u8F7D\uFF08\u6BCF\u6B21\u8FDB\u5165\u8BE5\u9875\u89E6\u53D1\u4E00\u6B21\uFF0C\u53EF\u8BFB\u53D6\u8DEF\u7531\u53C2\u6570\uFF09",
          mp: "Page.onLoad\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "\u6587\u6863 load",
          app: "\u865A\u62DF\u6808 mount \u547D\u4EE4"
        },
        show: {
          doc: "\u9875\u9762\u663E\u793A\uFF08\u5207\u5165\u524D\u53F0\uFF0C\u6216\u4ECE\u4E0A\u5C42\u9875\u9762\u8FD4\u56DE\uFF09",
          mp: "Page.onShow\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "load \u540E + visibilitychange\u2192visible",
          app: "\u865A\u62DF\u6808 enter \u547D\u4EE4 / \u58F3 resume"
        },
        ready: {
          doc: "\u9875\u9762\u9996\u5E27\u6E32\u67D3\u5B8C\u6210\uFF08\u4E00\u6B21\uFF09",
          mp: "Page.onReady\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "load \u540E\u9996\u5E27\uFF08rAF\uFF09",
          app: "\u5C4F\u9996\u5E27\u6E32\u67D3\u5B8C\u6210"
        },
        hide: {
          doc: "\u9875\u9762\u9690\u85CF\uFF08\u5207\u540E\u53F0\uFF0C\u6216\u88AB\u4E0A\u5C42\u9875\u9762\u8986\u76D6\uFF09",
          mp: "Page.onHide\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "visibilitychange\u2192hidden",
          app: "\u865A\u62DF\u6808 exit \u547D\u4EE4 / \u58F3 pause"
        },
        unload: {
          doc: "\u9875\u9762\u5378\u8F7D\uFF08\u79BB\u5F00\u5E76\u9500\u6BC1\uFF09",
          mp: "Page.onUnload\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "beforeunload",
          app: "\u865A\u62DF\u6808 unmount \u547D\u4EE4"
        },
        "route-done": {
          doc: "\u8DEF\u7531\u52A8\u753B\u5B8C\u6210\uFF08\u8F6C\u573A\u7ED3\u675F\u540E\uFF09",
          mp: "Page.onRouteDone\uFF08\u57FA\u7840\u5E93 2.32.1+\uFF09",
          web: "transitionend\uFF08\u7531 router \u5C42\u63A8\uFF09",
          app: "Morpheus \u8F6C\u573A\u7ED3\u675F",
          note: "\u57FA\u7840\u5E93\u7248\u672C\u8981\u6C42\u8F83\u9AD8\uFF1A\u4F4E\u7248\u672C\u65E0\u6B64\u94A9\u5B50\uFF08\u4EA7\u7269\u4F1A\u751F\u6210\uFF0C\u4F46\u4E0D\u89E6\u53D1\u2014\u2014\u8BDA\u5B9E\u964D\u7EA7\uFF09"
        },
        "pull-down-refresh": {
          doc: "\u4E0B\u62C9\u5237\u65B0\uFF08\u7528\u6237\u4E0B\u62C9\u9875\u9762\uFF09",
          mp: "Page.onPullDownRefresh",
          web: null,
          app: "\u5BBF\u4E3B\u4E0B\u62C9\u624B\u52BF",
          note: "\u2605\u5C0F\u7A0B\u5E8F\u9700\u5728 page.json \u5F00 enablePullDownRefresh\uFF0C\u5426\u5219\u4E0D\u89E6\u53D1\uFF1B**Web \u65E0\u539F\u751F\u7B49\u4EF7**\uFF08\u8BDA\u5B9E\u4E0D\u89E6\u53D1\uFF09"
        },
        "reach-bottom": {
          doc: "\u6EDA\u52A8\u89E6\u5E95\uFF08\u53EF\u7528\u4E8E\u52A0\u8F7D\u66F4\u591A\uFF09",
          mp: "Page.onReachBottom",
          web: "scroll \u8DDD\u5E95 \u226450px",
          app: "\u6EDA\u52A8\u5230\u5E95",
          note: "Web \u7AEF\u4E3A\u9608\u503C\u542F\u53D1\u5F0F\uFF0850px\uFF09\uFF1B\u5C0F\u7A0B\u5E8F\u6309 onReachBottomDistance \u914D\u7F6E"
        },
        "page-scroll": {
          doc: "\u9875\u9762\u6EDA\u52A8\uFF08\u643A\u5E26 scrollTop\uFF09",
          mp: "Page.onPageScroll",
          web: "scroll\uFF08rAF \u8282\u6D41\uFF09",
          app: "\u6EDA\u52A8\u56DE\u8C03",
          note: "\u2605\u2605**\u9AD8\u9891\u4E8B\u4EF6**\uFF1A\u5FAE\u4FE1\u5B98\u65B9\u660E\u786E\u4F1A\u5F15\u8D77\u903B\u8F91\u5C42\u4E0E\u6E32\u67D3\u5C42\u901A\u4FE1 \u21D2 \u5C0F\u7A0B\u5E8F\u7AEF**\u4EC5\u5F53\u4F60\u58F0\u660E\u8FC7 onPageScroll \u65F6\u624D\u6D3E\u53D1**\uFF1BWeb \u7AEF\u5DF2 rAF \u8282\u6D41"
        },
        resize: {
          doc: "\u9875\u9762\u5C3A\u5BF8\u53D8\u5316\uFF08\u65CB\u8F6C / \u5206\u5C4F / \u7A97\u53E3\u7F29\u653E\uFF09",
          mp: "Page.onResize\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: "resize",
          app: "\u5C4F\u5E55\u65CB\u8F6C / \u5206\u5C4F"
        },
        "tab-item-tap": {
          doc: "\u70B9\u51FB tab \u680F\u9879\uFF08\u643A\u5E26 index / pagePath\uFF09",
          mp: "Page.onTabItemTap\uFF08\u7F16\u8BD1\u4EA7\u7269\u6D3E\u53D1\uFF09",
          web: null,
          app: "tab \u680F\u70B9\u51FB",
          note: "Web \u7AEF\u65E0 tab \u680F\u6982\u5FF5\uFF08\u5982\u81EA\u7ED8 tab \u8BF7\u76F4\u63A5\u7528\u7EC4\u4EF6\u4E8B\u4EF6\uFF09"
        },
        "share-app-message": {
          doc: "\u8F6C\u53D1\u7ED9\u597D\u53CB\uFF08**\u51B3\u7B56\u578B**\uFF1A\u6CE8\u518C\u7684 provider \u8FD4\u56DE\u503C\u5373\u5206\u4EAB\u5185\u5BB9\uFF09",
          mp: "Page.onShareAppMessage",
          web: "navigator.share\uFF08\u9700\u7528\u6237\u624B\u52BF\uFF09",
          app: "\u7CFB\u7EDF\u5206\u4EAB\u9762\u677F",
          note: '\u2605\u5C0F\u7A0B\u5E8F**\u58F0\u660E\u540E\u624D\u663E\u793A\u53F3\u4E0A\u89D2"\u8F6C\u53D1"\u5165\u53E3**\uFF08\u6846\u67B6\u4E0D\u81EA\u52A8\u8865\u2014\u2014\u4E0D\u64C5\u81EA\u52A0\u7528\u6237\u53EF\u89C1\u884C\u4E3A\uFF09'
        },
        "share-timeline": {
          doc: "\u5206\u4EAB\u5230\u670B\u53CB\u5708\uFF08**\u51B3\u7B56\u578B**\uFF09",
          mp: "Page.onShareTimeline",
          web: null,
          app: "\u7CFB\u7EDF\u5206\u4EAB\u9762\u677F",
          note: "\u540C\u8F6C\u53D1\uFF1A\u5C0F\u7A0B\u5E8F\u58F0\u660E\u540E\u624D\u663E\u793A\u5165\u53E3"
        },
        "add-to-favorites": {
          doc: "\u6536\u85CF\u9875\u9762\uFF08**\u51B3\u7B56\u578B**\uFF09",
          mp: "Page.onAddToFavorites",
          web: null,
          app: "\u7CFB\u7EDF\u6536\u85CF",
          note: "\u540C\u8F6C\u53D1\uFF1A\u5C0F\u7A0B\u5E8F\u58F0\u660E\u540E\u624D\u663E\u793A\u5165\u53E3"
        },
        "save-exit-state": {
          doc: "\u4FDD\u5B58\u9000\u51FA\u72B6\u6001\uFF08**\u51B3\u7B56\u578B**\uFF1Aprovider \u8FD4\u56DE\u9700\u4FDD\u5B58\u7684\u72B6\u6001\u5BF9\u8C61\uFF09",
          mp: "Page.onSaveExitState\uFF08\u57FA\u7840\u5E93 2.7.4+\uFF09",
          web: "beforeunload' \u7684 'returnValue",
          app: "\u9000\u51FA\u524D\u72B6\u6001\u4FDD\u5B58",
          note: "Web \u7AEF\u8BED\u4E49\u5DEE\u5F02\uFF1Abeforeunload \u7684\u8FD4\u56DE\u503C\u7528\u4E8E**\u79BB\u5F00\u786E\u8BA4**\uFF08\u6D4F\u89C8\u5668\u4E0D\u6301\u4E45\u5316\u72B6\u6001\uFF09"
        }
      };
      APP_EVENT_META = {
        launch: {
          doc: "\u5E94\u7528\u542F\u52A8\uFF08**\u6070\u597D\u4E00\u6B21**\uFF0C\u5148\u4E8E\u9996\u4E2A show\uFF1B\u58F3\u53EA\u9700\u8F6C\u53D1 show\uFF0C\u603B\u7EBF\u81EA\u52A8\u8865 launch\uFF09",
          mp: "\u9996\u4E2A onAppShow \u81EA\u52A8\u8865\u53D1",
          web: "\u9996\u4E2A load \u81EA\u52A8\u8865\u53D1",
          app: "\u58F3\u51B7\u542F\u52A8"
        },
        show: {
          doc: "\u5E94\u7528\u8FDB\u5165\u524D\u53F0",
          mp: "wx.onAppShow",
          web: "visibilitychange\u2192visible",
          app: "\u58F3 resume\uFF08Activity.onResume / didBecomeActive\uFF09"
        },
        hide: {
          doc: "\u5E94\u7528\u9000\u5230\u540E\u53F0",
          mp: "wx.onAppHide",
          web: "visibilitychange\u2192hidden",
          app: "\u58F3 pause\uFF08Activity.onPause / willResignActive\uFF09"
        },
        error: {
          doc: "\u672A\u6355\u83B7\u7684\u8FD0\u884C\u65F6\u9519\u8BEF",
          mp: "App.onError' / 'wx.onError",
          web: "window.onerror",
          app: "\u58F3\u5168\u5C40\u5F02\u5E38\u94A9\u5B50\uFF08Android Thread.setDefaultUncaughtExceptionHandler / iOS NSSetUncaughtExceptionHandler\u2014\u2014\u53CC\u7AEF\u771F\u673A\u9A8C\u8BC1\uFF09"
        },
        "unhandled-rejection": {
          doc: "\u672A\u5904\u7406\u7684 Promise rejection",
          mp: "App.onUnhandledRejection",
          web: "unhandledrejection",
          // ★诚实分档（2026-09-30 取证）：Promise rejection 是 **JS 引擎语义**，Android/iOS 系统层
          //   没有这类事件（Android 只有线程级未捕获异常——已由 error 覆盖）。引擎侧未接 rejection
          //   tracker ⇒ **App 端如实为「无此事件」**（原写"壳错误捕获"是把 error 的来源安到它头上）。
          app: null
        },
        "memory-warning": {
          doc: "\u7CFB\u7EDF\u5185\u5B58\u8B66\u544A\uFF08\u53EF\u7528\u4E8E\u91CA\u653E\u7F13\u5B58\uFF09",
          mp: "App.onMemoryWarning' / 'wx.onMemoryWarning",
          web: "performance.memory \u542F\u53D1\u5F0F",
          app: "\u58F3\u5185\u5B58\u538B\u529B\u56DE\u8C03\uFF08Android ComponentCallbacks2.onTrimMemory / iOS didReceiveMemoryWarning\u2014\u2014\u53CC\u7AEF\u771F\u673A\u9A8C\u8BC1\uFF09",
          note: "\u2605**\u5F52\u5C5E C25 useBackground**\uFF08\u672C\u4E8B\u4EF6\u4E0D\u5728 useAppLifecycle \u4E0A\u2014\u2014\u4E24\u5904\u91CD\u590D\u5DF2\u4E8E 2026-09-30 \u53BB\u91CD\uFF09"
        },
        "theme-change": {
          doc: "\u7CFB\u7EDF\u6DF1\u8272/\u6D45\u8272\u6A21\u5F0F\u5207\u6362",
          mp: "App.onThemeChange' / 'wx.onThemeChange",
          web: "matchMedia(prefers-color-scheme)",
          app: "\u58F3\u914D\u7F6E\u53D8\u5316\u56DE\u8C03\uFF08Android onConfigurationChanged \u8BFB uiMode / iOS traitCollectionDidChange\u2014\u2014\u53CC\u7AEF\u771F\u673A\u9A8C\u8BC1\uFF09",
          note: "\u2605**\u5F52\u5C5E C25 useBackground**\uFF08\u53BB\u91CD\u540E\u4ECE useAppLifecycle \u79FB\u9664\uFF09"
        },
        resize: {
          doc: "\u7A97\u53E3\u5C3A\u5BF8\u53D8\u5316",
          mp: "wx.onWindowResize",
          web: "resize",
          app: "\u58F3\u914D\u7F6E\u53D8\u5316\u56DE\u8C03\uFF08Android onConfigurationChanged \u7684 screenWidthDp \u53D8\u5316\u2014\u2014\u771F\u673A\u65CB\u8F6C\u9A71\u52A8\u9A8C\u8BC1\uFF09",
          note: "\u2605**\u5F52\u5C5E C25 useBackground**\uFF08\u53BB\u91CD\u540E\u4ECE useAppLifecycle \u79FB\u9664\uFF09"
        },
        "page-not-found": {
          doc: "\u8DEF\u7531\u672A\u547D\u4E2D\uFF08\u53EF\u8DF3\u515C\u5E95\u9875\uFF09",
          mp: "App.onPageNotFound / wx.onPageNotFound",
          web: "\u8DEF\u7531\u672A\u547D\u4E2D\uFF08router \u5C42\u63A8\uFF09",
          // ★诚实分档（2026-09-30 取证）：路由未命中属**框架 router 层**事实，宿主系统没有此类事件
          //   （Android/iOS 都不会上报"路由未命中"）⇒ App 端如实为「无此事件」，等 router 层补发。
          app: null
        },
        "audio-interruption-begin": {
          doc: "\u97F3\u9891\u88AB\u7CFB\u7EDF\u4E2D\u65AD\u5F00\u59CB\uFF08\u6765\u7535\u7B49\uFF09",
          mp: "App.onAudioInterruptionBegin",
          web: null,
          // ★诚实分档（2026-09-30 取证）：Android 用 BECOMING_NOISY / HEADSET_PLUG **动态接收器**近似
          //   （真实现已注册）；但两条是保护广播 ⇒ adb 无法注入驱动，真触发需物理插拔耳机。
          app: "\u58F3\u97F3\u9891\u4FE1\u53F7\u63A5\u6536\u5668\uFF08Android BECOMING_NOISY / HEADSET_PLUG\u2014\u2014\u5DF2\u6CE8\u518C\uFF0C\u2605\u4FDD\u62A4\u5E7F\u64AD\u4E0D\u53EF\u811A\u672C\u9A71\u52A8\uFF09"
        },
        "audio-interruption-end": {
          doc: "\u97F3\u9891\u4E2D\u65AD\u7ED3\u675F\uFF08\u53EF\u6062\u590D\u64AD\u653E\uFF09",
          mp: "App.onAudioInterruptionEnd",
          web: null,
          app: "\u58F3\u97F3\u9891\u4FE1\u53F7\u63A5\u6536\u5668\uFF08Android HEADSET_PLUG state=1\u2014\u2014\u540C\u4E0A\uFF0C\u771F\u89E6\u53D1\u9700\u7269\u7406\u63D2\u62D4\uFF09"
        }
      };
      HOST_INVOKE_KEY = "__proteusHostInvoke";
      APP_NATIVE_METHODS = {
        /** C51 热更新：`{ hasUpdate, ready }` 或 `{ action: 'apply' }` */
        updateCheck: "update.check",
        updateApply: "update.apply",
        /** C74 窗口：`{ width, height }` */
        windowSetSize: "window.setSize",
        /** C14 键盘：壳主动推 `keyboard.height` 事件（见 APP_EVENT_SOURCES） */
        /** C48 宿主上下文：`{ provider, version, capabilities }` */
        hostContext: "host.context",
        /** C50 扩展加载：`{ id }` → 模块句柄（App 端由壳动态装载原生模块） */
        extensionLoad: "extension.load",
        /** C47 跳其他小程序：App 端无此概念（对齐 Web） */
        navigateMiniProgram: "mini-program.navigate",
        /** C53 Worker：App 端由壳创建后台线程（G-39 runOnThread） */
        workerCreate: "worker.create",
        workerPost: "worker.post",
        workerTerminate: "worker.terminate",
        /** C73 空闲回调：壳提供主线程空闲时机 */
        idleRequest: "idle.request",
        idleCancel: "idle.cancel",
        /** C67 预加载 */
        preloadAssets: "preload.assets"
      };
      PLATFORM_TOPICS = {
        // ── C23 应用生命周期：各平台的"app 级事件" ──
        "app-lifecycle": {
          mp: [
            {
              title: "\u5C0F\u7A0B\u5E8F\u5168\u5C40\u4E8B\u4EF6\u9762",
              titleEn: "Mini Program global event surface",
              desc: "App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* \u5747\u4E3A\u5C0F\u7A0B\u5E8F**\u72EC\u6709**\uFF08Web/App \u65E0\u5BF9\u5E94\u8BED\u4E49\uFF09",
              descEn: "App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* are Mini-Program-only (no Web/App equivalent)",
              hooks: ["useBackground"]
            },
            {
              title: "\u5C0F\u7A0B\u5E8F\u767D\u5C4F\u4E0E\u542F\u52A8\u8DEF\u5F84",
              titleEn: "Cold-start route & scene",
              desc: "\u51B7\u542F\u52A8\u53C2\u6570\uFF08scene / query / \u5206\u4EAB\u6765\u6E90\uFF09\u7531 App.onLaunch \u63D0\u4F9B\uFF0C\u5728\u751F\u547D\u5468\u671F\u91CC\u7B49\u540C\u4E8E\u9996\u4E2A show",
              descEn: "Cold-start params (scene / query / share origin) come from App.onLaunch \u2014 equivalent to the first show in this lifecycle",
              roadmap: "\u4E13\u7528\u7684\u542F\u52A8\u53C2\u6570\u8BFB\u53D6\uFF08launchOptions/enterOptions\uFF09\u5DF2\u5728 useBackground \u63D0\u4F9B",
              roadmapEn: "Dedicated launch/enter option readers already ship in useBackground",
              hooks: ["useBackground"]
            }
          ],
          web: [
            {
              title: '\u6D4F\u89C8\u5668\u65E0"\u542F\u52A8"\u6982\u5FF5',
              titleEn: 'Browsers have no "launch" concept',
              desc: '\u6D4F\u89C8\u5668\u4E0D\u533A\u5206"\u51B7\u542F\u52A8"\u4E0E"\u5237\u65B0"\u2014\u2014\u9996\u4E2A load \u540E\u603B\u7EBF\u81EA\u52A8\u8865\u4E00\u6B21 launch\uFF08\u8BED\u4E49\u7B49\u4EF7\u5316\uFF09',
              descEn: "Browsers do not distinguish cold start from reload \u2014 the first load auto-emits one launch (semantic equivalence)"
            },
            {
              title: "\u9875\u7B7E\u5207\u6362 \u2260 \u5E94\u7528\u5207\u540E\u53F0",
              titleEn: "Tab switch != app background",
              desc: 'visibilitychange \u65E0\u6CD5\u533A\u5206"\u7528\u6237\u5207\u5230\u53E6\u4E00\u4E2A\u6807\u7B7E"\u4E0E"\u6700\u5C0F\u5316\u7A97\u53E3"\u2014\u2014\u4E24\u8005\u90FD\u4F1A\u89E6\u53D1 hide',
              descEn: "visibilitychange cannot distinguish a tab switch from a minimized window \u2014 both fire hide"
            }
          ],
          app: [
            {
              title: "Activity / ViewController \u751F\u547D\u5468\u671F\u8F6C\u53D1",
              titleEn: "Activity / ViewController lifecycle forwarding",
              desc: "\u58F3\u628A onCreate/onResume/onPause\uFF08iOS\uFF1AviewDidLoad/didBecomeActive/willResignActive\uFF09\u8F6C\u53D1\u5230\u8FD0\u884C\u65F6\u2014\u2014**\u4E1A\u52A1\u4E0D\u76F4\u63A5\u63A5\u89E6 Activity \u751F\u547D\u5468\u671F**\uFF08G-39 \u552F\u4E00\u62E5\u6709\uFF09",
              descEn: "The shell forwards onCreate/onResume/onPause (iOS: viewDidLoad/didBecomeActive/willResignActive) into the runtime \u2014 **business code never touches Activity lifecycle directly** (G-39 single ownership)"
            },
            {
              title: "\u5185\u5B58\u8B66\u544A\u4E0E\u4F4E\u5185\u5B58",
              titleEn: "Memory warnings & low memory",
              desc: "iOS didReceiveMemoryWarning / Android onTrimMemory \u7531\u58F3\u8F6C\u53D1 \u2014\u2014 \u7528\u4E8E\u91CA\u653E\u7F13\u5B58\uFF08\u914D\u5408 G-43 \u6240\u6709\u6743\u6A21\u578B\uFF09",
              descEn: "iOS didReceiveMemoryWarning / Android onTrimMemory forwarded by the shell \u2014 release caches here (pairs with the G-43 ownership model)",
              hooks: ["useBackground"]
            },
            {
              title: "\u97F3\u9891\u4F1A\u8BDD\u4E2D\u65AD",
              titleEn: "Audio session interruption",
              desc: "\u7535\u8BDD/\u5176\u4ED6\u5E94\u7528\u5360\u7528\u97F3\u9891\u4F1A\u8BDD\u65F6\uFF0C\u7CFB\u7EDF\u4F1A\u6253\u65AD\u64AD\u653E \u2014\u2014 \u4E24\u5E73\u53F0\u90FD\u7531\u58F3\u63A5\u771F\u6765\u6E90\uFF08iOS `AVAudioSession.interruptionNotification` \u771F\u4F1A\u8BDD\u8BED\u4E49\uFF1BAndroid \u65E0\u7EDF\u4E00\u56DE\u8C03 \u21D2 \u7528 `BECOMING_NOISY`/`HEADSET_PLUG` \u63A5\u6536\u5668\u8FD1\u4F3C\uFF0C\u2605\u4FDD\u62A4\u5E7F\u64AD\u4E0D\u53EF\u811A\u672C\u9A71\u52A8\uFF09",
              descEn: "When a call or another app takes the audio session the system interrupts playback \u2014 both shells wire real sources (iOS: `AVAudioSession.interruptionNotification`; Android has no unified callback \u21D2 approximated via `BECOMING_NOISY`/`HEADSET_PLUG` receivers, \u2605protected broadcasts, not script-drivable)"
            }
          ]
        },
        // ── C24 页面生命周期：各平台的"页面级事件" ──
        "page-lifecycle": {
          mp: [
            {
              title: "\u9875\u9762\u6808\u4E0E tab \u8BED\u4E49",
              titleEn: "Page stack & tab semantics",
              desc: "\u9875\u9762\u6808\u6700\u591A 10 \u5C42\uFF1BswitchTab \u4F1A\u9500\u6BC1\u975E tab \u9875\u5E76\u4FDD\u6D3B\u5176\u4ED6 tab\uFF08\u8FD4\u56DE\u65F6\u4E0D\u91CD\u65B0\u521D\u59CB\u5316\uFF09\u2014\u2014\u8FD9\u662F Web/App \u90FD\u6CA1\u6709\u7684\u8BED\u4E49",
              descEn: "Up to a 10-page stack; switchTab destroys non-tab pages while keeping other tabs alive (no re-init on return) \u2014 semantics Web/App lack"
            },
            {
              title: "\u4E0B\u62C9\u5237\u65B0\u4E0E\u89E6\u5E95",
              titleEn: "Pull-down refresh & reach-bottom",
              desc: "\u2605\u9700\u5728 page.json \u5F00 enablePullDownRefresh \u624D\u4F1A\u89E6\u53D1\uFF1BonReachBottomDistance \u63A7\u5236\u89E6\u5E95\u9608\u503C\uFF08Web \u65E0\u539F\u751F\u7B49\u4EF7\uFF09",
              descEn: "\u2605Requires enablePullDownRefresh in page.json; onReachBottomDistance controls the bottom threshold (Web has no native equivalent)"
            },
            {
              title: "onRouteDone\uFF08\u8F6C\u573A\u5B8C\u6210\uFF09",
              titleEn: "onRouteDone (transition finished)",
              desc: '\u57FA\u7840\u5E93 2.32.1+\uFF1A\u81EA\u5B9A\u4E49\u8F6C\u573A\u771F\u6B63\u7ED3\u675F\u7684\u65F6\u673A\uFF08\u4E0D\u662F"\u8C03\u7528\u8FD4\u56DE\u65F6"\uFF09',
              descEn: "Base library 2.32.1+: the moment a custom transition actually finishes (not when the call returns)"
            },
            {
              title: "\u9AD8\u9891 onPageScroll",
              titleEn: "High-frequency onPageScroll",
              desc: "\u5FAE\u4FE1\u5B98\u65B9\u660E\u786E\uFF1A\u4F1A\u5F15\u8D77\u903B\u8F91\u5C42\u4E0E\u6E32\u67D3\u5C42\u901A\u4FE1 \u2014\u2014 \u6846\u67B6**\u4EC5\u5728\u4F60\u58F0\u660E\u8FC7 onPageScroll \u65F6\u624D\u6D3E\u53D1**",
              descEn: "WeChat docs state this causes logical/render layer IPC \u2014 the framework dispatches it **only when you declared onPageScroll**"
            }
          ],
          web: [
            {
              title: "\u65E0\u539F\u751F\u4E0B\u62C9\u5237\u65B0 / \u65E0\u9875\u9762\u6808",
              titleEn: "No native pull-to-refresh / no page stack",
              desc: "\u6D4F\u89C8\u5668\u6CA1\u6709\u4E0B\u62C9\u5237\u65B0\u4E0E\u9875\u9762\u6808\u6982\u5FF5\u2014\u2014`onPullDownRefresh` \u4E0D\u4F1A\u89E6\u53D1\uFF08\u8BDA\u5B9E\u964D\u7EA7\uFF09\uFF0C\u8FD4\u56DE\u884C\u4E3A\u7531 history \u63D0\u4F9B",
              descEn: "No pull-to-refresh or page stack in browsers \u2014 `onPullDownRefresh` never fires (honest degradation); back navigation comes from history",
              roadmap: "\u9875\u9762\u6808\u8BED\u4E49\uFF08push/pop/popTo\uFF09\u5C5E\u8DEF\u7531\u5C42\uFF08router\uFF09\u804C\u8D23\uFF0C\u4E0D\u5728\u672C\u80FD\u529B\u5185\u91CD\u5EFA",
              roadmapEn: "Page-stack semantics (push/pop/popTo) belong to the router layer, not rebuilt here"
            },
            {
              title: "beforeunload \u7684\u8BED\u4E49\u5DEE\u5F02",
              titleEn: "beforeunload semantics",
              desc: '\u8FD4\u56DE\u503C\u7528\u4E8E**\u79BB\u5F00\u786E\u8BA4**\uFF08\u6D4F\u89C8\u5668\u4E0D\u6301\u4E45\u5316\u72B6\u6001\uFF09\u2014\u2014\u4E0E\u5C0F\u7A0B\u5E8F onSaveExitState \u7684"\u4FDD\u5B58\u72B6\u6001"\u8BED\u4E49\u4E0D\u540C',
              descEn: "The return value drives **leave confirmation** (browsers do not persist state) \u2014 unlike Mini Program onSaveExitState which saves state"
            },
            {
              title: "\u6EDA\u52A8\u7531 rAF \u8282\u6D41",
              titleEn: "Scroll is rAF-throttled",
              desc: "\u6D4F\u89C8\u5668 scroll \u9891\u7387\u8FDC\u9AD8\u4E8E\u5C0F\u7A0B\u5E8F \u2014\u2014 \u6846\u67B6\u5728 rAF \u91CC\u5408\u5E76\u672C\u5E27\u591A\u6B21\u6EDA\u52A8\u540E\u624D\u6D3E\u53D1",
              descEn: "Browser scroll fires far more often than Mini Programs \u2014 the framework coalesces bursts into one dispatch per rAF"
            }
          ],
          app: [
            {
              title: "\u5C4F\u7684\u53EF\u89C1\u6027\u7531\u865A\u62DF\u6808\u9A71\u52A8",
              titleEn: "Visibility driven by the virtual stack",
              desc: "\u9875\u9762 show/hide \u6765\u81EA\u865A\u62DF\u6808\u7684 enter/exit \u547D\u4EE4\uFF08\u4E0D\u662F\u539F\u751F Fragment/VC \u56DE\u8C03\uFF09\u2014\u2014 G-39 + M5 \u7684\u7EC4\u5408\u5F62\u6001",
              descEn: "Page show/hide comes from virtual-stack enter/exit commands (not native Fragment/VC callbacks) \u2014 the G-39 + M5 combination"
            },
            {
              title: "\u8F6C\u573A\u7ED3\u675F\u7531 Morpheus \u544A\u77E5",
              titleEn: "Transition completion via Morpheus",
              desc: "route-done \u5728\u5185\u6838\u8F6C\u573A\u52A8\u753B\u7ED3\u675F\u65F6\u89E6\u53D1\uFF08\u5E73\u53F0\u96F6\u53C2\u4E0E\u8DEF\u5F84\uFF09\u2014\u2014 \u4E0E\u5C0F\u7A0B\u5E8F onRouteDone \u540C\u8BED\u4E49",
              descEn: "route-done fires when the kernel transition animation finishes (platform-zero path) \u2014 same semantics as Mini Program onRouteDone"
            }
          ]
        },
        // ── C51 热更新：各平台的更新通道 ──
        update: {
          mp: [
            {
              title: "\u5C0F\u7A0B\u5E8F\u70ED\u66F4\u65B0\uFF08\u9759\u9ED8\uFF09",
              titleEn: "Mini Program silent update",
              desc: "wx.getUpdateManager \u4E0B\u8F7D\u65B0\u7248\u672C\u5E76\u5728\u4E0B\u6B21\u51B7\u542F\u52A8\u751F\u6548\uFF08onUpdateReady \u2192 applyUpdate\uFF09\uFF1B\u65E0\u5BA1\u6838\u3001\u65E0\u9700\u53D1\u7248",
              descEn: "wx.getUpdateManager downloads the new bundle and applies it on next cold start (onUpdateReady \u2192 applyUpdate); no review, no release"
            }
          ],
          web: [
            {
              title: "Service Worker \u66F4\u65B0",
              titleEn: "Service Worker update flow",
              desc: "SW \u68C0\u6D4B\u5230\u65B0\u7248\u672C\u540E\u8FDB\u5165 waiting\uFF1BapplyUpdate \u53D1 skipWaiting \u6FC0\u6D3B\uFF0C\u9875\u9762 reload \u540E\u6362\u88C5",
              descEn: "A new SW version goes to waiting; applyUpdate sends skipWaiting to activate, the new version takes effect after reload"
            }
          ],
          app: [
            {
              title: "\u539F\u751F\u66F4\u65B0\uFF08\u5546\u5E97 / \u5185\u66F4\u65B0\uFF09",
              titleEn: "Native update (store / in-app)",
              desc: "\u58F3\u8F6C\u53D1\u539F\u751F\u66F4\u65B0\u6D41\u7A0B\u2014\u2014iOS \u8D70 App Store\u3001Android \u8D70 Play Core In-App Updates\uFF08\u9759\u9ED8\u66F4\u65B0\u53D7\u5E73\u53F0\u7B56\u7565\u9650\u5236\uFF09",
              descEn: "The shell forwards the native update flow \u2014 App Store on iOS, Play Core In-App Updates on Android (silent updates are limited by platform policy)",
              hooks: [],
              roadmap: "\u58F3\u5B9E\u73B0 `update.check` / `update.apply` \u540E\u672C\u7AEF\u53EF\u7528\uFF08\u672A\u5B9E\u73B0\u65F6\u8BDA\u5B9E\u8FD4\u56DE unsupported\uFF09",
              roadmapEn: "Available once the shell implements `update.check` / `update.apply` (honest unsupported otherwise)"
            }
          ]
        },
        // ── C74 窗口管理：各平台的窗体能力 ──
        window: {
          mp: [
            {
              title: "wx.setWindowSize\uFF08PC \u7AEF\uFF09",
              titleEn: "wx.setWindowSize (PC only)",
              desc: "\u4EC5\u5FAE\u4FE1 PC \u7AEF\u652F\u6301\u8BBE\u7F6E\u7A97\u53E3\u5C3A\u5BF8\uFF1B\u79FB\u52A8\u7AEF\u65E0\u6B64 API\uFF08\u8BDA\u5B9E Err\uFF09",
              descEn: "Only WeChat on PC supports setting the window size; mobile has no such API (honest Err)"
            }
          ],
          web: [
            {
              title: "\u6D4F\u89C8\u5668\u7A97\u53E3\u5C3A\u5BF8\u53D7\u9650",
              titleEn: "Browser window sizing is restricted",
              desc: "window.resizeTo \u4EC5\u5BF9\u811A\u672C\u6253\u5F00\u7684\u5F39\u51FA\u7A97\u53E3\u6709\u6548\u2014\u2014\u666E\u901A\u9875\u7B7E\u65E0\u6CD5\u6539\u5C3A\u5BF8\uFF08\u8BDA\u5B9E Err\uFF0C\u4E0D\u5047\u88C5\u6210\u529F\uFF09",
              descEn: "window.resizeTo only works on script-opened popups \u2014 regular tabs cannot resize (honest Err, never fake success)"
            }
          ],
          app: [
            {
              title: "\u539F\u751F\u7A97\u53E3\u7BA1\u7406\uFF08\u5206\u5C4F / \u6298\u53E0\u5C4F / \u684C\u9762\uFF09",
              titleEn: "Native window management (split view / foldable / desktop)",
              desc: "iPad \u5206\u5C4F\u3001\u6298\u53E0\u5C4F\u591A\u7A97\u53E3\u3001\u684C\u9762\u7AEF\u81EA\u7531\u7F29\u653E\u2014\u2014\u58F3\u8F6C\u53D1\u539F\u751F\u7A97\u53E3 API\uFF08iOS UIWindowScene / Android WindowManager\uFF09",
              descEn: "iPad split view, foldable multi-window, desktop free resizing \u2014 the shell forwards native window APIs (iOS UIWindowScene / Android WindowManager)",
              roadmap: "\u58F3\u5B9E\u73B0 `window.setSize` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `window.setSize`"
            },
            {
              title: "\u5C3A\u5BF8\u53D8\u5316\u901A\u77E5",
              titleEn: "Size-change notifications",
              desc: "\u7A97\u53E3\u5C3A\u5BF8\u53D8\u5316\u7ECF app:resize \u4E8B\u4EF6\u9001\u8FBE\uFF08\u65E0\u9700\u8F6E\u8BE2\uFF09\u2014\u2014\u5206\u5C4F/\u65CB\u8F6C\u65F6\u4E1A\u52A1\u53EF\u91CD\u6392\u5E03\u5C40",
              descEn: "Size changes arrive via the app:resize event (no polling) \u2014 re-layout on split view / rotation",
              hooks: ["useBackground"]
            }
          ]
        },
        // ── C53 Worker：各平台的后台线程 ──
        worker: {
          mp: [
            {
              title: "wx.createWorker\uFF08\u771F\u7EBF\u7A0B\uFF09",
              titleEn: "wx.createWorker (real thread)",
              desc: "\u5C0F\u7A0B\u5E8F\u591A\u7EBF\u7A0B Worker\uFF1A\u72EC\u7ACB JS \u4E0A\u4E0B\u6587\uFF0CpostMessage \u901A\u4FE1\u2014\u2014\u9700\u5728 app.json \u58F0\u660E worker \u76EE\u5F55",
              descEn: "Mini Program multithread Worker: an isolated JS context communicating via postMessage \u2014 declare the worker dir in app.json"
            }
          ],
          web: [
            {
              title: "Web Worker\uFF08\u771F\u7EBF\u7A0B\uFF09",
              titleEn: "Web Worker (real thread)",
              desc: "new Worker(url) \u72EC\u7ACB\u7EBF\u7A0B\uFF1BonMessage \u53EF\u7528 removeEventListener \u53D6\u6D88\uFF08\u6BD4 MP \u66F4\u5B8C\u6574\uFF09",
              descEn: "new Worker(url) runs on a separate thread; onMessage can be unsubscribed via removeEventListener (more complete than MP)"
            },
            {
              title: "\u8DE8\u7EBF\u7A0B\u6570\u636E\u9650\u5236",
              titleEn: "Cross-thread data limits",
              desc: "\u7ED3\u6784\u5316\u514B\u9686\uFF08\u975E\u5F15\u7528\u4F20\u9012\uFF09\uFF1B\u5927\u5BF9\u8C61\u5EFA\u8BAE Transferable\uFF08ArrayBuffer \u8F6C\u79FB\u6240\u6709\u6743\uFF0C\u96F6\u62F7\u8D1D\uFF09",
              descEn: "Structured clone (no reference sharing); use Transferables for large payloads (ArrayBuffer ownership transfer, zero copy)"
            }
          ],
          app: [
            {
              title: "\u58F3\u540E\u53F0\u7EBF\u7A0B\uFF08G-39 runOnThread\uFF09",
              titleEn: "Shell background threads (G-39 runOnThread)",
              desc: 'App \u7AEF\u7684"\u7EBF\u7A0B"\u7531\u5BBF\u4E3B\u8FD0\u884C\u65F6\u63D0\u4F9B\uFF08G-39 \u552F\u4E00\u62E5\u6709\uFF09\u2014\u2014\u6865\u7ECF\u58F3\u521B\u5EFA\uFF0C\u4E1A\u52A1\u4E0D\u76F4\u63A5\u5EFA\u7EBF\u7A0B',
              descEn: 'App-side "threads" come from the host runtime (G-39 single ownership) \u2014 the bridge creates them via the shell; business code never spawns threads directly',
              roadmap: "\u58F3\u5B9E\u73B0 `worker.create/post/terminate` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `worker.create/post/terminate`"
            }
          ]
        },
        // ── C75 导航卸载拦截 ──
        "navigation-guard": {
          mp: [
            {
              title: "wx.enableAlertBeforeUnload",
              titleEn: "wx.enableAlertBeforeUnload",
              desc: '\u8FD4\u56DE\u65F6\u5F39\u51FA\u786E\u8BA4\u6846\uFF08\u9632\u8BEF\u9000\u4E22\u8349\u7A3F\uFF09\u2014\u2014\u9700\u57FA\u7840\u5E93 2.12.0+\uFF1B\u4EC5\u62E6\u622A"\u8FD4\u56DE"\uFF0C\u4E0D\u62E6\u622A"\u5173\u95ED\u5C0F\u7A0B\u5E8F"',
              descEn: "Shows a confirm dialog on back navigation (guards unsaved drafts) \u2014 base library 2.12.0+; intercepts back only, not app close"
            }
          ],
          web: [
            {
              title: "beforeunload \u7684\u6D4F\u89C8\u5668\u9650\u5236",
              titleEn: "Browser limits on beforeunload",
              desc: '\u6D4F\u89C8\u5668\u53EA\u5141\u8BB8"\u8BE2\u95EE\u662F\u5426\u79BB\u5F00"\uFF0C**\u4E0D\u80FD\u81EA\u5B9A\u4E49\u6587\u6848**\uFF08\u73B0\u4EE3\u6D4F\u89C8\u5668\u5F3A\u5236\u663E\u793A\u901A\u7528\u63D0\u793A\uFF09',
              descEn: 'Browsers only allow "are you sure you want to leave" and **cannot show custom text** (modern browsers force a generic prompt)'
            }
          ],
          app: [
            {
              title: "\u865A\u62DF\u6808 pop \u62E6\u622A\uFF08\u6846\u67B6\u5185\u5B8C\u6210\uFF09",
              titleEn: "Virtual-stack pop interception (in-framework)",
              desc: "\u2605App \u7AEF\u65E0\u9700\u539F\u751F API\uFF1A\u865A\u62DF\u6808\u7684 pop \u662F\u6846\u67B6\u81EA\u5DF1\u7684\u547D\u4EE4\uFF08M5\uFF09\u21D2 \u62E6\u622A\u5728\u6846\u67B6\u5185\u5B8C\u6210\uFF0C\u53EF\u81EA\u5B9A\u4E49\u5F39\u5C42\u4E0E\u6587\u6848",
              descEn: "\u2605No native API needed on App: virtual-stack pop is the framework's own command (M5) \u2014 interception happens in-framework with custom dialogs and copy",
              hooks: ["usePageLifecycle"]
            },
            {
              title: "Android \u7269\u7406\u8FD4\u56DE\u952E",
              titleEn: "Android hardware back key",
              desc: "\u5B9E\u4F53/\u624B\u52BF\u8FD4\u56DE\u540C\u6837\u7ECF\u6808 pop \u6D3E\u53D1\u2014\u2014\u4E0E UI \u8FD4\u56DE\u4E00\u81F4\uFF08\u58F3\u8D1F\u8D23\u628A onBackPressed \u8F6C\u6210\u865A\u62DF\u6808 pop\uFF09",
              descEn: "Hardware/gesture back dispatches through the same stack pop \u2014 consistent with UI back (the shell maps onBackPressed to a virtual-stack pop)",
              roadmap: "\u58F3\u63A5\u7EBF onBackPressed \u2192 \u6808 pop \u540E\u751F\u6548",
              roadmapEn: "Effective once the shell wires onBackPressed to a stack pop"
            }
          ]
        },
        // ── C82 WebAssembly ──
        webassembly: {
          mp: [
            {
              title: "WXWebAssembly\uFF08\u8DEF\u5F84\u52A0\u8F7D\uFF09",
              titleEn: "WXWebAssembly (path load)",
              desc: "\u2605\u53EA\u80FD\u4ECE**\u4EE3\u7801\u5305\u8DEF\u5F84**\u52A0\u8F7D\uFF08.wasm / .wasm.br\uFF09\u2014\u2014\u4E0D\u652F\u6301\u5B57\u8282/\u6D41\u5F0F\u7F16\u8BD1\uFF08\u80FD\u529B\u4F4D supportsStreaming=false\uFF09",
              descEn: "\u2605Loads only from **code-package paths** (.wasm / .wasm.br) \u2014 no byte/streaming compilation (capability flag supportsStreaming=false)"
            }
          ],
          web: [
            {
              title: "\u6807\u51C6 WebAssembly\uFF08\u6D41\u5F0F\uFF09",
              titleEn: "Standard WebAssembly (streaming)",
              desc: "instantiateStreaming \u8FB9\u4E0B\u8FB9\u7F16\u8BD1\uFF08\u6BD4\u5148\u4E0B\u8F7D\u518D\u7F16\u8BD1\u66F4\u5FEB\uFF09\uFF1Bcompile/validate \u5168\u53EF\u7528",
              descEn: "instantiateStreaming compiles while downloading (faster than download-then-compile); compile/validate fully available"
            }
          ],
          app: [
            {
              title: "JSC / QuickJS \u5185\u7F6E WASM",
              titleEn: "WASM built into JSC / QuickJS",
              desc: "App \u7AEF JS \u5F15\u64CE\uFF08iOS JavaScriptCore / Android QuickJS\uFF09\u5747\u5185\u7F6E WebAssembly\u2014\u2014\u4E0E Web \u540C\u5F62\uFF08\u5B57\u8282\u52A0\u8F7D + \u6D41\u5F0F\u80FD\u529B\u4F4D\u968F\u5F15\u64CE\uFF09",
              descEn: "App JS engines (JavaScriptCore on iOS / QuickJS on Android) ship WebAssembly \u2014 same shape as Web (byte loading; streaming flag follows the engine)"
            }
          ]
        },
        // ── C47 跳其他小程序 ──
        "mini-program": {
          mp: [
            {
              title: "wx.navigateToMiniProgram",
              titleEn: "wx.navigateToMiniProgram",
              desc: "\u8DF3\u8F6C\u5230\u5176\u5B83\u5C0F\u7A0B\u5E8F\uFF08\u9700\u5728 app.json \u58F0\u660E navigateToMiniProgramAppIdList\u2014\u2014\u767D\u540D\u5355\u4E0A\u9650 10\uFF09",
              descEn: "Jump to another Mini Program (declare navigateToMiniProgramAppIdList in app.json \u2014 up to 10 entries)"
            }
          ],
          web: [
            {
              title: "\u65E0\u8DE8\u5C0F\u7A0B\u5E8F\u6982\u5FF5",
              titleEn: "No cross-mini-program concept",
              desc: 'Web \u6CA1\u6709"\u8DF3\u5176\u4ED6\u5C0F\u7A0B\u5E8F"\u2014\u2014\u7528 window.open / \u524D\u7AEF\u8DEF\u7531\u66FF\u4EE3\uFF08\u8BDA\u5B9E Err \u4E14\u7ED9\u51FA\u8DEF\uFF09',
              descEn: 'The Web has no "jump to another Mini Program" \u2014 use window.open / client routing instead (honest Err with guidance)'
            }
          ],
          app: [
            {
              title: "App \u95F4\u8DF3\u8F6C\uFF08URL Scheme / Universal Link\uFF09",
              titleEn: "App-to-app jumps (URL Scheme / Universal Link)",
              desc: 'App \u7AEF\u5BF9\u5E94"\u8DF3\u5176\u4ED6\u5E94\u7528"\u2014\u2014iOS Universal Link\u3001Android Intent\uFF1B\u9700\u76EE\u6807\u5E94\u7528\u58F0\u660E\u53EF\u88AB\u5524\u8D77',
              descEn: "The App counterpart: jumping to another app via iOS Universal Links or Android Intents; the target must declare itself launchable",
              roadmap: "\u58F3\u5B9E\u73B0 `mini-program.navigate` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `mini-program.navigate`"
            }
          ]
        },
        // ── C48 被宿主嵌入 ──
        embedded: {
          mp: [
            {
              title: '\u65E0"\u88AB\u5D4C\u5165"\u5F62\u6001',
              titleEn: 'No "embedded" form',
              desc: '\u5C0F\u7A0B\u5E8F\u603B\u662F\u8FD0\u884C\u5728\u5FAE\u4FE1\u5BBF\u4E3B\u5185\uFF08\u4E0D\u5B58\u5728"\u88AB\u522B\u7684 App \u5D4C\u5165"\uFF09\u2014\u2014provider \u6052\u4E3A weixin',
              descEn: "Mini Programs always run inside the WeChat host (never embedded by another app) \u2014 provider is always weixin"
            }
          ],
          web: [
            {
              title: "iframe \u5D4C\u5165\u4E0E\u7236\u7A97\u53E3",
              titleEn: "iframe embedding & parent window",
              desc: 'Web \u7684"\u88AB\u5D4C\u5165"= iframe\u2014\u2014provider=web\uFF0C\u7236\u7A97\u53E3\u7ECF window.parent \u53EF\u8FBE\uFF08\u8DE8\u57DF\u65F6\u53D7\u9650\uFF09',
              descEn: "Web embedding means iframe \u2014 provider=web, the parent is reachable via window.parent (restricted cross-origin)"
            }
          ],
          app: [
            {
              title: "\u88AB\u5BBF\u4E3B App \u5D4C\u5165\uFF08\u6838\u5FC3\u573A\u666F\uFF09",
              titleEn: "Embedded in a host App (the core scenario)",
              desc: 'App \u7AEF"\u88AB\u5D4C\u5165"\u662F\u4E00\u7B49\u573A\u666F\uFF08AAR / \u9759\u6001\u5E93\u96C6\u6210\uFF09\u2014\u2014\u5BBF\u4E3B\u7ECF `__PROTEUS_HOST_ID__` \u81EA\u8FF0\u8EAB\u4EFD\uFF0C\u4E1A\u52A1\u636E\u6B64\u5B9A\u5236\u884C\u4E3A',
              descEn: "On App, embedding is a first-class scenario (AAR / static-lib integration) \u2014 the host identifies itself via `__PROTEUS_HOST_ID__` so business code can adapt"
            }
          ]
        },
        // ── C50 扩展加载 ──
        extension: {
          mp: [
            {
              title: "\u65E0\u63D2\u4EF6\u52A0\u8F7D API",
              titleEn: "No plugin-loading API",
              desc: "\u5C0F\u7A0B\u5E8F\u7AEF\u4E0D\u80FD\u8FD0\u884C\u65F6\u52A0\u8F7D\u5916\u90E8\u4EE3\u7801\u2014\u2014\u9700\u5BBF\u4E3B\u6269\u5C55\u58F3\uFF08\u540C\u5C42\u6E32\u67D3 / \u52A8\u6001\u7EC4\u4EF6\uFF09\u627F\u63A5\uFF0C\u89C1 docs/proteus-platform-plan",
              descEn: "Mini Programs cannot load external code at runtime \u2014 a host extension shell (same-layer rendering / dynamic components) is required, see docs/proteus-platform-plan"
            }
          ],
          web: [
            {
              title: "\u52A8\u6001 import()",
              titleEn: "Dynamic import()",
              desc: "\u8FD0\u884C\u65F6\u52A0\u8F7D ES \u6A21\u5757\uFF08\u771F\u5B9E\u5B9E\u73B0\uFF09\uFF1B\u53EA\u63A5\u53D7\u6A21\u5757 URL\uFF08\u76F8\u5BF9/\u7EDD\u5BF9/http(s)\uFF09\u2014\u2014\u4E0D\u900F\u4F20\u88F8\u6807\u8BC6\u7B26",
              descEn: "Loads ES modules at runtime (a real implementation); accepts module URLs only (relative/absolute/http(s)) \u2014 bare specifiers are rejected"
            }
          ],
          app: [
            {
              title: "\u58F3\u52A8\u6001\u88C5\u8F7D\u539F\u751F\u6A21\u5757\uFF08G-45 \u540C\u673A\u5236\uFF09",
              titleEn: "Shell-loaded native modules (same mechanism as G-45)",
              desc: "App \u7AEF\u53EF\u52A8\u6001\u88C5\u8F7D\u539F\u751F\u6A21\u5757\uFF08Android DexClassLoader / iOS \u52A8\u6001\u5E93\uFF09\u2014\u2014\u4E0E\u8C03\u8BD5\u57FA\u5EA7\u7684\u63D2\u4EF6\u88C5\u8F7D\u540C\u673A\u5236",
              descEn: "Apps can dynamically load native modules (Android DexClassLoader / iOS dynamic libraries) \u2014 the same mechanism as dev-host plugin loading",
              roadmap: "\u58F3\u5B9E\u73B0 `extension.load` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `extension.load`"
            }
          ]
        },
        // ── C67 预加载 ──
        preload: {
          mp: [
            {
              title: "wx.preload* \u5BB6\u65CF",
              titleEn: "wx.preload* family",
              desc: "preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage\u2014\u2014\u5404\u81EA\u9884\u70ED\u4E00\u79CD\u8D44\u6E90",
              descEn: "preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage \u2014 each warms a different resource kind"
            }
          ],
          web: [
            {
              title: "link rel=preload",
              titleEn: "link rel=preload",
              desc: "Web \u65E0\u7EDF\u4E00\u9884\u52A0\u8F7D API\u2014\u2014\u7528 `<link rel=preload>` \u6216\u52A8\u6001 import \u9884\u70ED\uFF08\u672C\u6865\u8BDA\u5B9E Err \u5E76\u6307\u51FA\u66FF\u4EE3\uFF09",
              descEn: "The Web has no unified preload API \u2014 use `<link rel=preload>` or dynamic import (this bridge honestly errors and points to the alternatives)"
            }
          ],
          app: [
            {
              title: "\u58F3\u9884\u521D\u59CB\u5316\u6A21\u5757",
              titleEn: "Shell pre-initialized modules",
              desc: "App \u7AEF\u9884\u52A0\u8F7D = \u58F3\u63D0\u524D\u521D\u59CB\u5316\u539F\u751F\u6A21\u5757/\u5B57\u4F53/\u8D44\u6E90\uFF08\u628A\u9996\u6B21\u6210\u672C\u632A\u51FA\u9996\u5C4F\uFF09",
              descEn: "App preloading means the shell initializing native modules/fonts/resources ahead of time (moving first-use cost off the first screen)",
              roadmap: "\u58F3\u5B9E\u73B0 `preload.assets` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `preload.assets`"
            }
          ]
        },
        // ── C73 空闲回调 ──
        idle: {
          mp: [
            {
              title: "wx.requestIdleCallback",
              titleEn: "wx.requestIdleCallback",
              desc: "\u2605wx \u4E0D\u8FD4\u56DE id\uFF08\u56DE\u8C03\u5373\u6267\u884C\uFF09\u2014\u2014\u672C\u6865\u7528\u9012\u589E\u8BA1\u6570\u6A21\u62DF cancel \u53E5\u67C4\uFF08\u4E0E\u6D4F\u89C8\u5668\u5F62\u6001\u7684\u5DEE\u5F02\u89C1\u5B9E\u73B0\u6CE8\u91CA\uFF09",
              descEn: "\u2605wx returns no id (the callback runs immediately) \u2014 this bridge uses an incrementing counter to emulate a cancel handle"
            }
          ],
          web: [
            {
              title: "requestIdleCallback\uFF08\u539F\u751F\uFF09",
              titleEn: "requestIdleCallback (native)",
              desc: "\u6D4F\u89C8\u5668\u539F\u751F\u7A7A\u95F2\u56DE\u8C03\uFF08timeRemaining \u53CD\u6620\u771F\u5B9E\u5269\u4F59\u9884\u7B97\uFF09\uFF1BSafari \u652F\u6301\u8F83\u665A\u2014\u2014\u7F3A\u5931\u65F6\u8BDA\u5B9E Err",
              descEn: "Native browser idle callback (timeRemaining reflects the real budget); Safari support arrived late \u2014 honest Err when missing"
            }
          ],
          app: [
            {
              title: "\u58F3\u63D0\u4F9B\u7684\u7A7A\u95F2\u65F6\u673A",
              titleEn: "Shell-provided idle slots",
              desc: "App \u7AEF\u7684\u7A7A\u95F2\u65F6\u673A\u7531\u58F3\u51B3\u5B9A\uFF08\u5982\u5E27\u95F4\u7A7A\u9699\uFF09\u2014\u2014\u4F4E\u4F18\u5148\u7EA7\u4EFB\u52A1\uFF08\u65E5\u5FD7\u4E0A\u62A5/\u9884\u70ED\uFF09\u8D70\u8FD9\u91CC\uFF0C\u4E0D\u62A2\u9996\u5C4F",
              descEn: "Idle slots come from the shell (e.g. between frames) \u2014 low-priority work (log upload, warming) goes here without competing with the first screen",
              roadmap: "\u58F3\u5B9E\u73B0 `idle.request` / `idle.cancel` \u540E\u672C\u7AEF\u53EF\u7528",
              roadmapEn: "Available once the shell implements `idle.request` / `idle.cancel`"
            }
          ]
        },
        // ── C25 后台与环境：各平台的"环境事件" ──
        background: {
          mp: [
            {
              title: "\u5168\u5C40\u8BA2\u9605 API \u9762",
              titleEn: "Global subscription APIs",
              desc: "wx.onAppShow/onAppHide/onMemoryWarning/onThemeChange/onWindowResize/onError/onUnhandledRejection \u5747\u4E3A\u5168\u5C40\u8BA2\u9605\uFF08\u4E0E\u9875\u9762\u7EA7\u7684 Page \u94A9\u5B50\u673A\u5236\u4E0D\u540C\uFF09",
              descEn: "wx.onAppShow/Hide/MemoryWarning/ThemeChange/WindowResize/Error/UnhandledRejection are global subscriptions (unlike declarative Page hooks)"
            },
            {
              title: "\u542F\u52A8\u53C2\u6570\u8BFB\u53D6",
              titleEn: "Launch / enter options",
              desc: "getLaunchOptions\uFF08\u4E00\u6B21\u6027\uFF0C\u542F\u52A8\u65F6\uFF09\u4E0E getEnterOptions\uFF08\u6BCF\u6B21\u56DE\u524D\u53F0\uFF09\u2014\u2014 \u6DF1\u94FE\u53C2\u6570\u7684\u4E24\u79CD\u8BED\u4E49",
              descEn: "getLaunchOptions (once, at startup) and getEnterOptions (every foreground return) \u2014 deep-link params have two semantics here"
            }
          ],
          web: [
            {
              title: "visibilitychange \u4E3A\u552F\u4E00\u4FE1\u53F7",
              titleEn: "visibilitychange is the only signal",
              desc: "Web \u6CA1\u6709\u72EC\u7ACB\u7684 onAppShow/onAppHide \u2014\u2014 \u524D\u540E\u53F0\u4E0E\u5E94\u7528\u7EA7 resize \u90FD\u7531\u6D4F\u89C8\u5668\u4E8B\u4EF6\u63A8\u5BFC\uFF1B\u5185\u5B58\u8B66\u544A\u7528 performance.memory \u542F\u53D1\u5F0F",
              descEn: "No standalone onAppShow/onAppHide on Web \u2014 foreground/background and resize derive from browser events; memory warnings use a performance.memory heuristic"
            },
            {
              title: "\u4E0B\u8F7D\u9884\u9632\u7684\u79BB\u5F00\u786E\u8BA4",
              titleEn: "Leave confirmation for unsaved work",
              desc: "\u4E0E usePageLifecycle \u7684 save-exit-state \u5171\u7528 beforeunload \u901A\u9053\uFF08\u672C\u80FD\u529B\u8D1F\u8D23\u73AF\u5883\u4E8B\u4EF6\uFF0C\u79BB\u5F00\u786E\u8BA4\u5728\u9875\u9762\u5C42\uFF09",
              descEn: "Shares the beforeunload channel with usePageLifecycle save-exit-state (this capability owns environment events; leave confirmation lives at the page layer)"
            }
          ],
          app: [
            {
              title: "\u4E1A\u52A1\u6B04\u7684\u524D\u540E\u53F0\u8F6C\u53D1",
              titleEn: "Foreground/background forwarding",
              desc: "Activity.onResume/onPause\uFF08iOS didBecomeActive/willResignActive\uFF09\u7531\u58F3\u8F6C\u53D1 \u2014\u2014 \u4E0E useAppLifecycle \u7684 launch/show/hide \u662F**\u540C\u4E00\u7EC4\u4E8B\u4EF6**\uFF0C\u672C\u80FD\u529B\u591A\u4E86\u73AF\u5883\u9762",
              descEn: "Activity.onResume/onPause (iOS didBecomeActive/willResignActive) forwarded by the shell \u2014 the same events as useAppLifecycle launch/show/hide, plus the environment surface here"
            },
            {
              title: "\u5185\u5B58\u538B\u529B\u4E0E\u56DE\u6536",
              titleEn: "Memory pressure & reclamation",
              desc: "iOS didReceiveMemoryWarning / Android onTrimMemory \u2014\u2014 \u4E0E G-43 \u6240\u6709\u6743 Drop \u534F\u8BAE\u914D\u5408\u91CA\u653E\u7F13\u5B58",
              descEn: "iOS didReceiveMemoryWarning / Android onTrimMemory \u2014 pairs with the G-43 ownership Drop protocol to release caches"
            },
            {
              title: "\u7CFB\u7EDF\u4E3B\u9898\u4E0E\u5206\u5C4F",
              titleEn: "System theme & split view",
              desc: "\u6DF1\u8272\u6A21\u5F0F\u5207\u6362\u4E0E\u7A97\u53E3\u5C3A\u5BF8\u53D8\u5316\u7531\u58F3\u8F6C\u53D1\uFF08\u5E73\u677F/\u6298\u53E0\u5C4F\u4E0A\u5206\u5C4F\u9891\u7E41\uFF09",
              descEn: "Dark-mode switches and window-size changes forwarded by the shell (split view is frequent on tablets/foldables)"
            }
          ]
        }
      };
      PLATFORM_TOPIC_ORDER = ["mp", "web", "app"];
      APP_EVENT_KEY = "__proteusHostAppEvent";
      try {
        installAppEventSource(getHostLifecycleBus());
      } catch {
      }
      HOST_LIFECYCLE_BUS_KEY = "__proteusHostLifecycleBus";
      HOST_ID_KEY = "__PROTEUS_HOST_ID__";
    }
  });

  // packages/render-backend/src/quickjs-host.ts
  function createQuickJsHostRuntime(opts = {}) {
    const id = opts.id ?? "quickjs";
    const capabilities = {
      threads: { main: true, background: false, count: 1 },
      // ★诚实声明：无后台线程
      engine: opts.engine ?? "quickjs",
      // 桥**机制**恒在（registerNativeHandler/invokeNative/拒绝协议都存在）；transport 是可选出口
      nativeBridge: true,
      lifecycle: "full",
      // 宿主壳转发 onPause/onResume ⇒ full
      frameDriver: opts.frameDriver ?? "manual"
    };
    const refusals = [];
    const lifecycleEvents = [];
    const handlers = /* @__PURE__ */ new Map();
    const refuse = (op, reason) => {
      refusals.push({ op, reason, state: rt.state });
      throw new Error(`[${id}] \u804C\u8D23\u8FB9\u754C\u62D2\u7EDD ${op}\uFF1A${reason}\uFF08state=${rt.state}\uFF09`);
    };
    const rt = {
      id,
      state: "created",
      threads: ["main"],
      workers: [],
      queue: [],
      capabilities,
      lifecycleEvents,
      refusals,
      nativeHandlers: [],
      bootstrap() {
        if (rt.state === "destroyed") refuse("bootstrap", "\u5DF2\u9500\u6BC1\u7684\u8FD0\u884C\u65F6\u4E0D\u53EF\u590D\u6D3B\uFF08G-39.1\uFF1A\u751F\u547D\u5468\u671F\u552F\u4E00\u62E5\u6709\uFF09");
        if (rt.state === "suspended") refuse("bootstrap", "\u5DF2\u6302\u8D77\u72B6\u6001\u4E0B\u8BF7\u7528 resume()\uFF08bootstrap \u53EA\u8D1F\u8D23 created \u8D77\u6B65\uFF09");
        rt.state = "running";
        return rt;
      },
      suspend() {
        if (rt.state !== "running") refuse("suspend", "\u4EC5 running \u53EF\u6302\u8D77\uFF08\u91CD\u590D suspend / \u672A bootstrap \u90FD\u88AB\u62D2\u7EDD\uFF09");
        rt.state = "suspended";
        lifecycleEvents.push("suspend");
      },
      resume() {
        if (rt.state !== "suspended") refuse("resume", '\u4EC5 suspended \u53EF\u6062\u590D\uFF08\u9632"\u6CA1\u6302\u8D77\u8FC7\u5374\u4E0A\u62A5 resume"\u7684\u5047\u4E8B\u4EF6\uFF09');
        rt.state = "running";
        lifecycleEvents.push("resume");
      },
      destroy() {
        if (rt.state === "destroyed") refuse("destroy", "\u91CD\u590D\u9500\u6BC1\uFF08\u7B2C\u4E8C\u6B21 destroy \u901A\u5E38\u662F\u4E0A\u5C42\u7684\u91CD\u590D\u6E05\u7406\u2014\u2014\u771F\u5B9E\u7F3A\u9677\uFF09");
        rt.state = "destroyed";
        rt.queue = [];
        rt.workers = [];
        rt.threads = ["main"];
        lifecycleEvents.push("destroy");
      },
      createWorker() {
        if (rt.state === "destroyed") refuse("createWorker", "\u5DF2\u9500\u6BC1\u7684\u8FD0\u884C\u65F6\u4E0D\u80FD\u521B\u5EFA\u6267\u884C\u57DF");
        const w = {
          id: `w${rt.workers.length + 1}`,
          thread: `worker${rt.workers.length + 1}`,
          real: false
        };
        rt.workers.push(w);
        rt.threads.push(w.thread);
        return w;
      },
      postMessage() {
        return true;
      },
      enqueue(task, priority = 2) {
        if (rt.state === "destroyed") refuse("enqueue", "\u5DF2\u9500\u6BC1\u7684\u8FD0\u884C\u65F6\u4E0D\u518D\u63A5\u6536\u4EFB\u52A1\uFF08\u9632\u60AC\u7A7A\u56DE\u8C03\uFF09");
        rt.queue.push({ task, priority });
      },
      nextTick(fn) {
        if (rt.state === "destroyed") refuse("nextTick", "\u5DF2\u9500\u6BC1\u7684\u8FD0\u884C\u65F6\u4E0D\u518D\u63A5\u6536\u4EFB\u52A1");
        rt.queue.push({ task: fn, priority: 0 });
      },
      drain() {
        rt.queue.sort((a, b) => a.priority - b.priority);
        const out = [];
        while (rt.queue.length) {
          const { task } = rt.queue.shift();
          out.push(task());
        }
        return out;
      },
      /** ★宿主帧驱动（Android Choreographer / iOS CADisplayLink）：一帧消费一次队列 */
      pumpFrame() {
        if (rt.state === "destroyed") return 0;
        if (rt.state === "suspended") return 0;
        rt.queue.sort((a, b) => a.priority - b.priority);
        let n = 0;
        while (rt.queue.length) {
          const { task } = rt.queue.shift();
          task();
          n++;
        }
        return n;
      },
      registerNativeHandler(name, handler) {
        handlers.set(name, handler);
        rt.nativeHandlers.push(name);
      },
      runOnThread(thread, task) {
        if (thread === "main") {
          rt.enqueue(task, 2);
          return;
        }
        return refuse("runOnThread(background)", "\u672C\u5BBF\u4E3B capabilities.threads.background=false\uFF08\u5355\u7EBF\u7A0B JS \u5F15\u64CE\uFF1B\u8C03\u7528\u65B9\u5E94\u67E5 capabilities \u540E\u964D\u7EA7\uFF09");
      },
      async invokeNative(name, args) {
        if (rt.state === "destroyed") refuse("invokeNative", "\u5DF2\u9500\u6BC1\u7684\u8FD0\u884C\u65F6\u4E0D\u80FD\u8C03\u539F\u751F");
        const h = handlers.get(name);
        if (h) return h(args);
        if (opts.transport) {
          const json = opts.transport.call(name, JSON.stringify(args ?? null));
          try {
            return JSON.parse(json);
          } catch {
            return json;
          }
        }
        return refuse("invokeNative", `\u539F\u751F\u65B9\u6CD5\u300C${name}\u300D\u672A\u6CE8\u518C\u4E14\u65E0 transport\uFF08\u5DF2\u6CE8\u518C\uFF1A${rt.nativeHandlers.join(", ") || "\uFF08\u7A7A\uFF09"}\uFF09`);
      }
    };
    return rt;
  }

  // packages/component-ir/dist/index.js
  var TAG_SEMANTIC_MAP = {
    // G-32 ① 布局原语（12）
    "p-box": "layout.box",
    "p-inline": "layout.inline",
    "p-stack": "layout.stack",
    "p-grid": "layout.grid",
    // ★Skyline 线收口：'p-fluid' 移除——layout.fluid 是 v-p-fluid **指令**语义（非标签），登记为标签会让 <p-fluid> 静默不渲染
    "p-adaptive": "layout.adaptive",
    "p-fit": "layout.fit",
    "p-spacer": "layout.spacer",
    "p-divider": "layout.divider",
    "p-scroll": "layout.scroll",
    "p-virtual-list": "layout.virtual-list",
    "p-masonry": "layout.masonry",
    // G-32 ② UI 原语（18）
    "p-text": "ui.text",
    "p-heading": "ui.heading",
    "p-rich-text": "ui.rich-text",
    "p-icon": "ui.icon",
    "p-image": "ui.image",
    "p-avatar": "ui.avatar",
    "p-media": "ui.media",
    "p-canvas": "ui.canvas",
    "p-svg": "ui.svg",
    "p-input": "ui.input",
    "p-textarea": "ui.textarea",
    "p-select": "ui.select",
    "p-checkbox": "ui.checkbox",
    "p-radio": "ui.radio",
    "p-switch": "ui.switch",
    "p-slider": "ui.slider",
    "p-picker": "ui.picker",
    "p-form": "ui.form",
    "p-button": "ui.button",
    // 既有按钮
    // G-32 ③ Shell 原语（10）
    "p-page": "shell.page",
    "p-nav": "shell.nav",
    "p-tabbar": "shell.tabbar",
    "p-segment": "shell.segment",
    "p-drawer": "shell.drawer",
    "p-modal": "shell.modal",
    // ★★★GP4-c（2026-10-03）：登录失效拦截弹窗——与 p-modal **同语义**（模态弹窗）、
    //   **不同可取消性**（本组件不可取消：无关闭按钮/点遮罩不关；唯一出口是登录态恢复）。
    //   ★不登记 ⇒ 编译期按"未注册自定义组件"输出 ⇒ MP 端不渲染（M3 门禁会当场红）
    "p-auth-gate": "shell.modal",
    "p-popover": "shell.popover",
    "p-toast": "shell.toast",
    // ★★★GP4-a/b（2026-10-03）：两个**浮层宿主**同属其能力的语义（multi-tag 别名——同 ui.loading 的先例）。
    //   · p-toast-host：Toast 队列的渲染端（构建期按需注入）
    //   · p-loading-host：Loading 多实例的渲染端（同上）
    //   ★不登记 ⇒ 编译期按"未注册自定义组件"输出 ⇒ **MP 端不渲染**（M3 门禁当场抓出）
    "p-toast-host": "shell.toast",
    "p-action-sheet": "shell.action-sheet",
    "p-split": "layout.split",
    // ★已落地绑定（G-32 S10 分栏语义——layout.split 承载）
    // G-32 ④ Gesture 组件形态（2）
    "p-draggable": "gesture.draggable",
    "p-scrollable": "gesture.scrollable",
    // G-32 ⑥ Engineering 组件形态（3）
    "p-router-link": "engineering.router-link",
    // ★E18 组件形态（p- 前缀产 C-IR）
    "router-link": "engineering.router-link",
    // ★兼容别名（Vue Router 风格 <router-link> 标签；非 catalog 条目——p-view 先例 G-31 B4）
    "p-share-element": "engineering.share-element",
    // ★批次 8：页面间共享元素转场（≠ p-transition 页内过渡）
    "p-transition": "engineering.transition",
    "p-animate": "engineering.animate",
    // G-31 能力入口
    // ★2026-09-18 语义去重：原 capability.scan-qr / capability.pick-photo 是**重复名**——
    //   两个组件的实现分别调用 useQRCode() / useCamera()，对应真实能力即 C42 capability.qr-code /
    //   C1 capability.camera（其 mpEquiv 与 hook 完全一致）。故**退役重复名、重指向真实能力**，
    //   并按 E8 双形态在两行补 tag（而非新建语义）。
    "p-scan-qr": "capability.qr-code",
    "p-pick-photo": "capability.camera",
    "p-location": "capability.location",
    // ★G-31 B4 现有组件对齐（src/components 实际标签 → L1 语义）
    "p-view": "layout.box",
    // 原子容器 = p-box 角色
    "p-list-view": "ui.list",
    "p-nav-bar": "ui.nav",
    // ★G-31 B4 Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
    "p-safe": "layout.safe",
    "p-sidebar": "layout.sidebar",
    // ★#405 语义登记批：剩余 10 组件全量入图（EXTRA_KIND 文档兑底退役）——
    //   9 个新语义（catalog planned L2：语义层待多端映射）+ p-scroll-view 复用 layout.scroll
    //   （★2026-09-18 修正原文「p-view 先例」：显式 multi-tag 别名先例是上一行的 `router-link`
    //    ——同一语义由两个标签提供；本条与 p-view 是并列的别名情形，非「先例」关系）
    "p-aspect": "layout.aspect",
    "p-zone": "layout.zone",
    "p-formfactor": "layout.formfactor",
    // ★★Fluid System v2：柔性形态容器
    "p-loading": "ui.loading",
    // ★★★GP4-b（2026-10-03）：Loading **多实例宿主**与**区域遮罩**同属 ui.loading 语义（multi-tag 别名，
    //   与上一行 `router-link`/`p-view` 的"同一语义多标签"同款）。
    //   · p-loading-host：命令式多实例的渲染端（由构建期按需注入——用户一般不手写）
    //   · p-loading-region：区域遮罩（就地包裹，用户手写）
    //   ★不登记 ⇒ 编译期按"未注册自定义组件"输出 ⇒ MP 端不渲染（M3 门禁当场抓出——它是对的）
    "p-loading-host": "ui.loading",
    "p-loading-region": "ui.loading",
    "p-scale": "ui.scale",
    "p-skeleton": "ui.skeleton",
    "p-mask": "shell.mask",
    "p-popup": "shell.popup",
    "p-toolbar": "shell.toolbar",
    "p-scroll-view": "layout.scroll",
    // 滚动容器 = p-scroll 角色
    "p-error-boundary": "engineering.error-boundary",
    // E8 原语组件形态（useErrorBoundary API 形态并存）
    // ★能力颗粒度对齐 C2：新增真实组件
    "p-progress": "ui.progress",
    "p-label": "ui.label",
    "p-page-container": "shell.page-container",
    // ★权威标尺批 H：选区 / 键盘工具栏
    "p-selection": "ui.selection",
    "p-keyboard-accessory": "shell.keyboard-accessory",
    // ★权威标尺批 I：相机
    "p-camera": "ui.camera",
    // ★权威标尺批 J：内嵌网页 / 广告位
    "p-webview": "shell.webview",
    "p-ad": "shell.ad",
    "p-map": "ui.map"
  };
  function toComponentIR(tag, props = {}, children = []) {
    if (!tag.startsWith("p-")) return null;
    const semantic = TAG_SEMANTIC_MAP[tag];
    if (!semantic) return null;
    return { tag, semantic, props: { ...props }, children };
  }
  var LAYOUT = [
    { id: "L1", kind: "layout", semantic: "layout.box", tag: "p-box", props: ["aspectRatio", "overflow", "hoverClass", "hoverStopPropagation", "hoverStartTime", "hoverStayTime"], mpEquiv: "<view>", tier: "L1", status: "implemented" },
    { id: "L2", kind: "layout", semantic: "layout.inline", tag: "p-inline", props: ["wrap"], mpEquiv: "<text> \u5185\u8054", tier: "L1", status: "implemented" },
    { id: "L3", kind: "layout", semantic: "layout.stack", tag: "p-stack", props: ["direction", "gap", "align", "wrap", "snap", "loop"], mpEquiv: "flex + scroll-view + swiper", tier: "L1", status: "implemented" },
    { id: "L4", kind: "layout", semantic: "layout.grid", tag: "p-grid", props: ["minColWidth", "maxCols", "gap", "autoFlow"], mpEquiv: "<view> + CSS Grid", tier: "L1", status: "implemented" },
    // ★Skyline 线收口：layout.fluid 由 v-p-fluid **指令**承载（非标签）——无 tag，避免 <p-fluid> 幽灵
    { id: "L5", kind: "layout", semantic: "layout.fluid", props: ["breakpoints", "minItemWidth"], mpEquiv: "\u54CD\u5E94\u5F0F CSS\uFF08v-p-fluid \u6307\u4EE4\uFF09", tier: "L1", status: "implemented" },
    { id: "L6", kind: "layout", semantic: "layout.adaptive", tag: "p-adaptive", props: ["sheet", "dialog", "popover", "drawer"], mpEquiv: "\u65E0\uFF08\u5BB9\u5668\u5BBD\u5EA6\u8BED\u4E49\u65AD\u70B9\uFF09", tier: "L1", status: "implemented" },
    { id: "L7", kind: "layout", semantic: "layout.fit", tag: "p-fit", props: ["mode"], mpEquiv: "fit-content", tier: "L1", status: "implemented" },
    { id: "L8", kind: "layout", semantic: "layout.spacer", tag: "p-spacer", props: ["grow", "shrink"], mpEquiv: "flex:1", tier: "L1", status: "implemented" },
    { id: "L9", kind: "layout", semantic: "layout.divider", tag: "p-divider", props: ["orientation", "inset"], mpEquiv: "<view> + border", tier: "L1", status: "implemented" },
    { id: "L10", kind: "layout", semantic: "layout.scroll", tag: "p-scroll", props: ["axis", "paging", "refresh", "indicator", "upperThreshold", "lowerThreshold", "scrollIntoView", "scrollWithAnimation", "enableBackToTop", "enablePassive", "refresherEnabled", "refresherTriggered", "enhanced", "bounces", "scrollAnchoring", "padding"], mpEquiv: "<scroll-view>", tier: "L1", status: "implemented" },
    { id: "L11", kind: "layout", semantic: "layout.virtual-list", tag: "p-virtual-list", props: ["itemSize", "buffer", "direction"], mpEquiv: "<scroll-view> + \u624B\u52A8\u56DE\u6536", tier: "L1", status: "implemented" },
    { id: "L12", kind: "layout", semantic: "layout.masonry", tag: "p-masonry", props: ["colCount", "gap"], mpEquiv: "\u7B2C\u4E09\u65B9\u7011\u5E03\u6D41", tier: "L1", status: "implemented" },
    // ★#405 语义登记批：Fluid 体系剩余组件（语义层待多端映射 → planned L2——G-31.4 不足 3 端降级）
    { id: "L13", kind: "layout", semantic: "layout.aspect", tag: "p-aspect", props: ["ratio", "maxWidth"], mpEquiv: "\u65E0\uFF08\u7EB5\u6A2A\u6BD4\u5BB9\u5668\uFF09", tier: "L2", status: "planned" },
    { id: "L14", kind: "layout", semantic: "layout.zone", tag: "p-zone", props: ["designWidth"], mpEquiv: "\u65E0\uFF08\u5BB9\u5668\u65AD\u70B9\u5206\u533A\uFF09", tier: "L2", status: "planned" },
    // ★★Fluid System v2（2026-09-26）：柔性形态容器——按设备形态自动编排布局拓扑/能力/密度/缩放
    { id: "L26", kind: "layout", semantic: "layout.formfactor", tag: "p-formfactor", props: ["declared", "width", "height"], mpEquiv: "\u65E0\uFF08\u5F62\u6001\u7F16\u6392\u5BB9\u5668\uFF1Aglance/stack/duo/rail-split/rail-grid/dashboard/hero-focus-row\uFF09", tier: "L2", status: "implemented" },
    // ★批次 7（2026-09-18）未登记组件补登记：安全区（刘海/折叠屏/降级）+ 侧边导航容器
    { id: "L15", kind: "layout", semantic: "layout.safe", tag: "p-safe", props: ["area", "fold", "fallback"], mpEquiv: "\u65E0\uFF08\u5B89\u5168\u533A\u8BED\u4E49\u5BB9\u5668\uFF09", tier: "L1", status: "implemented" },
    { id: "L16", kind: "layout", semantic: "layout.sidebar", tag: "p-sidebar", props: ["minSidebarWidth", "navWidth", "designWidth", "toggleLabel"], mpEquiv: "\u65E0\uFF08\u5BB9\u5668\u65AD\u70B9\u4FA7\u680F\uFF09", tier: "L1", status: "implemented" }
  ];
  var UI = [
    { id: "U1", kind: "ui", semantic: "ui.text", tag: "p-text", props: ["content", "selectable", "truncate", "align", "userSelect", "overflow", "maxLines", "selectOnGesture", "space", "decode"], mpEquiv: "<text>", tier: "L1", status: "implemented" },
    { id: "U2", kind: "ui", semantic: "ui.heading", tag: "p-heading", props: ["level"], mpEquiv: "<h1>-<h6>", tier: "L1", status: "implemented" },
    { id: "U3", kind: "ui", semantic: "ui.rich-text", tag: "p-rich-text", props: ["nodes", "space", "userSelect", "mode", "source"], mpEquiv: "<rich-text>", tier: "L1", status: "implemented" },
    { id: "U4", kind: "ui", semantic: "ui.icon", tag: "p-icon", props: ["name", "type", "size", "color", "spin"], mpEquiv: "<icon>", tier: "L1", status: "implemented" },
    { id: "U5", kind: "ui", semantic: "ui.image", tag: "p-image", props: ["src", "fit", "placeholder", "lazy", "showMenuByLongpress", "fadeIn", "preload", "webp", "referrerPolicy"], mpEquiv: "<image>", tier: "L1", status: "implemented" },
    { id: "U6", kind: "ui", semantic: "ui.avatar", tag: "p-avatar", props: ["src", "shape", "size", "fallback"], mpEquiv: "\u7EC4\u5408", tier: "L1", status: "implemented" },
    { id: "U7", kind: "ui", semantic: "ui.media", tag: "p-media", props: ["kind", "src", "duration", "controls", "autoplay", "loop", "muted", "initialTime", "poster", "objectFit", "title", "playBtnPosition", "direction", "showProgress", "showFullscreenBtn", "showPlayBtn", "showCenterPlayBtn", "showMuteBtn", "showBottomProgress", "enableProgressGesture", "enablePlayGesture", "pageGesture", "vslideGesture", "vslideGestureInFullscreen", "autoPauseIfNavigate", "autoPauseIfOpenNative", "danmuList", "danmuBtn", "enableDanmu", "pictureInPicture"], mpEquiv: "<video>+<audio>", tier: "L1", status: "implemented" },
    { id: "U8", kind: "ui", semantic: "ui.canvas", tag: "p-canvas", props: ["engine", "canvasId", "disableScroll", "resolution"], mpEquiv: "<canvas>", tier: "L1", status: "implemented" },
    { id: "U9", kind: "ui", semantic: "ui.svg", tag: "p-svg", props: ["path", "viewbox"], mpEquiv: "\u65E0", tier: "L1", status: "implemented" },
    { id: "U10", kind: "ui", semantic: "ui.input", tag: "p-input", props: ["type", "mask", "validation", "clearable"], mpEquiv: "<input>", tier: "L1", status: "implemented" },
    { id: "U11", kind: "ui", semantic: "ui.textarea", tag: "p-textarea", props: ["autosize", "maxLength", "count"], mpEquiv: "<textarea>", tier: "L1", status: "implemented" },
    { id: "U12", kind: "ui", semantic: "ui.select", tag: "p-select", props: ["options", "multiple", "searchable", "cascader"], mpEquiv: "<picker> \u90E8\u5206", tier: "L1", status: "implemented" },
    { id: "U13", kind: "ui", semantic: "ui.checkbox", tag: "p-checkbox", props: ["checked", "indeterminate", "group"], mpEquiv: "<checkbox>", tier: "L1", status: "implemented" },
    { id: "U14", kind: "ui", semantic: "ui.radio", tag: "p-radio", props: ["value", "group"], mpEquiv: "<radio>", tier: "L1", status: "implemented" },
    { id: "U15", kind: "ui", semantic: "ui.switch", tag: "p-switch", props: ["checked", "loading"], mpEquiv: "<switch>", tier: "L1", status: "implemented" },
    { id: "U16", kind: "ui", semantic: "ui.slider", tag: "p-slider", props: ["min", "max", "step", "range"], mpEquiv: "<slider>", tier: "L1", status: "implemented" },
    { id: "U17", kind: "ui", semantic: "ui.picker", tag: "p-picker", props: ["mode", "start", "end", "indicatorStyle", "indicatorClass", "maskClass", "maskStyle", "immediateChange"], mpEquiv: "<picker>", tier: "L1", status: "implemented" },
    { id: "U18", kind: "ui", semantic: "ui.form", tag: "p-form", props: ["model", "rules", "layout"], mpEquiv: "\u7EC4\u5408", tier: "L1", status: "implemented" },
    // ★#405 语义登记批：反馈/状态类组件
    // ★2026-09-30 反馈组件补齐：组件本体（p-loading）与 MP 产物测试早已存在，
    //   缺的只是 SEMANTIC_BACKEND_MAP 的后端映射登记 ⇒ 补齐后据实转 implemented（**修记账非修能力**）
    { id: "U19", kind: "ui", semantic: "ui.loading", tag: "p-loading", props: ["size", "text"], mpEquiv: "wx.showLoading \u90E8\u5206", tier: "L1", status: "implemented" },
    { id: "U20", kind: "ui", semantic: "ui.scale", tag: "p-scale", props: ["level", "density", "baseSize"], mpEquiv: "\u65E0\uFF08\u65E0\u969C\u788D\u6863\u4F4D\uFF09", tier: "L2", status: "planned" },
    { id: "U21", kind: "ui", semantic: "ui.skeleton", tag: "p-skeleton", props: ["rows", "avatar", "animated"], mpEquiv: "\u65E0", tier: "L2", status: "planned" },
    // ★能力颗粒度对齐 C2：进度条 / 表单标签
    { id: "U22", kind: "ui", semantic: "ui.progress", tag: "p-progress", props: ["percent", "status", "type", "strokeWidth", "showInfo"], mpEquiv: "<progress>", tier: "L1", status: "implemented" },
    { id: "U23", kind: "ui", semantic: "ui.label", tag: "p-label", props: ["for", "block"], mpEquiv: "<label>", tier: "L1", status: "implemented" },
    // ★权威标尺批 H：局部文本选区
    { id: "U24", kind: "ui", semantic: "ui.selection", tag: "p-selection", props: ["disableContextMenu", "selectable"], mpEquiv: "<selection>", tier: "L1", status: "implemented" },
    // ★权威标尺批 I：相机
    { id: "U25", kind: "ui", semantic: "ui.camera", tag: "p-camera", props: ["mode", "resolution", "devicePosition", "flash", "frameSize", "aspectRatio"], mpEquiv: "<camera>", tier: "L1", status: "implemented" },
    // ★权威标尺批 J：地图
    { id: "U26", kind: "ui", semantic: "ui.map", tag: "p-map", props: ["latitude", "longitude", "scale", "minScale", "maxScale", "markers", "polyline", "circles", "polygons", "includePoints", "showLocation", "layerStyle", "rotate", "skew", "showCompass", "showScale", "enableZoom", "enableScroll", "enableRotate", "enableSatellite", "enableTraffic", "enablePoi", "enableBuilding", "enableOverlooking", "setting"], mpEquiv: "<map>", tier: "L1", status: "implemented" },
    // ★批次 7（2026-09-18）未登记组件补登记：这 3 个组件此前**只存在于 TAG_SEMANTIC_MAP**（编译器能解析、
    //   组件能渲染），但不在 SSOT catalog → C1 不变量（catalog tag ↔ TAG_SEMANTIC_MAP 双向）单向成立、
    //   catalog 查询类 API（primitiveByTag / componentPrimitives）查不到它们。
    //   ★p-button 尤其反讽：它是**端对齐全流程的参考实现**（21/21、SOP v2 范式），却不在语义清单里。
    { id: "U27", kind: "ui", semantic: "ui.button", tag: "p-button", props: ["disabled", "loading", "throttle", "size", "type", "plain", "formType", "openType", "hoverClass", "theme", "hoverStopPropagation", "hoverStartTime", "hoverStayTime", "lang", "sessionFrom", "sendMessageTitle", "sendMessagePath", "sendMessageImg", "appParameter", "showMessageCard", "phoneNumberNoQuotaToast", "needShowEntrance", "entrancePath"], mpEquiv: "<button>", tier: "L1", status: "implemented" },
    { id: "U28", kind: "ui", semantic: "ui.list", tag: "p-list-view", props: ["items", "itemHeight", "height", "bufferSize", "virtual", "lazy", "padding"], mpEquiv: "<list-view>\uFF08\u865A\u62DF\u6EDA\u52A8\uFF09", tier: "L1", status: "implemented" },
    { id: "U29", kind: "ui", semantic: "ui.nav", tag: "p-nav-bar", props: ["title", "back", "fixed", "loading", "frontColor", "backgroundColor", "colorAnimationDuration", "colorAnimationTimingFunc"], mpEquiv: "<navigation-bar>\uFF08\u81EA\u7ED8\uFF09", tier: "L1", status: "implemented" }
  ];
  var SHELL = [
    { id: "S1", kind: "shell", semantic: "shell.page", tag: "p-page", props: ["title", "statusBar", "pullRefresh"], mpEquiv: "<page>", tier: "L1", status: "implemented" },
    { id: "S2", kind: "shell", semantic: "shell.nav", tag: "p-nav", props: ["title", "transparent", "loading", "frontColor", "backgroundColor", "colorAnimationDuration", "colorAnimationTimingFunc"], mpEquiv: "\u5BFC\u822A\u680F\u914D\u7F6E", tier: "L1", status: "implemented" },
    { id: "S3", kind: "shell", semantic: "shell.tabbar", tag: "p-tabbar", props: ["tabs", "active", "badge"], mpEquiv: "<tabbar>", tier: "L1", status: "implemented" },
    { id: "S4", kind: "shell", semantic: "shell.segment", tag: "p-segment", props: ["options", "active"], mpEquiv: "<segment>", tier: "L1", status: "implemented" },
    { id: "S5", kind: "shell", semantic: "shell.drawer", tag: "p-drawer", props: ["side", "width", "overlay"], mpEquiv: "\u7EC4\u5408", tier: "L1", status: "implemented" },
    { id: "S6", kind: "shell", semantic: "shell.modal", tag: "p-modal", props: ["open", "dismissible", "sheet", "dialog", "alert"], mpEquiv: "<modal>+wx.showModal", tier: "L1", status: "implemented" },
    { id: "S7", kind: "shell", semantic: "shell.popover", tag: "p-popover", props: ["trigger", "placement"], mpEquiv: "\u7EC4\u5408", tier: "L1", status: "implemented" },
    // ★2026-09-30 同上（p-toast 已有 MP 产物测试 + 7 端映射 ⇒ 据实转 implemented）
    { id: "S8", kind: "shell", semantic: "shell.toast", tag: "p-toast", props: ["message", "duration", "type"], mpEquiv: "wx.showToast", tier: "L1", status: "implemented" },
    { id: "S9", kind: "shell", semantic: "shell.action-sheet", tag: "p-action-sheet", props: ["actions", "cancel"], mpEquiv: "wx.showActionSheet", tier: "L1", status: "implemented" },
    { id: "S10", kind: "shell", semantic: "layout.split", tag: "p-split", props: ["breakpoint", "ratio", "collapse"], mpEquiv: "\u65E0\uFF08\u5206\u680F\u5E03\u5C40\uFF09", tier: "L1", status: "implemented" },
    // ★已落地绑定：分栏语义由 layout.split 承载（G-32 文档为 shell.split——机器事实以实现为准）
    // ★#405 语义登记批：弹层/工具栏组件
    { id: "S11", kind: "shell", semantic: "shell.mask", tag: "p-mask", props: ["visible", "transparent"], mpEquiv: "\u7EC4\u5408\uFF08\u906E\u7F69\u5C42\uFF09", tier: "L2", status: "planned" },
    { id: "S12", kind: "shell", semantic: "shell.popup", tag: "p-popup", props: ["position", "round", "overlay"], mpEquiv: "\u7EC4\u5408\uFF08\u5F39\u5C42\uFF09", tier: "L2", status: "planned" },
    { id: "S13", kind: "shell", semantic: "shell.toolbar", tag: "p-toolbar", props: ["items", "itemWidth", "moreWidth"], mpEquiv: "\u65E0\uFF08\u6EA2\u51FA\u6298\u53E0\uFF09", tier: "L2", status: "planned" },
    // ★能力颗粒度对齐 C2：页面容器（对齐小程序 <page-container>）
    { id: "S14", kind: "shell", semantic: "shell.page-container", tag: "p-page-container", props: ["show", "position", "overlay", "closeOnClickOverlay", "duration", "zIndex", "closeOnSlideDown", "overlayStyle", "customStyle"], mpEquiv: "<page-container>", tier: "L1", status: "implemented" },
    // ★权威标尺批 H：键盘上方工具栏
    { id: "S15", kind: "shell", semantic: "shell.keyboard-accessory", tag: "p-keyboard-accessory", props: ["visible", "maxHeight", "background"], mpEquiv: "<keyboard-accessory>", tier: "L1", status: "implemented" },
    // ★权威标尺批 J：内嵌网页 / 广告位
    { id: "S16", kind: "shell", semantic: "shell.webview", tag: "p-webview", props: ["src", "height", "sandbox"], mpEquiv: "<web-view>", tier: "L1", status: "implemented" },
    { id: "S17", kind: "shell", semantic: "shell.ad", tag: "p-ad", props: ["unitId", "adIntervals", "adType", "adTheme", "height"], mpEquiv: "<ad>", tier: "L1", status: "implemented" }
  ];
  var GESTURE = [
    // ★2026-09-18：G1/G2 由 planned → implemented——`v-gesture:tap|longpress` 已双端落地
    //   （编译器新增 `directive/v-gesture` 规则：MP 映射 bindtap/bindlongpress；Web 走 Pointer 识别器）。
    //   ★G3–G7 **保持 planned**：MP 端无事件对等（官方用 worklet 手势处理器<组件>，框架未生成），
    //   mpEquiv 已改为**如实描述**（原值 bindswipe/bindtouchmove/组合/3D Touch 多为不准确表述）。
    { id: "G1", kind: "gesture", semantic: "gesture.tap", api: "v-gesture:tap", props: ["count"], mpEquiv: "bindtap\uFF08\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u7F16\u8BD1\u5668\u76F4\u6620\u5C04\uFF09", tier: "L1", status: "implemented" },
    { id: "G2", kind: "gesture", semantic: "gesture.longpress", api: "v-gesture:longpress", props: ["duration", "onEnd"], mpEquiv: "bindlongpress\uFF08\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u7F16\u8BD1\u5668\u76F4\u6620\u5C04\uFF09", tier: "L1", status: "implemented" },
    { id: "G3", kind: "gesture", semantic: "gesture.swipe", api: "v-gesture:swipe", props: ["direction", "threshold"], mpEquiv: "\u65E0\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u9700 @touchstart/@touchend \u81EA\u884C\u5224\u5B9A\u65B9\u5411", tier: "L1", status: "planned" },
    { id: "G4", kind: "gesture", semantic: "gesture.pan", api: "v-gesture:pan", props: ["axis", "bounds"], mpEquiv: "\u65E0\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u5B98\u65B9 <pan-gesture-handler>\uFF08worklet\uFF09\u6216 touch \u65CF\u81EA\u884C\u5224\u5B9A", tier: "L1", status: "planned" },
    { id: "G5", kind: "gesture", semantic: "gesture.pinch", api: "v-gesture:pinch", props: ["scale", "onChange"], mpEquiv: "\u65E0\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u5B98\u65B9 <scale-gesture-handler>\uFF08worklet\uFF09", tier: "L1", status: "planned" },
    { id: "G6", kind: "gesture", semantic: "gesture.rotate", api: "v-gesture:rotate", props: ["angle"], mpEquiv: "\u65E0\u539F\u751F\u4E8B\u4EF6\uFF08MP \u65E0 rotate \u624B\u52BF\u5904\u7406\u5668\uFF09", tier: "L1", status: "planned" },
    { id: "G7", kind: "gesture", semantic: "gesture.press", api: "v-gesture:press", props: ["force"], mpEquiv: "\u65E0\u539F\u751F\u4E8B\u4EF6\u2014\u2014\u5B98\u65B9 <force-press-gesture-handler>\uFF08worklet\uFF0C\u9700 3D Touch \u8BBE\u5907\uFF09", tier: "L1", status: "planned" },
    { id: "G8", kind: "gesture", semantic: "gesture.draggable", tag: "p-draggable", props: ["direction", "inertia", "outOfBounds", "x", "y", "damping", "friction", "disabled", "scaleEnabled", "scaleMin", "scaleMax", "scaleValue", "animation", "scaleArea", "ghost", "snapToGrid", "onDrop"], mpEquiv: "movable-view", tier: "L1", status: "implemented" },
    { id: "G9", kind: "gesture", semantic: "gesture.scrollable", tag: "p-scrollable", props: ["bounce", "refresh", "loadMore"], mpEquiv: "<scroll-view>", tier: "L1", status: "implemented" },
    { id: "G10", kind: "gesture", semantic: "gesture.use-gesture", api: "useGesture()", props: ["recognizers", "simultaneous"], mpEquiv: "\u65E0", tier: "L1", status: "planned" }
  ];
  function cap(id, name, api, mpEquiv, returnType) {
    return { id, kind: "capability", semantic: `capability.${name}`, api, props: [returnType], mpEquiv, tier: "L1", status: "planned" };
  }
  var CAPABILITY = [
    // 7.1 设备/硬件（15）
    // ★2026-09-18 双形态（E8 先例）：能力入口组件 p-pick-photo 即 useCamera() 的声明式入口
    { id: "C1", kind: "capability", semantic: "capability.camera", api: "useCamera()", tag: "p-pick-photo", props: ["Result<Media>"], mpEquiv: "wx.createCameraContext", tier: "L1", status: "implemented" },
    cap("C2", "microphone", "useMicrophone()", "RecorderManager", "Result<AudioBuffer>"),
    { id: "C3", kind: "capability", semantic: "capability.location", api: "useLocation()", tag: "p-location", props: ["Result<Coords>"], mpEquiv: "wx.getLocation", tier: "L1", status: "implemented" },
    cap("C4", "map", "useMap()", "wx.createMapContext", "MapController"),
    cap("C5", "sensor", "useSensor()", "onAccelerometer/onCompass/onGyroscope", "SensorStream"),
    cap("C6", "vibrate", "useVibrate()", "wx.vibrateShort/Long", "void"),
    cap("C7", "battery", "useBattery()", "wx.getBatteryInfo", "BatteryInfo"),
    cap("C8", "network", "useNetwork()", "wx.getNetworkType", "NetworkType"),
    cap("C9", "clipboard", "useClipboard()", "wx.set/getClipboardData", "Result<string>"),
    cap("C10", "screen", "useScreen()", "wx.getSystemInfo", "ScreenInfo"),
    cap("C11", "device", "useDevice()", "wx.getSystemInfo", "DeviceInfo"),
    cap("C12", "orientation", "useOrientation()", "wx.onDeviceOrientationChange", "Orientation"),
    cap("C13", "brightness", "useBrightness()", "wx.setScreenBrightness", "Result<void>"),
    cap("C14", "keyboard", "useKeyboard()", "wx.onKeyboardHeightChange", "KeyboardInfo"),
    cap("C15", "storage", "useStorage()", "wx.set/getStorage", "StorageAPI"),
    // 7.2 系统/OS（10）
    cap("C16", "permission", "usePermission()", "wx.authorize", "Result<PermissionStatus>"),
    cap("C17", "notification", "useNotification()", "wx.requestSubscribeMessage", "NotificationAPI"),
    cap("C18", "share", "useShare()", "wx.shareAppMessage", "Result<void>"),
    cap("C19", "contact", "useContact()", "wx.chooseContact", "Result<Contact[]>"),
    cap("C20", "calendar", "useCalendar()", "wx.addPhoneCalendar", "CalendarAPI"),
    cap("C21", "phone-call", "usePhoneCall()", "wx.makePhoneCall", "Result<void>"),
    cap("C22", "sms", "useSMS()", "wx.??\uFF08\u53D7\u9650\uFF09", "Result<void>"),
    // ★★2026-09-30：C23/C24/C25 App 宿主腿落地（此前仅 wx/web 两桥 ⇒ App 端形同虚设）——
    //   App 桥 `packages/api/src/capability-app.ts`（总线 + 三能力 + 虚拟栈页面事件翻译器）；
    //   真机判据 `check:host-runtime` ①~⑤（冷启动补 launch / 真实栈驱动页面生命周期 /
    //   壳真实事件逐条驱动总线 / 启动参数经 job 泵 / 阶段快照）。
    { id: "C23", kind: "capability", semantic: "capability.app-lifecycle", api: "useAppLifecycle()", props: ["LifecycleHooks"], mpEquiv: "App.onLaunch/onShow", tier: "L1", status: "implemented" },
    { id: "C24", kind: "capability", semantic: "capability.page-lifecycle", api: "usePageLifecycle()", props: ["LifecycleHooks"], mpEquiv: "Page.onLoad/onShow", tier: "L1", status: "implemented" },
    { id: "C25", kind: "capability", semantic: "capability.background", api: "useBackground()", props: ["BackgroundAPI"], mpEquiv: "wx.onBackground", tier: "L1", status: "implemented" },
    // 7.3 通信/数据（10）
    cap("C26", "fetch", "useFetch()", "wx.request", "Promise<T>"),
    cap("C27", "websocket", "useWebSocket()", "wx.connectSocket", "WSConnection"),
    cap("C28", "socket-task", "useSocketTask()", "wx.SocketTask", "SocketTask"),
    cap("C29", "upload", "useUpload()", "wx.uploadFile", "Progress<Result>"),
    cap("C30", "download", "useDownload()", "wx.downloadFile", "Progress<Result>"),
    cap("C31", "data-channel", "useDataChannel()", "wx...\uFF08\u76F4\u64AD/\u5B9E\u65F6\uFF09", "Channel"),
    cap("C32", "cookie", "useCookie()", "\u65E0", "CookieJar"),
    cap("C33", "auth", "useAuth()", "\u7EC4\u5408", "AuthState"),
    cap("C34", "analytics", "useAnalytics()", "wx.reportEvent", "TrackAPI"),
    cap("C35", "log", "useLog()", "console + \u4E0A\u62A5", "Logger"),
    // 7.4 扩展能力（10）
    cap("C36", "bluetooth", "useBluetooth()", "wx.openBluetoothAdapter", "BluetoothAPI"),
    cap("C37", "nfc", "useNFC()", "wx.getHCEState", "NFCAPI"),
    cap("C38", "biometric", "useBiometric()", "wx.checkIsSupportFingerPrint", "Result<boolean>"),
    cap("C39", "face-id", "useFaceID()", "\u7EC4\u5408", "Result<boolean>"),
    cap("C40", "payment", "usePayment()", "wx.requestPayment", "Result<PayResult>"),
    cap("C41", "login", "useLogin()", "wx.login", "Result<Token>"),
    // ★2026-09-18 双形态（E8 先例）：能力入口组件 p-scan-qr 即 useQRCode() 的声明式入口
    { id: "C42", kind: "capability", semantic: "capability.qr-code", api: "useQRCode()", tag: "p-scan-qr", props: ["Result<string>"], mpEquiv: "wx.scanCode + canvas", tier: "L1", status: "implemented" },
    cap("C43", "file-system", "useFileSystem()", "wx.getFileSystemManager", "FSAdapter"),
    cap("C44", "archive", "useArchive()", "wx.compressFile", "Result<void>"),
    cap("C45", "shortcut", "useShortcut()", "wx.addToDesktop", "Result<void>"),
    cap("C46", "in-app-purchase", "useInAppPurchase()", "wx.requestPayment \u6269\u5C55", "Result<Receipt>"),
    // 7.5 平台特有（4——C47-C50，此前 7.4 末 C46，总 50）
    { id: "C47", kind: "capability", semantic: "capability.mini-program", api: "useMiniProgram()", props: ["MPContext"], mpEquiv: "wx.navigateToMiniProgram", tier: "L1", status: "implemented" },
    { id: "C48", kind: "capability", semantic: "capability.embedded", api: "useEmbedded()", props: ["HostContext"], mpEquiv: "\u65E0\uFF08\u88AB\u5BBF\u4E3B\u5D4C\u5165\uFF09", tier: "L1", status: "implemented" },
    { id: "C49", kind: "capability", semantic: "capability.live", api: "useLive()", props: ["LiveRoom"], mpEquiv: "wx...\uFF08\u76F4\u64AD\u7EC4\u4EF6\uFF09", tier: "L1", status: "planned" },
    { id: "C50", kind: "capability", semantic: "capability.extension", api: "useExtension()", props: ["ExtensionAPI"], mpEquiv: "\u65E0\uFF08\u63D2\u4EF6/\u6269\u5C55\u70B9 G-21\uFF09", tier: "L1", status: "implemented" },
    // ★颗粒度对齐 C（2026-09-11）：C51 小程序热更新（wx.getUpdateManager）
    { id: "C51", kind: "capability", semantic: "capability.update", api: "useUpdate()", props: ["UpdateManagerAPI"], mpEquiv: "wx.getUpdateManager", tier: "L1", status: "implemented" },
    // ★颗粒度对齐 C3（2026-09-11）：相册 / Worker（对齐小程序媒体与多线程 API——纯 Hook，无 C-IR 节点 → planned）
    { id: "C52", kind: "capability", semantic: "capability.album", api: "useAlbum()", props: ["AlbumAPI"], mpEquiv: "wx.chooseMedia/saveImageToPhotosAlbum/previewMedia", tier: "L1", status: "planned" },
    { id: "C53", kind: "capability", semantic: "capability.worker", api: "useWorker()", props: ["WorkerHandle"], mpEquiv: "wx.createWorker", tier: "L1", status: "implemented" },
    // ★颗粒度对齐 C3 批 2：收货地址 / WiFi / 微信运动（对齐小程序系统 API——纯 Hook → planned）
    { id: "C54", kind: "capability", semantic: "capability.address", api: "useAddress()", props: ["ShippingAddress"], mpEquiv: "wx.chooseAddress", tier: "L1", status: "planned" },
    { id: "C55", kind: "capability", semantic: "capability.wifi", api: "useWifi()", props: ["WifiAPI"], mpEquiv: "wx.getConnectedWifi/getWifiList/connectWifi", tier: "L1", status: "planned" },
    { id: "C56", kind: "capability", semantic: "capability.we-run", api: "useWeRun()", props: ["WeRunData"], mpEquiv: "wx.getWeRunData", tier: "L1", status: "planned" },
    // ★组件实例 API 对齐（2026-09-12）：画布组件实例（wx.createCanvasContext/SelectorQuery node/canvasToTempFilePath/OffscreenCanvas；纯 Hook → planned）
    { id: "C57", kind: "capability", semantic: "capability.canvas", api: "useCanvas()", props: ["CanvasController"], mpEquiv: "wx.createCanvasContext/canvasToTempFilePath/createOffscreenCanvas", tier: "L1", status: "planned" },
    // ★组件实例 API 对齐（2026-09-12）：元素查询 / 交叉观察 / 媒体查询（wx SelectorQuery/IntersectionObserver/MediaQueryObserver）
    { id: "C58", kind: "capability", semantic: "capability.element-query", api: "useElement()", props: ["ElementQuery"], mpEquiv: "wx.createSelectorQuery", tier: "L1", status: "planned" },
    { id: "C59", kind: "capability", semantic: "capability.intersection", api: "useIntersection()", props: ["IntersectionHandle"], mpEquiv: "wx.createIntersectionObserver", tier: "L1", status: "planned" },
    { id: "C60", kind: "capability", semantic: "capability.media-query", api: "useMediaQuery()", props: ["MediaQueryObserver"], mpEquiv: "wx.createMediaQueryObserver", tier: "L1", status: "planned" },
    // ★组件实例 API 对齐（2026-09-12）：媒体组件实例 + 广告（wx VideoContext/InnerAudioContext/LivePusherContext + 广告联盟）
    { id: "C61", kind: "capability", semantic: "capability.video", api: "useVideo()", props: ["VideoController"], mpEquiv: "wx.createVideoContext", tier: "L1", status: "planned" },
    { id: "C62", kind: "capability", semantic: "capability.audio", api: "useAudio()", props: ["AudioController"], mpEquiv: "wx.createInnerAudioContext", tier: "L1", status: "planned" },
    { id: "C63", kind: "capability", semantic: "capability.live-pusher", api: "useLivePusher()", props: ["LivePusherController"], mpEquiv: "wx.createLivePusherContext", tier: "L1", status: "planned" },
    { id: "C64", kind: "capability", semantic: "capability.ad", api: "useAd()", props: ["AdAPI"], mpEquiv: "wx.createRewardedVideoAd/createInterstitialAd/createBannerAd", tier: "L1", status: "planned" },
    // ★权威标尺缺口补齐（2026-09-12）：隐私协议（wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize——合规刚需）
    { id: "C65", kind: "capability", semantic: "capability.privacy", api: "usePrivacy()", props: ["PrivacyAPI"], mpEquiv: "wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize", tier: "L1", status: "planned" },
    // ★权威标尺缺口补齐批 D（2026-09-12）：性能 / 预加载 / 图像编辑（通用能力，无资质门槛）
    { id: "C66", kind: "capability", semantic: "capability.performance", api: "usePerformance()", props: ["PerformanceAPI"], mpEquiv: "wx.getPerformance/reportPerformance", tier: "L1", status: "planned" },
    { id: "C67", kind: "capability", semantic: "capability.preload", api: "usePreload()", props: ["PreloadAPI"], mpEquiv: "wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage", tier: "L1", status: "implemented" },
    { id: "C68", kind: "capability", semantic: "capability.image-edit", api: "useImageEdit()", props: ["ImageEditAPI"], mpEquiv: "wx.cropImage/editImage", tier: "L1", status: "planned" },
    // ★权威标尺缺口补齐批 E（2026-09-12）：网络底层 / 媒体高级
    { id: "C69", kind: "capability", semantic: "capability.socket", api: "useSocket()", props: ["UDPSocketHandle / TCPSocketHandle"], mpEquiv: "wx.createUDPSocket/createTCPSocket", tier: "L1", status: "planned" },
    { id: "C70", kind: "capability", semantic: "capability.media-processing", api: "useMediaProcessing()", props: ["MediaProcessingAPI"], mpEquiv: "wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer", tier: "L1", status: "planned" },
    // ★权威标尺缺口补齐批 F（2026-09-12）：录屏/缓存/空闲/窗口/导航拦截
    { id: "C71", kind: "capability", semantic: "capability.screen-capture", api: "useScreenCapture()", props: ["ScreenCaptureAPI"], mpEquiv: "wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive", tier: "L1", status: "planned" },
    { id: "C72", kind: "capability", semantic: "capability.cache-manager", api: "useCacheManager()", props: ["CacheManagerHandle"], mpEquiv: "wx.createCacheManager", tier: "L1", status: "planned" },
    { id: "C73", kind: "capability", semantic: "capability.idle", api: "useIdle()", props: ["IdleAPI"], mpEquiv: "wx.requestIdleCallback/cancelIdleCallback", tier: "L1", status: "implemented" },
    { id: "C74", kind: "capability", semantic: "capability.window", api: "useWindow()", props: ["WindowAPI"], mpEquiv: "wx.setWindowSize", tier: "L1", status: "implemented" },
    { id: "C75", kind: "capability", semantic: "capability.navigation-guard", api: "useNavigationGuard()", props: ["NavigationGuardAPI"], mpEquiv: "wx.enableAlertBeforeUnload/disableAlertBeforeUnload", tier: "L1", status: "implemented" },
    // ★权威标尺缺口补齐批 G（2026-09-12）：AR/XR / iBeacon / 局域网 / 翻译 / 海报 / 设备探测
    { id: "C76", kind: "capability", semantic: "capability.ar", api: "useAR()", props: ["ARAPI"], mpEquiv: "wx.createVKSession/isVKSupport", tier: "L1", status: "planned" },
    { id: "C77", kind: "capability", semantic: "capability.beacon", api: "useBeacon()", props: ["BeaconAPI"], mpEquiv: "wx.onBeaconServiceChange/onBeaconUpdate", tier: "L1", status: "planned" },
    { id: "C78", kind: "capability", semantic: "capability.local-service", api: "useLocalService()", props: ["LocalServiceAPI"], mpEquiv: "wx.onLocalServiceFound/Lost/ResolveFail/DiscoveryStop", tier: "L1", status: "planned" },
    { id: "C79", kind: "capability", semantic: "capability.translation", api: "useTranslation()", props: ["TranslationAPI"], mpEquiv: "wx.onUserTriggerTranslation/onUserOffTranslation", tier: "L1", status: "planned" },
    { id: "C80", kind: "capability", semantic: "capability.poster", api: "usePoster()", props: ["PosterAPI"], mpEquiv: "wx.onGeneratePoster", tier: "L1", status: "planned" },
    { id: "C81", kind: "capability", semantic: "capability.device-capability", api: "useDeviceCapability()", props: ["DeviceCapabilityAPI"], mpEquiv: "wx.checkDeviceSupportHevc", tier: "L1", status: "planned" },
    // ★C82（2026-09-29）：WebAssembly 跨平台实现——**超官方清单**能力（官方 301 API 里无 wasm）。
    //   三端形态有实质差异（双源取证：微信官方文档 /framework/performance/wasm.html +
    //   miniprogram-api-typings/lib.wx.wasm.d.ts）：
    //   MP `WXWebAssembly.instantiate(path)` 只收**代码包路径**（.wasm/.wasm.br）· 无 compile/validate ·
    //   v2.13.0+ 全局 / v2.15.0+ Worker；Web 与 App-iOS(JSC) 走标准 `WebAssembly`（收字节 · 有 compile/validate）；
    //   App-Android 由**宿主 wasm3** 执行（QuickJS 内建无 WASM——双端真机验证 add(2,40)=42）。
    //   ⇒ 归一入口 `instantiate({bytes}|{path})` + 能力位 `supportsStreaming`/`supportsPathLoad`。
    { id: "C82", kind: "capability", semantic: "capability.webassembly", api: "useWebAssembly()", props: ["WebAssemblyAPI"], mpEquiv: "WXWebAssembly.instantiate\uFF08\u5B98\u65B9\u6587\u6863 performance/wasm\uFF09", tier: "L1", status: "implemented" },
    // ★★NC1 首个声明式能力（2026-09-30）：来源 = 权威标尺修复后浮现的真实缺口之一
    //   （快照抽取器修复前 `wx.setKeepScreenOn` 结构性不可见，见 mp-spec-coverage 的 SPEC_PLANNED）。
    //   落地方式 = **声明式**（`packages/api/src/bridge-decls/keep-screen-on.ts` → 生成 → 合并进 bridge）：
    //   MP `wx.setKeepScreenOn` / Web **Screen Wake Lock**（`navigator.wakeLock.request('screen')`）——
    //   双端都有真实对等（非降级对等）。status 标 implemented：桥与 Hook 已落地且测试覆盖
    //   （含双端真跑 + 幂等 + 缺 API 降级）。
    { id: "C83", kind: "capability", semantic: "capability.keep-screen-on", api: "useKeepScreenOn()", props: ["KeepScreenOnState"], mpEquiv: "wx.setKeepScreenOn\uFF08Web \u5BF9\u7B49\uFF1AScreen Wake Lock API\uFF09", tier: "L1", status: "implemented" },
    // ★★NC1 第二个声明式能力（2026-09-30）：**用户裁定**「openDocument 属原生能力落地范畴，
    //   目标就是 99% 的业务代码不需要写原生代码」⇒ 落地而非搁置。
    //   形态 = 声明式（bridge-decls/open-document.ts → 生成 → 合并）；MP `wx.openDocument` /
    //   Web `window.open`（浏览器查看器）；★Web 诚实边界：office 格式通常转下载而非预览。
    //   status = implemented：桥与 Hook 已落地 + 测试覆盖（含"弹窗被拦截 ⇒ Err"的防静默判据）。
    { id: "C84", kind: "capability", semantic: "capability.document-preview", api: "useOpenDocument()", props: ["DocumentPath"], mpEquiv: "wx.openDocument\uFF08Web \u5BF9\u7B49\uFF1Awindow.open \u2192 \u6D4F\u89C8\u5668\u67E5\u770B\u5668\uFF09", tier: "L1", status: "implemented" }
  ];
  var ENGINEERING = [
    { id: "E1", kind: "engineering", semantic: "engineering.state", api: "useState()", mpEquiv: "data", tier: "L1", status: "planned" },
    { id: "E2", kind: "engineering", semantic: "engineering.computed", api: "useComputed()", mpEquiv: "computed", tier: "L1", status: "planned" },
    { id: "E3", kind: "engineering", semantic: "engineering.watch", api: "useWatch()", mpEquiv: "watch", tier: "L1", status: "planned" },
    { id: "E4", kind: "engineering", semantic: "engineering.store", api: "useStore()", mpEquiv: "getApp().globalData", tier: "L1", status: "planned" },
    { id: "E5", kind: "engineering", semantic: "engineering.provide-inject", api: "useProvide()/useInject()", mpEquiv: "\u65E0", tier: "L1", status: "planned" },
    { id: "E6", kind: "engineering", semantic: "engineering.lifecycle", api: "useLifecycle()", mpEquiv: "onLoad/onShow/onHide/onUnload", tier: "L1", status: "planned" },
    { id: "E7", kind: "engineering", semantic: "engineering.ready", api: "useReady()", mpEquiv: "onReady", tier: "L1", status: "planned" },
    { id: "E8", kind: "engineering", semantic: "engineering.error-boundary", api: "useErrorBoundary()", tag: "p-error-boundary", mpEquiv: "onError", tier: "L1", status: "planned" },
    // ★#405：组件形态补登（双形态：Hook + p- 标签）
    { id: "E9", kind: "engineering", semantic: "engineering.page-param", api: "usePageParam()", mpEquiv: "onLoad(options)", tier: "L1", status: "planned" },
    { id: "E10", kind: "engineering", semantic: "engineering.route", api: "useRoute()", mpEquiv: "getCurrentPages()", tier: "L1", status: "planned" },
    { id: "E11", kind: "engineering", semantic: "engineering.router-push", api: "router.push()", mpEquiv: "wx.navigateTo", tier: "L1", status: "planned" },
    { id: "E12", kind: "engineering", semantic: "engineering.router-replace", api: "router.replace()", mpEquiv: "wx.redirectTo", tier: "L1", status: "planned" },
    { id: "E13", kind: "engineering", semantic: "engineering.router-back", api: "router.back()", mpEquiv: "wx.navigateBack", tier: "L1", status: "planned" },
    { id: "E14", kind: "engineering", semantic: "engineering.router-switch-tab", api: "router.switchTab()", mpEquiv: "wx.switchTab", tier: "L1", status: "planned" },
    { id: "E15", kind: "engineering", semantic: "engineering.router-relaunch", api: "router.reLaunch()", mpEquiv: "wx.reLaunch", tier: "L1", status: "planned" },
    { id: "E16", kind: "engineering", semantic: "engineering.router-before-each", api: "router.beforeEach()", mpEquiv: "onLaunch \u624B\u52A8", tier: "L1", status: "planned" },
    { id: "E17", kind: "engineering", semantic: "engineering.router-after-each", api: "router.afterEach()", mpEquiv: "\u65E0", tier: "L1", status: "planned" },
    { id: "E18", kind: "engineering", semantic: "engineering.router-link", tag: "p-router-link", props: ["to", "replace", "switchTab", "target", "url", "openType", "delta", "appId", "path", "extraData", "version", "shortLink", "hoverClass", "hoverStopPropagation", "hoverStartTime", "hoverStayTime"], mpEquiv: "<navigator>", tier: "L1", status: "implemented" },
    { id: "E19", kind: "engineering", semantic: "engineering.transition", tag: "p-transition", props: ["name", "mode"], mpEquiv: "transition CSS", tier: "L1", status: "implemented" },
    { id: "E20", kind: "engineering", semantic: "engineering.animate", tag: "p-animate", props: ["keyframes", "duration"], mpEquiv: "animation CSS", tier: "L1", status: "implemented" },
    { id: "E21", kind: "engineering", semantic: "engineering.animation", api: "useAnimation()", mpEquiv: "wx.createAnimation", tier: "L1", status: "planned" },
    { id: "E22", kind: "engineering", semantic: "engineering.gesture-animation", api: "useGestureAnimation()", mpEquiv: "\u7EC4\u5408", tier: "L1", status: "planned" },
    { id: "E23", kind: "engineering", semantic: "engineering.scroll-animation", api: "useScrollAnimation()", mpEquiv: "\u7EC4\u5408", tier: "L1", status: "planned" },
    { id: "E24", kind: "engineering", semantic: "engineering.devtools", api: "useDevTools()", mpEquiv: "\u5C0F\u7A0B\u5E8F DevTools", tier: "L1", status: "planned" },
    { id: "E25", kind: "engineering", semantic: "engineering.inspector", api: "useInspector()", mpEquiv: "\u65E0", tier: "L1", status: "planned" },
    { id: "E26", kind: "engineering", semantic: "engineering.performance", api: "usePerformance()", mpEquiv: "wx.reportPerformance", tier: "L1", status: "planned" },
    { id: "E27", kind: "engineering", semantic: "engineering.define-component", api: "defineComponent()", mpEquiv: "Component()", tier: "L1", status: "planned" },
    { id: "E28", kind: "engineering", semantic: "engineering.define-capability", api: "defineCapability()", mpEquiv: "\u65E0", tier: "L1", status: "planned" },
    // ★批次 8（2026-09-18）：共享元素转场（官方 <share-element> 对齐）——能力由宿主提供，框架只声明语义
    { id: "E29", kind: "engineering", semantic: "engineering.share-element", tag: "p-share-element", props: ["shuttleKey", "animate", "duration", "easingFunction", "transitionOnGesture", "shuttleOnPush", "shuttleOnPop", "rectTweenType"], mpEquiv: "<share-element>\uFF08\u5BBF\u4E3B\u8DE8\u9875\u98DE\u884C\u52A8\u753B\uFF09", tier: "L1", status: "implemented" },
    // ★E30（2026-09-19）：WebMCP 接入——把**能力面**暴露为浏览器内 agent 可调用工具。
    //   规范面：`document.modelContext.registerTool(...)`（★非 navigator）+ signal 注销（规范无 unregisterTool）；
    //   灵感来自 VueUse v15 `useWebMCP`（document 命名空间 / signal 注销 / 方法可调用探测 / 三元组返回）。
    //   框架差异化：能力面统一 `CapResult<T>` 契约（G-32.4）→ 能力可**自动**派生为工具、响应归一不必逐个手写。
    //   ★状态口径（与 E1-E28 / C15 / C26 等同款，非本轮新引入）：hook 形态原语无**渲染后端映射**，
    //   故按 catalog 既有约定记 `planned`——该字段反映「已在 SEMANTIC_BACKEND_MAP 登记 ≥3 端」，
    //   不等于「代码未实现」（本原语已实现于 `packages/api/src/mcp.ts`）。
    //   `mpEquiv: 无`：WebMCP 是浏览器侧 agent 通道，小程序无 `document.modelContext` → 如实降级（isSupported=false）。
    { id: "E30", kind: "engineering", semantic: "engineering.mcp", api: "useMCP()", props: ["tools", "capabilities", "prefix"], mpEquiv: "\u65E0\uFF08\u6D4F\u89C8\u5668\u4FA7 agent \u901A\u9053\uFF1BMP \u7AEF isSupported=false \u8BDA\u5B9E\u964D\u7EA7\uFF09", tier: "L1", status: "planned" }
  ];
  var PRIMITIVE_CATALOG = [...LAYOUT, ...UI, ...SHELL, ...GESTURE, ...CAPABILITY, ...ENGINEERING];
  var MP_COMPONENTS = [
    { mp: "<view>", proteus: "layout.box / layout.stack", status: "ok", group: "component" },
    { mp: "<text>", proteus: "ui.text / ui.heading", status: "ok", group: "component" },
    { mp: "<image>", proteus: "ui.image", status: "ok", group: "component" },
    { mp: "<scroll-view>", proteus: "layout.scroll / layout.virtual-list", status: "ok", group: "component" },
    { mp: "<swiper>", proteus: "layout.stack snap/loop\uFF08\u6D88\u706D\u4E3A\u5C5E\u6027\uFF09", status: "ok", group: "component" },
    { mp: "<swiper-item>", proteus: "layout.stack \u5B50\u9879", status: "ok", group: "component" },
    { mp: "<movable-area>", proteus: "gesture.scrollable \u5BB9\u5668", status: "ok", group: "component" },
    { mp: "<movable-view>", proteus: "gesture.draggable", status: "ok", group: "component" },
    { mp: "<cover-view>", proteus: "layout.box\uFF08Skyline \u540C\u5C42\u6E32\u67D3\u540E view \u5373\u53EF\u8986\u76D6\u2014\u2014\u5B98\u65B9\u5EFA\u8BAE\u66FF\u4EE3\uFF09", status: "ok", group: "component" },
    { mp: "<cover-image>", proteus: "ui.image\uFF08\u540C\u5C42\u6E32\u67D3\u540E image \u5373\u53EF\u8986\u76D6\uFF09", status: "ok", group: "component" },
    { mp: "<icon>", proteus: "ui.icon", status: "ok", group: "component" },
    { mp: "<progress>", proteus: "ui.progress", status: "ok", group: "component" },
    { mp: "<rich-text>", proteus: "ui.rich-text", status: "ok", group: "component" },
    { mp: "<button>", proteus: "ui.button", status: "ok", group: "component" },
    { mp: "<form>", proteus: "ui.form", status: "ok", group: "component" },
    { mp: "<input>", proteus: "ui.input", status: "ok", group: "component" },
    { mp: "<textarea>", proteus: "ui.textarea", status: "ok", group: "component" },
    { mp: "<checkbox>", proteus: "ui.checkbox", status: "ok", group: "component" },
    { mp: "<radio>", proteus: "ui.radio", status: "ok", group: "component" },
    { mp: "<picker>", proteus: "ui.picker / ui.select", status: "ok", group: "component" },
    { mp: "<picker-view>", proteus: "ui.picker mode=wheel", status: "ok", group: "component" },
    { mp: "<slider>", proteus: "ui.slider", status: "ok", group: "component" },
    { mp: "<switch>", proteus: "ui.switch", status: "ok", group: "component" },
    { mp: "<label>", proteus: "ui.label", status: "ok", group: "component" },
    { mp: "<navigator>", proteus: "engineering.router-link / router.*", status: "ok", group: "component" },
    { mp: "<audio>", proteus: "ui.media kind=audio\uFF08\u6D88\u706D\u4E3A\u5C5E\u6027\uFF09", status: "ok", group: "component" },
    { mp: "<video>", proteus: "ui.media kind=video\uFF08\u6D88\u706D\u4E3A\u5C5E\u6027\uFF09", status: "ok", group: "component" },
    { mp: "<camera>", proteus: "ui.camera\uFF08p-camera\uFF09+ useCamera", status: "ok", group: "component" },
    { mp: "<live-player>", proteus: "ui.media kind=live\uFF08\u6D88\u706D\u4E3A\u5C5E\u6027\uFF09", status: "ok", group: "component" },
    { mp: "<live-pusher>", proteus: "ui.media kind=live mode=push", status: "ok", group: "component" },
    { mp: "<canvas>", proteus: "ui.canvas", status: "ok", group: "component" },
    { mp: "<map>", proteus: "ui.map\uFF08p-map\uFF09+ useMap", status: "ok", group: "component" },
    { mp: "<web-view>", proteus: "shell.webview\uFF08p-webview\uFF09+ \u5BBF\u4E3B\u6865", status: "ok", group: "component" },
    { mp: "<editor>", proteus: "ui.rich-text editable", status: "ok", group: "component" },
    { mp: "<ad>", proteus: "shell.ad\uFF08p-ad\uFF09", status: "ok", group: "component" },
    { mp: "<official-account>", proteus: "useMiniProgram\uFF08\u5FAE\u4FE1\u79C1\u6709\uFF09", status: "private", group: "component" },
    { mp: "<open-data>", proteus: "useMiniProgram\uFF08\u5FAE\u4FE1\u79C1\u6709\uFF09", status: "private", group: "component" },
    { mp: "<share-element>", proteus: "engineering.share-element\uFF08p-share-element\uFF09", status: "ok", group: "component" },
    { mp: "<aria-component>", proteus: "aria-* \u5C5E\u6027\uFF08\u5404\u7EC4\u4EF6 ariaLabel\uFF1B\u4E24\u7AEF\u539F\u751F\u652F\u6301\uFF09", status: "ok", group: "component" },
    { mp: "<page-container>", proteus: "shell.page-container", status: "ok", group: "component" },
    { mp: "<voip-room>", proteus: "useMiniProgram\uFF08\u5FAE\u4FE1 VOIP\uFF09", status: "private", group: "component" },
    { mp: "<guild-room>", proteus: "useMiniProgram\uFF08\u5FAE\u4FE1\u6E38\u620F\uFF09", status: "private", group: "component" },
    // ★2026-09-11 补齐：此前矩阵漏列的真实微信内置组件（Skyline 族为主）——有等价能力标 ok/compat，无则 missing
    { mp: "<match-media>", proteus: "p-adaptive / p-zone\uFF08\u5BB9\u5668\u65AD\u70B9\u66FF\u4EE3\uFF09", status: "ok", group: "component" },
    { mp: "<navigation-bar>", proteus: "shell.nav\uFF08p-nav-bar \u81EA\u7ED8\uFF09", status: "ok", group: "component" },
    { mp: "<keyframe-animation>", proteus: "engineering.animate / engineering.transition", status: "ok", group: "component" },
    { mp: "<list-view>", proteus: "layout.virtual-list\uFF08p-list-view \u56DE\u6536\uFF09", status: "ok", group: "component" },
    { mp: "<grid-view>", proteus: "layout.grid / layout.virtual-list", status: "ok", group: "component" },
    { mp: "<snapshot>", proteus: "ui.canvas\uFF08\u622A\u56FE\u7ECF OffscreenCanvas\uFF09", status: "compat", group: "component" },
    { mp: "<page-meta>", proteus: "shell.page\uFF08\u9875\u9762\u914D\u7F6E\u5C5E\u6027\uFF09", status: "compat", group: "component" },
    { mp: "<root-portal>", proteus: "engineering.transition\uFF08teleport\u2192root-portal \u7F16\u8BD1\u671F\uFF09", status: "ok", group: "component" },
    { mp: "<sticky-header>", proteus: "layout.scroll + sticky\uFF08CSS\uFF09", status: "compat", group: "component" },
    { mp: "<sticky-section>", proteus: "layout.scroll + sticky\uFF08CSS\uFF09", status: "compat", group: "component" },
    { mp: "<double-tap-gesture>", proteus: "gesture.draggable\uFF08p-draggable \u624B\u52BF\u8BC6\u522B\u5668\uFF09", status: "ok", group: "component" },
    { mp: "<functional-page-navigator>", proteus: "\u2014\uFF08\u5FAE\u4FE1\u63D2\u4EF6\u9875\u4E13\u5C5E\uFF0C\u975E\u76EE\u6807\uFF09", status: "private", group: "component" },
    { mp: "<open-container>", proteus: "\u2014\uFF08\u5FAE\u4FE1\u5F00\u5C4F\u5BB9\u5668\uFF0C\u79C1\u6709\uFF09", status: "private", group: "component" },
    // ★权威标尺批 H：局部文本选区 / 键盘上方工具栏（全端真实落地）
    { mp: "<selection>", proteus: "ui.selection\uFF08p-selection\uFF09", status: "ok", group: "component" },
    { mp: "<keyboard-accessory>", proteus: "shell.keyboard-accessory\uFF08p-keyboard-accessory\uFF09", status: "ok", group: "component" }
  ];
  var MP_API_GROUPS = [
    { mp: "wx.request/upload/download/websocket\uFF08\u7F51\u7EDC\uFF09", proteus: "useFetch / useUpload / useDownload / useWebSocket / useSocketTask", status: "ok", group: "api" },
    { mp: "wx.requestPayment", proteus: "usePayment", status: "ok", group: "api" },
    { mp: "wx.chooseImage/chooseMedia/previewImage\uFF08\u5A92\u4F53\uFF09", proteus: "useAlbum / useCamera + ui.image", status: "ok", group: "api" },
    { mp: "wx.startRecord/RecorderManager\uFF08\u5F55\u97F3\uFF09", proteus: "useMicrophone / useRecorder", status: "ok", group: "api" },
    { mp: "wx.createVideoContext/CameraContext", proteus: "ui.media + createCameraContext\uFF08ui.canvas \u627F\u63A5\uFF09", status: "ok", group: "api" },
    { mp: "wx.scanCode", proteus: "useQRCode / p-scan-qr", status: "ok", group: "api" },
    { mp: "wx.saveImageToPhotosAlbum/saveVideoToPhotosAlbum", proteus: "useAlbum\uFF08saveImage/saveVideo\uFF09", status: "ok", group: "api" },
    { mp: "wx.createWorker\uFF08\u591A\u7EBF\u7A0B\uFF09", proteus: "useWorker", status: "ok", group: "api" },
    { mp: "wx.chooseAddress\uFF08\u6536\u8D27\u5730\u5740\uFF09", proteus: "useAddress", status: "ok", group: "api" },
    { mp: "wx.getConnectedWifi/getWifiList/connectWifi\uFF08WiFi\uFF09", proteus: "useWifi", status: "ok", group: "api" },
    { mp: "wx.getWeRunData\uFF08\u5FAE\u4FE1\u8FD0\u52A8\uFF09", proteus: "useWeRun", status: "ok", group: "api" },
    // ★组件实例 API 对齐（2026-09-12）：Canvas/查询/媒体组件实例（此前矩阵误标 useElement/useIntersection/useMedia——均为幽灵引用）
    { mp: "wx.createCanvasContext / canvasToTempFilePath / createOffscreenCanvas\uFF08Canvas \u7EC4\u4EF6\u5B9E\u4F8B\uFF09", proteus: "useCanvas", status: "ok", group: "api" },
    { mp: "wx.createSelectorQuery\uFF08\u5143\u7D20\u51E0\u4F55\u67E5\u8BE2\uFF09", proteus: "useElement", status: "ok", group: "api" },
    { mp: "wx.createIntersectionObserver\uFF08\u4EA4\u53C9\u89C2\u5BDF\uFF09", proteus: "useIntersection", status: "ok", group: "api" },
    { mp: "wx.createMediaQueryObserver\uFF08\u5A92\u4F53\u67E5\u8BE2\uFF09", proteus: "useMediaQuery", status: "ok", group: "api" },
    { mp: "wx.createVideoContext\uFF08\u89C6\u9891\u7EC4\u4EF6\u5B9E\u4F8B\uFF09", proteus: "useVideo", status: "ok", group: "api" },
    { mp: "wx.createInnerAudioContext\uFF08\u97F3\u9891\u5B9E\u4F8B\uFF09", proteus: "useAudio", status: "ok", group: "api" },
    { mp: "wx.createLivePusherContext\uFF08\u76F4\u64AD\u63A8\u6D41\u5B9E\u4F8B\uFF09", proteus: "useLivePusher", status: "ok", group: "api" },
    { mp: "wx.createRewardedVideoAd/createInterstitialAd/createBannerAd\uFF08\u5E7F\u544A\uFF09", proteus: "useAd", status: "ok", group: "api" },
    { mp: "wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize\uFF08\u9690\u79C1\u534F\u8BAE\uFF09", proteus: "usePrivacy", status: "ok", group: "api" },
    { mp: "wx.getPerformance/reportPerformance\uFF08\u6027\u80FD\uFF09", proteus: "usePerformance", status: "ok", group: "api" },
    { mp: "wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage\uFF08\u9884\u52A0\u8F7D\uFF09", proteus: "usePreload", status: "ok", group: "api" },
    { mp: "wx.cropImage/editImage\uFF08\u56FE\u50CF\u7F16\u8F91\uFF09", proteus: "useImageEdit", status: "ok", group: "api" },
    { mp: "wx.createUDPSocket/createTCPSocket\uFF08\u7F51\u7EDC\u5E95\u5C42 Socket\uFF09", proteus: "useSocket", status: "ok", group: "api" },
    { mp: "wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer\uFF08\u5A92\u4F53\u9AD8\u7EA7\uFF09", proteus: "useMediaProcessing", status: "ok", group: "api" },
    { mp: "wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive\uFF08\u5F55\u5C4F/\u622A\u5C4F\uFF09", proteus: "useScreenCapture", status: "ok", group: "api" },
    { mp: "wx.createCacheManager\uFF08\u8BF7\u6C42\u7F13\u5B58\u7BA1\u7406\uFF09", proteus: "useCacheManager", status: "ok", group: "api" },
    { mp: "wx.requestIdleCallback/cancelIdleCallback\uFF08\u7A7A\u95F2\u8C03\u5EA6\uFF09", proteus: "useIdle", status: "ok", group: "api" },
    { mp: "wx.setWindowSize\uFF08PC \u7A97\u53E3\uFF09", proteus: "useWindow", status: "ok", group: "api" },
    { mp: "wx.enableAlertBeforeUnload/disableAlertBeforeUnload\uFF08\u5378\u8F7D\u62E6\u622A\uFF09", proteus: "useNavigationGuard", status: "ok", group: "api" },
    { mp: "wx.createVKSession/isVKSupport\uFF08AR/XR \u89C6\u89C9\u7B97\u6CD5\uFF09", proteus: "useAR", status: "ok", group: "api" },
    { mp: "wx.onBeaconServiceChange/onBeaconUpdate\uFF08iBeacon\uFF09", proteus: "useBeacon", status: "ok", group: "api" },
    { mp: "wx.onLocalServiceFound/Lost/ResolveFail/DiscoveryStop\uFF08\u5C40\u57DF\u7F51 mDNS\uFF09", proteus: "useLocalService", status: "ok", group: "api" },
    { mp: "wx.onUserTriggerTranslation/onUserOffTranslation\uFF08\u7FFB\u8BD1\uFF09", proteus: "useTranslation", status: "ok", group: "api" },
    { mp: "wx.onGeneratePoster\uFF08\u5206\u4EAB\u6D77\u62A5\uFF09", proteus: "usePoster", status: "ok", group: "api" },
    { mp: "wx.checkDeviceSupportHevc\uFF08\u8BBE\u5907\u80FD\u529B\u63A2\u6D4B\uFF09", proteus: "useDeviceCapability", status: "ok", group: "api" },
    // ★C82：**超官方清单**能力（官方 301 API 列表里无 wasm）——`WXWebAssembly` 属官方「小程序运行时」
    //   文档（performance/wasm）确认的运行时能力 ⇒ 矩阵按 mpEquiv 如实登记；
    //   不进 spec 覆盖度分母（否则分母不变而 covered 虚增，覆盖率失真——见 mp-spec-coverage 注释）
    { mp: "WXWebAssembly.instantiate\uFF08WebAssembly \u8DE8\u5E73\u53F0\uFF0C\u5B98\u65B9\u6587\u6863 performance/wasm\uFF09", proteus: "useWebAssembly", status: "ok", group: "api" },
    { mp: "wx.getFileSystemManager/*\uFF08\u6587\u4EF6 30+\uFF09", proteus: "useFileSystem", status: "ok", group: "api" },
    { mp: "wx.compressFile/unzip", proteus: "useArchive", status: "ok", group: "api" },
    { mp: "wx.set/get/remove/clearStorage(+Sync)", proteus: "useStorage", status: "ok", group: "api" },
    { mp: "wx.getLocation/chooseLocation/openLocation", proteus: "useLocation / p-location", status: "ok", group: "api" },
    { mp: "wx.createMapContext", proteus: "useMap", status: "ok", group: "api" },
    { mp: "wx.getSystemInfo\uFF08\u8BBE\u5907/\u5C4F\u5E55/\u7F51\u7EDC/\u7535\u91CF/\u4EAE\u5EA6/\u65B9\u5411/\u9707\u52A8/\u4F20\u611F\u5668/\u526A\u8D34\u677F/\u7535\u8BDD\uFF09", proteus: "useDevice / useScreen / useNetwork / useBattery / useBrightness / useOrientation / useVibrate / useSensor / useClipboard / usePhoneCall", status: "ok", group: "api" },
    { mp: "wx.openBluetoothAdapter\uFF08\u84DD\u7259 20+\uFF09", proteus: "useBluetooth", status: "ok", group: "api" },
    { mp: "wx.getHCEState\uFF08NFC\uFF09", proteus: "useNFC", status: "ok", group: "api" },
    { mp: "wx.checkIsSupportFingerPrint/FaceID", proteus: "useBiometric / useFaceID", status: "ok", group: "api" },
    { mp: "wx.showToast/showLoading/showModal/showActionSheet", proteus: "shell.toast + ui.loading + shell.modal + shell.action-sheet", status: "ok", group: "api" },
    { mp: "wx.setNavigationBarTitle/Color", proteus: "shell.nav", status: "ok", group: "api" },
    { mp: "wx.setTabBarItem/Style/hide/show", proteus: "shell.tabbar", status: "ok", group: "api" },
    { mp: "wx.pageScrollTo", proteus: "layout.scroll\uFF08p-scroll-view\uFF09", status: "ok", group: "api" },
    { mp: "wx.createAnimation", proteus: "engineering.animate / engineering.transition", status: "ok", group: "api" },
    { mp: "wx.createSelectorQuery/IntersectionObserver", proteus: "engineering.router-link + layout.scroll\uFF08\u5B9E\u6D4B\u80FD\u529B\uFF09", status: "ok", group: "api" },
    { mp: "wx.navigateTo/redirectTo/navigateBack/switchTab/reLaunch", proteus: "engineering.router-link + router.* API", status: "ok", group: "api" },
    { mp: "wx.getCurrentPages", proteus: "engineering.router-link + shared adapter", status: "ok", group: "api" },
    { mp: "App()/Page() \u751F\u547D\u5468\u671F/getApp()", proteus: "useAppLifecycle / usePageLifecycle", status: "ok", group: "api" },
    { mp: "wx.shareAppMessage/requestSubscribeMessage", proteus: "useShare / useNotification", status: "ok", group: "api" },
    { mp: "wx.login/checkSession/getUserInfo/authorize", proteus: "useLogin / useAuth / usePermission", status: "ok", group: "api" },
    { mp: "wx.getUpdateManager", proteus: "useUpdate", status: "ok", group: "api" },
    { mp: "wx.requestWeChatPay/navigateToMiniProgram/\u6A21\u677F\u6D88\u606F/\u5BA2\u670D\uFF08\u5FAE\u4FE1\u79C1\u6709\uFF09", proteus: "useMiniProgram", status: "private", group: "api" }
  ];
  var MP_MAPPING_MATRIX = [...MP_COMPONENTS, ...MP_API_GROUPS];
  var PRIVATE_WEB_FALLBACK = {
    openType: "Web \u89E6\u53D1\u540C\u540D\u4E8B\u4EF6\uFF08\u5982 @contact\uFF09+ console \u63D0\u793A\u81EA\u5B9A\u4E49\u5BF9\u5E94\u4EA4\u4E92\uFF08\u53C2\u8003 Web p-button open-type\uFF09",
    appId: "Web \u65E0\u8DE8\u5E94\u7528\u8DF3\u8F6C\u80FD\u529B\uFF0C\u4EC5\u56DE\u663E\u53C2\u6570\u5E76\u63D0\u793A",
    shortLink: "Web \u65E0\u77ED\u94FE\u8DF3\u8F6C\u80FD\u529B\uFF0C\u4EC5\u56DE\u663E\u53C2\u6570\u5E76\u63D0\u793A",
    unitId: "Web \u65E0\u5BBF\u4E3B\u5E7F\u544A\u4F4D\uFF0C\u6E32\u67D3\u5360\u4F4D\u5E76\u63D0\u793A\uFF08\u4E0D\u9759\u9ED8\uFF09",
    adType: "Web \u65E0\u5BBF\u4E3B\u5E7F\u544A\u7C7B\u578B\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    adTheme: "Web \u65E0\u5BBF\u4E3B\u5E7F\u544A\u4E3B\u9898\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    adIntervals: "Web \u65E0\u5BBF\u4E3B\u5E7F\u544A\u81EA\u52A8\u5237\u65B0\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A"
  };
  var STYLE_WEB_FALLBACK = {
    hoverClass: "\u6620\u5C04 CSS :active/:hover \u7C7B\uFF08\u6846\u67B6\u9ED8\u8BA4\u7C7B\u6052\u5728\uFF0C\u81EA\u5B9A\u4E49\u7C7B\u4F5C\u9644\u52A0\u2014\u2014T3\uFF09",
    hoverStartTime: "Web \u7528 CSS transition-delay \u8FD1\u4F3C\u6309\u538B\u8D77\u59CB\u5EF6\u65F6",
    hoverStayTime: "Web \u7528 CSS transition-duration \u8FD1\u4F3C\u6309\u538B\u505C\u7559\u65F6\u957F",
    hoverStopPropagation: "Web \u7528 CSS pointer-events \u963B\u65AD\u5B50\u7EA7\u53CD\u9988\u8FD1\u4F3C"
  };
  var MP_HOST_WEB_FALLBACK = {
    alwaysEmbed: "Web \u65E0\u540C\u5C42/\u975E\u540C\u5C42\u5207\u6362\u6982\u5FF5\uFF08input \u59CB\u7EC8\u5728\u6587\u6863\u6D41\uFF09\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    confirmHold: "Web \u65E0\u6CD5\u63A7\u5236\u8F6F\u952E\u76D8\u6536\u8D77\u65F6\u673A\uFF08\u7531\u6D4F\u89C8\u5668/\u7CFB\u7EDF\u51B3\u5B9A\uFF09\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    adjustPosition: "Web \u7531\u6D4F\u89C8\u5668\u81EA\u8EAB\u5904\u7406\u952E\u76D8\u5F39\u8D77\u65F6\u7684\u89C6\u53E3\u6EDA\u52A8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    holdKeyboard: "Web \u65E0\u6CD5\u5728\u5931\u7126\u70B9\u51FB\u65F6\u4FDD\u6301\u952E\u76D8\uFF08\u6D4F\u89C8\u5668\u884C\u4E3A\uFF09\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    cursorColor: "Web \u8FD1\u4F3C\uFF1ACSS caret-color\uFF08\u5F53\u524D\u672A\u63A5\u7EBF\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A\uFF09",
    selectionStart: "Web \u8FD1\u4F3C\uFF1AsetSelectionRange\uFF08\u5F53\u524D\u672A\u63A5\u7EBF\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A\uFF09",
    selectionEnd: "Web \u8FD1\u4F3C\uFF1AsetSelectionRange\uFF08\u5F53\u524D\u672A\u63A5\u7EBF\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A\uFF09",
    placeholderClass: "Web \u65E0\u300C\u5360\u4F4D\u7B26\u4E13\u7528\u7C7B\u540D\u300D\u901A\u9053\uFF08::placeholder \u4E0D\u53EF\u627F\u63A5\u4EFB\u610F\u7C7B\uFF09\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordCertPath: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF08\u5BBF\u4E3B\u7EA7\u52A0\u5BC6\u952E\u76D8\uFF09\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordLength: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordTimeStamp: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordNonce: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordSalt: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    safePasswordCustomHash: "Web \u65E0\u5C0F\u7A0B\u5E8F\u5B89\u5168\u952E\u76D8\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A",
    reportSubmit: "formId \u662F\u5C0F\u7A0B\u5E8F\u6A21\u677F\u6D88\u606F\u5BBF\u4E3B\u80FD\u529B\uFF0CWeb \u65E0\u5BF9\u5E94 \u2192 \u5FFD\u7565\u5E76\u63D0\u793A",
    reportSubmitTimeout: "formId \u662F\u5C0F\u7A0B\u5E8F\u6A21\u677F\u6D88\u606F\u5BBF\u4E3B\u80FD\u529B\uFF0CWeb \u65E0\u5BF9\u5E94 \u2192 \u5FFD\u7565\u5E76\u63D0\u793A"
  };
  var HOST_TAGS = {
    "p-map": "Web \u6A21\u62DF\u5C42\u6E32\u67D3\u9759\u6001\u5360\u4F4D\u5BB9\u5668\uFF0C\u5FFD\u7565\u8BE5\u5730\u56FE\u663E\u793A\u53C2\u6570\u5E76\u63D0\u793A",
    "p-media": "Web \u7528\u539F\u751F <video>\uFF0C\u5FFD\u7565\u8BE5\u64AD\u653E\u5668\u5916\u89C2/\u4E13\u6709\u53C2\u6570\u5E76\u63D0\u793A",
    "p-camera": "Web \u65E0\u6444\u50CF\u5934\u5BBF\u4E3B\uFF0C\u5FFD\u7565\u8BE5\u91C7\u96C6\u53C2\u6570\u5E76\u63D0\u793A\uFF08\u53EF\u9000\u5316 getUserMedia \u65F6\u53E6\u884C\u5B9E\u73B0\uFF09",
    "p-ad": "Web \u65E0\u5BBF\u4E3B\u5E7F\u544A\uFF0C\u5FFD\u7565\u8BE5\u5E7F\u544A\u53C2\u6570\u5E76\u63D0\u793A",
    "p-canvas": "Web \u7528 HTMLCanvasElement\uFF0C\u5FFD\u7565\u8BE5\u5C0F\u7A0B\u5E8F\u6E32\u67D3\u4E0A\u4E0B\u6587\u4E13\u6709\u53C2\u6570\u5E76\u63D0\u793A",
    "p-webview": "Web \u7528 <iframe>\uFF0C\u5FFD\u7565\u8BE5\u5C0F\u7A0B\u5E8F web-view \u4E13\u6709\u53C2\u6570\u5E76\u63D0\u793A"
  };
  var WEB_EXTENSION_MP_FALLBACK = {
    density: "\u5C0F\u7A0B\u5E8F\u65E0 DPI \u5BC6\u5EA6\u6982\u5FF5\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A\uFF08rpx \u5DF2\u6309\u8BBE\u8BA1\u7A3F\u5BBD\u5EA6\u6362\u7B97\uFF09",
    designWidth: "\u5C0F\u7A0B\u5E8F\u7528 rpx \u57FA\u51C6\uFF08750\uFF09\uFF0C\u8BE5 Web \u4E13\u7528\u57FA\u51C6\u5FFD\u7565\u5E76\u63D0\u793A",
    searchable: "\u5C0F\u7A0B\u5E8F\u65E0\u5185\u5EFA\u641C\u7D22\u8BED\u4E49\uFF0C\u5FFD\u7565\u5E76\u63D0\u793A\uFF08\u7531\u4E1A\u52A1\u4FA7\u81EA\u7ED8\uFF09"
  };
  var TAG_PROP_MP_FALLBACK = {
    "p-stack": {
      snap: "\u5C0F\u7A0B\u5E8F view \u4E0D\u6EDA\u52A8\uFF08Skyline \u65E0 CSS overflow \u6EDA\u52A8\uFF0CS14 \u5B9E\u6D4B\uFF09\u2192 \u5438\u9644\u65E0\u8F7D\u4F53\uFF0C\u964D\u7EA7\u4E3A\u666E\u901A\u6392\u5217 + \u53EF\u89C2\u5BDF\u63D0\u793A\uFF1B\u9700\u7FFB\u9875\u8BF7\u7528 p-scroll-view \u7684 paging-enabled",
      loop: "\u56DE\u73AF\u4F9D\u8D56\u5438\u9644\u5BB9\u5668\uFF0C\u800C\u5C0F\u7A0B\u5E8F view \u4E0D\u6EDA\u52A8\uFF08S14\uFF09\u2192 \u4E00\u5E76\u964D\u7EA7\u4E3A\u666E\u901A\u6392\u5217 + \u53EF\u89C2\u5BDF\u63D0\u793A"
    }
  };
  var RULE_REGISTERED_PROPS = [
    ...Object.keys(PRIVATE_WEB_FALLBACK),
    ...Object.keys(STYLE_WEB_FALLBACK),
    ...Object.keys(WEB_EXTENSION_MP_FALLBACK),
    ...Object.keys(MP_HOST_WEB_FALLBACK),
    ...Object.values(TAG_PROP_MP_FALLBACK).flatMap((m) => Object.keys(m))
  ];
  var HOST_FALLBACK_TAGS = Object.keys(HOST_TAGS);
  function degradeProp(tag, prop) {
    const style = STYLE_WEB_FALLBACK[prop];
    if (style) return { mp: "supported", web: "fallback", behavior: style };
    const priv = PRIVATE_WEB_FALLBACK[prop];
    if (priv) return { mp: "supported", web: "fallback", behavior: priv };
    const mpHost = MP_HOST_WEB_FALLBACK[prop];
    if (mpHost) return { mp: "supported", web: "fallback", behavior: mpHost };
    if (tag && HOST_TAGS[tag]) {
      return { mp: "supported", web: "fallback", behavior: HOST_TAGS[tag] };
    }
    const tagProp = tag ? TAG_PROP_MP_FALLBACK[tag] : void 0;
    const tagPropBehavior = tagProp ? tagProp[prop] : void 0;
    if (tagPropBehavior) return { mp: "fallback", web: "supported", behavior: tagPropBehavior };
    const webExt = WEB_EXTENSION_MP_FALLBACK[prop];
    if (webExt) return { mp: "fallback", web: "supported", behavior: webExt };
    return { mp: "supported", web: "supported" };
  }
  function degradationOf(prim) {
    const out = {};
    for (const p of prim.props ?? []) out[p] = degradeProp(prim.tag, p);
    return out;
  }
  var DEGRADATION_TABLE = (() => {
    const out = {};
    for (const prim of PRIMITIVE_CATALOG) {
      if (!prim.tag) continue;
      out[prim.tag] = degradationOf(prim);
    }
    return out;
  })();
  var MP_UNSUPPORTED_PROPS = (() => {
    const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const out = {};
    for (const [tag, table] of Object.entries(DEGRADATION_TABLE)) {
      const set = /* @__PURE__ */ new Set();
      for (const [prop, entry] of Object.entries(table)) {
        if (entry.mp === "unsupported") set.add(kebab(prop));
      }
      if (set.size) out[tag] = set;
    }
    return out;
  })();
  var AnimCurve = {
    LINEAR: 0,
    EASE_OUT_CUBIC: 1,
    EASE_IN_CUBIC: 2,
    EASE_IN_OUT_CUBIC: 3,
    SPRING_APPROX: 4
  };
  var TABLE_N = 65;
  function springApprox(u) {
    return 1 - Math.exp(-6 * u) * Math.cos(10 * u);
  }
  function buildTable(curve) {
    const t = new Float64Array(TABLE_N);
    for (let i = 0; i < TABLE_N; i++) {
      const u = i / (TABLE_N - 1);
      t[i] = curve === AnimCurve.EASE_OUT_CUBIC ? 1 - (1 - u) ** 3 : curve === AnimCurve.EASE_IN_CUBIC ? u ** 3 : curve === AnimCurve.EASE_IN_OUT_CUBIC ? u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2 : curve === AnimCurve.SPRING_APPROX ? springApprox(u) : u;
    }
    t[0] = 0;
    t[TABLE_N - 1] = 1;
    return t;
  }
  var TABLES = [
    buildTable(AnimCurve.LINEAR),
    buildTable(AnimCurve.EASE_OUT_CUBIC),
    buildTable(AnimCurve.EASE_IN_CUBIC),
    buildTable(AnimCurve.EASE_IN_OUT_CUBIC),
    buildTable(AnimCurve.SPRING_APPROX)
  ];
  var PURE_CALLS = {
    // —— Math（纯计算）——
    "Math.abs": Math.abs,
    "Math.ceil": Math.ceil,
    "Math.floor": Math.floor,
    "Math.round": Math.round,
    "Math.trunc": Math.trunc,
    "Math.sign": Math.sign,
    "Math.sqrt": Math.sqrt,
    "Math.cbrt": Math.cbrt,
    "Math.pow": Math.pow,
    "Math.exp": Math.exp,
    "Math.log": Math.log,
    "Math.log2": Math.log2,
    "Math.log10": Math.log10,
    "Math.min": Math.min,
    "Math.max": Math.max,
    // —— 类型转换（call 形态，非 new）——
    "String": String,
    "Number": Number,
    "Boolean": Boolean,
    // —— 解析 / 判定（全局）——
    "parseInt": parseInt,
    "parseFloat": parseFloat,
    "isNaN": isNaN,
    "isFinite": isFinite,
    "Number.isFinite": Number.isFinite,
    "Number.isInteger": Number.isInteger,
    "Number.isNaN": Number.isNaN,
    // —— 数组判定 ——
    "Array.isArray": Array.isArray
  };
  var GLOBAL_CONST_MEMBERS = {
    "Math.PI": Math.PI,
    "Math.E": Math.E,
    "Math.LN2": Math.LN2,
    "Math.LN10": Math.LN10,
    "Math.LOG2E": Math.LOG2E,
    "Math.LOG10E": Math.LOG10E,
    "Math.SQRT2": Math.SQRT2,
    "Math.SQRT1_2": Math.SQRT1_2,
    "Number.MAX_SAFE_INTEGER": Number.MAX_SAFE_INTEGER,
    "Number.MIN_SAFE_INTEGER": Number.MIN_SAFE_INTEGER,
    "Number.EPSILON": Number.EPSILON,
    "Number.MAX_VALUE": Number.MAX_VALUE,
    "Number.MIN_VALUE": Number.MIN_VALUE
  };
  var HOST_DIRECTIVE_SPECS = {
    animate: {
      argKind: "anim-preset",
      argHint: "\u52A8\u753B\u9884\u8BBE\uFF08fade / slide-up / slide-down / slide-left / slide-right / zoom / fade-slide-up\uFF09",
      desc: "\u503C\u53D8\u5316\uFF08\u6216\u9996\u6B21\u6C42\u503C\u4E3A\u771F\uFF09\u65F6\u5728\u8BE5\u8282\u70B9**\u64AD\u4E00\u6B21**\u9884\u8BBE\u52A8\u753B\uFF08\u8D70\u5185\u6838\u52A8\u753B\u901A\u9053\uFF0C\u4E0E <Transition> \u540C\u4E00\u5957\uFF09\u3002\u8BED\u4E49\u5BF9\u9F50\uFF1A\u6307\u4EE4\u7684 mounted\uFF08\u9996\u8BC4 truthy \u5373\u64AD\uFF09\u4E0E updated\uFF08\u503C\u53D8\u5316\u5373\u64AD\uFF09\u3002"
    }
  };
  var HOST_DIRECTIVE_NAMES = Object.keys(HOST_DIRECTIVE_SPECS);

  // packages/render-backend/src/dispatcher.ts
  var DispatcherError = class extends Error {
    constructor(code, detail) {
      super(`unknown primitive tag: ${detail.type}\uFF08\u987B\u5728 G-32 \u539F\u8BED\u8868\u5185\uFF0C\u7F16\u8BD1\u671F\u62E6\u622A\uFF1B\u8FD0\u884C\u671F\u515C\u5E95\uFF09`);
      this.code = code;
      this.detail = detail;
      this.name = "DispatcherError";
    }
  };
  function createNodeOpsDispatcher(initialBackend) {
    let current = initialBackend;
    const history = [];
    const trace = [];
    let seq = 0;
    let handleIds = /* @__PURE__ */ new WeakMap();
    let nextHandleId = 1;
    function idOf(handle) {
      if (handle && typeof handle === "object") {
        let id = handleIds.get(handle);
        if (id === void 0) {
          id = nextHandleId++;
          handleIds.set(handle, id);
        }
        return id;
      }
      return 0;
    }
    function toIRNode(type, props = {}) {
      const cir = toComponentIR(type, props);
      if (!cir) throw new DispatcherError("unknown.primitive", { type });
      return { type: cir.tag, semantic: cir.semantic, props: { ...cir.props }, children: [] };
    }
    const nodeOps = {
      createElement(type, props = {}) {
        const ir = toIRNode(type, props);
        const handle = current.createElement(ir);
        trace.push({ seq: ++seq, op: "createElement", type, semantic: ir.semantic ?? type });
        return handle;
      },
      insert(child, parent, anchor) {
        current.insert(child, parent, anchor);
        trace.push({ seq: ++seq, op: "insert", child: idOf(child), parent: parent ? idOf(parent) : null, anchor: anchor ? idOf(anchor) : null });
      },
      remove(child) {
        current.remove(child);
        trace.push({ seq: ++seq, op: "remove", child: idOf(child) });
      },
      patchProp(el, key, prev, next) {
        current.patchProp(el, key, prev, next);
        trace.push({ seq: ++seq, op: "patchProp", el: idOf(el), key, next });
      },
      setText(el, text) {
        current.setText(el, text);
        trace.push({ seq: ++seq, op: "setText", el: idOf(el), text });
      },
      createText(text) {
        const handle = current.createElement({ type: "text", props: {}, children: [], semantic: void 0 });
        trace.push({ seq: ++seq, op: "createText", text });
        return handle;
      },
      createComment(text) {
        const handle = current.createElement({ type: "comment", props: {}, children: [] });
        trace.push({ seq: ++seq, op: "createComment", text });
        return handle;
      },
      parentNode(node) {
        const fn = current.parentNode;
        const r = fn ? fn(node) : null;
        trace.push({ seq: ++seq, op: "parentNode", node: idOf(node), result: r ? idOf(r) : null });
        return r ?? null;
      },
      nextSibling(node) {
        const fn = current.nextSibling;
        const r = fn ? fn(node) : null;
        trace.push({ seq: ++seq, op: "nextSibling", node: idOf(node), result: r ? idOf(r) : null });
        return r ?? null;
      }
    };
    return {
      get currentBackend() {
        return current;
      },
      switchBackend(next, opts) {
        const strategy = opts?.strategy ?? "rebuild";
        history.push(current);
        trace.push({ seq: ++seq, op: "switchBackend", from: current.id, to: next.id, strategy });
        current = next;
      },
      get switchHistory() {
        return history;
      },
      nodeOps,
      toIRNode,
      trace,
      clearTrace() {
        trace.length = 0;
        seq = 0;
        handleIds = /* @__PURE__ */ new WeakMap();
      }
    };
  }
  function renderIRTree(backend, ir, insertInto) {
    if (ir.type === "#text") return backend.createText(ir.text ?? "");
    const root = backend.createElement(ir);
    for (const child of ir.children) {
      const c = renderIRTree(backend, child);
      if (insertInto) insertInto(c, root);
      else backend.insert(c, root);
    }
    return root;
  }

  // packages/render-backend/src/headless.ts
  function toPlainTree(root) {
    return {
      id: root.id,
      type: root.type,
      props: { ...root.props },
      text: root.text,
      children: root.children.map(toPlainTree)
    };
  }
  var SEMANTIC_HEADLESS_MAP = {
    "layout.box": "box",
    "layout.stack": "stack",
    "layout.grid": "grid",
    "layout.fluid": "fluid",
    "layout.adaptive": "adaptive",
    "layout.fit": "fit",
    "layout.split": "split",
    "layout.safe": "safe",
    "layout.sidebar": "sidebar",
    "layout.formfactor": "formfactor",
    "ui.text": "text",
    "ui.button": "button",
    "ui.image": "image",
    "ui.input": "input",
    "ui.list": "list",
    "ui.nav": "nav",
    "capability.qr-code": "scan-qr",
    "capability.camera": "pick-photo",
    "capability.location": "location",
    // ★G-32 B1：新增 implemented 语义（与 component-ir SEMANTIC_BACKEND_MAP headless 列同源）
    "layout.inline": "inline",
    "layout.spacer": "spacer",
    "layout.divider": "divider",
    "layout.scroll": "scroll",
    "layout.virtual-list": "virtual-list",
    "layout.masonry": "masonry",
    "ui.heading": "heading",
    "ui.icon": "icon",
    "ui.textarea": "textarea",
    "ui.switch": "switch",
    "ui.slider": "slider",
    "shell.nav": "nav",
    "shell.tabbar": "tabbar",
    "shell.drawer": "drawer",
    "shell.modal": "modal",
    // ★G-32 B4：Shell 补齐 + UI 补齐（与 SEMANTIC_BACKEND_MAP headless 列同源）
    "shell.page": "page",
    "shell.segment": "segment",
    "shell.popover": "popover",
    "shell.action-sheet": "action-sheet",
    "shell.toast": "toast",
    "ui.loading": "loading",
    "ui.rich-text": "rich-text",
    "ui.avatar": "avatar",
    "ui.media": "media",
    "ui.canvas": "canvas",
    "ui.svg": "svg",
    "ui.select": "select",
    "ui.checkbox": "checkbox",
    "ui.radio": "radio",
    "ui.picker": "picker",
    "ui.form": "form",
    "gesture.draggable": "draggable",
    "gesture.scrollable": "scrollable",
    // ★G-32 B5 尾巴：E18 声明式导航（p-router-link）
    "engineering.router-link": "router-link",
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    "engineering.transition": "transition",
    "engineering.share-element": "share-element",
    "engineering.animate": "animate",
    // ★能力颗粒度对齐 C2
    "ui.progress": "progress",
    "ui.label": "label",
    "shell.page-container": "page-container",
    "ui.selection": "selection",
    "shell.keyboard-accessory": "keyboard-accessory",
    "ui.camera": "camera",
    "shell.webview": "webview",
    "shell.ad": "ad",
    "ui.map": "map"
  };
  var HEADLESS_CAPABILITIES = {
    layout: "none",
    // 框架 IR 求解（headless 无布局器）
    glass: "none",
    blur: "none",
    animation: "js",
    textureSharing: false,
    remoteRendering: false,
    ssr: true,
    input: ["touch"]
  };
  function createHeadlessBackend() {
    let nextId = 1;
    const nodes = /* @__PURE__ */ new Map();
    function ensureNode(handle) {
      const n = handle;
      if (!n || typeof n.id !== "number") throw new Error("HeadlessBackend: \u975E\u6CD5\u53E5\u67C4");
      return n;
    }
    return {
      id: "headless",
      version: "0.1.0",
      capabilities: HEADLESS_CAPABILITIES,
      createElement(node) {
        const viewType = node.semantic ? SEMANTIC_HEADLESS_MAP[node.semantic] ?? node.type : node.type;
        const n = {
          id: nextId++,
          type: viewType,
          props: { ...node.props },
          children: [],
          parent: null,
          text: ""
        };
        nodes.set(n.id, n);
        return n;
      },
      // ★2026-09-26 文本保留：'#text' → 文本节点（内存树）
      createText(text) {
        const n = {
          id: nextId++,
          type: "#text",
          props: {},
          children: [],
          parent: null,
          text
        };
        return n;
      },
      insert(child, parent, anchor) {
        const c = ensureNode(child);
        const p = ensureNode(parent);
        if (c.parent) {
          const oldIdx = c.parent.children.indexOf(c);
          if (oldIdx >= 0) c.parent.children.splice(oldIdx, 1);
        }
        if (anchor) {
          const a = ensureNode(anchor);
          const idx = p.children.indexOf(a);
          p.children.splice(idx >= 0 ? idx : p.children.length, 0, c);
        } else {
          p.children.push(c);
        }
        c.parent = p;
      },
      remove(child) {
        const c = ensureNode(child);
        if (c.parent) {
          const idx = c.parent.children.indexOf(c);
          if (idx >= 0) c.parent.children.splice(idx, 1);
          c.parent = null;
        }
        nodes.delete(c.id);
      },
      patchProp(el, key, prev, next) {
        const n = ensureNode(el);
        if (next === null || next === void 0) {
          delete n.props[key];
        } else {
          n.props[key] = next;
        }
      },
      setText(el, text) {
        ensureNode(el).text = text;
      },
      measure() {
        return { width: 0, height: 0 };
      }
    };
  }

  // packages/render-backend/src/flutter.ts
  var WIDGET_MAP = {
    view: "Container",
    text: "Text",
    button: "FilledButton",
    image: "Image",
    input: "TextField",
    textarea: "TextField",
    "scroll-view": "SingleChildScrollView",
    switch: "Switch",
    slider: "Slider",
    icon: "Icon",
    progress: "LinearProgressIndicator",
    navigator: "GestureDetector",
    "p-grid": "Wrap",
    "p-stack": "Flex",
    "p-split": "Row"
  };
  var SEMANTIC_FLUTTER_MAP = {
    "layout.box": "Container",
    "layout.stack": "Flex",
    "layout.grid": "GridView",
    "layout.fluid": "Wrap",
    "layout.adaptive": "showModal",
    "layout.fit": "IntrinsicWidth",
    "layout.split": "Row",
    "layout.safe": "SafeArea",
    "layout.sidebar": "NavigationRail",
    "layout.formfactor": "LayoutBuilder.formFactor",
    "ui.text": "Text",
    "ui.button": "FilledButton",
    "ui.image": "Image",
    "ui.input": "TextField",
    "ui.list": "ListView",
    "ui.nav": "Navigator",
    "capability.qr-code": "scanQR",
    "capability.camera": "pickPhoto",
    "capability.location": "getLocation",
    // ★G-32 B1：新增 implemented 语义
    "layout.inline": "InlineSpan",
    "layout.spacer": "Spacer",
    "layout.divider": "Divider",
    "layout.scroll": "ScrollView",
    "layout.virtual-list": "ListView",
    "layout.masonry": "SliverMasonryGrid",
    "ui.heading": "Text.heading",
    "ui.icon": "Icon",
    "ui.textarea": "TextField.multiline",
    "ui.switch": "Switch",
    "ui.slider": "Slider",
    "shell.nav": "AppBar",
    "shell.tabbar": "BottomNavigationBar",
    "shell.drawer": "Drawer",
    "shell.modal": "showDialog",
    // ★G-32 B4：Shell 补齐 + UI 补齐
    "shell.page": "Scaffold",
    "shell.segment": "SegmentedButton",
    "shell.popover": "showMenu",
    "shell.action-sheet": "showModalBottomSheet",
    "shell.toast": "ScaffoldMessenger.showSnackBar",
    "ui.loading": "CircularProgressIndicator",
    "ui.rich-text": "RichText",
    "ui.avatar": "CircleAvatar",
    "ui.media": "VideoPlayer",
    "ui.canvas": "CustomPaint",
    "ui.svg": "SvgPicture",
    "ui.select": "DropdownButton",
    "ui.checkbox": "Checkbox",
    "ui.radio": "Radio",
    "ui.picker": "showDatePicker",
    "ui.form": "Form",
    "gesture.draggable": "Draggable",
    "gesture.scrollable": "Scrollable",
    // ★G-32 B5 尾巴：E18 声明式导航（p-router-link）
    "engineering.router-link": "TextButton",
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    "engineering.transition": "AnimatedOpacity",
    "engineering.share-element": "Hero",
    // Flutter Hero 即共享元素
    "engineering.animate": "AnimationController",
    // ★能力颗粒度对齐 C2
    "ui.progress": "LinearProgressIndicator",
    "ui.label": "Text.label",
    "shell.page-container": "showModalBottomSheet",
    "ui.selection": "SelectableText",
    "shell.keyboard-accessory": "KeyboardAccessoryView",
    "ui.camera": "CameraPreview",
    "shell.webview": "WebView",
    "shell.ad": "AdWidget",
    "ui.map": "GoogleMap"
  };
  function mapWidgetType(type) {
    return WIDGET_MAP[type] ?? type;
  }
  function toWidgetTree(root) {
    return {
      id: root.id,
      widget: root.widget,
      props: { ...root.props },
      text: root.text,
      children: root.children.map(toWidgetTree)
    };
  }
  var FLUTTER_CAPABILITIES = {
    layout: "yoga",
    // Flutter 自带布局引擎（Yoga/C++——后端可选，spike 标注）
    glass: "L3",
    // Skia/Impeller 绘制玻璃（系统级渲染语义）
    blur: "true",
    animation: "native",
    // Flutter 动画管线
    textureSharing: true,
    // Texture/PlatformView 混合
    remoteRendering: false,
    ssr: false,
    input: ["touch", "cursor", "remote"]
  };
  function createFlutterBackend() {
    let nextId = 1;
    const nodes = /* @__PURE__ */ new Map();
    function ensureNode(handle) {
      const n = handle;
      if (!n || typeof n.id !== "number") throw new Error("FlutterBackend: \u975E\u6CD5\u53E5\u67C4");
      return n;
    }
    return {
      id: "flutter",
      version: "0.1.0",
      capabilities: FLUTTER_CAPABILITIES,
      createElement(node) {
        const widget = node.semantic ? SEMANTIC_FLUTTER_MAP[node.semantic] ?? mapWidgetType(node.type) : mapWidgetType(node.type);
        const descriptor = {
          id: nextId++,
          widget,
          props: { ...node.props },
          children: [],
          parent: null,
          text: ""
        };
        nodes.set(descriptor.id, descriptor);
        return descriptor;
      },
      // ★2026-09-26 文本保留：'#text' → Text widget 描述符
      createText(text) {
        const descriptor = {
          id: nextId++,
          widget: "Text",
          props: {},
          children: [],
          parent: null,
          text
        };
        return descriptor;
      },
      insert(child, parent, anchor) {
        const c = ensureNode(child);
        const p = ensureNode(parent);
        if (c.parent) {
          const oldIdx = c.parent.children.indexOf(c);
          if (oldIdx >= 0) c.parent.children.splice(oldIdx, 1);
        }
        if (anchor) {
          const a = ensureNode(anchor);
          const idx = p.children.indexOf(a);
          p.children.splice(idx >= 0 ? idx : p.children.length, 0, c);
        } else {
          p.children.push(c);
        }
        c.parent = p;
      },
      remove(child) {
        const c = ensureNode(child);
        if (c.parent) {
          const idx = c.parent.children.indexOf(c);
          if (idx >= 0) c.parent.children.splice(idx, 1);
          c.parent = null;
        }
        nodes.delete(c.id);
      },
      patchProp(el, key, prev, next) {
        const n = ensureNode(el);
        if (next === null || next === void 0) {
          delete n.props[key];
        } else {
          n.props[key] = next;
        }
      },
      setText(el, text) {
        ensureNode(el).text = text;
      },
      measure() {
        return { width: 0, height: 0 };
      }
    };
  }

  // packages/render-backend/src/host-conformance.ts
  function createHostRuntimeStub() {
    const rt = {
      id: "terminal",
      state: "created",
      threads: ["main"],
      workers: [],
      queue: [],
      bootstrap() {
        rt.state = "running";
        return rt;
      },
      suspend() {
        rt.state = "suspended";
      },
      resume() {
        rt.state = "running";
      },
      destroy() {
        rt.state = "destroyed";
        rt.queue = [];
        rt.workers = [];
      },
      createWorker() {
        const w = { id: `w${rt.workers.length + 1}`, thread: `worker${rt.workers.length + 1}` };
        rt.workers.push(w);
        rt.threads.push(w.thread);
        return w;
      },
      postMessage() {
        return true;
      },
      enqueue(task, priority = 2) {
        rt.queue.push({ task, priority });
      },
      nextTick(fn) {
        rt.queue.push({ task: fn, priority: 0 });
      },
      drain() {
        rt.queue.sort((a, b) => a.priority - b.priority);
        const out = [];
        while (rt.queue.length) rt.queue.shift();
        return out;
      }
    };
    return rt;
  }
  function createCarrierStub(kind) {
    return {
      id: kind,
      boundaries: 0,
      capabilities: kind === "jsi" ? { threadAffinity: true, trueConcurrency: false, realtime: { capable: false } } : { threadAffinity: false, trueConcurrency: true, realtime: { capable: true } },
      cross() {
        if (kind === "aot") return 0;
        this.boundaries++;
        return this.boundaries;
      }
    };
  }
  function buildProductIR(dispatch) {
    const grid = dispatch.toIRNode("p-grid", { minColWidth: 160 });
    const box1 = dispatch.toIRNode("p-box", {});
    const box2 = dispatch.toIRNode("p-box", {});
    const text = dispatch.toIRNode("p-text", { content: "\u5546\u54C1 A" });
    const button = dispatch.toIRNode("p-button", { variant: "primary" });
    return {
      ...dispatch.toIRNode("p-page", { title: "Product" }),
      children: [
        { ...grid, children: [{ ...box1, children: [text] }, { ...box2, children: [button] }] }
      ]
    };
  }
  var tests = [];
  var register = (group) => (id, fn) => tests.push({ id: `${group}-${id}`, group, fn });
  var H01 = register("H-01");
  var H02 = register("H-02");
  var H03 = register("H-03");
  var H04 = register("H-04");
  var H05 = register("H-05");
  var H06 = register("H-06");
  var H07 = register("H-07");
  var H08 = register("H-08");
  var assert = (c, m) => {
    if (!c) throw new Error(m ?? "assertion failed");
  };
  H01("01", ({ host }) => assert(host.state === "running", "Runtime \u5E94\u5DF2 bootstrap"));
  H01("02", ({ carrier }) => assert(carrier && carrier.id === "jsi", "Carrier \u5E94\u5DF2\u6CE8\u518C"));
  H01("03", ({ dispatch, backendA }) => assert(dispatch.currentBackend === backendA, "Backend \u5E94\u5DF2\u6CE8\u518C"));
  H01("04", ({ host, dispatch, backendA }) => assert(host.state === "running" && dispatch.currentBackend === backendA, "\u6CE8\u518C\u5148\u4E8E bootstrap\uFF08G-41.6\uFF09"));
  H02("01", ({ host }) => {
    host.suspend();
    assert(host.state === "suspended");
    host.resume();
  });
  H02("02", ({ host }) => assert(host.state === "running"));
  H02("03", ({ host }) => {
    const w = host.createWorker();
    assert(host.threads.includes(w.thread), "createWorker \u5E94\u4EA7\u751F\u72EC\u7ACB\u7EBF\u7A0B");
  });
  H02("04", ({}) => {
    const r2 = createHostRuntimeStub();
    r2.bootstrap();
    r2.enqueue(() => 1);
    r2.destroy();
    assert(r2.state === "destroyed" && r2.queue.length === 0, "destroy \u5E94\u6E05\u7406\u961F\u5217");
  });
  var snapA;
  var snapB;
  H03("01", ({ backendA, productIR }) => {
    const root = renderIRTree(backendA, productIR);
    snapA = JSON.stringify(toPlainTree(root));
    assert(snapA.includes("grid"), "Backend A \u6E32\u67D3\u5E94\u542B grid");
  });
  H03("02", ({ dispatch, backendB }) => {
    dispatch.switchBackend(backendB);
    assert(dispatch.currentBackend === backendB, "switchBackend \u5E94\u751F\u6548");
  });
  H03("03", ({ backendB, productIR }) => {
    const root = renderIRTree(backendB, productIR);
    snapB = JSON.stringify(toWidgetTree(root));
    assert(snapB.includes("GridView"), "Backend B \u6E32\u67D3\u5E94\u542B GridView");
  });
  H03("04", () => {
    assert(snapA && snapB, "\u53CC\u5F15\u64CE\u5FEB\u7167\u7F3A\u5931");
    assert(snapA.length > 0 && snapB.length > 0);
  });
  H04("01", ({ backendA, productIR }) => {
    const root = renderIRTree(backendA, productIR);
    const tree = JSON.stringify(toPlainTree(root));
    assert(tree.includes('"grid"'), "\u540E\u7AEF\u5E94\u57FA\u4E8E semantic \u5206\u53D1\uFF08G-37.1\uFF1Alayout.grid \u2192 grid\uFF09");
  });
  H04("02", ({ dispatch }) => {
    let threw = false;
    try {
      dispatch.toIRNode("p-unknown-thing", {});
    } catch (e) {
      threw = e instanceof DispatcherError;
    }
    assert(threw, "\u672A\u77E5\u539F\u8BED\u5E94\u88AB\u62E6\u622A\uFF08G-32.2\uFF1B\u7F16\u8BD1\u671F\u62E6\u622A\uFF0C\u8FD0\u884C\u671F\u5151\u5E95\uFF09");
  });
  H04("03", ({ host }) => {
    const before = host.threads.length;
    host.createWorker();
    assert(host.threads.length === before + 1, "\u6846\u67B6\u4E0D\u5F97\u76F4\u63A5\u5EFA\u7EBF\u7A0B\uFF0C\u987B\u59D4\u6258 runtime.createWorker\uFF08G-41.1\uFF09");
  });
  H04("04", () => {
    const src = createHeadlessBackend.toString() + createFlutterBackend.toString();
    assert(!/from ['"]vue['"]/.test(src) && !/@vue\/runtime/.test(src), "\u5F15\u64CE\u4E0D\u5F97 import vue\uFF08G-41.3\uFF09");
  });
  H04("05", ({ host }) => {
    const src = (host.constructor?.toString?.() ?? "") + createHostRuntimeStub.toString();
    assert(!/semantic\s*===/.test(src), "\u5BBF\u4E3B\u4E0D\u5F97\u89E3\u6790 IR \u5B57\u6BB5\uFF08G-41.2\uFF09");
  });
  H05("01", ({ dispatch, backendB }) => {
    dispatch.switchBackend(backendB);
    assert(dispatch.currentBackend === backendB, "\u70ED\u5207\u6362\u540E currentBackend \u5E94\u53D8\u66F4");
  });
  H05("02", ({ backendB, productIR }) => {
    const root = renderIRTree(backendB, productIR);
    assert(JSON.stringify(toWidgetTree(root)).includes("FilledButton"), "\u70ED\u5207\u6362\u540E\u53EF\u91CD\u65B0\u6E32\u67D3");
  });
  H05("03", ({ dispatch, backendA, productIR }) => {
    dispatch.switchBackend(backendA);
    const root = renderIRTree(backendA, productIR);
    assert(JSON.stringify(toPlainTree(root)).includes("button"), "\u5207\u56DE Backend A \u4ECD\u6B63\u786E");
  });
  H05("04", ({ backendA }) => {
    const cap2 = backendA.capabilities;
    assert(cap2 && typeof cap2 === "object", "\u540E\u7AEF\u5FC5\u987B\u58F0\u660E capabilities \u5BF9\u8C61");
    for (const key of ["layout", "glass", "blur", "animation", "textureSharing", "remoteRendering", "ssr", "input"]) {
      assert(key in cap2, `capabilities \u7F3A\u5931\u5B57\u6BB5: ${key}\uFF08G-37.3 \u8BDA\u5B9E\u58F0\u660E\uFF09`);
    }
  });
  H06("01", ({ backendA, backendB }) => assert(backendA !== backendB, "\u540C\u9875\u9762\u53EF\u6301\u6709\u591A\u4E2A Backend \u5B9E\u4F8B"));
  H06("02", ({}) => {
    const cir = toComponentIR("p-canvas", { engine: "skia", resolution: 2 });
    assert(cir !== null && cir.semantic === "ui.canvas" && cir.props.engine === "skia", "\u5F15\u64CE/\u5C5E\u6027\u5E94\u4F5C\u4E3A\u8BED\u4E49\u5C5E\u6027\u8FDB C-IR");
  });
  H06("03", ({}) => {
    const cir = toComponentIR("p-grid", { minColWidth: 160 });
    assert(cir !== null && cir.props.minColWidth === 160, "\u539F\u8BED\u5C5E\u6027\u5E94\u900F\u4F20\u8FDB C-IR");
  });
  H06("04", ({ dispatch, backendB }) => {
    dispatch.switchBackend(backendB);
    assert(dispatch.currentBackend === backendB, "Dispatcher \u5355\u5B9E\u4F8B\u652F\u6301\u591A\u540E\u7AEF\uFF08\u65B9\u6848 B\uFF09");
  });
  H07("01", ({ carrier }) => assert(typeof carrier.capabilities.threadAffinity === "boolean", "Carrier \u5E94\u58F0\u660E threadAffinity"));
  H07("02", ({}) => {
    const jsi = createCarrierStub("jsi");
    const aot = createCarrierStub("aot");
    assert(jsi.capabilities.trueConcurrency === false && aot.capabilities.trueConcurrency === true, "JSI \u53D7\u9650\u3001AOT \u4E0D\u53D7\u9650\uFF08G-40\uFF09");
  });
  H07("03", ({}) => {
    const aot = createCarrierStub("aot");
    aot.cross();
    aot.cross();
    assert(aot.boundaries === 0, "AOT \u8DE8\u754C\u6210\u672C\u4E3A 0");
  });
  H07("04", ({}) => {
    const jsi = createCarrierStub("jsi");
    const aot = createCarrierStub("aot");
    assert(jsi.capabilities.realtime.capable === false && aot.capabilities.realtime.capable === true, "realtime \u80FD\u529B\u4EC5\u5728 AOT \u53EF\u7528");
  });
  H08("01", ({ dispatch }) => {
    let ok = false;
    try {
      dispatch.toIRNode("div", {});
    } catch {
      ok = true;
    }
    assert(ok, "\u672A\u77E5\u539F\u8BED\u5E94\u629B\u9519\u800C\u975E\u9759\u9ED8");
  });
  H08("02", ({ dispatch }) => {
    const ir = dispatch.toIRNode("p-grid", { minColWidth: 160 });
    assert(ir.semantic === "layout.grid", "\u6846\u67B6\u8DEF\u5F84 semantic \u6052\u5B58\u5728\uFF08G-37.1\uFF1A\u540E\u7AEF\u6309 semantic \u5206\u53D1\u7684\u524D\u63D0\uFF09");
  });
  H08("03", ({}) => {
    const r = createHostRuntimeStub();
    r.bootstrap();
    r.destroy();
    assert(r.state === "destroyed", "destroy \u540E\u72B6\u6001\u5E94\u4E3A destroyed");
  });
  function runHostConformance(opts = {}) {
    const host = opts.host ?? createHostRuntimeStub();
    const carrier = opts.carrier ?? createCarrierStub("jsi");
    const backendA = opts.backendA ?? createHeadlessBackend();
    const backendB = opts.backendB ?? createFlutterBackend();
    const dispatch = createNodeOpsDispatcher(backendA);
    const productIR = buildProductIR(dispatch);
    const ctx = { host, carrier, backendA, backendB, dispatch, productIR };
    const results = [];
    host.bootstrap();
    snapA = "";
    snapB = "";
    for (const t of tests) {
      if (opts.only && !t.group.startsWith(opts.only)) continue;
      try {
        const ret = t.fn(ctx);
        if (ret === "SKIP") results.push({ id: t.id, status: "SKIP" });
        else results.push({ id: t.id, status: "PASS" });
      } catch (e) {
        results.push({ id: t.id, status: "FAIL", error: e.message });
      }
    }
    return {
      total: results.length,
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      skip: results.filter((r) => r.status === "SKIP").length,
      results
    };
  }

  // hosts/shared/bridge/entry-host-runtime.ts
  init_capability_app();

  // packages/router/src/app-stack.ts
  function paramKey(params) {
    if (!params) return "";
    return Object.keys(params).sort().filter((k) => params[k] !== void 0).map((k) => `${k}=${String(params[k])}`).join("&");
  }
  function createAppStack(opts) {
    const screens = opts.screens;
    const policy = {
      nodeBudget: null,
      keepWindow: 3,
      defaultScreenNodes: 64,
      ...opts.policy
    };
    const stack = [];
    const commands = [];
    const handlers = [];
    let seq = 0;
    let freezeCount = 0;
    let rebuildCount = 0;
    let overBudget = false;
    let activeNodeCount = 0;
    let frozenPrefix = 0;
    const emit = (e) => {
      for (const h of handlers) h(e);
    };
    function specOf(name) {
      const s = screens[name];
      if (!s) {
        throw new Error(`[app-stack] \u672A\u6CE8\u518C\u7684\u5C4F "${name}"\uFF08\u53EF\u7528\uFF1A${Object.keys(screens).join(", ") || "\uFF08\u7A7A\u6CE8\u518C\u8868\uFF09"}\uFF09`);
      }
      return s;
    }
    function makeRecord(name, params, transition) {
      const spec = specOf(name);
      return {
        screenId: `${name}#${++seq}`,
        name,
        path: spec.path,
        params: params ?? {},
        transition: transition ?? spec.transition,
        state: "hidden",
        // 调用方按角色置可见性（仅栈顶 mounted）
        needsRebuild: false,
        budgetNodes: spec.budgetNodes ?? policy.defaultScreenNodes
      };
    }
    function pushMount(rec, rebuild) {
      commands.push({ op: "mount", screenId: rec.screenId, name: rec.name, path: rec.path, params: rec.params, rebuild });
    }
    function activeNodes() {
      return activeNodeCount;
    }
    function applyMemoryPolicy() {
      overBudget = false;
      const budget = policy.nodeBudget;
      if (budget == null) return;
      if (activeNodeCount <= budget) return;
      const protectFrom = Math.max(0, stack.length - policy.keepWindow);
      while (activeNodeCount > budget) {
        let frozenOne = false;
        for (let i = frozenPrefix; i < protectFrom; i++) {
          const r = stack[i];
          if (r.state !== "hidden") continue;
          r.state = "frozen";
          r.needsRebuild = true;
          freezeCount++;
          commands.push({ op: "unmount", screenId: r.screenId, reason: "freeze" });
          activeNodeCount -= r.budgetNodes;
          while (frozenPrefix < stack.length && stack[frozenPrefix].state === "frozen") frozenPrefix++;
          emit({ type: "freeze", screenId: r.screenId, name: r.name, depth: stack.length });
          frozenOne = true;
          break;
        }
        if (!frozenOne) break;
      }
      overBudget = activeNodeCount > budget;
      if (overBudget) emit({ type: "over-budget", activeNodes: activeNodeCount, nodeBudget: budget });
    }
    function activateTop() {
      const top = stack[stack.length - 1];
      if (!top || top.state === "mounted") return;
      const rebuild = top.state === "frozen";
      top.state = "mounted";
      if (rebuild) {
        rebuildCount++;
        activeNodeCount += top.budgetNodes;
        pushMount(top, true);
        emit({ type: "restore", screenId: top.screenId, name: top.name, depth: stack.length });
      }
      commands.push({ op: "enter", screenId: top.screenId, transition: top.transition });
    }
    function deactivate(oldTop, transition) {
      if (!oldTop || oldTop.state !== "mounted") return;
      oldTop.state = "hidden";
      commands.push({ op: "exit", screenId: oldTop.screenId, transition });
    }
    function suspend(opts2) {
      const top = stack[stack.length - 1] ?? null;
      deactivate(top, opts2?.transition);
    }
    function resume() {
      if (stack.length === 0) return;
      activateTop();
    }
    function releaseTrees() {
      let released = 0;
      for (const r of stack) {
        if (r.state === "frozen") continue;
        if (r.state === "mounted") r.state = "hidden";
        activeNodeCount -= r.budgetNodes;
        r.state = "frozen";
        r.needsRebuild = true;
        freezeCount++;
        commands.push({ op: "unmount", screenId: r.screenId, reason: "freeze" });
        released++;
      }
      while (frozenPrefix < stack.length && stack[frozenPrefix].state === "frozen") frozenPrefix++;
      if (released > 0) emit({ type: "release", screens: released, depth: stack.length });
      return released;
    }
    function frames() {
      return stack.map((r) => {
        const f = { name: r.name };
        if (Object.keys(r.params).length > 0) f.params = { ...r.params };
        if (r.transition) f.transition = r.transition;
        return f;
      });
    }
    function push(name, params, o) {
      const oldTop = stack[stack.length - 1] ?? null;
      const rec = makeRecord(name, params, o?.transition);
      const t = rec.transition;
      deactivate(oldTop, t);
      pushMount(rec, false);
      rec.state = "mounted";
      stack.push(rec);
      activeNodeCount += rec.budgetNodes;
      commands.push({ op: "enter", screenId: rec.screenId, transition: t });
      applyMemoryPolicy();
      emit({ type: "push", name, depth: stack.length });
    }
    function popToIndex(targetIdx, exitTransition) {
      if (stack.length - 1 <= targetIdx) return null;
      const removed = [];
      while (stack.length - 1 > targetIdx) removed.push(stack.pop());
      commands.push({ op: "exit", screenId: removed[0].screenId, transition: exitTransition });
      for (const r of removed) {
        if (r.state !== "frozen") activeNodeCount -= r.budgetNodes;
        r.state = "destroyed";
        commands.push({ op: "unmount", screenId: r.screenId, reason: "pop" });
      }
      if (frozenPrefix > stack.length) frozenPrefix = stack.length;
      activateTop();
      return removed[0];
    }
    function pop(delta = 1) {
      const target = Math.max(0, stack.length - 1 - Math.max(1, delta));
      const oldTop = stack[stack.length - 1] ?? null;
      const removed = popToIndex(target, oldTop?.transition);
      if (!removed) return;
      applyMemoryPolicy();
      emit({ type: "pop", name: removed.name, depth: stack.length });
    }
    function replace(name, params, o) {
      const oldTop = stack[stack.length - 1] ?? null;
      if (oldTop) {
        commands.push({ op: "exit", screenId: oldTop.screenId, transition: o?.transition ?? oldTop.transition });
        commands.push({ op: "unmount", screenId: oldTop.screenId, reason: "pop" });
        stack.pop();
        if (oldTop.state !== "frozen") activeNodeCount -= oldTop.budgetNodes;
        oldTop.state = "destroyed";
        if (frozenPrefix > stack.length) frozenPrefix = stack.length;
      }
      const rec = makeRecord(name, params, o?.transition);
      pushMount(rec, false);
      rec.state = "mounted";
      stack.push(rec);
      activeNodeCount += rec.budgetNodes;
      commands.push({ op: "enter", screenId: rec.screenId, transition: rec.transition });
      applyMemoryPolicy();
      emit({ type: "replace", name, depth: stack.length });
    }
    function removeByName(name) {
      const removedIdx = [];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) removedIdx.push(i);
      }
      if (removedIdx.length === 0) return 0;
      const topIdx = stack.length - 1;
      const removedMounted = removedIdx.some((i) => stack[i].state === "mounted");
      const removedWasTop = removedIdx.includes(topIdx);
      for (const i of removedIdx) {
        const r = stack[i];
        if (r.state !== "frozen") activeNodeCount -= r.budgetNodes;
        r.state = "destroyed";
        commands.push({ op: "unmount", screenId: r.screenId, reason: "pop" });
      }
      for (const i of removedIdx) stack.splice(i, 1);
      if (frozenPrefix > stack.length) frozenPrefix = stack.length;
      if (removedMounted && removedWasTop && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.state !== "mounted") {
          const rebuild = top.state === "frozen";
          top.state = "mounted";
          if (rebuild) {
            rebuildCount++;
            activeNodeCount += top.budgetNodes;
            pushMount(top, true);
            emit({ type: "restore", screenId: top.screenId, name: top.name, depth: stack.length });
          }
          commands.push({ op: "enter", screenId: top.screenId, transition: top.transition });
        }
      }
      emit({ type: "pop", name, depth: stack.length });
      return removedIdx.length;
    }
    function moveToTop(name) {
      const idx = stack.findIndex((r) => r.name === name);
      if (idx < 0) {
        throw new Error(
          `[app-stack] moveToTop("${name}")\uFF1A\u6808\u4E2D\u4E0D\u5B58\u5728\u8BE5\u5C4F\uFF08\u5F53\u524D\u6808\uFF1A${stack.map((r) => r.name).join(" \u2192 ") || "\u7A7A"}\uFF09`
        );
      }
      const target = stack[idx];
      if (idx === stack.length - 1) return;
      const oldTop = stack[stack.length - 1];
      deactivate(oldTop, target.transition);
      stack.splice(idx, 1);
      stack.push(target);
      if (target.state !== "mounted") {
        const rebuild = target.state === "frozen";
        target.state = "mounted";
        if (rebuild) {
          rebuildCount++;
          activeNodeCount += target.budgetNodes;
          pushMount(target, true);
          emit({ type: "restore", screenId: target.screenId, name: target.name, depth: stack.length });
        }
      }
      commands.push({ op: "enter", screenId: target.screenId, transition: target.transition });
      emit({ type: "push", name, depth: stack.length });
    }
    function popTo(name) {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          idx = i;
          break;
        }
      }
      if (idx < 0) throw new Error(`[app-stack] popTo("${name}")\uFF1A\u6808\u4E2D\u4E0D\u5B58\u5728\u8BE5\u5C4F\uFF08\u5F53\u524D\u6808\uFF1A${stack.map((r) => r.name).join(" \u2192 ") || "\u7A7A"}\uFF09`);
      const oldTop = stack[stack.length - 1] ?? null;
      const removed = popToIndex(idx, oldTop?.transition);
      if (!removed) return;
      applyMemoryPolicy();
      emit({ type: "pop", name: removed.name, depth: stack.length });
    }
    function popToRoot() {
      const oldTop = stack[stack.length - 1] ?? null;
      if (stack.length <= 1) return;
      const removed = popToIndex(0, oldTop?.transition);
      if (!removed) return;
      applyMemoryPolicy();
      emit({ type: "pop", name: removed.name, depth: stack.length });
    }
    function resetTo(name, params) {
      while (stack.length) {
        const r = stack.pop();
        if (r.state !== "frozen") activeNodeCount -= r.budgetNodes;
        r.state = "destroyed";
        commands.push({ op: "unmount", screenId: r.screenId, reason: "reset" });
      }
      frozenPrefix = 0;
      const rec = makeRecord(name, params);
      pushMount(rec, false);
      rec.state = "mounted";
      stack.push(rec);
      activeNodeCount += rec.budgetNodes;
      commands.push({ op: "enter", screenId: rec.screenId, transition: rec.transition });
      applyMemoryPolicy();
      emit({ type: "reset", name, depth: stack.length });
    }
    function navigate(frames2) {
      for (const f of frames2) specOf(f.name);
      if (frames2.length === 0) {
        if (stack.length > 0) {
          resetEmpty();
        }
        return;
      }
      if (frames2.length === stack.length && frames2.every((f, i) => stack[i].name === f.name && paramKey(stack[i].params) === paramKey(f.params))) {
        return;
      }
      let common = 0;
      while (common < stack.length && common < frames2.length && stack[common].name === frames2[common].name && paramKey(stack[common].params) === paramKey(frames2[common].params)) {
        common++;
      }
      const oldTop = stack[stack.length - 1] ?? null;
      let popRemoved = null;
      let pushCount = 0;
      if (stack.length > common) {
        const removed = [];
        while (stack.length > common) removed.push(stack.pop());
        const t = frames2[common]?.transition ?? removed[0].transition;
        commands.push({ op: "exit", screenId: removed[0].screenId, transition: t });
        for (const r of removed) {
          if (r.state !== "frozen") activeNodeCount -= r.budgetNodes;
          r.state = "destroyed";
          commands.push({ op: "unmount", screenId: r.screenId, reason: "pop" });
        }
        popRemoved = removed[0];
        if (frozenPrefix > stack.length) frozenPrefix = stack.length;
      }
      if (oldTop && oldTop.state === "mounted" && stack[stack.length - 1] !== oldTop) {
        deactivate(oldTop, frames2[common]?.transition ?? oldTop.transition);
      }
      for (let i = common; i < frames2.length; i++) {
        const rec = makeRecord(frames2[i].name, frames2[i].params, frames2[i].transition);
        pushMount(rec, false);
        stack.push(rec);
        activeNodeCount += rec.budgetNodes;
        pushCount++;
      }
      activateTop();
      applyMemoryPolicy();
      if (popRemoved) emit({ type: "pop", name: popRemoved.name, depth: stack.length });
      if (pushCount > 0) {
        const top = stack[stack.length - 1];
        if (top) emit({ type: "push", name: top.name, depth: stack.length });
      }
    }
    function resetEmpty() {
      while (stack.length) {
        const r = stack.pop();
        if (r.state !== "frozen") activeNodeCount -= r.budgetNodes;
        r.state = "destroyed";
        commands.push({ op: "unmount", screenId: r.screenId, reason: "reset" });
      }
      frozenPrefix = 0;
      emit({ type: "reset", name: "", depth: 0 });
    }
    return {
      push,
      pop,
      replace,
      popTo,
      removeByName,
      moveToTop,
      popToRoot,
      tab: resetTo,
      reset: resetTo,
      navigate,
      markRebuilt(screenId) {
        const r = stack.find((s) => s.screenId === screenId);
        if (r) r.needsRebuild = false;
      },
      drainCommands() {
        const out = commands.slice();
        commands.length = 0;
        return out;
      },
      suspend,
      resume,
      releaseTrees,
      frames,
      current() {
        return stack[stack.length - 1] ?? null;
      },
      get stack() {
        return stack.slice();
      },
      get depth() {
        return stack.length;
      },
      stats() {
        let mounted = 0;
        let hidden = 0;
        let frozen = 0;
        for (const r of stack) {
          if (r.state === "mounted") mounted++;
          else if (r.state === "hidden") hidden++;
          else frozen++;
        }
        return {
          depth: stack.length,
          mounted,
          hidden,
          frozen,
          activeNodes: activeNodes(),
          nodeBudget: policy.nodeBudget,
          overBudget,
          freezeCount,
          rebuildCount
        };
      },
      on(handler) {
        handlers.push(handler);
        return () => {
          const i = handlers.indexOf(handler);
          if (i >= 0) handlers.splice(i, 1);
        };
      }
    };
  }

  // hosts/shared/bridge/entry-host-runtime.ts
  function globalHost() {
    if (typeof proteusHost === "undefined" || proteusHost === void 0) return null;
    return proteusHost;
  }
  var g = globalThis;
  var HOST_ID = g.__PROTEUS_HOST_ID__ ?? "quickjs-desktop";
  var BUILD_ID = "cfa346d4-133903";
  var FRAME_DRIVER = g.__PROTEUS_HOST_FRAME_DRIVER__ ?? "manual";
  var shellLog = [];
  var shellRt = null;
  function ensureShellRt() {
    if (!shellRt || shellRt.state === "destroyed") {
      shellRt = createQuickJsHostRuntime({ id: `${HOST_ID}-shell`, engine: "quickjs", frameDriver: FRAME_DRIVER });
      shellRt.bootstrap();
    }
    return shellRt;
  }
  function shellLifecycle(evt) {
    const rt = ensureShellRt();
    let applied = false;
    try {
      if (evt === "pause" && rt.state === "running") {
        rt.suspend();
        applied = true;
      } else if (evt === "resume" && rt.state === "suspended") {
        rt.resume();
        applied = true;
      }
    } catch {
      applied = false;
    }
    let capPhase = "unavailable";
    if (applied) {
      try {
        const bus = getHostLifecycleBus();
        bus.emit({ topic: "app", kind: evt === "pause" ? "hide" : "show" });
        capPhase = bus.snapshot().app;
      } catch {
      }
    }
    shellLog.push({ evt, applied, state: rt.state, cap_phase: capPhase });
    return shellLog.length;
  }
  globalThis.__proteusHostShellLifecycle = shellLifecycle;
  function shellQuery() {
    const suspends = shellLog.filter((e) => e.evt === "pause");
    const resumes = shellLog.filter((e) => e.evt === "resume");
    const capSnap = (() => {
      try {
        const bus = getHostLifecycleBus();
        const snap = bus.snapshot();
        return {
          app_phase: snap.app,
          page_phase: snap.page,
          subscribers: bus.subscriberCount
        };
      } catch {
        return { app_phase: "unavailable", page_phase: "unavailable", subscribers: -1 };
      }
    })();
    return JSON.stringify({
      hook_loaded: true,
      events: shellLog.length,
      suspend_requested: suspends.length,
      suspend_applied: suspends.filter((e) => e.applied).length,
      resume_requested: resumes.length,
      resume_applied: resumes.filter((e) => e.applied).length,
      final_state: shellRt ? shellRt.state : "none",
      log: shellLog,
      // ★能力开放：应用生命周期阶段由壳事件驱动后的最终态（应随 pause/resume 变化）
      cap_app_phase: capSnap.app_phase,
      cap_page_phase: capSnap.page_phase,
      cap_subscribers: capSnap.subscribers
    });
  }
  globalThis.__proteusHostShellQuery = shellQuery;
  function __proteusHostRun() {
    const host = globalHost();
    const transport = host && typeof host.memUsage === "function" ? {
      call: (name, _argsJson) => {
        if (name === "memUsage" && host.memUsage) return host.memUsage();
        if (name === "gc") {
          host.gc?.();
          return '"ok"';
        }
        throw new Error(`transport \u672A\u5B9E\u73B0 ${name}`);
      }
    } : void 0;
    const rt = createQuickJsHostRuntime({ id: HOST_ID, engine: "quickjs", frameDriver: FRAME_DRIVER, transport });
    const stateA0 = rt.state;
    rt.bootstrap();
    const stateA1 = rt.state;
    rt.suspend();
    const stateB1 = rt.state;
    rt.resume();
    const stateB2 = rt.state;
    let c1 = false;
    rt.suspend();
    try {
      rt.bootstrap();
    } catch {
      c1 = true;
    }
    let c2 = false;
    rt.resume();
    try {
      rt.resume();
    } catch {
      c2 = true;
    }
    let c3 = false;
    const refusalsBeforeDestroy = rt.refusals.length;
    rt.suspend();
    let ranWhileSuspended = false;
    rt.enqueue(() => {
      ranWhileSuspended = true;
    });
    const pumpWhileSuspended = rt.pumpFrame();
    rt.resume();
    const pumpAfterResume = rt.pumpFrame();
    const ranAfterResume = ranWhileSuspended;
    let inFrame = 0;
    rt.enqueue(() => {
      inFrame++;
      rt.enqueue(() => {
        inFrame++;
      });
    });
    const pumpInFrame = rt.pumpFrame();
    let e1 = false;
    try {
      rt.runOnThread("background", () => {
      });
    } catch {
      e1 = true;
    }
    const asyncState = { e2: false, e3: false, e3Value: "" };
    globalThis.__proteusHostAsync = asyncState;
    rt.invokeNative("native.not-registered").then(
      () => {
      },
      () => {
        asyncState.e2 = true;
      }
    );
    rt.registerNativeHandler("echo", (a) => a);
    rt.invokeNative("echo", { v: 1 }).then(
      (v) => {
        asyncState.e3 = true;
        asyncState.e3Value = JSON.stringify(v);
      },
      () => {
      }
    );
    let memOk = false;
    let memBefore = 0;
    let memAfterAlloc = 0;
    let memAfterGc = 0;
    let memObjBefore = 0;
    let memObjAfter = 0;
    let memScopeForReport = "none";
    if (transport) {
      let memScope = "unknown";
      const read = () => {
        const j = JSON.parse(transport.call("memUsage", "null"));
        memScope = j.scope ?? "engine";
        return { used: j.memory_used_size ?? 0, obj: j.obj_count ?? 0 };
      };
      const balloonBig = () => {
        const big = new Uint8Array(32 * 1024 * 1024);
        for (let i = 0; i < big.length; i += 4096) big[i] = 1;
        return big;
      };
      const smallBallast = () => {
        const ballast = [];
        for (let i = 0; i < 2e4; i++) ballast.push(i);
        return ballast;
      };
      let ballastHolder = null;
      const allocateBallast = (scope) => {
        ballastHolder = scope === "process" ? balloonBig() : smallBallast();
        globalThis.__proteusMemBallast = ballastHolder;
      };
      const releaseBallast = () => {
        ;
        globalThis.__proteusMemBallast = null;
      };
      const m0 = read();
      memBefore = m0.used;
      memObjBefore = m0.obj;
      allocateBallast(memScope);
      const m1 = read();
      memAfterAlloc = m1.used;
      memObjAfter = m1.obj;
      releaseBallast();
      ballastHolder = null;
      transport.call("gc", "null");
      const m2 = read();
      memAfterGc = m2.used;
      memOk = memAfterAlloc > memBefore && memAfterGc < memAfterAlloc;
      memScopeForReport = memScope;
    }
    const conf = runHostConformance({ host: rt });
    let c4 = false;
    rt.destroy();
    try {
      rt.destroy();
    } catch {
      c4 = true;
    }
    let c5 = false;
    try {
      rt.enqueue(() => {
      });
    } catch {
      c5 = true;
    }
    void c3;
    const capBus = getHostLifecycleBus();
    const capCaps = createAppLifecycleCapabilities(capBus, Error);
    const capLog = [];
    const lc = capCaps.getAppLifecycle();
    let launches = 0;
    lc.onLaunch(() => {
      launches++;
      capLog.push("app:launch");
    });
    lc.onShow(() => capLog.push("app:show"));
    lc.onHide(() => capLog.push("app:hide"));
    const pl = capCaps.getPageLifecycle();
    pl.onLoad(() => capLog.push("page:load"));
    pl.onShow(() => capLog.push("page:show"));
    pl.onHide(() => capLog.push("page:hide"));
    const capSpecs = {
      home: { name: "home", path: "/home" },
      detail: { name: "detail", path: "/detail" }
    };
    const capStack = createAppStack({ screens: capSpecs });
    const pageSrc = createStackPageSource(capBus);
    const feed = () => {
      for (const c of capStack.drainCommands()) pageSrc.apply(c);
    };
    capStack.push("home");
    feed();
    capStack.push("detail", { id: 1 });
    feed();
    capStack.pop();
    feed();
    const capPageAfterPop = capBus.snapshot().currentScreen;
    const shellSuspend = shellLog.filter((e) => e.evt === "pause" && e.applied).length;
    const shellResume = shellLog.filter((e) => e.evt === "resume" && e.applied).length;
    if (shellLog.length === 0) {
      capBus.emit({ topic: "app", kind: "show" });
    }
    const coldLaunchProbe = [];
    const probeOff = capBus.on("app:launch", () => coldLaunchProbe.push("cold"));
    probeOff();
    const capShellDriven = [];
    const offShellProbe = capBus.on("app:show", () => capShellDriven.push("show"));
    const offShellProbe2 = capBus.on("app:hide", () => capShellDriven.push("hide"));
    void offShellProbe;
    void offShellProbe2;
    const capPending = {
      bgReady: false,
      bgEvents: [],
      launchOptions: {},
      appPhase: capBus.snapshot().app,
      pagePhase: capBus.snapshot().page,
      pageAfterPop: capPageAfterPop,
      launches,
      log: capLog,
      sysLog: [],
      subscribers: capBus.subscriberCount
    };
    globalThis.__proteusCapPending = capPending;
    capBus.setLaunchOptions({ path: "pages/detail", query: { id: "7" } });
    const bg = capCaps.getBackground();
    bg.onEvent((e) => capPending.bgEvents.push(e.type));
    const sysLog = [];
    bg.onMemoryWarning((lv) => sysLog.push(`mem:${lv}`));
    bg.onThemeChange((t) => sysLog.push(`theme:${t}`));
    capBus.emit({ topic: "memory-warning", level: 2 });
    capBus.emit({ topic: "theme-change", theme: "dark" });
    capPending.sysLog = sysLog;
    void bg.getLaunchOptions().then((r) => {
      if (r.ok) capPending.launchOptions = r.data ?? {};
      capPending.appPhase = capBus.snapshot().app;
      capPending.pagePhase = capBus.snapshot().page;
      capPending.launches = launches;
      capPending.log = capLog;
      capPending.subscribers = capBus.subscriberCount;
      capPending.bgReady = true;
    });
    const appEventProbe = globalThis.__proteusAppEventProbe ?? {};
    globalThis.__proteusAppEventProbe = appEventProbe;
    void (async () => {
      try {
        const { getHostLifecycleBus: getBus, APP_EVENTS: ALL_APP_EVENTS } = await Promise.resolve().then(() => (init_capability_app(), capability_app_exports));
        const bus = getBus();
        if (appEventProbe.subscribed === void 0) {
          const seen = {};
          for (const e of ALL_APP_EVENTS) seen[e] = 0;
          for (const e of ALL_APP_EVENTS) {
            bus.on(`app:${e}`, () => {
              seen[e] = (seen[e] ?? 0) + 1;
            });
          }
          appEventProbe.seen = seen;
          appEventProbe.subscribed = ALL_APP_EVENTS.length;
        }
        appEventProbe.hostChannelInstalled = typeof globalThis.__proteusHostAppEvent === "function";
        const emitFn = globalThis.__proteusHostAppEvent;
        if (emitFn && appEventProbe.emitBadEvent === void 0) {
          appEventProbe.emitBadEvent = emitFn("not-a-real-event");
        }
        appEventProbe.done = true;
      } catch (e) {
        appEventProbe.fatal = String(e);
        appEventProbe.done = true;
      }
    })();
    const appPending = { done: false };
    globalThis.__proteusAppPending = appPending;
    void (async () => {
      try {
        const { createAppNativeCapabilities: createAppNativeCapabilities2 } = await Promise.resolve().then(() => (init_capability_app(), capability_app_exports));
        class DemoCapError extends Error {
          constructor(code, message, cause) {
            super(`[proteus-cap] ${code}: ${message}`);
            this.code = code;
            this.cause = cause;
            this.name = "CapError";
          }
        }
        const appCaps = createAppNativeCapabilities2(DemoCapError);
        appPending.hostContext = appCaps.getHostContext();
        const um = appCaps.getUpdateManager();
        appPending.updateCheck = await um.checkUpdate();
        appPending.updateApply = await um.applyUpdate();
        appPending.windowSetSize = await appCaps.getWindow().setSize(1024, 768);
        try {
          const w = appCaps.createWorker("demo.js");
          appPending.workerPost = w.postMessage({ ping: 1 });
          appPending.workerTerminate = w.terminate();
        } catch (e) {
          appPending.workerError = String(e);
        }
        let idleCalled = false;
        appPending.idleRequest = await appCaps.getIdle().request(() => {
          idleCalled = true;
        }, 100);
        appPending.idleCallbackRan = idleCalled;
        const pre = appCaps.getPreload();
        appPending.preloadAssets = await pre.assets([]);
        appPending.preloadSubpackage = await pre.subpackage("main");
        const ng = appCaps.getNavigationGuard();
        appPending.guardEnable = await ng.enable("\u6709\u672A\u4FDD\u5B58\u5185\u5BB9");
        appPending.guardDisable = await ng.disable();
        appPending.extensionLoad = await appCaps.loadExtension("demo-ext");
        appPending.navigateMiniProgram = await appCaps.navigateMiniProgram({ appId: "wx-demo" }).then(() => ({ ok: true }), (e) => ({ ok: false, code: e.code }));
        const wasmCaps = appCaps.getWebAssembly();
        appPending.wasmSupportsStreaming = wasmCaps.supportsStreaming;
        const ADD_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
        const inst = await wasmCaps.instantiate({ bytes: ADD_WASM }, { limits: { stackBytes: 65536, gasUnits: 1e6 } });
        if (inst.ok && inst.data) {
          const h = inst.data.__hostHandle;
          if (h) {
            const { invokeHost: rawInv } = await Promise.resolve().then(() => (init_capability_app(), capability_app_exports));
            const callRes = rawInv("webassembly.call", { handle: h, fn: "add", args: [2, 40] });
            appPending.wasmAddResult = callRes.ok ? callRes.data : { ok: false, reason: callRes.reason };
          } else {
            const ex = inst.data.exports;
            const fn = ex?.add;
            const val = typeof fn === "function" ? fn(2, 40) : null;
            appPending.wasmAddResult = { ok: true, result: val, type: "i32", engine: "engine-builtin" };
          }
          inst.data.dispose?.();
        } else {
          appPending.wasmAddResult = { ok: false, reason: inst.error?.message ?? "instantiate \u5931\u8D25" };
        }
        const wv = await wasmCaps.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        const wvErr = wv.error;
        appPending.wasmValidateEmptyModule = wv.ok ? { ok: true, data: wv.data } : { ok: false, code: wvErr?.code, message: String(wvErr?.message ?? "") };
      } catch (e) {
        appPending.fatal = String(e);
      }
      try {
        const { invokeHost: rawInvoke } = await Promise.resolve().then(() => (init_capability_app(), capability_app_exports));
        const rec = rawInvoke("native.calls");
        appPending.__hostCalls = rec.ok ? rec.data : { ok: false, reason: rec.reason };
      } catch (e) {
        appPending.__hostCalls = { ok: false, reason: String(e) };
      }
      appPending.done = true;
    })();
    const result = {
      ok: true,
      scene: "host-runtime",
      // ★平台标识（壳注入——判据按此分档：内存口径 engine/process、帧驱动源名）
      host_id: HOST_ID,
      frame_driver: FRAME_DRIVER,
      build_id: BUILD_ID,
      // A/B：生命周期
      state_created: stateA0,
      state_running: stateA1,
      state_suspended: stateB1,
      state_resumed: stateB2,
      // C：非法转换拒绝
      refuse_bootstrap_when_suspended: c1,
      refuse_double_resume: c2,
      refuse_destroy_twice: c4,
      refuse_enqueue_after_destroy: c5,
      refusals_recorded: refusalsBeforeDestroy,
      // D：队列/帧
      pump_while_suspended: pumpWhileSuspended,
      pump_after_resume: pumpAfterResume,
      ran_after_resume: ranAfterResume,
      pump_self_queued: pumpInFrame,
      // E：职责边界（同步部分）
      refuse_background_thread: e1,
      // E：职责边界（异步部分）
      // ★证据链：run 相位读一次（**必须 false**——Promise 续体不可能是同步完成的假象），
      //   finish 相位再读（**必须 true**——中间只有宿主侧的 job 泵能推动它；缺泵 ⇒ 恒 false ⇒ 判据红）
      async_resolved_at_run: asyncState.e2 || asyncState.e3,
      // F：内存账本（引擎真实 JS 堆读数——分配增长 / GC 下降）
      mem_available: !!transport,
      mem_before: memBefore,
      mem_after_alloc: memAfterAlloc,
      mem_after_gc: memAfterGc,
      mem_obj_before: memObjBefore,
      mem_obj_after: memObjAfter,
      mem_ok: memOk,
      mem_scope: memScopeForReport,
      // G：conformance
      conf_total: conf.total,
      conf_pass: conf.pass,
      conf_fail: conf.fail,
      conf_skip: conf.skip,
      conf_fail_ids: conf.results.filter((r) => r.status === "FAIL").map((r) => r.id),
      // 终态
      state_destroyed: rt.state,
      refusal_ops: rt.refusals.map((r) => r.op),
      // H：真实宿主壳转发（MainActivity.onPause/onResume → __proteusHostShellLifecycle）
      shell_hook_installed: typeof globalThis.__proteusHostShellLifecycle === "function",
      shell_lifecycle_logged: shellLog.length,
      shell_suspend_applied: shellLog.filter((e) => e.evt === "pause" && e.applied).length,
      shell_resume_applied: shellLog.filter((e) => e.evt === "resume" && e.applied).length,
      // I：应用与生命周期能力（C23/C24/C25）——同步读数；异步部分（bg_*）在 finish 相位补齐
      cap_log: capLog,
      cap_launches: launches,
      // ★冷启动补 launch 的独立证据：记录"第一个 show 事件到达时，launch 是否已随之前置"
      cap_launch_before_any_show: capLog.indexOf("app:launch") >= 0 && (capLog.indexOf("app:show") < 0 || capLog.indexOf("app:launch") < capLog.indexOf("app:show")),
      cap_page_after_pop: capPageAfterPop,
      cap_shell_suspend: shellSuspend,
      cap_shell_resume: shellResume,
      cap_shell_driven_events: capShellDriven.length,
      cap_subscribers: capBus.subscriberCount
    };
    return JSON.stringify(result);
  }
  globalThis.__proteusHostRun = __proteusHostRun;
  function __proteusHostFinish() {
    const st = globalThis.__proteusHostAsync;
    const cap2 = globalThis.__proteusCapPending;
    const app = globalThis.__proteusAppPending;
    return JSON.stringify({
      async_resolved: !!st && (st.e2 || st.e3),
      refuse_unregistered_native: st?.e2 ?? false,
      registered_native_ok: st?.e3 ?? false,
      registered_native_value: st?.e3Value ?? "",
      // I：能力开放的异步读数（useBackground 的 Promise 经 job 泵 resolved）
      cap_bg_ready: cap2?.bgReady ?? false,
      cap_bg_events: cap2?.bgEvents ?? [],
      cap_launch_options: cap2?.launchOptions ?? {},
      cap_app_phase: cap2?.appPhase ?? "PENDING",
      cap_page_phase: cap2?.pagePhase ?? "IDLE",
      cap_subscribers: cap2?.subscribers ?? -1,
      // J：App 端原生能力通道读数（**同一份业务代码在 App 端跑**）
      app_native: app ?? { done: false },
      // K：应用级生命周期事件源（真系统回调 → 总线）
      app_events: globalThis.__proteusAppEventProbe ?? { done: false }
    });
  }
  globalThis.__proteusHostFinish = __proteusHostFinish;
})();
