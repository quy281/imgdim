import React from 'react';
import { Group, Label, Tag, Text } from 'react-konva';

// Room name + area/perimeter labels at each detected room's label point. Tap to rename.
const RoomLabels = ({ plan, stageScale, interactive, onRename }) => {
    const invScale = 1 / stageScale;
    const rooms = (plan && plan.rooms) || [];
    return (
        <Group listening={interactive}>
            {rooms.map(r => {
                const info = `${(r.area / 1e6).toFixed(1)} m² · ${(r.perimeter / 1000).toFixed(1)} m`;
                const maxLen = Math.max(r.name.length, info.length);
                return (
                    <Label key={r.id} x={r.cx} y={r.cy}
                        offsetX={((maxLen * 6.5 + 20) / 2) * invScale}
                        offsetY={22 * invScale}
                        onClick={(e) => { e.cancelBubble = true; onRename(r.id); }}
                        onTap={(e) => { e.cancelBubble = true; onRename(r.id); }}
                        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                        onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                    >
                        <Tag fill="rgba(255,255,255,0.9)" stroke="#cbd5e1" strokeWidth={1 * invScale} cornerRadius={8 * invScale} />
                        <Text text={`${r.name}\n${info}`} align="center" fill="#0f172a"
                            fontSize={12 * invScale} padding={8 * invScale} lineHeight={1.4}
                            fontFamily="Inter" fontStyle="600" />
                    </Label>
                );
            })}
        </Group>
    );
};

export default RoomLabels;
