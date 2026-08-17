import React, { useMemo } from 'react';
import { Group, Line, Rect, Label, Tag, Text } from 'react-konva';
import {
    wallSegments, openingV, projectItemOnWall, SLAB_DEFAULT,
} from '../lib/geometry';
import { catalogItem, defaultSize, resolveZ } from '../lib/furnitureCatalog';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const INK = '#334155';
const WALL_FACE = '#f1f5f9';
const FURN = '#64748b';
const BLUE = '#2563eb';

/**
 * Khai triển một mặt tường. Hệ toạ độ local: x = u (dọc tường, đã lật theo hướng
 * nhìn), y = -z (màn hình y-down nên sàn z=0 nằm ở y=0, trần ở y âm).
 *
 * Tap được delegate lên trên y như WallsLayer — layer này thuần render:
 *   onSegmentTap(wallId, segIdx, len)   — đoạn tường giữa các cửa (luật ngang cũ)
 *   onOpeningTap(wallId, opId)          — chọn ô cửa
 *   onVerticalTap(opId, part, value)    — 'sill' | 'op' | 'head' | 'top'
 *   onCeilingTap()                      — nhãn cốt trần
 */
const ElevationLayer = ({
    frame, plan, furniture, settings, H, slabT = SLAB_DEFAULT, scale,
    selOpId, onSegmentTap, onOpeningTap, onVerticalTap, onCeilingTap,
}) => {
    const inv = 1 / scale;
    const { wall, len, toU } = frame;
    const sw = 1.4 * inv;

    const chain = useMemo(() => wallSegments(wall, len), [wall, len]);

    // Chiếu nội thất — nặng nhất, chỉ tính lại khi thật sự đổi
    const items = useMemo(() => {
        const out = [];
        for (const it of (furniture || [])) {
            const cat = catalogItem(it.kind);
            const size = { w: it.w || cat?.w || 600, d: it.d || cat?.d || 600 };
            const pr = projectItemOnWall(frame, it, size);
            if (!pr) continue;
            const h = it.h ?? cat?.h ?? 800;
            const z = resolveZ(it, cat, H);
            out.push({ ...pr, id: it.id, name: cat?.name || 'Nội thất', h, z, mount: cat?.mount });
        }
        // vẽ món cao trước, món thấp sau — đỡ che nhau
        return out.sort((a, b) => (b.z + b.h) - (a.z + a.h));
    }, [frame, furniture, H]);

    // nhãn nhỏ dùng chung
    const dimLabel = (key, x, z, txt, opts = {}) => {
        const w = (String(txt).length * 6 + 14) / 2;
        return (
            <Label key={key} x={x} y={-z}
                offsetX={w * inv} offsetY={11 * inv}
                onClick={opts.onTap} onTap={opts.onTap}
                listening={!!opts.onTap}
                onMouseEnter={(e) => { if (opts.onTap) e.target.getStage().container().style.cursor = 'text'; }}
                onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
            >
                <Tag fill={opts.fill || '#ffffff'} stroke={opts.stroke || BLUE}
                    strokeWidth={1.2 * inv} cornerRadius={6 * inv} />
                <Text text={String(txt)} fill={opts.color || '#1e40af'} fontSize={10 * inv}
                    padding={4.5 * inv} fontFamily={FONT} fontStyle="700" />
            </Label>
        );
    };

    return (
        <Group>
            {/* ===== Thân tường ===== */}
            <Rect x={0} y={-H} width={len} height={H} fill={WALL_FACE} listening={false} />

            {/* Dải sàn / dầm phía trên trần */}
            <Rect x={0} y={-(H + slabT)} width={len} height={slabT}
                fill="#e2e8f0" stroke={INK} strokeWidth={sw} listening={false} />

            {/* Hai biên là mặt CẮT tường giao — nét dày để phân biệt với mặt nhìn */}
            <Line points={[0, 0, 0, -H]} stroke={INK} strokeWidth={sw * 2.5} listening={false} />
            <Line points={[len, 0, len, -H]} stroke={INK} strokeWidth={sw * 2.5} listening={false} />

            {/* ===== Ô cửa ===== */}
            {chain.filter(s => s.kind === 'op').map(s => {
                const op = (wall.openings || []).find(o => o.id === s.opId);
                if (!op) return null;
                const { sill, h, top, assumed } = openingV(op, settings);
                // lật sang hệ nhìn rồi chuẩn hoá lại thứ tự
                const ua = toU(s.from), ub = toU(s.to);
                const x0 = Math.min(ua, ub), x1 = Math.max(ua, ub);
                const isSel = op.id === selOpId;
                const tap = (e) => { e.cancelBubble = true; onOpeningTap?.(wall.id, op.id); };
                const col = isSel ? BLUE : INK;
                return (
                    <Group key={op.id}>
                        {/* khoét trắng khỏi thân tường */}
                        <Rect x={x0} y={-top} width={x1 - x0} height={h}
                            fill={isSel ? '#dbeafe' : '#ffffff'} stroke={col} strokeWidth={sw * 1.6}
                            onClick={tap} onTap={tap}
                            hitStrokeWidth={Math.max(30 * inv, 0)} />
                        {op.type === 'door' ? (
                            // ký hiệu chiều mở trên khai triển: 2 nét chéo về phía bản lề
                            <>
                                <Line points={[op.flipped ? x1 : x0, -top, (x0 + x1) / 2, -sill]}
                                    stroke={col} strokeWidth={sw} dash={[40, 30]} listening={false} />
                                <Line points={[op.flipped ? x1 : x0, -sill, (x0 + x1) / 2, -top]}
                                    stroke={col} strokeWidth={sw} dash={[40, 30]} listening={false} />
                            </>
                        ) : (
                            <>
                                {/* đố ngang giữa + ngưỡng dưới nhô ra */}
                                <Line points={[x0, -(sill + h / 2), x1, -(sill + h / 2)]}
                                    stroke={col} strokeWidth={sw} listening={false} />
                                <Line points={[x0 - 30, -sill, x1 + 30, -sill]}
                                    stroke={col} strokeWidth={sw * 1.6} listening={false} />
                            </>
                        )}

                        {/* Cốt đỉnh ô cửa — phép đo laser thứ hai, phải bấm sửa được */}
                        {dimLabel(`top-${op.id}`, (x0 + x1) / 2, top + 90, `▽ ${Math.round(top)}`, {
                            onTap: (e) => { e.cancelBubble = true; onVerticalTap?.(op.id, 'top', Math.round(top)); },
                            stroke: assumed ? '#cbd5e1' : BLUE,
                            color: assumed ? '#64748b' : '#1e40af',
                        })}
                        {/* Chiều cao ô cửa */}
                        {dimLabel(`h-${op.id}`, (x0 + x1) / 2, sill + h / 2, assumed ? `~${Math.round(h)}` : Math.round(h), {
                            onTap: (e) => { e.cancelBubble = true; onVerticalTap?.(op.id, 'op', Math.round(h)); },
                            stroke: assumed ? '#cbd5e1' : BLUE,
                            color: assumed ? '#64748b' : '#1e40af',
                        })}
                        {/* Bệ cửa — cửa đi bằng 0 thì không cần nhãn */}
                        {sill > 0 && dimLabel(`s-${op.id}`, (x0 + x1) / 2, sill / 2, Math.round(sill), {
                            onTap: (e) => { e.cancelBubble = true; onVerticalTap?.(op.id, 'sill', Math.round(sill)); },
                            stroke: assumed ? '#cbd5e1' : BLUE,
                            color: assumed ? '#64748b' : '#1e40af',
                        })}
                    </Group>
                );
            })}

            {/* ===== Nội thất chiếu lên ===== */}
            {items.map(it => {
                const x0 = Math.min(it.u0, it.u1), x1 = Math.max(it.u0, it.u1);
                const wpx = (x1 - x0) * scale;
                return (
                    <Group key={it.id} listening={false}>
                        <Rect x={x0} y={-(it.z + it.h)} width={x1 - x0} height={it.h}
                            stroke={FURN} strokeWidth={sw}
                            dash={it.touching ? undefined : [50, 35]}
                            fill={it.touching ? 'rgba(148,163,184,0.14)' : undefined} />
                        {/* Nhãn: món nhỏ (ổ điện, công tắc) chỉ cần cao độ — đó là số duy nhất cần */}
                        {wpx > 26 && (
                            <Text
                                text={it.h < 300 && (x1 - x0) < 400 ? `+${Math.round(it.z)}` : `${it.name} · +${Math.round(it.z)}`}
                                x={x0} y={-(it.z + it.h) - 15 * inv}
                                width={Math.max(x1 - x0, 600)} align="center"
                                fontSize={9.5 * inv} fontFamily={FONT} fontStyle="600"
                                fill="#475569"
                            />
                        )}
                    </Group>
                );
            })}

            {/* ===== Sàn và trần ===== */}
            <Line points={[-200, 0, len + 200, 0]} stroke={INK} strokeWidth={sw * 3} listening={false} />
            <Line points={[0, -H, len, -H]} stroke={INK} strokeWidth={sw * 2} listening={false} />

            {/* Cốt sàn ±0.000 */}
            <Text text="±0.000" x={-200} y={22 * inv} fontSize={10 * inv}
                fontFamily={FONT} fontStyle="700" fill="#475569" listening={false} />

            {/* Cốt trần — bấm để sửa chiều cao thông thủy */}
            {dimLabel('ceil', len / 2, H + 110, `▽ trần ${Math.round(H)}`, {
                onTap: (e) => { e.cancelBubble = true; onCeilingTap?.(); },
                stroke: '#7c3aed', color: '#5b21b6',
            })}

            {/* ===== Chuỗi kích thước ngang: tái dùng nguyên luật của mặt bằng =====
                Tường không cửa thì đoạn duy nhất trùng luôn nhãn tổng — bỏ, đỡ rối. */}
            {(wall.openings || []).length > 0 && chain.filter(s => s.kind === 'seg' && s.len >= 1).map(s => {
                const ua = toU(s.from), ub = toU(s.to);
                const mid = (ua + ub) / 2;
                return dimLabel(`seg-${s.idx}`, mid, -320, Math.round(s.len), {
                    onTap: (e) => { e.cancelBubble = true; onSegmentTap?.(wall.id, s.idx, Math.round(s.len)); },
                });
            })}
            {chain.filter(s => s.kind === 'op').map(s => {
                const ua = toU(s.from), ub = toU(s.to);
                return dimLabel(`opw-${s.opId}`, (ua + ub) / 2, -320, Math.round(s.len), {
                    fill: 'rgba(100,116,139,0.88)', stroke: 'transparent', color: '#ffffff',
                });
            })}
            {/* Nhãn tổng chiều dài tường */}
            {dimLabel('total', len / 2, -620, Math.round(len), {
                fill: 'rgba(15,23,42,0.80)', stroke: 'transparent', color: '#fef08a',
            })}
        </Group>
    );
};

export default ElevationLayer;
