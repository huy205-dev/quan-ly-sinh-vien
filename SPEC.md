# SPEC — Mini project "Quản lý sinh viên" (shared contract for all agents)

Project root: the `quan-ly-sinh-vien/` folder (the folder that contains this file).
All user-facing text (UI, error messages, docs) is **Vietnamese with full diacritics**. Code identifiers in English.

## 0. Scope (from the assignment)
A. Student module with 11 features: (1) paginated table 10/15 per page, (2) create, (3) update, (4) view detail,
(5) delete one + delete many via checkboxes, (6) search (code, name, description, …), (7) copy one, (8) copy many,
(9) import/export Excel (.xlsx), JSON, XML, (10) show/hide table columns, (11) keyboard shortcuts for CRUD (Alt+…).
B. User permissions in a CMS (RBAC, REST API): define the functions that need permission, set Read/Create/Update/Delete(...) per user (via role).
C. Nginx access log: default file, log_format structure, basic commands (who/when/which IP), filter by date/time, user-agent, status, GoAccess.

## 1. Stack & layout
- Node.js 26 (works ≥ 24), built-in `node:sqlite` (`DatabaseSync`), Express 5.3.0, multer 2.5.0, exceljs 4.4.0, fast-xml-parser 5.12.0 — **already installed**. Do NOT add other npm deps (auth uses `node:crypto`: scrypt + hand-written HS256 JWT).
- Backend CommonJS. Frontend: plain HTML/CSS/JS with browser ES modules (`<script type="module">`), no build step, no CDN.
- One command `npm start` → `http://localhost:3000` serves both UI (`public/`) and API (`/api`). Env: `PORT` (3000), `DB_PATH` (`data/app.db`), `JWT_SECRET` (else generate once into `data/jwt-secret.txt`).

```
server.js                      # require('./src/app').createApp() then listen
src/app.js                     # createApp({ dbPath, uploadDir }) -> express app (used by tests)
src/config.js
src/db/index.js                # open DB, PRAGMA foreign_keys=ON, create schema, seed when empty, transaction(fn) helper
src/db/seed.js
src/constants/permissions.js   # permission catalog (section 3)
src/utils/                     # http-error.js, jwt.js, password.js, text.js (Vietnamese normalize), validators.js
src/middlewares/               # auth.js (authenticate, authorize(...codes)), upload.js, error-handler.js
src/routes/ controllers/ services/ repositories/   # route -> controller -> service -> repository
public/                        # frontend (index.html, login.html, css/, js/)
uploads/                       # uploaded images, served at /uploads
tests/api.test.js              # node:test, in-process app with temp DB
nginx/ docs/ scripts/          # nginx config, sample logs, log scripts, documentation
```

## 2. Data model (SQLite)
Dates: stored ISO-8601 UTC (`new Date().toISOString()`); UI shows `Asia/Ho_Chi_Minh`.

### Students
| Column | Type | Rule |
|---|---|---|
| StudentID | INTEGER PK AUTOINCREMENT | displayed as code `SV000001` (`'SV' + id padded to 6`) |
| FullName | TEXT NOT NULL | required, trimmed, 2–100 chars |
| PathImage | TEXT NULL | `/uploads/<file>` or null |
| Gender | TEXT NOT NULL | one of `Nam`, `Nữ`, `Khác` |
| DateOfBirth | TEXT NOT NULL | `YYYY-MM-DD`, valid date, 1950-01-01 … today |
| ClassName | TEXT NOT NULL | required, ≤ 50 (e.g. `CNTT-K18A`) |
| Major | TEXT NOT NULL | required, ≤ 100 (e.g. `Công nghệ thông tin`) |
| Email | TEXT NULL | optional, valid email, ≤ 100 (NOT unique — copies share it) |
| Phone | TEXT NULL | optional, `/^0\d{9,10}$/` |
| Address | TEXT NULL | optional, ≤ 255 |
| GPA | REAL NULL | optional, 0–4, rounded to 2 decimals |
| Description | TEXT NULL | optional, ≤ 1000 (Ghi chú) |
| CreateDate | TEXT NOT NULL | set by server only |
| UpdateDate | TEXT NOT NULL | set by server on every update |
| SearchText | TEXT NOT NULL | internal, never returned: normalized FullName+ClassName+Major+Email+Phone+Address+Description |

Student JSON returned by API (field order): `StudentID, StudentCode, FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA, Description, CreateDate, UpdateDate` (empty optional → `null`).

