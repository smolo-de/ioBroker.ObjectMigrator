/*
 * Pure logic of the mapping editor (06 §3–§5): tree, links, draft editing, plan building.
 * No React, no connection - unit tested in model.test.ts.
 */
import { converterToAlias, isConverting, type ValueConverter } from '../../src/lib/alias/converter';
import type { DraftObject } from '../../src/lib/alias/createMode';
import { normalizeIdPart } from '../../src/lib/alias/createMode';
import type { OverlapRule, TransferTask } from '../../src/lib/history/types';
import type { AliasId, AliasUpdate, MigrationPlan, SettingsMapping } from '../../src/lib/migration/types';
import type { SourceMode } from '../../src/lib/settings/settings';

export type { DraftObject, OverlapRule, MigrationPlan, ValueConverter };

/** The parts of an ioBroker object the editor needs */
export interface ObjInfo {
    /** Object ID */
    _id?: string;
    /** Object type: state, channel, device, folder, … */
    type: string;
    /** common part (name, role, unit, custom, …) */
    common: Record<string, any>;
    /** native part */
    native?: Record<string, unknown>;
}

/** Adapters that log history (same list as the backend) */
export const HISTORY_ADAPTERS = ['history', 'sql', 'influxdb'];

/** One link source → target (ME-10) */
export interface Link {
    /** Source state */
    sourceId: string;
    /** Target state */
    targetId: string;
}

/** Options of one target - edited in the properties panel (ME-15) */
export interface TargetOptions {
    /** Overlap rule - default: `switch` for several sources, `all` for one */
    overlap?: OverlapRule;
    /** Source whose settings are taken over - default: the first linked source */
    settingsFrom?: string;
    /** Alias targets: `common.alias.id` - default: the last linked source (the new adapter) */
    liveSource?: string;
    /** Migrate the history - default true */
    history?: boolean;
    /** Take over the settings - default true */
    settings?: boolean;
    /** Custom keys not taken over (SO-06) */
    exclude?: string[];
    /** Overrides per custom key (SO-04) */
    overrides?: Record<string, Record<string, unknown>>;
    /** What happens with the settings at the source - default 'disable' */
    sourceMode?: SourceMode;
    /** Conversion per source (alias.read/write of the live source, history of every source); `*` = from a template */
    converters?: Record<string, ValueConverter>;
    /** Take over rooms/functions of the source (FR-32) - default true */
    enums?: boolean;
    /** History values excluded in the preview: `${sourceId}|${ts}` (FR-96) */
    excluded?: string[];
    /**
     * The mapping as it was read in from the existing alias (FR-56): read source and a separate write
     * source - kept as long as the read source stays the live source
     */
    imported?: { read: string; write?: string };
}

/** Everything the editor defines - saved as draft, nothing is written before "Schreiben" */
export interface EditorState {
    /** Root of the left tree */
    sourceRoot: string;
    /** Root of the right tree */
    targetRoot: string;
    /** Base path of the create mode */
    basePath: string;
    /** Objects of the create mode (not written yet) */
    drafts: DraftObject[];
    /** Links source → target */
    links: Link[];
    /** Options per target */
    options: Record<string, TargetOptions>;
}

/** An empty editor */
export function emptyState(): EditorState {
    return { sourceRoot: '', targetRoot: '', basePath: '', drafts: [], links: [], options: {} };
}

// ------------------------------------------------------------------ tree

/** One node of a tree */
export interface TreeNode {
    /** Object ID */
    id: string;
    /** Last part of the ID */
    part: string;
    /** Object type, 'virtual' for missing parents */
    type: string;
    /** The object (existing or draft) */
    obj?: ObjInfo;
    /** Not written yet */
    draft: boolean;
    /** Child nodes, sorted */
    children: TreeNode[];
    /** Whole object tree: a namespace whose objects are loaded when it is expanded */
    lazy?: boolean;
}

/** Root of the left tree that shows the whole object tree (namespaces are loaded when expanded) */
export const ALL_OBJECTS = '*';

/**
 * Namespace of an object ID - what the whole object tree loads at once: `hm-rpc.0`, `0_userdata.0`,
 * `alias.0`, `system.adapter`
 *
 * @param id - object ID
 */
export function namespaceOf(id: string): string | undefined {
    const parts = id.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : undefined;
}

/**
 * The nodes to expand so that an ID is visible below a root ('' = whole object tree)
 *
 * @param id - object ID
 * @param root - root of the tree
 */
export function parentsOf(id: string, root: string): string[] {
    const parts = id.split('.');
    const result: string[] = [];
    for (let i = 1; i < parts.length; i++) {
        const p = parts.slice(0, i).join('.');
        if (!root || p === root || p.startsWith(`${root}.`)) {
            result.push(p);
        }
    }
    return result;
}

/** One visible row */
export interface Row {
    /** Tree node */
    node: TreeNode;
    /** Indentation level */
    depth: number;
    /** The node has children */
    hasChildren: boolean;
    /** The children are shown */
    expanded: boolean;
}

