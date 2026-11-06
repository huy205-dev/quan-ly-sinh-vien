/**
 * UI helpers: toasts, modal dialogs (native <dialog>), confirm, busy states, error display.
 */
import { html, raw, setHtml, SafeHtml } from './html.js';
import { icon } from './icons.js';
import { can, forbiddenMessage, requestSessionRefresh } from './session.js';

/* ------------------------------------------------------------------ misc */

export function debounce(fn, wait) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export const spinner = () => raw('<span class="spinner" aria-hidden="true"></span>');

/** Disable a button and show a spinner while work is in progress. */
export function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (button.classList.contains('is-busy')) return;
    button.dataset.wasDisabled = button.disabled ? '1' : '';
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
  } else {
    if (!button.classList.contains('is-busy')) return;
    button.disabled = button.dataset.wasDisabled === '1';
    delete button.dataset.wasDisabled;
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
  }
}

/* ---------------------------------------------------------------- modals */

const modalStack = [];
let modalSeq = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function fill(element, content) {
  if (content instanceof Node) element.replaceChildren(content);
  else setHtml(element, content instanceof SafeHtml ? content : html`${content ?? ''}`);
}

export const topModal = () => modalStack[modalStack.length - 1] || null;
export const hasOpenModal = () => modalStack.length > 0;

export function closeAllModals() {
  [...modalStack].reverse().forEach((modal) => modal.close());
}

/**
 * Open an accessible modal dialog.
 * Esc closes it natively (<dialog> cancel event); focus moves inside and is restored on close.
 * @returns handle { dialog, body, footer, close(value), setBusy(bool), setTitle(text), isClosed(), closed: Promise }
 */
export function openModal({
  title,
  body,
  footer,
  size = 'md',
  className = '',
  onSave = null,
  onClose = null,
  initialFocus = null,
  closeOnBackdrop = false,
  role = 'dialog',
} = {}) {
  const id = `modal-${(modalSeq += 1)}`;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = `modal modal--${size} ${className}`.trim();
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  if (role !== 'dialog') dialog.setAttribute('role', role);
  setHtml(
    dialog,
    html`<div class="modal__panel">
      <header class="modal__header">
        <h2 class="modal__title" id="${id}-title">${title}</h2>
        <button type="button" class="btn-icon modal__close" data-modal-close aria-label="Đóng (Esc)" title="Đóng (Esc)">${icon('x')}</button>
      </header>
      <div class="modal__body" id="${id}-body"></div>
      <footer class="modal__footer" hidden></footer>
    </div>`,
  );
  const bodyEl = dialog.querySelector('.modal__body');
  const footerEl = dialog.querySelector('.modal__footer');
  fill(bodyEl, body);
  if (footer) {
    fill(footerEl, footer);
    footerEl.hidden = false;
  }

  let closed = false;
  let result;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  const handle = {
    id,
    dialog,
    body: bodyEl,
    footer: footerEl,
    onSave,
    busy: false,
    closed: closedPromise,
    isClosed: () => closed,
    close(value) {
      if (closed) return;
      result = value;
      if (dialog.open) dialog.close();
      finalize();
    },
    setBusy(busy) {
      handle.busy = Boolean(busy);
      dialog.classList.toggle('is-busy', handle.busy);
      dialog.querySelectorAll('[data-modal-close]').forEach((button) => {
        button.disabled = handle.busy;
      });
    },
    setTitle(text) {
      dialog.querySelector('.modal__title').textContent = text;
    },
    setFooter(content) {
      fill(footerEl, content);
      footerEl.hidden = !content;
    },
  };

  function finalize() {
    if (closed) return;
    closed = true;
    const index = modalStack.indexOf(handle);
    if (index >= 0) modalStack.splice(index, 1);
    dialog.remove();
    syncToastHost();
    if (opener && opener.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    else topModal()?.dialog.querySelector(FOCUSABLE)?.focus();
    try {
      onClose?.(result);
    } finally {
      resolveClosed(result);
    }
  }

  /*
   * Esc fires `cancel`: close it ourselves, synchronously, so the modal stack is correct immediately
   * (Chromium only dispatches the `close` event at the next animation frame). While saving, keep it open.
   * `close` and `toggle` (newState = closed) remain as fallbacks for any other way the dialog gets closed.
   */
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!handle.busy) handle.close();
  });
  dialog.addEventListener('close', finalize);
  dialog.addEventListener('toggle', (event) => {
    if (event.newState === 'closed') finalize();
  });
  dialog.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-modal-close]');
    if (closer && dialog.contains(closer)) {
      if (!handle.busy) handle.close();
      return;
    }
    if (closeOnBackdrop && event.target === dialog && !handle.busy) handle.close();
  });

  document.body.append(dialog);
  modalStack.push(handle);
  dialog.showModal();
  syncToastHost();

  const target = typeof initialFocus === 'string' ? dialog.querySelector(initialFocus) : initialFocus;
  (target || bodyEl.querySelector(FOCUSABLE) || dialog.querySelector('[data-modal-close]'))?.focus();
  return handle;
}

