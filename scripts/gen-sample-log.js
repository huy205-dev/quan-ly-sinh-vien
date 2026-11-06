#!/usr/bin/env node
'use strict';
/**
 * scripts/gen-sample-log.js
 * -----------------------------------------------------------------------------
 * Sinh nhật ký truy cập (access log) Nginx MẪU cho dự án "Quản lý sinh viên",
 * dùng để luyện các lệnh phân tích log trong docs/NGINX-LOG.md.
 *
 * Cách chạy (từ thư mục gốc dự án):
 *   node scripts/gen-sample-log.js                 # seed mặc định 20261106
 *   node scripts/gen-sample-log.js --seed 42       # bộ dữ liệu khác
 *   node scripts/gen-sample-log.js --out /tmp/logs # ghi vào thư mục khác
 *
 * Kết quả: CÙNG một bộ dữ liệu được ghi ra HAI định dạng:
 *   nginx/sample-logs/access.log           định dạng "qlsv" (xem nginx/qlsv.conf):
 *       combined + "$upstream_http_x_user" rt=$request_time urt=$upstream_response_time
 *   nginx/sample-logs/access-combined.log  định dạng "combined" mặc định của Nginx
 *
 * Tính tất định (deterministic): mọi giá trị "ngẫu nhiên" đều lấy từ bộ sinh số
 * giả ngẫu nhiên mulberry32 với seed cố định, không dùng Math.random() hay giờ
 * hệ thống. Chạy lại bao nhiêu lần cũng ra đúng hai file như cũ.
 * Không dùng thư viện ngoài (chỉ node:fs, node:path).
 *
 * Dữ liệu mô phỏng: 01/11/2026 (Chủ nhật) đến 06/11/2026 (Thứ sáu), múi giờ +0700.
 *   - Tài khoản: admin, giaovu, giangvien, viewer. "-" = chưa đăng nhập, file
 *     tĩnh, hoặc response do chính Nginx tạo ra.
 *   - 15 địa chỉ IP: mạng LAN của trường và vài IP công cộng. IP công cộng dùng
 *     các dải dành riêng cho tài liệu (RFC 5737: 192.0.2.0/24, 198.51.100.0/24,
 *     203.0.113.0/24). Riêng Googlebot dùng dải IP thật của Google (66.249.x.x).
 *   - Các tình huống có chủ đích để luyện lọc log:
 *       02/11 09:2x  giáo vụ nhập file lỗi (400) rồi nhập lại thành công (201)
 *       03/11 02:1x  máy quét sqlmap (401) + gói TLS gửi nhầm vào cổng HTTP (400)
 *       03/11 10:1x  dò mật khẩu từ phòng lab: nhiều lần 401 liên tiếp
 *       03/11 14:4x  giáo vụ gõ tay #/roles: 403 (không có quyền role.read)
 *       04/11 10:02  app khởi động lại: mọi request nhận 502 trong khoảng 3 phút
 *       04/11 13:5x  admin bỏ quyền student.export của vai trò giangvien, giảng
 *                    viên bấm "Xuất file" bị 403; 15:1x admin trả lại quyền
 *       05/11 03:0x  máy quét Nikto: /.env, /wp-login.php, /.git/config... (404)
 *       05/11 08:3x  tài khoản bị khóa đăng nhập: 403 (ACCOUNT_LOCKED)
 *       05/11 11:1x  lỗi xuất file Excel (500) rồi thử lại thành công
 *       05/11 16:2x  file import 14 MB bị Nginx chặn (413, urt=-), ảnh 7 MB bị
 *                    app chặn (413, có tên user)
 *       hằng đêm 23:30  script python-requests sao lưu dữ liệu (export JSON)
 */

const fs = require('node:fs');
const path = require('node:path');

const USAGE = `Cách dùng: node scripts/gen-sample-log.js [--seed <số nguyên>] [--out <thư mục>]
  --seed  seed của bộ sinh số giả ngẫu nhiên (mặc định 20261106)
  --out   thư mục ghi kết quả (mặc định nginx/sample-logs)`;

// =============================================================================
// 1. Bộ sinh số giả ngẫu nhiên có seed (mulberry32) và các hàm tiện ích
// =============================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // số thực trong [0, 1)
  };
}

let rand = mulberry32(20261106); // được khởi tạo lại trong main() theo --seed

const int = (min, max) => min + Math.floor(rand() * (max - min + 1)); // số nguyên trong [min, max]
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const round3 = (x) => Math.round(x * 1000) / 1000;
const secs = (min, max) => round3(min + rand() * (max - min)); // thời gian (giây, 3 chữ số thập phân)

/** Chọn theo trọng số: weighted([['a', 3], ['b', 1]]) trả 'a' với xác suất 75%. */
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r < 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

// =============================================================================
// 2. Thời gian: t = số giây tính từ 01/11/2026 00:00:00 (+0700)
// =============================================================================
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const at = (day, hh, mm, ss = 0) => (day - 1) * DAY + hh * HOUR + mm * MIN + ss;
const dayOf = (t) => 1 + Math.floor(t / DAY);
const pad2 = (n) => String(n).padStart(2, '0');

/** 1 giờ 2 phút 3 giây ngày 6 -> "06/Nov/2026:01:02:03 +0700" (giống $time_local). */
function fmtTime(t) {
  const s = t - (dayOf(t) - 1) * DAY;
  const hh = Math.floor(s / HOUR);
  const mm = Math.floor((s % HOUR) / MIN);
  return `${pad2(dayOf(t))}/Nov/2026:${pad2(hh)}:${pad2(mm)}:${pad2(s % MIN)} +0700`;
}

const END = at(6, 17, 45); // dữ liệu dừng ở cuối giờ làm việc thứ Sáu 06/11

// App bị khởi động lại (cập nhật phiên bản) -> Nginx không kết nối được -> 502.
const APP_DOWN_FROM = at(4, 10, 2, 7);
const APP_DOWN_TO = at(4, 10, 5, 41);
const isAppDown = (t) => t >= APP_DOWN_FROM && t <= APP_DOWN_TO;
// Sau khi cập nhật, file tĩnh đổi nội dung (ETag mới) -> trình duyệt tải lại (200).
const assetVersion = (t) => (t > APP_DOWN_TO ? 2 : 1);
// Khoảng thời gian vai trò giangvien bị thu hồi quyền student.export (xem phần 7).
const EXPORT_REVOKED = [at(4, 13, 50), at(4, 15, 15)];

// =============================================================================
// 3. Dữ liệu cố định: website, User-Agent, thiết bị (IP), file tĩnh
// =============================================================================
const SITE = 'http://qlsv.example.com:8080';
const REF_APP = `${SITE}/`;
const REF_LOGIN = `${SITE}/login.html`;

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  curl: 'curl/8.7.1',
  postman: 'PostmanRuntime/7.49.1',
  python: 'python-requests/2.32.5',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  sqlmap: 'sqlmap/1.9.11#stable (https://sqlmap.org)',
  nikto: (n) => `Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:${String(n).padStart(6, '0')})`,
};

