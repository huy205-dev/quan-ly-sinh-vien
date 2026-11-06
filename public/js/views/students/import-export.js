/**
 * Import (POST /api/students/import, multipart `file`) and export (GET /api/students/export) modals.
 */
import { api } from '../../api.js';
import { html, setHtml } from '../../html.js';
import { icon } from '../../icons.js';
import { openModal, toast, showError, setBusy } from '../../ui.js';
import { formatFileSize, formatNumber } from '../../format.js';

const IMPORT_EXTENSIONS = ['xlsx', 'json', 'xml'];
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_ROWS = 500;
const EXPORT_FORMAT_KEY = 'qlsv.students.exportFormat';

export const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx)', desc: 'Mở bằng Microsoft Excel, LibreOffice, Google Sheets.' },
  { value: 'json', label: 'JSON (.json)', desc: 'Dữ liệu có cấu trúc, tiện cho lập trình.' },
  { value: 'xml', label: 'XML (.xml)', desc: 'Trao đổi dữ liệu giữa các hệ thống.' },
];

const FIELD_LABELS = {
  FullName: 'Họ tên',
  PathImage: 'Ảnh',
  Gender: 'Giới tính',
  DateOfBirth: 'Ngày sinh',
  ClassName: 'Lớp',
  Major: 'Ngành',
  Email: 'Email',
  Phone: 'SĐT',
  Address: 'Địa chỉ',
  GPA: 'GPA',
  Description: 'Ghi chú',
};

const extensionOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

/* ------------------------------------------------------------------ import */

