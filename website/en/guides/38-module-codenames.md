---
title: Module Codenames
order: 38
group: 架构与工程
---

# Module Codenames

The framework has dozens of packages and more than a dozen subsystems. When naming them we did not reach for `core` / `utils` / `engine-v2`. We reached for **the names of Greek and Roman gods** — because **a god's domain is the module's responsibility**.

This is not just a naming scheme. It is the **constraint mechanism** we use when organizing code: a name has to state what the module does inside the framework, and if it cannot, the responsibility probably was not clear to begin with.

## How "a god's domain is the responsibility" works

The method is direct: **locate the module's responsibility first, then find a deity whose domain matches it**.

| Module responsibility | Chosen domain | Why it fits |
|---|---|---|
| The framework itself — one source transformed into many forms | **Proteus**, the sea god who shifts shape | "Ever-changing" is exactly what cross-platform means |
| Two-way reuse between native assets and JavaScript | **Janus**, the Roman two-faced gatekeeper | One face toward native, one toward JS — literally a two-way gate |
| Stress-testing touch interaction to its limit | **Dactyl**, the Δάκτυλοι "finger clan" | Treats touch as a first-class citizen worth taking seriously |

The benefit is that **the name carries a one-line description**: a newcomer seeing `Janus` does not need to look up what the package does first — the domain already explains it.

## Three rules

Whether a name is good is held up by three hard rules, not by good intentions.

### Only mythological names

The pantheon **admits mythological names only** (gods, Titans, primordial deities, Muses, mythological figures; mythological creatures are allowed with a note). It does **not** admit common nouns, material names, architectural terms, or technical jargon.

> This rule exists because we **tripped over it first**: the first draft of the liquid-glass component library used `Hyaleos` / `Krystallos` (the Greek words for "glass / crystal"). The names were apt, but they are **common material nouns**, which broke the "divine name" axis. They were renamed to **Aether** (a primordial deity, the clear upper air — the medium of light), which keeps the axis and still expresses "a translucent shell that catches light".

### One name, one module

Once a name is registered it belongs to that module; if a candidate is claimed elsewhere, it must be dropped.

> Example: `Argus` (the hundred-eyed giant, a natural fit for "monitoring / traversal") was once a candidate for the memory-safety module, but because it was already registered as a candidate by another module, it **went to the memory module and was removed from the other's shortlist**. Better to change a name than to have two modules share one association.

### Trademark and package-name search before naming

Every codename gets a **trademark** and **package-name** search before it is formally adopted. **A codename that has not passed the search must not be used externally** — internal use is fine, but external copy always uses the functional description.

## Honest boundary: names we rejected

Some divine names fit their domains beautifully, and we still dropped them — because they are **already well-known projects outside**, and using them would make us unfindable:

| Rejected codename | Reason |
|---|---|
| **Iris** | Overlaps with a Rust + Vue3 animation engine in the same domain |
| **Athena** | Strongly claimed by AWS Athena |
| **Theia** | Eclipse Theia (an IDE framework), adjacent domain |
| **Eos** | EOS blockchain / EOS cameras |
| **Metis** | An existing JS framework |
| **Hermes** | The Hermes JS engine (React Native's default) |
| **Nike** | Strongly claimed as a trademark |

Better to pick another name than to make users run into someone else first when they search for us. This boundary lives in our internal spec and belongs here too — **restraint in naming is part of restraint in product**.

Two more we excluded on purpose:
- Very short generic words such as `Logos` / `Eos` — search is unreliable and they cannot be located
- `Harmonia`, which sounds like **HarmonyOS** — fatal confusion in the HarmonyOS context

## Current state of public disclosure

Only **three codenames have completed trademark and package-name search and may be used externally**:

| Codename | Module |
|---|---|
| **Proteus** | The framework itself |
| **Janus** | Native asset reuse and a unified development experience |
| **Dactyl** | Interactive visual stress-testing and performance acceptance |

Every other internal subsystem **uses a functional description** in external documentation ("declarative animation engine", "multi-platform CSS engine", "OS-level component library", …) and does not disclose a codename. The codename appears only once its search completes and its state becomes "named".

> You may occasionally see a stray codename in the docs ahead of time — that is residue from our consolidation and will be cleaned up or promoted. **Until we explicitly say a codename is "named", treat the functional description as the source of truth.**

Two of them need a separate note, because they are not "residue": they are **already in use as public product names while their search is still incomplete**:

- The **animation engine** codename appears in the titles of the [animation section](/docs/animation/00-overview) (which has its own product page)
- The **glass system-shell library** codename appears in the [liquid glass guide](/docs/31-liquid-glass) (that library is **still planned, not shipped**)

These two are places where "consistency in public copy" and "search not yet complete" have not been reconciled — **by our own rule they should have completed the search before going public**. We are flagging them honestly rather than pretending they are not there.

## Why this is worth writing down

Because the problem it solves is general: **when a system has dozens of parts, naming is the cheapest and most neglected part of the design**.

- Naming things `core` / `common` / `utils` is an admission that the responsibility boundary was never thought through
- Naming things after business abbreviations means every newcomer needs a lookup table
- Naming by "a god's domain is the responsibility" makes the name itself a one-line description — **and reminds you once a year what the module is actually for**

This is the whole Proteus methodology in miniature: **define the semantics first, then let implementations adapt to it** — naming here, layout there, capability access everywhere.

## Further reading

- [Proteus versus traditional cross-platform frameworks](/docs/02-difference) — the full account of our architectural stance
- [Pluggable architecture](/docs/framework/22-architecture) — how "not bound to anything" lands in each layer
- [Focus navigation engine](/docs/system/10-focus-navigation) — how one module's semantics were abstracted into a cross-platform primitive
