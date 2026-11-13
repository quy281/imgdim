// Thư viện mô hình 3D nội thất chuẩn phong cách SketchUp (màu kiến trúc + đường nét cạnh sắc sảo).
// Mọi kích thước tính bằng mm; tâm đáy món đồ đặt tại (0, 0, 0) trong Group của món:
//   +X = sang phải (theo chiều rộng w: [-w/2 .. +w/2])
//   +Y = hướng lên trần (theo chiều cao h: [0 .. h])
//   +Z = hướng từ lưng (-d/2) ra mặt trước (+d/2) vào trong phòng.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getItemGlbSource } from './furnitureCatalog';

const EDGE_MAT = new THREE.LineBasicMaterial({
    color: 0x334155,
    transparent: true,
    opacity: 0.45,
});

const HEX_MAT_CACHE = new Map();
const GLTF_TEMPLATE_CACHE = new Map();
const gltfLoader = typeof window !== 'undefined' ? new GLTFLoader() : null;

export function resolveMat(spec, fallback) {
    if (!spec) return fallback;
    if (MATS[spec]) return MATS[spec];
    if (typeof spec === 'string' && /^#[0-9a-f]{3,8}$/i.test(spec.trim())) {
        const key = spec.trim().toLowerCase();
        if (!HEX_MAT_CACHE.has(key)) {
            HEX_MAT_CACHE.set(key, new THREE.MeshStandardMaterial({
                color: new THREE.Color(key),
                roughness: 0.62,
                metalness: 0.06,
            }));
        }
        return HEX_MAT_CACHE.get(key);
    }
    return fallback;
}

export const MATS = {
    oak: new THREE.MeshStandardMaterial({ color: 0xc99a6b, roughness: 0.72, metalness: 0.04 }),
    oakDark: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.68, metalness: 0.06 }),
    redwood: new THREE.MeshStandardMaterial({ color: 0x6e2c1b, roughness: 0.58, metalness: 0.08 }),
    whiteMatte: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.62, metalness: 0.02 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.78, metalness: 0.01 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.35, metalness: 0.08 }),
    fabricWarm: new THREE.MeshStandardMaterial({ color: 0xd6d1c7, roughness: 0.88, metalness: 0.0 }),
    fabricSlate: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.86, metalness: 0.0 }),
    fabricBlue: new THREE.MeshStandardMaterial({ color: 0x476885, roughness: 0.85, metalness: 0.0 }),
    duvet: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85, metalness: 0.0 }),
    pillow: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.08 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.32, metalness: 0.62 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.38, metalness: 0.45 }),
    darkGlass: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.35 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.08, metalness: 0.75 }),
    clearGlass: new THREE.MeshStandardMaterial({
        color: 0xbae6fd, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false,
    }),
    sheer: new THREE.MeshStandardMaterial({
        color: 0xf8fafc, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.58, side: THREE.DoubleSide,
    }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.75, metalness: 0.02 }),
    leafLight: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.75, metalness: 0.02 }),
    rug: new THREE.MeshStandardMaterial({ color: 0xe7dfd3, roughness: 0.95, metalness: 0.0 }),
    rugBorder: new THREE.MeshStandardMaterial({ color: 0xcbbfae, roughness: 0.95, metalness: 0.0 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.32, metalness: 0.7 }),
};

/** Helper tạo khối hộp có viền cạnh SketchUp, toạ độ tâm (cx, cy, cz) */
function addBox(group, sx, sy, sz, mat, cx = 0, cy = sy / 2, cz = 0, withEdges = true) {
    if (sx <= 1 || sy <= 1 || sz <= 1) return null;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (withEdges) {
        const edges = new THREE.EdgesGeometry(geo, 22);
        const line = new THREE.LineSegments(edges, EDGE_MAT);
        mesh.add(line);
    }
    group.add(mesh);
    return mesh;
}

/** Helper tạo hình trụ đứng */
function addCyl(group, rTop, rBot, height, mat, cx = 0, cy = height / 2, cz = 0, segs = 18) {
    const geo = new THREE.CylinderGeometry(rTop, rBot, height, segs);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
}

/** Tạo một chiếc ghế ăn / ghế bàn làm việc nhỏ gọn */
function addDiningChair(parent, cx, cz, rotY, seatW = 420, seatD = 420, seatH = 450, totalH = 840) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rotY;
    const legT = 32;
    const lx = seatW / 2 - legT / 2 - 12;
    const lz = seatD / 2 - legT / 2 - 12;
    for (const [sx, sz] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) {
        addBox(g, legT, seatH - 35, legT, MATS.oakDark, sx, (seatH - 35) / 2, sz, false);
    }
    // Đệm ghế + lưng tựa
    addBox(g, seatW, 45, seatD, MATS.fabricWarm, 0, seatH - 22, 0);
    addBox(g, seatW - 10, totalH - seatH, 38, MATS.oak, 0, seatH + (totalH - seatH) / 2, -seatD / 2 + 22);
    parent.add(g);
}

