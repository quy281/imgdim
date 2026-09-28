import * as pb from './pb';

const LOCAL_KEY = 'mkg_experience_posts_v1';

export const EXPERIENCE_LIBRARY = [
    {
        id: 'board-zigzag',
        category: 'Quản lý ván tồn',
        type: 'youtube',
        title: 'Đo ván khuyết trước khi xuất DXF',
        desc: 'Quy trình đo biên ván, đặt mã, lưu kho và kiểm tra kích thước trước khi đưa vào plan cắt.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'blue',
        updatedAt: 20260928,
    },
    {
        id: 'cut-price',
        category: 'Cắt ván',
        type: 'article',
        title: 'Bảng giá cắt ván và dán chỉ',
        desc: 'Xem đơn giá cắt ván, dán chỉ, khoan cam/chốt và các lưu ý khi gửi file gia công.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'red',
        updatedAt: 20260927,
    },
    {
        id: 'cnc-file',
        category: 'CNC / khoan',
        type: 'tiktok',
        title: 'Chuẩn bị file DXF để gia công',
        desc: 'Checklist layer, đơn vị mm, mã chi tiết và cách ghi chú để xưởng đọc file nhanh hơn.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'violet',
        updatedAt: 20260926,
    },
    {
        id: 'stock-code',
        category: 'Quản lý ván tồn',
        type: 'article',
        title: 'Cách đặt mã ván tồn dễ tìm trong kho',
        desc: 'Gợi ý mã theo vật liệu, dày, màu, vị trí A1/A2 để giảm nhầm lẫn khi xuất kho.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'green',
        updatedAt: 20260924,
    },
];

export const EXPERIENCE_CATEGORIES = [
    'Tất cả', 'Đo hiện trạng', 'Quản lý ván tồn', 'Tối ưu cắt ván',
    'Cắt ván', 'Dán chỉ', 'CNC / khoan', 'Vẽ 3D', 'Phụ kiện',
];

const TONES = ['blue', 'red', 'violet', 'green'];

function readLocalPosts() {
    try {
        const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
        return Array.isArray(rows) ? rows : [];
    } catch {
        return [];
    }
}

function writeLocalPosts(rows) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
}

function currentOwnerId() {
    return pb.ownerId?.() || pb.myId?.() || 'anon';
}

function normalizePost(row) {
    const submittedMs = Number(row.submittedMs || row.submitted_ms || row.updatedAt || Date.now());
    return {
        id: row.id || `local-${submittedMs}`,
        source: row.source || 'local',
        ownerId: row.ownerId || row.owner || currentOwnerId(),
        ownerName: row.ownerName || row.owner_name || pb.ownerName?.() || '',
        category: row.category || 'Chia sẻ kinh nghiệm',
        type: row.type || detectVideoType(row.detailUrl || row.detail_url || ''),
        title: row.title || '',
        desc: row.desc || '',
        detailUrl: row.detailUrl || row.detail_url || '',
        embedUrl: row.embedUrl || row.embed_url || '',
        status: row.status || 'pending',
        submittedMs,
        updatedAt: submittedMs,
        thumbTone: row.thumbTone || TONES[Math.abs(hash(row.category || row.title || 'x')) % TONES.length],
        cloudId: row.cloudId || '',
    };
}

function visibleLocalPosts() {
    const owner = currentOwnerId();
    return readLocalPosts()
        .map(normalizePost)
        .filter(x => x.status === 'public' || x.ownerId === owner || pb.isAdmin?.());
}

export function detectVideoType(url) {
    const s = String(url || '').toLowerCase();
    if (s.includes('youtube.com') || s.includes('youtu.be')) return 'youtube';
    if (s.includes('tiktok.com')) return 'tiktok';
    if (s.includes('facebook.com') || s.includes('fb.watch')) return 'facebook';
    return 'article';
}

export function embedUrlFor(url) {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') {
            const id = u.pathname.split('/').filter(Boolean)[0];
            return id ? `https://www.youtube.com/embed/${id}` : '';
        }
        if (host.endsWith('youtube.com')) {
            const id = u.searchParams.get('v') || u.pathname.match(/\/shorts\/([^/?]+)/)?.[1] || u.pathname.match(/\/embed\/([^/?]+)/)?.[1];
            return id ? `https://www.youtube.com/embed/${id}` : '';
        }
        if (host.endsWith('tiktok.com')) {
            const id = u.pathname.match(/\/video\/(\d+)/)?.[1];
            return id ? `https://www.tiktok.com/embed/v2/${id}` : '';
        }
        if (host.endsWith('facebook.com') || host === 'fb.watch') {
            return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(raw)}&show_text=false&width=560`;
        }
    } catch {
        return '';
    }
    return '';
}

function hash(s) {
    return [...String(s || '')].reduce((n, ch) => ((n << 5) - n + ch.charCodeAt(0)) | 0, 0);
}

function staticItems() {
    return EXPERIENCE_LIBRARY.map(x => ({
        ...x,
        source: 'library',
        status: 'public',
        submittedMs: Number(x.updatedAt || 0),
    }));
}

export async function loadExperienceItems() {
    let cloud = [];
    if (pb.isLoggedIn?.()) {
        try {
            cloud = await pb.listExperiencePosts();
        } catch (err) {
            console.warn('loadExperienceItems:', err.message);
        }
    }
    const cloudIds = new Set(cloud.map(x => x.id));
    const local = visibleLocalPosts().filter(x => !x.cloudId || !cloudIds.has(x.cloudId));
    return [...staticItems(), ...cloud, ...local]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .filter(x => x.status !== 'rejected' || x.ownerId === currentOwnerId() || pb.isAdmin?.());
}

export async function addExperiencePost(input) {
    const detailUrl = String(input.detailUrl || '').trim();
    const post = normalizePost({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source: 'local',
        ownerId: currentOwnerId(),
        ownerName: pb.ownerName?.() || '',
        category: input.category,
        title: input.title,
        desc: input.desc,
        detailUrl,
        embedUrl: embedUrlFor(detailUrl),
        type: detectVideoType(detailUrl),
        status: 'pending',
        submittedMs: Date.now(),
    });
    const rows = [post, ...readLocalPosts()];
    writeLocalPosts(rows);
    try {
        const saved = await pb.createExperiencePost(post);
        writeLocalPosts(rows.map(x => x.id === post.id ? { ...post, cloudId: saved.id } : x));
        return saved;
    } catch (err) {
        if (err.status === 404 || err.status === 403 || err.status === 0) return post;
        throw err;
    }
}

export async function updateExperienceStatus(item, status) {
    if (item.source === 'cloud') return pb.reviewExperiencePost(item.id, status);
    const rows = readLocalPosts().map(x => x.id === item.id ? { ...x, status } : x);
    writeLocalPosts(rows);
    return { ...item, status };
}

export function latestExperienceFrom(items, limit = 3) {
    return [...(items || [])]
        .filter(x => x.status === 'public')
        .sort((a, b) => Number(b.updatedAt || b.submittedMs || 0) - Number(a.updatedAt || a.submittedMs || 0))
        .slice(0, limit);
}

export function latestExperience(limit = 3) {
    return latestExperienceFrom(staticItems(), limit);
}
