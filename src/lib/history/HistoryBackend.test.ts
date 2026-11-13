import { expect } from 'chai';
import { HistoryAdapterBackend, historySafeId, MAX_RAW_PAGE, type MessageTransport } from './HistoryBackend';

/**
 * Records the messages and answers like the history adapter
 *
 * @param answers - answer function per command
 */
function transport(answers: Record<string, (message: any) => unknown>): MessageTransport & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        sendTo: (_instance, command, message) => {
            calls.push(command);
            return Promise.resolve(answers[command]?.(message));
        },
        getForeignState: id => Promise.resolve({ val: id.endsWith('.alive'), ack: true, ts: 0, lc: 0, from: '' }),
    };
}

describe('history/HistoryAdapterBackend', () => {
    it('historySafeId replaces the characters like the history adapter', () => {
        expect(historySafeId('a.b:c/d*e')).to.equal('a.b~c~d~e');
    });

    it('getRanges uses one getDpStatistics call and maps also safe IDs', async () => {
        const t = transport({
            getDpStatistics: () => ({
                success: true,
                result: [
                    { id: 'hm.0.temp', count: 3, firstTs: 10, lastTs: 30 },
                    { id: 'x.0.a~b', count: 1, firstTs: 5, lastTs: 5 },
                    { id: 'empty.0.x', count: 0, firstTs: null, lastTs: null },
                ],
            }),
        });
        const backend = new HistoryAdapterBackend('history.0', t);
        const ranges = await backend.getRanges(['hm.0.temp', 'x.0.a:b', 'empty.0.x', 'missing']);
        expect(ranges).to.deep.equal({
            'hm.0.temp': { start: 10, end: 30, count: 3 },
            'x.0.a:b': { start: 5, end: 5, count: 1 },
            'empty.0.x': undefined,
            missing: undefined,
        });
        expect(t.calls).to.deep.equal(['getDpStatistics']);
    });

    it('readRange pages through getRawEntries and filters the borders', async () => {
        const all = Array.from({ length: MAX_RAW_PAGE + 10 }, (_, i) => ({ ts: 100 + i, val: i }));
        const t = transport({
            getRawEntries: (m: { offset: number; limit: number }) => ({
                result: all.slice(m.offset, m.offset + m.limit),
            }),
        });
        const backend = new HistoryAdapterBackend('history.0', t);
        const entries = await backend.readRange('id', { start: 100, end: 100 + MAX_RAW_PAGE + 5 });
        expect(entries.length).to.equal(MAX_RAW_PAGE + 6);
        expect(t.calls).to.deep.equal(['getRawEntries', 'getRawEntries', 'getRawEntries']);
    });

    it('readRange reads everything when the adapter caps the page below the limit (history 5.2: 2000)', async () => {
        const all = Array.from({ length: 4500 }, (_, i) => ({ ts: 100 + i, val: i }));
        const t = transport({
            getRawEntries: (m: { offset: number; limit: number }) => ({
                result: all.slice(m.offset, m.offset + Math.min(m.limit, 2000)),
            }),
        });
        const entries = await new HistoryAdapterBackend('history.0', t).readRange('id', { start: 0, end: 1e9 });
        expect(entries.length).to.equal(4500);
        expect(new Set(entries.map(e => e.ts)).size).to.equal(4500);
    });

    it('throws on an error answer', async () => {
        const backend = new HistoryAdapterBackend('history.0', transport({ storeState: () => ({ error: 'boom' }) }));
        let error: Error | undefined;
        try {
            await backend.store('id', [{ ts: 1, val: 1 }]);
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.contain('boom');
    });

    it('isAlive reads system.adapter.<instance>.alive', async () => {
        expect(await new HistoryAdapterBackend('history.0', transport({})).isAlive()).to.equal(true);
    });
});
