/**
 * REST client for /api (SPEC sections 4–7).
 * - adds `Authorization: Bearer <token>`
 * - normalises errors `{ error: { code, message, details, permission } }` into ApiError
 * - 401 on an authenticated call -> clear session, go to /login.html
 */
import { getToken, redirectToLogin } from './session.js';

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK_ERROR', message, details, permission } = {}) {
    super(message || 'Đã có lỗi xảy ra.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.permission = permission ?? null;
    this.handled = false; // true when already dealt with (e.g. redirected to login)
  }
}

const DEFAULT_MESSAGES = {
  0: 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra kết nối mạng.',
  400: 'Dữ liệu không hợp lệ.',
  401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy dữ liệu.',
  409: 'Thao tác bị từ chối do xung đột dữ liệu.',
  413: 'Tệp quá lớn.',
  500: 'Máy chủ gặp lỗi, vui lòng thử lại sau.',
};

/* ---- global "busy" indicator (number of requests in flight) ---- */
let inflight = 0;
const busyListeners = new Set();

export function onBusyChange(listener) {
  busyListeners.add(listener);
  return () => busyListeners.delete(listener);
}

function changeInflight(delta) {
  inflight = Math.max(0, inflight + delta);
  for (const listener of busyListeners) listener(inflight > 0);
}

function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function toApiError(response) {
  let payload = null;
  try {
    if ((response.headers.get('content-type') || '').includes('json')) payload = await response.json();
  } catch {
    /* body is not JSON */
  }
  const err = payload && typeof payload.error === 'object' && payload.error ? payload.error : {};
  return new ApiError({
    status: response.status,
    code: err.code || `HTTP_${response.status}`,
    message: err.message || DEFAULT_MESSAGES[response.status] || `Lỗi máy chủ (${response.status}).`,
    details: err.details,
    permission: err.permission,
  });
}

/**
 * @param {string} path
 * @param {{method?: string, query?: object, json?: any, form?: FormData, auth?: boolean, raw?: boolean}} options
 */
export async function request(path, { method = 'GET', query, json, form, auth = true, raw = false } = {}) {
  const headers = { Accept: raw ? '*/*' : 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // the browser sets the multipart boundary itself
  }

  changeInflight(1);
  try {
    let response;
    try {
      response = await fetch(buildUrl(path, query), { method, headers, body, cache: 'no-store', credentials: 'same-origin' });
    } catch {
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: DEFAULT_MESSAGES[0] });
    }

    if (response.status === 401 && auth) {
      // expired/invalid token, or the account was locked/deleted meanwhile: show the server's reason on the login page
      const error = await toApiError(response);
      error.handled = true;
      redirectToLogin('expired', error.message);
      throw error;
    }
    if (!response.ok) throw await toApiError(response);
    if (raw) return response;
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? await response.json() : await response.text();
  } finally {
    changeInflight(-1);
  }
}

/* ---- downloads: fetch with Bearer -> blob -> object URL -> <a download> ---- */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return sanitizeFilename(decodeURIComponent(star[2].trim().replace(/^"(.*)"$/, '$1')));
    } catch {
      /* fall back to filename= */
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  if (plain) return sanitizeFilename((plain[1] ?? plain[2] ?? '').trim());
  return null;
}

function sanitizeFilename(name) {
  const clean = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return clean || null;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function download(path, query, fallbackName) {
  const response = await request(path, { query, raw: true });
  changeInflight(1);
  try {
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get('content-disposition')) || fallbackName;
    saveBlob(blob, filename);
    return filename;
  } finally {
    changeInflight(-1);
  }
}

const enc = encodeURIComponent;

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', json: { username, password }, auth: false }),
  me: () => request('/api/auth/me'),

  students: {
    list: ({ page, pageSize, q }) => request('/api/students', { query: { page, pageSize, q } }),
    get: (id) => request(`/api/students/${enc(id)}`),
    create: (formData) => request('/api/students', { method: 'POST', form: formData }),
    update: (id, formData) => request(`/api/students/${enc(id)}`, { method: 'PUT', form: formData }),
    remove: (id) => request(`/api/students/${enc(id)}`, { method: 'DELETE' }),
    bulkDelete: (ids) => request('/api/students/bulk-delete', { method: 'POST', json: { ids } }),
    bulkCopy: (ids) => request('/api/students/bulk-copy', { method: 'POST', json: { ids } }),
    importFile: (file) => {
      const formData = new FormData();
      formData.append('file', file, file.name);
      return request('/api/students/import', { method: 'POST', form: formData });
    },
    exportFile: (format, q) => download('/api/students/export', { format, q }, `sinh-vien.${format}`),
    template: (format) => download('/api/students/template', { format }, `mau-nhap-sinh-vien.${format}`),
  },

  users: {
    list: ({ page, pageSize, q }) => request('/api/users', { query: { page, pageSize, q } }),
    get: (id) => request(`/api/users/${enc(id)}`),
    create: (data) => request('/api/users', { method: 'POST', json: data }),
    update: (id, data) => request(`/api/users/${enc(id)}`, { method: 'PUT', json: data }),
    remove: (id) => request(`/api/users/${enc(id)}`, { method: 'DELETE' }),
  },

  roles: {
    list: () => request('/api/roles'),
    options: () => request('/api/roles/options'),
    get: (id) => request(`/api/roles/${enc(id)}`),
    create: (data) => request('/api/roles', { method: 'POST', json: data }),
    update: (id, data) => request(`/api/roles/${enc(id)}`, { method: 'PUT', json: data }),
    remove: (id) => request(`/api/roles/${enc(id)}`, { method: 'DELETE' }),
  },

  permissions: () => request('/api/permissions'),
};
