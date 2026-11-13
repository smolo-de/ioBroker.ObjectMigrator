import { expect } from 'chai';
import { deepMerge, instanceStatusMap, planEnums, planSettings } from './settings';

const source = (custom: Record<string, unknown>, common: Record<string, unknown> = {}): ioBroker.Object =>
    ({
        _id: 'hm-rpc.0.OLD123.1.VALVE_STATE',
        type: 'state',
        common: {
            name: 'Ventil',
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            unit: '%',
            custom,
            ...common,
        },
        native: {},
    }) as unknown as ioBroker.Object;

const instances = {
    'history.0': 'active',
    'history.1': 'active',
    'lovelace.0': 'active',
    'statistics.0': 'disabled',
} as const;

describe('settings/planSettings', () => {
    it('takes over all custom keys generically and clears aliasId of history adapters', () => {
        const plan = planSettings(
            source({
                'history.0': { enabled: true, changesOnly: true, aliasId: 'old.id', retention: 31536000 },
                'statistics.0': { enabled: true, avg: true },
                'telegram.0': { enabled: true, foo: 1 },
            }),
            undefined,
            { ...instances },
        );
        expect(plan.targetCustom['history.0']).to.deep.equal({
            enabled: true,
            changesOnly: true,
            aliasId: '',
            retention: 31536000,
        });
        expect(plan.targetCustom['statistics.0']).to.deep.equal({ enabled: true, avg: true });
        expect(plan.targetCustom['telegram.0']).to.deep.equal({ enabled: true, foo: 1 });
        expect(plan.status).to.deep.equal({
            'history.0': 'active',
            'statistics.0': 'disabled',
            'telegram.0': 'missing',
        });
        // telegram not installed, statistics disabled, history logs at source and target
        expect(plan.warnings.length).to.equal(3);
    });

    it('by default nothing is changed at the source - only warnings', () => {
        const plan = planSettings(
            source({
                'history.0': { enabled: true },
                'lovelace.0': { enabled: true, entity: 'sensor', name: 'wohnzimmer_ventil' },
            }),
            undefined,
            { ...instances },
        );
        expect(plan.sourceCustom).to.deep.equal({});
        expect(plan.targetCustom['lovelace.0']).to.deep.equal({
            enabled: true,
            entity: 'sensor',
            name: 'wohnzimmer_ventil',
        });
        expect(plan.warnings.some(w => w.code === 'doubleLogging')).to.equal(true);
        expect(plan.warnings.some(w => w.code === 'lovelaceDuplicate')).to.equal(true);
    });

    it('sourceMode disable / remove change the source', () => {
        const custom = { 'history.0': { enabled: true }, 'lovelace.0': { enabled: true } };
        // lovelace ignores `enabled` (the admin removes a switched off entry) - it is removed,
        // otherwise the entity stays at the source (found with an end-to-end test)
        expect(
            planSettings(source(custom), undefined, { ...instances }, { sourceMode: 'disable' }).sourceCustom,
        ).to.deep.equal({
            'history.0': { enabled: false },
            'lovelace.0': null,
        });
        expect(
            planSettings(source(custom), undefined, { ...instances }, { sourceMode: 'remove' }).sourceCustom,
        ).to.deep.equal({
            'history.0': null,
            'lovelace.0': null,
        });
    });

    it('skips not installed adapters if configured', () => {
        const plan = planSettings(
            source({ 'telegram.0': { enabled: true } }),
            undefined,
            { ...instances },
            { copyUninstalled: false },
        );
        expect(plan.targetCustom).to.deep.equal({});
    });

    it('supports exclude, instance remap and overrides', () => {
        const plan = planSettings(
            source({ 'history.0': { enabled: true, retention: 100 }, 'statistics.0': { enabled: true } }),
            undefined,
            { ...instances },
            {
                exclude: ['statistics.0'],
                instanceRemap: { 'history.0': 'history.1' },
                overrides: { 'history.1': { retention: 0, debounceTime: null } },
            },
        );
        expect(Object.keys(plan.targetCustom)).to.deep.equal(['history.1']);
        expect(plan.targetCustom['history.1']).to.deep.equal({ enabled: true, retention: 0, aliasId: '' });
    });

    it('merges with existing target settings', () => {
        const plan = planSettings(
            source({ 'history.0': { enabled: true, retention: 100 } }),
            {
                common: { custom: { 'history.0': { enabled: false, maxLength: 10 } } },
            } as unknown as Partial<ioBroker.Object>,
            { ...instances },
        );
        expect(plan.targetCustom['history.0']).to.deep.equal({
            enabled: true,
            maxLength: 10,
            retention: 100,
            aliasId: '',
        });
    });

    it('copies smartName and common attributes only if empty at the target', () => {
        const plan = planSettings(
            source({}, { smartName: 'Ventil Wohnzimmer', desc: 'Heizkörper' }),
            { common: { unit: 'K' } } as unknown as Partial<ioBroker.Object>,
            { ...instances },
            { copyCommon: ['unit', 'desc'], commonOverrides: { role: 'value.percent' } },
        );
        expect(plan.targetCommon).to.deep.equal({
            smartName: 'Ventil Wohnzimmer',
            desc: 'Heizkörper',
            role: 'value.percent',
        });
    });

    it('writing again does not switch off the target (source was disabled by the first run)', () => {
        const plan = planSettings(
            source({ 'history.0': { enabled: false, retention: 0 } }),
            {
                common: { custom: { 'history.0': { enabled: true, retention: 0, aliasId: '' } } },
            } as unknown as Partial<ioBroker.Object>,
            { ...instances },
        );
        expect(plan.targetCustom['history.0'].enabled).to.equal(true);
        expect(plan.sourceCustom).to.deep.equal({});
    });

    it('an override can still switch off the target explicitly', () => {
        const plan = planSettings(
            source({ 'history.0': { enabled: true } }),
            { common: { custom: { 'history.0': { enabled: true } } } } as unknown as Partial<ioBroker.Object>,
            { ...instances },
            { overrides: { 'history.0': { enabled: false } } },
        );
        expect(plan.targetCustom['history.0'].enabled).to.equal(false);
    });
});

