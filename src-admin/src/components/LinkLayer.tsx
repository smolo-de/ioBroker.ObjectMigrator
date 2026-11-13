import React from 'react';
import type { Compat, Link } from '../model';
import { anchorRow } from '../model';
import { ROW_HEIGHT } from './ObjectTree';

/** A link with its display data */
export interface DrawLink extends Link {
    level: Compat;
    reason?: string;
    done?: boolean;
    /** a read-in mapping that nothing changes yet (FR-56) */
    existing?: boolean;
}

/** Props of the line layer */
export interface LinkLayerProps {
    links: DrawLink[];
    leftIndex: Map<string, number>;
    rightIndex: Map<string, number>;
    leftScroll: number;
    rightScroll: number;
    height: number;
    width: number;
    selected?: Link;
    /** IDs of the selected row - its lines are emphasized (ME-14) */
    focusIds: Set<string>;
    onSelect: (link: Link) => void;
}

/** Line styles - shared with the legend (LinkLegend) */
export const LINK_STYLE = {
    colors: { ok: '#4caf50', warn: '#ff9800', error: '#f44336' } as Record<Compat, string>,
    /** read in and unchanged (FR-56) */
    existing: '#90a4ae',
    /** written by the last run */
    done: '#9e9e9e',
    dashExisting: '7 4',
    /** an end is outside the visible area */
    dashOutside: '4 3',
    width: { normal: 1.6, bundle: 2.5, focus: 3, selected: 4 },
    /** other lines while a row is selected */
    faded: 0.35,
};
const COLORS = LINK_STYLE.colors;

/**
 * Bezier lines between the two trees (ME-10) - drawn in the gutter between them
 *
 * @param props
 */
export function LinkLayer(props: LinkLayerProps): React.JSX.Element {
    const { width, height } = props;
    const y = (row: number, scroll: number): number => row * ROW_HEIGHT - scroll + ROW_HEIGHT / 2;

    // links of collapsed nodes end at the visible parent - bundle equal lines (ME-10)
    const bundles = new Map<string, { y1: number; y2: number; links: DrawLink[] }>();
    for (const link of props.links) {
        const l = anchorRow(link.sourceId, props.leftIndex);
        const r = anchorRow(link.targetId, props.rightIndex);
        if (l === undefined || r === undefined) {
            continue;
        }
        const y1 = y(l, props.leftScroll);
        const y2 = y(r, props.rightScroll);
        const key = `${l}|${r}`;
        const bundle = bundles.get(key) ?? { y1, y2, links: [] };
        bundle.links.push(link);
        bundles.set(key, bundle);
    }

    const clamp = (v: number): number => Math.max(2, Math.min(height - 2, v));
    return (
        <svg
            className="om-links"
            width={width}
            height={height}
        >
            {[...bundles.values()].map(({ y1, y2, links }) => {
                const link = links[0];
                const outside = y1 < 0 || y1 > height || y2 < 0 || y2 > height;
                if ((y1 < 0 && y2 < 0) || (y1 > height && y2 > height)) {
                    return null;
                }
                const a = clamp(y1);
                const b = clamp(y2);
                const d = `M 0 ${a} C ${width / 2} ${a}, ${width / 2} ${b}, ${width} ${b}`;
                const level: Compat = links.some(x => x.level === 'error')
                    ? 'error'
                    : links.some(x => x.level === 'warn')
                      ? 'warn'
                      : 'ok';
                const isSelected =
                    links.length === 1 &&
                    props.selected?.sourceId === link.sourceId &&
                    props.selected?.targetId === link.targetId;
                const focus = links.some(x => props.focusIds.has(x.sourceId) || props.focusIds.has(x.targetId));
                const existing = links.every(x => x.existing);
                const color = existing
                    ? LINK_STYLE.existing
                    : link.done && links.every(x => x.done)
                      ? LINK_STYLE.done
                      : COLORS[level];
                const title = links
                    .map(x => `${x.sourceId} → ${x.targetId}${x.reason ? ` (${x.reason})` : ''}`)
                    .join('\n');
                return (
                    <g
                        key={`${link.sourceId}|${link.targetId}`}
                        onClick={() => props.onSelect(link)}
                        style={{ cursor: 'pointer' }}
                    >
                        <title>{title}</title>
                        <path
                            d={d}
                            stroke="transparent"
                            strokeWidth={10}
                            fill="none"
                        />
                        <path
                            d={d}
                            stroke={color}
                            strokeWidth={
                                isSelected
                                    ? LINK_STYLE.width.selected
                                    : focus
                                      ? LINK_STYLE.width.focus
                                      : links.length > 1
                                        ? LINK_STYLE.width.bundle
                                        : LINK_STYLE.width.normal
                            }
                            strokeDasharray={
                                outside ? LINK_STYLE.dashOutside : existing ? LINK_STYLE.dashExisting : undefined
                            }
                            opacity={props.focusIds.size && !focus ? LINK_STYLE.faded : 1}
                            fill="none"
                        />
                        {links.length > 1 && (
                            <text
                                x={width / 2}
                                y={(a + b) / 2 - 3}
                                className="om-link-count"
                                textAnchor="middle"
                            >
                                {links.length}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
