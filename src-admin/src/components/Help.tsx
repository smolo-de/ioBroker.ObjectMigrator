import { Button, Popover, Tooltip } from '@mui/material';
import React from 'react';

/**
 * "?" button with an explanation in a popover. The popover is placed in the app element, so the
 * colors of the theme (CSS variables of .om-dark) apply.
 *
 * @param props - component props
 * @param props.title - heading of the explanation
 * @param props.tooltip - tooltip of the button
 * @param props.label - text of the button (default "?")
 * @param props.children - the explanation
 */
export function HelpButton(props: {
    title: string;
    tooltip?: string;
    label?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
    const button = (
        <Button
            size="small"
            sx={{ minWidth: 28 }}
            onClick={e => setAnchor(e.currentTarget)}
        >
            {props.label ?? '?'}
        </Button>
    );
    return (
        <>
            {props.tooltip ? <Tooltip title={props.tooltip}>{button}</Tooltip> : button}
            <Popover
                open={!!anchor}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                container={() => anchor?.closest('.om-app') ?? document.body}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <div className="om-legend">
                    <h4>{props.title}</h4>
                    {props.children}
                </div>
            </Popover>
        </>
    );
}

/** One topic of a help text: a heading and its points */
export interface HelpTopic {
    head: React.ReactNode;
    points: React.ReactNode[];
}

/**
 * Topics as a list - heading in bold, points below
 *
 * @param props - component props
 * @param props.topics - the topics
 */
export function HelpTopics(props: { topics: HelpTopic[] }): React.JSX.Element {
    return (
        <div className="om-help-topics">
            {props.topics.map((topic, i) => (
                <div key={i}>
                    <b>{topic.head}</b>
                    <ul>
                        {topic.points.map((p, j) => (
                            <li key={j}>{p}</li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
