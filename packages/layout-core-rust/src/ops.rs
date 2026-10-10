// packages/layout-core-rust/src/ops.rs
// ★★Vapor for Proteus IR —— **更新指令流的 Rust 侧解码**（V1 里程碑的「双端对齐」半边）
//
// 【这份实现为什么必须存在（而不仅是 TS 侧自娱自乐）】
//   更新指令的**消费者是宿主**（App 端 = JSI → 本 crate）。若只有 TS 侧编解码，
//   就只是「自己跟自己对」——真正的契约是 **TS 编 → Rust 解 → 语义等价**。
//   本文件 + `tests/ops_conformance.rs` 让这条契约变成**可回归的机器判据**。
//
// 【格式（与 packages/slot-runtime/src/buffer.ts 逐字节一致；★改动必须双端同步）】
//   Header（20B）: magic u32 = 0x504F5650("PVOP") · version u32 = 2
//                  · opCount u32 · keyCount u32 · strCount u32
//   KeyPool:      keyCount ×（u16 len, utf8 bytes）
//   StringPool:   strCount ×（u16 len, utf8 bytes）
//   Ops:          opCount 条（判别字节 + 定长字段；SET_ATTRS / LIST_SPLICE 带 u16 计数）
//
// 【纪律：全部小端、显式偏移读取】——不用 `#[repr(C)]` 结构体直接 transmute：
//   对齐填充与端序在不同架构上会变，而**字节流是跨端契约**，必须逐字节可控。
use std::collections::HashMap;

pub const OPS_MAGIC: u32 = 0x504F_5650; // "PVOP"（小端 50 56 4F 50）
/// ★★**V2 语义变更（2026-09-29）：池按需**——TS 侧编码时只把**本消息实际引用的**键/字符串
/// 放进池，并**重映射 ref 下标**（V1 是每条消息携带全量池 ⇒ 列表场景单条更新膨胀 ~78×）。
///
/// 【为什么解码端**无需改动**】本格式的池是"自包含声明"：池里有几项由 Header 的
///   `key_count`/`str_count` 声明，`key_of`/`string_of` 按**池内下标**解析。V2 只是让那个
///   池**更小**——解码路径（游标推进 + 下标查表）逐字节不变。故 Rust 侧仅版本号需要跟上，
///   这正是"TS 改协议 ⇒ Rust 必须同步"的**跨语言契约**在此处的体现（golden 门禁当场抓出）。
pub const OPS_VERSION: u32 = 2;
pub const OPS_HEADER_BYTES: usize = 20;