const TYPE_ORDER: Record<string, number> = { device: 0, channel: 1, folder: 2, virtual: 3, state: 4 };

/**
 * Builds the tree below `root` from existing objects and drafts (drafts win if both exist - they show
 * what will be written, an existing object is never changed by a draft)
 *
 * @param root - root ID, '' = whole object tree
 * @param objects - existing objects (any IDs, only those below root are used)
 * @param drafts - drafts of the create mode
 * @param namespaces - whole object tree: namespace nodes, not loaded ones can be expanded (lazy)
 */
export function buildTree(
    root: string,
    objects: Record<string, ObjInfo>,
    drafts: DraftObject[] = [],
    namespaces: { id: string; loaded: boolean }[] = [],
): TreeNode {
    const nodes = new Map<string, TreeNode>();
    const make = (id: string): TreeNode => {
        let node = nodes.get(id);
        if (!node) {
            node = { id, part: id.split('.').pop() ?? id, type: 'virtual', draft: false, children: [] };
            nodes.set(id, node);
            if (id !== root) {
                const dot = id.lastIndexOf('.');
                make(dot < 0 ? '' : id.slice(0, dot)).children.push(node);
            }
        }
        return node;
    };
    const rootNode = make(root);
    const below = (id: string): boolean => !root || id === root || id.startsWith(`${root}.`);
    for (const ns of namespaces) {
        if (below(ns.id)) {
            make(ns.id).lazy = !ns.loaded;
        }
    }
    for (const [id, obj] of Object.entries(objects)) {
        if (obj && below(id)) {
            const node = make(id);
            node.obj = obj;
            node.type = obj.type;
        }
    }
    for (const draft of drafts) {
        if (below(draft.id)) {
            const node = make(draft.id);
            if (!node.obj) {
                node.obj = { type: draft.type, common: draft.common, native: draft.native };
                node.type = draft.type;
                node.draft = true;
            }
        }
    }
    const sort = (node: TreeNode): void => {
        node.children.sort(
            (a, b) =>
                (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3) ||
                a.part.localeCompare(b.part, undefined, { numeric: true }),
        );
        node.children.forEach(sort);
    };
    sort(rootNode);
    return rootNode;
}

/**
 * Display name of a node
 *
 * @param node - tree node
 * @param lang - language
 */
export function nodeName(node: TreeNode, lang = 'en'): string {
    const name = node.obj?.common?.name;
    if (typeof name === 'string' && name) {
        return name;
    }
    if (name && typeof name === 'object') {
        return name[lang] ?? name.en ?? Object.values(name)[0] ?? node.part;
    }
    return node.part;
}

/**
 * Visible rows: the root and all children of expanded nodes. With a filter only matching nodes and
 * their parents are shown (all expanded).
 *
 * @param root - tree
 * @param expanded - expanded node IDs
 * @param filter - optional match function
 */
export function flatten(root: TreeNode, expanded: Set<string>, filter?: (node: TreeNode) => boolean): Row[] {
    const rows: Row[] = [];
    const matches = new Map<string, boolean>();
    const check = (node: TreeNode): boolean => {
        let any = filter!(node);
        for (const child of node.children) {
            any = check(child) || any;
        }
        matches.set(node.id, any);
        return any;
    };
    if (filter) {
        check(root);
    }
    const walk = (node: TreeNode, depth: number): void => {
        if (filter && !matches.get(node.id)) {
            return;
        }
        const isOpen = filter ? true : expanded.has(node.id);
        rows.push({ node, depth, hasChildren: node.children.length > 0 || !!node.lazy, expanded: isOpen });
        if (isOpen) {
            node.children.forEach(child => walk(child, depth + 1));
        }
    };
    walk(root, 0);
    return rows;
}

/**
 * All node IDs up to a depth - the initial expansion
 *
 * @param root - tree
 * @param maxDepth - deepest level that is expanded
 */
export function expandToDepth(root: TreeNode, maxDepth: number): Set<string> {
    const result = new Set<string>();
    const walk = (node: TreeNode, depth: number): void => {
        if (depth <= maxDepth && node.children.length) {
            result.add(node.id);
            node.children.forEach(c => walk(c, depth + 1));
        }
    };
    walk(root, 0);
    return result;
}

/**
 * Row of an ID or of its nearest visible parent (collapsed nodes bundle the lines, ME-10)
 *
 * @param id - object ID
 * @param index - row index per ID
 */
export function anchorRow(id: string, index: Map<string, number>): number | undefined {
    for (let current = id; current; current = current.slice(0, Math.max(0, current.lastIndexOf('.')))) {
        const row = index.get(current);
        if (row !== undefined) {
            return row;
        }
        if (!current.includes('.')) {
            break;
        }
    }
    return undefined;
}

/**
 * Number of states with settings (custom keys) below a node - "only with settings" filter
 *
 * @param node - tree node
 */