// Thời gian truyền 1 byte về client theo loại mạng ($request_time tính cả thời
// gian gửi response; $upstream_response_time thì không).
const NET = { lan: 0.00000002, wifi: 0.0000003, home: 0.0000008, mobile: 0.000003, dc: 0.0000002 };

function device(ip, ua, net) {
  return { ip, ua, net, cache: new Map(), token: new Map(), faviconDay: 0 };
}

const D = {
  adminPc: device('192.168.1.10', UA.chromeWin, 'lan'), //       phòng đào tạo: admin
  giaovuPc: device('192.168.1.15', UA.edgeWin, 'lan'), //        phòng giáo vụ
  giangvienMac: device('192.168.1.23', UA.safariMac, 'lan'), //  giảng viên ở trường
  viewerLab: device('192.168.1.37', UA.firefoxMac, 'lan'), //    phòng lab (iMac)
  lab42: device('192.168.1.42', UA.chromeWin, 'lan'), //         phòng lab, chưa đăng nhập
  lab58: device('192.168.1.58', UA.firefoxWin, 'lan'), //        phòng lab, chưa đăng nhập
  viewerAndroid: device('10.10.0.21', UA.chromeAndroid, 'wifi'), // Wi-Fi trường
  guestIphone: device('10.10.0.34', UA.safariIphone, 'wifi'), //   Wi-Fi trường, khách
  devCurl: device('172.16.0.5', UA.curl, 'lan'), //              máy dev / máy chủ nội bộ
  devPostman: device('172.16.0.5', UA.postman, 'lan'),
  devPython: device('172.16.0.5', UA.python, 'lan'),
  giangvienHome: device('203.0.113.25', UA.chromeMac, 'home'), // giảng viên ở nhà
  viewer4g: device('203.0.113.80', UA.safariIphone, 'mobile'), //  điện thoại 4G
  giaovuHome: device('198.51.100.14', UA.firefoxWin, 'home'), //   giáo vụ ở nhà
  sqlmap: device('198.51.100.77', UA.sqlmap, 'home'), //           máy quét SQL injection
  nikto: device('192.0.2.150', UA.nikto(0), 'home'), //            máy quét lỗ hổng
  googlebot: device('66.249.66.1', UA.googlebot, 'dc'),
};

// File tĩnh của giao diện (public/) và kích thước (byte) khi trả 200, lấy theo
// file thật trong public/. Giao diện thật nạp khoảng 20 module ES; để log mẫu gọn,
// mỗi lần mở trang ở đây chỉ mô phỏng vài file tiêu biểu.
const ASSETS = {
  '/': 1845, // index.html
  '/login.html': 6383,
  '/css/style.css': 41769,
  '/favicon.svg': 551, // <link rel="icon" href="/favicon.svg">
  '/js/login.js': 3914,
  '/js/main.js': 7006,
  '/js/api.js': 7533,
  '/js/views/students/index.js': 23004,
};
const LOGIN_ASSETS = ['/css/style.css', '/js/login.js'];
const APP_ASSETS = ['/css/style.css', '/js/main.js', '/js/api.js', '/js/views/students/index.js'];

