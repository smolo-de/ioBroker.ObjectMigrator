import { useVirtualizer } from '@tanstack/react-virtual';
import React from 'react';
import { language, t } from '../i18n';
import { customIcons, nodeName, type Row } from '../model';

/** Row height in px - fixed, so the link lines can be computed from the row index */
export const ROW_HEIGHT = 28;

/** Adapter instance for the icons (ME-04) */
export interface InstanceInfo {
    enabled: boolean;
    icon?: string;
    title: string;
    /** The adapter has settings per state (common.supportCustoms) */
    supportCustoms?: boolean;
    /** native of the instance - used by the jsonCustom expressions */
    native?: Record<string, unknown>;
}

/** What a row can be dragged as */
export interface DragPayload {
    side: 'source' | 'target';
    id: string;
    /** All selected rows, if the dragged row is one of them */
    ids?: string[];
}

/** Props of the tree */
export interface ObjectTreeProps {
    side: 'source' | 'target';
    rows: Row[];
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onScroll: () => void;
    selectedId?: string;
    /** Multi selection (Ctrl/Shift click) */
    selectedIds?: Set<string>;
    /** Links per ID (also counted at collapsed parents) */
    linkCount: Map<string, number>;
    /** Counterparts of the selection */
    highlight: Set<string>;
    instances: Record<string, InstanceInfo>;
    values: Record<string, ioBroker.State | null | undefined>;
    /** `targetId|customKey` with an override */
    overridden: Set<string>;
    onToggle: (id: string) => void;
    onSelect: (id: string, mode: 'single' | 'toggle' | 'range') => void;
    onSetRoot: (id: string) => void;
    onDrop: (payload: DragPayload, targetRow: Row) => void;
    onShowHistory: (id: string) => void;
    /** target tree: read the existing alias mappings of a node in (FR-56) */
    onImport?: (id: string) => void;
    /** Source states with settings that are not linked (ME-16) */
    isUnlinkedWithSettings?: (id: string) => boolean;
    /** Existing objects with pending setting changes */
    changed?: Set<string>;
    /** Rooms/functions of an object (ME-05) */
    enumsOf?: (id: string) => string[] | undefined;
}

const TYPE_ICON: Record<string, string> = {
    device: '🖥️',
    channel: '📂',
    folder: '📁',
    virtual: '📁',
    state: '📄',
    instance: '🧩',
    adapter: '🧩',
    meta: '🗂️',
};

function formatValue(state: ioBroker.State | null | undefined, unit?: string): string {
    if (!state) {
        return '';
    }
    let val: unknown = state.val;
    if (val === null || val === undefined) {
        return 'null';
    }
    if (typeof val === 'number') {
        val = Math.round(val * 1000) / 1000;
    }
    // objects are stringified as JSON, the rest are primitives
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const text = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `${text.length > 24 ? `${text.slice(0, 24)}…` : text}${unit ? ` ${unit}` : ''}`;
}

/**
 * Icons of all adapters with settings at the object (ME-04)
 *
 * @param props
 * @param props.obj
 * @param props.instances
 * @param props.overridden
 */
export function CustomIcons(props: {
    obj: Row['node']['obj'];
    instances: Record<string, InstanceInfo>;
    overridden?: (key: string) => boolean;
}): React.JSX.Element | null {
    const icons = customIcons(props.obj, props.instances);
    if (!icons.length) {
        return null;
    }
    return (
        <span className="om-icons">
            {icons.map(icon => {
                const inst = props.instances[icon.key];
                const settings = props.obj?.common?.custom?.[icon.key];
                const title = `${icon.key}${icon.status === 'missing' ? ' (nicht installiert)' : ''}${
                    icon.enabled ? '' : ' – enabled: false'
                }\n${JSON.stringify(settings, null, 1).slice(0, 400)}`;
                const cls = [
                    'om-icon',
                    icon.enabled && icon.status === 'active' ? '' : 'om-icon-off',
                    icon.status === 'missing' ? 'om-icon-missing' : '',
                    props.overridden?.(icon.key) ? 'om-icon-overridden' : '',
                ].join(' ');
                return (
                    <span
                        key={icon.key}
                        className={cls}
                        title={title}
                    >
                        {inst?.icon ? (
                            <img
                                src={inst.icon}
                                alt={icon.adapter}
                            />
                        ) : (
                            <span className="om-icon-letter">{icon.adapter.slice(0, 2).toUpperCase()}</span>
                        )}
                    </span>
                );
            })}
        </span>
    );
}

/**
 * One of the two object trees (ME-01) - virtualized, fixed row height
 *
 * @param props
 */
