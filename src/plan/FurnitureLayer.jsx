import React from 'react';
import { Group, Rect, Line, Circle, Ellipse, Text } from 'react-konva';
import { catalogItem } from '../lib/furnitureCatalog';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const FILL = 'rgba(148,163,184,0.30)';
const FILL_SEL = 'rgba(37,99,235,0.20)';
const LINE = '#64748b';
const LINE_SEL = '#2563eb';

/**
 * Ký hiệu 2D trong hệ tọa độ local: tâm (0,0), lưng ở y=-d/2, mặt hướng y=+d/2.
 * Chỉ dùng nét — không tô đặc, để không lấn tường khi in.
 */
function Symbol2D({ sym, w, d, sw, color }) {
    const hw = w / 2, hd = d / 2;
    const common = { stroke: color, strokeWidth: sw, listening: false };

    switch (sym) {
        case 'bed': {
            const pillowD = Math.min(d * 0.18, 300);
            const gap = Math.min(w * 0.04, 60);
            const pw = (w - gap * 3) / 2;
            return (
                <>
                    {/* gối ở đầu giường (phía lưng) */}
                    {w > 1300 ? (
                        <>
                            <Rect x={-hw + gap} y={-hd + gap} width={pw} height={pillowD} cornerRadius={sw * 3} {...common} />
                            <Rect x={gap / 2} y={-hd + gap} width={pw} height={pillowD} cornerRadius={sw * 3} {...common} />
                        </>
                    ) : (
                        <Rect x={-hw + gap} y={-hd + gap} width={w - gap * 2} height={pillowD} cornerRadius={sw * 3} {...common} />
                    )}
                    {/* mép chăn */}
                    <Line points={[-hw, -hd + pillowD + gap * 2, hw, -hd + pillowD + gap * 2]} {...common} />
                </>
            );
        }
        case 'cab':
            // tủ: đường chỉ mặt cánh chạy dọc mặt trước
            return <Line points={[-hw, hd - d * 0.22, hw, hd - d * 0.22]} {...common} />;
        case 'sofa': {
            const arm = Math.min(w * 0.12, 220);
            const backD = Math.min(d * 0.22, 220);
            return (
                <>
                    <Line points={[-hw, -hd + backD, hw, -hd + backD]} {...common} />
                    <Line points={[-hw + arm, -hd + backD, -hw + arm, hd]} {...common} />
                    <Line points={[hw - arm, -hd + backD, hw - arm, hd]} {...common} />
                </>
            );
        }
        case 'table': {
            // ghế: ô nhỏ quanh 2 mặt dài
            const cs = Math.min(w, d) * 0.22;
            const n = Math.max(2, Math.round(w / 700));
            const seats = [];
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                seats.push(<Rect key={`t${i}`} x={cx - cs / 2} y={-hd - cs * 0.85} width={cs} height={cs * 0.7} cornerRadius={sw * 2} {...common} />);
                seats.push(<Rect key={`b${i}`} x={cx - cs / 2} y={hd + cs * 0.15} width={cs} height={cs * 0.7} cornerRadius={sw * 2} {...common} />);
            }
            return <>{seats}</>;
        }
        case 'toilet':
            return (
                <>
                    <Rect x={-hw} y={-hd} width={w} height={d * 0.28} {...common} />
                    <Ellipse x={0} y={hd - d * 0.3} radiusX={hw * 0.82} radiusY={d * 0.3} {...common} />
                </>
            );
        case 'basin': {
            const n = w > 900 ? 2 : 1;
            const bowls = [];
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                bowls.push(<Ellipse key={i} x={cx} y={0} radiusX={(w / n) * 0.32} radiusY={d * 0.28} {...common} />);
            }
            return <>{bowls}</>;
        }
        case 'shower':
            return (
                <>
                    <Line points={[-hw, -hd, hw, hd]} {...common} />
                    <Line points={[hw, -hd, -hw, hd]} {...common} />
                    <Circle x={-hw + w * 0.16} y={-hd + d * 0.16} radius={Math.min(w, d) * 0.09} {...common} />
                </>
            );
        case 'tub':
            return <Rect x={-hw + w * 0.05} y={-hd + d * 0.12} width={w * 0.9} height={d * 0.76}
                cornerRadius={Math.min(w, d) * 0.12} {...common} />;
        case 'hob': {
            const r = Math.min(w, d) * 0.13;
            return (
                <>
                    <Circle x={-w * 0.22} y={-d * 0.18} radius={r} {...common} />
                    <Circle x={w * 0.22} y={-d * 0.18} radius={r} {...common} />
                    <Circle x={-w * 0.22} y={d * 0.2} radius={r * 0.8} {...common} />
                    <Circle x={w * 0.22} y={d * 0.2} radius={r * 0.8} {...common} />
                </>
            );
        }
        case 'altar':
            // bàn thờ: viền kép + vạch chỉ hướng mặt (để soi hướng phong thủy)
            return (
                <>
                    <Rect x={-hw + d * 0.1} y={-hd + d * 0.1} width={w - d * 0.2} height={d - d * 0.2} {...common} />
                    <Line points={[-hw + w * 0.35, hd, hw - w * 0.35, hd]} stroke={color} strokeWidth={sw * 2.5} listening={false} />
                </>
            );
        case 'stairs': {
            const steps = Math.max(3, Math.round(d / 270));
            const lines = [];
            for (let i = 1; i < steps; i++) {
                const y = -hd + (d / steps) * i;
                lines.push(<Line key={i} points={[-hw, y, hw, y]} {...common} />);
            }
            // mũi tên chiều lên
            lines.push(<Line key="ar" points={[0, hd - d * 0.08, 0, -hd + d * 0.08]} {...common} />);
            lines.push(<Line key="ah" points={[-w * 0.14, -hd + d * 0.2, 0, -hd + d * 0.08, w * 0.14, -hd + d * 0.2]} {...common} />);
            return <>{lines}</>;
        }
        default:
            return null;
    }
}

