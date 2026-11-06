/**
 * Create / update student modal (multipart FormData: text fields + optional `image`, `removeImage=1`).
 */
import { api } from '../../api.js';
import { html, setHtml, safeUploadSrc } from '../../html.js';
import { icon } from '../../icons.js';
import { openModal, toast, showError, setBusy } from '../../ui.js';
import { field, describedBy, showFieldErrors, setFieldError, detailsToErrors, setFormAlert } from '../../forms.js';
import { formatDateTime, formatFileSize, formatGpa, todayYmd } from '../../format.js';
import { GENDERS, MIN_DOB, validateStudent, validateImageFile } from './validation.js';

const MAJOR_SUGGESTIONS = [
  'Công nghệ thông tin',
  'Kỹ thuật phần mềm',
  'Hệ thống thông tin',
  'Khoa học máy tính',
  'An toàn thông tin',
  'Quản trị kinh doanh',
  'Kế toán',
  'Tài chính – Ngân hàng',
  'Marketing',
  'Ngôn ngữ Anh',
];

/* Server detail fields that belong to the image picker. */
const FIELD_ALIASES = { PathImage: 'image', removeImage: 'image', file: 'image' };
const TEXT_FIELDS = ['FullName', 'DateOfBirth', 'ClassName', 'Major', 'Email', 'Phone', 'Address', 'GPA', 'Description'];

let formSeq = 0;

/**
 * @param {{ student?: object|null, onSaved?: (student) => void, onNotFound?: () => void }} options
 */