### RBAC tables
- `Roles(RoleID PK, Code TEXT UNIQUE, Name, Description, IsSystem INTEGER 0/1, CreateDate, UpdateDate)`
- `Permissions(Code TEXT PK, Module, Action, Name)` — seeded from `src/constants/permissions.js`
- `RolePermissions(RoleID FK→Roles ON DELETE CASCADE, PermissionCode FK→Permissions, PK(RoleID, PermissionCode))`
- `Users(UserID PK, Username TEXT UNIQUE, PasswordHash, FullName, Email, RoleID FK→Roles, IsActive INTEGER 1/0, LastLoginDate, CreateDate, UpdateDate)`
  - Username: 3–30 chars `/^[a-z0-9_.]+$/` (lowercased), immutable after create. Password: ≥ 6 chars, ≥ 1 letter and ≥ 1 digit. Hash: `scrypt$<saltHex>$<hashHex>`.

## 3. Permission catalog (functions that need permission)
Code format `module.action`.

| Module (name) | Code | Name (UI) | Guards |
|---|---|---|---|
| student (Sinh viên) | student.read | Xem | list, detail, search |
| | student.create | Thêm | create, copy one/many |
| | student.update | Sửa | update |
| | student.delete | Xóa | delete one/many |
| | student.import | Nhập file | import, download template |
| | student.export | Xuất file | export |
| user (Người dùng) | user.read | Xem | list/detail users |
| | user.create | Thêm | create user |
| | user.update | Sửa | update user, reset password, lock/unlock |
| | user.delete | Xóa | delete user |
| role (Vai trò & phân quyền) | role.read | Xem | list roles, permission catalog |
| | role.create | Thêm | create role |
| | role.update | Sửa | rename role, assign permissions |
| | role.delete | Xóa | delete role |

Action column order for the matrix UI: `read, create, update, delete, import, export` (labels: Xem, Thêm, Sửa, Xóa, Nhập file, Xuất file).

### Seed (only when DB empty)
| Role Code | Name | IsSystem | Permissions |
|---|---|---|---|
| admin | Quản trị viên | 1 | ALL (always; cannot be edited/deleted) |
| giaovu | Giáo vụ | 0 | all 6 student.*, user.read |
| giangvien | Giảng viên | 0 | student.read, student.update, student.export |
| viewer | Người xem | 0 | student.read |

Users: `admin / Admin@123` (admin), `giaovu / Giaovu@123`, `giangvien / Giangvien@123`, `viewer / Viewer@123` — FullName e.g. "Nguyễn Quản Trị", "Trần Thị Giáo Vụ", "Lê Văn Giảng", "Phạm Người Xem".
Students: 36 deterministic Vietnamese sample rows (varied classes CNTT-K18A/B, KTPM-K19A, HTTT-K20A, QTKD-K19B…, majors, GPAs, a few with Description), no images.

## 4. Auth
- `POST /api/auth/login` `{ username, password }` → 200 `{ token, user, permissions: [codes] }`; 401 wrong credentials; 403 `ACCOUNT_LOCKED` if IsActive=0. Updates LastLoginDate.
- `GET /api/auth/me` → `{ user, permissions }`.
- `user` object = `{ UserID, Username, FullName, Email, RoleID, RoleCode, RoleName, IsActive (bool), LastLoginDate, CreateDate, UpdateDate }` (never PasswordHash).
- Token: `Authorization: Bearer <JWT HS256>` payload `{ sub: UserID, iat, exp }`, 8 h. On **every** request the middleware reloads the user + role permissions from DB (so permission changes / locking apply immediately).
- Every authenticated response sets header `X-User: <username>` (also on successful login) → Nginx logs it via `$upstream_http_x_user`.
- Static files (`/`, `/login.html`, `/css`, `/js`, `/uploads`) are public; every `/api/*` except login requires a token.

## 5. Error format (all API errors)
`{ "error": { "code": "...", "message": "Vietnamese message", "details": [...]? } }`
| HTTP | code | when |
|---|---|---|
| 400 | VALIDATION_ERROR | details `[{ field, message }]`; for import `[{ row, field, message }]` |
| 400 | FILE_ERROR | bad file type/content, formula cell, XML DTD/entity, too many rows |
| 401 | UNAUTHORIZED | missing/invalid/expired token |
| 403 | FORBIDDEN | missing permission — include `"permission": "student.delete"` inside `error` |
| 403 | ACCOUNT_LOCKED | login of a locked user |
| 404 | NOT_FOUND | record not found (unknown /api route → 404 NOT_FOUND too) |
| 409 | CONFLICT | business rule (delete self, delete role in use, edit system role, duplicate username/role code) |
| 413 | FILE_ERROR | file too large |
| 500 | INTERNAL_ERROR | unexpected |

