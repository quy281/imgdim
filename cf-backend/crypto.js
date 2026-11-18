import bcrypt from 'bcryptjs';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const enc = new TextEncoder();

export function genId15() {
    const bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < 15; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return out;
}

export function nowIso(ms = Date.now()) {
    return new Date(ms).toISOString();
}

export function normalizeUtcCompare(s) {
    if (!s) return '';
    return String(s).trim().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function toB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function toB64Url(bytes) {
    return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
    const norm = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
    return fromB64(norm + pad);
}

export function timingSafeEqual(a, b) {
    const ua = a instanceof Uint8Array ? a : enc.encode(String(a));
    const ub = b instanceof Uint8Array ? b : enc.encode(String(b));
    if (ua.length !== ub.length) return false;
    let diff = 0;
    for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
    return diff === 0;
}

const PBKDF2_ITER = 100_000;

export async function hashPasswordPBKDF2(password) {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
        key,
        256,
    );
    return `pbkdf2$${PBKDF2_ITER}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return { ok: false, needsUpgrade: false };
    const pw = String(password ?? '');

    if (storedHash.startsWith('pbkdf2$')) {
        const parts = storedHash.split('$');
        if (parts.length !== 4) return { ok: false, needsUpgrade: false };
        const iter = Number(parts[1]);
        if (!Number.isFinite(iter) || iter < 1000) return { ok: false, needsUpgrade: false };
        const salt = fromB64(parts[2]);
        const expected = fromB64(parts[3]);
        const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
            key,
            expected.length * 8,
        );
        return { ok: timingSafeEqual(new Uint8Array(bits), expected), needsUpgrade: false };
    }

    if (storedHash.startsWith('$2')) {
        const norm = storedHash.startsWith('$2y$') ? '$2a$' + storedHash.slice(4) : storedHash;
        const ok = bcrypt.compareSync(pw, norm);
        return { ok, needsUpgrade: ok };
    }

    return { ok: false, needsUpgrade: false };
}

async function importHmacKey(secret, usage) {
    if (!secret) throw new Error('Missing JWT_SECRET environment variable');
    return crypto.subtle.importKey(
        'raw',
        enc.encode(String(secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        [usage],
    );
}

export async function signJwt(payload, secret, ttlSec = 30 * 86400) {
    const nowSec = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: nowSec, exp: nowSec + ttlSec };
    const headB64 = toB64Url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const bodyB64 = toB64Url(enc.encode(JSON.stringify(fullPayload)));
    const signingInput = `${headB64}.${bodyB64}`;
    const key = await importHmacKey(secret, 'sign');
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)));
    return `${signingInput}.${toB64Url(sig)}`;
}

export async function verifyJwt(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const raw = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    try {
        const key = await importHmacKey(secret, 'verify');
        const sig = fromB64Url(parts[2]);
        const valid = await crypto.subtle.verify('HMAC', key, sig, enc.encode(`${parts[0]}.${parts[1]}`));
        if (!valid) return null;
        const payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && nowSec >= payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}