export function hasSettings(node: TreeNode): boolean {
    return node.type === 'state' && Object.keys(node.obj?.common?.custom ?? {}).length > 0;
}

// ------------------------------------------------------------------ links

/**
 * Adds a link. A source has only one target (ME-13) - an existing link of the source is moved.
 *
 * @param state - editor state
 * @param sourceId - source state
 * @param targetId - target state
 */
export function addLink(state: EditorState, sourceId: string, targetId: string): EditorState {
    if (state.links.some(l => l.sourceId === sourceId && l.targetId === targetId)) {
        return state;
    }
    // the source moves: the old link is removed like "Verknüpfung lösen" (cleans up the old target)
    let next = state;
    for (const old of state.links.filter(l => l.sourceId === sourceId)) {
        next = removeLink(next, old);
    }
    return { ...next, links: [...next.links, { sourceId, targetId }] };
}

/**
 * Removes a link
 *
 * @param state - editor state
 * @param link - the link
 */
export function removeLink(state: EditorState, link: Link): EditorState {
    const links = state.links.filter(l => !(l.sourceId === link.sourceId && l.targetId === link.targetId));
    const next = { ...state, links };
    // an existing object without any link: its pending changes are discarded too (no invisible leftovers);
    // a new value of the draft keeps its settings
    const isDraft = state.drafts.some(d => d.id === link.targetId);
    if (!isDraft && !links.some(l => l.targetId === link.targetId)) {
        return clearOptions(next, link.targetId);
    }
    if (next.options[link.targetId]?.converters?.[link.sourceId]) {
        const converters = { ...next.options[link.targetId].converters };
        delete converters[link.sourceId];
        return setOptions(next, link.targetId, { converters });
    }
    return next;
}

/**
 * Discards all pending changes of a target (settings, conversions, overlap, …)
 *
 * @param state - editor state
 * @param targetId - target
 */
export function clearOptions(state: EditorState, targetId: string): EditorState {
    if (!(targetId in state.options)) {
        return state;
    }
    const options = { ...state.options };
    delete options[targetId];
    return { ...state, options };
}

/**
 * Existing (not draft) targets with pending setting changes - marked in the tree
 *
 * @param state - editor state
 */
export function changedTargets(state: EditorState): Set<string> {
    const drafts = new Set(state.drafts.map(d => d.id));
    const result = new Set<string>();
    for (const [id, o] of Object.entries(state.options)) {
        if (
            !drafts.has(id) &&
            ((o.overrides && Object.keys(o.overrides).length) ||
                (o.converters && Object.keys(o.converters).length) ||
                o.exclude?.length)
        ) {
            result.add(id);
        }
    }
    return result;
}

/**
 * Sources of a target in link order
 *
 * @param state - editor state
 * @param targetId - target state
 */
export function sourcesOf(state: EditorState, targetId: string): string[] {
    return state.links.filter(l => l.targetId === targetId).map(l => l.sourceId);
}

const simplify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

/**
 * Knoten → Knoten (ME-11): links all states below `sourceNode` to states below `targetNode` with the
 * same relative path; otherwise with the same last ID part or the same name, if unique.
 *
 * @param sourceNode - dragged node of the left tree
 * @param targetNode - node of the right tree
 * @param lang - language for names
 */
export function autoLinks(sourceNode: TreeNode, targetNode: TreeNode, lang = 'en'): Link[] {
    const collect = (node: TreeNode): TreeNode[] =>
        node.type === 'state' ? [node] : node.children.flatMap(child => collect(child));
    const sources = collect(sourceNode);
    const targets = collect(targetNode);
    const byRel = new Map(targets.map(t => [t.id.slice(targetNode.id.length), t]));
    const unique = (key: (n: TreeNode) => string): Map<string, TreeNode> => {
        const map = new Map<string, TreeNode | null>();
        for (const t of targets) {
            const k = key(t);
            map.set(k, map.has(k) ? null : t);
        }
        return new Map([...map].filter((e): e is [string, TreeNode] => !!e[1]));
    };
    const byPart = unique(n => simplify(n.part));
    const byName = unique(n => simplify(nodeName(n, lang)));
    const used = new Set<string>();
    const links: Link[] = [];
    for (const s of sources) {
        const target =
            byRel.get(s.id.slice(sourceNode.id.length)) ??
            byPart.get(simplify(s.part)) ??
            byName.get(simplify(nodeName(s, lang)));
        if (target && !used.has(target.id)) {
            used.add(target.id);
            links.push({ sourceId: s.id, targetId: target.id });
        }
    }
    return links;
}

/** Compatibility of a link (ME-15) */
export type Compat = 'ok' | 'warn' | 'error';

/**
 * Green/yellow/red of a link line
 *
 * @param source - source object
 * @param target - target object
 */
