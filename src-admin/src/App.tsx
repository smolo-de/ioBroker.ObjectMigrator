import {
    Alert,
    Autocomplete,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    LinearProgress,
    Snackbar,
    TextField,
    Tooltip,
} from '@mui/material';
import React from 'react';
import { normalizeIdPart } from '../../src/lib/alias/createMode';
import type { CheckResult, RunLogEntry } from '../../src/lib/migration/types';
import { CheckDialog, CreateModeDialog } from './components/Dialogs';
import { ApplyTemplateDialog, SaveTemplateDialog } from './components/TemplateDialogs';
import { HistoryDialog, type HistoryRequest } from './components/HistoryDialog';
import { LinkLayer, type DrawLink } from './components/LinkLayer';
import { LinkLegend } from './components/LinkLegend';
import { ObjectTree, ROW_HEIGHT, type DragPayload, type InstanceInfo } from './components/ObjectTree';
import { ObjectPicker } from './components/ObjectPicker';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DbNameDialog, DbNamesView } from './components/DbNamesView';
import { RefsView } from './components/RefsView';
import { RunsView } from './components/RunsView';
import { mergeLog, RunLog } from './components/RunLog';
import { converterToAlias } from '../../src/lib/alias/converter';
import { formatMessage, type Message } from '../../src/lib/messages';
import type { Connection } from './connection';
import { language, setLanguage, t } from './i18n';
import { readSession, writeSession, type TabSession, type TreeSession } from './session';
import {
    ALL_OBJECTS,
    addLink,
    addNode,
    addState,
    applyTemplate,
    changedTargets,
    clearOptions,
    converterOf,
    makeTemplate,
    applyMirror,
    autoLinks,
    buildPlan,
    buildTree,
    compat,
    emptyState,
    expandToDepth,
    flatten,
    importAliases,
    isUnchangedImport,
    hasSettings,
    moveDraft,
    namespaceOf,
    nodeName,
    overlapOf,
    parentsOf,
    removeDraft,
    removeLink,
    setOptions,
    sourcesOf,
    updateDraft,
    type DraftObject,
    type EditorState,
    type Link,
    type ObjInfo,
    type Row,
    type TreeNode,
} from './model';

const GUTTER = 110;
/** smallest height of the log list in px */
const LOG_MIN = 60;

interface Config {
    historyInstance: string;
    chunkSize: number;
    chunkPauseMs: number;
    defaultBasePath: string;
}

interface RunInfo {
    id?: string;
    status?: string;
    phase?: string;
    progress?: number;
    current?: string;
}

/**
 * Undo/redo for all editor actions (ME-17)
 *
 * @param initial
 */
function useUndo(
    initial: EditorState,
    locked: React.RefObject<boolean>,
): {
    state: EditorState;
    update: (fn: (s: EditorState) => EditorState) => void;
    reset: (s: EditorState) => void;
    /** back to a stored session, with its undo history */
    restore: (past: EditorState[], present: EditorState, future: EditorState[]) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    past: EditorState[];
    future: EditorState[];
} {
    const [h, setH] = React.useState({ past: [] as EditorState[], present: initial, future: [] as EditorState[] });
    return {
        state: h.present,
        past: h.past,
        future: h.future,
        restore: (past, present, future) => setH({ past, present, future }),
        // while a run is active the plan is locked (it is the plan that is being written)
        update: fn =>
            !locked.current &&
            setH(x => {
                const next = fn(x.present);
                return next === x.present ? x : { past: [...x.past.slice(-99), x.present], present: next, future: [] };
            }),
        reset: s => setH({ past: [], present: s, future: [] }),
        undo: () =>
            !locked.current &&
            setH(x =>
                x.past.length
                    ? {
                          past: x.past.slice(0, -1),
                          present: x.past[x.past.length - 1],
                          future: [x.present, ...x.future],
                      }
                    : x,
            ),
        redo: () =>
            !locked.current &&
            setH(x =>
                x.future.length ? { past: [...x.past, x.present], present: x.future[0], future: x.future.slice(1) } : x,
            ),
        canUndo: h.past.length > 0,
        canRedo: h.future.length > 0,
    };
}

/** Whole object tree (left side): the namespaces offered at the top and the linked objects */
interface WholeTree {
    /** namespaces shown at the top level, e.g. `hm-rpc.0` */
    namespaces: string[];
    /** linked objects - their parents are expanded at the start */
    linked: string[];
}

