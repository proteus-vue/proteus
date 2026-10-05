// packages/compiler-backend-rust/src/style_ir_canon.rs
// ★★★G-61 B0（2026-10-05）：**StyleIR 规范化编码**（Rust 侧 —— 与 TS `packages/contracts/src/style-ir-canonical.ts` 同一规范）
//
// 【为什么 Rust 侧也要有一份】INV-CE-01 要求「同一 SFC，Node 后端与 Rust 后端产出的 IR **逐字节相同**」。
//   逐字节等价的前提是**编码规则一致**——不是"两边各自 JSON.stringify/format! 就差不多"：
//   · JS `String(1e21)` = `1e+21`（指数记法）；Rust `format!("{}", 1e21)` = `1000000000000000000000`（定点）——同值两种字节。
//   · JS `JSON.stringify` 保留插入序；Rust `serde_json::Value::Object` 默认 BTreeMap 是**键序**，但 `preserve_order`
//     feature 下变 IndexMap（插入序）——**两种都合法**，谁都不能作为契约依赖。
//   ⇒ 规范显式写死（见 TS 侧头注）：①对象键按 UTF-8 字节序升序 ②数组保序 ③数值 = 定点十进制（去尾零、-0→0、拒 NaN/Inf）
//
// 【与 TS 侧的对应关系（逐函数）】
//   canonical_number    ⇄ canonicalNumber
//   fixed_notation      ⇄ fixedNotation
//   write_canonical     ⇄ canonicalJsonValue
//   canonicalize        ⇄ canonicalizeStyleIR
//   ★对拍判据：`tests/style-ir-golden.test.ts`（TS 驱动双端 → 逐字节比对）+ `cargo test`（本侧自测独立锚点）
//
// 【诚实边界（B0）】与 TS 侧相同：本文件只冻结**编码规则**；CSE 产 IR 是 B1 交付物。
//
// ★serde_json 数值陷阱（本模块必须处理）：`Value::Number` 可能是 i64/u64/f64 任一——
//   `n.to_string()` 对 f64 会走 Rust 默认（定点），但对 u64 大数也走定点。
//   规范要求"最短往返 + 定点"，Rust 的 f64 Display 即最短往返 + 定点（Rust 自 1.0 起；
//   `{}` 对 1e21 输出 1000000000000000000000）。故直接用 n.to_string() 再走 fixed_notation 归一。

use serde_json::Value;

/// 规范编码错误（不可编码值 —— 与 TS 侧同判据：NaN/±Infinity 拒绝）
#[derive(Debug)]
pub struct CanonError(pub String);

impl std::fmt::Display for CanonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "StyleIR canonical: {}", self.0)
    }
}

/// 数值 → 定点十进制（规范 ③）。与 TS `canonicalNumber` 逐字节等价。
pub fn canonical_number(v: f64) -> Result<String, CanonError> {
    if !v.is_finite() {
        return Err(CanonError(format!(
            "非法数值 {v}（NaN / ±Infinity 不可序列化——契约 §5）"
        )));
    }
    if v == 0.0 {
        return Ok("0".to_string()); // -0.0 与 0.0 规范化为同形
    }
    Ok(fixed_notation(&format_f64_shortest(v)))
}

/// 最短往返 f64 → 文本（Rust 默认 `{}` 已是：最短往返 + 无指数定点）。
/// ★单独成函以便未来 Rust 版本行为变化时**只有这一处**需要适配。
fn format_f64_shortest(v: f64) -> String {
    format!("{v}")
}

