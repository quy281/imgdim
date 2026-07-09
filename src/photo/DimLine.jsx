import React from 'react';
import { Arrow, Label, Tag, Text, Group, Circle } from 'react-konva';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Double-headed dimension arrow with a label pill on a photo.
 * Tap group = select; tap label = edit value; drag endpoints when selected.
 */
const DimLine = ({ line, isSelected, scale, onSelect, onLabelTap, onChange }) => {
    const inv = 1 / scale;
    const color = isSelected ? '#3b82f6' : '#ffffff';

    const handleDrag = (point, e, commit) => {
        const x = e.target.x();
        const y = e.target.y();
        const updated = { ...line };
        if (point === 'start') updated.start = { x, y };
        else updated.end = { x, y };
        onChange(updated, commit);
    };

    return (
        <Group name="dim-group" draggable={isSelected}
            onClick={(e) => { e.cancelBubble = true; onSelect(line.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelect(line.id); }}
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragEnd={(e) => {
                if (e.target.name() === 'dim-group') {
                    const dx = e.target.x();
                    const dy = e.target.y();
                    onChange({
                        ...line,
                        start: { x: line.start.x + dx, y: line.start.y + dy },
                        end: { x: line.end.x + dx, y: line.end.y + dy },
                    }, true);
                    e.target.x(0);
                    e.target.y(0);
                }
            }}
        >
            <Arrow points={[line.start.x, line.start.y, line.end.x, line.end.y]}
                stroke={color} strokeWidth={1.5 * inv} fill={color}
                pointerLength={7 * inv} pointerWidth={7 * inv}
                hitStrokeWidth={24 * inv} perfectDrawEnabled={false} shadowForStrokeEnabled={false}
                shadowColor="rgba(0,0,0,0.5)" shadowBlur={2 * inv} />
            <Arrow points={[line.end.x, line.end.y, line.start.x, line.start.y]}
                stroke={color} strokeWidth={1.5 * inv} fill={color}
                pointerLength={7 * inv} pointerWidth={7 * inv}
                hitStrokeWidth={24 * inv} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
            <Label x={(line.start.x + line.end.x) / 2} y={(line.start.y + line.end.y) / 2}
                offsetX={((String(line.label).length * 6.5 + 18) / 2) * inv}
                offsetY={13 * inv}
                onClick={(e) => { e.cancelBubble = true; onLabelTap(line); }}
                onTap={(e) => { e.cancelBubble = true; onLabelTap(line); }}
            >
                <Tag fill={isSelected ? 'rgba(37,99,235,0.92)' : 'rgba(15,23,42,0.72)'} cornerRadius={12 * inv} />
                <Text text={String(line.label)} fill={isSelected ? '#fef08a' : '#fff'}
                    fontSize={12 * inv} padding={6 * inv} fontFamily={FONT} fontStyle="700" />
            </Label>
            {isSelected && ['start', 'end'].map(pt => (
                <Circle key={pt} name="handle" x={line[pt].x} y={line[pt].y}
                    radius={7 * inv} hitStrokeWidth={26 * inv}
                    fill="#3b82f6" stroke="#fff" strokeWidth={2 * inv} draggable
                    onDragStart={(e) => { e.cancelBubble = true; }}
                    onDragMove={(e) => handleDrag(pt, e, false)}
                    onDragEnd={(e) => { e.cancelBubble = true; handleDrag(pt, e, true); }}
                />
            ))}
        </Group>
    );
};

export default DimLine;
