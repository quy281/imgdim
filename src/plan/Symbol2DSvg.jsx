import React from 'react';
import { parseSvgSymbol } from '../lib/svgSymbol';

/**
 * Thumbnail SVG top-down 2D nét mảnh kiến trúc cho Thư viện mẫu (nhẹ, sắc nét mọi DPI).
 */
export default function Symbol2DSvg({ cat, size = 68 }) {
    const rawW = Number(cat?.w) || 1000;
    const rawD = Number(cat?.d) || 600;
    const maxDim = Math.max(rawW, rawD, 1);
    const box = 72;
    const w = Math.max(20, (rawW / maxDim) * box);
    const d = Math.max(16, (rawD / maxDim) * box);
    const hw = w / 2;
    const hd = d / 2;

    const sym = cat?.sym || 'cab';
    const stroke = '#1e293b';
    const sub = '#64748b';
    const sw = 1.45;
    const swThin = 1.0;

    if (cat?.svg2d) {
        const parsed = React.useMemo(() => parseSvgSymbol(cat.svg2d), [cat.svg2d]);
        if (parsed && parsed.elements.length > 0) {
            const [vx, vy, vw, vh] = parsed.viewBox || [0, 0, 100, 100];
            const sx = w / (vw || 1);
            const sy = d / (vh || 1);
            const invS = 1 / Math.max(sx, sy, 0.001);
            return (
                <svg width={size} height={size} viewBox="-46 -46 92 92" fill="none">
                    <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke="#e2e8f0" strokeWidth="0.9" />
                    <g transform={`translate(${-hw - vx * sx}, ${-hd - vy * sy}) scale(${sx}, ${sy})`}>
                        {parsed.elements.map((el, i) => {
                            const common = {
                                fill: el.fill && el.fill !== 'none' ? el.fill : 'none',
                                stroke: el.stroke && el.stroke !== 'none' ? (el.stroke === 'currentColor' ? stroke : el.stroke) : stroke,
                                strokeWidth: (el.strokeWidth || sw) * invS,
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                            };
                            if (el.type === 'path') return <path key={i} d={el.d} {...common} />;
                            if (el.type === 'rect') return <rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx || 0} {...common} />;
                            if (el.type === 'circle') return <circle key={i} cx={el.cx} cy={el.cy} r={el.r} {...common} />;
                            if (el.type === 'ellipse') return <ellipse key={i} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...common} />;
                            if (el.type === 'line') return <line key={i} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} />;
                            if (el.type === 'polyline') {
                                return <polyline key={i} points={el.points.map(p => `${p.x},${p.y}`).join(' ')} {...common} />;
                            }
                            if (el.type === 'polygon') {
                                return <polygon key={i} points={el.points.map(p => `${p.x},${p.y}`).join(' ')} {...common} />;
                            }
                            return null;
                        })}
                    </g>
                </svg>
            );
        }
    }

    const renderBody = () => {
        switch (sym) {
            case 'bed': {
                const hbD = Math.max(3.5, d * 0.08);
                const pD = Math.min(13, d * 0.22);
                const gap = 3;
                const twoP = rawW > 1300;
                const pw = twoP ? (w - gap * 3) / 2 : w - gap * 2;
                const sY = -hd + hbD + pD + gap * 1.4;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw} y={-hd} width={w} height={hbD} fill="#e2e8f0" stroke={stroke} strokeWidth={sw} />
                        {twoP ? (
                            <>
                                <rect x={-hw + gap} y={-hd + hbD + 2} width={pw} height={pD} rx="2.5" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                                <rect x={gap / 2} y={-hd + hbD + 2} width={pw} height={pD} rx="2.5" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                            </>
                        ) : (
                            <rect x={-hw + gap} y={-hd + hbD + 2} width={pw} height={pD} rx="2.5" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                        )}
                        <line x1={-hw} y1={sY} x2={hw} y2={sY} stroke={stroke} strokeWidth={sw} />
                        <polyline points={`${-hw},${sY + 5} ${hw - w * 0.2},${sY + 5} ${hw},${sY}`} stroke={stroke} strokeWidth={swThin} fill="none" />
                        <line x1={-hw + 2} y1={hd - d * 0.14} x2={hw - 2} y2={hd - d * 0.14} stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'headboard': {
                const n = Math.max(4, Math.round(w / 10));
                return (
                    <>
                        <rect x={-hw} y={-Math.max(4, hd)} width={w} height={Math.max(8, d)} fill="#f8fafc" stroke={stroke} strokeWidth={sw} />
                        {Array.from({ length: n - 1 }, (_, i) => {
                            const x = -hw + (w / n) * (i + 1);
                            return <line key={i} x1={x} y1={-Math.max(4, hd)} x2={x} y2={Math.max(4, hd)} stroke={sub} strokeWidth={swThin} />;
                        })}
                    </>
                );
            }
            case 'wardrobe':
            case 'wardrobe_slide': {
                const isSlide = sym === 'wardrobe_slide';
                const nBays = isSlide ? 2 : 3;
                const dBand = Math.max(3, d * 0.14);
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw + 2} y1={-dBand / 2} x2={hw - 2} y2={-dBand / 2} stroke={sub} strokeWidth={swThin} />
                        {Array.from({ length: nBays - 1 }, (_, i) => {
                            const x = -hw + (w / nBays) * (i + 1);
                            return <line key={i} x1={x} y1={-hd} x2={x} y2={hd - dBand} stroke={stroke} strokeWidth={swThin} />;
                        })}
                        <line x1={-hw} y1={hd - dBand} x2={hw} y2={hd - dBand} stroke={stroke} strokeWidth={sw} />
                        {isSlide && (
                            <>
                                <line x1={-hw + 2} y1={hd - dBand * 0.6} x2={2} y2={hd - dBand * 0.6} stroke={stroke} strokeWidth={sw} />
                                <line x1={-2} y1={hd - dBand * 0.25} x2={hw - 2} y2={hd - dBand * 0.25} stroke={stroke} strokeWidth={sw} />
                            </>
                        )}
                    </>
                );
            }
            case 'cab':
            case 'cab_wall':
            case 'kitchen_base':
            case 'shoe_bench': {
                const isWall = sym === 'cab_wall';
                const divs = Math.max(2, Math.round(w / 18));
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} strokeDasharray={isWall ? '4,3' : undefined} />
                        {Array.from({ length: divs - 1 }, (_, i) => {
                            const x = -hw + (w / divs) * (i + 1);
                            return <line key={i} x1={x} y1={-hd} x2={x} y2={hd} stroke={sub} strokeWidth={swThin} strokeDasharray="3,2" />;
                        })}
                        {isWall ? (
                            <line x1={-hw} y1={-hd} x2={hw} y2={hd} stroke={sub} strokeWidth={swThin} strokeDasharray="3,2" />
                        ) : (
                            <line x1={-hw} y1={hd - 3} x2={hw} y2={hd - 3} stroke={stroke} strokeWidth={swThin} />
                        )}
                    </>
                );
            }
            case 'island': {
                const stR = 4.2;
                const nS = Math.max(2, Math.round(w / 20));
                return (
                    <>
                        {Array.from({ length: nS }, (_, i) => {
                            const cx = -hw * 0.72 + ((w * 0.72) / Math.max(1, nS - 1)) * i;
                            return <circle key={i} cx={nS === 1 ? 0 : cx} cy={hd + stR * 0.7} r={stR} fill="#ffffff" stroke={stroke} strokeWidth={swThin} />;
                        })}
                        <rect x={-hw} y={-hd} width={w} height={d} rx="2" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw} y1={hd - d * 0.28} x2={hw} y2={hd - d * 0.28} stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'sofa': {
                const arm = Math.max(5, w * 0.12);
                const back = Math.max(5, d * 0.25);
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw} y={-hd} width={w} height={back} rx="2.5" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={-hw} y={-hd + back * 0.6} width={arm} height={d - back * 0.6} rx="2.5" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={hw - arm} y={-hd + back * 0.6} width={arm} height={d - back * 0.6} rx="2.5" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <line x1={-hw + arm + (w - arm * 2) / 3} y1={-hd + back} x2={-hw + arm + (w - arm * 2) / 3} y2={hd} stroke={stroke} strokeWidth={swThin} />
                        <line x1={-hw + arm + ((w - arm * 2) * 2) / 3} y1={-hd + back} x2={-hw + arm + ((w - arm * 2) * 2) / 3} y2={hd} stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'sofaL': {
                const mainD = d * 0.52;
                const chW = w * 0.37;
                const chX = hw - chW;
                const arm = w * 0.09;
                const back = d * 0.14;
                return (
                    <>
                        <polygon points={`${-hw},${-hd} ${hw},${-hd} ${hw},${hd} ${chX},${hd} ${chX},${-hd + mainD} ${-hw},${-hd + mainD}`} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw} y={-hd} width={w} height={back} rx="2" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={-hw} y={-hd + back * 0.6} width={arm} height={mainD - back * 0.6} rx="2" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={hw - arm} y={-hd + back * 0.6} width={arm} height={d * 0.55} rx="2" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <line x1={chX} y1={-hd + back} x2={chX} y2={-hd + mainD} stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'armchair': {
                const arm = w * 0.18;
                const back = d * 0.24;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} rx="4" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw} y={-hd} width={w} height={back} rx="3" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={-hw} y={-hd + back * 0.5} width={arm} height={d - back * 0.5} rx="3" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                        <rect x={hw - arm} y={-hd + back * 0.5} width={arm} height={d - back * 0.5} rx="3" fill="#f1f5f9" stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'table': {
                const cw = Math.min(13, w * 0.24);
                const cd = 7.5;
                const nSide = rawW >= 1900 ? 3 : 2;
                return (
                    <>
                        {Array.from({ length: nSide }, (_, i) => {
                            const cx = -hw * 0.62 + ((w * 0.62) / Math.max(1, nSide - 1)) * i;
                            return (
                                <g key={i}>
                                    <rect x={cx - cw / 2} y={-hd - cd * 0.72} width={cw} height={cd} rx="2" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                                    <rect x={cx - cw / 2} y={hd - cd * 0.28} width={cw} height={cd} rx="2" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                                </g>
                            );
                        })}
                        <rect x={-hw} y={-hd} width={w} height={d} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                    </>
                );
            }
            case 'coffee': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw + 4} y={-hd + 4} width={w - 8} height={d - 8} rx="2" fill="none" stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'rug': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#f1efe9" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw + 4} y={-hd + 4} width={w - 8} height={d - 8} fill="none" stroke={sub} strokeWidth={swThin} strokeDasharray="4,3" />
                    </>
                );
            }
            case 'desk':
            case 'dresser': {
                return (
                    <>
                        <circle cx={0} cy={hd + 4} r="7" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-w * 0.2} y={-hd + 3} width={w * 0.4} height={d * 0.32} rx="1.5" fill="none" stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'nightstand':
            case 'bench':
            case 'tvstand': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw + 3} y1={hd - 3} x2={hw - 3} y2={hd - 3} stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'tv': {
                return (
                    <>
                        <line x1={-hw} y1="0" x2={hw} y2="0" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
                        <polygon points="-7,-8 7,-8 4,0 -4,0" fill="#e2e8f0" stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'partition': {
                const cnt = 6;
                return (
                    <>
                        {Array.from({ length: cnt }, (_, i) => {
                            const x = -hw + (w / cnt) * (i + 0.5);
                            return <rect key={i} x={x - 2} y={-hd} width="4" height={d} fill="#e2e8f0" stroke={stroke} strokeWidth={swThin} />;
                        })}
                    </>
                );
            }
            case 'plant': {
                const r = Math.min(hw, hd) * 0.85;
                return (
                    <>
                        <circle cx="0" cy="0" r={r} fill="#ecfdf5" stroke={stroke} strokeWidth={sw} />
                        {[0, 60, 120, 180, 240, 300].map(deg => (
                            <ellipse
                                key={deg}
                                cx={Math.cos((deg * Math.PI) / 180) * r * 0.35}
                                cy={Math.sin((deg * Math.PI) / 180) * r * 0.35}
                                rx={r * 0.44}
                                ry={r * 0.17}
                                transform={`rotate(${deg} ${Math.cos((deg * Math.PI) / 180) * r * 0.35} ${Math.sin((deg * Math.PI) / 180) * r * 0.35})`}
                                fill="rgba(117,147,72,0.32)"
                                stroke="#4d7c0f"
                                strokeWidth={swThin}
                            />
                        ))}
                    </>
                );
            }
            case 'toilet': {
                const tankD = d * 0.28;
                const cy = -hd + tankD + (d - tankD) * 0.52;
                return (
                    <>
                        <rect x={-hw * 0.9} y={-hd} width={w * 0.9} height={tankD} rx="2" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <ellipse cx="0" cy={cy} rx={hw * 0.84} ry={(d - tankD) * 0.46} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <ellipse cx="0" cy={cy + 1.5} rx={hw * 0.55} ry={(d - tankD) * 0.3} fill="none" stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'basin': {
                const two = rawW > 900;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        {(two ? [-w * 0.25, w * 0.25] : [0]).map((cx, i) => (
                            <g key={i}>
                                <ellipse cx={cx} cy={2} rx={two ? w * 0.17 : w * 0.33} ry={d * 0.3} fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                                <line x1={cx} y1={-hd + 3} x2={cx} y2={-hd + d * 0.35} stroke={stroke} strokeWidth={sw} />
                            </g>
                        ))}
                    </>
                );
            }
            case 'sink':
            case 'sink2': {
                const hasDr = sym === 'sink2';
                const workW = hasDr ? w * 0.66 : w;
                const bW = (workW - 10) / 2;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw + 3} y={-hd + 4} width={bW} height={d - 8} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                        <rect x={-hw + 7 + bW} y={-hd + 4} width={bW} height={d - 8} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                        {hasDr && Array.from({ length: 4 }, (_, i) => (
                            <line key={i} x1={-hw + workW + 3} y1={-hd + 6 + i * 5} x2={hw - 3} y2={-hd + 6 + i * 5} stroke={sub} strokeWidth={swThin} />
                        ))}
                    </>
                );
            }
            case 'hob': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} rx="3" fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <circle cx={-w * 0.22} cy="0" r={Math.min(w, d) * 0.2} fill="none" stroke={stroke} strokeWidth={sw} />
                        <circle cx={w * 0.22} cy="-2" r={Math.min(w, d) * 0.16} fill="none" stroke={stroke} strokeWidth={sw} />
                    </>
                );
            }
            case 'fridge': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw} y1={hd - 5} x2={hw} y2={hd - 5} stroke={stroke} strokeWidth={sw} />
                        {rawW >= 850 && <line x1="0" y1={hd - 5} x2="0" y2={hd} stroke={stroke} strokeWidth={sw} />}
                    </>
                );
            }
            case 'hood': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} strokeDasharray="4,3" />
                        <circle cx="0" cy={-hd + 7} r="4.5" fill="none" stroke={stroke} strokeWidth={swThin} />
                        <line x1={-hw + 4} y1={hd - 4} x2="-3" y2={-hd + 5} stroke={sub} strokeWidth={swThin} />
                        <line x1={hw - 4} y1={hd - 4} x2="3" y2={-hd + 5} stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'shower': {
                const dx = -hw + w * 0.25, dy = -hd + d * 0.25;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw} y1={-hd} x2={dx} y2={dy} stroke={sub} strokeWidth={swThin} />
                        <line x1={hw} y1={-hd} x2={dx} y2={dy} stroke={sub} strokeWidth={swThin} />
                        <line x1={hw} y1={hd} x2={dx} y2={dy} stroke={sub} strokeWidth={swThin} />
                        <line x1={-hw} y1={hd} x2={dx} y2={dy} stroke={sub} strokeWidth={swThin} />
                        <rect x={dx - 3} y={dy - 3} width="6" height="6" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'glass_part': {
                return <line x1={-hw} y1="0" x2={hw} y2="0" stroke="#0284c7" strokeWidth="3" strokeLinecap="round" />;
            }
            case 'tub': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw + 4} y={-hd + 4} width={w - 8} height={d - 8} rx="8" fill="#ffffff" stroke={stroke} strokeWidth={swThin} />
                        <circle cx={-hw + 11} cy="0" r="2.2" fill="none" stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'washer': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <circle cx="0" cy="2" r={Math.min(hw, hd) * 0.56} fill="none" stroke={stroke} strokeWidth={sw} />
                        <circle cx="0" cy="2" r={Math.min(hw, hd) * 0.36} fill="none" stroke={sub} strokeWidth={swThin} />
                    </>
                );
            }
            case 'ac_wall':
            case 'ac_cass': {
                if (sym === 'ac_cass') {
                    return (
                        <>
                            <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} strokeDasharray="4,3" />
                            <rect x={-hw + 9} y={-hd + 9} width={w - 18} height={d - 18} fill="none" stroke={sub} strokeWidth={swThin} />
                        </>
                    );
                }
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} strokeDasharray="4,3" />
                        <line x1={-hw + 4} y1={hd - 3} x2={hw - 4} y2={hd - 3} stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'curtain': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#f8fafc" stroke={sub} strokeWidth={swThin} strokeDasharray="3,2" />
                        <path d={`M ${-hw} 0 Q ${-hw + w * 0.25} ${-hd}, 0 0 T ${hw} 0`} stroke={stroke} strokeWidth={sw} fill="none" />
                    </>
                );
            }
            case 'socket':
            case 'switch':
            case 'lamp':
            case 'cove': {
                if (sym === 'cove') return <line x1={-hw} y1="0" x2={hw} y2="0" stroke={stroke} strokeWidth={sw} strokeDasharray="5,3" />;
                return (
                    <circle cx="0" cy="0" r="10" fill={sym === 'switch' ? stroke : '#ffffff'} stroke={stroke} strokeWidth={sw} />
                );
            }
            case 'altar': {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <rect x={-hw + 5} y={-hd + 4} width={w - 10} height={d - 8} fill="none" stroke={sub} strokeWidth={swThin} />
                        <circle cx="0" cy="0" r="4" fill="none" stroke={stroke} strokeWidth={swThin} />
                    </>
                );
            }
            case 'stairs': {
                const n = 7;
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        {Array.from({ length: n - 1 }, (_, i) => {
                            const y = -hd + (d / n) * (i + 1);
                            return <line key={i} x1={-hw} y1={y} x2={hw} y2={y} stroke={stroke} strokeWidth={swThin} />;
                        })}
                        <line x1="0" y1={hd - 4} x2="0" y2={-hd + 4} stroke={stroke} strokeWidth={sw} />
                        <polyline points={`${-5},${-hd + 10} 0,${-hd + 4} 5,${-hd + 10}`} fill="none" stroke={stroke} strokeWidth={sw} />
                    </>
                );
            }
            default: {
                return (
                    <>
                        <rect x={-hw} y={-hd} width={w} height={d} fill="#ffffff" stroke={stroke} strokeWidth={sw} />
                        <line x1={-hw} y1={-hd} x2={hw} y2={hd} stroke={sub} strokeWidth={swThin} strokeDasharray="3,2" />
                    </>
                );
            }
        }
    };

    return (
        <svg width={size} height={size} viewBox="-46 -46 92 92" fill="none">
            {renderBody()}
        </svg>
    );
}