// Kích thước body (byte) của các response lỗi, tính từ đúng thông báo tiếng Việt
// của backend (UTF-8) và của Nginx (đo trực tiếp trên container nginx:1.30-alpine).
const BYTES = {
  loginFail: 99, //        401 "Tên đăng nhập hoặc mật khẩu không đúng."
  badJson: 102, //         400 "Dữ liệu JSON gửi lên không đúng cú pháp."
  locked: 118, //          403 ACCOUNT_LOCKED
  expired: 115, //         401 token hết hạn
  noToken: 118, //         401 thiếu token
  forbiddenExport: 121, // 403 FORBIDDEN, permission student.export
  forbiddenRole: 122, //   403 FORBIDDEN, permission role.read
  forbiddenUser: 112, //   403 FORBIDDEN, permission user.read
  forbiddenOptions: 203, // 403 FORBIDDEN, cần một trong 4 quyền (GET /api/roles/options)
  notFound: 73, //         404 "Không tìm thấy sinh viên."
  conflictRole: 129, //    409 xóa vai trò đang được gán cho người dùng
  conflictSelf: 98, //     409 tự xóa tài khoản của mình
  conflictDup: 90, //      409 trùng tên đăng nhập
  internal: 108, //        500 INTERNAL_ERROR
  app413: 205, //          413 FILE_ERROR do app trả (ảnh > 5 MB, kèm details)
  uploadMissing: 75, //    404 file không có trong /uploads
  nginx502api: 124, //     502 JSON do Nginx trả (location @api_unavailable)
  nginx502html: 150, //    502 trang HTML mặc định của Nginx (server_tokens off)
  nginxPadding: 402, //    Nginx chèn thêm chú thích vào trang lỗi mặc định khi User-Agent chứa "MSIE " hoặc
  //                       "Chrome/" (msie_padding) để trình duyệt không thay bằng trang lỗi "thân thiện" của nó
  nginx413api: 78, //      413 JSON do Nginx trả (location @api_too_large)
  nginx400: 150, //        400 Bad Request do Nginx trả
};
// Trang lỗi mặc định của Nginx (502, 400, 413 ở ngoài /api/) dài hơn với Chrome/Edge/MSIE.
const nginxErrorPage = (size, ua) => (/MSIE |Chrome\//.test(ua) ? size + BYTES.nginxPadding : size);
// Đo trên app thật (npm start, CSDL mẫu): body của POST /api/auth/login và GET /api/auth/me.
const LOGIN_BYTES = { admin: 678, giaovu: 579, giangvien: 521, viewer: 480 };
const ME_BYTES = { admin: 528, giaovu: 429, giangvien: 371, viewer: 330 };
const loginBytes = (u) => LOGIN_BYTES[u];
const meBytes = (u) => ME_BYTES[u];
// Express trả trang lỗi HTML "Cannot GET /path" (127 byte + độ dài dòng đó) cho đường dẫn không tồn tại.
const html404 = (method, url) => 127 + `Cannot ${method} ${url}`.length;

const SEARCH_TERMS = [
  'nguyen', 'nguyen van', 'tran thi', 'Trần', 'le', 'pham', 'cntt', 'CNTT-K18A', 'ktpm',
  'httt', 'qtkd', 'sv000012', 'SV0000', 'Hà Nội', 'hoang', 'vo thi', 'dang',
];
function searchCount(q) {
  let h = 0;
  for (const ch of q) h = (h * 31 + ch.codePointAt(0)) % 9973;
  return 1 + (h % 13);
}

// =============================================================================
// 4. Trạng thái "cơ sở dữ liệu" (để ID sinh viên, số người dùng... hợp lý)
// =============================================================================
const db = {
  ids: Array.from({ length: 36 }, (_, i) => i + 1), // 36 sinh viên mẫu (seed)
  nextId: 37,
  images: [], // ảnh đã upload: { url, size }
  users: 4,
};

function uuid() {
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 15)]).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[int(0, 3)]}${hex(3)}-${hex(12)}`;
}

// =============================================================================
// 5. Ghi nhận các dòng log
// =============================================================================
const entries = [];

function record(e) {
  entries.push({ seq: entries.length, ...e });
}

/** Một lượt truy cập của một thiết bị (trình duyệt, curl, bot...). */
class Visit {
  constructor(dev, t, { ref = REF_APP } = {}) {
    this.dev = dev;
    this.t = t;
    this.user = null; // tên đăng nhập khi đã có token hợp lệ
    this.ref = ref; //   Referer của các request fetch() từ giao diện
    this.page = 1;
    this.pageSize = 10;
    this.q = '';
  }

  wait(min, max) {
    this.t += int(min, max);
    return this;
  }

  /**
   * Request được Nginx chuyển (proxy) vào app Node.js.
   * proc = thời gian app xử lý (giây) -> urt; rt = proc + chút overhead + thời gian truyền.
   * Trả về false nếu đúng lúc app đang tắt (Nginx trả 502).
   */
  send({ method = 'GET', url, status, bytes, referer = this.ref, user = this.user || '-', proc }) {
    const request = `${method} ${url} HTTP/1.1`;
    if (isAppDown(this.t)) {
      const api = url.startsWith('/api/');
      record({
        t: this.t, ip: this.dev.ip, ua: this.dev.ua, request, status: 502,
        bytes: api ? BYTES.nginx502api : nginxErrorPage(BYTES.nginx502html, this.dev.ua), referer, user: '-',
        rt: 0.001, urt: chance(0.5) ? 0 : 0.001,
      });
      return false;
    }
    const urt = round3(proc);
    const rt = round3(proc + secs(0, 0.001) + bytes * NET[this.dev.net]);
    record({ t: this.t, ip: this.dev.ip, ua: this.dev.ua, request, status, bytes, referer, user, rt, urt });
    return true;
  }

  /** Response do CHÍNH Nginx tạo ra, không vào app: urt = "-", user = "-". */
  nginx({ request, status, bytes, referer = '-', ua = this.dev.ua, rt = secs(0, 0.002) }) {
    record({ t: this.t, ip: this.dev.ip, ua, request, status, bytes, referer, user: '-', rt, urt: null });
  }

  api(method, url, status, bytes, procMin, procMax, user) {
    return this.send({ method, url, status, bytes, user: user ?? (this.user || '-'), proc: secs(procMin, procMax) });
  }

  // ---- File tĩnh (public/): 200 lần đầu, 304 khi trình duyệt đã có trong cache
  asset(url, referer) {
    const ver = assetVersion(this.t);
    const cached = this.dev.cache.get(url) === ver && !chance(0.04); // 4%: Ctrl+F5
    const ok = this.send({
      url, status: cached ? 304 : 200, bytes: cached ? 0 : ASSETS[url], referer, user: '-',
      proc: cached ? secs(0.001, 0.003) : secs(0.002, 0.007),
    });
    if (ok) this.dev.cache.set(url, ver);
    if (chance(0.3)) this.t += 1; // trình duyệt tải song song nên phần lớn cùng một giây
    return ok;
  }

  // /uploads được phục vụ với Cache-Control max-age=7 ngày: đã có trong cache thì
  // trình duyệt dùng luôn, không gửi request (nên không có dòng log nào).
  image(img) {
    if (this.dev.cache.get(img.url) === 1) return;
    if (this.send({ url: img.url, status: 200, bytes: img.size, user: '-', proc: secs(0.001, 0.006) })) {
      this.dev.cache.set(img.url, 1);
    }
  }

  // Trình duyệt tải icon khai báo trong <link rel="icon" href="/favicon.svg"> (mô phỏng 1 lần/ngày).
  // Còn /favicon.ico thì chỉ bot và máy quét hỏi; app không có file này nên Nginx
  // trả 204 (xem location = /favicon.ico trong nginx/qlsv.conf).
  favicon(referer) {
    if (this.dev.faviconDay === dayOf(this.t)) return;
    this.dev.faviconDay = dayOf(this.t);
    this.asset('/favicon.svg', referer);
  }

  // Nếu chính trang HTML lỗi (502) thì trình duyệt chỉ nhận trang lỗi của Nginx,
  // không tải tiếp CSS/JS.
  loginPage(referer = '-') {
    if (!this.asset('/login.html', referer)) return false;
    for (const f of LOGIN_ASSETS) this.asset(f, REF_LOGIN);
    this.favicon(REF_LOGIN);
    return true;
  }

  appPage(referer = '-') {
    this.freshPage = true;
    if (!this.asset('/', referer)) return false;
    for (const f of APP_ASSETS) this.asset(f, REF_APP);
    this.favicon(REF_APP);
    return true;
  }

  // ---- Xác thực
  login(username, { fails = 0 } = {}) {
    for (let i = 0; i < fails; i++) {
      this.api('POST', '/api/auth/login', 401, BYTES.loginFail, 0.021, 0.036, '-');
      this.wait(5, 20);
    }
    // scrypt cố ý chậm (~20-35 ms trên máy thử) để chống dò mật khẩu
    const ok = this.api('POST', '/api/auth/login', 200, loginBytes(username), 0.021, 0.038, username);
    if (ok) {
      this.user = username;
      this.dev.token.set(username, this.t);
    }
    return ok;
  }

  /** Mở ứng dụng trên trình duyệt; đăng nhập lại nếu chưa có token hoặc token đã hết hạn (8 giờ). */
  open(username, { fails = 0 } = {}) {
    const issued = this.dev.token.get(username);
    if (issued !== undefined && this.t - issued < 8 * HOUR) {
      if (!this.appPage('-')) return false;
      this.user = username;
      this.api('GET', '/api/auth/me', 200, meBytes(username), 0.002, 0.008);
    } else {
      if (issued !== undefined) {
        // Trình duyệt còn token cũ nhưng đã hết hạn -> 401 -> chuyển về trang đăng nhập
        if (!this.appPage('-')) return false;
        this.api('GET', '/api/auth/me', 401, BYTES.expired, 0.001, 0.003, '-');
        if (!this.loginPage(REF_APP)) return false;
      } else if (!this.loginPage('-')) {
        return false;
      }
      this.wait(6, 25);
      if (!this.login(username, { fails })) return false;
      if (!this.appPage(REF_LOGIN)) return false;
      this.api('GET', '/api/auth/me', 200, meBytes(username), 0.002, 0.008);
    }
    this.wait(0, 1);
    this.list(1, 10, '');
    return true;
  }

  // ---- Sinh viên
  list(page = this.page, pageSize = this.pageSize, q = this.q) {
    const total = q ? searchCount(q) : db.ids.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(page, totalPages);
    const n = Math.max(0, Math.min(pageSize, total - (p - 1) * pageSize));
    const url = `/api/students?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`;
    const ok = this.api('GET', url, 200, 60 + n * int(380, 405), 0.001, 0.006 + n * 0.0004);
    Object.assign(this, { page: p, pageSize, q });
    // Ảnh thumbnail: trình duyệt chỉ tải (hoặc hỏi lại 304) ở lần hiển thị đầu tiên sau khi mở trang;
    // sinh viên mới nhất nằm ở trang 1 (sắp xếp StudentID DESC) nên đó là các ảnh mới upload.
    if (ok && this.freshPage && page === 1 && !q) {
      for (const img of db.images.slice(-3)) this.image(img);
    }
    this.freshPage = false;
    return ok;
  }

  browse() {
    const totalPages = Math.max(1, Math.ceil((this.q ? searchCount(this.q) : db.ids.length) / this.pageSize));
    const next = weighted([[this.page + 1, 5], [this.page - 1, 2], [totalPages, 1], [1, 1], [int(1, totalPages), 2]]);
    this.list(Math.min(Math.max(1, next), totalPages));
  }

  changePageSize() {
    this.list(1, this.pageSize === 10 ? 15 : 10);
  }

  search() {
    const term = pick(SEARCH_TERMS);
    // Ô tìm kiếm có debounce 300 ms: gõ chậm thì có thêm 1 request trung gian
    if (term.length > 5 && chance(0.4)) {
      this.list(1, this.pageSize, term.slice(0, Math.ceil(term.length / 2)));
      this.wait(1, 2);
    }
    this.list(1, this.pageSize, term);
    if (chance(0.5)) {
      this.wait(8, 40);
      this.list(1, this.pageSize, ''); // xóa ô tìm kiếm
    }
  }

  detail() {
    this.api('GET', `/api/students/${pick(db.ids)}`, 200, int(360, 430), 0.001, 0.004);
  }

  create() {
    if (chance(0.15)) {
      this.api('POST', '/api/students', 400, int(190, 330), 0.003, 0.008); // VALIDATION_ERROR
      this.wait(15, 60);
    }
    const withImage = chance(0.3);
    if (this.api('POST', '/api/students', 201, int(360, 440), withImage ? 0.012 : 0.003, withImage ? 0.045 : 0.012)) {
      db.ids.push(db.nextId++);
      if (withImage) db.images.push({ url: `/uploads/${uuid()}.${pick(['jpg', 'jpg', 'png', 'webp'])}`, size: int(18000, 96000) });
    }
    this.wait(0, 1);
    this.list(1);
  }

  update() {
    const id = pick(db.ids);
    this.wait(20, 110); // mở form, sửa vài ô
    if (chance(0.12)) {
      this.api('PUT', `/api/students/${id}`, 400, int(180, 300), 0.003, 0.008);
      this.wait(10, 40);
    }
    this.api('PUT', `/api/students/${id}`, 200, int(360, 440), 0.003, 0.012);
    this.wait(0, 1);
    this.list();
  }

  remove() {
    if (db.ids.length < 30) return this.detail();
    const id = pick(db.ids.slice(-12)); // thường là bản ghi vừa thêm / bản sao
    if (this.api('DELETE', `/api/students/${id}`, 200, 13, 0.004, 0.011)) db.ids.splice(db.ids.indexOf(id), 1);
    this.wait(0, 1);
    this.list();
  }

  bulkDelete() {
    const n = int(2, 4);
    if (db.ids.length < 30 + n) return this.detail();
    if (this.api('POST', '/api/students/bulk-delete', 200, 13, 0.006, 0.018)) db.ids.splice(-n, n);
    this.wait(0, 1);
    this.list();
  }

  copy() {
    const n = chance(0.6) ? 1 : int(2, 4); // sao chép 1 hoặc nhiều dòng (cùng một API)
    if (this.api('POST', '/api/students/bulk-copy', 201, 24 + n * int(370, 430), 0.004, 0.008 + n * 0.004)) {
      for (let i = 0; i < n; i++) db.ids.push(db.nextId++);
    }
    this.wait(0, 1);
    this.list(1);
  }

  exportFile(format = weighted([['xlsx', 6], ['json', 2], ['xml', 1]]), status) {
    if (status === undefined) {
      // Chiều 04/11 vai trò giangvien tạm bị thu hồi student.export: lượt ngẫu nhiên thì xem danh sách thay vì xuất file
      if (this.user === 'giangvien' && this.t >= EXPORT_REVOKED[0] && this.t <= EXPORT_REVOKED[1]) return this.list();
      status = 200;
    }
    const n = this.q ? searchCount(this.q) : db.ids.length;
    const bytes = status !== 200 ? BYTES.internal : { xlsx: 7900 + n * 92, json: 20 + n * 491, xml: 70 + n * 597 }[format];
    const proc = status === 403 ? secs(0.001, 0.003) : secs(0.004, 0.03) + n * (format === 'xlsx' ? 0.004 : 0.0003);
    return this.send({
      url: `/api/students/export?format=${format}&q=${encodeURIComponent(this.q)}`,
      status, bytes: status === 403 ? BYTES.forbiddenExport : bytes, proc,
    });
  }

  template(format = 'xlsx') {
    this.api('GET', `/api/students/template?format=${format}`, 200, { xlsx: 8698, json: 742, xml: 945 }[format], 0.02, 0.06);
  }

  importFile({ withErrors = false, rows = int(8, 30) } = {}) {
    if (withErrors) {
      this.api('POST', '/api/students/import', 400, 380 + int(3, 9) * 96, 0.18, 0.62);
      this.wait(120, 420); // sửa file Excel rồi nhập lại
    }
    if (this.api('POST', '/api/students/import', 201, rows >= 10 ? 16 : 15, 0.22, 0.4 + rows * 0.03)) {
      for (let i = 0; i < rows; i++) db.ids.push(db.nextId++);
    }
    this.wait(0, 1);
    this.list(1);
  }

  // ---- Người dùng, vai trò
  usersPage() {
    this.api('GET', '/api/users?page=1&pageSize=10&q=', 200, 140 + db.users * 274, 0.001, 0.004);
  }

  userForm() {
    this.api('GET', '/api/roles/options', 200, 222, 0.001, 0.003);
  }

  userCreate() {
    this.usersPage();
    this.wait(5, 20);
    this.userForm();
    this.wait(40, 120);
    if (chance(0.2)) {
      this.api('POST', '/api/users', 409, BYTES.conflictDup, 0.004, 0.01); // trùng tên đăng nhập
      this.wait(10, 30);
    }
    if (this.api('POST', '/api/users', 201, int(270, 300), 0.021, 0.036)) db.users++;
    this.usersPage();
  }

  userUpdate(id = int(2, Math.max(2, db.users)), { reset = chance(0.3) } = {}) {
    this.usersPage();
    this.wait(5, 25);
    this.userForm();
    this.wait(20, 80);
    this.api('PUT', `/api/users/${id}`, 200, int(270, 300), reset ? 0.021 : 0.002, reset ? 0.036 : 0.006);
    this.usersPage();
  }

  rolesPage() {
    this.api('GET', '/api/roles', 200, 1433, 0.001, 0.004);
    this.api('GET', '/api/permissions', 200, 1975, 0.001, 0.003);
  }

  roleUpdate(id = int(2, 4)) {
    this.rolesPage();
    this.wait(30, 120);
    this.api('PUT', `/api/roles/${id}`, 200, int(245, 300), 0.001, 0.004);
    this.api('GET', '/api/roles', 200, 1433, 0.001, 0.004);
  }
}

// =============================================================================
// 6. Hành vi theo vai trò (trọng số chọn hành động)
// =============================================================================
const PROFILES = {
  giaovu: [['browse', 22], ['search', 14], ['detail', 10], ['create', 9], ['update', 10], ['remove', 4],
    ['bulkDelete', 2], ['copy', 5], ['exportFile', 4], ['changePageSize', 3], ['usersPage', 3]],
  giangvien: [['browse', 26], ['search', 16], ['detail', 16], ['update', 12], ['exportFile', 4], ['changePageSize', 3]],
  viewer: [['browse', 30], ['search', 18], ['detail', 16], ['changePageSize', 6]],
  // Thay đổi phân quyền chỉ xảy ra trong các tình huống có chủ đích (phần 7) để dễ theo dõi trong log.
  admin: [['usersPage', 8], ['userCreate', 2], ['userUpdate', 4], ['rolesPage', 6],
    ['browse', 8], ['detail', 3], ['search', 3]],
};

function work(v, persona, nActions) {
  for (let i = 0; i < nActions; i++) {
    v.wait(6, 75);
    v[weighted(PROFILES[persona])]();
  }
}

// =============================================================================
// 7. Các tình huống có chủ đích (thời điểm cố định)
// =============================================================================
const stories = [];
const story = (persona, dev, t, run) => stories.push({ persona, dev, t, run });

function defineStories() {

  // 02/11: giáo vụ tải file mẫu, nhập file có lỗi (400) rồi nhập lại thành công
  story('giaovu', D.giaovuPc, at(2, 9, 21, 14), (v) => {
    if (!v.open('giaovu')) return;
    v.wait(10, 30); v.template('xlsx');
    v.wait(200, 400); v.importFile({ withErrors: true, rows: 25 });
    work(v, 'giaovu', 3);
  });

  // 02/11: lập trình viên thử API bằng curl (quên header Authorization -> 401)
  story('dev', D.devCurl, at(2, 15, 42, 3), (v) => {
    v.ref = '-';
    v.api('GET', '/api/students?page=1&pageSize=10', 401, BYTES.noToken, 0.001, 0.003, '-');
    v.wait(20, 40); v.login('admin');
    v.wait(15, 30); v.api('GET', '/api/students?page=1&pageSize=10', 200, 3954, 0.002, 0.006);
    v.wait(10, 20); v.api('GET', '/api/students/9999', 404, BYTES.notFound, 0.002, 0.005);
    v.wait(10, 20); v.api('GET', '/api/students/12', 200, 393, 0.001, 0.003);
    v.wait(25, 50); v.exportFile('json');
  });

  // 03/11 02:1x: máy quét sqlmap (API cần token nên toàn bị 401) + gói TLS vào cổng HTTP
  story('sqlmap', D.sqlmap, at(3, 2, 12, 58), (v) => {
    v.ref = '-';
    // Client gửi gói bắt tay TLS (https) vào cổng HTTP: Nginx không hiểu, trả 400, User-Agent trống.
    const garbage = Array.from({ length: 26 }, () => {
      const b = int(0, 255);
      return b > 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }).join('');
    v.nginx({ request: `\\x16\\x03\\x01\\x02\\x00\\x01\\x00\\x01\\xFC\\x03\\x03${garbage} `, status: 400, bytes: BYTES.nginx400, ua: '-', rt: 0.041 });
    v.wait(9, 20);
    v.send({ url: '/', status: 200, bytes: ASSETS['/'], user: '-', proc: 0.004 });
    v.wait(1, 2);
    v.send({ url: '/login.html', status: 200, bytes: ASSETS['/login.html'], user: '-', proc: 0.003 });
    const payloads = [
      'a', "a'", 'a%27%20AND%201%3D1--%20-', 'a%27%20AND%201%3D2--%20-', 'a%27%29%20OR%20%271%27%3D%271',
      'a%22%20AND%20SLEEP%285%29%23', 'a%27%20UNION%20ALL%20SELECT%20NULL--%20-',
      'a%27%20UNION%20ALL%20SELECT%20NULL%2CNULL--%20-', 'a%29%20AND%208341%3D8341%20AND%20%288341%3D8341',
      'a%27%3B%20WAITFOR%20DELAY%20%270%3A0%3A5%27--', '1%20AND%20%28SELECT%201%20FROM%20sqlite_master%29',
    ];
    for (const p of payloads) {
      v.wait(0, 2);
      v.api('GET', `/api/students?page=1&pageSize=10&q=${p.replace("'", '%27')}`, 401, BYTES.noToken, 0.001, 0.002, '-');
    }
    for (let i = 0; i < 14; i++) {
      v.wait(1, 3);
      // body JSON chứa payload (không xuất hiện trong access log); JSON hỏng -> 400
      if (i % 5 === 4) v.api('POST', '/api/auth/login', 400, BYTES.badJson, 0.001, 0.003, '-');
      else v.api('POST', '/api/auth/login', 401, BYTES.loginFail, 0.002, 0.034, '-');
    }
    v.wait(2, 4);
    v.api('GET', '/api/students/1%20OR%201%3D1', 401, BYTES.noToken, 0.001, 0.002, '-');
    v.api('GET', '/api/users?page=1&pageSize=10&q=%27%20OR%201%3D1--', 401, BYTES.noToken, 0.001, 0.002, '-');
  });

  // 03/11 10:1x: dò mật khẩu từ một máy phòng lab (nhiều lần 401 liên tiếp rồi bỏ cuộc)
  story('anon', D.lab42, at(3, 10, 12, 31), (v) => {
    v.loginPage('-');
    for (let i = 0; i < 7; i++) {
      v.wait(6, 14);
      v.api('POST', '/api/auth/login', 401, BYTES.loginFail, 0.021, 0.036, '-');
    }
  });

  // 03/11 14:4x: giáo vụ gõ tay địa chỉ #/roles -> API trả 403 (thiếu quyền role.read)
  story('giaovu', D.giaovuPc, at(3, 14, 41, 9), (v) => {
    if (!v.open('giaovu')) return;
    work(v, 'giaovu', 2);
    v.wait(10, 30);
    v.api('GET', '/api/roles', 403, BYTES.forbiddenRole, 0.002, 0.004);
    v.api('GET', '/api/permissions', 403, BYTES.forbiddenRole, 0.002, 0.004);
    work(v, 'giaovu', 3);
  });

  // 04/11 10:00-10:08: app khởi động lại để cập nhật -> 502, giáo vụ và giảng viên đang dùng
  story('giaovu', D.giaovuPc, at(4, 9, 58, 40), (v) => {
    if (!v.open('giaovu')) return;
    v.wait(30, 50); v.search();
    v.t = Math.max(v.t, APP_DOWN_FROM + int(10, 25));
    v.update(); //                lưu đúng lúc app vừa tắt: PUT nhận 502
    v.wait(20, 40); v.list(); //  thử lại: 502
    v.wait(30, 50); v.list(); //  502
    v.wait(30, 50); v.appPage('-'); // F5: chỉ nhận trang lỗi 502 của Nginx
    v.t = Math.max(v.t, APP_DOWN_TO + int(20, 40));
    v.appPage('-'); //          tải lại trang sau khi app chạy lại: file tĩnh mới -> 200
    v.api('GET', '/api/auth/me', 200, meBytes('giaovu'), 0.002, 0.008);
    v.list(1, 10, '');
    work(v, 'giaovu', 4);
  });
  story('giangvien', D.giangvienMac, at(4, 10, 3, 2), (v) => {
    v.appPage('-'); //          giảng viên mở trang đúng lúc app tắt
    v.wait(20, 35);
    v.appPage('-'); //          F5 lần nữa
    v.t = Math.max(v.t, APP_DOWN_TO + int(60, 120));
    if (!v.open('giangvien')) return;
    work(v, 'giangvien', 3);
  });

  // 04/11: thu hồi quyền student.export của vai trò giangvien (RoleID 3), rồi trả lại
  story('admin', D.adminPc, at(4, 13, 52, 10), (v) => {
    if (!v.open('admin')) return;
    v.wait(10, 20); v.roleUpdate(3); //   bỏ student.export
  });
  story('giangvien', D.giangvienMac, at(4, 13, 40, 5), (v) => {
    if (!v.open('giangvien')) return;
    work(v, 'giangvien', 2);
    v.t = Math.max(v.t, at(4, 14, 6, 12));
    v.list();
    v.wait(20, 40);
    v.exportFile('xlsx', 403); // nút vẫn hiện vì chưa tải lại trang, nhưng backend chặn ngay
    v.wait(5, 10);
    v.api('GET', '/api/auth/me', 200, meBytes('giangvien') - 17, 0.002, 0.006); // giao diện cập nhật lại quyền
    work(v, 'giangvien', 2);
  });
  story('admin', D.adminPc, at(4, 15, 9, 33), (v) => {
    if (!v.open('admin')) return;
    v.wait(10, 20); v.roleUpdate(3); //   trả lại student.export
    v.wait(30, 90); v.userUpdate(5, { reset: false }); // khóa tài khoản thuctap (IsActive = 0)
  });
  story('giangvien', D.giangvienMac, at(4, 15, 21, 44), (v) => {
    if (!v.open('giangvien')) return;
    v.wait(15, 30); v.exportFile('xlsx');
    work(v, 'giangvien', 2);
  });

  // 05/11 03:0x: máy quét lỗ hổng Nikto
  story('nikto', D.nikto, at(5, 3, 1, 47), (v) => {
    v.ref = '-';
    const probes = [
      ['GET', '/'], ['GET', '/robots.txt'], ['GET', '/.env'], ['GET', '/wp-login.php'], ['GET', '/.git/config'],
      ['GET', '/phpmyadmin/'], ['GET', '/admin.php'], ['GET', '/server-status'], ['GET', '/config.php'],
      ['GET', '/backup.zip'], ['GET', '/.DS_Store'], ['GET', '/xmlrpc.php'], ['POST', '/xmlrpc.php'],
      ['GET', '/cgi-bin/test-cgi'], ['GET', '/web.config'], ['GET', '/.htaccess'], ['GET', '/wp-admin/'],
      ['GET', '/api/v1/users'], ['GET', '/.aws/credentials'], ['GET', '/actuator/health'], ['GET', '/login.html'],
      ['GET', '/data/app.db'], ['GET', '/uploads/'], ['GET', '/.env.bak'], ['GET', '/package.json'],
      ['GET', '/server.js'], ['TRACE', '/'], ['GET', '/sitemap.xml'], ['GET', '/favicon.ico'],
    ];
    let test = 0;
    for (const [method, url] of probes) {
      v.wait(0, 3);
      v.dev.ua = UA.nikto(test += int(1, 40));
      if (url === '/favicon.ico') v.send({ method, url, status: 204, bytes: 0, user: '-', proc: secs(0.001, 0.003) });
      else if (method === 'GET' && (url === '/' || url === '/login.html')) v.send({ method, url, status: 200, bytes: ASSETS[url], user: '-', proc: secs(0.002, 0.004) });
      else if (url.startsWith('/api/')) v.api(method, url, 404, Buffer.byteLength(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Không tìm thấy API: ${method} ${url}` } })), 0.001, 0.002, '-');
      else if (url.startsWith('/uploads/')) v.send({ method, url, status: 404, bytes: BYTES.uploadMissing, user: '-', proc: secs(0.001, 0.002) });
      else v.send({ method, url, status: 404, bytes: html404(method, url), user: '-', proc: secs(0.001, 0.003) });
    }
    // Đường dẫn vượt ra ngoài thư mục gốc: Nginx tự trả 400 trước khi đọc header (User-Agent trống)
    v.wait(1, 2);
    v.nginx({ request: 'GET /../../etc/passwd HTTP/1.1', status: 400, bytes: BYTES.nginx400, ua: '-' });
    v.wait(0, 1);
    v.nginx({ request: 'GET /uploads/../../data/app.db HTTP/1.1', status: 400, bytes: BYTES.nginx400, ua: '-' });
  });

  // 05/11 08:3x: tài khoản "thuctap" đã bị khóa -> đăng nhập nhận 403 (ACCOUNT_LOCKED)
  story('anon', D.lab58, at(5, 8, 31, 26), (v) => {
    v.loginPage('-');
    v.wait(10, 20); v.api('POST', '/api/auth/login', 403, BYTES.locked, 0.022, 0.037, '-');
    v.wait(15, 40); v.api('POST', '/api/auth/login', 403, BYTES.locked, 0.022, 0.037, '-');
  });

  // 05/11 11:1x: lỗi xuất file Excel (500), thử lại thì được
  story('giaovu', D.giaovuPc, at(5, 11, 14, 2), (v) => {
    if (!v.open('giaovu')) return;
    work(v, 'giaovu', 2);
    v.wait(10, 20); v.exportFile('xlsx', 500);
    v.wait(20, 45); v.exportFile('xlsx');
    work(v, 'giaovu', 2);
  });

  // 05/11 14:3x: kiểm thử API vai trò bằng Postman
  story('dev', D.devPostman, at(5, 14, 33, 18), (v) => {
    v.ref = '-';
    v.login('admin');
    v.wait(20, 40); v.api('GET', '/api/permissions', 200, 1975, 0.001, 0.003);
    v.wait(30, 60); v.api('POST', '/api/roles', 201, 296, 0.002, 0.006); //  tạo vai trò "thuky" (RoleID 5)
    v.wait(20, 50); v.api('PUT', '/api/roles/5', 200, 331, 0.001, 0.004);
    v.wait(20, 40); v.api('DELETE', '/api/roles/2', 409, BYTES.conflictRole, 0.003, 0.007); // vai trò đang có người dùng
    v.wait(15, 30); v.api('DELETE', '/api/roles/5', 200, 13, 0.004, 0.009);
    v.wait(15, 30); v.api('DELETE', '/api/users/1', 409, BYTES.conflictSelf, 0.003, 0.007); // không được tự xóa mình
  });

  // 05/11 16:2x: file import 14 MB bị Nginx chặn (413), ảnh 7 MB bị app chặn (413)
  story('giaovu', D.giaovuPc, at(5, 16, 18, 37), (v) => {
    if (!v.open('giaovu')) return;
    v.wait(30, 60);
    v.nginx({ request: 'POST /api/students/import HTTP/1.1', status: 413, bytes: BYTES.nginx413api, referer: REF_APP, rt: 0.002 });
    v.wait(60, 120); v.importFile({ rows: 40 }); // file nhỏ hơn
    v.wait(40, 80);
    v.api('POST', '/api/students', 413, BYTES.app413, 0.081, 0.142); // ảnh quá 5 MB: app (multer) chặn
    v.wait(20, 40); v.create();
  });

  // 06/11: người xem gõ tay #/users trên điện thoại -> 403
  story('viewer', D.viewerAndroid, at(6, 9, 47, 12), (v) => {
    if (!v.open('viewer')) return;
    work(v, 'viewer', 2);
    v.wait(10, 30);
    v.api('GET', '/api/users?page=1&pageSize=10&q=', 403, BYTES.forbiddenUser, 0.002, 0.004);
    v.api('GET', '/api/roles/options', 403, BYTES.forbiddenOptions, 0.002, 0.004);
    work(v, 'viewer', 2);
  });

  // 02/11: admin tạo tài khoản thực tập (sau này bị khóa)
  story('admin', D.adminPc, at(2, 8, 4, 51), (v) => {
    if (!v.open('admin')) return;
    v.wait(10, 30); v.rolesPage();
    v.wait(20, 60); v.userCreate();
    work(v, 'admin', 3);
  });

  // 01/11 (Chủ nhật): giáo vụ làm việc ở nhà buổi tối
  story('giaovu', D.giaovuHome, at(1, 20, 14, 22), (v) => {
    if (!v.open('giaovu')) return;
    work(v, 'giaovu', 4);
    v.wait(10, 30); v.exportFile('xlsx');
  });

  // Script sao lưu hằng đêm (python-requests) đăng nhập rồi export JSON
  for (let day = 1; day <= 5; day++) {
    story('backup', D.devPython, at(day, 23, 30, int(1, 4)), (v) => {
      v.ref = '-';
      if (v.login('admin')) v.exportFile('json');
    });
  }

  // 06/11 14:0x: giờ cao điểm. Giáo vụ sao chép, xóa nhiều dòng, thêm mới; admin đặt lại mật khẩu
  story('giaovu', D.giaovuPc, at(6, 14, 1, 37), (v) => {
    if (!v.open('giaovu')) return;
    v.wait(20, 40); v.copy();
    v.wait(30, 60); v.bulkDelete();
    v.wait(30, 60); v.create();
    v.wait(20, 50); v.search();
    v.wait(30, 60); v.exportFile('xml');
    work(v, 'giaovu', 3);
  });
  story('admin', D.adminPc, at(6, 14, 32, 5), (v) => {
    if (!v.open('admin')) return;
    v.wait(20, 40); v.userUpdate(4, { reset: true }); // đặt lại mật khẩu cho viewer
    work(v, 'admin', 2);
  });
  story('viewer', D.viewer4g, at(6, 14, 12, 50), (v) => {
    if (!v.open('viewer')) return;
    work(v, 'viewer', 3);
  });

  // 06/11 cuối giờ chiều: giảng viên cập nhật điểm
  story('giangvien', D.giangvienMac, at(6, 16, 58, 21), (v) => {
    if (!v.open('giangvien')) return;
    v.wait(20, 40); v.search();
    v.wait(20, 40); v.update();
    v.wait(20, 40); v.update();
  });
}