export function ObjectTree(props: ObjectTreeProps): React.JSX.Element {
    const virtualizer = useVirtualizer({
        count: props.rows.length,
        getScrollElement: () => props.scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 20,
    });
    const lang = language();
    const [dropId, setDropId] = React.useState<string>();

    return (
        <div
            className="om-tree-scroll"
            ref={props.scrollRef}
            onScroll={props.onScroll}
        >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map(item => {
                    const row = props.rows[item.index];
                    const { node } = row;
                    const isState = node.type === 'state';
                    const links = props.linkCount.get(node.id) ?? 0;
                    const draggable = props.side === 'source' || node.draft;
                    const unlinked = props.isUnlinkedWithSettings?.(node.id);
                    const cls = [
                        'om-row',
                        props.selectedId === node.id || props.selectedIds?.has(node.id) ? 'om-row-selected' : '',
                        props.highlight.has(node.id) ? 'om-row-highlight' : '',
                        node.draft ? 'om-row-draft' : '',
                        dropId === node.id ? 'om-row-drop' : '',
                        unlinked ? 'om-row-unlinked' : '',
                    ].join(' ');
                    const hasHistory = Object.keys(node.obj?.common?.custom ?? {}).some(k =>
                        /^(history|sql|influxdb)\./.test(k),
                    );
                    // stored under another name in the database (aliasId, FR-57)
                    const dbName = Object.entries(
                        (node.obj?.common?.custom ?? {}) as Record<string, { aliasId?: unknown } | null>,
                    )
                        .filter(
                            ([k, v]) =>
                                /^(history|sql|influxdb)\./.test(k) &&
                                typeof v?.aliasId === 'string' &&
                                v.aliasId.trim() &&
                                v.aliasId.trim() !== node.id,
                        )
                        .map(([k, v]) => `${k} → ${String(v!.aliasId)}`)
                        .join('\n');
                    return (
                        <div
                            key={node.id}
                            className={cls}
                            style={{ top: item.start, height: ROW_HEIGHT }}
                            title={unlinked ? `${node.id}\n${t('notMigrated')}` : node.id}
                            draggable={draggable}
                            onDragStart={e => {
                                e.dataTransfer.setData(
                                    'application/x-objectmigrator',
                                    JSON.stringify({
                                        side: props.side,
                                        id: node.id,
                                        ids:
                                            props.selectedIds?.has(node.id) && props.selectedIds.size > 1
                                                ? [...props.selectedIds]
                                                : undefined,
                                    } satisfies DragPayload),
                                );
                                e.dataTransfer.effectAllowed = props.side === 'source' ? 'link' : 'move';
                            }}
                            onDragOver={e => {
                                if (
                                    props.side === 'target' &&
                                    e.dataTransfer.types.includes('application/x-objectmigrator')
                                ) {
                                    e.preventDefault();
                                    if (dropId !== node.id) {
                                        setDropId(node.id);
                                    }
                                }
                            }}
                            onDragLeave={() => dropId === node.id && setDropId(undefined)}
                            onDrop={e => {
                                setDropId(undefined);
                                const data = e.dataTransfer.getData('application/x-objectmigrator');
                                if (data) {
                                    e.preventDefault();
                                    props.onDrop(JSON.parse(data) as DragPayload, row);
                                }
                            }}
                            onClick={e =>
                                props.onSelect(
                                    node.id,
                                    e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single',
                                )
                            }
                            onDoubleClick={() => !isState && props.onSetRoot(node.id)}
                        >
                            {props.side === 'target' && <span className={`om-anchor ${links ? 'om-anchor-on' : ''}`} />}
                            <span style={{ width: row.depth * 16, flex: 'none' }} />
                            <span
                                className="om-toggle"
                                onClick={e => {
                                    e.stopPropagation();
                                    if (row.hasChildren) {
                                        props.onToggle(node.id);
                                    }
                                }}
                            >
                                {row.hasChildren ? (row.expanded ? '▾' : '▸') : ''}
                            </span>
                            <span className="om-type">{TYPE_ICON[node.type] ?? '📄'}</span>
                            <span className={`om-name ${isState ? '' : 'om-name-node'}`}>
                                {nodeName(node, lang)}
                                {nodeName(node, lang) !== node.part && <span className="om-part">{node.part}</span>}
                            </span>
                            {node.draft && <span className="om-chip om-chip-draft">{t('draft')}</span>}
                            {props.changed?.has(node.id) && (
                                <span
                                    className="om-chip om-chip-changed"
                                    title={t('changedHint')}
                                >
                                    ✎ {t('changed')}
                                </span>
                            )}
                            {links > 1 && props.side === 'target' && isState && (
                                <span className="om-chip">{t('linkedSources', { n: links })}</span>
                            )}
                            {!isState && links > 0 && !row.expanded && <span className="om-chip">{links}</span>}
                            {props
                                .enumsOf?.(node.id)
                                ?.slice(0, 2)
                                .map(name => (
                                    <span
                                        key={name}
                                        className="om-chip om-chip-enum"
                                        title={props.enumsOf!(node.id)!.join(', ')}
                                    >
                                        {name}
                                    </span>
                                ))}
                            <span className="om-spacer" />
                            {!isState && row.depth > 0 && !node.draft && (
                                <span
                                    className="om-root-btn"
                                    title={t('asRoot')}
                                    onClick={e => {
                                        e.stopPropagation();
                                        props.onSetRoot(node.id);
                                    }}
                                >
                                    ⤓ {t('asRoot')}
                                </span>
                            )}
                            {props.onImport && !node.draft && node.id.startsWith('alias.') && (
                                <span
                                    className="om-root-btn"
                                    title={t('importAliasesHelp')}
                                    onClick={e => {
                                        e.stopPropagation();
                                        props.onImport!(node.id);
                                    }}
                                >
                                    ⇠ {t('importAliases')}
                                </span>
                            )}
                            <CustomIcons
                                obj={node.obj}
                                instances={props.instances}
                                overridden={key => props.overridden.has(`${node.id}|${key}`)}
                            />
                            {isState && dbName && (
                                <span
                                    className="om-db-marker"
                                    title={dbName}
                                >
                                    DB
                                </span>
                            )}
                            {isState && hasHistory && (
                                <span
                                    className="om-history"
                                    title={t('showHistory')}
                                    onClick={e => {
                                        e.stopPropagation();
                                        props.onShowHistory(node.id);
                                    }}
                                >
                                    📈
                                </span>
                            )}
                            {isState && (
                                <span className="om-value">
                                    {formatValue(props.values[node.id], node.obj?.common?.unit)}
                                </span>
                            )}
                            {props.side === 'source' && <span className={`om-anchor ${links ? 'om-anchor-on' : ''}`} />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
