# Huong dan Chuyen han sang Cloudflare & Backup Google Drive

Kien truc moi cua **MKG Khao Sat (`do.mkg.vn`)** tren Cloudflare:

- **Frontend + API**: Cloudflare Pages (`imgdim`) + **Pages Functions** (`/api/*` trong [`functions/api/[[route]].js`](functions/api/%5B%5Broute%5D%5D.js)).
- **Co so du lieu cau truc**: **Cloudflare D1** (`mkg-khaosat-db`) — bang & quyen tuong thich 100% logic sync 2 pha.
- **Anh khao sat, goi khach >180KB & Thư viện 3D FADI**: **Cloudflare R2** (`mkg-khaosat-media`) — mien phi 10GB dau, **0d phi egress**, tu dong offload khoi D1 de khong vuot gioi han 2MB/row.
- **Backup dinh ky hang dem**: Worker doc lap [`workers/backup-cron`](workers/backup-cron/wrangler.toml) chay Cron `0 19 * * *` (02:00 sang VN) dump D1 (`.json.gz`) + dong bo tang dan anh/file R2 thang sang **Google Drive** (va giu 30 ban noi bo tren R2).

---

## Lo trinh chuyen doi an toan (khong gian doan app dang chay)

Hien `do.mkg.vn` van de mac dinh tro `https://db.mkg.vn` cho den khi anh/chi xong cac buoc duoi day (co the test song song ngay bang `?backend=cf`).

### Buoc 1: Bat Cloudflare R2 (1 lan tren Dashboard)
1. Mo https://dash.cloudflare.com → chon tai khoan `Quy28181818@gmail.com` → muc **R2 Object Storage** → bam **Enable R2** (goi Mien phi co san 10 GB/thang, 0d egress).

### Buoc 2: Hoan tat R2 bucket & cap nhat binding R2
*(D1 `mkg-khaosat-db`, schema 13 bang, `JWT_SECRET`/`BACKUP_SECRET`, `wrangler.toml` va Cron Worker endpoint da duoc deploy san!)*
```bash
node scripts/cf-setup.mjs --provision --deploy-cron --deploy-pages
```
Lenh nay se tu:
- Tao R2 bucket `mkg-khaosat-media`.
- Mo `[[r2_buckets]]` trong `wrangler.toml` & `workers/backup-cron/wrangler.toml` va deploy lai Cloudflare Pages (`imgdim`) + Backup Worker.

> **Luu y gioi han Cron mien phi cua Cloudflare**: Tai khoan Cloudflare hien tai da dung het 5/5 Cron Trigger goi Free (ma loi `10072`). Co 2 cach bat chay tu dong 02:00 sang VN:
> - **Cach 1 (0d, khong can nang goi CF)**: Them secret `BACKUP_SECRET` vao GitHub Repo (`quy281/imgdim` -> Settings -> Secrets and variables -> Actions) de [daily-backup.yml](.github/workflows/daily-backup.yml) goi `POST https://do.mkg.vn/api/backup/run` luc 02:00 sang hang ngay.
> - **Cach 2**: Nang cap Workers Paid (\$5/thang — tang gioi han Cron len 1.000 va CPU tu 10ms len 30s, tot cho ca verify bcrypt lan dau) hoac xoa bot 1 Cron cu tren Dashboard roi chay `node scripts/cf-setup.mjs --deploy-cron`.

### Buoc 3: Chuyen toan bo du lieu cu tu `db.mkg.vn` sang Cloudflare
**Cach A (Khuyen dung — giu nguyen 100% mat khau & PIN cu):**
1. Vao PocketBase Admin (`https://db.mkg.vn/_/`) -> Settings -> Backups -> tai file backup `.zip` va giai nen vao thu muc (VD: `C:\pb-backup`).
2. Chay:
```bash
node scripts/migrate-pb-to-cf.mjs --pb-dir C:\pb-backup --push --db mkg-khaosat-db --bucket mkg-khaosat-media
```

**Cach B (Chuyen qua HTTP API neu chua tien lay file backup):**
```bash
PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/migrate-pb-to-cf.mjs --pb-live --fallback-pin 1111 --push
```

### Buoc 4: Ket noi Google Drive cho Backup dinh ky
1. Trong Google Cloud Console (cua tai khoan Google giu Drive backup), bat **Google Drive API**, tao **OAuth Client ID (Desktop app)**.
2. Chay script xac thuc & tu dong nap secret len Cloudflare:
```bash
GDRIVE_CLIENT_ID=... GDRIVE_CLIENT_SECRET=... node scripts/gdrive-auth.mjs --push-cf
```
3. Deploy Worker Cron Backup (chay 02:00 sang VN hang ngay):
```bash
node scripts/cf-setup.mjs --deploy-cron
```

### Buoc 5: Kiem tra song song & Cat chuyen chinh thuc (Cutover)
1. Mo **`https://do.mkg.vn/?backend=cf`** tren trinh duyet (app se bam sang Cloudflare D1 + R2 ma khong anh huong nhan vien khac).
2. Dang nhap, dong bo 1 du an + anh + mo **Cai dat -> Quan ly team -> Sao luu & Backup -> Bam Backup ngay** de kiem tra file `.json.gz` va thu muc `MKG-KhaoSat-Backups` xuat hien tren Google Drive.
3. Khi moi thu OK 100%, vao **Cloudflare Dashboard -> Pages (`imgdim`) -> Settings -> Environment variables**, them **`VITE_BACKEND_URL`** = `""` (chuoi rong) va **Retry deployment** (hoac xoa fallback `'https://db.mkg.vn'` trong `src/lib/pb.js`) de toan bo nhan vien dung Cloudflare mac dinh.

---

## Khoi phuc khi gap su co (Disaster Recovery)
- **Khoi phuc tu file backup Google Drive (`mkg-db-YYYY-MM-DD_HHmm.json.gz`)**:
```bash
node scripts/migrate-pb-to-cf.mjs --restore-file C:\Downloads\mkg-db-2026-11-19_0200.json.gz --push --db mkg-khaosat-db
```
- Ngoai ra Cloudflare D1 co san **Time Travel** (`npx wrangler d1 time-travel restore mkg-khaosat-db --timestamp=...`) giup quay nguoc DB trong 7-30 ngay.