// =============================================================================
// 8. Lượt truy cập ngẫu nhiên theo lịch làm việc
// =============================================================================
const OFFICE = [[7 * HOUR + 30 * MIN, 11 * HOUR + 30 * MIN, 5], [13 * HOUR + 30 * MIN, 17 * HOUR + 15 * MIN, 4]];
const EVENING = [[19 * HOUR, 22 * HOUR + 30 * MIN, 1]];

function randomTime(day, slots) {
  const [from, to] = weighted(slots.map((s) => [s, s[2]]));
  return (day - 1) * DAY + int(from, to);
}

const RANDOM_PLAN = [
  // persona, thiết bị (chọn theo trọng số), số lượt/ngày làm việc, khung giờ, số hành động mỗi lượt
  { persona: 'giaovu', devices: [[D.giaovuPc, 1]], visits: [1, 2], slots: OFFICE, actions: [5, 10] },
  { persona: 'giaovu', devices: [[D.giaovuHome, 1]], visits: [0, 1], slots: EVENING, actions: [3, 6] },
  { persona: 'giangvien', devices: [[D.giangvienMac, 1]], visits: [1, 2], slots: OFFICE, actions: [3, 8] },
  { persona: 'giangvien', devices: [[D.giangvienHome, 1]], visits: [0, 1], slots: EVENING, actions: [2, 5] },
  { persona: 'viewer', devices: [[D.viewerLab, 2], [D.viewerAndroid, 1]], visits: [1, 2], slots: OFFICE, actions: [2, 6] },
  { persona: 'viewer', devices: [[D.viewer4g, 1]], visits: [0, 1], slots: EVENING, actions: [2, 4] },
  { persona: 'admin', devices: [[D.adminPc, 1]], visits: [0, 1], slots: OFFICE, actions: [3, 6] },
];

