# Mini Project: Quản lý sinh viên

Ứng dụng web quản lý sinh viên viết bằng **Node.js**. Project gồm ba phần:

1. **Module quản lý sinh viên** với đủ 11 chức năng: phân trang, thêm, sửa, xem, xóa một/nhiều, tìm kiếm, sao chép một/nhiều, nhập/xuất Excel‑JSON‑XML, ẩn/hiện cột, phím tắt.
2. **Phân quyền người dùng trong CMS** theo mô hình RBAC qua REST API. Quyền gồm Xem, Thêm, Sửa, Xóa, Nhập file, Xuất file và được gán cho từng vai trò.
3. **Nhật ký truy cập qua Nginx** gồm: file log mặc định, cấu trúc `log_format`, các lệnh lọc log theo IP/người dùng/ngày giờ/user-agent/status, và thống kê bằng GoAccess.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Giao diện | HTML/CSS/JavaScript thuần (ES modules), không framework |
| API | Express 5 (REST, JSON) |
| CSDL | SQLite tích hợp sẵn trong Node (`node:sqlite`) |
| Xác thực | JWT HS256 + băm mật khẩu scrypt (`node:crypto`) |
| Upload ảnh | Multer (PNG/JPEG/WebP, tối đa 5 MB, kiểm tra nội dung file) |
| Excel / XML | ExcelJS, fast-xml-parser |
| Reverse proxy & log | Nginx (chạy bằng Docker Compose) |

Đã chạy thử trên **Node.js 26.10**. Yêu cầu tối thiểu là Node.js 24, vì cần `node:sqlite`.

## Cài đặt và chạy

```bash
cd quan-ly-sinh-vien
npm install
npm start            # mở http://localhost:3000
npm test             # chạy bộ kiểm thử API
```

Lần chạy đầu, ứng dụng tự tạo CSDL `data/app.db` với 4 vai trò, 4 tài khoản và 36 sinh viên mẫu.

| Tài khoản | Mật khẩu | Vai trò | Quyền chính |
|---|---|---|---|
| `admin` | `Admin@123` | Quản trị viên | Toàn quyền (vai trò hệ thống, bị khóa sửa) |
| `giaovu` | `Giaovu@123` | Giáo vụ | Toàn quyền sinh viên + xem người dùng |
| `giangvien` | `Giangvien@123` | Giảng viên | Xem, sửa, xuất file sinh viên |
| `viewer` | `Viewer@123` | Người xem | Chỉ xem sinh viên |

Đăng nhập bằng từng tài khoản để thấy giao diện thay đổi theo quyền. Nút nào không có quyền sẽ bị ẩn. Nếu gọi API trực tiếp khi không có quyền, server trả về `403 FORBIDDEN`.

Muốn làm lại dữ liệu mẫu: tắt server, xóa `data/app.db`, rồi chạy lại `npm start`.

## 11 chức năng của module Sinh viên

| # | Chức năng | Cách dùng |
|---|---|---|
| 1 | Bảng phân trang | Mặc định 10 dòng/trang, chọn được 15; có tổng số bản ghi và nút chuyển trang |
| 2 | Thêm mới | Nút **Thêm** / `Alt+N`; biểu mẫu có upload và xem trước ảnh, báo lỗi theo từng trường |
| 3 | Cập nhật | Chọn 1 dòng → **Sửa** / `Alt+U`; giữ ảnh cũ nếu không chọn ảnh mới |
| 4 | Xem chi tiết | Chọn 1 dòng → **Xem** / `Alt+V`; hiển thị mọi trường ở chế độ chỉ đọc |
| 5 | Xóa một / nhiều | Tick checkbox → **Xóa** / `Alt+X`; luôn hỏi xác nhận; xóa nhiều chạy trong một giao dịch |
| 6 | Tìm kiếm | `Alt+Q`; tìm theo mã SV, họ tên, lớp, ngành, email, SĐT, ghi chú; không phân biệt hoa/thường và dấu |
| 7 | Sao chép một | Chọn 1 dòng → **Sao chép** / `Alt+C`; tạo ID mới, thêm hậu tố "(bản sao)" |
| 8 | Sao chép nhiều | Tick nhiều dòng → **Sao chép**; thực hiện toàn bộ hoặc không thực hiện gì |
| 9 | Nhập / xuất | `Alt+I` nhập, `Alt+E` xuất `.xlsx` / `.json` / `.xml`; có file mẫu; báo lỗi theo dòng và trường |
| 10 | Ẩn/hiện cột | `Alt+K`; lưu lựa chọn trong localStorage, có nút khôi phục mặc định |
| 11 | Phím tắt | `Alt+H` mở bảng phím tắt; `Alt+S` lưu, `Esc` đóng hộp thoại |

