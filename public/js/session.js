/**
 * Session + permission helpers.
 * localStorage['qlsv.session'] = { token, user, permissions: [codes] }
 */
export const SESSION_KEY = 'qlsv.session';

let cache = null;

function readStorage() {
  try {
    const rawValue = localStorage.getItem(SESSION_KEY);
    if (!rawValue) return null;
    const data = JSON.parse(rawValue);
    if (!data || typeof data.token !== 'string' || !data.token) return null;
    return {
      token: data.token,
      user: data.user && typeof data.user === 'object' ? data.user : null,
      permissions: Array.isArray(data.permissions) ? data.permissions.filter((p) => typeof p === 'string') : [],
    };
  } catch {
    return null;
  }
}

export function getSession() {
  if (!cache) cache = readStorage();
  return cache;
}

export function saveSession({ token, user, permissions }) {
  cache = { token, user: user ?? null, permissions: Array.isArray(permissions) ? [...permissions] : [] };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable (private mode…): keep the session in memory only */
  }
  return cache;
}

export function updateSession(patch) {
  const current = getSession();
  if (!current) return null;
  return saveSession({ ...current, ...patch });
}

export function clearSession() {
  cache = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export const getToken = () => getSession()?.token ?? null;
export const getUser = () => getSession()?.user ?? null;
export const getPermissions = () => getSession()?.permissions ?? [];

export function can(code) {
  return getPermissions().includes(code);
}

export function canAny(...codes) {
  return codes.some((code) => can(code));
}

export const LOGIN_NOTICE_KEY = 'qlsv.loginNotice';

/** Clear the session and go to the login page; `message` (e.g. the server's 401 reason) is shown there once. */
export function redirectToLogin(reason, message) {
  clearSession();
  try {
    if (message) sessionStorage.setItem(LOGIN_NOTICE_KEY, message);
  } catch {
    /* ignore */
  }
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  window.location.replace(`/login.html${query}`);
}

/* Another tab logged in/out: drop the in-memory copy. */
window.addEventListener('storage', (event) => {
  if (event.key === SESSION_KEY || event.key === null) cache = null;
});

/* Ask the app shell to reload /api/auth/me (e.g. after a 403 or after editing roles). */
export const SESSION_REFRESH_EVENT = 'qlsv:refresh-session';
export function requestSessionRefresh() {
  window.dispatchEvent(new CustomEvent(SESSION_REFRESH_EVENT));
}

/* Vietnamese phrases used in "Bạn không có quyền …" messages. */
export const PERMISSION_PHRASES = {
  'student.read': 'xem sinh viên',
  'student.create': 'thêm sinh viên',
  'student.update': 'sửa sinh viên',
  'student.delete': 'xóa sinh viên',
  'student.import': 'nhập file sinh viên',
  'student.export': 'xuất file sinh viên',
  'user.read': 'xem người dùng',
  'user.create': 'thêm người dùng',
  'user.update': 'sửa người dùng',
  'user.delete': 'xóa người dùng',
  'role.read': 'xem vai trò & phân quyền',
  'role.create': 'thêm vai trò',
  'role.update': 'sửa vai trò & phân quyền',
  'role.delete': 'xóa vai trò',
};

/**
 * "Bạn không có quyền …" text. The server message wins when it already has that form (it is exact even for
 * guards accepting several permissions, where `error.permission` only names the first one).
 */
export function forbiddenMessage(code, serverMessage) {
  if (serverMessage && /^Bạn không có quyền/i.test(serverMessage)) return serverMessage;
  if (code && PERMISSION_PHRASES[code]) return `Bạn không có quyền ${PERMISSION_PHRASES[code]}.`;
  return 'Bạn không có quyền thực hiện thao tác này.';
}
