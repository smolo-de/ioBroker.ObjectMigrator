/**
 * Working state of the tab for the browser session.
 *
 * The admin removes the iframe of the tab as soon as another admin page (objects, adapters, ...) is
 * opened and loads it again on the way back. The state is written to the sessionStorage when the page
 * is left (pagehide) and restored on the next start - in the same browser tab only.
 */
import type { EditorState, Link } from './model';

/** State of one tree */
export interface TreeSession {
    /** Root of the tree the state belongs to */
    root: string;
    /** Expanded nodes */
    expanded: string[];
    /** Text of the filter */
    filter: string;
    /** "only with settings" */
    onlySettings: boolean;
    /** Scroll position in px */
    scroll: number;
}

/** Everything that makes "where was I" */
export interface TabSession {
    /** When the tab was left */
    savedAt: number;
    /** Version of the stored plan the editor was based on */
    planVersion?: number;
    /** The plan had changes that were not stored yet */
    dirty: boolean;
    /** Undo steps */
    past: EditorState[];
    /** The plan */
    present: EditorState;
    /** Redo steps */
    future: EditorState[];
    /** Editor, history of runs or references */
    view: 'editor' | 'runs' | 'refs' | 'db';
    /** Selected row */
    selected?: { side: 'source' | 'target'; id: string };
    /** Selected link line */
    selectedLink?: Link;
    /** Source state for the "link" button */
    pickedSource?: string;
    /** Multi selection in the source tree */
    sourceSelection: string[];
    /** Source tree */
    left?: TreeSession;
    /** Target tree */
    right?: TreeSession;
    /** Log panel open */
    showLog: boolean;
    /** Target of the open history preview */
    historyFor?: string;
}

/** Undo steps kept in the session - a plan has easily 100 kB */
const MAX_PAST = 20;
const MAX_FUTURE = 10;

const key = (instance: string): string => `objectmigrator.${instance}.session`;

/**
 * The state of the last visit in this browser tab
 *
 * @param instance - e.g. objectmigrator.0
 */
export function readSession(instance: string): TabSession | undefined {
    try {
        const s = JSON.parse(window.sessionStorage.getItem(key(instance)) ?? '') as TabSession;
        return s?.present && Array.isArray(s.past) && Array.isArray(s.future) ? s : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Stores the state. The undo history is the big part: without room, older steps are dropped.
 *
 * @param instance - e.g. objectmigrator.0
 * @param session - the state
 */
export function writeSession(instance: string, session: TabSession): void {
    let past = session.past.slice(-MAX_PAST);
    let future = session.future.slice(0, MAX_FUTURE);
    for (;;) {
        try {
            window.sessionStorage.setItem(key(instance), JSON.stringify({ ...session, past, future }));
            return;
        } catch {
            if (!past.length && !future.length) {
                try {
                    window.sessionStorage.removeItem(key(instance));
                } catch {
                    // no storage
                }
                return;
            }
            past = past.slice(past.length - Math.floor(past.length / 2));
            future = future.slice(0, Math.floor(future.length / 2));
        }
    }
}
