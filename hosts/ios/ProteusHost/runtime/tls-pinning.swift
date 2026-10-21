// hosts/ios/ProteusHost/runtime/tls-pinning.swift
// ★★★决策 #1153：**TLS 证书 pinning**（iOS 宿主侧）。
//
// 【为什么单列】`http-capability.swift` 已是千行级文件（`check:file-size` 棘轮）；
//   pinning 是一块完全内聚的职责（解析指纹 + 校验证书链 + 与系统信任组合），抽出来更清楚。
//
// 【★★实现口径：钉 SPKI，不钉整张证书】
//   钉整张证书在**续期**（同一密钥）时指纹就变 ⇒ 每次续期都得改业务代码；
//   SPKI（SubjectPublicKeyInfo）跨续期稳定，且能覆盖"链上任意一张证书"（含中间 CA）。
//   ⇒ 取 `SecCertificateCopyKey(cert)` 的**外部表示**（DER 编码的 SPKI）后算 SHA-256。
//   ★它与 openssl 的 `x509 -pubkey | pkey -pubin -outform der` 得到**同一串字节**（判据用 openssl 交叉验证）。
//
// 【两种信任语义（与 `MetaTagInvoke.PinOnly` 对应）】
//   · **叠加**（缺省）：系统信任必须通过 **且** pin 命中。
//   · **替代**（pinOnly）：只看 pin（仍由 URLSession 校验主机名）。
//     用途：企业内网自签（系统信任必然拒 ⇒ 不替代就永远用不上 pin）。★它放宽了信任锚，只由业务显式开启。
//
// 【★诚实边界】
//   · `pinOnly` 模式下**不再**校验证书的有效期/吊销（那是系统信任的职责）——这是"只看 pin"的必然含义；
//   · 主机名校验不在本文件：`URLSession` 在 challenge 里由系统做（`defaultHandling` 时）；
//     ★我们返回 `.performDefaultHandling` 让系统继续走自己的验证，**再**叠 pin 校验——
//       若系统拒（自签），challenge 不会给我们"通过"的机会，`pinOnly` 才有意义。
//   · 指纹比较用 `CryptoKit` 的 `SHA256`（系统库，零第三方依赖）。

import Foundation
import CryptoKit
import Security

enum TlsPinningIos {
    /**
     * ★★★#1153：**pin 明确未命中**的 reqId 记账（供 `didCompleteWithError` 精确归因）。
     *
     * 【为什么必须单独记】在 `URLSession` 里，"我们在 challenge 里因 pin 不匹配而取消"
     *   与"系统因证书不受信任而拒绝"产生的是**同一种** `NSURLErrorCancelled`(-999)
     *   ⇒ 只靠错误码无法区分。而两者的归因**必须不同**：
     *     · pin 未命中 ⇒ `fetch.tlsError`（业务去查 pin 配置）
     *     · 系统不信任 ⇒ `fetch.failed`（业务去查证书/CA，不是 pin）
     *   首版把两者都归成 tlsError ⇒ "叠加模式"那条报错归因错（比不归因更误导）。
     * ⇒ challenge 里判 pin 失败时按 reqId 记一笔，`didCompleteWithError` **消费**它。
     */
    private static var pinMismatchReqIds = Set<String>()
    private static let lock = NSLock()

    static func notePinMismatch(_ reqId: String) {
        lock.lock(); defer { lock.unlock() }
        pinMismatchReqIds.insert(reqId)
    }

    /** 消费（读一次即清）：`true` ⇒ 这次失败是 pin 未命中（不是系统信任问题）。 */
    static func consumePinMismatch(_ reqId: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return pinMismatchReqIds.remove(reqId) != nil
    }

    /// 解析指纹串（换行 / 逗号 / 空白分隔；容忍 HPKP 的 `sha256/` 前缀）。
    /// ★返回空数组 = **不做 pinning**（调用方据此保持平台默认——绝不"用了但没生效"）。
    static func parsePins(_ raw: String?) -> [Data] {
        guard let raw, !raw.isEmpty else { return [] }
        var out: [Data] = []
        let parts = raw.split(whereSeparator: { $0.isWhitespace || $0 == "," })
        for part in parts {
            var p = String(part)
            // ★★只认**确切的**算法前缀：base64 字母表含 `/`，按任意 `/` 切会把指纹截断
            let lower = p.lowercased()
            if lower.hasPrefix("sha256/") { p = String(p.dropFirst("sha256/".count)) }
            else if lower.hasPrefix("sha-256/") { p = String(p.dropFirst("sha-256/".count)) }
            if let d = Data(base64Encoded: p), !d.isEmpty { out.append(d) }
        }
        return out
    }

