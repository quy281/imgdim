import React from 'react';
import { Group, Rect, Text } from 'react-konva';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Draggable text note pill. Tap = select, tap again (selected) = edit. */
const NoteMarker = ({ note, isSelected, scale, onSelect, onEdit, onChange, baseSize = 15 }) => {
    const inv = 1 / scale;
    const fontSize = baseSize * inv;
    const padding = 7 * inv;
    const w = note.text.length * fontSize * 0.58 + padding * 2;
    const h = fontSize + padding * 2;

    const tap = (e) => {
        e.cancelBubble = true;
        if (isSelected) onEdit(note);
        else onSelect(note.id);
    };

    return (
        <Group x={note.x} y={note.y} draggable
            onClick={tap}
            onTap={tap}
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragEnd={(e) => onChange({ ...note, x: e.target.x(), y: e.target.y() }, true)}
        >
            <Rect width={w} height={h}
                fill={isSelected ? 'rgba(37,99,235,0.92)' : 'rgba(15,23,42,0.72)'}
                cornerRadius={8 * inv}
                stroke={isSelected ? '#93c5fd' : 'transparent'}
                strokeWidth={1.5 * inv} />
            <Text text={note.text} fill="#fff" fontSize={fontSize}
                fontFamily={FONT} fontStyle="600" padding={padding} />
        </Group>
    );
};

export default NoteMarker;
