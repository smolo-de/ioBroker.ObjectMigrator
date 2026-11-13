import { expect } from 'chai';
import { countId, findReferences } from './references';

describe('refs/findReferences', () => {
    it('countId finds only whole IDs', () => {
        expect(countId("getState('hm.0.temp').val", 'hm.0.temp')).to.equal(1);
        expect(countId('hm.0.temp1 and xhm.0.temp', 'hm.0.temp')).to.equal(0);
        expect(countId('use hm.0.temp. Then hm.0.temp.sub', 'hm.0.temp')).to.equal(1);
        expect(countId('"hm.0.temp","hm.0.temp"', 'hm.0.temp')).to.equal(2);
    });

    it('lists the places per ID, the object itself is not a reference', () => {
        const refs = findReferences(
            ['hm.0.temp', 'hm.0.hum'],
            [
                { kind: 'script', location: 'script.js.heizung', name: 'Heizung', text: "on('hm.0.temp', ...)" },
                { kind: 'alias', location: 'alias.0.wp.temp', text: '{"id":"hm.0.temp"}' },
                { kind: 'alias', location: 'hm.0.hum', text: '{"id":"hm.0.hum"}' },
            ],
        );
        expect(refs['hm.0.temp']).to.deep.equal([
            { kind: 'script', location: 'script.js.heizung', name: 'Heizung', count: 1 },
            { kind: 'alias', location: 'alias.0.wp.temp', name: undefined, count: 1 },
        ]);
        expect(refs['hm.0.hum']).to.deep.equal([]);
    });
});