export function compat(source?: ObjInfo, target?: ObjInfo): { level: Compat; reason?: string } {
    if (!source || !target) {
        return { level: 'warn', reason: 'missing' };
    }
    const st = source.common?.type;
    const tt = target.common?.type;
    if (st && tt && st !== tt && st !== 'mixed' && tt !== 'mixed') {
        return { level: 'error', reason: `type ${st} → ${tt}` };
    }
    if ((source.common?.unit ?? '') !== (target.common?.unit ?? '')) {
        return { level: 'warn', reason: `unit ${source.common?.unit ?? '-'} → ${target.common?.unit ?? '-'}` };
    }
    if (source.common?.role && target.common?.role && source.common.role !== target.common.role) {
        return { level: 'warn', reason: `role ${source.common.role} → ${target.common.role}` };
    }
    return { level: 'ok' };
}

// ------------------------------------------------------------------ drafts

const isBelow = (id: string, parent: string): boolean => id === parent || id.startsWith(`${parent}.`);

/**
 * Removes a draft with everything below (EM-05) - its links are removed too
 *
 * @param state - editor state
 * @param id - draft ID
 */
export function removeDraft(state: EditorState, id: string): EditorState {
    const options = { ...state.options };
    for (const key of Object.keys(options)) {
        if (isBelow(key, id)) {
            delete options[key];
        }
    }
    return {
        ...state,
        drafts: state.drafts.filter(d => !isBelow(d.id, id)),
        links: state.links.filter(l => !isBelow(l.targetId, id)),
        options,
    };
}

/**
 * Renames/moves a draft and everything below: `oldId` → `newId` (EM-04, EM-06). Links stay.
 *
 * @param state - editor state
 * @param oldId - current ID
 * @param newId - new ID
 */
export function moveDraft(state: EditorState, oldId: string, newId: string): EditorState {
    if (oldId === newId || isBelow(newId, oldId)) {
        return state;
    }
    const map = (id: string): string => (isBelow(id, oldId) ? newId + id.slice(oldId.length) : id);
    const options: Record<string, TargetOptions> = {};
    for (const [key, value] of Object.entries(state.options)) {
        options[map(key)] = value;
    }
    const drafts = state.drafts.map(d => (isBelow(d.id, oldId) ? { ...d, id: map(d.id) } : d));
    // missing parents of the new place become folders
    const ids = new Set(drafts.map(d => d.id));
    const parts = newId.split('.');
    for (let i = parts.length - 1; i > 2; i--) {
        const parent = parts.slice(0, i).join('.');
        if (!ids.has(parent) && isBelow(parent, state.basePath) && parent !== state.basePath) {
            drafts.push({ id: parent, type: 'folder', common: { name: parts[i - 1] }, native: {} });
            ids.add(parent);
        }
    }
    return {
        ...state,
        drafts,
        links: state.links.map(l => ({ ...l, targetId: map(l.targetId) })),
        options,
    };
}

/**
 * Changes the common part of a draft (EM-06)
 *
 * @param state - editor state
 * @param id - draft ID
 * @param patch - changed attributes, undefined removes
 */
export function updateDraft(state: EditorState, id: string, patch: Record<string, unknown>): EditorState {
    return {
        ...state,
        drafts: state.drafts.map(d => {
            if (d.id !== id) {
                return d;
            }
            const common = { ...d.common, ...patch };
            for (const [k, v] of Object.entries(patch)) {
                if (v === undefined) {
                    delete common[k];
                }
            }
            return { ...d, common };
        }),
    };
}

/**
 * Adds a new empty node below a parent (EM-04)
 *
 * @param state - editor state
 * @param parentId - parent ID
 * @param type - folder/channel/device
 * @param name - name, also the ID part
 */
export function addNode(
    state: EditorState,
    parentId: string,
    type: 'folder' | 'channel' | 'device',
    name: string,
): EditorState {
    const id = `${parentId}.${normalizeIdPart(name) || type}`;
    if (state.drafts.some(d => d.id === id)) {
        return state;
    }
    return { ...state, drafts: [...state.drafts, { id, type, common: { name }, native: {} }] };
}

/**
 * Takes over the drafts of `mirror.preview` (EM-02) - drafts with the same ID are replaced,
 * every mirrored state is linked to its source
 *
 * @param state - editor state
 * @param drafts - mirrored drafts
 */
export function applyMirror(state: EditorState, drafts: DraftObject[]): EditorState {
    const ids = new Set(drafts.map(d => d.id));
    let next: EditorState = { ...state, drafts: [...state.drafts.filter(d => !ids.has(d.id)), ...drafts] };
    for (const draft of drafts) {
        if (draft.type === 'state' && draft.sourceId) {
            next = addLink(next, draft.sourceId, draft.id);
        }
    }
    return next;
}

/**
 * Updates the options of a target
 *
 * @param state - editor state
 * @param targetId - target
 * @param patch - changed options
 */
export function setOptions(state: EditorState, targetId: string, patch: Partial<TargetOptions>): EditorState {
    return { ...state, options: { ...state.options, [targetId]: { ...state.options[targetId], ...patch } } };
}

// ------------------------------------------------------------------ plan

