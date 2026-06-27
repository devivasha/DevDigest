# deprecation-policy

Flag silent removal of API surface — routes, fields, or parameters — without a preceding deprecation marker and migration window. Consumers have no signal that the API is going away and discover the removal only through runtime failures.

The correct pattern is: **mark deprecated → keep alive for one major version → remove in the next major**.

## Good Example

```typescript
/**
 * @deprecated Use GET /v2/users/:id instead. Will be removed in v3.0.
 */
app.get('/v1/users/:id', async (req, reply) => {
  reply.header('X-Deprecated', 'Use /v2/users/:id');
  reply.header('Sunset', 'Sat, 01 Jan 2026 00:00:00 GMT');
  return legacyGetUser(req.params.id);
});
```

Keeps old consumers working, gives them a clear signal (`X-Deprecated`, `Sunset` headers, JSDoc), and points to the replacement.

## Bad Example

```diff
// Route silently deleted. Callers receive 404 with no prior warning.
- app.get('/v1/users/:id', getUser)
```

```diff
// Field silently removed from response.
- type UserResponse = { id: string; name: string; legacyRole: string };
+ type UserResponse = { id: string; name: string };
```

Flag all silent removals as CRITICAL. Suggest:
1. Restore the removed surface.
2. Add `@deprecated` JSDoc and `X-Deprecated` / `Sunset` response headers.
3. Reference the replacement endpoint/field.
4. Schedule hard removal for the next major version milestone.
