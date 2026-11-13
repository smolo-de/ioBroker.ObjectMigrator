import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress } from '@mui/material';
import * as echarts from 'echarts';
import React from 'react';
import { compileExpression } from '../../../src/lib/alias/converter';
import { resolveOverlap } from '../../../src/lib/history/merge';
import type { DataRange, HistoryEntry, OverlapRule, TimeRange } from '../../../src/lib/history/types';
import type { Connection } from '../connection';
import { t } from '../i18n';

/** What the preview shows */
export interface HistoryRequest {
    /** The target - or a single state */
    id: string;
    /** Sources in link order (later ones win on equal ts) */
    sources: string[];
    overlap: OverlapRule;
    /** Excluded values `${sourceId}|${ts}` (FR-96) */
    excluded?: string[];
    /** read expression per source - the result shows the converted values like they are written */
    converters?: Record<string, string>;
}

interface Series {
    count: number;
    raw: boolean;
    entries: HistoryEntry[];
}

interface Answer {
    ranges: Record<string, DataRange | undefined>;
    series: Record<string, Series>;
}

const toNumber = (v: unknown): number | null =>
    v === null || v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);

const PALETTE = ['#2196f3', '#e91e63', '#ff9800', '#9c27b0', '#009688', '#795548'];

/**
 * Merged result as it will be at the target - from the (possibly aggregated) points
 *
 * @param request - target and sources
 * @param answer - points per ID
 */
