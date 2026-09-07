# G-50 SPI 定义：DeveloperPlatform

> 接续 `02-architecture.md`。本文定义 **A（工具链）+ B（生态）共用的统一接口** `DeveloperPlatform`，
> 以及核心工件 `AppPackage` 的规范。**接口与后端解耦**——本地开发、平台门户、测试均可替换后端。

---

## 1. 设计原则（沿用原则 #0「不绑定」）

| 原则 | G-50 投影 |
|------|----------|
| 不绑定渲染后端 | → **不绑定工具链后端**（本地 / 云端构建可替换） |
| 不绑定资源容器 | → **不绑定应用包存储**（自有服务器 / 对象存储 / CDN 可替换） |
| 不绑定小程序能力 | → **不绑定审核策略**（自动 / 人工 / 第三方可替换） |
| 不绑定宿主形态 | → **不绑定分发渠道**（自有 App / 应用市场 / 网页可替换） |

> **一句话**：G-50 定义**语义与接口**，后端实现可插拔——与 G-27/G-46/G-48 完全同构。

---

## 2. 核心接口：DeveloperPlatform

```typescript
interface DeveloperPlatform {
  // ── A 工具链 ──────────────────────────────────────
  readonly toolchain: ToolchainAPI;
  // ── B 生态 ────────────────────────────────────────
  readonly portal: DeveloperPortalAPI;
  readonly submission: SubmissionAPI;
  readonly distribution: DistributionAPI;
  readonly governance: GovernanceAPI;
}
```

**五个子接口**对应 02-architecture 的三条主线 + 治理。各自后端可独立替换。

---

## 3. A 工具链：ToolchainAPI

```typescript
interface ToolchainAPI {
  /** 创建项目脚手架（05-project-scaffold） */
  createProject(input: ProjectSeed): Promise<Project>;

  /** 开发模式（HMR + DevTools，复用 devtools-plus（G-34）） */
  dev(project: Project, opts: DevOptions): DevServer;

  /** 构建（04-cli-pipeline） */
  build(project: Project, target: BuildTarget): Promise<BuildArtifact>;

  /** 静态审计（对齐 G-48 兼容矩阵 + G-49 权限） */
  audit(artifact: BuildArtifact): Promise<AuditReport>;

  /** 发布（08-publish-runtime）—— 桥接 A → B */
  publish(artifact: BuildArtifact, opts: PublishOptions): Promise<AppPackageRef>;

  /** 能力脚手架（07-component-toolkit）：基于 Capability IR 生成 Adapter 模板 */
  generateCapability(name: string, adapter: AdapterName): Promise<GeneratedFiles>;
}
```

**关键设计**：`publish()` 是 **A → B 的唯一桥接点**——工具链的产物（BuildArtifact）经此方法转为 AppPackageRef，
进入 B 的提审流程。**只要实现了 `publish`，A 工具链可完全独立使用**（即使不做 B 生态）。

---

## 4. B 生态：生态接口

```typescript
// 09-developer-portal
interface DeveloperPortalAPI {
  registerDeveloper(profile: DeveloperProfile): Promise<Developer>;
  createApp(developerId: string, input: AppSeed): Promise<App>;
  rotateKey(appId: string): Promise<APIKey>;
  manageMembers(appId: string, changes: MemberChange[]): Promise<void>;
}

// 10-submission-review
interface SubmissionAPI {
  submit(ref: AppPackageRef, version: string): Promise<Submission>;
  /** 自动化扫描（静态 + 权限 + 签名校验） */
  autoScan(submissionId: string): Promise<ScanResult>;
  /** 人工审核（可选，过扫描后触发） */
  manualReview(submissionId: string, reviewer: Reviewer): Promise<ReviewVerdict>;
  /** 审核通过 → 双签名（开发者签名 + 平台签名，G-45 扩展） */
  approve(submissionId: string): Promise<SignedPackage>;
}

// 11-distribution-store
interface DistributionAPI {
  /** 上架到 CDN / 应用市场 */
  release(signed: SignedPackage, channels: Channel[]): Promise<Release>;
  /** 灰度发布（按人群/地域/比例） */
  canary(releaseId: string, rules: CanaryRules): Promise<void>;
  /** 热修复（不更新版本，仅补丁） */
  hotfix(releaseId: string, patch: CodePatch): Promise<void>;
  /** 下架（治理触发，见 GovernanceAPI.revoke） */
  unpublish(releaseId: string, reason: string): Promise<void>;
}

// 12-governance-monetization
interface GovernanceAPI {
  /** 运行时配额检查（复用 G-49 ResourceQuota，扩展全局池） */
  checkQuota(packageId: string, usage: ResourceUsage): QuotaVerdict;
  /** 风控事件上报（运行时 → 治理） */
  reportMetrics(packageId: string, metrics: RuntimeMetrics): Promise<void>;
  /** 审计日志（不可篡改，对齐 G-49 ISOLATION_BREACH 审计） */
  auditEvent(event: GovernanceEvent): Promise<void>;
  /** 撤销（下架 + 清凭证 + 清存储，G-43 Drop 级联） */
  revoke(packageId: string, reason: RevocationReason): Promise<void>;
}
```

