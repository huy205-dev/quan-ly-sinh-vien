/**
 * Client-side validation mirroring SPEC section 2 (Students). The server validates again.
 */
export const GENDERS = ['Nam', 'Nữ', 'Khác'];
export const MIN_DOB = '1950-01-01';
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/* Same e-mail rule as the API (ASCII local part, dotted domain, TLD of 2+ letters). */
export const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const PHONE_RE = /^0\d{9,10}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const GPA_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Length in Unicode code points, like the API (emoji count as 1). */
export const charLength = (text) => [...String(text ?? '')].length;

export function isValidYmd(value) {
  const match = DATE_RE.exec(value || '');
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * @param {Record<string,string>} v trimmed values keyed by API field name
 * @param {{today: string, badInput?: Record<string, boolean>}} options
 * @returns {Record<string,string>} { field: message }
 */
export function validateStudent(v, { today, badInput = {} }) {
  const errors = {};
  const len = charLength;

  if (!v.FullName) errors.FullName = 'Vui lòng nhập họ và tên.';
  else if (len(v.FullName) < 2 || len(v.FullName) > 100) errors.FullName = 'Họ và tên phải từ 2 đến 100 ký tự.';

  if (!GENDERS.includes(v.Gender)) errors.Gender = 'Vui lòng chọn giới tính: Nam, Nữ hoặc Khác.';

  if (badInput.DateOfBirth) errors.DateOfBirth = 'Ngày sinh không hợp lệ.';
  else if (!v.DateOfBirth) errors.DateOfBirth = 'Vui lòng nhập ngày sinh.';
  else if (!isValidYmd(v.DateOfBirth)) errors.DateOfBirth = 'Ngày sinh không hợp lệ.';
  else if (v.DateOfBirth < MIN_DOB || v.DateOfBirth > today) errors.DateOfBirth = 'Ngày sinh phải từ 01/01/1950 đến hôm nay.';

  if (!v.ClassName) errors.ClassName = 'Vui lòng nhập lớp.';
  else if (len(v.ClassName) > 50) errors.ClassName = 'Lớp tối đa 50 ký tự.';

  if (!v.Major) errors.Major = 'Vui lòng nhập ngành.';
  else if (len(v.Major) > 100) errors.Major = 'Ngành tối đa 100 ký tự.';

  if (v.Email) {
    if (len(v.Email) > 100) errors.Email = 'Email tối đa 100 ký tự.';
    else if (!EMAIL_RE.test(v.Email)) errors.Email = 'Email không hợp lệ (ví dụ: ten@example.com).';
  }

  if (v.Phone && !PHONE_RE.test(v.Phone)) errors.Phone = 'Số điện thoại phải bắt đầu bằng 0 và gồm 10–11 chữ số.';

  if (v.Address && len(v.Address) > 255) errors.Address = 'Địa chỉ tối đa 255 ký tự.';

  if (badInput.GPA) errors.GPA = 'GPA phải là số từ 0 đến 4.';
  else if (v.GPA !== '') {
    const text = v.GPA.replace(',', '.'); // "3,5" and "3.5" are both accepted (as by the API)
    const gpa = Number(text);
    if (!GPA_RE.test(text) || !Number.isFinite(gpa) || gpa < 0 || gpa > 4) errors.GPA = 'GPA phải là số từ 0 đến 4.';
  }

  if (v.Description && len(v.Description) > 1000) errors.Description = 'Ghi chú tối đa 1000 ký tự.';

  return errors;
}

export function validateImageFile(file) {
  if (!file) return null;
  const typeOk = IMAGE_TYPES.includes(file.type) || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!typeOk) return 'Ảnh phải có định dạng PNG, JPEG hoặc WebP.';
  if (file.size === 0) return 'Tệp ảnh rỗng.';
  if (file.size > MAX_IMAGE_BYTES) return 'Ảnh tối đa 5 MB.';
  return null;
}
