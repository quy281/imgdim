import React from 'react';
import { Group, Line, Circle, Label, Tag, Text } from 'react-konva';
import { columnPolygon } from '../lib/geometry';

const ACCENT = '#7c3aed';

function SizeTag({ x, y, text, scale }) {
    return (
        <Label x={x} y={y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
            <Tag fill={ACCENT} cornerRadius={4} />
            <Text text={text} fontSize={11} fontStyle="bold" fill="#fff" padding={3} />
        </Label>
    );
}

/**
 * Ô cột đang đặt. Vẽ trên cùng, KHÔNG ghi vào plan cho tới khi thả tay — nên kéo
 * qua kéo lại thoải mái mà lịch sử undo không đầy rác.
 *
 * `target` là chỗ neo (góc hoặc thân tường); a/b là hai cạnh đã làm tròn 50mm.
 */
export default function ColumnPreview({ target, a, b, scale }) {
    if (!target) return null;

    // Chưa kéo: chỉ chấm sáng chỗ sẽ đặt, để người dùng biết app đã bắt đúng điểm.
    if (!a || !b) {
        return (
            <Group listening={false}>
                <Circle x={target.p.x} y={target.p.y} radius={9 / scale}
                    fill={ACCENT} opacity={0.28} />
                <Circle x={target.p.x} y={target.p.y} radius={4 / scale} fill={ACCENT} />
            </Group>
        );
    }

    const pts = columnPolygon(target, a, b);
    const flat = pts.flatMap(p => [p.x, p.y]);
    // Nhãn đặt ở trung điểm hai cạnh kề nhau — đọc được cả khi ô cột rất nhỏ.
    const mid = (i, j) => ({ x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 });
    const mA = mid(0, 1);
    const mB = mid(1, 2);

    return (
        <Group listening={false}>
            <Line points={flat} closed fill={ACCENT} opacity={0.22} />
            <Line points={flat} closed stroke={ACCENT} strokeWidth={2 / scale} />
            <SizeTag x={mA.x} y={mA.y} text={String(Math.round(a))} scale={scale} />
            <SizeTag x={mB.x} y={mB.y} text={String(Math.round(b))} scale={scale} />
        </Group>
    );
}