/**
 * item = { id, kind, x, y, w, d, rot }  — x,y = tâm; rot = 0|90|180|270
 */
const FurnitureItem = ({ item, scale, isSelected, onSelect, onChange, onRotate }) => {
    const inv = 1 / scale;
    const cat = catalogItem(item.kind);
    const w = item.w || cat?.w || 600;
    const d = item.d || cat?.d || 600;
    const sw = 1.2 * inv;
    const color = isSelected ? LINE_SEL : LINE;
    const lastTap = React.useRef(0);

    const tap = (e) => {
        e.cancelBubble = true;
        const now = e.evt?.timeStamp || 0;
        if (isSelected && now - lastTap.current < 320) { onRotate(item); lastTap.current = 0; return; }
        lastTap.current = now;
        onSelect(item.id);
    };

    return (
        <Group
            x={item.x} y={item.y} rotation={item.rot || 0} draggable
            onClick={tap} onTap={tap}
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragMove={(e) => onChange({ ...item, x: e.target.x(), y: e.target.y() }, false, e.target)}
            onDragEnd={(e) => onChange({ ...item, x: e.target.x(), y: e.target.y() }, true, e.target)}
            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; }}
            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
        >
            <Rect
                x={-w / 2} y={-d / 2} width={w} height={d}
                fill={isSelected ? FILL_SEL : FILL}
                stroke={color} strokeWidth={isSelected ? sw * 2 : sw * 1.5}
                hitStrokeWidth={0}
            />
            {/* vạch lưng dày hơn — biết ngay mặt nào áp tường */}
            {cat?.back && (
                <Line points={[-w / 2, -d / 2, w / 2, -d / 2]}
                    stroke={color} strokeWidth={sw * 3} listening={false} />
            )}
            <Symbol2D sym={cat?.sym} w={w} d={d} sw={sw} color={color} />
            {cat && (
                <Text
                    text={cat.name}
                    x={-w / 2} y={-5.5 * inv}
                    width={w} align="center"
                    rotation={-(item.rot || 0)}
                    fontSize={Math.min(11 * inv, d * 0.3)}
                    fontFamily={FONT} fontStyle="600"
                    fill={isSelected ? '#1e40af' : '#475569'}
                    listening={false}
                />
            )}
        </Group>
    );
};

const FurnitureLayer = ({ items, scale, sel, listening, onSelect, onChange, onRotate }) => (
    <Group listening={listening}>
        {(items || []).map(it => (
            <FurnitureItem key={it.id} item={it} scale={scale}
                isSelected={sel?.kind === 'furniture' && sel.id === it.id}
                onSelect={onSelect} onChange={onChange} onRotate={onRotate} />
        ))}
    </Group>
);

export default FurnitureLayer;
