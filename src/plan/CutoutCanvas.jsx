import React from 'react';
import { Stage, Layer, Shape, Rect, Circle, Line, Group, Label, Tag, Text } from 'react-konva';
import { cutoutOffsets } from '../lib/cutoutModel';

const FONT = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function CutoutGrid({ stageScale, stagePos, stageSize, outer, gridMinor = 50, gridMajor = 100, isDark }) {
    const pad = Math.max(outer.w, outer.h, 800);
    const x1 = Math.min(-stagePos.x / stageScale, -pad);
    const y1 = Math.min(-stagePos.y / stageScale, -pad);
    const x2 = Math.max((stageSize.width - stagePos.x) / stageScale, outer.w + pad);
    const y2 = Math.max((stageSize.height - stagePos.y) / stageScale, outer.h + pad);
    const showMinor = stageScale * gridMinor >= 8;

    return (
        <Shape
            listening={false}
            sceneFunc={(ctx) => {
                ctx.fillStyle = isDark ? '#0b1324' : '#f1f5f9';
                ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

                const drawLines = (step, color, width) => {
                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = width / stageScale;
                    for (let x = Math.floor(x1 / step) * step; x <= x2; x += step) {
                        ctx.moveTo(x, y1);
                        ctx.lineTo(x, y2);
                    }
                    for (let y = Math.floor(y1 / step) * step; y <= y2; y += step) {
                        ctx.moveTo(x1, y);
                        ctx.lineTo(x2, y);
                    }
                    ctx.stroke();
                };
                if (showMinor) drawLines(gridMinor, isDark ? 'rgba(148,163,184,0.06)' : 'rgba(15,23,42,0.04)', 1);
                drawLines(gridMajor, isDark ? 'rgba(148,163,184,0.13)' : 'rgba(15,23,42,0.09)', 1);
            }}
        />
    );
}

function DimPill({ x, y, text, scale, bg, border, color, onTap }) {
    const inv = 1 / scale;
    const str = String(text);
    const wApprox = (str.length * 6.4 + 14);
    const interactive = typeof onTap === 'function';
    const tap = (e) => {
        if (!interactive) return;
        e.cancelBubble = true;
        onTap();
    };
    return (
        <Label
            x={x}
            y={y}
            offsetX={(wApprox / 2) * inv}
            offsetY={11 * inv}
            listening={interactive}
            onClick={tap}
            onTap={tap}
            onMouseEnter={(e) => { if (interactive) e.target.getStage().container().style.cursor = 'text'; }}
            onMouseLeave={(e) => { if (interactive) e.target.getStage().container().style.cursor = 'default'; }}
        >
            <Tag
                fill={bg}
                stroke={border}
                strokeWidth={1.2 * inv}
                cornerRadius={6 * inv}
            />
            <Text
                text={str}
                fill={color}
                fontSize={10.5 * inv}
                padding={4.5 * inv}
                fontFamily={FONT}
                fontStyle="700"
            />
        </Label>
    );
}

/**
 * Bản vẽ CAD đo lỗ khoét (bếp, lavabo, ổ điện, lỗ tròn) dùng chung cho CutoutEditor và ShareViewer.
 */
