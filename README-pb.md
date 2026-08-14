# Backend PocketBase — MKG Khảo Sát v3

Server: `https://db.mkg.vn` (PocketBase v0.23+, sau Cloudflare).

## Áp schema

Script `scripts/pb-setup.mjs` làm toàn bộ việc, chạy lại nhiều lần vẫn an toàn (idempotent).
Nó cần credential superuser — truyền qua biến môi trường để không nằm lại trên đĩa và
không đi vào git.

Xem trước kế hoạch, chưa ghi gì:

```bash
PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/pb-setup.mjs --dry-run
```

Áp thật:

```bash
PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/pb-setup.mjs
```

Trước khi sửa, script tự ghi bản sao schema hiện tại ra `scripts/.pb-backup-<timestamp>.json`.

### Script làm gì

| Bước | Nội dung |
|---|---|
| 1 | Backup schema hiện tại ra file |
| 2 | Tạo collection `teams` + team **MKG**, nạp toàn bộ user hiện có làm thành viên |
| 3 | Tạo collection `shares` (link chia sẻ, id 10 ký tự) |
| 4 | Thêm field vào `survey_items`: `scope`, `team`, `updated_ms`, `deleted`, `rev`, `schema_v`, `photo`, `photo_hash`, `owner_name` + index + API rules |
| 5 | Backfill record cũ: `updated_ms = data.updatedAt`, `scope = private`, `rev = 1`, `schema_v = 2` |

Bước 5 **bắt buộc** — không có `updated_ms`, client sẽ rơi về chế độ tương thích (tải cả
ảnh mỗi lượt sync, đúng cái đang chậm). App vẫn chạy được nếu chưa áp schema, chỉ là chậm;
màn "Kiểm tra đồng bộ" sẽ báo đỏ *"Backend chưa nâng schema v3"*.

## Phân quyền

`survey_items` — đọc và sửa:

```
owner = @request.auth.id || (scope = "team" && team.members.id ?= @request.auth.id)
```

**Mặc định là `team`.** Mọi dự án — kể cả dữ liệu tạo trước khi có lớp user — đều thuộc
team MKG; muốn giữ riêng thì đổi phạm vi trong menu dự án trên app. Đổi mặc định ở
`SCOPE_DEFAULT` trong `src/lib/pb.js` **và** biến cùng tên trong `scripts/pb-setup.mjs`
(hai chỗ phải khớp nhau).

- Dự án `scope = "team"`: cả thành viên team MKG xem **và sửa** được.
- Dự án `private`: chỉ chủ sở hữu thấy, trên mọi máy của mình. Backfill tôn trọng lựa
  chọn này, không kéo ngược về team.
- Xóa cứng record: chỉ chủ sở hữu. Thành viên team xóa dự án chung sẽ tạo soft-delete
  (`deleted = true`) — vẫn lan sang máy người khác, nên nút xóa dự án team có cảnh báo riêng.
- Không ai đổi được `owner` của record người khác (`OWNER_GUARD` trong rule).

`teams` — thành viên đọc được team của mình; **tạo/sửa/xóa team chỉ superuser**. Từ bản này
làm được ngay trong app (xem "Quản lý team & người dùng" bên dưới), không bắt buộc vào PB
Admin UI nữa. Client tự dò lại team ở mỗi lần sync nên thành viên mới không phải đăng nhập lại.

`shares` — chủ sở hữu liệt kê được link của mình để thu hồi. Người ngoài **xem được bằng id**
(10 ký tự, không đoán được); link đã thu hồi hoặc hết hạn trả 404.

## Tài khoản superuser (Founder) cũng sync được

`owner` trên `survey_items` là quan hệ tới collection `users`. Superuser xác thực qua bảng
riêng `_superusers` — id của nó **không tồn tại** trong `users`, nên ghi thẳng id đó vào
`owner` bị PocketBase từ chối (lỗi validate quan hệ). Đây là nguyên nhân tài khoản dùng để
chạy `pb-setup.mjs` (thường cũng là tài khoản Founder dùng hàng ngày) không sync được nếu
đăng nhập thẳng vào app bằng creds đó.

