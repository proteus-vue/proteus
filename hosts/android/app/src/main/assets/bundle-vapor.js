"use strict";
(() => {
  // packages/slot-runtime/dist/index.js
  var PropKeyTable = class _PropKeyTable {
    constructor() {
      this.keys = [];
      this.index = /* @__PURE__ */ new Map();
    }
    /** 分配（已存在则返回原下标——**幂等**） */
    intern(key) {
      const hit = this.index.get(key);
      if (hit !== void 0) return hit;
      const id = this.keys.length;
      this.keys.push(key);
      this.index.set(key, id);
      return id;
    }
    /** 反查（诊断 / explain 用；运行时不走这条路径） */
    keyOf(id) {
      return this.keys[id];
    }
    get size() {
      return this.keys.length;
    }
    /** 导出（进 PatchTable 产物） */
    toArray() {
      return [...this.keys];
    }
    /** 导入（消费方重建） */
    static fromArray(keys) {
      const t = new _PropKeyTable();
      for (const k of keys) t.intern(k);
      return t;
    }
  };
  var StringPool = class _StringPool {
    constructor() {
      this.values = [];
      this.index = /* @__PURE__ */ new Map();
    }
    intern(s) {
      const hit = this.index.get(s);
      if (hit !== void 0) return hit;
      const id = this.values.length;
      this.values.push(s);
      this.index.set(s, id);
      return id;
    }
    valueOf(id) {
      return this.values[id];
    }
    get size() {
      return this.values.length;
    }
    toArray() {
      return [...this.values];
    }
    static fromArray(values) {
      const p = new _StringPool();
      for (const v of values) p.intern(v);
      return p;
    }
  };
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
  var OPS_MAGIC = 1347376720;
  var OPS_VERSION = 2;
  var OPS_HEADER_BYTES = 20;
  function opSize(op) {
    switch (op.op) {
      case 1:
      case 2:
        return 11;
      case 3:
        return 9;
      case 4:
        return 7 + 6 * op.attrs.length;
      case 5:
        return 6;
      case 16:
        return 10;
      case 17:
        return 5;
      case 18:
        return 10;
      case 32:
        return 9;
      case 33:
        return 15 + 4 * op.itemKeyRefs.length;
      case 34:
        return 17;
      case 48:
        return 13;
      default: {
        const never = op;
        throw new Error(`\u672A\u77E5\u6307\u4EE4\uFF1A${JSON.stringify(never)}`);
      }
    }
  }
  var ByteWriter = class {
    constructor(size) {
      this.pos = 0;
      this.buf = new Uint8Array(size);
    }
    u8(v) {
      this.buf[this.pos++] = v & 255;
    }
    u16(v) {
      this.buf[this.pos++] = v & 255;
      this.buf[this.pos++] = v >>> 8 & 255;
    }
    u32(v) {
      this.buf[this.pos++] = v & 255;
      this.buf[this.pos++] = v >>> 8 & 255;
      this.buf[this.pos++] = v >>> 16 & 255;
      this.buf[this.pos++] = v >>> 24 & 255;
    }
    f32(v) {
      const f = new Float32Array(1);
      f[0] = v;
      const b = new Uint8Array(f.buffer);
      this.buf[this.pos++] = b[0];
      this.buf[this.pos++] = b[1];
      this.buf[this.pos++] = b[2];
      this.buf[this.pos++] = b[3];
    }
    str(s) {
      const bytes = utf8Encode(s);
      if (bytes.length > 65535) throw new Error(`\u5B57\u7B26\u4E32\u8FC7\u957F\uFF08>65535B\uFF09\uFF1A${bytes.length}`);
      this.u16(bytes.length);
      this.buf.set(bytes, this.pos);
      this.pos += bytes.length;
    }
    done() {
      if (this.pos !== this.buf.length) throw new Error(`\u5199\u5165\u957F\u5EA6\u4E0D\u7B26\uFF1A${this.pos} != ${this.buf.length}`);
      return this.buf;
    }
  };
  function utf8Encode(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let cp = s.charCodeAt(i);
      if (cp >= 55296 && cp <= 56319 && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 56320 && lo <= 57343) {
          cp = (cp - 55296 << 10) + (lo - 56320) + 65536;
          i++;
        }
      }
      if (cp < 128) out.push(cp);
      else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
      else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
      else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
    }
    return Uint8Array.from(out);
  }
  var OpBuffer = class {
    constructor() {
      this.ops = [];
    }
    push(op) {
      this.ops.push(op);
    }
    get count() {
      return this.ops.length;
    }
    /** 只读快照（调试 / explain / 测试用） */
    snapshot() {
      return this.ops.slice();
    }
    clear() {
      this.ops.length = 0;
    }
    /**
     * 编码并提交，随后**清空**。
     *
     * @param keys    属性键表（进入 Header，供消费方还原 keyId → 字符串）
     * @param strings 字符串池（同上）
     * @param sink    提交出口（App 端 = 一次 JSI 调用）
     * @returns 本次提交的字节数
     */
    flush(keys, strings, sink) {
      const bytes = encodeOps(this.ops, keys, strings);
      const n = this.ops.length;
      sink(bytes, n);
      this.ops.length = 0;
      return bytes.length;
    }
  };
  function collectRefs(ops) {
    const k = /* @__PURE__ */ new Set();
    const s = /* @__PURE__ */ new Set();
    for (const op of ops) {
      switch (op.op) {
        case 1:
        case 2:
          k.add(op.keyId);
          break;
        case 4:
          for (const a of op.attrs) k.add(a.keyId);
          break;
        case 3:
          s.add(op.textRef);
          break;
        case 33:
          for (const r of op.itemKeyRefs) s.add(r);
          break;
        case 34:
          s.add(op.itemKeyRef);
          break;
        // TOGGLE_VIS / INSERT_BLOCK / REMOVE_NODE / MOVE_NODE / LIST_SET /
        // CALL_COMPONENT_UPDATE：无池引用（若将来新增，**在此处补一支**）
        default:
          break;
      }
    }
    return { keyIds: [...k].sort((a, b) => a - b), strRefs: [...s].sort((a, b) => a - b) };
  }
  function remapOf(used) {
    const m = /* @__PURE__ */ new Map();
    used.forEach((old, i) => m.set(old, i));
    return m;
  }
  function remapOp(op, kMap, sMap) {
    switch (op.op) {
      case 1:
      case 2:
        return { ...op, keyId: kMap.get(op.keyId) ?? 0 };
      case 4:
        return { ...op, attrs: op.attrs.map((a) => ({ keyId: kMap.get(a.keyId) ?? 0, value: a.value })) };
      case 3:
        return { ...op, textRef: sMap.get(op.textRef) ?? 0 };
      case 33:
        return { ...op, itemKeyRefs: op.itemKeyRefs.map((r) => sMap.get(r) ?? 0) };
      case 34:
        return { ...op, itemKeyRef: sMap.get(op.itemKeyRef) ?? 0 };
      default:
        return op;
    }
  }
  function encodeOps(ops, keys, strings) {
    const allKeys = keys.toArray();
    const allStrs = strings.toArray();
    const used = collectRefs(ops);
    const keyArr = used.keyIds.map((i) => allKeys[i]).filter((x) => x !== void 0);
    const strArr = used.strRefs.map((i) => allStrs[i]).filter((x) => x !== void 0);
    const kMap = remapOf(used.keyIds.filter((i) => allKeys[i] !== void 0));
    const sMap = remapOf(used.strRefs.filter((i) => allStrs[i] !== void 0));
    let size = OPS_HEADER_BYTES;
    for (const k of keyArr) size += 2 + utf8Encode(k).length;
    for (const s of strArr) size += 2 + utf8Encode(s).length;
    for (const op of ops) size += opSize(op);
    const w = new ByteWriter(size);
    w.u32(OPS_MAGIC);
    w.u32(OPS_VERSION);
    w.u32(ops.length);
    w.u32(keyArr.length);
    w.u32(strArr.length);
    for (const k of keyArr) w.str(k);
    for (const s of strArr) w.str(s);
    for (const op of ops) encodeOp(w, remapOp(op, kMap, sMap));
    return w.done();
  }
  function encodeOp(w, op) {
    w.u8(op.op);
    switch (op.op) {
      case 1:
      case 2:
        w.u32(op.nodeId);
        w.u16(op.keyId);
        w.f32(op.value);
        return;
      case 3:
        w.u32(op.nodeId);
        w.u32(op.textRef);
        return;
      case 4:
        w.u32(op.nodeId);
        w.u16(op.attrs.length);
        for (const a of op.attrs) {
          w.u16(a.keyId);
          w.f32(a.value);
        }
        return;
      case 5:
        w.u32(op.nodeId);
        w.u8(op.visible ? 1 : 0);
        return;
      case 16:
        w.u32(op.blockId);
        w.u32(op.refNodeId);
        w.u8(op.pos);
        return;
      case 17:
        w.u32(op.nodeId);
        return;
      case 18:
        w.u32(op.nodeId);
        w.u32(op.refNodeId);
        w.u8(op.pos);
        return;
      case 32:
        w.u32(op.listId);
        w.u32(op.dataRef);
        return;
      case 33:
        w.u32(op.listId);
        w.u32(op.start);
        w.u32(op.delCount);
        w.u16(op.itemKeyRefs.length);
        for (const r of op.itemKeyRefs) w.u32(r);
        return;
      case 34:
        w.u32(op.listId);
        w.u32(op.itemKeyRef);
        w.u32(op.slotId);
        w.f32(op.value);
        return;
      case 48:
        w.u32(op.componentId);
        w.u32(op.slotId);
        w.f32(op.value);
        return;
      default: {
        const never = op;
        throw new Error(`\u672A\u77E5\u6307\u4EE4\uFF1A${JSON.stringify(never)}`);
      }
    }
  }
  function createSlot(spec, keys, strings, initial, registry) {
    const nodeId = spec.nodeId;
    const keyId = spec.keyId ?? 0;
    const listId = spec.listId ?? 0;
    const listSlotId = spec.listSlotId ?? spec.id;
    const slot = {
      id: spec.id,
      nodeId,
      kind: spec.kind,
      value: initial,
      dirty: false,
      emit(next, buf) {
        switch (spec.kind) {
          case "text":
            buf.push({ op: 3, nodeId, textRef: strings.intern(String(next)) });
            return;
          case "prop":
            buf.push({ op: 1, nodeId, keyId, value: toF32(next) });
            return;
          case "style":
            buf.push({ op: 2, nodeId, keyId, value: toF32(next) });
            return;
          case "visibility":
            buf.push({ op: 5, nodeId, visible: Boolean(next) });
            return;
          case "list-item": {
            const item = next;
            const nodeId2 = registry?.resolveNode(listId, item.key, listSlotId);
            if (nodeId2 !== void 0) {
              if ((spec.itemKind ?? "style") === "text") {
                buf.push({ op: 3, nodeId: nodeId2, textRef: strings.intern(String(item.value)) });
              } else {
                buf.push({ op: 2, nodeId: nodeId2, keyId, value: toF32(item.value) });
              }
              return;
            }
            buf.push({
              op: 34,
              listId,
              itemKeyRef: strings.intern(item.key),
              slotId: listSlotId,
              value: toF32(item.value)
            });
            return;
          }
          case "list-data":
            buf.push({ op: 32, listId, dataRef: toF32(next) });
            return;
          case "attrs": {
            const attrs = next;
            buf.push({ op: 4, nodeId, attrs });
            return;
          }
          case "component-prop":
            buf.push({ op: 48, componentId: nodeId, slotId: listSlotId, value: toF32(next) });
            return;
          default: {
            const never = spec.kind;
            throw new Error(`\u672A\u77E5\u69FD\u4F4D\u79CD\u7C7B\uFF1A${String(never)}`);
          }
        }
      }
    };
    return slot;
  }
  function toF32(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    throw new Error(`\u69FD\u4F4D\u503C\u5FC5\u987B\u662F number/boolean\uFF0C\u6536\u5230 ${typeof v}\uFF08\u6587\u672C\u8BF7\u7528 kind='text'\uFF09`);
  }
  var microtaskScheduler = {
    schedule(cb) {
      void Promise.resolve().then(cb);
    }
  };
  var SlotRuntime = class {
    constructor(keys, strings, sink, scheduler = microtaskScheduler) {
      this.keys = keys;
      this.strings = strings;
      this.sink = sink;
      this.scheduler = scheduler;
      this.buffer = new OpBuffer();
      this.dirty = [];
      this.pending = false;
      this.stats = { flushes: 0, opsEmitted: 0, bytesSent: 0, shortCircuits: 0 };
    }
    /** 槽位写入（方案 §3.3）：相等即短路；否则标脏 + 排帧 */
    setSlot(slot, next) {
      if (Object.is(slot.value, next)) {
        this.stats.shortCircuits++;
        return;
      }
      slot.value = next;
      if (!slot.dirty) {
        slot.dirty = true;
        this.dirty.push(slot);
      }
      this.scheduleFlush();
    }
    /** 排帧（幂等——同帧多次调用只排一次） */
    scheduleFlush() {
      if (this.pending) return;
      this.pending = true;
      this.scheduler.schedule(() => this.flush());
    }
    /**
     * 立即 flush（测试 / 确定性驱动用）
     *
     * 【为什么单独暴露】真机上「Vsync 何时来」不可控；测量装置纪律要求用例能**确定性地**
     *   驱动一次提交（本仓四次踩过"测量装置污染读数"）。
     */
    flush() {
      this.pending = false;
      for (const slot of this.dirty) {
        slot.emit(slot.value, this.buffer);
        slot.dirty = false;
      }
      this.dirty.length = 0;
      if (this.buffer.count === 0) return;
      this.stats.opsEmitted += this.buffer.count;
      this.stats.bytesSent += this.buffer.flush(this.keys, this.strings, this.sink);
      this.stats.flushes++;
    }
    getStats() {
      return { ...this.stats };
    }
    /** 待发射的脏槽位数（诊断） */
    get dirtyCount() {
      return this.dirty.length;
    }
  };
  function toNum(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") return v.trim() === "" ? 0 : Number(v);
    if (v === null) return 0;
    if (v === void 0) return NaN;
    return NaN;
  }
  function evalExpr(p, ctx) {
    switch (p.k) {
      case "root":
        return ctx.read(p.name);
      case "lit":
        return p.v;
      case "undef":
        return void 0;
      case "mem": {
        const o = evalExpr(p.obj, ctx);
        if (o == null) return void 0;
        return o[p.key];
      }
      case "memdyn": {
        const o = evalExpr(p.obj, ctx);
        if (o == null) return void 0;
        const k = evalExpr(p.key, ctx);
        return o[String(k)];
      }
      case "un": {
        const v = evalExpr(p.arg, ctx);
        const uop = p.op;
        switch (uop) {
          case "!":
            return !v;
          case "-":
            return -toNum(v);
          case "+":
            return +toNum(v);
          default:
            throw new Error(`\u672A\u77E5\u4E00\u5143\u8FD0\u7B97\u7B26\uFF1A${String(uop)}`);
        }
      }
      case "bin": {
        const l = evalExpr(p.l, ctx);
        const r = evalExpr(p.r, ctx);
        const bop = p.op;
        switch (bop) {
          case "+":
            if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
            return toNum(l) + toNum(r);
          case "-":
            return toNum(l) - toNum(r);
          case "*":
            return toNum(l) * toNum(r);
          case "/":
            return toNum(l) / toNum(r);
          case "%":
            return toNum(l) % toNum(r);
          case "===":
            return l === r;
          case "!==":
            return l !== r;
          case "<":
            return l < r;
          case ">":
            return l > r;
          case "<=":
            return l <= r;
          case ">=":
            return l >= r;
          default:
            throw new Error(`\u672A\u77E5\u4E8C\u5143\u8FD0\u7B97\u7B26\uFF1A${String(bop)}`);
        }
      }
      case "logi": {
        const l = evalExpr(p.l, ctx);
        if (p.op === "&&") return l ? evalExpr(p.r, ctx) : l;
        if (p.op === "||") return l ? l : evalExpr(p.r, ctx);
        return l === null || l === void 0 ? evalExpr(p.r, ctx) : l;
      }
      case "cond":
        return evalExpr(p.t, ctx) ? evalExpr(p.c, ctx) : evalExpr(p.a, ctx);
      case "obj": {
        const o = {};
        for (const pr of p.props) o[pr.key] = evalExpr(pr.value, ctx);
        return o;
      }
      case "arr":
        return p.items.map((x) => evalExpr(x, ctx));
      default: {
        const never = p;
        throw new Error(`\u672A\u77E5\u8868\u8FBE\u5F0F\u8282\u70B9\uFF1A${JSON.stringify(never)}`);
      }
    }
  }
  var ListRegistry = class {
    constructor() {
      this.items = /* @__PURE__ */ new Map();
      this.hits = 0;
      this.misses = 0;
    }
    /**
     * 登记一个列表项
     *
     * @param listId    编译期分配的列表 id
     * @param itemKey   该行的稳定 key（**绝不用下标**——下标在 splice 后会命中错项，方案坑位 #5）
     * @param slotNodes item 内槽位 id → 该槽位对应的**节点 id**
     */
    registerItem(listId, itemKey, slotNodes) {
      let byKey = this.items.get(listId);
      if (!byKey) {
        byKey = /* @__PURE__ */ new Map();
        this.items.set(listId, byKey);
      }
      const m = slotNodes instanceof Map ? slotNodes : new Map(Object.entries(slotNodes).map(([k, v]) => [Number(k), v]));
      byKey.set(itemKey, m);
    }
    /** 批量登记（列表首帧渲染后一次性登记全部项——避免逐项调用） */
    registerItems(listId, entries) {
      for (const e of entries) this.registerItem(listId, e.itemKey, e.slotNodes);
    }
    /** 解析：该列表项内某槽位对应的节点 id（未登记 ⇒ undefined，调用方回退 LIST_UPDATE） */
    resolveNode(listId, itemKey, slotId) {
      const hit = this.items.get(listId)?.get(itemKey)?.get(slotId);
      if (hit === void 0) this.misses++;
      else this.hits++;
      return hit;
    }
    /** 移除项（splice 删除时调用，防止 key 被复用时命中已删项） */
    removeItem(listId, itemKey) {
      return this.items.get(listId)?.delete(itemKey) ?? false;
    }
    /** 整体清空某个列表（LIST_SET 整体换数据源时） */
    clearList(listId) {
      this.items.delete(listId);
    }
    /** 清空全部（卸载页面时） */
    clear() {
      this.items.clear();
    }
    get size() {
      let n = 0;
      for (const byKey of this.items.values()) n += byKey.size;
      return n;
    }
    get stats() {
      return { hits: this.hits, misses: this.misses, items: this.size };
    }
  };
  function engineFieldOf(propKey) {
    if (propKey === "text.content") return { kind: "text" };
    const m = propKey.match(/^(?:layout|paint|text)\.(.+)$/);
    if (!m) return null;
    return { kind: "style", key: m[1] };
  }
  function rowsOfList(listId, table, read) {
    if (!table) return [];
    const itemSlots = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === "list-item" && x.listId === listId);
    const spec = itemSlots[0];
    if (!spec) return [];
    const srcName = table.sources.find((s) => s.slots.some((x) => x.listId === listId))?.sourceName ?? "";
    const segs = (spec.sourceExpr ?? "").split(".").filter(Boolean);
    const topRows = read(srcName);
    if (!Array.isArray(topRows)) return [];
    const walkSegs = segs[0] === srcName ? segs.slice(1) : segs;
    let cur = topRows;
    for (const field of walkSegs) {
      const next = [];
      for (const r of cur) {
        const arr = r?.[field];
        if (!Array.isArray(arr)) continue;
        for (const x of arr) next.push(x);
      }
      cur = next;
    }
    return cur;
  }
  function instantiateTemplate(tpl, opts) {
    const nodes = [];
    const maxTemplateId = tpl.nodes.reduce((m, n) => Math.max(m, n.id), 0);
    let nextId = opts.firstRowInstanceId ?? maxTemplateId + 1;
    let allocated = 0;
    let reused = 0;
    const rowLists = new Map(tpl.lists.map((l) => [l.listId, l]));
    const byId = /* @__PURE__ */ new Map();
    let valuesFilled = 0;
    const virtualRows = [];
    const emit = (n, id, parentId) => {
      const out = { id, parentId };
      if (n.style) for (const [k, v] of Object.entries(n.style)) {
        ;
        out[k] = v;
      }
      if (n.text !== void 0) out.text = n.text;
      nodes.push(out);
      byId.set(id, out);
    };
    const cloneRow = (listId, row, itemKey, first, rowIndex) => {
      const meta = rowLists.get(listId);
      const idMap = /* @__PURE__ */ new Map();
      let rowRootId = 0;
      for (const tplId of meta.subtreeIds) {
        const engineId = first ? tplId : nextId++;
        if (!first) allocated++;
        else reused++;
        idMap.set(tplId, engineId);
        if (tplId === meta.rowRootId) rowRootId = engineId;
      }
      for (const tplId of meta.subtreeIds) {
        const tn = tpl.nodes.find((x) => x.id === tplId);
        const engineId = idMap.get(tplId);
        const tplParent = tn.parentId;
        const parentId = tplParent === null ? null : idMap.get(tplParent) ?? tplParent;
        emit(tn, engineId, parentId);
      }
      virtualRows.push({
        index: rowIndex,
        key: itemKey,
        root: rowRootId,
        ids: meta.subtreeIds.map((t) => idMap.get(t))
      });
      if (opts.table) {
        const itemSlots = opts.table.sources.flatMap((s) => s.slots).filter((x) => x.kind === "list-item" && x.listId === listId);
        if (itemSlots.length > 0) {
          const slotNodes = {};
          for (const sl of itemSlots) {
            const mapped = idMap.get(sl.nodeId);
            if (mapped !== void 0) slotNodes[sl.itemSlotId] = mapped;
            if (mapped === void 0) continue;
            const target = byId.get(mapped);
            const field = sl.itemValueField;
            if (!target || !field) continue;
            const v = row[field];
            if (v === void 0) continue;
            const f = engineFieldOf(sl.propKey);
            if (!f) continue;
            if (f.kind === "text") {
              target.text = String(v);
            } else {
              ;
              target[f.key] = v;
            }
            valuesFilled++;
          }
          if (opts.registry && Object.keys(slotNodes).length > 0) {
            opts.registry.registerItem(listId, itemKey, slotNodes);
          }
        }
      }
      return rowRootId;
    };
    const rowMemberIds = /* @__PURE__ */ new Set();
    for (const l of tpl.lists) for (const id of l.subtreeIds) rowMemberIds.add(id);
    for (const n of tpl.nodes) {
      if (rowMemberIds.has(n.id)) {
        const meta = tpl.lists.find((l) => l.rowRootId === n.id);
        if (!meta) continue;
        const rows = rowsOfList(meta.listId, opts.table, opts.read);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const keyOf = () => {
            const keyField = opts.table?.sources.flatMap((s) => s.slots).find((x) => x.kind === "list-item" && x.listId === meta.listId)?.itemKeyField;
            return keyField && row[keyField] !== void 0 ? String(row[keyField]) : String(i);
          };
          cloneRow(meta.listId, row, keyOf(), i === 0, i);
        }
        continue;
      }
      emit(n, n.id, n.parentId);
    }
    return {
      viewport: opts.viewport,
      nodes,
      stats: { reusedTemplateIds: reused, allocatedIds: allocated, rows: nodes.length, valuesFilled },
      // ★只有**恰好一个**列表时才给虚拟化描述（多个列表 ⇒ 行号空间不同源，宿主按行号二分会错配）
      virtual: virtualRows.length > 0 && tpl.lists.length === 1 ? { rows: virtualRows } : void 0
    };
  }
  var VaporRuntime = class {
    constructor(table, rt, evaluators, registry) {
      this.table = table;
      this.rt = rt;
      this.evaluators = evaluators;
      this.registry = registry;
      this.slots = /* @__PURE__ */ new Map();
      this.slotById = /* @__PURE__ */ new Map();
      this.evalImpls = /* @__PURE__ */ new Map();
      this.sourcesOfSlot = /* @__PURE__ */ new Map();
      this.uninstantiatedSlots = [];
      this.itemValueCache = /* @__PURE__ */ new Map();
      this.loaded = false;
    }
    /**
     * 从订阅表重建求值函数（把**可序列化的声明**变成可执行函数）
     *
     * 【为什么单独一步（而不是直接吃函数）】方案 §4.4 要求产物可序列化
     *   （跨端禁 eval）⇒ 声明与实现分离：声明随产物下发，实现在各端本地重建。
     *   本方法就是「本地重建」的参考实现：
     *     · `member` —— 纯路径访问，**免解析**（热路径主力）
     *     · `const`  —— 常量
     *     · `expr`   —— 表达式文本（各端按自己的能力求值；本实现给出最简单的成员回退）
     */
    static buildEvaluators(specs) {
      const out = /* @__PURE__ */ new Map();
      for (const s of specs) {
        switch (s.form) {
          case "member": {
            const segs = (s.path ?? "").split(".").filter(Boolean);
            const [root, ...rest] = segs;
            out.set(s.evaluatorId, (ctx) => {
              let v = ctx.read(root);
              for (const seg of rest) {
                if (v == null || typeof v !== "object") return void 0;
                v = v[seg];
              }
              return v;
            });
            break;
          }
          case "program": {
            const prog = s.program;
            if (!prog) break;
            out.set(s.evaluatorId, (ctx) => evalExpr(prog, ctx));
            break;
          }
          case "const": {
            const text = (s.expr ?? "").trim();
            const parsed = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text === "true" ? true : text === "false" ? false : text.replace(/^['"]|['"]$/g, "");
            out.set(s.evaluatorId, () => parsed);
            break;
          }
          case "expr": {
            const expr = (s.expr ?? "").trim();
            if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) {
              const segs = expr.split(".");
              const [root, ...rest] = segs;
              out.set(s.evaluatorId, (ctx) => {
                let v = ctx.read(root);
                for (const seg of rest) {
                  if (v == null || typeof v !== "object") return void 0;
                  v = v[seg];
                }
                return v;
              });
            }
            break;
          }
          default:
            break;
        }
      }
      return out;
    }
    /** 注册订阅（方案 §4.3 Step 5：源变化 → 求值 → 直写槽位） */
    load(ctx, subscribe) {
      const unknownSources = [];
      const unsupportedEvaluators = [];
      let l1Slots = 0;
      for (const src of this.table.sources) {
        for (const spec of src.slots) {
          const impl = this.evaluators.get(spec.evaluatorId);
          if (!impl) {
            unsupportedEvaluators.push({ evaluatorId: spec.evaluatorId, reason: "\u6C42\u503C\u51FD\u6570\u672A\u5B9E\u4F8B\u5316\uFF08\u5F62\u6001\u4E0D\u652F\u6301\uFF09" });
            continue;
          }
          let slot = this.slots.get(spec.slotId);
          if (!slot) {
            slot = createSlot(
              {
                id: spec.slotId,
                nodeId: spec.nodeId,
                kind: spec.kind,
                keyId: this.rt.keys.intern(spec.propKey),
                listId: spec.listId ?? spec.slotId,
                listSlotId: spec.itemSlotId ?? spec.slotId,
                itemKind: spec.itemKind,
                itemValueField: spec.itemValueField,
                itemKeyField: spec.itemKeyField,
                scope: spec.scope
              },
              this.rt.keys,
              this.rt.strings,
              void 0,
              this.registry
              // ★传入注册表（缺省 ⇒ list-item 回退 LIST_UPDATE，保持 V3 行为）
            );
            this.slots.set(spec.slotId, slot);
          }
          this.slotById.set(spec.slotId, { slot, spec, evalId: spec.evaluatorId });
          const deps = this.sourcesOfSlot.get(spec.slotId) ?? [];
          deps.push(src.sourceName);
          this.sourcesOfSlot.set(spec.slotId, deps);
          l1Slots++;
        }
      }
      for (const src of this.table.sources) {
        subscribe(src.sourceName, () => {
          this.writeSlotsOfSource(src.sourceName, ctx);
        });
      }
      for (const src of this.table.sources) {
        for (const spec of src.slots) {
          if (spec.kind !== "list-item") continue;
          if (!this.evaluators.get(spec.evaluatorId)) {
            this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey });
          }
        }
      }
      this.loaded = true;
      return {
        l1Slots,
        l0Slots: this.table.l0Slots.length,
        unknownSources,
        unsupportedEvaluators,
        // ★行内槽位的未实例化清单（与 unsupportedEvaluators 同性质：**上报而非静默**）
        uninstantiatedSlots: this.uninstantiatedSlots.slice()
      };
    }
    /** 写入某源驱动的全部槽位（源变化时由订阅回调触发） */
    writeSlotsOfSource(sourceName, ctx) {
      for (const src of this.table.sources) {
        if (src.sourceName !== sourceName) continue;
        this.writeListItems(src, ctx);
        for (const spec of src.slots) {
          if (spec.kind === "list-item") continue;
          if (spec.kind === "list-data") continue;
          const entry = this.slotById.get(spec.slotId);
          const impl = this.evaluators.get(spec.evaluatorId);
          if (!entry || !impl) continue;
          this.rt.setSlot(entry.slot, impl(ctx));
        }
      }
    }
    /**
     * ★列表行内槽位通道：按行求值 → 与上一轮**按 key 缓存**的值 diff → 只发变化行
     *
     * 【关键：行作用域求值】`item.w` 的求值需要**当前行**绑定到 v-for 作用域。
     *   故每行构造一个 `rowCtx`：`read(scope)` 返回该行，其余名透传原 ctx。
     *   （编译器在槽位上给了 `scope` 才能这么做——见 SlotSubscription.scope）
     */
    writeListItems(src, ctx) {
      const itemSlots = src.slots.filter((x) => x.kind === "list-item");
      if (itemSlots.length === 0) return;
      const rowsCache = /* @__PURE__ */ new Map();
      const rowsOfList2 = (listId, spec) => {
        const cached = rowsCache.get(listId);
        if (cached) return cached;
        const out = [];
        const keyOf = (r, i) => spec.itemKeyField && r && r[spec.itemKeyField] !== void 0 ? String(r[spec.itemKeyField]) : String(i);
        const segs = (spec.sourceExpr ?? "").split(".").filter(Boolean);
        const topRows = ctx.read(src.sourceName);
        if (!Array.isArray(topRows)) return out;
        const walkSegs = segs[0] === src.sourceName ? segs.slice(1) : segs;
        let current = topRows.map((row) => ({ row, ancestors: [] }));
        for (let seg = 0; seg < walkSegs.length; seg++) {
          const field = walkSegs[seg];
          const next = [];
          for (const c of current) {
            const arr = c.row?.[field];
            if (!Array.isArray(arr)) continue;
            for (const x of arr) {
              next.push({ row: x, ancestors: [...c.ancestors, c.row] });
            }
          }
          current = next;
        }
        for (let i = 0; i < current.length; i++) {
          out.push({ key: keyOf(current[i].row, i), row: current[i].row, ancestors: current[i].ancestors });
        }
        rowsCache.set(listId, out);
        return out;
      };
      const rowCtxCache = /* @__PURE__ */ new Map();
      for (const spec of itemSlots) {
        const impl = this.evaluators.get(spec.evaluatorId);
        if (!impl) {
          this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey });
          continue;
        }
        const scope = spec.scope ?? "";
        const rows = rowsOfList2(spec.listId ?? -1, spec);
        for (const rowRef of rows) {
          const key = rowRef.key;
          const row = rowRef.row;
          const ancestors = rowRef.ancestors;
          const cached = rowCtxCache.get(rowRef);
          const rowCtx = cached && cached.scope === scope ? cached.ctx : this.makeRowCtx(scope, row, ancestors, ctx);
          if (!(cached && cached.scope === scope)) rowCtxCache.set(rowRef, { scope, ctx: rowCtx });
          const value = impl(rowCtx);
          this.diffAndEmit(spec, key, value);
        }
      }
    }
    /**
     * ★★行级失效：**只重算指定行**的 list-item 槽位（2026-09-29 新增）
     *
     * 【为什么需要（本仓真机实测的瓶颈）】粗粒度触发（`triggers.get('list')` ⇒ `relink`）只知道
     *   "源变了"、不知道"哪一行变了" ⇒ 只能**全表重扫**：1000 行 × 3 槽位 = 3000 次求值 + diff。
     *   真机 `V11` 实测该段 **7.03ms**（列表更新总 11ms）——而 Vapor 的设计本意是
     *   **O(1) 槽位直写**（改哪行算哪行）。本方法就是那个 O(1) 入口。
     *
     * 【调用方责任】提供**变更行的身份**（`key` + 行对象 + 祖先链）——它天然知道（编译器产出的
     *   行作用域效应 / 应用层的不可变更新都携带这些）。**不知道时不要调用**，走 `relink` 全扫（正确但慢）。
     *
     * 【正确性】与全扫路径**共用** `makeRowCtx` / `diffAndEmit` / `itemValueCache`（唯一实现
     *   ⇒ 两条路径不会漂移）；缓存是实例级的 ⇒ 全扫与行级失效交替调用也保持一致。
     *
     * @param listId 目标列表 id（订阅表里的 `listId`）
     * @param key    行标识（= `itemKeyField` 对应的值，与 `emitListItem` 的键一致）
     * @param row    该行的**数据对象**
     * @param ancestors 该行的祖先行链（顶层列表传空数组；嵌套列表按「自外向内」）
     */
    relinkRow(listId, key, row, ancestors = [], ctx) {
      const evalCtx = ctx ?? this.lastCtx ?? { read: () => void 0 };
      for (const spec of this.listSpecsOf(listId)) {
        const impl = this.evaluators.get(spec.evaluatorId);
        if (!impl) continue;
        const rowCtx = this.makeRowCtx(spec.scope ?? "", row, ancestors, evalCtx);
        this.diffAndEmit(spec, key, impl(rowCtx));
      }
    }
    /** scope（v-for 别名）→ listId 反查（`relinkRow` 用；作用域由订阅表声明，不猜） */
    listIdOfScope(scope) {
      for (const src of this.table.sources) {
        for (const sl of src.slots) if (sl.kind === "list-item" && (sl.scope ?? "") === scope) return sl.listId ?? -1;
      }
      return void 0;
    }
    /** 该列表的全部 list-item 槽位（`relinkRow` 用；与 `writeListItems` 同一数据源） */
    listSpecsOf(listId) {
      const out = [];
      for (const src of this.table.sources) {
        for (const sl of src.slots) if (sl.kind === "list-item" && (sl.listId ?? -1) === listId) out.push(sl);
      }
      return out;
    }
    /** ★行作用域上下文（**唯一实现**）：当前行别名 + 各层祖先别名 —— `writeListItems` 与 `relinkRow` 共用 */
    makeRowCtx(scope, row, ancestors, ctx) {
      if (!scope) return ctx;
      const lid = this.listIdOfScope(scope);
      const ancestorScopes = lid === void 0 ? [] : this.ancestorScopesOf(lid);
      return {
        read: (n) => {
          if (n === scope) return row;
          const idx = ancestorScopes.indexOf(n);
          if (idx >= 0 && idx < ancestors.length) return ancestors[idx];
          return ctx.read(n);
        }
      };
    }
    /** ★值 diff + 发射（**唯一实现**）：嵌套 Map 免拼接：listId/slotId 均为数字键 */
    diffAndEmit(spec, key, value) {
      const listId = spec.listId ?? -1;
      let bySlot = this.itemValueCache.get(listId);
      if (!bySlot) {
        bySlot = /* @__PURE__ */ new Map();
        this.itemValueCache.set(listId, bySlot);
      }
      let byKey = bySlot.get(spec.slotId);
      if (!byKey) {
        byKey = /* @__PURE__ */ new Map();
        bySlot.set(spec.slotId, byKey);
      }
      if (byKey.get(key) === value) return;
      byKey.set(key, value);
      this.emitListItem(spec, key, value);
    }
    /** 发一条行内更新指令：解析得到 nodeId 就发普通指令，否则回退 LIST_UPDATE */
    emitListItem(spec, key, value) {
      const nodeId = this.registry?.resolveNode(spec.listId ?? -1, key, spec.itemSlotId ?? -1);
      if (nodeId !== void 0) {
        if ((spec.itemKind ?? "style") === "text") {
          this.rt.buffer.push({ op: 3, nodeId, textRef: this.rt.strings.intern(String(value)) });
        } else {
          this.rt.buffer.push({
            op: 2,
            nodeId,
            keyId: this.rt.keys.intern(spec.propKey),
            value: typeof value === "number" ? value : Number(value) || 0
          });
        }
      } else {
        this.rt.buffer.push({
          op: 34,
          listId: spec.listId ?? -1,
          itemKeyRef: this.rt.strings.intern(key),
          slotId: spec.itemSlotId ?? -1,
          value: typeof value === "number" ? value : Number(value) || 0
        });
      }
    }
    /** ★首帧同步：把所有 L1 槽位按当前源值写一遍（否则首屏不会出现这些值） */
    relink(ctx) {
      this.lastCtx = ctx;
      for (const src of this.table.sources) {
        this.writeSlotsOfSource(src.sourceName, ctx);
      }
    }
    /**
     * 某列表的**别名链**（自外向内；末位是它自身的 scope）
     *
     * 【为什么需要】`rowCtx` 要按位置把「祖先行」绑给对应的外层别名——
     *   而位置对应关系依赖"自外向内"的稳定顺序（由 `parentListId` 逐级上溯构造）。
     */
    ancestorScopesOf(listId) {
      const chain = [];
      let cur = listId;
      const allSlots = this.table.sources.flatMap((x) => x.slots);
      let guard = 0;
      while (cur !== void 0 && guard < 32) {
        const spec = allSlots.find((x) => x.kind === "list-item" && x.listId === cur);
        if (!spec) break;
        chain.unshift(spec.scope ?? "");
        cur = spec.parentListId;
        guard++;
      }
      return chain;
    }
    /** 取某源的行数组（列表源 ⇒ 数组；非数组返回空）——仅供「无 :key 时用下标兜底」 */
    rowsOfSource(sourceName, ctx) {
      const v = ctx.read(sourceName);
      return Array.isArray(v) ? v : [];
    }
    /** 某槽位是否已建立订阅（诊断：确认"这个槽位真的被接管了"） */
    hasSlot(slotId) {
      return this.slots.has(slotId);
    }
    get loaded_() {
      return this.loaded;
    }
    /** 该槽位由哪些源驱动（诊断 / explain） */
    depsOf(slotId) {
      return this.sourcesOfSlot.get(slotId) ?? [];
    }
    /** L1 槽位表（供宿主对账：哪些槽位由 L1 接管） */
    slotIds() {
      return [...this.slots.keys()].sort((a, b) => a - b);
    }
  };

  // hosts/android/bridge/entry-vapor.ts
  function makeData(rows) {
    return {
      list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 40 + i % 5 * 12, title: `row ${i + 1}` }))
    };
  }
  function __proteusVaporRun(argsJson) {
    const t = () => Date.now();
    const args = JSON.parse(argsJson);
    const rows = Math.max(1, args.rows ?? 8);
    const notes = [];
    const rep = {
      ok: false,
      tpl_nodes: 0,
      tpl_ok: false,
      sub_l1: 0,
      sub_l0: 0,
      sub_l1_rate: 0,
      sub_sources: [],
      inst_ms: 0,
      inst_nodes: 0,
      inst_reused_ids: 0,
      inst_allocated_ids: 0,
      inst_rows: 0,
      inst_values_filled: 0,
      inst_virtual_rows: 0,
      inst_text_filled: 0,
      inst_width_filled: 0,
      mount_ms: 0,
      mount_nodes: 0,
      updates_run: 0,
      ops_bytes: 0,
      ops_ms: 0,
      apply_ms: 0,
      update_evidence: [],
      geom_probe: [],
      uninstantiated_slots: 0,
      notes
    };
    try {
      const artifacts = JSON.parse(args.artifacts);
      const tpl = artifacts.tpl;
      const table = artifacts.table;
      rep.tpl_nodes = tpl.nodes.length;
      rep.tpl_ok = tpl.ok;
      rep.sub_l1 = table.stats.l1;
      rep.sub_l0 = table.stats.l0;
      rep.sub_l1_rate = table.stats.l1Rate;
      rep.sub_sources = table.sources.map((s2) => s2.sourceName);
      if (!tpl.ok) {
        rep.error = "\u6A21\u677F\u4E0D\u53EF\u7528\uFF08\u6784\u5EFA\u671F\u8BCA\u65AD\u2014\u2014\u89C1 gen-vapor-fixture.mjs \u8F93\u51FA\uFF09";
        return JSON.stringify(rep);
      }
      const data = makeData(rows);
      const read = (n) => data[n];
      const registry = new ListRegistry();
      const t2 = t();
      const inst = instantiateTemplate(tpl, {
        viewport: args.viewport,
        read,
        table,
        registry
      });
      rep.inst_ms = t() - t2;
      rep.inst_nodes = inst.nodes.length;
      rep.inst_reused_ids = inst.stats.reusedTemplateIds;
      rep.inst_allocated_ids = inst.stats.allocatedIds;
      rep.inst_rows = inst.stats.rows;
      rep.inst_values_filled = inst.stats.valuesFilled;
      rep.inst_virtual_rows = inst.virtual?.rows.length ?? 0;
      rep.inst_text_filled = inst.nodes.filter((n) => typeof n.text === "string" && n.text.length > 0).length;
      rep.inst_width_filled = inst.nodes.filter((n) => typeof n.width === "number").length;
      if (rep.inst_text_filled === 0) notes.push("\u26A0 \u5B9E\u4F8B\u6811\u91CC\u6CA1\u6709\u4EFB\u4F55\u975E\u7A7A\u6587\u672C\u2014\u2014\u56DE\u586B\u94FE\u53EF\u7591");
      const t3 = t();
      const mountOut = proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }));
      rep.mount_ms = t() - t3;
      const mo = JSON.parse(mountOut);
      if (mo.ok !== true) {
        rep.error = "\u5BBF\u4E3B mount \u5931\u8D25\uFF1A" + (mo.error ?? mountOut.slice(0, 200));
        return JSON.stringify(rep);
      }
      rep.mount_nodes = mo.nodes ?? -1;
      rep.host_layout_ms = mo.layout_ms;
      rep.host_cmds = mo.cmds;
      const keys = new PropKeyTable();
      const strings = new StringPool();
      const captured = [];
      const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes));
      const evals = VaporRuntime.buildEvaluators(table.evaluators);
      const vapor = new VaporRuntime(table, slotRt, evals, registry);
      const ctx = { read };
      const triggers = /* @__PURE__ */ new Map();
      vapor.load(ctx, (name, cb) => triggers.set(name, cb));
      vapor.relink(ctx);
      slotRt.flush();
      captured.length = 0;
      rep.uninstantiated_slots = vapor.uninstantiatedSlots.length;
      const itemSlots = table.sources.flatMap((s2) => s2.slots).filter((x) => x.kind === "list-item");
      const widthSlot = itemSlots.find((x) => x.propKey === "layout.width");
      const probeId = widthSlot ? registry.resolveNode(widthSlot.listId, "2", widthSlot.itemSlotId) : void 0;
      const rectsOf = () => {
        try {
          const ro = JSON.parse(proteusHost.readRects());
          return ro.rects ?? {};
        } catch {
          return {};
        }
      };
      const before = probeId !== void 0 ? rectsOf()[String(probeId)]?.width ?? -1 : -1;
      const updates = Math.max(0, args.updates ?? 3);
      const evidence = [];
      for (let r = 0; r < updates; r++) {
        const list = data.list;
        if (list.length < 2) break;
        const at = r % Math.min(list.length, rows);
        list[at].title = `upd ${r}`;
        list[at].w = 60 + r % 4 * 20;
        const to = t();
        const fire = triggers.get("list");
        if (!fire) {
          notes.push(`\u7B2C ${r} \u8F6E\uFF1A\u8BA2\u9605\u8868\u91CC\u6CA1\u6709 'list' \u6E90\uFF08\u7F16\u8BD1\u5668\u672A\u4EA7\u51FA\u8BE5\u6E90\uFF1F\uFF09`);
          break;
        }
        fire();
        slotRt.flush();
        rep.ops_ms += t() - to;
        const payload = captured.length ? captured[captured.length - 1] : new Uint8Array(0);
        rep.ops_bytes += payload.length;
        if (!payload.length) {
          notes.push(`\u7B2C ${r} \u8F6E\uFF1A\u8BA2\u9605\u8868\u672A\u4EA7\u51FA\u6307\u4EE4\uFF08\u69FD\u4F4D\u672A\u547D\u4E2D\uFF1F\uFF09`);
          continue;
        }
        const ta = t();
        const applyOut = proteusHost.applyOps(JSON.stringify(Array.from(payload)));
        rep.apply_ms += t() - ta;
        const ao = JSON.parse(applyOut);
        if (ao.ok !== true) {
          notes.push(`\u7B2C ${r} \u8F6E applyOps \u5931\u8D25\uFF1A${ao.error ?? ""}`);
          continue;
        }
        const changed = ao.rects ? Object.keys(ao.rects).length : 0;
        evidence.push({ round: r, row: at + 1, ops: payload.length, changed_rects: changed, relayout: ao.relayout ?? -1 });
        rep.updates_run++;
      }
      rep.update_evidence = evidence;
      if (probeId !== void 0) {
        const after = rectsOf()[String(probeId)]?.width ?? -1;
        rep.geom_probe.push({ id: probeId, before, after });
      }
      rep.ok = rep.updates_run > 0;
      if (!rep.ok) notes.push("\u589E\u91CF\u94FE\u672A\u8DD1\u8D77\u6765\u2014\u2014\u89C1\u4E0A\u65B9 notes");
      else notes.push(`\u5B9E\u4F8B\u6811 ${inst.nodes.length} \u8282\u70B9 / \u884C ${inst.stats.rows} / \u865A\u62DF\u5316\u884C ${rep.inst_virtual_rows} / \u589E\u91CF ${rep.updates_run} \u8F6E`);
      return JSON.stringify(rep);
    } catch (e) {
      rep.error = e?.message ?? String(e);
      return JSON.stringify(rep);
    }
  }
  globalThis.__proteusVaporRun = __proteusVaporRun;
})();
