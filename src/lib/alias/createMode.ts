import type { Message } from '../messages';

/** A draft object of the create mode - nothing is written before "Schreiben" (WR-01) */
export interface DraftObject {
    /** Full object ID of the draft */
    id: string;
    /** Object type */
    type: 'folder' | 'device' | 'channel' | 'state';
    /** common part of the object */
    common: Record<string, unknown>;
    /** native part of the object */
    native: Record<string, unknown>;
    /** Source state (only for states) */
    sourceId?: string;
}

/** Characters not allowed in an ID part (js-controller FORBIDDEN_CHARS plus separators) */
const FORBIDDEN = /[\][*,;'"`<>\\?\s.]/g;

/**
 * Makes one part of an ID valid: forbidden characters become `_`
 *
 * @param part - one segment of an ID (no dots)
 */
export function normalizeIdPart(part: string): string {
    return part.trim().replace(FORBIDDEN, '_');
}

/**
 * Checks a base path like `alias.0.xyz.abc` (EM-01d)
 *
 * @param basePath - the base path
 * @returns list of errors, empty if valid
 */
export function validateBasePath(basePath: string): Message[] {
    const errors: Message[] = [];
    if (!/^alias\.0(\.|$)/.test(basePath)) {
        errors.push({ code: 'basePathNotAlias', id: basePath });
    }
    const parts = basePath.split('.');
    parts.forEach((part, i) => {
        if (!part) {
            errors.push({ code: 'basePathEmptySegment', id: basePath, args: { pos: i + 1 } });
        } else if (normalizeIdPart(part) !== part) {
            errors.push({ code: 'basePathForbidden', id: basePath, args: { part } });
        }
    });
    return errors;
}

/** Attributes of a source state that are mirrored to the alias state */
const MIRRORED_STATE_COMMON = [
    'name',
    'desc',
    'type',
    'role',
    'unit',
    'min',
    'max',
    'step',
    'states',
    'read',
    'write',
    'def',
];

/** Options of the mirroring */
export interface MirrorOptions {
    /** Type of the created nodes of the base path below `alias.0`; default: folders, the last one 'device' */
    basePathTypes?: ('folder' | 'device' | 'channel')[];
    /** IDs that exist already - no draft is created for them (EM-08) */
    existingIds?: Set<string>;
    /** Only these source IDs, their parents and everything below them are mirrored (EM-07) */
    onlySourceIds?: Set<string>;
}

/**
 * Mirrors the structure below `sourceRoot` to `basePath` as draft objects (EM-02).
 * `hm-rpc.0.OLD123.1.TEMPERATURE` with root `hm-rpc.0.OLD123` and base path `alias.0.xyz.abc`
 * becomes `alias.0.xyz.abc.1.TEMPERATURE` (EM-01a).
 *
 * @param sourceRoot - ID of the source root node
 * @param objects - all objects below the root (the root itself may be included)
 * @param basePath - target base path, e.g. `alias.0.xyz.abc`
 * @param options - options
 */
export function mirrorStructure(
    sourceRoot: string,
    objects: Record<string, ioBroker.Object>,
    basePath: string,
    options: MirrorOptions = {},
): DraftObject[] {
    const drafts = new Map<string, DraftObject>();
    const existing = options.existingIds ?? new Set<string>();

    // nodes of the base path itself (EM-01b)
    const baseParts = basePath.split('.');
    for (let i = 2; i < baseParts.length; i++) {
        const id = baseParts.slice(0, i + 1).join('.');
        if (existing.has(id)) {
            continue;
        }
        const isLast = i === baseParts.length - 1;
        const type = options.basePathTypes?.[i - 2] ?? (isLast ? 'device' : 'folder');
        const rootName = isLast ? objects[sourceRoot]?.common?.name : undefined;
        drafts.set(id, { id, type, common: { name: rootName ?? baseParts[i] }, native: {} });
    }

    const prefix = `${sourceRoot}.`;
    const ids = Object.keys(objects)
        .filter(id => id.startsWith(prefix))
        .sort();

    const wanted = (id: string): boolean => {
        if (!options.onlySourceIds) {
            return true;
        }
        if (options.onlySourceIds.has(id)) {
            return true;
        }
        for (const only of options.onlySourceIds) {
            // a parent of a selected object, or below a selected node
            if (only.startsWith(`${id}.`) || id.startsWith(`${only}.`)) {
                return true;
            }
        }
        return false;
    };

    for (const sourceId of ids) {
        const obj = objects[sourceId];
        if (!obj || !wanted(sourceId)) {
            continue;
        }
        const relative = sourceId.slice(prefix.length).split('.').map(normalizeIdPart).join('.');
        const id = `${basePath}.${relative}`;

        // make sure all parents exist as draft (missing objects in the source tree become folders)
        const parts = relative.split('.');
        for (let i = 1; i < parts.length; i++) {
            const parentId = `${basePath}.${parts.slice(0, i).join('.')}`;
            if (!drafts.has(parentId) && !existing.has(parentId)) {
                drafts.set(parentId, { id: parentId, type: 'folder', common: { name: parts[i - 1] }, native: {} });
            }
        }

        if (existing.has(id)) {
            continue;
        }

        if (obj.type === 'state') {
            const common: Record<string, unknown> = {};
            const sourceCommon = obj.common as unknown as Record<string, unknown>;
            for (const attr of MIRRORED_STATE_COMMON) {
                if (sourceCommon[attr] !== undefined) {
                    common[attr] = structuredClone(sourceCommon[attr]);
                }
            }
            common.name ??= parts[parts.length - 1];
            common.type ??= 'mixed';
            common.role ??= 'state';
            common.read ??= true;
            common.write ??= false;
            common.alias = { id: sourceId };
            drafts.set(id, { id, type: 'state', common, native: {}, sourceId });
        } else if (obj.type === 'device' || obj.type === 'channel' || obj.type === 'folder') {
            const common: Record<string, unknown> = { name: obj.common?.name ?? parts[parts.length - 1] };
            if ((obj.common as Record<string, unknown>)?.role) {
                common.role = (obj.common as Record<string, unknown>).role;
            }
            drafts.set(id, { id, type: obj.type, common, native: {} });
        }
    }

    return [...drafts.values()];
}
