import React from 'react';
import { Group, Rect, Line, Circle, Ellipse, Arc, Label, Tag, Text } from 'react-konva';
import { catalogItem } from '../lib/furnitureCatalog';
import { furnitureBasis } from '../lib/magnetSnap';
import { isParametricCabinet, resolveParametricConfig } from '../lib/parametricModel';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const FILL = 'rgba(241,245,249,0.72)';
const FILL_WOOD = 'rgba(254,243,199,0.42)';
const FILL_SOFT = 'rgba(226,232,240,0.48)';
const FILL_WATER = 'rgba(224,242,254,0.45)';
const FILL_SEL = 'rgba(37,99,235,0.16)';
const FILL_EDIT = 'rgba(5,150,105,0.14)';
const LINE = '#475569';
const LINE_SUB = '#94a3b8';
const LINE_SEL = '#2563eb';
const LINE_EDIT = '#059669';

/** Thứ tự vẽ mặt bằng: thảm dưới cùng -> đồ đặt sàn -> chậu/bếp trên mặt đá -> đồ treo tường/trần trên cùng */
function layerOrder(item) {
    const cat = catalogItem(item.kind);
    if (cat?.sym === 'rug') return 0;
    if (cat?.mount === 'ceiling') return 4;
    if (cat?.mount === 'wall') return 3;
    if ((item.z ?? cat?.z ?? 0) >= 500) return 2;
    return 1;
}

/** Màu nền tinh tế theo chủng loại để bản vẽ mặt bằng nội thất có chiều sâu chuyên nghiệp */
function itemFill(cat, isSelected, isEditing) {
    if (isEditing) return FILL_EDIT;
    if (isSelected) return FILL_SEL;
    if (!cat) return FILL;
    if (cat.sym === 'rug') return 'rgba(254,249,195,0.28)';
    if (cat.group === 'wc' || cat.sym === 'sink' || cat.sym === 'sink2') return FILL_WATER;
    if (['wardrobe', 'wardrobe_slide', 'cab', 'dresser', 'desk', 'nightstand', 'tvstand', 'table', 'altar', 'shoe_bench'].includes(cat.sym)) {
        return FILL_WOOD;
    }
    if (['bed', 'sofa', 'sofaL', 'armchair', 'bench'].includes(cat.sym)) return FILL_SOFT;
    return FILL;
}

/**
 * Thư viện ký hiệu CAD 2D kiến trúc nội thất chuyên nghiệp.
 * Hệ tọa độ local: tâm (0,0), lưng áp tường ở y = -d/2, mặt trước hướng vào phòng y = +d/2.
 */
