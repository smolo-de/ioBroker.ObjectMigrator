# Security check

Date: 2026-11-13 · Version 0.0.1 · Scope: adapter backend (`src/`), admin tab (`src-admin/`), dependencies, CI.

## 1. What the adapter can do (attack surface)

The migrator changes objects of **all** adapters: it creates aliases, writes `common.custom` settings,
`common.alias`, room/function memberships, and adds history values through the history adapter. It
is controlled only through messages (`sendTo`) from the admin tab. Everything an attacker could reach
therefore goes through `onMessage` in `src/main.ts`.

| Entry | Protection |
|---|---|
| `sendTo` from other adapters/scripts | **Rejected** – only `system.adapter.admin.N` may send (`src/lib/access.ts`) |
| Admin websocket | Login and permissions of the admin (the user needs the `sendto` permission) |
| Object IDs in a plan | Checked: no wildcards, no forbidden characters, ≥ 2 parts, ≤ 500 chars (`isValidId`) |
| Base path of the create mode | Must be below `alias.0` (`validateBasePath`) |
| Run IDs (report, rollback) | Must match `run-<ISO time>Z` – no path traversal (`isRunId`) |
| Plan/template names | Reduced to letters, digits, `. _ -` and spaces (`safeName`) |
| Formulas (conversion, `alias.read/write`) | Expressions with `val` only, see §2 |
| Stored plans (JSON) | `__proto__`/`constructor`/`prototype` keys are ignored when merging (`deepMerge`) |
| Commands | Lookup with `Object.hasOwn` – no access to inherited properties |
| History reads | At most 2000 IDs per request, points of the preview limited to 10…5000 |

## 2. Formulas (the main risk)

The history of a source is converted with the **same** read formula that becomes `alias.read`.
This conversion runs in the adapter, and the preview runs it in the browser. A formula is **never
executed as JavaScript** (no `eval`, no `new Function`). It is parsed by a small allow-list
interpreter (`src/lib/alias/expression.ts`) and evaluated node by node:

- literals (numbers, texts, `true`, `false`, `null`, `undefined`), `val`, parameters of arrow
  functions `(a, b) => …`;
- operators `+ - * / % ! typeof === !== == != < > <= >= && || ?? ? :`;
- calls of `Number`, `String`, `Boolean`, `parseFloat`, `parseInt`, `isNaN`, `isFinite`,
  `Math.round/floor/ceil/trunc/abs/sign/sqrt/min/max/pow`;
- methods from an allow list on texts (`replace`, `toLowerCase`, `includes`, …), numbers
  (`toFixed`, `toPrecision`) and lists (`includes`, `indexOf`, `join`, `slice`), with values as
  arguments only (no function of the formula is handed to native code);
- `[…]` only on a table `{…}` or list `[…]` written in the formula itself; a table has no
  prototype and only its own entries are found.

Everything else fails while parsing: names other than the ones above, unicode escapes or other
characters in names, statements, assignments, `this`, `new`, template strings, regular
expressions, `[…]` on other values (`val["constructor"]`). Calls of arrow functions are limited
(nesting 64, 10,000 per evaluation). The allowed subset has the same meaning in JavaScript (unit test
compares all generated formulas with JavaScript), so a checked formula can also be stored as
`alias.read/write`, where js-controller evaluates it.

The formulas of the simple conversions are built from the converter (07 §2, `converter.ts`): texts and
tables go in as JSON with `<`, `>`, `/`, U+2028 and U+2029 escaped, factor, offset and decimals only as
finite numbers - anything else is ignored. The result is checked like any other formula.

**Security review 2026-11-13 – finding fixed:** the first version used a deny list of words
(checked with the texts in quotes removed) before `new Function`. It could be bypassed with
property names as text (`val["constructor"]["constructor"]("…")()`), unicode escapes
(`process`) and a regular expression that confused the quote handling. The result was code
execution in the adapter process for a user who may send messages through the admin. Before this
release the formulas were not checked at all. Replaced by the interpreter above; the payloads are
regression tests in `src/lib/security.test.ts`.

The admin tab evaluates the expressions of the adapters' `jsonCustom.json` (hidden/disabled/
defaultFunc) in the browser like the admin itself does – these come from the installed adapters,
not from the user.

## 3. Data safety (history)

- Source data is only **read**. Values are only **added** to targets (`storeState`), values with an
  existing timestamp are skipped – writing a plan again writes nothing twice.
- Nothing changes at the source by default (D-17).
- Before every run the touched objects are backed up (`backups/<run>.json`, only the relevant
  rooms/functions). The rollback restores them, deletes created objects and removes written history
  **only** where the target had no values in that range before (it can not separate them otherwise).
- Before "Schreiben" the history ranges are read fresh (no cache), the rollback relies on them.
- Retention of the target that would delete migrated values blocks "Schreiben".

## 4. Admin tab

- React escapes all output; no `dangerouslySetInnerHTML`.
- Two open tabs can not overwrite each other's plan unnoticed (version check, conflict dialog).
- `localStorage` only for per-browser conveniences (language, column widths).

## 5. Dependencies (`npm audit`, 2026-11-13)

| Scope | Result |
|---|---|
| Runtime (`--omit=dev`, only `@iobroker/adapter-core`) | **0 vulnerabilities** |
| Development tools | 0 critical, 0 high, 15 moderate (build/test tooling of the ioBroker template: `@iobroker/adapter-dev`, `@iobroker/testing`, `nyc`) – not part of the package |

`@iobroker/dev-server` was removed from the dev dependencies: it brought 2 critical (`request`,
`xmldom`) and 1 high (`serialize-javascript`) finding and is only needed once to create the local
test system (`npx @iobroker/dev-server@0.8 setup`). The suggested `npm audit fix --force` would
downgrade the template tools by a major version – not done.

The admin tab is bundled by Vite; React, MUI and echarts are dev dependencies and end up only in
`admin/build/`.

## 6. CI

- `npm audit --omit=dev --audit-level=high` in the workflow "Test and Release".
- Workflow "CodeQL security analysis" (`security-extended` queries).
- Both run on every push to `main` and on pull requests, CodeQL also weekly.
- Workflows have `contents: read` by default; only the release job may write.

## 7. Open points

- `createObjects` writes drafts below `alias.0` with the `common` of the plan - a user who may
  send messages through the admin can create alias objects (same as with the admin object editor).
- The rollback restores whole objects – changes made after the run are lost (shown in the dialog).