/**
 * Tree side: objects, expansion, filter, scrolling. The root ALL_OBJECTS shows the whole object tree:
 * only the namespaces at first, their objects are loaded when they are expanded.
 *
 * @param socket
 * @param root
 * @param drafts
 * @param session - state of the last visit (expansion, filter, scroll position)
 * @param whole - namespaces and linked objects for the whole object tree
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function useTreeSide(
    socket: Connection,
    root: string,
    drafts: DraftObject[],
    session?: TreeSession,
    whole?: WholeTree,
) {
    const [objects, setObjects] = React.useState<Record<string, ObjInfo>>({});
    const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
    const [filter, setFilter] = React.useState(session?.filter ?? '');
    const [onlySettings, setOnlySettings] = React.useState(session?.onlySettings ?? false);
    const [scroll, setScroll] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [reloadCount, setReloadCount] = React.useState(0);
    const scrollRef = React.useRef<HTMLDivElement>(null);
    // drafts at the time of loading - for the initial expansion only
    const draftsRef = React.useRef(drafts);
    draftsRef.current = drafts;
    // linked objects at the time of loading - their parents are expanded
    const linkedRef = React.useRef<string[]>([]);
    linkedRef.current = whole?.linked ?? [];
    // used once, for the first load of the same root
    const sessionRef = React.useRef(session);
    const pendingScroll = React.useRef<number>(undefined);
    /** an object to scroll to as soon as it is visible (read in, FR-56) */
    const revealRef = React.useRef<{ id: string; until: number }>(undefined);
    const all = root === ALL_OBJECTS;
    // whole object tree: loaded namespaces (value: reload count of the load), loads in progress
    const [loadedNs, setLoadedNs] = React.useState<Record<string, number>>({});
    const [loadingNs, setLoadingNs] = React.useState(0);
    const inflight = React.useRef(new Set<string>());
    const generation = React.useRef(0);
    const lastRoot = React.useRef<string>(undefined);

    React.useEffect(() => {
        const rootChanged = lastRoot.current !== root;
        if (rootChanged) {
            // results of loads for another root are dropped
            lastRoot.current = root;
            generation.current++;
            inflight.current = new Set();
            setLoadingNs(0);
            setLoadedNs({});
        }
        if (!root) {
            setObjects({});
            return;
        }
        const takeSession = (): TreeSession | undefined => {
            const last = sessionRef.current;
            sessionRef.current = undefined;
            return last?.root === root ? last : undefined;
        };
        if (all) {
            // a reload after "Schreiben" loads the expanded namespaces again (effect below)
            if (rootChanged) {
                // only the namespaces - their objects are loaded on expanding
                setObjects({});
                const last = takeSession();
                if (last) {
                    setExpanded(new Set(last.expanded));
                    pendingScroll.current = last.scroll;
                } else {
                    setExpanded(new Set(linkedRef.current.flatMap(id => parentsOf(id, ''))));
                }
            }
            return;
        }
        let cancelled = false;
        setLoading(true);
        socket
            .getSubtree(root)
            .then(objs => {
                if (cancelled) {
                    return;
                }
                setObjects(objs);
                const last = takeSession();
                if (last) {
                    // back from another admin page: as it was
                    setExpanded(new Set(last.expanded));
                    pendingScroll.current = last.scroll;
                } else if (!reloadCount) {
                    const size = Object.keys(objs).length + draftsRef.current.length;
                    setExpanded(
                        new Set([
                            ...expandToDepth(buildTree(root, objs, draftsRef.current), size < 1500 ? 99 : 1),
                            // the linked objects are visible, not only their collapsed parents
                            ...linkedRef.current.flatMap(id => parentsOf(id, root)),
                        ]),
                    );
                }
            })
            .catch(() => !cancelled && setObjects({}))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
        // reloadCount: reload after "Schreiben" without changing the expansion
        // (dependencies on purpose incomplete)
    }, [root, socket, reloadCount]);

    React.useEffect(() => setReloadCount(0), [root]);

    // whole object tree: load the expanded namespaces (again after a reload)
    React.useEffect(() => {
        if (!all) {
            return;
        }
        const gen = generation.current;
        const running = inflight.current;
        const wanted = new Set([...expanded].map(namespaceOf).filter((ns): ns is string => !!ns));
        for (const ns of wanted) {
            if (loadedNs[ns] === reloadCount || running.has(ns)) {
                continue;
            }
            running.add(ns);
            setLoadingNs(n => n + 1);
            const count = reloadCount;
            void socket
                .getSubtree(ns)
                .catch(() => ({}))
                .then(objs => {
                    if (gen !== generation.current) {
                        return;
                    }
                    setObjects(prev => {
                        const next: Record<string, ObjInfo> = {};
                        for (const [id, obj] of Object.entries(prev)) {
                            if (id !== ns && !id.startsWith(`${ns}.`)) {
                                next[id] = obj;
                            }
                        }
                        return { ...next, ...objs };
                    });
                    setLoadedNs(prev => ({ ...prev, [ns]: count }));
                })
                .finally(() => {
                    running.delete(ns);
                    if (gen === generation.current) {
                        setLoadingNs(n => n - 1);
                    }
                });
        }
    }, [all, expanded, loadedNs, reloadCount, socket]);

    const namespaces = React.useMemo(
        () =>
            all
                ? [
                      ...new Set([
                          ...(whole?.namespaces ?? []),
                          ...(whole?.linked ?? []).map(namespaceOf).filter((ns): ns is string => !!ns),
                          ...Object.keys(loadedNs),
                      ]),
                  ].map(id => ({ id, loaded: id in loadedNs }))
                : [],
        [all, whole, loadedNs],
    );
    const tree = React.useMemo(
        () => buildTree(all ? '' : root, objects, drafts, namespaces),
        [all, root, objects, drafts, namespaces],
    );
    const rows = React.useMemo(() => {
        const text = filter.trim().toLowerCase();
        const lang = language();
        const fn =
            text || onlySettings
                ? (node: TreeNode): boolean =>
                      (!onlySettings || hasSettings(node)) &&
                      (!text ||
                          node.id.toLowerCase().includes(text) ||
                          nodeName(node, lang).toLowerCase().includes(text))
                : undefined;
        if (!root) {
            return [];
        }
        if (!all) {
            return flatten(tree, expanded, fn);
        }
        // whole object tree: the root row is not shown, it is always open
        return flatten(tree, new Set([...expanded, '']), fn)
            .slice(1)
            .map(r => ({ ...r, depth: r.depth - 1 }));
    }, [tree, expanded, filter, onlySettings, root, all]);
    // scroll position of the last visit, as soon as the rows are there - or the object to reveal
    React.useLayoutEffect(() => {
        const el = scrollRef.current;
        if (pendingScroll.current !== undefined && el && rows.length) {
            el.scrollTop = pendingScroll.current;
            pendingScroll.current = undefined;
            setScroll(el.scrollTop);
            return;
        }
        const reveal = revealRef.current;
        if (!reveal || !el) {
            return;
        }
        if (Date.now() > reveal.until) {
            revealRef.current = undefined;
            return;
        }
        const i = rows.findIndex(r => r.node.id === reveal.id);
        if (i >= 0) {
            revealRef.current = undefined;
            const top = i * ROW_HEIGHT;
            if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_HEIGHT) {
                el.scrollTop = Math.max(0, top - el.clientHeight / 3);
                setScroll(el.scrollTop);
            }
        }
    }, [rows]);
    // values of the shown objects
    const patterns = React.useMemo(
        () => (all ? Object.keys(loadedNs).map(ns => `${ns}.*`) : root ? [`${root}.*`] : []),
        [all, root, loadedNs],
    );
    const index = React.useMemo(() => new Map(rows.map((r, i) => [r.node.id, i])), [rows]);
    const nodes = React.useMemo(() => {
        const map = new Map<string, TreeNode>();
        const walk = (n: TreeNode): void => {
            map.set(n.id, n);
            n.children.forEach(walk);
        };
        walk(tree);
        return map;
    }, [tree]);

    return {
        objects,
        tree,
        rows,
        index,
        nodes,
        expanded,
        setExpanded,
        filter,
        setFilter,
        onlySettings,
        setOnlySettings,
        scroll,
        scrollRef,
        onScroll: () => setScroll(scrollRef.current?.scrollTop ?? 0),
        loading: loading || loadingNs > 0,
        /** state patterns of the shown objects (subscribed for the values) */
        patterns,
        /**
         * Expands the parents of objects and scrolls to the first one (read in, FR-56)
         *
         * @param ids - objects to show
         * @param forRoot - root they are shown in (the new one if the root changes at the same time)
         */
        reveal: (ids: string[], forRoot: string) => {
            if (!ids.length) {
                return;
            }
            const base = forRoot === ALL_OBJECTS ? '' : forRoot;
            // a new root expands the parents of the linked objects itself when it is loaded
            setExpanded(prev => new Set([...prev, ...ids.flatMap(id => parentsOf(id, base))]));
            revealRef.current = { id: ids[0], until: Date.now() + 15_000 };
        },
        reload: () => setReloadCount(c => c + 1),
        toggle: (id: string) =>
            setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            }),
    };
}

/**
 * Root selection with suggestions (ME-02)
 *
 * @param props
 * @param props.value
 * @param props.choices
 * @param props.onChange
 */
function RootPicker(props: { value: string; choices: string[]; onChange: (v: string) => void }): React.JSX.Element {
    // the whole object tree is shown by name, `*` can be typed
    const label = (v: string): string => (v === ALL_OBJECTS ? t('allObjects') : v);
    const parse = (v: string): string => (v.trim() === label(ALL_OBJECTS) ? ALL_OBJECTS : v.trim());
    const [text, setText] = React.useState(label(props.value));
    React.useEffect(() => setText(label(props.value)), [props.value]);
    return (
        <Autocomplete
            freeSolo
            size="small"
            sx={{ flex: 1, minWidth: 180 }}
            options={props.choices}
            getOptionLabel={label}
            value={props.value}
            inputValue={text}
            onInputChange={(_, v) => setText(v)}
            onChange={(_, v) => typeof v === 'string' && props.onChange(parse(v))}
            renderInput={params => (
                <TextField
                    {...params}
                    label={t('root')}
                    onKeyDown={e => e.key === 'Enter' && props.onChange(parse(text))}
                />
            )}
        />
    );
}

/**
 * The mapping editor (06 §3)
 *
 * @param props
 * @param props.socket
 * @param props.dark
 */