    /// 一张证书的 SHA-256(SPKI)。
    static func spkiSha256(_ cert: SecCertificate) -> Data? {
        guard let key = SecCertificateCopyKey(cert),
              let der = SecKeyCopyExternalRepresentation(key, nil) as Data? else { return nil }
        // ★`SecKeyCopyExternalRepresentation` 对 RSA/EC 公钥返回的是**裸公钥**（PKCS#1 / 裸点），
        //   **不是**完整的 SPKI 结构（后者含 AlgorithmIdentifier 头）。
        //   ⇒ 为与 openssl/Android 的"SPKI 指纹"口径**逐字节一致**，这里必须补上 SPKI 头。
        //   ★这是本文件最容易做错的一处：直接对裸公钥哈希会得到**另一个值**，
        //     导致"按标准文档算出的 pin 永远不匹配"（且两端各错一套，判据才会发现）。
        let spki = wrapInSpki(der, key: key)
        return Data(SHA256.hash(data: spki))
    }

    /// 给裸公钥补 SPKI 头（AlgorithmIdentifier + BIT STRING 包装）。
    /// ★只覆盖本仓实际会遇到的两种：RSA（PKCS#1）与 EC（裸点，P-256/P-384）。
    ///   其它算法（Ed25519 等）如实返回原字节并依赖上层"不匹配则报错"——
    ///   不静默猜（猜错比报错更糟）。
    private static func wrapInSpki(_ der: Data, key: SecKey) -> Data {
        guard let attrs = SecKeyCopyAttributes(key) as? [String: Any],
              let type = attrs[kSecAttrKeyType as String] as? String else { return der }
        let bitString = der
        if type == (kSecAttrKeyTypeRSA as String) {
            // RSA：SPKI = SEQ { SEQ { OID rsaEncryption, NULL }, BITSTRING { PKCS#1 } }
            let algId = Data([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
            return seq(algId + bitStringWrap(bitString))
        }
        if type == (kSecAttrKeyTypeECSECPrimeRandom as String) {
            // EC：SPKI = SEQ { SEQ { OID id-ecPublicKey, OID curve }, BITSTRING { 裸点 } }
            let curveOid: [UInt8]
            let bits = Int(attrs[kSecAttrKeySizeInBits as String] as? Int ?? 256)
            switch bits {
            case 384: curveOid = [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22] // secp384r1
            case 521: curveOid = [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x23] // secp521r1
            default: curveOid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07] // prime256v1
            }
            let ecOid: [UInt8] = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01] // id-ecPublicKey
            let algId = seq(Data(ecOid) + Data(curveOid))
            return seq(algId + bitStringWrap(bitString))
        }
        return der
    }

    private static func bitStringWrap(_ d: Data) -> Data {
        // BIT STRING：tag 0x03 + 长度 + **1 字节 unused-bits 前缀（0）** + 内容
        var out = Data([0x03])
        out.append(derLength(d.count + 1))
        out.append(0x00)
        out.append(d)
        return out
    }

    private static func seq(_ d: Data) -> Data {
        var out = Data([0x30])
        out.append(derLength(d.count))
        out.append(d)
        return out
    }

    /// DER 长度编码（<128 单字节；否则 0x8N + N 字节大端）。
    private static func derLength(_ n: Int) -> Data {
        if n < 0x80 { return Data([UInt8(n)]) }
        var bytes: [UInt8] = []
        var v = n
        while v > 0 { bytes.insert(UInt8(v & 0xff), at: 0); v >>= 8 }
        return Data([0x80 | UInt8(bytes.count)] + bytes)
    }

    /// 链上任一证书的 SPKI 命中任一 pin ⇒ 通过。
    static func chainMatches(_ pins: [Data], _ certs: [SecCertificate]) -> Bool {
        for cert in certs {
            guard let digest = spkiSha256(cert) else { continue }
            for pin in pins where digest == pin { return true }
        }
        return false
    }

    /// 处理 `NSURLAuthenticationChallenge`（server trust）。
    /// @return `nil` ⇒ 没有 pin 配置（调用方用系统默认处理）；否则返回是否接受。
    /**
     * 处理 `NSURLAuthenticationChallenge`（server trust）。
     *
     * @return 三态（★不能用 Bool?——"系统不信任"与"pin 未命中"必须分开，否则归因错）：
     *   · `.none`    ⇒ 没有 pin 配置 / 不是 server-trust 挑战（调用方用系统默认处理）
     *   · `.systemTrustFailed` ⇒ 叠加模式下**系统不信任**（不是 pin 的问题）
     *   · `.pinMismatch` ⇒ 链上没有任何证书命中 pin（这才是 `fetch.tlsError` 该归的因）
     *   · `.accept`  ⇒ 通过
     */
    enum Verdict {
        case none
        case systemTrustFailed
        case pinMismatch
        case accept
    }

    static func evaluate(challenge: URLAuthenticationChallenge, pins: [Data], pinOnly: Bool) -> Verdict {
        guard !pins.isEmpty else { return .none }
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else { return .none }
        var certs: [SecCertificate] = []
        if let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate] {
            certs = chain
        }
        // ① 叠加模式：系统信任必须先过（自签/私有 CA 在这里就被挡住 ⇒ 归因是"系统不信任"）
        if !pinOnly {
            var err: CFError?
            if !SecTrustEvaluateWithError(trust, &err) { return .systemTrustFailed }
        }
        // ② pin 必须命中（到这里失败就是**pin 的问题**）
        return chainMatches(pins, certs) ? .accept : .pinMismatch
    }
}