/* ────────────────────────── 指令与操作码 ────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpCode {
    SetProp = 0x01,
    SetStyle = 0x02,
    SetText = 0x03,
    SetAttrs = 0x04,
    ToggleVis = 0x05,
    /// ★★★B3d（2026-10-10）：**字符串样式** `(nodeId, keyId, strRef)`——
    ///   `grid-template-columns` 等值形如 `1fr 1fr 200px`（**字符串 token 串**），f32 的 SET_STYLE 装不下
    ///   ⇒ 独立 op（值走**字符串池引用**）。★与 TS `OpCode.SET_STYLE_STR` **同号**（跨语言契约）。
    SetStyleStr = 0x06,
    InsertBlock = 0x10,
    RemoveNode = 0x11,
    MoveNode = 0x12,
    ListSet = 0x20,
    ListSplice = 0x21,
    ListUpdate = 0x22,
    CallComponentUpdate = 0x30,
}

impl OpCode {
    pub fn from_u8(v: u8) -> Result<Self, String> {
        use OpCode::*;
        Ok(match v {
            0x01 => SetProp,
            0x02 => SetStyle,
            0x03 => SetText,
            0x04 => SetAttrs,
            0x05 => ToggleVis,
            0x06 => SetStyleStr,
            0x10 => InsertBlock,
            0x11 => RemoveNode,
            0x12 => MoveNode,
            0x20 => ListSet,
            0x21 => ListSplice,
            0x22 => ListUpdate,
            0x30 => CallComponentUpdate,
            other => return Err(format!("未知操作码：0x{other:02x}")),
        })
    }
}

/// 插入/移动的位次语义（与 TS 的 `InsertPos` 同号）
pub const POS_BEFORE: u8 = 0;
pub const POS_AFTER: u8 = 1;

#[derive(Debug, Clone, PartialEq)]
pub enum UpdateOp {
    SetProp { node_id: u32, key_id: u16, value: f32 },
    SetStyle { node_id: u32, key_id: u16, value: f32 },
    SetText { node_id: u32, text_ref: u32 },
    SetStyleStr { node_id: u32, key_id: u16, value_ref: u32 },
    SetAttrs { node_id: u32, attrs: Vec<(u16, f32)> },
    ToggleVis { node_id: u32, visible: bool },
    InsertBlock { block_id: u32, ref_node_id: u32, pos: u8 },
    RemoveNode { node_id: u32 },
    MoveNode { node_id: u32, ref_node_id: u32, pos: u8 },
    ListSet { list_id: u32, data_ref: u32 },
    ListSplice { list_id: u32, start: u32, del_count: u32, item_key_refs: Vec<u32> },
    ListUpdate { list_id: u32, item_key_ref: u32, slot_id: u32, value: f32 },
    CallComponentUpdate { component_id: u32, slot_id: u32, value: f32 },
}

impl UpdateOp {
    pub fn code(&self) -> OpCode {
        use UpdateOp::*;
        match self {
            SetProp { .. } => OpCode::SetProp,
            SetStyle { .. } => OpCode::SetStyle,
            SetText { .. } => OpCode::SetText,
            SetStyleStr { .. } => OpCode::SetStyleStr,
            SetAttrs { .. } => OpCode::SetAttrs,
            ToggleVis { .. } => OpCode::ToggleVis,
            InsertBlock { .. } => OpCode::InsertBlock,
            RemoveNode { .. } => OpCode::RemoveNode,
            MoveNode { .. } => OpCode::MoveNode,
            ListSet { .. } => OpCode::ListSet,
            ListSplice { .. } => OpCode::ListSplice,
            ListUpdate { .. } => OpCode::ListUpdate,
            CallComponentUpdate { .. } => OpCode::CallComponentUpdate,
        }
    }

    /// 指令体字节数（★必须与 TS 的 `opSize()` 逐项一致）
    pub fn size(&self) -> usize {
        use UpdateOp::*;
        match self {
            SetProp { .. } | SetStyle { .. } => 11,
            SetText { .. } => 9,
            // node_id(u32) + key_id(u16) + value_ref(u32) = 11（含 1 字节 opcode）
            SetStyleStr { .. } => 11,
            SetAttrs { attrs, .. } => 7 + 6 * attrs.len(),
            ToggleVis { .. } => 6,
            InsertBlock { .. } => 10,
            RemoveNode { .. } => 5,
            MoveNode { .. } => 10,
            ListSet { .. } => 9,
            ListSplice { item_key_refs, .. } => 15 + 4 * item_key_refs.len(),
            ListUpdate { .. } => 17,
            CallComponentUpdate { .. } => 13,
        }
    }
}

/* ────────────────────────── 解码 ────────────────────────── */

/// 解码结果（键表 / 字符串池 + 指令序列）
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedOps {
    pub version: u32,
    pub keys: Vec<String>,
    pub strings: Vec<String>,
    pub ops: Vec<UpdateOp>,
}

