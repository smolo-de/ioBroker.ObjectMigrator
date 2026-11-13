import { expect } from 'chai';
import { convertValue, estimateValues, mergeWindow, resolveOverlap } from './merge';
import type { HistoryEntry, SourceSpec } from './types';

const e = (ts: number, val: ioBroker.StateValue = ts): HistoryEntry => ({
    ts,
    val,
    ack: 1,
    from: 'system.adapter.x.0',
});

describe('history/merge', () => {
    describe('convertValue', () => {
        it('linear converts numbers only', () => {
            expect(convertValue(10, { type: 'linear', factor: 2, offset: 1 })).to.equal(21);
            expect(convertValue('a', { type: 'linear', factor: 2, offset: 1 })).to.equal('a');
        });
        it('invert works for booleans and 0/1', () => {
            expect(convertValue(true, { type: 'invert' })).to.equal(false);
            expect(convertValue(0, { type: 'invert' })).to.equal(1);
            expect(convertValue(5, { type: 'invert' })).to.equal(5);
        });
        it('keeps null', () => {
            expect(convertValue(null, { type: 'linear', factor: 2, offset: 1 })).to.equal(null);
        });
    });

    describe('resolveOverlap', () => {
        const sources: SourceSpec[] = [{ id: 'old' }, { id: 'new' }];
        const ranges = { old: { start: 0, end: 100 }, new: { start: 50, end: 200 } };

        it('all: nothing excluded', () => {
            expect(resolveOverlap(sources, ranges, { type: 'all' })).to.deep.equal({ old: [], new: [] });
        });
        it('prefer: others excluded in the range of the preferred source', () => {
            const r = resolveOverlap(sources, ranges, { type: 'prefer', sourceId: 'new' });
            expect(r.old).to.deep.equal([{ start: 50, end: 200 }]);
            expect(r.new).to.deep.equal([]);
        });
        it('switch: every source until the next one starts, independent of the order', () => {
            const three: SourceSpec[] = [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'empty' }];
            const r = resolveOverlap(
                three,
                { a: { start: 0, end: 100 }, b: { start: 50, end: 300 }, c: { start: 200, end: 400 } },
                { type: 'switch' },
            );
            expect(r).to.deep.equal({
                a: [{ start: 50, end: Number.MAX_SAFE_INTEGER }],
                b: [{ start: 200, end: Number.MAX_SAFE_INTEGER }],
                c: [],
                empty: [],
            });
        });
        it('cut: old sources until at-1, new ones from at', () => {
            const r = resolveOverlap(sources, ranges, { type: 'cut', at: 80, oldSourceIds: ['old'] });
            expect(r.old[0].start).to.equal(80);
            expect(r.new[0].end).to.equal(79);
        });
    });

    describe('mergeWindow', () => {
        it('merges, sorts and removes duplicate ts (higher priority wins)', () => {
            const { toWrite, stats } = mergeWindow({
                entries: { old: [e(3, 'old3'), e(1, 'old1')], new: [e(2, 'new2'), e(3, 'new3')] },
                sources: [{ id: 'old' }, { id: 'new', priority: 1 }],
                existingTargetTs: new Set(),
                exclude: { old: [], new: [] },
            });
            expect(toWrite.map(x => x.val)).to.deep.equal(['old1', 'new2', 'new3']);
            expect(stats.read).to.equal(4);
            expect(stats.skippedDuplicate).to.equal(1);
            expect(stats.written).to.equal(3);
        });

        it('never writes ts that exist at the target (idempotent)', () => {
            const { toWrite, stats } = mergeWindow({
                entries: { a: [e(1), e(2), e(3)] },
                sources: [{ id: 'a' }],
                existingTargetTs: new Set([2]),
                exclude: { a: [] },
            });
            expect(toWrite.map(x => x.ts)).to.deep.equal([1, 3]);
            expect(stats.skippedExisting).to.equal(1);
        });

        it('applies exclusions, overlap ranges and converters', () => {
            const { toWrite, stats } = mergeWindow({
                entries: { a: [e(1, 10), e(2, 20), e(3, 30)] },
                sources: [{ id: 'a', converter: { type: 'linear', factor: 1, offset: 5 } }],
                existingTargetTs: new Set(),
                exclude: { a: [{ start: 3, end: 3 }] },
                excluded: new Set(['a|1']),
            });
            expect(toWrite).to.deep.equal([{ ts: 2, val: 25, ack: true, from: 'system.adapter.x.0' }]);
            expect(stats.excluded).to.equal(1);
            expect(stats.skippedOverlap).to.equal(1);
        });

        it('drops the start/stop markers of the history adapter unless keepMarkers is set', () => {
            const entries = {
                a: [
                    { ts: 1, val: null, q: 0x40, from: 'system.adapter.history.0' },
                    { ts: 2, val: 5 },
                    { ts: 3, val: null, from: 'system.adapter.zigbee.0' },
                ] as HistoryEntry[],
            };
            const base = { entries, sources: [{ id: 'a' }], existingTargetTs: new Set<number>(), exclude: { a: [] } };
            const dropped = mergeWindow(base);
            expect(dropped.toWrite.map(x => x.ts)).to.deep.equal([2, 3]);
            expect(dropped.stats.skippedMarker).to.equal(1);
            expect(mergeWindow({ ...base, keepMarkers: true }).toWrite.length).to.equal(3);
        });
    });

    describe('estimateValues', () => {
        it('switch: the old source counts only until the new one starts', () => {
            const ranges = {
                old: { start: 0, end: 1000, count: 1001 },
                new: { start: 900, end: 1100, count: 201 },
            };
            const e = estimateValues([{ id: 'old' }, { id: 'new' }], ranges, { type: 'switch' });
            expect(e.perSource).to.deep.equal({ old: 901, new: 201 });
            expect(e.total).to.equal(1102);
        });
        it('all: every value counts, a source without data counts 0', () => {
            const e = estimateValues(
                [{ id: 'a' }, { id: 'b' }],
                { a: { start: 0, end: 10, count: 7 } },
                { type: 'all' },
            );
            expect(e).to.deep.equal({ perSource: { a: 7, b: 0 }, total: 7 });
        });
    });
});
