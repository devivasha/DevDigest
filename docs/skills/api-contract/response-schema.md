# response-schema

Flag changes to the shape of an API response body: removed fields, renamed fields, type changes (e.g. `string` → `number`), or fields changing from optional to required. Consumers that destructure or validate the response will silently break or throw at runtime.

Adding a new **optional** field is safe. Everything else requires a major version bump.

## Good Example

```diff
// Adding a new optional field — safe; old consumers simply ignore it.
- return { id, name, email }
+ return { id, name, email, avatar_url: user.avatarUrl ?? null }
```

## Bad Example

```diff
// Removing a field — any consumer accessing .email now gets undefined.
- return { id, name, email }
+ return { id, name }
```

```diff
// Renaming a field — callers referencing .userId now get undefined.
- return { userId: user.id, name: user.name }
+ return { accountId: user.id, name: user.name }
```

```diff
// Type widening from number to string — callers doing arithmetic will break.
- return { score: 91 }         // number
+ return { score: "91/100" }   // string
```

Flag any of the above as CRITICAL. Suggest:
- Keep the old field alongside the new one (dual-emit) for a transitional major.
- Use an explicit deprecation marker on the old field.
- Document the migration path in the PR description.
