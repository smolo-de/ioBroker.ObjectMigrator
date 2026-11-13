import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    List,
    ListItemButton,
    ListItemText,
    IconButton,
    TextField,
} from '@mui/material';
import React from 'react';
import { validateBasePath } from '../../../src/lib/alias/createMode';
import type { Connection } from '../connection';
import { formatMessage } from '../../../src/lib/messages';
import { language, t } from '../i18n';
import { templateVariables, type Template } from '../model';

/**
 * Name of a new template (EM-11)
 *
 * @param props
 * @param props.nodeName
 * @param props.onSave
 * @param props.onClose
 */
export function SaveTemplateDialog(props: {
    nodeName: string;
    onSave: (name: string, replacements: { text: string; variable: string }[]) => void;
    onClose: () => void;
}): React.JSX.Element {
    const [name, setName] = React.useState(props.nodeName);
    // the name of the node usually changes from device to device - offered as placeholder {{name}}
    const [rows, setRows] = React.useState<{ text: string; variable: string }[]>([
        { text: props.nodeName, variable: 'name' },
    ]);
    const save = (): void =>
        props.onSave(
            name.trim(),
            rows.filter(r => r.text.trim() && r.variable.trim()),
        );
    return (
        <Dialog
            open
            fullWidth
            maxWidth="xs"
            onClose={props.onClose}
        >
            <DialogTitle>{t('saveTemplate')}</DialogTitle>
            <DialogContent>
                <DialogContentText>{t('templateHelp')}</DialogContentText>
                <TextField
                    autoFocus
                    fullWidth
                    margin="normal"
                    label={t('templateName')}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && name.trim() && save()}
                />
                <div className="om-muted">{t('placeholdersHelp')}</div>
                {rows.map((row, i) => (
                    <div
                        key={i}
                        className="om-row-fields"
                    >
                        <TextField
                            size="small"
                            margin="dense"
                            label={t('placeholderText')}
                            value={row.text}
                            onChange={e => setRows(rows.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)))}
                        />
                        <TextField
                            size="small"
                            margin="dense"
                            label={t('placeholderVariable')}
                            value={row.variable}
                            onChange={e =>
                                setRows(
                                    rows.map((r, j) =>
                                        j === i ? { ...r, variable: e.target.value.replace(/\W/g, '') } : r,
                                    ),
                                )
                            }
                            helperText={row.variable ? `{{${row.variable}}}` : undefined}
                        />
                        <IconButton
                            size="small"
                            onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                            ✕
                        </IconButton>
                    </div>
                ))}
                <Button
                    size="small"
                    onClick={() => setRows([...rows, { text: '', variable: '' }])}
                >
                    + {t('placeholderAdd')}
                </Button>
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!name.trim()}
                    onClick={save}
                >
                    ★ {t('saveTemplate')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * Create drafts from a template: choose template, base path and placeholder values
 *
 * @param props
 * @param props.socket
 * @param props.defaultParent
 * @param props.linkSource
 * @param props.onApply
 * @param props.onClose
 */
export function ApplyTemplateDialog(props: {
    socket: Connection;
    defaultParent: string;
    linkSource?: string;
    onApply: (template: Template, basePath: string, vars: Record<string, string>) => void;
    onClose: () => void;
}): React.JSX.Element {
    const [names, setNames] = React.useState<string[]>();
    const [template, setTemplate] = React.useState<Template>();
    const [path, setPath] = React.useState(props.defaultParent);
    const [vars, setVars] = React.useState<Record<string, string>>({});
    const [error, setError] = React.useState<string>();

    const reload = React.useCallback(() => {
        props.socket
            .send<string[]>('template.list')
            .then(setNames)
            .catch((e: Error) => setError(e.message));
    }, [props.socket]);
    React.useEffect(reload, [reload]);

    const choose = (name: string): void => {
        props.socket
            .send<Template>('template.load', { name })
            .then(tpl => {
                setTemplate(tpl);
                const part = name.replace(/[^\wäöüÄÖÜß-]/g, '_');
                setPath(`${props.defaultParent}.${part}`);
                setVars(Object.fromEntries(templateVariables(tpl).map(v => [v, ''])));
            })
            .catch((e: Error) => setError(e.message));
    };
    const pathErrors = validateBasePath(path);

    return (
        <Dialog
            open
            fullWidth
            maxWidth="sm"
            onClose={props.onClose}
        >
            <DialogTitle>{t('fromTemplate')}</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error">{error}</Alert>}
                {names && !names.length && <DialogContentText>{t('noTemplates')}</DialogContentText>}
                <List dense>
                    {(names ?? []).map(name => (
                        <ListItemButton
                            key={name}
                            selected={template?.name === name}
                            onClick={() => choose(name)}
                        >
                            <ListItemText primary={name} />
                            <IconButton
                                size="small"
                                title={t('deleteTemplate')}
                                onClick={e => {
                                    e.stopPropagation();
                                    void props.socket.send('template.delete', { name }).then(reload);
                                }}
                            >
                                ✕
                            </IconButton>
                        </ListItemButton>
                    ))}
                </List>
                {template && (
                    <>
                        <div className="om-muted">
                            {template.nodes.length} {t('object')}
                            {props.linkSource ? ` · ${t('templateLinkHint')} (${props.linkSource})` : ''}
                        </div>
                        <TextField
                            fullWidth
                            margin="normal"
                            label={t('basePath')}
                            value={path}
                            error={pathErrors.length > 0}
                            helperText={pathErrors.map(e => formatMessage(e, language())).join(', ') || undefined}
                            onChange={e => setPath(e.target.value.trim())}
                        />
                        {Object.keys(vars).map(v => (
                            <TextField
                                key={v}
                                fullWidth
                                margin="dense"
                                label={`{{${v}}}`}
                                value={vars[v]}
                                onChange={e => setVars({ ...vars, [v]: e.target.value })}
                            />
                        ))}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!template || pathErrors.length > 0}
                    onClick={() => template && props.onApply(template, path, vars)}
                >
                    {t('apply')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
