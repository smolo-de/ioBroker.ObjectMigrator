import {
    Alert,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    LinearProgress,
    TextField,
} from '@mui/material';
import React from 'react';
import { validateBasePath } from '../../../src/lib/alias/createMode';
import type { CheckResult } from '../../../src/lib/migration/types';
import { formatMessage, type Message } from '../../../src/lib/messages';
import { language, t } from '../i18n';
import { CustomIcons, type InstanceInfo } from './ObjectTree';

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 90) {
        return `${s} s`;
    }
    if (s < 5400) {
        return `${Math.round(s / 60)} min`;
    }
    return `${(s / 3600).toFixed(1)} h`;
}

/**
 * Number of values the history tasks will write (estimate of the backend, else all source values)
 *
 * @param check
 */
export function valuesOf(check: CheckResult): number {
    return check.history.reduce(
        (sum, h) => sum + (h.estimate ?? h.sources.reduce((s, src) => s + (src.range?.count ?? 0), 0)),
        0,
    );
}

/**
 * The target has values over (almost) the whole period of the source - it was probably migrated before.
 * 95 %, because the source may have logged a few newer values since.
 *
 * @param src - range of the source
 * @param src.start
 * @param src.end
 * @param target - range of the target
 * @param target.start
 * @param target.end
 */
function coveredByTarget(src?: { start: number; end: number }, target?: { start: number; end: number }): boolean {
    if (!src || !target) {
        return false;
    }
    const span = Math.max(1, src.end - src.start);
    const overlap = Math.min(src.end, target.end) - Math.max(src.start, target.start);
    return overlap / span >= 0.95;
}

/**
 * common.alias as text: id and read/write functions
 *
 * @param alias - common.alias (string or object)
 */
function aliasText(alias: unknown): string {
    if (!alias) {
        return '–';
    }
    if (typeof alias === 'string') {
        return alias;
    }
    const a = alias as { id?: unknown; read?: string; write?: string };
    const id = typeof a.id === 'string' ? a.id : JSON.stringify(a.id);
    return `${id}${a.read ? `  read: ${a.read}` : ''}${a.write ? `  write: ${a.write}` : ''}`;
}

const fmtDate = (ts: number): string => new Date(ts).toLocaleDateString(language() === 'de' ? 'de-DE' : 'en-GB');
const fmtNum = (n: number): string => n.toLocaleString(language() === 'de' ? 'de-DE' : 'en-GB');
const fmtRange = (r: { start: number; end: number }): string =>
    fmtDate(r.start) === fmtDate(r.end) ? fmtDate(r.start) : `${fmtDate(r.start)} – ${fmtDate(r.end)}`;

/**
 * Estimated duration of the history migration: at least one chunk (with pause) per target, reading
 * day by day (about 3 requests per day and target, measured in the load test: 1 year ≈ 17 s)
 *
 * @param check - result of "Prüfen"
 * @param chunkSize - values per chunk
 * @param pauseMs - pause per chunk
 */
export function estimateMs(check: CheckResult, chunkSize: number, pauseMs: number): number {
    let ms = 0;
    for (const h of check.history) {
        const ranges = h.sources.map(s => s.range).filter((r): r is NonNullable<typeof r> => !!r);
        if (!ranges.length) {
            continue;
        }
        const count = ranges.reduce((sum, r) => sum + ((r as { count?: number }).count ?? 0), 0);
        const days = (Math.max(...ranges.map(r => r.end)) - Math.min(...ranges.map(r => r.start))) / 86400_000 + 1;
        ms += Math.ceil(count / Math.max(1, chunkSize)) * (pauseMs + 150) + days * 25;
    }
    return ms;
}

/**
 * Messages grouped by their object - in the language of the user
 *
 * @param props
 * @param props.messages
 * @param props.severity
 * @param props.title
 */
