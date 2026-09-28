// packages/layout-core-rust/src/rects_bin.rs
// ★Vapor IR V4 —— **变化集二进制返回通道**（V3 类B 实测的第一优化项）
//
// 【为什么必须做（V3 真机读数）】类B（4003 节点全量重排）成本分解：
//     rects_parse **19.35ms** · apply 15.43ms · layers 13.34ms
//   ⇒ **返回通道的 JSON 解析是最大单项**。这与 `blob.rs` 顶注的结论（JSON 通道占 4051 节点
//     布局耗时 95%+）在**返回路径**上再次吻合——去程已用二进制（blob），回程还在用 JSON。
//
// 【为什么不用 serde_json 反序列化后编码】
//   那是「先解析成 Value 再重新编码」——解析成本一分没省。⇒ 宿主解码时**直接顺序读**：
//   无字符扫描、无 HashMap、无 f32 文本解析（`parse_float` 是最贵的）。
//
// ── 线上格式（全部小端；与 TS 侧 `decodeRects` / 宿主解码必须逐字节一致）──
//   Header（16B）
//     magic   u32 = 0x53455250 ("PRES" 小端 50 52 45 53)
//     version u32 = 1
//     count   u32            矩形条数
//     reserved u32           对齐保留（恒 0）
//   Rects（count × 20B，定长 ⇒ 解码即游标推进）
//     id u32 · x f32 · y f32 · width f32 · height f32
//
// 【体积对照】4003 条：JSON 222KB（66 字节/条） vs 本格式 **80KB**（20 字节/条）——2.8×，
//   且解码是 memcpy 级。
use crate::node::LayoutTree;

pub const RECTS_MAGIC: u32 = 0x5345_5250; // "PRES"（小端 50 52 45 53）
pub const RECTS_VERSION: u32 = 1;
pub const RECTS_HEADER_BYTES: usize = 16;
/// 单条矩形字节数（id u32 + 4×f32）
pub const RECT_BYTES: usize = 20;

/// 从已计算的绝对矩形表编码为二进制（调用方给的是 (id, Rect) 列表）
pub fn encode_rects(items: &[(u32, crate::style::Rect)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(RECTS_HEADER_BYTES + items.len() * RECT_BYTES);
    out.extend_from_slice(&RECTS_MAGIC.to_le_bytes());
    out.extend_from_slice(&RECTS_VERSION.to_le_bytes());
    out.extend_from_slice(&(items.len() as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // reserved
    for (id, r) in items {
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(&r.x.to_le_bytes());
        out.extend_from_slice(&r.y.to_le_bytes());
        out.extend_from_slice(&r.width.to_le_bytes());
        out.extend_from_slice(&r.height.to_le_bytes());
    }
    out
}

/// 收集子树的绝对矩形为 (id, Rect) 列表（与既有 `collect_abs_subtree` 同语义，
/// 只是产出**结构体列表**而非 JSON Map——避免中途构造 serde_json::Value）
pub fn collect_abs_pairs(
    tree: &LayoutTree,
    idx: u32,
    parent_ox: f32,
    parent_oy: f32,
    out: &mut Vec<(u32, crate::style::Rect)>,
) {
    let node = tree.get(idx);
    if node.style.display == crate::style::Display::None {
        return; // 无盒：不下钻（与 JSON 路径同规则）
    }
    let r = node.rect;
    let abs_x = parent_ox + r.x;
    let abs_y = parent_oy + r.y;
    out.push((
        node.id,
        crate::style::Rect { x: abs_x, y: abs_y, width: r.width, height: r.height },
    ));
    for &c in &node.children {
        collect_abs_pairs(tree, c, abs_x, abs_y, out);
    }
}

/* ────────────────────────── 解码（供测试与桌面验证） ────────────────────────── */

/// 解码结果（宿主/测试消费）
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedRects {
    pub version: u32,
    pub rects: Vec<(u32, crate::style::Rect)>,
}

pub fn decode_rects(buf: &[u8]) -> Result<DecodedRects, String> {
    if buf.len() < RECTS_HEADER_BYTES {
        return Err(format!("头不足：{} < {RECTS_HEADER_BYTES}", buf.len()));
    }
    let u32at = |o: usize| u32::from_le_bytes([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
    let magic = u32at(0);
    if magic != RECTS_MAGIC {
        return Err(format!("magic 不符：0x{magic:08x}（期望 0x{RECTS_MAGIC:08x}）"));
    }
    let version = u32at(4);
    if version != RECTS_VERSION {
        return Err(format!("版本不符：{version}（期望 {RECTS_VERSION}）"));
    }
    let count = u32at(8) as usize;
    let need = RECTS_HEADER_BYTES + count * RECT_BYTES;
    if buf.len() < need {
        return Err(format!("指令流被截断：需要 {need} 字节，实际 {}", buf.len()));
    }
    if buf.len() > need {
        return Err(format!("尾部有 {} 字节残留（格式或计数不符）", buf.len() - need));
    }
    let f32at = |o: usize| f32::from_le_bytes([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
    let mut rects = Vec::with_capacity(count);
    for i in 0..count {
        let o = RECTS_HEADER_BYTES + i * RECT_BYTES;
        rects.push((
            u32at(o),
            crate::style::Rect { x: f32at(o + 4), y: f32at(o + 8), width: f32at(o + 12), height: f32at(o + 16) },
        ));
    }
    Ok(DecodedRects { version, rects })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::Rect;

    #[test]
    fn roundtrip_and_size() {
        let items: Vec<(u32, Rect)> = (0..100)
            .map(|i| (i, Rect { x: i as f32, y: i as f32 * 2.0, width: 10.0, height: 20.0 }))
            .collect();
        let bytes = encode_rects(&items);
        assert_eq!(bytes.len(), RECTS_HEADER_BYTES + 100 * RECT_BYTES);
        let back = decode_rects(&bytes).expect("解码应成功");
        assert_eq!(back.rects, items);
    }

    #[test]
    fn rejects_bad_magic_version_and_truncation() {
        let items = vec![(1u32, Rect { x: 1.0, y: 2.0, width: 3.0, height: 4.0 })];
        let good = encode_rects(&items);
        let mut bad = good.clone();
        bad[0] ^= 0xff;
        assert!(decode_rects(&bad).unwrap_err().contains("magic"));
        let mut badv = good.clone();
        badv[4] = 9;
        assert!(decode_rects(&badv).unwrap_err().contains("版本"));
        assert!(decode_rects(&good[..good.len() - 1]).unwrap_err().contains("截断"));
        let mut extra = good.clone();
        extra.push(0);
        assert!(decode_rects(&extra).unwrap_err().contains("残留"));
    }

    /// ★体积对照（方案 §V4 的立项依据）：二进制应显著小于等值 JSON
    #[test]
    fn binary_is_meaningfully_smaller_than_json() {
        let items: Vec<(u32, Rect)> = (0..4003)
            .map(|i| (i, Rect { x: 0.0, y: i as f32 * 56.0, width: 358.0, height: 56.0 }))
            .collect();
        let bin = encode_rects(&items);
        // 等值 JSON（与现状返回体同构）
        let json = serde_json::to_string(
            &items.iter().map(|(id, r)| (id.to_string(), serde_json::json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}))).collect::<std::collections::BTreeMap<_, _>>(),
        )
        .unwrap();
        assert!(
            bin.len() * 2 < json.len(),
            "二进制应至少小一半：bin={} json={}",
            bin.len(),
            json.len()
        );
    }
}
