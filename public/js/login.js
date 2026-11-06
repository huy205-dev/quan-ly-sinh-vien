/**
 * Login page: POST /api/auth/login, store { token, user, permissions } in localStorage['qlsv.session'], go to /.
 */
import { api } from './api.js';
import { getSession, saveSession, LOGIN_NOTICE_KEY } from './session.js';
import { setHtml } from './html.js';
import { icon } from './icons.js';

if (getSession()) window.location.replace('/');

const form = document.getElementById('login-form');
const alertBox = document.getElementById('login-alert');
const usernameInput = form.elements.username;
const passwordInput = form.elements.password;
const submitButton = form.querySelector('[type="submit"]');
const toggleButton = document.getElementById('toggle-password');
const capsHint = document.getElementById('password-caps');

function showAlert(message, type = 'error') {
  alertBox.className = `alert alert--${type}`;
  alertBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
  alertBox.textContent = message;
  alertBox.hidden = !message;
}

function setError(input, message) {
  const errorEl = document.getElementById(`${input.id}-error`);
  input.closest('.field')?.classList.toggle('has-error', Boolean(message));
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }
}

function setSubmitting(busy) {
  submitButton.disabled = busy;
  submitButton.classList.toggle('is-busy', busy);
  submitButton.setAttribute('aria-busy', String(busy));
}

function takeNotice() {
  try {
    const notice = sessionStorage.getItem(LOGIN_NOTICE_KEY);
    sessionStorage.removeItem(LOGIN_NOTICE_KEY);
    return notice;
  } catch {
    return null;
  }
}

const reason = new URLSearchParams(window.location.search).get('reason');
const notice = takeNotice(); // e.g. "Tài khoản đã bị khóa…" from the 401 that ended the session
if (reason === 'expired') showAlert(notice || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', notice ? 'warning' : 'info');
else if (reason === 'logout') showAlert('Bạn đã đăng xuất.', 'success');

document.querySelectorAll('[data-demo-username]').forEach((button) => {
  button.addEventListener('click', () => {
    usernameInput.value = button.dataset.demoUsername;
    passwordInput.value = button.dataset.demoPassword;
    setError(usernameInput, '');
    setError(passwordInput, '');
    showAlert('');
    submitButton.focus();
  });
});

toggleButton.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  toggleButton.setAttribute('aria-pressed', String(show));
  toggleButton.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  setHtml(toggleButton, icon(show ? 'eyeOff' : 'eye', { size: 18 }));
});

const updateCapsHint = (event) => {
  if (typeof event.getModifierState === 'function') capsHint.hidden = !event.getModifierState('CapsLock');
};
passwordInput.addEventListener('keydown', updateCapsHint);
passwordInput.addEventListener('keyup', updateCapsHint);
passwordInput.addEventListener('blur', () => {
  capsHint.hidden = true;
});

[usernameInput, passwordInput].forEach((input) => input.addEventListener('input', () => setError(input, '')));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showAlert('');
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  setError(usernameInput, username ? '' : 'Vui lòng nhập tên đăng nhập.');
  setError(passwordInput, password ? '' : 'Vui lòng nhập mật khẩu.');
  if (!username || !password) {
    (username ? passwordInput : usernameInput).focus();
    return;
  }

  setSubmitting(true);
  try {
    const result = await api.login(username, password);
    if (!result?.token) throw new Error('missing token');
    saveSession({ token: result.token, user: result.user, permissions: result.permissions });
    window.location.replace('/');
  } catch (error) {
    showAlert(error?.name === 'ApiError' ? error.message : 'Đăng nhập thất bại. Vui lòng thử lại.', 'error');
    passwordInput.select();
    passwordInput.focus();
    setSubmitting(false);
  }
});
