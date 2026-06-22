# semver-discipline

Flag PRs that introduce a breaking API change without bumping the major version in `package.json` (or equivalent version manifest). Consumers pinned to the current `^x.y.z` range will receive the breaking change silently on their next install.

## Rules

| Change type | Required bump |
|---|---|
| Breaking change (route removed, field removed, type changed, required param added) | **major** (x+1.0.0) |
| New route, new optional field, new optional param | minor (x.y+1.0) |
| Bug fix, internal refactor with no contract change | patch (x.y.z+1) |

## Good Example

```diff
// Breaking: POST /orders now requires `currency` field.
// Version correctly bumped from 1.4.2 → 2.0.0
- "version": "1.4.2"
+ "version": "2.0.0"
```

## Bad Example

```diff
// Breaking: GET /users/:id field `email` removed from response.
// Version bumped as patch — WRONG. Consumers on ^1.4.2 will receive this.
- "version": "1.4.2"
+ "version": "1.4.3"
```

```diff
// Breaking change but version unchanged — not bumped at all.
- router.delete('/v1/users/:id', handler)
// version: "1.4.2" (unchanged)
```

Flag as WARNING when no breaking change is detected but the bump level looks suspicious. Flag as CRITICAL when a confirmed breaking change is present but the major version is not bumped.