/// 定点记法归一（去指数 + 去尾零）。与 TS `fixedNotation` 同算法。
fn fixed_notation(input: &str) -> String {
    let mut s = input.to_string();
    let mut exp: i64 = 0;
    if let Some(idx) = s.find(['e', 'E']) {
        exp = s[idx + 1..].parse::<i64>().unwrap_or(0);
        s.truncate(idx);
    }
    let mut sign = String::new();
    if let Some(rest) = s.strip_prefix('-') {
        sign.push('-');
        s = rest.to_string();
    }
    let dot = s.find('.');
    let digits: String = match dot {
        Some(d) => format!("{}{}", &s[..d], &s[d + 1..]),
        None => s.clone(),
    };
    let point_pos: i64 = (dot.unwrap_or(digits.len()) as i64) + exp;
    let (int_part, frac_part) = if point_pos <= 0 {
        (
            "0".to_string(),
            format!("{}{}", "0".repeat((-point_pos) as usize), digits),
        )
    } else if point_pos >= digits.len() as i64 {
        (
            format!("{}{}", digits, "0".repeat((point_pos - digits.len() as i64) as usize)),
            String::new(),
        )
    } else {
        (
            digits[..point_pos as usize].to_string(),
            digits[point_pos as usize..].to_string(),
        )
    };
    let frac = frac_part.trim_end_matches('0');
    // 去前导零（保留至少一位）
    let int_trimmed = int_part.trim_start_matches('0');
    let int_final = if int_trimmed.is_empty() { "0" } else { int_trimmed };
    if frac.is_empty() {
        format!("{sign}{int_final}")
    } else {
        format!("{sign}{int_final}.{frac}")
    }
}

/// 递归编码（规范 ①②③）。与 TS `canonicalJsonValue` 逐字节等价。
///
/// ★键序：`serde_json::Map` 的迭代序**不可依赖**（feature 相关）⇒ 显式收集 + `sort_unstable`（UTF-8 字节序，
///   Rust `String` 的 `Ord` 原生即字节序）。
pub fn write_canonical(v: &Value, out: &mut String) -> Result<(), CanonError> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&canonical_number(
            n.as_f64()
                .ok_or_else(|| CanonError(format!("数值 {n} 超出 f64 表示——IR 契约只允许 f64 范围")))?,
        )?),
        Value::String(s) => write_json_string(s, out),
        Value::Array(arr) => {
            out.push('[');
            for (i, item) in arr.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable(); // String Ord = UTF-8 字节序
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json_string(k, out);
                out.push(':');
                write_canonical(&map[*k], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// JSON 字符串转义（与 JS `JSON.stringify` 的**必转义集**一致：
/// `"` `\` 与 C0 控制字符；其余（含非 ASCII）输出原始 UTF-8）。
fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// **StyleIR(JSON) → 规范化文本**。与 TS `canonicalizeStyleIR` 逐字节等价。
pub fn canonicalize(v: &Value) -> Result<String, CanonError> {
    let mut out = String::new();
    write_canonical(v, &mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_are_fixed_notation_without_trailing_zeros() {
        assert_eq!(canonical_number(0.0).unwrap(), "0");
        assert_eq!(canonical_number(-0.0).unwrap(), "0"); // -0 规范化
        assert_eq!(canonical_number(1.0).unwrap(), "1");
        assert_eq!(canonical_number(1.5).unwrap(), "1.5");
        assert_eq!(canonical_number(0.5).unwrap(), "0.5");
        assert_eq!(canonical_number(1e21).unwrap(), "1000000000000000000000");
        assert_eq!(canonical_number(1e-7).unwrap(), "0.0000001");
        assert_eq!(canonical_number(-2.25).unwrap(), "-2.25");
        // 保真：相近值不得碰撞
        assert_ne!(canonical_number(0.4999999).unwrap(), canonical_number(0.5).unwrap());
    }

    #[test]
    fn rejects_non_finite() {
        assert!(canonical_number(f64::NAN).is_err());
        assert!(canonical_number(f64::INFINITY).is_err());
        assert!(canonical_number(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn object_keys_sorted_utf8_bytewise() {
        let v = json!({"b": 1, "a": 2, "A": 3});
        assert_eq!(canonicalize(&v).unwrap(), r#"{"A":3,"a":2,"b":1}"#);
    }

    #[test]
    fn arrays_keep_order_and_roundtrip() {
        let v = json!({"z": [3, 1, 2], "a": {"y": null, "x": true}});
        let enc = canonicalize(&v).unwrap();
        assert_eq!(enc, r#"{"a":{"x":true,"y":null},"z":[3,1,2]}"#);
        // 幂等：编码 → 解析 → 再编码 = 原编码
        let parsed: Value = serde_json::from_str(&enc).unwrap();
        assert_eq!(canonicalize(&parsed).unwrap(), enc);
    }

    #[test]
    fn strings_escape_minimally() {
        let v = json!({"s": "你好 \"x\"\n"});
        assert_eq!(canonicalize(&v).unwrap(), "{\"s\":\"你好 \\\"x\\\"\\n\"}");
    }
}
