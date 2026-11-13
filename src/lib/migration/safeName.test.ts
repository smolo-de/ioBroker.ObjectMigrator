import { expect } from 'chai';
import { safeName } from './MigrationRunner';

describe('migration/safeName', () => {
    it('keeps letters, digits, umlauts, spaces, dots and dashes', () => {
        expect(safeName('current')).to.equal('current');
        expect(safeName('Kühlschrank Keller-2.v1')).to.equal('Kühlschrank Keller-2.v1');
    });
    it('replaces path characters', () => {
        expect(safeName('../a/b:c')).to.equal('.._a_b_c');
        expect(safeName('  ')).to.equal('unnamed');
    });
});
