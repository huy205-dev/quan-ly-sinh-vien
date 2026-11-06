/**
 * Read-only student detail modal (GET /api/students/:id).
 */
import { api } from '../../api.js';
import { html, setHtml, safeUploadSrc } from '../../html.js';
import { icon } from '../../icons.js';
import { openModal, showError, spinner } from '../../ui.js';
import { can } from '../../session.js';
import { formatDate, formatDateTime, formatGpa, studentCode, initials, colorSlot } from '../../format.js';

const dash = html`<span class="muted">—</span>`;
const orDash = (value) => (value === null || value === undefined || value === '' ? dash : value);

function detailTemplate(s) {
  const src = safeUploadSrc(s.PathImage);
  const code = s.StudentCode || studentCode(s.StudentID);
  const item = (label, value, className = '') => html`<div class="detail__item ${className}"><dt>${label}</dt><dd>${orDash(value)}</dd></div>`;
  return html`<div class="detail">
    <div class="detail__aside">
      ${src
        ? html`<img class="detail__photo" src="${src}" alt="Ảnh của ${s.FullName}">`
        : html`<span class="detail__photo detail__photo--empty avatar--c${colorSlot(s.StudentID)}" role="img" aria-label="Chưa có ảnh">${initials(s.FullName)}</span>`}
      <p class="detail__name">${s.FullName}</p>
      <p><span class="code">${code}</span></p>
      ${s.GPA != null ? html`<p class="detail__gpa"><span class="muted">GPA</span> <strong>${formatGpa(s.GPA)}</strong></p>` : ''}
    </div>
    <dl class="detail__list">
      ${item('Mã sinh viên', code)}
      ${item('Họ và tên', s.FullName)}
      ${item('Giới tính', s.Gender)}
      ${item('Ngày sinh', formatDate(s.DateOfBirth))}
      ${item('Lớp', s.ClassName)}
      ${item('Ngành', s.Major)}
      ${item('Email', s.Email ? html`<a href="mailto:${s.Email}">${s.Email}</a>` : '')}
      ${item('Số điện thoại', s.Phone ? html`<a href="tel:${s.Phone}">${s.Phone}</a>` : '')}
      ${item('GPA', formatGpa(s.GPA))}
      ${item('Địa chỉ', s.Address)}
      ${item('Ghi chú', s.Description ? html`<span class="pre-wrap">${s.Description}</span>` : '', 'span-2')}
      ${item('Ngày tạo', formatDateTime(s.CreateDate))}
      ${item('Ngày cập nhật', formatDateTime(s.UpdateDate))}
    </dl>
  </div>`;
}

export function openStudentDetail(id, { onEdit, onNotFound } = {}) {
  const modal = openModal({
    title: 'Chi tiết sinh viên',
    size: 'lg',
    closeOnBackdrop: true,
    body: html`<div class="loading-block">${spinner()}<span>Đang tải thông tin sinh viên…</span></div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-modal-close>Đóng</button>`,
  });

  api.students
    .get(id)
    .then((student) => {
      if (modal.isClosed()) return;
      modal.setTitle(`Chi tiết sinh viên ${student.StudentCode || studentCode(student.StudentID)}`);
      setHtml(modal.body, detailTemplate(student));
      modal.setFooter(
        html`<button type="button" class="btn btn-secondary" data-modal-close>Đóng</button>
          ${can('student.update') ? html`<button type="button" class="btn btn-primary" data-role="edit">${icon('edit', { size: 16 })} Sửa</button>` : ''}`,
      );
      modal.footer.querySelector('[data-role="edit"]')?.addEventListener('click', () => {
        modal.close();
        onEdit?.(student.StudentID);
      });
      modal.footer.querySelector('button')?.focus();
    })
    .catch((error) => {
      modal.close();
      showError(error, 'Không tải được thông tin sinh viên.');
      if (error.status === 404) onNotFound?.();
    });
  return modal;
}
