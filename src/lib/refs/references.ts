/*
 * Where are the old IDs used (FR-70)? Scripts, adapter configurations (e.g. telegram, lovelace),
 * aliases, rooms/functions and VIS projects still point to the source after the migration and
 * have to be changed to the new alias ID by the user.
 */

/** Kind of a place that can contain IDs */
export type RefKind = 'script' | 'instance' | 'alias' | 'enum' | 'vis' | 'lovelace';

/** Text of one place, as read by the adapter */
export interface RefSource {
    /** Kind of the place */
    kind: RefKind;
    /** ID of the object or file name */
    location: string;
    /** Readable name, e.g. of the script */
    name?: string;
    /** Content that is searched */
    text: string;
}

/** One use of an ID */
export interface Reference {
    /** Kind of the place */
    kind: RefKind;
    /** Object ID or file */
    location: string;
    /** Readable name */
    name?: string;
    /** Number of uses in this place */
    count: number;
}

const ID_CHAR = /[\p{L}\p{N}_\-.]/u;

/**
 * Counts the uses of an ID in a text - only as a whole ID: `x.1` is not found in `x.10` or `ax.1`
 *
 * @param text - text
 * @param id - object ID
 */
export function countId(text: string, id: string): number {
    let count = 0;
    for (let i = text.indexOf(id); i !== -1; i = text.indexOf(id, i + id.length)) {
        const before = i > 0 ? text[i - 1] : '';
        const after = text[i + id.length] ?? '';
        // a dot after the ID is fine at the end of a sentence, but not before another part
        const continues = after === '.' ? ID_CHAR.test(text[i + id.length + 1] ?? '') : ID_CHAR.test(after);
        if (!(before && ID_CHAR.test(before)) && !continues) {
            count++;
        }
    }
    return count;
}

/**
 * Finds the places that use the IDs
 *
 * @param ids - IDs to look for (sources of the migration)
 * @param sources - texts of all places
 */
export function findReferences(ids: string[], sources: RefSource[]): Record<string, Reference[]> {
    const result: Record<string, Reference[]> = {};
    for (const id of ids) {
        result[id] = [];
    }
    for (const src of sources) {
        for (const id of ids) {
            if (src.location === id || !src.text.includes(id)) {
                continue;
            }
            const count = countId(src.text, id);
            if (count) {
                result[id].push({ kind: src.kind, location: src.location, name: src.name, count });
            }
        }
    }
    return result;
}