/** Promise<boolean>. Danger dialogs focus "Hủy" first (least destructive action). */
export function confirmDialog({
  title = 'Xác nhận',
  message,
  details = '',
  confirmText = 'Đồng ý',
  cancelText = 'Hủy',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      size: 'sm',
      role: 'alertdialog',
      className: 'modal--confirm',
      body: html`<div class="confirm">
        <div class="confirm__icon ${danger ? 'confirm__icon--danger' : ''}">${icon(danger ? 'alert' : 'info', { size: 22 })}</div>
        <div class="confirm__text"><p class="confirm__message">${message}</p>${details}</div>
      </div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-confirm="no">${cancelText}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="yes">${confirmText}</button>`,
      initialFocus: danger ? '[data-confirm="no"]' : '[data-confirm="yes"]',
      onClose: (value) => resolve(value === true),
    });
    modal.dialog.setAttribute('aria-describedby', modal.body.id);
    modal.footer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (button) modal.close(button.dataset.confirm === 'yes');
    });
  });
}

/* ---------------------------------------------------------------- toasts */

const TOAST_ICONS = { success: 'checkCircle', error: 'errorCircle', warning: 'alert', info: 'info' };
let toastRegion = null;

function getToastRegion() {
  if (!toastRegion) {
    toastRegion = document.getElementById('toast-region');
    if (!toastRegion) {
      toastRegion = document.createElement('div');
      toastRegion.id = 'toast-region';
    }
    toastRegion.className = 'toast-region';
  }
  syncToastHost();
  return toastRegion;
}

/* A modal <dialog> sits in the top layer and makes the page inert, so toasts live in the top-most dialog. */
function syncToastHost() {
  if (!toastRegion) return;
  const host = topModal()?.dialog || document.body;
  if (toastRegion.parentElement !== host) host.append(toastRegion);
}

export function toast(message, type = 'info', { timeout } = {}) {
  const region = getToastRegion();
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  setHtml(
    item,
    html`<span class="toast__icon">${icon(TOAST_ICONS[type] || 'info', { size: 20 })}</span>
      <div class="toast__message">${message}</div>
      <button type="button" class="toast__close btn-icon" aria-label="Đóng thông báo">${icon('x', { size: 16 })}</button>`,
  );
  region.append(item);
  while (region.children.length > 4) region.firstElementChild.remove();

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 180);
  };
  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  };
  schedule(timeout ?? (type === 'error' ? 6000 : 3500));
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => schedule(2000));
  item.querySelector('.toast__close').addEventListener('click', dismiss);
  return dismiss;
}

/* ----------------------------------------------------------- error / perms */

export function showError(error, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại.') {
  if (!error || error.handled) return;
  if (error.name !== 'ApiError') {
    console.error(error); // programming error: keep it visible for debugging
    toast(fallback, 'error');
    return;
  }
  if (error.status === 403 && error.code !== 'ACCOUNT_LOCKED') {
    toast(forbiddenMessage(error.permission, error.message), 'error');
    requestSessionRefresh(); // permissions may have changed on the server
    return;
  }
  toast(error.message || fallback, 'error');
}

/** Client-side permission guard shared by buttons and keyboard shortcuts. */
export function requirePermission(code) {
  if (can(code)) return true;
  toast(forbiddenMessage(code), 'error');
  return false;
}

/** Small reusable kbd hint, e.g. kbdHint('Alt+N'). */
export function kbdHint(keys, className = '') {
  return html`<kbd class="${className}">${keys}</kbd>`;
}