**五个接口 = B 的完整闭环**：门户(注册) → 提审(审核) → 分发(上架) → 治理(运行) → 撤销(下架)。

---

## 5. 核心工件：AppPackage（规范）

```typescript
interface AppPackage {
  readonly manifest: AppManifest;        // 见 05-project-scaffold
  readonly code: CodeBundle;             // 代码包（主包 + 分包，对齐 G-48）
  readonly assets: AssetBundle;          // 静态资源
  readonly developerSignature: Signature; // G-45 开发者签名
  readonly platformSignature?: Signature;// G-45 平台审核签名（审核通过后补）
}

interface AppManifest {
  packageId: string;                     // 全局唯一（反向域名）
  version: SemVer;                       // "1.0.0"
  sdkVersion: VersionRange;              // ">=1.2.0 <2.0"
  capabilities: CapabilityDeclaration[]; // G-48 Capability IR 静态化
  permissions: PermissionDeclaration[]; // G-49 CapabilityBridge 静态声明
  resources: ResourceQuota;             // G-49 ResourceQuota
}

type CapabilityDeclaration = {
  name: string;                          // 'login' | 'payment' | 'bluetooth' ...
  adapter?: AdapterName;                 // 走哪个平台 Adapter（默认 auto）
  required?: boolean;                    // 缺失是否致命
  restricted?: boolean;                  // 是否需审核（true → 触发 10 审核）
};
```

**AppPackage 的三重角色**：
1. **对工具链**：`publish()` 的输出
2. **对运行时**：G-48 Runtime 的加载输入（manifest 驱动权限/配额）
3. **对治理**：配额/审计/撤销的**唯一标识**（packageId）

---

## 6. 错误模型（统一，复用 G-48/G-49 风格）

```typescript
type PlatformError =
  | { code: 'BUILD_FAILED'; reason: string }
  | { code: 'AUDIT_FAILED'; violations: AuditViolation[] }     // 权限超声明
  | { code: 'SIGNATURE_INVALID'; kind: 'developer' | 'platform' }
  | { code: 'SUBMISSION_REJECTED'; reason: ReviewReason }
  | { code: 'QUOTA_EXCEEDED'; usage: ResourceUsage }          // 复用 G-49
  | { code: 'PACKAGE_NOT_FOUND'; packageId: string }
  | { code: 'REVOKE_ACTIVE'; packageId: string };
```

**关键约束（G-50.3）**：**配额/审核拒绝是业务错误（结构化返回），不是异常抛出**——
复用 G-49.6「配额拒绝是业务错误，非异常」。

---

## 7. 后端矩阵（接口 × 实现）

| 接口 | 本地开发后端 | 平台生产后端 | Conformance 后端 |
|------|------------|------------|----------------|
| ToolchainAPI | **LocalCLI** | CloudBuild | **InMemoryToolchain** |
| DeveloperPortalAPI | — | REST API | InMemoryPortal |
| SubmissionAPI | AutoPass | Scanner + Reviewer | **AutoReject**（负向测试） |
| DistributionAPI | LocalFS | CDN | InMemoryDist |
| GovernanceAPI | NoOp | AuditService | **RecordingGovernance** |

**Conformance 后端（第三列）是 G-44 Test IR 的应用**：用内存实现跑通全部流程，验证**接口语义正确**——
**与 G-48/G-49 的 conformance 思想完全一致**。

---

## 8. 与 G-48/G-49 的 SPI 衔接

```
G-48:  MiniProgramRuntime  ← AppPackage 是其加载输入（manifest 驱动 Adapter 选择）
G-49:  SandboxBackend      ← AppPackage 的 permissions/resources 是其策略输入
G-50:  DeveloperPlatform   ← 生产 + 管理 AppPackage（本份）
              ↑
        三者共用 AppPackage 契约（manifest/capabilities/permissions/resources/signatures）
```

**这是 G-50 的集成价值**：它不重新定义运行时/沙箱，而是**给已有 SPI 加一层"生产与管理"接口**，
让 AppPackage 成为贯穿三层的一等工件。

---

*下一份：`04-cli-pipeline.md`（A1：CLI 流水线，Phase 1 首个落地项）。*