/**
 * Effective overlap rule of a target
 *
 * @param state - editor state
 * @param targetId - target
 */
export function overlapOf(state: EditorState, targetId: string): OverlapRule {
    return (
        state.options[targetId]?.overlap ??
        (sourcesOf(state, targetId).length > 1 ? { type: 'switch' } : { type: 'all' })
    );
}

/**
 * Conversion of a link: the one of the source, or the template conversion (`*`) for new links
 *
 * @param state - editor state
 * @param targetId - target
 * @param sourceId - source
 */
export function converterOf(state: EditorState, targetId: string, sourceId: string): ValueConverter | undefined {
    const c = state.options[targetId]?.converters;
    return c?.[sourceId] ?? c?.['*'];
}

/**
 * Alias of a target: live source and the conversion of that source
 *
 * @param state - editor state
 * @param targetId - target
 * @param writeable - the alias is writeable (write function)
 */
export function aliasOf(
    state: EditorState,
    targetId: string,
    writeable: boolean,
): { id: AliasId; read?: string; write?: string } | undefined {
    const sources = sourcesOf(state, targetId);
    const opts = state.options[targetId] ?? {};
    const live = opts.liveSource && sources.includes(opts.liveSource) ? opts.liveSource : sources.at(-1);
    if (!live) {
        return undefined;
    }
    const fns = converterToAlias(converterOf(state, targetId, live), writeable);
    // read in with a separate write ID: it stays as long as the read source is the live source
    const write = opts.imported?.read === live ? opts.imported.write : undefined;
    const id: AliasId = write && write !== live ? { read: live, write } : live;
    return { id, ...(fns.read ? { read: fns.read } : {}), ...(fns.write ? { write: fns.write } : {}) };
}

/**
 * `alias.id` as text for comparisons and display
 *
 * @param id - string or { read, write }
 */
export function aliasIdText(id: unknown): string {
    if (id && typeof id === 'object') {
        const v = id as { read?: unknown; write?: unknown };
        const read = typeof v.read === 'string' ? v.read : '';
        const write = typeof v.write === 'string' ? v.write : '';
        // { read: X, write: X } is the same as X
        return read === write ? read : `${read} / ${write}`;
    }
    return typeof id === 'string' ? id : '';
}

/**
 * Read ID of `alias.id` (the live source)
 *
 * @param id - string or { read, write }
 */
export function aliasReadId(id: unknown): string | undefined {
    if (id && typeof id === 'object') {
        const read = (id as { read?: unknown }).read;
        return typeof read === 'string' && read ? read : undefined;
    }
    return typeof id === 'string' && id ? id : undefined;
}

/**
 * Reads the existing alias mappings below a node into the editor (FR-56): every alias state with an
 * `alias.id` gets a link from its read source; formulas become an expert conversion, a separate
 * write ID is kept (AM-12). Read-in targets migrate neither history nor settings until the user
 * switches it on - an unchanged read-in mapping writes nothing. The root of the left tree is widened
 * until it shows the sources (up to the whole object tree).
 *
 * @param state - editor state
 * @param objects - existing objects (at least the node and everything below it)
 * @param nodeId - alias node (or a single alias state)
 */
export function importAliases(
    state: EditorState,
    objects: Record<string, ObjInfo>,
    nodeId: string,
): {
    state: EditorState;
    imported: string[];
    already: string[];
    conflicts: { targetId: string; sourceId: string; linkedTo: string }[];
    /** read sources of the imported and the already linked targets */
    sources: string[];
} {
    let next = state;
    const imported: string[] = [];
    const already: string[] = [];
    const conflicts: { targetId: string; sourceId: string; linkedTo: string }[] = [];
    /** read sources of the imported and already linked targets - they must be visible on the left */
    const sources: string[] = [];
    const ids = Object.keys(objects)
        .filter(id => id.startsWith('alias.') && (id === nodeId || isBelow(id, nodeId)))
        .sort();
    for (const targetId of ids) {
        const obj = objects[targetId];
        const alias =
            obj?.type === 'state'
                ? (obj.common?.alias as { id?: unknown; read?: unknown; write?: unknown } | undefined)
                : undefined;
        const read = aliasReadId(alias?.id);
        if (!read) {
            continue;
        }
        if (next.links.some(l => l.sourceId === read && l.targetId === targetId)) {
            already.push(targetId);
            sources.push(read);
            continue;
        }
        const other = next.links.find(l => l.sourceId === read);
        if (other) {
            // a source has only one target (ME-13, AM-13)
            conflicts.push({ targetId, sourceId: read, linkedTo: other.targetId });
            continue;
        }
        const writeId = alias?.id && typeof alias.id === 'object' ? (alias.id as { write?: unknown }).write : undefined;
        const formulas: ValueConverter = {};
        if (typeof alias?.read === 'string' && alias.read.trim()) {
            formulas.read = alias.read;
        }
        if (typeof alias?.write === 'string' && alias.write.trim()) {
            formulas.write = alias.write;
            // the expert conversion needs a read formula - unchanged value
            formulas.read ??= 'val';
        }
        const known = next.options[targetId];
        next = { ...next, links: [...next.links, { sourceId: read, targetId }] };
        next = setOptions(next, targetId, {
            imported: { read, ...(typeof writeId === 'string' && writeId !== read ? { write: writeId } : {}) },
            // only switching the source needs no history migration (AM-08) - switched on by the user
            ...(known?.history === undefined ? { history: false } : {}),
            ...(known?.settings === undefined ? { settings: false } : {}),
            ...(Object.keys(formulas).length ? { converters: { ...known?.converters, [read]: formulas } } : {}),
        });
        imported.push(targetId);
        sources.push(read);
    }
    // the sources must be visible in the left tree, or their lines end nowhere
    const sourceRoot = rootShowing(next.sourceRoot, sources);
    if (sourceRoot !== next.sourceRoot) {
        next = { ...next, sourceRoot };
    }
    return { state: next, imported, already, conflicts, sources };
}

