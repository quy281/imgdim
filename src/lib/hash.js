// Hash nhanh, không mã hoá — chỉ để trả lời "chuỗi này có đổi không?".
// Dùng cho ảnh khảo sát: nếu photo_hash trên cloud khớp local thì bỏ qua, không
// upload/download lại vài trăm KB base64 mỗi lần sync.
// FNV-1a 32-bit chạy hai vòng lệch nhau + độ dài → 72 bit khoá, đủ xa mức đụng độ
// cho vài nghìn ảnh, và nhanh hơn crypto.subtle (đồng bộ, không cần await).
export function hashString(s) {
    if (!s) return '';
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = ((h1 ^ c) * 0x01000193) >>> 0;
        h2 = ((h2 + c) * 0x85ebca6b) >>> 0;
        h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
    }
    return `${s.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}