export function MessageList(props: {
    messages: Message[];
    severity: 'error' | 'warning';
    title: string;
}): React.JSX.Element | null {
    if (!props.messages.length) {
        return null;
    }
    const groups = new Map<string, Message[]>();
    for (const m of props.messages) {
        const key = m.id ?? '';
        groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return (
        <Alert severity={props.severity}>
            <b>
                {props.title} ({props.messages.length})
            </b>
            {[...groups.entries()].slice(0, 100).map(([id, list]) => (
                <div
                    key={id}
                    className="om-msg-group"
                >
                    {id && <div className="om-msg-id">{id}</div>}
                    <ul>
                        {list.map((m, i) => (
                            <li key={i}>{formatMessage(m, language())}</li>
                        ))}
                    </ul>
                </div>
            ))}
            {groups.size > 100 && <div>… +{groups.size - 100}</div>}
        </Alert>
    );
}

/**
 * Result of "Prüfen" and confirmation of "Schreiben" (WR-02, WR-03)
 *
 * @param props
 * @param props.check
 * @param props.loading
 * @param props.error
 * @param props.instances
 * @param props.chunkSize
 * @param props.pauseMs
 * @param props.onWrite
 * @param props.onClose
 * @param props.onDiscard
 * @param props.scopeNode
 * @param props.scope
 * @param props.onScope
 */
export function CheckDialog(props: {
    check?: CheckResult;
    loading: boolean;
    error?: string;
    instances: Record<string, InstanceInfo>;
    chunkSize: number;
    pauseMs: number;
    onWrite: () => void;
    onClose: () => void;
    /** Discards the pending changes of a target (settings without source) */
    onDiscard?: (targetId: string) => void;
    /** Selected node of the target tree: write only it and everything below (WR-04) */
    scopeNode?: string;
    scope?: string;
    onScope?: (scope: string | undefined) => void;
}): React.JSX.Element {
    const { check } = props;
    const [confirm, setConfirm] = React.useState(false);
    const values = check ? valuesOf(check) : 0;
    const create = check?.objects.filter(o => o.action === 'create') ?? [];
    const exist = check ? check.objects.length - create.length : 0;
    const duration = check ? estimateMs(check, props.chunkSize, props.pauseMs) : 0;

    return (
        <Dialog
            open
            fullWidth
            maxWidth="lg"
            onClose={props.onClose}
        >
            <DialogTitle>{confirm ? t('confirmWrite') : t('checkTitle')}</DialogTitle>
            <DialogContent dividers>
                {props.loading && <LinearProgress />}
                {props.error && <Alert severity="error">{props.error}</Alert>}
                {check && confirm && (
                    <DialogContentText>
                        {t('confirmWriteText', {
                            objects: create.length,
                            settings: check.settings.length,
                            values: fmtNum(values),
                            targets: check.history.length,
                        })}
                    </DialogContentText>
                )}
                {props.scopeNode && props.onScope && !confirm && (
                    <div className="om-scope">
                        <b>{t('scope')}:</b>
                        <label>
                            <input
                                type="radio"
                                checked={!props.scope}
                                onChange={() => props.onScope!(undefined)}
                            />{' '}
                            {t('scopeAll')}
                        </label>
                        <label>
                            <input
                                type="radio"
                                checked={!!props.scope}
                                onChange={() => props.onScope!(props.scopeNode)}
                            />{' '}
                            {t('scopeNode')}: <code>{props.scopeNode}</code>
                        </label>
                    </div>
                )}
                {check && !confirm && (
                    <div className="om-check">
                        {!check.historyAlive && check.history.length > 0 && (
                            <Alert severity="error">
                                {t('historyNotAlive')}: {check.historyInstance}
                            </Alert>
                        )}
                        <MessageList
                            messages={check.errors}
                            severity="error"
                            title={t('errors')}
                        />
                        <MessageList
                            messages={check.warnings}
                            severity="warning"
                            title={t('warnings')}
                        />
                        <h4>
                            {t('objectsCreate')}: {create.length}
                            {exist ? ` (${exist} ${t('objectsExist')})` : ''}
                        </h4>
                        <div className="om-check-list">
                            {create.slice(0, 200).map(o => (
                                <div key={o.id}>{o.id}</div>
                            ))}
                            {create.length > 200 && <div>… +{create.length - 200}</div>}
                        </div>
                        <h4>
                            {t('settingsTitle')}: {check.settings.length}
                        </h4>
                        <table className="om-table">
                            <thead>
                                <tr>
                                    <th>{t('source')}</th>
                                    <th />
                                    <th>{t('target')}</th>
                                    <th>{t('adapters')}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {check.settings.slice(0, 300).map(s => (
                                    <tr key={s.targetId}>
                                        <td>
                                            {s.sourceId ?? (
                                                <span className="om-warn-text">
                                                    {t('settingsOnly')}
                                                    {props.onDiscard && (
                                                        <Button
                                                            size="small"
                                                            color="error"
                                                            onClick={() => props.onDiscard!(s.targetId)}
                                                        >
                                                            ✕ {t('discard')}
                                                        </Button>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td>→</td>
                                        <td>{s.targetId}</td>
                                        <td>
                                            <CustomIcons
                                                obj={{ type: 'state', common: { custom: s.plan.targetCustom } }}
                                                instances={props.instances}
                                            />
                                        </td>
                                        <td className="om-muted">
                                            {Object.keys(s.plan.sourceCustom).length
                                                ? `Quelle: ${Object.entries(s.plan.sourceCustom)
                                                      .map(([k, v]) => `${k} ${v === null ? '✕' : 'aus'}`)
                                                      .join(', ')}`
                                                : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {check.aliases.length > 0 && (
                            <>
                                <h4>
                                    {t('aliasesTitle')}: {check.aliases.length}
                                </h4>
                                <table className="om-table">
                                    <thead>
                                        <tr>
                                            <th>{t('target')}</th>
                                            <th>{t('aliasBefore')}</th>
                                            <th>{t('aliasAfter')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {check.aliases.map(a => (
                                            <tr key={a.targetId}>
                                                <td>{a.targetId}</td>
                                                <td className="om-muted">{aliasText(a.from)}</td>
                                                <td>{aliasText(a.to)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </>
                        )}
                        <h4>
                            {t('historyTitle')}: {check.history.length} {t('targets')} – ≈ {fmtNum(values)}{' '}
                            {t('values')}, {t('estimated')} ≈ {formatDuration(duration)}
                        </h4>
                        <table className="om-table">
                            <thead>
                                <tr>
                                    <th>{t('target')}</th>
                                    <th>{t('sources')}</th>
                                    <th className="om-num">{t('values')}</th>
                                    <th>{t('period')}</th>
                                    <th className="om-num">{t('willWrite')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {check.history.slice(0, 300).map(h => {
                                    const rows = [
                                        ...h.sources.map(src => ({
                                            key: src.id,
                                            label: src.id,
                                            count: src.range?.count,
                                            range: src.range,
                                            write: src.estimate,
                                            muted: false,
                                            // the target has values over the whole period already - probably migrated before
                                            covered: coveredByTarget(src.range, h.targetRange),
                                        })),
                                        ...(h.targetRange
                                            ? [
                                                  {
                                                      key: '#target',
                                                      label: t('existingTarget'),
                                                      count: h.targetRange.count,
                                                      range: h.targetRange,
                                                      write: undefined,
                                                      muted: true,
                                                      covered: false,
                                                  },
                                              ]
                                            : []),
                                    ];
                                    return rows.map((r, i) => (
                                        <tr
                                            key={`${h.target}|${r.key}`}
                                            className={i === rows.length - 1 ? 'om-row-last' : 'om-row-inner'}
                                        >
                                            {i === 0 && (
                                                <td rowSpan={rows.length}>
                                                    {h.target}
                                                    {h.retention ? (
                                                        <div className="om-muted">
                                                            {t('retention')}: {Math.round(h.retention / 86400)} d
                                                        </div>
                                                    ) : null}
                                                    {h.estimate !== undefined && h.sources.length > 1 && (
                                                        <div className="om-muted">
                                                            {t('total')}: ≈ {fmtNum(h.estimate)}
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                            <td className={r.muted ? 'om-muted' : ''}>{r.label}</td>
                                            <td className="om-num">
                                                {r.count === undefined ? t('noHistory') : fmtNum(r.count)}
                                            </td>
                                            <td className="om-muted om-nowrap">{r.range ? fmtRange(r.range) : ''}</td>
                                            <td className="om-num">
                                                {r.write === undefined ? '' : `≤ ${fmtNum(r.write)}`}
                                                {r.covered && (
                                                    <div
                                                        className="om-muted om-hint"
                                                        title={t('probablyDoneHint')}
                                                    >
                                                        {t('probablyDone')}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ));
                                })}
                            </tbody>
                        </table>
                        <div className="om-muted">{t('skipHint')}</div>
                    </div>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={confirm ? () => setConfirm(false) : props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    color="warning"
                    disabled={!check?.ok || props.loading}
                    onClick={() => (confirm ? props.onWrite() : setConfirm(true))}
                >
                    ✎ {t('write')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * Base path of the create mode (EM-01)
 *
 * @param props
 * @param props.defaultPath
 * @param props.sourceRoot
 * @param props.selection
 * @param props.error
 * @param props.onMirror
 * @param props.onClose
 */
export function CreateModeDialog(props: {
    defaultPath: string;
    sourceRoot: string;
    /** Objects selected in the source tree */
    selection: string[];
    error?: string;
    onMirror: (basePath: string, sourceRoot: string, onlySourceIds?: string[]) => void;
    onClose: () => void;
}): React.JSX.Element {
    const [path, setPath] = React.useState(props.defaultPath);
    const [onlySelected, setOnlySelected] = React.useState(props.selection.length > 0);
    const errors = validateBasePath(path);
    const root = props.sourceRoot;
    return (
        <Dialog
            open
            fullWidth
            maxWidth="sm"
            onClose={props.onClose}
        >
            <DialogTitle>{t('createMode')}</DialogTitle>
            <DialogContent>
                <DialogContentText>{t('basePathHelp')}</DialogContentText>
                <TextField
                    autoFocus
                    fullWidth
                    margin="normal"
                    label={t('basePath')}
                    value={path}
                    onChange={e => setPath(e.target.value.trim())}
                    error={errors.length > 0}
                    helperText={errors.map(e => formatMessage(e, language())).join(', ') || `${root}.… → ${path}.…`}
                />
                {props.selection.length > 0 && (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={onlySelected}
                                onChange={e => setOnlySelected(e.target.checked)}
                            />
                        }
                        label={t('mirrorSelection', { n: props.selection.length })}
                    />
                )}
                {props.error && <Alert severity="error">{props.error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={errors.length > 0}
                    onClick={() => props.onMirror(path, root, onlySelected ? props.selection : undefined)}
                >
                    {t('mirror')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
