import { Button, Popover, Tooltip } from '@mui/material';
import React from 'react';
import { t } from '../i18n';
import { LINK_STYLE } from './LinkLayer';

/** One sample line, drawn like the real ones (LinkLayer) */
function Sample(props: {
    color: string;
    width?: number;
    dash?: string;
    opacity?: number;
    count?: number;
}): React.JSX.Element {
    const d = 'M 2 17 C 30 17, 30 7, 58 7';
    return (
        <svg
            width={60}
            height={24}
            className="om-legend-sample"
        >
            <path
                d={d}
                stroke={props.color}
                strokeWidth={props.width ?? LINK_STYLE.width.normal}
                strokeDasharray={props.dash}
                opacity={props.opacity ?? 1}
                fill="none"
            />
            {props.count && (
                <text
                    x={30}
                    y={9}
                    className="om-link-count"
                    textAnchor="middle"
                >
                    {props.count}
                </text>
            )}
        </svg>
    );
}

/**
 * "? Linien": what the lines between the trees and the marks in the trees mean (ME-10, ME-14)
 *
 * @param props - component props
 * @param props.dark - dark theme (the popover is outside the app element)
 */
export function LinkLegend(props: { dark: boolean }): React.JSX.Element {
    const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
    const c = LINK_STYLE.colors;
    const lines: [React.JSX.Element, string][] = [
        [<Sample color={c.ok} />, t('lgOk')],
        [<Sample color={c.warn} />, t('lgWarn')],
        [<Sample color={c.error} />, t('lgError')],
        [
            <Sample
                color={LINK_STYLE.existing}
                dash={LINK_STYLE.dashExisting}
            />,
            t('lgExisting'),
        ],
        [<Sample color={LINK_STYLE.done} />, t('lgDone')],
        [
            <Sample
                color={c.ok}
                dash={LINK_STYLE.dashOutside}
            />,
            t('lgOutside'),
        ],
        [
            <Sample
                color={c.ok}
                width={LINK_STYLE.width.bundle}
                count={3}
            />,
            t('lgBundle'),
        ],
        [
            <span className="om-legend-pair">
                <Sample
                    color={c.ok}
                    width={LINK_STYLE.width.focus}
                />
                <Sample
                    color={c.ok}
                    opacity={LINK_STYLE.faded}
                />
            </span>,
            t('lgFocus'),
        ],
        [
            <Sample
                color={c.ok}
                width={LINK_STYLE.width.selected}
            />,
            t('lgSelected'),
        ],
    ];
    const marks: [React.JSX.Element, string][] = [
        [
            <span className="om-legend-pair">
                <span className="om-anchor om-anchor-on" />
                <span className="om-anchor" />
            </span>,
            t('lgAnchor'),
        ],
        [<span className="om-chip">4</span>, t('lgCount')],
        [<span className="om-chip">{t('linkedSources', { n: 2 })}</span>, t('lgSources')],
        [<span className="om-chip om-chip-draft">{t('draft')}</span>, t('lgDraft')],
        [<span className="om-chip om-chip-changed">✎ {t('changed')}</span>, t('lgChanged')],
        [<span className="om-legend-unlinked">Name</span>, t('lgUnlinked')],
        [<span className="om-db-marker">DB</span>, t('lgDb')],
        [<span className="om-legend-highlight">Name</span>, t('lgHighlight')],
    ];
    const table = (rows: [React.JSX.Element, string][]): React.JSX.Element => (
        <div className="om-legend-grid">
            {rows.map(([sample, text]) => (
                <React.Fragment key={text}>
                    <div className="om-legend-cell">{sample}</div>
                    <div>{text}</div>
                </React.Fragment>
            ))}
        </div>
    );
    return (
        <>
            <Tooltip title={t('lgTooltip')}>
                <Button
                    size="small"
                    onClick={e => setAnchor(e.currentTarget)}
                >
                    ? {t('lgButton')}
                </Button>
            </Tooltip>
            <Popover
                open={!!anchor}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <div className={`om-legend ${props.dark ? 'om-dark' : ''}`}>
                    <h4>{t('lgLines')}</h4>
                    {table(lines)}
                    <h4>{t('lgUse')}</h4>
                    <ul>
                        <li>{t('lgUseDrag')}</li>
                        <li>{t('lgUseNodes')}</li>
                        <li>{t('lgUseSeveral')}</li>
                        <li>{t('lgUseClick')}</li>
                        <li>{t('lgUseImport')}</li>
                    </ul>
                    <h4>{t('lgMarks')}</h4>
                    {table(marks)}
                </div>
            </Popover>
        </>
    );
}