/**
 * Root of the left tree that shows all IDs: the current root if they are below it already, otherwise
 * the common parent of the root and the IDs (at least an adapter instance), otherwise the whole
 * object tree
 *
 * @param current - current root ('' = none, ALL_OBJECTS = whole object tree)
 * @param ids - object IDs that must be visible
 */
export function rootShowing(current: string, ids: string[]): string {
    if (!ids.length || current === ALL_OBJECTS || (current && ids.every(id => isBelow(id, current)))) {
        return current;
    }
    const paths = [...(current ? [current.split('.')] : []), ...ids.map(id => id.split('.').slice(0, -1))];
    let common = paths[0];
    for (const p of paths) {
        let i = 0;
        while (i < common.length && i < p.length && common[i] === p[i]) {
            i++;
        }
        common = common.slice(0, i);
    }
    return common.length >= 2 ? common.join('.') : ALL_OBJECTS;
}

/**
 * An alias formula for comparisons; `val` (unchanged value) counts as none
 *
 * @param f - formula
 */
const formula = (f: string | undefined): string => (f?.trim() === 'val' ? '' : (f?.trim() ?? ''));

/**
 * A read-in mapping (FR-56) that nothing changes yet - drawn dashed, "Schreiben" does nothing for it
 *
 * @param state - editor state
 * @param targetId - target
 * @param current - the existing alias object
 */
export function isUnchangedImport(state: EditorState, targetId: string, current: ObjInfo | undefined): boolean {
    const opts = state.options[targetId];
    if (!opts?.imported || opts.history !== false || opts.settings !== false) {
        return false;
    }
    if (opts.overrides && Object.keys(opts.overrides).length) {
        return false;
    }
    const sources = sourcesOf(state, targetId);
    if (sources.length !== 1 || sources[0] !== opts.imported.read) {
        return false;
    }
    const want = aliasOf(state, targetId, !!current?.common?.write);
    const have = current?.common?.alias as { id?: unknown; read?: string; write?: string } | undefined;
    return (
        !!want &&
        aliasIdText(want.id) === aliasIdText(have?.id) &&
        formula(want.read) === formula(have?.read) &&
        formula(want.write) === formula(have?.write)
    );
}

/**
 * Builds what "Prüfen"/"Schreiben" sends to the adapter (WR-02/03)
 *
 * @param state - editor state
 * @param objects - existing objects (sources and targets)
 * @param scope - write only this node and everything below it (WR-04)
 */