Client tự xử lý: lần đầu đăng nhập bằng superuser, `resolveIdentity()` tìm hoặc tạo một
record `users` cùng email, dùng id của record đó làm `owner`/`team.members` (gọi là
"ownerId" trong code, khác với "myId" — id đăng nhập thô, chỉ dùng để hiển thị). Tự động,
không cần làm gì thêm — chỉ cần đăng nhập lại một lần sau khi cập nhật app.

## Quản lý team & người dùng (trong app, chỉ superuser thấy)

Settings → **Quản lý team & người dùng** (mục này ẩn với tài khoản thường). Làm được:

- Tạo team mới (vd tách riêng Academy / Labs sau này).
- Xem thành viên từng team, thêm người mới bằng email + tên + mật khẩu (bỏ trống mật khẩu
  để tự sinh ngẫu nhiên — **hiện đúng một lần**, phải copy ngay lúc đó vì PocketBase không
  cho đọc lại). Email đã có tài khoản thì chỉ gắn thêm vào team, không tạo trùng.
- Xóa người khỏi team.

Mật khẩu tối thiểu 8 ký tự (`PASSWORD_MIN` trong `pb.js`) — PocketBase từ chối thẳng mật khẩu
ngắn hơn, kể cả khi gõ tay. Muốn tạo hàng loạt qua CLI thay vì tap trong app:

```bash
PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/pb-setup.mjs --skip-backfill \
  --add-users "an@mkg.vn:Anh An,binh@mkg.vn:Chị Bình" --password "mkg-2026-tam"
```

Bỏ `--password` để mỗi người có một mật khẩu ngẫu nhiên riêng, in ra cuối log — an toàn hơn
nhưng phải copy-paste gửi từng người. `--team <slug>` đổi team đích (mặc định `mkg`).

## Nhiều team — chọn team cho từng dự án

Field `team` trên `survey_items` vốn đã là quan hệ chung (không khoá cứng vào MKG), nên
thêm team thứ hai không cần đổi schema. Trên app: dự án chỉ hiện nút bật/tắt "Chia sẻ cho
team X" khi tài khoản chỉ thuộc 1 team (giữ nguyên trải nghiệm hiện tại); thuộc ≥2 team thì
đổi thành picker liệt kê tất cả để chọn đúng team. Superuser luôn thấy **toàn bộ** team (bỏ
qua rule `members.id ?= auth.id`), phù hợp vai trò quản lý chung.

## Optimistic concurrency (`rev`) — mặc định TẮT

Trường `rev` đã có và client vẫn tăng mỗi lần ghi, nhưng rule chưa chặn ghi đè. Bật bằng:

```bash
PB_EMAIL=... PB_PASSWORD='***' node scripts/pb-setup.mjs --enable-rev-cas
```

Rule khi bật thêm điều kiện `@request.body.rev > rev`, biến mọi lần ghi thành compare-and-swap:
máy nào đọc bản cũ rồi ghi sẽ bị 403 thay vì âm thầm đè mất việc của người khác.

**Chỉ bật sau khi test bằng một tài khoản thành viên thật** (không phải superuser — superuser
bỏ qua mọi rule nên không kiểm được gì). Nếu rule sai, mọi lệnh sửa sẽ 403. Tắt lại bằng
cách chạy script không có cờ đó.

## Ảnh khảo sát

Từ schema v3, ảnh nằm ở file field `photo` (`protected: true` → phải có file token mới đọc
được, không lộ qua URL), **không** còn nhúng base64 trong `data`. Client tự chuyển dần:
record `schema_v = 2` được đẩy lại thành v3 ở lần sync sau, giữ nguyên `updated_ms` nên máy
khác không phải tải lại doc.

Trước: mỗi lần sync tải toàn bộ `data` gồm ảnh → ~20MB với 40 ảnh.
Sau: pha 1 chỉ tải metadata (~250 byte/record); ảnh chỉ tải khi `photo_hash` đổi.

## Test

Chạy `npm run dev` rồi mở:

- `/test/sync.test.html` — tầng sync (chặn fetch, không chạm server thật)
- `/test/user.test.html` — lớp user, cách ly dữ liệu giữa tài khoản
- `/test/admin.test.html` — superuser tự có danh tính sync, quản lý team/user, đa team
- `/test/migrate.test.html` — di trú dữ liệu v2 → v3
- `/test/geometry.test.html` — hình học mặt bằng

Tiêu đề tab hiện `N pass` hoặc `N FAIL`.