function Symbol2D({ sym, w, d, sw, color, subColor, item, cat }) {
    const hw = w / 2, hd = d / 2;
    const st = { stroke: color, strokeWidth: sw, listening: false };
    const stThin = { stroke: subColor, strokeWidth: sw * 0.78, listening: false };

    switch (sym) {
        case 'bed': {
            const hbD = Math.min(70, d * 0.045);
            const pillowD = Math.min(d * 0.19, 320);
            const gap = Math.min(w * 0.045, 65);
            const twoPillows = w > 1300;
            const pw = twoPillows ? (w - gap * 3) / 2 : (w - gap * 2);
            const sheetY = -hd + hbD + pillowD + gap * 1.8;
            const foldD = Math.min(d * 0.12, 210);
            const throwD = Math.min(d * 0.16, 280);
            return (
                <>
                    {/* Thành đầu giường */}
                    <Rect x={-hw} y={-hd} width={w} height={hbD} fill="rgba(148,163,184,0.25)" {...st} />
                    {/* Gối nằm bo góc mềm + viền chỉ may trong */}
                    {twoPillows ? (
                        <>
                            <Rect x={-hw + gap} y={-hd + hbD + gap * 0.7} width={pw} height={pillowD} cornerRadius={pillowD * 0.25} fill="#ffffff" {...st} />
                            <Rect x={gap / 2} y={-hd + hbD + gap * 0.7} width={pw} height={pillowD} cornerRadius={pillowD * 0.25} fill="#ffffff" {...st} />
                            <Line points={[-hw + gap * 1.6, -hd + hbD + gap * 0.7 + pillowD * 0.5, -hw + gap + pw - gap * 0.6, -hd + hbD + gap * 0.7 + pillowD * 0.5]} {...stThin} />
                            <Line points={[gap * 1.1, -hd + hbD + gap * 0.7 + pillowD * 0.5, gap / 2 + pw - gap * 0.6, -hd + hbD + gap * 0.7 + pillowD * 0.5]} {...stThin} />
                        </>
                    ) : (
                        <Rect x={-hw + gap} y={-hd + hbD + gap * 0.7} width={pw} height={pillowD} cornerRadius={pillowD * 0.25} fill="#ffffff" {...st} />
                    )}
                    {/* Nếp gấp chăn (duvet turn-down) có vát góc kiến trúc */}
                    <Line points={[-hw, sheetY, hw, sheetY]} {...st} />
                    <Line points={[-hw, sheetY + foldD, hw - Math.min(260, w * 0.18), sheetY + foldD, hw, sheetY]} {...st} />
                    <Line points={[hw - Math.min(260, w * 0.18), sheetY, hw - Math.min(260, w * 0.18), sheetY + foldD]} {...stThin} />
                    {/* Khăn trải trang trí cuối giường (bed runner) */}
                    <Line points={[-hw + gap * 0.5, hd - throwD, hw - gap * 0.5, hd - throwD]} {...stThin} />
                    <Line points={[-hw + gap * 0.5, hd - gap * 0.6, hw - gap * 0.5, hd - gap * 0.6]} {...stThin} />
                </>
            );
        }

        case 'headboard': {
            const n = Math.max(3, Math.round(w / 400));
            const ticks = [];
            for (let i = 1; i < n; i++) {
                const x = -hw + (w / n) * i;
                ticks.push(<Line key={i} points={[x, -hd, x, hd]} {...stThin} />);
            }
            return <>{ticks}</>;
        }

        case 'wardrobe':
        case 'wardrobe_slide': {
            const isSlide = sym === 'wardrobe_slide';
            const doorBand = isSlide ? Math.min(90, d * 0.16) : Math.min(45, d * 0.08);
            const nBays = Math.max(2, Math.round(w / (isSlide ? 950 : 580)));
            const els = [];
            // Suốt treo quần áo dọc tâm tủ + các vạch móc áo chéo (chuẩn CAD nội thất)
            const railY = ( -hd + (hd - doorBand) ) / 2;
            els.push(<Line key="rail" points={[-hw + 35, railY, hw - 35, railY]} {...stThin} />);
            for (let b = 0; b < nBays; b++) {
                const x0 = -hw + (w / nBays) * b;
                const bw = w / nBays;
                if (b > 0) els.push(<Line key={`div-${b}`} points={[x0, -hd, x0, hd - doorBand]} {...st} />);
                const nTicks = Math.max(3, Math.min(7, Math.floor(bw / 130)));
                const hangerHalf = Math.min(d * 0.24, 130);
                for (let k = 1; k <= nTicks; k++) {
                    const tx = x0 + (bw / (nTicks + 1)) * k;
                    els.push(<Line key={`hg-${b}-${k}`} points={[tx - 24, railY - hangerHalf, tx + 24, railY + hangerHalf]} {...stThin} />);
                }
            }
            if (isSlide) {
                // Cửa lùa 2 ray so le
                const midY = hd - doorBand / 2;
                els.push(<Line key="tr1" points={[-hw, hd - doorBand, hw, hd - doorBand]} {...st} />);
                els.push(<Line key="sl1" points={[-hw + 20, midY - doorBand * 0.18, 30, midY - doorBand * 0.18]} stroke={color} strokeWidth={sw * 1.8} listening={false} />);
                els.push(<Line key="sl2" points={[-30, midY + doorBand * 0.18, hw - 20, midY + doorBand * 0.18]} stroke={color} strokeWidth={sw * 1.8} listening={false} />);
            } else {
                els.push(<Line key="dr" points={[-hw, hd - doorBand, hw, hd - doorBand]} {...st} />);
            }
            return <>{els}</>;
        }

        case 'cab':
        case 'cab_wall':
        case 'kitchen_base':
        case 'shoe_bench': {
            const isWall = sym === 'cab_wall';
            const isKitchen = sym === 'kitchen_base';
            const isShoeBench = sym === 'shoe_bench';
            const benchW = isShoeBench ? Math.min(500, w * 0.36) : 0;
            const cabW = w - benchW;
            const cabRight = hw - benchW;
            const bays = item && isParametricCabinet(item.kind) ? resolveParametricConfig(item, cat).bays : null;
            const nDiv = bays ? bays.length : Math.max(1, Math.round(cabW / 600));
            const divs = [];
            for (let i = 1; i < nDiv; i++) {
                const x = -hw + (cabW / nDiv) * i;
                divs.push(<Line key={i} points={[x, -hd, x, hd]} {...stThin} dash={isWall ? [25, 22] : [35, 28]} />);
            }
            return (
                <>
                    {!isWall && <Line points={[-hw, hd - Math.min(45, d * 0.1), cabRight, hd - Math.min(45, d * 0.1)]} {...st} />}
                    {isWall && <Line points={[-hw, -hd, hw, hd]} {...stThin} dash={[30, 25]} />}
                    {isKitchen && <Line points={[-hw, hd - 50, hw, hd - 50]} {...stThin} dash={[40, 30]} />}
                    {divs}
                    {isShoeBench && (
                        <>
                            <Line points={[cabRight, -hd, cabRight, hd]} {...st} />
                            <Rect x={cabRight + 20} y={-hd + 25} width={benchW - 40} height={d - 50} cornerRadius={25} {...stThin} />
                        </>
                    )}
                </>
            );
        }

        case 'island': {
            const overhang = Math.min(260, d * 0.28);
            const nStools = Math.max(2, Math.round(w / 650));
            const stools = [];
            for (let i = 0; i < nStools; i++) {
                const cx = -hw + (w / nStools) * (i + 0.5);
                const r = Math.min(155, (w / nStools) * 0.28);
                stools.push(<Circle key={i} x={cx} y={hd - overhang * 0.45} radius={r} {...stThin} />);
            }
            return (
                <>
                    <Line points={[-hw, hd - overhang, hw, hd - overhang]} {...stThin} dash={[35, 25]} />
                    {stools}
                </>
            );
        }

        case 'nightstand': {
            const pad = Math.min(45, w * 0.1);
            return (
                <>
                    <Rect x={-hw + pad} y={-hd + pad} width={w - pad * 2} height={d - pad * 2} {...stThin} />
                    <Circle x={0} y={0} radius={Math.min(w, d) * 0.22} {...stThin} />
                    <Line points={[-w * 0.18, hd - pad * 0.4, w * 0.18, hd - pad * 0.4]} stroke={color} strokeWidth={sw * 1.6} listening={false} />
                </>
            );
        }

        case 'dresser': {
            const stoolR = Math.min(170, w * 0.16, d * 0.36);
            return (
                <>
                    {/* Gương bàn phấn sát tường */}
                    <Rect x={-w * 0.28} y={-hd + 18} width={w * 0.56} height={Math.min(36, d * 0.09)} fill="#ffffff" {...st} />
                    <Line points={[-hw + w * 0.32, -hd, -hw + w * 0.32, hd]} {...stThin} />
                    <Line points={[hw - w * 0.32, -hd, hw - w * 0.32, hd]} {...stThin} />
                    {/* Đôn tròn nhô nhẹ phía trước */}
                    <Circle x={0} y={hd + stoolR * 0.35} radius={stoolR} fill="#ffffff" {...st} />
                </>
            );
        }

        case 'desk': {
            const cw = Math.min(480, w * 0.42);
            const cd = Math.min(420, d * 0.68);
            const pedW = Math.min(380, w * 0.32);
            return (
                <>
                    {/* Hộc ngăn kéo bên phải */}
                    {w >= 950 && <Line points={[hw - pedW, -hd, hw - pedW, hd]} {...stThin} dash={[30, 25]} />}
                    {/* Bàn phím / laptop pad */}
                    <Rect x={-cw * 0.45} y={-d * 0.08} width={cw * 0.9} height={d * 0.34} cornerRadius={14} {...stThin} />
                    {/* Ghế xoay làm việc nhô ra phía người ngồi (+hd) */}
                    <Rect x={-cw / 2} y={hd - cd * 0.28} width={cw} height={cd * 0.72} cornerRadius={cw * 0.22} fill="#ffffff" {...st} />
                    <Rect x={-cw * 0.44} y={hd + cd * 0.32} width={cw * 0.88} height={cd * 0.22} cornerRadius={cw * 0.12} fill="#ffffff" {...st} />
                </>
            );
        }

        case 'bench': {
            const bolsterW = Math.min(120, w * 0.1);
            return (
                <>
                    <Rect x={-hw + 20} y={-hd + 20} width={bolsterW} height={d - 40} cornerRadius={25} {...stThin} />
                    <Rect x={hw - 20 - bolsterW} y={-hd + 20} width={bolsterW} height={d - 40} cornerRadius={25} {...stThin} />
                    <Line points={[-hw + 20 + bolsterW, 0, hw - 20 - bolsterW, 0]} {...stThin} />
                </>
            );
        }

        case 'sofa': {
            const armW = Math.min(w * 0.11, 200);
            const backD = Math.min(d * 0.24, 220);
            const innerW = w - armW * 2;
            const nSeats = w >= 1900 ? 3 : 2;
            const lines = [];
            for (let i = 1; i < nSeats; i++) {
                const x = -hw + armW + (innerW / nSeats) * i;
                lines.push(<Line key={i} points={[x, -hd + backD, x, hd - 20]} {...st} />);
            }
            const pw = Math.min(260, innerW * 0.2);
            return (
                <>
                    {/* Tựa lưng & 2 tay vịn bo tròn */}
                    <Rect x={-hw} y={-hd} width={w} height={backD} cornerRadius={35} fill="rgba(255,255,255,0.45)" {...st} />
                    <Rect x={-hw} y={-hd + backD * 0.6} width={armW} height={d - backD * 0.6} cornerRadius={35} fill="rgba(255,255,255,0.45)" {...st} />
                    <Rect x={hw - armW} y={-hd + backD * 0.6} width={armW} height={d - backD * 0.6} cornerRadius={35} fill="rgba(255,255,255,0.45)" {...st} />
                    {lines}
                    {/* Gối tựa trang trí 2 góc */}
                    <Line points={[-hw + armW + 30, -hd + backD + pw * 0.65, -hw + armW + 30 + pw * 0.75, -hd + backD + 20]} {...stThin} />
                    <Line points={[hw - armW - 30, -hd + backD + pw * 0.65, hw - armW - 30 - pw * 0.75, -hd + backD + 20]} {...stThin} />
                </>
            );
        }

        case 'sofaL': {
            // Sofa góc chữ L thực thụ bên trong khổ bao w × d: phần văng chính ở lưng (-hd), phần chaise dài ở bên phải
            const armW = Math.min(w * 0.085, 190);
            const backD = Math.min(d * 0.13, 210);
            const mainD = Math.min(d * 0.52, 920);
            const chaiseW = Math.min(w * 0.37, 980);
            const mainSpanW = w - chaiseW - armW;
            const seatMidX = -hw + armW + mainSpanW / 2;
            const chaiseLeftX = hw - chaiseW;
            return (
                <>
                    {/* Đường biên thực hình chữ L */}
                    <Line
                        points={[
                            -hw, -hd,
                            hw, -hd,
                            hw, hd,
                            chaiseLeftX, hd,
                            chaiseLeftX, -hd + mainD,
                            -hw, -hd + mainD,
                        ]}
                        closed fill="rgba(226,232,240,0.62)" {...st}
                    />
                    {/* Tựa lưng & tay vịn */}
                    <Rect x={-hw} y={-hd} width={w} height={backD} cornerRadius={30} fill="rgba(255,255,255,0.5)" {...st} />
                    <Rect x={-hw} y={-hd + backD * 0.6} width={armW} height={mainD - backD * 0.6} cornerRadius={30} fill="rgba(255,255,255,0.5)" {...st} />
                    <Rect x={hw - armW} y={-hd + backD * 0.6} width={armW} height={d * 0.55} cornerRadius={30} fill="rgba(255,255,255,0.5)" {...st} />
                    {/* Đường chia đệm ngồi */}
                    <Line points={[seatMidX, -hd + backD, seatMidX, -hd + mainD]} {...st} />
                    <Line points={[chaiseLeftX, -hd + backD, chaiseLeftX, -hd + mainD]} {...st} />
                </>
            );
        }

        case 'armchair': {
            const arm = w * 0.18;
            const back = d * 0.24;
            return (
                <>
                    <Rect x={-hw} y={-hd} width={w} height={back} cornerRadius={35} fill="rgba(255,255,255,0.5)" {...st} />
                    <Rect x={-hw} y={-hd + back * 0.5} width={arm} height={d - back * 0.5} cornerRadius={35} fill="rgba(255,255,255,0.5)" {...st} />
                    <Rect x={hw - arm} y={-hd + back * 0.5} width={arm} height={d - back * 0.5} cornerRadius={35} fill="rgba(255,255,255,0.5)" {...st} />
                </>
            );
        }

        case 'coffee': {
            const p = Math.min(w, d) * 0.12;
            return (
                <>
                    <Rect x={-hw + p} y={-hd + p} width={w - p * 2} height={d - p * 2} cornerRadius={20} {...stThin} />
                    <Rect x={-w * 0.16} y={-d * 0.16} width={w * 0.32} height={d * 0.32} {...stThin} />
                </>
            );
        }

        case 'rug': {
            const p = Math.min(w, d) * 0.07;
            return (
                <Rect x={-hw + p} y={-hd + p} width={w - p * 2} height={d - p * 2}
                    stroke={subColor} strokeWidth={sw * 0.8} dash={[45, 35]} listening={false} />
            );
        }

        case 'tvstand': {
            return (
                <>
                    <Line points={[-w * 0.18, -hd, -w * 0.18, hd]} {...stThin} />
                    <Line points={[w * 0.18, -hd, w * 0.18, hd]} {...stThin} />
                    <Line points={[-hw, hd - Math.min(35, d * 0.1), hw, hd - Math.min(35, d * 0.1)]} {...st} />
                </>
            );
        }

        case 'tv': {
            return (
                <>
                    <Line points={[-hw + 20, 0, hw - 20, 0]} stroke={color} strokeWidth={sw * 2.4} listening={false} />
                    <Line points={[-w * 0.12, -hd, w * 0.12, -hd, w * 0.08, 0, -w * 0.08, 0]} closed {...stThin} />
                </>
            );
        }

        case 'table': {
            const cw = Math.min(430, Math.min(w, d) * 0.45);
            const cd = cw * 0.62;
            const hasEndChairs = w >= 1900;
            const nSide = hasEndChairs ? Math.max(2, Math.round((w - 500) / 620)) : Math.max(2, Math.round(w / 620));
            const seats = [];
            const spanW = hasEndChairs ? w * 0.82 : w * 0.92;
            for (let i = 0; i < nSide; i++) {
                const cx = -spanW / 2 + (spanW / nSide) * (i + 0.5);
                // Ghế cạnh trên (-hd) & cạnh dưới (+hd) với lưng ghế cong nhẹ
                seats.push(
                    <Group key={`top-${i}`} listening={false}>
                        <Rect x={cx - cw / 2} y={-hd - cd * 0.72} width={cw} height={cd} cornerRadius={cw * 0.22} fill="#ffffff" {...st} />
                        <Line points={[cx - cw * 0.4, -hd - cd * 0.52, cx + cw * 0.4, -hd - cd * 0.52]} {...stThin} />
                    </Group>,
                    <Group key={`bot-${i}`} listening={false}>
                        <Rect x={cx - cw / 2} y={hd - cd * 0.28} width={cw} height={cd} cornerRadius={cw * 0.22} fill="#ffffff" {...st} />
                        <Line points={[cx - cw * 0.4, hd + cd * 0.52, cx + cw * 0.4, hd + cd * 0.52]} {...stThin} />
                    </Group>
                );
            }
            if (hasEndChairs) {
                seats.push(
                    <Rect key="left" x={-hw - cd * 0.72} y={-cw / 2} width={cd} height={cw} cornerRadius={cw * 0.22} fill="#ffffff" {...st} />,
                    <Rect key="right" x={hw - cd * 0.28} y={-cw / 2} width={cd} height={cw} cornerRadius={cw * 0.22} fill="#ffffff" {...st} />
                );
            }
            const inset = Math.min(w, d) * 0.08;
            return (
                <>
                    {seats}
                    {/* Mặt bàn đè lên phần chân ghế thu vào gầm bàn (đúng chuẩn hình chiếu mặt bằng) */}
                    <Rect x={-hw} y={-hd} width={w} height={d} cornerRadius={30} fill="rgba(254,243,199,0.85)" {...st} />
                    <Rect x={-hw + inset} y={-hd + inset} width={w - inset * 2} height={d - inset * 2} cornerRadius={18} {...stThin} />
                </>
            );
        }

        case 'partition': {
            const slats = Math.max(4, Math.round(w / 110));
            const lines = [];
            for (let i = 0; i < slats; i++) {
                const x = -hw + (w / slats) * (i + 0.5);
                lines.push(<Rect key={i} x={x - 16} y={-hd + 8} width={32} height={d - 16} fill="rgba(180,83,9,0.25)" {...st} />);
            }
            return <>{lines}</>;
        }

        case 'plant': {
            const r = Math.min(hw, hd) * 0.88;
            const leaves = [0, 60, 120, 180, 240, 300].map(deg => {
                const rad = (deg * Math.PI) / 180;
                return (
                    <Ellipse key={deg}
                        x={Math.cos(rad) * r * 0.36} y={Math.sin(rad) * r * 0.36}
                        radiusX={r * 0.42} radiusY={r * 0.16} rotation={deg}
                        fill="rgba(16,185,129,0.22)" stroke="#059669" strokeWidth={sw * 0.9} listening={false}
                    />
                );
            });
            return (
                <>
                    <Circle x={0} y={0} radius={r} fill="rgba(254,243,199,0.5)" {...st} />
                    <Circle x={0} y={0} radius={r * 0.78} {...stThin} />
                    {leaves}
                </>
            );
        }

        case 'toilet': {
            const tankD = d * 0.28;
            const bowlCy = -hd + tankD + (d - tankD) * 0.52;
            const bowlRx = hw * 0.84;
            const bowlRy = (d - tankD) * 0.46;
            return (
                <>
                    {/* Két nước vát nhẹ + nút nhấn kép */}
                    <Rect x={-hw * 0.92} y={-hd} width={w * 0.92} height={tankD} cornerRadius={20} fill="#ffffff" {...st} />
                    <Ellipse x={0} y={-hd + tankD * 0.5} radiusX={w * 0.1} radiusY={tankD * 0.16} {...stThin} />
                    {/* Bệ ngồi bầu dục đôi */}
                    <Ellipse x={0} y={bowlCy} radiusX={bowlRx} radiusY={bowlRy} fill="#ffffff" {...st} />
                    <Ellipse x={0} y={bowlCy + bowlRy * 0.06} radiusX={bowlRx * 0.68} radiusY={bowlRy * 0.68} {...stThin} />
                </>
            );
        }

        case 'basin': {
            const n = w > 900 ? 2 : 1;
            const els = [];
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                const rx = (w / n) * 0.34, ry = d * 0.30;
                els.push(
                    <Ellipse key={`b${i}`} x={cx} y={d * 0.06} radiusX={rx} radiusY={ry} fill="#ffffff" {...st} />,
                    <Circle key={`d${i}`} x={cx} y={d * 0.02} radius={Math.min(24, rx * 0.12)} {...stThin} />,
                    <Line key={`f${i}`} points={[cx, -hd + d * 0.1, cx, -hd + d * 0.32]} stroke={color} strokeWidth={sw * 1.6} listening={false} />
                );
            }
            return <>{els}</>;
        }

        case 'sink':
        case 'sink2': {
            const hasDrainer = sym === 'sink2';
            const workW = hasDrainer ? w * 0.66 : w;
            const nBowls = w >= 720 ? 2 : 1;
            const pad = 42;
            const bowlW = (workW - pad * (nBowls + 1)) / nBowls;
            const bowlH = d - pad * 2.3;
            const els = [];
            for (let i = 0; i < nBowls; i++) {
                const bx = -hw + pad + i * (bowlW + pad);
                const by = -hd + pad * 1.3;
                els.push(
                    <Rect key={`bw${i}`} x={bx} y={by} width={bowlW} height={bowlH} cornerRadius={35} fill="#ffffff" {...st} />,
                    <Circle key={`dr${i}`} x={bx + bowlW / 2} y={by + bowlH * 0.35} radius={26} {...stThin} />
                );
            }
            // Vòi rửa cổ ngỗng ở giữa
            const fx = -hw + workW / 2;
            els.push(<Line key="faucet" points={[fx, -hd + 22, fx, -hd + d * 0.32]} stroke={color} strokeWidth={sw * 1.8} listening={false} />);
            if (hasDrainer) {
                const dx0 = -hw + workW + 25, dx1 = hw - 35;
                for (let k = 0; k < 5; k++) {
                    const ry = -hd + pad * 1.5 + (bowlH / 4) * k;
                    els.push(<Line key={`rib${k}`} points={[dx0, ry, dx1, ry]} {...stThin} />);
                }
            }
            return <>{els}</>;
        }

        case 'hob': {
            const r1 = Math.min(w, d) * 0.19;
            const r2 = Math.min(w, d) * 0.15;
            return (
                <>
                    <Rect x={-hw + 20} y={-hd + 20} width={w - 40} height={d - 40} cornerRadius={18} fill="rgba(15,23,42,0.06)" {...stThin} />
                    <Circle x={-w * 0.23} y={-d * 0.04} radius={r1} {...st} />
                    <Circle x={-w * 0.23} y={-d * 0.04} radius={r1 * 0.35} {...stThin} />
                    <Circle x={w * 0.23} y={-d * 0.08} radius={r2} {...st} />
                    <Circle x={w * 0.23} y={d * 0.2} radius={r2 * 0.82} {...stThin} />
                    <Line points={[-w * 0.18, hd - 42, w * 0.18, hd - 42]} {...stThin} />
                </>
            );
        }

        case 'fridge': {
            const doorD = Math.min(75, d * 0.11);
            const isDouble = w >= 850;
            return (
                <>
                    <Line points={[-hw, -hd + 35, hw, -hd + 35]} {...stThin} dash={[25, 20]} />
                    <Line points={[-hw, hd - doorD, hw, hd - doorD]} {...st} />
                    {isDouble && <Line points={[0, hd - doorD, 0, hd]} {...st} />}
                </>
            );
        }

        case 'hood': {
            return (
                <>
                    <Circle x={0} y={-hd + Math.min(110, d * 0.25)} radius={Math.min(75, d * 0.16)} {...st} />
                    <Line points={[-hw + 40, hd - 40, -20, -hd + 40]} {...stThin} />
                    <Line points={[hw - 40, hd - 40, 20, -hd + 40]} {...stThin} />
                </>
            );
        }

        case 'shower': {
            const drainX = -hw + w * 0.22, drainY = -hd + d * 0.22;
            return (
                <>
                    {/* Vách kính cường lực 2 mặt ngoài */}
                    <Line points={[-hw, hd - 18, hw - 18, hd - 18, hw - 18, -hd]} {...stThin} />
                    {/* 4 đường dốc thoát sàn hội tụ về phễu thu */}
                    <Line points={[-hw, -hd, drainX, drainY]} {...stThin} />
                    <Line points={[hw, -hd, drainX, drainY]} {...stThin} />
                    <Line points={[hw, hd, drainX, drainY]} {...stThin} />
                    <Line points={[-hw, hd, drainX, drainY]} {...stThin} />
                    <Rect x={drainX - 35} y={drainY - 35} width={70} height={70} fill="#ffffff" {...st} />
                    {/* Bát sen tắm đứng */}
                    <Circle x={0} y={-hd + Math.min(140, d * 0.16)} radius={Math.min(75, w * 0.08)} {...st} />
                </>
            );
        }

        case 'glass_part': {
            return <Line points={[-hw, 0, hw, 0]} stroke="#0284c7" strokeWidth={sw * 2.2} listening={false} />;
        }

        case 'tub': {
            const px = w * 0.07, py = d * 0.11;
            const cr = Math.min(w, d) * 0.28;
            return (
                <>
                    <Rect x={-hw + px} y={-hd + py} width={w - px * 2} height={d - py * 2} cornerRadius={cr} fill="#ffffff" {...st} />
                    <Circle x={-hw + px + cr * 0.7} y={0} radius={28} {...st} />
                    <Line points={[-hw + 15, 0, -hw + px + 30, 0]} stroke={color} strokeWidth={sw * 2} listening={false} />
                </>
            );
        }

        case 'washer': {
            return (
                <>
                    <Line points={[-hw, -hd + d * 0.14, hw, -hd + d * 0.14]} {...stThin} />
                    <Circle x={0} y={d * 0.05} radius={Math.min(w, d) * 0.28} {...st} />
                    <Circle x={0} y={d * 0.05} radius={Math.min(w, d) * 0.19} {...stThin} />
                    <Arc x={0} y={hd} innerRadius={0} outerRadius={w * 0.24} angle={180} rotation={180} {...stThin} />
                </>
            );
        }

        case 'ac_wall': {
            return (
                <>
                    <Line points={[-hw + 40, hd - d * 0.28, hw - 40, hd - d * 0.28]} {...st} />
                    <Line points={[-w * 0.25, hd, -w * 0.3, hd + 90]} {...stThin} />
                    <Line points={[0, hd, 0, hd + 100]} {...stThin} />
                    <Line points={[w * 0.25, hd, w * 0.3, hd + 90]} {...stThin} />
                </>
            );
        }

        case 'ac_cass': {
            const p = w * 0.16;
            return (
                <>
                    <Rect x={-hw + p} y={-hd + p} width={w - p * 2} height={d - p * 2} {...st} />
                    <Line points={[-hw + p * 0.5, -hd + p * 0.5, hw - p * 0.5, -hd + p * 0.5]} {...stThin} />
                    <Line points={[-hw + p * 0.5, hd - p * 0.5, hw - p * 0.5, hd - p * 0.5]} {...stThin} />
                    <Line points={[-hw + p * 0.5, -hd + p * 0.5, -hw + p * 0.5, hd - p * 0.5]} {...stThin} />
                    <Line points={[hw - p * 0.5, -hd + p * 0.5, hw - p * 0.5, hd - p * 0.5]} {...stThin} />
                </>
            );
        }

        case 'curtain': {
            const waves = Math.max(6, Math.round(w / 160));
            const pts = [];
            for (let i = 0; i <= waves * 2; i++) {
                const x = -hw + (w / (waves * 2)) * i;
                const y = (i % 2 === 0 ? -1 : 1) * hd * 0.55;
                pts.push(x, y);
            }
            return <Line points={pts} tension={0.45} {...st} />;
        }

        case 'socket':
        case 'switch':
        case 'lamp':
        case 'cove': {
            if (sym === 'lamp') return <Circle x={0} y={0} radius={Math.min(hw, hd) * 0.65} {...st} />;
            if (sym === 'cove') return <Line points={[-hw, 0, hw, 0]} {...stThin} dash={[35, 25]} />;
            return <Circle x={0} y={0} radius={Math.max(22, Math.min(hw, hd) * 0.55)} fill={sym === 'switch' ? color : '#ffffff'} {...st} />;
        }

        case 'altar': {
            const p = Math.min(w, d) * 0.11;
            const scrollW = Math.min(80, w * 0.07);
            return (
                <>
                    <Rect x={-hw + p} y={-hd + p} width={w - p * 2} height={d - p * 2} {...st} />
                    {/* Hai tai cuốn thư bàn thờ Á Đông */}
                    <Rect x={-hw} y={-hd} width={scrollW} height={d} {...stThin} />
                    <Rect x={hw - scrollW} y={-hd} width={scrollW} height={d} {...stThin} />
                    {/* Bát hương chính giữa + vạch hướng mặt phong thuỷ */}
                    <Circle x={0} y={-d * 0.06} radius={Math.min(65, d * 0.12)} {...st} />
                    <Line points={[-w * 0.25, hd, w * 0.25, hd]} stroke={color} strokeWidth={sw * 2.6} listening={false} />
                </>
            );
        }

        case 'stairs': {
            const steps = Math.max(3, Math.round(d / 270));
            const lines = [];
            for (let i = 1; i < steps; i++) {
                const y = -hd + (d / steps) * i;
                lines.push(<Line key={i} points={[-hw, y, hw, y]} {...st} />);
            }
            lines.push(<Line key="ar" points={[0, hd - d * 0.08, 0, -hd + d * 0.08]} {...st} />);
            lines.push(<Line key="ah" points={[-w * 0.14, -hd + d * 0.2, 0, -hd + d * 0.08, w * 0.14, -hd + d * 0.2]} {...st} />);
            return <>{lines}</>;
        }

        default:
            return null;
    }
}

