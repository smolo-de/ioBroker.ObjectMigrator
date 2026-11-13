import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    List,
    ListItemButton,
    ListItemText,
    TextField,
} from '@mui/material';
import React from 'react';
import type { Connection } from '../connection';
import { language, t } from '../i18n';
import type { ObjInfo } from '../model';

const MAX = 300;

/**
 * Name of an object in the language of the user
 *
 * @param obj
 */
function objName(obj: ObjInfo): string {
    const n = obj.common?.name;
    if (typeof n === 'string') {
        return n;
    }
    return n ? (n[language()] ?? n.en ?? '') : '';
}

/**
 * Selection of a state (instead of typing the ID): searches below a start path, filters by ID and name
 *
 * @param props - start path and callbacks
 * @param props.socket - connection
 * @param props.start - path to start with, e.g. the root of the source tree
 * @param props.onSelect - called with the chosen ID
 * @param props.onClose - dialog closed
 */
export function ObjectPicker(props: {
    socket: Connection;
    start: string;
    onSelect: (id: string) => void;
    onClose: () => void;
}): React.JSX.Element {
    const [path, setPath] = React.useState(props.start);
    const [filter, setFilter] = React.useState('');
    const [objects, setObjects] = React.useState<Record<string, ObjInfo>>();
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            props.socket
                .getStatesBelow(path)
                .then(o => !cancelled && setObjects(o))
                .catch(() => !cancelled && setObjects({}))
                .finally(() => !cancelled && setLoading(false));
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [path, props.socket]);

    const text = filter.trim().toLowerCase();
    const list = Object.entries(objects ?? {})
        .filter(([id, obj]) => !text || id.toLowerCase().includes(text) || objName(obj).toLowerCase().includes(text))
        .sort(([a], [b]) => a.localeCompare(b));

    return (
        <Dialog
            open
            fullWidth
            maxWidth="md"
            onClose={props.onClose}
        >
            <DialogTitle>{t('pickObject')}</DialogTitle>
            <DialogContent>
                <div className="om-row-fields">
                    <TextField
                        size="small"
                        margin="dense"
                        fullWidth
                        label={t('pickPath')}
                        value={path}
                        onChange={e => setPath(e.target.value.trim())}
                    />
                    <TextField
                        size="small"
                        margin="dense"
                        fullWidth
                        autoFocus
                        label={t('filter')}
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>
                {loading && <LinearProgress />}
                <List
                    dense
                    className="om-picker-list"
                >
                    {list.slice(0, MAX).map(([id, obj]) => (
                        <ListItemButton
                            key={id}
                            onClick={() => props.onSelect(id)}
                        >
                            <ListItemText
                                primary={id}
                                secondary={[objName(obj), obj.common?.role, obj.common?.unit]
                                    .filter(Boolean)
                                    .join(' · ')}
                            />
                        </ListItemButton>
                    ))}
                </List>
                {list.length > MAX && <div className="om-muted">{t('pickMore', { n: list.length - MAX })}</div>}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
}