function planRandomVisits() {
  const plans = [];
  for (let day = 2; day <= 6; day++) {
    for (const p of RANDOM_PLAN) {
      const n = int(p.visits[0], p.visits[1]);
      for (let i = 0; i < n; i++) {
        const dev = weighted(p.devices);
        const actions = int(p.actions[0], p.actions[1]);
        plans.push({ persona: p.persona, dev, t: randomTime(day, p.slots), est: 90 + actions * 50, run: (v) => {
          if (v.open(p.persona, { fails: chance(0.08) ? 1 : 0 })) work(v, p.persona, actions);
        } });
      }
    }
    // Khách chưa đăng nhập (sinh viên tò mò): mở trang đăng nhập, thử 1-2 lần rồi thôi
    for (let i = int(0, 2); i > 0; i--) {
      plans.push({ persona: 'anon', dev: pick([D.lab42, D.lab58, D.guestIphone]), t: randomTime(day, OFFICE), est: 120, run: (v) => {
        v.loginPage('-');
        for (let k = int(0, 2); k > 0; k--) { v.wait(8, 30); v.api('POST', '/api/auth/login', 401, BYTES.loginFail, 0.021, 0.036, '-'); }
      } });
    }
    // Lập trình viên kiểm tra nhanh API bằng curl
    if (chance(0.4)) {
      plans.push({ persona: 'dev', dev: D.devCurl, t: randomTime(day, OFFICE), est: 120, run: (v) => {
        v.ref = '-';
        if (!v.login('admin')) return;
        v.wait(5, 20); v.api('GET', `/api/students?page=${int(1, 4)}&pageSize=10`, 200, 60 + 10 * int(380, 405), 0.002, 0.006);
        if (chance(0.5)) { v.wait(5, 20); v.api('GET', `/api/students/${pick(db.ids)}`, 200, int(360, 430), 0.001, 0.004); }
      } });
    }
  }
  // Googlebot ghé thăm vài lần mỗi ngày, mọi khung giờ
  for (let day = 1; day <= 6; day++) {
    for (let i = int(1, 3); i > 0; i--) {
      plans.push({ persona: 'bot', dev: D.googlebot, t: (day - 1) * DAY + int(0, DAY - 1), est: 30, run: (v) => {
        v.ref = '-';
        const url = weighted([['/robots.txt', 3], ['/', 3], ['/login.html', 2], ['/favicon.ico', 2]]);
        if (url === '/robots.txt') v.send({ url, status: 404, bytes: html404('GET', url), user: '-', proc: secs(0.001, 0.003) });
        else if (url === '/favicon.ico') v.send({ url, status: 204, bytes: 0, user: '-', proc: secs(0.001, 0.003) });
        else v.send({ url, status: 200, bytes: ASSETS[url], user: '-', proc: secs(0.002, 0.005) });
      } });
    }
  }
  return plans;
}

