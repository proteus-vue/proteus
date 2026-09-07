---
title: Semantic versioning & compatibility
order: 39
group: 质量与兼容
---

# Semantic versioning & compatibility

Proteus's stance on compatibility: **commitments are anchored by mechanisms, not by words**. The framework doesn't start by handing you a marketing guarantee of "forever backward compatible"; instead, it turns every compatibility contract into a machine-decidable conformance rule — passing means compatible, failing means incompatible, with no middle ground.

## Compatibility is anchored by conformance

"Compatibility" in a pluggable layer is defined as: **the same contract tests pass across every implementation**. Take the CCI iron rules of combination conformance (G-47) as an example:

| ID | Iron rule | Level |
|---|---|---|
| CCI-01 | A backend must not cache `readAuth` results — query the shared pool every time | error |
| CCI-02 | `unmount()` must not destroy any resource in the pool | error |
| CCI-03 | Switching backends must be an atomic transaction (mounting the new + unmounting the old cannot be split) | error |
| CCI-04 | Logout and backend switching must be serialized (the same lock) | error |
| CCI-05 | An unavailable backend must throw explicitly (silent error-swallowing is forbidden) | error |
| CCI-06 | Combination conformance must be 100% PASS, 0 warnings | error |

The same anchoring runs through every layer: the same semantics across backends must produce structurally identical state (CMP074); inconsistent results across backends — a semantic divergence — must be fixed (CMP077); any backend conformance FAIL blocks the merge (G-44.2). So when upgrading the framework version or swapping in a backend, "whether it is compatible" is not guessed by reading docs — it is run: the same Test IR is re-run on the new version (the same assertions must be executable on ≥2 backends, G-44.4), and a PASS proves the behavioral contract is unchanged. See [Conformance](/docs/framework/29-conformance) for details.

## Versioning mechanisms already shipped

| Mechanism | Content | Status |
|---|---|---|
| The "backward compatibility" iron rule | major versioning + a deprecation flow; cross-layer consistency is checked by `check-consistency.js` — violations turn CI red and block the PR | ✅ |
| G-45 ABI version management | major/minor/patch triple + a compatibility matrix ("equal major + minor backward compatible") + handling of four change classes + ABI-01~08 conformance; the ABI is frozen in the released state, and introducing unregistered native capabilities at runtime is forbidden | ✅ |
| App version validation | `app.version` in `app.config` must be valid semver — schema validation intercepts it at compile time | ✅ |
| Dependency version alignment | Declared versions between `@proteus-vue/*` packages must exactly equal the actual workspace versions (preventing npm 404s), enforced by the `check:pkg` gate | ✅ |

## Current package version status

The monorepo currently has **38 `@proteus-vue/*` packages**, managed by **changesets**: each package has an independent semver version; changesets derive versions automatically, generate CHANGELOGs, and align exact inter-package dependencies across the workspace. Currently in **beta prerelease mode** (changesets pre mode, tag: beta):

- On 2026-08-31 the first 22 packages were published to npm under the dist-tag `beta`, in dependency order
- Packages added since (render backends, test IR, the docs engine, AI infrastructure, …) ship in changesets batches — whatever is actually visible on npm is authoritative

Current workspace versions, for example (authoritative source: `packages/*/package.json`):

| Package | Version |
|---|---|
| `@proteus-vue/compiler` | 0.3.0-beta.0 |
| `@proteus-vue/cli` | 0.2.1-beta.0 |
| `@proteus-vue/router` / `runtime` / `shared` / `plugin-vite` / `pinia-sync` | 0.2.0-beta.0 |
| `@proteus-vue/create-proteus` | 0.2.0 |
| Most other packages | 0.1.0 |

> **Honest boundary**: during the 0.x beta phase the API may still change. That is exactly why there is no premature compatibility promise — the promise is redeemed at every step by conformance and the versioning mechanisms, not pre-redeemed by slogans.

## Upgrade advice

After upgrading `@proteus-vue/*` dependencies, verify compatibility with the repo's real command chain:

```bash
npm test                              # full unit test run
npm run verify                        # test + both-target builds + workspace build + check:pkg
npm run check:pkg                     # package health gate (dependency-version alignment / exports / files completeness)
npm run proteus -- conformance --repo .   # no-fork repo governance scan
npm run bench                         # performance benchmarks (regression > 5% blocks the merge, G-44.5)
```

Practical criterion: **whether an upgrade is safe = whether the command chain above is all green** — not whether the version-number difference "looks harmless".

## Maintainer view: shipping a release

Releases are constrained by the same mechanisms; the core flow (changesets topological publishing):

```bash
npx changeset                # register a change (patch / minor / major)
npm run changeset:version    # bump versions + generate CHANGELOG + align exact inter-package deps across the workspace
npm install                  # update the lockfile
npm run verify               # all-green gates
npm run changeset:publish    # publish all packages automatically in dependency order
```

Two spots changesets cannot manage need manual version-range syncing: `examples/package.json` and `packages/create-proteus/templates/package.json` (private packages are not managed by changesets). After syncing, the template-snapshot consistency check backstops against drift.

## Not yet finalized

The following has no written-down policy in the repo yet — marked 📋 honestly:

- **npm package-level semver policy document** (the 0.x → 1.0 timeline, deprecation-window lengths, LTS strategy) is not yet written; the "independent semver + automatic changesets derivation + workspace protocol" described by `proteus-build-plan` M7 is the planning-level wording
- The long-term strategy for each package's npm `latest` vs `beta` tags will be finalized together with the stable-release cadence

Until a policy is written down, use **the conformance contracts + the command chain above** as the compatibility criterion.

## Related pages

- [Conformance](/docs/framework/29-conformance): how compatibility contracts are machine-enforced
- [Pluggable architecture](/docs/framework/22-architecture): the SPI layering behind version evolution
