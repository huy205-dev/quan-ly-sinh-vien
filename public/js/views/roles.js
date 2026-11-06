/**
 * Roles view: role list + permission matrix (rows = modules, columns = actions from GET /api/permissions).
 * The system role is locked (all permissions, cannot be changed or deleted; name/description editable).
 */
import { api } from '../api.js';
import { html, setHtml } from '../html.js';
import { icon } from '../icons.js';
import { can, requestSessionRefresh } from '../session.js';
import { openModal, toast, showError, confirmDialog, requirePermission, setBusy, spinner } from '../ui.js';
import { field, describedBy, showFieldErrors, setFieldError, detailsToErrors, setFormAlert } from '../forms.js';
import { formatDateTime } from '../format.js';
import { registerViewShortcuts } from '../shortcuts.js';
import { charLength } from './students/validation.js';

const ROLE_CODE_RE = /^[a-z0-9_]{2,30}$/;
const DEFAULT_ACTIONS = [
  { action: 'read', name: 'Xem' },
  { action: 'create', name: 'Thêm' },
  { action: 'update', name: 'Sửa' },
  { action: 'delete', name: 'Xóa' },
  { action: 'import', name: 'Nhập file' },
  { action: 'export', name: 'Xuất file' },
];

function validateRoleText(values) {
  const errors = {};
  if (!values.Name) errors.Name = 'Vui lòng nhập tên vai trò.';
  else if (charLength(values.Name) < 2 || charLength(values.Name) > 100) errors.Name = 'Tên vai trò phải từ 2 đến 100 ký tự.';
  if (values.Description && charLength(values.Description) > 255) errors.Description = 'Mô tả tối đa 255 ký tự.';
  return errors;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));

