import {
    Alert,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    LinearProgress,
    TextField,
} from '@mui/material';
import React from 'react';
import { formatMessage } from '../../../src/lib/messages';
import type { DataRange } from '../../../src/lib/history/types';
import type { CheckResult } from '../../../src/lib/migration/types';
import type { Connection } from '../connection';
import { language, t } from '../i18n';
import { HISTORY_ADAPTERS } from '../model';

/** One redirection: the object stores under another name at a logging instance */
interface DbNameRow {
    id: string;
    instance: string;
    name: string;
    enabled: boolean;
    range?: DataRange;
}

const day = (ts?: number): string => (ts ? new Date(ts).toLocaleDateString() : '');

/**
 * Change the DB name (aliasId) of an object at a logging instance (FR-57, HM-14) - checked first,
 * executed as a run (report, rollback)
 *
 * @param props - component props
 * @param props.socket - connection
 * @param props.id - object ID
 * @param props.instance - logging instance
 * @param props.current - current DB name ('' = own ID)
 * @param props.resolve - start with "resolve" (back to the own ID)
 * @param props.historyInstance - the history instance of the migrator (only it moves values)
 * @param props.running - a run is active
 * @param props.onClose - closed
 * @param props.onStarted - the run was started
 */
export function DbNameDialog(props: {
    socket: Connection;
    id: string;
    instance: string;
    current: string;
    resolve?: boolean;
    historyInstance: string;
    running: boolean;
    onClose: () => void;
    onStarted: (runId: string) => void;
}): React.JSX.Element {
    const [to, setTo] = React.useState(props.resolve ? '' : props.current);
    const canMove = props.instance === props.historyInstance;
    const [move, setMove] = React.useState(canMove);
    const [check, setCheck] = React.useState<CheckResult>();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const lang = language();
    const plan = { dbNames: [{ id: props.id, instance: props.instance, to: to.trim(), moveValues: move && canMove }] };

    React.useEffect(() => {
        setCheck(undefined);
        const timer = setTimeout(() => {
            void props.socket
                .send<CheckResult>('plan.check', plan)
                .then(setCheck)
                .catch(e => setError((e as Error).message));
        }, 300);
        return () => clearTimeout(timer);
        // the plan is built from to/move
        // (dependencies on purpose incomplete)
    }, [to, move]);

    const entry = check?.dbNames?.[0];
    const unchanged = !!entry && entry.from === entry.to;
    return (
        <Dialog
            open
            onClose={props.onClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('dbNameChange')}</DialogTitle>
            <DialogContent>
                <div className="om-id">{props.id}</div>
                <div className="om-muted">
                    {props.instance} · {t('dbStoredAs')} „{props.current || t('dbNameOwn')}“
                </div>
                <TextField
                    sx={{ mt: 2 }}
                    fullWidth
                    size="small"
                    label={t('dbNameNew')}
                    placeholder={`${props.id} (${t('dbNameOwn')})`}
                    value={to}
                    onChange={e => setTo(e.target.value)}
                    helperText={t('dbNameNewHelp')}
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={move && canMove}
                            disabled={!canMove}
                            onChange={e => setMove(e.target.checked)}
                        />
                    }
                    label={canMove ? t('dbNameMove') : t('dbNameMoveOnly', { instance: props.historyInstance })}
                />
                {!check && !error && <LinearProgress />}
                {entry && (
                    <div className="om-check-list">
                        „{entry.from}“ → „{entry.to}“
                        {entry.move && (
                            <div className="om-muted">
                                {entry.range
                                    ? t('dbNameMoveCount', {
                                          n: entry.range.count ?? 0,
                                          from: day(entry.range.start),
                                          to: day(entry.range.end),
                                      })
                                    : t('dbNameNothingToMove')}
                            </div>
                        )}
                    </div>
                )}
                {[...(check?.errors ?? []), ...(check?.warnings ?? [])].map((m, i) => (
                    <Alert
                        key={i}
                        severity={check?.errors.includes(m) ? 'error' : 'warning'}
                        sx={{ mt: 1 }}
                    >
                        {formatMessage(m, lang)}
                    </Alert>
                ))}
                {error && (
                    <Alert
                        severity="error"
                        sx={{ mt: 1 }}
                    >
                        {error}
                    </Alert>
                )}
                <div
                    className="om-muted"
                    style={{ marginTop: 8 }}
                >
                    {t('dbNameKeeps')}
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!check?.ok || unchanged || busy || props.running}
                    onClick={() => {
                        setBusy(true);
                        void props.socket
                            .send<{ runId?: string; check: CheckResult }>('plan.write', plan)
                            .then(res => {
                                if (res.runId) {
                                    props.onStarted(res.runId);
                                } else {
                                    setCheck(res.check);
                                }
                            })
                            .catch(e => setError((e as Error).message))
                            .finally(() => setBusy(false));
                    }}
                >
                    {t('write')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * Logging instances of an object with their DB name - in the properties panel (ME-20)
 *
 * @param props - component props
 * @param props.custom - `common.custom` of the object
 * @param props.onChange - open the dialog
 */
export function DbNamesOf(props: {
    custom: Record<string, unknown> | undefined;
    onChange?: (instance: string, current: string) => void;
}): React.JSX.Element | null {
    const rows = Object.entries(props.custom ?? {}).filter(
        ([key, v]) => HISTORY_ADAPTERS.includes(key.split('.')[0]) && v && typeof v === 'object',
    ) as [string, { aliasId?: unknown }][];
    if (!rows.length) {
        return null;
    }
    return (
        <div className="om-dbnames-of">
            {rows.map(([instance, v]) => {
                const name = typeof v.aliasId === 'string' ? v.aliasId.trim() : '';
                return (
                    <div key={instance}>
                        <span className="om-muted">
                            {instance} {t('dbStoredAs')}{' '}
                        </span>
                        {name ? <b>{name}</b> : <span className="om-muted">{t('dbNameOwn')}</span>}
                        {props.onChange && (
                            <Button
                                size="small"
                                onClick={() => props.onChange!(instance, name)}
                            >
                                {t('dbNameChangeShort')}
                            </Button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * "DB-Namen" (FR-57, ME-20): all objects that a logging instance stores under another name
 *
 * @param props - component props
 * @param props.socket - connection
 * @param props.running - a run is active
 * @param props.historyInstance - history instance of the migrator
 * @param props.onStarted - a run was started
 */
export function DbNamesView(props: {
    socket: Connection;
    running: boolean;
    historyInstance: string;
    onStarted: (runId: string) => void;
}): React.JSX.Element {
    const [rows, setRows] = React.useState<DbNameRow[]>();
    const [filter, setFilter] = React.useState('');
    const [error, setError] = React.useState<string>();
    const [edit, setEdit] = React.useState<{ row: DbNameRow; resolve: boolean }>();

    const load = (): void => {
        setRows(undefined);
        void props.socket
            .send<DbNameRow[]>('dbNames.list')
            .then(setRows)
            .catch(e => setError((e as Error).message));
    };
    // reload when a run has finished
    React.useEffect(load, [props.running]);

    const text = filter.trim().toLowerCase();
    const shown = (rows ?? []).filter(
        r => !text || r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text),
    );
    return (
        <div className="om-view">
            <div className="om-view-head">
                <h3>{t('dbNames')}</h3>
                <TextField
                    size="small"
                    placeholder={t('filter')}
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
                <Button
                    size="small"
                    onClick={load}
                >
                    ↻
                </Button>
            </div>
            <p className="om-muted">{t('dbNamesHelp')}</p>
            {props.running && (
                <Alert
                    severity="info"
                    sx={{ mb: 1 }}
                >
                    {t('dbNameRunning')}
                </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {!rows && !error && <LinearProgress />}
            {rows && !rows.length && <Alert severity="success">{t('dbNamesNone')}</Alert>}
            {!!shown.length && (
                <table className="om-table">
                    <thead>
                        <tr>
                            <th>{t('dbNameObject')}</th>
                            <th>{t('dbNameInstance')}</th>
                            <th>{t('dbName')}</th>
                            <th className="om-num">{t('dbNameValues')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(r => (
                            <tr key={`${r.id}|${r.instance}`}>
                                <td className="om-id">{r.id}</td>
                                <td>
                                    {r.instance}
                                    {!r.enabled && <span className="om-chip">{t('customOff')}</span>}
                                </td>
                                <td>
                                    <b>{r.name}</b>
                                </td>
                                <td className="om-num">
                                    {r.range ? (
                                        <span title={`${day(r.range.start)} – ${day(r.range.end)}`}>
                                            {r.range.count ?? ''}
                                        </span>
                                    ) : (
                                        <span className="om-muted">
                                            {r.instance === props.historyInstance ? '0' : '–'}
                                        </span>
                                    )}
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                    <Button
                                        size="small"
                                        disabled={props.running}
                                        onClick={() => setEdit({ row: r, resolve: false })}
                                    >
                                        {t('dbNameChangeShort')}
                                    </Button>
                                    <Button
                                        size="small"
                                        disabled={props.running}
                                        onClick={() => setEdit({ row: r, resolve: true })}
                                    >
                                        {t('dbNameResolve')}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {edit && (
                <DbNameDialog
                    socket={props.socket}
                    id={edit.row.id}
                    instance={edit.row.instance}
                    current={edit.row.name}
                    resolve={edit.resolve}
                    historyInstance={props.historyInstance}
                    running={props.running}
                    onClose={() => setEdit(undefined)}
                    onStarted={runId => {
                        setEdit(undefined);
                        props.onStarted(runId);
                    }}
                />
            )}
        </div>
    );
}
