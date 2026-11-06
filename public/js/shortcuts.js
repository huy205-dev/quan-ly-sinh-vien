/**
 * Keyboard shortcuts (SPEC section 8).
 * - match on event.code (KeyN…) + altKey: on macOS Option changes event.key (Option+N -> "˜")
 * - while typing in an input/textarea/select only Alt+S (and native Esc) work
 * - while a dialog is open only Alt+S works (Esc is handled natively by <dialog>)
 * - views register the SAME action functions their buttons call; actions check permissions themselves
 */
import { html } from './html.js';
import { openModal, topModal } from './ui.js';
import { can } from './session.js';

export const SHORTCUTS = [
  { code: 'KeyN', keys: 'Alt+N', action: 'create', label: 'Thêm mới', note: 'Sinh viên, người dùng, vai trò' },
  { code: 'KeyS', keys: 'Alt+S', action: 'save', label: 'Lưu', note: 'Biểu mẫu đang mở / ma trận phân quyền', inInput: true, inModal: true, global: true },
  { code: 'KeyU', keys: 'Alt+U', action: 'edit', label: 'Sửa sinh viên đang chọn', note: 'Chọn đúng 1 dòng' },
  { code: 'KeyV', keys: 'Alt+V', action: 'view', label: 'Xem chi tiết sinh viên đang chọn', note: 'Chọn đúng 1 dòng' },
  { code: 'KeyX', keys: 'Alt+X', action: 'delete', label: 'Xóa sinh viên đang chọn', note: 'Một hoặc nhiều dòng, luôn hỏi xác nhận' },
  { code: 'KeyC', keys: 'Alt+C', action: 'copy', label: 'Sao chép sinh viên đang chọn', note: 'Một hoặc nhiều dòng' },
  { code: 'KeyQ', keys: 'Alt+Q', action: 'search', label: 'Tìm kiếm', note: 'Đưa con trỏ tới ô tìm kiếm' },
  { code: 'KeyI', keys: 'Alt+I', action: 'import', label: 'Nhập file', note: 'Excel (.xlsx), JSON, XML' },
  { code: 'KeyE', keys: 'Alt+E', action: 'export', label: 'Xuất file', note: 'Chọn định dạng xlsx / json / xml' },
  { code: 'KeyK', keys: 'Alt+K', action: 'columns', label: 'Cấu hình cột hiển thị', note: 'Lưu trên trình duyệt này' },
  { code: 'KeyH', keys: 'Alt+H', action: 'help', label: 'Danh sách phím tắt', note: 'Mở bảng này', global: true },
  { code: 'Escape', keys: 'Esc', action: 'close', label: 'Đóng hộp thoại', note: 'Hộp thoại đang mở', native: true, global: true },
];

const BY_CODE = new Map(SHORTCUTS.filter((s) => !s.native).map((s) => [s.code, s]));
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color']);

/** { action: { run: fn, permission?: code, label?: text } } registered by the current view. */
let viewHandlers = {};
let installed = false;

export function registerViewShortcuts(handlers) {
  viewHandlers = handlers || {};
  return () => {
    if (viewHandlers === handlers) viewHandlers = {};
  };
}

export function clearViewShortcuts() {
  viewHandlers = {};
}

function isTextEntry(element) {
  if (!(element instanceof Element)) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
  if (element.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(element.type);
  return false;
}

function resolveHandler(def) {
  const modal = topModal();
  if (def.action === 'save') return modal ? modal.onSave : viewHandlers.save?.run;
  if (modal) return null; // other shortcuts are disabled while a dialog is open
  if (def.action === 'help') return openShortcutHelp;
  return viewHandlers[def.action]?.run || null;
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.isComposing) return;
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const def = BY_CODE.get(event.code);
  if (!def) return;
  if (isTextEntry(event.target) && !def.inInput) return;
  const handler = resolveHandler(def);
  if (!handler) return;
  event.preventDefault(); // stop Option+key characters on macOS / browser menus on Windows
  event.stopPropagation();
  if (event.repeat) return;
  handler();
}

export function initShortcuts() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKeyDown);
}

function availability(def) {
  if (def.global) return { ok: true, text: 'Luôn dùng được' };
  const handler = viewHandlers[def.action];
  if (!handler) return { ok: false, text: 'Không dùng ở trang này' };
  if (handler.permission && !can(handler.permission)) return { ok: false, text: 'Không có quyền' };
  return { ok: true, text: handler.label || 'Dùng được' };
}

/** Help modal (Alt+H, "Phím tắt" button). */
export function openShortcutHelp() {
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  const rows = SHORTCUTS.map((def) => {
    const state = availability(def);
    const keys = def.keys.split('+');
    return html`<tr class="${state.ok ? '' : 'is-unavailable'}">
      <td class="shortcut-keys">${keys.map((key, i) => html`${i ? html`<span class="kbd-plus">+</span>` : ''}<kbd>${key}</kbd>`)}</td>
      <td><strong>${def.label}</strong><span class="shortcut-note">${def.note}</span></td>
      <td><span class="badge ${state.ok ? 'badge--success' : 'badge--muted'}">${state.text}</span></td>
    </tr>`;
  });
  openModal({
    title: 'Phím tắt bàn phím',
    size: 'md',
    closeOnBackdrop: true,
    body: html`<p class="muted">
        ${isMac ? html`Trên macOS dùng phím <kbd>Option ⌥</kbd> thay cho <kbd>Alt</kbd>. ` : ''}Khi con trỏ đang ở ô nhập liệu,
        chỉ <kbd>Alt</kbd>+<kbd>S</kbd> và <kbd>Esc</kbd> có tác dụng. Khi hộp thoại đang mở, chỉ dùng được <kbd>Alt</kbd>+<kbd>S</kbd> và <kbd>Esc</kbd>.
      </p>
      <div class="table-wrap table-wrap--plain">
        <table class="data-table shortcut-table">
          <thead><tr><th scope="col">Phím</th><th scope="col">Chức năng</th><th scope="col">Trạng thái</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`,
    footer: html`<button type="button" class="btn btn-primary" data-modal-close>Đã hiểu</button>`,
    initialFocus: '.modal__footer [data-modal-close]',
  });
}
