/*
 * Adapter settings per value (SO-04, SO-08) - like the custom dialog of the admin: every installed
 * adapter that supports settings per state shows its own form, described by its admin/jsonCustom.json.
 * Supported: checkbox, text, number, select, autocomplete, header, staticText, divider, panel, pattern,
 * objectId, slider, color, password - with hidden/disabled/default/defaultFunc. Other fields fall back to JSON.
 */
import {
    Checkbox,
    Collapse,
    FormControlLabel,
    IconButton,
    MenuItem,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React from 'react';
import type { Connection } from '../connection';
import { language, t } from '../i18n';
import { HISTORY_ADAPTERS, type ObjInfo, type TargetOptions } from '../model';
import type { InstanceInfo } from './ObjectTree';

interface Item {
    type?: string;
    label?: unknown;
    text?: unknown;
    help?: unknown;
    /** Panel: named items (a table has an array of columns here, see TableField) */
    items?: Record<string, Item>;
    options?: { value: unknown; label: unknown }[];
    default?: unknown;
    defaultFunc?: string;
    hidden?: string | boolean;
    disabled?: string | boolean;
    pattern?: string;
    min?: number;
    max?: number;
    step?: number;
    newLine?: boolean;
    xs?: number;
    sm?: number;
}

/** Column of a table field */
interface TableColumn {
    type?: string;
    attr: string;
    title?: unknown;
    width?: string;
    default?: unknown;
    options?: { value: unknown; label: unknown }[];
}

interface Schema {
    schema: Item;
    i18n: Record<string, string>;
}

/**
 * Text of a value for an input - objects as JSON
 *
 * @param v - value
 */
function asString(v: unknown): string {
    if (v === undefined || v === null) {
        return '';
    }
    // primitives only - objects are JSON
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const schemas = new Map<string, Promise<Schema | null>>();

/**
 * Loads jsonCustom.json and the translations of an adapter (cached)
 *
 * @param socket - connection
 * @param adapter - adapter name, e.g. history
 */
function loadSchema(socket: Connection, adapter: string): Promise<Schema | null> {
    const key = `${adapter}|${language()}`;
    let p = schemas.get(key);
    if (!p) {
        p = (async () => {
            const text = await socket.readFile(`${adapter}.admin`, 'jsonCustom.json').catch(() => null);
            if (!text) {
                return null;
            }
            let schema: Item;
            try {
                schema = JSON.parse(text) as Item;
            } catch {
                return null;
            }
            let i18n: Record<string, string> = {};
            const inline = (schema as { i18n?: unknown }).i18n;
            if (inline && typeof inline === 'object') {
                // translations inside jsonCustom.json: { "Label": { "en": …, "de": … } } (e.g. telegram)
                for (const [k, v] of Object.entries(inline as Record<string, Record<string, string>>)) {
                    const tr = v?.[language()] ?? v?.en;
                    if (tr) {
                        i18n[k] = tr;
                    }
                }
            } else if (inline === true) {
                for (const file of [`i18n/${language()}.json`, `i18n/${language()}/translations.json`]) {
                    const tr = await socket.readFile(`${adapter}.admin`, file).catch(() => null);
                    if (tr) {
                        try {
                            i18n = JSON.parse(tr) as Record<string, string>;
                            break;
                        } catch {
                            // next file
                        }
                    }
                }
            }
            return { schema, i18n };
        })();
        schemas.set(key, p);
    }
    return p;
}

interface Context {
    data: Record<string, unknown>;
    customObj: ObjInfo & { _id: string };
    instanceObj: ObjInfo;
}

/**
 * Evaluates an expression of jsonCustom (`!data.enabled`, defaultFunc, …) like the admin does
 *
 * @param expr - expression
 * @param ctx - data, customObj, instanceObj
 */
function evaluate(expr: string | boolean | undefined, ctx: Context): unknown {
    if (typeof expr === 'boolean' || expr === undefined) {
        return expr;
    }
    try {
        // jsonCustom expressions come from the installed adapters, the admin evaluates them the same way
        const fn = new Function(
            'data',
            'originalData',
            '_system',
            'instanceObj',
            'customObj',
            'globalData',
            '_changed',
            'arrayIndex',
            `return ${expr.trim().replace(/;$/, '')};`,
        );
        return fn(ctx.data, ctx.data, {}, ctx.instanceObj, ctx.customObj, {}, false, 0);
    } catch {
        return undefined;
    }
}

/**
 * Default values of a form - what the admin sets when the adapter is switched on
 *
 * @param item - schema
 * @param ctx - context (data is filled while walking)
 */
export function defaultsOf(item: Item, ctx: Context): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const walk = (items: Record<string, Item> | undefined): void => {
        for (const [key, it] of Object.entries(items ?? {})) {
            if (it.items && !Array.isArray(it.items)) {
                walk(it.items);
            }
            if (
                key.startsWith('_') ||
                ['header', 'staticText', 'divider', 'panel', 'pattern'].includes(it.type ?? '')
            ) {
                continue;
            }
            if (it.defaultFunc) {
                result[key] = evaluate(it.defaultFunc, { ...ctx, data: result });
            } else if (it.default !== undefined) {
                result[key] = it.default;
            }
        }
    };
    walk(item.items);
    return result;
}

/**
 * Table field of jsonCustom (e.g. influxdb custom tags, lovelace attributes): rows with columns
 *
 * @param props
 * @param props.label
 * @param props.help
 * @param props.columns
 * @param props.value
 * @param props.tr
 * @param props.onChange
 */
function TableField(props: {
    label: string;
    help?: string;
    columns: TableColumn[];
    value: Record<string, unknown>[];
    tr: (text: unknown) => string;
    onChange: (rows: Record<string, unknown>[]) => void;
}): React.JSX.Element {
    const rows = props.value;
    const update = (i: number, attr: string, v: unknown): void =>
        props.onChange(rows.map((r, j) => (j === i ? { ...r, [attr]: v } : r)));
    const newRow = (): Record<string, unknown> =>
        Object.fromEntries(props.columns.map(c => [c.attr, c.default ?? (c.type === 'checkbox' ? false : '')]));
    return (
        <div className="om-form-table">
            {props.label && <Typography variant="subtitle2">{props.label}</Typography>}
            {props.help && <div className="om-muted">{props.help}</div>}
            <table className="om-table">
                <thead>
                    <tr>
                        {props.columns.map(c => (
                            <th key={c.attr}>{props.tr(c.title) || c.attr}</th>
                        ))}
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>
                            {props.columns.map(c => (
                                <td key={c.attr}>
                                    {c.type === 'checkbox' ? (
                                        <Checkbox
                                            size="small"
                                            checked={!!row[c.attr]}
                                            onChange={e => update(i, c.attr, e.target.checked)}
                                        />
                                    ) : c.type === 'select' ? (
                                        <TextField
                                            select
                                            size="small"
                                            fullWidth
                                            variant="standard"
                                            value={JSON.stringify(row[c.attr] ?? '')}
                                            onChange={e => update(i, c.attr, JSON.parse(e.target.value))}
                                        >
                                            {(c.options ?? []).map(o => (
                                                <MenuItem
                                                    key={JSON.stringify(o.value)}
                                                    value={JSON.stringify(o.value)}
                                                >
                                                    {props.tr(o.label)}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                    ) : (
                                        <TextField
                                            size="small"
                                            fullWidth
                                            variant="standard"
                                            type={c.type === 'number' ? 'number' : 'text'}
                                            value={asString(row[c.attr])}
                                            onChange={e =>
                                                update(
                                                    i,
                                                    c.attr,
                                                    c.type === 'number' && e.target.value !== ''
                                                        ? Number(e.target.value)
                                                        : e.target.value,
                                                )
                                            }
                                        />
                                    )}
                                </td>
                            ))}
                            <td>
                                <IconButton
                                    size="small"
                                    onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
                                >
                                    ✕
                                </IconButton>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <IconButton
                size="small"
                onClick={() => props.onChange([...rows, newRow()])}
            >
                +
            </IconButton>
        </div>
    );
}

function JsonForm(props: {
    schema: Schema;
    ctx: Context;
    onChange: (data: Record<string, unknown>) => void;
    onPick?: (done: (id: string) => void) => void;
}): React.JSX.Element {
    const { ctx } = props;
    const tr = (text: unknown): string => {
        if (text === undefined || text === null) {
            return '';
        }
        if (typeof text === 'object') {
            const o = text as Record<string, string>;
            return o[language()] ?? o.en ?? Object.values(o)[0] ?? '';
        }
        const key = typeof text === 'string' ? text : JSON.stringify(text);
        return props.schema.i18n[key] ?? key;
    };
    const set = (key: string, value: unknown): void => props.onChange({ ...ctx.data, [key]: value });

    const render = (items: Record<string, Item> | undefined): React.ReactNode[] =>
        Object.entries(items ?? {}).map(([key, it]) => {
            if (evaluate(it.hidden, ctx) === true || (typeof it.hidden === 'string' && evaluate(it.hidden, ctx))) {
                return null;
            }
            const disabled = !!evaluate(it.disabled, ctx);
            const value = ctx.data[key];
            const label = tr(it.label);
            const help = tr(it.help) || undefined;
            switch (it.type) {
                case 'panel':
                    return <React.Fragment key={key}>{render(it.items)}</React.Fragment>;
                case 'header':
                    return (
                        <Typography
                            key={key}
                            variant="subtitle2"
                            sx={{ mt: 1 }}
                        >
                            {tr(it.text)}
                        </Typography>
                    );
                case 'staticText':
                    return (
                        <div
                            key={key}
                            className="om-muted"
                        >
                            {tr(it.text) || label}
                        </div>
                    );
                case 'divider':
                    return <hr key={key} />;
                case 'checkbox':
                    return (
                        <FormControlLabel
                            key={key}
                            disabled={disabled}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={!!value}
                                    onChange={e => set(key, e.target.checked)}
                                />
                            }
                            label={label}
                            title={help}
                        />
                    );
                case 'select':
                    return (
                        <TextField
                            key={key}
                            select
                            size="small"
                            fullWidth
                            margin="dense"
                            disabled={disabled}
                            label={label}
                            helperText={help}
                            value={(it.options ?? []).some(o => o.value === value) ? JSON.stringify(value) : ''}
                            onChange={e => set(key, JSON.parse(e.target.value))}
                        >
                            {(it.options ?? []).map(o => (
                                <MenuItem
                                    key={JSON.stringify(o.value)}
                                    value={JSON.stringify(o.value)}
                                >
                                    {tr(o.label)}
                                </MenuItem>
                            ))}
                        </TextField>
                    );
                case 'table':
                    return (
                        <TableField
                            key={key}
                            label={label}
                            help={help}
                            columns={(it.items as unknown as TableColumn[]) ?? []}
                            value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
                            tr={tr}
                            onChange={rows => set(key, rows)}
                        />
                    );
                case 'pattern': {
                    const text = (it.pattern ?? '').replace(/\$\{([^}]+)\}/g, (_, e: string) =>
                        asString(evaluate(e, ctx)),
                    );
                    return (
                        <TextField
                            key={key}
                            size="small"
                            fullWidth
                            margin="dense"
                            disabled
                            label={label}
                            value={text}
                        />
                    );
                }
                case 'number':
                case 'slider':
                    return (
                        <TextField
                            key={key}
                            size="small"
                            fullWidth
                            margin="dense"
                            type="number"
                            disabled={disabled}
                            label={label}
                            helperText={help}
                            slotProps={{ htmlInput: { min: it.min, max: it.max, step: it.step } }}
                            value={value ?? ''}
                            onChange={e => set(key, e.target.value === '' ? undefined : Number(e.target.value))}
                        />
                    );
                case 'objectId':
                    return (
                        <div
                            key={key}
                            className="om-row-fields"
                        >
                            <TextField
                                size="small"
                                fullWidth
                                margin="dense"
                                disabled={disabled}
                                label={label}
                                helperText={help}
                                value={asString(value)}
                                onChange={e => set(key, e.target.value)}
                            />
                            {props.onPick && !disabled && (
                                <IconButton
                                    size="small"
                                    title={t('pickObject')}
                                    onClick={() => props.onPick!(id => set(key, id))}
                                >
                                    🔍
                                </IconButton>
                            )}
                        </div>
                    );
                case 'text':
                case 'autocomplete':
                case 'color':
                case 'password':
                case undefined:
                    return (
                        <TextField
                            key={key}
                            size="small"
                            fullWidth
                            margin="dense"
                            type={it.type === 'password' ? 'password' : 'text'}
                            disabled={disabled}
                            label={label}
                            helperText={help}
                            value={asString(value)}
                            onChange={e => set(key, e.target.value)}
                        />
                    );
                default:
                    // fields the editor cannot show (sendTo, tables, …) - keep their value
                    return null;
            }
        });

    return <div className="om-form">{render(props.schema.schema.items)}</div>;
}

function JsonFallback(props: {
    data: Record<string, unknown>;
    onChange: (d: Record<string, unknown>) => void;
}): React.JSX.Element {
    const [text, setText] = React.useState(JSON.stringify(props.data, null, 1));
    const [error, setError] = React.useState(false);
    return (
        <TextField
            size="small"
            fullWidth
            multiline
            margin="dense"
            label={t('noForm')}
            value={text}
            error={error}
            onChange={e => setText(e.target.value)}
            onBlur={() => {
                try {
                    props.onChange(JSON.parse(text) as Record<string, unknown>);
                    setError(false);
                } catch {
                    setError(true);
                }
            }}
        />
    );
}

/**
 * One adapter instance with switch and form
 *
 * @param props
 * @param props.socket
 * @param props.instanceKey
 * @param props.info
 * @param props.missing
 * @param props.data
 * @param props.active
 * @param props.fromSource
 * @param props.overridden
 * @param props.customObj
 * @param props.onToggle
 * @param props.onChange
 * @param props.onPick
 */
function AdapterBlock(props: {
    socket: Connection;
    instanceKey: string;
    info: InstanceInfo;
    /** The instance is not installed */
    missing: boolean;
    data: Record<string, unknown>;
    active: boolean;
    fromSource: boolean;
    overridden: boolean;
    customObj: Context['customObj'];
    onToggle: (on: boolean, defaults: Record<string, unknown>) => void;
    onChange: (data: Record<string, unknown>) => void;
    onPick?: (done: (id: string) => void) => void;
}): React.JSX.Element {
    const adapter = props.instanceKey.split('.')[0];
    const [open, setOpen] = React.useState(false);
    const [schema, setSchema] = React.useState<Schema | null | undefined>(undefined);
    React.useEffect(() => {
        let cancelled = false;
        void loadSchema(props.socket, adapter).then(s => !cancelled && setSchema(s));
        return () => {
            cancelled = true;
        };
    }, [props.socket, adapter]);
    const ctx: Context = {
        data: props.data,
        customObj: props.customObj,
        instanceObj: { type: 'instance', common: {}, native: props.info.native ?? {} },
    };
    return (
        <div className={`om-adapter ${props.active ? 'om-adapter-on' : ''}`}>
            <div className="om-adapter-head">
                <Switch
                    size="small"
                    checked={props.active}
                    onChange={e => {
                        const defaults = schema ? defaultsOf(schema.schema, ctx) : {};
                        props.onToggle(e.target.checked, defaults);
                        if (e.target.checked) {
                            setOpen(true);
                        }
                    }}
                />
                {props.info.icon ? (
                    <img
                        src={props.info.icon}
                        alt=""
                        className="om-adapter-icon"
                    />
                ) : null}
                <span
                    className="om-adapter-name"
                    onClick={() => setOpen(!open)}
                >
                    {props.instanceKey}
                    {props.missing ? (
                        <span className="om-muted"> ({t('notInstalled')})</span>
                    ) : (
                        !props.info.enabled && <span className="om-muted"> ({t('instanceOff')})</span>
                    )}
                    {props.fromSource && <span className="om-chip">{t('fromSource')}</span>}
                    {props.overridden && <span className="om-dot om-dot-override" />}
                </span>
                <IconButton
                    size="small"
                    onClick={() => setOpen(!open)}
                >
                    {open ? '▴' : '▾'}
                </IconButton>
            </div>
            <Collapse in={open && props.active}>
                {schema ? (
                    <JsonForm
                        schema={schema}
                        ctx={ctx}
                        onChange={props.onChange}
                        onPick={props.onPick}
                    />
                ) : schema === null ? (
                    <JsonFallback
                        data={props.data}
                        onChange={props.onChange}
                    />
                ) : null}
            </Collapse>
        </div>
    );
}

/**
 * All adapters with settings per state - for one target value
 *
 * @param props
 * @param props.socket
 * @param props.targetId
 * @param props.target
 * @param props.source
 * @param props.instances
 * @param props.options
 * @param props.onOptions
 * @param props.onPickObject
 * @param props.pickStart
 */
export function AdapterSettings(props: {
    socket: Connection;
    targetId: string;
    /** Target object (draft or existing) */
    target?: ObjInfo;
    /** Source the settings are taken from */
    source?: ObjInfo;
    instances: Record<string, InstanceInfo>;
    options: TargetOptions;
    onOptions: (patch: Partial<TargetOptions>) => void;
    onPickObject?: (start: string, done: (id: string) => void) => void;
    pickStart?: string;
}): React.JSX.Element {
    const sourceCustom = (props.source?.common?.custom ?? {}) as Record<string, Record<string, unknown> | null>;
    const targetCustom = (props.target?.common?.custom ?? {}) as Record<string, Record<string, unknown> | null>;
    const overrides = props.options.overrides ?? {};
    const exclude = props.options.exclude ?? [];
    // installed adapters with settings per state, plus keys of source/target that are not installed
    const keys = [
        ...new Set([
            ...Object.entries(props.instances)
                .filter(([, i]) => i.supportCustoms)
                .map(([k]) => k),
            ...Object.keys(sourceCustom),
            ...Object.keys(targetCustom),
            ...Object.keys(overrides),
        ]),
    ].sort();
    const customObj = { _id: props.targetId, type: 'state', common: { ...(props.target?.common ?? {}) } };

    const setOverride = (
        key: string,
        value: Record<string, unknown> | undefined,
        excluded = exclude.includes(key),
    ): void => {
        const next = { ...overrides };
        if (value) {
            next[key] = value;
        } else {
            delete next[key];
        }
        const nextExclude = excluded ? [...new Set([...exclude, key])] : exclude.filter(k => k !== key);
        props.onOptions({ overrides: next, exclude: nextExclude });
    };

    return (
        <div>
            <div className="om-muted">{t('adaptersHelp')}</div>
            {keys.map(key => {
                const fromSource = !!sourceCustom[key] && !exclude.includes(key);
                const existing = targetCustom[key] ?? undefined;
                const base: Record<string, unknown> = {
                    ...(existing ?? {}),
                    ...(fromSource ? sourceCustom[key] : {}),
                    ...(fromSource && HISTORY_ADAPTERS.includes(key.split('.')[0]) ? { aliasId: '' } : {}),
                };
                // like the backend: an active setting at the target is not switched off by the source
                if (existing?.enabled === true) {
                    base.enabled = true;
                }
                const data = { ...base, ...(overrides[key] ?? {}) };
                const has = fromSource || !!existing || !!overrides[key];
                const active = has && !exclude.includes(key) && data.enabled !== false;
                return (
                    <AdapterBlock
                        key={key}
                        socket={props.socket}
                        instanceKey={key}
                        info={props.instances[key] ?? { enabled: false, title: key }}
                        missing={!props.instances[key]}
                        data={data}
                        active={active}
                        fromSource={fromSource}
                        overridden={!!overrides[key]}
                        customObj={customObj}
                        onToggle={(on, defaults) => {
                            if (on) {
                                setOverride(
                                    key,
                                    has ? { ...overrides[key], enabled: true } : { ...defaults, enabled: true },
                                    false,
                                );
                            } else if (existing) {
                                // switch off an existing setting at the target
                                setOverride(key, { ...overrides[key], enabled: false }, false);
                            } else if (sourceCustom[key]) {
                                setOverride(key, undefined, true);
                            } else {
                                setOverride(key, undefined, false);
                            }
                        }}
                        onChange={d => setOverride(key, { ...d, enabled: true }, false)}
                        onPick={
                            props.onPickObject
                                ? done =>
                                      props.onPickObject!(
                                          props.pickStart ?? props.targetId.split('.').slice(0, 2).join('.'),
                                          done,
                                      )
                                : undefined
                        }
                    />
                );
            })}
        </div>
    );
}
