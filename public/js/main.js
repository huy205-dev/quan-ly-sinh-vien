/**
 * SPA shell: session check, /api/auth/me refresh, header + permission-aware nav, hash router.
 * Routes: #/students (default), #/users, #/roles.
 */
import { api, onBusyChange } from './api.js';
import { html, setHtml } from './html.js';
import { icon } from './icons.js';
import {
  getSession,
  getUser,
  getPermissions,
  updateSession,
  clearSession,
  can,
  SESSION_KEY,
  SESSION_REFRESH_EVENT,
  PERMISSION_PHRASES,
} from './session.js';
import { toast, showError, closeAllModals, debounce } from './ui.js';
import { initShortcuts, clearViewShortcuts } from './shortcuts.js';
import { initials, colorSlot } from './format.js';
import { mountStudents } from './views/students/index.js';
import { mountUsers } from './views/users.js';
import { mountRoles } from './views/roles.js';

const APP_TITLE = 'Quản lý sinh viên';

const ROUTES = [
  { name: 'students', label: 'Sinh viên', icon: 'student', permission: 'student.read', mount: mountStudents },
  { name: 'users', label: 'Người dùng', icon: 'users', permission: 'user.read', mount: mountUsers },
  { name: 'roles', label: 'Vai trò & phân quyền', icon: 'shield', permission: 'role.read', mount: mountRoles },
];

const els = {
  nav: document.getElementById('main-nav'),
  userBox: document.getElementById('user-box'),
  view: document.getElementById('view'),
  main: document.getElementById('main'),
};

const current = { name: null, unmount: null };
let permissionKey = '';

const permissionsKeyOf = (permissions) => [...permissions].sort().join(',');
const routeFromHash = () => /^#\/([\w-]+)/.exec(window.location.hash)?.[1] || '';
const firstAllowedRoute = () => ROUTES.find((route) => can(route.permission)) || null;

/* ------------------------------------------------------------------ header */

function renderHeader() {
  const user = getUser();
  const active = current.name;
  setHtml(
    els.nav,
    html`${ROUTES.filter((route) => can(route.permission)).map(
      (route) => html`<a class="nav-link ${route.name === active ? 'is-active' : ''}" href="#/${route.name}" title="${route.label}"
        ${route.name === active ? html`aria-current="page"` : ''}>${icon(route.icon, { size: 18 })}<span class="nav-link__label">${route.label}</span></a>`,
    )}`,
  );
  const name = user?.FullName || user?.Username || '';
  setHtml(
    els.userBox,
    html`<div class="user-chip" title="${name}${user?.RoleName ? ` — ${user.RoleName}` : ''}">
        <span class="avatar avatar--sm avatar--c${colorSlot(user?.Username)}" aria-hidden="true">${initials(name)}</span>
        <span class="user-chip__text"><strong>${name}</strong><small>${user?.RoleName || user?.RoleCode || ''}</small></span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="logout" title="Đăng xuất">
        ${icon('logout', { size: 16 })}<span class="btn__label">Đăng xuất</span>
      </button>`,
  );
}

/* ------------------------------------------------------------------ router */

function unmountCurrent() {
  closeAllModals();
  clearViewShortcuts();
  try {
    current.unmount?.();
  } catch (error) {
    console.error(error);
  }
  current.unmount = null;
}

function showNoAccess(route) {
  const fallback = firstAllowedRoute();
  setHtml(
    els.view,
    html`<section class="card no-access">
      ${icon('lock', { size: 36 })}
      <h1 class="page-title" tabindex="-1">${route ? `Bạn không có quyền truy cập “${route.label}”` : 'Tài khoản chưa được cấp quyền'}</h1>
      <p class="muted">${route
        ? `Trang này yêu cầu quyền ${PERMISSION_PHRASES[route.permission] || route.permission}. Vui lòng liên hệ quản trị viên nếu bạn cần truy cập.`
        : 'Tài khoản của bạn chưa được cấp quyền truy cập chức năng nào. Vui lòng liên hệ quản trị viên.'}</p>
      ${fallback && fallback !== route ? html`<a class="btn btn-primary" href="#/${fallback.name}">Về trang ${fallback.label}</a>` : ''}
    </section>`,
  );
}

function navigate({ force = false, focus = false } = {}) {
  let route = ROUTES.find((item) => item.name === routeFromHash());
  if (!route) {
    route = firstAllowedRoute();
    if (route) window.history.replaceState(null, '', `#/${route.name}`);
  }
  if (!force && route && current.name === route.name && current.unmount) {
    renderHeader();
    return;
  }
  unmountCurrent();
  current.name = route?.name ?? null;
  renderHeader();
  document.title = route ? `${route.label} · ${APP_TITLE}` : APP_TITLE;
  if (!route || !can(route.permission)) {
    showNoAccess(route);
  } else {
    // A fresh container per mount: listeners a view attached to its root die with it (no leaks across views).
    const viewRoot = document.createElement('div');
    viewRoot.className = `view-root view-root--${route.name}`;
    els.view.replaceChildren(viewRoot);
    current.unmount = route.mount(viewRoot) || null;
  }
  if (focus) els.view.querySelector('.page-title')?.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ session */

async function refreshSession() {
  try {
    const me = await api.me();
    updateSession({ user: me?.user ?? getUser(), permissions: Array.isArray(me?.permissions) ? me.permissions : [] });
  } catch (error) {
    if (!error.handled && error.status !== 403) showError(error, 'Không thể làm mới thông tin đăng nhập.');
    return;
  }
  const nextKey = permissionsKeyOf(getPermissions());
  if (nextKey !== permissionKey) {
    permissionKey = nextKey;
    toast('Quyền của bạn vừa được cập nhật.', 'info');
    navigate({ force: true });
  } else {
    renderHeader();
  }
}

function logout() {
  clearSession();
  window.location.replace('/login.html?reason=logout');
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (!getSession()) {
    window.location.replace('/login.html');
    return;
  }

  initShortcuts();
  onBusyChange((busy) => document.documentElement.classList.toggle('is-busy', busy));

  els.userBox.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="logout"]')) logout();
  });
  document.querySelector('[data-skip-link]')?.addEventListener('click', (event) => {
    event.preventDefault(); // keep the hash route intact
    els.main.focus();
  });
  window.addEventListener('storage', (event) => {
    if ((event.key === SESSION_KEY || event.key === null) && !getSession()) window.location.replace('/login.html');
  });
  window.addEventListener(SESSION_REFRESH_EVENT, debounce(refreshSession, 300));

  renderHeader();
  try {
    const me = await api.me();
    updateSession({ user: me?.user ?? getUser(), permissions: Array.isArray(me?.permissions) ? me.permissions : [] });
  } catch (error) {
    if (error.handled) return; // 401: already redirected to /login.html
    showError(error, 'Không thể làm mới thông tin đăng nhập; đang dùng thông tin đã lưu.');
  }
  permissionKey = permissionsKeyOf(getPermissions());
  document.body.classList.remove('is-booting');

  window.addEventListener('hashchange', () => navigate({ focus: true }));
  navigate();
}

boot();