export default function CutoutCanvas({
    stageRef,
    stageSize,
    view,
    cutout,
    selId,
    guides = [],
    readOnly = false,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onSelectHole,
    onDragHole,
    onTapOuterW,
    onTapOuterH,
    onTapOffset,
    onTapHoleDim,
}) {
    const isDark = cutout?.theme !== 'light';
    const ow = Math.max(40, Number(cutout?.w) || 1000);
    const oh = Math.max(40, Number(cutout?.h) || 550);
    const holes = cutout?.cutouts || [];
    const refMode = cutout?.refMode === 'center' ? 'center' : 'edge';
    const scale = view?.scale || 0.2;
    const inv = 1 / scale;

    const ink = isDark ? '#f8fafc' : '#0f172a';
    const inkSub = isDark ? '#94a3b8' : '#64748b';
    const surfaceFill = isDark ? 'rgba(30, 41, 59, 0.55)' : '#ffffff';
    const guideStroke = isDark ? '#38bdf8' : '#2563eb';
    const pillBg = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.95)';
    const pillText = isDark ? '#f8fafc' : '#0f172a';
    const offPillBg = isDark ? 'rgba(12, 74, 110, 0.92)' : '#eff6ff';
    const offPillBorder = isDark ? '#38bdf8' : '#2563eb';
    const offPillText = isDark ? '#e0f2fe' : '#1d4ed8';

    const selectedHole = holes.find(h => h.id === selId) || (holes.length === 1 ? holes[0] : null);

    return (
        <Stage
            width={stageSize.width}
            height={stageSize.height}
            ref={stageRef}
            scaleX={scale}
            scaleY={scale}
            x={view.x}
            y={view.y}
            onWheel={onWheel}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
        >
            <Layer>
                <CutoutGrid stageScale={scale} stagePos={{ x: view.x, y: view.y }} stageSize={stageSize} outer={{ w: ow, h: oh }} isDark={isDark} />

                {/* Khung bề mặt ngoài */}
                <Rect
                    x={0}
                    y={0}
                    width={ow}
                    height={oh}
                    fill={surfaceFill}
                    stroke={ink}
                    strokeWidth={2.2 * inv}
                    listening={false}
                />

                {/* Hai trục tâm nhẹ của tấm đá / vách */}
                <Line points={[ow / 2, 0, ow / 2, oh]} stroke={isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)'} strokeWidth={1 * inv} dash={[8 * inv, 6 * inv]} listening={false} />
                <Line points={[0, oh / 2, ow, oh / 2]} stroke={isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)'} strokeWidth={1 * inv} dash={[8 * inv, 6 * inv]} listening={false} />

                {/* 4 điểm góc dạng CAD node giống ứng dụng Reekon */}
                {[[0, 0], [ow, 0], [ow, oh], [0, oh]].map(([vx, vy], idx) => (
                    <Circle
                        key={`ov-${idx}`}
                        x={vx}
                        y={vy}
                        radius={4 * inv}
                        fill={isDark ? '#0b1324' : '#ffffff'}
                        stroke={ink}
                        strokeWidth={1.6 * inv}
                        listening={false}
                    />
                ))}

                {/* Kích thước bao ngoài (Trên = Rộng W, Trái = Sâu/Cao H) */}
                <Group>
                    <Line points={[0, -28 * inv, ow, -28 * inv]} stroke={inkSub} strokeWidth={1.1 * inv} listening={false} />
                    <Line points={[0, -34 * inv, 0, -6 * inv]} stroke={inkSub} strokeWidth={1 * inv} listening={false} />
                    <Line points={[ow, -34 * inv, ow, -6 * inv]} stroke={inkSub} strokeWidth={1 * inv} listening={false} />
                    <DimPill
                        x={ow / 2}
                        y={-28 * inv}
                        text={`${Math.round(ow)}`}
                        scale={scale}
                        bg={pillBg}
                        border={inkSub}
                        color={pillText}
                        onTap={!readOnly ? onTapOuterW : null}
                    />

                    <Line points={[-28 * inv, 0, -28 * inv, oh]} stroke={inkSub} strokeWidth={1.1 * inv} listening={false} />
                    <Line points={[-34 * inv, 0, -6 * inv, 0]} stroke={inkSub} strokeWidth={1 * inv} listening={false} />
                    <Line points={[-34 * inv, oh, -6 * inv, oh]} stroke={inkSub} strokeWidth={1 * inv} listening={false} />
                    <DimPill
                        x={-28 * inv}
                        y={oh / 2}
                        text={`${Math.round(oh)}`}
                        scale={scale}
                        bg={pillBg}
                        border={inkSub}
                        color={pillText}
                        onTap={!readOnly ? onTapOuterH : null}
                    />
                </Group>

                {/* Snap alignment guidelines khi kéo */}
                {guides.map((g, idx) => (
                    <Line
                        key={`g-${idx}`}
                        points={[g.x1, g.y1, g.x2, g.y2]}
                        stroke="#f59e0b"
                        strokeWidth={1.4 * inv}
                        dash={[6 * inv, 4 * inv]}
                        listening={false}
                    />
                ))}

                {/* Các lỗ khoét bên trong */}
                {holes.map(hole => {
                    const isSel = selectedHole?.id === hole.id;
                    const cx = hole.x + hole.w / 2;
                    const cy = hole.y + hole.h / 2;
                    const accent = isSel ? guideStroke : (hole.color || ink);
                    const holeFill = isSel
                        ? (isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(37, 99, 235, 0.12)')
                        : (isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(226, 232, 240, 0.52)');

                    return (
                        <Group
                            key={hole.id}
                            x={hole.x}
                            y={hole.y}
                            draggable={!readOnly}
                            onClick={(e) => { e.cancelBubble = true; onSelectHole?.(hole.id); }}
                            onTap={(e) => { e.cancelBubble = true; onSelectHole?.(hole.id); }}
                            onDragStart={(e) => { e.cancelBubble = true; onSelectHole?.(hole.id); }}
                            onDragMove={(e) => {
                                const pos = onDragHole?.(hole, { x: e.target.x(), y: e.target.y() }, false);
                                if (pos) { e.target.x(pos.x); e.target.y(pos.y); }
                            }}
                            onDragEnd={(e) => {
                                const pos = onDragHole?.(hole, { x: e.target.x(), y: e.target.y() }, true);
                                if (pos) { e.target.x(pos.x); e.target.y(pos.y); }
                            }}
                            onMouseEnter={(e) => { if (!readOnly) e.target.getStage().container().style.cursor = 'move'; }}
                            onMouseLeave={(e) => { if (!readOnly) e.target.getStage().container().style.cursor = 'default'; }}
                        >
                            {hole.shape === 'circle' ? (
                                <>
                                    <Circle
                                        x={hole.w / 2}
                                        y={hole.h / 2}
                                        radius={hole.w / 2}
                                        fill={holeFill}
                                        stroke={accent}
                                        strokeWidth={(isSel ? 2.2 : 1.6) * inv}
                                        hitStrokeWidth={24 * inv}
                                    />
                                    <Line
                                        points={[hole.w * 0.18, hole.h / 2, hole.w * 0.82, hole.h / 2]}
                                        stroke={accent} strokeWidth={1 * inv} listening={false}
                                    />
                                    <Line
                                        points={[hole.w / 2, hole.h * 0.18, hole.w / 2, hole.h * 0.82]}
                                        stroke={accent} strokeWidth={1 * inv} listening={false}
                                    />
                                </>
                            ) : (
                                <>
                                    <Rect
                                        x={0}
                                        y={0}
                                        width={hole.w}
                                        height={hole.h}
                                        cornerRadius={hole.r || 0}
                                        fill={holeFill}
                                        stroke={accent}
                                        strokeWidth={(isSel ? 2.2 : 1.6) * inv}
                                        hitStrokeWidth={24 * inv}
                                    />
                                    {[[0, 0], [hole.w, 0], [hole.w, hole.h], [0, hole.h]].map(([hx, hy], ci) => (
                                        <Circle
                                            key={`hv-${ci}`}
                                            x={hx}
                                            y={hy}
                                            radius={3.2 * inv}
                                            fill={isDark ? '#0f172a' : '#ffffff'}
                                            stroke={accent}
                                            strokeWidth={1.3 * inv}
                                            listening={false}
                                        />
                                    ))}
                                </>
                            )}

                            {/* Tên lỗ ở tâm */}
                            <Text
                                x={-40 * inv}
                                y={hole.h / 2 - (hole.shape === 'circle' ? 20 * inv : 10 * inv)}
                                width={hole.w + 80 * inv}
                                align="center"
                                text={hole.name}
                                fontSize={11 * inv}
                                fontFamily={FONT}
                                fontStyle="700"
                                fill={isSel ? accent : ink}
                                listening={false}
                            />
                            {!isSel && (
                                <Text
                                    x={-40 * inv}
                                    y={hole.h / 2 + 4 * inv}
                                    width={hole.w + 80 * inv}
                                    align="center"
                                    text={hole.shape === 'circle' ? `Ø${Math.round(hole.w)}` : `${Math.round(hole.w)}×${Math.round(hole.h)}`}
                                    fontSize={9.5 * inv}
                                    fontFamily={FONT}
                                    fontStyle="600"
                                    fill={inkSub}
                                    listening={false}
                                />
                            )}
                        </Group>
                    );
                })}

                {/* Đường định vị 4 cạnh + kích thước trực tiếp cho lỗ đang chọn (như màn iPad trong ảnh) */}
                {selectedHole && (() => {
                    const hole = selectedHole;
                    const cx = hole.x + hole.w / 2;
                    const cy = hole.y + hole.h / 2;
                    const offs = cutoutOffsets({ w: ow, h: oh }, hole, refMode);

                    const rxL = refMode === 'center' ? cx : hole.x;
                    const rxR = refMode === 'center' ? cx : hole.x + hole.w;
                    const ryT = refMode === 'center' ? cy : hole.y;
                    const ryB = refMode === 'center' ? cy : hole.y + hole.h;

                    const tick = 5 * inv;
                    const lineProps = { stroke: guideStroke, strokeWidth: 1.3 * inv, dash: [5 * inv, 4 * inv], listening: false };

                    // Tránh đặt pill đè lên lỗ lân cận nằm cùng khoảng X/Y
                    const otherHoles = holes.filter(o => o.id !== hole.id);
                    const rightBlocked = otherHoles.some(o => o.x + o.w > rxR && o.x < ow && cy >= o.y - 16 * inv && cy <= o.y + o.h + 16 * inv);
                    const leftBlocked = otherHoles.some(o => o.x < rxL && o.x + o.w > 0 && cy >= o.y - 16 * inv && cy <= o.y + o.h + 16 * inv);
                    const topBlocked = otherHoles.some(o => o.y < ryT && o.y + o.h > 0 && cx >= o.x - 24 * inv && cx <= o.x + o.w + 24 * inv);
                    const botBlocked = otherHoles.some(o => o.y + o.h > ryB && o.y < oh && cx >= o.x - 24 * inv && cx <= o.x + o.w + 24 * inv);

                    const pillLX = leftBlocked ? Math.max(24 * inv, rxL * 0.25) : rxL / 2;
                    const pillRX = rightBlocked ? Math.min(ow - 24 * inv, ow - (ow - rxR) * 0.16) : (rxR + ow) / 2;
                    const pillTY = topBlocked ? Math.max(14 * inv, ryT * 0.25) : ryT / 2;
                    const pillBY = botBlocked ? Math.min(oh - 14 * inv, oh - (oh - ryB) * 0.25) : (ryB + oh) / 2;

                    return (
                        <Group>
                            {/* Đường gióng Trái / Phải */}
                            {rxL > 0 && (
                                <>
                                    <Line points={[0, cy, rxL, cy]} {...lineProps} />
                                    <Line points={[0, cy - tick, 0, cy + tick]} stroke={guideStroke} strokeWidth={1.5 * inv} listening={false} />
                                    <DimPill
                                        x={pillLX}
                                        y={cy}
                                        text={`T ${offs.left}`}
                                        scale={scale}
                                        bg={offPillBg}
                                        border={offPillBorder}
                                        color={offPillText}
                                        onTap={!readOnly ? () => onTapOffset?.(hole, 'left', offs.left) : null}
                                    />
                                </>
                            )}
                            {ow - rxR > 0 && (
                                <>
                                    <Line points={[rxR, cy, ow, cy]} {...lineProps} />
                                    <Line points={[ow, cy - tick, ow, cy + tick]} stroke={guideStroke} strokeWidth={1.5 * inv} listening={false} />
                                    <DimPill
                                        x={pillRX}
                                        y={cy}
                                        text={`P ${offs.right}`}
                                        scale={scale}
                                        bg={offPillBg}
                                        border={offPillBorder}
                                        color={offPillText}
                                        onTap={!readOnly ? () => onTapOffset?.(hole, 'right', offs.right) : null}
                                    />
                                </>
                            )}

                            {/* Đường gióng Trên / Dưới */}
                            {ryT > 0 && (
                                <>
                                    <Line points={[cx, 0, cx, ryT]} {...lineProps} />
                                    <Line points={[cx - tick, 0, cx + tick, 0]} stroke={guideStroke} strokeWidth={1.5 * inv} listening={false} />
                                    <DimPill
                                        x={cx}
                                        y={pillTY}
                                        text={`Tr ${offs.top}`}
                                        scale={scale}
                                        bg={offPillBg}
                                        border={offPillBorder}
                                        color={offPillText}
                                        onTap={!readOnly ? () => onTapOffset?.(hole, 'top', offs.top) : null}
                                    />
                                </>
                            )}
                            {oh - ryB > 0 && (
                                <>
                                    <Line points={[cx, ryB, cx, oh]} {...lineProps} />
                                    <Line points={[cx - tick, oh, cx + tick, oh]} stroke={guideStroke} strokeWidth={1.5 * inv} listening={false} />
                                    <DimPill
                                        x={cx}
                                        y={pillBY}
                                        text={`D ${offs.bottom}`}
                                        scale={scale}
                                        bg={offPillBg}
                                        border={offPillBorder}
                                        color={offPillText}
                                        onTap={!readOnly ? () => onTapOffset?.(hole, 'bottom', offs.bottom) : null}
                                    />
                                </>
                            )}

                            {/* Kích thước bản thân lỗ (đặt gọn bên trong lỗ nếu đủ lớn để không đè lên đường P / D) */}
                            {hole.shape === 'circle' ? (
                                <DimPill
                                    x={cx}
                                    y={hole.y + hole.h + 18 * inv}
                                    text={`Ø ${Math.round(hole.w)}`}
                                    scale={scale}
                                    bg={pillBg}
                                    border={hole.color || guideStroke}
                                    color={pillText}
                                    onTap={!readOnly ? () => onTapHoleDim?.(hole, 'd') : null}
                                />
                            ) : (
                                <>
                                    <DimPill
                                        x={cx}
                                        y={hole.h * scale >= 66 ? (hole.y + hole.h - 15 * inv) : (hole.y + hole.h + 15 * inv)}
                                        text={`R ${Math.round(hole.w)}`}
                                        scale={scale}
                                        bg={pillBg}
                                        border={hole.color || guideStroke}
                                        color={pillText}
                                        onTap={!readOnly ? () => onTapHoleDim?.(hole, 'w') : null}
                                    />
                                    <DimPill
                                        x={hole.w * scale >= 100 ? (hole.x + hole.w - 28 * inv) : (hole.x + hole.w + 26 * inv)}
                                        y={cy}
                                        text={`C ${Math.round(hole.h)}`}
                                        scale={scale}
                                        bg={pillBg}
                                        border={hole.color || guideStroke}
                                        color={pillText}
                                        onTap={!readOnly ? () => onTapHoleDim?.(hole, 'h') : null}
                                    />
                                </>
                            )}
                        </Group>
                    );
                })()}
            </Layer>
        </Stage>
    );
}
