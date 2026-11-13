'use strict';
/*
 * UC-7b: DB names (aliasId) of the history instance - set, resolve, move the values, rollback.
 * Runs against a running ioBroker with history.0 (like e2e.test.js), with its own throw-away state.
 */
const { expect } = require('chai');
const { connect, sleep } = require('./client');

describe('e2e DB names (aliasId): set, resolve, move values, rollback (UC-7b)', function () {
    this.timeout(300_000);
    const tag = Date.now().toString(36);
    const ID = `0_userdata.0.om_db_${tag}`;
    const NAME = `om_db_name_${tag}`;
    const DAY = 86_400_000;
    const t0 = Date.now() - 20 * DAY;
    const original = Array.from({ length: 50 }, (_, i) => ({ val: i, ts: t0 + i * 3_600_000, ack: true }));
    const later = Array.from({ length: 10 }, (_, i) => ({ val: 100 + i, ts: Date.now() - 5 * DAY + i * 60_000, ack: true }));
    /** @type {Awaited<ReturnType<typeof connect>>} */
    let io;
    let run1;
    let run2;
    const runs = [];

    async function write(plan) {
        const res = await io.om('plan.write', plan);
        expect(res.runId, JSON.stringify(res.check?.errors)).to.be.a('string');
        runs.unshift(res.runId);
        for (let i = 0; i < 300; i++) {
            const r = await io.om('run.status', { runId: res.runId });
            if (r && r.status !== 'running') {
                return r;
            }
            await sleep(500);
        }
        throw new Error('run did not finish');
    }
    const custom = async () => (await io.getObject(ID)).common.custom['history.0'];
    const tsOf = values => values.map(v => v.ts);

    before(async () => {
        io = await connect();
        expect((await io.om('history.status')).alive).to.equal(true);
        await io.call('setObject', ID, {
            type: 'state',
            common: {
                name: 'DB name test',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                custom: {
                    'history.0': {
                        enabled: true,
                        aliasId: '',
                        changesOnly: false,
                        debounceTime: 0,
                        retention: 0,
                        maxLength: 960,
                    },
                },
            },
            native: {},
        });
        await sleep(1500);
        await io.history('storeState', { id: ID, state: original });
        expect(tsOf(await io.values(ID))).to.include.members(tsOf(original));
    });

    after(async () => {
        if (!io) {
            return;
        }
        for (const runId of runs) {
            const r = await io.om('run.status', { runId }).catch(() => undefined);
            if (r && r.status === 'done') {
                await io.om('run.rollback', { runId }).catch(() => undefined);
            }
        }
        await io.call('delObject', ID).catch(() => undefined);
        await sleep(1000);
        await io.history('deleteAll', [{ id: ID }, { id: NAME }]).catch(() => undefined);
        io.close();
    });

    it('"Prüfen" shows old and new name and the values that move', async () => {
        const check = await io.om('plan.check', {
            dbNames: [{ id: ID, instance: 'history.0', to: NAME, moveValues: true }],
        });
        expect(check.ok, JSON.stringify(check.errors)).to.equal(true);
        expect(check.dbNames).to.have.length(1);
        expect(check.dbNames[0]).to.include({ id: ID, from: ID, to: NAME, move: true });
        expect(check.dbNames[0].range.count).to.be.at.least(50);
        // an instance that does not log is refused
        const bad = await io.om('plan.check', { dbNames: [{ id: ID, instance: 'lovelace.0', to: NAME }] });
        expect(bad.errors.map(e => e.code)).to.include('dbNameInstance');
    });

    it('own ID → DB name: the values move along, the object stores under the name from now on', async () => {
        run1 = await write({ dbNames: [{ id: ID, instance: 'history.0', to: NAME, moveValues: true }] });
        expect(run1.status, run1.error).to.equal('done');
        expect((await custom()).aliasId).to.equal(NAME);
        expect(tsOf(await io.values(NAME))).to.include.members(tsOf(original));
        expect(run1.dbNames[0]).to.include({ from: ID, to: NAME });
        expect(run1.dbNames[0].moved.stats.written).to.be.at.least(50);
        expect(run1.log.map(l => l.msg.code)).to.include('logDbName');
        // reading by the object ID gives the values under the name (the history instance redirects)
        await io.history('storeState', { id: ID, state: later });
        expect(tsOf(await io.values(NAME))).to.include.members(tsOf(later));
    });

    it('"auflösen": DB name → own ID, the values come back under the own ID', async () => {
        run2 = await write({ dbNames: [{ id: ID, instance: 'history.0', to: '', moveValues: true }] });
        expect(run2.status, run2.error).to.equal('done');
        expect((await custom()).aliasId).to.equal('');
        const own = tsOf(await io.values(ID));
        expect(own).to.include.members([...tsOf(original), ...tsOf(later)]);
        // the data under the name stays (04 §0.2)
        expect(tsOf(await io.values(NAME))).to.include.members([...tsOf(original), ...tsOf(later)]);
    });

    it('rollback: settings back, moved values removed, the original data untouched', async () => {
        // newest first. Run 2 moved values to the own ID, which had values in that range before (the
        // originals, the start marker of the history instance): deleteRange can not tell them apart,
        // so they stay (HM-12) - the preview says so
        const preview2 = await io.om('run.rollbackPlan', { runId: run2.id });
        expect(preview2.keepHistory).to.include(ID);
        expect(preview2.restore).to.include(ID);
        await io.om('run.rollback', { runId: run2.id });
        expect((await custom()).aliasId).to.equal(NAME);
        // run 1 moved into a name without values: they are removed there
        const preview1 = await io.om('run.rollbackPlan', { runId: run1.id });
        expect(preview1.removeHistory.map(h => h.target)).to.deep.equal([NAME]);
        await io.om('run.rollback', { runId: run1.id });
        runs.length = 0;
        expect((await custom()).aliasId).to.equal('');
        // own ID: the original values are untouched
        expect(tsOf(await io.values(ID))).to.include.members(tsOf(original));
        // the name: what was moved there by run 1 is gone, what the object stored there itself stays
        const named = tsOf(await io.values(NAME));
        expect(named.filter(ts => tsOf(original).includes(ts))).to.deep.equal([]);
        expect(named).to.include.members(tsOf(later));
    });
});