/**
 * 1 món nội thất trên mặt bằng.
 */
const FurnitureItem = ({ item, scale, isSelected, isEditing, onSelect, onChange, onRotate }) => {
    const inv = 1 / scale;
    const cat = catalogItem(item.kind);
    const w = item.w || cat?.w || 600;
    const d = item.d || cat?.d || 600;
    const sw = 1.15 * inv;
    const color = isEditing ? LINE_EDIT : isSelected ? LINE_SEL : LINE;
    const subColor = isEditing ? '#10b981' : isSelected ? '#60a5fa' : LINE_SUB;
    const lastTap = React.useRef(0);

    const tap = (e) => {
        e.cancelBubble = true;
        const now = e.evt?.timeStamp || Date.now();
        if (isSelected && now - lastTap.current < 320) {
            onRotate(item);
            lastTap.current = 0;
            return;
        }
        lastTap.current = now;
        onSelect(item.id);
    };

    const isSofaL = cat?.sym === 'sofaL';
    const isTable = cat?.sym === 'table';

    return (
        <Group
            x={item.x} y={item.y} rotation={item.rot || 0} draggable
            onClick={tap} onTap={tap}
            onDragStart={(e) => { e.cancelBubble = true; onSelect(item.id); }}
            onDragMove={(e) => onChange({ ...item, x: e.target.x(), y: e.target.y() }, false, e.target)}
            onDragEnd={(e) => onChange({ ...item, x: e.target.x(), y: e.target.y() }, true, e.target)}
            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; }}
            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
        >
            {/* Khung bao vật thể: với sofaL hoặc bàn ăn có ghế thò ra, chỉ vẽ khung bao đứt nét khi đang chọn/sửa */}
            <Rect
                x={-w / 2} y={-d / 2} width={w} height={d}
                fill={isSofaL || isTable ? 'rgba(0,0,0,0.001)' : itemFill(cat, isSelected, isEditing)}
                stroke={(isSofaL || isTable) && !isSelected && !isEditing ? 'transparent' : color}
                strokeWidth={isSelected || isEditing ? sw * 1.9 : sw * 1.35}
                dash={(isSofaL || isTable) && (isSelected || isEditing) ? [5 * inv, 4 * inv] : (cat?.mount === 'wall' || cat?.mount === 'ceiling' ? [6 * inv, 4 * inv] : undefined)}
                hitStrokeWidth={Math.max(12 * inv, 0)}
            />
            {/* Vạch lưng dày cho các món áp tường */}
            {cat?.back && !isSofaL && (
                <Line points={[-w / 2, -d / 2, w / 2, -d / 2]}
                    stroke={color} strokeWidth={sw * 2.8} listening={false} />
            )}
            <Symbol2D sym={cat?.sym} w={w} d={d} sw={sw} color={color} subColor={subColor} item={item} cat={cat} />
            {cat && w * scale > 28 && d * scale > 16 && (
                <Text
                    text={cat.name}
                    x={-w / 2} y={-5.5 * inv}
                    width={w} align="center"
                    rotation={-(item.rot || 0)}
                    fontSize={Math.min(10.5 * inv, Math.max(d, w) * 0.24)}
                    fontFamily={FONT} fontStyle="600"
                    fill={isEditing ? '#065f46' : isSelected ? '#1e40af' : '#334155'}
                    listening={false}
                />
            )}
        </Group>
    );
};

