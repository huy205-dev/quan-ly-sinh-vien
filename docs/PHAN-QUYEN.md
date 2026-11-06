# Phân quyền người dùng (RBAC) qua REST API

Tài liệu cho phần **"Phân quyền người dùng trong hệ thống CMS (Permission for user - REST API)"**
của mini project *Quản lý sinh viên*. Đề bài gồm hai việc:

1. **Định nghĩa các chức năng của hệ thống cần phân quyền.**
2. **Thiết lập các quyền (Read, Create, Update, Delete…) cho người dùng khi truy cập hệ thống.**

Hệ thống dùng mô hình **RBAC** (Role-Based Access Control, phân quyền theo vai trò):
quyền không gán thẳng cho từng người dùng mà gán cho **vai trò**, rồi mỗi người dùng được gán
một vai trò. Mọi kiểm tra quyền đều diễn ra ở **backend** (REST API). Giao diện chỉ ẩn các nút
mà người dùng không được dùng.

> Các ví dụ `curl` ở mục 8 và các lệnh ở mục 9 đã được chạy thật (app chạy bằng `npm start`
> với CSDL mẫu mới tạo, ngày 06/11/2026); kết quả in ra là kết quả thật. Khi bạn tự chạy,
> token và các mốc thời gian (`LastLoginDate`, `iat`, `exp`) sẽ khác.

## Mục lục