const PRIMARY_MATS = new Set([
    MATS.oak, MATS.whiteMatte, MATS.fabricSlate, MATS.fabricWarm,
    MATS.fabricBlue, MATS.redwood, MATS.stone, MATS.ceramic, MATS.rug,
]);
const SECONDARY_MATS = new Set([
    MATS.oakDark, MATS.cream, MATS.duvet, MATS.rugBorder, MATS.graphite,
]);
const ACCENT_MATS = new Set([
    MATS.steel, MATS.brass, MATS.pillow, MATS.mirror, MATS.darkGlass,
]);

function applyMaterialOverrides(group, cat) {
    if (!cat?.matPrimary && !cat?.matSecondary && !cat?.matAccent) return;
    group.traverse((obj) => {
        if (!obj.isMesh) return;
        const m = obj.material;
        if (cat.matPrimary && PRIMARY_MATS.has(m)) {
            obj.material = resolveMat(cat.matPrimary, m);
        } else if (cat.matSecondary && SECONDARY_MATS.has(m)) {
            obj.material = resolveMat(cat.matSecondary, m);
        } else if (cat.matAccent && ACCENT_MATS.has(m)) {
            obj.material = resolveMat(cat.matAccent, m);
        }
    });
}

function fitGltfCloneToBounds(template, w, h, d, cat) {
    const clone = template.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const sx = size.x > 1e-4 ? w / size.x : 1;
    const sy = size.y > 1e-4 ? h / size.y : 1;
    const sz = size.z > 1e-4 ? d / size.z : 1;

    const wrapper = new THREE.Group();
    clone.scale.set(sx, sy, sz);
    clone.position.set(-center.x * sx, -box.min.y * sy, -center.z * sz);
    clone.traverse((obj) => {
        if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (cat?.matPrimary && obj.material && !obj.material.transparent) {
                // Giữ texture gốc nếu model có map; chỉ nhuộm nếu không có texture map
                if (!obj.material.map) {
                    const mat = resolveMat(cat.matPrimary, null);
                    if (mat) obj.material = mat;
                }
            }
        }
    });
    wrapper.add(clone);
    return wrapper;
}

function loadGltfTemplate(src) {
    if (GLTF_TEMPLATE_CACHE.has(src)) return GLTF_TEMPLATE_CACHE.get(src);
    if (!gltfLoader) return Promise.reject(new Error('GLTFLoader unavailable'));
    const p = new Promise((resolve, reject) => {
        gltfLoader.load(
            src,
            (gltf) => resolve(gltf.scene || gltf.scenes?.[0]),
            undefined,
            (err) => {
                GLTF_TEMPLATE_CACHE.delete(src);
                reject(err);
            }
        );
    });
    GLTF_TEMPLATE_CACHE.set(src, p);
    return p;
}

/**
 * Xây dựng `THREE.Group` cho 1 món nội thất theo kích thước thực tế `(w, d, h)` và chiều cao trần `roomH`.
 * Hỗ trợ override chất liệu (`matPrimary`/`matSecondary`/`matAccent`), `sym3d` và file `.glb`/`.gltf` tùy biến.
 */