// =============================================================================
// 9. Chạy mô phỏng theo thứ tự thời gian và ghi file
// =============================================================================
function simulate() {
  const busy = new Map(); // persona -> các khoảng thời gian đã có lượt truy cập (tránh 2 lượt chồng nhau)
  const overlaps = (persona, from, to) => (busy.get(persona) || []).some(([a, b]) => from < b + 600 && to > a - 600);
  const reserve = (persona, from, to) => busy.set(persona, [...(busy.get(persona) || []), [from, to]]);

  const plans = stories.map((s) => ({ ...s, est: 900 }));
  plans.forEach((p) => reserve(p.persona, p.t, p.t + p.est));
  for (const p of planRandomVisits()) {
    const single = ['anon', 'bot', 'dev'].includes(p.persona);
    if (!single && overlaps(p.persona, p.t, p.t + p.est)) continue; // bỏ lượt bị trùng giờ
    reserve(p.persona, p.t, p.t + p.est);
    plans.push(p);
  }
  plans.sort((a, b) => a.t - b.t);
  for (const p of plans) {
    if (p.t > END) continue;
    p.run(new Visit(p.dev, p.t));
  }
}

function formatQlsv(e) {
  const urt = e.urt === null ? '-' : e.urt.toFixed(3);
  return `${e.ip} - - [${fmtTime(e.t)}] "${e.request}" ${e.status} ${e.bytes} "${e.referer}" "${e.ua}" "${e.user}" rt=${e.rt.toFixed(3)} urt=${urt}`;
}