## 6. Student API (permission in brackets)
- `GET /api/students?page=1&pageSize=10&q=` [student.read] → `{ items, page, pageSize, total, totalPages }`. pageSize ∈ {10, 15} (anything else → 10). Order `StudentID DESC`. If `page > totalPages` (and total > 0) the server clamps and returns the last valid page (response `page` = effective page). totalPages ≥ 1.
- Search `q`: normalize (trim, lowercase, NFD remove diacritics, `đ→d`) and match `SearchText LIKE %q%` OR `printf('sv%06d', StudentID) LIKE %q%` (so "sv000012", "SV0000", "nguyen van", "cntt" all work). Escape `%`/`_`.
- `GET /api/students/:id` [student.read] → Student | 404.
- `POST /api/students` [student.create] — `multipart/form-data` with the text fields + optional file field `image` → 201 Student.
- `PUT /api/students/:id` [student.update] — multipart; new `image` replaces PathImage; field `removeImage=1` sets PathImage null; otherwise old image kept → 200 Student.
- `DELETE /api/students/:id` [student.delete] → `{ deleted: 1 }`.
- `POST /api/students/bulk-delete` [student.delete] JSON `{ ids: [int…] }` (1–1000 ids) → `{ deleted: n }`; any id missing → 404, nothing deleted (one DB transaction).
- `POST /api/students/bulk-copy` [student.create] `{ ids }` → 201 `{ copied: n, items: [new students] }`; new ID + dates, FullName + `" (bản sao)"` (truncate base so total ≤ 100), same PathImage; all-or-nothing transaction. Used for copy-one too.
- `POST /api/students/import` [student.import] multipart field `file` (.xlsx/.json/.xml by extension, ≤ 10 MB, ≤ 1000 rows) → 201 `{ imported: n }`. Validate ALL rows first; any error → 400 VALIDATION_ERROR with `details [{row, field, message}]` and nothing inserted. Insert in one transaction. Import only adds; ignores StudentID/StudentCode/CreateDate/UpdateDate in the file. `PathImage` optional; if given must be `/uploads/<name>` of an existing file.
  - `row` numbering: xlsx = Excel row number (header row 1 → first data row 2); json/xml = 1-based index of the record.
  - Excel: sheet `Students` (fallback first sheet), row 1 = field names. Reject formula cells (FILE_ERROR or row error). Date cells → `YYYY-MM-DD`; numeric phone → string, restore lost leading `0`. Rich text / hyperlinks → plain text.
  - XML: reject any `<!DOCTYPE` / `<!ENTITY` (FILE_ERROR). Structure `<Students><Student><FullName>…</FullName>…</Student></Students>`; parse all values as strings.
  - JSON: array of objects (or `{ "Students": [...] }`).
- `GET /api/students/export?format=xlsx|json|xml&q=` [student.export] → download of ALL rows matching q (all pages), columns: `StudentID, StudentCode, FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA, Description, CreateDate, UpdateDate` — independent of column visibility. `Content-Disposition: attachment; filename="sinh-vien-YYYYMMDD-HHmmss.<ext>"`. The exported file must be re-importable.
- `GET /api/students/template?format=xlsx|json|xml` [student.import] → template with import columns `FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA, Description` and 2 example rows. filename `mau-nhap-sinh-vien.<ext>`.
- Image upload: multer memoryStorage, 5 MB, accept PNG/JPEG/WebP verified by magic bytes (not just mimetype), save `uploads/<randomUUID>.<png|jpg|webp>`, PathImage `/uploads/<file>`. Image files are never deleted when a student is deleted/updated (copies share paths).

