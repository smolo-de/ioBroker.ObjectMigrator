import { expect } from 'chai';
import type { HistoryBackend } from './HistoryBackend';
import { nextDay, runTransfer, startOfDay, taskRange } from './transfer';
import type { DataRange, HistoryEntry, TimeRange, TransferTask } from './types';

/** In-memory history instance that behaves like the history adapter (add only, no dedup) */
class FakeBackend implements HistoryBackend {
    public readonly instance = 'history.0';
    public data: Record<string, HistoryEntry[]> = {};
    public storeCalls = 0;

    public isAlive(): Promise<boolean> {
        return Promise.resolve(true);
    }
    public getRanges(ids: string[]): Promise<Record<string, DataRange | undefined>> {
        const result: Record<string, DataRange | undefined> = {};
        for (const id of ids) {
            const list = (this.data[id] ?? []).map(x => x.ts);
            result[id] = list.length
                ? { start: Math.min(...list), end: Math.max(...list), count: list.length }
                : undefined;
        }
        return Promise.resolve(result);
    }
    public readRange(id: string, range: TimeRange): Promise<HistoryEntry[]> {
        return Promise.resolve(
            (this.data[id] ?? []).filter(x => x.ts >= range.start && x.ts <= range.end).sort((a, b) => a.ts - b.ts),
        );
    }
    public store(id: string, entries: HistoryEntry[]): Promise<void> {
        this.storeCalls++;
        (this.data[id] ??= []).push(...entries.map(x => ({ ...x })));
        return Promise.resolve();
    }
    public deleteRange(id: string, range: TimeRange): Promise<void> {
        this.data[id] = (this.data[id] ?? []).filter(x => x.ts < range.start || x.ts > range.end);
        return Promise.resolve();
    }
}

const HOUR = 3600_000;
const day0 = startOfDay(Date.UTC(2025, 0, 10, 12));
const series = (count: number, from: number, step: number, val = 1): HistoryEntry[] =>
    Array.from({ length: count }, (_, i) => ({ ts: from + i * step, val: val + i, ack: true }));

const noSleep = (): Promise<void> => Promise.resolve();