/**
 * 4 tay cầm Scale 4 chiều (Trái, Phải, Lưng, Trước) đặt trong toạ độ thế giới.
 * Kéo cạnh nào chỉ co giãn theo đúng hướng đó, giữ CỐ ĐỊNH cạnh đối diện!
 * Chạm nhẹ vào tay cầm sẽ mở NumPad để nhập số chính xác theo hướng vừa chạm.
 */
function FourWayScaleHandles({ item, scale, onScaleEdge, onTapEdge }) {
    const inv = 1 / scale;
    const cat = catalogItem(item.kind);
    const w = item.w || cat?.w || 600;
    const d = item.d || cat?.d || 600;
    const rot = item.rot || 0;
    const { right, front } = furnitureBasis(rot);

    const startItemRef = React.useRef(null);
    const movedRef = React.useRef(false);

    const edges = [
        { key: 'left', pos: { x: item.x - right.x * (w / 2), y: item.y - right.y * (w / 2) }, isHorizontalPill: false, cursor: 'ew-resize', arrow: [-3.5, 0, 2.5, -4, 2.5, 4] },
        { key: 'right', pos: { x: item.x + right.x * (w / 2), y: item.y + right.y * (w / 2) }, isHorizontalPill: false, cursor: 'ew-resize', arrow: [3.5, 0, -2.5, -4, -2.5, 4] },
        { key: 'back', pos: { x: item.x - front.x * (d / 2), y: item.y - front.y * (d / 2) }, isHorizontalPill: true, cursor: 'ns-resize', arrow: [0, -3.5, -4, 2.5, 4, 2.5] },
        { key: 'front', pos: { x: item.x + front.x * (d / 2), y: item.y + front.y * (d / 2) }, isHorizontalPill: true, cursor: 'ns-resize', arrow: [0, 3.5, -4, -2.5, 4, -2.5] },
    ];

    const labelPos = {
        x: item.x + front.x * (d / 2 + 28 * inv),
        y: item.y + front.y * (d / 2 + 28 * inv),
    };
    const dimTxt = `${Math.round(w)} × ${Math.round(d)}`;

    return (
        <Group>
            {/* Nhãn kích thước trực tiếp W × D cập nhật realtime khi kéo */}
            <Label x={labelPos.x} y={labelPos.y}
                offsetX={((dimTxt.length * 6.4 + 18) / 2) * inv}
                offsetY={12 * inv}
                listening={false}>
                <Tag fill="rgba(5,150,105,0.95)" cornerRadius={8 * inv} />
                <Text text={dimTxt} fill="#ffffff" fontSize={11 * inv} padding={5 * inv} fontFamily={FONT} fontStyle="700" />
            </Label>

            {edges.map(ed => {
                const pillW = (ed.isHorizontalPill ? 28 : 13) * inv;
                const pillH = (ed.isHorizontalPill ? 13 : 28) * inv;
                return (
                    <Group
                        key={ed.key}
                        name="handle"
                        x={ed.pos.x}
                        y={ed.pos.y}
                        rotation={rot}
                        draggable
                        onDragStart={(e) => {
                            e.cancelBubble = true;
                            startItemRef.current = { ...item, w, d };
                            movedRef.current = false;
                        }}
                        onDragMove={(e) => {
                            e.cancelBubble = true;
                            movedRef.current = true;
                            const stage = e.target.getStage();
                            const ptr = stage.getPointerPosition();
                            if (!ptr || !startItemRef.current) return;
                            const worldPt = {
                                x: (ptr.x - stage.x()) / stage.scaleX(),
                                y: (ptr.y - stage.y()) / stage.scaleY(),
                            };
                            const next = onScaleEdge(startItemRef.current, ed.key, worldPt, false);
                            if (next) {
                                const nb = furnitureBasis(next.rot || 0);
                                const nw = next.w || w, nd = next.d || d;
                                const hx = ed.key === 'left' ? next.x - nb.right.x * (nw / 2)
                                    : ed.key === 'right' ? next.x + nb.right.x * (nw / 2)
                                    : ed.key === 'back' ? next.x - nb.front.x * (nd / 2)
                                    : next.x + nb.front.x * (nd / 2);
                                const hy = ed.key === 'left' ? next.y - nb.right.y * (nw / 2)
                                    : ed.key === 'right' ? next.y + nb.right.y * (nw / 2)
                                    : ed.key === 'back' ? next.y - nb.front.y * (nd / 2)
                                    : next.y + nb.front.y * (nd / 2);
                                e.target.x(hx);
                                e.target.y(hy);
                            }
                        }}
                        onDragEnd={(e) => {
                            e.cancelBubble = true;
                            const stage = e.target.getStage();
                            const ptr = stage?.getPointerPosition();
                            if (ptr && startItemRef.current && movedRef.current) {
                                const worldPt = {
                                    x: (ptr.x - stage.x()) / stage.scaleX(),
                                    y: (ptr.y - stage.y()) / stage.scaleY(),
                                };
                                onScaleEdge(startItemRef.current, ed.key, worldPt, true);
                            }
                            startItemRef.current = null;
                        }}
                        onClick={(e) => {
                            e.cancelBubble = true;
                            if (!movedRef.current) onTapEdge?.(item, ed.key);
                        }}
                        onTap={(e) => {
                            e.cancelBubble = true;
                            if (!movedRef.current) onTapEdge?.(item, ed.key);
                        }}
                        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = ed.cursor; }}
                        onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                    >
                        {/* Vùng cảm ứng rộng cho ngón tay điện thoại / iPad */}
                        <Circle name="handle" x={0} y={0} radius={22 * inv} fill="rgba(0,0,0,0.001)" />
                        <Rect
                            name="handle"
                            x={-pillW / 2} y={-pillH / 2}
                            width={pillW} height={pillH}
                            cornerRadius={6.5 * inv}
                            fill="#059669"
                            stroke="#ffffff"
                            strokeWidth={2 * inv}
                        />
                        <Line
                            points={ed.arrow.map(v => v * inv)}
                            closed fill="#ffffff" listening={false}
                        />
                    </Group>
                );
            })}
        </Group>
    );
}