export function buildPlan(state: EditorState, objects: Record<string, ObjInfo>, scope?: string): MigrationPlan {
    const inScope = (id: string): boolean => !scope || isBelow(id, scope);
    // targets: linked ones and values with own adapter settings
    const withSettings = Object.entries(state.options)
        .filter(([, o]) => o.overrides && Object.keys(o.overrides).length)
        .map(([id]) => id);
    const targets = [...new Set([...state.links.map(l => l.targetId), ...withSettings])].filter(inScope);
    const mappings: SettingsMapping[] = [];
    const tasks: TransferTask[] = [];
    const aliases: AliasUpdate[] = [];
    const exists = (id: string): boolean => !!objects[id];

    // drafts: a new alias gets alias.id of the live source (the last linked = the new adapter);
    // drafts that exist already are skipped by the adapter - their alias is updated like any existing one
    const drafts = state.drafts
        .filter(d => !scope || isBelow(d.id, scope) || isBelow(scope, d.id))
        .map(d => {
            if (d.type !== 'state' || !d.id.startsWith('alias.') || exists(d.id)) {
                return d;
            }
            const alias = aliasOf(state, d.id, !!d.common.write);
            if (alias) {
                return { ...d, common: { ...d.common, alias } };
            }
            // no source (any more): created without alias.id, linked later (EM-12) - a mirrored draft
            // whose link was removed must not keep the source of the mirror
            const { alias: _unlinked, ...common } = d.common;
            return { ...d, common };
        });

    for (const targetId of targets) {
        const sources = sourcesOf(state, targetId);
        const opts = state.options[targetId] ?? {};

        // existing alias (also one written by an earlier run): remap to the live source and set the
        // conversion (UC-3B) - independent of the settings
        if (targetId.startsWith('alias.') && exists(targetId) && sources.length) {
            const current = objects[targetId]?.common?.alias as
                { id?: unknown; read?: string; write?: string } | undefined;
            const alias = aliasOf(state, targetId, !!objects[targetId]?.common?.write);
            if (
                alias &&
                (aliasIdText(alias.id) !== aliasIdText(current?.id) ||
                    formula(alias.read) !== formula(current?.read) ||
                    formula(alias.write) !== formula(current?.write))
            ) {
                aliases.push({ targetId, alias });
            }
        }

        if (opts.settings !== false) {
            const settingsFrom =
                opts.settingsFrom && sources.includes(opts.settingsFrom) ? opts.settingsFrom : sources[0];
            const mapping: SettingsMapping = {
                sourceId: settingsFrom,
                targetId,
                options: {
                    exclude: opts.exclude?.length ? opts.exclude : undefined,
                    overrides: opts.overrides && Object.keys(opts.overrides).length ? opts.overrides : undefined,
                    sourceMode: opts.sourceMode,
                },
            };
            if (opts.enums === false) {
                mapping.enums = false;
            }
            const others = sources.filter(s => s !== settingsFrom);
            // further sources are only changed if the user chose so (default: nothing happens at the source)
            if (others.length && (opts.sourceMode === 'disable' || opts.sourceMode === 'remove')) {
                mapping.disableHistoryAt = others;
            }
            mappings.push(mapping);
        }
        if (opts.history !== false && sources.length) {
            const task: TransferTask = {
                target: targetId,
                // later linked sources win on equal timestamps; the history is converted like the live value
                sources: sources.map((id, priority) => {
                    const read = converterToAlias(converterOf(state, targetId, id)).read;
                    return read ? { id, priority, converter: { type: 'expression' as const, read } } : { id, priority };
                }),
                overlap: overlapOf(state, targetId),
            };
            if (opts.excluded?.length) {
                task.excluded = opts.excluded;
            }
            tasks.push(task);
        }
    }
    return { drafts, mappings, tasks, aliases };
}

/**
 * Custom keys of an object with their status for the icons (ME-04)
 *
 * @param obj - object
 * @param instances - instance status
 */
export function customIcons(
    obj: ObjInfo | undefined,
    instances: Record<string, { enabled: boolean }>,
): { key: string; adapter: string; enabled: boolean; status: 'active' | 'disabled' | 'missing' }[] {
    const custom = obj?.common?.custom ?? {};
    return Object.entries(custom)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([key, v]) => {
            const inst = instances[key];
            return {
                key,
                adapter: key.split('.')[0],
                enabled: (v as { enabled?: boolean }).enabled !== false,
                status: !inst ? 'missing' : inst.enabled ? 'active' : 'disabled',
            };
        });
}

/**
 * Adds a new value without a source (create mode) - it is linked later or gets an alias.id entered
 *
 * @param state - editor state
 * @param parentId - parent node
 * @param name - name, also the ID part
 * @param common - type, role, unit, …
 */
export function addState(
    state: EditorState,
    parentId: string,
    name: string,
    common: Record<string, unknown> = {},
): { state: EditorState; id: string } {
    const base = `${parentId}.${normalizeIdPart(name) || 'value'}`;
    const ids = new Set(state.drafts.map(d => d.id));
    let id = base;
    for (let i = 2; ids.has(id); i++) {
        id = `${base}_${i}`;
    }
    const draft: DraftObject = {
        id,
        type: 'state',
        common: { name, type: 'number', role: 'value', read: true, write: false, ...common },
        native: {},
    };
    return { state: { ...state, drafts: [...state.drafts, draft] }, id };
}

// ------------------------------------------------------------------ templates

/** One node of a template - IDs are relative to the template root */
export interface TemplateNode {
    /** ID relative to the template root */
    rel: string;
    /** Object type */
    type: DraftObject['type'];
    /** common part (without alias and custom) */
    common: Record<string, unknown>;
}

/** Options of one value of a template */
export interface TemplateOptions {
    /** Adapter settings per custom key */
    overrides?: TargetOptions['overrides'];
    /** Custom keys not taken over */
    exclude?: string[];
    /** Conversion of the source linked later */
    converter?: ValueConverter;
}

