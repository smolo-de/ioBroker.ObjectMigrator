import React from 'react';

import { formatMessage } from '../../../src/lib/messages';
import type { RunLogEntry } from '../../../src/lib/migration/types';
import { language, t } from '../i18n';

const time = (ts: number): string => new Date(ts).toLocaleTimeString();
/** the end of a long ID is the interesting part */
const shortId = (id: string): string => {
    const parts = id.split('.');
    return parts.length > 5 ? `…${parts.slice(-3).join('.')}` : id;
};

/**
 * Log of a run: what was migrated, target by target (live while the run is active, and in the report)
 *
 * @param props - component props
 * @param props.entries - lines of the log
 * @param props.height - height of the list in px
 */
export function RunLog(props: { entries: RunLogEntry[]; height?: number }): React.JSX.Element {
    const box = React.useRef<HTMLDivElement>(null);
    // follows new lines as long as the user did not scroll up
    const atEnd = React.useRef(true);
    React.useLayoutEffect(() => {
        const el = box.current;
        if (el && atEnd.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [props.entries.length]);
    const lang = language();
    return (
        <div
            ref={box}
            className="om-runlog"
            style={{ height: props.height ?? 170 }}
            onScroll={e => {
                const el = e.currentTarget;
                atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
            }}
        >
            {!props.entries.length && <div className="om-muted">{t('logEmpty')}</div>}
            {props.entries.map((e, i) => (
                <div
                    key={`${e.ts}-${i}`}
                    className={`om-runlog-line om-runlog-${e.msg.code}`}
                >
                    <span className="om-runlog-time">{time(e.ts)}</span>
                    {e.msg.id && (
                        <span
                            className="om-runlog-id"
                            title={e.msg.id}
                        >
                            {shortId(e.msg.id)}
                        </span>
                    )}
                    <span>{formatMessage(e.msg, lang)}</span>
                </div>
            ))}
        </div>
    );
}

/**
 * Adds lines that arrived live (state run.log) to the known log - no line twice
 *
 * @param known - log so far
 * @param more - new lines
 */
export function mergeLog(known: RunLogEntry[], more: RunLogEntry[]): RunLogEntry[] {
    const key = (e: RunLogEntry): string => `${e.ts}|${e.msg.code}|${e.msg.id ?? ''}`;
    const seen = new Set(known.map(key));
    const added = more.filter(e => !seen.has(key(e)));
    return added.length ? [...known, ...added].sort((a, b) => a.ts - b.ts) : known;
}
