"use strict";
(() => {
  // packages/router/src/app-stack.ts
  var KEEP_ALIVE_TIERS = {
    none: true,
    active: true,
    all: true
  };
  function paramKey(params) {
    if (!params) return "";
    return Object.keys(params).sort().filter((k) => params[k] !== void 0).map((k) => `${k}=${String(params[k])}`).join("&");
  }
  function createAppStack(opts) {
    const screens2 = opts.screens;
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
    function specOf2(name) {
      const s = screens2[name];
      if (!s) {
        throw new Error(`[app-stack] \u672A\u6CE8\u518C\u7684\u5C4F "${name}"\uFF08\u53EF\u7528\uFF1A${Object.keys(screens2).join(", ") || "\uFF08\u7A7A\u6CE8\u518C\u8868\uFF09"}\uFF09`);
      }
      return s;
    }
    function makeRecord(name, params, transition) {
      const spec = specOf2(name);
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
      for (const f of frames2) specOf2(f.name);
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

  // packages/router/src/guards.ts
  var beforeGuards = [];
  var afterGuards = [];
  function beforeEach(guard) {
    beforeGuards.push(guard);
  }
  function afterEach(guard) {
    afterGuards.push(guard);
  }
  async function runBeforeEach(to, from, trace) {
    for (const g of beforeGuards) {
      const result = await g(to, from);
      if (result === false) {
        trace?.(`[guard] beforeEach \u2192 ${to.name ?? to.path} \u88AB\u62E6\u622A\uFF08\u5B88\u536B\u8FD4\u56DE false\uFF0C\u5BFC\u822A\u53D6\u6D88\uFF09`);
        return false;
      }
    }
    trace?.(`[guard] beforeEach \u2192 ${to.name ?? to.path} \u653E\u884C\uFF08${beforeGuards.length} \u4E2A\u5B88\u536B\uFF09`);
    return true;
  }
  async function runAfterEach(to, from, trace) {
    for (const g of afterGuards) g(to, from);
    trace?.(`[guard] afterEach \u2192 ${to.name ?? to.path}\uFF08${afterGuards.length} \u4E2A\u5B88\u536B\uFF09`);
  }

  // packages/router/src/skyline.ts
  function isSkyline() {
    if (typeof wx === "undefined" || !wx.getWindowInfo) return false;
    return typeof __PROTEUS_SKYLINE__ !== "undefined" && __PROTEUS_SKYLINE__;
  }
  function navigateWithCustomRoute(url, routeType) {
    return new Promise((resolve) => {
      wx.navigateTo({
        url,
        routeType,
        success: () => resolve(),
        fail: () => {
          wx.navigateTo({ url, success: () => resolve() });
        }
      });
    });
  }

  // packages/router/src/router-core.ts
  function currentFrom(routeMap2, pages) {
    if (pages.length === 0) return null;
    const path = pages[pages.length - 1].route;
    return routeMap2[path] || Object.values(routeMap2).find((r) => r.path === path) || null;
  }
  var Router = class {
    constructor(routeMap2, adapter, options = {}) {
      this.routeMap = routeMap2;
      this.adapter = adapter;
      this.options = options;
      /** 导航 traceId 自增（start/end 配对） */
      this.traceSeq = 0;
      /** ★Web 端非 push 导航（站内 <a> 链接 / 浏览器前进后退）补发 trace 的去重标志：push 内部导航时置位，onPageLoad 消费 */
      this.tracePending = false;
      /** 当前路由（onPageLoad 维护——非 push 导航的 from 基准） */
      this.lastRoute = "?";
      if (!adapter.isMP && typeof adapter.onPageLoad === "function") {
        const pages = adapter.getCurrentPages();
        this.lastRoute = (pages.length ? pages[pages.length - 1].route ?? "?" : "?") || "index";
        adapter.onPageLoad((route2, _query, _routeType, _nav) => {
          const normalized = route2 || "index";
          if (this.tracePending) {
            this.tracePending = false;
            this.lastRoute = normalized;
            return;
          }
          const bus = this.options.traceBus;
          const from = this.lastRoute;
          this.lastRoute = normalized;
          if (!bus) return;
          const name = "navigate " + normalized;
          const traceId = "nav-" + ++this.traceSeq;
          bus.emit("router", "start", name, { from: { path: from }, to: { path: normalized } }, traceId);
          bus.emit("router", "end", name, void 0, traceId);
        });
      }
    }
    /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1；App = 虚拟栈深） */
    get stackDepth() {
      return this.adapter.getCurrentPages().length;
    }
    /**
     * 注册前置守卫（M6：实例级 API，三端一致——delegate 到全局守卫注册表）
     * 用法：router.beforeEach((to, from) => { if (to.meta?.needLogin && !isLogin()) return false })
     */
    beforeEach(guard) {
      beforeEach(guard);
    }
    /** 注册后置守卫（M6：实例级 API，三端一致） */
    afterEach(guard) {
      afterEach(guard);
    }
    /** ★B11（router-plan 超级应用）：requiresAuth 自动守卫——未登录拦截（auth 检查器未配置时放行） */
    async authGuard(to, trace) {
      if (!to.meta?.requiresAuth || !this.options.auth) return true;
      const authed = await this.options.auth();
      if (authed) return true;
      trace?.(`[guard] requiresAuth \u2192 ${to.name ?? to.path} \u88AB\u62E6\u622A\uFF08\u672A\u767B\u5F55\uFF09`);
      this.options.onAuthFail?.();
      return false;
    }
    /** ★security M3：meta.permissions 自动守卫——缺权限拦截（permissions 检查器未配置时放行；PermissionRegistry.hasAll 直接可传） */
    async permissionGuard(to, trace) {
      const required = to.meta?.permissions;
      if (!required || !required.length || !this.options.permissions) return true;
      const ok = await this.options.permissions.hasAll(required);
      if (ok) return true;
      const denied = required[0];
      trace?.(`[guard] permissions \u2192 ${to.name ?? to.path} \u88AB\u62E6\u622A\uFF08\u7F3A\u6743\u9650 ${denied}\uFF09`);
      this.options.onPermissionFail?.(denied);
      return false;
    }
    /** 命名路由跳转（推荐）——泛型 N 由 name 字面量推断，params 类型自动匹配（类型提示全链路） */
    async push(options) {
      const target = this.resolve(options);
      if (!target) throw new Error(`[router] route not found: ${JSON.stringify(options)}`);
      const bus = this.options.traceBus;
      const navName = "navigate " + (target.name ?? target.path);
      const traceId = "nav-" + ++this.traceSeq;
      if (bus) {
        const pages = this.adapter.getCurrentPages();
        const top = pages.length ? pages[pages.length - 1] : void 0;
        const fromPath = top?.route || "index";
        bus.emit("router", "start", navName, { from: { path: fromPath }, to: { path: target.path, query: options.query } }, traceId);
      }
      const isDebug = typeof __PROTEUS_DEBUG__ !== "undefined" && __PROTEUS_DEBUG__;
      const trace = isDebug ? (msg) => console.log(msg) : void 0;
      const from = currentFrom(this.routeMap, this.adapter.getCurrentPages());
      if (!await this.authGuard(target, trace)) {
        bus?.emit("router", "point", "guard requiresAuth:cancel", void 0, traceId);
        bus?.emit("router", "end", navName, void 0, traceId);
        return;
      }
      if (!await this.permissionGuard(target, trace)) {
        bus?.emit("router", "point", "guard permissions:cancel", void 0, traceId);
        bus?.emit("router", "end", navName, void 0, traceId);
        return;
      }
      const guardResult = await runBeforeEach(target, from, trace);
      if (guardResult === false) {
        bus?.emit("router", "point", "guard beforeEach:cancel", void 0, traceId);
        bus?.emit("router", "end", navName, void 0, traceId);
        return;
      }
      bus?.emit("router", "point", "guard beforeEach:next", void 0, traceId);
      const url = this.buildUrl(target.path, { ...options.params, ...options.query });
      this.tracePending = true;
      try {
        if (options.routeType && isSkyline()) {
          await navigateWithCustomRoute(url, options.routeType);
        } else if (options.switchTab || target.meta?.isTab) {
          await this.adapter.switchTab({ url: target.path });
        } else if (options.replace) {
          await this.adapter.redirectTo({ url });
        } else if (options.reLaunch) {
          await this.adapter.reLaunch({ url });
        } else {
          if (this.adapter.isMP && this.stackDepth >= 9) {
            await this.adapter.redirectTo({ url });
          } else {
            await this.adapter.navigateTo({ url, routeType: options.routeType });
          }
        }
      } finally {
        this.tracePending = false;
      }
      await runAfterEach(target, from, trace);
      bus?.emit("router", "end", navName, void 0, traceId);
    }
    /** 后退 */
    back(delta = 1) {
      this.adapter.navigateBack({ delta });
    }
    /** 替换当前页 */
    replace(options) {
      return this.push({ ...options, replace: true });
    }
    /**
     * ★★回退到栈中最近的该名路由（启示 3 · 对齐鸿蒙 `popToName`）——**不传 delta，传名字**。
     * Web 端无栈概念 ⇒ 不支持时**明确报错**（不静默退化成 back()——那会跳错页）。
     */
    popTo(name) {
      if (!this.adapter.popTo) {
        throw new Error(
          `[router] popTo("${name}")\uFF1A\u5F53\u524D\u7AEF\u9002\u914D\u5668\u4E0D\u652F\u6301\u6309\u540D\u56DE\u9000\uFF08${this.adapter.isMP ? "\u5C0F\u7A0B\u5E8F" : "Web"} \u7AEF\u53D7\u5E73\u53F0\u6808\u8BED\u4E49\u9650\u5236\uFF09\u2014\u2014App \u7AEF\u5B8C\u6574\u652F\u6301\uFF1B\u5176\u4ED6\u7AEF\u8BF7\u7528 back(delta)`
        );
      }
      this.adapter.popTo(name);
    }
    /** ★★抹掉栈中该名路由（启示 3 · 对齐鸿蒙 `removeByName`）；返回移除数（0 = 栈中无此屏，幂等） */
    removeByName(name) {
      if (!this.adapter.removeByName) {
        throw new Error(`[router] removeByName("${name}")\uFF1A\u5F53\u524D\u7AEF\u9002\u914D\u5668\u4E0D\u652F\u6301\uFF08\u4EC5 App \u865A\u62DF\u6808\uFF09`);
      }
      return this.adapter.removeByName(name);
    }
    /** ★★把栈内该屏提到栈顶（启示 3 · 对齐鸿蒙 `moveToTop`）；中间屏原位保留 */
    moveToTop(name) {
      if (!this.adapter.moveToTop) {
        throw new Error(`[router] moveToTop("${name}")\uFF1A\u5F53\u524D\u7AEF\u9002\u914D\u5668\u4E0D\u652F\u6301\uFF08\u4EC5 App \u865A\u62DF\u6808\uFF09`);
      }
      this.adapter.moveToTop(name);
    }
    /** 根据命名路由/路径解析目标 */
    resolve(options) {
      if (options.name && this.routeMap[options.name]) return this.routeMap[options.name];
      if (options.path) {
        const found = Object.values(this.routeMap).find((r) => r.path === options.path || r.name === options.path);
        return found ?? null;
      }
      return null;
    }
    /** 拼接 URL（params + query → query string，自动 encode） */
    buildUrl(path, params) {
      if (!params) return `/${path}`;
      const qs = Object.entries(params).filter(([, v]) => v !== void 0).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
      return qs ? `/${path}?${qs}` : `/${path}`;
    }
  };
  function createRouterCore(routes2, options) {
    const { adapter, ...rest } = options;
    const routeMap2 = routes2.reduce((m, r) => {
      m[r.name] = r;
      return m;
    }, {});
    return new Router(routeMap2, adapter, rest);
  }

  // packages/router/src/app-adapter.ts
  function normPath(p) {
    return p.replace(/^\/+/, "").replace(/\/+$/, "");
  }
  function parseRouterUrl(url) {
    const [rawPath, rawQuery = ""] = url.split("?");
    const params = {};
    if (rawQuery) {
      for (const pair of rawQuery.split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = eq < 0 ? pair : pair.slice(0, eq);
        const v = eq < 0 ? "" : pair.slice(eq + 1);
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      }
    }
    return { path: rawPath ?? "", params };
  }
  function createAppNavigationAdapter(opts) {
    const { stack, pump, screens: screens2 } = opts;
    const byPath = /* @__PURE__ */ new Map();
    for (const spec of Object.values(screens2)) byPath.set(normPath(spec.path), spec.name);
    if (byPath.size === 0) {
      throw new Error("[app-adapter] \u5C4F\u6CE8\u518C\u8868\u4E3A\u7A7A\u2014\u2014App \u7AEF\u5BFC\u822A\u9700\u8981 screens\uFF08\u4E0E createAppStack \u540C\u6E90\uFF09");
    }
    const resolveName = (urlPath) => {
      const name = byPath.get(normPath(urlPath));
      if (!name) {
        throw new Error(
          `[app-adapter] \u672A\u77E5\u8DEF\u5F84 "${urlPath}"\uFF08\u5C4F\u6CE8\u518C\u8868\u65E0\u6B64\u5C4F\uFF09\u2014\u2014\u68C0\u67E5\u8DEF\u7531\u8868\u4E0E\u5C4F\u6CE8\u518C\u8868\u540C\u6E90\uFF1A\u53EF\u7528\u8DEF\u5F84 ${[...byPath.keys()].slice(0, 8).join(", ")}${byPath.size > 8 ? " \u2026" : ""}`
        );
      }
      return name;
    };
    let chain = Promise.resolve();
    const fire = () => {
      chain = chain.then(() => pump()).catch((e) => {
        console.error("[app-adapter] \u6CF5\u5931\u8D25\uFF1A", e);
      });
      return chain;
    };
    const flush = () => chain;
    const doUrl = (url) => {
      const { path, params } = parseRouterUrl(url);
      return { name: resolveName(path), params };
    };
    return {
      isMP: false,
      getCurrentPages() {
        return stack.stack.map((rec) => ({
          route: rec.path,
          query: Object.fromEntries(Object.entries(rec.params).map(([k, v]) => [k, String(v ?? "")]))
        }));
      },
      async navigateTo({ url }) {
        const { name, params } = doUrl(url);
        stack.push(name, params);
        await fire();
      },
      async redirectTo({ url }) {
        const { name, params } = doUrl(url);
        stack.replace(name, params);
        await fire();
      },
      async reLaunch({ url }) {
        const { name, params } = doUrl(url);
        stack.reset(name, params);
        await fire();
      },
      async switchTab({ url }) {
        const { name, params } = doUrl(url);
        stack.tab(name, params);
        await fire();
      },
      navigateBack({ delta }) {
        stack.pop(delta);
        void fire();
      },
      // ★★★（2026-10-02 · 启示 3）**App 专属栈原语**——Web/MP 受平台栈语义限制，App 虚拟栈完整支持
      //   （"App 端可解除 Skyline 硬限制"的又一兑现：按名回退/移除/提顶都不需要平台配合）
      popTo(name) {
        stack.popTo(name);
        void fire();
      },
      removeByName(name) {
        const n = stack.removeByName(name);
        void fire();
        return n;
      },
      moveToTop(name) {
        stack.moveToTop(name);
        void fire();
      },
      flush
    };
  }
  function screensFromRoutes(routes2) {
    const out = {};
    for (const r of routes2) {
      if (!r.name) {
        throw new Error(`[app-adapter] \u8DEF\u7531\u8868\u6761\u76EE\u7F3A name\uFF08path="${r.path}"\uFF09\u2014\u2014\u68C0\u67E5 gen-routes \u4EA7\u7269`);
      }
      const spec = { name: r.name, path: r.path };
      const t = r.meta?.transition;
      if (typeof t === "string") spec.transition = t;
      const b = r.meta?.budgetNodes;
      if (typeof b === "number" && b > 0) spec.budgetNodes = b;
      const ka = r.meta?.branch?.keepAlive;
      if (ka === "none" || ka === "active" || ka === "all") spec.keepAlive = ka;
      out[r.name] = spec;
    }
    return out;
  }

  // packages/router/src/branch-navigator.ts
  var OUTER_BRANCH = "#outer";
  function createBranchNavigator(opts) {
    const { screens: screens2, policy } = opts;
    const declared = opts.branches;
    const tabNames2 = opts.tabNames;
    if (!declared && !tabNames2) {
      throw new Error(
        "[branch-navigator] \u9700\u8981 tabNames \u6216 branches \u4E4B\u4E00\uFF08\u5206\u652F\u6E05\u5355\u7684\u6765\u6E90\u2014\u2014\u4E0D\u731C\uFF1BtabNames \u6765\u81EA auto-routes.ts \u4E0E screens \u540C\u6E90\u7684\u771F\u5B9E\u6295\u5F71\uFF09"
      );
    }
    const specList = [];
    const byName = /* @__PURE__ */ new Map();
    const materialize = (name, over) => {
      const spec = screens2[name];
      if (!spec) {
        throw new Error(
          `[branch-navigator] \u5206\u652F "${name}" \u4E0D\u5728\u5C4F\u6CE8\u518C\u8868\u4E2D\uFF08\u53EF\u7528\uFF1A${Object.keys(screens2).slice(0, 8).join(", ")}${Object.keys(screens2).length > 8 ? " \u2026" : ""}\uFF09`
        );
      }
      const tier = over?.keepAlive ?? spec.keepAlive ?? "active";
      if (!KEEP_ALIVE_TIERS[tier]) {
        throw new Error(`[branch-navigator] \u5206\u652F "${name}" \u7684 keepAlive="${String(tier)}" \u975E\u6CD5\uFF08\u5408\u6CD5\uFF1Anone / active / all\uFF09`);
      }
      const s = { name, root: over?.root || spec.path, keepAlive: tier };
      const t = over?.transition ?? spec.transition;
      if (t) s.transition = t;
      return s;
    };
    for (const b of declared ?? []) {
      if (byName.has(b.name)) continue;
      const s = materialize(b.name, b);
      byName.set(s.name, s);
      specList.push(s);
    }
    for (const name of tabNames2 ?? []) {
      if (byName.has(name)) continue;
      const s = materialize(name);
      byName.set(s.name, s);
      specList.push(s);
    }
    if (specList.length === 0) {
      throw new Error("[branch-navigator] \u5206\u652F\u6E05\u5355\u4E3A\u7A7A\u2014\u2014tabNames \u4E0E branches \u90FD\u672A\u63D0\u4F9B\u6709\u6548\u5206\u652F\uFF08\u68C0\u67E5 isTab \u9875\u9762\uFF09");
    }
    const initial = opts.initial ?? specList[0].name;
    if (!byName.has(initial)) {
      throw new Error(
        `[branch-navigator] initial="${initial}" \u4E0D\u5728\u5206\u652F\u6E05\u5355\u4E2D\uFF08\u53EF\u7528\uFF1A${specList.map((s) => s.name).join(", ")}\uFF09`
      );
    }
    const records = /* @__PURE__ */ new Map();
    const handlers = [];
    const commands = [];
    let activeName = initial;
    let clockSeq = 0;
    let lastFrom = initial;
    const emit = (e) => {
      for (const h of handlers) h(e);
    };
    function recordOf(name) {
      const r = records.get(name);
      if (!r) {
        throw new Error(`[branch-navigator] \u672A\u77E5\u5206\u652F "${name}"\uFF08\u53EF\u7528\uFF1A${specList.map((s) => s.name).join(", ")}\uFF09`);
      }
      return r;
    }
    for (const spec of specList) {
      records.set(spec.name, { spec, stack: createAppStack({ screens: screens2, ...policy ? { policy } : {} }) });
    }
    const parent = opts.parent ?? null;
    function flushInto(branch, stack) {
      for (const c of stack.drainCommands()) commands.push({ ...c, branch });
    }
    function ensureRoot(r) {
      if (r.stack.depth === 0) r.stack.push(r.spec.name);
    }
    function activateBranch(target, from) {
      const t = target.spec.transition;
      if (from) {
        from.stack.suspend(t ? { transition: t } : void 0);
        flushInto(from.spec.name, from.stack);
      }
      if (target.stack.depth === 0) ensureRoot(target);
      target.stack.resume();
      flushInto(target.spec.name, target.stack);
      for (const d of keepAlivePolicy()) {
        if (d.keep) continue;
        const r = recordOf(d.branch);
        if (r.stack.depth === 0) continue;
        const released = r.stack.releaseTrees();
        if (released > 0) {
          emit({ type: "release", branch: d.branch, screens: released });
          flushInto(d.branch, r.stack);
        }
      }
    }
    function branchOrder() {
      return specList.map((s) => s.name);
    }
    function switchTo(name) {
      const target = recordOf(name);
      const from = recordOf(activeName);
      if (from === target) {
        emit({ type: "switch-noop", branch: name });
        return;
      }
      lastFrom = from.spec.name;
      activeName = name;
      activateBranch(target, from);
      clockSeq++;
      emit({ type: "switch", from: lastFrom, to: name, seq: clockSeq });
    }
    function navigate(branch, frames) {
      const r = recordOf(branch);
      const f = frames.length > 0 ? [...frames] : [{ name: r.spec.name }];
      if (f[0].name !== r.spec.name) f.unshift({ name: r.spec.name });
      const before = JSON.stringify(r.stack.frames());
      r.stack.navigate(f);
      flushInto(r.spec.name, r.stack);
      const rebuilt = JSON.stringify(r.stack.frames()) !== before;
      emit({ type: "navigate", branch, depth: r.stack.depth, rebuilt });
      return r.stack;
    }
    function handToOuter(branch) {
      emit({ type: "back-outer", branch });
      if (parent && parent.depth > 1) {
        parent.pop(1);
        flushInto(OUTER_BRANCH, parent);
        return { action: "outer", branch };
      }
      emit({ type: "back-system" });
      return { action: "system" };
    }
    function back(delta = 1) {
      const r = recordOf(activeName);
      if (r.stack.depth > 1) {
        const top = r.stack.current();
        r.stack.pop(delta);
        flushInto(r.spec.name, r.stack);
        const depth = r.stack.depth;
        emit({ type: "back", branch: activeName, popped: top.name, depth });
        return { action: "pop", branch: activeName, popped: top.name, depth };
      }
      return handToOuter(activeName);
    }
    function keepAlivePolicy() {
      const idx = specList.findIndex((s) => s.name === activeName);
      return specList.map((s, i) => {
        if (s.name === activeName) return { branch: s.name, keep: true };
        if (s.keepAlive === "all") return { branch: s.name, keep: true };
        if (s.keepAlive === "none") return { branch: s.name, keep: false };
        const adjacent = idx >= 0 && (i === idx - 1 || i === idx + 1);
        return { branch: s.name, keep: adjacent };
      });
    }
    function drainCommands() {
      for (const name of branchOrder()) {
        const r = recordOf(name);
        flushInto(name, r.stack);
      }
      if (parent) flushInto(OUTER_BRANCH, parent);
      const out = commands.slice();
      commands.length = 0;
      return out;
    }
    ensureRoot(recordOf(initial));
    return {
      branches: specList.map((s) => ({ ...s })),
      active: () => activeName,
      switchTo,
      stackOf(name) {
        return recordOf(name).stack;
      },
      activeStack() {
        return recordOf(activeName).stack;
      },
      navigate,
      back,
      keepAlivePolicy,
      drainCommands,
      snapshot() {
        return { active: activeName, frames: recordOf(activeName).stack.frames() };
      },
      clock() {
        return { seq: clockSeq, from: lastFrom, to: activeName };
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

  // packages/router/src/app-route.ts
  function createRouter(routes2, options) {
    return createRouterCore(routes2, options);
  }

  // packages/contracts/src/layers.ts
  var LAYER_PRIMITIVES = ["layer-content", "layer-navigation", "layer-mask", "layer-popout"];

  // packages/contracts/src/mount-layers.ts
  var MOUNT_LAYERS = ["global", "page", "overlay"];
  var MOUNT_LAYER_ORDER = {
    global: 0,
    page: 1,
    overlay: 2
  };
  var MOUNT_LAYER_NODE_OFFSET = {
    global: 1,
    page: 2,
    overlay: 3
  };
  function mountLayerContainerPlans() {
    return [...MOUNT_LAYERS].sort((a, b) => MOUNT_LAYER_ORDER[a] - MOUNT_LAYER_ORDER[b]).map((layer) => ({
      layer,
      nodeOffset: MOUNT_LAYER_NODE_OFFSET[layer],
      order: MOUNT_LAYER_ORDER[layer],
      frame: "fullscreen"
    }));
  }

  // packages/contracts/src/scroll.ts
  var DOCK_REQUIRES_LAYER = LAYER_PRIMITIVES.includes("layer-navigation");

  // packages/render-backend/src/screen-executor.ts
  function createScreenExecutor(opts) {
    const { host, anim, plan, contentOf, onScreenMounted, onEvent } = opts;
    const nodes = /* @__PURE__ */ new Map();
    const stats = {
      commands: 0,
      transitions: 0,
      forward: 0,
      back: 0,
      skippedNone: 0,
      destroyed: { pop: 0, reset: 0, freeze: 0 },
      visibility: { shown: 0, hidden: 0 },
      mounts: { first: 0, rebuild: 0 },
      errors: []
    };
    let txn = { exiting: null, mounted: /* @__PURE__ */ new Map() };
    const emit = (type, screenId, detail) => {
      onEvent?.({ type, screenId, detail });
    };
    async function runCommand(cmd) {
      stats.commands++;
      switch (cmd.op) {
        case "mount": {
          const rebuild = cmd.rebuild === true;
          const name = cmd.name ?? cmd.screenId;
          const path = cmd.path ?? "";
          const content = contentOf?.({ name, path });
          const node = await host.mountScreen({
            screenId: cmd.screenId,
            name,
            path,
            params: cmd.params ?? null,
            rebuild,
            ...content ? { content } : {},
            // ★GP3-c：三层容器计划（由**契约**算，宿主只消费——偏移量而非绝对 id，见类型注释）
            layerContainers: mountLayerContainerPlans()
          });
          nodes.set(cmd.screenId, node);
          txn.mounted.set(cmd.screenId, rebuild);
          if (rebuild) stats.mounts.rebuild++;
          else stats.mounts.first++;
          emit("mount", cmd.screenId, { rebuild, node, contentNodes: content?.nodes.length ?? 0 });
          onScreenMounted?.(cmd.screenId, rebuild);
          return;
        }
        case "exit": {
          txn.exiting = { screenId: cmd.screenId, transition: cmd.transition, destroy: null };
          emit("exit", cmd.screenId, { transition: cmd.transition });
          return;
        }
        case "unmount": {
          const reason = cmd.reason ?? "pop";
          if (txn.exiting && txn.exiting.screenId === cmd.screenId) {
            txn.exiting.destroy = reason;
            emit("unmount-deferred", cmd.screenId, { reason });
            return;
          }
          await host.destroyScreen(cmd.screenId, reason, nodes.get(cmd.screenId));
          nodes.delete(cmd.screenId);
          stats.destroyed[reason]++;
          emit("destroy", cmd.screenId, { reason });
          return;
        }
        case "enter": {
          const incomingNode = nodes.get(cmd.screenId);
          if (incomingNode === void 0) {
            stats.errors.push(`enter(${cmd.screenId})\uFF1A\u5C4F\u5B50\u6811\u4E0D\u5B58\u5728\uFF08mount \u672A\u6267\u884C\uFF1F\uFF09`);
            emit("error", cmd.screenId, "enter-without-subtree");
            return;
          }
          const exiting = txn.exiting;
          const outgoingNode = exiting ? nodes.get(exiting.screenId) : void 0;
          const mountedHere = txn.mounted.get(cmd.screenId);
          const direction = mountedHere === false ? "forward" : "back";
          const transition = cmd.transition;
          const batch = plan(transition, { incoming: incomingNode, outgoing: outgoingNode }, { direction });
          const normalized = typeof transition === "string" ? transition : "none";
          await host.setScreenVisible(cmd.screenId, true, incomingNode);
          stats.visibility.shown++;
          emit("visible", cmd.screenId, true);
          const hasAnims = batch.incoming.anims.length > 0 || batch.outgoing.anims.length > 0;
          if (hasAnims) {
            await anim.playRouteTransition(batch, { direction, transition: normalized });
            stats.transitions++;
            if (direction === "forward") stats.forward++;
            else stats.back++;
            emit("transition", cmd.screenId, { direction, transition: normalized, anims: batch.incoming.anims.length + batch.outgoing.anims.length });
          } else {
            stats.skippedNone++;
            emit("transition-skipped", cmd.screenId, { transition: normalized });
          }
          if (exiting) {
            if (exiting.destroy !== null) {
              await host.destroyScreen(exiting.screenId, exiting.destroy, outgoingNode);
              nodes.delete(exiting.screenId);
              stats.destroyed[exiting.destroy]++;
              emit("destroy", exiting.screenId, { reason: exiting.destroy, deferred: true });
            } else if (outgoingNode !== void 0) {
              await host.setScreenVisible(exiting.screenId, false, outgoingNode);
              stats.visibility.hidden++;
              emit("visible", exiting.screenId, false);
            }
          }
          txn = { exiting: null, mounted: /* @__PURE__ */ new Map() };
          return;
        }
      }
    }
    let queue = Promise.resolve();
    return {
      applyCommands(commands) {
        queue = queue.then(async () => {
          for (const c of commands) await runCommand(c);
        });
        return queue;
      },
      stats: () => JSON.parse(JSON.stringify(stats)),
      subtreeNode: (screenId) => nodes.get(screenId)
    };
  }

  // packages/render-backend/src/screen-executor-host.ts
  var SCREEN_ANIM_DONE_KEY = "__proteusHostScreenAnimDone";
  var instSeq = 0;
  function call(channel, method, args) {
    const raw = channel(method, JSON.stringify(args ?? null));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`[screen-host] ${method} \u56DE\u6267\u975E JSON\uFF1A${String(raw).slice(0, 120)}`);
    }
    if (parsed && parsed.ok === false) {
      throw new Error(`[screen-host] ${method} \u5931\u8D25${parsed.missing ? "\uFF08\u672A\u5B9E\u73B0\uFF09" : ""}\uFF1A${parsed.reason ?? "\u65E0\u539F\u56E0"}`);
    }
    return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
  }
  function createHostScreenPorts(opts) {
    const channel = opts.invoke;
    const pending = /* @__PURE__ */ new Map();
    let tokenSeq = 0;
    let hookInstalled = false;
    const INSTANCE_ID = `s${++instSeq}-`;
    const resolveOne = (token, payload) => {
      const r = pending.get(token);
      if (!r) return false;
      pending.delete(token);
      r(payload);
      return true;
    };
    if (opts.installAnimDoneHook !== false) {
      const g = globalThis;
      const REGISTRY_KEY = `${SCREEN_ANIM_DONE_KEY}__registry`;
      let registry = g[REGISTRY_KEY];
      if (!Array.isArray(registry)) {
        registry = [];
        g[REGISTRY_KEY] = registry;
      }
      const handler = (token, resultJson) => {
        if (typeof token !== "string") return "bad-token";
        const r = registry;
        for (let i = 0; i < r.length; i++) {
          if (r[i](token, resultJson)) return "ok";
        }
        return "unknown-token";
      };
      registry.push((token, payload) => resolveOne(token, payload));
      try {
        g[SCREEN_ANIM_DONE_KEY] = handler;
        hookInstalled = true;
      } catch {
        try {
          Object.defineProperty(g, SCREEN_ANIM_DONE_KEY, { value: handler, writable: true, configurable: true });
          hookInstalled = true;
        } catch {
        }
      }
    }
    const tree = {
      mountScreen(screen) {
        const d = call(channel, "screen.mount", {
          screenId: screen.screenId,
          name: screen.name,
          path: screen.path,
          params: screen.params,
          rebuild: screen.rebuild,
          // ★★★GP3-c：**三层容器计划**随 mount 下发（宿主照此建树——偏移量，宿主加到自己分配的根 id 上）。
          //   执行器已按契约算好（见 screen-executor.ts）；本层只做**透传**（不再重复计算——
          //   本仓纪律：同一件事两份实现 = 修一份等于没修）。
          ...screen.layerContainers ? { layerContainers: screen.layerContainers } : {},
          // ★★★阶段 1（2026-10-04 · App 三端对齐 B1+B2）：**屏内容**（真实页面渲染产物）透传。
          //   执行器按 `contentOf` 提供者解析后放入 mountScreen 入参；本层只做转发（与上方同款纪律）。
          ...screen.content ? { content: screen.content } : {}
        });
        const rootNodeId = Number(d?.rootNodeId ?? 0);
        if (!rootNodeId) {
          throw new Error(`[screen-host] screen.mount \u672A\u8FD4\u56DE rootNodeId\uFF08${JSON.stringify(d)}\uFF09\u2014\u2014\u5BBF\u4E3B\u5B9E\u73B0\u4E0D\u5B8C\u6574`);
        }
        return rootNodeId;
      },
      setScreenVisible(screenId, visible, rootNodeId) {
        call(channel, "screen.visible", { screenId, visible, rootNodeId });
      },
      destroyScreen(screenId, reason, rootNodeId) {
        call(channel, "screen.destroy", { screenId, reason, rootNodeId });
      }
    };
    const anim = {
      playRouteTransition(plan, ctx) {
        const anims = [...plan.incoming.anims, ...plan.outgoing.anims];
        if (anims.length === 0) return;
        const token = `${INSTANCE_ID}screen-anim-${++tokenSeq}`;
        const d = call(channel, "screen.anim", {
          anims,
          durationMs: plan.durationMs,
          direction: ctx.direction,
          transition: ctx.transition,
          token
        });
        if (d?.immediate === true) return;
        return new Promise((resolve) => {
          pending.set(token, () => resolve());
        });
      }
    };
    return {
      tree,
      anim,
      shared: {
        async rect(screenId, nodeId) {
          const d = call(channel, "screen.rect", { screenId, nodeId });
          if (!d || typeof d.x !== "number") {
            throw new Error(`[screen-host] screen.rect \u672A\u8FD4\u56DE\u51E0\u4F55\uFF08${JSON.stringify(d)}\uFF09`);
          }
          return { x: d.x, y: d.y ?? 0, w: d.width ?? 0, h: d.height ?? 0 };
        },
        fly(opts2) {
          const token = `screen-shared-${++tokenSeq}`;
          const d = call(channel, "screen.shared", { ...opts2, token });
          if (!d || (d.started ?? 0) < 1) {
            return Promise.reject(new Error(`[screen-host] screen.shared \u672A\u542F\u52A8\uFF08${JSON.stringify(d)}\uFF09`));
          }
          const geom = { fromRect: d.fromRect, toRect: d.toRect };
          return new Promise((resolve) => {
            pending.set(token, (v) => {
              let extra = {};
              if (typeof v === "string") {
                try {
                  const o = JSON.parse(v);
                  if (o && typeof o === "object") extra = o;
                } catch {
                }
              } else if (v && typeof v === "object") {
                extra = v;
              }
              resolve({ ...geom, ...extra });
            });
          });
        }
      },
      get pendingAnimations() {
        return pending.size;
      },
      get animDoneHookInstalled() {
        return hookInstalled;
      }
    };
  }

  // packages/animation/src/types.ts
  var AnimKind = {
    TRANSLATE_X: 0,
    TRANSLATE_Y: 1,
    SCALE: 2,
    ROTATE: 3,
    OPACITY: 4,
    // ★★颜色（2026-10-01）：用户面**一个** `color` 声明，内核面**四个标量通道**（kind 5..8）。
    //   分解的理由见内核 `anim.rs::AnimKind` 头注（求值机器全是标量的 ⇒ 零改动复用）。
    //   ★对外**不暴露**通道号（`ANIM_KIND_ID` 里也没有它们）——那是编译内部的事。
    COLOR_R: 5,
    COLOR_G: 6,
    COLOR_B: 7,
    COLOR_A: 8,
    // ★★文字色（2026-10-01）：与底色**同一条数学、不同的样式槽**（`text_color` vs `bg`）。
    //   分成两组编号（而不是复用 5..8）的唯一原因：内核 `write()` 必须知道**往哪个槽写**——
    //   用同一批编号无法区分（会在"同时动底色与文字色"时互相覆盖）。
    TEXT_COLOR_R: 9,
    TEXT_COLOR_G: 10,
    TEXT_COLOR_B: 11,
    TEXT_COLOR_A: 12,
    // ★★3D 旋转（2026-10-01 · B 批）：与 `rotate`（Z 轴）并列的两个轴。
    //   走 tick 路径（不进平台零参与——iOS/Android 的 3D 插值语义不同，跨端一致优先；
    //   见内核 is_composited 注释）。
    ROTATE_X: 13,
    ROTATE_Y: 14,
    // ★★裁剪形状参数（2026-10-01 · C1）：最多 16 条标量通道（与颜色同源的分解法）。
    //   含义按节点声明的**形状类型**解释（见 `ClipShape`）；类型静态、参数可动画（CSS 同规）。
    CLIP0: 15,
    CLIP1: 16,
    CLIP2: 17,
    CLIP3: 18,
    CLIP4: 19,
    CLIP5: 20,
    CLIP6: 21,
    CLIP7: 22,
    CLIP8: 23,
    CLIP9: 24,
    CLIP10: 25,
    CLIP11: 26,
    CLIP12: 27,
    CLIP13: 28,
    CLIP14: 29,
    CLIP15: 30,
    /** ★★SVG 描边进度（2026-10-01 · C2）：0..1 = 沿路径弧长画到哪（"手写字"动效） */
    STROKE_PROGRESS: 31,
    /** ★★渐变混合因子（2026-10-01 · 渐变 v2）：0..1 = A 态（fillGradient）→ B 态（fillGradientTo） */
    GRADIENT_MIX: 32,
    /** ★★路径变形因子（2026-10-01 · 路径变形 v1）：0..1 = A 态（svgPath）→ B 态（svgPathTo） */
    PATH_MORPH: 33,
    /** ★★发光强度（2026-10-01 · glow v1）：0..1 乘子（1 = 按声明全额发光） */
    GLOW_INTENSITY: 34,
    /** ★★遮罩进度（2026-10-01 · mask v1）：0..1 = 软边揭示的进度（0=全隐 / 1=全显） */
    MASK_PROGRESS: 35,
    /** ★★倾斜 X（2026-10-01 · skew v1；度） */
    SKEW_X: 36,
    /** ★★倾斜 Y（2026-10-01 · skew v1；度） */
    SKEW_Y: 37
  };
  var ANIM_KIND_ID = {
    translateX: AnimKind.TRANSLATE_X,
    translateY: AnimKind.TRANSLATE_Y,
    scale: AnimKind.SCALE,
    rotate: AnimKind.ROTATE,
    opacity: AnimKind.OPACITY,
    // ★`color` 的编号是**名义值**：编译期会把它展开成 4 条通道指令（见 `compileOne`）。
    //   这里给 COLOR_R 是为了让 `ANIM_KIND_ID` 保持"每个名字都有编号"的完备形状——
    //   直接消费它会少写 3 个通道，故 `compileOne` 有专门的 `color` 分支（不读这个值）。
    color: AnimKind.COLOR_R,
    // ★`textColor` 同理（名义值 = 文字色 R 通道 9；编译期展开成 4 条）
    textColor: AnimKind.TEXT_COLOR_R,
    // ★3D 旋转（单通道——无数值展开）
    rotateX: AnimKind.ROTATE_X,
    rotateY: AnimKind.ROTATE_Y,
    // ★`clip` 的编号是**名义值**（= 参数槽 0 的 15）：编译期按参数个数展开成 N 条参数通道
    //   （见 `isClipDecl` 分支——它不读这个值）。给名义值是为了 `ANIM_KIND_ID` 的完备形状。
    clip: AnimKind.CLIP0,
    // ★描边进度是**单通道**（31——与内核同号）
    strokeProgress: AnimKind.STROKE_PROGRESS,
    // ★渐变混合是**单通道**（32——与内核同号）
    gradientMix: AnimKind.GRADIENT_MIX,
    // ★路径变形是**单通道**（33——与内核同号）
    pathMorph: AnimKind.PATH_MORPH,
    // ★发光强度是**单通道**（34——与内核同号）
    glowIntensity: AnimKind.GLOW_INTENSITY,
    // ★遮罩进度是**单通道**（35——与内核同号）
    maskProgress: AnimKind.MASK_PROGRESS,
    // ★倾斜是**两条单通道**（36/37——与内核同号；X/Y 各一条：可独立动或一起动）
    skewX: AnimKind.SKEW_X,
    skewY: AnimKind.SKEW_Y
  };
  var Curve = {
    LINEAR: 0,
    EASE_OUT: 1,
    EASE_IN: 2,
    EASE_IN_OUT: 3,
    /** 阻尼振荡近似（查表）；**与真弹簧不同**——需要物理语义时用 `spring` */
    SPRING_APPROX: 4
  };
  var CURVE_ID = {
    linear: Curve.LINEAR,
    easeOut: Curve.EASE_OUT,
    easeIn: Curve.EASE_IN,
    easeInOut: Curve.EASE_IN_OUT,
    springApprox: Curve.SPRING_APPROX
  };

  // packages/animation/src/color.ts
  function parseColorToChannels(css) {
    if (typeof css !== "string") {
      throw new Error(`\u989C\u8272\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF08\u6536\u5230 ${typeof css}\uFF09\u2014\u2014\u7528 '#RRGGBB' \u5F62\u6001`);
    }
    const s = css.trim();
    if (!s.startsWith("#")) {
      throw new Error(`\u989C\u8272 "${s}" \u4E0D\u652F\u6301\uFF1A\u53EA\u63A5\u53D7 #RGB / #RRGGBB / #RRGGBBAA \u5341\u516D\u8FDB\u5236\u5F62\u6001`);
    }
    const hex = s.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(`\u989C\u8272 "${s}" \u4E0D\u662F\u5408\u6CD5\u5341\u516D\u8FDB\u5236\uFF08\u5E94\u4E3A #RGB / #RRGGBB / #RRGGBBAA\uFF09`);
    }
    switch (hex.length) {
      case 3: {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 255
        };
      }
      case 6:
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 255
        };
      case 8:
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: parseInt(hex.slice(6, 8), 16)
        };
      default:
        throw new Error(
          `\u989C\u8272 "${s}" \u4F4D\u6570\u975E\u6CD5\uFF08${hex.length} \u4F4D\uFF09\u2014\u2014\u53EA\u63A5\u53D7 #RGB\uFF083\uFF09/ #RRGGBB\uFF086\uFF09/ #RRGGBBAA\uFF088\uFF09`
        );
    }
  }

  // packages/animation/src/validate.ts
  var COMPOSITED_KINDS = [
    "translateX",
    "translateY",
    "scale",
    "rotate",
    "opacity"
  ];
  var TICK_ONLY_KINDS = [
    "rotateX",
    "rotateY",
    // ★★C1（2026-10-01）：裁剪形状是绘制期约束（canvas.clipPath / CALayer.mask）——
    //   Android RenderNode 无"可动画裁剪形状"属性 ⇒ 两端统一 tick 路径。
    "clip",
    // ★★C2（2026-10-01）：SVG 描边进度同样非合成（改占位层/重画路径）⇒ tick 路径。
    "strokeProgress",
    // ★★渐变 v2（2026-10-01）：色标混合是 paint 状态（改 shader/渐变层），且 lerp 只在
    //   内核一处 ⇒ 两端一致走 tick（与颜色同类决策）。
    "gradientMix",
    // ★★路径变形 v1（2026-10-01）：改的是**几何**（宿主每帧重建平台 path），且 lerp 只在
    //   内核一处（宿主只翻译变形后的段）⇒ 必走 tick（与描边同族但更重）。
    "pathMorph",
    // ★★发光强度（glow v1）：改的是 paint 状态（分层描边 alpha）——非合成，走 tick。
    "glowIntensity",
    // ★★遮罩进度（mask v1）：改的是**合成状态**（layer.mask / saveLayer+DST_IN）——非合成，走 tick。
    "maskProgress",
    // ★★倾斜（skew v1）：两端都不是"一等属性"（Android 无 setSkewX / iOS 无倾斜属性）
    //   ⇒ 平台插值器无从谈起 ⇒ 统一 tick（与 rotateX/Y 同一推理）。
    "skewX",
    "skewY"
  ];
  function isTickOnly(kind) {
    return TICK_ONLY_KINDS.includes(kind);
  }
  function isComposited(kind) {
    return COMPOSITED_KINDS.includes(kind);
  }
  function checkCurveBezier(d, i, issues) {
    const cb = d.curveBezier;
    if (cb === void 0) return;
    if (!Array.isArray(cb) || cb.length !== 4) {
      issues.push({
        index: i,
        code: "invalid-range",
        message: `\`curveBezier\` \u9700\u8981 4 \u4E2A\u63A7\u5236\u70B9 [x1,y1,x2,y2]\uFF0C\u6536\u5230 ${JSON.stringify(cb)}`,
        hint: "\u4F8B\uFF1AcurveBezier: [0.34, 1.56, 0.64, 1]\uFF08\u56DE\u5F39\uFF09\u6216 [0.2, 0, 0, 1]"
      });
      return;
    }
    const bad = cb.some((v) => typeof v !== "number" || !Number.isFinite(v));
    if (bad) {
      issues.push({ index: i, code: "invalid-range", message: `\`curveBezier\` \u542B\u975E\u6709\u9650\u6570\uFF1A${JSON.stringify(cb)}`, hint: "\u7ED9\u5177\u4F53\u6570\u503C" });
      return;
    }
    if (cb[0] < 0 || cb[0] > 1 || cb[2] < 0 || cb[2] > 1) {
      issues.push({
        index: i,
        code: "invalid-range",
        message: `\`curveBezier\` \u7684 x1/x2 \u5FC5\u987B\u5728 [0,1]\uFF08\u65F6\u95F4\u8F74\u5355\u8C03\u2014\u2014\u5426\u5219\u7ED9\u5B9A\u8FDB\u5EA6\u6C42\u503C\u4E0D\u552F\u4E00\uFF09\uFF1Ax1=${cb[0]}, x2=${cb[2]}`,
        hint: "y1/y2 \u53EF\u4EE5\u4EFB\u610F\uFF08> 1 \u6216 < 0 \u662F\u56DE\u5F39/\u9884\u671F\u6548\u679C\uFF09\uFF1B\u53EA\u6709 x \u53D7\u9650\uFF08CSS cubic-bezier \u540C\u89C4\uFF09"
      });
    }
    if (d.curve !== void 0) {
      issues.push({
        index: i,
        code: "conflicting-easing",
        message: "`curveBezier` \u4E0E `curve` \u5E76\u5B58 \u2014\u2014 \u4E24\u5904\u90FD\u63CF\u8FF0\u7F13\u52A8\uFF0C\u5FC5\u987B\u552F\u4E00",
        hint: "\u5220\u6389 `curve`\uFF08\u5C01\u95ED\u96C6\u5FEB\u6377\u540D\uFF09\uFF0C\u53EA\u7559 `curveBezier`"
      });
    }
    if (d.spring !== void 0) {
      issues.push({
        index: i,
        code: "conflicting-easing",
        message: "`curveBezier` \u4E0E `spring` \u5E76\u5B58 \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
        hint: "\u4E8C\u9009\u4E00\uFF1A\u8981\u7269\u7406\u624B\u611F\u7528 `spring`\uFF0C\u8981\u786E\u5B9A\u66F2\u7EBF\u7528 `curveBezier`"
      });
    }
    if (d.keyframes !== void 0) {
      issues.push({
        index: i,
        code: "conflicting-easing",
        message: "`curveBezier` \u4E0E `keyframes` \u5E76\u5B58 \u2014\u2014 \u6BB5\u7EA7\u66F2\u7EBF\u76EE\u524D\u53EA\u7528\u5C01\u95ED\u96C6\uFF08\u8BDA\u5B9E\u8FB9\u754C\uFF09",
        hint: "\u5220\u6389 `curveBezier`\uFF08\u591A\u6BB5\u5E8F\u5217\u91CC\u6BCF\u6BB5\u7528 `curve` \u5C01\u95ED\u96C6\uFF09\uFF0C\u6216\u6539\u7528\u5355\u6BB5 + `curveBezier`"
      });
    }
  }
  function validateAnimations(decls) {
    const issues = [];
    if (decls.length === 0) {
      issues.push({
        index: -1,
        code: "empty",
        message: "\u52A8\u753B\u58F0\u660E\u4E3A\u7A7A",
        hint: '\u81F3\u5C11\u7ED9\u4E00\u6761\u58F0\u660E\uFF1B\u82E5\u672C\u610F\u662F"\u505C\u6389\u52A8\u753B"\uFF0C\u8BF7\u8C03 stopAnimations \u800C\u4E0D\u662F\u7F16\u8BD1\u7A7A\u6279\u6B21'
      });
      return issues;
    }
    decls.forEach((d, i) => {
      if (d.kind === "color" || d.kind === "textColor") {
        if (d.from === void 0) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: '`color` \u52A8\u753B\u7684 `from` \u662F**\u5FC5\u586B**\uFF08\u5185\u6838\u6CA1\u6709"\u7F3A\u7701 = \u8282\u70B9\u5F53\u524D\u5E95\u8272"\u8BED\u4E49\uFF09',
            hint: "\u663E\u5F0F\u7ED9\u8D77\u70B9\uFF0C\u5982 from: '#2f6fed'\uFF08\u901A\u5E38\u53D6\u8BE5\u8282\u70B9\u7684 backgroundColor\uFF09"
          });
        }
        for (const [key, val] of [
          ["from", d.from],
          ["to", d.to]
        ]) {
          if (val === void 0) continue;
          try {
            parseColorToChannels(val);
          } catch (e) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\`color\` \u7684 \`${key}\` \u975E\u6CD5\uFF1A${e.message}`,
              hint: "\u7528\u5341\u516D\u8FDB\u5236\uFF1A'#RGB' / '#RRGGBB' / '#RRGGBBAA'\uFF08CSS4 \u5E8F\uFF0C\u6700\u540E\u4E24\u4F4D\u662F alpha\uFF09"
            });
          }
        }
        if (d.keyframes) {
          const kf = d.keyframes;
          if (kf.length === 0) {
            issues.push({
              index: i,
              code: "empty",
              message: "`keyframes` \u4E3A\u7A7A\u6570\u7EC4\uFF08\u5E8F\u5217\u81F3\u5C11\u8981\u4E00\u6BB5\uFF1B\u5355\u6BB5\u8BF7\u76F4\u63A5\u7528 `curve`\uFF09",
              hint: "\u53BB\u6389 `keyframes` \u7528\u5355\u6BB5\u58F0\u660E\uFF0C\u6216\u8865\u4E0A\u81F3\u5C11\u4E00\u6BB5 `{ to, durationMs }`"
            });
          }
          const sum = kf.reduce((acc, seg) => acc + (Number.isFinite(seg.durationMs) ? seg.durationMs : 0), 0);
          kf.forEach((seg, j) => {
            try {
              parseColorToChannels(seg.to);
            } catch (e) {
              issues.push({
                index: i,
                code: "invalid-range",
                message: `\u989C\u8272\u5E8F\u5217\u7B2C ${j} \u6BB5 \`to\` \u975E\u6CD5\uFF1A${e.message}`,
                hint: "\u6BCF\u6BB5\u7EC8\u70B9\u90FD\u8981\u662F\u989C\u8272\uFF1A'#RGB' / '#RRGGBB' / '#RRGGBBAA'"
              });
            }
            if (!Number.isFinite(seg.durationMs) || seg.durationMs < 0) {
              issues.push({
                index: i,
                code: "invalid-range",
                message: `\u989C\u8272\u5E8F\u5217\u7B2C ${j} \u6BB5 \`durationMs\` \u975E\u6CD5\uFF1A${seg.durationMs}`,
                hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570\uFF080 = \u8BE5\u6BB5\u77AC\u53D8\uFF0C\u5408\u6CD5\u4F46\u901A\u5E38\u4E0D\u662F\u672C\u610F\uFF09"
              });
            }
            if (seg.curve !== void 0 && !(seg.curve in CURVE_ID)) {
              issues.push({
                index: i,
                code: "invalid-range",
                message: `\u989C\u8272\u5E8F\u5217\u7B2C ${j} \u6BB5\u66F2\u7EBF\u672A\u77E5\uFF1A${seg.curve}`,
                hint: "\u7528 Curve \u5C01\u95ED\u96C6\u91CC\u7684\u540D\u5B57"
              });
            }
          });
          if (sum <= 0) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: "\u989C\u8272\u5E8F\u5217\u603B\u65F6\u957F\u4E3A 0 \u2014\u2014 \u52A8\u753B\u4F1A**\u77AC\u95F4\u8DF3\u5230\u672B\u6BB5\u7EC8\u70B9**",
              hint: '\u81F3\u5C11\u7ED9\u4E00\u6BB5\u6B63\u65F6\u957F\uFF1B\u96F6\u65F6\u957F\u5E8F\u5217\u5728\u771F\u673A\u4E0A\u770B\u8D77\u6765\u5C31\u662F"\u6CA1\u505A\u52A8\u753B"'
            });
          }
          if (d.spring !== void 0) {
            issues.push({
              index: i,
              code: "conflicting-easing",
              message: "`keyframes` \u4E0E `spring` \u5E76\u5B58 \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
              hint: "\u5E8F\u5217\u91CC\u8981\u5F39\u6027\u624B\u611F\uFF0C\u628A\u67D0\u4E00\u6BB5\u7528\u66F2\u7EBF\u8FD1\u4F3C\uFF08\u5982 springApprox\uFF09\uFF0C\u6216\u6574\u6761\u6539\u7528 spring"
            });
          }
          if (d.curve !== void 0) {
            issues.push({
              index: i,
              code: "conflicting-easing",
              message: "`keyframes` \u4E0E `curve` \u5E76\u5B58 \u2014\u2014 \u6BB5\u5185\u66F2\u7EBF\u7531\u6BCF\u6BB5\u81EA\u5DF1\u7684 `curve` \u51B3\u5B9A",
              hint: "\u5220\u6389\u5916\u5C42\u7684 `curve`\uFF08\u5B83\u53EA\u5BF9\u5355\u6BB5\u6A21\u5F0F\u6709\u610F\u4E49\uFF09"
            });
          }
          const last = kf[kf.length - 1];
          if (last && last.to.toLowerCase() !== d.to.toLowerCase()) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\u672B\u6BB5 \`to\`(${last.to}) \u4E0E\u58F0\u660E \`to\`(${d.to}) \u4E0D\u4E00\u81F4 \u2014\u2014 \u4E24\u5904\u90FD\u63CF\u8FF0"\u7EC8\u70B9"`,
              hint: "\u8BA9\u4E8C\u8005\u76F8\u7B49\uFF08\u7F16\u8BD1\u5668\u4EE5\u58F0\u660E `to` \u4E3A\u51C6\u505A\u7AEF\u70B9\u9489\u6B7B\uFF0C\u4E0D\u4E00\u81F4\u4F1A\u8BA9\u7EC8\u503C\u4E0E\u4F60\u5199\u7684\u4E0D\u7B26\uFF09"
            });
          }
        }
        if (d.curve !== void 0 && d.spring !== void 0) {
          issues.push({
            index: i,
            code: "conflicting-easing",
            message: "\u540C\u65F6\u58F0\u660E\u4E86 `curve` \u4E0E `spring` \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
            hint: "\u4E8C\u9009\u4E00\uFF1A\u8981\u7269\u7406\u624B\u611F\u7528 `spring`\uFF0C\u8981\u786E\u5B9A\u66F2\u7EBF\u7528 `curve`"
          });
        }
        if (d.spring) {
          const s = d.spring;
          const bad = !Number.isFinite(s.stiffness) || s.stiffness <= 0 || !Number.isFinite(s.damping) || s.damping < 0 || s.mass !== void 0 && (!Number.isFinite(s.mass) || s.mass <= 0);
          if (bad) {
            issues.push({
              index: i,
              code: "invalid-spring",
              message: `\u5F39\u7C27\u53C2\u6570\u975E\u6CD5\uFF1A${JSON.stringify(s)}\uFF08\u8981\u6C42 stiffness>0 \xB7 damping\u22650 \xB7 mass>0\uFF09`,
              hint: "\u7528\u9884\u8BBE\uFF08presets.easing.snappy / smooth\uFF09\u907F\u514D\u624B\u8C03\uFF1B\u5185\u6838\u6709 10s \u5B89\u5168\u4E0A\u9650\u515C\u5E95\u4F46\u90A3\u662F\u515C\u5E95\u4E0D\u662F\u8BBE\u8BA1"
            });
          }
        }
        if (d.durationMs !== void 0 && (!Number.isFinite(d.durationMs) || d.durationMs < 0)) {
          issues.push({ index: i, code: "invalid-range", message: `\`durationMs\` \u975E\u6CD5\uFF1A${d.durationMs}`, hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570" });
        }
        if (d.delayMs !== void 0 && (!Number.isFinite(d.delayMs) || d.delayMs < 0)) {
          issues.push({ index: i, code: "invalid-range", message: `\`delayMs\` \u975E\u6CD5\uFF1A${d.delayMs}`, hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570" });
        }
        if (d.scroll) {
          const { from, to } = d.scroll;
          if (!Number.isFinite(from) || !Number.isFinite(to)) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\u6EDA\u52A8\u7A97\u53E3\u542B\u975E\u6709\u9650\u503C\uFF1A${JSON.stringify(d.scroll)}`,
              hint: "\u7A97\u53E3\u4E24\u7AEF\u90FD\u8981\u662F\u5177\u4F53\u7684\u6EDA\u52A8\u4F4D\u7F6E\uFF08px\uFF09"
            });
          } else if (to <= from) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\u6EDA\u52A8\u7A97\u53E3\u9000\u5316\uFF08to=${to} <= from=${from}\uFF09\u2014\u2014\u8FDB\u5EA6\u5C06\u6052\u4E3A 1\uFF0C\u52A8\u753B\u4E00\u5F00\u59CB\u5C31\u505C\u5728\u7EC8\u70B9`,
              hint: "\u68C0\u67E5 from/to \u662F\u5426\u5199\u53CD\uFF1B\u7A97\u53E3\u8DE8\u5EA6\u5E94\u4E3A\u6B63\u6570\uFF08\u5982 from: 0, to: 120\uFF09"
            });
          }
        }
        checkCurveBezier(d, i, issues);
        {
          const dd = d;
          if (dd.repeat !== void 0) {
            const badNum = typeof dd.repeat === "number" && (!Number.isFinite(dd.repeat) || dd.repeat < 1);
            if (dd.repeat !== "infinite" && (typeof dd.repeat !== "number" || badNum)) {
              issues.push({
                index: i,
                code: "invalid-range",
                message: `\`repeat\` \u975E\u6CD5\uFF1A${JSON.stringify(dd.repeat)}\uFF08\u5E94 \u2265 1 \u7684\u6570\u5B57\uFF0C\u6216 'infinite'\uFF09`,
                hint: "\u4F8B\uFF1Arepeat: 3 \xB7 repeat: 'infinite'\uFF08\u547C\u5438\u706F\u7684\u5E95\u8272\u5FAA\u73AF\uFF09"
              });
            }
            if ((dd.repeat === "infinite" || typeof dd.repeat === "number" && dd.repeat > 1) && dd.scroll) {
              issues.push({
                index: i,
                code: "conflicting-easing",
                message: '`repeat` \u4E0E `scroll` \u5E76\u5B58 \u2014\u2014 \u6EDA\u52A8\u9A71\u52A8\u7684\u8FDB\u5EA6\u6765\u81EA\u4F4D\u7F6E\uFF0C\u6CA1\u6709"\u8F6E"\u7684\u6982\u5FF5',
                hint: "\u53BB\u6389 `repeat`"
              });
            }
          }
          if (dd.direction !== void 0 && dd.direction !== "normal" && dd.direction !== "alternate") {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\`direction\` \u975E\u6CD5\uFF1A${JSON.stringify(dd.direction)}`,
              hint: "yoyo \u5F80\u590D\u7528 direction: 'alternate'"
            });
          }
        }
        return;
      }
      if (d.kind === "clip" && d.scroll) {
        const { from: sfrom, to: sto } = d.scroll;
        if (!Number.isFinite(sfrom) || !Number.isFinite(sto)) {
          issues.push({ index: i, code: "invalid-range", message: "\u6EDA\u52A8\u7A97\u53E3\u542B\u975E\u6709\u9650\u6570", hint: "from/to \u90FD\u5E94\u662F\u6709\u9650 px" });
        } else if (sto <= sfrom) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\u6EDA\u52A8\u7A97\u53E3\u9000\u5316\uFF08to=${sto} <= from=${sfrom}\uFF09\u2014\u2014\u8FDB\u5EA6\u5C06\u6052\u4E3A 1`,
            hint: "\u68C0\u67E5 from/to \u662F\u5426\u5199\u53CD\uFF1B\u7A97\u53E3\u8DE8\u5EA6\u5E94\u4E3A\u6B63\u6570"
          });
        }
      }
      if (d.kind === "clip") {
        const cd = d;
        const n = cd.to?.length ?? 0;
        if (!Array.isArray(cd.to) || n === 0) {
          issues.push({
            index: i,
            code: "empty",
            message: "`clip` \u58F0\u660E\u7684 `to` \u4E3A\u7A7A\u2014\u2014\u81F3\u5C11\u7ED9\u4E00\u4E2A\u53C2\u6570",
            hint: "inset 4 \u4E2A\uFF08top/right/bottom/left\uFF09\xB7 circle 3 \u4E2A\uFF08cx/cy/r\uFF09\xB7 polygon \u5076\u6570\u4E2A\uFF08\u226416\uFF0C\u6700\u591A 8 \u70B9\uFF09"
          });
        } else if (n > 16) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\`clip\` \u53C2\u6570\u8FC7\u591A\uFF1A${n} \u4E2A\uFF08\u6700\u591A 16 = 8 \u4E2A\u9876\u70B9\uFF09\u2014\u2014\u5185\u6838\u53EA\u6709 16 \u4E2A\u53C2\u6570\u69FD`,
            hint: "polygon \u6700\u591A 8 \u4E2A\u9876\u70B9\uFF0816 \u4E2A\u6570\uFF09\uFF1B\u66F4\u590D\u6742\u7684\u5F62\u72B6\u8BF7\u62C6\u6210\u591A\u4E2A\u8282\u70B9\u6216\u8D70\u9003\u751F\u53E3\u767B\u8BB0"
          });
        }
        if (!Array.isArray(cd.from) || cd.from.length < n) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\`clip\` \u7684 \`from\` \u53C2\u6570\u4E0D\u8DB3\uFF1A\u9700\u8981 ${n} \u4E2A\uFF08\u4E0E \`to\` \u5BF9\u9F50\uFF09\uFF0C\u6536\u5230 ${cd.from?.length ?? 0} \u4E2A`,
            hint: '\u5185\u6838\u6CA1\u6709"\u7F3A\u7701 = \u5F53\u524D\u503C"\u8BED\u4E49\uFF08\u4E0E\u989C\u8272\u540C\u4E00\u6761\u7EAA\u5F8B\uFF09\u2014\u2014\u8D77\u70B9\u5FC5\u987B\u663E\u5F0F\u7ED9\u51FA'
          });
        }
        const badNum = (arr) => Array.isArray(arr) && arr.some((v) => typeof v !== "number" || !Number.isFinite(v));
        if (badNum(cd.from) || badNum(cd.to)) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: "`clip` \u53C2\u6570\u542B\u975E\u6709\u9650\u6570\uFF08NaN / Infinity\uFF09",
            hint: "\u53C2\u6570\u662F\u76D2\u5206\u6570\uFF080..1 \u5E38\u89C1\uFF0C\u53EF\u8D1F = \u5916\u6269\uFF09\u2014\u2014\u7ED9\u5177\u4F53\u6570\u503C"
          });
        }
        if (cd.keyframes) {
          for (const [j, seg] of cd.keyframes.entries()) {
            if (!Array.isArray(seg.to) || seg.to.length < n) {
              issues.push({
                index: i,
                code: "invalid-range",
                message: `\`clip\` \u5E8F\u5217\u7B2C ${j} \u6BB5\u53C2\u6570\u4E0D\u8DB3\uFF1A\u9700\u8981 ${n} \u4E2A\uFF0C\u6536\u5230 ${seg.to?.length ?? 0} \u4E2A`,
                hint: "\u6BCF\u6BB5 `to` \u90FD\u662F\u5B8C\u6574\u7684\u53C2\u6570\u6570\u7EC4\uFF08\u4E0E\u58F0\u660E `to` \u5BF9\u9F50\uFF09"
              });
            }
          }
        }
        checkCurveBezier(d, i, issues);
        if (d.curve !== void 0 && d.spring !== void 0) {
          issues.push({
            index: i,
            code: "conflicting-easing",
            message: "`clip` \u7684 `curve` \u4E0E `spring` \u5E76\u5B58 \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
            hint: "\u4E8C\u9009\u4E00\uFF1A\u8981\u7269\u7406\u624B\u611F\u7528 `spring`\uFF0C\u8981\u786E\u5B9A\u66F2\u7EBF\u7528 `curve`"
          });
        }
        if (cd.keyframes && d.spring !== void 0) {
          issues.push({
            index: i,
            code: "conflicting-easing",
            message: "`clip` \u7684 `keyframes` \u4E0E `spring` \u5E76\u5B58 \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
            hint: "\u4E8C\u9009\u4E00\uFF08\u4E0E\u6807\u91CF/\u989C\u8272\u540C\u89C4\u5219\uFF09"
          });
        }
        return;
      }
      checkCurveBezier(d, i, issues);
      {
        const dd = d;
        if (dd.repeat !== void 0) {
          const badNum = typeof dd.repeat === "number" && (!Number.isFinite(dd.repeat) || dd.repeat < 1);
          if (dd.repeat !== "infinite" && (typeof dd.repeat !== "number" || badNum)) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\`repeat\` \u975E\u6CD5\uFF1A${JSON.stringify(dd.repeat)}\uFF08\u5E94 \u2265 1 \u7684\u6570\u5B57\uFF0C\u6216 'infinite'\uFF09`,
              hint: "\u4F8B\uFF1Arepeat: 3\uFF08\u64AD\u4E09\u904D\uFF09\xB7 repeat: 'infinite'\uFF08\u65E0\u9650\uFF09"
            });
          }
          if ((dd.repeat === "infinite" || typeof dd.repeat === "number" && dd.repeat > 1) && dd.scroll) {
            issues.push({
              index: i,
              code: "conflicting-easing",
              message: '`repeat` \u4E0E `scroll` \u5E76\u5B58 \u2014\u2014 \u6EDA\u52A8\u9A71\u52A8\u7684\u8FDB\u5EA6\u6765\u81EA\u4F4D\u7F6E\uFF0C\u6CA1\u6709"\u8F6E"\u7684\u6982\u5FF5',
              hint: "\u53BB\u6389 `repeat`\uFF08\u6EDA\u52A8\u8054\u52A8\u5929\u7136\u968F\u4F4D\u7F6E\u5F80\u590D\uFF09"
            });
          }
        }
        if (dd.direction !== void 0 && dd.direction !== "normal" && dd.direction !== "alternate") {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\`direction\` \u975E\u6CD5\uFF1A${JSON.stringify(dd.direction)}\uFF08\u5E94 'normal' / 'alternate'\uFF09`,
            hint: "yoyo \u5F80\u590D\u7528 direction: 'alternate'"
          });
        }
      }
      const dup = decls.slice(0, i).find((p) => p.kind === d.kind);
      if (dup) {
        issues.push({
          index: i,
          code: "duplicate-kind",
          message: `\u540C\u4E00\u6279\u6B21\u91CC \`${d.kind}\` \u51FA\u73B0\u4E86\u591A\u6B21\uFF08\u5185\u6838\u5BF9\u540C (\u8282\u70B9,\u5C5E\u6027) \u662F**\u66FF\u6362**\u8BED\u4E49 \u21D2 \u540E\u8005\u4F1A\u9759\u9ED8\u66FF\u6362\u524D\u8005\uFF09`,
          hint: "\u591A\u6BB5\u5E8F\u5217\u8BF7\u7528 `keyframes`\uFF08\u4E00\u6761\u52A8\u753B\u5185\u5206\u6BB5\uFF0C\u5185\u6838 AnimMode::Keyframes\uFF09\uFF1B\u6216\u62C6\u6210\u4E24\u6B21\u8C03\u7528\uFF1B\u6216\u6539\u7528\u4E0D\u540C\u5C5E\u6027\u7EC4\u5408\uFF08\u5982 scale + opacity \u540C\u65F6\u8FDB\u884C\uFF09"
        });
      }
      if (d.keyframes) {
        const kf = d.keyframes;
        if (kf.length === 0) {
          issues.push({
            index: i,
            code: "empty",
            message: "`keyframes` \u4E3A\u7A7A\u6570\u7EC4\uFF08\u5E8F\u5217\u81F3\u5C11\u8981\u4E00\u6BB5\uFF1B\u5355\u6BB5\u8BF7\u76F4\u63A5\u7528 `curve`\uFF09",
            hint: "\u53BB\u6389 `keyframes` \u7528\u5355\u6BB5\u58F0\u660E\uFF0C\u6216\u8865\u4E0A\u81F3\u5C11\u4E00\u6BB5 `{ to, durationMs }`"
          });
        }
        const sum = kf.reduce((acc, s) => acc + (Number.isFinite(s.durationMs) ? s.durationMs : 0), 0);
        kf.forEach((s, j) => {
          if (!Number.isFinite(s.to)) {
            issues.push({ index: i, code: "invalid-range", message: `\u5E8F\u5217\u7B2C ${j} \u6BB5 \`to\` \u975E\u6709\u9650\u6570`, hint: "\u7ED9\u5177\u4F53\u6570\u503C" });
          }
          if (!Number.isFinite(s.durationMs) || s.durationMs < 0) {
            issues.push({
              index: i,
              code: "invalid-range",
              message: `\u5E8F\u5217\u7B2C ${j} \u6BB5 \`durationMs\` \u975E\u6CD5\uFF1A${s.durationMs}`,
              hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570\uFF080 = \u8BE5\u6BB5\u77AC\u53D8\uFF0C\u5408\u6CD5\u4F46\u901A\u5E38\u4E0D\u662F\u672C\u610F\uFF09"
            });
          }
          if (s.curve !== void 0 && !(s.curve in CURVE_ID)) {
            issues.push({ index: i, code: "invalid-range", message: `\u5E8F\u5217\u7B2C ${j} \u6BB5\u66F2\u7EBF\u672A\u77E5\uFF1A${s.curve}`, hint: "\u7528 Curve \u5C01\u95ED\u96C6\u91CC\u7684\u540D\u5B57" });
          }
        });
        if (sum <= 0) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: "\u5E8F\u5217\u603B\u65F6\u957F\u4E3A 0 \u2014\u2014 \u52A8\u753B\u4F1A**\u77AC\u95F4\u8DF3\u5230\u672B\u6BB5\u7EC8\u70B9**",
            hint: '\u81F3\u5C11\u7ED9\u4E00\u6BB5\u6B63\u65F6\u957F\uFF1B\u96F6\u65F6\u957F\u5E8F\u5217\u5728\u771F\u673A\u4E0A\u770B\u8D77\u6765\u5C31\u662F"\u6CA1\u505A\u52A8\u753B"'
          });
        }
        if (d.spring !== void 0) {
          issues.push({
            index: i,
            code: "conflicting-easing",
            message: "`keyframes` \u4E0E `spring` \u5E76\u5B58 \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
            hint: "\u5E8F\u5217\u91CC\u8981\u5F39\u6027\u624B\u611F\uFF0C\u628A\u67D0\u4E00\u6BB5\u7528\u66F2\u7EBF\u8FD1\u4F3C\uFF08\u5982 springApprox\uFF09\uFF0C\u6216\u6574\u6761\u6539\u7528 spring"
          });
        }
        if (d.curve !== void 0) {
          issues.push({
            index: i,
            code: "conflicting-easing",
            message: "`keyframes` \u4E0E `curve` \u5E76\u5B58 \u2014\u2014 \u6BB5\u5185\u66F2\u7EBF\u7531\u6BCF\u6BB5\u81EA\u5DF1\u7684 `curve` \u51B3\u5B9A",
            hint: "\u5220\u6389\u5916\u5C42\u7684 `curve`\uFF08\u5B83\u53EA\u5BF9\u5355\u6BB5\u6A21\u5F0F\u6709\u610F\u4E49\uFF09"
          });
        }
        const last = kf[kf.length - 1];
        if (last && Number.isFinite(last.to) && Number.isFinite(d.to) && last.to !== d.to) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\u672B\u6BB5 \`to\`(${last.to}) \u4E0E\u58F0\u660E \`to\`(${d.to}) \u4E0D\u4E00\u81F4 \u2014\u2014 \u4E24\u5904\u90FD\u63CF\u8FF0"\u7EC8\u70B9"`,
            hint: "\u8BA9\u4E8C\u8005\u76F8\u7B49\uFF08\u7F16\u8BD1\u5668\u4EE5\u58F0\u660E `to` \u4E3A\u51C6\u505A\u7AEF\u70B9\u9489\u6B7B\uFF0C\u4E0D\u4E00\u81F4\u4F1A\u8BA9\u7EC8\u503C\u4E0E\u4F60\u5199\u7684\u4E0D\u7B26\uFF09"
          });
        }
      }
      if (!isComposited(d.kind) && !isTickOnly(d.kind)) {
        issues.push({
          index: i,
          code: "non-composited",
          message: `\`${d.kind}\` \u4E0D\u662F\u5408\u6210\u5C5E\u6027 \u2014\u2014 \u4F1A\u89E6\u53D1\u5E73\u53F0\u5E03\u5C40\u94FE\u8DEF\uFF08requestLayout / \u5E03\u5C40\u91CD\u7B97\uFF09\uFF0C\u5E73\u53F0\u6E32\u67D3\u7EBF\u7A0B\u7684\u5F02\u6B65\u7EA2\u5229**\u5B8C\u5168\u5931\u6548**`,
          hint: '\u6539\u7528\u5408\u6210\u5C5E\u6027\uFF1A\u4F4D\u79FB\u7528 translateX/Y\u3001\u7F29\u653E\u7528 scale\u3001\u65CB\u8F6C\u7528 rotate\u3001\u900F\u660E\u5EA6\u7528 opacity\uFF1B\u5982\u679C\u8981\u52A8\u7684\u662F"\u5E03\u5C40\u8BA9\u4F4D"\uFF0C\u8BF7\u8D70 FLIP\uFF08presets.list.shift\uFF09'
        });
      }
      if (!Number.isFinite(d.to)) {
        issues.push({ index: i, code: "invalid-range", message: "`to` \u4E0D\u662F\u6709\u9650\u6570", hint: "\u7ED9\u4E00\u4E2A\u5177\u4F53\u7684\u6570\u503C\u76EE\u6807" });
      }
      if (d.from !== void 0 && !Number.isFinite(d.from)) {
        issues.push({ index: i, code: "invalid-range", message: "`from` \u4E0D\u662F\u6709\u9650\u6570", hint: "\u7701\u7565 `from` \u8BA9\u5185\u6838\u53D6\u8282\u70B9\u5F53\u524D\u503C" });
      }
      const isSpring = d.spring !== void 0;
      if (isSpring && d.curve !== void 0) {
        issues.push({
          index: i,
          code: "conflicting-easing",
          message: "\u540C\u65F6\u58F0\u660E\u4E86 `curve` \u4E0E `spring` \u2014\u2014 \u6C42\u503C\u6A21\u5F0F\u5FC5\u987B\u552F\u4E00",
          hint: "\u4E8C\u9009\u4E00\uFF1A\u8981\u7269\u7406\u624B\u611F\u7528 `spring`\uFF0C\u8981\u786E\u5B9A\u66F2\u7EBF\u7528 `curve`"
        });
      }
      if (d.durationMs !== void 0 && (!Number.isFinite(d.durationMs) || d.durationMs < 0)) {
        issues.push({ index: i, code: "invalid-range", message: `\`durationMs\` \u975E\u6CD5\uFF1A${d.durationMs}`, hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570" });
      }
      if (d.delayMs !== void 0 && (!Number.isFinite(d.delayMs) || d.delayMs < 0)) {
        issues.push({ index: i, code: "invalid-range", message: `\`delayMs\` \u975E\u6CD5\uFF1A${d.delayMs}`, hint: "\u7ED9\u975E\u8D1F\u6BEB\u79D2\u6570" });
      }
      if (isSpring) {
        const s = d.spring;
        const bad = !Number.isFinite(s.stiffness) || s.stiffness <= 0 || !Number.isFinite(s.damping) || s.damping < 0 || s.mass !== void 0 && (!Number.isFinite(s.mass) || s.mass <= 0);
        if (bad) {
          issues.push({
            index: i,
            code: "invalid-spring",
            message: `\u5F39\u7C27\u53C2\u6570\u975E\u6CD5\uFF1A${JSON.stringify(s)}\uFF08\u8981\u6C42 stiffness>0 \xB7 damping\u22650 \xB7 mass>0\uFF09`,
            hint: "\u7528\u9884\u8BBE\uFF08presets.easing.snappy / smooth\uFF09\u907F\u514D\u624B\u8C03\uFF1B\u5185\u6838\u6709 10s \u5B89\u5168\u4E0A\u9650\u515C\u5E95\u4F46\u90A3\u662F\u515C\u5E95\u4E0D\u662F\u8BBE\u8BA1"
          });
        }
      }
      if (d.scroll) {
        const { from, to } = d.scroll;
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\u6EDA\u52A8\u7A97\u53E3\u542B\u975E\u6709\u9650\u503C\uFF1A${JSON.stringify(d.scroll)}`,
            hint: "\u7A97\u53E3\u4E24\u7AEF\u90FD\u8981\u662F\u5177\u4F53\u7684\u6EDA\u52A8\u4F4D\u7F6E\uFF08px\uFF09"
          });
        } else if (to <= from) {
          issues.push({
            index: i,
            code: "invalid-range",
            message: `\u6EDA\u52A8\u7A97\u53E3\u9000\u5316\uFF08to=${to} <= from=${from}\uFF09\u2014\u2014\u8FDB\u5EA6\u5C06\u6052\u4E3A 1\uFF0C\u52A8\u753B\u4E00\u5F00\u59CB\u5C31\u505C\u5728\u7EC8\u70B9`,
            hint: "\u68C0\u67E5 from/to \u662F\u5426\u5199\u53CD\uFF1B\u7A97\u53E3\u8DE8\u5EA6\u5E94\u4E3A\u6B63\u6570\uFF08\u5982 from: 0, to: 120\uFF09"
          });
        }
      }
      if (d.scroll && d.spring) {
        issues.push({
          index: i,
          code: "conflicting-easing",
          message: "\u6EDA\u52A8\u9A71\u52A8\u4E0E\u5F39\u7C27\u7269\u7406\u5E76\u5B58 \u2014\u2014 \u5F39\u7C27\u7684\u8FDB\u5EA6\u53C2\u6570\u5728\u6EDA\u52A8\u9A71\u52A8\u4E0B\u65E0\u610F\u4E49\uFF08\u5185\u6838\u6309\u4F4D\u7F6E\u6362\u7B97\u8FDB\u5EA6\u540E\u8D70\u66F2\u7EBF\u6C42\u503C\uFF09",
          hint: "\u6EDA\u52A8\u8054\u52A8\u8BF7\u7528 `curve`\uFF08\u5982 easeOut / linear\uFF09\uFF1B\u5F39\u7C27\u7559\u7ED9\u65F6\u95F4\u9A71\u52A8\u7684\u52A8\u753B"
        });
      }
    });
    return issues;
  }

  // packages/animation/src/compile.ts
  function compileAnimations(decls, targets, opts) {
    const issues = validateAnimations(decls);
    if (issues.length > 0) {
      const detail = issues.map((i) => `[${i.code}] #${i.index} ${i.message} \u2192 ${i.hint}`).join("; ");
      throw new Error(
        `Morpheus \u52A8\u753B\u58F0\u660E\u6821\u9A8C\u5931\u8D25\uFF1A${detail}
  \u21D2 \u82E5\u5C01\u95ED\u96C6\u786E\u5B9E\u8868\u8FBE\u4E0D\u4E86\uFF0C\u8D70**\u663E\u5F0F\u9003\u751F\u53E3**\uFF08\`escapes.register({kind, detail, reason, behaviorRisk})\`\uFF09\u2014\u2014\u53EF\u7528\u4F46\u5FC5\u987B\u767B\u8BB0\u5E76\u63A5\u53D7 degraded \u98CE\u9669\uFF08Morpheus \xA74.2\uFF09\uFF0C\u4E0D\u8981\u7ED5\u8FC7\u6846\u67B6\u3002`
      );
    }
    const anims = decls.flatMap((d) => compileOne(d, targets));
    opts?.escapes?.noteDeclarative(anims.length);
    const kindNames = new Set(decls.map((d) => d.kind));
    const composited = [...kindNames].every((k) => isComposited(k));
    return {
      anims,
      composited,
      // ★颜色两类（color / textColor）都是 paint-only 非合成 ⇒ 如实列进清单
      nonComposited: composited ? [] : [...kindNames].filter((k) => !isComposited(k))
    };
  }
  function isColorDecl(d) {
    return d.kind === "color" || d.kind === "textColor";
  }
  function isClipDecl(d) {
    return d.kind === "clip";
  }
  function compileOne(d, targets) {
    const easing2 = resolveEasing(d);
    if (isClipDecl(d)) {
      const n = Math.min(16, d.to.length);
      if (n === 0) {
        throw new Error("\u88C1\u526A\u58F0\u660E `to` \u4E3A\u7A7A\u2014\u2014\u81F3\u5C11\u7ED9\u4E00\u4E2A\u53C2\u6570\uFF08inset\u22654 / circle\u22653 / polygon \u5076\u6570\u4E2A\uFF09");
      }
      const from = d.from;
      if (from.length < n) {
        throw new Error(
          `\u88C1\u526A\u58F0\u660E \`from\` \u53C2\u6570\u4E0D\u8DB3\uFF1A\u9700\u8981 ${n} \u4E2A\uFF08\u4E0E \`to\` \u5BF9\u9F50\uFF09\uFF0C\u6536\u5230 ${from.length} \u4E2A\uFF08\u5185\u6838\u6CA1\u6709"\u7F3A\u7701 = \u5F53\u524D\u503C"\u8BED\u4E49\u2014\u2014\u8D77\u70B9\u5FC5\u987B\u663E\u5F0F\u7ED9\u51FA\uFF09`
        );
      }
      const kf = d.keyframes?.map((seg) => ({ seg, to: seg.to.length >= n ? seg.to : seg.to }));
      const mkClip = (slot) => ({
        nodeId: targets.nodeId,
        // ★通道编号 = 15 + 槽位（契约：CLIP0 = 15，见 types.ts AnimKind）
        kind: 15 + slot,
        curve: easing2.curve,
        clipSlot: slot,
        ...d.curveBezier ? { curveBezier: d.curveBezier } : {},
        from: from[slot] ?? 0,
        to: d.to[slot] ?? 0,
        durMs: easing2.durMs,
        delayMs: d.delayMs ?? 0,
        // ★★滚动驱动（长卷探索补）：与标量/颜色同字段同语义（内核 `start_scroll` 支持任意 kind）
        drive: d.drive === "progress" ? 1 : 0,
        ...d.scroll ? { scrollFrom: d.scroll.from, scrollTo: d.scroll.to } : {},
        takeover: d.takeover !== false,
        ...d.spring ? { spring: { stiffness: d.spring.stiffness, damping: d.spring.damping, mass: d.spring.mass ?? 1 } } : {},
        ...kf ? {
          keyframes: kf.map(({ seg }) => ({
            to: seg.to[slot] ?? 0,
            durMs: seg.durationMs,
            curve: CURVE_ID[seg.curve ?? "easeOut"]
          }))
        } : {},
        ...d.repeat !== void 0 ? {
          repeat: d.repeat === "infinite" ? -1 : d.repeat,
          ...d.direction === "alternate" ? { alternate: true } : {}
        } : {}
      });
      const out = [];
      for (let slot = 0; slot < n; slot++) out.push(mkClip(slot));
      return out;
    }
    if (isColorDecl(d)) {
      const from = parseColorToChannels(d.from);
      const to = parseColorToChannels(d.to);
      const base = d.kind === "color" ? [AnimKind.COLOR_R, AnimKind.COLOR_G, AnimKind.COLOR_B, AnimKind.COLOR_A] : [AnimKind.TEXT_COLOR_R, AnimKind.TEXT_COLOR_G, AnimKind.TEXT_COLOR_B, AnimKind.TEXT_COLOR_A];
      const kf = d.keyframes?.map((seg) => {
        const ch = parseColorToChannels(seg.to);
        return { ch, durMs: seg.durationMs, curve: CURVE_ID[seg.curve ?? "easeOut"] };
      });
      const mc = d;
      const mk = (kind, idx) => {
        const f = [from.r, from.g, from.b, from.a][idx];
        const t = [to.r, to.g, to.b, to.a][idx];
        return {
          nodeId: targets.nodeId,
          kind,
          curve: easing2.curve,
          // ★自定义贝塞尔：**展开到四条通道**（同一控制点 ⇒ 同一条曲线——颜色不能分通道变缓动）
          ...mc.curveBezier ? { curveBezier: mc.curveBezier } : {},
          from: f,
          to: t,
          durMs: easing2.durMs,
          delayMs: d.delayMs ?? 0,
          drive: d.drive === "progress" ? 1 : 0,
          takeover: d.takeover !== false,
          ...d.spring ? { spring: { stiffness: d.spring.stiffness, damping: d.spring.damping, mass: d.spring.mass ?? 1 } } : {},
          ...kf ? {
            keyframes: kf.map(({ ch, durMs, curve }) => ({
              to: [ch.r, ch.g, ch.b, ch.a][idx],
              durMs,
              curve
            }))
          } : {},
          ...d.scroll ? { scrollFrom: d.scroll.from, scrollTo: d.scroll.to } : {},
          // ★A2 循环：四条通道**都要带**（少一条通道不循环 = 颜色分叉——经典静默缺陷）
          ...d.repeat !== void 0 ? {
            repeat: d.repeat === "infinite" ? -1 : d.repeat,
            ...d.direction === "alternate" ? { alternate: true } : {}
          } : {}
        };
      };
      return [mk(base[0], 0), mk(base[1], 1), mk(base[2], 2), mk(base[3], 3)];
    }
    return [
      {
        nodeId: targets.nodeId,
        kind: ANIM_KIND_ID[d.kind],
        curve: easing2.curve,
        // ★自定义贝塞尔（给了它内核求值优先于 `curve` id——见内核 `Anim::curve_at`）
        ...d.curveBezier ? { curveBezier: d.curveBezier } : {},
        from: d.from ?? 0,
        to: d.to,
        durMs: easing2.durMs,
        delayMs: d.delayMs ?? 0,
        drive: d.drive === "progress" ? 1 : 0,
        takeover: d.takeover !== false,
        ...d.spring ? { spring: { stiffness: d.spring.stiffness, damping: d.spring.damping, mass: d.spring.mass ?? 1 } } : {},
        // ★MA6：序列（每段曲线在编译期落定；durMs = 各段之和 ⇒ 内核用它做时间→进度换算）
        ...d.keyframes ? {
          keyframes: d.keyframes.map((s) => ({
            to: s.to,
            durMs: s.durationMs,
            curve: CURVE_ID[s.curve ?? "easeOut"]
          }))
        } : {},
        // ★MA5：滚动窗口（内核据 scrollTo > scrollFrom 判定为滚动驱动）
        ...d.scroll ? { scrollFrom: d.scroll.from, scrollTo: d.scroll.to } : {},
        // ★A2 循环（`'infinite'` → -1 哨兵；`direction` 只在有 repeat 时下发——不污染线格式）
        ...d.repeat !== void 0 ? {
          repeat: d.repeat === "infinite" ? -1 : d.repeat,
          ...d.direction === "alternate" ? { alternate: true } : {}
        } : {}
      }
    ];
  }
  function resolveEasing(d) {
    if (d.keyframes) {
      const sum = d.keyframes.reduce((acc, s) => acc + s.durationMs, 0);
      return { curve: CURVE_ID[d.curve ?? "easeOut"], durMs: d.durationMs ?? sum };
    }
    if (d.spring) {
      return { curve: CURVE_ID.easeOut, durMs: d.durationMs ?? 1e3 };
    }
    return { curve: CURVE_ID[d.curve ?? "easeOut"], durMs: d.durationMs ?? 300 };
  }

  // packages/animation/src/easing.ts
  var easing = {
    /** 快速、微回弹（对齐 iOS `.snappy`） */
    snappy: { stiffness: 320, damping: 30, mass: 1 },
    /** 顺滑、几乎无回弹（对齐 iOS `.smooth`） */
    smooth: { stiffness: 180, damping: 26, mass: 1 }
  };

  // packages/animation/src/bitmap-font.ts
  var FONT_5X7 = {
    A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."]
  };
  var GLYPH_ADVANCE = 6;
  var GLYPH_HEIGHT = 7;
  var LINE_GAP = 1;
  function textBitmap(text) {
    const up = text.toUpperCase();
    const lines = up.split("\n");
    const lineWidth = (s) => (Math.max(s.length, 1) - 1) * GLYPH_ADVANCE + 5;
    const widths = lines.map(lineWidth);
    const width = Math.max(...widths, 5);
    const height = lines.length * GLYPH_HEIGHT + (lines.length - 1) * LINE_GAP;
    const lit = [];
    lines.forEach((line, li) => {
      const xBase = Math.floor((width - widths[li]) / 2);
      const yBase = li * (GLYPH_HEIGHT + LINE_GAP);
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        const glyph = FONT_5X7[ch] ?? FONT_5X7[" "];
        const x0 = xBase + ci * GLYPH_ADVANCE;
        for (let y = 0; y < GLYPH_HEIGHT; y++) {
          const row = glyph[y] ?? ".....";
          for (let x = 0; x < 5; x++) {
            if (row[x] === "#") lit.push({ x: x0 + x, y: yBase + y });
          }
        }
      }
    });
    return { width, height, lit, text: up };
  }

  // packages/animation/src/choreography.ts
  function staggerRanks(n, cols, order = "index") {
    const ranks = new Array(n);
    if (n === 0) return ranks;
    const c = Math.max(1, cols);
    const rowOf = (i) => Math.floor(i / c);
    const colOf = (i) => i % c;
    switch (order) {
      case "index":
        for (let i = 0; i < n; i++) ranks[i] = i;
        return ranks;
      case "diagonal": {
        const keyed = Array.from({ length: n }, (_, i) => ({ i, key: rowOf(i) + colOf(i) }));
        keyed.sort((a, b) => a.key - b.key || a.i - b.i);
        keyed.forEach((e, k) => ranks[e.i] = k);
        return ranks;
      }
      case "serpentine": {
        const rows = Math.ceil(n / c);
        let k = 0;
        for (let r = 0; r < rows; r++) {
          const lo = r * c;
          const hi = Math.min(lo + c, n);
          if (r % 2 === 0) {
            for (let i = lo; i < hi; i++) ranks[i] = k++;
          } else {
            for (let i = hi - 1; i >= lo; i--) ranks[i] = k++;
          }
        }
        return ranks;
      }
      case "radialOut":
      case "radialIn": {
        const rows = Math.ceil(n / c);
        const cx = (c - 1) / 2;
        const cy = (rows - 1) / 2;
        const keyed = Array.from({ length: n }, (_, i) => ({
          i,
          key: Math.hypot(colOf(i) - cx, rowOf(i) - cy)
        }));
        keyed.sort(
          (a, b) => order === "radialOut" ? a.key - b.key || a.i - b.i : b.key - a.key || a.i - b.i
        );
        keyed.forEach((e, k) => ranks[e.i] = k);
        return ranks;
      }
      case "alternate": {
        const half = Math.ceil(n / 2);
        let even = 0;
        let odd = half;
        for (let i = 0; i < n; i++) ranks[i] = i % 2 === 0 ? even++ : odd++;
        return ranks;
      }
    }
  }
  function compileChoreography(spec) {
    const { ids, canvas, make } = spec;
    const n = ids.length;
    const c = Math.max(1, canvas.cols);
    const ranks = staggerRanks(n, c, spec.order ?? "index");
    const staggerMs = spec.staggerMs ?? 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      const nth = ranks[i] ?? i;
      const delayMs = nth * staggerMs;
      const ctx = {
        i,
        n,
        row: Math.floor(i / c),
        col: i % c,
        nth,
        delayMs,
        at: canvas.centers?.[i] ?? { x: 0, y: 0 }
      };
      const decls = make(ctx).map((d) => ({ ...d, delayMs: (d.delayMs ?? 0) + delayMs }));
      try {
        out.push(...compileAnimations(decls, { nodeId: ids[i] }).anims);
      } catch (e) {
        throw new Error(`\u7F16\u6392\u7B2C ${i} \u7247\uFF08nodeId=${ids[i]}\uFF09\u7F16\u8BD1\u5931\u8D25\uFF1A${e.message}`);
      }
    }
    return out;
  }
  function hash01(seed) {
    const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function viewCenter(view) {
    return { x: view.width / 2, y: view.height / 2 };
  }
  function needCenters(canvas, who) {
    const cs = canvas.centers;
    if (!cs || cs.length === 0) {
      throw new Error(
        `${who} \u9700\u8981 \`canvas.centers\`\uFF08\u6BCF\u7247\u5F53\u524D\u4E2D\u5FC3\uFF09\u2014\u2014\u4F4D\u79FB\u91CF = \u76EE\u6807 \u2212 \u5F53\u524D\uFF0C\u5F15\u64CE\u4E0D\u731C\u5F53\u524D\u5728\u54EA\u3002\u8BF7\u5148\u4ECE\u5185\u6838\u51E0\u4F55\u8BFB\u56DE\uFF08\u5BBF\u4E3B \`rects()\`\uFF09\u518D\u4F20\u5165\u3002`
      );
    }
    return cs;
  }
  var specOf = (scene) => (make) => ({
    ids: scene.ids,
    canvas: scene.canvas,
    order: scene.order,
    staggerMs: scene.staggerMs,
    make
  });
  var choreograph = {
    /**
     * **波浪**：每片从 `from` 偏移处弹回布局位（spring 物理），随相位错峰扫过。
     * 方向由 `dir` 决定（`down` = 从上方向下扫；`up` = 从下方向上托）。
     */
    wave(scene) {
      const mag = scene.magnitude ?? 260;
      const from = scene.dir === "up" ? mag : -mag;
      const spring = scene.spring ?? easing.smooth;
      const fadeMs = scene.fadeMs ?? 220;
      return compileChoreography(
        specOf(scene)(() => [
          { kind: "translateY", from, to: 0, spring },
          { kind: "opacity", from: 0, to: 1, curve: "easeOut", durationMs: fadeMs }
        ])
      );
    },
    /**
     * **涟漪**：从中心向外逐圈脉冲——scale（放大回弹）+ opacity（压暗回暖），
     * `radialOut` 相位天然形成"一圈圈推出去"的节奏。
     */
    ripple(scene) {
      const peak = scene.peak ?? 1.35;
      const dip = scene.dip ?? 0.5;
      const half = (scene.durationMs ?? 760) / 2;
      return compileChoreography(
        specOf(scene)(() => [
          {
            kind: "scale",
            from: 1,
            to: 1,
            keyframes: [
              { to: peak, durationMs: half, curve: "easeOut" },
              { to: 1, durationMs: half, curve: "easeInOut" }
            ]
          },
          {
            kind: "opacity",
            from: 1,
            to: 1,
            keyframes: [
              { to: dip, durationMs: half, curve: "easeOut" },
              { to: 1, durationMs: half, curve: "easeInOut" }
            ]
          }
        ])
      );
    },
    /**
     * **漩涡**：每片沿渐开线收向视口中心（`turns` 圈），同时旋转 + 缩小。
     * 位移量 = 目标 − **当前**（centers 由调用方从内核几何读回——重排之后也能算对）。
     */
    spiral(scene) {
      const turns = scene.turns ?? 3;
      const rMin = scene.rMin ?? 0.05;
      const rMax = scene.rMax ?? 0.9;
      const toScale = scene.toScale ?? 0.35;
      const durationMs = scene.durationMs ?? 900;
      const curve = scene.curve ?? "easeInOut";
      const view = scene.canvas.view;
      const centers = needCenters(scene.canvas, "choreograph.spiral");
      return compileChoreography(
        specOf(scene)((c) => {
          const center = viewCenter(view);
          const rad0 = Math.min(view.width, view.height) / 2;
          const ang = c.i / Math.max(1, c.n) * Math.PI * 2 * turns;
          const rad = rad0 * (rMin + (rMax - rMin) * (c.i / Math.max(1, c.n)));
          const tx = center.x + Math.cos(ang) * rad - centers[c.i].x;
          const ty = center.y + Math.sin(ang) * rad - centers[c.i].y;
          return [
            { kind: "translateX", from: 0, to: tx, curve, durationMs },
            { kind: "translateY", from: 0, to: ty, curve, durationMs },
            {
              kind: "rotate",
              from: 0,
              to: (c.i % 2 === 0 ? 1 : -1) * (180 + c.i / Math.max(1, c.n) * 540),
              curve,
              durationMs
            },
            { kind: "scale", from: 1, to: toScale, curve, durationMs }
          ];
        })
      );
    },
    /**
     * **归位**：一切变换回到"布局位"（translate/rotate → 0、scale → 1），按相位错峰。
     * 幕间清理用它——把上一幕留下的姿态收干净。
     *
     * ★起点来自 `canvas.attitudes`（**必须提供**）：内核的 `from` 是必填量，缺省落 0——
     *   若不给当前姿态，"归位"会**瞬移归零**（不是收回去）。传 `attitudes: []`（空数组）
     *   等价于"已在基线"（此时本预设等于无操作，调用方可跳过）。
     */
    settle(scene) {
      const durationMs = scene.durationMs ?? 700;
      const curve = scene.curve ?? "easeInOut";
      const attitudes = scene.canvas.attitudes;
      if (!attitudes) {
        throw new Error(
          "choreograph.settle \u9700\u8981 `canvas.attitudes`\uFF08\u6BCF\u7247\u5F53\u524D\u59FF\u6001\uFF09\u2014\u2014\u5185\u6838\u7684 `from` \u662F\u5FC5\u586B\u91CF\uFF0C\u4E0D\u7ED9\u5F53\u524D\u59FF\u6001\u4F1A**\u77AC\u79FB\u5F52\u96F6**\u800C\u4E0D\u662F\u6536\u56DE\u3002\u8BF7\u4F20\u5165\u4E0A\u4E00\u5E55\u7684\u7EC8\u6001\uFF08\u8BB0\u8D26\u6216\u5B9E\u8BFB\uFF1B\u89C1 `ChoreoAttitude` \u6CE8\u91CA\uFF09\u3002"
        );
      }
      const withOpacity = scene.opacity ?? true;
      return compileChoreography(
        specOf(scene)((c) => {
          const a = attitudes[c.i] ?? {};
          const decls = [
            { kind: "translateX", from: a.tx ?? 0, to: 0, curve, durationMs },
            { kind: "translateY", from: a.ty ?? 0, to: 0, curve, durationMs },
            { kind: "rotate", from: a.rotate ?? 0, to: 0, curve, durationMs },
            { kind: "scale", from: a.scale ?? 1, to: 1, curve, durationMs }
          ];
          if (withOpacity) {
            decls.push({ kind: "opacity", from: a.opacity ?? 1, to: 1, curve, durationMs });
          }
          return decls;
        })
      );
    },
    /**
     * **多米诺**：每片"翻过去再弹回"（rotate 用 keyframes 两段；奇偶反向），
     * `serpentine` 相位形成掠过感。
     */
    domino(scene) {
      const tilt = scene.tilt ?? 26;
      const fallMs = scene.fallMs ?? 150;
      const riseMs = scene.riseMs ?? 430;
      return compileChoreography(
        specOf(scene)((c) => {
          const dir = c.i % 2 === 0 ? 1 : -1;
          return [
            {
              kind: "rotate",
              from: 0,
              to: 0,
              keyframes: [
                { to: dir * tilt, durationMs: fallMs, curve: "easeIn" },
                { to: 0, durationMs: riseMs, curve: "springApprox" }
              ]
            },
            {
              kind: "scale",
              from: 1,
              to: 1,
              keyframes: [
                { to: 0.82, durationMs: fallMs, curve: "easeIn" },
                { to: 1, durationMs: riseMs, curve: "springApprox" }
              ]
            }
          ];
        })
      );
    },
    /**
     * ★★**聚字**：把元素聚成点阵文字（`bitmap-font.ts` 的 5×7 字形；支持 `\n` 多行）。
     *
     * 分工：前 `lit.length` 片各就一个**亮像素**（放大显示）；其余成为**星尘**
     * （确定性散布在文字四周的椭圆环上——同输入同画面）。
     * 元素数 < 亮像素数时按序取前几片（文字会缺笔画——由调用方保证规模，
     * 判据端有"亮像素数 ≤ 元素数"的检查）。
     *
     * ★**点距与点大小**（真机截图两轮打磨的结果）：
     *   · 点距 `gap = min(宽比/矩阵宽, 高比/矩阵高)`——**受限于较紧的一边**；
     *     单行 9 字（53 列）时点距只有 ~6.6px（整屏才 390px）⇒ 想要"字大"要么少字、要么**分两行**；
     *   · 点尺寸给了 `elemPx`（元素原始边长）时**自动**按 `fill×gap` 推导（默认 80% 填充度）——
     *     手填 `pixelScale` 时点会随点距变化忽大忽小（点距 6.6 时 0.42 几乎粘连、
     *     点距 20 时又变成一盘散沙——两轮真机截图都抓到了）。
     */
    text(scene) {
      const bm = textBitmap(scene.text);
      if (bm.lit.length === 0) throw new Error(`choreograph.text\uFF1A\u6587\u672C "${scene.text}" \u6CA1\u6709\u4EFB\u4F55\u4EAE\u50CF\u7D20\uFF08\u5B57\u7B26\u5168\u5728\u5B57\u5E93\u5916\uFF1F\uFF09`);
      const view = scene.canvas.view;
      const centers = needCenters(scene.canvas, "choreograph.text");
      const widthRatio = scene.widthRatio ?? 0.9;
      const heightRatio = scene.heightRatio ?? 0.5;
      const durationMs = scene.durationMs ?? 900;
      const curve = scene.curve ?? "easeInOut";
      const gap = Math.min(
        view.width * widthRatio / Math.max(1, bm.width),
        view.height * heightRatio / Math.max(1, bm.height)
      );
      const fill = scene.fill ?? 0.8;
      const pixelScale = scene.pixelScale ?? (scene.elemPx && scene.elemPx > 0 ? Math.max(0.12, Math.min(1, fill * gap / scene.elemPx)) : 0.42);
      const x0 = (view.width - (bm.width - 1) * gap) / 2;
      const y0 = (view.height - (bm.height - 1) * gap) / 2;
      const center = viewCenter(view);
      const lit = bm.lit.length;
      return compileChoreography(
        specOf(scene)((c) => {
          let target;
          let scale;
          let opacity;
          if (c.i < lit) {
            const p = bm.lit[c.i];
            target = { x: x0 + p.x * gap, y: y0 + p.y * gap };
            scale = pixelScale;
            opacity = 1;
          } else {
            const h1 = hash01(c.i);
            const h2 = hash01(c.i + 977);
            const h3 = hash01(c.i + 1543);
            const ang = h1 * Math.PI * 2;
            const rx = view.width * (0.36 + 0.06 * h2);
            const ry = view.height * (0.26 + 0.05 * h3);
            target = { x: center.x + Math.cos(ang) * rx, y: center.y + Math.sin(ang) * ry };
            scale = Math.max(0.14, pixelScale * (0.42 + 0.3 * h2));
            opacity = 0.14 + 0.26 * h3;
          }
          return [
            { kind: "translateX", from: 0, to: target.x - centers[c.i].x, curve, durationMs },
            { kind: "translateY", from: 0, to: target.y - centers[c.i].y, curve, durationMs },
            { kind: "scale", from: 1, to: scale, curve, durationMs },
            { kind: "opacity", from: 1, to: opacity, curve, durationMs }
          ];
        })
      );
    },
    /**
     * **汇聚**：每片沿"屏心 → 自己"的径向外推 `spread` 倍后飞回（开场"星尘凝聚"；
     * `spread` ≥ 2 时起点已在屏外）。spring 物理。
     */
    gather(scene) {
      const spread = scene.spread ?? 2.6;
      const spring = scene.spring ?? easing.smooth;
      const fadeMs = scene.fadeMs ?? 260;
      const centers = needCenters(scene.canvas, "choreograph.gather");
      const center = viewCenter(scene.canvas.view);
      return compileChoreography(
        specOf(scene)((c) => [
          { kind: "translateX", from: (centers[c.i].x - center.x) * spread, to: 0, spring },
          { kind: "translateY", from: (centers[c.i].y - center.y) * spread, to: 0, spring },
          { kind: "opacity", from: 0, to: 1, curve: "easeOut", durationMs: fadeMs }
        ])
      );
    },
    /**
     * **风暴**：五属性并发（位移抖动 + 大幅旋转 + 收放 + 呼吸），`alternate` 相位两班倒。
     * 这是单帧负载最重的一幕（800×5 = 4000 条指令并发）——压力上限的代表。
     */
    storm(scene) {
      const durationMs = scene.durationMs ?? 900;
      const spread = scene.spread ?? 90;
      const shrink = scene.shrink ?? 0.45;
      return compileChoreography(
        specOf(scene)((c) => {
          const h1 = hash01(c.i * 1.7);
          const h2 = hash01(c.i * 2.3 + 11);
          const h3 = hash01(c.i * 3.1 + 29);
          return [
            { kind: "translateX", from: 0, to: (h1 - 0.5) * spread, curve: "easeInOut", durationMs },
            { kind: "translateY", from: 0, to: (h2 - 0.5) * spread, curve: "easeInOut", durationMs },
            {
              kind: "rotate",
              from: 0,
              to: (c.i % 2 === 0 ? 1 : -1) * (360 + h3 * 360),
              curve: "easeInOut",
              durationMs
            },
            { kind: "scale", from: 1, to: shrink + h1 * 0.3, curve: "easeInOut", durationMs },
            { kind: "opacity", from: 1, to: 0.72, curve: "easeInOut", durationMs }
          ];
        })
      );
    },
    /* ────────────────────────── 颜色编排（2026-10-01 · 灯光秀抽出） ──────────────────────────
     *
     * 【为什么这批是**通用预设**（而不是节目单私有的循环）】它们全部走 `compileChoreography`
     *   的 make 回调——与 wave/ripple 同一形态、同一编译链（同一份校验/线格式）。
     *   灯光秀是第一个消费面，但"颜色 + 相位编排"是通用需求（霓虹标题/状态灯/节奏带），
     *   收敛到本包 = 一份实现（纪律 #22：第 N 份手写相位循环 = 下一个静默缺陷）。
     *   ★颜色声明按通道展开（一次声明 → 4 条标量指令）由 `compileAnimations` 保证。 */
    /**
     * **闪烁**：`from →（峰值闪）→ to` 一次往返，附 scale 脉冲（"灯亮起"的物理感）。
     *
     * 相位错峰由 `order × staggerMs` 决定——`radialOut` = 从中心向外逐个点亮（点火），
     * `serpentine` = 蛇形扫过（斜扫）。
     */
    flash(scene) {
      const peak = scene.peak ?? "#ffffff";
      const flashMs = scene.flashMs ?? 160;
      const fallMs = scene.fallMs ?? 620;
      const pulse = scene.pulse ?? 1.18;
      const dur = flashMs + fallMs;
      return compileChoreography(
        specOf(scene)(() => {
          const decls = [
            {
              kind: "color",
              from: scene.from,
              to: scene.to,
              durationMs: dur,
              keyframes: [
                { to: peak, durationMs: flashMs, curve: "easeOut" },
                { to: scene.to, durationMs: fallMs, curve: "easeInOut" }
              ]
            }
          ];
          if (pulse !== 1) {
            decls.push({
              kind: "scale",
              from: 1,
              to: 1,
              durationMs: dur,
              keyframes: [
                { to: pulse, durationMs: flashMs, curve: "easeOut" },
                { to: 1, durationMs: fallMs, curve: "easeInOut" }
              ]
            });
          }
          return decls;
        })
      );
    },
    /**
     * **色环**：每片走同一个多段色序列（`from → colors… → to`），相位错峰形成流动色带。
     *
     * `staggerMs = 0` 时全场同步（"呼吸"：`colors = [亮, 暗, 亮, 暗]`）；
     * 错峰时是流动的彩虹（灯光秀 rainbow 幕）。
     */
    cycle(scene) {
      const segMs = scene.segMs ?? 240;
      return compileChoreography(
        specOf(scene)(() => [
          {
            kind: "color",
            from: scene.from,
            to: scene.to,
            durationMs: segMs * scene.colors.length,
            keyframes: scene.colors.map((c) => ({ to: c, durationMs: segMs, curve: "easeInOut" }))
          }
        ])
      );
    },
    /**
     * **极光带**：整行同色、行间错峰（行内 0 相位）——横向光带自上而下流过。
     *
     * 与 `cycle` 的差别：相位**按行**（同一行的灯严格同拍）而不是按片的 `order` 名次——
     * 行内错峰会打散"光带"的横线形态。行色缺省是 青→蓝→紫 三角波（冷色调）。
     */
    aurora(scene) {
      const rowMs = scene.rowMs ?? 40;
      const hold = scene.holdMs ?? 900;
      const rows = Math.max(1, scene.rows);
      const colorAt = scene.colorAt ?? defaultAuroraColor;
      return compileChoreography({
        ids: scene.ids,
        canvas: scene.canvas,
        order: "index",
        staggerMs: 0,
        make: (c) => {
          const d = c.row * rowMs;
          const rowColor = colorAt(c.row, rows);
          return [
            {
              kind: "color",
              from: scene.from,
              to: scene.from,
              durationMs: hold * 2,
              delayMs: d,
              keyframes: [
                { to: rowColor, durationMs: hold, curve: "easeInOut" },
                { to: scene.from, durationMs: hold, curve: "easeInOut" }
              ]
            }
          ];
        }
      });
    },
    /**
     * **染色**：纯颜色补间（`from → to`），相位错峰——"全场变某色"的一句话。
     * 聚字/归位幕常与位置预设**同批**使用（各自独立声明，颜色与位置互不干扰）。
     */
    paint(scene) {
      const durationMs = scene.durationMs ?? 700;
      const curve = scene.curve ?? "easeInOut";
      return compileChoreography(
        specOf(scene)(() => [{ kind: "color", from: scene.from, to: scene.to, durationMs, curve }])
      );
    },
    /* ────────────────────────── 灯阵模式（2026-10-01 · 灯光秀重构抽出） ──────────────────────────
     *
     * 【与上面"颜色编排"的本质差别】那批是"每片同一种色变化"（靠 `order` 相位错峰）；
     *   这批是**灯阵语义**：每颗灯的亮/灭/色由它的**位置**（行/列/角度）决定，灯**一颗不动**——
     *   整场演出只是"亮灯和灭灯"（真实灯光秀与 LED 矩阵屏的工作方式，用户语义修正的落点）。
     *   ★所有预设只产出**颜色指令**（kind 5..8），不产出任何位移/缩放/旋转/透明度。
     *   ★仍走 `compileChoreography` 同一编译链（同一份校验/线格式）。 */
    /**
     * ★★**灯阵点字**（"亮灯成字"——LED 矩阵屏的经典节目）：
     *   把 `text`（5×7 点阵）渲染到灯阵上——**亮的灯** = `on` 色，**灭的灯** = `off` 色（暗盘）。
     *   灯位保持不变，全靠亮灭组成文字。
     *
     * 布局：点阵水平居中；`\n` 多行纵向堆叠。每行最多 `floor((cols+1)/6)` 个字（5 列字宽 + 1 列间隔）。
     * `blinks` > 0 时亮灯先闪烁（灭→亮交替）再定格——"霓虹招牌"的观感。
     */
    matrixText(scene) {
      const on = scene.on ?? "#ffffff";
      const resolveMs = scene.resolveMs ?? 420;
      const bm = textBitmap(scene.text);
      const cols = Math.max(1, scene.canvas.cols);
      const rows = Math.max(1, Math.ceil(scene.ids.length / cols));
      const x0 = Math.floor((cols - bm.width) / 2);
      const y0 = Math.floor((rows - bm.height) / 2);
      const cells = /* @__PURE__ */ new Set();
      for (const pt of bm.lit) cells.add(pt.y * 4096 + pt.x);
      const litOf = (i) => {
        const gx = i % cols - x0;
        const gy = Math.floor(i / cols) - y0;
        return gx >= 0 && gy >= 0 && gx < bm.width && gy < bm.height && cells.has(gy * 4096 + gx);
      };
      const cur = (i) => scene.currentOf?.(i) ?? scene.from ?? scene.off;
      return compileChoreography({
        ids: scene.ids,
        canvas: scene.canvas,
        // ★相位错峰由 order × staggerMs 推出（compileChoreography 自动叠加 delayMs）——
        //   波形扫过：灯一颗颗（按对角名次）解析成字，而不是整屏同时跳变
        order: scene.order ?? "diagonal",
        staggerMs: scene.staggerMs ?? 6,
        make: (c) => [
          {
            kind: "color",
            from: cur(c.i),
            to: litOf(c.i) ? on : scene.off,
            durationMs: resolveMs,
            curve: "easeInOut"
          }
        ]
      });
    },
    /**
     * ★★**灯阵图案帧**（纯计算，不产出指令）：给定文本与网格，返回**每颗灯的目标色**数组——
     *   亮盘 = `on`、灭盘 = `off`。调用方用它算下一幕的 `currentOf`（逐灯起点色）：
     *   `matrixFrame('800', cols, n, {on, off})` 的终态 = 下一幕（如 `matrixText('LIG\nHTS')`）
     *   `currentOf` 的输入 ⇒ **串幕零跳变**（灯从"它此刻真实的颜色"出发）。
     */
    matrixFrame(text, cols, n, colors) {
      const bm = textBitmap(text);
      const cc = Math.max(1, cols);
      const rows = Math.max(1, Math.ceil(n / cc));
      const x0 = Math.floor((cc - bm.width) / 2);
      const y0 = Math.floor((rows - bm.height) / 2);
      const cells = /* @__PURE__ */ new Set();
      for (const pt of bm.lit) cells.add(pt.y * 4096 + pt.x);
      const out = [];
      for (let i = 0; i < n; i++) {
        const gx = i % cc - x0;
        const gy = Math.floor(i / cc) - y0;
        const lit = gx >= 0 && gy >= 0 && gx < bm.width && gy < bm.height && cells.has(gy * 4096 + gx);
        out.push(lit ? colors.on : colors.off);
      }
      return out;
    },
    /**
     * **跑马灯**（边框追逐——灯会实景最常见的节目）：灯阵**外圈**的灯按顺时针次序
     * 逐颗点亮（亮白 → 回落），内部灯保持灭。相位名次 = 沿边框的序号。
     */
    perimeterChase(scene) {
      const on = scene.on ?? "#ffffff";
      const staggerMs = scene.staggerMs ?? 16;
      const holdMs = scene.holdMs ?? 260;
      const from = scene.from ?? scene.off;
      const cols = Math.max(1, scene.canvas.cols);
      const rows = Math.max(1, Math.ceil(scene.ids.length / cols));
      const rankOf = (i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        if (r === 0) return c;
        if (c === cols - 1) return cols - 1 + r;
        if (r === rows - 1) return cols - 1 + rows - 1 + (cols - 1 - c);
        if (c === 0) return cols - 1 + rows - 1 + cols - 1 + (rows - 1 - r);
        return -1;
      };
      return compileChoreography(
        specOf(scene)((c) => {
          const rank = rankOf(c.i);
          if (rank < 0) {
            return [{ kind: "color", from, to: scene.off, durationMs: staggerMs, curve: "linear" }];
          }
          return [
            {
              kind: "color",
              from,
              to: scene.off,
              durationMs: rank * staggerMs + holdMs,
              // 等到自己那一棒：先灭着（或保持起点色），轮到时亮白，再回落
              keyframes: [
                { to: scene.off, durationMs: Math.max(1, rank * staggerMs), curve: "linear" },
                { to: on, durationMs: holdMs, curve: "easeOut" },
                { to: scene.off, durationMs: 1, curve: "linear" }
              ]
            }
          ];
        })
      );
    },
    /**
     * **光扇**（旋转光束——灯会实景的另一招牌）：一束光绕屏心**旋转扫过**，
     * 被扫到的灯亮白、扫过即灭（角度由灯在阵中的位置推出）。
     *
     * 每颗灯的关键帧 = **按"该灯被光束照到的时间区间"归并**（通常 2–4 段，不是 steps 段）——
     * 800 颗灯的总指令仍是每灯 4 条颜色通道（四通道展开）。`steps` × `stepMs` = 转一整圈的时长。
     */
    fan(scene) {
      const on = scene.on ?? "#ffffff";
      const steps = Math.max(3, scene.steps ?? 12);
      const widthDeg = scene.widthDeg ?? 60;
      const stepMs = scene.stepMs ?? 150;
      const from = scene.from ?? scene.off;
      const cols = Math.max(1, scene.canvas.cols);
      const rows = Math.max(1, Math.ceil(scene.ids.length / cols));
      const angOf = (i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = c + 0.5 - cols / 2;
        const y = r + 0.5 - rows / 2;
        const a = Math.atan2(y, x) * 180 / Math.PI;
        return (a + 360) % 360;
      };
      const diff = (a, b) => {
        const d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
      };
      return compileChoreography(
        specOf(scene)((c) => {
          const ang = angOf(c.i);
          const status = [];
          for (let k2 = 0; k2 < steps; k2++) {
            const beam = k2 * 360 / steps;
            status.push(diff(ang, beam) <= widthDeg / 2);
          }
          const kf = [];
          let k = 0;
          while (k < steps) {
            const s0 = status[k];
            let j = k;
            while (j < steps && status[j] === s0) j++;
            kf.push({ to: s0 ? on : scene.off, durationMs: (j - k) * stepMs, curve: "linear" });
            k = j;
          }
          if (kf.length === 0 || kf[kf.length - 1].to !== scene.off) {
            kf.push({ to: scene.off, durationMs: stepMs, curve: "linear" });
          }
          const dur = kf.reduce((acc, x) => acc + x.durationMs, 0);
          return [{ kind: "color", from, to: scene.off, durationMs: dur, keyframes: kf }];
        })
      );
    },
    /**
     * **棋盘翻转**（矩阵屏经典）：亮灭按 (行+列) 的奇偶交替成棋盘格，整体**翻转 `flips` 次**
     * 后收为全灭。
     */
    checker(scene) {
      const on = scene.on ?? "#ffffff";
      const flips = Math.max(1, scene.flips ?? 4);
      const segMs = scene.segMs ?? 240;
      const from = scene.from ?? scene.off;
      const cols = Math.max(1, scene.canvas.cols);
      return compileChoreography(
        specOf(scene)((c) => {
          const kf = [];
          for (let k = 0; k < flips; k++) {
            const onPhase = (c.row + c.col + k) % 2 === 0;
            kf.push({ to: onPhase ? on : scene.off, durationMs: segMs, curve: "linear" });
          }
          kf.push({ to: scene.off, durationMs: segMs, curve: "linear" });
          const dur = kf.reduce((acc, x) => acc + x.durationMs, 0);
          return [{ kind: "color", from, to: scene.off, durationMs: dur, keyframes: kf }];
        })
      );
    },
    /**
     * **星火**（确定性闪烁）：每颗灯按确定性伪随机走 `segments` 段霓虹色，
     * 最后收灭——"满屏灯在闪"的压力形态（800 灯 × 多段 keyframes）。
     */
    sparkle(scene) {
      const palette = scene.palette.length > 0 ? scene.palette : ["#ffffff"];
      const segments = Math.max(2, scene.segments ?? 6);
      const segMs = scene.segMs ?? 200;
      const from = scene.from ?? scene.off;
      return compileChoreography(
        specOf(scene)((c) => {
          const kf = [];
          for (let k = 0; k < segments; k++) {
            const pick = palette[Math.floor(hash01(c.i * 31.7 + k * 7.3) * palette.length) % palette.length];
            kf.push({ to: pick, durationMs: segMs, curve: "linear" });
          }
          kf.push({ to: scene.off, durationMs: segMs, curve: "linear" });
          const dur = kf.reduce((acc, x) => acc + x.durationMs, 0);
          return [{ kind: "color", from, to: scene.off, durationMs: dur, keyframes: kf }];
        })
      );
    },
    /**
     * **扫描光幕**：一条"暗带"先自上而下压过（灯逐行暗下），紧接着"亮带"再自下而上
     * 点亮（灯逐行亮起）——真实舞台常见的"灯光窗帘"。每行整行同拍、行间错峰 `rowMs`。
     */
    rowSweep(scene) {
      const rowMs = scene.rowMs ?? 30;
      const holdMs = scene.holdMs ?? 240;
      const cols = Math.max(1, scene.canvas.cols);
      return compileChoreography(
        specOf(scene)((c) => [
          {
            kind: "color",
            from: scene.from,
            to: scene.from,
            durationMs: c.row * rowMs + holdMs,
            delayMs: 1,
            keyframes: [
              { to: scene.dim, durationMs: Math.max(1, c.row * rowMs), curve: "linear" },
              { to: scene.from, durationMs: holdMs, curve: "easeOut" }
            ]
          }
        ])
      );
    }
  };
  function defaultAuroraColor(row, rows) {
    const t = row / Math.max(1, rows - 1);
    const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
    const a = [34, 211, 238];
    const b = [59, 130, 246];
    const c = [168, 85, 247];
    const mix = (x, y, u) => {
      const f = (p, q) => Math.round(p + (q - p) * u).toString(16).padStart(2, "0");
      return `#${f(x[0], y[0])}${f(x[1], y[1])}${f(x[2], y[2])}`;
    };
    return tri < 0.5 ? mix(a, b, tri * 2) : mix(b, c, (tri - 0.5) * 2);
  }

  // packages/animation/src/presets.ts
  var DUR = 300;
  var route = {
    /**
     * **半屏弹窗**（从底部滑入）—— 对齐 `wx://bottom-sheet`
     *
     * ★为什么"只动进场页"：弹窗场景下旧页面**保持不动**（背景被遮罩压暗即可）——
     *   动它反而会让用户误以为页面在跳。这与微信 `wx://bottom-sheet` 的行为一致。
     */
    bottomSheet(opts = {}) {
      const dist = opts.distance ?? 400;
      const dur = opts.durationMs ?? DUR;
      const enter = opts.spring ? [{ kind: "translateY", from: dist, to: 0, spring: easing.smooth }] : [{ kind: "translateY", from: dist, to: 0, curve: "easeOut", durationMs: dur }];
      return { name: "bottomSheet", wxRouteType: "wx://bottom-sheet", enter, exit: [], opaque: false, durationMs: dur };
    },
    /**
     * **全屏向上推入**（新页从下方推入，旧页被推出）—— 对齐 `wx://upwards`
     */
    slideUp(opts = {}) {
      const dist = opts.distance ?? 800;
      const dur = opts.durationMs ?? DUR;
      const parallax = opts.exitParallax ?? 0.3;
      return {
        name: "slideUp",
        wxRouteType: "wx://upwards",
        enter: [{ kind: "translateY", from: dist, to: 0, curve: "easeOut", durationMs: dur }],
        // 旧页向反方向让位（视差）+ 轻微淡出——这是"推入"的层次感来源
        exit: [
          { kind: "translateY", from: 0, to: -dist * parallax, curve: "easeOut", durationMs: dur },
          { kind: "opacity", from: 1, to: 1 - parallax, curve: "easeOut", durationMs: dur }
        ],
        opaque: true,
        durationMs: dur
      };
    },
    /**
     * **下滑关闭**（dismiss：当前页向下滑出，露出下层页）—— 对齐统一枚举的 `slideDown`
     *
     * 【与 `slideUp` 的方向关系】`slideUp` 是"推入"（新页从下往上），`slideDown` 是"弹出/关闭"
     *   （当前页从上往下）——两者是**相反**的位移方向，对应统一枚举 `RouteTransition` 的两个成员
     *   （Web 侧 `WEB_TRANSITION_MAP.slideDown = 'slide-down'`、MP 侧 `routeType: 'slideDown'`）。
     *
     * ★注意 `enter`/`exit` 的语义：本预设描述的是**被关闭页（exit）下滑**；
     *   `enter` 留空（下层页本就静止——动它会让"关闭"看起来像"又推了一页"）。
     */
    slideDown(opts = {}) {
      const dist = opts.distance ?? 800;
      const dur = opts.durationMs ?? 300;
      return {
        name: "slideDown",
        wxRouteType: null,
        // ★诚实边界：微信 routeType 里没有"下滑关闭"这个预设（dismiss 由导航栈语义表达）
        // ★★`role: 'dismiss'`（退场型）——`exit` 描述的是**被关闭页**的下滑动作（pop 语义）。
        //   没有它时 back 推导会把 `exit` 反向绑给"返回目标页"⇒ 视觉变成"下层页升上来"（方向反了）。
        role: "dismiss",
        enter: [],
        exit: [
          { kind: "translateY", from: 0, to: dist, curve: "easeIn", durationMs: dur },
          { kind: "opacity", from: 1, to: 0.8, curve: "easeIn", durationMs: dur }
        ],
        opaque: false,
        // 下滑时下层页可见
        durationMs: dur
      };
    },
    /**
     * **缩放下沉**（新页从底部放大进入，旧页下沉）—— 对齐 `wx://zoom`
     */
    zoom(opts = {}) {
      const dur = opts.durationMs ?? DUR;
      const sc = opts.fromScale ?? 0.92;
      const offY = opts.fromOffsetY ?? 60;
      return {
        name: "zoom",
        wxRouteType: "wx://zoom",
        enter: [
          { kind: "scale", from: sc, to: 1, curve: "easeOut", durationMs: dur },
          { kind: "translateY", from: offY, to: 0, curve: "easeOut", durationMs: dur },
          { kind: "opacity", from: 0.6, to: 1, curve: "easeOut", durationMs: dur }
        ],
        // 旧页"下沉"（缩小 + 变暗）——视觉上像被压到下面
        exit: [
          { kind: "scale", from: 1, to: 0.96, curve: "easeOut", durationMs: dur },
          { kind: "opacity", from: 1, to: 0.7, curve: "easeOut", durationMs: dur }
        ],
        opaque: true,
        durationMs: dur
      };
    },
    /**
     * **iOS 风格模态**（从底部滑入 + 轻微缩放）—— 对齐 `wx://cupertino-modal`
     *
     * 与 `bottomSheet` 的差别：模态是**全屏**（距离 = 屏幕高），且**带阻尼感**（弹簧）。
     */
    cupertinoModal(opts = {}) {
      const dist = opts.distance ?? 800;
      return {
        name: "cupertinoModal",
        wxRouteType: "wx://cupertino-modal",
        enter: [{ kind: "translateY", from: dist, to: 0, spring: easing.smooth }],
        exit: [{ kind: "scale", from: 1, to: 0.92, curve: "easeInOut", durationMs: 250 }],
        opaque: true,
        durationMs: 350
      };
    }
  };
  var list = {
    /**
     * ★★**列表项增删让位**（Morpheus §5 的招牌能力）
     *
     * 【为什么这一条最值钱】传统 FLIP 要**前后各读一次几何**（跨边界查询，VDOM 框架里很贵）；
     *   而本仓几何本来就在 Rust 内核 ⇒ 两次快照都是内部读，**零跨边界、零 JS**。
     *   配合 0.08ms 全量重排，"列表增删时其他项平滑让位"几乎白送。
     *
     * 用法（一句话）：
     * ```ts
     * const spec = presets.list.shift()          // 默认 300ms easeOut、无交错
     * engine.flipCapture()                        // 变更前记快照
     * applyListMutation()                         // 增删数据 → 布局变
     * engine.flipStart(spec)                      // 启动补间
     * ```
     */
    shift(opts = {}) {
      return {
        name: "listShift",
        durationMs: opts.durationMs ?? 300,
        curve: opts.curve ?? "easeOut",
        staggerMs: opts.staggerMs ?? 0
      };
    }
  };
  var element = {
    /** **淡入**（透明度 0 → 1；可加轻微上移，避免"平淡地出现"） */
    fadeIn(opts = {}) {
      const dur = opts.durationMs ?? 240;
      const rise = opts.risePx ?? 0;
      const decls = [
        { kind: "opacity", from: 0, to: 1, curve: "easeOut", durationMs: dur, delayMs: opts.delayMs }
      ];
      if (rise > 0) {
        decls.push({ kind: "translateY", from: rise, to: 0, curve: "easeOut", durationMs: dur, delayMs: opts.delayMs });
      }
      return { name: "fadeIn", decls, durationMs: dur };
    },
    /**
     * ★★**翻牌 / 3D 旋入**（2026-10-01 · B 批）——`rotateX` / `rotateY` + 透视。
     *
     * `axis: 'x' | 'y'` 决定绕哪个轴翻；`from` 是起始角度（度，正 = 朝观察者翻起/右缘向内）。
     * 常配 `perspective`（在**节点样式**上声明：`perspective: 1200`——CSS 语义）。
     *
     * ★**为什么走 tick 路径（诚实标注）**：两端平台插值器的 3D 语义不同（iOS 完整 4×4
     *   矩阵 vs Android rotationX/Y + Camera）⇒ 统一走内核逐帧求值（跨端一致优先，与 color 同源）。
     *   实测余量充足（120Hz p95 2ms / 预算 8.3ms）。
     */
    flipIn(opts = {}) {
      const axis = opts.axis ?? "y";
      const from = opts.fromDeg ?? -90;
      const dur = opts.durationMs ?? 420;
      const decls = [
        {
          kind: axis === "x" ? "rotateX" : "rotateY",
          from,
          to: 0,
          curve: opts.curve ?? "easeOut",
          durationMs: dur,
          delayMs: opts.delayMs
        },
        // ★翻入常配淡入（纯旋转在无背面的元素上观感单调）——与 3D 同批下发（不同属性不冲突）
        { kind: "opacity", from: 0.6, to: 1, curve: "easeOut", durationMs: dur, delayMs: opts.delayMs }
      ];
      return { name: `flipIn-${axis}`, decls, durationMs: dur };
    },
    /**
     * ★★**3D 翻面**（`rotateY` 0→180 或 `rotateX`）——卡片翻到"背面"。
     *
     * `flips: 1` 翻一次停住；与 `repeat`/`direction` 组合可做"持续翻转"
     * （`{ kind: 'rotateY', repeat: 'infinite', direction: 'alternate' }` 一句话 = 来回翻转）。
     */
    flip3D(opts = {}) {
      const axis = opts.axis ?? "y";
      const to = opts.toDeg ?? 180;
      const dur = opts.durationMs ?? 500;
      return {
        name: `flip3D-${axis}`,
        decls: [
          {
            kind: axis === "x" ? "rotateX" : "rotateY",
            from: 0,
            to,
            curve: opts.curve ?? "easeInOut",
            durationMs: dur,
            ...opts.repeat !== void 0 ? { repeat: opts.repeat } : {},
            ...opts.direction !== void 0 ? { direction: opts.direction } : {}
          }
        ],
        durationMs: dur
      };
    },
    /**
     * **按压反馈**（松手弹回：`from` 是按下时的缩放，弹回 1）
     *
     * ★**诚实边界（引擎能力决定形态）**：内核对同 (节点,属性) 是**替换**语义 ⇒
     *   "按下 → 弹回"**两段序列**在一个批次里表达不了（第二条会替换第一条）。
     *   ⇒ 本预设只做**弹回段**；按下段由调用方在 `pressStart` 时单独启动
     *   （或直接用 `spring` 从按下值弹回——这也是最常用的用法）。
     *   ★序列编排（sequence）是已知缺口，见 README「未做」一节。
     */
    pressRelease(opts = {}) {
      const sc = opts.fromScale ?? 0.96;
      return {
        name: "pressRelease",
        decls: [{ kind: "scale", from: sc, to: 1, spring: easing.snappy }],
        durationMs: 400
      };
    },
    /**
     * ★★**按压反馈（两段序列）**——按下后回弹，**一条动画**表达完整序列（MA6 起）
     *
     * 【这条预设是"序列编排"的存在理由】此前只能做"弹回段"（`pressRelease`），
     *   因为内核对同 (节点,属性) 是替换语义、两条 scale 会互相覆盖；
     *   MA6 的 `keyframes` 让"下压 → 回弹"收敛在**一条**动画里，且提交平台路径时仍是**一条**
     *   `CAKeyframeAnimation`（不额外增加提交次数）。
     */
    press(opts = {}) {
      const sc = opts.fromScale ?? 0.94;
      const downMs = opts.downMs ?? 90;
      const upMs = opts.upMs ?? 260;
      return {
        name: "pressSequence",
        decls: [
          {
            kind: "scale",
            from: 1,
            to: 1,
            keyframes: [
              { to: sc, durationMs: downMs, curve: opts.downCurve ?? "easeOut" },
              { to: 1, durationMs: upMs, curve: opts.upCurve ?? "springApprox" }
            ]
          }
        ],
        durationMs: downMs + upMs
      };
    },
    /**
     * **抖动（错误提示）**——水平往复三段，末段回到起点
     *
     * ★为什么"末段必须回 0"：抖动是**扰动**，不是位移；末段不回 0 会让元素永久偏移
     *   （这是"看起来对、实际错位"的典型）。预设已保证末段 `to: 0`。
     */
    shake(opts = {}) {
      const amp = opts.amplitude ?? 10;
      const dur = opts.durationMs ?? 360;
      const seg = dur / 3;
      return {
        name: "shake",
        decls: [
          {
            kind: "translateX",
            from: 0,
            to: 0,
            keyframes: [
              { to: -amp, durationMs: seg, curve: "easeOut" },
              { to: amp, durationMs: seg, curve: "easeInOut" },
              { to: 0, durationMs: seg, curve: "easeOut" }
            ]
          }
        ],
        durationMs: dur
      };
    },
    /**
     * ★★**共享元素**（跨元素/跨页面飞行）——Morpheus §6.1 清单最后一项
     *
     * 【与 `sharedElementFlyIn` 的本质差别】那个是"**在落点上**做缩放+淡入"（不需要源几何）；
     *   本条是**真·共享元素**：从**源矩形**飞到目标位置再归位——需要"源"的稳态几何。
     *
     * 【源有两种，覆盖两种场景】
     *   - `fromNodeId`：**同树节点**（同页面内的共享元素，如列表项 → 扩展卡）；
     *   - `fromRect`：**系统坐标矩形**（跨页面/跨稳态，如"上一页的缩略图位置"——
     *     该几何由调用方注入：静态布局（tab/宫格/固定 header）可在**编译期**算出、随指令一起下发，
     *     只有真正运行期才知道的才由宿主上报）。
     *
     * 【几何数学在内核，本预设只是"声明"】编译产物带 `shared: {sourceRect | sourceNodeId}`，
     *   由宿主交 `proteus_layout_shared_element` 处理（中心差 + 宽度比 + 缓动都在内核）。
     *
     * ★诚实边界（见 README「未做」）：内核只有**等比** scale ⇒ 以宽度比为准，
     *   源/目标宽高比不一致时高度按目标比例推出。
     */
    sharedElement(opts = {}) {
      if (!opts.fromRect && opts.fromNodeId === void 0) {
        throw new Error("sharedElement \u9700\u8981\u6E90\uFF1A\u7ED9 fromRect\uFF08\u7CFB\u7EDF\u5750\u6807\uFF09\u6216 fromNodeId\uFF08\u540C\u6811\u8282\u70B9\uFF09");
      }
      if (opts.fromRect && opts.fromNodeId !== void 0) {
        throw new Error("sharedElement \u7684\u6E90\u53EA\u80FD\u7ED9\u4E00\u4E2A\uFF1AfromRect \u4E0E fromNodeId \u4E8C\u9009\u4E00");
      }
      return {
        name: "sharedElement",
        durationMs: opts.durationMs ?? 400,
        fadeIn: opts.fadeIn !== false,
        ...opts.fromRect ? { fromRect: opts.fromRect } : { fromNodeId: opts.fromNodeId }
      };
    },
    /** **共享元素飞入**（在同树落点上做缩放+淡入——不需要源几何的简化形态） */
    sharedElementFlyIn(opts = {}) {
      const dur = opts.durationMs ?? 400;
      const sc = opts.fromScale ?? 0.4;
      return {
        name: "sharedElementFlyIn",
        decls: [
          { kind: "scale", from: sc, to: 1, spring: easing.smooth },
          { kind: "opacity", from: 0, to: 1, curve: "easeOut", durationMs: dur }
        ],
        durationMs: dur
      };
    }
  };
  var scroll = {
    /**
     * **吸顶**（滚过 `pinAt` 后头部固定：用反向位移抵消继续滚动）
     *
     * ★实现说明：本引擎只写**合成属性**（translate/opacity）⇒ 吸顶表达为
     *   `translateY: 0 → -(scrollSpan)` 的窗口动画，配合布局让位实现"钉住"观感；
     *   真·改变定位（position: sticky）属布局属性，不在本引擎属性面上（编译期会拦）。
     */
    sticky(opts = {}) {
      const pinAt = opts.pinAt ?? 80;
      const span = opts.span ?? 120;
      return {
        name: "scrollSticky",
        decls: [{ kind: "translateY", from: 0, to: -span, curve: "linear", scroll: { from: pinAt, to: pinAt + span } }],
        window: { from: pinAt, to: pinAt + span }
      };
    },
    /**
     * **视差**（背景层随滚动反向慢移；`factor` 0..1 = 慢移比例）
     *
     * `factor=0.4` ⇒ 滚过 100px 时背景只上移 40px（相对前景的"景深感"）。
     */
    parallax(opts = {}) {
      const factor = opts.factor ?? 0.4;
      const from = opts.from ?? 0;
      const to = opts.to ?? 400;
      return {
        name: "scrollParallax",
        decls: [
          {
            kind: "translateY",
            from: 0,
            to: -(to - from) * factor,
            curve: "linear",
            scroll: { from, to }
          }
        ],
        window: { from, to }
      };
    },
    /**
     * **渐显**（滚入 `from..to` 区间内透明度 0 → 1；可叠加轻微上移）
     *
     * ★`from/to` 通常取"元素进入视口"的滚动位置区间（由布局计算给出，预设不猜）。
     */
    fadeIn(opts) {
      const rise = opts.risePx ?? 0;
      const decls = [
        { kind: "opacity", from: 0, to: 1, curve: "easeOut", scroll: { from: opts.from, to: opts.to } }
      ];
      if (rise > 0) {
        decls.push({ kind: "translateY", from: rise, to: 0, curve: "easeOut", scroll: { from: opts.from, to: opts.to } });
      }
      return { name: "scrollFadeIn", decls, window: { from: opts.from, to: opts.to } };
    }
  };
  var presets = { route, list, element, easing, scroll, choreograph };

  // packages/animation/src/route-transition.ts
  var APP_TRANSITION_MAP = {
    // 推入（新页从下往上）—— 与 Web `slide-up` / MP `routeType: 'slideUp'` 同语义
    slideUp: presets.route.slideUp(),
    // 下滑关闭（当前页往下滑出，露出下层）—— 与 Web `slide-down` / MP `slideDown` 同语义
    slideDown: presets.route.slideDown(),
    // 半屏（弹窗从底部滑入，下层不动）—— 与 Web `halfscreen` / MP `halfScreen` 同语义
    halfScreen: presets.route.bottomSheet(),
    // 缩放下沉（新页放大进入 + 旧页下沉）—— 与 Web `scale` / MP `scaleDown` 同语义
    scaleDown: presets.route.zoom(),
    // 无转场（瞬切）
    none: {
      name: "none",
      wxRouteType: null,
      enter: [],
      exit: [],
      opaque: true,
      durationMs: 0
    }
  };
  function appTransition(transition, opts) {
    const spec = APP_TRANSITION_MAP[transition];
    if (!spec) return APP_TRANSITION_MAP.none;
    if (!opts || opts.distance === void 0 && opts.durationMs === void 0) return spec;
    const p = opts.distance;
    const d = opts.durationMs;
    switch (transition) {
      case "slideUp":
        return presets.route.slideUp({ distance: p, durationMs: d });
      case "slideDown":
        return presets.route.slideDown({ distance: p, durationMs: d });
      case "halfScreen":
        return presets.route.bottomSheet({ distance: p, durationMs: d });
      case "scaleDown":
        return presets.route.zoom({ durationMs: d, fromOffsetY: p });
      default:
        return spec;
    }
  }
  function reverseDecls(decls) {
    return decls.map((d) => {
      if (isColorDecl(d)) {
        const { from: from2, ...rest2 } = d;
        return { ...rest2, from: d.to, to: from2 };
      }
      if (isClipDecl(d)) {
        const { from: from2, ...rest2 } = d;
        return { ...rest2, from: d.to, to: from2 };
      }
      const { from, ...rest } = d;
      return { ...rest, from: d.to, to: from ?? 0 };
    });
  }
  var EMPTY_BATCH = { anims: [], composited: true, nonComposited: [] };
  function routeTransitionBatches(transition, targets, opts) {
    const spec = appTransition(transition, opts);
    const direction = opts?.direction ?? "forward";
    const role = spec.role ?? "push";
    const effective = role === "dismiss" ? { enter: spec.enter, exit: spec.exit, durationMs: spec.durationMs, opaque: spec.opaque } : direction === "back" ? { enter: reverseDecls(spec.exit), exit: reverseDecls(spec.enter), durationMs: spec.durationMs, opaque: spec.opaque } : { enter: spec.enter, exit: spec.exit, durationMs: spec.durationMs, opaque: spec.opaque };
    const name = Object.keys(APP_TRANSITION_MAP).includes(transition) ? transition : "none";
    const incoming = targets.incoming !== void 0 && effective.enter.length > 0 ? compileAnimations(effective.enter, { nodeId: targets.incoming }) : EMPTY_BATCH;
    const outgoing = targets.outgoing !== void 0 && effective.exit.length > 0 ? compileAnimations(effective.exit, { nodeId: targets.outgoing }) : EMPTY_BATCH;
    return { incoming, outgoing, durationMs: spec.durationMs, opaque: spec.opaque, direction, transition: name, role };
  }

  // packages/animation/src/escape.ts
  var ESCAPE_KINDS = [
    "custom-easing",
    "external-driver",
    "layout-property",
    "cross-property-timeline",
    "platform-mixing",
    "other"
  ];
  var ESCAPE_RATIO_TARGET = 0.05;
  var EscapeRegistry = class {
    constructor() {
      this.records = [];
      this.declarativeCount = 0;
    }
    /** 登记一条逃生口（**三要素缺失当场抛错**——"没有理由的逃生口"是设计泄漏，不许静默通过） */
    register(r) {
      if (!r || typeof r !== "object") throw new Error("\u9003\u751F\u53E3\u767B\u8BB0\u9700\u8981\u5BF9\u8C61\uFF08{kind, detail, reason, behaviorRisk}\uFF09");
      if (!ESCAPE_KINDS.includes(r.kind)) {
        throw new Error(`\u672A\u77E5\u9003\u751F\u53E3\u7C7B\u522B \`${r.kind}\`\uFF08\u5408\u6CD5\u503C\uFF1A${ESCAPE_KINDS.join(" / ")}\uFF09`);
      }
      for (const f of ["detail", "reason", "behaviorRisk"]) {
        const v = r[f];
        if (typeof v !== "string" || v.trim().length === 0) {
          throw new Error(
            `\u9003\u751F\u53E3\u767B\u8BB0\u7F3A\u5C11 \`${f}\`\uFF08${r.kind}\uFF09\u2014\u2014` + (f === "behaviorRisk" ? '\xA74.2 \u8981\u6C42\u5199\u660E"\u884C\u4E3A\u53EF\u80FD\u4E0D\u4E00\u81F4"\u7684\u5177\u4F53\u5F62\u6001\uFF08degraded \u7684\u5B9A\u4E49\uFF09' : f === "reason" ? '\u6CA1\u6709\u7406\u7531\u7684\u9003\u751F\u53E3\u662F\u8BBE\u8BA1\u6CC4\u6F0F\uFF0C\u5FC5\u987B\u5199\u6E05"\u4E3A\u4EC0\u4E48\u5C01\u95ED\u96C6\u4E0D\u591F"' : '\u5FC5\u987B\u5199\u6E05"\u5177\u4F53\u5728\u505A\u4EC0\u4E48"')
          );
        }
      }
      this.records.push({ ...r });
    }
    /** 记录声明式使用量（由 `compileAnimations` 在**注入本注册表**时调用） */
    noteDeclarative(n) {
      if (Number.isFinite(n) && n > 0) this.declarativeCount += n;
    }
    /** 全部登记（只读视图） */
    list() {
      return this.records;
    }
    /** ★聚合（degraded 单列；**全部类别都出现**，零值也列出——不给人留"未归类"的想象空间） */
    summary() {
      const byKind = Object.fromEntries(ESCAPE_KINDS.map((k) => [k, 0]));
      for (const r of this.records) byKind[r.kind] += 1;
      const total = this.records.length;
      const denom = this.declarativeCount + total;
      return {
        total,
        declaratives: this.declarativeCount,
        byKind,
        // §4.2：degraded 是**最高危险度**，单列（不与其它类别混）——这里就是那条单列表
        degraded: this.records.slice(),
        ratio: denom > 0 ? total / denom : 0
      };
    }
    /** ★可读报告（degraded **单独一节**，不与类别汇总混排） */
    format() {
      const s = this.summary();
      const lines = [];
      lines.push("\u2550\u2550\u2550 Morpheus \u9003\u751F\u53E3\u62A5\u544A \u2550\u2550\u2550");
      lines.push(
        `\u58F0\u660E\u5F0F ${s.declaratives} \u6761 \xB7 \u9003\u751F\u53E3 ${s.total} \u6761 \xB7 \u7387 ${s.total === 0 ? "0%" : `${(s.ratio * 100).toFixed(1)}%`}\uFF08\u76EE\u6807 < ${(ESCAPE_RATIO_TARGET * 100).toFixed(0)}%\uFF09`
      );
      lines.push("");
      if (s.total === 0) {
        lines.push("\u65E0\u9003\u751F\u53E3\u767B\u8BB0\uFF08\u5168\u90E8\u8D70\u58F0\u660E\u5F0F\u8DEF\u5F84\uFF09\u3002");
      } else {
        lines.push("\u2605 degraded\uFF08\u884C\u4E3A\u53EF\u80FD\u4E0E\u58F0\u660E\u5F0F\u8DEF\u5F84\u4E0D\u4E00\u81F4\u2014\u2014\xA74.2 \u6700\u9AD8\u5371\u9669\u5EA6\uFF0C\u5355\u5217\uFF09:");
        for (const r of s.degraded) {
          lines.push(`  \xB7 [${r.kind}] ${r.detail}`);
          lines.push(`      \u7406\u7531\uFF1A${r.reason}`);
          lines.push(`      \u98CE\u9669\uFF1A${r.behaviorRisk}`);
          if (r.site) lines.push(`      \u51FA\u5904\uFF1A${r.site}`);
        }
        lines.push("");
      }
      lines.push('\u6309\u7C7B\u522B\u6C47\u603B\uFF08\u542B\u96F6\u503C\u2014\u2014"\u672A\u5F52\u7C7B"\u4E0D\u5B58\u5728\uFF0C\u53EA\u6709 other \u515C\u5E95\uFF09:');
      for (const k of ESCAPE_KINDS) lines.push(`  \xB7 ${k}: ${s.byKind[k]}`);
      if (s.ratio > ESCAPE_RATIO_TARGET) {
        lines.push("");
        lines.push(`\u26A0 \u9003\u751F\u53E3\u7387 ${(s.ratio * 100).toFixed(1)}% \u8D85\u8FC7\u76EE\u6807 ${(ESCAPE_RATIO_TARGET * 100).toFixed(0)}%\u2014\u2014\u4F18\u5148\u770B\u80FD\u5426\u628A\u9AD8\u9891\u7C7B\u522B\u8865\u6210\u9884\u8BBE\uFF08\u9884\u8BBE\u4F18\u5148\u4E8E\u9003\u751F\u53E3\uFF09`);
      }
      return lines.join("\n");
    }
    /** 清空（**测试隔离用**——跨用例共享状态必须可归零，本仓纪律） */
    reset() {
      this.records = [];
      this.declarativeCount = 0;
    }
  };
  var escapes = new EscapeRegistry();

  // packages/render-backend/src/app-navigation.ts
  function createAppNavigation(opts) {
    if (!opts.screens && !opts.routes) {
      throw new Error("[app-navigation] \u9700\u8981 screens \u6216 routes \u4E4B\u4E00\uFF08\u5C4F\u6CE8\u518C\u8868\u7684\u6765\u6E90\u2014\u2014\u4E0D\u731C\uFF09");
    }
    const screens2 = opts.screens ?? screensFromRoutes(opts.routes);
    if (Object.keys(screens2).length === 0) {
      throw new Error("[app-navigation] \u5C4F\u6CE8\u518C\u8868\u4E3A\u7A7A\u2014\u2014\u68C0\u67E5 routes/screens \u662F\u5426\u4E3A\u7A7A");
    }
    const stack = createAppStack({ screens: screens2, ...opts.policy ? { policy: opts.policy } : {} });
    const ports = createHostScreenPorts({ invoke: opts.invoke });
    const executor = createScreenExecutor({
      host: ports.tree,
      anim: ports.anim,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o ?? {}),
      onScreenMounted: opts.onScreenMounted ?? ((id) => stack.markRebuilt(id)),
      ...opts.onEvent ? { onEvent: opts.onEvent } : {}
    });
    const autoPump = opts.autoPump !== false;
    const adapter = createAppNavigationAdapter({
      stack,
      screens: screens2,
      pump: autoPump ? () => executor.applyCommands(stack.drainCommands()) : async () => {
      }
    });
    return {
      stack,
      executor,
      adapter,
      flush: () => adapter.flush(),
      hostStats: () => {
        try {
          return JSON.parse(opts.invoke("screen.stats", "null"));
        } catch (e) {
          return { error: String(e) };
        }
      }
    };
  }

  // hosts/shared/bridge/app-screen-content.generated.ts
  var APP_SCREEN_CONTENT = {
    "index": {
      "nodes": [
        {
          "id": 0,
          "parentId": null,
          "semantic": "view"
        },
        {
          "id": 1,
          "parentId": 0,
          "padding": {
            "top": 24,
            "right": 0,
            "bottom": 16,
            "left": 0
          },
          "semantic": "view"
        },
        {
          "id": 2,
          "parentId": 1,
          "fontSize": 26,
          "fontWeight": 700,
          "color": "#eef0f5",
          "letterSpacing": -0.3,
          "text": "\u65E9\u4E0A\u597D\uFF0C\u8FD0\u8425\u540C\u5B66",
          "semantic": "text"
        },
        {
          "id": 3,
          "parentId": 1,
          "margin": {
            "top": 8
          },
          "fontSize": 14,
          "color": "#b6bcc9",
          "text": "\u4ECA\u5929\u662F 10 \u6708 4 \u65E5 \xB7 \u6709 2 \u9879\u5173\u952E\u4EFB\u52A1\u5F85\u8DDF\u8FDB",
          "semantic": "text"
        },
        {
          "id": 4,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 5,
          "parentId": 4,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "center",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 6,
          "parentId": 5,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "display": "flex",
          "flexDirection": "column",
          "alignItems": "center",
          "semantic": "view"
        },
        {
          "id": 7,
          "parentId": 6,
          "fontSize": 20,
          "fontWeight": 700,
          "semantic": "text"
        },
        {
          "id": 8,
          "parentId": 6,
          "margin": {
            "top": 4
          },
          "fontSize": 12,
          "color": "#9aa1af",
          "semantic": "text"
        },
        {
          "id": 9,
          "parentId": 0,
          "text": "\u5168\u5C40\u72B6\u6001",
          "semantic": "text"
        },
        {
          "id": 10,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 11,
          "parentId": 10,
          "semantic": "view"
        },
        {
          "id": 12,
          "parentId": 11,
          "semantic": "view"
        },
        {
          "id": 13,
          "parentId": 12,
          "text": "\u4E3B\u9898",
          "semantic": "text"
        },
        {
          "id": 14,
          "parentId": 11,
          "semantic": "text"
        },
        {
          "id": 15,
          "parentId": 10,
          "semantic": "view"
        },
        {
          "id": 16,
          "parentId": 15,
          "semantic": "view"
        },
        {
          "id": 17,
          "parentId": 16,
          "text": "IM \u672A\u8BFB\u89D2\u6807",
          "semantic": "text"
        },
        {
          "id": 18,
          "parentId": 15,
          "semantic": "text"
        },
        {
          "id": 19,
          "parentId": 10,
          "semantic": "view"
        },
        {
          "id": 20,
          "parentId": 19,
          "semantic": "view"
        },
        {
          "id": 21,
          "parentId": 20,
          "text": "\u97F3\u4E50\u64AD\u653E\u6761",
          "semantic": "text"
        },
        {
          "id": 22,
          "parentId": 19,
          "semantic": "text"
        },
        {
          "id": 23,
          "parentId": 0,
          "text": "\u5FEB\u6377\u64CD\u4F5C",
          "semantic": "text"
        },
        {
          "id": 24,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 25,
          "parentId": 24,
          "semantic": "view"
        },
        {
          "id": 26,
          "parentId": 25,
          "semantic": "view"
        },
        {
          "id": 27,
          "parentId": 26,
          "text": "\u6A21\u62DF\u5F31\u7F51",
          "semantic": "text"
        },
        {
          "id": 28,
          "parentId": 26,
          "text": "\u5F31\u7F51\u65F6\u63D0\u9192\u7528\u6237",
          "semantic": "text"
        },
        {
          "id": 29,
          "parentId": 25,
          "semantic": "view"
        },
        {
          "id": 30,
          "parentId": 24,
          "semantic": "view"
        },
        {
          "id": 31,
          "parentId": 30,
          "semantic": "view"
        },
        {
          "id": 32,
          "parentId": 31,
          "text": "\u64AD\u653E\u5185\u90E8\u64AD\u5BA2",
          "semantic": "text"
        },
        {
          "id": 33,
          "parentId": 31,
          "text": "\u64AD\u653E\u5185\u90E8\u64AD\u5BA2",
          "semantic": "text"
        },
        {
          "id": 34,
          "parentId": 30,
          "semantic": "view"
        },
        {
          "id": 35,
          "parentId": 24,
          "semantic": "navigator"
        },
        {
          "id": 36,
          "parentId": 35,
          "semantic": "view"
        },
        {
          "id": 37,
          "parentId": 36,
          "text": "\u6253\u5F00\u9A8C\u6536\u63A7\u5236\u53F0",
          "semantic": "text"
        },
        {
          "id": 38,
          "parentId": 36,
          "text": "\u5168\u5C40\u80FD\u529B\u81EA\u68C0",
          "semantic": "text"
        },
        {
          "id": 39,
          "parentId": 35,
          "semantic": "view"
        },
        {
          "id": 40,
          "parentId": 0,
          "text": "\u4ECA\u65E5\u5F85\u529E",
          "semantic": "text"
        },
        {
          "id": 41,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 42,
          "parentId": 41,
          "semantic": "view"
        },
        {
          "id": 43,
          "parentId": 42,
          "semantic": "view"
        },
        {
          "id": 44,
          "parentId": 43,
          "text": "Q4 \u6295\u653E\u8BA1\u5212\u590D\u6838",
          "semantic": "text"
        },
        {
          "id": 45,
          "parentId": 43,
          "text": "\u622A\u6B62 18:00",
          "semantic": "text"
        },
        {
          "id": 46,
          "parentId": 42,
          "text": "\u7D27\u6025",
          "semantic": "text"
        },
        {
          "id": 47,
          "parentId": 41,
          "semantic": "view"
        },
        {
          "id": 48,
          "parentId": 47,
          "semantic": "view"
        },
        {
          "id": 49,
          "parentId": 48,
          "text": "\u6E20\u9053\u6708\u62A5\u6570\u636E\u6821\u5BF9",
          "semantic": "text"
        },
        {
          "id": 50,
          "parentId": 48,
          "text": "\u622A\u6B62\u660E\u65E5",
          "semantic": "text"
        },
        {
          "id": 51,
          "parentId": 47,
          "text": "\u8FDB\u884C\u4E2D",
          "semantic": "text"
        },
        {
          "id": 52,
          "parentId": 41,
          "semantic": "view"
        },
        {
          "id": 53,
          "parentId": 52,
          "semantic": "view"
        },
        {
          "id": 54,
          "parentId": 53,
          "text": "\u65B0\u5BA2\u56DE\u8BBF\u540D\u5355\u786E\u8BA4",
          "semantic": "text"
        },
        {
          "id": 55,
          "parentId": 53,
          "text": "\u622A\u6B62\u672C\u5468\u4E94",
          "semantic": "text"
        },
        {
          "id": 56,
          "parentId": 52,
          "text": "\u5F85\u5F00\u59CB",
          "semantic": "text"
        }
      ]
    },
    "messages": {
      "nodes": [
        {
          "id": 0,
          "parentId": null,
          "semantic": "view"
        },
        {
          "id": 1,
          "parentId": 0,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "baseline",
          "justifyContent": "space-between",
          "padding": {
            "top": 24,
            "right": 16,
            "bottom": 12,
            "left": 16
          },
          "semantic": "view"
        },
        {
          "id": 2,
          "parentId": 1,
          "fontSize": 26,
          "fontWeight": 700,
          "color": "#eef0f5",
          "letterSpacing": -0.3,
          "text": "\u6D88\u606F",
          "semantic": "text"
        },
        {
          "id": 3,
          "parentId": 1,
          "fontSize": 12,
          "color": "#9aa1af",
          "semantic": "text"
        },
        {
          "id": 4,
          "parentId": 0,
          "display": "flex",
          "flexDirection": "row",
          "padding": {
            "top": 0,
            "right": 0,
            "bottom": 12,
            "left": 0
          },
          "semantic": "view"
        },
        {
          "id": 5,
          "parentId": 4,
          "margin": {
            "right": 12
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "fontSize": 12,
          "color": "#b6bcc9",
          "text": "\u6807\u8BB0\u4E00\u6761\u672A\u8BFB",
          "semantic": "view"
        },
        {
          "id": 6,
          "parentId": 4,
          "margin": {
            "right": 12
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "fontSize": 12,
          "color": "#b6bcc9",
          "text": "\u5168\u90E8\u5DF2\u8BFB",
          "semantic": "view"
        },
        {
          "id": 7,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 8,
          "parentId": 7,
          "semantic": "view"
        },
        {
          "id": 9,
          "parentId": 8,
          "flexShrink": 0,
          "width": 40,
          "height": 40,
          "borderRadius": 20,
          "display": "flex",
          "alignItems": "center",
          "justifyContent": "center",
          "backgroundColor": "#7b7bef29",
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 10,
          "parentId": 9,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 11,
          "parentId": 8,
          "semantic": "view"
        },
        {
          "id": 12,
          "parentId": 11,
          "semantic": "text"
        },
        {
          "id": 13,
          "parentId": 11,
          "semantic": "text"
        },
        {
          "id": 14,
          "parentId": 8,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "column",
          "alignItems": "flex-end",
          "semantic": "view"
        },
        {
          "id": 15,
          "parentId": 14,
          "fontSize": 11,
          "color": "#9aa1af",
          "margin": {
            "bottom": 4
          },
          "semantic": "text"
        },
        {
          "id": 16,
          "parentId": 14,
          "semantic": "text"
        }
      ]
    },
    "mine": {
      "nodes": [
        {
          "id": 0,
          "parentId": null,
          "semantic": "view"
        },
        {
          "id": 1,
          "parentId": 0,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "center",
          "padding": {
            "top": 24,
            "right": 0,
            "bottom": 16,
            "left": 0
          },
          "semantic": "view"
        },
        {
          "id": 2,
          "parentId": 1,
          "width": 56,
          "height": 56,
          "borderRadius": 28,
          "display": "flex",
          "alignItems": "center",
          "justifyContent": "center",
          "backgroundColor": "#7b7bef42",
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 3,
          "parentId": 2,
          "fontSize": 20,
          "fontWeight": 700,
          "color": "#9393f5",
          "text": "\u8FD0",
          "semantic": "text"
        },
        {
          "id": 4,
          "parentId": 1,
          "semantic": "view"
        },
        {
          "id": 5,
          "parentId": 4,
          "fontSize": 16,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u8FD0\u8425\u540C\u5B66",
          "semantic": "text"
        },
        {
          "id": 6,
          "parentId": 4,
          "margin": {
            "top": 2
          },
          "fontSize": 12,
          "color": "#9aa1af",
          "text": "\u534E\u4E1C\u5927\u533A \xB7 \u6E20\u9053\u8FD0\u8425",
          "semantic": "text"
        },
        {
          "id": 7,
          "parentId": 0,
          "text": "\u5916\u89C2",
          "semantic": "text"
        },
        {
          "id": 8,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 9,
          "parentId": 8,
          "semantic": "view"
        },
        {
          "id": 10,
          "parentId": 9,
          "flexShrink": 0,
          "width": 28,
          "height": 28,
          "borderRadius": 8,
          "display": "flex",
          "alignItems": "center",
          "justifyContent": "center",
          "backgroundColor": "#7b7bef29",
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 11,
          "parentId": 10,
          "fontSize": 15,
          "color": "#9393f5",
          "text": "\u25D0",
          "semantic": "text"
        },
        {
          "id": 12,
          "parentId": 9,
          "padding": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 13,
          "parentId": 12,
          "text": "\u6DF1\u8272\u6A21\u5F0F",
          "semantic": "text"
        },
        {
          "id": 14,
          "parentId": 12,
          "text": "\u5168\u5E94\u7528\u5373\u65F6\u751F\u6548\uFF08\u65E0\u9700\u5237\u65B0\uFF09",
          "semantic": "text"
        },
        {
          "id": 15,
          "parentId": 9,
          "flexShrink": 0,
          "width": 44,
          "height": 26,
          "borderRadius": 13,
          "backgroundColor": "#2e3340",
          "padding": {
            "top": 2,
            "right": 2,
            "bottom": 2,
            "left": 2
          },
          "boxSizing": "border-box",
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "center",
          "semantic": "view"
        },
        {
          "id": 16,
          "parentId": 15,
          "pointerEvents": false,
          "flexShrink": 0,
          "width": 22,
          "height": 22,
          "borderRadius": 11,
          "backgroundColor": "#ffffff",
          "boxShadow": {
            "dx": 0,
            "dy": 1,
            "blur": 2,
            "spread": 0,
            "color": "#00000059"
          },
          "semantic": "view"
        },
        {
          "id": 17,
          "parentId": 0,
          "text": "\u5168\u5C40\u80FD\u529B",
          "semantic": "text"
        },
        {
          "id": 18,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 19,
          "parentId": 18,
          "semantic": "view"
        },
        {
          "id": 20,
          "parentId": 19,
          "flexShrink": 0,
          "width": 28,
          "height": 28,
          "borderRadius": 8,
          "display": "flex",
          "alignItems": "center",
          "justifyContent": "center",
          "backgroundColor": "#7b7bef29",
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 21,
          "parentId": 20,
          "fontSize": 15,
          "color": "#9393f5",
          "text": "\u25C9",
          "semantic": "text"
        },
        {
          "id": 22,
          "parentId": 19,
          "padding": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 23,
          "parentId": 22,
          "text": "\u5BA2\u670D\u60AC\u6D6E\u7403",
          "semantic": "text"
        },
        {
          "id": 24,
          "parentId": 22,
          "text": "\u5E38\u9A7B\u5165\u53E3\uFF0C\u5173\u95ED\u540E\u5168\u90E8\u9875\u9762\u9690\u85CF",
          "semantic": "text"
        },
        {
          "id": 25,
          "parentId": 19,
          "flexShrink": 0,
          "width": 44,
          "height": 26,
          "borderRadius": 13,
          "backgroundColor": "#2e3340",
          "padding": {
            "top": 2,
            "right": 2,
            "bottom": 2,
            "left": 2
          },
          "boxSizing": "border-box",
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "center",
          "semantic": "view"
        },
        {
          "id": 26,
          "parentId": 25,
          "pointerEvents": false,
          "flexShrink": 0,
          "width": 22,
          "height": 22,
          "borderRadius": 11,
          "backgroundColor": "#ffffff",
          "boxShadow": {
            "dx": 0,
            "dy": 1,
            "blur": 2,
            "spread": 0,
            "color": "#00000059"
          },
          "semantic": "view"
        },
        {
          "id": 27,
          "parentId": 18,
          "semantic": "view"
        },
        {
          "id": 28,
          "parentId": 27,
          "flexShrink": 0,
          "width": 28,
          "height": 28,
          "borderRadius": 8,
          "display": "flex",
          "alignItems": "center",
          "justifyContent": "center",
          "backgroundColor": "#7b7bef29",
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 29,
          "parentId": 28,
          "fontSize": 15,
          "color": "#9393f5",
          "text": "\u266A",
          "semantic": "text"
        },
        {
          "id": 30,
          "parentId": 27,
          "padding": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 31,
          "parentId": 30,
          "text": "\u97F3\u4E50\u64AD\u653E\u6761",
          "semantic": "text"
        },
        {
          "id": 32,
          "parentId": 30,
          "semantic": "text"
        },
        {
          "id": 33,
          "parentId": 27,
          "semantic": "text"
        },
        {
          "id": 34,
          "parentId": 0,
          "text": "\u5173\u4E8E",
          "semantic": "text"
        },
        {
          "id": 35,
          "parentId": 0,
          "semantic": "view"
        },
        {
          "id": 36,
          "parentId": 35,
          "semantic": "navigator"
        },
        {
          "id": 37,
          "parentId": 36,
          "padding": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 38,
          "parentId": 37,
          "text": "\u9A8C\u6536\u63A7\u5236\u53F0",
          "semantic": "text"
        },
        {
          "id": 39,
          "parentId": 37,
          "text": "\u5168\u5C40\u80FD\u529B\u81EA\u68C0",
          "semantic": "text"
        },
        {
          "id": 40,
          "parentId": 36,
          "semantic": "view"
        },
        {
          "id": 41,
          "parentId": 35,
          "semantic": "view"
        },
        {
          "id": 42,
          "parentId": 41,
          "padding": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 43,
          "parentId": 42,
          "text": "\u7248\u672C",
          "semantic": "text"
        },
        {
          "id": 44,
          "parentId": 41,
          "semantic": "text"
        }
      ]
    },
    "verify": {
      "nodes": [
        {
          "id": 0,
          "parentId": null,
          "semantic": "view"
        },
        {
          "id": 1,
          "parentId": 0,
          "padding": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 2,
          "parentId": 1,
          "fontSize": 26,
          "fontWeight": 700,
          "color": "#eef0f5",
          "letterSpacing": -0.3,
          "text": "\u9A8C\u6536\u63A7\u5236\u53F0",
          "semantic": "text"
        },
        {
          "id": 3,
          "parentId": 1,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#b6bcc9",
          "text": "\u516B\u6761\u8D85\u7EA7\u5E94\u7528\u573A\u666F \xB7 \u9010\u6761\u89E6\u53D1\u5E76\u8BFB\u56DE\u72B6\u6001\uFF08\u672C\u9875 = \u9A8C\u6536\u5165\u53E3\uFF09",
          "semantic": "text"
        },
        {
          "id": 4,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 5,
          "parentId": 4,
          "semantic": "view"
        },
        {
          "id": 6,
          "parentId": 5,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 7,
          "parentId": 6,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 8,
          "parentId": 7,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2460 \u5168\u5C40 Toast",
          "semantic": "text"
        },
        {
          "id": 9,
          "parentId": 7,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Overlay \u5C42 \xB7 \u961F\u5217\u8BED\u4E49\uFF08\u6784\u5EFA\u671F\u6309\u9700\u6CE8\u5165\u5BBF\u4E3B\uFF09",
          "semantic": "text"
        },
        {
          "id": 10,
          "parentId": 7,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 11,
          "parentId": 6,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 12,
          "parentId": 11,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u5355\u6761",
          "semantic": "view"
        },
        {
          "id": 13,
          "parentId": 11,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u6392\u961F 3 \u6761",
          "semantic": "view"
        },
        {
          "id": 14,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 15,
          "parentId": 14,
          "semantic": "view"
        },
        {
          "id": 16,
          "parentId": 15,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 17,
          "parentId": 16,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 18,
          "parentId": 17,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2461 \u5168\u5C40 Loading",
          "semantic": "text"
        },
        {
          "id": 19,
          "parentId": 17,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Overlay \u5C42 \xB7 \u591A\u5B9E\u4F8B + \u906E\u7F69\u8303\u56F4",
          "semantic": "text"
        },
        {
          "id": 20,
          "parentId": 17,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 21,
          "parentId": 16,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 22,
          "parentId": 21,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u4E00\u4E2A",
          "semantic": "view"
        },
        {
          "id": 23,
          "parentId": 21,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u4E24\u4E2A\u5171\u5B58",
          "semantic": "view"
        },
        {
          "id": 24,
          "parentId": 21,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u5173\u95ED",
          "semantic": "view"
        },
        {
          "id": 25,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 26,
          "parentId": 25,
          "semantic": "view"
        },
        {
          "id": 27,
          "parentId": 26,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 28,
          "parentId": 27,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 29,
          "parentId": 28,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2462 \u767B\u5F55\u5931\u6548\u62E6\u622A",
          "semantic": "text"
        },
        {
          "id": 30,
          "parentId": 28,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Overlay \u5C42 \xB7 \u4E0D\u53EF\u53D6\u6D88\uFF08\u2605\u624B\u5199\u5BBF\u4E3B\u2014\u2014\u9700\u7ED1 onAction\uFF09",
          "semantic": "text"
        },
        {
          "id": 31,
          "parentId": 28,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 32,
          "parentId": 27,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 33,
          "parentId": 32,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u6A21\u62DF 401",
          "semantic": "view"
        },
        {
          "id": 34,
          "parentId": 32,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u6A21\u62DF\u767B\u5F55\u6210\u529F",
          "semantic": "view"
        },
        {
          "id": 35,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 36,
          "parentId": 35,
          "semantic": "view"
        },
        {
          "id": 37,
          "parentId": 36,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 38,
          "parentId": 37,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 39,
          "parentId": 38,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2463 \u5BA2\u670D\u60AC\u6D6E\u7403",
          "semantic": "text"
        },
        {
          "id": 40,
          "parentId": 38,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Global \u5C42 \xB7 App \u58F3\u58F0\u660E\u4E00\u6B21",
          "semantic": "text"
        },
        {
          "id": 41,
          "parentId": 38,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 42,
          "parentId": 37,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 43,
          "parentId": 42,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u5207\u6362\u663E\u9690",
          "semantic": "view"
        },
        {
          "id": 44,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 45,
          "parentId": 44,
          "semantic": "view"
        },
        {
          "id": 46,
          "parentId": 45,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 47,
          "parentId": 46,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 48,
          "parentId": 47,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2464 \u97F3\u4E50\u64AD\u653E\u6761",
          "semantic": "text"
        },
        {
          "id": 49,
          "parentId": 47,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Global \u5C42 \xB7 \u64AD\u653E\u63A7\u5236",
          "semantic": "text"
        },
        {
          "id": 50,
          "parentId": 47,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 51,
          "parentId": 46,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 52,
          "parentId": 51,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u64AD\u653E",
          "semantic": "view"
        },
        {
          "id": 53,
          "parentId": 51,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u5173\u95ED",
          "semantic": "view"
        },
        {
          "id": 54,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 55,
          "parentId": 54,
          "semantic": "view"
        },
        {
          "id": 56,
          "parentId": 55,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 57,
          "parentId": 56,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 58,
          "parentId": 57,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2465 \u7F51\u7EDC\u72B6\u6001\u6761",
          "semantic": "text"
        },
        {
          "id": 59,
          "parentId": 57,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Global \u5C42 \xB7 \u5F31\u7F51\u63D0\u793A\uFF08\u53EF\u5FFD\u7565\uFF09",
          "semantic": "text"
        },
        {
          "id": 60,
          "parentId": 57,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 61,
          "parentId": 56,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 62,
          "parentId": 61,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u89E6\u53D1",
          "semantic": "view"
        },
        {
          "id": 63,
          "parentId": 61,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u6536\u8D77",
          "semantic": "view"
        },
        {
          "id": 64,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 65,
          "parentId": 64,
          "semantic": "view"
        },
        {
          "id": 66,
          "parentId": 65,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 67,
          "parentId": 66,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 68,
          "parentId": 67,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2466 \u4E3B\u9898\u5BB9\u5668",
          "semantic": "text"
        },
        {
          "id": 69,
          "parentId": 67,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Global \u5C42 \xB7 \u6DF1/\u6D45\u5207\u6362\uFF08\u65E0\u9700\u5237\u65B0\uFF09",
          "semantic": "text"
        },
        {
          "id": 70,
          "parentId": 67,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 71,
          "parentId": 66,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 72,
          "parentId": 71,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u5207\u6362\u4E3B\u9898",
          "semantic": "view"
        },
        {
          "id": 73,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 74,
          "parentId": 73,
          "semantic": "view"
        },
        {
          "id": 75,
          "parentId": 74,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 76,
          "parentId": 75,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 77,
          "parentId": 76,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2467 IM \u672A\u8BFB\u89D2\u6807",
          "semantic": "text"
        },
        {
          "id": 78,
          "parentId": 76,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "Global + \u72B6\u6001 \xB7 \u8DE8\u9875\u540C\u6B65",
          "semantic": "text"
        },
        {
          "id": 79,
          "parentId": 76,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 80,
          "parentId": 75,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 81,
          "parentId": 80,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "+1",
          "semantic": "view"
        },
        {
          "id": 82,
          "parentId": 80,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#1c1f26",
          "color": "#b6bcc9",
          "fontSize": 12,
          "borderWidth": 1,
          "borderColor": "#2e3340",
          "text": "\u6E05\u96F6",
          "semantic": "view"
        },
        {
          "id": 83,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 84,
          "parentId": 83,
          "semantic": "view"
        },
        {
          "id": 85,
          "parentId": 84,
          "display": "flex",
          "flexDirection": "row",
          "alignItems": "flex-start",
          "justifyContent": "space-between",
          "semantic": "view"
        },
        {
          "id": 86,
          "parentId": 85,
          "flexGrow": 1,
          "flexShrink": 1,
          "flexBasis": 0,
          "minWidth": 0,
          "margin": {
            "right": 12
          },
          "semantic": "view"
        },
        {
          "id": 87,
          "parentId": 86,
          "fontSize": 14,
          "fontWeight": 600,
          "color": "#eef0f5",
          "text": "\u2468 Global \u5C42\u5185\u5B58\uFF08GP7\uFF09",
          "semantic": "text"
        },
        {
          "id": 88,
          "parentId": 86,
          "margin": {
            "top": 2
          },
          "fontSize": 11,
          "color": "#9aa1af",
          "text": "\u5E38\u9A7B\u76D1\u63A7 \xB7 \u5206\u7AEF\u53E3\u5F84\uFF08MP\uFF1A\u72B6\u6001\u4E00\u4EFD + \u6BCF\u9875\u521D\u503C \xD7 \u9875\u9762\u6808\uFF09",
          "semantic": "text"
        },
        {
          "id": 89,
          "parentId": 86,
          "margin": {
            "top": 8
          },
          "fontSize": 12,
          "color": "#9393f5",
          "semantic": "text"
        },
        {
          "id": 90,
          "parentId": 85,
          "flexShrink": 0,
          "display": "flex",
          "flexDirection": "row",
          "flexWrap": "wrap",
          "justifyContent": "flex-end",
          "maxWidth": 200,
          "semantic": "view"
        },
        {
          "id": 91,
          "parentId": 90,
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 8,
            "left": 8
          },
          "padding": {
            "top": 8,
            "right": 12,
            "bottom": 8,
            "left": 12
          },
          "borderRadius": 10,
          "backgroundColor": "#7b7bef",
          "color": "#ffffff",
          "fontSize": 12,
          "text": "\u8BFB\u5185\u5B58",
          "semantic": "view"
        },
        {
          "id": 92,
          "parentId": 0,
          "text": "\u64CD\u4F5C\u65E5\u5FD7",
          "semantic": "text"
        },
        {
          "id": 93,
          "parentId": 0,
          "margin": {
            "left": 0,
            "right": 0
          },
          "semantic": "view"
        },
        {
          "id": 94,
          "parentId": 93,
          "semantic": "view"
        },
        {
          "id": 95,
          "parentId": 94,
          "fontFamily": "monospace",
          "fontSize": 11,
          "color": "#b6bcc9",
          "lineHeight": "1.7",
          "semantic": "text"
        },
        {
          "id": 96,
          "parentId": 94,
          "fontFamily": "monospace",
          "fontSize": 11,
          "color": "#9aa1af",
          "lineHeight": "1.7",
          "text": "\uFF08\u64CD\u4F5C\u540E\u5728\u6B64\u7559\u75D5\uFF09",
          "semantic": "text"
        },
        {
          "id": 97,
          "parentId": 0,
          "semantic": "p-auth-gate"
        }
      ]
    }
  };

  // packages/router/src/codegen/app.ts
  function toScreenEntry(node) {
    const name = node.name ?? node.path.replace(/^\//, "").replace(/\//g, "-");
    const entry = {
      name,
      path: node.path,
      componentPath: node.componentPath,
      children: node.children.map((c) => c.name ?? c.path.replace(/^\//, "").replace(/\//g, "-")),
      isTab: node.meta.isTab === true
    };
    if (node.meta.transition) entry.transition = node.meta.transition;
    const budget = node.meta.budgetNodes;
    if (typeof budget === "number" && budget > 0) entry.budgetNodes = budget;
    const ka = node.meta.branch?.keepAlive;
    if (ka === "none" || ka === "active" || ka === "all") entry.keepAlive = ka;
    return entry;
  }
  function flattenScreenEntries(nodes) {
    const out = [];
    for (const n of nodes) {
      out.push(toScreenEntry(n));
      out.push(...flattenScreenEntries(n.children));
    }
    return out;
  }

  // examples/router/auto-routes.ts
  var routes = [
    { name: "builtin-components-demo", path: "pages/builtin-components-demo", component: "../pages/builtin-components-demo.vue", parent: "index", meta: { "title": "\u5185\u7F6E\u7EC4\u4EF6" } },
    { name: "components-demo", path: "pages/components-demo", component: "../pages/components-demo.vue", parent: "index", meta: { "title": "\u7EC4\u4EF6\u6F14\u793A" } },
    { name: "config-demo", path: "pages/config-demo", component: "../pages/config-demo.vue", parent: "index", meta: { "title": "\u914D\u7F6E\u6F14\u793A" } },
    { name: "consistency-stress", path: "pages/consistency-stress", component: "../pages/consistency-stress.vue", parent: "index" },
    { name: "dev-host-demo", path: "pages/dev-host-demo", component: "../pages/dev-host-demo.vue", parent: "index" },
    { name: "devtools-open-api-demo", path: "pages/devtools-open-api-demo", component: "../pages/devtools-open-api-demo.vue", parent: "index", meta: { "title": "\u5F00\u653E API \u6F14\u793A" } },
    { name: "docs-engine-demo", path: "pages/docs-engine-demo", component: "../pages/docs-engine-demo.vue", parent: "index" },
    { name: "fluid-layout-demo", path: "pages/fluid-layout-demo", component: "../pages/fluid-layout-demo.vue", parent: "index", meta: { "title": "\u67D4\u6027\u5E03\u5C40" } },
    { name: "fluid-system-demo", path: "pages/fluid-system-demo", component: "../pages/fluid-system-demo.vue", parent: "index", meta: { "title": "Fluid System" } },
    { name: "forms", path: "pages/forms", component: "../pages/forms.vue", parent: "index", meta: { "title": "\u8868\u5355\u4E0E\u6307\u4EE4" } },
    { name: "glass-demo", path: "pages/glass-demo", component: "../pages/glass-demo.vue", parent: "index", meta: { "title": "\u6DB2\u6001\u73BB\u7483\uFF08G-07\uFF09" } },
    { name: "gp0-root-portal", path: "pages/gp0-root-portal", component: "../pages/gp0-root-portal.vue", parent: "index" },
    { name: "gp3-global-layer-demo", path: "pages/gp3-global-layer-demo", component: "../pages/gp3-global-layer-demo.vue", parent: "index" },
    { name: "i18n-demo", path: "pages/i18n-demo", component: "../pages/i18n-demo.vue", parent: "index", meta: { "title": "\u56FD\u9645\u5316" } },
    { name: "index", path: "pages/index", component: "../pages/index.vue", meta: { "title": "\u9996\u9875", "isTab": true } },
    { name: "mine", path: "pages/mine", component: "../pages/mine.vue", parent: "index", meta: { "title": "\u6211\u7684", "isTab": true, "branch": { "keepAlive": "none" } } },
    { name: "mp-semantics-demo", path: "pages/mp-semantics-demo", component: "../pages/mp-semantics-demo.vue", parent: "index" },
    { name: "native-components-demo", path: "pages/native-components-demo", component: "../pages/native-components-demo.vue", parent: "index", meta: { "title": "\u539F\u751F\u80FD\u529B\u7EC4\u4EF6" } },
    { name: "pinia-demo", path: "pages/pinia-demo", component: "../pages/pinia-demo.vue", parent: "index", meta: { "title": "\u72B6\u6001\u7BA1\u7406" } },
    { name: "platform-api-demo", path: "pages/platform-api-demo", component: "../pages/platform-api-demo.vue", parent: "index", meta: { "title": "PlatformAPI \u6536\u53E3" } },
    { name: "provide-inject-demo", path: "pages/provide-inject-demo", component: "../pages/provide-inject-demo.vue", parent: "index", meta: { "title": "\u6CE8\u5165\u6F14\u793A" } },
    { name: "render-backend-demo", path: "pages/render-backend-demo", component: "../pages/render-backend-demo.vue", parent: "index" },
    { name: "semantic-primitives-demo", path: "pages/semantic-primitives-demo", component: "../pages/semantic-primitives-demo.vue", parent: "index" },
    { name: "showcase", path: "pages/showcase", component: "../pages/showcase.vue", parent: "index", meta: { "title": "\u8F6C\u573A\u6F14\u793A" } },
    { name: "svg-showcase-demo", path: "pages/svg-showcase-demo", component: "../pages/svg-showcase-demo.vue", parent: "index" },
    { name: "svg-skeleton-demo", path: "pages/svg-skeleton-demo", component: "../pages/svg-skeleton-demo.vue", parent: "index" },
    { name: "user", path: "pages/user/index", component: "../pages/user/index.vue", parent: "index", meta: { "requiresAuth": true, "transition": "slideUp", "title": "\u7528\u6237\u4E2D\u5FC3" } },
    { name: "user-profile", path: "pages/user/profile", component: "../pages/user/profile.vue", parent: "user", meta: { "requiresAuth": true, "transition": "slideUp", "title": "\u4E2A\u4EBA\u8D44\u6599" } },
    { name: "virtual-list-demo", path: "pages/virtual-list-demo", component: "../pages/virtual-list-demo.vue", parent: "index", meta: { "title": "\u865A\u62DF\u5217\u8868" } },
    { name: "vmodel-mp-test", path: "pages/vmodel-mp-test", component: "../pages/vmodel-mp-test.vue", parent: "index" },
    { name: "vue-compat-demo", path: "pages/vue-compat-demo", component: "../pages/vue-compat-demo.vue", parent: "index" },
    { name: "order-pages-list", path: "subpackages/order/pages/list", component: "../subpackages/order/pages/list.vue", subPackage: "order", meta: { "title": "\u8BA2\u5355\u5217\u8868" } },
    { name: "svg-lab-pages-gp4-auth-gate-demo", path: "subpackages/svg-lab/pages/gp4-auth-gate-demo", component: "../subpackages/svg-lab/pages/gp4-auth-gate-demo.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-gp4-loading-demo", path: "subpackages/svg-lab/pages/gp4-loading-demo", component: "../subpackages/svg-lab/pages/gp4-loading-demo.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-gp4-toast-queue-demo", path: "subpackages/svg-lab/pages/gp4-toast-queue-demo", component: "../subpackages/svg-lab/pages/gp4-toast-queue-demo.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-gp5-scenarios-demo", path: "subpackages/svg-lab/pages/gp5-scenarios-demo", component: "../subpackages/svg-lab/pages/gp5-scenarios-demo.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-image-spike", path: "subpackages/svg-lab/pages/image-spike", component: "../subpackages/svg-lab/pages/image-spike.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-module-import-demo", path: "subpackages/svg-lab/pages/module-import-demo", component: "../subpackages/svg-lab/pages/module-import-demo.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-anim-probe", path: "subpackages/svg-lab/pages/svg-anim-probe", component: "../subpackages/svg-lab/pages/svg-anim-probe.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-canvas-probe", path: "subpackages/svg-lab/pages/svg-canvas-probe", component: "../subpackages/svg-lab/pages/svg-canvas-probe.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-canvas-test", path: "subpackages/svg-lab/pages/svg-canvas-test", component: "../subpackages/svg-lab/pages/svg-canvas-test.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-hit-test", path: "subpackages/svg-lab/pages/svg-hit-test", component: "../subpackages/svg-lab/pages/svg-hit-test.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-p2-spike", path: "subpackages/svg-lab/pages/svg-p2-spike", component: "../subpackages/svg-lab/pages/svg-p2-spike.vue", subPackage: "svg-lab" },
    { name: "svg-lab-pages-svg-spike", path: "subpackages/svg-lab/pages/svg-spike", component: "../subpackages/svg-lab/pages/svg-spike.vue", subPackage: "svg-lab" }
  ];
  var tabRoutes = routes.filter((r) => r.meta?.isTab);
  var routeMap = routes.reduce((m, r) => {
    m[r.name] = r;
    return m;
  }, {});
  var screens = {
    "builtin-components-demo": {
      "name": "builtin-components-demo",
      "path": "pages/builtin-components-demo"
    },
    "components-demo": {
      "name": "components-demo",
      "path": "pages/components-demo"
    },
    "config-demo": {
      "name": "config-demo",
      "path": "pages/config-demo"
    },
    "consistency-stress": {
      "name": "consistency-stress",
      "path": "pages/consistency-stress"
    },
    "dev-host-demo": {
      "name": "dev-host-demo",
      "path": "pages/dev-host-demo"
    },
    "devtools-open-api-demo": {
      "name": "devtools-open-api-demo",
      "path": "pages/devtools-open-api-demo"
    },
    "docs-engine-demo": {
      "name": "docs-engine-demo",
      "path": "pages/docs-engine-demo"
    },
    "fluid-layout-demo": {
      "name": "fluid-layout-demo",
      "path": "pages/fluid-layout-demo"
    },
    "fluid-system-demo": {
      "name": "fluid-system-demo",
      "path": "pages/fluid-system-demo"
    },
    "forms": {
      "name": "forms",
      "path": "pages/forms"
    },
    "glass-demo": {
      "name": "glass-demo",
      "path": "pages/glass-demo"
    },
    "gp0-root-portal": {
      "name": "gp0-root-portal",
      "path": "pages/gp0-root-portal"
    },
    "gp3-global-layer-demo": {
      "name": "gp3-global-layer-demo",
      "path": "pages/gp3-global-layer-demo"
    },
    "i18n-demo": {
      "name": "i18n-demo",
      "path": "pages/i18n-demo"
    },
    "index": {
      "name": "index",
      "path": "pages/index"
    },
    "mine": {
      "name": "mine",
      "path": "pages/mine",
      "keepAlive": "none"
    },
    "mp-semantics-demo": {
      "name": "mp-semantics-demo",
      "path": "pages/mp-semantics-demo"
    },
    "native-components-demo": {
      "name": "native-components-demo",
      "path": "pages/native-components-demo"
    },
    "pinia-demo": {
      "name": "pinia-demo",
      "path": "pages/pinia-demo"
    },
    "platform-api-demo": {
      "name": "platform-api-demo",
      "path": "pages/platform-api-demo"
    },
    "provide-inject-demo": {
      "name": "provide-inject-demo",
      "path": "pages/provide-inject-demo"
    },
    "render-backend-demo": {
      "name": "render-backend-demo",
      "path": "pages/render-backend-demo"
    },
    "semantic-primitives-demo": {
      "name": "semantic-primitives-demo",
      "path": "pages/semantic-primitives-demo"
    },
    "showcase": {
      "name": "showcase",
      "path": "pages/showcase"
    },
    "svg-showcase-demo": {
      "name": "svg-showcase-demo",
      "path": "pages/svg-showcase-demo"
    },
    "svg-skeleton-demo": {
      "name": "svg-skeleton-demo",
      "path": "pages/svg-skeleton-demo"
    },
    "user": {
      "name": "user",
      "path": "pages/user/index",
      "transition": "slideUp"
    },
    "user-profile": {
      "name": "user-profile",
      "path": "pages/user/profile",
      "transition": "slideUp"
    },
    "virtual-list-demo": {
      "name": "virtual-list-demo",
      "path": "pages/virtual-list-demo"
    },
    "vmodel-mp-test": {
      "name": "vmodel-mp-test",
      "path": "pages/vmodel-mp-test"
    },
    "vue-compat-demo": {
      "name": "vue-compat-demo",
      "path": "pages/vue-compat-demo"
    },
    "order-pages-list": {
      "name": "order-pages-list",
      "path": "subpackages/order/pages/list"
    },
    "svg-lab-pages-gp4-auth-gate-demo": {
      "name": "svg-lab-pages-gp4-auth-gate-demo",
      "path": "subpackages/svg-lab/pages/gp4-auth-gate-demo"
    },
    "svg-lab-pages-gp4-loading-demo": {
      "name": "svg-lab-pages-gp4-loading-demo",
      "path": "subpackages/svg-lab/pages/gp4-loading-demo"
    },
    "svg-lab-pages-gp4-toast-queue-demo": {
      "name": "svg-lab-pages-gp4-toast-queue-demo",
      "path": "subpackages/svg-lab/pages/gp4-toast-queue-demo"
    },
    "svg-lab-pages-gp5-scenarios-demo": {
      "name": "svg-lab-pages-gp5-scenarios-demo",
      "path": "subpackages/svg-lab/pages/gp5-scenarios-demo"
    },
    "svg-lab-pages-image-spike": {
      "name": "svg-lab-pages-image-spike",
      "path": "subpackages/svg-lab/pages/image-spike"
    },
    "svg-lab-pages-module-import-demo": {
      "name": "svg-lab-pages-module-import-demo",
      "path": "subpackages/svg-lab/pages/module-import-demo"
    },
    "svg-lab-pages-svg-anim-probe": {
      "name": "svg-lab-pages-svg-anim-probe",
      "path": "subpackages/svg-lab/pages/svg-anim-probe"
    },
    "svg-lab-pages-svg-canvas-probe": {
      "name": "svg-lab-pages-svg-canvas-probe",
      "path": "subpackages/svg-lab/pages/svg-canvas-probe"
    },
    "svg-lab-pages-svg-canvas-test": {
      "name": "svg-lab-pages-svg-canvas-test",
      "path": "subpackages/svg-lab/pages/svg-canvas-test"
    },
    "svg-lab-pages-svg-hit-test": {
      "name": "svg-lab-pages-svg-hit-test",
      "path": "subpackages/svg-lab/pages/svg-hit-test"
    },
    "svg-lab-pages-svg-p2-spike": {
      "name": "svg-lab-pages-svg-p2-spike",
      "path": "subpackages/svg-lab/pages/svg-p2-spike"
    },
    "svg-lab-pages-svg-spike": {
      "name": "svg-lab-pages-svg-spike",
      "path": "subpackages/svg-lab/pages/svg-spike"
    }
  };
  var screenNames = ["builtin-components-demo", "components-demo", "config-demo", "consistency-stress", "dev-host-demo", "devtools-open-api-demo", "docs-engine-demo", "fluid-layout-demo", "fluid-system-demo", "forms", "glass-demo", "gp0-root-portal", "gp3-global-layer-demo", "i18n-demo", "index", "mine", "mp-semantics-demo", "native-components-demo", "pinia-demo", "platform-api-demo", "provide-inject-demo", "render-backend-demo", "semantic-primitives-demo", "showcase", "svg-showcase-demo", "svg-skeleton-demo", "user", "user-profile", "virtual-list-demo", "vmodel-mp-test", "vue-compat-demo", "order-pages-list", "svg-lab-pages-gp4-auth-gate-demo", "svg-lab-pages-gp4-loading-demo", "svg-lab-pages-gp4-toast-queue-demo", "svg-lab-pages-gp5-scenarios-demo", "svg-lab-pages-image-spike", "svg-lab-pages-module-import-demo", "svg-lab-pages-svg-anim-probe", "svg-lab-pages-svg-canvas-probe", "svg-lab-pages-svg-canvas-test", "svg-lab-pages-svg-hit-test", "svg-lab-pages-svg-p2-spike", "svg-lab-pages-svg-spike"];
  var tabNames = ["index", "mine"];

  // hosts/shared/bridge/entry-app-project.ts
  function __proteusAppProjectRun(argsJson) {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const names = Array.isArray(screenNames) ? screenNames : [];
    const entry = args.entry ?? (Array.isArray(tabNames) && tabNames.length ? tabNames[0] : names[0]);
    const steps = Math.max(0, args.steps ?? 3);
    const base = {
      ok: true,
      scene: "app-project",
      screens: Object.keys(screens).length,
      name_count: names.length,
      tab_count: Array.isArray(tabNames) ? tabNames.length : 0,
      route_count: Array.isArray(routes) ? routes.length : 0,
      // ★项目声明被携带的证据：多少屏带 transition（来自 router.meta / <route>）
      transitions_carried: Object.values(screens).filter((s) => !!s.transition).length,
      entry
    };
    if (!entry || !screens[entry]) {
      return JSON.stringify({ ...base, ok: false, error: `\u5165\u53E3\u5C4F "${entry}" \u4E0D\u5728\u9879\u76EE\u5C4F\u6CE8\u518C\u8868\uFF08\u53EF\u7528\uFF1A${names.slice(0, 6).join(", ")}\u2026\uFF09` });
    }
    const stack = createAppStack({ screens });
    stack.push(entry);
    stack.drainCommands();
    const afterEntry = { depth: stack.depth, top: stack.current()?.name, transition: stack.current()?.transition };
    const pushed = [];
    for (const n of names) {
      if (pushed.length >= steps) break;
      if (n === entry) continue;
      if (!screens[n]) continue;
      stack.push(n);
      pushed.push(n);
    }
    stack.drainCommands();
    const afterPush = {
      depth: stack.depth,
      top: stack.current()?.name,
      pushed,
      // 每个被 push 的屏，其转场声明（来自项目 meta）——空 = 该屏未声明
      transitions: pushed.map((n) => screens[n]?.transition ?? null)
    };
    stack.pop();
    const cmds = stack.drainCommands();
    const afterBack = { depth: stack.depth, top: stack.current()?.name };
    const backOps = cmds.map((c) => c.op);
    let apiResult;
    try {
      const nav = createAppNavigation({
        invoke: (m, a) => {
          const ph = globalThis.proteusHost;
          if (!ph || typeof ph.invoke !== "function") throw new Error("\u5BBF\u4E3B invoke \u901A\u9053\u7F3A\u5931");
          return ph.invoke(m, a);
        },
        screens
      });
      const router = createRouter(routes, { adapter: nav.adapter });
      apiResult = { adapter_ready: true, api_stack_depth: nav.stack.depth };
    } catch (e) {
      apiResult = { adapter_ready: false, error: String(e) };
    }
    const branchResult = (() => {
      try {
        const nav = createBranchNavigator({ screens, tabNames });
        const branches = nav.branches.map((b) => b.name);
        const branchKeep = nav.branches.map((b) => `${b.name}:${b.keepAlive}`);
        if (branches.length === 0) {
          return { g_ok: false, g_error: "\u9879\u76EE\u4EA7\u7269\u65E0\u5206\u652F\uFF08tabNames \u4E3A\u7A7A\u2014\u2014\u68C0\u67E5 router.pages \u7684 isTab\uFF09" };
        }
        const first = branches[0];
        const second = branches[1] ?? branches[0];
        if (branches.length < 2) {
          return {
            g_ok: false,
            g_error: `\u9879\u76EE\u4EA7\u7269\u53EA\u6709 ${branches.length} \u4E2A\u5206\u652F\uFF08\u5224\u636E\u9700\u8981 \u22652\u2014\u2014\u5207\u5206\u652F\u4FDD\u6808\u9700\u8981\u4E24\u4E2A\uFF09`,
            g_branches: branches
          };
        }
        const subA = names.find((n) => !branches.includes(n) && screens[n]) ?? null;
        const subB = names.filter((n) => !branches.includes(n) && screens[n] && n !== subA)[0] ?? null;
        const a = nav.stackOf(first);
        if (subA) a.push(subA);
        if (subB) a.push(subB);
        const depthA0 = a.depth;
        nav.switchTo(second);
        const bRoot = nav.stackOf(second).depth;
        const depthAAfterBack = (nav.switchTo(first), nav.stackOf(first).depth);
        const kaPolicy = nav.keepAlivePolicy().map((p) => `${p.branch}:${p.keep ? "keep" : "drop"}`);
        const noneBranch = nav.branches.find((b) => b.keepAlive === "none")?.name ?? null;
        let noneFrames = [];
        let noneFrozen = 0;
        let noneRebuilds = 0;
        let noneDepth = 0;
        if (noneBranch && noneBranch !== nav.active()) {
          nav.switchTo(noneBranch);
          const ns = nav.stackOf(noneBranch);
          if (subA && subA !== noneBranch) ns.push(subA);
          noneDepth = ns.depth;
          nav.switchTo(branches.find((b) => b !== noneBranch));
          nav.drainCommands();
          noneFrames = nav.stackOf(noneBranch).frames().map((f) => f.name);
          noneFrozen = nav.stackOf(noneBranch).stats().frozen;
          nav.switchTo(noneBranch);
          noneRebuilds = nav.stackOf(noneBranch).stats().rebuildCount;
        }
        const beforeBack = {
          active: nav.active(),
          activeDepth: nav.activeStack().depth,
          otherDepth: nav.stackOf(branches.find((b) => b !== nav.active())).depth
        };
        const back1 = nav.back();
        const otherAfter = nav.stackOf(branches.find((b) => b !== nav.active())).depth;
        let backSystem = false;
        for (let i = 0; i < 8; i++) {
          const o = nav.back();
          if (o.action === "pop") continue;
          if (o.action === "system") backSystem = true;
          break;
        }
        const cmds2 = nav.drainCommands();
        const cmdBranches = [...new Set(cmds2.map((c) => c.branch))];
        const g_ok = depthAAfterBack === depthA0 && // 切分支保栈（核心判据）
        depthA0 >= 2 && // 真的推过屏（>=2 层）
        bRoot >= 1 && // B 懒建根
        noneFrozen === noneDepth && noneDepth >= 2 && noneFrames.length === noneDepth && noneRebuilds >= 1 && // none 档：释放 + 状态保留 + 重建
        back1.action === "pop" && otherAfter === beforeBack.otherDepth && // 返回只作用于活跃分支
        backSystem;
        return {
          g_ok,
          g_branches: branches,
          g_keep_alive: branchKeep,
          g_policy: kaPolicy,
          g_none_branch: noneBranch,
          g_none_depth: noneDepth,
          g_none_frozen: noneFrozen,
          g_none_frames: noneFrames,
          g_none_rebuilds: noneRebuilds,
          g_switch_kept_depth: depthAAfterBack,
          // = depthA0 时保栈成立
          g_switch_depth_before: depthA0,
          g_b_root_depth: bRoot,
          g_back_action: back1.action,
          g_back_other_untouched: otherAfter === beforeBack.otherDepth,
          g_back_system: backSystem,
          g_cmd_branches: cmdBranches,
          g_note: "\u5206\u652F\u5BFC\u822A\u5668\uFF08NB1/NB3/NB6\uFF09\u2014\u2014\u5207\u5206\u652F\u4FDD\u6808 + none \u6863\u91CA\u653E\u91CD\u5EFA + \u8FD4\u56DE\u5F52\u5C5E\uFF08\u771F\u673A\uFF09"
        };
      } catch (e) {
        return { g_ok: false, g_error: String(e) };
      }
    })();
    return JSON.stringify({
      ...base,
      after_entry: afterEntry,
      after_push: afterPush,
      after_back: afterBack,
      back_ops: backOps,
      ...apiResult,
      ...branchResult
    });
  }
  globalThis.__proteusAppProjectRun = __proteusAppProjectRun;

  // hosts/shared/bridge/entry-app-stack.ts
  function buildNodes(fans) {
    const nodes = [];
    for (let i = 0; i < fans; i++) {
      nodes.push({
        loc: { file: `page-${i}.vue`, line: 1, column: 1 },
        path: `/page-${i}`,
        name: `page-${i}`,
        meta: { title: `\u9875\u9762 ${i}`, transition: i % 2 === 0 ? "slideUp" : "halfScreen" },
        lazy: true,
        componentPath: `/pages/page-${i}.vue`,
        children: []
      });
    }
    return nodes;
  }
  function __proteusAppStackRun(argsJson) {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const depth = args.depth ?? 2e4;
    const fans = args.fans ?? 32;
    const budget = args.budget ?? 1e3;
    const nodes = buildNodes(fans);
    const entries = flattenScreenEntries(nodes);
    const screens2 = {};
    for (const e of entries) screens2[e.name] = { name: e.name, path: e.path, transition: e.transition, budgetNodes: e.budgetNodes };
    const names = entries.map((e) => e.name);
    const deep = createAppStack({ screens: screens2 });
    const tA0 = Date.now();
    for (let i = 0; i < depth; i++) deep.push(names[i % fans], { i });
    const pushMs = Date.now() - tA0;
    const depthReached = deep.depth;
    const deepCmds = deep.drainCommands();
    const count = (arr, op) => arr.filter((c) => c.op === op).length;
    const aMount = count(deepCmds, "mount");
    const aEnter = count(deepCmds, "enter");
    const aExit = count(deepCmds, "exit");
    const aUnmount = count(deepCmds, "unmount");
    const tPop0 = Date.now();
    deep.popToRoot();
    const popMs = Date.now() - tPop0;
    const depthAfterRoot = deep.depth;
    const rootCmds = deep.drainCommands();
    const rootUnmount = count(rootCmds, "unmount");
    const frozen = createAppStack({ screens: screens2, policy: { nodeBudget: budget, keepWindow: 3, defaultScreenNodes: 64 } });
    const tB0 = Date.now();
    for (let i = 0; i < depth; i++) frozen.push(names[i % fans], { i });
    const frozenPushMs = Date.now() - tB0;
    const frozenStats = frozen.stats();
    const frozenCmds = frozen.drainCommands();
    const freezeUnmounts = frozenCmds.filter((c) => c.op === "unmount" && c.reason === "freeze").length;
    const smallScreens = {};
    for (const n of names) smallScreens[n] = { name: n, path: `/page-${n}`, budgetNodes: 64 };
    const rebuild = createAppStack({ screens: smallScreens, policy: { nodeBudget: 64, keepWindow: 1, defaultScreenNodes: 64 } });
    rebuild.push(names[0]);
    rebuild.push(names[1]);
    const cFrozen = rebuild.stats().frozen;
    rebuild.drainCommands();
    rebuild.pop();
    const cCmds = rebuild.drainCommands();
    const cMounts = cCmds.filter((c) => c.op === "mount");
    const cRebuildMounts = cMounts.filter((c) => c.op === "mount" && c.rebuild).length;
    const cRebuildStat = rebuild.stats().rebuildCount;
    const navDepth = Math.min(depth, 5e3);
    const nav = createAppStack({ screens: screens2 });
    for (let i = 0; i < navDepth; i++) nav.push(names[i % fans]);
    nav.drainCommands();
    const keep = Math.floor(navDepth / 2);
    const frames = [];
    for (let i = 0; i < keep; i++) frames.push({ name: names[i % fans] });
    const tD0 = Date.now();
    nav.navigate(frames);
    const navMs = Date.now() - tD0;
    const navCmds = nav.drainCommands();
    const dMount = count(navCmds, "mount");
    const dUnmount = count(navCmds, "unmount");
    const dEnter = count(navCmds, "enter");
    const dDepth = nav.depth;
    const result = {
      ok: true,
      scene: "app-stack",
      // 规模参数（读数可复现）
      depth,
      fans,
      budget,
      screens: entries.length,
      // 场景 A（深栈）
      a_depth_reached: depthReached,
      a_push_ms: pushMs,
      a_pop_ms: popMs,
      a_depth_after_pop_to_root: depthAfterRoot,
      a_mounts: aMount,
      a_enters: aEnter,
      a_exits: aExit,
      a_unmounts: aUnmount,
      a_root_unmounts: rootUnmount,
      // 场景 B（冻结）
      b_frozen_count: frozenStats.frozen,
      b_active_nodes: frozenStats.activeNodes,
      b_over_budget: frozenStats.overBudget,
      b_freeze_unmounts: freezeUnmounts,
      b_push_ms: frozenPushMs,
      b_depth: frozenStats.depth,
      // 场景 C（重建）
      c_frozen_before_pop: cFrozen,
      c_rebuild_mounts: cRebuildMounts,
      c_rebuild_stat: cRebuildStat,
      // 场景 D（navigate diff）
      d_mounts: dMount,
      d_unmounts: dUnmount,
      d_enters: dEnter,
      d_depth: dDepth,
      d_nav_ms: navMs
    };
    return JSON.stringify(result);
  }
  globalThis.__proteusAppStackRun = __proteusAppStackRun;
  function invokeHostRaw(method) {
    const ph = globalThis.proteusHost;
    if (!ph || typeof ph.invoke !== "function") throw new Error("\u5BBF\u4E3B invoke \u901A\u9053\u7F3A\u5931");
    const out = JSON.parse(ph.invoke(method, "null"));
    return out && out.ok === false ? { error: out } : out.data ?? out;
  }
  async function runExecutorScenario() {
    const eSpecs = {
      home: { name: "home", path: "/home", transition: "slideUp" },
      detail: { name: "detail", path: "/detail", transition: "slideUp" },
      third: { name: "third", path: "/third", transition: "halfScreen" }
    };
    const eStack = createAppStack({ screens: eSpecs, policy: { keepWindow: 3 } });
    const eLog = [];
    const ePlays = [];
    const ePorts = createHostScreenPorts({
      invoke: (m, a) => {
        const ph = globalThis.proteusHost;
        if (!ph || typeof ph.invoke !== "function") throw new Error("\u5BBF\u4E3B invoke \u901A\u9053\u7F3A\u5931\uFF08screen.* \u65E0\u6CD5\u9001\u8FBE\u5BBF\u4E3B\uFF09");
        return ph.invoke(m, a);
      }
    });
    const eTree = {
      mountScreen(sc) {
        const node = ePorts.tree.mountScreen(sc);
        eLog.push(`mount:${sc.name}:rebuild=${sc.rebuild}:node=${node}`);
        return node;
      },
      setScreenVisible(screenId, v, root) {
        eLog.push(`visible:${screenId}:${v}:node=${root}`);
        ePorts.tree.setScreenVisible(screenId, v, root);
      },
      destroyScreen(screenId, reason, root) {
        eLog.push(`destroy:${screenId}:${reason}:node=${root}`);
        ePorts.tree.destroyScreen(screenId, reason, root);
      }
    };
    const eExecutor = createScreenExecutor({
      host: eTree,
      anim: {
        async playRouteTransition(plan, ctx) {
          const i0 = plan.incoming.anims[0];
          const o0 = plan.outgoing.anims[0];
          ePlays.push({
            direction: ctx.direction,
            transition: ctx.transition,
            inAnims: plan.incoming.anims.length,
            outAnims: plan.outgoing.anims.length,
            firstInFrom: i0 && typeof i0.from === "number" ? i0.from : null,
            firstInTo: i0 && typeof i0.to === "number" ? i0.to : null,
            firstOutFrom: o0 && typeof o0.from === "number" ? o0.from : null,
            firstOutTo: o0 && typeof o0.to === "number" ? o0.to : null
          });
          await ePorts.anim.playRouteTransition(plan, ctx);
        }
      },
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o ?? {}),
      // ★★★阶段 1b（B5 · 2026-10-04）：**屏内容来自真实 SFC 产物**（构建期生成）——
      //   `APP_SCREEN_CONTENT[屏名]` 是 `buildLayoutTemplate(SFC) → screenContentFromLayoutTemplate`
      //   的产物（不是手写节点）。未命中的屏回落 `default`/首个（装置屏名与项目屏名不完全重合时）。
      contentOf: (s) => {
        const byName = APP_SCREEN_CONTENT;
        return byName[s.name] ?? byName.index;
      },
      onScreenMounted: (id) => eStack.markRebuilt(id)
    });
    const ePump = () => eExecutor.applyCommands(eStack.drainCommands());
    eStack.push("home");
    await ePump();
    const e1 = { log: [...eLog], plays: [...ePlays] };
    const eHomeId = eStack.stack[0]?.screenId ?? "";
    let e4Source = { captured: false };
    try {
      const homeRoot0 = eExecutor.subtreeNode(eHomeId);
      if (homeRoot0 === void 0) throw new Error(`subtreeNode \u7F3A home \u5C4F\u6839\uFF08${eHomeId}\uFF09`);
      const srcRect = await ePorts.shared.rect(eHomeId, homeRoot0 + 2);
      e4Source = { captured: true, screen: eHomeId, node: homeRoot0 + 2, rect: srcRect };
    } catch (err) {
      e4Source = { captured: false, error: String(err) };
    }
    eLog.length = 0;
    ePlays.length = 0;
    eStack.push("detail");
    await ePump();
    const e2 = { log: [...eLog], plays: [...ePlays] };
    const eDetailId = eStack.stack[1]?.screenId ?? "";
    let e4 = { ran: false };
    try {
      const top = eStack.stack[eStack.stack.length - 1];
      const prev = eStack.stack[eStack.stack.length - 2];
      if (!top || !prev) throw new Error(`\u6808\u4E0A\u4E0D\u8DB3\u4E24\u5C4F\uFF08depth=${eStack.depth}\uFF09\u2014\u2014\u65E0\u6CD5\u505A\u8DE8\u9875\u9762\u98DE\u884C`);
      if (!e4Source.captured) throw new Error(`\u6E90\u77E9\u5F62\u672A\u6355\u83B7\uFF1A${JSON.stringify(e4Source)}`);
      const targetRoot = eExecutor.subtreeNode(top.screenId);
      if (targetRoot === void 0) throw new Error(`subtreeNode \u7F3A\u76EE\u6807\u5C4F\u6839\uFF08${top.screenId}\uFF09`);
      const targetNodeId = targetRoot + 2;
      const targetRect = await ePorts.shared.rect(top.screenId, targetNodeId);
      const srcRect = e4Source.rect;
      const flyOut = await ePorts.shared.fly({
        targetScreenId: top.screenId,
        targetNodeId,
        // ★源矩形**人为错开**（缩略图 → 大图的真实形态）：若两侧装置几何恰好相同
        //   （本装置两屏同构 ⇒ dx=dy=0/scale=1），判据的"独立复算"会退化成恒等式——
        //   错开后才真正考验"内核按两个不同矩形算几何"。错开的量进报告（判据核对）。
        sourceRect: { x: srcRect.x + 60, y: srcRect.y + 30, w: srcRect.w * 0.5, h: srcRect.h * 0.5 },
        durMs: 200,
        curve: 1,
        fadeIn: false
      });
      e4 = {
        ran: true,
        target_screen: top.screenId,
        source_screen: e4Source.screen,
        target_node: targetNodeId,
        source_node: e4Source.node,
        source_rect: srcRect,
        /** ★实际注入的源矩形（错开后的——判据按它复算） */
        injected_source_rect: { x: srcRect.x + 60, y: srcRect.y + 30, w: srcRect.w * 0.5, h: srcRect.h * 0.5 },
        target_rect: targetRect,
        from_rect: flyOut.fromRect ?? null,
        to_rect: flyOut.toRect ?? null
      };
    } catch (err) {
      e4 = { ran: false, error: String(err), source: e4Source };
    }
    eLog.length = 0;
    ePlays.length = 0;
    eStack.pop();
    await ePump();
    const e3 = { log: [...eLog], plays: [...ePlays] };
    const eStats = eExecutor.stats();
    const e2play = e2.plays[0];
    const e3play = e3.plays[0];
    const mirrorOk = !!e2play && !!e3play && e2play.firstInFrom === e3play.firstOutTo && e2play.firstInTo === e3play.firstOutFrom;
    return {
      e1_log: e1.log,
      e1_plays: e1.plays,
      e2_log: e2.log,
      e2_plays: e2.plays,
      e3_log: e3.log,
      e3_plays: e3.plays,
      e4,
      e_mirror_ok: mirrorOk,
      e_home_id: eHomeId,
      e_detail_id: eDetailId,
      e_stats: eStats,
      // ★真实端口读数：宿主侧记账（真建树/真可见性/真动画——判据据此证明"不是壳自述"）
      e_host_stats: (() => {
        try {
          const r = invokeHostRaw("screen.stats");
          return r;
        } catch (e) {
          return { error: String(e) };
        }
      })(),
      e_pending_anims: ePorts.pendingAnimations,
      e_anim_hook: ePorts.animDoneHookInstalled
    };
  }
  function runRouterApiScenario() {
    return (async () => {
      const routes2 = [
        { name: "r-home", path: "r-home", meta: { title: "\u9996\u9875" }, component: "" },
        { name: "r-detail", path: "r-detail", meta: { transition: "slideUp" }, component: "" },
        { name: "r-user", path: "r-user", component: "" }
      ];
      const invoke = (m, a) => {
        const ph = globalThis.proteusHost;
        if (!ph || typeof ph.invoke !== "function") throw new Error("\u5BBF\u4E3B invoke \u901A\u9053\u7F3A\u5931");
        return ph.invoke(m, a);
      };
      const nav = createAppNavigation({ invoke, routes: routes2 });
      const router = createRouter(routes2, { adapter: nav.adapter });
      const push = router.push.bind(router);
      const replace = router.replace.bind(router);
      await push({ name: "r-home" });
      await push({ name: "r-detail", params: { id: "42" } });
      const afterPush = {
        depth: nav.stack.depth,
        top: nav.stack.current()?.name,
        params: nav.stack.current()?.params
      };
      router.back();
      await nav.flush();
      const afterBack = { depth: nav.stack.depth, top: nav.stack.current()?.name };
      await replace({ name: "r-user" });
      const afterReplace = { depth: nav.stack.depth, top: nav.stack.current()?.name };
      return {
        f_ok: afterPush.depth === 2 && afterPush.top === "r-detail" && String(afterPush.params?.id) === "42" && afterBack.depth === 1 && afterBack.top === "r-home" && afterReplace.depth === 1 && afterReplace.top === "r-user",
        f_after_push: afterPush,
        f_after_back: afterBack,
        f_after_replace: afterReplace,
        // ★f_host_stats：宿主记账读数。★诚实边界：**本字段可能为 null** ——
        //   F 组自带内联 invoke（`proteusHost.invoke` 的直通形态），而宿主侧的 `screenHost`
        //   实例由壳在特定路径创建；本场景不保证同一实例可读 ⇒ 读不到时**如实记 null**
        //   （不伪装成 0）。F 组的**主判据是 `f_ok`**（导航语义全绿），宿主侧的真建树/真动画
        //   证明由 **E 组**承担（`e_host_stats`，与宿主实例同源）——两者分工明确，不重复声称。
        f_host_stats: (() => {
          try {
            return JSON.parse(invoke("screen.stats", "null"));
          } catch (e) {
            return { error: String(e) };
          }
        })(),
        f_note: "\u7EDF\u4E00 API\uFF08createRouter\uFF09\u2192 \u865A\u62DF\u6808 \u2192 \u6267\u884C\u5668 \u2192 \u5BBF\u4E3B \u5168\u94FE\uFF08\u96F6\u80F6\u6C34\u5F62\u6001\uFF09"
      };
    })();
  }
  function __proteusAppStackExecutorKick() {
    const g = globalThis;
    if (g.__proteusAppStackExecutorResult !== void 0) return "already";
    void (async () => {
      try {
        const [e, f] = await Promise.all([runExecutorScenario(), runRouterApiScenario()]);
        g.__proteusAppStackExecutorResult = { ...e, ...f };
      } catch (err) {
        g.__proteusAppStackExecutorResult = { fatal: String(err) };
      }
    })();
    return "kicked";
  }
  function __proteusAppStackExecutorRead() {
    const g = globalThis;
    if (g.__proteusAppStackExecutorResult === void 0) return JSON.stringify({ pending: true });
    return JSON.stringify(g.__proteusAppStackExecutorResult);
  }
  globalThis.__proteusAppStackExecutorKick = __proteusAppStackExecutorKick;
  globalThis.__proteusAppStackExecutorRead = __proteusAppStackExecutorRead;
  function __proteusRouterApiProbe() {
    const steps = [];
    const g = globalThis;
    void (async () => {
      try {
        steps.push("enter");
        const routes2 = [
          { name: "r-home", path: "r-home", component: "" },
          { name: "r-detail", path: "r-detail", meta: { transition: "slideUp" }, component: "" }
        ];
        const ph = globalThis.proteusHost;
        if (!ph || typeof ph.invoke !== "function") throw new Error("\u5BBF\u4E3B invoke \u901A\u9053\u7F3A\u5931");
        steps.push("host-ok");
        const nav = createAppNavigation({ invoke: (m, a) => ph.invoke(m, a), routes: routes2 });
        steps.push("nav-built");
        const router = createRouter(routes2, { adapter: nav.adapter });
        steps.push("router-built");
        await router.push({ name: "r-home" });
        steps.push("pushed-home depth=" + nav.stack.depth);
        await router.push({ name: "r-detail" });
        steps.push("pushed-detail depth=" + nav.stack.depth);
        g.__proteusRouterProbeResult = { ok: true, steps };
      } catch (e) {
        g.__proteusRouterProbeResult = { ok: false, steps, error: String(e) };
      }
    })();
    return JSON.stringify({ kicked: true, steps });
  }
  function __proteusRouterApiProbeRead() {
    const g = globalThis;
    if (g.__proteusRouterProbeResult === void 0) return JSON.stringify({ pending: true });
    return JSON.stringify(g.__proteusRouterProbeResult);
  }
  globalThis.__proteusRouterApiProbe = __proteusRouterApiProbe;
  globalThis.__proteusRouterApiProbeRead = __proteusRouterApiProbeRead;
})();
