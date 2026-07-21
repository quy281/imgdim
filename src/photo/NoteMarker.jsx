import React from 'react';
import { Group, Rect, Text } from 'react-konva';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Draggable checklist note pill.
 * note = { id, x, y, items: [{id, text, done}] }  (backward-compat: note.text = legacy string)
 */
const NoteMarker = ({ note, isSelected, scale, onSelect, onEdit, onChange, baseSize = 13 }) => {
    const inv = 1 / scale;
    const items = note.items || (note.text ? [{ id: '_', text: note.text, done: false }] : [{ id: '_', text: '—', done: false }]);
    const shown = items.slice(0, 4);
    const extra = items.length - shown.length;

    const fontSize = baseSize * inv;
    const lineH = fontSize * 1.6;
    const padX = 9 * inv;
    const padY = 7 * inv;
    const maxCharW = Math.max(...shown.map(it => (it.text.length + 2) * 0.57), 8);
    const boxW = maxCharW * fontSize + padX * 2;
    const totalLines = shown.length + (extra > 0 ? 1 : 0);
    const boxH = totalLines * lineH + padY * 2;

    const fill = isSelected ? 'rgba(37,99,235,0.93)' : 'rgba(15,23,42,0.80)';
    const stroke = isSelected ? '#93c5fd' : 'transparent';

    const tap = (e) => {
        e.cancelBubble = true;
        if (isSelected) onEdit(note);
        else onSelect(note.id);
    };

    return (
        <Group x={note.x} y={note.y} draggable
            onClick={tap} onTap={tap}
            onDragStart={e => { e.cancelBubble = true; }}
            onDragEnd={e => onChange({ ...note, x: e.target.x(), y: e.target.y() }, true)}
        >
            <Rect width={boxW} height={boxH}
                fill={fill} cornerRadius={8 * inv}
                stroke={stroke} strokeWidth={1.5 * inv} />
            {shown.map((it, i) => (
                <Text key={it.id}
                    text={`${it.done ? '✓' : '○'} ${it.text}`}
                    fill={it.done ? 'rgba(255,255,255,0.50)' : '#fff'}
                    fontSize={fontSize}
                    fontFamily={FONT}
                    fontStyle={it.done ? 'normal' : '600'}
                    x={padX} y={padY + i * lineH}
                    textDecoration={it.done ? 'line-through' : ''}
                />
            ))}
            {extra > 0 && (
                <Text
                    text={`+${extra} hạng mục nữa`}
                    fill="rgba(255,255,255,0.45)"
                    fontSize={fontSize * 0.85}
                    fontFamily={FONT}
                    x={padX} y={padY + shown.length * lineH}
                />
            )}
        </Group>
    );
};

export default NoteMarker;
