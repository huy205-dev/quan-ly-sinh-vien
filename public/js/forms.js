/**
 * Form helpers: labelled field markup + per-field error display.
 * A field wrapper is `[data-field="<ApiFieldName>"]` containing `.field__error`.
 */
import { html } from './html.js';

/** Render a labelled field. The control must have id=`id` and aria-describedby=`${id}-error` (+ `${id}-hint`). */
export function field({ id, name, label, required = false, hint = '', control, className = '' }) {
  return html`<div class="field ${className}" data-field="${name}">
    <label class="field__label" for="${id}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ''}</label>
    ${control}
    ${hint ? html`<p class="field__hint" id="${id}-hint">${hint}</p>` : ''}
    <p class="field__error" id="${id}-error" hidden></p>
  </div>`;
}

/** aria-describedby value for a control rendered with `field()`. */
export const describedBy = (id, withHint = false) => (withHint ? `${id}-hint ${id}-error` : `${id}-error`);

function fieldWrapper(root, name) {
  return root.querySelector(`[data-field="${CSS.escape(name)}"]`);
}

/** Set (or clear when message is empty) the error of one field. Returns the control to focus, or null. */
export function setFieldError(root, name, message) {
  const wrapper = fieldWrapper(root, name);
  if (!wrapper) return null;
  wrapper.classList.toggle('has-error', Boolean(message));
  const errorEl = wrapper.querySelector('.field__error');
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }
  const controls = wrapper.querySelectorAll('input:not([type="file"]), select, textarea');
  controls.forEach((control) => {
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  });
  return wrapper.querySelector('[data-focus-target]') || controls[0] || null;
}

export function clearFieldErrors(root) {
  root.querySelectorAll('.field.has-error').forEach((wrapper) => wrapper.classList.remove('has-error'));
  root.querySelectorAll('.field__error').forEach((errorEl) => {
    errorEl.textContent = '';
    errorEl.hidden = true;
  });
  root.querySelectorAll('[aria-invalid="true"]').forEach((control) => control.removeAttribute('aria-invalid'));
}

/**
 * Show a { field: message } map. Returns { first, unknown } where `first` is the first control to focus
 * (in document order) and `unknown` the messages whose field is not in the form.
 */
export function showFieldErrors(root, errors) {
  clearFieldErrors(root);
  const unknown = [];
  const controls = [];
  for (const [name, message] of Object.entries(errors || {})) {
    const control = setFieldError(root, name, message);
    if (control) controls.push(control);
    else unknown.push(message);
  }
  controls.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return { first: controls[0] || null, unknown };
}

/** Server `details: [{ field, message }]` -> { field: message } (first message per field wins). */
export function detailsToErrors(details, aliases = {}) {
  const errors = {};
  const general = [];
  for (const detail of details || []) {
    const name = aliases[detail?.field] || detail?.field;
    if (!name) general.push(detail?.message);
    else if (!errors[name]) errors[name] = detail.message;
  }
  return { errors, general: general.filter(Boolean) };
}

/** Show / hide the form-level alert box `[data-role="form-alert"]`. */
export function setFormAlert(root, message) {
  const alert = root.querySelector('[data-role="form-alert"]');
  if (!alert) return;
  alert.textContent = message || '';
  alert.hidden = !message;
}
