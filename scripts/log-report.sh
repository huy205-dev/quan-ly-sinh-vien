#!/usr/bin/env bash
# =============================================================================
#  scripts/log-report.sh: lọc và thống kê nhanh access log của Nginx
# -----------------------------------------------------------------------------
#  Đọc log định dạng "qlsv" (xem nginx/qlsv.conf: combined + "$upstream_http_x_user"
#  rt=... urt=...) hoặc định dạng "combined" mặc định (khi đó cột user lấy từ
#  $remote_user, thường là "-").
#
#  Chạy được trên macOS (bash 3.2, awk/sed/grep bản BSD) và Linux (GNU coreutils,
#  gawk/mawk/BusyBox awk): chỉ dùng awk POSIX, không dùng strftime/mktime,
#  grep -P, sed -i hay date -d. File .gz được đọc bằng "gzip -dc" (trên macOS,
#  "zcat file.gz" bị lỗi vì zcat của macOS tìm file .Z).
#
#  Ví dụ (chạy từ thư mục gốc dự án):
#    scripts/log-report.sh -f nginx/sample-logs/access.log
#    scripts/log-report.sh -f nginx/sample-logs/access.log -d 06/Nov/2026 -H 14
#    scripts/log-report.sh -f nginx/sample-logs/access.log -d 2026-11-04 -u giangvien
#    scripts/log-report.sh -f nginx/sample-logs/access.log -s 4xx,5xx -q
#    scripts/log-report.sh -f nginx/sample-logs/access.log -a sqlmap -l 5
#    scripts/log-report.sh -f access.log -f access.log.1 -f access.log.2.gz -i 192.168.1.
#    tail -n 500 nginx/logs/access.log | scripts/log-report.sh -f -
# =============================================================================

PROG=$(basename "$0")

usage() {
  cat <<EOF
Cách dùng: $PROG [tùy chọn]

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
EOF
}

die() {
  echo "$PROG: $*" >&2
  echo "Gõ \"$PROG -h\" để xem hướng dẫn." >&2
  exit 1
}

# ---- 1. Đọc tham số ----------------------------------------------------------
FILES=()
DATE=""
HOURS=""
STATUS=""
AGENT=""
IP=""
USER_FILTER=""
LIMIT=30
TOPN=10
QUIET=0

while getopts ":f:d:H:s:a:i:u:l:n:qh" opt; do
  case "$opt" in
    f) FILES+=("$OPTARG") ;;
    d) DATE=$OPTARG ;;
    H) HOURS=$OPTARG ;;
    s) STATUS=$OPTARG ;;
    a) AGENT=$OPTARG ;;
    i) IP=$OPTARG ;;
    u) USER_FILTER=$OPTARG ;;
    l) LIMIT=$OPTARG ;;
    n) TOPN=$OPTARG ;;
    q) QUIET=1 ;;
    h) usage; exit 0 ;;
    :) die "tùy chọn -$OPTARG cần một giá trị" ;;
    \?) die "tùy chọn không hợp lệ: -$OPTARG" ;;
  esac
done
shift $((OPTIND - 1))
[ $# -eq 0 ] || die "tham số thừa: $*"
[ ${#FILES[@]} -gt 0 ] || FILES=("/var/log/nginx/access.log")

# ---- 2. Kiểm tra giá trị (regex đặt trong biến để chạy được cả bash 3.2) -----
re_num='^[0-9]+$'
[[ $LIMIT =~ $re_num ]] || die "-l phải là số nguyên >= 0"
[[ $TOPN =~ $re_num ]] || die "-n phải là số nguyên >= 0"

# Ngày: chấp nhận 2026-11-06 và đổi sang dạng của Nginx 06/Nov/2026
re_iso='^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$'
re_nginx='^[0-9][0-9]/[A-Z][a-z][a-z]/[0-9][0-9][0-9][0-9]$'
if [ -n "$DATE" ]; then
  if [[ $DATE =~ $re_iso ]]; then
    y=${BASH_REMATCH[1]} m=${BASH_REMATCH[2]} d=${BASH_REMATCH[3]}
    case "$m" in
      01) mon=Jan ;; 02) mon=Feb ;; 03) mon=Mar ;; 04) mon=Apr ;; 05) mon=May ;; 06) mon=Jun ;;
      07) mon=Jul ;; 08) mon=Aug ;; 09) mon=Sep ;; 10) mon=Oct ;; 11) mon=Nov ;; 12) mon=Dec ;;
      *) die "tháng không hợp lệ trong -d $DATE" ;;
    esac
    DATE="$d/$mon/$y"
  elif ! [[ $DATE =~ $re_nginx ]]; then
    die "-d phải có dạng 06/Nov/2026 hoặc 2026-11-06"
  fi
