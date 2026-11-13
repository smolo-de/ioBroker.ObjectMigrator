![Logo](admin/objectmigrator.png)
# ioBroker.objectmigrator

[![NPM version](https://img.shields.io/npm/v/iobroker.objectmigrator.svg)](https://www.npmjs.com/package/iobroker.objectmigrator)
[![Downloads](https://img.shields.io/npm/dm/iobroker.objectmigrator.svg)](https://www.npmjs.com/package/iobroker.objectmigrator)
![Number of Installations](https://iobroker.live/badges/objectmigrator-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/objectmigrator-stable.svg)

**Tests:** ![Test and Release](https://github.com/smolo-de/ioBroker.objectmigrator/workflows/Test%20and%20Release/badge.svg)

## Object migrator adapter for ioBroker

Migrates **history values** and **object settings** from the objects of one adapter to **alias
objects** or to the objects of another adapter. The typical case: a device is delivered by a new
adapter from now on. The alias should contain both histories without a gap, and all settings
(history, lovelace, telegram, influxdb, …) should be kept.

**Priorities:** 1. the history stays complete, 2. simple handling. General alias editing is done by
[ioBroker.alias-manager](https://github.com/iobroker-community-adapters/ioBroker.alias-manager) –
this adapter is for the **migration**.

> Status: **in development** – not for production use yet.
>
> The adapter changes objects and writes history data. **Make a full backup before the first
> "Write".** Use at your own risk and without warranty – see [Disclaimer](#disclaimer).
>
> German user guide: [docs/de/README.md](docs/de/README.md)

### Features

- **Mapping editor** (admin tab): two object trees, links by drag & drop shown as lines, adapter
  icons per state, create mode that mirrors a structure below a base path, templates.
- **History migration** through the history adapter (≥ 5.2.0): read → merge → `storeState` into the
  target. Several sources per target (overlap rules: switch, all, prefer, cut), conversion with the
  same formula as `alias.read`, values with an existing timestamp are skipped – writing again never
  writes twice.
- **Settings** of all adapters (`common.custom`), smartName, rooms/functions – with the adapters' own
  forms (`jsonCustom`) to change them per state.
- **Nothing is written before "Write"** – "Check" shows everything first. Nothing changes at the
  source by default.
- **History of runs with rollback**, **references** (where old IDs are used in scripts, VIS,
  lovelace, adapter configurations).

### Usage

Admin → tab **"Object Migrator"**:

1. Left: choose the root of the source (adapter instance or any node).
2. Right: **Create mode** → base path (e.g. `alias.0.devices.thermostat`) → **Mirror**.
3. Link the new adapter: drag a node onto a node (matched by path/name) or a state onto a state.
4. Adjust on the right (rename, remove, conversion, settings), preview the history (📈).
5. **Check** → **Write**. Every run can be rolled back in **History of runs**.

### Requirements

- js-controller ≥ 6.0.11, admin ≥ 7.6.20, Node.js ≥ 22
- history ≥ 5.2.0 for the history migration (one instance, chosen in the instance settings)

## Documentation

| File | Content |
|---|---|
| [docs/de/README.md](docs/de/README.md) | User guide (German) |
| [docs/security.md](docs/security.md) | Security check: attack surface, formula rules, dependencies |
| [docs/requirements/](docs/requirements/README.md) | Requirements (German): use cases, settings and history migration, alias model, UI, architecture, non-functional requirements, decisions |

## Development

| Command | Purpose |
|---|---|
| `npm run build` | Backend (TypeScript) and admin tab |
| `npm run build:tab` | Admin tab only (`src-admin/` → `admin/tab.html`, Vite) |
| `npm run check` | Type check (backend and tab) |
| `npm run lint` | ESLint (`@iobroker/eslint-config`) |
| `npm run test:ts` | Unit tests (`src/**/*.test.ts`, `src-admin/src/**/*.test.ts`) |
| `npm run test:package` / `test:integration` | package files / adapter start with js-controller |
| `npm run test:e2e` | End-to-end test against a running ioBroker with history (see below) |
| `npm run dev:start` | Start the local test ioBroker (admin: http://127.0.0.1:8081) |
| `npm run dev:deploy` | Build, copy into the local ioBroker, restart the instance |

Local test system (once): `npx @iobroker/dev-server@0.8 setup`, then in `.dev-server/default`:
`npm install iobroker.history@5.2.0` and `node node_modules/iobroker.js-controller/iobroker.js add history`.
Remove `iobroker.objectmigrator` from `.dev-server/default/package.json` – `npm run dev:deploy`
copies the adapter (a symlink is not found by js-controller, and npm would replace the copy).
`dev-server watch` does not work on Windows 11 (it calls the removed `wmic.exe`).

`test/e2e/dbnames.test.js` (part of `npm run test:e2e`) sets, resolves and rolls back the DB name
(`aliasId`) of a throw-away state with moving its values. Run the end-to-end tests on a throw-away
instance (`OM_INSTANCE=objectmigrator.N`) to keep their runs out of the history of the instance you
work with.

**CI:** "Test and Release" (check, lint, `npm audit`, unit/integration tests, end-to-end test with
js-controller, admin and history; release on a version tag) runs on every push to `main` and on pull
requests. "CodeQL security analysis" runs on pushes, pull requests and weekly. Dependabot proposes
updates once a month; merging them automatically is off (needs the secret `AUTO_MERGE_TOKEN`, see
`.github/workflows/dependabot-auto-merge.yml`).

## Disclaimer

- The adapter changes objects and their settings and writes history data in your ioBroker
  installation. **Make a full backup before the first "Write"** (e.g. with BackItUp, including the
  data of the history adapter).
- **No warranty:** the software is provided "as is", without warranty of any kind, express or
  implied, including but not limited to the warranties of merchantability, fitness for a particular
  purpose and non-infringement.
- **No liability:** you use it at your own risk. To the extent permitted by law, the authors are not
  liable for any damage, in particular loss of data (objects, settings, history values) or downtime.
  Liability that cannot be excluded by law (e.g. for intent or gross negligence) remains unaffected.
- The [MIT License](LICENSE) applies.
- This personal project is developed in spare time and has no business goal; it is not an official
  ioBroker project. All product and company names or logos are trademarks™ or registered® trademarks
  of their respective holders. Use of them does not imply any affiliation with or endorsement by them.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (smolo-de) initial release

## License
MIT License

Copyright (c) 2026 smolo-de

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
