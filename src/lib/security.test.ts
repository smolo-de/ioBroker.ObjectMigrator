import { expect } from 'chai';
import { isAllowedSender } from './access';
import { checkExpression, compileExpression, converterToAlias } from './alias/converter';
import { HistoryAdapterBackend, type MessageTransport } from './history/HistoryBackend';
import { isRunId, isValidDbName, isValidId, validatePlan } from './migration/MigrationRunner';
import { deepMerge } from './settings/settings';

describe('security', () => {
    it('only the admin may send messages', () => {
        expect(isAllowedSender('system.adapter.admin.0')).to.equal(true);
        expect(isAllowedSender('system.adapter.javascript.0')).to.equal(false);
        expect(isAllowedSender('system.adapter.admin.0.x')).to.equal(false);
        expect(isAllowedSender(undefined)).to.equal(false);
    });

    it('run IDs can not leave the runs folder', () => {
        expect(isRunId('run-2026-11-12T23-29-54-151Z')).to.equal(true);
        expect(isRunId('../plans/current')).to.equal(false);
        expect(isRunId('run-1/../../x')).to.equal(false);
    });

    it('object IDs: no wildcards, no forbidden characters, at least two parts', () => {
        expect(isValidId('alias.0.Bewässerung.Temperatur')).to.equal(true);
        expect(isValidId('hm-rpc.0.ABC:1.TEMPERATURE')).to.equal(true);
        for (const bad of ['*', 'alias.*', 'a', 'a..b', '.a.b', 'a.b.', "a.b'", 'a.b\n', 42, undefined]) {
            expect(isValidId(bad), String(bad)).to.equal(false);
        }
    });

    it('DB names (aliasId): free text, but no path parts - the history instance builds file names from it', () => {
        expect(isValidDbName('om_db_name')).to.equal(true);
        expect(isValidDbName('hm-rpc.0.ABC:1.TEMPERATURE')).to.equal(true);
        for (const bad of ['', ' x', '../x', 'a/b', 'a\\b', 'a..b', 'x*', "a'b", 'a\n', 42, undefined]) {
            expect(isValidDbName(bad), String(bad)).to.equal(false);
        }
        expect(
            validatePlan({ dbNames: [{ id: 'a.0.b', instance: 'history.0', to: '../../etc' }] }).map(e => e.code),
        ).to.deep.equal(['invalidId']);
    });

    it('formulas may only compute with val', () => {
        expect(checkExpression('Math.round(val * 10) / 10')).to.equal(undefined);
        expect(checkExpression('(val) >= 1 ? "An" : "Aus"')).to.equal(undefined);
        expect(checkExpression('"process" + val')).to.equal(undefined); // text only
        for (const bad of [
            'process.exit()',
            'val.constructor.constructor("x")()',
            'val = 1',
            '1; 2',
            '`${val}`',
            '(() => { while (true) {} })()',
            'globalThis',
            'this',
            'new Date()',
            'eval("1")',
            'require("fs")',
            'val.__proto__',
        ]) {
            expect(checkExpression(bad), bad).to.be.a('string');
        }
    });

    it('security review: the bypasses of the former deny list are rejected', () => {
        const payloads = [
            // property names as text
            String.raw`val["constructor"]["constructor"]("return process.mainModule.require('child_process').execSync('id')")()`,
            '""["constructor"]["constructor"]("return process")()',
            // unicode escapes in names
            String.raw`\u0070rocess.getBuiltinModule("child_process").execSync("id")`,
            String.raw`val.constr\u0075ctor`,
            // a regex literal that confused the quote stripper
            '/\'/.source ? process.getBuiltinModule("child_process").execSync("id") : \'/\'',
            // [ ] only on tables written in the formula
            'String(val)["length"]',
            '({ a: 1 })["constructor"]',
            // functions may not be handed to native code
            '[1].join((v) => v)',
        ];
        for (const p of payloads) {
            const reason = checkExpression(p);
            if (reason !== undefined) {
                continue;
            }
            // it parses - evaluating it may fail, but never reaches anything outside the formula
            let out: unknown;
            try {
                out = compileExpression(p)(1);
            } catch (e) {
                out = (e as Error).message;
            }
            expect(typeof out, p).to.not.equal('function');
            expect(String(out), p).to.not.match(/process|pwned|native code/);
        }
        // the table lookup only finds own entries
        expect(compileExpression('({ "0": "Aus" })[String(val)]')('constructor')).to.equal(undefined);
        expect(compileExpression('({ "0": "Aus" })[String(val)]')('__proto__')).to.equal(undefined);
    });

    it('formulas that call themselves stop', () => {
        expect(() => compileExpression('((f) => f(f))((f) => f(f))')(1)).to.throw(/calls|deep/);
    });

    it('the interpreter computes like JavaScript for all generated formulas', () => {
        const converters = [
            { factor: 0.1, offset: -2, decimals: 1, to: 'number' as const },
            { to: 'string' as const, decimals: 2, suffix: ' °C' },
            { map: { 0: 'Aus', 1: 'An' }, invert: true },
            { to: 'boolean' as const },
            { decimals: 3 },
            { to: 'number' as const },
        ];
        const inputs: unknown[] = [0, 1, 21.456, -3.2, '12,5', 'on', 'x', true, false, null, '', '1'];
        for (const c of converters) {
            const { read, write } = converterToAlias(c, true);
            for (const expr of [read, write].filter((e): e is string => !!e)) {
                // reference: plain JavaScript (only in this test)
                const native = new Function('val', `return ${expr};`) as (v: unknown) => unknown;
                for (const v of inputs) {
                    expect(compileExpression(expr)(v), `${expr} with ${JSON.stringify(v)}`).to.deep.equal(native(v));
                }
            }
        }
    });

    it('all generated alias functions pass the formula check', () => {
        const converters = [
            { factor: 0.1, offset: 2, decimals: 1, to: 'number' as const },
            { to: 'string' as const, decimals: 2, suffix: ' °C' },
            { map: { 0: 'Aus', 1: 'An' }, invert: true },
            { to: 'boolean' as const },
        ];
        for (const c of converters) {
            const { read, write } = converterToAlias(c, true);
            expect(checkExpression(read!), read).to.equal(undefined);
            if (write) {
                expect(checkExpression(write), write).to.equal(undefined);
            }
        }
    });

    it('validatePlan rejects bad IDs and formulas', () => {
        const errors = validatePlan({
            drafts: [
                {
                    id: 'alias.0.x',
                    type: 'state',
                    common: { alias: { id: 'a.0.b', read: 'require("fs")' } },
                    native: {},
                },
            ],
            tasks: [{ target: 'alias.*', sources: [], overlap: { type: 'all' } }],
        });
        expect(errors.map(e => e.code).sort()).to.deep.equal(['invalidExpression', 'invalidId']);
    });

    it('deepMerge ignores __proto__ from stored plans', () => {
        const merged = deepMerge(
            {},
            JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>,
        );
        expect(merged).to.deep.equal({ a: 1 });
        expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
    });

    it('history ranges are cached when allowed - getDpStatistics scans all files', async () => {
        let calls = 0;
        const transport: MessageTransport = {
            sendTo: () => {
                calls++;
                return Promise.resolve({ result: [{ id: 'a.0.b', count: 1, firstTs: 1, lastTs: 1 }] });
            },
            getForeignState: () => Promise.resolve(null),
        };
        const backend = new HistoryAdapterBackend('history.0', transport);
        await backend.getRanges(['a.0.b'], 60_000);
        await backend.getRanges(['a.0.b'], 60_000);
        expect(calls).to.equal(1);
        await backend.getRanges(['a.0.b']); // fresh (before "Schreiben")
        expect(calls).to.equal(2);
        backend.invalidate();
        await backend.getRanges(['a.0.b'], 60_000);
        expect(calls).to.equal(3);
    });
});
