import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Share2, RotateCw, Eye, EyeOff, Maximize2, Compass } from 'lucide-react';
import { dist, wallSegments, openingV, ceilingHeight, pointInPolygon } from '../lib/geometry';
import { catalogItem, resolveZ } from '../lib/furnitureCatalog';
import { buildFurniture3D, MATS } from '../lib/room3dModels';
import { shareDataURL, stamp } from '../lib/export';
import { toast } from '../ui/Toast';

const CUT_H = 260; // Chiều cao tường hạ thấp khi chắn tầm nhìn camera (mm)

const WALL_MAT = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.85, metalness: 0.02 });
const WALL_CAP_MAT = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.75, metalness: 0.05 });
const COL_MAT = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.78, metalness: 0.05 });
const FLOOR_MAT = new THREE.MeshStandardMaterial({
    color: 0xeaddcf, roughness: 0.76, metalness: 0.02, side: THREE.DoubleSide,
});
const WC_FLOOR_MAT = new THREE.MeshStandardMaterial({
    color: 0xdbe4ea, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide,
});
const GROUND_PAD_MAT = new THREE.MeshStandardMaterial({
    color: 0xf1f3f6, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
});
const DOOR_FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x7c5338, roughness: 0.65, metalness: 0.05 });
const DOOR_LEAF_MAT = new THREE.MeshStandardMaterial({ color: 0xb98556, roughness: 0.68, metalness: 0.04 });
const WIN_FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.35 });
const ARCH_EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.42 });

function addFramedBox(parent, sx, sy, sz, mat, cx, cy, cz) {
    if (sx <= 1 || sy <= 1 || sz <= 1) return null;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), ARCH_EDGE_MAT));
    parent.add(mesh);
    return mesh;
}

/** Dựng bộ cửa đi 3D (khung bao + cánh mở hé 26° + tay nắm) dọc theo hệ trục tường (u từ 0..len) */
function addDoor3D(parent, u0, u1, sill, h, th, flipped) {
    const w = u1 - u0;
    if (w < 120 || h < 300) return;
    const frameT = 42;
    const depth = th + 20;
    const g = new THREE.Group();
    g.position.set((u0 + u1) / 2, sill, 0);

    addFramedBox(g, frameT, h, depth, DOOR_FRAME_MAT, -w / 2 + frameT / 2, h / 2, 0);
    addFramedBox(g, frameT, h, depth, DOOR_FRAME_MAT, w / 2 - frameT / 2, h / 2, 0);
    addFramedBox(g, w, frameT, depth, DOOR_FRAME_MAT, 0, h - frameT / 2, 0);

    // Cánh cửa xoay nhẹ để nhìn rõ chiều mở trong 3D
    const leafW = Math.max(80, w - frameT * 2);
    const leafH = Math.max(200, h - frameT - 8);
    const pivot = new THREE.Group();
    pivot.position.set(-w / 2 + frameT, 4, 0);
    pivot.rotation.y = (flipped ? 1 : -1) * 0.46; // ~26 độ
    addFramedBox(pivot, leafW, leafH, 40, DOOR_LEAF_MAT, leafW / 2, leafH / 2, 0);
    // Tay gạt khoá cửa
    addFramedBox(pivot, 95, 18, 90, MATS.steel, leafW - 75, Math.min(1000, leafH * 0.48), 0);
    g.add(pivot);
    parent.add(g);
}

/** Dựng cửa sổ 3D (khung nhôm hệ + đố chia cánh + kính xanh dịu + bệ đá) */
function addWindow3D(parent, u0, u1, sill, h, th) {
    const w = u1 - u0;
    if (w < 120 || h < 200) return;
    const g = new THREE.Group();
    g.position.set((u0 + u1) / 2, sill, 0);
    const fT = 45;
    const fD = Math.min(th, 90);

    // Bệ cửa sổ đá
    addFramedBox(g, w + 40, 28, th + 36, MATS.stone, 0, 14, 0);
    // Khung bao 4 cạnh
    addFramedBox(g, w, fT, fD, WIN_FRAME_MAT, 0, fT / 2 + 24, 0);
    addFramedBox(g, w, fT, fD, WIN_FRAME_MAT, 0, h - fT / 2, 0);
    addFramedBox(g, fT, h - 24, fD, WIN_FRAME_MAT, -w / 2 + fT / 2, (h + 24) / 2, 0);
    addFramedBox(g, fT, h - 24, fD, WIN_FRAME_MAT, w / 2 - fT / 2, (h + 24) / 2, 0);
    // Đố đứng giữa nếu cửa rộng
    if (w >= 950) {
        addFramedBox(g, fT * 0.85, h - fT * 2 - 24, fD * 0.85, WIN_FRAME_MAT, 0, (h + 24) / 2, 0);
    }
    // Tấm kính trong suốt
    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(40, w - fT * 2), Math.max(40, h - fT * 2 - 24), 12),
        MATS.clearGlass
    );
    glass.position.set(0, (h + 24) / 2, 0);
    g.add(glass);
    parent.add(g);
}