> Trên macOS, phím **Alt** là phím **Option (⌥)**.

## Phân quyền (RBAC)

Mô hình: **Người dùng → Vai trò → Quyền**. Mỗi quyền có mã dạng `module.action`, ví dụ `student.read`, `student.delete`, `user.update`, `role.update`.

- Tab **Vai trò & phân quyền** có ma trận checkbox: hàng là chức năng, cột là Xem/Thêm/Sửa/Xóa/Nhập/Xuất. Tick rồi bấm Lưu.
- Tab **Người dùng** dùng để tạo tài khoản, gán vai trò, khóa/mở khóa và đặt lại mật khẩu.
- Mỗi request, server đọc lại quyền từ CSDL. Vì vậy thay đổi quyền có hiệu lực ngay, không cần đăng nhập lại.

Chi tiết xem [docs/PHAN-QUYEN.md](docs/PHAN-QUYEN.md).

## Nhật ký truy cập Nginx

```bash
npm start                       # ứng dụng chạy ở cổng 3000
docker compose up -d            # Nginx reverse proxy ở http://localhost:8080
tail -f nginx/logs/access.log   # xem log truy cập thật
./scripts/log-report.sh -f nginx/sample-logs/access.log -s 403   # lọc log mẫu
```

Server gửi header `X-User`. Nginx ghi giá trị đó vào log, nhờ vậy biết được **ai** truy cập, ngoài IP và thời gian. Nginx cũng ẩn header này khỏi trình duyệt.

Chi tiết xem [docs/NGINX-LOG.md](docs/NGINX-LOG.md): file log mặc định, giải thích `log_format`, các lệnh `awk`/`grep`, lọc theo ngày/giờ, user-agent, status code, và GoAccess.

## Cấu trúc thư mục

```
server.js                 Điểm khởi động
src/
  app.js                  Tạo ứng dụng Express
  db/                     Kết nối SQLite, tạo bảng, dữ liệu mẫu
  constants/              Danh mục quyền
  middlewares/            Xác thực, phân quyền, upload, xử lý lỗi
  routes/ controllers/ services/ repositories/   Tách lớp theo chức năng
  utils/                  JWT, mật khẩu, chuẩn hóa tiếng Việt, kiểm tra dữ liệu
public/                   Giao diện (login.html, index.html, css, js)
tests/                    Kiểm thử API (node:test)
nginx/                    Cấu hình Nginx, log mẫu, báo cáo GoAccess
scripts/                  Script sinh log mẫu và lọc log
docs/                     Tài liệu phân quyền và nhật ký Nginx
SPEC.md                   Đặc tả kỹ thuật (API, CSDL, quyền)
```

## API chính

Đặc tả đầy đủ nằm trong [SPEC.md](SPEC.md). Mọi API (trừ đăng nhập) cần header `Authorization: Bearer <token>`.

| Phương thức & đường dẫn | Quyền |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | — |
| `GET /api/students?page=&pageSize=&q=`, `GET /api/students/:id` | `student.read` |
| `POST /api/students`, `POST /api/students/bulk-copy` | `student.create` |
| `PUT /api/students/:id` | `student.update` |
| `DELETE /api/students/:id`, `POST /api/students/bulk-delete` | `student.delete` |
| `POST /api/students/import`, `GET /api/students/template?format=` | `student.import` |
| `GET /api/students/export?format=&q=` | `student.export` |
| `GET/POST/PUT/DELETE /api/users…` | `user.read/create/update/delete` |
| `GET /api/permissions`, `GET/POST/PUT/DELETE /api/roles…` | `role.read/create/update/delete` |
