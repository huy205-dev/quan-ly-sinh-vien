# Nhật ký truy cập Nginx: đọc, lọc và thống kê

Tài liệu cho phần **"Tìm hiểu nhật ký truy cập người dùng từ hệ thống qua Nginx"** của mini
project *Quản lý sinh viên*. Đề bài yêu cầu:

1. Xác định file log mặc định của Nginx (`/var/log/nginx/access.log`).
2. Giải thích cấu trúc log (theo `log_format`).
3. Đưa ra lệnh cơ bản để biết **ai** truy cập, **khi nào**, **từ IP nào**.
4. Lọc theo ngày/giờ, user-agent, status code.
5. Đề xuất công cụ trực quan như **GoAccess** để thống kê.

> **Mọi lệnh trong tài liệu đều đã được chạy thật** trên macOS (bash 3.2, awk/sed/grep bản
> BSD có sẵn của macOS) với file log mẫu của dự án; phần kết quả bên dưới mỗi lệnh là kết quả
> thật (dòng `… (còn N dòng)` nghĩa là đã cắt bớt cho gọn). Những chỗ Linux (GNU) khác macOS
> đều được ghi chú, và có bảng tổng hợp ở [Phụ lục A](#phụ-lục-a-khác-biệt-gnu-linux-và-bsd-macos).

## Mục lục

0. [Chuẩn bị: log mẫu và log thật](#0-chuẩn-bị-log-mẫu-và-log-thật)
1. [File log mặc định của Nginx](#1-file-log-mặc-định-của-nginx)
2. [Cấu trúc log: log_format](#2-cấu-trúc-log-log_format)
3. [Lệnh cơ bản: ai, khi nào, từ IP nào](#3-lệnh-cơ-bản-ai-khi-nào-từ-ip-nào)
4. [Lọc theo ngày và giờ](#4-lọc-theo-ngày-và-giờ)
5. [Lọc theo user-agent](#5-lọc-theo-user-agent)
6. [Lọc theo status code](#6-lọc-theo-status-code)
7. [Kết hợp nhiều bộ lọc, script log-report.sh](#7-kết-hợp-nhiều-bộ-lọc-script-log-reportsh)
8. [Log đã xoay vòng (logrotate) và file .gz](#8-log-đã-xoay-vòng-logrotate-và-file-gz)
9. [GoAccess: thống kê trực quan](#9-goaccess-thống-kê-trực-quan)
10. [Quyền riêng tư và bảo mật](#10-quyền-riêng-tư-và-bảo-mật)
11. [Bài tập tự luyện](#11-bài-tập-tự-luyện)

## 0. Chuẩn bị: log mẫu và log thật

Các file liên quan trong dự án:

| Đường dẫn | Nội dung |
|---|---|
| `nginx/qlsv.conf` | Cấu hình reverse proxy, khai báo `log_format qlsv` |
| `docker-compose.yml` | Chạy Nginx (`nginx:1.30-alpine`) ở cổng 8080, proxy vào app ở cổng 3000 |
| `nginx/sample-logs/access.log` | **Log mẫu** định dạng `qlsv` (01/11 → 06/11/2026, giờ Việt Nam +0700) |
| `nginx/sample-logs/access-combined.log` | Cùng dữ liệu nhưng ở định dạng `combined` mặc định |
| `scripts/gen-sample-log.js` | Script sinh log mẫu (tất định: chạy lại ra đúng file cũ) |
| `scripts/log-report.sh` | Script lọc + thống kê nhanh (mục 7) |
| `nginx/reports/goaccess-report.html` | Báo cáo GoAccess tạo từ log mẫu (mục 9) |
| `nginx/logs/` | Log thật khi chạy `docker compose up` (đã có trong `.gitignore`) |

**Cách 1: dùng log mẫu (khuyên dùng để luyện).** Mọi ví dụ từ mục 3 trở đi chạy trong thư mục
`nginx/sample-logs`:

```console
$ wc -l access.log access-combined.log
    1017 access.log
    1017 access-combined.log
    2034 total
$ head -n 2 access.log
66.249.66.1 - - [01/Nov/2026:01:45:14 +0700] "GET / HTTP/1.1" 200 1845 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "-" rt=0.004 urt=0.003
66.249.66.1 - - [01/Nov/2026:09:03:54 +0700] "GET /login.html HTTP/1.1" 200 6383 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "-" rt=0.007 urt=0.005
```

Log mẫu mô phỏng một tuần làm việc với 4 tài khoản (`admin`, `giaovu`, `giangvien`, `viewer`),
15 địa chỉ IP (mạng LAN của trường, vài IP công cộng thuộc các dải dành cho tài liệu theo
RFC 5737, và Googlebot), các trình duyệt khác nhau, công cụ (curl, Postman, python-requests),
máy quét lỗ hổng, cùng các tình huống có chủ đích để luyện lọc log:

| Thời điểm | Tình huống | Dấu hiệu trong log |
|---|---|---|
| 02/11 09:2x | Giáo vụ nhập file lỗi rồi nhập lại | `POST /api/students/import` 400 rồi 201 |
| 03/11 02:1x | Máy quét sqlmap; gói TLS gửi nhầm vào cổng HTTP | User-Agent `sqlmap`, nhiều 401; một dòng 400 với request "rác" |
| 03/11 10:1x | Dò mật khẩu từ một máy phòng lab | 7 lần `POST /api/auth/login` 401 liên tiếp |
| 03/11 14:4x | Giáo vụ gõ tay địa chỉ trang Vai trò | 403 cho `/api/roles` |
| 04/11 10:02 | App khởi động lại để cập nhật | 502 trong khoảng 3 phút |
| 04/11 13:54 → 15:11 | Admin thu hồi rồi trả lại quyền xuất file của Giảng viên | `PUT /api/roles/3`, giảng viên bị 403 khi xuất file |
| 05/11 03:0x | Máy quét Nikto | `/.env`, `/wp-login.php`, `/.git/config`… 404; `/../../etc/passwd` 400 |
| 05/11 08:3x | Đăng nhập vào tài khoản đã bị khóa | `POST /api/auth/login` 403 |
| 05/11 11:1x | Lỗi xuất file Excel | 500 rồi thử lại 200 |
| 05/11 16:2x | File import 14 MB; ảnh 7 MB | 413 do Nginx (`urt=-`), 413 do app (có tên user) |
| 23:30 hằng ngày | Script sao lưu | `python-requests` export JSON |

**Cách 2: log thật.** Chạy app trên máy (`npm start`, cổng 3000) rồi bật Nginx:

```bash
mkdir -p nginx/logs            # nên tạo trước (trên Linux, Docker tự tạo sẽ thuộc root)
docker compose up -d           # Nginx: http://localhost:8080
tail -f nginx/logs/access.log  # mở trình duyệt vào http://localhost:8080 rồi xem log chạy
docker compose down
```

## 1. File log mặc định của Nginx

### 1.1 access.log và error.log

Nginx có hai loại nhật ký:

| | `access.log` | `error.log` |
|---|---|---|
| Ghi gì | Mỗi request đã xử lý xong là **một dòng**: ai (IP, user), khi nào, yêu cầu gì, kết quả (status), bao nhiêu byte, trình duyệt nào | Sự cố và sự kiện của **chính Nginx**: khởi động/dừng, cấu hình sai, không kết nối được app phía sau (upstream), request bị từ chối… |
| Chỉ thị | `access_log đường_dẫn [tên_format];` | `error_log đường_dẫn [mức];` |
| Định dạng | Tùy chỉnh bằng `log_format` (mục 2) | Cố định: `thời gian [mức] pid#tid: *id thông điệp` |
| Mức độ | Không có | `debug`, `info`, `notice`, `warn`, `error`, `crit`, `alert`, `emerg` (ghi từ mức đã chọn trở lên) |
| Dùng để | Thống kê truy cập, kiểm toán, phát hiện tấn công | Gỡ lỗi khi trang trả 502/504, cấu hình không chạy |

Ví dụ `error.log` thật của dự án (chạy thử ngày 06/11/2026): một file import 11 MB bị chặn,
sau đó app bị tắt nên Nginx không kết nối được:

```console
$ grep -v '\[notice\]' nginx/logs/error.log
2026/11/06 14:01:19 [error] 20#20: *43 client intended to send too large body: 11000212 bytes, client: 192.168.107.1, server: _, request: "POST /api/students/import HTTP/1.1", host: "localhost:8080", referrer: "http://localhost:8080/"
2026/11/06 14:07:52 [error] 20#20: *48 connect() failed (111: Connection refused) while connecting to upstream, client: 192.168.107.1, server: _, request: "GET /api/students?page=1&pageSize=10&q= HTTP/1.1", upstream: "http://0.250.250.254:3000/api/students?page=1&pageSize=10&q=", host: "localhost:8080"
2026/11/06 14:07:52 [error] 22#22: *50 connect() failed (111: Connection refused) while connecting to upstream, client: 192.168.107.1, server: _, request: "GET / HTTP/1.1", upstream: "http://0.250.250.254:3000/", host: "localhost:8080"
```

Khi người dùng báo "trang báo 502", hãy xem `error.log` trước: dòng `connect() failed (111:
Connection refused)` cho biết app phía sau không chạy. Còn `access.log` chỉ cho biết request đó
nhận 502.

### 1.2 Vị trí mặc định theo hệ điều hành

Các giá trị trong bảng đã được kiểm tra trực tiếp bằng cách cài Nginx trong container của từng
bản phân phối (ngày 06/11/2026), trừ dòng macOS và Windows:

| Môi trường | access log | error log | Ghi chú |
|---|---|---|---|
| Debian / Ubuntu (`apt install nginx`) | `/var/log/nginx/access.log` | `/var/log/nginx/error.log` | Debian 13, nginx 1.26.3. File thuộc `www-data:adm`, quyền `0640`. logrotate: hằng ngày, giữ 14 bản, nén `.gz` |
| RHEL / CentOS / Rocky / AlmaLinux (`dnf install nginx`) | `/var/log/nginx/access.log` | `/var/log/nginx/error.log` | Rocky 9.8, nginx 1.20.1. Thư mục `/var/log/nginx` là `drwx--x--x root`: người dùng thường không liệt kê được, phải dùng `sudo`. logrotate: hằng ngày, giữ 10 bản |
| Alpine (`apk add nginx`) | `/var/log/nginx/access.log` | `/var/log/nginx/error.log` | Alpine 3.24, nginx 1.30.6, định dạng `main`, error log mức `warn` |
| Image Docker chính thức `nginx` | `/var/log/nginx/access.log` **→ `/dev/stdout`** | `/var/log/nginx/error.log` **→ `/dev/stderr`** | Là symlink, xem log bằng `docker logs`. Xem mục 1.4 |
| macOS Homebrew (Apple Silicon) | `/opt/homebrew/var/log/nginx/access.log` | `/opt/homebrew/var/log/nginx/error.log` | Máy Mac Intel: `/usr/local/var/log/nginx/`. Xác nhận bằng `nginx -V` |
| Windows (bản zip của nginx.org) | `logs\access.log` | `logs\error.log` | Tính từ thư mục giải nén Nginx |

Logrotate thật của Debian (`/etc/logrotate.d/nginx`), mục 8 sẽ giải thích:

```text
/var/log/nginx/*.log {
	daily
	missingok
	rotate 14
	compress
	delaycompress
	notifempty
	create 0640 www-data adm
	sharedscripts
	prerotate
		if [ -d /etc/logrotate.d/httpd-prerotate ]; then \
			run-parts /etc/logrotate.d/httpd-prerotate; \
		fi \
	endscript
	postrotate
		invoke-rc.d nginx rotate >/dev/null 2>&1
	endscript
}
```

### 1.3 Xác nhận đường dẫn thực tế trên máy chủ

Đường dẫn có thể bị đổi trong cấu hình, nên đừng đoán mà hãy hỏi chính Nginx:

```bash
sudo nginx -T | grep -E 'access_log|error_log'   # in TOÀN BỘ cấu hình đang dùng (cả các file include)
```

Trong dự án (Nginx chạy bằng Docker Compose), kết quả thật:

```console
$ docker compose exec nginx nginx -T 2>/dev/null | grep -E 'access_log|error_log'
error_log  /var/log/nginx/error.log notice;
    access_log  /var/log/nginx/access.log  main;
    # access_log ở mức server sẽ THAY THẾ (không cộng thêm) access_log "main"
    access_log /var/log/nginx/access.log qlsv;
    error_log  /var/log/nginx/error.log warn;
```

Đọc kết quả: dòng 1–2 đến từ `/etc/nginx/nginx.conf` của image (mức `http`), dòng 3 là chú
thích trong `qlsv.conf` (grep bắt cả chú thích), dòng 4–5 là cấu hình của server trong
`nginx/qlsv.conf`. `access_log` khai báo ở mức `server` **thay thế** cái khai báo ở mức `http`,
nên request vào server này chỉ được ghi theo định dạng `qlsv`.

Nếu cấu hình **không** có chỉ thị `access_log` nào, Nginx dùng đường dẫn được biên dịch sẵn:

```console
$ docker run --rm nginx:1.30-alpine nginx -V 2>&1 | tr ' ' '\n' | grep -E 'log-path'
--error-log-path=/var/log/nginx/error.log
--http-log-path=/var/log/nginx/access.log
```

(Bản Debian được biên dịch với `--error-log-path=stderr`, còn file `/var/log/nginx/error.log`
là do `nginx.conf` của gói khai báo.)

Mẹo khác: `ls -l /var/log/nginx/` (xem file nào đang lớn lên), `sudo lsof -c nginx | grep log`
(file log nào đang được mở).

### 1.4 Nginx trong Docker

Trong image chính thức, hai file log là symlink tới đầu ra chuẩn của container:

```console
$ docker run --rm nginx:1.30-alpine ls -l /var/log/nginx
total 8
lrwxrwxrwx    1 root     root            11 Oct 21 23:13 access.log -> /dev/stdout
lrwxrwxrwx    1 root     root            11 Oct 21 23:13 error.log -> /dev/stderr
```

Vì vậy với image gốc, log được xem bằng `docker logs <container>` hoặc
`docker compose logs -f nginx`. Dự án này mount thư mục `./nginx/logs` của máy host đè lên
`/var/log/nginx` (xem `docker-compose.yml`). Thư mục mount **che** các symlink, Nginx ghi ra
file thật và ta đọc được bằng các lệnh của tài liệu này:

```console
$ docker compose exec nginx ls -l /var/log/nginx
total 12
-rw-r--r--    1 root     root          6639 Nov  6 14:01 access.log
-rw-r--r--    1 root     root          1499 Nov  6 14:01 error.log
$ docker compose logs nginx | tail -n 4
qlsv-nginx  | /docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh
qlsv-nginx  | /docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh
qlsv-nginx  | /docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh
qlsv-nginx  | /docker-entrypoint.sh: Configuration complete; ready for start up
```

(`docker compose logs` giờ chỉ còn thông báo khởi động; access log nằm trong `nginx/logs/`.)

Hai điểm cần biết khi chạy trong Docker:

- **Múi giờ:** container mặc định dùng UTC (log ghi `+0000`). `docker-compose.yml` đặt
  `TZ: Asia/Ho_Chi_Minh` nên `$time_local` ghi giờ Việt Nam `+0700`.
- **IP client:** trên Docker Desktop/OrbStack, request từ trình duyệt của máy host đi qua mạng
  ảo của Docker, nên `$remote_addr` là IP gateway của mạng đó (lần chạy thử trong tài liệu này
  là `192.168.107.1`), không phải `127.0.0.1`. Khi Nginx đứng sau một proxy/load balancer khác,
  dùng module `realip` (`set_real_ip_from`, `real_ip_header X-Forwarded-For`) để lấy IP thật.

## 2. Cấu trúc log: log_format

### 2.1 Định dạng combined (mặc định)

Khi viết `access_log /đường/dẫn;` mà không nêu tên định dạng, Nginx dùng định dạng có sẵn
`combined`. Định nghĩa chính thức (tài liệu module `ngx_http_log_module`):

```nginx
log_format combined '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent"';
```

`combined` được định nghĩa sẵn, không khai báo lại được. Image Docker chính thức còn khai báo
thêm định dạng `main` = combined + `"$http_x_forwarded_for"`:

```console
$ docker run --rm nginx:1.30-alpine grep -A 3 'log_format' /etc/nginx/nginx.conf
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';
```

Một dòng thật trong `access-combined.log`:

```console
$ grep '06/Nov/2026:14:02:05' access-combined.log | grep bulk-copy
192.168.1.15 - - [06/Nov/2026:14:02:05 +0700] "POST /api/students/bulk-copy HTTP/1.1" 201 407 "http://qlsv.example.com:8080/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0"
```

| # | Biến | Giá trị trong ví dụ | Ý nghĩa |
|---|---|---|---|
| 1 | `$remote_addr` | `192.168.1.15` | IP của client kết nối tới Nginx |
| 2 | `-` | `-` | Chữ `-` cố định (trước đây là "ident" theo RFC 1413, nay không dùng) |
| 3 | `$remote_user` | `-` | Tên đăng nhập **HTTP Basic Auth**; không dùng Basic Auth thì là `-` |
| 4 | `[$time_local]` | `[06/Nov/2026:14:02:05 +0700]` | Thời điểm **ghi log** (lúc xử lý xong request), giờ địa phương + độ lệch múi giờ |
| 5 | `"$request"` | `"POST /api/students/bulk-copy HTTP/1.1"` | Dòng request gốc: phương thức, đường dẫn (kèm query string), giao thức |
| 6 | `$status` | `201` | Mã trạng thái HTTP trả về |
| 7 | `$body_bytes_sent` | `407` | Số byte **phần thân** đã gửi (không tính header); 304 thì là 0 |
| 8 | `"$http_referer"` | `"http://qlsv.example.com:8080/"` | Trang chứa liên kết/gọi request; `-` nếu không có |
| 9 | `"$http_user_agent"` | `"Mozilla/5.0 (Windows NT 10.0; …) … Edg/153.0.0.0"` | Trình duyệt/công cụ của client (ở đây là Edge trên Windows) |

Đọc dòng trên: *máy 192.168.1.15, lúc 14:02:05 ngày 06/11/2026, dùng Edge trên Windows, từ
trang chủ của ứng dụng đã gửi `POST /api/students/bulk-copy` (sao chép sinh viên), server trả
201 Created kèm 407 byte dữ liệu.* Với định dạng `combined` ta **không biết ai** (tài khoản
nào) đã làm việc đó, vì app dùng JWT chứ không dùng Basic Auth nên `$remote_user` luôn là `-`.

Một số điểm hay bị hiểu nhầm:

- Giá trị rỗng được ghi là `-`.
- Ký tự `"`, `\` và ký tự điều khiển trong giá trị được Nginx ghi dưới dạng `\xHH`
  (`escape=default`), nên dấu `"` không bao giờ xuất hiện "trần" bên trong một trường. Nhờ vậy
  tách trường theo dấu `"` (mục 2.3) luôn an toàn.
- Dòng request là thứ client gửi, **chưa giải mã**: chữ tiếng Việt trong ô tìm kiếm xuất hiện
  dạng `%E1%BA%A7` (xem mục 10).

### 2.2 Định dạng qlsv của dự án

Để biết **ai** (tài khoản nào) truy cập và request **mất bao lâu**, dự án khai báo định dạng
riêng trong `nginx/qlsv.conf`:

```nginx
log_format qlsv '$remote_addr - $remote_user [$time_local] "$request" '
                '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                '"$upstream_http_x_user" rt=$request_time urt=$upstream_response_time';

server {
    ...
    access_log /var/log/nginx/access.log qlsv;
    proxy_hide_header X-User;
}
```

Ba trường thêm vào cuối:

| Trường | Ý nghĩa |
|---|---|
| `"$upstream_http_x_user"` | Giá trị header `X-User` trong **response của app**. App (middleware `authenticate`) đặt header này bằng tên đăng nhập cho mọi request đã xác thực. Quy tắc tên biến: `$upstream_http_` + tên header viết thường, `-` đổi thành `_`. `-` nghĩa là chưa đăng nhập, file tĩnh, đăng nhập sai hoặc Nginx tự trả lời |
| `rt=$request_time` | Tổng thời gian xử lý request (giây, chính xác tới mili giây), tính cả thời gian nhận body và gửi response tới client |
| `urt=$upstream_response_time` | Thời gian chờ app trả lời. `-` khi request **không** được chuyển vào app (ví dụ 413, 400 do Nginx tự trả) |

Cùng request ở trên, trong `access.log` (định dạng qlsv):

```console
$ grep '06/Nov/2026:14:02:05' access.log | grep bulk-copy
192.168.1.15 - - [06/Nov/2026:14:02:05 +0700] "POST /api/students/bulk-copy HTTP/1.1" 201 407 "http://qlsv.example.com:8080/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0" "giaovu" rt=0.004 urt=0.004
```

Giờ ta biết thêm: người thực hiện là tài khoản **`giaovu`**, app xử lý mất 4 ms.

Vì sao làm như vậy:

- `log_format` **chỉ được khai báo trong context `http`**. File `nginx/qlsv.conf` được mount
  vào `/etc/nginx/conf.d/`, và `nginx.conf` có dòng `include /etc/nginx/conf.d/*.conf;` nằm
  *bên trong* khối `http { }`, nên khai báo `log_format` ở đầu file là hợp lệ.
- `proxy_hide_header X-User` xóa header khỏi response gửi cho trình duyệt (người dùng không cần
  thấy), nhưng biến `$upstream_http_x_user` vẫn đọc được để ghi log.
- Client **không giả mạo được** trường user: giá trị lấy từ *response* của app, không phải từ
  header client gửi lên (nếu dùng `$http_x_user` thì ai cũng tự đặt được).
- `urt` lớn mà `rt` cũng lớn → app chậm. `rt` lớn hơn hẳn `urt` → mạng của client chậm (tải
  response lâu) hoặc client upload chậm. Do đo bằng bộ đếm thời gian khác nhau, đôi khi `urt`
  lớn hơn `rt` 0,001 giây, đó là bình thường.

Một số dòng **thật** do Nginx của dự án ghi khi chạy thử (traffic tạo bằng curl, một số request
giả User-Agent trình duyệt):

```console
$ grep -E '" (403|401|413|204) ' nginx/logs/access.log
192.168.107.1 - - [06/Nov/2026:14:01:17 +0700] "DELETE /api/students/1 HTTP/1.1" 403 114 "http://localhost:8080/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "viewer" rt=0.002 urt=0.002
192.168.107.1 - - [06/Nov/2026:14:01:18 +0700] "GET /api/students HTTP/1.1" 401 118 "-" "curl/8.7.1" "-" rt=0.002 urt=0.002
192.168.107.1 - - [06/Nov/2026:14:01:18 +0700] "POST /api/auth/login HTTP/1.1" 401 99 "http://localhost:8080/login.html" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "-" rt=0.032 urt=0.032
192.168.107.1 - - [06/Nov/2026:14:01:18 +0700] "GET /favicon.ico HTTP/1.1" 204 0 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "-" rt=0.001 urt=0.001
192.168.107.1 - - [06/Nov/2026:14:01:19 +0700] "GET /api/students/export?format=json&q= HTTP/1.1" 403 121 "-" "curl/8.7.1" "viewer" rt=0.001 urt=0.001
192.168.107.1 - - [06/Nov/2026:14:01:19 +0700] "GET /api/students/export?format=json&q= HTTP/1.1" 403 121 "-" "curl/8.7.1" "viewer" rt=0.000 urt=0.000
192.168.107.1 - - [06/Nov/2026:14:01:19 +0700] "POST /api/students/import HTTP/1.1" 413 78 "http://localhost:8080/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "-" rt=0.000 urt=-
```

Các dòng 403 có user `viewer` (đã đăng nhập nhưng không có quyền xóa, không có quyền xuất file);
hai dòng 401 không có user (một request không gửi token, một lần đăng nhập sai mật khẩu); dòng
204 là `/favicon.ico` (app không có file này, Nginx trả 204); dòng 413 do chính Nginx chặn nên
`urt=-` và user `-`.

Các biến hữu ích khác khi tự thiết kế `log_format`:

| Biến | Ý nghĩa |
|---|---|
| `$time_iso8601` | Thời gian dạng ISO 8601 (`2026-11-06T14:02:05+07:00`), dễ sắp xếp, dễ so sánh |
| `$msec` | Thời gian dạng số giây Unix có phần mili giây |
| `$request_id` | Mã ngẫu nhiên cho mỗi request, gửi kèm sang app để đối chiếu log hai bên |
| `$upstream_addr`, `$upstream_status` | Địa chỉ và status của server phía sau đã xử lý |
| `$http_x_forwarded_for` | Chuỗi IP khi đứng sau proxy khác |
| `$host`, `$server_name` | Tên miền được truy cập |
| `$request_length`, `$bytes_sent` | Kích thước request; tổng byte gửi (kể cả header) |

Có thể ghi log dạng JSON cho hệ thống thu thập log (ELK, Loki…): khai báo
`log_format json_log escape=json '{"time":"$time_iso8601","ip":"$remote_addr",…}';`.
**Không bao giờ** đưa `$http_authorization`, `$http_cookie` hay `$request_body` vào log (mục 10).

### 2.3 Hai cách tách trường bằng awk

**Cách 1: tách theo dấu cách** (mặc định của `awk`). Đơn giản nhưng User-Agent có dấu cách nên
bị chia thành nhiều trường:

```console
$ grep '06/Nov/2026:14:02:05' access.log | grep bulk-copy | awk '{ for (i = 1; i <= 16; i++) printf "$%d = %s\n", i, $i }'
$1 = 192.168.1.15
$2 = -
$3 = -
$4 = [06/Nov/2026:14:02:05
$5 = +0700]
$6 = "POST
$7 = /api/students/bulk-copy
$8 = HTTP/1.1"
$9 = 201
$10 = 407
$11 = "http://qlsv.example.com:8080/"
$12 = "Mozilla/5.0
$13 = (Windows
$14 = NT
$15 = 10.0;
$16 = Win64;
```

Các trường "ổn định" khi tách theo dấu cách: `$1` IP, `$4` thời gian (có dấu `[`), `$6` phương
thức (có dấu `"`), `$7` đường dẫn, `$9` status, `$10` số byte.

**Cách 2: tách theo dấu nháy kép** `-F'"'`. Mỗi phần nằm trong `"…"` thành một trường riêng, kể
cả User-Agent:

```console
$ grep '06/Nov/2026:14:02:05' access.log | grep bulk-copy | awk -F'"' '{ for (i = 1; i <= NF; i++) printf "$%d = [%s]\n", i, $i }'
$1 = [192.168.1.15 - - [06/Nov/2026:14:02:05 +0700] ]
$2 = [POST /api/students/bulk-copy HTTP/1.1]
$3 = [ 201 407 ]
$4 = [http://qlsv.example.com:8080/]
$5 = [ ]
$6 = [Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0]
$7 = [ ]
$8 = [giaovu]
$9 = [ rt=0.004 urt=0.004]
```

| Trường (`-F'"'`) | Nội dung |
|---|---|
| `$1` | `IP - remote_user [thời gian] ` (tách tiếp bằng `split($1, a, " ")`) |
| `$2` | Dòng request |
| `$3` | ` status byte ` (tách tiếp bằng `split($3, s, " ")`) |
| `$4` | Referer |
| `$6` | User-Agent |
| `$8` | User (X-User), chỉ có ở định dạng qlsv |
| `$9` | ` rt=… urt=…` |

Cách 2 an toàn hơn, mục 6 có ví dụ cách 1 cho kết quả **sai**.

## 3. Lệnh cơ bản: ai, khi nào, từ IP nào

### 3.1 Xem log mới nhất và theo dõi trực tiếp

```console
$ tail -n 3 access.log | cut -c 1-150
192.168.1.23 - - [06/Nov/2026:17:00:35 +0700] "GET /api/students?page=1&pageSize=10&q= HTTP/1.1" 200 4060 "http://qlsv.example.com:8080/" "Mozilla/5.0
192.168.1.23 - - [06/Nov/2026:17:02:32 +0700] "PUT /api/students/54 HTTP/1.1" 200 384 "http://qlsv.example.com:8080/" "Mozilla/5.0 (Macintosh; Intel M
192.168.1.23 - - [06/Nov/2026:17:02:33 +0700] "GET /api/students?page=1&pageSize=10&q= HTTP/1.1" 200 3920 "http://qlsv.example.com:8080/" "Mozilla/5.0
```

`tail -f` (follow) đứng chờ và in thêm dòng mới ngay khi có request; bấm `Ctrl+C` để thoát.
Kết quả thật khi mở trang đăng nhập qua Nginx của dự án:

```console
$ tail -f nginx/logs/access.log
192.168.107.1 - - [06/Nov/2026:14:01:15 +0700] "GET /login.html HTTP/1.1" 200 6383 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "-" rt=0.002 urt=0.002
192.168.107.1 - - [06/Nov/2026:14:01:15 +0700] "GET /css/style.css HTTP/1.1" 200 41769 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "-" rt=0.002 urt=0.001
192.168.107.1 - - [06/Nov/2026:14:01:15 +0700] "GET /js/login.js HTTP/1.1" 200 3914 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" "-" rt=0.001 urt=0.002
^C
```

Biến thể: `tail -F` (theo dõi tiếp cả khi file bị logrotate đổi tên), `tail -f access.log | grep --line-buffered ' 50[0-9] '`
(chỉ xem lỗi 5xx khi chúng xảy ra), `less +F access.log` (bấm `Ctrl+C` để cuộn/tìm, `F` để theo dõi tiếp).

### 3.2 Chọn vài cột cần xem

```console
$ awk '{ print $1, $4, $9, $7 }' access.log | head -n 5
66.249.66.1 [01/Nov/2026:01:45:14 200 /
66.249.66.1 [01/Nov/2026:09:03:54 200 /login.html
66.249.66.1 [01/Nov/2026:17:45:22 200 /
198.51.100.14 [01/Nov/2026:20:14:22 200 /login.html
198.51.100.14 [01/Nov/2026:20:14:22 200 /css/style.css
```

### 3.3 Từ IP nào?

Top IP gửi nhiều request nhất. Đây là "công thức" quan trọng nhất của phân tích log:
**lấy cột → `sort` → `uniq -c` (đếm các dòng giống nhau liền kề) → `sort -rn` (sắp theo số
giảm dần)**:

```console
$ awk '{ print $1 }' access.log | sort | uniq -c | sort -rn | head -n 10
 252 192.168.1.15
 205 192.168.1.23
 148 192.168.1.10
 120 192.168.1.37
  45 10.10.0.21
  44 203.0.113.25
  43 203.0.113.80
  31 192.0.2.150
  30 198.51.100.77
  26 192.168.1.42
```

Số IP khác nhau, và các IP **ngoài** mạng nội bộ (192.168.x.x, 10.x.x.x, 172.16.x.x):

```console
$ awk '{ print $1 }' access.log | sort -u | wc -l
      15
$ awk '$1 !~ /^(192\.168\.|10\.|172\.16\.)/ { print $1 }' access.log | sort | uniq -c | sort -rn
  44 203.0.113.25
  43 203.0.113.80
  31 192.0.2.150
  30 198.51.100.77
  18 198.51.100.14
  14 66.249.66.1
```

`cut -d ' ' -f 1 access.log` cho kết quả giống `awk '{ print $1 }'`.

### 3.4 Ai truy cập? (cột X-User)

```console
$ awk -F'"' '{ print $8 }' access.log | sort | uniq -c | sort -rn
 584 -
 148 giaovu
 113 giangvien
  95 admin
  77 viewer
```

`-` chiếm phần lớn vì gồm file tĩnh (HTML, CSS, JS không cần đăng nhập), khách chưa đăng nhập,
bot, máy quét. Ghép **user ↔ IP** để biết mỗi người dùng truy cập từ đâu:

```console
$ awk -F'"' '$8 != "-" { split($1, a, " "); print $8, a[1] }' access.log | sort | uniq -c
  24 admin 172.16.0.5
  71 admin 192.168.1.10
  96 giangvien 192.168.1.23
  17 giangvien 203.0.113.25
 139 giaovu 192.168.1.15
   9 giaovu 198.51.100.14
  18 viewer 10.10.0.21
  43 viewer 192.168.1.37
  16 viewer 203.0.113.80
```

Đọc kết quả: `admin` dùng hai nơi (máy 192.168.1.10 và máy chủ/máy dev 172.16.0.5 chạy script),
`giangvien` có thêm IP 203.0.113.25 (ở nhà), `viewer` dùng cả máy phòng lab, Wi-Fi trường
(10.10.0.21) và 4G (203.0.113.80). Một tài khoản đột nhiên xuất hiện từ IP lạ là dấu hiệu
cần kiểm tra (lộ mật khẩu?).

Lịch sử đăng nhập (thành công và thất bại):

```console
$ awk -F'"' '$2 ~ /^POST \/api\/auth\/login / { split($1, a, " "); split($3, s, " "); print substr(a[4], 2), a[1], s[1], $8 }' access.log
01/Nov/2026:20:14:34 198.51.100.14 200 giaovu
01/Nov/2026:23:30:01 172.16.0.5 200 admin
02/Nov/2026:08:05:14 192.168.1.10 200 admin
02/Nov/2026:08:26:30 192.168.1.37 200 viewer
02/Nov/2026:09:21:23 192.168.1.15 200 giaovu
02/Nov/2026:15:28:08 192.168.1.23 200 giangvien
02/Nov/2026:15:42:24 172.16.0.5 200 admin
02/Nov/2026:16:36:55 172.16.0.5 200 admin
02/Nov/2026:19:40:03 203.0.113.80 200 viewer
02/Nov/2026:23:30:04 172.16.0.5 200 admin
03/Nov/2026:02:13:24 198.51.100.77 401 -
03/Nov/2026:02:13:27 198.51.100.77 401 -
… (còn 52 dòng)
```

Status 200 kèm tên user là đăng nhập thành công; 401 là sai tên/mật khẩu (user `-` vì chưa
biết là ai).

### 3.5 Khi nào? Lần đầu, lần cuối; theo ngày; theo giờ

Lần truy cập đầu tiên và cuối cùng của mỗi người dùng (log đã sắp theo thời gian nên dòng
gặp đầu tiên là sớm nhất):

```console
$ awk -F'"' '$8 != "-" { split($1, a, " "); t = substr(a[4], 2); if (!($8 in first)) first[$8] = t; last[$8] = t; n[$8]++ } END { for (u in first) printf "%-10s %5d request  từ %s  đến %s\n", u, n[u], first[u], last[u] }' access.log | sort
admin         95 request  từ 01/Nov/2026:23:30:01  đến 06/Nov/2026:14:35:40
giangvien    113 request  từ 02/Nov/2026:15:28:08  đến 06/Nov/2026:17:02:33
giaovu       148 request  từ 01/Nov/2026:20:14:34  đến 06/Nov/2026:14:08:09
viewer        77 request  từ 02/Nov/2026:08:26:30  đến 06/Nov/2026:14:16:22
```

Số request theo ngày (`substr($4, 2, 11)` lấy `06/Nov/2026` từ `[06/Nov/2026:14:02:05`). Không
cần `sort` trước `uniq -c` vì log vốn đã theo thứ tự thời gian:

```console
$ awk '{ print substr($4, 2, 11) }' access.log | uniq -c
  23 01/Nov/2026
 129 02/Nov/2026
 233 03/Nov/2026
 207 04/Nov/2026
 205 05/Nov/2026
 220 06/Nov/2026
```

Số request theo giờ trong ngày (gộp mọi ngày), thấy rõ giờ cao điểm và lưu lượng lúc 2–3 giờ
sáng (máy quét):

```console
$ awk '{ print substr($4, 14, 2) "h" }' access.log | sort | uniq -c
   1 00h
   1 01h
  30 02h
  31 03h
   1 07h
 100 08h
 134 09h
 115 10h
  37 11h
   1 12h
  35 13h
 208 14h
  96 15h
 110 16h
  24 17h
  43 19h
  39 20h
  11 23h
```

## 4. Lọc theo ngày và giờ

Thời gian trong log có dạng `[06/Nov/2026:14:02:05 +0700]`: ngày/tháng tiếng Anh viết tắt/năm,
rồi `:giờ:phút:giây`. Nên luôn có dấu `[` đứng trước để không khớp nhầm chỗ khác trong dòng
(dấu `[` là ký tự đặc biệt của regex nên phải viết `\[`).

### 4.1 Dùng grep

```console
$ grep -c '\[06/Nov/2026' access.log
220
$ grep '\[06/Nov/2026:14' access.log | wc -l
      80
$ grep -cE '\[06/Nov/2026:(0[89]|1[01]):' access.log
115
```

Lần lượt: cả ngày 06/11; riêng 14:00–14:59; từ 08:00 đến 11:59 (regex `(0[89]|1[01])` khớp
giờ 08, 09, 10, 11).

Log của **hôm nay**, dùng được cho cả Linux và macOS:

```console
$ LC_ALL=C date '+%d/%b/%Y'
06/Nov/2026
$ grep -c "\[$(LC_ALL=C date '+%d/%b/%Y')" access.log
220
```

`LC_ALL=C` bắt `date` in tên tháng tiếng Anh như Nginx. Trên máy đặt locale tiếng Việt, `%b`
có thể ra `Thg 11`. Kiểm tra trên Debian có cài locale `vi_VN.UTF-8`:

```console
$ LC_ALL=vi_VN.UTF-8 date '+%d/%b/%Y'
06/Thg 11/2026
$ LC_ALL=C date '+%d/%b/%Y'
06/Nov/2026
```

(Trên macOS thường không có locale `vi_VN`, nên lỗi này hay gặp trên máy chủ Linux.)

### 4.2 Dùng awk theo khoảng thời gian

So sánh chuỗi `$4` với mốc thời gian (cùng định dạng, kể cả dấu `[`), ví dụ 14:00 đến trước 14:15:

```console
$ awk '$4 >= "[06/Nov/2026:14:00:00" && $4 < "[06/Nov/2026:14:15:00"' access.log | wc -l
      43
```

So sánh chuỗi chỉ đúng **trong cùng một tháng**: ngày đứng đầu nên `"[30/Oct…" > "[01/Nov…"`.
Khi khoảng thời gian vắt qua ngày/tháng, đổi thời gian thành khóa sắp xếp được
`yyyymmddHHMMSS` (dùng được với mọi awk, không cần hàm riêng của gawk):

```console
$ awk 'BEGIN { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", m, " "); for (i = 1; i <= 12; i++) mon[m[i]] = sprintf("%02d", i) }
{ t = substr($4, 2); key = substr(t, 8, 4) mon[substr(t, 4, 3)] substr(t, 1, 2) substr(t, 13, 2) substr(t, 16, 2) substr(t, 19, 2) }
key >= "20261104220000" && key < "20261105060000" { print substr($4, 2), $1, $7 }' access.log | head -n 4
04/Nov/2026:23:30:01 172.16.0.5 /api/auth/login
04/Nov/2026:23:30:01 172.16.0.5 /api/students/export?format=json&q=
05/Nov/2026:03:01:50 192.0.2.150 /
05/Nov/2026:03:01:51 192.0.2.150 /robots.txt
```

(Ví dụ trên lọc từ 22:00 ngày 04/11 đến trước 06:00 ngày 05/11 và thấy ngay máy quét lúc 3 giờ sáng.)

### 4.3 Dùng sed theo khoảng dòng

`sed -n '/mẫu_bắt_đầu/,/mẫu_kết_thúc/p'` in từ dòng **đầu tiên** khớp mẫu bắt đầu tới dòng
**đầu tiên** khớp mẫu kết thúc (in cả dòng đó):

```console
$ sed -n '/\[06\/Nov\/2026:14:/,/\[06\/Nov\/2026:16:/p' access.log | wc -l
      81
$ sed -n '/\[06\/Nov\/2026:14:/,/\[06\/Nov\/2026:16:/p' access.log | tail -n 2 | cut -c 1-80
10.10.0.34 - - [06/Nov/2026:14:51:56 +0700] "POST /api/auth/login HTTP/1.1" 401 
192.168.1.23 - - [06/Nov/2026:16:12:32 +0700] "GET / HTTP/1.1" 304 0 "-" "Mozill
```

Ngày 06/11 có 80 dòng lúc 14:xx (mục 4.1) nhưng `sed` in ra thêm **dòng đầu tiên lúc 16:xx**,
chính là dòng khớp mẫu kết thúc. Bẫy thứ hai: nếu mẫu kết thúc **không có dòng nào khớp** thì
`sed` in tới hết file. Ngày 06/11 không có request nào lúc 15:xx, nên lấy "14 giờ đến 15 giờ"
lại ra cả các dòng lúc 17 giờ:

```console
$ sed -n '/\[06\/Nov\/2026:14:/,/\[06\/Nov\/2026:15:/p' access.log | wc -l
     104
$ sed -n '/\[06\/Nov\/2026:14:/,/\[06\/Nov\/2026:15:/p' access.log | tail -n 1 | cut -c 1-80
192.168.1.23 - - [06/Nov/2026:17:02:33 +0700] "GET /api/students?page=1&pageSize
```

(Mẫu bắt đầu không khớp dòng nào thì `sed` không in gì.) Vì vậy `awk` so sánh thời gian (mục
4.2) dễ kiểm soát hơn.

### 4.4 N phút gần nhất (khác nhau giữa GNU và BSD)

Tính mốc "15 phút trước" bằng `date`, cú pháp khác nhau giữa hai hệ:

```console
$ LC_ALL=C date -v-15M '+%d/%b/%Y:%H:%M'
06/Nov/2026:14:17
$ docker run --rm -e TZ=Asia/Ho_Chi_Minh debian:stable-slim date -d '15 minutes ago' '+%d/%b/%Y:%H:%M'
06/Nov/2026:14:17
```

Lệnh đầu là BSD `date` của macOS (`-v-15M`); lệnh sau chạy GNU `date` trong container Debian
(`-d '15 minutes ago'`). Ghép với awk để lấy các request trong 15 phút gần nhất:

```console
$ since="[$(LC_ALL=C date -v-15M '+%d/%b/%Y:%H:%M:%S')"
$ echo "$since"
[06/Nov/2026:14:17:54
$ awk -v s="$since" '$4 >= s' access.log | wc -l
      57
```

Trên Linux thay dòng đầu bằng `since="[$(LC_ALL=C date -d '15 minutes ago' '+%d/%b/%Y:%H:%M:%S')"`.
(Log mẫu kéo dài tới 17:02 ngày 06/11 nên ví dụ trên vẫn có kết quả; trên log thật lệnh này
cho biết lưu lượng 15 phút vừa qua.)

## 5. Lọc theo user-agent

User-Agent là trường `$6` khi tách theo `"`. Thống kê theo User-Agent (cắt bớt cho gọn):

```console
$ awk -F'"' '{ print $6 }' access.log | sort | uniq -c | sort -rn | cut -c 1-110
 252 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/
 205 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Saf
 174 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/
 120 Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0
  53 Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/2
  45 Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/
  44 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 S
  29 sqlmap/1.9.11#stable (https://sqlmap.org)
  24 Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0
  14 Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
  10 python-requests/2.32.5
   8 curl/8.7.1
   7 PostmanRuntime/7.49.1
   3 -
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000575)
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000549)
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000536)
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000502)
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000489)
   1 Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000464)
… (còn 23 dòng)
```

Gom nhóm theo trình duyệt. Thứ tự kiểm tra **quan trọng**, vì User-Agent của Edge chứa cả chữ
`Chrome` và `Safari`, của Chrome chứa chữ `Safari`:

```console
$ awk -F'"' '{ ua = $6; b = "Khác"
  if (ua ~ /Edg\//) b = "Edge"; else if (ua ~ /Chrome\//) b = "Chrome"; else if (ua ~ /Firefox\//) b = "Firefox"
  else if (ua ~ /Safari\//) b = "Safari"; else if (ua ~ /bot|Bot/) b = "Bot"
  else if (ua ~ /^(curl|PostmanRuntime|python-requests)/) b = "Công cụ/script"; else if (ua ~ /sqlmap|Nikto/) b = "Máy quét"
  print b }' access.log | sort | uniq -c | sort -rn
 263 Chrome
 258 Safari
 252 Edge
 144 Firefox
  58 Máy quét
  25 Công cụ/script
  14 Bot
   3 Khác
```

(Nhóm "Khác" là các dòng User-Agent trống `-`.)

Lọc nhanh bằng `grep -i` (không phân biệt hoa thường):

```console
$ grep -ci 'googlebot' access.log
14
$ grep -iE 'curl|python-requests|postmanruntime' access.log | awk -F'"' '{ print $6 }' | sort | uniq -c
   7 PostmanRuntime/7.49.1
   8 curl/8.7.1
  10 python-requests/2.32.5
$ grep -iE 'sqlmap|nikto' access.log | awk '{ print $1 }' | sort | uniq -c
  29 192.0.2.150
  29 198.51.100.77
```

`grep` tìm trên **cả dòng**, nên có thể khớp nhầm đường dẫn hay referer chứa chữ đó. Muốn chính
xác thì so trên đúng trường `$6`; `tolower()` có trong mọi bản awk (còn `IGNORECASE` chỉ gawk có):

```console
$ awk -F'"' 'tolower($6) ~ /bot/' access.log | wc -l
      14
$ awk -F'"' '$6 ~ /Android|iPhone/ { split($1, a, " "); print a[1], $8 }' access.log | sort | uniq -c
  27 10.10.0.21 -
  18 10.10.0.21 viewer
  10 10.10.0.34 -
  27 203.0.113.80 -
  16 203.0.113.80 viewer
$ awk -F'"' '$6 == "-"' access.log | cut -c 1-120
198.51.100.77 - - [03/Nov/2026:02:12:58 +0700] "\x16\x03\x01\x02\x00\x01\x00\x01\xFC\x03\x032o\xFD\xE8^h\x05!{i\xBF\x1D\
192.0.2.150 - - [05/Nov/2026:03:02:35 +0700] "GET /../../etc/passwd HTTP/1.1" 400 150 "-" "-" "-" rt=0.002 urt=-
192.0.2.150 - - [05/Nov/2026:03:02:36 +0700] "GET /uploads/../../data/app.db HTTP/1.1" 400 150 "-" "-" "-" rt=0.001 urt=
```

Dòng cuối: request **không có User-Agent**, thường là máy quét hoặc request hỏng mà Nginx từ
chối trước khi đọc header.

Chuỗi User-Agent do client tự khai, giả được dễ dàng. Muốn biết "Googlebot" có thật không, tra
DNS ngược rồi tra xuôi (kết quả thật):

```console
$ host 66.249.66.1
1.66.249.66.in-addr.arpa domain name pointer crawl-66-249-66-1.googlebot.com.
$ host crawl-66-249-66-1.googlebot.com
crawl-66-249-66-1.googlebot.com has address 66.249.66.1
```

Tên miền ngược phải thuộc `googlebot.com` hoặc `google.com` và tra xuôi phải ra lại đúng IP.

## 6. Lọc theo status code

### 6.1 Đếm theo status và cạm bẫy khi tách theo dấu cách

```console
$ awk '{ print $9 }' access.log | sort | uniq -c | sort -rn
 586 200
 291 304
  58 401
  29 404
  21 201
   8 400
   7 502
   7 403
   3 409
   3 204
   2 413
   1 500
   1 150
```

Có một "status" lạ là **150**. Nó trông giống một mã 1xx hợp lệ nên không lọc được bằng cách
kiểm tra `$9`; hãy tìm dòng mà cột phương thức `$6` không có dạng `"` + chữ in hoa:

```console
$ awk '$6 !~ /^"[A-Z]+$/' access.log
198.51.100.77 - - [03/Nov/2026:02:12:58 +0700] "\x16\x03\x01\x02\x00\x01\x00\x01\xFC\x03\x032o\xFD\xE8^h\x05!{i\xBF\x1D\xF1\x9C0\x91\xB8\xBF\x11\x9Fj<J%M\xBC " 400 150 "-" "-" "-" rt=0.041 urt=-
```

Đó là một client gửi gói bắt tay **TLS (https)** vào cổng HTTP. Nginx không hiểu, trả 400 và
ghi nguyên các byte nhận được (dạng `\xHH`). Phần "request" này không có dấu cách ở giữa nên
mọi cột sau nó bị lệch: `$9` rơi vào số byte (150). Tách theo dấu `"` thì không bị lệch:

```console
$ awk -F'"' '{ split($3, s, " "); print s[1] }' access.log | sort | uniq -c | sort -rn
 586 200
 291 304
  58 401
  29 404
  21 201
   9 400
   7 502
   7 403
   3 409
   3 204
   2 413
   1 500
```

Ý nghĩa nhanh: 2xx thành công (200 OK, 201 Created, 204 No Content), 304 Not Modified (trình
duyệt dùng lại bản trong cache), 4xx lỗi phía client (400 dữ liệu sai, 401 chưa đăng nhập,
403 không có quyền, 404 không tìm thấy, 409 xung đột nghiệp vụ, 413 file quá lớn), 5xx lỗi
phía server (500 lỗi app, 502 Nginx không kết nối được app).

### 6.2 Lọc một status, một nhóm status

```console
$ awk '$9 == 404' access.log | wc -l
      29
$ grep -c 404 access.log
36
$ grep -cE '" 404 [0-9]+ "' access.log
29
```

`grep -c 404` đếm **sai** (nhiều hơn) vì chữ số 404 còn xuất hiện trong số byte, thời gian,
đường dẫn… Khi dùng grep, hãy neo theo cấu trúc dòng: dấu `"` đóng request, dấu cách, status,
dấu cách, số byte, dấu cách, dấu `"` mở referer.

Cả nhóm 5xx (lỗi phía server), dùng cách tách an toàn:

```console
$ awk -F'"' '{ split($3, s, " ") } s[1] >= 500' access.log | cut -c 1-120
192.168.1.23 - - [04/Nov/2026:10:03:02 +0700] "GET / HTTP/1.1" 502 150 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15
192.168.1.23 - - [04/Nov/2026:10:03:23 +0700] "GET / HTTP/1.1" 502 150 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15
192.168.1.15 - - [04/Nov/2026:10:04:05 +0700] "PUT /api/students/32 HTTP/1.1" 502 124 "http://qlsv.example.com:8080/" "M
192.168.1.15 - - [04/Nov/2026:10:04:06 +0700] "GET /api/students?page=1&pageSize=10&q=qtkd HTTP/1.1" 502 124 "http://qls
192.168.1.15 - - [04/Nov/2026:10:04:32 +0700] "GET /api/students?page=1&pageSize=10&q=qtkd HTTP/1.1" 502 124 "http://qls
192.168.1.15 - - [04/Nov/2026:10:05:08 +0700] "GET /api/students?page=1&pageSize=10&q=qtkd HTTP/1.1" 502 124 "http://qls
192.168.1.15 - - [04/Nov/2026:10:05:39 +0700] "GET / HTTP/1.1" 502 552 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ap
192.168.1.15 - - [05/Nov/2026:11:15:59 +0700] "GET /api/students/export?format=xlsx&q= HTTP/1.1" 500 108 "http://qlsv.ex
```

Các lỗi 4xx nhiều nhất theo status + request:

```console
$ awk -F'"' '{ split($3, s, " "); split($2, r, " ") } s[1] ~ /^4/ { print s[1], r[1], r[2] }' access.log | sort | uniq -c | sort -rn
  25 401 POST /api/auth/login
  19 401 GET /api/auth/me
   3 404 GET /robots.txt
   2 403 POST /api/auth/login
   2 400 POST /api/students
   2 400 POST /api/auth/login
   1 413 POST /api/students/import
   1 413 POST /api/students
   1 409 POST /api/users
   1 409 DELETE /api/users/1
   1 409 DELETE /api/roles/2
   1 404 TRACE /
… (còn 49 dòng)
```

### 6.3 Một số câu hỏi an ninh

Đường dẫn bị 404 nhiều nhất (máy quét dò file nhạy cảm):

```console
$ awk '$9 == 404 { print $7 }' access.log | sort | uniq -c | sort -rn
   3 /robots.txt
   2 /xmlrpc.php
   1 /wp-login.php
   1 /wp-admin/
   1 /web.config
   1 /uploads/
   1 /sitemap.xml
   1 /server.js
   1 /server-status
   1 /phpmyadmin/
… (còn 16 dòng)
```

Đăng nhập thất bại theo IP. Nhiều lần 401 từ cùng một IP trong thời gian ngắn là dấu hiệu
**dò mật khẩu** (brute force):

```console
$ awk '$6 == "\"POST" && $7 == "/api/auth/login" && $9 == 401 { print $1 }' access.log | sort | uniq -c | sort -rn
  12 198.51.100.77
  11 192.168.1.42
   2 10.10.0.34
$ grep '192.168.1.42' access.log | grep '/api/auth/login' | awk '{ print $4, $9 }' | head -n 8
[03/Nov/2026:10:12:40 401
[03/Nov/2026:10:12:52 401
[03/Nov/2026:10:13:01 401
[03/Nov/2026:10:13:13 401
[03/Nov/2026:10:13:21 401
[03/Nov/2026:10:13:28 401
[03/Nov/2026:10:13:39 401
[05/Nov/2026:15:10:45 401
```

(Ở đây `$6` là `"POST` vì dấu `"` dính vào phương thức khi tách theo dấu cách.)

Request chậm nhất (theo `rt=`):

```console
$ awk '{ for (i = NF; i > 0; i--) if ($i ~ /^rt=/) { print substr($i, 4), $9, $7; break } }' access.log | sort -rn | head -n 5
0.874 201 /api/students/import
0.566 201 /api/students/import
0.476 400 /api/students/import
0.317 200 /api/students/export?format=xlsx&q=
0.315 200 /api/students/export?format=xlsx&q=
```

Hai kiểu 413: Nginx chặn (body vượt `client_max_body_size 10m`, request không tới app, `urt=-`,
không có user) và app chặn (ảnh vượt 5 MB, có user):

```console
$ awk -F'"' '{ split($3, s, " ") } s[1] == 413 { print $2, "|", s[1], s[2], "| user:", $8, "|", $9 }' access.log
POST /api/students/import HTTP/1.1 | 413 78 | user: - |  rt=0.002 urt=-
POST /api/students HTTP/1.1 | 413 205 | user: giaovu |  rt=0.105 urt=0.104
```

## 7. Kết hợp nhiều bộ lọc, script log-report.sh

### 7.1 Ghép lệnh bằng pipe

Ngày 04/11, những request lỗi (≥ 400) của giảng viên:

```console
$ grep '\[04/Nov/2026' access.log | awk -F'"' '$8 == "giangvien" { split($3, s, " "); if (s[1] >= 400) print }' | cut -c 1-120
192.168.1.23 - - [04/Nov/2026:14:06:46 +0700] "GET /api/students/export?format=xlsx&q=sv000012 HTTP/1.1" 403 121 "http:/
```

Khách chưa đăng nhập nhận 404 trong khoảng 0–6 giờ sáng, theo IP:

```console
$ awk -F'"' '{ split($1, a, " "); split($3, s, " "); h = substr(a[4], 14, 2) } s[1] == 404 && h < "06" && $8 == "-" { print a[1] }' access.log | sort | uniq -c
  26 192.0.2.150
```

Lỗi theo giờ của ngày 04/11 (thấy ngay sự cố 502 lúc 10 giờ):

```console
$ grep '\[04/Nov/2026' access.log | awk -F'"' '{ split($1, a, " "); split($3, s, " ") } s[1] >= 400 { print substr(a[4], 14, 2) "h", s[1] }' | sort | uniq -c
   2 08h 401
   1 09h 401
   7 10h 502
   1 13h 401
   1 14h 403
```

Các lệnh gọi API bằng công cụ/script (không phải trình duyệt), kèm tài khoản:

```console
$ awk -F'"' '$6 ~ /^(curl|PostmanRuntime|python-requests)/ { split($3, s, " "); print $8, $6, $2, s[1] }' access.log | sort | uniq -c | sort -rn
   5 admin python-requests/2.32.5 POST /api/auth/login HTTP/1.1 200
   5 admin python-requests/2.32.5 GET /api/students/export?format=json&q= HTTP/1.1 200
   2 admin curl/8.7.1 POST /api/auth/login HTTP/1.1 200
   1 admin curl/8.7.1 GET /api/students?page=4&pageSize=10 HTTP/1.1 200
   1 admin curl/8.7.1 GET /api/students?page=1&pageSize=10 HTTP/1.1 200
   1 admin curl/8.7.1 GET /api/students/export?format=json&q= HTTP/1.1 200
   1 admin curl/8.7.1 GET /api/students/9999 HTTP/1.1 404
   1 admin curl/8.7.1 GET /api/students/12 HTTP/1.1 200
   1 admin PostmanRuntime/7.49.1 PUT /api/roles/5 HTTP/1.1 200
   1 admin PostmanRuntime/7.49.1 POST /api/roles HTTP/1.1 201
… (còn 6 dòng)
```

### 7.2 Script scripts/log-report.sh

Để khỏi gõ lại các lệnh dài, dự án có `scripts/log-report.sh`: chỉ dùng bash + awk chuẩn
POSIX nên chạy được trên macOS (bash 3.2, awk BSD) lẫn Linux (gawk, mawk, BusyBox awk); kết quả
đã được kiểm tra giống hệt nhau trên cả bốn bản awk. Chạy từ thư mục gốc dự án:

```console
$ scripts/log-report.sh -h
Cách dùng: log-report.sh [tùy chọn]

Nguồn dữ liệu:
  -f FILE    File access log (mặc định /var/log/nginx/access.log). Có thể lặp lại
             nhiều lần (-f access.log -f access.log.1). File *.gz được tự giải nén.
             "-f -" = đọc từ stdin (dùng với pipe).

Bộ lọc (kết hợp được với nhau, tất cả phải thỏa):
  -d DATE    Ngày: 06/Nov/2026 hoặc 2026-11-06
  -H HOUR    Giờ (0-23): 14  hoặc khoảng 08-11 (tính cả hai đầu)
  -s STATUS  Mã trạng thái: 404 | 4xx | 5xx | danh sách "401,403" | "4xx,5xx"
  -a TEXT    User-Agent chứa TEXT (không phân biệt hoa thường), ví dụ: curl, bot
  -i IP      IP chính xác (192.168.1.15) hoặc tiền tố kết thúc bằng dấu chấm (192.168.1.)
  -u USER    Người dùng (cột X-User): admin, giaovu... Dùng "-" cho khách chưa đăng nhập

Hiển thị:
  -l N       Số request tối đa in ở phần danh sách (mặc định 30, 0 = in tất cả)
  -n N       Số dòng của mỗi bảng "top" (mặc định 10)
  -q         Không in danh sách request, chỉ in các bảng thống kê
  -h         Hiện hướng dẫn này
```

Ví dụ 1: ngày 06/11, giờ 14, in 8 request đầu và các bảng top 5:

```console
$ scripts/log-report.sh -f nginx/sample-logs/access.log -d 06/Nov/2026 -H 14 -l 8 -n 5

--- Danh sách request khớp bộ lọc ---
06/Nov/2026:14:01:37 | 192.168.1.15    | -          | GET / | 304
06/Nov/2026:14:01:37 | 192.168.1.15    | -          | GET /css/style.css | 304
06/Nov/2026:14:01:37 | 192.168.1.15    | -          | GET /js/main.js | 304
06/Nov/2026:14:01:37 | 192.168.1.15    | -          | GET /js/api.js | 304
06/Nov/2026:14:01:38 | 192.168.1.15    | -          | GET /js/views/students/index.js | 304
06/Nov/2026:14:01:39 | 192.168.1.15    | giaovu     | GET /api/auth/me | 200
06/Nov/2026:14:01:40 | 192.168.1.15    | giaovu     | GET /api/students?page=1&pageSize=10&q= | 200
06/Nov/2026:14:02:05 | 192.168.1.15    | giaovu     | POST /api/students/bulk-copy | 201
... còn 72 request nữa (dùng -l 0 để in tất cả, -l N để in N dòng)

=== Tổng quan ===
Nguồn: nginx/sample-logs/access.log
Bộ lọc: ngày=06/Nov/2026 giờ=14
Định dạng: qlsv (user lấy từ trường X-User)
Số dòng đã đọc: 1017 | khớp bộ lọc: 80 | dòng sai định dạng: 0
Từ 06/Nov/2026:14:01:37 đến 06/Nov/2026:14:51:56
Số IP khác nhau: 4 | số user khác nhau: 4

=== Top 5 IP (kèm các user đã đăng nhập từ IP đó) ===
      27   33.8%  192.168.1.10     user: -,admin
      26   32.5%  203.0.113.80     user: -,viewer
      21   26.2%  192.168.1.15     user: -,giaovu
       6    7.5%  10.10.0.34       user: -

=== Top 5 user ("-" = chưa đăng nhập / file tĩnh) ===
      42   52.5%  -             IP: 192.168.1.15,203.0.113.80,192.168.1.10,10.10.0.34
      16   20.0%  giaovu        IP: 192.168.1.15
      12   15.0%  admin         IP: 192.168.1.10
      10   12.5%  viewer        IP: 203.0.113.80

=== Status code ===
  200      46   57.5%
  201       4    5.0%
  304      25   31.2%
  400       1    1.2%
  401       4    5.0%

=== Số request theo giờ (gộp các ngày) ===
  14h      80  ########################################

=== Top 5 đường dẫn (đã bỏ query string) ===
      19   23.8%  /api/students
       8   10.0%  /css/style.css
       6    7.5%  /api/users
       5    6.2%  /
       5    6.2%  /api/auth/me
  ... và 15 mục khác

=== Lỗi 4xx/5xx: 5 request (gộp theo status + method + đường dẫn) ===
       2   40.0%  401 GET /api/auth/me
       2   40.0%  401 POST /api/auth/login
       1   20.0%  400 POST /api/students
```

Ví dụ 2: chỉ thống kê các lỗi 4xx và 5xx (không in danh sách):

```console
$ scripts/log-report.sh -f nginx/sample-logs/access.log -s 4xx,5xx -q -n 6

=== Tổng quan ===
Nguồn: nginx/sample-logs/access.log
Bộ lọc: status=4xx,5xx
Định dạng: qlsv (user lấy từ trường X-User)
Số dòng đã đọc: 1017 | khớp bộ lọc: 116 | dòng sai định dạng: 0
Từ 02/Nov/2026:08:08:01 đến 06/Nov/2026:14:51:56
Số IP khác nhau: 14 | số user khác nhau: 5

=== Top 6 IP (kèm các user đã đăng nhập từ IP đó) ===
      28   24.1%  192.0.2.150      user: -
      28   24.1%  198.51.100.77    user: -
      18   15.5%  192.168.1.15     user: giaovu,-
      11    9.5%  192.168.1.42     user: -
       7    6.0%  192.168.1.23     user: -,giangvien
       5    4.3%  192.168.1.10     user: admin,-
  ... và 8 mục khác

=== Top 6 user ("-" = chưa đăng nhập / file tĩnh) ===
     101   87.1%  -             IP: 172.16.0.5,66.249.66.1,198.51.100.77,192.168.1.42,192.168.1.23,... (+9)
       8    6.9%  giaovu        IP: 192.168.1.15
       4    3.4%  admin         IP: 192.168.1.10,172.16.0.5
       2    1.7%  viewer        IP: 10.10.0.21
       1    0.9%  giangvien     IP: 192.168.1.23

=== Status code ===
  400       9    7.8%
  401      58   50.0%
  403       7    6.0%
  404      29   25.0%
  409       3    2.6%
  413       2    1.7%
  500       1    0.9%
  502       7    6.0%

=== Số request theo ngày ===
  02/Nov/2026       6
  03/Nov/2026      41
  04/Nov/2026      12
  05/Nov/2026      43
  06/Nov/2026      14

=== Số request theo giờ (gộp các ngày) ===
  02h      28  ########################################
  03h      28  ########################################
  08h       7  ##########
  09h       8  ###########
  10h      17  ########################
  11h       2  ##
  13h       1  #
  14h      13  ##################
  15h       5  #######
  16h       4  #####
  19h       2  ##
  20h       1  #

=== Top 6 đường dẫn (đã bỏ query string) ===
      29   25.0%  /api/auth/login
      19   16.4%  /api/auth/me
      18   15.5%  /api/students
       4    3.4%  /
       3    2.6%  /api/users
       3    2.6%  /robots.txt
  ... và 37 mục khác

=== Lỗi 4xx/5xx: 116 request (gộp theo status + method + đường dẫn) ===
      25   21.6%  401 POST /api/auth/login
      19   16.4%  401 GET /api/auth/me
      12   10.3%  401 GET /api/students
       3    2.6%  404 GET /robots.txt
       3    2.6%  502 GET /
       3    2.6%  502 GET /api/students
  ... và 48 mục khác
```

Ví dụ 3: giảng viên bị từ chối quyền ngày 04/11 (ngày nhập theo dạng `2026-11-04` cũng được):

```console
$ scripts/log-report.sh -f nginx/sample-logs/access.log -u giangvien -d 2026-11-04 -s 403 -n 3

--- Danh sách request khớp bộ lọc ---
04/Nov/2026:14:06:46 | 192.168.1.23    | giangvien  | GET /api/students/export?format=xlsx&q=sv000012 | 403

=== Tổng quan ===
Nguồn: nginx/sample-logs/access.log
Bộ lọc: ngày=04/Nov/2026 status=403 user=giangvien
Định dạng: qlsv (user lấy từ trường X-User)
Số dòng đã đọc: 1017 | khớp bộ lọc: 1 | dòng sai định dạng: 0
Từ 04/Nov/2026:14:06:46 đến 04/Nov/2026:14:06:46
Số IP khác nhau: 1 | số user khác nhau: 1

=== Top 3 IP (kèm các user đã đăng nhập từ IP đó) ===
       1  100.0%  192.168.1.23     user: giangvien

=== Top 3 user ("-" = chưa đăng nhập / file tĩnh) ===
       1  100.0%  giangvien     IP: 192.168.1.23

=== Status code ===
  403       1  100.0%

=== Số request theo giờ (gộp các ngày) ===
  14h       1  ########################################

=== Top 3 đường dẫn (đã bỏ query string) ===
       1  100.0%  /api/students/export

=== Lỗi 4xx/5xx: 1 request (gộp theo status + method + đường dẫn) ===
       1  100.0%  403 GET /api/students/export
```

Ví dụ 4: đọc từ pipe (`-f -`), ví dụ chỉ các request từ điện thoại; và đọc file định dạng
`combined` (cột user lấy từ `$remote_user` nên toàn `-`):

```console
$ grep -E 'Android|iPhone' nginx/sample-logs/access.log | scripts/log-report.sh -f - -q -n 3 | sed -n '/Tổng quan/,/Status code/p'
=== Tổng quan ===
Nguồn: -
Bộ lọc: (không có)
Định dạng: qlsv (user lấy từ trường X-User)
Số dòng đã đọc: 98 | khớp bộ lọc: 98 | dòng sai định dạng: 0
Từ 02/Nov/2026:14:39:33 đến 06/Nov/2026:14:51:56
Số IP khác nhau: 3 | số user khác nhau: 2

=== Top 3 IP (kèm các user đã đăng nhập từ IP đó) ===
      45   45.9%  10.10.0.21       user: -,viewer
      43   43.9%  203.0.113.80     user: -,viewer
      10   10.2%  10.10.0.34       user: -

=== Top 3 user ("-" = chưa đăng nhập / file tĩnh) ===
      64   65.3%  -             IP: 10.10.0.34,203.0.113.80,10.10.0.21
      34   34.7%  viewer        IP: 203.0.113.80,10.10.0.21

=== Status code ===
$ scripts/log-report.sh -f nginx/sample-logs/access-combined.log -i 192.168.1. -q -n 3 | sed -n '/Tổng quan/,/Top 3 user/p'
=== Tổng quan ===
Nguồn: nginx/sample-logs/access-combined.log
Bộ lọc: ip=192.168.1.
Định dạng: combined (user lấy từ $remote_user)
Số dòng đã đọc: 1017 | khớp bộ lọc: 757 | dòng sai định dạng: 0
Từ 02/Nov/2026:08:04:51 đến 06/Nov/2026:17:02:33
Số IP khác nhau: 6 | số user khác nhau: 1

=== Top 3 IP (kèm các user đã đăng nhập từ IP đó) ===
     252   33.3%  192.168.1.15     user: -
     205   27.1%  192.168.1.23     user: -
     148   19.6%  192.168.1.10     user: -
  ... và 3 mục khác

=== Top 3 user ("-" = chưa đăng nhập / file tĩnh) ===
```

Các tùy chọn khác: `-a TEXT` (User-Agent chứa TEXT, ví dụ `-a sqlmap`), `-i IP` (một IP hoặc
tiền tố như `192.168.1.`), `-f` lặp lại nhiều lần và tự giải nén file `.gz` (mục 8).

## 8. Log đã xoay vòng (logrotate) và file .gz

Log ghi liên tục sẽ đầy ổ đĩa, nên trên Linux có **logrotate** chạy hằng ngày (bằng cron hoặc
systemd timer). Với cấu hình Debian ở mục 1.2:

- `daily` + `rotate 14`: mỗi ngày đổi tên `access.log` → `access.log.1`, giữ 14 bản cũ.
- `compress` + `delaycompress`: bản cũ được nén `.gz`, **trừ** bản mới nhất (`access.log.1`)
  vì Nginx có thể vẫn đang ghi nốt vào nó.
- `postrotate … invoke-rc.d nginx rotate`: báo Nginx mở lại file log (tương đương
  `nginx -s reopen` hoặc gửi tín hiệu `USR1` cho tiến trình master; Rocky dùng
  `kill -USR1 $(cat /run/nginx.pid)`). Thiếu bước này Nginx sẽ tiếp tục ghi vào file đã đổi tên.

Giả lập thư mục `/var/log/nginx` sau vài ngày (tách log mẫu theo ngày: 06/11 → `access.log`,
05/11 → `access.log.1`, các ngày cũ hơn nén thành `access.log.2.gz`…):

```console
$ ls -1
access.log
access.log.1
access.log.2.gz
access.log.3.gz
access.log.4.gz
access.log.5.gz
```

Đọc file `.gz` **không cần giải nén ra đĩa**. Đây là chỗ macOS khác Linux:

```console
$ zcat access.log.2.gz | head -n 1
zcat: can't stat: access.log.2.gz (access.log.2.gz.Z): No such file or directory
$ gzcat access.log.2.gz | wc -l
     207
$ gzip -dc access.log.2.gz | wc -l
     207
$ zcat < access.log.2.gz | wc -l
     207
```

Trên macOS, `zcat file.gz` báo lỗi vì `zcat` của macOS là bản cũ, tự thêm đuôi `.Z`. Dùng
`gzcat`, `gzip -dc` hoặc `zcat < file`. Trên Linux, `zcat` của GNU gzip đọc `.gz` bình thường,
và `zcat -f` đọc được cả file không nén:

```console
$ docker run --rm -v "$PWD:/logs:ro" -w /logs debian:stable-slim sh -c 'zcat access.log.*.gz | wc -l; zcat -f access.log* | wc -l'
592
1017
```

`zgrep` (grep trên file nén) có ở cả hai hệ:

```console
$ zgrep -c '" 401 ' access.log.*.gz
access.log.2.gz:4
access.log.3.gz:36
access.log.4.gz:1
access.log.5.gz:0
```

Gộp **tất cả** (file thường + file nén) để thống kê, cách viết chạy được trên cả hai hệ:

```console
$ { cat access.log access.log.1; gzip -dc access.log.*.gz; } | wc -l
    1017
$ gzip -dcf access.log* | awk '{ print $1 }' | sort | uniq -c | sort -rn | head -n 3
 252 192.168.1.15
 205 192.168.1.23
 148 192.168.1.10
```

(`gzip -dcf`: `-d` giải nén, `-c` in ra stdout, `-f` cho phép đọc cả file không nén.) Script
`log-report.sh` cũng nhận nhiều file, tự giải nén `.gz`:
`scripts/log-report.sh -f access.log -f access.log.1 -f access.log.2.gz`.

Lưu ý thêm:

- Với Docker Compose của dự án, log nằm ở `nginx/logs/` trên máy host. Muốn xoay vòng thì đặt
  logrotate trên máy host, và trong `postrotate` chạy `docker compose exec nginx nginx -s reopen`.
  Cách đơn giản hơn là tùy chọn `copytruncate` (sao chép rồi làm rỗng file, có thể mất vài dòng).
- **`journalctl` không chứa access log của Nginx.** Nginx ghi access log thẳng vào file;
  `journalctl -u nginx` chỉ có thông báo của systemd (start/stop/lỗi khởi động) và những gì
  Nginx in ra stderr trước khi mở được `error_log`. Chỉ khi cấu hình
  `access_log syslog:server=unix:/dev/log;` thì log mới đi vào syslog/journald.

## 9. GoAccess: thống kê trực quan

### 9.1 GoAccess là gì

[GoAccess](https://goaccess.io) là công cụ mã nguồn mở (viết bằng C) phân tích access log của
Nginx/Apache **ngay trên máy chủ**: không cần cơ sở dữ liệu, không cần cài agent. Có hai chế độ:
bảng điều khiển trong **terminal**, và **báo cáo HTML** (một file duy nhất, mở bằng trình duyệt;
có thể cập nhật theo thời gian thực qua WebSocket). Các bảng chính: khách truy cập theo ngày,
URL được gọi nhiều, file tĩnh, 404, IP/host, hệ điều hành, trình duyệt, phân bố theo giờ,
referrer, status code, và **Remote User** (với dự án này chính là cột X-User).

### 9.2 Cài đặt

| Hệ điều hành | Lệnh |
|---|---|
| Debian/Ubuntu | `sudo apt install goaccess` (bản trong kho có thể cũ; bản mới có ở kho `deb.goaccess.io`) |
| Fedora / RHEL (EPEL) | `sudo dnf install goaccess` |
| macOS | `brew install goaccess` |
| Docker (không cần cài) | `docker run --rm -i allinurl/goaccess …` |

```console
$ docker run --rm allinurl/goaccess --version | head -n 1
GoAccess - 1.12.
```

### 9.3 log-format cho định dạng qlsv và COMBINED

GoAccess cần biết cấu trúc dòng log. Với định dạng **combined** mặc định chỉ cần
`--log-format=COMBINED`. Với định dạng **qlsv** của dự án:

```bash
--log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
--date-format='%d/%b/%Y' --time-format='%H:%M:%S'
```

| Phần của dòng log | Đặc tả GoAccess | Ý nghĩa |
|---|---|---|
| `192.168.1.15` | `%h` | Host (IP client) |
| ` - - ` | `%^` | Bỏ qua (đến dấu `[`) |
| `[06/Nov/2026:14:02:05 +0700]` | `[%d:%t %^]` | Ngày theo `--date-format`, giờ theo `--time-format`, bỏ qua múi giờ |
| `"POST /api/students/bulk-copy HTTP/1.1"` | `"%r"` | Dòng request |
| `201` / `407` | `%s` / `%b` | Status / số byte |
| `"http://…"` / `"Mozilla/5.0 …"` | `"%R"` / `"%u"` | Referer / User-Agent |
| `"giaovu"` | `"%e"` | User ID (bảng *Remote User*) |
| `rt=0.004` | `rt=%T` | Thời gian phục vụ (giây, có phần mili giây) |
| `urt=0.004` | `urt=%^` | Bỏ qua |

Có thể ghi vào file cấu hình `~/.goaccessrc` (hoặc truyền bằng `-p file`) để khỏi gõ lại:

```text
log-format %h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^
date-format %d/%b/%Y
time-format %H:%M:%S
```

### 9.4 Báo cáo HTML tĩnh (kết quả thật trên log mẫu)

Chạy bằng Docker từ thư mục gốc dự án (thư mục `nginx/` được mount vào `/srv` trong container).
`-o json` in số liệu tổng quát ra stdout để kiểm tra GoAccess đã đọc đúng định dạng:

```console
$ docker run --rm -v "$PWD/nginx:/srv" allinurl/goaccess /srv/sample-logs/access.log \
  --log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
  --date-format='%d/%b/%Y' --time-format='%H:%M:%S' --no-progress \
  --html-report-title='QLSV - log mẫu 01-06/11/2026' -o /srv/reports/goaccess-report.html
$ ls -lh nginx/reports/goaccess-report.html | awk '{ print $5, $9 }'
1.9M nginx/reports/goaccess-report.html
$ docker run --rm -v "$PWD/nginx:/srv:ro" allinurl/goaccess /srv/sample-logs/access.log \
  --log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
  --date-format='%d/%b/%Y' --time-format='%H:%M:%S' --no-progress -o json | grep -oE '"(total|valid|failed)_requests": [0-9]+'
"total_requests": 1017
"valid_requests": 1017
"failed_requests": 0
```

`valid_requests` bằng `total_requests` và `failed_requests: 0` nghĩa là **mọi dòng đều được
phân tích đúng** (kể cả dòng "rác" TLS ở mục 6.1). Nếu `failed_requests` lớn thì `--log-format`
không khớp với log. Mở `nginx/reports/goaccess-report.html` bằng trình duyệt để xem các biểu đồ.

Cùng dữ liệu ở định dạng combined, chỉ cần `COMBINED`:

```console
$ docker run --rm -v "$PWD/nginx:/srv:ro" allinurl/goaccess /srv/sample-logs/access-combined.log \
  --log-format=COMBINED --no-progress -o json | grep -oE '"(total|valid|failed)_requests": [0-9]+'
"total_requests": 1017
"valid_requests": 1017
"failed_requests": 0
```

Cài sẵn GoAccess trên máy thì bỏ phần `docker run … allinurl/goaccess`:

```bash
goaccess nginx/sample-logs/access.log --log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
  --date-format='%d/%b/%Y' --time-format='%H:%M:%S' -o nginx/reports/goaccess-report.html
```

### 9.5 Chế độ terminal

```bash
goaccess /var/log/nginx/access.log --log-format=COMBINED          # log combined
goaccess nginx/sample-logs/access.log -p ~/.goaccessrc             # log qlsv, dùng file cấu hình
docker run --rm -it -v "$PWD/nginx:/srv:ro" -v "$HOME/.goaccessrc:/root/.goaccessrc:ro" \
  allinurl/goaccess /srv/sample-logs/access.log -p /root/.goaccessrc   # qua Docker: cần -it
```

Phím tắt: `Tab`/`Shift+Tab` chuyển bảng, `Enter` mở rộng bảng đang chọn, `s` đổi cách sắp xếp,
`/` tìm kiếm, `F1` hoặc `h` trợ giúp, `q` thoát.

### 9.6 HTML thời gian thực

```bash
goaccess /var/log/nginx/access.log --log-format=COMBINED \
  -o /var/www/html/goaccess.html --real-time-html --port=7890 --daemonize
```

GoAccess đọc tiếp các dòng mới của log và đẩy số liệu tới trang HTML qua WebSocket (mặc định
cổng 7890; dùng `--ws-url=wss://ten-mien:7890` khi trang được mở từ máy khác, kèm TLS).
`--daemonize` cho chạy nền. Với Docker: thêm `-p 7890:7890` cho container rồi mở file HTML vừa
tạo bằng trình duyệt.

Đã chạy thử đúng lệnh dưới đây trên log thật của dự án (`nginx/logs/access.log`):

```console
$ docker run -d --name goaccess-rt -p 7890:7890 -v "$PWD/nginx:/srv" allinurl/goaccess /srv/logs/access.log \
    --log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
    --date-format='%d/%b/%Y' --time-format='%H:%M:%S' --real-time-html -o /srv/reports/goaccess-live.html
$ docker logs goaccess-rt 2>&1 | tail -n 1
/srv/logs/access.log              0   0/s  -WebSocket server ready to accept new client connections
$ docker rm -f goaccess-rt
```

Mở `nginx/reports/goaccess-live.html` bằng trình duyệt: trang kết nối `ws://localhost:7890` và
tự cập nhật khi có request mới vào Nginx. Dừng bằng `docker rm -f goaccess-rt`.

### 9.7 Lọc trước khi đưa vào GoAccess

GoAccess đọc được từ stdin (tên file là `-`), nên mọi lệnh lọc ở mục 4–7 đều ghép được:

```console
$ grep '\[06/Nov/2026' nginx/sample-logs/access.log | docker run --rm -i allinurl/goaccess - \
  --log-format='%h %^[%d:%t %^] "%r" %s %b "%R" "%u" "%e" rt=%T urt=%^' \
  --date-format='%d/%b/%Y' --time-format='%H:%M:%S' --no-progress -o json | grep -oE '"(total|valid|failed)_requests": [0-9]+'
"total_requests": 220
"valid_requests": 220
"failed_requests": 0
```

Một số cách dùng hay gặp:

```bash
zcat /var/log/nginx/access.log.*.gz | goaccess - --log-format=COMBINED -o tuan-truoc.html   # Linux; macOS dùng gzcat
goaccess access.log --log-format=COMBINED --ignore-crawlers -o report.html     # bỏ bot
goaccess access.log --log-format=COMBINED -e 192.168.1.10 -o report.html       # loại một IP (máy admin)
goaccess access.log --log-format=COMBINED --ignore-status=304 -o report.html   # bỏ các response 304
goaccess access.log --log-format=COMBINED --anonymize-ip -o report.html        # ẩn octet cuối của IP
goaccess access.log --log-format=COMBINED --persist --restore --db-path=/var/lib/goaccess -o report.html  # cộng dồn nhiều lần chạy
```

### 9.8 Các công cụ khác

| Công cụ | Khi nào nên chọn |
|---|---|
| **lnav** | Xem/tìm log ngay trong terminal trên một máy, tự nhận dạng định dạng combined, truy vấn bằng SQL; hợp để điều tra nhanh |
| **AWStats** | Báo cáo thống kê truyền thống theo tháng/năm (Perl, chạy theo lô); hợp khi chỉ cần số liệu lịch sử, không cần thời gian thực |
| **ELK / OpenSearch** (Elasticsearch/OpenSearch + Logstash/Beats + Kibana/Dashboards) | Gom log của **nhiều máy chủ**, tìm kiếm toàn văn, dashboard, cảnh báo; mạnh nhưng nặng (cần nhiều RAM) |
| **Grafana Loki + Promtail** | Gom log nhẹ, đánh chỉ mục theo nhãn, xem trên Grafana cạnh số liệu Prometheus. Lưu ý: Grafana đã ngừng phát triển Promtail và khuyến nghị dùng **Grafana Alloy** để đẩy log vào Loki |
| **Graylog** | Quản lý log tập trung có phân quyền người dùng, luồng (stream), cảnh báo; hợp cho đội vận hành cần một sản phẩm "trọn gói" |

Với mini project một máy chủ: dùng lệnh `awk`/`grep` và `scripts/log-report.sh` khi cần trả lời
một câu hỏi cụ thể, GoAccess khi cần cái nhìn tổng quan trực quan.

## 10. Quyền riêng tư và bảo mật

**Log chứa dữ liệu cá nhân.** Địa chỉ IP kết hợp với thời gian và tài khoản cho phép xác định
một người cụ thể, và đường dẫn còn tiết lộ người đó tìm gì. Ví dụ, ô tìm kiếm sinh viên nằm
trong query string nên **tên người được tìm** cũng vào log:

```console
$ grep -oE 'q=[^ &"]+' access.log | sort | uniq -c | sort -rn | head -n 6
  10 q=SV0000
   8 q=le
   8 q=CNTT-K18A
   7 q=nguyen
   6 q=sv000012
   5 q=qtkd
$ grep -c 'q=Tr%E1%BA%A7n' access.log
1
$ printf '%b\n' "$(echo 'Tr%E1%BA%A7n' | sed 's/%/\\x/g')"
Trần
```

(Chữ tiếng Việt được mã hóa phần trăm theo UTF-8; lệnh cuối giải mã `Tr%E1%BA%A7n` thành `Trần`.) Ở Việt Nam, Nghị định 13/2023/NĐ-CP coi dữ
liệu phản ánh hoạt động, lịch sử hoạt động trên không gian mạng là dữ liệu cá nhân, và Luật Bảo
vệ dữ liệu cá nhân (số 91/2025/QH15, hiệu lực từ 01/01/2026) đặt ra nghĩa vụ bảo vệ dữ liệu
cá nhân. Ở châu Âu, GDPR cũng coi địa chỉ IP là dữ liệu cá nhân. Trong thực tế:

- **Chỉ giữ log trong thời gian cần thiết**, và ghi rõ trong chính sách: logrotate `rotate 14`
  nghĩa là giữ 14 ngày; có thể thêm `maxage 30`. Đừng quên xóa cả báo cáo GoAccess cũ.
- **Giới hạn người đọc log:** Debian để file log `0640 www-data:adm`, Rocky khóa cả thư mục
  `drwx--x--x root`. Không cấp quyền đọc cho mọi người, không đặt file log trong thư mục web.
- **Báo cáo GoAccess cũng chứa IP:** không công khai trên Internet (đặt sau đăng nhập hoặc chỉ
  mở trong mạng nội bộ); dùng `--anonymize-ip` khi chia sẻ.
- **Ẩn bớt IP ngay khi ghi** nếu không cần IP đầy đủ, ví dụ thay octet cuối bằng 0 (đã kiểm tra
  bằng `nginx -t` và chạy thử):

```nginx
# Trong context http (ví dụ đầu file nginx/qlsv.conf)
map $remote_addr $remote_addr_anon {
    ~(?P<ip>\d+\.\d+\.\d+)\.\d+    $ip.0;      # IPv4: 192.168.1.15 -> 192.168.1.0
    ~(?P<ip>[^:]+:[^:]+):          $ip::;      # IPv6: chỉ giữ 2 nhóm đầu
    default                        0.0.0.0;
}
log_format qlsv_anon '$remote_addr_anon - $remote_user [$time_local] "$request" '
                     '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                     '"$upstream_http_x_user" rt=$request_time urt=$upstream_response_time';
```

  Chạy thử trong container `nginx:1.30-alpine`, request từ `127.0.0.1` được ghi thành:

  ```text
  127.0.0.0 - - [06/Nov/2026:07:11:05 +0000] "GET / HTTP/1.1" 200 3 "-" "Wget" "-" rt=0.000 urt=-
  ```

**Không bao giờ ghi token, mật khẩu, cookie vào log.** Không thêm `$http_authorization`,
`$http_cookie`, `$request_body` vào `log_format`. App này đúng cách:

- Mật khẩu nằm trong **body** JSON của `POST /api/auth/login`, mà access log không ghi body.
- Token JWT được gửi trong **header** `Authorization: Bearer …`, không nằm trên URL, nên không
  xuất hiện trong `$request` hay Referer. Kiểm tra trên log mẫu và trên log thật của lần chạy
  thử (đã có nhiều lần đăng nhập và gọi API có token; mọi JWT đều bắt đầu bằng `eyJ`):

```console
$ grep -c 'eyJ' access.log
0
$ grep -c 'eyJ' ../logs/access.log
0
```

  Nếu token được truyền kiểu `GET /api/students?token=eyJ…` thì nó sẽ nằm trong access log,
  lịch sử trình duyệt và header Referer gửi sang trang khác: ai đọc được log là đăng nhập được.

Một số lưu ý an ninh khác:

- Header do client gửi (`X-Forwarded-For`, `User-Agent`, `Referer`) **giả được**. Chỉ tin
  `X-Forwarded-For` khi nó đến từ proxy của mình (`set_real_ip_from`). Trường user của dự án
  lấy từ response của app nên client không giả được.
- Log có thể chứa nội dung độc hại do kẻ tấn công cố ý gửi (đường dẫn, User-Agent chứa mã
  HTML/JS). Nginx đã thoát ký tự đặc biệt, GoAccess thoát HTML khi tạo báo cáo; khi tự viết
  script xử lý log, không bao giờ `eval` nội dung log hay chèn thẳng vào trang web.
- `server_tokens off;` (có trong `nginx/qlsv.conf`) giấu số phiên bản Nginx khỏi header và
  trang lỗi, bớt thông tin cho máy quét.

## 11. Bài tập tự luyện

Chạy trong `nginx/sample-logs`, tự làm trước rồi mới mở đáp án.

1. Có bao nhiêu lần đăng nhập thất bại (401) trong ngày 03/11?
2. Tài khoản `viewer` đã truy cập từ những IP nào, mỗi IP bao nhiêu request?
3. Trong khoảng 10:00–10:10 ngày 04/11 có bao nhiêu request nhận 502?
4. Máy quét Nikto đã thử những file nào bắt đầu bằng dấu chấm (`/.env`, `/.git/…`)?
5. Request `POST /api/students/import` nào tốn thời gian nhất và của ai?

<details>
<summary>Đáp án (lệnh và kết quả thật)</summary>

```console
$ grep '\[03/Nov/2026' access.log | awk '$6 == "\"POST" && $7 == "/api/auth/login" && $9 == 401' | wc -l
      19
$ awk -F'"' '$8 == "viewer" { split($1, a, " "); print a[1] }' access.log | sort | uniq -c
  18 10.10.0.21
  43 192.168.1.37
  16 203.0.113.80
$ grep -E '\[04/Nov/2026:10:0' access.log | awk -F'"' '{ split($3, s, " ") } s[1] == 502' | wc -l
       7
$ grep -i 'nikto' access.log | awk '$7 ~ /^\/\./ { print $7 }' | sort -u
/.DS_Store
/.aws/credentials
/.env
/.env.bak
/.git/config
/.htaccess
$ grep '"POST /api/students/import' access.log | awk -F'"' '{ split($1, a, " "); print $9, substr(a[4], 2), $8 }' | sort -t= -k2 -rn | head -n 1
 rt=0.874 urt=0.874 02/Nov/2026:09:35:06 giaovu
```

</details>

## Phụ lục A: Khác biệt GNU (Linux) và BSD (macOS)

| Việc cần làm | Linux (GNU) | macOS (BSD) | Cách viết chạy được cả hai |
|---|---|---|---|
| Đọc file `.gz` | `zcat file.gz` | `zcat file.gz` **lỗi** (tìm file `.Z`) | `gzip -dc file.gz` hoặc `gzcat`; `zcat < file.gz` |
| Đọc cả file thường lẫn `.gz` | `zcat -f access.log*` | `gzip -dcf access.log*` | `gzip -dcf access.log*` |
| Thời điểm "15 phút trước" | `date -d '15 minutes ago'` | `date -v-15M` | Không có; tách hai trường hợp |
| Tên tháng tiếng Anh cho `%b` | phụ thuộc locale | phụ thuộc locale | luôn đặt `LC_ALL=C date …` |
| Sửa file tại chỗ | `sed -i 's/a/b/' f` | `sed -i '' 's/a/b/' f` | Ghi ra file mới rồi đổi tên |
| Regex kiểu Perl | `grep -P` | Không có | `grep -E` |
| Hàm thời gian trong awk | `strftime`, `mktime` (chỉ gawk) | Không có | Tự đổi tháng thành số như mục 4.2 |
| So khớp không phân biệt hoa thường trong awk | `IGNORECASE=1` (chỉ gawk) | Không có | `tolower($6) ~ /bot/` |
| Định dạng của `uniq -c` | số đếm canh lề rộng 7 ký tự | rộng 4 ký tự | (chỉ khác cách trình bày) |
| `wc -l file` | `1017 file` | `    1017 file` | (chỉ khác cách trình bày) |

Ví dụ khác biệt trình bày của `uniq -c` (cùng dữ liệu, macOS rồi Debian):

```console
$ awk '{ print $1 }' access.log | sort | uniq -c | sort -rn | head -n 2
 252 192.168.1.15
 205 192.168.1.23
$ docker run --rm -v "$PWD:/logs:ro" -w /logs debian:stable-slim sh -c "awk '{ print \$1 }' access.log | sort | uniq -c | sort -rn | head -n 2"
    252 192.168.1.15
    205 192.168.1.23
```

Lưu ý: thứ tự của các dòng có **cùng số đếm** sau `sort -rn` có thể khác nhau giữa các máy (do
locale). Tài liệu này chạy với `LC_ALL=C`; muốn kết quả giống hệt, đặt `LC_ALL=C` trước lệnh.

## Phụ lục B: Bảng tra nhanh

| Câu hỏi | Lệnh (định dạng qlsv) |
|---|---|
| 20 dòng mới nhất / theo dõi trực tiếp | `tail -n 20 access.log` / `tail -f access.log` |
| Top IP | `awk '{print $1}' access.log \| sort \| uniq -c \| sort -rn \| head` |
| Top user | `awk -F'"' '{print $8}' access.log \| sort \| uniq -c \| sort -rn` |
| User ↔ IP | `awk -F'"' '$8!="-" {split($1,a," "); print $8, a[1]}' access.log \| sort \| uniq -c` |
| Một ngày / một giờ | `grep '\[06/Nov/2026' access.log` / `grep '\[06/Nov/2026:14' access.log` |
| Khoảng thời gian | `awk '$4 >= "[06/Nov/2026:14:00:00" && $4 < "[06/Nov/2026:15:00:00"' access.log` |
| Theo User-Agent | `awk -F'"' 'tolower($6) ~ /bot/' access.log` |
| Đếm theo status | `awk -F'"' '{split($3,s," "); print s[1]}' access.log \| sort \| uniq -c \| sort -rn` |
| Lỗi 5xx | `awk -F'"' '{split($3,s," ")} s[1] >= 500' access.log` |
| Đăng nhập thất bại theo IP | `awk '$7=="/api/auth/login" && $9==401 {print $1}' access.log \| sort \| uniq -c \| sort -rn` |
| Request chậm nhất | `awk '{for(i=NF;i>0;i--) if($i~/^rt=/){print substr($i,4), $7; break}}' access.log \| sort -rn \| head` |
| Log nén | `gzip -dc access.log.*.gz \| …` hoặc `zgrep '…' access.log.*.gz` |
| Báo cáo tổng hợp | `scripts/log-report.sh -f access.log -d 06/Nov/2026 -s 4xx,5xx` |
| Báo cáo trực quan | `goaccess access.log -p ~/.goaccessrc -o report.html` |