/**
 * Đường gióng Magnet trực quan khi kéo đồ hoặc kéo cạnh scale 4 chiều.
 */
function SnapGuidesOverlay({ guides, scale }) {
    if (!guides?.length) return null;
    const inv = 1 / scale;
    return (
        <Group listening={false}>
            {guides.map((g, i) => {
                const col = g.kind === 'wall' ? '#2563eb' : g.kind === 'furn' ? '#ec4899' : '#f59e0b';
                return (
                    <React.Fragment key={i}>
                        <Line
                            points={[g.x1, g.y1, g.x2, g.y2]}
                            stroke={col}
                            strokeWidth={1.8 * inv}
                            dash={g.kind === 'align' ? [6 * inv, 4 * inv] : [9 * inv, 4 * inv]}
                        />
                        <Circle x={g.x1} y={g.y1} radius={3.2 * inv} fill={col} />
                        <Circle x={g.x2} y={g.y2} radius={3.2 * inv} fill={col} />
                    </React.Fragment>
                );
            })}
        </Group>
    );
}

const FurnitureLayer = ({
    items, scale, sel, editItemId, snapGuides, listening,
    onSelect, onChange, onRotate, onScaleEdge, onTapEdge,
}) => {
    const sorted = React.useMemo(
        () => [...(items || [])].sort((a, b) => layerOrder(a) - layerOrder(b)),
        [items]
    );
    const editingItem = editItemId ? (items || []).find(it => it.id === editItemId) : null;

    return (
        <Group listening={listening}>
            {sorted.map(it => (
                <FurnitureItem
                    key={it.id}
                    item={it}
                    scale={scale}
                    isSelected={sel?.kind === 'furniture' && sel.id === it.id}
                    isEditing={editItemId === it.id}
                    onSelect={onSelect}
                    onChange={onChange}
                    onRotate={onRotate}
                />
            ))}
            <SnapGuidesOverlay guides={snapGuides} scale={scale} />
            {editingItem && (
                <FourWayScaleHandles
                    item={editingItem}
                    scale={scale}
                    onScaleEdge={onScaleEdge}
                    onTapEdge={onTapEdge}
                />
            )}
        </Group>
    );
};

export default FurnitureLayer;
