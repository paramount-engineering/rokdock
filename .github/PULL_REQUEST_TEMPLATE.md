## Summary

<!-- What does this change do and why? -->

## Related issue

<!-- Link the issue this addresses. Example: Fixes #42 -->

## How tested

<!-- Describe how you verified the change works. Did you run `npm run verify`? Did you test manually? -->

`npm run verify` result: passing / failing (delete as appropriate)

If `verify:full` (Playwright E2E) was also run, note the result here.

## Checklist

- [ ] `npm run verify` passes (typecheck + lint + unit/integration tests)
- [ ] Tests added or updated for behavioral changes
- [ ] Exported symbols and files follow naming conventions (PascalCase exports, camelCase files/folders)
- [ ] New UI uses `--rokdock-*` CSS variables and `rokdock-controls` components rather than hardcoded styles
- [ ] Main process does not import renderer component code