describe('history/transfer', () => {
    it('nextDay steps to the next local midnight', () => {
        const d = nextDay(day0);
        expect(new Date(d).getHours()).to.equal(0);
        expect(d).to.be.greaterThan(day0);
    });

    it('taskRange builds the union and applies the limit', () => {
        expect(taskRange([{ start: 5, end: 10 }, undefined, { start: 1, end: 7 }])).to.deep.equal({
            start: 1,
            end: 10,
        });
        expect(taskRange([{ start: 5, end: 10 }], { start: 6 })).to.deep.equal({ start: 6, end: 10 });
        expect(taskRange([undefined])).to.equal(undefined);
    });

    it('migrates two sources over several days into the target, sources stay unchanged', async () => {
        const backend = new FakeBackend();
        backend.data['old.0.temp'] = series(72, day0, HOUR); // 3 days hourly
        backend.data['new.0.temp'] = series(24, day0 + 60 * HOUR, HOUR, 100); // overlaps 12 h
        const oldCopy = JSON.stringify(backend.data['old.0.temp']);

        const task: TransferTask = {
            target: 'alias.0.Wp.temp',
            sources: [{ id: 'old.0.temp' }, { id: 'new.0.temp', priority: 1 }],
            overlap: { type: 'all' },
        };
        const result = await runTransfer(backend, task, { chunkSize: 10, pauseMs: 0, sleep: noSleep });

        const target = backend.data['alias.0.Wp.temp'];
        const ts = target.map(x => x.ts);
        expect(new Set(ts).size).to.equal(ts.length, 'no duplicates');
        expect(ts.length).to.equal(72 + 24 - 12);
        // in the overlap the new source wins
        expect(target.find(x => x.ts === day0 + 60 * HOUR)!.val).to.equal(100);
        expect(result.cancelled).to.equal(undefined);
        expect(result.stats.written).to.equal(84);
        expect(result.stats.skippedDuplicate).to.equal(12);
        expect(result.written).to.deep.equal({ start: day0, end: day0 + 83 * HOUR });
        expect(JSON.stringify(backend.data['old.0.temp'])).to.equal(oldCopy);
        expect(backend.storeCalls).to.be.greaterThan(3, 'written in chunks');
    });

    it('collects several days into one chunk - one pause per chunk, not per day', async () => {
        const backend = new FakeBackend();
        backend.data.src = series(30 * 100, day0, (24 * HOUR) / 100); // 30 days, 100 values per day
        let pauses = 0;
        const sleep = (): Promise<void> => {
            pauses++;
            return Promise.resolve();
        };
        const task: TransferTask = { target: 'tgt', sources: [{ id: 'src' }], overlap: { type: 'all' } };
        const result = await runTransfer(backend, task, { chunkSize: 1000, pauseMs: 1000, sleep });
        expect(backend.data.tgt.length).to.equal(3000);
        expect(backend.storeCalls).to.equal(3);
        expect(pauses).to.equal(3);
        expect(result.written).to.deep.equal({ start: day0, end: backend.data.src[2999].ts });
    });

    it('is idempotent: a second run writes nothing', async () => {
        const backend = new FakeBackend();
        backend.data.src = series(30, day0, HOUR);
        const task: TransferTask = { target: 'tgt', sources: [{ id: 'src' }], overlap: { type: 'all' } };
        await runTransfer(backend, task, { chunkSize: 5000, pauseMs: 0, sleep: noSleep });
        const second = await runTransfer(backend, task, { chunkSize: 5000, pauseMs: 0, sleep: noSleep });
        expect(second.stats.written).to.equal(0);
        expect(second.stats.skippedExisting).to.equal(30);
        expect(backend.data.tgt.length).to.equal(30);
    });

    it('can be cancelled - starting again completes it without duplicates', async () => {
        const backend = new FakeBackend();
        backend.data.src = series(96, day0, HOUR); // 4 days
        const task: TransferTask = { target: 'tgt', sources: [{ id: 'src' }], overlap: { type: 'all' } };

        let days = 0;
        const first = await runTransfer(backend, task, {
            chunkSize: 5000,
            pauseMs: 0,
            sleep: noSleep,
            isCancelled: () => days >= 2,
            onProgress: () => {
                days++;
            },
        });
        expect(first.cancelled).to.equal(true);
        expect(backend.data.tgt.length).to.be.lessThan(96);

        // "Schreiben" clicked again
        const second = await runTransfer(backend, task, { chunkSize: 5000, pauseMs: 0, sleep: noSleep });
        expect(second.cancelled).to.equal(undefined);
        expect(second.stats.skippedExisting).to.equal(backend.data.tgt.length - second.stats.written);
        expect(backend.data.tgt.length).to.equal(96);
        expect(new Set(backend.data.tgt.map(x => x.ts)).size).to.equal(96);
    });

    it('keeps existing target values and only adds missing ones', async () => {
        const backend = new FakeBackend();
        backend.data.src = series(10, day0, HOUR);
        backend.data.tgt = [{ ts: day0 + 2 * HOUR, val: 'live', ack: true }];
        const task: TransferTask = { target: 'tgt', sources: [{ id: 'src' }], overlap: { type: 'all' } };
        const result = await runTransfer(backend, task, { chunkSize: 5000, pauseMs: 0, sleep: noSleep });
        expect(result.targetRangeBefore).to.deep.equal({ start: day0 + 2 * HOUR, end: day0 + 2 * HOUR });
        expect(backend.data.tgt.length).to.equal(10);
        expect(backend.data.tgt.find(x => x.ts === day0 + 2 * HOUR)!.val).to.equal('live');
    });

    it('respects the range limit and the cut rule', async () => {
        const backend = new FakeBackend();
        backend.data.old = series(48, day0, HOUR);
        backend.data.new = series(48, day0, HOUR, 1000);
        const cut = day0 + 24 * HOUR;
        const task: TransferTask = {
            target: 'tgt',
            sources: [{ id: 'old' }, { id: 'new' }],
            overlap: { type: 'cut', at: cut, oldSourceIds: ['old'] },
            range: { start: day0 + 12 * HOUR },
        };
        await runTransfer(backend, task, { chunkSize: 5000, pauseMs: 0, sleep: noSleep });
        const tgt = backend.data.tgt.sort((a, b) => a.ts - b.ts);
        expect(tgt[0].ts).to.equal(day0 + 12 * HOUR);
        expect(tgt.every(x => (x.ts < cut ? (x.val as number) < 1000 : (x.val as number) >= 1000))).to.equal(true);
        expect(tgt.length).to.equal(36);
    });
});
