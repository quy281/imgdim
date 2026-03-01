import React from 'react';
import { Text, Group, Rect } from 'react-konva';

const TextNote = ({ note, isSelected, onSelect, onChange, onEdit, stageScale }) => {
    const invScale = 1 / stageScale;
    const fontSize = (note.fontSize || 16) * invScale;
    const padding = 6 * invScale;

    return (
        <Group
            x={note.x} y={note.y}
            draggable
            onClick={(e) => { e.cancelBubble = true; onSelect(note.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelect(note.id); }}
            onDblClick={(e) => { e.cancelBubble = true; onEdit(note); }}
            onDblTap={(e) => { e.cancelBubble = true; onEdit(note); }}
            onDragEnd={(e) => {
                onChange({ ...note, x: e.target.x(), y: e.target.y() }, true);
            }}
        >
            <Rect
                width={(note.text.length * fontSize * 0.6) + padding * 2}
                height={fontSize + padding * 2}
                fill={isSelected ? "rgba(59,130,246,0.15)" : "rgba(0,0,0,0.55)"}
                cornerRadius={6 * invScale}
                stroke={isSelected ? "#3b82f6" : "transparent"}
                strokeWidth={1.5 * invScale}
            />
            <Text
                text={note.text}
                fill={note.color || "#ffffff"}
                fontSize={fontSize}
                fontFamily="Inter"
                fontStyle="600"
                padding={padding}
            />
        </Group>
    );
};
export default TextNote;