fi

# Giờ: "14" hoặc "08-11"
H1=""
H2=""
if [ -n "$HOURS" ]; then
  re_hour='^([0-9][0-9]?)(-([0-9][0-9]?))?$'
  [[ $HOURS =~ $re_hour ]] || die "-H phải có dạng 14 hoặc 08-11"
  H1=$((10#${BASH_REMATCH[1]}))
  H2=$H1
  [ -n "${BASH_REMATCH[3]}" ] && H2=$((10#${BASH_REMATCH[3]}))
  { [ "$H1" -le 23 ] && [ "$H2" -le 23 ] && [ "$H1" -le "$H2" ]; } || die "-H: giờ trong khoảng 0-23 và giờ đầu <= giờ cuối"
fi

# Status: 404 | 4xx | 401,403 | 4xx,5xx
if [ -n "$STATUS" ]; then
  re_status='^([1-5]([0-9][0-9]|xx))(,[1-5]([0-9][0-9]|xx))*$'
  [[ $STATUS =~ $re_status ]] || die "-s phải có dạng 404, 4xx hoặc danh sách 401,403"
fi

for f in "${FILES[@]}"; do
  [ "$f" = "-" ] && continue
  [ -f "$f" ] || die "không tìm thấy file log: $f  (thử: -f nginx/sample-logs/access.log)"
  [ -r "$f" ] || die "không có quyền đọc $f  (log hệ thống thường cần sudo)"
done

# ---- 3. Đọc dữ liệu: nối các file, tự giải nén .gz -------------------------------
read_input() {
  local f
  for f in "${FILES[@]}"; do
    case "$f" in
      -) cat ;;
      *.gz) gzip -dc -- "$f" ;;
      *) cat -- "$f" ;;
    esac
  done
}

# Giá trị chuỗi truyền vào awk qua biến môi trường (ENVIRON) để awk không
# diễn giải dấu "\" như khi dùng "awk -v".
export LR_DATE="$DATE" LR_STATUS="$STATUS" LR_AGENT="$AGENT" LR_IP="$IP" LR_USER="$USER_FILTER"
export LR_HOURS="$HOURS" LR_SOURCE="${FILES[*]}"

# ---- 4. Phân tích bằng awk (POSIX) ----------------------------------------------
read_input | awk -F'"' -v H1="$H1" -v H2="$H2" -v LIMIT="$LIMIT" -v TOPN="$TOPN" -v QUIET="$QUIET" '
# Cấu trúc một dòng khi tách theo dấu nháy kép (-F"):
#   $1 = 192.168.1.15 - - [06/Nov/2026:14:24:04 +0700]     (IP, -, remote_user, thời gian)
#   $2 = GET /api/students?page=1 HTTP/1.1                 (request)
#   $3 =  200 4430                                         (status, số byte)
#   $4 = referer   $6 = user-agent   $8 = X-User (định dạng qlsv)   $9 =  rt=... urt=...
BEGIN {
  fdate = ENVIRON["LR_DATE"]; fagent = tolower(ENVIRON["LR_AGENT"])
  fip = ENVIRON["LR_IP"]; fuser = ENVIRON["LR_USER"]; fstatus = ENVIRON["LR_STATUS"]
  ipprefix = (substr(fip, length(fip), 1) == ".")
  nst = split(fstatus, stlist, ",")
  total = 0; matched = 0; bad = 0; shown = 0; ndays = 0; qlsv = 0
  nm = split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mname, " ")
  for (i = 1; i <= nm; i++) monnum[mname[i]] = sprintf("%02d", i)
}

# Khóa so sánh được theo thời gian: "06/Nov/2026" -> "20261106"
# (cần vì có thể truyền nhiều file theo thứ tự mới nhất trước, như access.log access.log.1 ...)
function dkey(d) { return substr(d, 8, 4) monnum[substr(d, 4, 3)] substr(d, 1, 2) }
# "06/Nov/2026:14:24:04" -> "20261106 14:24:04"
function tkey(t) { return dkey(substr(t, 1, 11)) " " substr(t, 13, 8) }