export function buildFurniture3D(item, cat, roomH = 3200, opts = {}) {
    const g = new THREE.Group();
    const w = Math.max(60, item.w || cat?.w || 600);
    const d = Math.max(30, item.d || cat?.d || 600);
    const h = Math.max(12, item.h ?? cat?.h ?? 800);
    const hw = w / 2, hd = d / 2;

    const glbSrc = cat?.glbUrl || cat?.glbData || (item?.kind ? getItemGlbSource(item.kind) : null);
    if (glbSrc && gltfLoader) {
        const placeholder = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshBasicMaterial({ color: 0x94a3b8, wireframe: true, transparent: true, opacity: 0.35 })
        );
        placeholder.position.set(0, h / 2, 0);
        g.add(placeholder);

        loadGltfTemplate(glbSrc).then((scene) => {
            if (!scene) return;
            g.remove(placeholder);
            placeholder.geometry.dispose();
            placeholder.material.dispose();
            g.add(fitGltfCloneToBounds(scene, w, h, d, cat));
            opts?.onLoaded?.();
        }).catch(() => {
            // Giữ khung chờ hoặc fallback nếu URL hỏng
        });
        return g;
    }

    const sym = cat?.sym3d || cat?.sym || 'box';

    switch (sym) {
        case 'bed': {
            const hbT = Math.min(85, d * 0.05);
            const hbH = Math.max(h + 520, 980);
            const frameH = Math.min(260, h * 0.58);
            const matH = Math.max(160, h - frameH + 30);
            // Đầu giường bọc nệm + viền gỗ
            addBox(g, w, hbH, hbT, MATS.oak, 0, hbH / 2, -hd + hbT / 2);
            addBox(g, w - 80, hbH - 140, 28, MATS.fabricWarm, 0, hbH * 0.56, -hd + hbT + 10);
            // Khung giường gỗ + chân thụt
            addBox(g, w - 120, 70, d - hbT - 100, MATS.oakDark, 0, 35, hbT / 2);
            addBox(g, w, frameH - 70, d - hbT, MATS.oak, 0, 70 + (frameH - 70) / 2, hbT / 2);
            // Đệm trắng
            const matW = w - 50, matD = d - hbT - 40;
            const matTop = frameH + matH;
            addBox(g, matW, matH, matD, MATS.whiteMatte, 0, frameH + matH / 2, hbT / 2);
            // Chăn gấp + tấm trải chân giường
            const duvD = matD * 0.68;
            addBox(g, matW + 16, 36, duvD, MATS.duvet, 0, matTop + 14, hd - 25 - duvD / 2);
            addBox(g, matW + 22, 42, Math.min(340, matD * 0.22), MATS.fabricBlue, 0, matTop + 18, hd - 210);
            // Gối đầu giường
            const two = w > 1300;
            const pilW = two ? (matW - 140) / 2 : matW - 160;
            const pilD = Math.min(310, matD * 0.18);
            const pilZ = -hd + hbT + 45 + pilD / 2;
            if (two) {
                addBox(g, pilW, 110, pilD, MATS.pillow, -matW / 4 - 10, matTop + 48, pilZ);
                addBox(g, pilW, 110, pilD, MATS.pillow, matW / 4 + 10, matTop + 48, pilZ);
            } else {
                addBox(g, pilW, 110, pilD, MATS.pillow, 0, matTop + 48, pilZ);
            }
            break;
        }

        case 'headboard': {
            addBox(g, w, h, d * 0.55, MATS.oak, 0, h / 2, -d * 0.2);
            const n = Math.max(3, Math.round(w / 380));
            const pw = (w - 40) / n;
            for (let i = 0; i < n; i++) {
                addBox(g, pw - 10, h - 50, d * 0.5, MATS.fabricWarm, -hw + 20 + pw * (i + 0.5), h / 2, d * 0.15);
            }
            break;
        }

        case 'wardrobe':
        case 'wardrobe_slide': {
            const plinth = 80;
            const doorT = 22;
            const bodyD = Math.max(60, d - doorT * 1.4);
            addBox(g, w - 40, plinth, bodyD - 40, MATS.oakDark, 0, plinth / 2, -15);
            addBox(g, w, h - plinth, bodyD, MATS.oak, 0, plinth + (h - plinth) / 2, -doorT * 0.6);

            const isSlide = sym === 'wardrobe_slide';
            const nDoors = Math.max(2, Math.round(w / (isSlide ? 950 : 560)));
            const dw = (w - 16) / nDoors;
            const dh = h - plinth - 20;
            for (let i = 0; i < nDoors; i++) {
                const cx = -hw + 8 + dw * (i + 0.5);
                const zOff = isSlide ? (i % 2 === 0 ? hd - doorT * 1.3 : hd - doorT * 0.4) : hd - doorT / 2;
                addBox(g, dw - (isSlide ? -12 : 4), dh, doorT, MATS.whiteMatte, cx, plinth + 10 + dh / 2, zOff);
                // Tay nắm dọc tinh tế
                const handleX = isSlide
                    ? (i === 0 ? cx - dw * 0.38 : cx + dw * 0.38)
                    : (i % 2 === 0 ? cx + dw * 0.41 : cx - dw * 0.41);
                addBox(g, 14, Math.min(900, dh * 0.42), 18, MATS.graphite, handleX, plinth + dh * 0.48, zOff + doorT / 2 + 7, false);
            }
            break;
        }

        case 'cab':
        case 'cab_wall':
        case 'shoe_bench': {
            const isWall = sym === 'cab_wall';
            const isShoeBench = sym === 'shoe_bench';
            const isOven = item.kind === 'tall_oven';
            const isMirror = item.kind === 'mirrorcab';
            const plinth = isWall ? 0 : 75;
            const benchW = isShoeBench ? Math.min(500, w * 0.36) : 0;
            const cabW = w - benchW;
            const cabCenterX = -benchW / 2;

            if (plinth > 0) addBox(g, w - 40, plinth, d - 50, MATS.oakDark, 0, plinth / 2, -10);
            addBox(g, cabW, h - plinth, d - 20, MATS.oak, cabCenterX, plinth + (h - plinth) / 2, -10);

            if (isOven) {
                // Tủ cột bếp: cánh dưới + lò nướng + lò vi sóng + cánh trên
                const bodyH = h - plinth;
                addBox(g, cabW - 8, bodyH * 0.32, 20, MATS.whiteMatte, 0, plinth + bodyH * 0.16, hd - 10);
                addBox(g, cabW - 24, bodyH * 0.25, 22, MATS.darkGlass, 0, plinth + bodyH * 0.46, hd - 8);
                addBox(g, cabW - 24, bodyH * 0.17, 22, MATS.darkGlass, 0, plinth + bodyH * 0.69, hd - 8);
                addBox(g, cabW - 8, bodyH * 0.20, 20, MATS.whiteMatte, 0, plinth + bodyH * 0.89, hd - 10);
            } else {
                const nDoors = Math.max(1, Math.round(cabW / 520));
                const dw = (cabW - 12) / nDoors;
                const dh = h - plinth - 16;
                for (let i = 0; i < nDoors; i++) {
                    const cx = -hw + 6 + dw * (i + 0.5);
                    addBox(g, dw - 4, dh, 20, isMirror ? MATS.mirror : MATS.whiteMatte, cx, plinth + 8 + dh / 2, hd - 10);
                }
            }

            if (isShoeBench && benchW > 80) {
                const bx = hw - benchW / 2;
                addBox(g, benchW, 430 - plinth, d - 20, MATS.oak, bx, plinth + (430 - plinth) / 2, -10);
                addBox(g, benchW - 20, 55, d - 30, MATS.fabricWarm, bx, 458, -5);
                addBox(g, benchW, h - 430, 35, MATS.oak, bx, 430 + (h - 430) / 2, -hd + 18);
            }
            break;
        }

        case 'kitchen_base':
        case 'island': {
            const isIsland = sym === 'island';
            const plinth = 95;
            const topT = 36;
            const bodyH = Math.max(200, h - plinth - topT);
            const bodyD = isIsland ? d * 0.72 : d - 28;
            const bodyZ = isIsland ? -d * 0.12 : -10;

            addBox(g, w - 50, plinth, bodyD - 50, MATS.graphite, 0, plinth / 2, bodyZ);
            addBox(g, w - 8, bodyH, bodyD, MATS.oak, 0, plinth + bodyH / 2, bodyZ);
            // Mặt đá thạch anh trắng tràn nhẹ
            addBox(g, w, topT, d, MATS.stone, 0, h - topT / 2, 0);

            // Chia mô-đun cánh & ngăn kéo mặt trước
            const nMod = Math.max(2, Math.round(w / 600));
            const mw = (w - 12) / nMod;
            const frontZ = bodyZ + bodyD / 2 + 10;
            for (let i = 0; i < nMod; i++) {
                const cx = -hw + 6 + mw * (i + 0.5);
                if (i === 1 && nMod >= 3) {
                    // Khoang 3 ngăn kéo
                    for (let dr = 0; dr < 3; dr++) {
                        const dh = (bodyH - 16) / 3;
                        addBox(g, mw - 5, dh - 4, 18, MATS.whiteMatte, cx, plinth + 8 + dh * (dr + 0.5), frontZ);
                    }
                } else {
                    addBox(g, mw - 5, bodyH - 10, 18, MATS.whiteMatte, cx, plinth + bodyH / 2, frontZ);
                }
            }
            if (isIsland) {
                const nStools = Math.max(2, Math.round(w / 680));
                for (let s = 0; s < nStools; s++) {
                    const sx = -hw + (w / nStools) * (s + 0.5);
                    addCyl(g, 24, 24, 580, MATS.graphite, sx, 290, hd - 130, 12);
                    addCyl(g, 165, 155, 55, MATS.oakDark, sx, 600, hd - 130, 20);
                }
            }
            break;
        }

        case 'nightstand': {
            const legH = 140;
            const bodyH = Math.max(180, h - legH);
            for (const [sx, sz] of [[-hw + 45, -hd + 45], [hw - 45, -hd + 45], [-hw + 45, hd - 45], [hw - 45, hd - 45]]) {
                addCyl(g, 16, 10, legH, MATS.oakDark, sx, legH / 2, sz, 10);
            }
            addBox(g, w, bodyH, d, MATS.oak, 0, legH + bodyH / 2, 0);
            addBox(g, w - 24, bodyH * 0.44, 16, MATS.whiteMatte, 0, legH + bodyH * 0.27, hd + 4);
            addBox(g, w - 24, bodyH * 0.44, 16, MATS.whiteMatte, 0, legH + bodyH * 0.73, hd + 4);
            // Đèn ngủ nhỏ xinh đặt trên táp
            addCyl(g, 55, 70, 90, MATS.brass, 0, h + 45, 0, 14);
            addCyl(g, 95, 125, 150, MATS.cream, 0, h + 185, 0, 16);
            break;
        }

        case 'dresser': {
            const topT = 130;
            addBox(g, 45, h - topT, d - 40, MATS.oak, -hw + 30, (h - topT) / 2, 0);
            addBox(g, Math.min(340, w * 0.3), h - topT, d - 30, MATS.oak, hw - Math.min(175, w * 0.15), (h - topT) / 2, 0);
            addBox(g, w, topT, d, MATS.oak, 0, h - topT / 2, 0);
            // Gương tròn/chữ nhật phía trên
            addBox(g, w * 0.52, 620, 28, MATS.oakDark, -w * 0.08, h + 330, -hd + 25);
            addBox(g, w * 0.48, 580, 14, MATS.mirror, -w * 0.08, h + 330, -hd + 40);
            // Đôn ngồi
            addCyl(g, 165, 165, 420, MATS.fabricWarm, -w * 0.12, 210, hd + 90, 20);
            break;
        }

        case 'desk': {
            const topT = 38;
            addBox(g, 40, h - topT, d - 50, MATS.graphite, -hw + 35, (h - topT) / 2, 0);
            const pedW = Math.min(360, w * 0.3);
            addBox(g, pedW, h - topT, d - 40, MATS.whiteMatte, hw - pedW / 2 - 15, (h - topT) / 2, 0);
            addBox(g, w, topT, d, MATS.oak, 0, h - topT / 2, 0);
            // Màn hình máy tính trên bàn + ghế làm việc phía trước
            addBox(g, Math.min(520, w * 0.45), 310, 22, MATS.darkGlass, -w * 0.1, h + 220, -hd + 130);
            addBox(g, 120, 75, 90, MATS.steel, -w * 0.1, h + 36, -hd + 120);
            addDiningChair(g, -w * 0.1, hd + 70, Math.PI, 460, 440, 450, 880);
            break;
        }

        case 'bench': {
            const legH = h * 0.45;
            for (const [sx, sz] of [[-hw + 55, -hd + 45], [hw - 55, -hd + 45], [-hw + 55, hd - 45], [hw - 55, hd - 45]]) {
                addBox(g, 38, legH, 38, MATS.oakDark, sx, legH / 2, sz, false);
            }
            addBox(g, w, h - legH, d, MATS.fabricWarm, 0, legH + (h - legH) / 2, 0);
            break;
        }

        case 'sofa':
        case 'armchair': {
            const legH = 70;
            const seatH = Math.min(410, h * 0.5);
            const armW = sym === 'armchair' ? w * 0.18 : Math.min(180, w * 0.1);
            const armH = Math.min(600, h * 0.75);
            const backT = Math.min(200, d * 0.24);
            const mat = sym === 'armchair' ? MATS.fabricBlue : MATS.fabricWarm;

            for (const [sx, sz] of [[-hw + 65, -hd + 65], [hw - 65, -hd + 65], [-hw + 65, hd - 65], [hw - 65, hd - 65]]) {
                addCyl(g, 20, 14, legH, MATS.oakDark, sx, legH / 2, sz, 10);
            }
            // Khung đáy + 2 tay vịn + lưng tựa
            addBox(g, w - armW * 2, 160, d - 30, mat, 0, legH + 80, 10);
            addBox(g, armW, armH - legH, d, mat, -hw + armW / 2, legH + (armH - legH) / 2, 0);
            addBox(g, armW, armH - legH, d, mat, hw - armW / 2, legH + (armH - legH) / 2, 0);
            addBox(g, w, h - legH, backT, mat, 0, legH + (h - legH) / 2, -hd + backT / 2);

            // Đệm ngồi rời & gối tựa lưng
            const innerW = w - armW * 2;
            const nSeats = sym === 'armchair' ? 1 : (w >= 1900 ? 3 : 2);
            const sw = (innerW - (nSeats - 1) * 10) / nSeats;
            for (let i = 0; i < nSeats; i++) {
                const cx = -innerW / 2 + sw * (i + 0.5) + i * 5;
                addBox(g, sw - 6, seatH - legH - 150, d - backT - 15, mat, cx, legH + 160 + (seatH - legH - 150) / 2, backT / 2);
                addBox(g, sw - 16, (h - seatH) * 0.88, 125, MATS.pillow, cx, seatH + (h - seatH) * 0.44, -hd + backT + 55);
            }
            break;
        }

        case 'sofaL': {
            const legH = 65;
            const seatH = 410;
            const armW = Math.min(180, w * 0.08);
            const backT = Math.min(195, d * 0.12);
            const mainD = Math.min(d * 0.52, 920);
            const chaiseW = Math.min(w * 0.37, 980);
            const leftPartW = w - chaiseW;

            // Văng chính bên trái (-hw .. hw - chaiseW)
            const leftCx = -hw + leftPartW / 2;
            const mainCz = -hd + mainD / 2;
            addBox(g, leftPartW, seatH - legH, mainD, MATS.fabricWarm, leftCx, legH + (seatH - legH) / 2, mainCz);
            addBox(g, armW, 560 - legH, mainD, MATS.fabricWarm, -hw + armW / 2, legH + (560 - legH) / 2, mainCz);
            // Phần Chaise dài bên phải (hw - chaiseW .. hw, suốt chiều sâu d)
            const chaiseCx = hw - chaiseW / 2;
            addBox(g, chaiseW, seatH - legH, d, MATS.fabricWarm, chaiseCx, legH + (seatH - legH) / 2, 0);
            addBox(g, armW, 560 - legH, d * 0.58, MATS.fabricWarm, hw - armW / 2, legH + (560 - legH) / 2, -hd + d * 0.29);
            // Lưng tựa suốt chiều ngang
            addBox(g, w, h - legH, backT, MATS.fabricWarm, 0, legH + (h - legH) / 2, -hd + backT / 2);
            // Gối tựa lưng
            const nPils = 3;
            const pw = (w - armW * 2 - 40) / nPils;
            for (let i = 0; i < nPils; i++) {
                addBox(g, pw - 18, (h - seatH) * 0.85, 125, MATS.pillow, -hw + armW + 20 + pw * (i + 0.5), seatH + (h - seatH) * 0.42, -hd + backT + 55);
            }
            break;
        }

        case 'coffee': {
            const topT = 36;
            const legT = 36;
            addBox(g, w, topT, d, MATS.stone, 0, h - topT / 2, 0);
            addBox(g, w - 80, 24, d - 80, MATS.oak, 0, h * 0.34, 0);
            for (const [sx, sz] of [[-hw + 45, -hd + 45], [hw - 45, -hd + 45], [-hw + 45, hd - 45], [hw - 45, hd - 45]]) {
                addBox(g, legT, h - topT, legT, MATS.oakDark, sx, (h - topT) / 2, sz, false);
            }
            break;
        }

        case 'rug': {
            addBox(g, w, 10, d, MATS.rugBorder, 0, 5, 0, false);
            addBox(g, w - 120, 12, d - 120, MATS.rug, 0, 6, 0, false);
            break;
        }

        case 'tvstand': {
            const legH = 90;
            const bodyH = Math.max(180, h - legH);
            addBox(g, w - 120, legH, d - 100, MATS.oakDark, 0, legH / 2, 0);
            addBox(g, w, bodyH, d, MATS.oak, 0, legH + bodyH / 2, 0);
            const bayW = (w - 24) / 3;
            addBox(g, bayW - 6, bodyH - 24, 18, MATS.whiteMatte, -bayW, legH + bodyH / 2, hd + 2);
            addBox(g, bayW - 6, (bodyH - 28) / 2, 18, MATS.whiteMatte, 0, legH + bodyH * 0.28, hd + 2);
            addBox(g, bayW - 6, bodyH - 24, 18, MATS.whiteMatte, bayW, legH + bodyH / 2, hd + 2);
            break;
        }

        case 'tv': {
            addBox(g, w * 0.35, h * 0.35, d * 0.5, MATS.graphite, 0, h / 2, -hd + d * 0.25, false);
            addBox(g, w, h, Math.min(36, d * 0.5), MATS.graphite, 0, h / 2, hd - 18);
            addBox(g, w - 28, h - 28, 8, MATS.darkGlass, 0, h / 2, hd + 1, false);
            break;
        }

        case 'table': {
            const topT = 42;
            const legT = 56;
            addBox(g, w, topT, d, MATS.oak, 0, h - topT / 2, 0);
            addBox(g, w - 160, 70, d - 160, MATS.oakDark, 0, h - topT - 35, 0, false);
            const lx = hw - 85, lz = hd - 85;
            for (const [sx, sz] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) {
                addBox(g, legT, h - topT, legT, MATS.oakDark, sx, (h - topT) / 2, sz);
            }
            // Tự động xếp ghế ăn 3D quanh bàn
            const hasEnd = w >= 1900;
            const nSide = hasEnd ? Math.max(2, Math.round((w - 500) / 620)) : Math.max(2, Math.round(w / 620));
            const spanW = hasEnd ? w * 0.8 : w * 0.88;
            for (let i = 0; i < nSide; i++) {
                const cx = -spanW / 2 + (spanW / nSide) * (i + 0.5);
                addDiningChair(g, cx, -hd - 110, 0);
                addDiningChair(g, cx, hd + 110, Math.PI);
            }
            if (hasEnd) {
                addDiningChair(g, -hw - 110, 0, Math.PI / 2);
                addDiningChair(g, hw + 110, 0, -Math.PI / 2);
            }
            break;
        }

        case 'partition': {
            addBox(g, w, 45, d, MATS.oakDark, 0, 22.5, 0);
            addBox(g, w, 45, d, MATS.oakDark, 0, h - 22.5, 0);
            const n = Math.max(4, Math.round(w / 115));
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                addBox(g, 36, h - 90, d - 16, MATS.oak, cx, h / 2, 0);
            }
            break;
        }

        case 'plant': {
            const potH = Math.min(380, h * 0.34);
            const potR = Math.min(hw, hd) * 0.72;
            addCyl(g, potR, potR * 0.78, potH, MATS.whiteMatte, 0, potH / 2, 0, 18);
            addCyl(g, 18, 24, h * 0.48, MATS.oakDark, 0, potH + h * 0.24, 0, 8);
            // Tán cây xanh tự nhiên nhiều lớp
            const crownY = potH + (h - potH) * 0.62;
            const cr = Math.min(w, d) * 0.52;
            const puffs = [
                [0, crownY + cr * 0.35, 0, cr * 0.75, MATS.leafLight],
                [-cr * 0.42, crownY, cr * 0.25, cr * 0.62, MATS.leaf],
                [cr * 0.42, crownY + 30, -cr * 0.2, cr * 0.65, MATS.leaf],
                [0, crownY - cr * 0.2, -cr * 0.35, cr * 0.58, MATS.leafLight],
                [0, crownY - cr * 0.15, cr * 0.4, cr * 0.55, MATS.leaf],
            ];
            for (const [px, py, pz, r, m] of puffs) {
                const sp = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), m);
                sp.position.set(px, py, pz);
                sp.castShadow = true;
                g.add(sp);
            }
            break;
        }

        case 'hob': {
            addBox(g, w, Math.max(24, h * 0.45), d, MATS.darkGlass, 0, 16, 0);
            const r = Math.min(w, d) * 0.19;
            addCyl(g, r, r, 6, MATS.steel, -w * 0.23, 30, 0, 20);
            addCyl(g, r * 0.85, r * 0.85, 6, MATS.steel, w * 0.23, 30, 0, 20);
            break;
        }

        case 'sink':
        case 'sink2': {
            const topY = h;
            addBox(g, w, 26, d, MATS.steel, 0, topY - 13, 0);
            const spanW = sym === 'sink2' ? w * 0.66 : w;
            const nBowls = w >= 720 ? 2 : 1;
            const pad = 42;
            const bw = (spanW - pad * (nBowls + 1)) / nBowls;
            for (let i = 0; i < nBowls; i++) {
                const bx = -hw + pad + i * (bw + pad) + bw / 2;
                addBox(g, bw, h - 18, d - 95, MATS.graphite, bx, (h - 18) / 2, 12);
            }
            // Vòi rửa cổ ngỗng cao
            const fx = -hw + spanW / 2;
            addCyl(g, 14, 18, 250, MATS.steel, fx, topY + 125, -hd + 65, 12);
            addBox(g, 24, 24, 140, MATS.steel, fx, topY + 245, -hd + 125, false);
            break;
        }

        case 'fridge': {
            const bodyD = d - 55;
            addBox(g, w, h, bodyD, MATS.graphite, 0, h / 2, -25);
            if (w >= 850) {
                const dw = (w - 14) / 2;
                addBox(g, dw, h * 0.58, 48, MATS.steel, -dw / 2 - 3, h * 0.70, hd - 24);
                addBox(g, dw, h * 0.58, 48, MATS.steel, dw / 2 + 3, h * 0.70, hd - 24);
                addBox(g, w - 8, h * 0.39, 48, MATS.steel, 0, h * 0.20, hd - 24);
            } else {
                addBox(g, w - 8, h * 0.36, 48, MATS.steel, 0, h * 0.81, hd - 24);
                addBox(g, w - 8, h * 0.61, 48, MATS.steel, 0, h * 0.31, hd - 24);
            }
            break;
        }

        case 'hood': {
            addBox(g, w, 90, d, MATS.steel, 0, 45, 0);
            addBox(g, Math.min(320, w * 0.36), Math.max(120, h - 90), Math.min(280, d * 0.6), MATS.steel, 0, 90 + (h - 90) / 2, -hd + Math.min(140, d * 0.3));
            break;
        }

        case 'toilet': {
            const tankD = d * 0.3;
            const tankH = Math.max(h + 340, 760);
            addBox(g, w * 0.92, tankH, tankD, MATS.ceramic, 0, tankH / 2, -hd + tankD / 2);
            const bowlL = d - tankD;
            addCyl(g, w * 0.45, w * 0.34, h, MATS.ceramic, 0, h / 2, -hd + tankD + bowlL * 0.48, 20);
            addCyl(g, w * 0.46, w * 0.46, 32, MATS.whiteMatte, 0, h + 16, -hd + tankD + bowlL * 0.48, 20);
            break;
        }

        case 'basin': {
            const cabH = Math.max(240, h * 0.56);
            addBox(g, w - 10, cabH, d - 20, MATS.oak, 0, h - 110 - cabH / 2, -10);
            addBox(g, w, 110, d, MATS.ceramic, 0, h - 55, 0);
            const n = w > 900 ? 2 : 1;
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                addCyl(g, (w / n) * 0.3, (w / n) * 0.26, 26, MATS.stone, cx, h + 4, 15, 18);
                addCyl(g, 14, 16, 150, MATS.steel, cx, h + 75, -hd + 75, 10);
            }
            break;
        }

        case 'shower': {
            addBox(g, w, 55, d, MATS.stone, 0, 27.5, 0);
            // Vách kính tắm đứng trong suốt + khung đen mờ
            addBox(g, w, h - 55, 14, MATS.clearGlass, 0, 55 + (h - 55) / 2, hd - 7, false);
            addBox(g, 14, h - 55, d, MATS.clearGlass, hw - 7, 55 + (h - 55) / 2, 0, false);
            addBox(g, w, 24, 24, MATS.graphite, 0, h - 12, hd - 12, false);
            addBox(g, 24, 24, d, MATS.graphite, hw - 12, h - 12, 0, false);
            addBox(g, 24, h - 55, 24, MATS.graphite, hw - 12, 55 + (h - 55) / 2, hd - 12, false);
            // Cây sen đứng + bát sen mưa
            addCyl(g, 10, 10, h * 0.65, MATS.steel, 0, h * 0.52, -hd + 45, 10);
            addCyl(g, 110, 110, 16, MATS.steel, 0, h * 0.86, -hd + 190, 18);
            break;
        }

        case 'glass_part': {
            addBox(g, w, h, Math.max(16, d), MATS.clearGlass, 0, h / 2, 0, false);
            addBox(g, w, 26, 28, MATS.graphite, 0, h - 13, 0, false);
            addBox(g, 26, h, 28, MATS.graphite, -hw + 13, h / 2, 0, false);
            break;
        }

        case 'tub': {
            const wallT = 75;
            addBox(g, w, h * 0.35, d, MATS.ceramic, 0, h * 0.175, 0);
            addBox(g, w, h * 0.65, wallT, MATS.ceramic, 0, h * 0.675, -hd + wallT / 2);
            addBox(g, w, h * 0.65, wallT, MATS.ceramic, 0, h * 0.675, hd - wallT / 2);
            addBox(g, wallT, h * 0.65, d - wallT * 2, MATS.ceramic, -hw + wallT / 2, h * 0.675, 0);
            addBox(g, wallT, h * 0.65, d - wallT * 2, MATS.ceramic, hw - wallT / 2, h * 0.675, 0);
            addCyl(g, 16, 18, 170, MATS.steel, -hw + wallT / 2, h + 85, 0, 12);
            break;
        }

        case 'washer': {
            const isTower = h > 1300;
            const unitH = isTower ? h / 2 - 6 : h;
            const levels = isTower ? [0, unitH + 12] : [0];
            for (const y0 of levels) {
                addBox(g, w, unitH, d - 25, MATS.whiteMatte, 0, y0 + unitH / 2, -12);
                const drum = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 32, 22), MATS.darkGlass);
                drum.rotation.x = Math.PI / 2;
                drum.position.set(0, y0 + unitH * 0.48, hd - 10);
                g.add(drum);
            }
            break;
        }

        case 'ac_wall': {
            addBox(g, w, h, d, MATS.whiteMatte, 0, h / 2, 0);
            addBox(g, w - 60, 24, 20, MATS.graphite, 0, 28, hd - 8, false);
            break;
        }

        case 'ac_cass': {
            addBox(g, w, Math.min(70, h), d, MATS.whiteMatte, 0, 35, 0);
            addBox(g, w * 0.58, 12, d * 0.58, MATS.graphite, 0, 2, 0, false);
            break;
        }

        case 'curtain': {
            // Hộp rèm sát trần + rèm vải & voan rủ xuống gần sàn
            addBox(g, w, h, d, MATS.whiteMatte, 0, h / 2, 0);
            const dropH = Math.max(1200, roomH - h - 40);
            addBox(g, w - 40, dropH, 24, MATS.sheer, 0, -dropH / 2, 0, false);
            const sideW = Math.min(380, w * 0.22);
            addBox(g, sideW, dropH, 55, MATS.fabricWarm, -hw + sideW / 2 + 10, -dropH / 2, 18, false);
            addBox(g, sideW, dropH, 55, MATS.fabricWarm, hw - sideW / 2 - 10, -dropH / 2, 18, false);
            break;
        }

        case 'altar': {
            const isHang = cat?.mount === 'wall';
            if (isHang) {
                addBox(g, w, 65, d, MATS.redwood, 0, h - 32, 0);
                addBox(g, 55, h, d, MATS.redwood, -hw + 28, h / 2, 0);
                addBox(g, 55, h, d, MATS.redwood, hw - 28, h / 2, 0);
            } else {
                const topT = 85;
                const legT = 72;
                addBox(g, w, topT, d, MATS.redwood, 0, h - topT / 2, 0);
                addBox(g, w - 120, 160, d - 100, MATS.redwood, 0, h - topT - 80, 0);
                // Hai tai cuốn thư uốn cao 2 đầu
                addBox(g, 55, 65, d, MATS.redwood, -hw + 27.5, h + 32, 0);
                addBox(g, 55, 65, d, MATS.redwood, hw - 27.5, h + 32, 0);
                for (const [sx, sz] of [[-hw + 65, -hd + 65], [hw - 65, -hd + 65], [-hw + 65, hd - 65], [hw - 65, hd - 65]]) {
                    addBox(g, legT, h - topT, legT, MATS.redwood, sx, (h - topT) / 2, sz);
                }
            }
            // Bát hương đồng đặt trang trọng ở giữa
            addCyl(g, 65, 52, 110, MATS.brass, 0, h + 55, -d * 0.08, 16);
            break;
        }

        case 'stairs': {
            const steps = Math.max(5, Math.round(h / 175));
            const stepD = d / steps;
            const stepH = h / steps;
            for (let i = 0; i < steps; i++) {
                const sy = stepH * (i + 1);
                const sz = hd - stepD * (i + 0.5);
                addBox(g, w, sy, stepD + 4, MATS.oak, 0, sy / 2, sz);
            }
            break;
        }

        case 'shelf_open': {
            const sideT = 20;
            const shelves = Math.max(3, Math.round(h / 380));
            addBox(g, sideT, h, d, MATS.oak, -hw + sideT / 2, h / 2, 0);
            addBox(g, sideT, h, d, MATS.oak, hw - sideT / 2, h / 2, 0);
            addBox(g, w - sideT * 2, h - 20, 12, MATS.cream, 0, h / 2, -hd + 6);
            for (let i = 0; i < shelves; i++) {
                const sy = (h - 20) * (i / Math.max(1, shelves - 1)) + 10;
                addBox(g, w - sideT * 2, 18, d - 14, MATS.oak, 0, sy, 2);
            }
            break;
        }

        case 'cabinet_glass': {
            const sideT = 18;
            addBox(g, w, h, d - 22, MATS.oakDark, 0, h / 2, -11);
            const cols = Math.max(1, Math.min(4, Math.round(w / 450)));
            const colW = (w - sideT * 2) / cols;
            for (let i = 0; i < cols; i++) {
                const cx = -hw + sideT + colW * (i + 0.5);
                addBox(g, colW - 8, h - 40, 14, MATS.clearGlass, cx, h / 2, hd - 10);
                addBox(g, 8, h - 40, 18, MATS.oakDark, cx - colW / 2 + 4, h / 2, hd - 9);
                addBox(g, 8, h - 40, 18, MATS.oakDark, cx + colW / 2 - 4, h / 2, hd - 9);
            }
            break;
        }

        case 'box':
        default: {
            addBox(g, w, h, d, MATS.whiteMatte, 0, h / 2, 0);
            break;
        }
    }

    applyMaterialOverrides(g, cat);
    return g;
}