function mergedPreview(request: HistoryRequest, answer: Answer): [number, number | null][] {
    const ranges: Record<string, TimeRange | undefined> = answer.ranges;
    const exclude = resolveOverlap(
        request.sources.map((id, priority) => ({ id, priority })),
        ranges,
        request.overlap,
    );
    const byTs = new Map<number, number | null>();
    for (const e of answer.series[request.id]?.entries ?? []) {
        byTs.set(e.ts, toNumber(e.val));
    }
    const excluded = new Set(request.excluded ?? []);
    request.sources.forEach(id => {
        const read = request.converters?.[id];
        let convert = (v: unknown): unknown => v;
        if (read) {
            try {
                convert = compileExpression(read);
            } catch {
                // invalid formula - shown unconverted, "Prüfen" reports it
            }
        }
        for (const e of answer.series[id]?.entries ?? []) {
            if (exclude[id]?.some(r => e.ts >= r.start && e.ts <= r.end) || excluded.has(`${id}|${e.ts}`)) {
                continue;
            }
            let v: unknown = e.val;
            try {
                v = convert(e.val);
            } catch {
                // keep the value
            }
            byTs.set(e.ts, toNumber(v));
        }
    });
    return [...byTs.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * History preview of a target with all its sources (06 §6)
 *
 * @param props
 * @param props.socket
 * @param props.request
 * @param props.dark
 * @param props.onClose
 * @param props.onSetCut
 * @param props.onToggleExclude
 */
export function HistoryDialog(props: {
    socket: Connection;
    request: HistoryRequest;
    dark: boolean;
    onClose: () => void;
    /** Click in the chart sets the cut at this time (FR-93) */
    onSetCut?: (ts: number) => void;
    /** Click on a raw value excludes it / takes it again (FR-96) */
    onToggleExclude?: (key: string) => void;
}): React.JSX.Element {
    const { request } = props;
    const [clickMode, setClickMode] = React.useState<'cut' | 'exclude' | undefined>();
    const clickModeRef = React.useRef(clickMode);
    clickModeRef.current = clickMode;
    const chartRef = React.useRef<HTMLDivElement>(null);
    const chart = React.useRef<echarts.ECharts>(undefined);
    const [answer, setAnswer] = React.useState<Answer>();
    const [error, setError] = React.useState<string>();
    const [loading, setLoading] = React.useState(false);
    const [window, setWindow] = React.useState<TimeRange>({ start: 0, end: Date.now() + 3600_000 });
    const ids = React.useMemo(
        () => [request.id, ...request.sources.filter(s => s !== request.id)],
        [request.id, request.sources],
    );

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        props.socket
            .send<Answer>('history.aggregate', { ids, start: window.start, end: window.end, points: 800 })
            .then(a => !cancelled && setAnswer(a))
            .catch((e: Error) => !cancelled && setError(e.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [ids, window, props.socket]);

    React.useEffect(() => {
        if (!chartRef.current || !answer) {
            return;
        }
        chart.current ??= echarts.init(chartRef.current, props.dark ? 'dark' : undefined);
        const hasSources = request.sources.length > 0;
        const series: echarts.SeriesOption[] = ids.map((id, i) => ({
            name: id === request.id && hasSources ? `${t('existingTarget')}: ${id}` : id,
            type: 'line',
            showSymbol: false,
            sampling: 'lttb',
            lineStyle: { width: 1.2 },
            color: PALETTE[i % PALETTE.length],
            data: (answer.series[id]?.entries ?? []).map(e => [e.ts, toNumber(e.val)]),
            markPoint: {
                symbol: 'circle',
                symbolSize: 9,
                itemStyle: { color: '#f44336' },
                label: { show: false },
                data: (answer.series[id]?.entries ?? [])
                    .filter(e => request.excluded?.includes(`${id}|${e.ts}`))
                    .map(e => ({ name: 'excluded', coord: [e.ts, toNumber(e.val) ?? 0] })),
            },
        }));
        if (hasSources) {
            const exclude = resolveOverlap(
                request.sources.map((id, priority) => ({ id, priority })),
                answer.ranges,
                request.overlap,
            );
            const switches = new Set(
                Object.values(exclude)
                    .flat()
                    .map(r => (r.start > 0 ? r.start : r.end + 1))
                    .filter(ts => ts > 0 && ts < Number.MAX_SAFE_INTEGER - 1),
            );
            series.push({
                name: t('result'),
                type: 'line',
                showSymbol: false,
                sampling: 'lttb',
                color: '#4caf50',
                lineStyle: { width: 2, type: 'dashed' },
                data: mergedPreview(request, answer),
                markLine: {
                    symbol: 'none',
                    label: { formatter: (p: any) => new Date(p.value as number).toLocaleString() },
                    data: [...switches].map(x => ({ xAxis: x })),
                },
            });
        }
        chart.current.setOption(
            {
                backgroundColor: 'transparent',
                tooltip: { trigger: 'axis' },
                legend: { type: 'scroll', top: 0 },
                grid: { left: 50, right: 20, top: 40, bottom: 70 },
                xAxis: { type: 'time' },
                yAxis: { type: 'value', scale: true },
                dataZoom: [{ type: 'inside' }, { type: 'slider' }],
                series,
            },
            { notMerge: true },
        );
        // zooming loads the visible window again - raw values for small windows
        let timer: ReturnType<typeof setTimeout> | undefined;
        chart.current.off('datazoom');
        chart.current.on('datazoom', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const axis = (chart.current as any)?.getModel().getComponent('xAxis', 0).axis;
                const [start, end] = axis.scale.getExtent() as [number, number];
                if (start > 0 && end > start) {
                    setWindow({ start: Math.floor(start), end: Math.ceil(end) });
                }
            }, 600);
        });
        // click on a value (exclude) or into the chart (cut)
        chart.current.off('click');
        chart.current.on('click', (params: any) => {
            if (clickModeRef.current !== 'exclude' || !props.onToggleExclude) {
                return;
            }
            const id = ids[params.seriesIndex as number];
            if (!id || id === request.id || !request.sources.includes(id)) {
                return;
            }
            const ts = (params.value as [number, number])[0];
            props.onToggleExclude(`${id}|${ts}`);
        });
        const zr = chart.current.getZr();
        zr.off('click');
        zr.on('click', (ev: { offsetX: number; offsetY: number; target?: unknown }) => {
            if (clickModeRef.current !== 'cut' || !props.onSetCut || !chart.current) {
                return;
            }
            const point = [ev.offsetX, ev.offsetY];
            if (!chart.current.containPixel('grid', point)) {
                return;
            }
            const [ts] = chart.current.convertFromPixel('grid', point);
            if (ts > 0) {
                props.onSetCut(Math.round(ts));
            }
        });
    }, [answer, ids, request, props.dark]);

    React.useEffect(() => () => chart.current?.dispose(), []);

    return (
        <Dialog
            open
            fullWidth
            maxWidth="xl"
            onClose={props.onClose}
        >
            <DialogTitle>{request.id}</DialogTitle>
            <DialogContent>
                {loading && <LinearProgress />}
                {error && <Alert severity="error">{error}</Alert>}
                <div className="om-history-info">
                    {ids.map((id, i) => {
                        const r = answer?.ranges[id];
                        const s = answer?.series[id];
                        return (
                            <div key={id}>
                                <span
                                    className="om-dot"
                                    style={{ background: PALETTE[i % PALETTE.length] }}
                                />
                                {id}:{' '}
                                {r
                                    ? `${new Date(r.start).toLocaleString()} … ${new Date(r.end).toLocaleString()}, ${r.count.toLocaleString()} ${t('values')} (${s?.raw ? t('rawValues') : t('aggregated')})`
                                    : t('noHistory')}
                            </div>
                        );
                    })}
                </div>
                <div
                    ref={chartRef}
                    style={{ width: '100%', height: 460 }}
                />
            </DialogContent>
            <DialogActions>
                {request.sources.length > 0 && props.onSetCut && (
                    <>
                        <span className="om-muted">{t('clickSets')}:</span>
                        <Button
                            size="small"
                            variant={clickMode === 'cut' ? 'contained' : 'outlined'}
                            onClick={() => setClickMode(clickMode === 'cut' ? undefined : 'cut')}
                            title={t('cutHint')}
                        >
                            ✂ {t('overlapCut')}
                        </Button>
                        <Button
                            size="small"
                            variant={clickMode === 'exclude' ? 'contained' : 'outlined'}
                            onClick={() => setClickMode(clickMode === 'exclude' ? undefined : 'exclude')}
                            title={t('excludeHint')}
                        >
                            ⊘ {t('excludeValue')}
                        </Button>
                        {(request.excluded?.length ?? 0) > 0 && (
                            <span className="om-muted">
                                {request.excluded!.length} {t('excludedCount')}
                            </span>
                        )}
                        <span className="om-spacer" />
                    </>
                )}
                <Button onClick={() => setWindow({ start: 0, end: Date.now() + 3600_000 })}>{t('reload')}</Button>
                <Button
                    variant="contained"
                    onClick={props.onClose}
                >
                    {t('close')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
