# breaking-change

Flag any change that removes a previously-available public endpoint, renames a path parameter, changes an HTTP method, or adds a new **required** request parameter to an existing route — all of which break existing callers without a prior deprecation window.

A breaking change is present whenever a caller that was correct before the PR would stop working after it merges, with no opt-in migration path.

## Good Example

```diff
// Adding an OPTIONAL query parameter — additive, non-breaking.
- GET /users/:id
+ GET /users/:id?include_deleted=boolean   // new param is optional; old callers still work
```

New optional parameters, new optional response fields, and new routes are all safe additions.

## Bad Example

```diff
// Renaming a path parameter — all callers hardcoded to /users/:userId now 404.
- router.get('/users/:userId', handler)
+ router.get('/users/:accountId', handler)
```

```diff
// Removing a route with no deprecation notice.
- app.get('/v1/orders/:id', getOrder)
```

Both examples silently break every existing consumer. Flag these as CRITICAL findings and suggest:
1. Keep the old route alive (proxy to new if needed).
2. Bump the major version.
3. Publish a deprecation notice pointing to the replacement.