export function openImportModal({ onImported } = {}) {
  let file = null;
  let busy = false;

  const modal = openModal({
    title: 'Nhập sinh viên từ file',
    size: 'lg',
    body: html`<form class="form" id="import-form" novalidate>
      <div class="dropzone" data-role="dropzone">
        <span class="dropzone__icon">${icon('upload', { size: 28 })}</span>
        <p><strong>Kéo thả tệp vào đây</strong> hoặc
          <button type="button" class="btn btn-secondary btn-sm" data-role="pick">Chọn tệp…</button></p>
        <p class="muted">Hỗ trợ .xlsx, .json, .xml · tối đa 10 MB và 1000 dòng · chỉ thêm mới, không ghi đè.</p>
        <input type="file" name="file" accept=".xlsx,.json,.xml" data-role="file" hidden>
        <div class="file-chip" data-role="chip" hidden></div>
      </div>
      <div class="template-links">
        <span class="muted">Tải file mẫu:</span>
        ${FORMATS.map(
          (format) => html`<button type="button" class="btn btn-ghost btn-sm" data-template="${format.value}">${icon('download', { size: 16 })} ${format.label}</button>`,
        )}
      </div>
      <p class="muted small">Cột cần có: FullName, Gender (Nam/Nữ/Khác), DateOfBirth (YYYY-MM-DD), ClassName, Major; tùy chọn: PathImage, Email,
        Phone, Address, GPA, Description. Nếu có bất kỳ lỗi nào, toàn bộ tệp sẽ không được nhập.</p>
      <div class="import-result" data-role="result" aria-live="polite"></div>
    </form>`,
    footer: html`<span class="modal__hint"><kbd>Alt</kbd>+<kbd>S</kbd> nhập · <kbd>Esc</kbd> đóng</span>
      <button type="button" class="btn btn-secondary" data-modal-close>Đóng</button>
      <button type="submit" class="btn btn-primary" form="import-form" data-role="submit" disabled>${icon('upload', { size: 16 })} Nhập dữ liệu</button>`,
    onSave: () => modal.body.querySelector('form')?.requestSubmit(),
    initialFocus: '[data-role="pick"]',
  });

  const form = modal.body.querySelector('form');
  const fileInput = form.querySelector('[data-role="file"]');
  const dropzone = form.querySelector('[data-role="dropzone"]');
  const chip = form.querySelector('[data-role="chip"]');
  const result = form.querySelector('[data-role="result"]');
  const submitButton = modal.footer.querySelector('[data-role="submit"]');

  function showResult(content) {
    setHtml(result, content);
  }

  function chooseFile(candidate) {
    showResult('');
    if (!candidate) return;
    const ext = extensionOf(candidate.name);
    if (!IMPORT_EXTENSIONS.includes(ext)) {
      showResult(html`<div class="alert alert--error" role="alert">Tệp “${candidate.name}” không được hỗ trợ. Chỉ nhận .xlsx, .json hoặc .xml.</div>`);
      return;
    }
    if (candidate.size > MAX_IMPORT_BYTES) {
      showResult(html`<div class="alert alert--error" role="alert">Tệp quá lớn (${formatFileSize(candidate.size)}). Kích thước tối đa là 10 MB.</div>`);
      return;
    }
    file = candidate;
    setHtml(
      chip,
      html`${icon('file', { size: 18 })}<span class="file-chip__name">${file.name}</span><span class="muted">${formatFileSize(file.size)}</span>
        <button type="button" class="btn-icon" data-role="clear-file" aria-label="Bỏ chọn tệp ${file.name}">${icon('x', { size: 16 })}</button>`,
    );
    chip.hidden = false;
    submitButton.disabled = false;
  }

  function clearFile() {
    file = null;
    fileInput.value = '';
    chip.hidden = true;
    submitButton.disabled = true;
    showResult('');
    form.querySelector('[data-role="pick"]').focus();
  }

  form.querySelector('[data-role="pick"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => chooseFile(fileInput.files?.[0] || null));
  chip.addEventListener('click', (event) => {
    if (event.target.closest('[data-role="clear-file"]')) clearFile();
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    chooseFile(event.dataTransfer?.files?.[0] || null);
  });

  form.querySelectorAll('[data-template]').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true);
      try {
        const filename = await api.students.template(button.dataset.template);
        toast(`Đã tải xuống file mẫu ${filename}.`, 'success');
      } catch (error) {
        showError(error, 'Không tải được file mẫu.');
      } finally {
        setBusy(button, false);
      }
    });
  });

  function errorTable(details) {
    const shown = details.slice(0, MAX_ERROR_ROWS);
    return html`<div class="alert alert--error" role="alert">
        <strong>Tệp có ${formatNumber(details.length)} lỗi.</strong> Không có sinh viên nào được nhập — vui lòng sửa các lỗi dưới đây rồi thử lại.
      </div>
      <div class="table-wrap table-wrap--compact">
        <table class="data-table error-table">
          <caption class="sr-only">Danh sách lỗi khi nhập file</caption>
          <thead><tr><th scope="col">Dòng</th><th scope="col">Trường</th><th scope="col">Lỗi</th></tr></thead>
          <tbody>
            ${shown.map(
              (detail) => html`<tr>
                <td class="col-num">${detail.row ?? '—'}</td>
                <td>${detail.field ? html`<code>${detail.field}</code>${FIELD_LABELS[detail.field] ? html` <span class="muted">(${FIELD_LABELS[detail.field]})</span>` : ''}` : html`<span class="muted">—</span>`}</td>
                <td>${detail.message}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${details.length > shown.length ? html`<p class="muted small">… và ${formatNumber(details.length - shown.length)} lỗi khác.</p>` : ''}`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      showResult(html`<div class="alert alert--warning" role="alert">Vui lòng chọn tệp .xlsx, .json hoặc .xml để nhập.</div>`);
      return;
    }
    busy = true;
    modal.setBusy(true);
    setBusy(submitButton, true);
    showResult(html`<p class="muted">Đang kiểm tra và nhập dữ liệu…</p>`);
    try {
      const response = await api.students.importFile(file);
      const imported = Number(response?.imported) || 0;
      modal.close(true);
      toast(`Đã nhập thành công ${formatNumber(imported)} sinh viên.`, 'success');
      onImported?.(response);
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR' && error.details.length) {
        showResult(errorTable(error.details));
      } else if (error.name === 'ApiError' && error.status !== 403) {
        showResult(html`<div class="alert alert--error" role="alert">${error.message}</div>`);
      } else {
        showResult('');
        showError(error, 'Không thể nhập file.');
      }
    } finally {
      busy = false;
      if (!modal.isClosed()) {
        modal.setBusy(false);
        setBusy(submitButton, false);
      }
    }
  });

  return modal;
}

/* ------------------------------------------------------------------ export */

function readLastFormat() {
  try {
    const saved = localStorage.getItem(EXPORT_FORMAT_KEY);
    return FORMATS.some((format) => format.value === saved) ? saved : 'xlsx';
  } catch {
    return 'xlsx';
  }
}

export function openExportModal({ q = '', total = 0 } = {}) {
  const last = readLastFormat();
  const scope = q
    ? html`Xuất <strong>toàn bộ ${formatNumber(total)}</strong> sinh viên khớp với từ khóa “<strong>${q}</strong>” (tất cả các trang).`
    : html`Xuất <strong>toàn bộ ${formatNumber(total)}</strong> sinh viên (tất cả các trang).`;

  const modal = openModal({
    title: 'Xuất danh sách sinh viên',
    size: 'sm',
    body: html`<form class="form" id="export-form" novalidate>
      <fieldset class="option-list">
        <legend class="field__label">Định dạng tệp</legend>
        ${FORMATS.map(
          (format) => html`<label class="option">
            <input type="radio" name="format" value="${format.value}" ${format.value === last ? 'checked' : ''}>
            <span class="option__body"><span class="option__title">${format.label}</span><span class="option__desc">${format.desc}</span></span>
          </label>`,
        )}
      </fieldset>
      <p class="muted small">${scope} Tệp luôn có đầy đủ các cột, không phụ thuộc cấu hình cột hiển thị, và có thể nhập lại.</p>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-modal-close>Hủy</button>
      <button type="submit" class="btn btn-primary" form="export-form" data-role="submit" aria-keyshortcuts="Alt+S">${icon('download', { size: 16 })} Xuất file</button>`,
    onSave: () => modal.body.querySelector('form')?.requestSubmit(),
    initialFocus: 'input[name="format"]:checked',
  });

  const form = modal.body.querySelector('form');
  const submitButton = modal.footer.querySelector('[data-role="submit"]');
  let busy = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const format = form.querySelector('input[name="format"]:checked')?.value || 'xlsx';
    busy = true;
    modal.setBusy(true);
    setBusy(submitButton, true);
    try {
      const filename = await api.students.exportFile(format, q);
      try {
        localStorage.setItem(EXPORT_FORMAT_KEY, format);
      } catch {
        /* ignore */
      }
      modal.close(true);
      toast(`Đã xuất tệp ${filename}.`, 'success');
    } catch (error) {
      showError(error, 'Không thể xuất file.');
    } finally {
      busy = false;
      if (!modal.isClosed()) {
        modal.setBusy(false);
        setBusy(submitButton, false);
      }
    }
  });

  return modal;
}
