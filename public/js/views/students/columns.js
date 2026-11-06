/**
 * Student table columns + show/hide configuration stored in localStorage['qlsv.students.columns.v1']
 * as { [columnKey]: boolean }. Unknown / missing keys fall back to the defaults.
 */
import { html, safeUploadSrc } from '../../html.js';
import { formatDate, formatDateTime, formatGpa, studentCode, initials, colorSlot } from '../../format.js';
import { openModal, toast } from '../../ui.js';
import { icon } from '../../icons.js';

export const COLUMNS_STORAGE_KEY = 'qlsv.students.columns.v1';

export function avatarTemplate(student, size = 'sm') {
  const src = safeUploadSrc(student.PathImage);
  const text = initials(student.FullName);
  if (src) {
    return html`<img class="avatar avatar--${size}" src="${src}" alt="Ảnh của ${student.FullName}" loading="lazy" decoding="async" data-initials="${text}">`;
  }
  return html`<span class="avatar avatar--${size} avatar--c${colorSlot(student.StudentID ?? student.FullName)}" role="img" aria-label="Chưa có ảnh">${text}</span>`;
}

const td = (value, className = '') => html`<td class="${className}">${value === '' || value == null ? html`<span class="muted">—</span>` : value}</td>`;

function gpaClass(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (n >= 3.6) return 'gpa gpa--excellent';
  if (n >= 3.2) return 'gpa gpa--good';
  if (n >= 2.0) return 'gpa';
  return 'gpa gpa--low';
}

export const COLUMNS = [
  { key: 'code', label: 'Mã SV', defaultVisible: true, className: 'col-code', cell: (s) => html`<td class="col-code"><span class="code">${s.StudentCode || studentCode(s.StudentID)}</span></td>` },
  { key: 'image', label: 'Ảnh', defaultVisible: true, className: 'col-image', cell: (s) => html`<td class="col-image">${avatarTemplate(s)}</td>` },
  { key: 'fullName', label: 'Họ tên', defaultVisible: true, className: 'col-name', cell: (s) => html`<th scope="row" class="col-name">${s.FullName}</th>` },
  { key: 'gender', label: 'Giới tính', defaultVisible: true, className: 'col-gender', cell: (s) => td(s.Gender, 'col-gender') },
  { key: 'dob', label: 'Ngày sinh', defaultVisible: true, className: 'col-date', cell: (s) => td(formatDate(s.DateOfBirth), 'col-date') },
  { key: 'className', label: 'Lớp', defaultVisible: true, className: 'col-class', cell: (s) => td(s.ClassName, 'col-class') },
  { key: 'major', label: 'Ngành', defaultVisible: true, className: 'col-major', cell: (s) => td(s.Major, 'col-major') },
  { key: 'email', label: 'Email', defaultVisible: false, className: 'col-email', cell: (s) => td(s.Email, 'col-email') },
  { key: 'phone', label: 'SĐT', defaultVisible: false, className: 'col-phone', cell: (s) => td(s.Phone, 'col-phone') },
  { key: 'address', label: 'Địa chỉ', defaultVisible: false, className: 'col-wrap', cell: (s) => td(s.Address, 'col-wrap') },
  {
    key: 'gpa',
    label: 'GPA',
    defaultVisible: true,
    className: 'col-num',
    cell: (s) => td(s.GPA == null ? '' : html`<span class="${gpaClass(s.GPA)}">${formatGpa(s.GPA)}</span>`, 'col-num'),
  },
  {
    key: 'description',
    label: 'Ghi chú',
    defaultVisible: false,
    className: 'col-wrap',
    cell: (s) => (s.Description ? html`<td class="col-wrap"><span class="clamp-2" title="${s.Description}">${s.Description}</span></td>` : td('', 'col-wrap')),
  },
  { key: 'createDate', label: 'Ngày tạo', defaultVisible: false, className: 'col-datetime', cell: (s) => td(formatDateTime(s.CreateDate), 'col-datetime') },
  { key: 'updateDate', label: 'Ngày cập nhật', defaultVisible: false, className: 'col-datetime', cell: (s) => td(formatDateTime(s.UpdateDate), 'col-datetime') },
];

export function defaultColumnPrefs() {
  return Object.fromEntries(COLUMNS.map((column) => [column.key, column.defaultVisible]));
}

export function loadColumnPrefs() {
  const prefs = defaultColumnPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const column of COLUMNS) if (typeof saved[column.key] === 'boolean') prefs[column.key] = saved[column.key];
    }
  } catch {
    /* corrupted or unavailable storage: use defaults */
  }
  return Object.values(prefs).some(Boolean) ? prefs : defaultColumnPrefs();
}

export function saveColumnPrefs(prefs) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function resetColumnPrefs() {
  try {
    localStorage.removeItem(COLUMNS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return defaultColumnPrefs();
}

export function visibleColumns(prefs) {
  return COLUMNS.filter((column) => prefs[column.key]);
}

/** Column config modal (Alt+K). Changes apply immediately and are saved. */
export function openColumnConfig({ prefs, onChange }) {
  let current = { ...prefs };
  const listTemplate = () =>
    html`${COLUMNS.map(
      (column) => html`<li><label class="check">
        <input type="checkbox" data-col="${column.key}" ${current[column.key] ? 'checked' : ''}>
        <span>${column.label}</span>${column.defaultVisible ? '' : html`<span class="badge badge--muted">Ẩn mặc định</span>`}
      </label></li>`,
    )}`;

  const modal = openModal({
    title: 'Cấu hình cột hiển thị',
    size: 'sm',
    closeOnBackdrop: true,
    body: html`<p class="muted">Chọn các cột hiển thị trong bảng sinh viên. Thiết lập được lưu trên trình duyệt này
        và không ảnh hưởng tới dữ liệu khi xuất file.</p>
      <ul class="column-list" data-role="column-list">${listTemplate()}</ul>`,
    footer: html`<button type="button" class="btn btn-ghost" data-role="reset">${icon('undo')} Khôi phục mặc định</button>
      <button type="button" class="btn btn-primary" data-modal-close>Xong</button>`,
  });

  const list = modal.body.querySelector('[data-role="column-list"]');
  list.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-col]');
    if (!checkbox) return;
    const next = { ...current, [checkbox.dataset.col]: checkbox.checked };
    if (!Object.values(next).some(Boolean)) {
      checkbox.checked = true;
      toast('Cần hiển thị ít nhất một cột.', 'warning');
      return;
    }
    current = next;
    saveColumnPrefs(current);
    onChange({ ...current });
  });
  modal.footer.querySelector('[data-role="reset"]').addEventListener('click', () => {
    current = resetColumnPrefs();
    list.querySelectorAll('input[data-col]').forEach((checkbox) => {
      checkbox.checked = Boolean(current[checkbox.dataset.col]);
    });
    onChange({ ...current });
    toast('Đã khôi phục các cột mặc định.', 'success');
  });
  return modal;
}
