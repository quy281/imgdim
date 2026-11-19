#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
});

let pass = 0;
try {
    const {
        newCutoutDoc,
        makeCutoutItem,
        cutoutOffsets,
        applyCutoutOffset,
        applyCutoutSize,
        centerCutout,
        snapCutoutPosition,
    } = await server.ssrLoadModule('/src/lib/cutoutModel.js');
    const { generateCutoutDxf } = await server.ssrLoadModule('/src/lib/cutoutDxf.js');

    function test(name, fn) {
        fn();
        pass++;
        console.log(`PASS  ${name}`);
    }

    test('newCutoutDoc tao dung preset lavabo_top, kitchen_top, wall_elec', () => {
        const lav = newCutoutDoc('p1', 'Lavabo WC', 'lavabo_top');
        assert.equal(lav.type, 'cutout');
        assert.equal(lav.cutout.w, 1000);
        assert.equal(lav.cutout.h, 550);
        assert.equal(lav.cutout.cutouts.length, 2);

        const kit = newCutoutDoc('p1', 'Da bep', 'kitchen_top');
        assert.equal(kit.cutout.w, 2400);
        assert.equal(kit.cutout.h, 620);
        assert.equal(kit.cutout.cutouts[0].kind, 'hob');
        assert.equal(kit.cutout.cutouts[1].kind, 'sink');

        const wall = newCutoutDoc('p1', 'O dien phong ngu', 'wall_elec');
        assert.equal(wall.cutout.w, 2400);
        assert.equal(wall.cutout.h, 2600);
        assert.equal(wall.cutout.cutouts[0].kind, 'socket2');
    });

    test('cutoutOffsets va applyCutoutOffset chinh xac theo Mep lo (edge)', () => {
        const outer = { w: 1000, h: 550 };
        const hole = makeCutoutItem('lavabo', outer, { x: 240, y: 85, w: 520, h: 380 });
        const o1 = cutoutOffsets(outer, hole, 'edge');
        assert.deepEqual(o1, { left: 240, right: 240, top: 85, bottom: 85 });

        const movedLeft = applyCutoutOffset(outer, hole, 'left', 150, 'edge');
        assert.equal(movedLeft.x, 150);
        assert.deepEqual(cutoutOffsets(outer, movedLeft, 'edge'), { left: 150, right: 330, top: 85, bottom: 85 });

        const movedRight = applyCutoutOffset(outer, hole, 'right', 100, 'edge');
        assert.equal(movedRight.x, 380);
        assert.deepEqual(cutoutOffsets(outer, movedRight, 'edge'), { left: 380, right: 100, top: 85, bottom: 85 });

        const movedBottom = applyCutoutOffset(outer, hole, 'bottom', 60, 'edge');
        assert.equal(movedBottom.y, 110);
        assert.equal(cutoutOffsets(outer, movedBottom, 'edge').bottom, 60);
    });

    test('cutoutOffsets va applyCutoutOffset chinh xac theo Tam lo (center - o dien/voi)', () => {
        const outer = { w: 2400, h: 2600 };
        const sock = makeCutoutItem('socket2', outer, { x: 500, y: 1400, w: 156, h: 86 });
        const oCenter = cutoutOffsets(outer, sock, 'center');
        assert.equal(oCenter.left, 578);
        assert.equal(oCenter.bottom, 1157);

        const placedY = applyCutoutOffset(outer, sock, 'bottom', 1100, 'center');
        assert.equal(cutoutOffsets(outer, placedY, 'center').bottom, 1100);
        assert.equal(placedY.y, 1457);

        const placedX = applyCutoutOffset(outer, placedY, 'left', 800, 'center');
        assert.equal(cutoutOffsets(outer, placedX, 'center').left, 800);
        assert.equal(placedX.x, 722);
    });

    test('applyCutoutSize va centerCutout khoa dung gioi han be mat', () => {
        const outer = { w: 1200, h: 600 };
        let hob = makeCutoutItem('hob', outer, { x: 200, y: 100, w: 680, h: 380, r: 20 });
        hob = applyCutoutSize(outer, hob, 'w', 750);
        assert.equal(hob.w, 750);
        hob = applyCutoutSize(outer, hob, 'r', 30);
        assert.equal(hob.r, 30);

        const centered = centerCutout(outer, hob, 'both');
        assert.equal(centered.x, 225);
        assert.equal(centered.y, 110);

        const fau = makeCutoutItem('faucet', outer, { x: 582, y: 40, w: 36, h: 36 });
        const bigFau = applyCutoutSize(outer, fau, 'd', 60);
        assert.equal(bigFau.w, 60);
        assert.equal(bigFau.h, 60);
        assert.equal(bigFau.r, 30);
    });

    test('snapCutoutPosition hit truc giua va thang hang voi lo ben canh', () => {
        const outer = { w: 2400, h: 620 };
        const hob = makeCutoutItem('hob', outer, { x: 200, y: 120, w: 680, h: 380 });
        const sink = makeCutoutItem('sink', outer, { x: 1400, y: 100, w: 780, h: 450 });
        const snapCenter = snapCutoutPosition(outer, [hob, sink], sink, { x: 1450, y: 92 }, 15);
        assert.equal(snapCenter.y, 85);
        assert.ok(snapCenter.guides.some(g => g.kind === 'center'));

        const sock1 = makeCutoutItem('socket1', outer, { x: 500, y: 100, w: 86, h: 86 });
        const sock2 = makeCutoutItem('socket2', outer, { x: 465, y: 300, w: 156, h: 86 });
        const alignRes = snapCutoutPosition(outer, [sock1, sock2], sock2, { x: 470, y: 300 }, 15);
        assert.equal(alignRes.x, 465);
    });

    test('generateCutoutDxf xuat du layer, CIRCLE, POLYLINE va kich thuoc', () => {
        const doc = newCutoutDoc('p1', 'Lavabo Test', 'lavabo_top');
        const dxf = generateCutoutDxf(doc);
        assert.ok(dxf.includes('CUTOUT_OUTER'));
        assert.ok(dxf.includes('CUTOUT_HOLE'));
        assert.ok(dxf.includes('CUTOUT_DIM'));
        assert.ok(dxf.includes('CIRCLE'));
        assert.ok(dxf.includes('POLYLINE'));
        assert.ok(dxf.includes('EOF'));
    });

    console.log(`\n===== CUTOUT UNIT TEST: ${pass} pass, 0 fail =====`);
} finally {
    await server.close();
}
