import { expect } from 'chai';
import { mirrorStructure, normalizeIdPart, validateBasePath } from './createMode';

const obj = (type: string, common: Record<string, unknown>): ioBroker.Object =>
    ({ type, common, native: {} }) as unknown as ioBroker.Object;

const tree: Record<string, ioBroker.Object> = {
    'hm-rpc.0': obj('instance', { name: 'hm-rpc' }),
    'hm-rpc.0.OLD123': obj('device', { name: 'Thermostat' }),
    'hm-rpc.0.OLD123.Heizung': obj('channel', { name: 'Heizung' }),
    'hm-rpc.0.OLD123.Heizung.VALVE_1': obj('state', {
        name: 'Ventil',
        type: 'number',
        role: 'value',
        unit: '%',
        read: true,
        write: false,
        custom: { 'history.0': { enabled: true } },
    }),
    'hm-rpc.0.OLD123.Heizung.BOOST': obj('state', {
        name: 'Boost',
        type: 'boolean',
        role: 'indicator',
        read: true,
        write: false,
    }),
    'hm-rpc.0.Wartung.Protokoll': obj('state', {
        name: 'Protokoll',
        type: 'mixed',
        read: true,
        write: false,
    }),
};

describe('alias/createMode', () => {
    it('normalizeIdPart replaces forbidden characters', () => {
        expect(normalizeIdPart('Soll Tem*peratur')).to.equal('Soll_Tem_peratur');
        expect(normalizeIdPart('Ventil-1')).to.equal('Ventil-1');
    });

    it('validateBasePath', () => {
        expect(validateBasePath('alias.0.xyz.abc')).to.deep.equal([]);
        expect(validateBasePath('alias.0')).to.deep.equal([]);
        expect(validateBasePath('0_userdata.0.x')).to.have.length(1);
        expect(validateBasePath('alias.0..x')).to.have.length(1);
        expect(validateBasePath('alias.0.a b')).to.have.length(1);
    });

    it('mirrors the structure relative below the base path (EM-01a)', () => {
        const drafts = mirrorStructure('hm-rpc.0', tree, 'alias.0.xyz.abc');
        const byId = Object.fromEntries(drafts.map(d => [d.id, d]));

        expect(byId['alias.0.xyz'].type).to.equal('folder');
        expect(byId['alias.0.xyz.abc'].type).to.equal('device');
        expect(byId['alias.0.xyz.abc.OLD123'].type).to.equal('device');
        expect(byId['alias.0.xyz.abc.OLD123.Heizung'].type).to.equal('channel');

        const valve = byId['alias.0.xyz.abc.OLD123.Heizung.VALVE_1'];
        expect(valve.type).to.equal('state');
        expect(valve.sourceId).to.equal('hm-rpc.0.OLD123.Heizung.VALVE_1');
        expect(valve.common).to.include({ name: 'Ventil', type: 'number', role: 'value', unit: '%' });
        expect(valve.common.alias).to.deep.equal({ id: 'hm-rpc.0.OLD123.Heizung.VALVE_1' });
        // settings are not mirrored here - the settings planner does that
        expect(valve.common.custom).to.equal(undefined);

        // missing parent in the source tree becomes a folder
        expect(byId['alias.0.xyz.abc.Wartung'].type).to.equal('folder');
        expect(byId['alias.0.xyz.abc.Wartung.Protokoll'].common.role).to.equal('state');
    });

    it('skips existing objects and supports partial mirroring', () => {
        const drafts = mirrorStructure('hm-rpc.0', tree, 'alias.0.th', {
            existingIds: new Set(['alias.0.th']),
            onlySourceIds: new Set(['hm-rpc.0.OLD123.Heizung.BOOST']),
        });
        expect(drafts.map(d => d.id).sort()).to.deep.equal([
            'alias.0.th.OLD123',
            'alias.0.th.OLD123.Heizung',
            'alias.0.th.OLD123.Heizung.BOOST',
        ]);
    });

    it('a selected node is mirrored with everything below it', () => {
        const drafts = mirrorStructure('hm-rpc.0', tree, 'alias.0.th', {
            existingIds: new Set(['alias.0.th']),
            onlySourceIds: new Set(['hm-rpc.0.OLD123.Heizung']),
        });
        expect(drafts.map(d => d.id)).to.include.members([
            'alias.0.th.OLD123.Heizung.BOOST',
            'alias.0.th.OLD123.Heizung.VALVE_1',
        ]);
        expect(drafts.some(d => d.id.includes('Wartung'))).to.equal(false);
    });
});