export function openStudentForm({ student = null, onSaved, onNotFound } = {}) {
  const isEdit = Boolean(student);
  const prefix = `sf${(formSeq += 1)}`;
  const id = (name) => `${prefix}-${name}`;
  const today = todayYmd();
  const value = (name) => (student && student[name] != null ? student[name] : '');
  const existingImage = safeUploadSrc(student?.PathImage);

  const textInput = (name, attrs) =>
    html`<input class="input" id="${id(name)}" name="${name}" value="${value(name)}" aria-describedby="${describedBy(id(name), Boolean(attrs.hint))}"
      type="${attrs.type || 'text'}" ${attrs.extra || ''}>`;

  const body = html`<form class="form" id="${prefix}" novalidate>
    <div class="alert alert--error" role="alert" data-role="form-alert" hidden></div>
    ${isEdit
      ? html`<div class="form-meta">
          <span><span class="muted">Mã SV:</span> <strong class="code">${student.StudentCode}</strong></span>
          <span><span class="muted">Ngày tạo:</span> ${formatDateTime(student.CreateDate)}</span>
          <span><span class="muted">Cập nhật:</span> ${formatDateTime(student.UpdateDate)}</span>
        </div>`
      : ''}
    <div class="form-layout">
      <div class="field image-field" data-field="image">
        <span class="field__label" id="${id('image')}-label">Ảnh đại diện</span>
        <div class="image-field__preview" data-role="preview"></div>
        <div class="image-field__actions">
          <button type="button" class="btn btn-secondary btn-sm" data-role="pick" data-focus-target
            aria-describedby="${id('image')}-hint ${id('image')}-error">${icon('image', { size: 16 })} Chọn ảnh…</button>
          <button type="button" class="btn btn-ghost btn-sm text-danger" data-role="remove-image">${icon('trash', { size: 16 })} Xóa ảnh</button>
        </div>
        <input type="file" id="${id('image')}" name="image" accept="image/png,image/jpeg,image/webp" data-role="file" hidden>
        <p class="field__hint" id="${id('image')}-hint" data-role="image-hint"></p>
        <p class="field__error" id="${id('image')}-error" hidden></p>
      </div>

      <div class="form-grid">
        ${field({
          id: id('FullName'),
          name: 'FullName',
          label: 'Họ và tên',
          required: true,
          className: 'span-2',
          control: textInput('FullName', { extra: html`maxlength="100" autocomplete="off" required placeholder="VD: Nguyễn Văn An"` }),
        })}
        <fieldset class="field field--radios" data-field="Gender">
          <legend class="field__label">Giới tính<span class="field__req" aria-hidden="true">*</span></legend>
          <div class="radio-group">
            ${GENDERS.map(
              (gender) => html`<label class="radio"><input type="radio" name="Gender" value="${gender}" ${value('Gender') === gender ? 'checked' : ''}
                aria-describedby="${id('Gender')}-error"><span>${gender}</span></label>`,
            )}
          </div>
          <p class="field__error" id="${id('Gender')}-error" hidden></p>
        </fieldset>
        ${field({
          id: id('DateOfBirth'),
          name: 'DateOfBirth',
          label: 'Ngày sinh',
          required: true,
          control: textInput('DateOfBirth', { type: 'date', extra: html`min="${MIN_DOB}" max="${today}" required` }),
        })}
        ${field({
          id: id('ClassName'),
          name: 'ClassName',
          label: 'Lớp',
          required: true,
          control: textInput('ClassName', { extra: html`maxlength="50" autocomplete="off" required placeholder="VD: CNTT-K18A"` }),
        })}
        ${field({
          id: id('Major'),
          name: 'Major',
          label: 'Ngành',
          required: true,
          control: textInput('Major', { extra: html`maxlength="100" autocomplete="off" required list="${prefix}-majors" placeholder="VD: Công nghệ thông tin"` }),
        })}
        ${field({
          id: id('Email'),
          name: 'Email',
          label: 'Email',
          control: textInput('Email', { type: 'email', extra: html`maxlength="100" autocomplete="off" placeholder="ten@example.com"` }),
        })}
        ${field({
          id: id('Phone'),
          name: 'Phone',
          label: 'Số điện thoại',
          control: textInput('Phone', { type: 'tel', extra: html`maxlength="14" inputmode="numeric" autocomplete="off" placeholder="VD: 0912345678"` }),
        })}
        ${field({
          id: id('GPA'),
          name: 'GPA',
          label: 'GPA',
          hint: 'Thang 4, ví dụ 3.5 hoặc 3,5.',
          control: html`<input class="input" id="${id('GPA')}" name="GPA" type="text" inputmode="decimal" maxlength="6" autocomplete="off"
            placeholder="VD: 3.25" value="${student && student.GPA != null ? formatGpa(student.GPA) : ''}" aria-describedby="${describedBy(id('GPA'), true)}">`,
        })}
        ${field({
          id: id('Address'),
          name: 'Address',
          label: 'Địa chỉ',
          control: textInput('Address', { extra: html`maxlength="255" autocomplete="off"` }),
        })}
        ${field({
          id: id('Description'),
          name: 'Description',
          label: 'Ghi chú',
          className: 'span-2',
          hint: 'Tối đa 1000 ký tự.',
          control: html`<textarea class="input" id="${id('Description')}" name="Description" rows="3" maxlength="1000"
            aria-describedby="${describedBy(id('Description'), true)}">${value('Description')}</textarea>`,
        })}
      </div>
    </div>
    <datalist id="${prefix}-majors">${MAJOR_SUGGESTIONS.map((major) => html`<option value="${major}"></option>`)}</datalist>
  </form>`;

  let form = null;
  let newFile = null;
  let objectUrl = null;
  let removeExisting = false;
  let saving = false;

  const revokePreview = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const modal = openModal({
    title: isEdit ? `Sửa sinh viên ${student.StudentCode || ''}`.trim() : 'Thêm sinh viên',
    size: 'lg',
    body,
    footer: html`<span class="modal__hint"><kbd>Alt</kbd>+<kbd>S</kbd> lưu · <kbd>Esc</kbd> đóng</span>
      <button type="button" class="btn btn-secondary" data-modal-close>Hủy</button>
      <button type="submit" class="btn btn-primary" form="${prefix}" data-role="save" aria-keyshortcuts="Alt+S">${icon('save', { size: 16 })} ${isEdit ? 'Lưu thay đổi' : 'Thêm sinh viên'}</button>`,
    onSave: () => form?.requestSubmit(),
    onClose: revokePreview,
    initialFocus: `#${id('FullName')}`,
  });

  form = modal.body.querySelector('form');
  const saveButton = modal.footer.querySelector('[data-role="save"]');
  const fileInput = form.querySelector('[data-role="file"]');
  const previewEl = form.querySelector('[data-role="preview"]');
  const removeButton = form.querySelector('[data-role="remove-image"]');
  const imageHint = form.querySelector('[data-role="image-hint"]');

  function renderPreview() {
    const src = objectUrl || (removeExisting ? null : existingImage);
    setHtml(
      previewEl,
      src
        ? html`<img src="${src}" alt="Ảnh xem trước">`
        : html`<div class="image-field__placeholder">${icon('user', { size: 40 })}<span>Chưa có ảnh</span></div>`,
    );
    removeButton.hidden = !src;
    if (newFile) imageHint.textContent = `Đã chọn: ${newFile.name} (${formatFileSize(newFile.size)})`;
    else if (removeExisting) imageHint.textContent = 'Ảnh hiện tại sẽ bị xóa khi lưu.';
    else if (src) imageHint.textContent = 'Ảnh hiện tại. Chọn ảnh khác để thay thế.';
    else imageHint.textContent = 'PNG, JPEG hoặc WebP, tối đa 5 MB.';
  }

  form.querySelector('[data-role="pick"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) {
      setFieldError(form, 'image', error);
      fileInput.value = '';
      return;
    }
    setFieldError(form, 'image', '');
    revokePreview();
    newFile = file;
    objectUrl = URL.createObjectURL(file);
    renderPreview();
  });
  removeButton.addEventListener('click', () => {
    revokePreview();
    newFile = null;
    fileInput.value = '';
    if (existingImage) removeExisting = true;
    setFieldError(form, 'image', '');
    renderPreview();
    form.querySelector('[data-role="pick"]').focus();
  });
  renderPreview();

  /* Clear a field's error as soon as the user edits it. */
  form.addEventListener('input', (event) => {
    const wrapper = event.target.closest('[data-field]');
    if (wrapper?.classList.contains('has-error') && wrapper.dataset.field !== 'image') setFieldError(form, wrapper.dataset.field, '');
  });

  function collectValues() {
    const element = (name) => form.elements.namedItem(name);
    const text = (name) => String(element(name)?.value ?? '').trim().normalize('NFC');
    const values = {};
    for (const name of TEXT_FIELDS) values[name] = text(name);
    values.Phone = values.Phone.replace(/[\s.-]/g, '');
    values.GPA = values.GPA.replace(',', '.');
    values.Gender = form.querySelector('input[name="Gender"]:checked')?.value ?? '';
    const badInput = {
      DateOfBirth: Boolean(element('DateOfBirth')?.validity?.badInput),
      GPA: Boolean(element('GPA')?.validity?.badInput),
    };
    return { values, badInput };
  }

  function buildFormData(values) {
    const formData = new FormData();
    for (const [name, fieldValue] of Object.entries(values)) formData.append(name, fieldValue);
    if (newFile) formData.append('image', newFile, newFile.name);
    else if (isEdit && removeExisting) formData.append('removeImage', '1');
    return formData;
  }

  function focusFirst(control) {
    if (!control) return;
    control.focus();
    control.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  async function submit() {
    if (saving) return;
    setFormAlert(form, '');
    const { values, badInput } = collectValues();
    const errors = validateStudent(values, { today, badInput });
    const { first } = showFieldErrors(form, errors);
    if (first) {
      focusFirst(first);
      toast('Vui lòng kiểm tra lại các trường được đánh dấu.', 'warning');
      return;
    }

    saving = true;
    modal.setBusy(true);
    setBusy(saveButton, true);
    try {
      const formData = buildFormData(values);
      const saved = isEdit ? await api.students.update(student.StudentID, formData) : await api.students.create(formData);
      modal.close(true);
      const code = saved?.StudentCode ? ` ${saved.StudentCode}` : '';
      toast(isEdit ? `Đã cập nhật sinh viên${code}.` : `Đã thêm sinh viên${code}.`, 'success');
      onSaved?.(saved);
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR' && error.details.length) {
        const { errors: serverErrors, general } = detailsToErrors(error.details, FIELD_ALIASES);
        const { first: firstInvalid, unknown } = showFieldErrors(form, serverErrors);
        const extra = [...general, ...unknown];
        if (extra.length) setFormAlert(form, extra.join(' ')); // field errors are shown inline
        focusFirst(firstInvalid);
        toast(error.message || 'Dữ liệu không hợp lệ.', 'error');
      } else if (error.code === 'FILE_ERROR') {
        focusFirst(setFieldError(form, 'image', error.message));
        toast(error.message, 'error');
      } else if (error.status === 404 && isEdit) {
        modal.close(false);
        showError(error, 'Sinh viên không tồn tại hoặc đã bị xóa.');
        onNotFound?.();
      } else {
        if (error.name === 'ApiError' && error.status !== 403) setFormAlert(form, error.message);
        showError(error, 'Không thể lưu sinh viên.');
      }
    } finally {
      saving = false;
      if (!modal.isClosed()) {
        modal.setBusy(false);
        setBusy(saveButton, false);
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  return modal;
}