describe('settings/helpers', () => {
    it('deepMerge deletes with null', () => {
        expect(deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { d: null }, e: 5 })).to.deep.equal({
            a: 1,
            b: { c: 2 },
            e: 5,
        });
    });

    it('instanceStatusMap reads enabled', () => {
        const map = instanceStatusMap({
            'system.adapter.history.0': { type: 'instance', common: { enabled: true } } as unknown as ioBroker.Object,
            'system.adapter.sql.0': { type: 'instance', common: { enabled: false } } as unknown as ioBroker.Object,
            'system.adapter.sql': { type: 'adapter', common: {} } as unknown as ioBroker.Object,
        });
        expect(map).to.deep.equal({ 'history.0': 'active', 'sql.0': 'disabled' });
    });

    it('planEnums adds the target and optionally removes the source', () => {
        const enums = {
            'enum.rooms.keller': { common: { members: ['src.a', 'other'] } } as unknown as ioBroker.Object,
            'enum.functions.heizung': { common: { members: ['other'] } } as unknown as ioBroker.Object,
        };
        expect(planEnums(enums, 'src.a', 'alias.0.a', true)).to.deep.equal([
            { enumId: 'enum.rooms.keller', members: ['other', 'alias.0.a'] },
        ]);
        expect(planEnums(enums, 'src.a', 'alias.0.a', false)[0].members).to.deep.equal(['src.a', 'other', 'alias.0.a']);
    });
});

describe('settings/planSettings - adapters added in the editor', () => {
    it('an override of a key the source does not have adds that adapter, exclude wins', () => {
        const plan = planSettings(source({ 'history.0': { enabled: true } }), undefined, instances, {
            overrides: { 'lovelace.0': { enabled: true, entity: 'sensor' }, 'statistics.0': { enabled: true } },
            exclude: ['statistics.0'],
        });
        expect(plan.targetCustom['lovelace.0']).to.deep.equal({ enabled: true, entity: 'sensor' });
        expect(plan.status['lovelace.0']).to.equal('active');
        expect(plan.targetCustom['statistics.0']).to.equal(undefined);
        expect(plan.sourceCustom['lovelace.0']).to.equal(undefined);
    });

    it('works without a source (new value)', () => {
        const plan = planSettings({ common: {} } as unknown as ioBroker.Object, undefined, instances, {
            overrides: { 'history.0': { enabled: true, retention: 0 } },
        });
        expect(plan.targetCustom).to.deep.equal({ 'history.0': { enabled: true, retention: 0 } });
    });
});
