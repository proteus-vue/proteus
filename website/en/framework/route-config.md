---
title: The `<route>` config reference
order: 10
group: 编译期
---

# The `<route>` config reference

The sole entry point of page-level configuration. `gen-routes` reads it at compile time, and the dual-target artifacts are generated automatically. **An explicit declaration always wins over derivation.**

## Full structure

```vue
<route>
{
  "name": "user-profile",
  "path": "pages/user/profile",
  "parent": "pages/user",
  "meta": {
    "title": "Profile",
    "isTab": true,
    "requiresAuth": true,
    "permissions": ["order:read"],
    "transition": "slideUp"
  }
}
</route>
```

## The full set of meta fields

The contract is defined in `@proteus-vue/contracts` (`RouteMeta`):

| Field | Type | Output |
|---|---|---|
| `title` | string | MP navigation bar title / Web page title |
| `isTab` | boolean | tab page (folded into the tabBar declaration) |
| `requiresAuth` | boolean | login guard (the createRouter auth checker) |
| `permissions` | string[] | permission guard (`resource:action`, the permissions checker) |
| `transition` | `'slideUp' or 'slideDown' or 'halfScreen' or 'scaleDown' or 'none'` | MP `routeType` transition (Skyline custom routing) |
| Arbitrary extension | JSON-serializable | kept in meta (the centralized-config merge artifact) |

## Top-level fields

| Field | Description |
|---|---|
| `name` | named route (kebab-case); derived from the file location when omitted |
| `path` | page path; derived from the directory when omitted (`pages/user/profile.vue` → `pages/user/profile`) |
| `parent` | explicit nesting parent (derived from the path prefix by default; under Skyline MPA nesting degrades to flattening, with `meta.__parent` preserving the parent chain) |
| `meta` | the meta fields in the table above |

## Route records (generated artifacts)

Each `RouteRecord` (generated, do not hand-edit) contains `name` / `path` / `component` / `parent` / `meta` / `subPackage` (undefined in the main package) / `customRouteKeyName` / `params` (the route-param type declaration).

## Subpackages

`proteus.config.ts` declares `subPackages` (name + root), and every subpackage is **scanned and tree-derived independently — no nesting across subpackages**; subpackage dependencies (`dependencies`) and `preloadRule` are generated automatically by matching chunk and name/root base names.

## Next steps

- [Compile rules & decision chain](/docs/framework/compile-rules)
