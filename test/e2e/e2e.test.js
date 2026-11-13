'use strict';
/*
 * End-to-end test against a running ioBroker with admin (websocket), history and objectmigrator:
 *   npm run dev:start      (local, see README)   or the CI job "e2e"
 *   npm run test:e2e
 * The test talks to the adapter like the admin tab does: sendTo over the admin websocket.
 * Everything is created below 0_userdata.0.e2e<tag> / alias.0.e2e<tag> and removed at the end.
 */
const { expect } = require('chai');

const URL = process.env.OM_ADMIN_WS || 'ws://127.0.0.1:8081/?sid=e2e&name=admin';
const INSTANCE = process.env.OM_INSTANCE || 'objectmigrator.0';
const HISTORY = process.env.OM_HISTORY || 'history.0';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Minimal client for the admin websocket ([type, id, name, args]) */
function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        const pending = new Map();
        let id = 1;
        const call = (name, ...args) =>
            new Promise((res, rej) => {
                const myId = ++id;
                const timer = setTimeout(() => rej(new Error(`timeout ${name}`)), 600_000);
                pending.set(myId, value => {
                    clearTimeout(timer);
                    res(value);
                });
                ws.send(JSON.stringify([3, myId, name, args]));
            });
        const api = {
            call,
            /** sendTo to the migrator, unpacks { ok, data } */
            async om(command, message = {}) {
                const [answer] = await call('sendTo', INSTANCE, command, message);
                if (!answer?.ok) {
                    throw new Error(`${command}: ${JSON.stringify(answer?.error)}`);
                }
                return answer.data;
            },
            async history(command, message) {
                const [answer] = await call('sendTo', HISTORY, command, message);
                return answer;
            },
            close: () => ws.close(),
        };
        ws.onmessage = ev => {
            const [type, msgId, name, args] = JSON.parse(ev.data);
            if (type === 1) {
                ws.send(JSON.stringify([2]));
            } else if (type === 0 && name === '___ready___') {
                resolve(api);
            } else if (type === 3 && pending.has(msgId)) {
                pending.get(msgId)(args ?? []);
                pending.delete(msgId);
            }
        };
        ws.onerror = () => reject(new Error(`websocket error - is ioBroker running at ${URL}?`));
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('e2e: objectmigrator with the real history adapter', function () {
    this.timeout(900_000);
    const tag = `e2e${Date.now().toString(36)}`;
    const SRC = `0_userdata.0.${tag}`;
    const OLD = `${SRC}.alt.temp`;
    const NEW = `${SRC}.neu.temp`;
    const DENSE = `${SRC}.dense.value`;
    const BASE = `alias.0.${tag}`;
    const TARGET = `${BASE}.temp`;
    const DENSE_TARGET = `${BASE}.dense`;
    let io;
    let newStart;
    let oldValues;
    let newValues;
    const runIds = [];

    const stateObject = (name, extra = {}) => ({
        type: 'state',
        common: {
            name,
            type: 'number',
            role: 'value.temperature',
            unit: '°C',
            read: true,
            write: false,
            custom: { [HISTORY]: { enabled: true, changesOnly: true, debounceTime: 0, retention: 0, maxLength: 960 } },
            ...extra,
        },
        native: {},
    });

    /** "Schreiben" and wait for the end of the run */
    async function write(plan) {
        const res = await io.om('plan.write', plan);
        expect(res.runId, JSON.stringify(res.check?.errors)).to.be.a('string');
        runIds.push(res.runId);
        for (let i = 0; i < 600; i++) {
            const run = await io.om('run.status', { runId: res.runId });
            if (run && run.status !== 'running') {
                return run;
            }
            await sleep(1000);
        }
        throw new Error('run did not finish');
    }

    async function values(id) {
        const all = [];
        for (let offset = 0; ;) {
            const r = await io.history('getRawEntries', {
                id,
                start: 0,
                end: Date.now() + DAY,
                sort: 'asc',
                limit: 5000,
                offset,
                noTotal: true,
            });
            const page = r?.result ?? [];
            if (!page.length) {
                return all.filter(v => v.val !== null);
            }
            all.push(...page);
            offset += page.length;
        }
    }

    before(async () => {
        io = await connect();
        const status = await io.om('history.status');
        expect(status.alive, `${HISTORY} must run`).to.equal(true);
        await io.call('setObject', OLD, stateObject('Temperatur alt'));
        await io.call('setObject', NEW, stateObject('Temperatur neu'));
        await io.call('setObject', DENSE, stateObject('dicht', { unit: 'W' }));
        await sleep(1500);
        const now = Date.now();
        const start = now - 10 * DAY;
        // old source 9 days hourly, new source the last 2 days, 2 hours overlap
        oldValues = Array.from({ length: 9 * 24 }, (_, i) => ({ ts: start + i * HOUR, val: 20 + i / 10, ack: true }));
        newStart = start + (9 * 24 - 2) * HOUR;
        newValues = Array.from({ length: 48 }, (_, i) => ({ ts: newStart + i * HOUR, val: 50 + i, ack: true }));
        // more than 2000 values on one day (history 5.2 returns at most 2000 per page)
        const denseStart = now - 2 * DAY;
        const dense = Array.from({ length: 2500 }, (_, i) => ({ ts: denseStart + i * 20_000, val: i, ack: true }));
        expect((await io.history('storeState', { id: OLD, state: oldValues })).error).to.equal(undefined);
        expect((await io.history('storeState', { id: NEW, state: newValues })).error).to.equal(undefined);
        expect((await io.history('storeState', { id: DENSE, state: dense })).error).to.equal(undefined);
    });

    after(async () => {
        if (!io) {
            return;
        }
        for (const id of [OLD, NEW, DENSE, `${SRC}.alt`, `${SRC}.neu`, `${SRC}.dense`, SRC, `script.js.${tag}`]) {
            await io.call('delObject', id).catch(() => undefined);
        }
        io.close();
    });

    it('create mode mirrors the source below the base path', async () => {
        const mirror = await io.om('mirror.preview', { sourceRoot: `${SRC}.alt`, basePath: BASE });
        expect(mirror.errors).to.deep.equal([]);
        const draft = mirror.drafts.find(d => d.id === TARGET);
        expect(draft.common.alias.id).to.equal(OLD);
    });

    it('rejects formulas that do more than computing with val (also the bypasses of the security review)', async () => {
        const payloads = [
            'process.exit(1)',
            'val["constructor"]["constructor"]("return process.exit(1)")()',
            '\\u0070rocess.exit(1)',
        ];
        for (const read of payloads) {
            const check = await io.om('plan.check', {
                tasks: [
                    {
                        target: TARGET,
                        sources: [{ id: OLD, converter: { type: 'expression', read } }],
                        overlap: { type: 'all' },
                    },
                ],
            });
            expect(check.ok, read).to.equal(false);
            expect(
                check.errors.map(e => e.code),
                read,
            ).to.include('invalidExpression');
        }
    });

    it('migrates two sources into one alias (switch rule), values above 2000 per day, conversion', async () => {
        const mirror = await io.om('mirror.preview', { sourceRoot: `${SRC}.alt`, basePath: BASE });
        const drafts = [
            ...mirror.drafts,
            {
                id: DENSE_TARGET,
                type: 'state',
                common: {
                    name: 'dicht',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    alias: { id: DENSE },
                },
                native: {},
            },
        ];
        const plan = {
            drafts,
            mappings: [{ sourceId: OLD, targetId: TARGET }],
            tasks: [
                {
                    target: TARGET,
                    sources: [
                        { id: OLD, priority: 0 },
                        { id: NEW, priority: 1 },
                    ],
                    overlap: { type: 'switch' },
                },
                // W → kW: the history is converted with the alias read formula
                {
                    target: DENSE_TARGET,
                    sources: [{ id: DENSE, converter: { type: 'expression', read: 'Number(val) / 1000' } }],
                    overlap: { type: 'all' },
                },
            ],
        };
        const check = await io.om('plan.check', plan);
        expect(check.ok, JSON.stringify(check.errors)).to.equal(true);
        const run = await write(plan);
        expect(run.status, run.error).to.equal('done');

        const target = await values(TARGET);
        const ts = target.map(v => v.ts);
        expect(new Set(ts).size).to.equal(ts.length, 'no duplicate timestamps');
        // switch: the old source until the new one starts, then only the new one
        expect(target.length).to.equal(9 * 24 - 2 + 48);
        expect(target.find(v => v.ts === newStart).val).to.equal(50);
        expect(target[0].ts).to.equal(oldValues[0].ts);

        const dense = await values(DENSE_TARGET);
        expect(dense.length).to.equal(2500);
        expect(dense[2499].val).to.be.closeTo(2.499, 1e-9);

        // the sources are unchanged
        expect((await values(OLD)).length).to.equal(oldValues.length);
        const oldObj = (await io.call('getObject', OLD))[1];
        expect(oldObj.common.custom[HISTORY].enabled).to.equal(true, 'nothing changes at the source by default');
    });

    it('writing the same plan again writes nothing', async () => {
        const plan = {
            tasks: [
                {
                    target: TARGET,
                    sources: [
                        { id: OLD, priority: 0 },
                        { id: NEW, priority: 1 },
                    ],
                    overlap: { type: 'switch' },
                },
            ],
        };
        const run = await write(plan);
        expect(run.results[0].stats.written).to.equal(0);
        expect(run.results[0].stats.skippedExisting).to.be.greaterThan(0);
    });

    it('bug 1+2: an existing alias is remapped and an old read formula is removed', async () => {
        // the alias gets a formula first …
        await write({ aliases: [{ targetId: TARGET, alias: { id: OLD, read: 'val * 10' } }] });
        let obj = (await io.call('getObject', TARGET))[1];
        expect(obj.common.alias).to.deep.equal({ id: OLD, read: 'val * 10' });
        // … then it is remapped to the new adapter without conversion
        await write({ aliases: [{ targetId: TARGET, alias: { id: NEW } }] });
        obj = (await io.call('getObject', TARGET))[1];
        expect(obj.common.alias).to.deep.equal({ id: NEW });
    });

    it('finds the old ID in a script (references)', async () => {
        await io.call('setObject', `script.js.${tag}`, {
            type: 'script',
            common: {
                name: tag,
                engineType: 'Javascript/js',
                source: `on('${OLD}', obj => log(obj.state.val));`,
                enabled: false,
            },
            native: {},
        });
        const refs = await io.om('refs.find', { ids: [OLD, NEW] });
        expect(refs[OLD].map(r => r.kind)).to.include('script');
        expect(refs[NEW].filter(r => r.kind === 'script')).to.deep.equal([]);
    });

    it('lists the runs and rolls the first one back', async () => {
        const runs = await io.om('run.list');
        for (const id of runIds) {
            expect(runs.map(r => r.id)).to.include(id);
        }
        const first = runIds[0];
        const preview = await io.om('run.rollbackPlan', { runId: first });
        expect(preview.delete).to.include(TARGET);
        expect(preview.removeHistory.map(h => h.target)).to.include.members([TARGET, DENSE_TARGET]);

        await io.om('run.rollback', { runId: first });
        expect((await io.call('getObject', TARGET))[1]).to.equal(null);
        expect((await io.call('getObject', BASE))[1]).to.equal(null);
        // the history of the new targets is removed, the sources are untouched
        expect((await values(DENSE_TARGET)).length).to.equal(0);
        expect((await values(OLD)).length).to.equal(oldValues.length);
        expect((await values(NEW)).length).to.equal(newValues.length);
        const run = await io.om('run.status', { runId: first });
        expect(run.status).to.equal('rolledBack');
        // a second rollback is refused
        const [answer] = await io.call('sendTo', INSTANCE, 'run.rollback', { runId: first });
        expect(answer.ok).to.equal(false);
    });

    it('"Abbruch" stops the run and rolls it back, the log tells what happened', async () => {
        const target = `${BASE}.abort`;
        const plan = {
            drafts: [
                { id: BASE, type: 'folder', common: { name: tag }, native: {} },
                {
                    id: target,
                    type: 'state',
                    common: {
                        name: 'abort',
                        type: 'number',
                        role: 'value',
                        read: true,
                        write: false,
                        alias: { id: OLD },
                    },
                    native: {},
                },
            ],
            tasks: [{ target, sources: [{ id: OLD }], overlap: { type: 'all' } }],
        };
        const res = await io.om('plan.write', plan);
        expect(res.runId).to.be.a('string');
        await io.om('run.abort');
        let run;
        for (let i = 0; i < 120; i++) {
            run = await io.om('run.status', { runId: res.runId });
            if (run.status === 'rolledBack') {
                break;
            }
            await sleep(500);
        }
        expect(run.status).to.equal('rolledBack');
        expect((await io.call('getObject', target))[1]).to.equal(null);
        expect(await values(target)).to.deep.equal([]);
        const codes = run.log.map(l => l.msg.code);
        expect(codes[0]).to.equal('logStart');
        expect(codes).to.include.members(['logAbort', 'logRolledBack']);
        expect(codes).to.not.include('logDone');
    });

    it('a new alias value without a source is created without alias.id, the rollback removes it (EM-12)', async () => {
        const base = `${BASE}_nosource`;
        const id = `${base}.sollwert`;
        const plan = {
            drafts: [
                { id: base, type: 'device', common: { name: 'ohne Quelle' }, native: {} },
                {
                    id,
                    type: 'state',
                    common: { name: 'Sollwert', type: 'number', role: 'level', unit: '°C', read: true, write: true },
                    native: {},
                },
            ],
        };
        // a warning, not an error
        const check = await io.om('plan.check', plan);
        expect(check.ok, JSON.stringify(check.errors)).to.equal(true);
        expect(check.warnings.map(w => `${w.code}|${w.id}`)).to.include(`draftNoSource|${id}`);
        const run = await write(plan);
        expect(run.status).to.equal('done');
        const [, obj] = await io.call('getObject', id);
        expect(obj.type).to.equal('state');
        expect(obj.common.unit).to.equal('°C');
        expect(obj.common.alias).to.equal(undefined);
        await io.om('run.rollback', { runId: run.id });
        expect((await io.call('getObject', id))[1]).to.equal(null);
        expect((await io.call('getObject', base))[1]).to.equal(null);
    });

    it('rejects run IDs that would leave the runs folder', async () => {
        const [answer] = await io.call('sendTo', INSTANCE, 'run.status', { runId: '../plans/current' });
        expect(answer.ok).to.equal(false);
    });
});