impl DecodedOps {
    /// 反查属性键（诊断用；运行时不走这条路径——这正是「不解析字符串」的落点）
    pub fn key_of(&self, id: u16) -> Option<&str> {
        self.keys.get(id as usize).map(|s| s.as_str())
    }
    /// 反查字符串（文本内容 / 列表 key）
    pub fn string_of(&self, id: u32) -> Option<&str> {
        self.strings.get(id as usize).map(|s| s.as_str())
    }
    /// ★列表项的**二级索引**：itemKey 字符串 → 该 key 上的指令位置
    ///
    /// 【为什么需要】宿主应用 `LIST_UPDATE` 时要按 key 找到目标列表项；
    ///   若每个指令现场线性扫字符串池，等于把「不解析字符串」的收益又还回去了。
    ///   ⇒ 一次解码建表，后续 O(1)。
    pub fn list_update_index(&self) -> HashMap<(u32, String), Vec<usize>> {
        let mut out: HashMap<(u32, String), Vec<usize>> = HashMap::new();
        for (i, op) in self.ops.iter().enumerate() {
            if let UpdateOp::ListUpdate { list_id, item_key_ref, .. } = op {
                if let Some(k) = self.string_of(*item_key_ref) {
                    out.entry((*list_id, k.to_string())).or_default().push(i);
                }
            }
        }
        out
    }
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Cursor { buf, pos: 0 }
    }
    fn need(&self, n: usize) -> Result<(), String> {
        if self.buf.len() - self.pos < n {
            return Err(format!("指令流被截断：需要 {n} 字节，剩余 {}", self.buf.len() - self.pos));
        }
        Ok(())
    }
    fn u8(&mut self) -> Result<u8, String> {
        self.need(1)?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }
    fn u16(&mut self) -> Result<u16, String> {
        self.need(2)?;
        let v = u16::from_le_bytes([self.buf[self.pos], self.buf[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, String> {
        self.need(4)?;
        let v = u32::from_le_bytes([
            self.buf[self.pos],
            self.buf[self.pos + 1],
            self.buf[self.pos + 2],
            self.buf[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }
    fn f32(&mut self) -> Result<f32, String> {
        self.need(4)?;
        let v = f32::from_le_bytes([
            self.buf[self.pos],
            self.buf[self.pos + 1],
            self.buf[self.pos + 2],
            self.buf[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }
    fn len_prefixed_str(&mut self) -> Result<String, String> {
        let n = self.u16()? as usize;
        self.need(n)?;
        let bytes = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        // ★严格 UTF-8：非法序列报错而不是静默替换（静默替换会让双端比对**假绿**）
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("非法 UTF-8（{n} 字节）：{e}"))
    }
}

/// 解码整个指令流（★与 TS `decodeOps()` 逐字节一致）
pub fn decode_ops(buf: &[u8]) -> Result<DecodedOps, String> {
    let mut c = Cursor::new(buf);
    let magic = c.u32()?;
    if magic != OPS_MAGIC {
        return Err(format!("magic 不符：0x{magic:08x}（期望 0x{OPS_MAGIC:08x}）"));
    }
    let version = c.u32()?;
    if version != OPS_VERSION {
        return Err(format!("版本不符：{version}（期望 {OPS_VERSION}）"));
    }
    let op_count = c.u32()? as usize;
    let key_count = c.u32()? as usize;
    let str_count = c.u32()? as usize;

    let mut keys = Vec::with_capacity(key_count);
    for _ in 0..key_count {
        keys.push(c.len_prefixed_str()?);
    }
    let mut strings = Vec::with_capacity(str_count);
    for _ in 0..str_count {
        strings.push(c.len_prefixed_str()?);
    }

    let mut ops = Vec::with_capacity(op_count);
    for i in 0..op_count {
        let raw = c.u8()?;
        let code = OpCode::from_u8(raw).map_err(|e| format!("第 {i} 条指令：{e}"))?;
        ops.push(decode_op(&mut c, code)?);
    }
    if c.pos != buf.len() {
        return Err(format!("指令流尾部有 {} 字节残留（格式或计数不符）", buf.len() - c.pos));
    }
    Ok(DecodedOps { version, keys, strings, ops })
}

fn decode_op(c: &mut Cursor<'_>, code: OpCode) -> Result<UpdateOp, String> {
    use OpCode::*;
    Ok(match code {
        SetProp => UpdateOp::SetProp { node_id: c.u32()?, key_id: c.u16()?, value: c.f32()? },
        SetStyle => UpdateOp::SetStyle { node_id: c.u32()?, key_id: c.u16()?, value: c.f32()? },
        SetText => UpdateOp::SetText { node_id: c.u32()?, text_ref: c.u32()? },
        SetStyleStr => UpdateOp::SetStyleStr { node_id: c.u32()?, key_id: c.u16()?, value_ref: c.u32()? },
        SetAttrs => {
            let node_id = c.u32()?;
            let n = c.u16()? as usize;
            let mut attrs = Vec::with_capacity(n);
            for _ in 0..n {
                attrs.push((c.u16()?, c.f32()?));
            }
            UpdateOp::SetAttrs { node_id, attrs }
        }
        ToggleVis => UpdateOp::ToggleVis { node_id: c.u32()?, visible: c.u8()? != 0 },
        InsertBlock => UpdateOp::InsertBlock { block_id: c.u32()?, ref_node_id: c.u32()?, pos: c.u8()? },
        RemoveNode => UpdateOp::RemoveNode { node_id: c.u32()? },
        MoveNode => UpdateOp::MoveNode { node_id: c.u32()?, ref_node_id: c.u32()?, pos: c.u8()? },
        ListSet => UpdateOp::ListSet { list_id: c.u32()?, data_ref: c.u32()? },
        ListSplice => {
            let list_id = c.u32()?;
            let start = c.u32()?;
            let del_count = c.u32()?;
            let n = c.u16()? as usize;
            let mut item_key_refs = Vec::with_capacity(n);
            for _ in 0..n {
                item_key_refs.push(c.u32()?);
            }
            UpdateOp::ListSplice { list_id, start, del_count, item_key_refs }
        }
        ListUpdate => UpdateOp::ListUpdate {
            list_id: c.u32()?,
            item_key_ref: c.u32()?,
            slot_id: c.u32()?,
            value: c.f32()?,
        },
        CallComponentUpdate => UpdateOp::CallComponentUpdate { component_id: c.u32()?, slot_id: c.u32()?, value: c.f32()? },
    })
}

/* ────────────────────────── 编解码往返自测（Rust 侧独立验证） ────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    /// 编码助手（仅测试用；生产端的编码在 TS 侧，Rust 只负责**解码**）
    fn encode_for_test(keys: &[&str], strings: &[&str], ops: &[UpdateOp]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&OPS_MAGIC.to_le_bytes());
        out.extend_from_slice(&OPS_VERSION.to_le_bytes());
        out.extend_from_slice(&(ops.len() as u32).to_le_bytes());
        out.extend_from_slice(&(keys.len() as u32).to_le_bytes());
        out.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        for k in keys {
            out.extend_from_slice(&(k.len() as u16).to_le_bytes());
            out.extend_from_slice(k.as_bytes());
        }
        for s in strings {
            out.extend_from_slice(&(s.len() as u16).to_le_bytes());
            out.extend_from_slice(s.as_bytes());
        }
        for op in ops {
            out.push(op.code() as u8);
            match op {
                UpdateOp::SetProp { node_id, key_id, value } | UpdateOp::SetStyle { node_id, key_id, value } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&key_id.to_le_bytes());
                    out.extend_from_slice(&value.to_le_bytes());
                }
                UpdateOp::SetText { node_id, text_ref } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&text_ref.to_le_bytes());
                }
                UpdateOp::SetStyleStr { node_id, key_id, value_ref } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&key_id.to_le_bytes());
                    out.extend_from_slice(&value_ref.to_le_bytes());
                }
                UpdateOp::SetAttrs { node_id, attrs } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&(attrs.len() as u16).to_le_bytes());
                    for (k, v) in attrs {
                        out.extend_from_slice(&k.to_le_bytes());
                        out.extend_from_slice(&v.to_le_bytes());
                    }
                }
                UpdateOp::ToggleVis { node_id, visible } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.push(if *visible { 1 } else { 0 });
                }
                UpdateOp::InsertBlock { block_id, ref_node_id, pos } => {
                    out.extend_from_slice(&block_id.to_le_bytes());
                    out.extend_from_slice(&ref_node_id.to_le_bytes());
                    out.push(*pos);
                }
                UpdateOp::RemoveNode { node_id } => out.extend_from_slice(&node_id.to_le_bytes()),
                UpdateOp::MoveNode { node_id, ref_node_id, pos } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&ref_node_id.to_le_bytes());
                    out.push(*pos);
                }
                UpdateOp::ListSet { list_id, data_ref } => {
                    out.extend_from_slice(&list_id.to_le_bytes());
                    out.extend_from_slice(&data_ref.to_le_bytes());
                }
                UpdateOp::ListSplice { list_id, start, del_count, item_key_refs } => {
                    out.extend_from_slice(&list_id.to_le_bytes());
                    out.extend_from_slice(&start.to_le_bytes());
                    out.extend_from_slice(&del_count.to_le_bytes());
                    out.extend_from_slice(&(item_key_refs.len() as u16).to_le_bytes());
                    for r in item_key_refs {
                        out.extend_from_slice(&r.to_le_bytes());
                    }
                }
                UpdateOp::ListUpdate { list_id, item_key_ref, slot_id, value } => {
                    out.extend_from_slice(&list_id.to_le_bytes());
                    out.extend_from_slice(&item_key_ref.to_le_bytes());
                    out.extend_from_slice(&slot_id.to_le_bytes());
                    out.extend_from_slice(&value.to_le_bytes());
                }
                UpdateOp::CallComponentUpdate { component_id, slot_id, value } => {
                    out.extend_from_slice(&component_id.to_le_bytes());
                    out.extend_from_slice(&slot_id.to_le_bytes());
                    out.extend_from_slice(&value.to_le_bytes());
                }
            }
        }
        out
    }

    #[test]
    fn roundtrip_all_opcodes() {
        let keys = vec!["layout.width", "paint.backgroundColor", "layout.gridTemplateColumns"];
        let strings = vec!["hello 世界", "row-1", "1fr 1fr 200px"];
        let ops = vec![
            UpdateOp::SetProp { node_id: 7, key_id: 0, value: 120.5 },
            UpdateOp::SetStyle { node_id: 8, key_id: 1, value: 255.0 },
            UpdateOp::SetStyleStr { node_id: 8, key_id: 2, value_ref: 2 },
            UpdateOp::SetText { node_id: 9, text_ref: 0 },
            UpdateOp::SetAttrs { node_id: 10, attrs: vec![(0, 8.0)] },
            UpdateOp::ToggleVis { node_id: 11, visible: true },
            UpdateOp::InsertBlock { block_id: 1, ref_node_id: 12, pos: POS_BEFORE },
            UpdateOp::RemoveNode { node_id: 13 },
            UpdateOp::MoveNode { node_id: 14, ref_node_id: 15, pos: POS_AFTER },
            UpdateOp::ListSet { list_id: 2, data_ref: 3 },
            UpdateOp::ListSplice { list_id: 2, start: 1, del_count: 2, item_key_refs: vec![1] },
            UpdateOp::ListUpdate { list_id: 2, item_key_ref: 1, slot_id: 5, value: 42.5 },
            UpdateOp::CallComponentUpdate { component_id: 4, slot_id: 6, value: 1.5 },
        ];
        let bytes = encode_for_test(&keys, &strings, &ops);
        let back = decode_ops(&bytes).expect("解码应成功");
        assert_eq!(back.ops, ops);
        assert_eq!(back.keys, keys);
        assert_eq!(back.strings, strings);
        // 字符串反查（宿主消费路径）
        assert_eq!(back.string_of(0), Some("hello 世界"));
        assert_eq!(back.key_of(0), Some("layout.width"));
    }

    #[test]
    fn rejects_bad_magic_and_version() {
        let mut bytes = encode_for_test(&[], &[], &[UpdateOp::RemoveNode { node_id: 1 }]);
        bytes[0] ^= 0xff;
        assert!(decode_ops(&bytes).unwrap_err().contains("magic"));

        let mut v = encode_for_test(&[], &[], &[UpdateOp::RemoveNode { node_id: 1 }]);
        v[4] = 99;
        assert!(decode_ops(&v).unwrap_err().contains("版本"));
    }

    #[test]
    fn rejects_truncated_stream() {
        let bytes = encode_for_test(&[], &[], &[UpdateOp::SetText { node_id: 1, text_ref: 0 }]);
        let truncated = &bytes[..bytes.len() - 2];
        assert!(decode_ops(truncated).unwrap_err().contains("截断"));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut bytes = encode_for_test(&[], &[], &[UpdateOp::RemoveNode { node_id: 1 }]);
        bytes.push(0);
        assert!(decode_ops(&bytes).unwrap_err().contains("残留"));
    }

    #[test]
    fn rejects_invalid_utf8() {
        // 手工构造：keyCount=1，长度 2，字节 0xFF 0xFE（非法 UTF-8）
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&OPS_MAGIC.to_le_bytes());
        bytes.extend_from_slice(&OPS_VERSION.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // opCount
        bytes.extend_from_slice(&1u32.to_le_bytes()); // keyCount
        bytes.extend_from_slice(&0u32.to_le_bytes()); // strCount
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&[0xFF, 0xFE]);
        assert!(decode_ops(&bytes).unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn op_size_matches_encoding_length() {
        // ★尺寸函数与实际编码必须一致（否则 TS 侧按尺寸预算分配会错位）
        // ★注意：encode_for_test 会带 20 字节 Header，故这里减去它再比。
        let ops = vec![
            UpdateOp::SetAttrs { node_id: 1, attrs: vec![(0, 1.0), (1, 2.0)] },
            UpdateOp::ListSplice { list_id: 1, start: 0, del_count: 1, item_key_refs: vec![0, 1, 2] },
        ];
        for op in &ops {
            let bytes = encode_for_test(&[], &[], std::slice::from_ref(op));
            assert_eq!(bytes.len() - OPS_HEADER_BYTES, op.size(), "尺寸不符：{op:?}");
        }
    }

    #[test]
    fn list_update_index_groups_by_item_key() {
        let strings = vec!["a", "b"];
        let ops = vec![
            UpdateOp::ListUpdate { list_id: 1, item_key_ref: 0, slot_id: 1, value: 1.0 },
            UpdateOp::ListUpdate { list_id: 1, item_key_ref: 1, slot_id: 1, value: 2.0 },
            UpdateOp::ListUpdate { list_id: 1, item_key_ref: 0, slot_id: 2, value: 3.0 },
        ];
        let decoded = decode_ops(&encode_for_test(&[], &strings, &ops)).unwrap();
        let idx = decoded.list_update_index();
        assert_eq!(idx.get(&(1, "a".to_string())).map(|v| v.len()), Some(2));
        assert_eq!(idx.get(&(1, "b".to_string())).map(|v| v.len()), Some(1));
    }
}
