import React from 'react';
import { Group, Label, Tag, Text } from 'react-konva';

const FONT = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

// Room name + area/perimeter at each room's label point. Tap to rename.
const RoomLabels = ({ plan, scale, listening, onTap, themeMode = 'presentation' }) => {
    const inv = 1 / scale;
    const isPres = themeMode !== 'cad';
    const rooms = (plan && plan.rooms) || [];
    return (
        <Group listening={listening}>
            {rooms.map(r => {
                const info = `${(r.area / 1e6).toFixed(1)} m² · ${(r.perimeter / 1000).toFixed(1)} m`;
                const maxLen = Math.max(r.name.length, info.length);
                const tap = (e) => { e.cancelBubble = true; onTap(r.id); };
                return (
                    <Label key={r.id} x={r.cx} y={r.cy}
                        offsetX={((maxLen * 6.5 + 20) / 2) * inv}
                        offsetY={22 * inv}
                        onClick={tap}
                        onTap={tap}
                        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                        onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                    >
                        <Tag
                            fill={isPres ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.92)'}
                            stroke={isPres ? 'rgba(203,213,225,0.9)' : '#cbd5e1'}
                            strokeWidth={1 * inv}
                            cornerRadius={8 * inv}
                        />
                        <Text text={`${r.name}\n${info}`} align="center" fill="#0f172a"
                            fontSize={11.5 * inv} padding={7 * inv} lineHeight={1.38}
                            fontFamily={FONT} fontStyle="700" />
                    </Label>
                );
            })}
        </Group>
    );
};

export default RoomLabels;
