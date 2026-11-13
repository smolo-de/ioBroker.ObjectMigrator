import { Alert, Button, LinearProgress, TextField } from '@mui/material';
import React from 'react';
import type { Reference } from '../../../src/lib/refs/references';
import type { Connection } from '../connection';
import { t, type TextKey } from '../i18n';
import type { Link } from '../model';

const KIND: Record<string, TextKey> = {
    script: 'refScript',
    instance: 'refInstance',
    alias: 'refAlias',
    enum: 'refEnum',
    vis: 'refVis',
    lovelace: 'refLovelace',
};

/**
 * "Referenzen" (FR-70): where are the old IDs used? After the migration scripts, VIS, lovelace and
 * adapter configurations should use the new alias ID.
 *
 * @param props
 * @param props.socket
 * @param props.links
 */
export function RefsView(props: { socket: Connection; links: Link[] }): React.JSX.Element {
    // old ID → new ID (the target of the link)
    const mapping = React.useMemo(() => new Map(props.links.map(l => [l.sourceId, l.targetId])), [props.links]);
    const [extra, setExtra] = React.useState('');
    const [result, setResult] = React.useState<Record<string, Reference[]>>();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [copied, setCopied] = React.useState(false);

    const search = (): void => {
        const ids = [
            ...mapping.keys(),
            ...extra
                .split(/[\s,;]+/)
                .map(x => x.trim())
                .filter(Boolean),
        ];
        setBusy(true);
        setError(undefined);
        props.socket
            .send<Record<string, Reference[]>>('refs.find', { ids: [...new Set(ids)] })
            .then(setResult)
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
    };

    const found = result ? Object.entries(result).filter(([, refs]) => refs.length) : [];
    const csv = found.map(([id]) => `${id};${mapping.get(id) ?? ''}`).join('\n');

    return (
        <div className="om-view">
            <div className="om-view-head">
                <h3>{t('references')}</h3>
            </div>
            <div className="om-muted">{t('refsHelp', { n: mapping.size })}</div>
            <div className="om-row-fields">
                <TextField
                    size="small"
                    margin="dense"
                    fullWidth
                    label={t('refsExtra')}
                    value={extra}
                    onChange={e => setExtra(e.target.value)}
                />
                <Button
                    variant="contained"
                    disabled={busy || (!mapping.size && !extra.trim())}
                    onClick={search}
                >
                    {t('search')}
                </Button>
            </div>
            {busy && <LinearProgress />}
            {error && <Alert severity="error">{error}</Alert>}
            {result && !found.length && <p className="om-muted">{t('refsNone')}</p>}
            {found.length > 0 && (
                <>
                    <Button
                        size="small"
                        onClick={() => {
                            void navigator.clipboard?.writeText(`old;new\n${csv}`).then(() => setCopied(true));
                        }}
                    >
                        {copied ? '✓ ' : ''}
                        {t('refsCopy')}
                    </Button>
                    <table className="om-table">
                        <thead>
                            <tr>
                                <th>{t('refsOld')}</th>
                                <th>{t('refsNew')}</th>
                                <th>{t('refsWhere')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {found.map(([id, refs]) => (
                                <tr key={id}>
                                    <td>{id}</td>
                                    <td>{mapping.get(id) ?? '–'}</td>
                                    <td>
                                        {refs.map(r => (
                                            <div key={`${r.kind}|${r.location}`}>
                                                <span className="om-chip">{t(KIND[r.kind] ?? 'refInstance')}</span>{' '}
                                                {r.location}
                                                {r.name ? ` (${r.name})` : ''}
                                                {r.count > 1 ? ` × ${r.count}` : ''}
                                            </div>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}
