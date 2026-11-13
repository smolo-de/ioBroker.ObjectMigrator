import { Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import React from 'react';
import { converterToAlias, convertWith, isConverting, type ValueConverter } from '../../../src/lib/alias/converter';
import { t } from '../i18n';

const tableToText = (map?: ValueConverter['map']): string =>
    Object.entries(map ?? {})
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('\n');

function textToTable(text: string): ValueConverter['map'] {
    const map: Record<string, string | number | boolean> = {};
    for (const line of text.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) {
            const raw = line.slice(i + 1).trim();
            map[line.slice(0, i).trim()] =
                raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
        }
    }
    return Object.keys(map).length ? map : undefined;
}

function preview(c: ValueConverter, val: unknown): string {
    try {
        const out = convertWith(c, val);
        return `${JSON.stringify(val)} → ${JSON.stringify(out)}`;
    } catch (e) {
        return `⚠ ${(e as Error).message}`;
    }
}

/**
 * Conversion of one link: number ↔ text, factor, decimals, value table, own formula
 *
 * @param props
 * @param props.value
 * @param props.sourceValue
 * @param props.sourceStates
 * @param props.writeable
 * @param props.onChange
 */
export function ConverterEditor(props: {
    value?: ValueConverter;
    /** Current value of the source - for the live preview */
    sourceValue?: unknown;
    /** common.states of the source - offered for the value table */
    sourceStates?: Record<string, string>;
    writeable: boolean;
    onChange: (c: ValueConverter | undefined) => void;
}): React.JSX.Element {
    const c = props.value ?? {};
    const [table, setTable] = React.useState(tableToText(c.map));
    const [expert, setExpert] = React.useState(!!c.read);
    const set = (patch: Partial<ValueConverter>): void => {
        const next: ValueConverter = { ...c, ...patch };
        for (const k of Object.keys(next) as (keyof ValueConverter)[]) {
            if (next[k] === undefined || next[k] === '') {
                delete next[k];
            }
        }
        props.onChange(isConverting(next) ? next : undefined);
    };
    const num = (v: string): number | undefined => (v.trim() === '' || isNaN(Number(v)) ? undefined : Number(v));
    const fns = converterToAlias(c, props.writeable);
    const samples = [
        props.sourceValue,
        ...(props.sourceStates ? Object.keys(props.sourceStates).slice(0, 2) : []),
    ].filter(v => v !== undefined && v !== null);

    return (
        <div className="om-conv">
            {!expert && (
                <>
                    <div className="om-row-fields">
                        <TextField
                            select
                            size="small"
                            margin="dense"
                            label={t('convTo')}
                            value={c.to ?? ''}
                            onChange={e => set({ to: (e.target.value || undefined) as ValueConverter['to'] })}
                            sx={{ flex: 1 }}
                        >
                            <MenuItem value="">{t('keepType')}</MenuItem>
                            <MenuItem value="number">{t('toNumber')}</MenuItem>
                            <MenuItem value="string">{t('toText')}</MenuItem>
                            <MenuItem value="boolean">{t('toBoolean')}</MenuItem>
                        </TextField>
                        <TextField
                            size="small"
                            margin="dense"
                            type="number"
                            label={t('decimals')}
                            value={c.decimals ?? ''}
                            onChange={e => set({ decimals: num(e.target.value) })}
                            sx={{ width: 120 }}
                        />
                    </div>
                    <div className="om-row-fields">
                        <TextField
                            size="small"
                            margin="dense"
                            type="number"
                            label={t('factor')}
                            value={c.factor ?? ''}
                            placeholder="1"
                            onChange={e => set({ factor: num(e.target.value) })}
                        />
                        <TextField
                            size="small"
                            margin="dense"
                            type="number"
                            label={t('offset')}
                            value={c.offset ?? ''}
                            placeholder="0"
                            onChange={e => set({ offset: num(e.target.value) })}
                        />
                    </div>
                    {c.to === 'string' && (
                        <TextField
                            size="small"
                            margin="dense"
                            fullWidth
                            label={t('suffix')}
                            placeholder=" °C"
                            value={c.suffix ?? ''}
                            onChange={e => set({ suffix: e.target.value || undefined })}
                        />
                    )}
                    <FormControlLabel
                        control={
                            <Checkbox
                                size="small"
                                checked={!!c.invert}
                                onChange={e => set({ invert: e.target.checked || undefined })}
                            />
                        }
                        label={t('invert')}
                    />
                    <TextField
                        size="small"
                        margin="dense"
                        fullWidth
                        multiline
                        minRows={1}
                        label={t('valueTable')}
                        helperText={t('valueTableHelp')}
                        value={table}
                        onChange={e => setTable(e.target.value)}
                        onBlur={() => set({ map: textToTable(table) })}
                    />
                    {props.sourceStates && !c.map && (
                        <Button
                            size="small"
                            onClick={() => {
                                const map = { ...props.sourceStates };
                                setTable(tableToText(map));
                                set({ map });
                            }}
                        >
                            {t('valueTable')} {t('fromStates')}
                        </Button>
                    )}
                </>
            )}
            <FormControlLabel
                control={
                    <Checkbox
                        size="small"
                        checked={expert}
                        onChange={e => {
                            setExpert(e.target.checked);
                            if (e.target.checked) {
                                // start with what the simple fields create
                                set({ read: fns.read ?? 'val', write: fns.write });
                            } else {
                                set({ read: undefined, write: undefined });
                            }
                        }}
                    />
                }
                label={t('expert')}
            />
            {expert && (
                <>
                    <TextField
                        size="small"
                        margin="dense"
                        fullWidth
                        multiline
                        label={t('readExpr')}
                        value={c.read ?? ''}
                        onChange={e => set({ read: e.target.value })}
                    />
                    {props.writeable && (
                        <TextField
                            size="small"
                            margin="dense"
                            fullWidth
                            multiline
                            label={t('writeExpr')}
                            value={c.write ?? ''}
                            onChange={e => set({ write: e.target.value })}
                        />
                    )}
                </>
            )}
            {isConverting(c) && (
                <div className="om-muted om-conv-preview">
                    {samples.length > 0 && (
                        <div>
                            {t('preview')}: {samples.map(v => preview(c, v)).join(' · ')}
                        </div>
                    )}
                    {!expert && <code>read: {fns.read}</code>}
                    {!expert && fns.write && <code>write: {fns.write}</code>}
                </div>
            )}
        </div>
    );
}
