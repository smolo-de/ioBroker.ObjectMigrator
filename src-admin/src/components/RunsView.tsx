import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    LinearProgress,
} from '@mui/material';
import React from 'react';
import type { MigrationRun, RollbackPlan, RunSummary } from '../../../src/lib/migration/types';
import { formatMessage } from '../../../src/lib/messages';
import type { Connection } from '../connection';
import { language, t } from '../i18n';
import { RunLog } from './RunLog';

const fmtTime = (ts?: number): string =>
    ts ? new Date(ts).toLocaleString(language() === 'de' ? 'de-DE' : 'en-GB') : '';
const fmtNum = (n: number): string => n.toLocaleString(language() === 'de' ? 'de-DE' : 'en-GB');

/**
 * Details of one run: results per target
 *
 * @param props
 * @param props.socket
 * @param props.runId
 * @param props.onClose
 */
function ReportDialog(props: { socket: Connection; runId: string; onClose: () => void }): React.JSX.Element {
    const [run, setRun] = React.useState<MigrationRun>();
    const [error, setError] = React.useState<string>();
    React.useEffect(() => {
        props.socket
            .send<MigrationRun>('run.status', { runId: props.runId })
            .then(setRun)
            .catch((e: Error) => setError(e.message));
    }, [props.socket, props.runId]);
    return (
        <Dialog
            open
            fullWidth
            maxWidth="lg"
            onClose={props.onClose}
        >
            <DialogTitle>
                {t('report')}: {props.runId}
            </DialogTitle>
            <DialogContent dividers>
                {!run && !error && <LinearProgress />}
                {error && <Alert severity="error">{error}</Alert>}
                {run && (
                    <>
                        <p>
                            {t('status')}: <b>{t(run.status ?? 'done')}</b> · {fmtTime(run.startedAt)} –{' '}
                            {fmtTime(run.finishedAt)}
                        </p>
                        {run.error && <Alert severity="error">{run.error}</Alert>}
                        <h4>
                            {t('objectsCreate')}: {run.createdIds.length}
                        </h4>
                        <div className="om-check-list">
                            {run.createdIds.map(id => (
                                <div key={id}>{id}</div>
                            ))}
                        </div>
                        <h4>{t('historyTitle')}</h4>
                        <table className="om-table">
                            <thead>
                                <tr>
                                    <th>{t('target')}</th>
                                    <th className="om-num">{t('written')}</th>
                                    <th className="om-num">{t('skippedExisting')}</th>
                                    <th className="om-num">{t('skippedOther')}</th>
                                    <th>{t('period')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {run.results
                                    .filter(r => !!r)
                                    .map(r => (
                                        <tr key={r.target}>
                                            <td>
                                                {r.target}
                                                {r.cancelled ? ` (${t('cancelled')})` : ''}
                                            </td>
                                            <td className="om-num">{fmtNum(r.stats.written)}</td>
                                            <td className="om-num">{fmtNum(r.stats.skippedExisting)}</td>
                                            <td className="om-num">
                                                {fmtNum(
                                                    r.stats.skippedDuplicate +
                                                        r.stats.skippedOverlap +
                                                        r.stats.excluded +
                                                        r.stats.skippedMarker,
                                                )}
                                            </td>
                                            <td className="om-muted om-nowrap">
                                                {r.written
                                                    ? `${fmtTime(r.written.start)} – ${fmtTime(r.written.end)}`
                                                    : ''}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                        {!!run.log?.length && (
                            <>
                                <h4>{t('runLog')}</h4>
                                <RunLog
                                    entries={run.log}
                                    height={240}
                                />
                            </>
                        )}
                        {run.warnings.length > 0 && (
                            <>
                                <h4>{t('warnings')}</h4>
                                <ul className="om-muted">
                                    {run.warnings.map((w, i) => (
                                        <li key={i}>
                                            {w.id ? `${w.id}: ` : ''}
                                            {typeof w === 'string' ? w : formatMessage(w, language())}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('close')}</Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * Rollback with a preview of what happens (HM-12)
 *
 * @param props
 * @param props.socket
 * @param props.runId
 * @param props.onDone
 * @param props.onClose
 */
function RollbackDialog(props: {
    socket: Connection;
    runId: string;
    onDone: () => void;
    onClose: () => void;
}): React.JSX.Element {
    const [plan, setPlan] = React.useState<RollbackPlan>();
    const [error, setError] = React.useState<string>();
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
        props.socket
            .send<RollbackPlan>('run.rollbackPlan', { runId: props.runId })
            .then(setPlan)
            .catch((e: Error) => setError(e.message));
    }, [props.socket, props.runId]);
    return (
        <Dialog
            open
            fullWidth
            maxWidth="md"
            onClose={props.onClose}
        >
            <DialogTitle>
                {t('rollback')}: {props.runId}
            </DialogTitle>
            <DialogContent dividers>
                {(!plan || busy) && !error && <LinearProgress />}
                {error && <Alert severity="error">{error}</Alert>}
                {plan && (
                    <>
                        <DialogContentText>{t('rollbackText')}</DialogContentText>
                        {plan.noBackup && <Alert severity="warning">{t('rollbackNoBackup')}</Alert>}
                        <h4>
                            {t('rollbackRemoveHistory')}: {plan.removeHistory.length}
                        </h4>
                        <div className="om-check-list">
                            {plan.removeHistory.map(h => (
                                <div key={h.target}>
                                    {h.target}: {fmtNum(h.written)} {t('values')} ({fmtTime(h.start)} – {fmtTime(h.end)}
                                    )
                                </div>
                            ))}
                        </div>
                        {plan.keepHistory.length > 0 && (
                            <>
                                <h4>
                                    {t('rollbackKeepHistory')}: {plan.keepHistory.length}
                                </h4>
                                <div className="om-muted">{t('rollbackKeepHint')}</div>
                                <div className="om-check-list">
                                    {plan.keepHistory.map(id => (
                                        <div key={id}>{id}</div>
                                    ))}
                                </div>
                            </>
                        )}
                        <h4>
                            {t('rollbackRestore')}: {plan.restore.length}
                        </h4>
                        <div className="om-muted">{t('rollbackRestoreHint')}</div>
                        <div className="om-check-list">
                            {plan.restore.map(id => (
                                <div key={id}>{id}</div>
                            ))}
                        </div>
                        <h4>
                            {t('rollbackDelete')}: {plan.delete.length}
                        </h4>
                        <div className="om-check-list">
                            {plan.delete.map(id => (
                                <div key={id}>{id}</div>
                            ))}
                        </div>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    color="error"
                    disabled={!plan || busy}
                    onClick={() => {
                        setBusy(true);
                        props.socket
                            .send('run.rollback', { runId: props.runId })
                            .then(() => props.onDone())
                            .catch((e: Error) => setError(e.message))
                            .finally(() => setBusy(false));
                    }}
                >
                    ↶ {t('rollback')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * "Verlauf": all runs with report and rollback (06 §7)
 *
 * @param props
 * @param props.socket
 * @param props.running
 */
export function RunsView(props: { socket: Connection; running: boolean }): React.JSX.Element {
    const [runs, setRuns] = React.useState<RunSummary[]>();
    const [error, setError] = React.useState<string>();
    const [report, setReport] = React.useState<string>();
    const [rollback, setRollback] = React.useState<string>();
    const load = React.useCallback(() => {
        props.socket
            .send<RunSummary[]>('run.list')
            .then(setRuns)
            .catch((e: Error) => setError(e.message));
    }, [props.socket]);
    React.useEffect(load, [load, props.running]);

    return (
        <div className="om-view">
            <div className="om-view-head">
                <h3>{t('runs')}</h3>
                <Button
                    size="small"
                    onClick={load}
                >
                    {t('reload')}
                </Button>
            </div>
            <div className="om-muted">{t('runsHelp')}</div>
            {error && <Alert severity="error">{error}</Alert>}
            {!runs && !error && <LinearProgress />}
            {runs && !runs.length && <p className="om-muted">{t('noRuns')}</p>}
            {runs && runs.length > 0 && (
                <table className="om-table om-runs">
                    <thead>
                        <tr>
                            <th>{t('started')}</th>
                            <th>{t('status')}</th>
                            <th className="om-num">{t('objectsCreate')}</th>
                            <th className="om-num">{t('settingsTitle')}</th>
                            <th className="om-num">{t('targets')}</th>
                            <th className="om-num">{t('written')}</th>
                            <th className="om-num">{t('skippedExisting')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map(r => (
                            <tr key={r.id}>
                                <td className="om-nowrap">
                                    {fmtTime(r.startedAt)}
                                    <div className="om-muted">{r.id}</div>
                                </td>
                                <td>
                                    {t((r.status as 'done') ?? 'done')}
                                    {r.rolledBackAt ? <div className="om-muted">{fmtTime(r.rolledBackAt)}</div> : null}
                                    {r.error ? <div className="om-warn-text">{r.error}</div> : null}
                                </td>
                                <td className="om-num">{r.created}</td>
                                <td className="om-num">{r.settings}</td>
                                <td className="om-num">{r.targets}</td>
                                <td className="om-num">{fmtNum(r.written)}</td>
                                <td className="om-num">{fmtNum(r.skippedExisting)}</td>
                                <td className="om-nowrap">
                                    <Button
                                        size="small"
                                        onClick={() => setReport(r.id)}
                                    >
                                        {t('report')}
                                    </Button>
                                    <Button
                                        size="small"
                                        color="error"
                                        disabled={r.status === 'running' || r.status === 'rolledBack' || props.running}
                                        onClick={() => setRollback(r.id)}
                                    >
                                        ↶ {t('rollback')}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {report && (
                <ReportDialog
                    socket={props.socket}
                    runId={report}
                    onClose={() => setReport(undefined)}
                />
            )}
            {rollback && (
                <RollbackDialog
                    socket={props.socket}
                    runId={rollback}
                    onClose={() => setRollback(undefined)}
                    onDone={() => {
                        setRollback(undefined);
                        load();
                    }}
                />
            )}
        </div>
    );
}
