import { Button, Checkbox, FormControlLabel, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import React from 'react';
import { isConverting } from '../../../src/lib/alias/converter';
import { normalizeIdPart } from '../../../src/lib/alias/createMode';
import type { Connection } from '../connection';
import { language, t } from '../i18n';
import {
    aliasReadId,
    compat,
    converterOf,
    nodeName,
    overlapOf,
    sourcesOf,
    type EditorState,
    type ObjInfo,
    type OverlapRule,
    type TargetOptions,
    type TreeNode,
    type ValueConverter,
} from '../model';
import { AdapterSettings } from './AdapterSettings';
import { ConverterEditor } from './ConverterEditor';
import { DbNamesOf } from './DbNamesView';
import { HelpButton, HelpTopics } from './Help';
import { CustomIcons, type InstanceInfo } from './ObjectTree';

/** Props of the panel */
export interface PropertiesPanelProps {
    socket: Connection;
    side: 'source' | 'target';
    node: TreeNode;
    state: EditorState;
    /** Objects of both sides and further loaded sources */
    objects: Record<string, ObjInfo>;
    values: Record<string, ioBroker.State | null | undefined>;
    instances: Record<string, InstanceInfo>;
    onRename: (oldId: string, newId: string) => void;
    onUpdateDraft: (id: string, patch: Record<string, unknown>) => void;
    onRemoveDraft: (id: string) => void;
    onAddNode: (parentId: string, type: 'folder' | 'channel' | 'device') => void;
    onAddState: (parentId: string) => void;
    onSaveTemplate: (nodeId: string) => void;
    onOptions: (targetId: string, patch: Partial<TargetOptions>) => void;
    onLink: (sourceId: string, targetId: string) => void;
    onUnlink: (sourceId: string, targetId: string) => void;
    onSelect: (side: 'source' | 'target', id: string) => void;
    onShowHistory: (id: string) => void;
    /** read the existing alias mappings of a node in (FR-56) */
    onImport?: (id: string) => void;
    /** change the DB name (aliasId) of the object at a logging instance (FR-57) */
    onDbName?: (id: string, instance: string, current: string) => void;
    /** Names of the rooms/functions an object is member of */
    enumsOf: (id: string) => string[];
    /** Opens the object picker; the callback gets the chosen ID */
    onPickObject: (start: string, done: (id: string) => void) => void;
    /** Start path of the object picker (root of the source tree) */
    pickStart: string;
}

/** "?" at the buttons "+ Neuer Wert/Kanal/Ordner/Gerät": what they create (EM-12) */
function NewObjectsHelp(): React.JSX.Element {
    return (
        <HelpButton
            title={t('helpNewTitle')}
            tooltip={t('helpNewTip')}
        >
            <HelpTopics
                topics={[
                    { head: t('hnValue'), points: [t('hnValue1'), t('hnValue2'), t('hnValue3')] },
                    { head: t('hnChannel'), points: [t('hnChannel1')] },
                    { head: t('hnFolder'), points: [t('hnFolder1')] },
                    { head: t('hnDevice'), points: [t('hnDevice1')] },
                    { head: t('hnAll'), points: [t('hnAll1'), t('hnAll2'), t('hnAll3'), t('hnAll4')] },
                ]}
            />
        </HelpButton>
    );
}

const asText = (v: unknown): string =>
    // objects as JSON, the rest are primitives
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

function Field(props: {
    label: string;
    value: unknown;
    onChange: (v: string) => void;
    type?: string;
}): React.JSX.Element {
    const [text, setText] = React.useState(asText(props.value));
    React.useEffect(() => setText(asText(props.value)), [props.value]);
    return (
        <TextField
            size="small"
            fullWidth
            margin="dense"
            label={props.label}
            type={props.type}
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => text !== asText(props.value) && props.onChange(text)}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
    );
}

/**
 * Collapsible section of the panel
 *
 * @param props
 * @param props.title
 * @param props.open
 * @param props.badge
 * @param props.children
 */