export function mountRoles(root) {
  const state = {
    roles: [],
    catalog: { actions: DEFAULT_ACTIONS, modules: [] },
    catalogLoaded: false,
    selectedId: null,
    draft: null, // { Name, Description, perms: Set }
    loading: true,
    error: null,
    saving: false,
  };
  let disposed = false;
  let formSeq = 0;

  setHtml(
    root,
    html`<div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">Vai trò &amp; phân quyền</h1>
          <p class="page-subtitle">Mỗi người dùng có một vai trò; vai trò quyết định các chức năng được Xem / Thêm / Sửa / Xóa / Nhập / Xuất.</p>
        </div>
        ${can('role.create')
          ? html`<button type="button" class="btn btn-primary" data-action="create" aria-keyshortcuts="Alt+N" title="Thêm vai trò (Alt+N)">
              ${icon('plus', { size: 16 })}<span class="btn__label">Thêm vai trò</span><kbd class="btn__kbd">Alt+N</kbd></button>`
          : ''}
      </div>
      <div class="roles-layout">
        <section class="card role-list-card" aria-labelledby="role-list-title">
          <div class="card__header">
            <h2 class="card__title" id="role-list-title">Danh sách vai trò</h2>
            <span class="badge badge--muted" data-role="role-count"></span>
          </div>
          <ul class="role-list" data-role="role-list"></ul>
        </section>
        <section class="card role-detail-card" data-role="detail" aria-label="Chi tiết vai trò"></section>
      </div>`,
  );

  const els = {
    list: root.querySelector('[data-role="role-list"]'),
    count: root.querySelector('[data-role="role-count"]'),
    detail: root.querySelector('[data-role="detail"]'),
  };

  const selectedRole = () => state.roles.find((role) => role.RoleID === state.selectedId) || null;
  const allCodes = () => state.catalog.modules.flatMap((module) => module.permissions.map((p) => p.code));
  const moduleCodes = (moduleName) => state.catalog.modules.find((m) => m.module === moduleName)?.permissions.map((p) => p.code) || [];
  const actionCodes = (action) => state.catalog.modules.flatMap((m) => m.permissions.filter((p) => p.action === action).map((p) => p.code));
  const isLocked = (role) => !role || role.IsSystem || !can('role.update');

  function resetDraft() {
    const role = selectedRole();
    state.draft = role
      ? {
          Name: role.Name || '',
          Description: role.Description || '',
          perms: new Set(role.IsSystem ? allCodes() : role.Permissions || []),
        }
      : null;
  }

  function isDirty() {
    const role = selectedRole();
    if (!role || !state.draft) return false;
    const original = new Set(role.IsSystem ? allCodes() : role.Permissions || []);
    return (
      state.draft.Name.trim() !== (role.Name || '') ||
      state.draft.Description.trim() !== (role.Description || '') ||
      !sameSet(state.draft.perms, original)
    );
  }

  /* ------------------------------------------------------------ data */

  async function loadAll() {
    state.loading = true;
    renderDetail();
    try {
      const [rolesResponse, catalog] = await Promise.all([api.roles.list(), state.catalogLoaded ? null : api.permissions()]);
      if (disposed) return;
      if (catalog) {
        state.catalog = {
          actions: Array.isArray(catalog.actions) && catalog.actions.length ? catalog.actions : DEFAULT_ACTIONS,
          modules: Array.isArray(catalog.modules)
            ? catalog.modules.map((m) => ({ ...m, permissions: Array.isArray(m.permissions) ? m.permissions : [] }))
            : [],
        };
        state.catalogLoaded = true;
      }
      state.roles = Array.isArray(rolesResponse?.items) ? rolesResponse.items : [];
      if (!state.roles.some((role) => role.RoleID === state.selectedId)) state.selectedId = state.roles[0]?.RoleID ?? null;
      state.error = null;
      resetDraft();
    } catch (error) {
      if (disposed) return;
      state.error = error;
      showError(error, 'Không tải được danh sách vai trò.');
    } finally {
      if (!disposed) {
        state.loading = false;
        renderList();
        renderDetail();
      }
    }
  }

  /* ------------------------------------------------------------ render */

  function renderList() {
    els.count.textContent = `${state.roles.length} vai trò`;
    setHtml(
      els.list,
      html`${state.roles.map((role) => {
        const active = role.RoleID === state.selectedId;
        const permCount = role.IsSystem ? allCodes().length : (role.Permissions || []).length;
        return html`<li><button type="button" class="role-item ${active ? 'is-active' : ''}" data-role-id="${role.RoleID}" aria-current="${active ? 'true' : 'false'}">
          <span class="role-item__icon">${icon(role.IsSystem ? 'lock' : 'shield', { size: 18 })}</span>
          <span class="role-item__body">
            <span class="role-item__name">${role.Name}</span>
            <span class="role-item__meta"><code>${role.Code}</code> · ${role.UserCount ?? 0} người dùng · ${permCount} quyền</span>
          </span>
          ${role.IsSystem ? html`<span class="badge badge--warning">Hệ thống</span>` : ''}
        </button></li>`;
      })}`,
    );
  }

  function matrixTemplate(role) {
    const { actions, modules } = state.catalog;
    return html`<div class="table-wrap table-wrap--plain matrix-wrap">
      <table class="matrix">
        <caption class="sr-only">Ma trận phân quyền của vai trò ${role.Name}</caption>
        <thead>
          <tr>
            <th scope="col" class="matrix__module">Chức năng</th>
            <th scope="col" class="matrix__toggle">
              <label class="check check--stacked"><input type="checkbox" data-toggle="all" aria-label="Chọn tất cả quyền"><span>Tất cả</span></label>
            </th>
            ${actions.map(
              (action) => html`<th scope="col">
                <label class="check check--stacked"><input type="checkbox" data-col="${action.action}" aria-label="Chọn cả cột ${action.name}"><span>${action.name}</span></label>
              </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${modules.map(
            (module) => html`<tr>
              <th scope="row" class="matrix__module"><span class="matrix__module-name">${module.name}</span> <code class="muted small">${module.module}</code></th>
              <td class="matrix__toggle"><input type="checkbox" data-row="${module.module}" aria-label="Chọn cả hàng ${module.name}"></td>
              ${actions.map((action) => {
                const permission = module.permissions.find((p) => p.action === action.action);
                return permission
                  ? html`<td><input type="checkbox" data-code="${permission.code}" aria-label="${module.name}: ${action.name}"
                      title="${permission.description || permission.name || permission.code}"></td>`
                  : html`<td class="matrix__na"><span aria-hidden="true">—</span><span class="sr-only">Không áp dụng</span></td>`;
              })}
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  function renderDetail() {
    const role = selectedRole();
    if (state.loading && !state.roles.length) {
      setHtml(els.detail, html`<div class="loading-block">${spinner()}<span>Đang tải phân quyền…</span></div>`);
      return;
    }
    if (!role) {
      setHtml(
        els.detail,
        html`<div class="empty-state">${icon(state.error ? 'alert' : 'shield', { size: 28 })}<p>${state.error ? 'Không tải được dữ liệu vai trò.' : 'Chưa có vai trò nào.'}</p>
          ${state.error ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="reload">${icon('refresh', { size: 16 })} Thử lại</button>` : ''}</div>`,
      );
      return;
    }
    const canEdit = can('role.update');
    const id = `rf${(formSeq += 1)}`;
    setHtml(
      els.detail,
      html`<form class="role-form" id="${id}" novalidate>
        <div class="card__header role-detail__header">
          <div>
            <h2 class="card__title">${role.Name} ${role.IsSystem ? html`<span class="badge badge--warning">${icon('lock', { size: 12 })} Hệ thống</span>` : ''}</h2>
            <p class="muted small"><code>${role.Code}</code> · ${role.UserCount ?? 0} người dùng · cập nhật ${formatDateTime(role.UpdateDate)}</p>
          </div>
          ${can('role.delete') && !role.IsSystem
            ? html`<button type="button" class="btn btn-danger-soft btn-sm" data-action="delete-role">${icon('trash', { size: 16 })} Xóa vai trò</button>`
            : ''}
        </div>
        <div class="role-form__body">
          ${role.IsSystem
            ? html`<div class="alert alert--info">${icon('lock', { size: 16 })}<span>Vai trò hệ thống luôn có <strong>toàn bộ quyền</strong>. Không thể thay đổi quyền hoặc xóa vai trò này; chỉ có thể đổi tên và mô tả.</span></div>`
            : ''}
          ${!canEdit ? html`<div class="alert alert--muted">${icon('eye', { size: 16 })}<span>Bạn chỉ có quyền xem phân quyền của vai trò.</span></div>` : ''}
          <div class="alert alert--error" role="alert" data-role="form-alert" hidden></div>
          <div class="form-grid">
            ${field({
              id: `${id}-Name`,
              name: 'Name',
              label: 'Tên vai trò',
              required: true,
              control: html`<input class="input" id="${id}-Name" name="Name" type="text" maxlength="100" value="${state.draft.Name}"
                aria-describedby="${describedBy(`${id}-Name`)}" ${canEdit ? '' : 'readonly'}>`,
            })}
            ${field({
              id: `${id}-Description`,
              name: 'Description',
              label: 'Mô tả',
              control: html`<input class="input" id="${id}-Description" name="Description" type="text" maxlength="255" value="${state.draft.Description}"
                aria-describedby="${describedBy(`${id}-Description`)}" ${canEdit ? '' : 'readonly'}>`,
            })}
          </div>
          <h3 class="section-title">Ma trận phân quyền</h3>
          <p class="muted small">Hàng là chức năng, cột là thao tác. Ô đầu hàng/cột dùng để chọn nhanh cả hàng/cột; ô “—” là thao tác không áp dụng cho chức năng đó.</p>
          ${matrixTemplate(role)}
        </div>
        <div class="form-actions">
          <span class="perm-count muted small" data-role="perm-count"></span>
          <span class="dirty-indicator" data-role="dirty" hidden>Có thay đổi chưa lưu</span>
          ${canEdit
            ? html`<button type="button" class="btn btn-secondary" data-action="reset">${icon('undo', { size: 16 })} Hoàn tác</button>
                <button type="submit" class="btn btn-primary" data-role="save" aria-keyshortcuts="Alt+S">${icon('save', { size: 16 })} Lưu thay đổi <kbd class="btn__kbd">Alt+S</kbd></button>`
            : ''}
        </div>
      </form>`,
    );
    syncMatrix();
  }

  /** Reflect draft permissions into the matrix: cells, row/column/all toggles (indeterminate), counters, dirty flag. */
  function syncMatrix() {
    const role = selectedRole();
    const form = els.detail.querySelector('form');
    if (!role || !form || !state.draft) return;
    const locked = isLocked(role);
    const perms = state.draft.perms;
    const setToggle = (checkbox, codes) => {
      if (!checkbox) return;
      const selected = codes.filter((code) => perms.has(code)).length;
      checkbox.checked = codes.length > 0 && selected === codes.length;
      checkbox.indeterminate = selected > 0 && selected < codes.length;
      checkbox.disabled = locked || codes.length === 0;
    };
    form.querySelectorAll('input[data-code]').forEach((checkbox) => {
      checkbox.checked = perms.has(checkbox.dataset.code);
      checkbox.disabled = locked;
    });
    form.querySelectorAll('input[data-row]').forEach((checkbox) => setToggle(checkbox, moduleCodes(checkbox.dataset.row)));
    form.querySelectorAll('input[data-col]').forEach((checkbox) => setToggle(checkbox, actionCodes(checkbox.dataset.col)));
    setToggle(form.querySelector('input[data-toggle="all"]'), allCodes());
    form.querySelector('[data-role="perm-count"]').textContent = `Đã chọn ${perms.size}/${allCodes().length} quyền`;
    const dirty = isDirty();
    form.querySelector('[data-role="dirty"]').hidden = !dirty;
    const saveButton = form.querySelector('[data-role="save"]');
    if (saveButton && !saveButton.classList.contains('is-busy')) saveButton.disabled = !dirty;
    const resetButton = form.querySelector('[data-action="reset"]');
    if (resetButton) resetButton.disabled = !dirty;
  }

  function setCodes(codes, on) {
    if (!state.draft) return;
    for (const code of codes) {
      if (on) state.draft.perms.add(code);
      else state.draft.perms.delete(code);
    }
    syncMatrix();
  }

  /* ------------------------------------------------------------ actions */

  async function selectRole(roleId) {
    if (roleId === state.selectedId) return;
    if (isDirty()) {
      const discard = await confirmDialog({
        title: 'Bỏ thay đổi chưa lưu?',
        message: 'Vai trò hiện tại có thay đổi chưa lưu. Bạn có muốn bỏ các thay đổi này?',
        confirmText: 'Bỏ thay đổi',
        cancelText: 'Ở lại',
        danger: true,
      });
      if (!discard || disposed) return;
    }
    state.selectedId = roleId;
    resetDraft();
    renderList();
    renderDetail();
  }

  async function save() {
    if (!requirePermission('role.update')) return;
    const role = selectedRole();
    const form = els.detail.querySelector('form');
    if (!role || !form || !state.draft || state.saving) return;
    setFormAlert(form, '');
    const values = { Name: state.draft.Name.trim().normalize('NFC'), Description: state.draft.Description.trim().normalize('NFC') };
    const { first } = showFieldErrors(form, validateRoleText(values));
    if (first) {
      first.focus();
      toast('Vui lòng kiểm tra lại thông tin vai trò.', 'warning');
      return;
    }
    if (!isDirty()) {
      toast('Không có thay đổi nào để lưu.', 'info');
      return;
    }
    const saveButton = form.querySelector('[data-role="save"]');
    state.saving = true;
    setBusy(saveButton, true);
    try {
      await api.roles.update(role.RoleID, {
        Name: values.Name,
        Description: values.Description,
        Permissions: role.IsSystem ? allCodes() : [...state.draft.perms],
      });
      toast(`Đã lưu vai trò “${values.Name}”.`, 'success');
      requestSessionRefresh(); // the current user's own permissions may have changed
      await loadAll();
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR' && error.details.length) {
        const { errors, general } = detailsToErrors(error.details);
        const { first: firstInvalid, unknown } = showFieldErrors(form, errors);
        const extra = [...general, ...unknown];
        if (extra.length) setFormAlert(form, extra.join(' ')); // field errors are shown inline
        firstInvalid?.focus();
      } else if (error.name === 'ApiError' && error.status !== 403) {
        setFormAlert(form, error.message);
      }
      showError(error, 'Không thể lưu vai trò.');
      if (error.status === 404) loadAll();
    } finally {
      state.saving = false;
      if (saveButton?.isConnected) {
        setBusy(saveButton, false);
        syncMatrix();
      }
    }
  }

  async function deleteRole() {
    if (!requirePermission('role.delete')) return;
    const role = selectedRole();
    if (!role) return;
    if (role.IsSystem) {
      toast('Không thể xóa vai trò hệ thống.', 'warning');
      return;
    }
    if (Number(role.UserCount) > 0) {
      toast(`Không thể xóa: vai trò “${role.Name}” đang được gán cho ${role.UserCount} người dùng.`, 'warning');
      return;
    }
    const ok = await confirmDialog({
      title: 'Xóa vai trò',
      message: html`Bạn có chắc muốn xóa vai trò <strong>${role.Name}</strong> (<code>${role.Code}</code>)?`,
      details: html`<p class="muted small">Thao tác này không thể hoàn tác.</p>`,
      confirmText: 'Xóa',
      danger: true,
    });
    if (!ok || disposed) return;
    try {
      await api.roles.remove(role.RoleID);
      toast(`Đã xóa vai trò “${role.Name}”.`, 'success');
      state.selectedId = null;
      await loadAll();
    } catch (error) {
      showError(error, 'Không thể xóa vai trò.');
      if (error.status === 404) loadAll();
    }
  }

  function openCreateRole() {
    if (!requirePermission('role.create')) return;
    const prefix = `rc${(formSeq += 1)}`;
    const id = (name) => `${prefix}-${name}`;
    let form = null;
    const modal = openModal({
      title: 'Thêm vai trò',
      size: 'md',
      body: html`<form class="form" id="${prefix}" novalidate autocomplete="off">
        <div class="alert alert--error" role="alert" data-role="form-alert" hidden></div>
        <div class="form-grid">
          ${field({
            id: id('Code'),
            name: 'Code',
            label: 'Mã vai trò',
            required: true,
            hint: '2–30 ký tự: a–z, 0–9 hoặc gạch dưới. Không thể đổi sau khi tạo.',
            control: html`<input class="input" id="${id('Code')}" name="Code" type="text" maxlength="30" autocapitalize="none" spellcheck="false"
              placeholder="VD: tro_ly" aria-describedby="${describedBy(id('Code'), true)}">`,
          })}
          ${field({
            id: id('Name'),
            name: 'Name',
            label: 'Tên vai trò',
            required: true,
            control: html`<input class="input" id="${id('Name')}" name="Name" type="text" maxlength="100" placeholder="VD: Trợ lý khoa"
              aria-describedby="${describedBy(id('Name'))}">`,
          })}
          ${field({
            id: id('Description'),
            name: 'Description',
            label: 'Mô tả',
            className: 'span-2',
            control: html`<input class="input" id="${id('Description')}" name="Description" type="text" maxlength="255"
              aria-describedby="${describedBy(id('Description'))}">`,
          })}
          ${field({
            id: id('CopyFrom'),
            name: 'Permissions',
            label: 'Quyền ban đầu',
            className: 'span-2',
            hint: 'Có thể chỉnh chi tiết trong ma trận phân quyền sau khi tạo.',
            control: html`<select class="input" id="${id('CopyFrom')}" name="CopyFrom" aria-describedby="${describedBy(id('CopyFrom'), true)}">
              <option value="">Chưa có quyền nào</option>
              ${state.roles.map((role) => html`<option value="${role.RoleID}">Sao chép quyền từ “${role.Name}”</option>`)}
            </select>`,
          })}
        </div>
      </form>`,
      footer: html`<span class="modal__hint"><kbd>Alt</kbd>+<kbd>S</kbd> lưu · <kbd>Esc</kbd> đóng</span>
        <button type="button" class="btn btn-secondary" data-modal-close>Hủy</button>
        <button type="submit" class="btn btn-primary" form="${prefix}" data-role="save">${icon('save', { size: 16 })} Tạo vai trò</button>`,
      onSave: () => form?.requestSubmit(),
      initialFocus: `#${id('Code')}`,
    });
    form = modal.body.querySelector('form');
    const saveButton = modal.footer.querySelector('[data-role="save"]');
    let saving = false;
    const codeInput = form.elements.Code;
    codeInput.addEventListener('input', () => {
      const lower = codeInput.value.toLowerCase();
      if (lower !== codeInput.value) codeInput.value = lower;
    });
    form.addEventListener('input', (event) => {
      const wrapper = event.target.closest('[data-field]');
      if (wrapper?.classList.contains('has-error')) setFieldError(form, wrapper.dataset.field, '');
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      setFormAlert(form, '');
      const values = {
        Code: codeInput.value.trim().toLowerCase(),
        Name: form.elements.Name.value.trim().normalize('NFC'),
        Description: form.elements.Description.value.trim().normalize('NFC'),
      };
      const errors = validateRoleText(values);
      if (!values.Code) errors.Code = 'Vui lòng nhập mã vai trò.';
      else if (!ROLE_CODE_RE.test(values.Code)) errors.Code = 'Mã vai trò gồm 2–30 ký tự: chữ thường a–z, số hoặc gạch dưới.';
      const { first } = showFieldErrors(form, errors);
      if (first) {
        first.focus();
        toast('Vui lòng kiểm tra lại các trường được đánh dấu.', 'warning');
        return;
      }
      const source = state.roles.find((role) => String(role.RoleID) === form.elements.CopyFrom.value);
      const permissions = source ? (source.IsSystem ? allCodes() : [...(source.Permissions || [])]) : [];
      saving = true;
      modal.setBusy(true);
      setBusy(saveButton, true);
      try {
        const created = await api.roles.create({ ...values, Permissions: permissions });
        modal.close(true);
        toast(`Đã tạo vai trò “${created?.Name || values.Name}”.`, 'success');
        if (created?.RoleID != null) state.selectedId = created.RoleID;
        await loadAll();
      } catch (error) {
        if (error.code === 'VALIDATION_ERROR' && error.details.length) {
          const { errors: serverErrors, general } = detailsToErrors(error.details);
          const { first: firstInvalid, unknown } = showFieldErrors(form, serverErrors);
          const extra = [...general, ...unknown];
          if (extra.length) setFormAlert(form, extra.join(' ')); // field errors are shown inline
          firstInvalid?.focus();
        } else if (error.status === 409) {
          setFieldError(form, 'Code', error.message)?.focus();
        } else if (error.name === 'ApiError' && error.status !== 403) {
          setFormAlert(form, error.message);
        }
        showError(error, 'Không thể tạo vai trò.');
      } finally {
        saving = false;
        if (!modal.isClosed()) {
          modal.setBusy(false);
          setBusy(saveButton, false);
        }
      }
    });
  }

  /* ------------------------------------------------------------ events */

  root.addEventListener('click', (event) => {
    const roleButton = event.target.closest('[data-role-id]');
    if (roleButton && els.list.contains(roleButton)) {
      selectRole(Number(roleButton.dataset.roleId));
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    switch (button.dataset.action) {
      case 'create':
        openCreateRole();
        break;
      case 'delete-role':
        deleteRole();
        break;
      case 'reset':
        resetDraft();
        renderDetail();
        break;
      case 'reload':
        loadAll();
        break;
      default:
    }
  });

  els.detail.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('input[data-code]')) setCodes([target.dataset.code], target.checked);
    else if (target.matches('input[data-row]')) setCodes(moduleCodes(target.dataset.row), target.checked);
    else if (target.matches('input[data-col]')) setCodes(actionCodes(target.dataset.col), target.checked);
    else if (target.matches('input[data-toggle="all"]')) setCodes(allCodes(), target.checked);
  });

  els.detail.addEventListener('input', (event) => {
    if (!state.draft) return;
    const name = event.target.name;
    if (name === 'Name' || name === 'Description') {
      state.draft[name] = event.target.value;
      const form = els.detail.querySelector('form');
      if (form) setFieldError(form, name, '');
      syncMatrix();
    }
  });

  els.detail.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });

  const unregisterShortcuts = registerViewShortcuts({
    create: { run: () => openCreateRole(), permission: 'role.create', label: 'Thêm vai trò' },
    save: { run: () => save(), permission: 'role.update', label: 'Lưu phân quyền' },
  });

  loadAll();

  return () => {
    disposed = true;
    unregisterShortcuts();
  };
}