function formatCombined(e) {
  return `${e.ip} - - [${fmtTime(e.t)}] "${e.request}" ${e.status} ${e.bytes} "${e.referer}" "${e.ua}"`;
}

function parseArgs(argv) {
  const opts = { seed: 20261106, out: path.join(__dirname, '..', 'nginx', 'sample-logs') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--out') opts.out = path.resolve(argv[++i] || '.');
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Tham số không hợp lệ: ${a}\n${USAGE}`);
      process.exit(1);
    }
  }
  if (!Number.isSafeInteger(opts.seed)) {
    console.error('--seed phải là số nguyên');
    process.exit(1);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  rand = mulberry32(opts.seed);
  defineStories();
  simulate();

  const lines = entries
    .filter((e) => e.t <= END)
    .sort((a, b) => a.t - b.t || a.seq - b.seq);

  fs.mkdirSync(opts.out, { recursive: true });
  const qlsvFile = path.join(opts.out, 'access.log');
  const combinedFile = path.join(opts.out, 'access-combined.log');
  fs.writeFileSync(qlsvFile, lines.map(formatQlsv).join('\n') + '\n');
  fs.writeFileSync(combinedFile, lines.map(formatCombined).join('\n') + '\n');

  const byStatus = {};
  for (const e of lines) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  console.log(`Đã ghi ${lines.length} dòng (seed ${opts.seed}), từ ${fmtTime(lines[0].t)} đến ${fmtTime(lines[lines.length - 1].t)}`);
  console.log(`  ${path.relative(process.cwd(), qlsvFile) || qlsvFile}  (định dạng qlsv)`);
  console.log(`  ${path.relative(process.cwd(), combinedFile) || combinedFile}  (định dạng combined)`);
  console.log(`  IP khác nhau: ${new Set(lines.map((e) => e.ip)).size}`);
  console.log(`  Status: ${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(' ')}`);
}

main();