/**
 * Góc 3D sơ bộ của Phòng / Toàn mặt bằng (SketchUp-style Interactive 3D Room View).
 */
export default function Room3DView({ doc, initialRoomId = 'all', onClose }) {
    const mountRef = useRef(null);
    const threeRef = useRef(null);
    const rooms = doc?.plan?.rooms || [];

    const [roomFilter, setRoomFilter] = useState(() => {
        if (initialRoomId && initialRoomId !== 'all' && rooms.some(r => r.id === initialRoomId)) {
            return initialRoomId;
        }
        return 'all';
    });
    // 'auto' = Tự hạ tường chắn mắt | 'full' = Tường cao đủ | 'low' = Hạ thấp mọi tường
    const [wallMode, setWallMode] = useState('auto');
    const [busy, setBusy] = useState(false);

    const activeRoom = useMemo(
        () => (roomFilter === 'all' ? null : rooms.find(r => r.id === roomFilter) || null),
        [roomFilter, rooms]
    );

    // Xây dựng & cập nhật cảnh 3D
    useEffect(() => {
        const container = mountRef.current;
        if (!container) return;

        const width = Math.max(container.clientWidth, 300);
        const height = Math.max(container.clientHeight, 300);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe8eef5);

        const camera = new THREE.PerspectiveCamera(42, width / height, 50, 120000);
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI * 0.485; // Không lọt xuống dưới gầm sàn
        controls.minDistance = 800;
        controls.maxDistance = 45000;

        // Hệ thống ánh sáng kiến trúc tự nhiên (Hemisphere + Sun + Fill)
        const hemi = new THREE.HemisphereLight(0xffffff, 0xd6cfc2, 0.95);
        hemi.position.set(0, 12000, 0);
        scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xfffbf2, 1.05);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0004;
        scene.add(sun);
        scene.add(sun.target);

        const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.42);
        scene.add(fillLight);

        // ===== Dựng hình học Phòng / Tường / Sàn / Nội thất =====
        const plan = doc.plan || { nodes: [], walls: [], rooms: [] };
        const settings = doc.settings || {};
        const nodeById = new Map((plan.nodes || []).map(n => [n.id, n]));

        const visibleRooms = activeRoom ? [activeRoom] : (plan.rooms || []);
        const activeNodeSet = activeRoom ? new Set(activeRoom.nodeIds || []) : null;

        // 1. Tường cần hiển thị
        const visibleWalls = (plan.walls || []).filter(w => {
            if (!activeNodeSet) return true;
            return activeNodeSet.has(w.a) && activeNodeSet.has(w.b);
        });

        // Chiều cao trần cho từng tường (ưu tiên phòng chứa tường đó)
        const wallRoomMap = new Map();
        for (const r of (plan.rooms || [])) {
            const rSet = new Set(r.nodeIds || []);
            for (const w of (plan.walls || [])) {
                if (rSet.has(w.a) && rSet.has(w.b)) {
                    if (!wallRoomMap.has(w.id)) wallRoomMap.set(w.id, []);
                    wallRoomMap.get(w.id).push(r);
                }
            }
        }

        // Tính khung bao để đặt tâm nhìn & sàn nền
        const xs = [], zs = [];
        const pushPt = (x, z) => { if (Number.isFinite(x) && Number.isFinite(z)) { xs.push(x); zs.push(z); } };
        if (activeRoom) {
            for (const nid of (activeRoom.nodeIds || [])) {
                const nd = nodeById.get(nid);
                if (nd) pushPt(nd.x, nd.y);
            }
        } else {
            for (const nd of (plan.nodes || [])) pushPt(nd.x, nd.y);
            for (const f of (doc.furniture || [])) {
                pushPt(f.x - (f.w || 600), f.y - (f.d || 600));
                pushPt(f.x + (f.w || 600), f.y + (f.d || 600));
            }
        }
        const minX = xs.length ? Math.min(...xs) : 0;
        const maxX = xs.length ? Math.max(...xs) : 4000;
        const minZ = zs.length ? Math.min(...zs) : 0;
        const maxZ = zs.length ? Math.max(...zs) : 3000;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        const spanX = Math.max(1500, maxX - minX);
        const spanZ = Math.max(1500, maxZ - minZ);
        const maxSpan = Math.max(spanX, spanZ);

        // Cập nhật đèn mặt trời bao phủ đúng vùng nhìn
        sun.position.set(centerX + maxSpan * 0.85, maxSpan * 1.45, centerZ + maxSpan * 0.95);
        sun.target.position.set(centerX, 0, centerZ);
        const shadowCamSpan = maxSpan * 0.9 + 1500;
        sun.shadow.camera.left = -shadowCamSpan;
        sun.shadow.camera.right = shadowCamSpan;
        sun.shadow.camera.top = shadowCamSpan;
        sun.shadow.camera.bottom = -shadowCamSpan;
        sun.shadow.camera.near = 200;
        sun.shadow.camera.far = maxSpan * 4 + 8000;
        fillLight.position.set(centerX - maxSpan, maxSpan * 0.9, centerZ - maxSpan * 0.8);

        // 2. Mặt đất chuẩn + Lưới kiến trúc nhẹ xung quanh
        const padW = spanX + 3200, padZ = spanZ + 3200;
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(padW, padZ), GROUND_PAD_MAT);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(centerX, -6, centerZ);
        ground.receiveShadow = true;
        scene.add(ground);

        const gridSize = Math.ceil(Math.max(padW, padZ) / 1000) * 1000;
        const grid = new THREE.GridHelper(gridSize, Math.max(4, Math.round(gridSize / 1000)), 0xcbd5e1, 0xe2e8f0);
        grid.position.set(centerX, -3, centerZ);
        scene.add(grid);

        // 3. Sàn gỗ / gạch cho các phòng khép kín
        const activeRoomPoly = activeRoom
            ? (activeRoom.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean)
            : null;

        for (const r of visibleRooms) {
            const pts = (r.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean);
            if (pts.length < 3) continue;
            const shape = new THREE.Shape();
            shape.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
            shape.closePath();
            const fGeo = new THREE.ShapeGeometry(shape);
            const isWc = /wc|vệ sinh|tắm|toilet/i.test(r.name || '');
            const fMesh = new THREE.Mesh(fGeo, isWc ? WC_FLOOR_MAT : FLOOR_MAT);
            // Xoay +90° quanh X để (px, py, 0) -> (px, 0, py) khớp tuyệt đối hệ toạ độ 2D!
            fMesh.rotation.x = Math.PI / 2;
            fMesh.position.y = 2;
            fMesh.receiveShadow = true;
            scene.add(fMesh);
        }

        // Nếu chưa khép kín phòng nào, lót tấm sàn gỗ sơ bộ dưới vùng tường/nội thất
        if (visibleRooms.length === 0 && (visibleWalls.length > 0 || (doc.furniture || []).length > 0)) {
            const fallbackFloor = new THREE.Mesh(
                new THREE.PlaneGeometry(spanX + 800, spanZ + 800),
                FLOOR_MAT
            );
            fallbackFloor.rotation.x = -Math.PI / 2;
            fallbackFloor.position.set(centerX, 2, centerZ);
            fallbackFloor.receiveShadow = true;
            scene.add(fallbackFloor);
        }

        // 4. Dựng Tường 3D (có cả bản Full cao H và bản Cutaway hạ thấp 260mm để tự động ẩn mở)
        const wallControllers = [];
        for (const w of visibleWalls) {
            const a = nodeById.get(w.a), b = nodeById.get(w.b);
            if (!a || !b) continue;
            const len = dist(a, b);
            if (len < 1) continue;

            const adjRooms = activeRoom ? [activeRoom] : (wallRoomMap.get(w.id) || []);
            const H = adjRooms.length
                ? Math.max(...adjRooms.map(r => ceilingHeight(r, settings)))
                : ceilingHeight(null, settings);
            const th = w.thickness || 110;
            const mat = w.column ? COL_MAT : WALL_MAT;

            const angle2D = Math.atan2(b.y - a.y, b.x - a.x);
            const wallRoot = new THREE.Group();
            wallRoot.position.set(a.x, 0, a.y);
            // Quay quanh +Y một góc -angle2D để trục +X của wallRoot đi từ a -> b!
            wallRoot.rotation.y = -angle2D;

            const fullGrp = new THREE.Group();
            const cutGrp = new THREE.Group();

            const segs = wallSegments(w, len);
            for (const s of segs) {
                const segLen = s.to - s.from;
                if (segLen < 1) continue;
                const midU = (s.from + s.to) / 2;

                if (s.kind === 'seg') {
                    // Kéo dài nhẹ 2 đầu (th * 0.48) ở các góc nối để góc tường khít đặc không hở khe
                    const padA = s.from <= 1 ? th * 0.48 : 0;
                    const padB = s.to >= len - 1 ? th * 0.48 : 0;
                    const extLen = segLen + padA + padB;
                    const extMid = midU + (padB - padA) / 2;

                    addFramedBox(fullGrp, extLen, H, th, mat, extLen > 0 ? extMid : midU, H / 2, 0);
                    addFramedBox(cutGrp, extLen, CUT_H, th, mat, extLen > 0 ? extMid : midU, CUT_H / 2, 0);
                    addFramedBox(cutGrp, extLen, 10, th + 4, WALL_CAP_MAT, extLen > 0 ? extMid : midU, CUT_H + 5, 0);
                } else {
                    const op = (w.openings || []).find(o => o.id === s.opId);
                    if (!op) continue;
                    const { sill, h, top } = openingV(op, settings);
                    if (sill > 1) {
                        addFramedBox(fullGrp, segLen, sill, th, mat, midU, sill / 2, 0);
                        const cutSill = Math.min(sill, CUT_H);
                        addFramedBox(cutGrp, segLen, cutSill, th, mat, midU, cutSill / 2, 0);
                    }
                    if (H - top > 1) {
                        addFramedBox(fullGrp, segLen, H - top, th, mat, midU, top + (H - top) / 2, 0);
                    }
                    if (op.type === 'door') {
                        addDoor3D(fullGrp, s.from, s.to, sill, h, th, !!op.flipped);
                    } else {
                        addWindow3D(fullGrp, s.from, s.to, sill, h, th);
                    }
                }
            }

            wallRoot.add(fullGrp);
            wallRoot.add(cutGrp);
            scene.add(wallRoot);

            // Pháp tuyến ra ngoài để xét tường chắn camera
            const ux = (b.x - a.x) / len, uz = (b.y - a.y) / len;
            let outNx = -uz, outNz = ux;
            const midX = (a.x + b.x) / 2, midZ = (a.y + b.y) / 2;
            const refRoom = activeRoom || (adjRooms.length === 1 ? adjRooms[0] : null);
            const isPartitionBetweenTwoRooms = !activeRoom && adjRooms.length >= 2;

            if (refRoom && Number.isFinite(refRoom.cx)) {
                // Hướng từ tâm phòng ra bức tường
                if ((midX - refRoom.cx) * outNx + (midZ - refRoom.cy) * outNz < 0) {
                    outNx = -outNx;
                    outNz = -outNz;
                }
            } else {
                // Tường lẻ chưa khép phòng: lấy hướng từ tâm mặt bằng ra bức tường
                if ((midX - centerX) * outNx + (midZ - centerZ) * outNz < 0) {
                    outNx = -outNx;
                    outNz = -outNz;
                }
            }

            wallControllers.push({
                id: w.id,
                a, b, len, ux, uz, th,
                midX, midZ, outNx, outNz,
                isPartition: isPartitionBetweenTwoRooms && !w.column,
                isColumn: !!w.column,
                fullGrp, cutGrp,
                isCut: false,
            });
        }

        // 5. Đặt Nội thất 3D vào đúng vị trí, cao độ Z và hướng xoay trên mặt bằng
        const defaultH = activeRoom
            ? ceilingHeight(activeRoom, settings)
            : ceilingHeight(plan.rooms?.[0], settings);

        const furnEntries = [];
        for (const it of (doc.furniture || [])) {
            // Khi đang lọc xem riêng 1 phòng: giữ các món có tâm nằm trong phòng hoặc áp sát tường phòng đó
            if (activeRoomPoly && activeRoomPoly.length >= 3) {
                const inside = pointInPolygon({ x: it.x, y: it.y }, activeRoomPoly);
                if (!inside) {
                    const nearRoomWall = wallControllers.some(wc => {
                        const rx = it.x - wc.a.x, rz = it.y - wc.a.y;
                        const along = rx * wc.ux + rz * wc.uz;
                        const perp = Math.abs(-rx * wc.uz + rz * wc.ux);
                        return along >= -300 && along <= wc.len + 300 && perp <= wc.th + Math.max(it.w || 600, it.d || 600) * 0.65;
                    });
                    if (!nearRoomWall) continue;
                }
            }

            const cat = catalogItem(it.kind);
            const z0 = resolveZ(it, cat, defaultH);
            const model = buildFurniture3D(it, cat, defaultH);
            model.position.set(it.x, z0, it.y);
            model.rotation.y = -((it.rot || 0) * Math.PI) / 180;
            scene.add(model);

            // Tìm tường chủ nếu là đồ treo cao (để khi tường đó tự hạ thấp thì đồ treo cao không lơ lửng chắn mắt)
            let hostWall = null;
            if (z0 >= 1100 || cat?.sym === 'curtain') {
                let bestD = 380;
                for (const wc of wallControllers) {
                    const rx = it.x - wc.a.x, rz = it.y - wc.a.y;
                    const along = rx * wc.ux + rz * wc.uz;
                    if (along < -200 || along > wc.len + 200) continue;
                    const perp = Math.abs(-rx * wc.uz + rz * wc.ux) - wc.th / 2 - (it.d || cat?.d || 200) / 2;
                    if (Math.abs(perp) < bestD) {
                        bestD = Math.abs(perp);
                        hostWall = wc;
                    }
                }
            }
            furnEntries.push({ model, hostWall });
        }

        // Góc đặt camera ban đầu: phối cảnh 3/4 nhìn từ trên chéo xuống rất trực quan
        const distCam = Math.max(3800, maxSpan * 1.28);
        controls.target.set(centerX, Math.min(900, defaultH * 0.28), centerZ);
        camera.position.set(centerX + distCam * 0.72, distCam * 0.78, centerZ + distCam * 0.86);
        controls.update();

        // Cập nhật trạng thái hạ tường thông minh theo góc nhìn camera
        const updateWallCutaway = (modeNow) => {
            const vx = camera.position.x - controls.target.x;
            const vz = camera.position.z - controls.target.z;
            const vHoriz = Math.hypot(vx, vz) || 1;
            const camDirX = vx / vHoriz, camDirZ = vz / vHoriz;

            for (const wc of wallControllers) {
                let cut = false;
                if (modeNow === 'low') {
                    cut = true;
                } else if (modeNow === 'full') {
                    cut = false;
                } else {
                    // Chế độ 'auto': hạ những bức tường biên nằm phía gần camera & quay lưng chắn tầm mắt
                    if (!wc.isPartition && !wc.isColumn) {
                        const dotNormal = wc.outNx * camDirX + wc.outNz * camDirZ;
                        const relSide = (wc.midX - centerX) * camDirX + (wc.midZ - centerZ) * camDirZ;
                        if (dotNormal > 0.24 && relSide > -maxSpan * 0.12) {
                            cut = true;
                        }
                    }
                }
                wc.isCut = cut;
                wc.fullGrp.visible = !cut;
                wc.cutGrp.visible = cut;
            }

            for (const fe of furnEntries) {
                if (fe.hostWall) {
                    fe.model.visible = !fe.hostWall.isCut;
                }
            }
        };

        let animId = 0;
        const stateObj = {
            scene, camera, renderer, controls,
            centerX, centerZ, maxSpan, defaultH,
            wallModeRef: wallMode,
            updateWallCutaway,
        };
        threeRef.current = stateObj;

        updateWallCutaway(stateObj.wallModeRef);
        const onControlsChange = () => updateWallCutaway(stateObj.wallModeRef);
        controls.addEventListener('change', onControlsChange);

        const animate = () => {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        const ro = new ResizeObserver(() => {
            if (!container) return;
            const w = Math.max(container.clientWidth, 100);
            const h = Math.max(container.clientHeight, 100);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
        ro.observe(container);

        return () => {
            cancelAnimationFrame(animId);
            ro.disconnect();
            controls.removeEventListener('change', onControlsChange);
            controls.dispose();
            scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
            });
            renderer.dispose();
            threeRef.current = null;
        };
    }, [doc.plan, doc.furniture, doc.settings, activeRoom]);

    // Đồng bộ chế độ tường tức thì mà không dựng lại toàn bộ Scene
    useEffect(() => {
        const st = threeRef.current;
        if (!st) return;
        st.wallModeRef = wallMode;
        st.updateWallCutaway(wallMode);
    }, [wallMode]);

    // Các preset góc nhìn nhanh
    const setPreset = (preset) => {
        const st = threeRef.current;
        if (!st) return;
        const { camera, controls, centerX, centerZ, maxSpan, defaultH, updateWallCutaway } = st;
        const r = Math.max(3800, maxSpan * 1.28);
        if (preset === 'iso') {
            controls.target.set(centerX, Math.min(900, defaultH * 0.28), centerZ);
            camera.position.set(centerX + r * 0.72, r * 0.78, centerZ + r * 0.86);
        } else if (preset === 'top') {
            controls.target.set(centerX, 0, centerZ);
            camera.position.set(centerX, r * 1.45, centerZ + 40);
        } else if (preset === 'rotate90') {
            const dx = camera.position.x - controls.target.x;
            const dz = camera.position.z - controls.target.z;
            camera.position.x = controls.target.x - dz;
            camera.position.z = controls.target.z + dx;
        }
        controls.update();
        updateWallCutaway(st.wallModeRef);
    };

    const cycleWallMode = () => {
        setWallMode(m => (m === 'auto' ? 'full' : m === 'full' ? 'low' : 'auto'));
    };

    const exportImage = async () => {
        const st = threeRef.current;
        if (!st || busy) return;
        setBusy(true);
        try {
            st.renderer.render(st.scene, st.camera);
            const uri = st.renderer.domElement.toDataURL('image/png');
            const label = activeRoom?.name || doc.name || 'Phong3D';
            const clean = label.replace(/[\\/:*?"<>|]/g, '');
            const r = await shareDataURL(uri, `3D_${clean}_${stamp()}.png`);
            toast(r === 'shared' ? 'Đã chia sẻ ảnh 3D phòng' : 'Đã lưu ảnh 3D phòng', 'ok');
        } catch (err) {
            toast('Không xuất được ảnh 3D: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const wallModeLabel = wallMode === 'auto'
        ? 'Tự hạ tường'
        : wallMode === 'full' ? 'Tường cao đủ' : 'Hạ thấp tường';

    return (
        <div className="elev-screen room3d-screen">
            <div className="mode-banner elev">
                <span>
                    Góc 3D sơ bộ · {activeRoom ? (activeRoom.name || 'Phòng') : 'Toàn mặt bằng'}
                </span>
                <span className="spacer" />
                <button className="banner-btn" onClick={cycleWallMode}>
                    {wallMode === 'full' ? <Eye size={13} /> : <EyeOff size={13} />} {wallModeLabel}
                </button>
                <button className="banner-btn solid" disabled={busy} onClick={exportImage}>
                    <Share2 size={13} /> {busy ? 'Đang xuất…' : 'Xuất ảnh 3D'}
                </button>
            </div>

            <div className="room3d-stage-wrap">
                <div className="room3d-canvas" ref={mountRef} />

                {/* Cụm nút xoay / chuyển góc nhìn nhanh nổi góc phải */}
                <div className="room3d-floating-tools">
                    <button className="room3d-tool-btn" onClick={() => setPreset('iso')} title="Góc phối cảnh 3D">
                        <Compass size={16} /> Góc chéo
                    </button>
                    <button className="room3d-tool-btn" onClick={() => setPreset('rotate90')} title="Xoay 90° quanh phòng">
                        <RotateCw size={16} /> Xoay 90°
                    </button>
                    <button className="room3d-tool-btn" onClick={() => setPreset('top')} title="Nhìn thẳng từ trên xuống">
                        <Maximize2 size={16} /> Trên xuống
                    </button>
                </div>

                <div className="room3d-hint">
                    1 ngón xoay 360° · 2 ngón véo zoom & trượt góc nhìn
                </div>
            </div>

            <div className="elev-faces">
                <button
                    className={`chip ${roomFilter === 'all' ? 'on' : ''}`}
                    onClick={() => setRoomFilter('all')}
                >
                    Toàn mặt bằng
                </button>
                {rooms.map((r, idx) => (
                    <button
                        key={r.id}
                        className={`chip ${roomFilter === r.id ? 'on' : ''}`}
                        onClick={() => setRoomFilter(r.id)}
                    >
                        {r.name || `Phòng ${idx + 1}`}
                    </button>
                ))}
                <span style={{ flex: 1 }} />
                <button className="chip" onClick={onClose}><X size={15} /> Đóng</button>
            </div>
        </div>
    );
}