export function App(props: { socket: Connection; dark: boolean }): React.JSX.Element {
    const { socket } = props;
    const ns = socket.instance;
    const locked = React.useRef(false);
    /** where the user was before leaving the tab (the admin reloads the iframe on the way back) */
    const [session] = React.useState(() => readSession(ns));
    const editor = useUndo(emptyState(), locked);
    const state = editor.state;
    const [connected, setConnected] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    const [instances, setInstances] = React.useState<Record<string, InstanceInfo>>({});
    const [config, setConfig] = React.useState<Config>({
        historyInstance: 'history.0',
        chunkSize: 5000,
        chunkPauseMs: 1000,
        defaultBasePath: 'alias.0',
    });
    const [values, setValues] = React.useState<Record<string, ioBroker.State | null>>({});
    const [extraObjects, setExtraObjects] = React.useState<Record<string, ObjInfo>>({});
    const [selected, setSelected] = React.useState<{ side: 'source' | 'target'; id: string } | undefined>(
        session?.selected,
    );
    /** Multi selection in the source tree (Ctrl/Shift click) - mirrored in the create mode */
    const [sourceSelection, setSourceSelection] = React.useState<Set<string>>(() => new Set(session?.sourceSelection));
    const selectionAnchor = React.useRef<string>(undefined);
    const [lang, setLang] = React.useState<'de' | 'en'>('de');
    const [widths, setWidths] = React.useState<{ left: number; panel: number }>(() => {
        try {
            const w = JSON.parse(window.localStorage.getItem('objectmigrator.widths') ?? '') as {
                left: number;
                panel: number;
            };
            if (w.left > 0 && w.panel > 0) {
                return w;
            }
        } catch {
            // default
        }
        return { left: 520, panel: 380 };
    });
    const [saveTemplateFor, setSaveTemplateFor] = React.useState<string>();
    const [confirmClear, setConfirmClear] = React.useState(false);
    const [applyTemplateOpen, setApplyTemplateOpen] = React.useState(false);
    const [selectedLink, setSelectedLink] = React.useState<Link | undefined>(session?.selectedLink);
    const [pickedSource, setPickedSource] = React.useState<string | undefined>(session?.pickedSource);
    /** Target of the history preview - the request is built from the current state (cut/exclusions) */
    const [historyFor, setHistoryFor] = React.useState<string | undefined>(session?.historyFor);
    const [view, setView] = React.useState<'editor' | 'runs' | 'refs' | 'db'>(session?.view ?? 'editor');
    /** DB name (aliasId) of an object being changed (FR-57) */
    const [dbEdit, setDbEdit] = React.useState<{ id: string; instance: string; current: string }>();
    const [picker, setPicker] = React.useState<{ start: string; done: (id: string) => void }>();
    /** member ID → names of its rooms/functions */
    const [enumNames, setEnumNames] = React.useState<Map<string, string[]>>(new Map());
    /** Scope of "Prüfen"/"Schreiben": a node of the target tree, undefined = everything (WR-04) */
    const [checkScope, setCheckScope] = React.useState<string>();
    /** Version of the stored plan this editor is based on - detects a second open tab */
    const planVersion = React.useRef<number | undefined>(undefined);
    /** the plan as last stored or loaded - anything else is not stored yet */
    const savedPlan = React.useRef<EditorState>(undefined);
    const [conflict, setConflict] = React.useState<{ savedAt?: number }>();
    const conflictRef = React.useRef(false);
    conflictRef.current = !!conflict;
    const [checkState, setCheckState] = React.useState<{ loading: boolean; result?: CheckResult; error?: string }>();
    const [createMode, setCreateMode] = React.useState<{ error?: string }>();
    const [run, setRun] = React.useState<RunInfo>({});
    /** Log of the current/last run - live from the state run.log */
    const [runLog, setRunLog] = React.useState<{ runId?: string; entries: RunLogEntry[] }>({ entries: [] });
    const [showLog, setShowLog] = React.useState(session?.showLog ?? false);
    /** Height of the log list in px - dragged at its upper edge, remembered per browser */
    const [logHeight, setLogHeight] = React.useState<number>(() => {
        try {
            const h = Number(window.localStorage.getItem('objectmigrator.logHeight'));
            if (h >= LOG_MIN) {
                return h;
            }
        } catch {
            // default
        }
        return 170;
    });
    const [confirmAbort, setConfirmAbort] = React.useState(false);
    const [toast, setToast] = React.useState<{ text: string; severity: 'success' | 'error' | 'info' | 'warning' }>();
    const [bodyHeight, setBodyHeight] = React.useState(400);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const mainRef = React.useRef<HTMLDivElement>(null);
    const lastRunStatus = React.useRef<string>(undefined);
    const doneTargets = React.useRef(new Set<string>());

    const rootChoices = React.useMemo(
        () =>
            [
                'alias.0',
                '0_userdata.0',
                ...Object.keys(instances).filter(k => !k.startsWith(`${ns.split('.')[0]}.`)),
            ].sort(),
        [instances, ns],
    );
    const linkedSources = React.useMemo(() => new Set(state.links.map(l => l.sourceId)), [state.links]);
    const wholeTree = React.useMemo(
        () => ({ namespaces: rootChoices, linked: [...linkedSources] }),
        [rootChoices, linkedSources],
    );
    const left = useTreeSide(socket, state.sourceRoot, [], session?.left, wholeTree);
    const right = useTreeSide(socket, state.targetRoot, state.drafts, session?.right);

    const fail = (e: unknown): void => setToast({ text: (e as Error).message ?? String(e), severity: 'error' });

    // ---- start: connection, language, instances, config, saved draft, run states
    React.useEffect(() => {
        socket.onConnectionChange = setConnected;
        void (async () => {
            try {
                await socket.connect();
                const sysConfig = await socket.getObject('system.config');
                let stored: string | null = null;
                try {
                    stored = window.localStorage.getItem('objectmigrator.lang');
                } catch {
                    // no storage
                }
                const lang = stored || (sysConfig?.common?.language as string) || 'de';
                setLanguage(lang);
                setLang(lang === 'de' ? 'de' : 'en');
                const inst = await socket.getInstances();
                const infos: Record<string, InstanceInfo> = {};
                for (const [id, obj] of Object.entries(inst)) {
                    const key = id.replace(/^system\.adapter\./, '');
                    const adapter = key.split('.')[0];
                    const icon = obj.common?.icon as string | undefined;
                    infos[key] = {
                        enabled: !!obj.common?.enabled,
                        icon: icon ? `../${adapter}/${icon}` : (obj.common?.extIcon as string | undefined),
                        title: key,
                        supportCustoms: !!obj.common?.supportCustoms,
                        native: obj.native,
                    };
                }
                setInstances(infos);
                const own = inst[`system.adapter.${ns}`];
                if (own?.native) {
                    setConfig(c => ({ ...c, ...(own.native as Partial<Config>) }));
                }
                try {
                    const saved = await socket.send<{ plan: EditorState; version?: number } | undefined>(
                        'plan.load',
                        {},
                    );
                    planVersion.current = saved?.version ?? 0;
                    const stored = saved?.plan ? { ...emptyState(), ...saved.plan } : undefined;
                    const last = session && { ...emptyState(), ...session.present };
                    if (
                        session &&
                        last &&
                        (session.planVersion === planVersion.current ||
                            (stored && JSON.stringify(stored) === JSON.stringify(last)))
                    ) {
                        // back from another admin page: the plan as it was, with its undo history
                        editor.restore(session.past, last, session.future);
                        savedPlan.current = last;
                        if (session.dirty && session.planVersion === planVersion.current) {
                            // the last changes did not reach the adapter before the tab was left
                            void savePlan(last, true).catch(fail);
                        }
                    } else if (stored) {
                        editor.reset(stored);
                        savedPlan.current = stored;
                    } else {
                        // no plan yet: the empty editor counts as stored
                        savedPlan.current = editor.state;
                    }
                } catch (e) {
                    fail(e);
                }
                // rooms and functions for the chips in the trees (ME-05)
                void socket.getEnums().then(enums => {
                    const map = new Map<string, string[]>();
                    for (const [id, obj] of Object.entries(enums)) {
                        if (!/^enum\.(rooms|functions)\./.test(id)) {
                            continue;
                        }
                        const n = obj.common?.name;
                        const label = typeof n === 'string' ? n : (n?.[language()] ?? n?.en ?? id.split('.').pop()!);
                        for (const member of (obj.common?.members as string[] | undefined) ?? []) {
                            map.set(member, [...(map.get(member) ?? []), label]);
                        }
                    }
                    setEnumNames(map);
                });
                const states = await socket.getStates(`${ns}.run.*`);
                const info: RunInfo = {};
                for (const [id, s] of Object.entries(states)) {
                    (info as Record<string, unknown>)[id.split('.').pop()!] = s?.val;
                }
                lastRunStatus.current = info.status;
                setRun(info);
                socket.subscribe(`${ns}.run.*`);
            } catch (e) {
                fail(e);
            } finally {
                setLoaded(true);
            }
        })();
        // (dependencies on purpose incomplete)
    }, [socket]);

    // ---- state values of both roots and run progress
    React.useEffect(() => {
        return socket.onState((id, s) => {
            if (id === `${ns}.run.log`) {
                try {
                    const { runId, ...entry } = JSON.parse(String(s?.val)) as RunLogEntry & { runId: string };
                    setRunLog(l =>
                        l.runId === runId
                            ? { runId, entries: mergeLog(l.entries, [entry]) }
                            : { runId, entries: [entry] },
                    );
                } catch {
                    // no log line
                }
            } else if (id.startsWith(`${ns}.run.`)) {
                setRun(r => ({ ...r, [id.split('.').pop()!]: s?.val }));
            } else {
                setValues(v => ({ ...v, [id]: s }));
            }
        });
    }, [socket, ns]);
    // whole object tree: one pattern per loaded namespace
    const valuePatterns = [...new Set([...left.patterns, ...right.patterns])].join('|');
    React.useEffect(() => {
        const patterns = valuePatterns ? valuePatterns.split('|') : [];
        patterns.forEach(p => {
            socket.subscribe(p);
            void socket.getStates(p).then(s => setValues(v => ({ ...v, ...s })));
        });
        return () => patterns.forEach(p => socket.unsubscribe(p));
    }, [socket, valuePatterns]);
    // values of linked sources outside the left root (preview of the conversion)
    React.useEffect(() => {
        const prefix = state.sourceRoot && state.sourceRoot !== ALL_OBJECTS ? `${state.sourceRoot}.` : undefined;
        const outside = [...new Set(state.links.map(l => l.sourceId))].filter(id => !prefix || !id.startsWith(prefix));
        outside.forEach(id => {
            socket.subscribe(id);
            void socket.getStates(id).then(s => setValues(v => ({ ...v, ...s })));
        });
        return () => outside.forEach(id => socket.unsubscribe(id));
    }, [socket, state.links, state.sourceRoot]);
    // states of objects created by "Schreiben" (aliases) - read again after the reload
    React.useEffect(() => {
        if (state.targetRoot && Object.keys(right.objects).length) {
            void socket.getStates(`${state.targetRoot}.*`).then(s => setValues(v => ({ ...v, ...s })));
        }
    }, [socket, state.targetRoot, right.objects]);

    // ---- log of the run: the lines so far (the tab may be opened while the run is active)
    React.useEffect(() => {
        if (!run.id) {
            return;
        }
        const runId = run.id;
        void socket
            .send<{ id: string; log?: RunLogEntry[] } | undefined>('run.status', { runId })
            .then(r => {
                if (r?.id === runId) {
                    setRunLog(l => ({ runId, entries: mergeLog(l.runId === runId ? l.entries : [], r.log ?? []) }));
                }
            })
            .catch(() => undefined);
    }, [socket, run.id]);
    React.useEffect(() => {
        locked.current = run.status === 'running';
        if (run.status === 'running') {
            setShowLog(true);
        }
    }, [run.status]);

    // ---- reload after a finished run (new objects, changed settings)
    React.useEffect(() => {
        if (lastRunStatus.current === 'running' && run.status && run.status !== 'running') {
            left.reload();
            right.reload();
            const status = run.status;
            const head = `${t('write')}: ${t((status as 'done') ?? 'done')}`;
            setToast({ text: head, severity: status === 'done' ? 'success' : 'warning' });
            // real numbers of the run: written / skipped because the target had them already
            void socket
                .send<{ results?: { stats?: { written: number; skippedExisting: number } }[] } | undefined>(
                    'run.status',
                    {},
                )
                .then(r => {
                    const stats = (r?.results ?? []).map(x => x?.stats).filter(x => !!x);
                    if (stats.length) {
                        const written = stats.reduce((n, x) => n + x.written, 0);
                        const skipped = stats.reduce((n, x) => n + x.skippedExisting, 0);
                        setToast({
                            text: `${head} – ${t('resultWritten', { written: written.toLocaleString(), skipped: skipped.toLocaleString() })}`,
                            severity: status === 'done' ? 'success' : 'warning',
                        });
                    }
                })
                .catch(() => undefined);
            if (run.status === 'done') {
                state.links.forEach(l => doneTargets.current.add(l.targetId));
            }
        }
        lastRunStatus.current = run.status;
        // (dependencies on purpose incomplete)
    }, [run.status]);

    // ---- leaving the tab: the admin removes the iframe (another admin page) - keep where the user was
    const latest = React.useRef<() => TabSession>(undefined);
    latest.current = (): TabSession => {
        const tree = (side: typeof left, root: string): TreeSession => ({
            root,
            expanded: [...side.expanded],
            filter: side.filter,
            onlySettings: side.onlySettings,
            // the state, not the element: when the iframe is removed there is no layout any more
            scroll: side.scroll,
        });
        return {
            savedAt: Date.now(),
            planVersion: planVersion.current,
            dirty: state !== savedPlan.current,
            past: editor.past,
            present: state,
            future: editor.future,
            view,
            selected,
            selectedLink,
            pickedSource,
            sourceSelection: [...sourceSelection],
            left: state.sourceRoot ? tree(left, state.sourceRoot) : undefined,
            right: state.targetRoot ? tree(right, state.targetRoot) : undefined,
            showLog,
            historyFor,
        };
    };
    React.useEffect(() => {
        if (!loaded) {
            // nothing to keep yet - and the state of the last visit must not be overwritten
            return;
        }
        const onLeave = (): void => {
            const now = latest.current!();
            writeSession(ns, now);
            // the autosave timer dies with the page: store the last changes right away
            if (now.dirty && !conflictRef.current && !locked.current) {
                void savePlan(now.present, true).catch(() => undefined);
            }
        };
        window.addEventListener('pagehide', onLeave);
        return () => window.removeEventListener('pagehide', onLeave);
        // savePlan only uses refs and the socket
        // (dependencies on purpose incomplete)
    }, [loaded, ns]);

    // ---- autosave of the draft (WR-01)
    const firstSave = React.useRef(true);
    React.useEffect(() => {
        if (!loaded) {
            return;
        }
        if (firstSave.current) {
            firstSave.current = false;
            return;
        }
        // nothing new (loaded, restored or just stored) - or another tab has stored in between
        if (conflictRef.current || state === savedPlan.current) {
            return;
        }
        const timer = setTimeout(() => void savePlan(state, true).catch(fail), 1500);
        return () => clearTimeout(timer);
        // savePlan is stable enough - it only uses refs and the socket
        // (dependencies on purpose incomplete)
    }, [state, loaded, socket]);

    /**
     * Stores the plan. With check, a plan saved by another tab in between is not overwritten.
     *
     * @param plan - editor state
     * @param check - compare the version
     */
    async function savePlan(plan: EditorState, check: boolean): Promise<boolean> {
        const res = await socket.send<{ version: number; conflict?: boolean; savedAt?: number }>('plan.save', {
            plan,
            baseVersion: check ? planVersion.current : undefined,
        });
        if (res.conflict) {
            setConflict({ savedAt: res.savedAt });
            return false;
        }
        planVersion.current = res.version;
        savedPlan.current = plan;
        return true;
    }

    // ---- objects of linked sources outside the current left root
    React.useEffect(() => {
        const missing = [...new Set(state.links.map(l => l.sourceId))].filter(
            id => !left.objects[id] && !extraObjects[id],
        );
        if (!missing.length) {
            return;
        }
        void Promise.all(missing.map(id => socket.getObject(id).then(o => [id, o] as const))).then(list =>
            setExtraObjects(x => ({
                ...x,
                ...Object.fromEntries(list.filter((e): e is readonly [string, ObjInfo] => !!e[1])),
            })),
        );
    }, [state.links, left.objects, extraObjects, socket]);

    // ---- size of the tree area for the lines
    React.useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) {
            return;
        }
        const ro = new ResizeObserver(() => setBodyHeight(el.clientHeight));
        ro.observe(el);
        setBodyHeight(el.clientHeight);
        return () => ro.disconnect();
    }, [loaded]);

    const allObjects = React.useMemo(
        () => ({ ...extraObjects, ...left.objects, ...right.objects }),
        [extraObjects, left.objects, right.objects],
    );
    const objectOf = (id: string): ObjInfo | undefined =>
        right.nodes.get(id)?.obj ?? left.nodes.get(id)?.obj ?? allObjects[id];

    // ---- link display
    const drawLinks: DrawLink[] = React.useMemo(
        () =>
            state.links.map(l => {
                const c = compat(objectOf(l.sourceId), objectOf(l.targetId));
                return {
                    ...l,
                    level: c.level,
                    reason: c.reason,
                    done: doneTargets.current.has(l.targetId),
                    existing: isUnchangedImport(state, l.targetId, objectOf(l.targetId)),
                };
            }),
        // (dependencies on purpose incomplete)
        [state.links, state.options, allObjects, right.nodes, left.nodes, run.status],
    );
    const countLinks = (ids: string[]): Map<string, number> => {
        const map = new Map<string, number>();
        for (const id of ids) {
            const parts = id.split('.');
            for (let i = parts.length; i > 0; i--) {
                const p = parts.slice(0, i).join('.');
                map.set(p, (map.get(p) ?? 0) + 1);
            }
        }
        return map;
    };
    const leftCounts = React.useMemo(() => countLinks(state.links.map(l => l.sourceId)), [state.links]);
    const rightCounts = React.useMemo(() => countLinks(state.links.map(l => l.targetId)), [state.links]);

    const highlight = React.useMemo(() => {
        const set = new Set<string>();
        if (selected?.side === 'target') {
            sourcesOf(state, selected.id).forEach(id => set.add(id));
        } else if (selected?.side === 'source') {
            state.links.filter(l => l.sourceId === selected.id).forEach(l => set.add(l.targetId));
        }
        return set;
    }, [selected, state]);
    const focusIds = React.useMemo(
        () => (selected ? new Set([selected.id, ...highlight]) : new Set<string>()),
        [selected, highlight],
    );

    // a read-in mapping (FR-56) is not "changed" while it is as it was
    const changed = React.useMemo(
        () => new Set([...changedTargets(state)].filter(id => !isUnchangedImport(state, id, objectOf(id)))),
        // (dependencies on purpose incomplete)
        [state, allObjects, right.nodes],
    );
    const overridden = React.useMemo(() => {
        const set = new Set<string>();
        for (const [target, opts] of Object.entries(state.options)) {
            Object.keys(opts.overrides ?? {}).forEach(k => set.add(`${target}|${k}`));
        }
        return set;
    }, [state.options]);

    // ---- actions
    const mirror = async (
        sourceRoot: string,
        basePath: string,
        keepBelow?: string,
        onlySourceIds?: string[],
    ): Promise<string | undefined> => {
        const res = await socket.send<{ errors: Message[]; drafts: DraftObject[] }>('mirror.preview', {
            sourceRoot,
            basePath,
            onlySourceIds,
        });
        if (res.errors.length) {
            return res.errors.map(e => formatMessage(e, language())).join(', ');
        }
        // dropped into an existing node: its own draft and its parents stay as they are
        const drafts = keepBelow ? res.drafts.filter(d => d.id.startsWith(`${keepBelow}.`)) : res.drafts;
        editor.update(s => applyMirror(s, drafts));
        right.setExpanded(prev => new Set([...prev, ...drafts.filter(d => d.type !== 'state').map(d => d.id)]));
        return undefined;
    };

    const onDrop = (payload: DragPayload, row: Row): void => {
        const target = row.node;
        if (payload.side === 'source' && payload.ids?.length && target.type !== 'state') {
            // several selected objects: mirror them below the target node, relative to their common parent
            const ids = payload.ids;
            const parts = ids.map(id => id.split('.'));
            let common = parts[0].slice(0, -1);
            for (const p of parts) {
                let i = 0;
                while (i < common.length && i < p.length - 1 && common[i] === p[i]) {
                    i++;
                }
                common = common.slice(0, i);
            }
            if (target.id.startsWith('alias.') && common.length >= 2) {
                void mirror(common.join('.'), target.id, target.id, ids)
                    .then(error => error && fail(new Error(error)))
                    .catch(fail);
                right.setExpanded(prev => new Set([...prev, target.id]));
            }
            return;
        }
        if (payload.side === 'source') {
            const source = left.nodes.get(payload.id);
            if (!source) {
                return;
            }
            if (source.type === 'state' && target.type === 'state') {
                editor.update(s => addLink(s, source.id, target.id));
                setSelected({ side: 'target', id: target.id });
            } else if (target.type !== 'state') {
                const links = source.type === 'state' ? [] : autoLinks(source, target, language());
                if (links.length) {
                    editor.update(s => links.reduce((acc, l) => addLink(acc, l.sourceId, l.targetId), s));
                    setToast({ text: `${links.length} × ${t('link')}`, severity: 'success' });
                } else if (target.id.startsWith('alias.')) {
                    // nothing matches: mirror the dragged node/state below the target node (EM-07)
                    const isState = source.type === 'state';
                    const sourceRoot = isState ? source.id.slice(0, source.id.lastIndexOf('.')) : source.id;
                    const basePath = isState ? target.id : `${target.id}.${normalizeIdPart(source.part)}`;
                    void (async () => {
                        const res = await socket.send<{ errors: Message[]; drafts: DraftObject[] }>('mirror.preview', {
                            sourceRoot,
                            basePath,
                            onlySourceIds: isState ? [source.id] : undefined,
                        });
                        if (res.errors.length) {
                            fail(new Error(res.errors.map(e => formatMessage(e, language())).join(', ')));
                            return;
                        }
                        const drafts = res.drafts.filter(d => d.id.startsWith(`${target.id}.`));
                        editor.update(s => applyMirror(s, drafts));
                        right.setExpanded(
                            prev =>
                                new Set([...prev, target.id, ...drafts.filter(d => d.type !== 'state').map(d => d.id)]),
                        );
                    })().catch(fail);
                } else {
                    setToast({ text: t('noMatches'), severity: 'info' });
                }
            }
        } else if (payload.side === 'target' && target.type !== 'state' && payload.id !== target.id) {
            const part = payload.id.split('.').pop()!;
            editor.update(s => moveDraft(s, payload.id, `${target.id}.${part}`));
            right.setExpanded(prev => new Set([...prev, target.id]));
        }
    };

    /** a DB name change was started (FR-57) - its log shows what happens */
    const dbRunStarted = (runId: string): void => {
        lastRunStatus.current = 'running';
        setShowLog(true);
        setToast({ text: `${t('write')}: ${runId}`, severity: 'info' });
    };

    /** existing alias mappings below a node of the target tree become links (FR-56) */
    const importFrom = (nodeId: string): void => {
        const res = importAliases(state, { ...allObjects, ...right.objects }, nodeId);
        if (res.state !== state) {
            editor.update(() => res.state);
            right.setExpanded(
                prev => new Set([...prev, nodeId, ...res.imported.map(id => id.slice(0, id.lastIndexOf('.')))]),
            );
        }
        // the sources in the left tree: parents expanded, scrolled to the first one
        left.reveal(res.sources, res.state.sourceRoot);
        const text = [
            t('importedAliases', { n: res.imported.length }),
            res.already.length ? t('importedAlready', { n: res.already.length }) : '',
            res.conflicts.length
                ? t('importConflicts', {
                      n: res.conflicts.length,
                      list: res.conflicts.map(c => `${c.sourceId} → ${c.linkedTo}`).join(', '),
                  })
                : '',
        ]
            .filter(Boolean)
            .join(' · ');
        setToast({
            text,
            severity: res.conflicts.length ? 'warning' : res.imported.length ? 'success' : 'info',
        });
    };

    const runCheck = async (current: EditorState = state, scope: string | undefined = checkScope): Promise<void> => {
        setCheckState({ loading: true });
        try {
            const result = await socket.send<CheckResult>('plan.check', buildPlan(current, allObjects, scope));
            setCheckState({ loading: false, result });
        } catch (e) {
            setCheckState({ loading: false, error: (e as Error).message });
        }
    };

    const runWrite = async (): Promise<void> => {
        setCheckState(c => ({ ...c, loading: true }));
        try {
            const res = await socket.send<{ runId?: string; check: CheckResult }>(
                'plan.write',
                buildPlan(state, allObjects, checkScope),
            );
            if (res.runId) {
                setCheckState(undefined);
                lastRunStatus.current = 'running';
                setToast({ text: `${t('write')}: ${res.runId}`, severity: 'info' });
            } else {
                setCheckState({ loading: false, result: res.check });
            }
        } catch (e) {
            setCheckState(c => ({ ...c, loading: false, error: (e as Error).message }));
        }
    };

    const showHistory = (id: string): void => setHistoryFor(id);
    const historyRequest: HistoryRequest | undefined = historyFor
        ? {
              id: historyFor,
              sources: sourcesOf(state, historyFor),
              overlap: overlapOf(state, historyFor),
              excluded: state.options[historyFor]?.excluded,
              converters: Object.fromEntries(
                  sourcesOf(state, historyFor)
                      .map(src => [src, converterToAlias(converterOf(state, historyFor, src)).read])
                      .filter((e): e is [string, string] => !!e[1]),
              ),
          }
        : undefined;

    // ---- keyboard: undo/redo, delete (ME-14, ME-17)
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || locked.current) {
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                editor.undo();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                editor.redo();
            } else if (e.key === 'Delete') {
                if (selectedLink) {
                    editor.update(s => removeLink(s, selectedLink));
                    setSelectedLink(undefined);
                } else if (selected?.side === 'target' && right.nodes.get(selected.id)?.draft) {
                    editor.update(s => removeDraft(s, selected.id));
                    setSelected(undefined);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editor, selected, selectedLink, right.nodes]);

    const startResize = (e: React.MouseEvent, which: 'left' | 'panel'): void => {
        e.preventDefault();
        const startX = e.clientX;
        const start = widths[which];
        let latest = widths;
        const move = (ev: MouseEvent): void => {
            const delta = ev.clientX - startX;
            const value = Math.max(240, Math.min(1400, which === 'left' ? start + delta : start - delta));
            latest = { ...latest, [which]: value };
            setWidths(latest);
        };
        const up = (): void => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            try {
                window.localStorage.setItem('objectmigrator.widths', JSON.stringify(latest));
            } catch {
                // no storage
            }
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const startLogResize = (e: React.MouseEvent): void => {
        e.preventDefault();
        const startY = e.clientY;
        const start = logHeight;
        // the editor keeps at least 200 px; never above the CSS limit of .om-runlog-box .om-runlog
        const max = Math.max(
            LOG_MIN,
            Math.min(window.innerHeight - 350, start + (mainRef.current?.clientHeight ?? 0) - 200),
        );
        let latest = start;
        const move = (ev: MouseEvent): void => {
            latest = Math.round(Math.max(LOG_MIN, Math.min(max, start + startY - ev.clientY)));
            setLogHeight(latest);
        };
        const up = (): void => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            try {
                window.localStorage.setItem('objectmigrator.logHeight', String(latest));
            } catch {
                // no storage
            }
        };
        document.body.style.cursor = 'row-resize';
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    if (!loaded) {
        return <LinearProgress />;
    }

    const selectedNode = selected
        ? (selected.side === 'source' ? left.nodes : right.nodes).get(selected.id)
        : undefined;
    const running = run.status === 'running';
    // keyboard alternative to drag & drop (ME-18): select a source state, then a target state
    const canLink =
        !!pickedSource &&
        selected?.side === 'target' &&
        selectedNode?.type === 'state' &&
        !state.links.some(l => l.sourceId === pickedSource && l.targetId === selected.id);

    const treeHeader = (side: 'source' | 'target'): React.JSX.Element => {
        const tree = side === 'source' ? left : right;
        const root = side === 'source' ? state.sourceRoot : state.targetRoot;
        return (
            <div className="om-tree-header">
                <div className="om-tree-title">
                    <b>{side === 'source' ? t('source') : t('target')}</b>
                    {tree.loading && <span className="om-muted"> …</span>}
                    <span className="om-spacer" />
                    {side === 'source' && sourceSelection.size > 1 && (
                        <span className="om-chip">{t('selected', { n: sourceSelection.size })}</span>
                    )}
                    {side === 'target' && (
                        <>
                            <Button
                                size="small"
                                onClick={() => setApplyTemplateOpen(true)}
                            >
                                ★ {t('fromTemplate')}
                            </Button>
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={!state.sourceRoot || state.sourceRoot === ALL_OBJECTS}
                                onClick={() => setCreateMode({})}
                            >
                                ✚ {t('createMode')}
                            </Button>
                        </>
                    )}
                </div>
                <div className="om-tree-tools">
                    <Tooltip title={t('upLevel')}>
                        <span>
                            <Button
                                size="small"
                                sx={{ minWidth: 32 }}
                                disabled={
                                    side === 'source' ? !root || root === ALL_OBJECTS : root.split('.').length < 2
                                }
                                onClick={() => {
                                    // left: above an adapter instance comes the whole object tree
                                    const up =
                                        side === 'source' && root.split('.').length <= 2
                                            ? ALL_OBJECTS
                                            : root.slice(0, root.lastIndexOf('.'));
                                    editor.update(s =>
                                        side === 'source' ? { ...s, sourceRoot: up } : { ...s, targetRoot: up },
                                    );
                                }}
                            >
                                ↑
                            </Button>
                        </span>
                    </Tooltip>
                    <RootPicker
                        value={root}
                        choices={side === 'source' ? [ALL_OBJECTS, ...rootChoices] : rootChoices}
                        onChange={v =>
                            side === 'source'
                                ? editor.update(s => ({ ...s, sourceRoot: v }))
                                : v !== ALL_OBJECTS && editor.update(s => ({ ...s, targetRoot: v }))
                        }
                    />
                    <TextField
                        size="small"
                        sx={{ width: 140 }}
                        label={t('filter')}
                        value={tree.filter}
                        onChange={e => tree.setFilter(e.target.value)}
                    />
                    {side === 'source' && (
                        <Tooltip title={t('onlySettings')}>
                            <FormControlLabel
                                sx={{ mr: 0 }}
                                control={
                                    <Checkbox
                                        size="small"
                                        checked={tree.onlySettings}
                                        onChange={e => tree.setOnlySettings(e.target.checked)}
                                    />
                                }
                                label="⚙"
                            />
                        </Tooltip>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={`om-app ${props.dark ? 'om-dark' : ''}`}>
            {!connected && <Alert severity="error">{t('disconnected')}</Alert>}
            <div className="om-topbar">
                {(['editor', 'runs', 'refs', 'db'] as const).map(v => (
                    <span
                        key={v}
                        className={`om-tab ${view === v ? 'om-tab-on' : ''}`}
                        onClick={() => setView(v)}
                    >
                        {t(
                            v === 'editor'
                                ? 'viewEditor'
                                : v === 'runs'
                                  ? 'runs'
                                  : v === 'refs'
                                    ? 'references'
                                    : 'dbNames',
                        )}
                    </span>
                ))}
                <span className="om-spacer" />
                {running && (
                    <span className="om-muted">
                        {t('running')} {Number(run.progress || 0).toFixed(1)} %
                    </span>
                )}
                <span className="om-lang">
                    {(['de', 'en'] as const).map(l => (
                        <span
                            key={l}
                            className={l === lang ? 'om-lang-on' : ''}
                            onClick={() => {
                                setLanguage(l);
                                setLang(l);
                                try {
                                    window.localStorage.setItem('objectmigrator.lang', l);
                                } catch {
                                    // no storage
                                }
                            }}
                        >
                            {l.toUpperCase()}
                        </span>
                    ))}
                </span>
            </div>
            {view === 'runs' && (
                <RunsView
                    socket={socket}
                    running={running}
                />
            )}
            {view === 'refs' && (
                <RefsView
                    socket={socket}
                    links={state.links}
                />
            )}
            {view === 'db' && (
                <DbNamesView
                    socket={socket}
                    running={running}
                    historyInstance={config.historyInstance}
                    onStarted={dbRunStarted}
                />
            )}
            {dbEdit && (
                <DbNameDialog
                    socket={socket}
                    id={dbEdit.id}
                    instance={dbEdit.instance}
                    current={dbEdit.current}
                    historyInstance={config.historyInstance}
                    running={running}
                    onClose={() => setDbEdit(undefined)}
                    onStarted={runId => {
                        setDbEdit(undefined);
                        dbRunStarted(runId);
                    }}
                />
            )}
            {view === 'editor' && (
                <>
                    {running && (
                        <Alert
                            severity="info"
                            sx={{ py: 0 }}
                        >
                            {t('runLocked')}
                        </Alert>
                    )}
                    <div
                        ref={mainRef}
                        className={`om-main ${running ? 'om-locked' : ''}`}
                        inert={running}
                        style={{
                            gridTemplateColumns: `${widths.left}px 6px ${GUTTER}px minmax(240px, 1fr) 6px ${widths.panel}px`,
                        }}
                    >
                        <div style={{ gridColumn: 1, gridRow: 1 }}>{treeHeader('source')}</div>
                        <div
                            className="om-splitter"
                            style={{ gridColumn: 2, gridRow: '1 / 3' }}
                            onMouseDown={e => startResize(e, 'left')}
                        />
                        <div
                            className="om-gutter-head"
                            style={{ gridColumn: 3, gridRow: 1 }}
                        >
                            <LinkLegend dark={props.dark} />
                        </div>
                        <div style={{ gridColumn: 4, gridRow: 1 }}>{treeHeader('target')}</div>
                        <div
                            className="om-splitter"
                            style={{ gridColumn: 5, gridRow: '1 / 3' }}
                            onMouseDown={e => startResize(e, 'panel')}
                        />
                        <div
                            className="om-panel-header"
                            style={{ gridColumn: 6, gridRow: 1 }}
                        >
                            <b>{t('properties')}</b>
                        </div>

                        <div
                            className="om-tree-box"
                            style={{ gridColumn: 1, gridRow: 2 }}
                            ref={bodyRef}
                        >
                            {state.sourceRoot ? (
                                <ObjectTree
                                    side="source"
                                    rows={left.rows}
                                    scrollRef={left.scrollRef}
                                    onScroll={left.onScroll}
                                    selectedId={selected?.side === 'source' ? selected.id : undefined}
                                    selectedIds={sourceSelection}
                                    linkCount={leftCounts}
                                    highlight={highlight}
                                    instances={instances}
                                    values={values}
                                    overridden={new Set()}
                                    enumsOf={id => enumNames.get(id)}
                                    onToggle={left.toggle}
                                    onSelect={(id, mode) => {
                                        setSelected({ side: 'source', id });
                                        setSelectedLink(undefined);
                                        setPickedSource(left.nodes.get(id)?.type === 'state' ? id : undefined);
                                        setSourceSelection(prev => {
                                            if (mode === 'toggle') {
                                                const next = new Set(prev);
                                                if (next.has(id)) {
                                                    next.delete(id);
                                                } else {
                                                    next.add(id);
                                                }
                                                return next;
                                            }
                                            if (mode === 'range' && selectionAnchor.current) {
                                                const a = left.index.get(selectionAnchor.current);
                                                const b = left.index.get(id);
                                                if (a !== undefined && b !== undefined) {
                                                    const [from, to] = a < b ? [a, b] : [b, a];
                                                    return new Set(left.rows.slice(from, to + 1).map(r => r.node.id));
                                                }
                                            }
                                            return new Set([id]);
                                        });
                                        if (mode !== 'range') {
                                            selectionAnchor.current = id;
                                        }
                                    }}
                                    onSetRoot={id => editor.update(s => ({ ...s, sourceRoot: id }))}
                                    onDrop={() => undefined}
                                    onShowHistory={showHistory}
                                    isUnlinkedWithSettings={id => {
                                        const node = left.nodes.get(id);
                                        return (
                                            !!node &&
                                            hasSettings(node) &&
                                            !linkedSources.has(id) &&
                                            state.links.length > 0
                                        );
                                    }}
                                />
                            ) : (
                                <div className="om-empty">
                                    {t('noRoot')}
                                    <div>
                                        <Button
                                            size="small"
                                            onClick={() => editor.update(s => ({ ...s, sourceRoot: ALL_OBJECTS }))}
                                        >
                                            {t('showAllObjects')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div
                            className="om-gutter"
                            style={{ gridColumn: 3, gridRow: 2 }}
                        >
                            <LinkLayer
                                links={drawLinks}
                                leftIndex={left.index}
                                rightIndex={right.index}
                                leftScroll={left.scroll}
                                rightScroll={right.scroll}
                                height={bodyHeight}
                                width={GUTTER}
                                selected={selectedLink}
                                focusIds={focusIds}
                                onSelect={link => {
                                    setSelectedLink(link);
                                    setSelected({ side: 'target', id: link.targetId });
                                }}
                            />
                        </div>
                        <div
                            className="om-tree-box"
                            style={{ gridColumn: 4, gridRow: 2 }}
                        >
                            {state.targetRoot ? (
                                <ObjectTree
                                    side="target"
                                    rows={right.rows}
                                    scrollRef={right.scrollRef}
                                    onScroll={right.onScroll}
                                    selectedId={selected?.side === 'target' ? selected.id : undefined}
                                    linkCount={rightCounts}
                                    highlight={highlight}
                                    instances={instances}
                                    values={values}
                                    overridden={overridden}
                                    enumsOf={id => enumNames.get(id)}
                                    changed={changed}
                                    onToggle={right.toggle}
                                    onSelect={id => {
                                        setSelected({ side: 'target', id });
                                        setSelectedLink(undefined);
                                    }}
                                    onSetRoot={id => editor.update(s => ({ ...s, targetRoot: id }))}
                                    onImport={running ? undefined : importFrom}
                                    onDrop={onDrop}
                                    onShowHistory={showHistory}
                                />
                            ) : (
                                <div className="om-empty">{t('noTarget')}</div>
                            )}
                        </div>
                        <div
                            className="om-panel-box"
                            style={{ gridColumn: 6, gridRow: 2 }}
                        >
                            {selectedNode && selected ? (
                                <PropertiesPanel
                                    key={`${selected.side}|${selected.id}`}
                                    side={selected.side}
                                    node={selectedNode}
                                    state={state}
                                    socket={socket}
                                    enumsOf={id => enumNames.get(id) ?? []}
                                    onPickObject={(start, done) => setPicker({ start, done })}
                                    pickStart={state.sourceRoot === ALL_OBJECTS ? '' : state.sourceRoot}
                                    objects={allObjects}
                                    values={values}
                                    instances={instances}
                                    onRename={(oldId, newId) => {
                                        editor.update(s => moveDraft(s, oldId, newId));
                                        setSelected({ side: 'target', id: newId });
                                    }}
                                    onUpdateDraft={(id, patch) => editor.update(s => updateDraft(s, id, patch))}
                                    onRemoveDraft={id => {
                                        editor.update(s => removeDraft(s, id));
                                        setSelected(undefined);
                                    }}
                                    onAddNode={(parentId, type) => {
                                        const names = {
                                            folder: t('newFolder'),
                                            channel: t('newChannel'),
                                            device: t('newDevice'),
                                        };
                                        editor.update(s => addNode(s, parentId, type, names[type]));
                                        right.setExpanded(prev => new Set([...prev, parentId]));
                                    }}
                                    onAddState={parentId => {
                                        const added = addState(state, parentId, t('newValue'));
                                        editor.update(() => added.state);
                                        right.setExpanded(prev => new Set([...prev, parentId]));
                                        setSelected({ side: 'target', id: added.id });
                                    }}
                                    onSaveTemplate={id => setSaveTemplateFor(id)}
                                    onLink={(sourceId, targetId) => editor.update(s => addLink(s, sourceId, targetId))}
                                    onOptions={(id, patch) => editor.update(s => setOptions(s, id, patch))}
                                    onUnlink={(sourceId, targetId) =>
                                        editor.update(s => removeLink(s, { sourceId, targetId }))
                                    }
                                    onSelect={(side, id) => setSelected({ side, id })}
                                    onShowHistory={showHistory}
                                    onImport={running || selected.side !== 'target' ? undefined : importFrom}
                                    onDbName={
                                        running
                                            ? undefined
                                            : (id, instance, current) => setDbEdit({ id, instance, current })
                                    }
                                />
                            ) : (
                                <div className="om-panel om-muted">
                                    <p>{t('nothingSelected')}</p>
                                    <p>{t('help')}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {showLog && (
                        <div className="om-runlog-box">
                            <div
                                className="om-splitter-h"
                                title={t('logResize')}
                                onMouseDown={startLogResize}
                            />
                            <div className="om-runlog-head">
                                <b>{t('runLog')}</b>
                                {runLog.runId && <span className="om-muted">{runLog.runId}</span>}
                                <span className="om-spacer" />
                                <Button
                                    size="small"
                                    onClick={() => setShowLog(false)}
                                >
                                    ✕
                                </Button>
                            </div>
                            <RunLog
                                entries={runLog.entries}
                                height={logHeight}
                            />
                        </div>
                    )}
                    <div className="om-bar">
                        {!running && (
                            <>
                                <Button
                                    size="small"
                                    disabled={!editor.canUndo}
                                    onClick={editor.undo}
                                    title="Ctrl+Z"
                                >
                                    ↶ {t('undo')}
                                </Button>
                                <Button
                                    size="small"
                                    disabled={!editor.canRedo}
                                    onClick={editor.redo}
                                    title="Ctrl+Y"
                                >
                                    ↷ {t('redo')}
                                </Button>
                            </>
                        )}
                        {!running && canLink && (
                            <Button
                                size="small"
                                variant="outlined"
                                title={`${pickedSource} → ${selected?.id}`}
                                onClick={() => editor.update(s => addLink(s, pickedSource, selected.id))}
                            >
                                ↔ {t('link')}
                            </Button>
                        )}
                        {!running && selectedLink && (
                            <Button
                                size="small"
                                color="error"
                                onClick={() => {
                                    editor.update(s => removeLink(s, selectedLink));
                                    setSelectedLink(undefined);
                                }}
                            >
                                ✕ {t('unlink')}
                            </Button>
                        )}
                        <span className="om-muted">
                            {state.links.length} ↔ · {state.drafts.length} {t('draft')}
                        </span>
                        <div className="om-run">
                            {run.status && (
                                <>
                                    <span>
                                        {t((run.status as 'done') ?? 'done')}
                                        {running && run.phase ? ` · ${t(`phase_${run.phase}` as 'phase_history')}` : ''}
                                        {running && run.current ? ` · ${run.current}` : ''}
                                    </span>
                                    {running && (
                                        <LinearProgress
                                            variant="determinate"
                                            value={Number(run.progress) || 0}
                                            sx={{ flex: 1, minWidth: 80 }}
                                        />
                                    )}
                                    {running && <span>{Number(run.progress || 0).toFixed(1)} %</span>}
                                </>
                            )}
                        </div>
                        <Button
                            size="small"
                            variant={showLog ? 'outlined' : 'text'}
                            onClick={() => setShowLog(v => !v)}
                        >
                            ☰ {t('runLog')}
                        </Button>
                        {running ? (
                            <>
                                <Tooltip title={t('runStopHelp')}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        onClick={() => void socket.send('run.cancel').catch(fail)}
                                    >
                                        ■ {t('runStop')}
                                    </Button>
                                </Tooltip>
                                <Tooltip title={t('runAbortHelp')}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="error"
                                        onClick={() => setConfirmAbort(true)}
                                    >
                                        ✕ {t('runAbort')}
                                    </Button>
                                </Tooltip>
                            </>
                        ) : (
                            <>
                                <Button
                                    size="small"
                                    color="error"
                                    disabled={
                                        !state.links.length &&
                                        !state.drafts.length &&
                                        !Object.keys(state.options).length
                                    }
                                    onClick={() => setConfirmClear(true)}
                                >
                                    {t('clearPlan')}
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() =>
                                        void savePlan(state, true)
                                            .then(ok => ok && setToast({ text: t('saved'), severity: 'success' }))
                                            .catch(fail)
                                    }
                                >
                                    {t('savePlan')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    disabled={!state.links.length && !state.drafts.length}
                                    onClick={() => {
                                        setCheckScope(undefined);
                                        void runCheck(state, undefined);
                                    }}
                                >
                                    {t('check')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="contained"
                                    color="warning"
                                    disabled={!state.links.length && !state.drafts.length}
                                    onClick={() => {
                                        setCheckScope(undefined);
                                        void runCheck(state, undefined);
                                    }}
                                >
                                    ✎ {t('write')}
                                </Button>
                            </>
                        )}
                    </div>
                </>
            )}

            {picker && (
                <ObjectPicker
                    socket={socket}
                    start={picker.start}
                    onClose={() => setPicker(undefined)}
                    onSelect={id => {
                        picker.done(id);
                        setPicker(undefined);
                    }}
                />
            )}
            {conflict && (
                <Dialog open>
                    <DialogTitle>{t('conflictTitle')}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {t('conflictText', {
                                time: conflict.savedAt ? new Date(conflict.savedAt).toLocaleTimeString() : '',
                            })}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            onClick={() =>
                                void socket
                                    .send<{ plan: EditorState; version?: number } | undefined>('plan.load', {})
                                    .then(saved => {
                                        planVersion.current = saved?.version ?? 0;
                                        const stored = { ...emptyState(), ...(saved?.plan ?? {}) };
                                        savedPlan.current = stored;
                                        editor.reset(stored);
                                        setConflict(undefined);
                                    })
                                    .catch(fail)
                            }
                        >
                            {t('conflictReload')}
                        </Button>
                        <Button
                            variant="contained"
                            color="warning"
                            onClick={() =>
                                void savePlan(state, false)
                                    .then(() => setConflict(undefined))
                                    .catch(fail)
                            }
                        >
                            {t('conflictOverwrite')}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
            {createMode && (
                <CreateModeDialog
                    defaultPath={
                        state.basePath ||
                        `${config.defaultBasePath || 'alias.0'}.${normalizeIdPart(
                            nodeName(left.tree, language()).replace(/\./g, '_'),
                        )}`
                    }
                    sourceRoot={state.sourceRoot}
                    selection={[...sourceSelection].filter(id => id !== state.sourceRoot)}
                    error={createMode.error}
                    onClose={() => setCreateMode(undefined)}
                    onMirror={(basePath, sourceRoot, only) =>
                        void mirror(sourceRoot, basePath, undefined, only)
                            .then(error => {
                                if (error) {
                                    setCreateMode({ error });
                                } else {
                                    editor.update(s => ({ ...s, basePath, targetRoot: basePath }));
                                    setCreateMode(undefined);
                                }
                            })
                            .catch(e => setCreateMode({ error: (e as Error).message }))
                    }
                />
            )}
            {confirmAbort && (
                <Dialog
                    open
                    onClose={() => setConfirmAbort(false)}
                >
                    <DialogTitle>{t('runAbortTitle')}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>{t('runAbortText')}</DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmAbort(false)}>{t('cancel')}</Button>
                        <Button
                            variant="contained"
                            color="error"
                            onClick={() => {
                                setConfirmAbort(false);
                                void socket.send('run.abort').catch(fail);
                            }}
                        >
                            ✕ {t('runAbort')}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
            {confirmClear && (
                <Dialog
                    open
                    onClose={() => setConfirmClear(false)}
                >
                    <DialogTitle>{t('clearPlan')}?</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {t('clearPlanText', {
                                drafts: state.drafts.length,
                                links: state.links.length,
                                options: Object.keys(state.options).length,
                            })}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmClear(false)}>{t('cancel')}</Button>
                        <Button
                            variant="contained"
                            color="error"
                            onClick={() => {
                                // the roots stay - only the definitions are removed
                                editor.update(s => ({
                                    ...emptyState(),
                                    sourceRoot: s.sourceRoot,
                                    targetRoot: s.targetRoot,
                                }));
                                setSelected(undefined);
                                setSelectedLink(undefined);
                                setConfirmClear(false);
                            }}
                        >
                            {t('clearPlan')}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
            {saveTemplateFor && right.nodes.get(saveTemplateFor) && (
                <SaveTemplateDialog
                    nodeName={nodeName(right.nodes.get(saveTemplateFor)!, language())}
                    onClose={() => setSaveTemplateFor(undefined)}
                    onSave={(name, replacements) => {
                        const template = makeTemplate(name, right.nodes.get(saveTemplateFor)!, state, replacements);
                        void socket
                            .send('template.save', { name, template })
                            .then(() => setToast({ text: `${t('template')}: ${name}`, severity: 'success' }))
                            .catch(fail);
                        setSaveTemplateFor(undefined);
                    }}
                />
            )}
            {applyTemplateOpen && (
                <ApplyTemplateDialog
                    socket={socket}
                    defaultParent={
                        selected?.side === 'target' && right.nodes.get(selected.id)?.type !== 'state'
                            ? selected.id
                            : state.targetRoot || config.defaultBasePath || 'alias.0'
                    }
                    linkSource={selected?.side === 'source' && selectedNode?.type !== 'state' ? selected.id : undefined}
                    onClose={() => setApplyTemplateOpen(false)}
                    onApply={(template, basePath, vars) => {
                        let next = applyTemplate(state, template, basePath, vars);
                        // a selected source node: link the new values by path/name
                        const sourceNode = selected?.side === 'source' ? left.nodes.get(selected.id) : undefined;
                        if (sourceNode && sourceNode.type !== 'state') {
                            const tree = buildTree(basePath, {}, next.drafts);
                            next = autoLinks(sourceNode, tree, language()).reduce(
                                (acc, l) => addLink(acc, l.sourceId, l.targetId),
                                next,
                            );
                        }
                        const targetRoot =
                            state.targetRoot && basePath.startsWith(`${state.targetRoot}.`)
                                ? state.targetRoot
                                : basePath;
                        editor.update(() => ({ ...next, targetRoot }));
                        right.setExpanded(
                            prev =>
                                new Set([
                                    ...prev,
                                    basePath,
                                    ...next.drafts.filter(d => d.type !== 'state').map(d => d.id),
                                ]),
                        );
                        setApplyTemplateOpen(false);
                    }}
                />
            )}
            {checkState && (
                <CheckDialog
                    check={checkState.result}
                    loading={checkState.loading}
                    error={checkState.error}
                    instances={instances}
                    chunkSize={config.chunkSize}
                    pauseMs={config.chunkPauseMs}
                    onClose={() => setCheckState(undefined)}
                    onWrite={() => void runWrite()}
                    scopeNode={selected?.side === 'target' ? selected.id : undefined}
                    scope={checkScope}
                    onScope={scope => {
                        setCheckScope(scope);
                        void runCheck(state, scope);
                    }}
                    onDiscard={id => {
                        const next = clearOptions(state, id);
                        editor.update(() => next);
                        void runCheck(next);
                    }}
                />
            )}
            {historyRequest && (
                <HistoryDialog
                    socket={socket}
                    request={historyRequest}
                    dark={props.dark}
                    onClose={() => setHistoryFor(undefined)}
                    onSetCut={ts => {
                        const sources = sourcesOf(state, historyRequest.id);
                        editor.update(s =>
                            setOptions(s, historyRequest.id, {
                                overlap: { type: 'cut', at: ts, oldSourceIds: sources.slice(0, -1) },
                            }),
                        );
                    }}
                    onToggleExclude={key => {
                        const current = new Set(state.options[historyRequest.id]?.excluded ?? []);
                        if (current.has(key)) {
                            current.delete(key);
                        } else {
                            current.add(key);
                        }
                        editor.update(s => setOptions(s, historyRequest.id, { excluded: [...current] }));
                    }}
                />
            )}
            <Snackbar
                open={!!toast}
                autoHideDuration={5000}
                onClose={() => setToast(undefined)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                {toast ? (
                    <Alert
                        severity={toast.severity}
                        onClose={() => setToast(undefined)}
                    >
                        {toast.text}
                    </Alert>
                ) : undefined}
            </Snackbar>
        </div>
    );
}