function status_ok(st,   i, s) {
  if (nst == 0) return 1
  for (i = 1; i <= nst; i++) {
    s = stlist[i]
    if (s == st) return 1
    if (substr(s, 2) == "xx" && substr(s, 1, 1) == substr(st, 1, 1)) return 1
  }
  return 0
}

# Thêm v vào danh sách "a,b,c" nếu chưa có
function addset(list, v) {
  if (list == "") return v
  if (index("," list ",", "," v ",") > 0) return list
  return list "," v
}

# Rút gọn danh sách "a,b,c,d,e,f,g" thành "a,b,c,d,e,... (+2)"
function shortlist(list, max,   parts, n, i, out) {
  n = split(list, parts, ",")
  if (n <= max) return list
  out = parts[1]
  for (i = 2; i <= max; i++) out = out "," parts[i]
  return out ",... (+" (n - max) ")"
}

# In n phần tử có giá trị lớn nhất của mảng cnt (hòa thì xếp theo khóa)
function top(cnt, n, label, extra, sum,   k, keys, nk, i, j, best, used, pct) {
  nk = 0
  for (k in cnt) keys[++nk] = k
  if (nk == 0) { print "  (không có dữ liệu)"; return }
  for (i = 1; i <= n && i <= nk; i++) {
    best = 0
    for (j = 1; j <= nk; j++) {
      if (used[j]) continue
      if (best == 0 || cnt[keys[j]] > cnt[keys[best]] || (cnt[keys[j]] == cnt[keys[best]] && keys[j] < keys[best])) best = j
    }
    used[best] = 1
    pct = sum > 0 ? 100 * cnt[keys[best]] / sum : 0
    if (label == "ip") printf "  %6d  %5.1f%%  %-15s  user: %s\n", cnt[keys[best]], pct, keys[best], shortlist(extra[keys[best]], 5)
    else if (label == "user") printf "  %6d  %5.1f%%  %-12s  IP: %s\n", cnt[keys[best]], pct, keys[best], shortlist(extra[keys[best]], 5)
    else printf "  %6d  %5.1f%%  %s\n", cnt[keys[best]], pct, keys[best]
  }
  if (nk > n) printf "  ... và %d mục khác\n", nk - n
}

{
  total++
  if (NF < 7) { bad++; next }

  split($1, pre, " ")
  ip = pre[1]; ruser = pre[3]; t = substr(pre[4], 2)          # 06/Nov/2026:14:24:04
  day = substr(t, 1, 11); hour = substr(t, 13, 2)
  if (ip == "" || length(t) < 20) { bad++; next }

  nr = split($2, rq, " ")
  if (nr >= 3 && substr(rq[nr], 1, 5) == "HTTP/") { method = rq[1]; path = rq[2] }
  else { method = "-"; path = $2 }                                # request hỏng (ví dụ gói TLS)
  split($3, sb, " "); st = sb[1]
  ua = $6
  if (NF >= 9 && substr($9, 1, 4) == " rt=") { user = $8; qlsv = 1 } else user = ruser

  # ---- bộ lọc
  if (fdate != "" && day != fdate) next
  if (H1 != "" && (hour + 0 < H1 + 0 || hour + 0 > H2 + 0)) next
  if (!status_ok(st)) next
  if (fagent != "" && index(tolower(ua), fagent) == 0) next
  if (fip != "") { if (ipprefix) { if (index(ip, fip) != 1) next } else if (ip != fip) next }
  if (ENVIRON["LR_USER"] != "" && user != fuser) next

  matched++
  # Lấy mốc sớm nhất / muộn nhất theo thời gian, không theo thứ tự dòng đọc vào
  tk = tkey(t)
  if (matched == 1 || tk < kfirst) { kfirst = tk; first = t }
  if (matched == 1 || tk > klast) { klast = tk; last = t }
  shortpath = path; q = index(shortpath, "?"); if (q > 0) shortpath = substr(shortpath, 1, q - 1)
  shown_path = path; if (length(shown_path) > 70) shown_path = substr(shown_path, 1, 67) "..."

  if (!QUIET && (LIMIT == 0 || shown < LIMIT)) {
    if (shown == 0) print "\n--- Danh sách request khớp bộ lọc ---"
    printf "%s | %-15s | %-10s | %s %s | %s\n", t, ip, user, method, shown_path, st
    shown++
  }

  c_ip[ip]++; ip_users[ip] = addset(ip_users[ip], user)
  c_user[user]++; user_ips[user] = addset(user_ips[user], ip)
  c_status[st]++
  c_hour[hour]++
  if (!(day in c_day)) daylist[++ndays] = day
  c_day[day]++
  c_path[shortpath]++
  if (st >= 400) c_err[st " " method " " shortpath]++
}