## 7. Users & roles API
- `GET /api/users?page=1&pageSize=10&q=` [user.read] → paged `{items,page,pageSize,total,totalPages}` (pageSize 1–100), search Username/FullName/Email (diacritic-insensitive OK).
- `GET /api/users/:id` [user.read]
- `POST /api/users` [user.create] `{ Username, Password, FullName, Email?, RoleID, IsActive? }` → 201 user. Duplicate username → 409.
- `PUT /api/users/:id` [user.update] `{ FullName, Email, RoleID, IsActive, Password? }` (Password optional = reset). Cannot lock yourself or change your own role → 409.
- `DELETE /api/users/:id` [user.delete] — cannot delete yourself → 409; cannot remove the last active admin-role user → 409.
- `GET /api/permissions` [role.read] → `{ actions: [{action, name}…in matrix order], modules: [{ module, name, permissions: [{ code, action, name, description }] }] }`.
- `GET /api/roles` [role.read] → `{ items: [Role] }`; Role = `{ RoleID, Code, Name, Description, IsSystem (bool), UserCount, Permissions: [codes], CreateDate, UpdateDate }`.
- `GET /api/roles/options` [any of user.read, user.create, user.update, role.read] → `{ items: [{ RoleID, Code, Name }] }` (for the user form's role select).
- `GET /api/roles/:id` [role.read]
- `POST /api/roles` [role.create] `{ Code, Name, Description?, Permissions: [codes] }` → 201. Code `/^[a-z0-9_]{2,30}$/`, unique (409). Unknown permission code → 400.
- `PUT /api/roles/:id` [role.update] `{ Name, Description, Permissions }` — admin/system role: 409 if Permissions differ from ALL (system role always has all permissions; Name/Description may change).
- `DELETE /api/roles/:id` [role.delete] — 409 if IsSystem or UserCount > 0.

## 8. Frontend (public/)
- `login.html`: login form + demo-account list (click fills the form). Session stored in `localStorage['qlsv.session'] = { token, user, permissions }`, then go to `/`.
- `index.html` SPA, hash routes `#/students` (default), `#/users`, `#/roles`. Header: app title "Quản lý sinh viên", current user FullName + RoleName, logout. Nav tabs only for modules the user can read. On load call `/api/auth/me` (refresh permissions); 401 → clear session, go to `/login.html`. 403 → toast "Bạn không có quyền …".
- Buttons the user lacks permission for are hidden; backend still enforces.
- Light admin theme, CSS written by hand, responsive down to ~360 px.
- **Students view** (all 11 features): toolbar (Thêm Alt+N, Sửa Alt+U, Xem Alt+V, Xóa Alt+X, Sao chép Alt+C, Nhập file Alt+I, Xuất file Alt+E with format choice xlsx/json/xml, Cột Alt+K, Phím tắt Alt+H), search box (Alt+Q, debounce 300 ms, diacritic-insensitive via API), table with select checkbox + "chọn tất cả" (current page only), image thumbnail, row actions (Xem/Sửa/Sao chép/Xóa), pager: page size 10/15, "Tổng: N sinh viên", first/prev/numbered/next/last. Selection cleared on page/search change. Edit & View need exactly 1 selected row; Delete & Copy accept ≥ 1. Every delete has a confirm dialog. After deleting the last rows of the last page, go to nearest valid page.
  - Form modal (create/update): all editable fields, image picker with preview + "Xóa ảnh", client-side validation mirroring section 2, server `details` shown per field. CreateDate/UpdateDate not editable. Alt+S saves.
  - Detail modal: all fields read-only incl. StudentCode, image, CreateDate/UpdateDate (VN time).
  - Import modal: file input (.xlsx,.json,.xml), template download links per format, result table of `{row, field, message}` errors.
  - Column config: checkbox per data column, saved to `localStorage['qlsv.students.columns.v1']`, "Khôi phục mặc định". Default visible: Mã SV, Ảnh, Họ tên, Giới tính, Ngày sinh, Lớp, Ngành, GPA; hidden by default: Email, SĐT, Địa chỉ, Ghi chú, Ngày tạo, Ngày cập nhật.
- **Users view**: paged table + search, create/edit modal (role select from `/api/roles/options`, active toggle, password on create / optional reset on edit), delete with confirm.
- **Roles view**: role list (name, code, user count, system badge) + permission matrix for the selected role: rows = modules, columns = actions (Xem/Thêm/Sửa/Xóa/Nhập file/Xuất file; cell empty when the module lacks that action), row/column "select all" toggles, Save (role.update). Create/delete role. System role shown locked (all checked, disabled).
- **Shortcuts** (one shared handler used by both buttons and keys; match on `event.code` like `KeyN` because macOS Option changes `event.key`; `preventDefault`): Alt+N thêm, Alt+S lưu, Alt+U sửa, Alt+V xem, Alt+X xóa, Alt+C sao chép, Alt+Q tìm kiếm, Alt+I nhập file, Alt+E xuất file, Alt+K cấu hình cột, Alt+H trợ giúp, Esc đóng hộp thoại. While typing in an input/textarea/select only Alt+S and Esc work. Delete via shortcut still asks for confirmation. Shortcuts respect permissions. Help modal lists them.
- Display: DateOfBirth `dd/mm/yyyy`; Create/UpdateDate `dd/mm/yyyy HH:mm` in Asia/Ho_Chi_Minh; GPA 2 decimals. Always escape HTML when rendering data.
- Loading / success / error feedback (toasts, disabled buttons while busy).

## 9. Nginx
- App sets `X-User` header; Nginx reverse proxy (port 8080 in docker, upstream app on host :3000) logs it with a custom `log_format qlsv` = combined + `"$upstream_http_x_user" rt=$request_time urt=$upstream_response_time` and hides the header from clients with `proxy_hide_header X-User`.
