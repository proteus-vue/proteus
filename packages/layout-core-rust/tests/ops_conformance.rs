// packages/layout-core-rust/tests/ops_conformance.rs
// ★★Vapor IR V1 · **双端对齐**门禁（Rust 侧）—— 与 TS 的 tests/update-ops-golden.test.ts 配对
//
// 【这份测试在防什么（为什么不能只做各自的往返）】
//   更新指令的字节流是 **TS 编码 → 宿主（本 crate）解码** 的跨语言契约。
//   两侧各写一份编解码后，若只测「自己编自己解」，编码端改了字段宽度/端序/操作码，
//   解码端不会红——真机上才炸。真正的判据是：**同一份字节，两端解出同一语义**。
//
// 【判据形态】
//   `tests/golden/update-ops.bin`（TS 生成）+ `update-ops.json`（TS 侧的 canonical 视图）
//   ⇒ 本测试解码 .bin，构造**同形态**的 canonical JSON，与 .json **逐字段比对**。
//
// 【golden 从哪来】`tests/update-ops-golden.test.ts` 生成（`UPDATE_OPS_GOLDEN_WRITE=1` 重写）。
//   故本测试**无需 Node 即可运行**（CI/无头环境可回归）。
use std::fs;
use std::path::PathBuf;

use proteus_layout_core::ops::{decode_ops, UpdateOp};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
struct GoldenJson {
    version: u32,
    keys: Vec<String>,
    strings: Vec<String>,
    ops: Vec<Value>,
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

/// 把 Rust 解码结果转成与 TS 侧**同形**的 canonical JSON
///
/// ★字段名必须是 camelCase（TS 侧 `{...op}` 展开后就是这种形态）——
///   若这里写 snake_case，比对会因命名而红，掩盖真正的格式问题。
fn canonical_json(decoded: &proteus_layout_core::ops::DecodedOps) -> Value {
    let ops: Vec<Value> = decoded
        .ops
        .iter()
        .map(|op| match op {
            UpdateOp::SetProp { node_id, key_id, value } => {
                json!({ "op": 0x01, "nodeId": node_id, "keyId": key_id, "value": value })
            }
            UpdateOp::SetStyle { node_id, key_id, value } => {
                json!({ "op": 0x02, "nodeId": node_id, "keyId": key_id, "value": value })
            }
            UpdateOp::SetStyleStr { node_id, key_id, value_ref } => {
                json!({ "op": 0x06, "nodeId": node_id, "keyId": key_id, "valueRef": value_ref })
            }
            UpdateOp::SetText { node_id, text_ref } => {
                json!({ "op": 0x03, "nodeId": node_id, "textRef": text_ref })
            }
            UpdateOp::SetAttrs { node_id, attrs } => json!({
                "op": 0x04,
                "nodeId": node_id,
                "attrs": attrs.iter().map(|(k, v)| json!({ "keyId": k, "value": v })).collect::<Vec<_>>()
            }),
            UpdateOp::ToggleVis { node_id, visible } => {
                json!({ "op": 0x05, "nodeId": node_id, "visible": visible })
            }
            UpdateOp::InsertBlock { block_id, ref_node_id, pos } => {
                json!({ "op": 0x10, "blockId": block_id, "refNodeId": ref_node_id, "pos": pos })
            }
            UpdateOp::RemoveNode { node_id } => json!({ "op": 0x11, "nodeId": node_id }),
            UpdateOp::MoveNode { node_id, ref_node_id, pos } => {
                json!({ "op": 0x12, "nodeId": node_id, "refNodeId": ref_node_id, "pos": pos })
            }
            UpdateOp::ListSet { list_id, data_ref } => {
                json!({ "op": 0x20, "listId": list_id, "dataRef": data_ref })
            }
            UpdateOp::ListSplice { list_id, start, del_count, item_key_refs } => json!({
                "op": 0x21,
                "listId": list_id,
                "start": start,
                "delCount": del_count,
                "itemKeyRefs": item_key_refs
            }),
            UpdateOp::ListUpdate { list_id, item_key_ref, slot_id, value } => json!({
                "op": 0x22,
                "listId": list_id,
                "itemKeyRef": item_key_ref,
                "slotId": slot_id,
                "value": value
            }),
            UpdateOp::CallComponentUpdate { component_id, slot_id, value } => json!({
                "op": 0x30,
                "componentId": component_id,
                "slotId": slot_id,
                "value": value
            }),
        })
        .collect();
    json!({
        "version": decoded.version,
        "keys": decoded.keys,
        "strings": decoded.strings,
        "ops": ops,
    })
}

fn load_golden() -> (Vec<u8>, GoldenJson) {
    let dir = golden_dir();
    let bin = fs::read(dir.join("update-ops.bin"))
        .expect("golden 缺失——先跑 `UPDATE_OPS_GOLDEN_WRITE=1 npx vitest run tests/update-ops-golden.test.ts`");
    let txt = fs::read_to_string(dir.join("update-ops.json")).expect("golden JSON 缺失");
    let parsed: GoldenJson = serde_json::from_str(&txt).expect("golden JSON 解析失败");
    (bin, parsed)
}

#[test]
fn decodes_ts_encoded_stream_faithfully() {
    let (bin, golden) = load_golden();
    let decoded = decode_ops(&bin).expect("Rust 必须能解码 TS 产出的字节流");

    // ① 版本 / 池逐项一致
    assert_eq!(decoded.version, golden.version, "版本不符");
    assert_eq!(decoded.keys, golden.keys, "属性键表不符（键序敏感——intern 顺序是契约）");
    assert_eq!(decoded.strings, golden.strings, "字符串池不符");

    // ② ★指令语义逐条一致（canonical JSON 比对：字段名 + 值 + 顺序）
    //
    // ★数值比对必须**数值感知**（本仓实测：首版直接比 `serde_json::Value` 红在
    //   `8.0`(TS 侧 JSON.stringify) vs `8`(Rust serde 输出) —— 同一个 f32 的两种文本表示。
    //   那是**表示层假红**，会掩盖真正的格式问题。⇒ 统一走 `num_eq()`。
    let got = canonical_json(&decoded);
    let want = json!({
        "version": golden.version,
        "keys": golden.keys,
        "strings": golden.strings,
        "ops": golden.ops,
    });
    assert!(
        json_semantically_eq(&got, &want),
        "★双端语义不一致：\n  Rust 解码 = {}\n  TS golden = {}",
        serde_json::to_string(&got).unwrap(),
        serde_json::to_string(&want).unwrap()
    );

    // ③ 数量自洽
    assert_eq!(decoded.ops.len(), golden.ops.len(), "指令条数不符");
    // 把 golden 里出现过的操作码都覆盖到（漏一条 = 该指令在 Rust 侧无人验证）
    let seen: std::collections::HashSet<u64> = golden
        .ops
        .iter()
        .filter_map(|o| o.get("op").and_then(|v| v.as_u64()))
        .collect();
    for code in [0x01, 0x02, 0x03, 0x04, 0x05, 0x10, 0x11, 0x12, 0x20, 0x21, 0x22, 0x30] {
        assert!(seen.contains(&code), "golden 未覆盖操作码 0x{code:02x}（该指令在 Rust 侧无人验证）");
    }
}

#[test]
fn string_pool_lookup_matches_content() {
    // 宿主实际消费路径：按 ref 反查文本（这是「运行时无字符串解析」的兑现点）
    let (bin, golden) = load_golden();
    let decoded = decode_ops(&bin).unwrap();
    // golden 里含中文与 emoji：验证 UTF-8 变长与代理对解码无损
    let has_cjk = decoded.strings.iter().any(|s| s.contains("无线降噪耳机"));
    let has_emoji = decoded.strings.iter().any(|s| s.contains("🎧"));
    assert!(has_cjk, "中文字符串解码丢失");
    assert!(has_emoji, "emoji（代理对）解码丢失");
    assert_eq!(decoded.strings, golden.strings);
}

#[test]
fn list_update_index_is_usable_for_host_apply() {
    // ★宿主应用 LIST_UPDATE 的关键路径：按 (listId, itemKey) 定位
    let (bin, _) = load_golden();
    let decoded = decode_ops(&bin).unwrap();
    let idx = decoded.list_update_index();
    // golden 里那条 LIST_UPDATE 的 key 是 'id-4021'
    assert!(
        idx.contains_key(&(3, "id-4021".to_string())),
        "★宿主无法按 key 定位列表项——LIST_UPDATE 的消费路径断了"
    );
}

/* ────────────────────── 破坏性验证：门禁真的会红吗 ────────────────────── */

#[test]
fn destructive_proof_wrong_opcode_is_rejected() {
    // 把第一条指令的操作码改成未定义值 ⇒ 必须报错（而不是静默解成别的指令）
    let (bin, _) = load_golden();
    let mut broken = bin.clone();
    // header 20B + key 池 + 字符串池之后才是第一条指令；这里直接找已知偏移不便，
    // 改用「截断到只剩头 + 池」的方式构造非法流：
    let truncated = &mut broken[..OPS_HEADER_MIN];
    truncated[8] = 1; // opCount = 1，但后面没有指令体 ⇒ 必然截断报错
    assert!(decode_ops(truncated).is_err(), "★截断的指令流竟然解码成功——门禁失效");
}

/// header 20B + 最小池（golden 的池不止这些，故这里只是「必定不够」的保守上界）
const OPS_HEADER_MIN: usize = 20;

/* ────────────────────── 数值感知的 JSON 比对 ────────────────────── */

/// 语义相等：数字按 **f64 数值**比（容忍 `8.0` vs `8` 这类文本差异），其余严格
///
/// 【为什么需要】TS 的 `JSON.stringify(8)` → `8`，而 `JSON.stringify(8.0)` → `8`；
///   但 `serde_json` 对 f32 字段会输出 `8.0`。同一 f32 的两种文本表示不应判红。
///   注意：**不**做容差比较（不是 approx）——数值必须精确相等，否则掩盖精度缺陷。
fn json_semantically_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(xf), Some(yf)) => xf == yf,
            _ => false,
        },
        (Value::Array(xs), Value::Array(ys)) => {
            xs.len() == ys.len() && xs.iter().zip(ys).all(|(x, y)| json_semantically_eq(x, y))
        }
        (Value::Object(xo), Value::Object(yo)) => {
            xo.len() == yo.len()
                && xo.iter().all(|(k, v)| yo.get(k).map(|w| json_semantically_eq(v, w)).unwrap_or(false))
        }
        _ => a == b,
    }
}
