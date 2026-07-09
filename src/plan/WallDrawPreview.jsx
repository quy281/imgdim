import React from 'react';
import { Group, Line, Circle, Label, Tag, Text } from 'react-konva';
import { wallQuad, dist } from './planGeometry';

/**
 * Live preview while drawing a wall chain: ghost wall quad + dashed centerline +
 * live length label + anchor dot. Highlights the target node when snapping (closing a loop).
 */
const WallDrawPreview = ({ anchor, preview, thickness, stageScale }) => {
    if (!anchor) return null;
    const invScale = 1 / stageScale;
    const len = preview ? Math.round(dist(anchor, preview)) : 0;
    return (
        <Group listening={false}>
            {preview && len > 0 && (
                <>
                    <Line points={wallQuad(anchor, preview, thickness).flatMap(p => [p.x, p.y])}
                        closed fill="rgba(51,65,85,0.3)" />
                    <Line points={[anchor.x, anchor.y, preview.x, preview.y]}
                        stroke="#10b981" strokeWidth={2 * invScale}
                        dash={[8 * invScale, 6 * invScale]} />
                    <Label x={(anchor.x + preview.x) / 2} y={(anchor.y + preview.y) / 2}
                        offsetX={((String(len).length * 6 + 16) / 2) * invScale}
                        offsetY={26 * invScale}>
                        <Tag fill="rgba(16,185,129,0.9)" cornerRadius={12 * invScale} />
                        <Text text={String(len)} fill="#fff" fontSize={11 * invScale} padding={6 * invScale} fontFamily="Inter" fontStyle="700" />
                    </Label>
                    {preview.nodeId && (
                        <Circle x={preview.x} y={preview.y} radius={14 * invScale}
                            stroke="#10b981" strokeWidth={3 * invScale} />
                    )}
                </>
            )}
            <Circle x={anchor.x} y={anchor.y} radius={6 * invScale} fill="#10b981" stroke="#fff" strokeWidth={1.5 * invScale} />
        </Group>
    );
};

export default WallDrawPreview;