END {
  if (!QUIET && matched > shown) printf "... còn %d request nữa (dùng -l 0 để in tất cả, -l N để in N dòng)\n", matched - shown

  print "\n=== Tổng quan ==="
  printf "Nguồn: %s\n", ENVIRON["LR_SOURCE"]
  f = ""
  if (fdate != "") f = f " ngày=" fdate
  if (ENVIRON["LR_HOURS"] != "") f = f " giờ=" ENVIRON["LR_HOURS"]
  if (fstatus != "") f = f " status=" fstatus
  if (ENVIRON["LR_AGENT"] != "") f = f " user-agent~" ENVIRON["LR_AGENT"]
  if (fip != "") f = f " ip=" fip
  if (ENVIRON["LR_USER"] != "") f = f " user=" fuser
  printf "Bộ lọc:%s\n", (f == "" ? " (không có)" : f)
  printf "Định dạng: %s\n", (qlsv ? "qlsv (user lấy từ trường X-User)" : "combined (user lấy từ $remote_user)")
  printf "Số dòng đã đọc: %d | khớp bộ lọc: %d | dòng sai định dạng: %d\n", total, matched, bad
  if (matched == 0) { print "Không có request nào khớp bộ lọc."; exit 0 }
  printf "Từ %s đến %s\n", first, last
  nip = 0; for (k in c_ip) nip++
  nus = 0; for (k in c_user) nus++
  printf "Số IP khác nhau: %d | số user khác nhau: %d\n", nip, nus

  printf "\n=== Top %d IP (kèm các user đã đăng nhập từ IP đó) ===\n", TOPN
  top(c_ip, TOPN, "ip", ip_users, matched)

  printf "\n=== Top %d user (\"-\" = chưa đăng nhập / file tĩnh) ===\n", TOPN
  top(c_user, TOPN, "user", user_ips, matched)

  print "\n=== Status code ==="
  ns = 0
  for (k in c_status) sk[++ns] = k
  for (i = 2; i <= ns; i++) { v = sk[i]; for (j = i - 1; j >= 1 && sk[j] > v; j--) sk[j + 1] = sk[j]; sk[j + 1] = v }
  for (i = 1; i <= ns; i++) printf "  %s  %6d  %5.1f%%\n", sk[i], c_status[sk[i]], 100 * c_status[sk[i]] / matched

  if (ndays > 1) {
    print "\n=== Số request theo ngày ==="
    # sắp xếp ngày tăng dần (insertion sort, chạy được trên mọi bản awk)
    for (i = 2; i <= ndays; i++) {
      v = daylist[i]; j = i - 1
      while (j >= 1 && dkey(daylist[j]) > dkey(v)) { daylist[j + 1] = daylist[j]; j-- }
      daylist[j + 1] = v
    }
    for (i = 1; i <= ndays; i++) printf "  %s  %6d\n", daylist[i], c_day[daylist[i]]
  }

  print "\n=== Số request theo giờ (gộp các ngày) ==="
  max = 0
  # Chú ý: chỉ đọc c_hour[hh] sau khi kiểm tra (hh in c_hour), vì trong awk
  # việc đọc một phần tử chưa có sẽ tạo ra phần tử đó (giá trị rỗng).
  for (h = 0; h < 24; h++) { hh = sprintf("%02d", h); if ((hh in c_hour) && c_hour[hh] > max) max = c_hour[hh] }
  for (h = 0; h < 24; h++) {
    hh = sprintf("%02d", h)
    if (!(hh in c_hour)) continue
    w = int(c_hour[hh] * 40 / max); if (w < 1) w = 1
    bar = ""; for (b = 0; b < w; b++) bar = bar "#"
    printf "  %sh  %6d  %s\n", hh, c_hour[hh], bar
  }

  printf "\n=== Top %d đường dẫn (đã bỏ query string) ===\n", TOPN
  top(c_path, TOPN, "path", c_path, matched)

  nerr = 0; for (k in c_err) nerr += c_err[k]
  printf "\n=== Lỗi 4xx/5xx: %d request (gộp theo status + method + đường dẫn) ===\n", nerr
  if (nerr > 0) top(c_err, TOPN, "err", c_err, nerr)
  else print "  (không có)"
}
'
