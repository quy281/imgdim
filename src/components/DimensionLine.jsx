import React from 'react';
import { Arrow, Label, Tag, Text, Group, Circle } from 'react-konva';

const DimensionLine = ({ line, onTextEdit, onChange, onSelect, isSelected, stageScale }) => {
    const invScale = 1 / stageScale;
    const handleDrag = (point, e, commit = false) => {
        let x = e.target.x(); let y = e.target.y();
        if (e.evt && e.evt.shiftKey) {
            const fixedPoint = point === 'start' ? line.end : line.start;
            const dx = x - fixedPoint.x; const dy = y - fixedPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const currentAngle = Math.atan2(dy, dx);
            const snapAngle = Math.round(currentAngle / (Math.PI / 4)) * (Math.PI / 4);
            x = fixedPoint.x + Math.cos(snapAngle) * distance;
            y = fixedPoint.y + Math.sin(snapAngle) * distance;
            e.target.x(x); e.target.y(y);
        }
        const updatedLine = { ...line };
        if (point === 'start') updatedLine.start = { x, y }; else updatedLine.end = { x, y };
        onChange(updatedLine, commit);
    };
    const color = isSelected ? "#3b82f6" : "white";
    return (
        <Group name="dim-group" draggable
            onClick={(e) => { e.cancelBubble = true; onSelect(line.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelect(line.id); }}
            onTouchStart={(e) => { e.cancelBubble = true; onSelect(line.id); }}
            onDragStart={(e) => { e.cancelBubble = true; if (e.target.name() === 'handle') e.cancelBubble = true; }}
            onDragEnd={(e) => {
                if (e.target.name() === 'dim-group') {
                    const dx = e.target.x(); const dy = e.target.y();
                    const newLine = { ...line, start: { x: line.start.x + dx, y: line.start.y + dy }, end: { x: line.end.x + dx, y: line.end.y + dy } };
                    onChange(newLine, true);
                    e.target.x(0); e.target.y(0);
                }
            }}
            onMouseEnter={(e) => { if (e.target.name() === 'dim-group') e.target.getStage().container().style.cursor = 'move'; }}
            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
        >
            <Arrow points={[line.start.x, line.start.y, line.end.x, line.end.y]} stroke={color} strokeWidth={1 * invScale} fill={color} pointerLength={6 * invScale} pointerWidth={6 * invScale} hitStrokeWidth={20 * invScale} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
            <Arrow points={[line.end.x, line.end.y, line.start.x, line.start.y]} stroke={color} strokeWidth={1 * invScale} fill={color} pointerLength={6 * invScale} pointerWidth={6 * invScale} hitStrokeWidth={20 * invScale} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
            <Label x={(line.start.x + line.end.x) / 2} y={(line.start.y + line.end.y) / 2}
                offsetX={((line.label.length * 6 + 16) / 2) * invScale} offsetY={12 * invScale}
                onDblClick={(e) => { e.cancelBubble = true; onTextEdit(line); }}
                onDblTap={(e) => { e.cancelBubble = true; onTextEdit(line); }}
                onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
            >
                <Tag fill="rgba(0,0,0,0.65)" cornerRadius={12 * invScale} />
                <Text text={line.label} fill="white" fontSize={11 * invScale} padding={6 * invScale} fontFamily="Inter" fontStyle="500" />
            </Label>
            {isSelected && (
                <>
                    <Circle name="handle" x={line.start.x} y={line.start.y} radius={6 * invScale} hitStrokeWidth={20 * invScale} fill="#3b82f6" draggable onDragStart={(e) => e.cancelBubble = true} onDragMove={(e) => handleDrag('start', e, false)} onDragEnd={(e) => { e.cancelBubble = true; handleDrag('start', e, true); }} onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }} onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; }} />
                    <Circle name="handle" x={line.end.x} y={line.end.y} radius={6 * invScale} hitStrokeWidth={20 * invScale} fill="#3b82f6" draggable onDragStart={(e) => e.cancelBubble = true} onDragMove={(e) => handleDrag('end', e, false)} onDragEnd={(e) => { e.cancelBubble = true; handleDrag('end', e, true); }} onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }} onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; }} />
                </>
            )}
        </Group>
    );
};
export default DimensionLine;