1. [Khái niệm: xác thực và phân quyền](#1-khái-niệm-xác-thực-và-phân-quyền)
2. [Các chức năng cần phân quyền](#2-các-chức-năng-cần-phân-quyền)
3. [Mô hình RBAC: User, Role, Permission](#3-mô-hình-rbac-user-role-permission)
4. [Luồng xử lý một request](#4-luồng-xử-lý-một-request)
5. [Ma trận quyền của 4 vai trò mẫu](#5-ma-trận-quyền-của-4-vai-trò-mẫu)
6. [Bảng API và quyền cần có](#6-bảng-api-và-quyền-cần-có)
7. [Quy tắc nghiệp vụ](#7-quy-tắc-nghiệp-vụ)
8. [Thực hành với curl](#8-thực-hành-với-curl)
9. [Đối chiếu với nhật ký Nginx](#9-đối-chiếu-với-nhật-ký-nginx)
10. [Mã nguồn liên quan](#10-mã-nguồn-liên-quan)

## 1. Khái niệm: xác thực và phân quyền

| | Xác thực (authentication) | Phân quyền (authorization) |
|---|---|---|
| Câu hỏi | "Bạn là ai?" | "Bạn được làm gì?" |
| Cách làm trong dự án | Đăng nhập bằng tên + mật khẩu, nhận **JWT**; mỗi request gửi header `Authorization: Bearer <token>` | So mã quyền mà API yêu cầu (ví dụ `student.delete`) với danh sách quyền của vai trò người dùng |
| Lỗi khi không đạt | **401 Unauthorized**: thiếu token, token sai, hết hạn, tài khoản đã bị khóa | **403 Forbidden**: đã đăng nhập nhưng không có quyền |
| Middleware | `authenticate` | `authorize(...mãQuyền)` |

Ba khái niệm của RBAC:

- **Permission (quyền)**: một thao tác trên một chức năng, mã dạng `module.action`, ví dụ
  `student.read` (xem sinh viên), `student.export` (xuất file sinh viên).
- **Role (vai trò)**: một nhóm quyền đặt tên theo nghiệp vụ: *Quản trị viên*, *Giáo vụ*,
  *Giảng viên*, *Người xem*.
- **User (người dùng)**: một tài khoản đăng nhập, thuộc đúng **một** vai trò.

## 2. Các chức năng cần phân quyền

Hệ thống có 3 nhóm chức năng (module). Ngoài 4 thao tác cơ bản **Read / Create / Update /
Delete**, module Sinh viên có thêm 2 thao tác **Import** (nhập file) và **Export** (xuất file),
chính là phần "…" trong đề bài. Danh mục quyền nằm trong `src/constants/permissions.js`
(mỗi lần khởi động, bảng `Permissions` trong CSDL được đồng bộ theo file này).

| Module | Mã quyền | Tên trên giao diện | Bảo vệ chức năng | Vì sao cần phân quyền |
|---|---|---|---|---|
| Sinh viên | `student.read` | Xem | Danh sách (phân trang), xem chi tiết, tìm kiếm | Đây là dữ liệu cá nhân (ngày sinh, email, số điện thoại, địa chỉ, điểm GPA); chỉ người có nhiệm vụ mới được xem |
| | `student.create` | Thêm | Thêm mới, sao chép 1 hoặc nhiều sinh viên | Tạo bản ghi mới làm thay đổi dữ liệu gốc. Sao chép thực chất là tạo mới nên dùng chung quyền này |
| | `student.update` | Sửa | Cập nhật thông tin, đổi/xóa ảnh | Sửa điểm, thông tin liên lạc là thao tác nhạy cảm, cần biết ai được sửa |
| | `student.delete` | Xóa | Xóa 1 sinh viên, xóa nhiều sinh viên đã chọn | Xóa không hoàn tác được; xóa hàng loạt càng nguy hiểm |
| | `student.import` | Nhập file | Nhập từ Excel/JSON/XML, tải file mẫu | Thêm tới 1000 dòng một lúc và phải đọc file do người dùng gửi lên: rủi ro dữ liệu rác, file độc hại. Tách khỏi `create` để chỉ giao cho người chịu trách nhiệm nhập liệu |
| | `student.export` | Xuất file | Xuất toàn bộ kết quả tìm kiếm ra xlsx/json/xml | Lấy **toàn bộ** dữ liệu ra khỏi hệ thống trong một lần (nguy cơ rò rỉ dữ liệu cá nhân). Xem từng trang (`read`) khác với tải về tất cả |
| Người dùng | `user.read` | Xem | Danh sách, chi tiết tài khoản | Lộ danh sách tài khoản, email, vai trò, trạng thái khóa |
| | `user.create` | Thêm | Tạo tài khoản | Tạo tài khoản đồng nghĩa với cấp quyền truy cập hệ thống |
| | `user.update` | Sửa | Sửa thông tin, đổi vai trò, đặt lại mật khẩu, khóa/mở khóa | Đặt lại mật khẩu người khác = chiếm được tài khoản đó; đổi vai trò = nâng quyền |
| | `user.delete` | Xóa | Xóa tài khoản | Mất tài khoản và lịch sử gắn với nó |
| Vai trò & phân quyền | `role.read` | Xem | Danh sách vai trò, danh mục quyền (ma trận) | Biết cấu hình phân quyền là biết "ai làm được gì" |
| | `role.create` | Thêm | Tạo vai trò mới | Tạo nhóm quyền mới |
| | `role.update` | Sửa | Đổi tên vai trò, **gán quyền** cho vai trò | Quyền mạnh nhất: ai có nó có thể tự thêm quyền cho vai trò của mình, nên chỉ giao cho quản trị viên |
| | `role.delete` | Xóa | Xóa vai trò | Xóa nhầm làm người dùng mất quyền |

Những phần **không** cần quyền:

- `POST /api/auth/login`: công khai (chưa đăng nhập thì chưa có quyền gì).
- `GET /api/auth/me`: chỉ cần token hợp lệ (ai cũng được xem thông tin và quyền của chính mình).
- File tĩnh của giao diện: `/`, `/login.html`, `/css`, `/js`, `/uploads`.

## 3. Mô hình RBAC: User, Role, Permission

```mermaid
erDiagram
    Roles ||--o{ Users : "gán cho"
    Roles ||--o{ RolePermissions : "có"
    Permissions ||--o{ RolePermissions : "được gán qua"
    Users {
        INTEGER UserID PK
        TEXT Username UK "3-30 ký tự, không đổi sau khi tạo"
        TEXT PasswordHash "scrypt, không bao giờ trả về API"
        TEXT FullName
        TEXT Email
        INTEGER RoleID FK
        INTEGER IsActive "1 hoạt động, 0 bị khóa"
        TEXT LastLoginDate
        TEXT CreateDate
        TEXT UpdateDate
    }
    Roles {
        INTEGER RoleID PK
        TEXT Code UK "admin, giaovu, giangvien, viewer"
        TEXT Name
        TEXT Description
        INTEGER IsSystem "1 = vai trò hệ thống"
        TEXT CreateDate
        TEXT UpdateDate
    }
    Permissions {
        TEXT Code PK "module.action"
        TEXT Module
        TEXT Action
        TEXT Name
    }
    RolePermissions {
        INTEGER RoleID PK, FK
        TEXT PermissionCode PK, FK
    }
```

- **User → Role** là quan hệ nhiều-một: mỗi người dùng có đúng một vai trò (`Users.RoleID`),
  một vai trò có nhiều người dùng.
- **Role ↔ Permission** là quan hệ nhiều-nhiều, lưu trong bảng nối `RolePermissions`
  (khóa chính kép `RoleID + PermissionCode`; xóa vai trò thì các dòng gán quyền bị xóa theo
  nhờ `ON DELETE CASCADE`).
- Quyền của một người dùng = quyền của vai trò người đó. Riêng vai trò hệ thống
  (`IsSystem = 1`, tức `admin`) luôn có **toàn bộ** quyền, kể cả quyền mới thêm vào danh mục sau này.

Vì sao dùng RBAC thay vì gán quyền cho từng người?

- Trường có thể có hàng chục giáo vụ: chỉ cần chỉnh vai trò *Giáo vụ* một lần là tất cả được cập nhật.
- Dễ kiểm tra theo **nguyên tắc đặc quyền tối thiểu** (least privilege): nhìn ma trận là biết
  vai trò nào có quyền thừa.
- Khi cần linh hoạt hơn có thể mở rộng: một người nhiều vai trò (thêm bảng `UserRoles`),
  hoặc quyền theo phạm vi dữ liệu (giảng viên chỉ sửa lớp mình dạy).

## 4. Luồng xử lý một request

Ví dụ: người dùng bấm **Xóa** một sinh viên.

```mermaid
sequenceDiagram
    autonumber
    actor U as Người dùng
    participant N as Nginx :8080
    participant A as authenticate
    participant Z as authorize(student.delete)
    participant C as Controller, Service
    participant DB as SQLite

    U->>N: DELETE /api/students/12<br/>Authorization: Bearer eyJ...
    N->>A: proxy_pass tới app :3000<br/>kèm X-Real-IP, X-Forwarded-For
    alt Không có token, sai chữ ký hoặc hết hạn (8 giờ)
        A-->>N: 401 UNAUTHORIZED
    else Token hợp lệ
        A->>DB: Nạp lại User + Role + Permissions theo UserID trong token
        DB-->>A: user, permissions
        alt Tài khoản đã bị xóa hoặc bị khóa
            A-->>N: 401 UNAUTHORIZED
        else Tài khoản hợp lệ
            A->>Z: req.auth = user + permissions, đặt header X-User
            alt Vai trò không có student.delete
                Z-->>N: 403 FORBIDDEN, kèm "permission": "student.delete"
            else Có quyền
                Z->>C: next()
                C->>DB: Xóa sinh viên 12
                C-->>N: 200 {"deleted":1}
            end
        end
    end
    N-->>U: Trả response (đã xóa header X-User) và ghi 1 dòng access.log
```

Các điểm cần nhớ:

1. **Token chỉ chứa `sub` (UserID), `iat`, `exp`**, không chứa danh sách quyền. Ở **mỗi
   request**, `authenticate` đọc lại người dùng và quyền từ CSDL. Nhờ vậy khi quản trị viên
   đổi quyền hoặc khóa tài khoản, thay đổi có hiệu lực **ngay ở request kế tiếp**, không phải
   chờ người dùng đăng nhập lại (xem ví dụ thật ở mục 8.5). Cái giá phải trả là vài truy vấn
   SQLite mỗi request, không đáng kể với hệ thống nhỏ.
2. `authenticate` đặt header `X-User: <username>` **trước** khi kiểm tra quyền, nên cả request
   bị 403 cũng ghi được tên người dùng vào log Nginx (biết *ai* đang cố làm việc không được phép).
3. `authorize` được đặt **trước** middleware upload (multer): request không có quyền bị chặn
   trước khi server đọc file gửi lên.
4. `authorize(a, b, ...)` cho qua nếu người dùng có **ít nhất một** trong các quyền, ví dụ
   `GET /api/roles/options` (danh sách vai trò cho ô chọn ở form người dùng) chỉ cần một trong
   `user.read`, `user.create`, `user.update`, `role.read`.

Phân biệt 401 và 403 trong dự án:

| Tình huống | Mã | `error.code` |
|---|---|---|
| Không gửi header `Authorization` | 401 | `UNAUTHORIZED` |
| Token sai chữ ký / sai định dạng / hết hạn | 401 | `UNAUTHORIZED` |
| Token hợp lệ nhưng tài khoản đã bị khóa hoặc bị xóa | 401 | `UNAUTHORIZED` |
| Đăng nhập sai tên hoặc mật khẩu | 401 | `UNAUTHORIZED` |
| Đăng nhập đúng mật khẩu nhưng tài khoản bị khóa | 403 | `ACCOUNT_LOCKED` |
| Đã đăng nhập nhưng vai trò thiếu quyền | 403 | `FORBIDDEN` (kèm `permission`) |

## 5. Ma trận quyền của 4 vai trò mẫu

Dữ liệu mẫu (tạo khi CSDL còn trống, `src/db/seed.js`):

| Vai trò | Mã | Hệ thống | Tài khoản mẫu |
|---|---|---|---|
| Quản trị viên | `admin` | Có (`IsSystem = 1`) | `admin` / `Admin@123` |
| Giáo vụ | `giaovu` | Không | `giaovu` / `Giaovu@123` |
| Giảng viên | `giangvien` | Không | `giangvien` / `Giangvien@123` |
| Người xem | `viewer` | Không | `viewer` / `Viewer@123` |

Ma trận quyền (✓ = có quyền):

| Module | Quyền | Quản trị viên | Giáo vụ | Giảng viên | Người xem |
|---|---|:---:|:---:|:---:|:---:|
| Sinh viên | Xem `student.read` | ✓ | ✓ | ✓ | ✓ |
| | Thêm `student.create` | ✓ | ✓ | | |
| | Sửa `student.update` | ✓ | ✓ | ✓ | |
| | Xóa `student.delete` | ✓ | ✓ | | |
| | Nhập file `student.import` | ✓ | ✓ | | |
| | Xuất file `student.export` | ✓ | ✓ | ✓ | |
| Người dùng | Xem `user.read` | ✓ | ✓ | | |
| | Thêm `user.create` | ✓ | | | |
| | Sửa `user.update` | ✓ | | | |
| | Xóa `user.delete` | ✓ | | | |
| Vai trò & phân quyền | Xem `role.read` | ✓ | | | |
| | Thêm `role.create` | ✓ | | | |
| | Sửa `role.update` | ✓ | | | |
| | Xóa `role.delete` | ✓ | | | |
| | **Tổng số quyền** | **14** | **7** | **3** | **1** |

Đọc ma trận theo nghiệp vụ:

- **Giáo vụ** quản lý trọn vẹn hồ sơ sinh viên (kể cả nhập/xuất file) và được xem danh sách tài
  khoản, nhưng không tạo/sửa tài khoản và không đụng tới phân quyền.
- **Giảng viên** xem, cập nhật (ví dụ điểm GPA) và xuất danh sách lớp, nhưng không thêm/xóa
  sinh viên.
- **Người xem** chỉ đọc.

Trên giao diện, trang **Vai trò** hiển thị đúng ma trận này cho từng vai trò (hàng = module,
cột = Xem/Thêm/Sửa/Xóa/Nhập file/Xuất file; ô trống khi module không có thao tác đó). Lưu
ma trận chính là gọi `PUT /api/roles/:id` với danh sách mã quyền. Vai trò hệ thống hiển thị
khóa (tất cả đã chọn, không sửa được).

## 6. Bảng API và quyền cần có

Lấy từ `src/routes/*.routes.js`:

| Phương thức | Endpoint | Quyền cần có | Ghi chú |
|---|---|---|---|
| POST | `/api/auth/login` | (công khai) | Trả `{ token, user, permissions }` |
| GET | `/api/auth/me` | (chỉ cần token) | Thông tin + quyền hiện tại của chính mình |
| GET | `/api/students?page=&pageSize=&q=` | `student.read` | Phân trang 10/15, tìm kiếm không dấu |
| GET | `/api/students/:id` | `student.read` | |
| POST | `/api/students` | `student.create` | multipart, có thể kèm ảnh |
| PUT | `/api/students/:id` | `student.update` | multipart |
| DELETE | `/api/students/:id` | `student.delete` | |
| POST | `/api/students/bulk-delete` | `student.delete` | `{ ids: [...] }`, tất cả hoặc không gì cả |
| POST | `/api/students/bulk-copy` | `student.create` | Sao chép 1 hoặc nhiều |
| POST | `/api/students/import` | `student.import` | xlsx/json/xml, tối đa 10 MB, 1000 dòng |
| GET | `/api/students/template?format=` | `student.import` | File mẫu để nhập |
| GET | `/api/students/export?format=&q=` | `student.export` | Toàn bộ kết quả khớp `q` |
| GET | `/api/users`, `/api/users/:id` | `user.read` | |
| POST | `/api/users` | `user.create` | |
| PUT | `/api/users/:id` | `user.update` | Kể cả đặt lại mật khẩu, khóa/mở khóa |
| DELETE | `/api/users/:id` | `user.delete` | |
| GET | `/api/permissions` | `role.read` | Danh mục quyền cho ma trận |
| GET | `/api/roles`, `/api/roles/:id` | `role.read` | |
| GET | `/api/roles/options` | một trong `user.read`, `user.create`, `user.update`, `role.read` | Cho ô chọn vai trò ở form người dùng |
| POST | `/api/roles` | `role.create` | `{ Code, Name, Description?, Permissions }` |
| PUT | `/api/roles/:id` | `role.update` | Đổi tên/mô tả, **gán quyền** |
| DELETE | `/api/roles/:id` | `role.delete` | |

Trong code, mỗi route khai báo quyền ngay cạnh đường dẫn, ví dụ (`src/routes/student.routes.js`):

```js
router.use(authenticate);                                         // mọi route bên dưới cần đăng nhập
router.get('/', authorize(P.STUDENT_READ), controller.list);
router.post('/import', authorize(P.STUDENT_IMPORT), uploads.importUpload, controller.importFile);
router.delete('/:id', authorize(P.STUDENT_DELETE), controller.remove);
```

## 7. Quy tắc nghiệp vụ

| Quy tắc | Kết quả khi vi phạm |
|---|---|
| Vai trò hệ thống (`admin`) **luôn có toàn bộ quyền**: không thể bỏ bớt quyền | 409 "Vai trò hệ thống luôn có toàn bộ quyền…" (được đổi tên, mô tả) |
| Không xóa được vai trò hệ thống | 409 |
| Không xóa được vai trò **đang được gán** cho người dùng | 409 "…vì đang được gán cho N người dùng." |
| Mã vai trò duy nhất, dạng `^[a-z0-9_]{2,30}$`; mã quyền phải có trong danh mục | 409 nếu trùng mã, 400 nếu mã quyền lạ |
| Không tự xóa tài khoản của mình | 409 |
| Không tự khóa mình, không tự đổi vai trò của mình | 409 |
| Hệ thống phải còn ít nhất **một quản trị viên đang hoạt động** | 409 (khi khóa, đổi vai trò hoặc xóa admin cuối cùng) |
| Tên đăng nhập duy nhất, không đổi được sau khi tạo | 409 nếu trùng |
| Thay đổi quyền / khóa tài khoản **có hiệu lực ngay** | Request kế tiếp bị 403 (mất quyền) hoặc 401 (bị khóa), không cần đăng nhập lại |
| Đăng nhập sai tên hay sai mật khẩu đều trả **cùng một thông báo** và tốn cùng thời gian băm (scrypt) | Kẻ dò không phân biệt được "tài khoản có tồn tại hay không" |
| Giao diện **ẩn** nút/tab không có quyền, nhưng **backend mới là nơi kiểm tra thật** | Gọi thẳng API bằng curl/Postman vẫn bị 403 |

Về điểm cuối cùng: ẩn nút chỉ để giao diện gọn và tránh bấm nhầm. Người dùng luôn có thể mở
DevTools hoặc dùng curl để gọi API, nên **không bao giờ** dựa vào giao diện để bảo mật. Giao
diện lấy danh sách quyền từ `permissions` (trả về khi đăng nhập và khi gọi `/api/auth/me`)
để quyết định hiện nút nào; khi gặp 403 thì báo "Bạn không có quyền …".

## 8. Thực hành với curl

Chạy app (`npm start`, cổng 3000), mở terminal khác. Mỗi khối dưới đây là một phiên shell;
các biến như `TOKEN` chỉ tồn tại trong phiên đó. Để in JSON cho dễ đọc mà không cần cài `jq`,
ta dùng một hàm nhỏ chạy bằng Node.js (có sẵn vì dự án chạy bằng Node):

```bash
API=http://localhost:3000        # đi qua Nginx thì dùng http://localhost:8080
pretty() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'; }
token() { node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'; }
```

### 8.1 Đăng nhập để lấy token

```console
$ curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"giangvien","password":"Giangvien@123"}' | pretty
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjMsImlhdCI6MTc5Mzk0ODc1NSwiZXhwIjoxNzkzOTc3NTU1fQ.awBIenRKxw9FTzEpZjZxF_PCtfAuQ3E4g8i7JeaRuvg",
  "user": {
    "UserID": 3,
    "Username": "giangvien",
    "FullName": "Lê Văn Giảng",
    "Email": "giangvien@qlsv.edu.vn",
    "RoleID": 3,
    "RoleCode": "giangvien",
    "RoleName": "Giảng viên",
    "IsActive": true,
    "LastLoginDate": "2026-11-06T07:05:55.672Z",
    "CreateDate": "2026-11-06T07:00:14.539Z",
    "UpdateDate": "2026-11-06T07:00:14.539Z"
  },
  "permissions": [
    "student.read",
    "student.update",
    "student.export"
  ]
}
```

`permissions` chính là ma trận quyền của vai trò *Giảng viên*. Token là chuỗi JWT gồm 3 phần
`header.payload.signature`; phần payload giải mã base64url ra `{"sub":3,"iat":…,"exp":…}`
(chỉ có UserID và thời hạn, không có quyền).

### 8.2 Gọi API có token, không có token

```console
$ TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"giangvien","password":"Giangvien@123"}' | token)
$ curl -s -o /dev/null -D - "$API/api/students?page=1&pageSize=10&q=" -H "Authorization: Bearer $TOKEN" | tr -d '\r' | grep -iE '^(HTTP|x-user|content-length)'
HTTP/1.1 200 OK
X-User: giangvien
Content-Length: 3954
$ curl -s -i "$API/api/students?page=1&pageSize=10&q=" | tr -d '\r' | grep -vE '^(Date|ETag|Connection|Keep-Alive|X-Frame|X-Content|Referrer)'
HTTP/1.1 401 Unauthorized
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 118

{"error":{"code":"UNAUTHORIZED","message":"Bạn chưa đăng nhập hoặc phiên đăng nhập không hợp lệ."}}
```

Request có token trả 200 và header `X-User: giangvien` (header này dành cho Nginx ghi log; khi
đi qua Nginx nó bị ẩn khỏi trình duyệt). Không có token thì 401.

### 8.3 Đã đăng nhập nhưng thiếu quyền: 403

Tài khoản `viewer` chỉ có `student.read`, thử xóa một sinh viên:

```console
$ VIEWER=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"viewer","password":"Viewer@123"}' | token)
$ curl -s -i -X DELETE "$API/api/students/1" -H "Authorization: Bearer $VIEWER" | tr -d '\r' | grep -vE '^(Date|ETag|Connection|Keep-Alive|X-Frame|X-Content|Referrer)'
HTTP/1.1 403 Forbidden
Cache-Control: no-store
X-User: viewer
Content-Type: application/json; charset=utf-8
Content-Length: 114

{"error":{"code":"FORBIDDEN","message":"Bạn không có quyền xóa sinh viên.","permission":"student.delete"}}
```

Response có `X-User: viewer`, nên trong log Nginx dòng 403 này vẫn ghi rõ *ai* đã thử xóa.
Trường `permission` cho biết quyền còn thiếu.

### 8.4 Xem vai trò và quyền hiện tại (admin)

```console
$ ADMIN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"Admin@123"}' | token)
$ curl -s "$API/api/roles" -H "Authorization: Bearer $ADMIN" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).items.map(r => `${r.RoleID} ${r.Code} (${r.UserCount} người dùng${r.IsSystem ? ", hệ thống" : ""}): ${r.Permissions.join(", ")}`).join("\n")'
1 admin (1 người dùng, hệ thống): student.read, student.create, student.update, student.delete, student.import, student.export, user.read, user.create, user.update, user.delete, role.read, role.create, role.update, role.delete
2 giaovu (1 người dùng): student.read, student.create, student.update, student.delete, student.import, student.export, user.read
3 giangvien (1 người dùng): student.read, student.update, student.export
4 viewer (1 người dùng): student.read
```

### 8.5 Gán quyền cho vai trò bằng `PUT /api/roles/:id`, có hiệu lực ngay

Cho vai trò *Người xem* (`RoleID = 4`) thêm quyền xuất file, kiểm tra bằng chính token cũ của
`viewer` (không đăng nhập lại), rồi trả về như cũ:

```console
$ ADMIN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"Admin@123"}' | token)
$ VIEWER=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"viewer","password":"Viewer@123"}' | token)
$ curl -s -o /dev/null -w 'viewer xuất file: %{http_code}\n' "$API/api/students/export?format=json&q=" -H "Authorization: Bearer $VIEWER"
viewer xuất file: 403
$ curl -s -X PUT "$API/api/roles/4" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"Permissions":["student.read","student.export"]}' | pretty
{
  "RoleID": 4,
  "Code": "viewer",
  "Name": "Người xem",
  "Description": "Chỉ được xem danh sách sinh viên.",
  "IsSystem": false,
  "UserCount": 1,
  "Permissions": [
    "student.read",
    "student.export"
  ],
  "CreateDate": "2026-11-06T07:00:14.539Z",
  "UpdateDate": "2026-11-06T07:05:55.990Z"
}
$ curl -s -o /dev/null -w 'viewer xuất file: %{http_code}\n' "$API/api/students/export?format=json&q=" -H "Authorization: Bearer $VIEWER"
viewer xuất file: 200
$ curl -s -X PUT "$API/api/roles/4" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"Permissions":["student.read"]}' -o /dev/null -w 'trả lại quyền cũ: %{http_code}\n'
trả lại quyền cũ: 200
$ curl -s -o /dev/null -w 'viewer xuất file: %{http_code}\n' "$API/api/students/export?format=json&q=" -H "Authorization: Bearer $VIEWER"
viewer xuất file: 403
```

`PUT /api/roles/:id` là cập nhật **từng phần**: chỉ gửi `Permissions` thì `Name`, `Description`
giữ nguyên. Danh sách gửi lên **thay thế toàn bộ** quyền cũ của vai trò (không phải cộng thêm).

### 8.6 Các quy tắc bảo vệ (409)

```console
$ ADMIN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"Admin@123"}' | token)
$ curl -s -X PUT "$API/api/roles/1" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"Permissions":["student.read"]}'; echo
{"error":{"code":"CONFLICT","message":"Vai trò hệ thống luôn có toàn bộ quyền. Không thể thay đổi phân quyền của vai trò này."}}
$ curl -s -X DELETE "$API/api/roles/2" -H "Authorization: Bearer $ADMIN"; echo
{"error":{"code":"CONFLICT","message":"Không thể xóa vai trò \"Giáo vụ\" vì đang được gán cho 1 người dùng."}}
$ curl -s -X DELETE "$API/api/users/1" -H "Authorization: Bearer $ADMIN"; echo
{"error":{"code":"CONFLICT","message":"Bạn không thể xóa tài khoản của chính mình."}}
```

## 9. Đối chiếu với nhật ký Nginx

App gắn header `X-User` vào response của mọi request đã qua bước xác thực (middleware
`authenticate`), nên Nginx ghi được tên người dùng vào cột `"$upstream_http_x_user"` của log (xem
`nginx/qlsv.conf` và `docs/NGINX-LOG.md`). Ngoại lệ là các lỗi app trả về trước bước xác thực:
body JSON hỏng (400), body JSON vượt 1 MB (413), đường dẫn `/api/...` không tồn tại (404). Những
dòng này ghi user là `-` dù request có token.
Một số câu hỏi kiểm toán (audit) trả lời được ngay từ log mẫu `nginx/sample-logs/access.log`:

Ai đã bị từ chối quyền (403), lúc nào, với chức năng gì?

```console
$ awk -F'"' '{ split($1, a, " "); split($3, s, " ") } s[1] == 403 { print substr(a[4], 2), a[1], $8, $2 }' access.log
03/Nov/2026:14:43:18 192.168.1.15 giaovu GET /api/roles HTTP/1.1
03/Nov/2026:14:43:18 192.168.1.15 giaovu GET /api/permissions HTTP/1.1
04/Nov/2026:14:06:46 192.168.1.23 giangvien GET /api/students/export?format=xlsx&q=sv000012 HTTP/1.1
05/Nov/2026:08:31:43 192.168.1.58 - POST /api/auth/login HTTP/1.1
05/Nov/2026:08:32:20 192.168.1.58 - POST /api/auth/login HTTP/1.1
06/Nov/2026:09:49:25 10.10.0.21 viewer GET /api/users?page=1&pageSize=10&q= HTTP/1.1
06/Nov/2026:09:49:25 10.10.0.21 viewer GET /api/roles/options HTTP/1.1
```

Các dòng có user là `-` là đăng nhập vào tài khoản bị khóa (403 `ACCOUNT_LOCKED`), vì lúc
đó chưa xác thực được ai. Dòng `giangvien … export` lúc 14:06 ngày 04/11 là tình huống quản
trị viên vừa thu hồi quyền `student.export` của vai trò *Giảng viên*: nút "Xuất file" vẫn còn
trên màn hình (giao diện chưa tải lại) nhưng backend đã chặn ngay.

Ai đã thay đổi phân quyền (gọi `PUT /api/roles/...`)?

```console
$ grep -E '"(PUT|POST|DELETE) /api/roles' access.log | awk -F'"' '{ split($1, a, " "); split($3, s, " "); print substr(a[4], 2), a[1], $8, $2, s[1] }'
04/Nov/2026:13:54:32 192.168.1.10 admin PUT /api/roles/3 HTTP/1.1 200
04/Nov/2026:15:11:13 192.168.1.10 admin PUT /api/roles/3 HTTP/1.1 200
05/Nov/2026:14:34:43 172.16.0.5 admin POST /api/roles HTTP/1.1 201
05/Nov/2026:14:35:26 172.16.0.5 admin PUT /api/roles/5 HTTP/1.1 200
05/Nov/2026:14:35:51 172.16.0.5 admin DELETE /api/roles/2 HTTP/1.1 409
05/Nov/2026:14:36:18 172.16.0.5 admin DELETE /api/roles/5 HTTP/1.1 200
```

## 10. Mã nguồn liên quan

| File | Nội dung |
|---|---|
| `src/constants/permissions.js` | Danh mục chức năng và quyền (module, action, tên, mô tả) |
| `src/middlewares/auth.js` | `authenticate` (kiểm tra JWT, nạp lại quyền, đặt `X-User`) và `authorize(...codes)` |
| `src/routes/*.routes.js` | Khai báo quyền cho từng endpoint |
| `src/services/auth.service.js` | Đăng nhập, xác thực token, kiểm tra tài khoản bị khóa |
| `src/services/role.service.js` | Quy tắc vai trò hệ thống, xóa vai trò đang dùng, gán quyền |
| `src/services/user.service.js` | Quy tắc tự xóa/tự khóa, còn ít nhất một admin |
| `src/db/seed.js` | 4 vai trò và 4 tài khoản mẫu |
| `nginx/qlsv.conf` | Ghi `X-User` vào access log và ẩn header này khỏi client |
