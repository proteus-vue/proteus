---
title: Proteus vs. traditional cross-platform frameworks
order: 2
group: 起步
---

# Proteus vs. traditional cross-platform frameworks

Proteus's primary language is Vue (standard SFC), so the learning curve for front-end developers is low. Its fundamental difference from traditional cross-platform frameworks is **architectural positioning**:

> **Any cross-platform problem = semantic definition (done by the framework) + backend implementation (done by the platform)**

The framework does exactly two things: it defines *what you want* (semantic interfaces / IR) and *how to prove it is correct* (conformance suites / compile-time constraints). The platform supplies *how to do it* (backend implementation). **Business developers only consume semantic interfaces and stay unaware of the backend.**

## Comparison with common cross-platform frameworks

| Dimension | Common cross-platform frameworks | Proteus |
|---|---|---|
| How you write | Platform DSL (`view` / `text`) or locked to one-end syntax | Standard HTML + standard Vue SFC |
| Rendering base | WebView or locked to a single engine | Pluggable; pick an engine per page in the same app |
| AI involvement | No IR — text substitution only | Operates on IR + compile-time enforcement |
| Toolchain | IDE-locked | Pure Vite plugin — runs in any CI |

Plain DSL mapping means "rewrite native code with different syntax"; Proteus means "define semantics, let any backend implement them".

## "Not binding" is one repeated design move

"Not binding" is not a slogan — it is the same design move repeated across every architectural dimension: each layer first defines a semantic contract, then turns its concrete implementation into a pluggable backend — platform APIs, render engines, compilers, container shapes, host runtimes, execution carriers. See the full table in [pluggable architecture](/docs/framework/22-architecture).

## What this means for AI

What competitors lack is not a particular API but "explicit semantics + programmable IR + native backend mapping + enforced validation". An AI agent operates on **IR** — and IR carries compile-time constraints, so AI-generated code is checked by machines, not by convention. See [AI-native development](/docs/32-ai-agent).

## Next steps

- [Try the Playground](/docs/03-playground): live compilation in the browser — watch the IR yourself
- [Semantic model](/docs/framework/11-semantic-model): understand "business code → semantic IR → any backend"
