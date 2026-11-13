// Đóng gói SketchUp Extension trong sketchup-plugin/ thành file chuẩn .rbz (ZIP) tại public/mkg_khaosat_exporter.rbz
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'sketchup-plugin');
const ICONS_DIR = path.join(PLUGIN_DIR, 'mkg_khaosat_exporter', 'icons');
const OUT_RBZ = path.join(ROOT, 'public', 'mkg_khaosat_exporter.rbz');

// Bảng CRC-32 chuẩn IEEE 802.3 cho cả PNG và ZIP
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, pixels) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const rowOff = y * (stride + 1);
        raw[rowOff] = 0; // filter None
        pixels.copy(raw, rowOff + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', idat),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Vẽ icon khối 3D isometric xanh dương MKG + điểm nhấn đỏ SketchUp */
function renderPluginIcon(size) {
    const pixels = Buffer.alloc(size * size * 4);
    const cx = size / 2;
    const cy = size / 2;

    const blend = (x, y, r, g, b, a = 255) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const idx = (y * size + x) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = a;
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Nền bo tròn xanh đậm
            const nx = (x + 0.5 - cx) / (size * 0.46);
            const ny = (y + 0.5 - cy) / (size * 0.46);
            const rr = Math.max(Math.abs(nx), Math.abs(ny));
            const corner = Math.hypot(Math.max(0, Math.abs(nx) - 0.62), Math.max(0, Math.abs(ny) - 0.62));
            if (rr <= 1 && corner <= 0.38) {
                blend(x, y, 29, 78, 216, 255);
            } else {
                blend(x, y, 0, 0, 0, 0);
            }

            // Hộp isometric 3D trắng / xanh nhạt / đỏ ở giữa
            const dx = (x + 0.5 - cx) / (size * 0.32);
            const dy = (y + 0.5 - cy) / (size * 0.32);
            if (Math.abs(dx) <= 0.88 && dy >= -0.95 && dy <= 0.95) {
                // Mặt trên (diamond): -0.95..0
                const topHalf = 0.88 * (1 - Math.abs(dy + 0.45) / 0.5);
                if (dy >= -0.95 && dy <= 0.05 && Math.abs(dx) <= topHalf) {
                    blend(x, y, 248, 250, 252, 255);
                } else {
                    const sideTop = -0.45 + Math.abs(dx) * 0.56;
                    const sideBot = 0.92 - (0.88 - Math.abs(dx)) * 0.52;
                    if (dy >= sideTop && dy <= sideBot && Math.abs(dx) <= 0.86) {
                        if (dx < 0) {
                            blend(x, y, 191, 219, 254, 255); // mặt trái sáng
                        } else {
                            blend(x, y, 225, 29, 72, 255); // mặt phải nhấn đỏ MKG
                        }
                    }
                }
            }
        }
    }
    return encodePngRgba(size, size, pixels);
}

function collectFiles(dir, baseDir = dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...collectFiles(full, baseDir));
        } else if (ent.isFile()) {
            const rel = path.relative(baseDir, full).split(path.sep).join('/');
            out.push({ rel, full });
        }
    }
    out.sort((a, b) => a.rel.localeCompare(b.rel));
    return out;
}

function dosTimeDate(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
    const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
    return { dosTime, dosDate };
}

function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, data, mtime } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const compressed = zlib.deflateRawSync(data, { level: 9 });
        const useStore = compressed.length >= data.length;
        const payload = useStore ? data : compressed;
        const method = useStore ? 0 : 8;
        const { dosTime, dosDate } = dosTimeDate(mtime);

        // Local file header (30 bytes + name)
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4); // version needed
        lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
        lfh.writeUInt16LE(method, 8);
        lfh.writeUInt16LE(dosTime, 10);
        lfh.writeUInt16LE(dosDate, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(payload.length, 18);
        lfh.writeUInt32LE(data.length, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);

        localParts.push(lfh, nameBuf, payload);

        // Central directory file header (46 bytes + name)
        const cdfh = Buffer.alloc(46);
        cdfh.writeUInt32LE(0x02014b50, 0);
        cdfh.writeUInt16LE(20, 4); // version made by
        cdfh.writeUInt16LE(20, 6); // version needed
        cdfh.writeUInt16LE(0x0800, 8); // UTF-8
        cdfh.writeUInt16LE(method, 10);
        cdfh.writeUInt16LE(dosTime, 12);
        cdfh.writeUInt16LE(dosDate, 14);
        cdfh.writeUInt32LE(crc, 16);
        cdfh.writeUInt32LE(payload.length, 20);
        cdfh.writeUInt32LE(data.length, 24);
        cdfh.writeUInt16LE(nameBuf.length, 28);
        cdfh.writeUInt16LE(0, 30);
        cdfh.writeUInt16LE(0, 32);
        cdfh.writeUInt16LE(0, 34);
        cdfh.writeUInt16LE(0, 36);
        cdfh.writeUInt32LE(0, 38);
        cdfh.writeUInt32LE(offset, 42);

        centralParts.push(cdfh, nameBuf);
        offset += lfh.length + nameBuf.length + payload.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralBuf, eocd]);
}

fs.mkdirSync(ICONS_DIR, { recursive: true });
fs.writeFileSync(path.join(ICONS_DIR, 'mkg_24.png'), renderPluginIcon(24));
fs.writeFileSync(path.join(ICONS_DIR, 'mkg_32.png'), renderPluginIcon(32));

const files = collectFiles(PLUGIN_DIR);
const zipEntries = files.map((f) => ({
    name: f.rel,
    data: fs.readFileSync(f.full),
    mtime: fs.statSync(f.full).mtime,
}));

const rbzBuffer = createZip(zipEntries);
fs.mkdirSync(path.dirname(OUT_RBZ), { recursive: true });
fs.writeFileSync(OUT_RBZ, rbzBuffer);

console.log(`[build:skp] Packed ${files.length} files -> ${path.relative(ROOT, OUT_RBZ)} (${rbzBuffer.length} bytes)`);