function Section(props: {
    title: string;
    open?: boolean;
    badge?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    const [open, setOpen] = React.useState(props.open ?? true);
    return (
        <div className="om-section">
            <div
                className="om-section-head"
                onClick={() => setOpen(!open)}
            >
                <span>{open ? '▾' : '▸'}</span> <b>{props.title}</b>
                {props.badge && <span className="om-chip">{props.badge}</span>}
            </div>
            {open && <div className="om-section-body">{props.children}</div>}
        </div>
    );
}

/** Short info in the head of a collapsed adapter section */
function customSummary(key: string, value: Record<string, unknown>): string {
    const adapter = key.split('.')[0];
    if (adapter === 'lovelace' && value.name) {
        return `${asText(value.entity) || 'sensor'}.${asText(value.name)}`;
    }
    if (['history', 'sql', 'influxdb'].includes(adapter) && value.retention !== undefined && value.retention !== '') {
        const seconds = Number(value.retention);
        return seconds > 0 ? t('retentionDays', { n: Math.round(seconds / 86400) }) : t('retentionForever');
    }
    return '';
}

/**
 * Adapter settings of a source state: one collapsible section per instance, the fields as a list
 * (read only - they are edited at the target)
 *
 * @param props - component props
 * @param props.instanceKey - e.g. history.0
 * @param props.value - the settings
 * @param props.instances - status and icons of the instances
 */
function SourceCustom(props: {
    instanceKey: string;
    value: Record<string, unknown> | null;
    instances: Record<string, InstanceInfo>;
}): React.JSX.Element {
    const [open, setOpen] = React.useState(false);
    const value = props.value ?? {};
    const enabled = value.enabled !== false;
    // "0": "", "1": "" are leftovers of the admin dialog
    const fields = Object.entries(value).filter(([k, v]) => !(/^\d+$/.test(k) && v === ''));
    const summary = customSummary(props.instanceKey, value);
    return (
        <div className={`om-adapter ${enabled ? 'om-adapter-on' : ''}`}>
            <div
                className="om-adapter-head om-clickable"
                onClick={() => setOpen(!open)}
            >
                <CustomIcons
                    obj={{ type: 'state', common: { custom: { [props.instanceKey]: value } } }}
                    instances={props.instances}
                />
                <span className="om-adapter-name">
                    <b>{props.instanceKey}</b>
                    {!enabled && <span className="om-chip">{t('customOff')}</span>}
                    {summary && <span className="om-muted om-ellipsis">{summary}</span>}
                </span>
                <span className="om-muted">{open ? '▴' : '▾'}</span>
            </div>
            {open && (
                <table className="om-kv">
                    <tbody>
                        {fields.map(([k, v]) => (
                            <tr key={k}>
                                <td>{k}</td>
                                <td className={asText(v) === '' ? 'om-muted' : ''}>{asText(v) || '–'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

/**
 * The current mapping of an existing alias (UC-7a): where it reads and writes, its formulas
 *
 * @param props - component props
 * @param props.alias - `common.alias` of the object
 * @param props.imported - the mapping is read into the plan
 * @param props.onSelect - show a source in the left tree
 * @param props.onImport - read this mapping in (only without links)
 */
function AliasNow(props: {
    alias: unknown;
    imported: boolean;
    onSelect: (id: string) => void;
    onImport?: () => void;
}): React.JSX.Element | null {
    const alias = props.alias as { id?: unknown; read?: unknown; write?: unknown } | undefined;
    const read = aliasReadId(alias?.id);
    if (!read) {
        return null;
    }
    const write = alias?.id && typeof alias.id === 'object' ? (alias.id as { write?: unknown }).write : undefined;
    const link = (id: string): React.JSX.Element => (
        <a
            href="#"
            onClick={e => {
                e.preventDefault();
                props.onSelect(id);
            }}
        >
            {id}
        </a>
    );
    return (
        <div className="om-alias-now">
            <div>
                <span className="om-muted">{t('aliasPointsTo')} </span>
                {link(read)}
                {props.imported && <span className="om-chip">{t('importedChip')}</span>}
            </div>
            {typeof write === 'string' && write !== read && (
                <div>
                    <span className="om-muted">{t('aliasWriteTo')} </span>
                    {link(write)}
                </div>
            )}
            {typeof alias?.read === 'string' && alias.read && <code>read: {alias.read}</code>}
            {typeof alias?.write === 'string' && alias.write && <code>write: {alias.write}</code>}
            {props.onImport && (
                <Button
                    size="small"
                    onClick={props.onImport}
                    title={t('importAliasesHelp')}
                >
                    ⇠ {t('importAliases')}
                </Button>
            )}
        </div>
    );
}

const toDateInput = (ts: number): string => {
    const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
    return d.toISOString().slice(0, 16);
};

function ManualSource(props: { onLink: (id: string) => void; onPick: () => void }): React.JSX.Element {
    const [id, setId] = React.useState('');
    const link = (): void => {
        if (id) {
            props.onLink(id);
            setId('');
        }
    };
    return (
        <div className="om-row-fields">
            <TextField
                size="small"
                margin="dense"
                fullWidth
                label={t('manualSource')}
                value={id}
                onChange={e => setId(e.target.value.trim())}
                onKeyDown={e => e.key === 'Enter' && link()}
            />
            <Tooltip title={t('pickObject')}>
                <IconButton
                    size="small"
                    onClick={props.onPick}
                >
                    🔍
                </IconButton>
            </Tooltip>
            <Button
                size="small"
                disabled={!id}
                onClick={link}
            >
                ↔
            </Button>
        </div>
    );
}

/**
 * Details and options of the selected row (EM-06, ME-15, SO-04)
 *
 * @param props
 */
export function PropertiesPanel(props: PropertiesPanelProps): React.JSX.Element {
    const { node, state } = props;
    const lang = language();
    const common = node.obj?.common ?? {};
    const isState = node.type === 'state';

    // ---- source row
    if (props.side === 'source') {
        const link = state.links.find(l => l.sourceId === node.id);
        return (
            <div className="om-panel">
                <h3>{nodeName(node, lang)}</h3>
                <div className="om-id">{node.id}</div>
                <div className="om-muted">
                    {node.type} {common.role ? `· ${common.role}` : ''} {common.type ? `· ${common.type}` : ''}{' '}
                    {common.unit ? `· ${common.unit}` : ''}
                </div>
                {isState && (
                    <DbNamesOf
                        custom={common.custom as Record<string, unknown> | undefined}
                        onChange={
                            props.onDbName
                                ? (instance, current) => props.onDbName!(node.id, instance, current)
                                : undefined
                        }
                    />
                )}
                {Object.entries((common.custom ?? {}) as Record<string, Record<string, unknown> | null>).map(
                    ([key, value]) => (
                        <SourceCustom
                            key={key}
                            instanceKey={key}
                            value={value}
                            instances={props.instances}
                        />
                    ),
                )}
                {link && (
                    <p>
                        →{' '}
                        <a
                            href="#"
                            onClick={e => {
                                e.preventDefault();
                                props.onSelect('target', link.targetId);
                            }}
                        >
                            {link.targetId}
                        </a>
                    </p>
                )}
                {isState && <Button onClick={() => props.onShowHistory(node.id)}>📈 {t('showHistory')}</Button>}
            </div>
        );
    }

    // ---- target row
    const sources = sourcesOf(state, node.id);
    const opts = state.options[node.id] ?? {};
    const overlap = overlapOf(state, node.id);
    const settingsFrom = opts.settingsFrom && sources.includes(opts.settingsFrom) ? opts.settingsFrom : sources[0];
    const parentId = node.id.slice(0, node.id.lastIndexOf('.'));
    const isAlias = node.id.startsWith('alias.');
    const setOverlap = (rule: OverlapRule): void => props.onOptions(node.id, { overlap: rule });
    const overlapValue =
        overlap.type === 'prefer' ? `prefer:${overlap.sourceId}` : overlap.type === 'cut' ? 'cut' : overlap.type;
    const live = opts.liveSource && sources.includes(opts.liveSource) ? opts.liveSource : sources.at(-1);
    const setConverter = (sourceId: string, c: ValueConverter | undefined): void => {
        const converters = { ...opts.converters };
        if (c) {
            converters[sourceId] = c;
        } else {
            delete converters[sourceId];
        }
        // the template conversion is used up once a source has its own
        delete converters['*'];
        props.onOptions(node.id, { converters });
        // the type of a new value follows the conversion of the live source
        if (node.draft && sourceId === live && c?.to) {
            props.onUpdateDraft(node.id, { type: c.to });
        }
    };

    return (
        <div className="om-panel">
            <div className="om-panel-title">
                <h3>{nodeName(node, lang)}</h3>
                {!isState && isAlias && !node.draft && props.onImport && (
                    <Tooltip title={t('importAliasesHelp')}>
                        <Button
                            size="small"
                            onClick={() => props.onImport!(node.id)}
                        >
                            ⇠ {t('importAliases')}
                        </Button>
                    </Tooltip>
                )}
                {!isState && (
                    <Tooltip title={t('saveTemplate')}>
                        <IconButton
                            size="small"
                            onClick={() => props.onSaveTemplate(node.id)}
                        >
                            ★
                        </IconButton>
                    </Tooltip>
                )}
                {node.draft && (
                    <Tooltip title={t('remove')}>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => props.onRemoveDraft(node.id)}
                        >
                            🗑
                        </IconButton>
                    </Tooltip>
                )}
            </div>
            <div className="om-id">{node.id}</div>
            {isState && !node.draft && (
                <DbNamesOf
                    custom={common.custom as Record<string, unknown> | undefined}
                    onChange={
                        props.onDbName ? (instance, current) => props.onDbName!(node.id, instance, current) : undefined
                    }
                />
            )}

            {/* ---- the object itself */}
            {(node.draft || (!isState && isAlias)) && (
                <Section title={t('object')}>
                    {node.draft && (
                        <>
                            <Field
                                label={t('idPart')}
                                value={node.part}
                                onChange={v => {
                                    const part = normalizeIdPart(v);
                                    if (part) {
                                        props.onRename(node.id, `${parentId}.${part}`);
                                    }
                                }}
                            />
                            <Field
                                label={t('name')}
                                value={typeof common.name === 'string' ? common.name : nodeName(node, lang)}
                                onChange={v => props.onUpdateDraft(node.id, { name: v })}
                            />
                        </>
                    )}
                    {node.draft && isState && (
                        <>
                            <div className="om-row-fields">
                                <Field
                                    label={t('role')}
                                    value={common.role}
                                    onChange={v => props.onUpdateDraft(node.id, { role: v || undefined })}
                                />
                                <Field
                                    label={t('unit')}
                                    value={common.unit}
                                    onChange={v => props.onUpdateDraft(node.id, { unit: v || undefined })}
                                />
                            </div>
                            <TextField
                                select
                                size="small"
                                fullWidth
                                margin="dense"
                                label={t('type')}
                                value={common.type ?? 'mixed'}
                                onChange={e => props.onUpdateDraft(node.id, { type: e.target.value })}
                            >
                                {['number', 'string', 'boolean', 'mixed', 'object', 'array', 'json'].map(x => (
                                    <MenuItem
                                        key={x}
                                        value={x}
                                    >
                                        {x}
                                    </MenuItem>
                                ))}
                            </TextField>
                            <div className="om-row-fields">
                                <Field
                                    label={t('min')}
                                    type="number"
                                    value={common.min}
                                    onChange={v =>
                                        props.onUpdateDraft(node.id, { min: v === '' ? undefined : Number(v) })
                                    }
                                />
                                <Field
                                    label={t('max')}
                                    type="number"
                                    value={common.max}
                                    onChange={v =>
                                        props.onUpdateDraft(node.id, { max: v === '' ? undefined : Number(v) })
                                    }
                                />
                            </div>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        size="small"
                                        checked={common.read !== false}
                                        onChange={e => props.onUpdateDraft(node.id, { read: e.target.checked })}
                                    />
                                }
                                label={t('read')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        size="small"
                                        checked={!!common.write}
                                        onChange={e => props.onUpdateDraft(node.id, { write: e.target.checked })}
                                    />
                                }
                                label={t('writeable')}
                            />
                        </>
                    )}
                    {!isState && isAlias && (
                        <div className="om-buttons">
                            <Tooltip title={t('newValueTip')}>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => props.onAddState(node.id)}
                                >
                                    + {t('newValue')}
                                </Button>
                            </Tooltip>
                            {(
                                [
                                    ['channel', 'newChannel', 'newChannelTip'],
                                    ['folder', 'newFolder', 'newFolderTip'],
                                    ['device', 'newDevice', 'newDeviceTip'],
                                ] as const
                            ).map(([type, label, tip]) => (
                                <Tooltip
                                    key={type}
                                    title={t(tip)}
                                >
                                    <Button
                                        size="small"
                                        onClick={() => props.onAddNode(node.id, type)}
                                    >
                                        + {t(label)}
                                    </Button>
                                </Tooltip>
                            ))}
                            <NewObjectsHelp />
                        </div>
                    )}
                </Section>
            )}

            {/* ---- sources with their conversion */}
            {isState && (
                <Section
                    title={t('sources')}
                    badge={sources.length ? String(sources.length) : undefined}
                >
                    {isAlias && !node.draft && (
                        <AliasNow
                            alias={common.alias}
                            imported={!!opts.imported}
                            onSelect={id => props.onSelect('source', id)}
                            onImport={props.onImport && !sources.length ? () => props.onImport!(node.id) : undefined}
                        />
                    )}
                    {!sources.length && <div className="om-muted">{t('noSourceYet')}</div>}
                    {!sources.length && node.draft && isAlias && (
                        <div className="om-muted om-no-source">
                            {t('noSourceDraft')} <NewObjectsHelp />
                        </div>
                    )}
                    {sources.map(id => {
                        const c = compat(props.objects[id], node.obj);
                        const conv = converterOf(state, node.id, id);
                        return (
                            <div
                                key={id}
                                className="om-source-block"
                            >
                                <div className="om-source">
                                    <span className={`om-dot om-compat-${c.level}`} />
                                    <a
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            props.onSelect('source', id);
                                        }}
                                    >
                                        {id}
                                    </a>
                                    {id === live && isAlias && <span className="om-chip">live</span>}
                                    <span
                                        className="om-x"
                                        title={t('unlink')}
                                        onClick={() => props.onUnlink(id, node.id)}
                                    >
                                        ✕
                                    </span>
                                </div>
                                {c.reason && <div className="om-muted">{c.reason}</div>}
                                <Section
                                    title={t('conversion')}
                                    open={isConverting(conv)}
                                    badge={isConverting(conv) ? '✓' : undefined}
                                >
                                    <ConverterEditor
                                        value={conv}
                                        sourceValue={props.values[id]?.val}
                                        sourceStates={
                                            props.objects[id]?.common?.states as Record<string, string> | undefined
                                        }
                                        writeable={!!common.write}
                                        onChange={v => setConverter(id, v)}
                                    />
                                </Section>
                            </div>
                        );
                    })}
                    <ManualSource
                        onLink={id => props.onLink(id, node.id)}
                        onPick={() => props.onPickObject(props.pickStart, id => props.onLink(id, node.id))}
                    />
                    {sources.length > 1 && isAlias && (
                        <TextField
                            select
                            size="small"
                            fullWidth
                            margin="dense"
                            label={t('liveSource')}
                            value={live}
                            onChange={e => props.onOptions(node.id, { liveSource: e.target.value })}
                        >
                            {sources.map(id => (
                                <MenuItem
                                    key={id}
                                    value={id}
                                >
                                    {id}
                                </MenuItem>
                            ))}
                        </TextField>
                    )}
                </Section>
            )}

            {/* ---- history */}
            {isState && sources.length > 0 && (
                <Section title={t('historyTitle')}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                size="small"
                                checked={opts.history !== false}
                                onChange={e => props.onOptions(node.id, { history: e.target.checked })}
                            />
                        }
                        label={t('migrateHistory')}
                    />
                    {opts.history !== false && (
                        <TextField
                            select
                            size="small"
                            fullWidth
                            margin="dense"
                            label={t('overlap')}
                            value={overlapValue}
                            onChange={e => {
                                const v = e.target.value;
                                if (v === 'switch' || v === 'all') {
                                    setOverlap({ type: v });
                                } else if (v === 'cut') {
                                    setOverlap({
                                        type: 'cut',
                                        at: Date.now() - 86400_000,
                                        oldSourceIds: sources.slice(0, -1),
                                    });
                                } else {
                                    setOverlap({ type: 'prefer', sourceId: v.slice('prefer:'.length) });
                                }
                            }}
                        >
                            <MenuItem value="switch">{t('overlapSwitch')}</MenuItem>
                            <MenuItem value="all">{t('overlapAll')}</MenuItem>
                            {sources.map(id => (
                                <MenuItem
                                    key={id}
                                    value={`prefer:${id}`}
                                >
                                    {t('overlapPrefer')}: {id}
                                </MenuItem>
                            ))}
                            <MenuItem value="cut">{t('overlapCut')}</MenuItem>
                        </TextField>
                    )}
                    {opts.history !== false && overlap.type === 'cut' && (
                        <TextField
                            size="small"
                            fullWidth
                            margin="dense"
                            type="datetime-local"
                            value={toDateInput(overlap.at)}
                            onChange={e =>
                                setOverlap({ ...overlap, at: new Date(e.target.value).getTime() || overlap.at })
                            }
                            helperText={`alt: ${overlap.oldSourceIds.join(', ')}`}
                        />
                    )}
                    <Button onClick={() => props.onShowHistory(node.id)}>📈 {t('showHistory')}</Button>
                </Section>
            )}

            {/* ---- adapter settings per value */}
            {isState && (
                <Section title={t('adapters')}>
                    {sources.length > 0 && (
                        <>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        size="small"
                                        checked={opts.settings !== false}
                                        onChange={e => props.onOptions(node.id, { settings: e.target.checked })}
                                    />
                                }
                                label={t('takeSettings')}
                            />
                            {opts.settings !== false && sources.length > 1 && (
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    margin="dense"
                                    label={t('settingsFrom')}
                                    value={settingsFrom}
                                    onChange={e => props.onOptions(node.id, { settingsFrom: e.target.value })}
                                >
                                    {sources.map(id => (
                                        <MenuItem
                                            key={id}
                                            value={id}
                                        >
                                            {id}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            )}
                            {opts.settings !== false && (
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    margin="dense"
                                    label={t('sourceMode')}
                                    helperText={t('sourceModeHelp')}
                                    value={opts.sourceMode ?? 'keep'}
                                    onChange={e =>
                                        props.onOptions(node.id, {
                                            sourceMode: e.target.value as TargetOptions['sourceMode'],
                                        })
                                    }
                                >
                                    <MenuItem value="keep">{t('sourceKeep')}</MenuItem>
                                    <MenuItem value="disable">{t('sourceDisable')}</MenuItem>
                                    <MenuItem value="remove">{t('sourceRemove')}</MenuItem>
                                </TextField>
                            )}
                        </>
                    )}
                    {opts.settings !== false && settingsFrom && props.enumsOf(settingsFrom).length > 0 && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    size="small"
                                    checked={opts.enums !== false}
                                    onChange={e => props.onOptions(node.id, { enums: e.target.checked })}
                                />
                            }
                            label={`${t('takeEnums')}: ${props.enumsOf(settingsFrom).join(', ')}`}
                        />
                    )}
                    {opts.settings !== false && (
                        <AdapterSettings
                            onPickObject={props.onPickObject}
                            pickStart={props.pickStart}
                            socket={props.socket}
                            targetId={node.id}
                            target={node.obj}
                            source={settingsFrom ? props.objects[settingsFrom] : undefined}
                            instances={props.instances}
                            options={opts}
                            onOptions={patch => props.onOptions(node.id, patch)}
                        />
                    )}
                </Section>
            )}
        </div>
    );
}
