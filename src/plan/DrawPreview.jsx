import React from 'react';
import { Group, Line, Circle, Label, Tag, Text } from 'react-konva';
import { wallQuad, dist } from '../lib/geometry';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Live preview while drawing a wall chain: ghost quad + dashed centerline +
 * live length label + anchor dot. Highlights the target node when closing a loop.
 */
const DrawPreview = ({ anchor, preview, thickness, scale }) => {
    if (!anchor) return null;
    const inv = 1 / scale;
    const len = preview ? Math.round(dist(anchor, preview)) : 0;
    return (
        <Group listening={false}>
            {preview && len > 0 && (
                <>
                    <Line points={wallQuad(anchor, preview, thickness).flatMap(p => [p.x, p.y])}
                        closed fill="rgba(51,65,85,0.3)" />
                    <Line points={[anchor.x, anchor.y, preview.x, preview.y]}
                        stroke="#10b981" strokeWidth={2 * inv}
                        dash={[8 * inv, 6 * inv]} />
                    <Label x={(anchor.x + preview.x) / 2} y={(anchor.y + preview.y) / 2}
                        offsetX={((String(len).length * 6 + 16) / 2) * inv}
                        offsetY={26 * inv}>
                        <Tag fill="rgba(16,185,129,0.92)" cornerRadius={12 * inv} />
                        <Text text={String(len)} fill="#fff" fontSize={11 * inv} padding={6 * inv} fontFamily={FONT} fontStyle="700" />
                    </Label>
                    {preview.nodeId && (
                        <Circle x={preview.x} y={preview.y} radius={14 * inv}
                            stroke="#10b981" strokeWidth={3 * inv} />
                    )}
                </>
            )}
            <Circle x={anchor.x} y={anchor.y} radius={6 * inv} fill="#10b981" stroke="#fff" strokeWidth={1.5 * inv} />
        </Group>
    );
};

export default DrawPreview;