/** Structure template (create mode): nodes, adapter settings and conversions per value */
export interface Template {
    /** Name of the template */
    name: string;
    /** Type and common of the root node */
    root: { type: DraftObject['type']; common: Record<string, unknown> };
    /** Objects below the root */
    nodes: TemplateNode[];
    /** Per relative ID */
    options: Record<string, TemplateOptions>;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Creates a template from a node of the target tree (drafts and existing objects)
 *
 * @param name - template name
 * @param root - node of the target tree
 * @param state - editor state (options of the values)
 * @param replacements - texts replaced by {{placeholders}}
 */
export function makeTemplate(
    name: string,
    root: TreeNode,
    state: EditorState,
    replacements: { text: string; variable: string }[] = [],
): Template {
    const nodes: TemplateNode[] = [];
    const options: Template['options'] = {};
    const walk = (node: TreeNode): void => {
        for (const child of node.children) {
            const rel = child.id.slice(root.id.length + 1);
            const common = { ...(child.obj?.common ?? {}) };
            const custom = common.custom as TargetOptions['overrides'] | undefined;
            delete common.alias;
            delete common.custom;
            nodes.push({
                rel,
                type: child.type === 'virtual' ? 'folder' : (child.type as DraftObject['type']),
                common,
            });
            const opts = state.options[child.id];
            const live = sourcesOf(state, child.id).at(-1);
            const converter = live ? converterOf(state, child.id, live) : opts?.converters?.['*'];
            // adapter settings: those of the existing object plus the overrides of the editor
            const overrides = { ...(custom ?? {}), ...(opts?.overrides ?? {}) };
            const o: TemplateOptions = {};
            if (Object.keys(overrides).length) {
                o.overrides = overrides;
            }
            if (opts?.exclude?.length) {
                o.exclude = opts.exclude;
            }
            if (isConverting(converter)) {
                o.converter = converter;
            }
            if (Object.keys(o).length) {
                options[rel] = o;
            }
            walk(child);
        }
    };
    walk(root);
    const rootCommon = { ...(root.obj?.common ?? {}) };
    delete rootCommon.custom;
    const template: Template = {
        name,
        root: { type: root.type === 'virtual' ? 'device' : (root.type as DraftObject['type']), common: rootCommon },
        nodes,
        options,
    };
    return withPlaceholders(template, replacements);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces texts of a template by placeholders: "Kühlschrank" → {{name}} in names, and the ID form
 * of the text ("Kuehlschrank" stays as it is, "Kühl schrank" → "Kühl_schrank") in the IDs
 *
 * @param template - template
 * @param replacements - text → variable name
 */
export function withPlaceholders(template: Template, replacements: { text: string; variable: string }[]): Template {
    let json = JSON.stringify({ root: template.root, nodes: template.nodes });
    let options = JSON.stringify(template.options);
    for (const r of replacements) {
        const variable = r.variable.trim().replace(/\W/g, '');
        if (!r.text || !variable) {
            continue;
        }
        const placeholder = `{{${variable}}}`;
        for (const text of new Set([r.text, normalizeIdPart(r.text)])) {
            const re = new RegExp(escapeRegExp(JSON.stringify(text).slice(1, -1)), 'g');
            json = json.replace(re, placeholder);
            // keys of the options are the relative IDs
            options = options.replace(re, placeholder);
        }
    }
    const parsed = JSON.parse(json) as Pick<Template, 'root' | 'nodes'>;
    return { ...template, ...parsed, options: JSON.parse(options) as Template['options'] };
}

/**
 * Placeholders `{{name}}` used in the template (names, IDs, units, …)
 *
 * @param template - template
 */
export function templateVariables(template: Template): string[] {
    const found = new Set<string>();
    for (const m of JSON.stringify([template.root, template.nodes]).matchAll(PLACEHOLDER)) {
        found.add(m[1]);
    }
    return [...found];
}

const fill = <T>(value: T, vars: Record<string, string>): T =>
    JSON.parse(
        JSON.stringify(value).replace(PLACEHOLDER, (_, k: string) => JSON.stringify(vars[k] ?? '').slice(1, -1)),
    ) as T;

/**
 * Creates the drafts of a template below a base path (EM-11)
 *
 * @param state - editor state
 * @param template - template
 * @param basePath - ID of the new root node
 * @param vars - values of the placeholders
 */
export function applyTemplate(
    state: EditorState,
    template: Template,
    basePath: string,
    vars: Record<string, string> = {},
): EditorState {
    const drafts: DraftObject[] = [
        { id: basePath, type: template.root.type, common: fill(template.root.common, vars), native: {} },
    ];
    const options = { ...state.options };
    for (const node of template.nodes) {
        const rel = fill(node.rel, vars)
            .split('.')
            .map(p => normalizeIdPart(p))
            .join('.');
        const id = `${basePath}.${rel}`;
        drafts.push({ id, type: node.type, common: fill(node.common, vars), native: {} });
        const o = template.options[node.rel];
        if (o) {
            options[id] = {
                ...options[id],
                ...(o.overrides ? { overrides: o.overrides } : {}),
                ...(o.exclude ? { exclude: o.exclude } : {}),
                // the conversion belongs to the source that will be linked later
                ...(o.converter ? { converters: { '*': o.converter } } : {}),
            };
        }
    }
    const ids = new Set(drafts.map(d => d.id));
    return { ...state, drafts: [...state.drafts.filter(d => !ids.has(d.id)), ...drafts], options };
}
