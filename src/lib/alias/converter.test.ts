import { expect } from 'chai';
import { compileExpression, converterToAlias, convertWith, isConverting } from './converter';

describe('alias/converter', () => {
    it('no conversion: no alias functions', () => {
        expect(isConverting({})).to.equal(false);
        expect(converterToAlias({ factor: 1, offset: 0 })).to.deep.equal({});
    });

    it('factor + decimals: 215 (×0.1) → 21.5, write inverts', () => {
        const c = { factor: 0.1, to: 'number' as const, decimals: 1 };
        expect(convertWith(c, 215)).to.equal(21.5);
        expect(convertWith(c, '217')).to.equal(21.7);
        const { write } = converterToAlias(c, true);
        expect(compileExpression(write!)(21.5)).to.be.closeTo(215, 1e-9);
    });

    it('text to number with comma', () => {
        expect(convertWith({ to: 'number' }, '12,5')).to.equal(12.5);
    });

    it('number to text with decimals and suffix, write parses it back', () => {
        const c = { to: 'string' as const, decimals: 1, suffix: ' °C' };
        expect(convertWith(c, 21.456)).to.equal('21.5 °C');
        const { write } = converterToAlias(c, true);
        expect(compileExpression(write!)('21.5 °C')).to.equal(21.5);
    });

    it('rounding keeps the type', () => {
        expect(convertWith({ decimals: 2 }, 1.23456)).to.equal(1.23);
        expect(convertWith({ decimals: 2 }, 'x')).to.equal('x');
    });

    it('value table and its inverse', () => {
        const c = { map: { 0: 'Aus', 1: 'An' } };
        expect(convertWith(c, 1)).to.equal('An');
        expect(convertWith(c, 5)).to.equal(5);
        const { write } = converterToAlias(c, true);
        expect(compileExpression(write!)('Aus')).to.equal(0);
    });

    it('invert and to boolean', () => {
        expect(convertWith({ invert: true }, true)).to.equal(false);
        expect(convertWith({ invert: true }, 1)).to.equal(0);
        expect(convertWith({ to: 'boolean' }, 'on')).to.equal(true);
        expect(convertWith({ to: 'boolean' }, 0)).to.equal(false);
        expect(converterToAlias({ to: 'boolean' }, true).write).to.equal(undefined);
    });

    it('own expressions win', () => {
        expect(converterToAlias({ read: 'val / 2', write: 'val * 2', factor: 9 }, true)).to.deep.equal({
            read: 'val / 2',
            write: 'val * 2',
        });
    });
});
