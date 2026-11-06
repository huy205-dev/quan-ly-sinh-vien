/**
 * Users view (SPEC section 7/8): paged table + search, create/edit modal, delete with confirm.
 */
import { api } from '../api.js';
import { html, setHtml } from '../html.js';
import { icon } from '../icons.js';
import { can, getUser, requestSessionRefresh } from '../session.js';
import { openModal, toast, showError, confirmDialog, requirePermission, debounce, setBusy, spinner } from '../ui.js';
import { field, describedBy, showFieldErrors, setFieldError, detailsToErrors, setFormAlert } from '../forms.js';
import { formatDateTime, formatNumber, initials, colorSlot } from '../format.js';
import { registerViewShortcuts } from '../shortcuts.js';
import { renderPager, bindPager } from '../components/pager.js';
import { EMAIL_RE, charLength } from './students/validation.js';

const PAGE_SIZES = [10, 15, 20];
const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

function passwordError(password) {
  if (password.length < 6 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Mật khẩu tối thiểu 6 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số.';
  }
  return null;
}

function validateUser(values, { isEdit }) {
  const errors = {};
  if (!isEdit) {
    if (!values.Username) errors.Username = 'Vui lòng nhập tên đăng nhập.';
    else if (!USERNAME_RE.test(values.Username)) errors.Username = 'Tên đăng nhập gồm 3–30 ký tự: chữ thường a–z, số, dấu chấm (.) hoặc gạch dưới (_).';
    if (!values.Password) errors.Password = 'Vui lòng nhập mật khẩu.';
  }
  if (values.Password) {
    const message = passwordError(values.Password);
    if (message) errors.Password = message;
  }
  if (!values.FullName) errors.FullName = 'Vui lòng nhập họ tên.';
  else if (charLength(values.FullName) < 2 || charLength(values.FullName) > 100) errors.FullName = 'Họ tên phải từ 2 đến 100 ký tự.';
  if (values.Email) {
    if (charLength(values.Email) > 100) errors.Email = 'Email tối đa 100 ký tự.';
    else if (!EMAIL_RE.test(values.Email)) errors.Email = 'Email không hợp lệ.';
  }
  if (!values.RoleID) errors.RoleID = 'Vui lòng chọn vai trò.';
  return errors;
}

export function mountUsers(root) {
  const me = getUser();
  const state = {
    page: 1,
    pageSize: 10,
    q: '',
    items: [],
    total: 0,
    totalPages: 1,
    loading: false,
    loadedOnce: false,
    error: null,
    seq: 0,
    roleOptions: null,
  };
  let disposed = false;
  let formSeq = 0;

  setHtml(
    root,
    html`<div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">Người dùng</h1>
          <p class="page-subtitle">Quản lý tài khoản đăng nhập, trạng thái hoạt động và vai trò của từng người dùng.</p>
        </div>
        ${can('user.create')
          ? html`<button type="button" class="btn btn-primary" data-action="create" aria-keyshortcuts="Alt+N" title="Thêm người dùng (Alt+N)">
              ${icon('plus', { size: 16 })}<span class="btn__label">Thêm người dùng</span><kbd class="btn__kbd">Alt+N</kbd></button>`
          : ''}
      </div>
      <section class="card">
        <div class="filters">
          <div class="search-box">
            ${icon('search', { size: 18 })}
            <label class="sr-only" for="user-search">Tìm kiếm người dùng</label>
            <input id="user-search" class="input" type="search" maxlength="100" autocomplete="off" spellcheck="false"
              placeholder="Tìm theo tên đăng nhập, họ tên, email…" aria-keyshortcuts="Alt+Q" enterkeyhint="search">
            <kbd class="search-box__kbd" aria-hidden="true">Alt+Q</kbd>
          </div>
          <div class="selection-bar" data-role="summary" aria-live="polite"></div>
        </div>
        <div class="table-wrap" data-role="table-wrap" role="region" aria-label="Bảng người dùng" tabindex="0">
          <table class="data-table data-table--users">
            <thead>
              <tr>
                <th scope="col">Tên đăng nhập</th>
                <th scope="col">Họ tên</th>
                <th scope="col">Email</th>
                <th scope="col">Vai trò</th>
                <th scope="col">Trạng thái</th>
                <th scope="col" class="col-datetime">Đăng nhập gần nhất</th>
                <th scope="col" class="col-datetime">Ngày tạo</th>
                <th scope="col" class="col-actions">Thao tác</th>
              </tr>
            </thead>
            <tbody data-role="tbody"></tbody>
          </table>
          <div class="table-overlay" aria-hidden="true">${spinner()}<span>Đang tải…</span></div>
        </div>
        <div class="pager" data-role="pager"></div>
      </section>`,
  );

  const els = {
    search: root.querySelector('#user-search'),
    summary: root.querySelector('[data-role="summary"]'),
    wrap: root.querySelector('[data-role="table-wrap"]'),
    tbody: root.querySelector('[data-role="tbody"]'),
    pager: root.querySelector('[data-role="pager"]'),
  };

  async function load() {
    const seq = (state.seq += 1);
    state.loading = true;
    renderLoading();
    try {
      const response = await api.users.list({ page: state.page, pageSize: state.pageSize, q: state.q });
      if (disposed || seq !== state.seq) return;
      state.items = Array.isArray(response?.items) ? response.items : [];
      state.total = Number(response?.total) || 0;
      state.totalPages = Math.max(1, Number(response?.totalPages) || 1);
      state.page = Number(response?.page) || state.page;
      state.error = null;
    } catch (error) {
      if (disposed || seq !== state.seq) return;
      state.error = error;
      showError(error, 'Không tải được danh sách người dùng.');
    } finally {
      if (!disposed && seq === state.seq) {
        state.loading = false;
        state.loadedOnce = true;
        render();
      }
    }
  }

  function renderLoading() {
    els.wrap.classList.toggle('is-loading', state.loading && state.loadedOnce);
    els.wrap.setAttribute('aria-busy', String(state.loading));
  }

  function rowTemplate(user) {
    const isMe = me && user.UserID === me.UserID;
    return html`<tr data-id="${user.UserID}">
      <td><div class="user-cell">
        <span class="avatar avatar--sm avatar--c${colorSlot(user.Username)}" aria-hidden="true">${initials(user.FullName || user.Username)}</span>
        <span><strong>${user.Username}</strong>${isMe ? html` <span class="badge badge--info">Bạn</span>` : ''}</span>
      </div></td>
      <td>${user.FullName}</td>
      <td>${user.Email || html`<span class="muted">—</span>`}</td>
      <td><span class="badge badge--role">${user.RoleName || user.RoleCode || '—'}</span></td>
      <td>${user.IsActive
        ? html`<span class="badge badge--success">Hoạt động</span>`
        : html`<span class="badge badge--danger">${icon('lock', { size: 12 })} Đã khóa</span>`}</td>
      <td class="col-datetime">${user.LastLoginDate ? formatDateTime(user.LastLoginDate) : html`<span class="muted">Chưa đăng nhập</span>`}</td>
      <td class="col-datetime">${formatDateTime(user.CreateDate)}</td>
      <td class="col-actions"><div class="row-actions">
        ${can('user.update')
          ? html`<button type="button" class="btn-icon" data-action="edit" title="Sửa" aria-label="Sửa người dùng ${user.Username}">${icon('edit', { size: 16 })}</button>
              <button type="button" class="btn-icon" data-action="toggle-active" ${isMe ? 'disabled' : ''}
                title="${isMe ? 'Không thể tự khóa tài khoản của mình' : user.IsActive ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}"
                aria-label="${user.IsActive ? 'Khóa' : 'Mở khóa'} tài khoản ${user.Username}">${icon(user.IsActive ? 'lock' : 'unlock', { size: 16 })}</button>`
          : ''}
        ${can('user.delete')
          ? html`<button type="button" class="btn-icon btn-icon--danger" data-action="delete" ${isMe ? 'disabled' : ''}
              title="${isMe ? 'Không thể xóa tài khoản đang đăng nhập' : 'Xóa'}" aria-label="Xóa người dùng ${user.Username}">${icon('trash', { size: 16 })}</button>`
          : ''}
      </div></td>
    </tr>`;
  }

  function render() {
    renderLoading();
    let body;
    if (!state.loadedOnce) {
      body = Array.from({ length: 5 }, () => html`<tr class="skeleton-row" aria-hidden="true">${Array.from({ length: 8 }, () => html`<td><span class="skeleton"></span></td>`)}</tr>`);
    } else if (!state.items.length) {
      body = html`<tr class="table-message"><td colspan="8"><div class="empty-state">${icon(state.error ? 'alert' : 'users', { size: 28 })}
        <p>${state.error ? 'Không tải được danh sách người dùng.' : state.q ? html`Không tìm thấy người dùng phù hợp với “<strong>${state.q}</strong>”.` : 'Chưa có người dùng nào.'}</p>
        ${state.error ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="reload">${icon('refresh', { size: 16 })} Thử lại</button>` : ''}
      </div></td></tr>`;
    } else {
      body = state.items.map(rowTemplate);
    }
    setHtml(els.tbody, html`${body}`);
    setHtml(
      els.summary,
      state.q
        ? html`<span class="muted">Kết quả cho “${state.q}”: ${formatNumber(state.total)} người dùng</span>`
        : html`<span class="muted">Tài khoản đang đăng nhập được đánh dấu “Bạn”.</span>`,
    );
    renderPager(els.pager, {
      page: state.page,
      totalPages: state.totalPages,
      total: state.total,
      pageSize: state.pageSize,
      pageSizes: PAGE_SIZES,
      unit: 'người dùng',
      count: state.items.length,
    });
  }

  async function loadRoleOptions() {
    if (!state.roleOptions) {
      const response = await api.roles.options();
      state.roleOptions = Array.isArray(response?.items) ? response.items : [];
    }
    return state.roleOptions;
  }

  /* ------------------------------------------------------------ form */

  async function openUserForm(user = null) {
    const isEdit = Boolean(user);
    let roles;
    try {
      roles = await loadRoleOptions();
    } catch (error) {
      showError(error, 'Không tải được danh sách vai trò.');
      return;
    }
    if (disposed) return;
    const isSelf = isEdit && me && user.UserID === me.UserID;
    const prefix = `uf${(formSeq += 1)}`;
    const id = (name) => `${prefix}-${name}`;

    const body = html`<form class="form" id="${prefix}" novalidate autocomplete="off">
      <div class="alert alert--error" role="alert" data-role="form-alert" hidden></div>
      <div class="form-grid">
        ${isEdit
          ? html`<div class="field"><span class="field__label">Tên đăng nhập</span><p class="field__static"><strong>${user.Username}</strong>
              <span class="muted small">(không thể đổi)</span></p></div>`
          : field({
              id: id('Username'),
              name: 'Username',
              label: 'Tên đăng nhập',
              required: true,
              hint: '3–30 ký tự: a–z, 0–9, dấu chấm hoặc gạch dưới.',
              control: html`<input class="input" id="${id('Username')}" name="Username" type="text" maxlength="30" autocapitalize="none"
                spellcheck="false" autocomplete="off" required aria-describedby="${describedBy(id('Username'), true)}">`,
            })}
        ${field({
          id: id('Password'),
          name: 'Password',
          label: isEdit ? 'Mật khẩu mới' : 'Mật khẩu',
          required: !isEdit,
          hint: isEdit ? 'Để trống nếu không muốn đặt lại mật khẩu.' : 'Tối thiểu 6 ký tự, có chữ cái và chữ số.',
          control: html`<div class="input-group">
            <input class="input" id="${id('Password')}" name="Password" type="password" autocomplete="new-password" maxlength="100"
              aria-describedby="${describedBy(id('Password'), true)}" ${isEdit ? '' : 'required'}>
            <button type="button" class="btn-icon input-group__btn" data-role="toggle-password" aria-label="Hiện mật khẩu" aria-pressed="false">${icon('eye', { size: 16 })}</button>
          </div>`,
        })}
        ${field({
          id: id('FullName'),
          name: 'FullName',
          label: 'Họ tên',
          required: true,
          control: html`<input class="input" id="${id('FullName')}" name="FullName" type="text" maxlength="100" required
            value="${user?.FullName ?? ''}" aria-describedby="${describedBy(id('FullName'))}">`,
        })}
        ${field({
          id: id('Email'),
          name: 'Email',
          label: 'Email',
          control: html`<input class="input" id="${id('Email')}" name="Email" type="email" maxlength="100"
            value="${user?.Email ?? ''}" placeholder="ten@example.com" aria-describedby="${describedBy(id('Email'))}">`,
        })}
        ${field({
          id: id('RoleID'),
          name: 'RoleID',
          label: 'Vai trò',
          required: true,
          hint: isSelf ? 'Bạn không thể tự đổi vai trò của mình.' : '',
          control: html`<select class="input" id="${id('RoleID')}" name="RoleID" required ${isSelf ? 'disabled' : ''}
            aria-describedby="${describedBy(id('RoleID'), isSelf)}">
            <option value="">— Chọn vai trò —</option>
            ${roles.map((role) => html`<option value="${role.RoleID}" ${user && Number(user.RoleID) === Number(role.RoleID) ? 'selected' : ''}>${role.Name} (${role.Code})</option>`)}
          </select>`,
        })}
        <div class="field" data-field="IsActive">
          <span class="field__label">Trạng thái</span>
          <label class="switch">
            <input type="checkbox" name="IsActive" ${!user || user.IsActive ? 'checked' : ''} ${isSelf ? 'disabled' : ''}
              aria-describedby="${id('IsActive')}-error">
            <span class="switch__track" aria-hidden="true"></span>
            <span>Đang hoạt động (cho phép đăng nhập)</span>
          </label>
          ${isSelf ? html`<p class="field__hint">Bạn không thể tự khóa tài khoản của mình.</p>` : ''}
          <p class="field__error" id="${id('IsActive')}-error" hidden></p>
        </div>
      </div>
    </form>`;

    let form = null;
    const modal = openModal({
      title: isEdit ? `Sửa người dùng ${user.Username}` : 'Thêm người dùng',
      size: 'md',
      body,
      footer: html`<span class="modal__hint"><kbd>Alt</kbd>+<kbd>S</kbd> lưu · <kbd>Esc</kbd> đóng</span>
        <button type="button" class="btn btn-secondary" data-modal-close>Hủy</button>
        <button type="submit" class="btn btn-primary" form="${prefix}" data-role="save">${icon('save', { size: 16 })} ${isEdit ? 'Lưu thay đổi' : 'Thêm người dùng'}</button>`,
      onSave: () => form?.requestSubmit(),
      initialFocus: isEdit ? `#${id('FullName')}` : `#${id('Username')}`,
    });
    form = modal.body.querySelector('form');
    const saveButton = modal.footer.querySelector('[data-role="save"]');
    let saving = false;

    const usernameInput = form.querySelector('[name="Username"]');
    usernameInput?.addEventListener('input', () => {
      const lower = usernameInput.value.toLowerCase();
      if (lower !== usernameInput.value) usernameInput.value = lower;
    });
    const passwordInput = form.querySelector('[name="Password"]');
    const toggle = form.querySelector('[data-role="toggle-password"]');
    toggle.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      setHtml(toggle, icon(show ? 'eyeOff' : 'eye', { size: 16 }));
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
        Username: (usernameInput?.value || '').trim().toLowerCase(),
        Password: passwordInput.value,
        FullName: form.elements.FullName.value.trim().normalize('NFC'),
        Email: form.elements.Email.value.trim(),
        RoleID: isSelf ? String(user.RoleID) : form.elements.RoleID.value,
        IsActive: isSelf ? Boolean(user.IsActive) : form.elements.IsActive.checked,
      };
      const { first } = showFieldErrors(form, validateUser(values, { isEdit }));
      if (first) {
        first.focus();
        toast('Vui lòng kiểm tra lại các trường được đánh dấu.', 'warning');
        return;
      }
      const payload = {
        FullName: values.FullName,
        Email: values.Email || null,
        RoleID: Number(values.RoleID),
        IsActive: values.IsActive,
      };
      if (!isEdit) {
        payload.Username = values.Username;
        payload.Password = values.Password;
      } else if (values.Password) {
        payload.Password = values.Password;
      }

      saving = true;
      modal.setBusy(true);
      setBusy(saveButton, true);
      try {
        const saved = isEdit ? await api.users.update(user.UserID, payload) : await api.users.create(payload);
        modal.close(true);
        toast(isEdit ? `Đã cập nhật người dùng ${saved?.Username || user.Username}.` : `Đã thêm người dùng ${saved?.Username || values.Username}.`, 'success');
        if (!isEdit) state.page = 1;
        if (isSelf) requestSessionRefresh(); // header shows FullName
        load();
      } catch (error) {
        if (error.code === 'VALIDATION_ERROR' && error.details.length) {
          const { errors, general } = detailsToErrors(error.details);
          const { first: firstInvalid, unknown } = showFieldErrors(form, errors);
          const extra = [...general, ...unknown];
          if (extra.length) setFormAlert(form, extra.join(' ')); // field errors are shown inline
          firstInvalid?.focus();
        } else if (error.status === 409) {
          if (!isEdit && /username|tên đăng nhập/i.test(error.message)) setFieldError(form, 'Username', error.message)?.focus();
          else setFormAlert(form, error.message);
        } else if (error.status === 404 && isEdit) {
          modal.close(false);
          showError(error, 'Người dùng không tồn tại hoặc đã bị xóa.');
          load();
          return;
        } else if (error.name === 'ApiError' && error.status !== 403) {
          setFormAlert(form, error.message);
        }
        showError(error, 'Không thể lưu người dùng.');
      } finally {
        saving = false;
        if (!modal.isClosed()) {
          modal.setBusy(false);
          setBusy(saveButton, false);
        }
      }
    });
  }

  /* ------------------------------------------------------------ actions */

  const actions = {
    create() {
      if (!requirePermission('user.create')) return;
      openUserForm(null);
    },
    edit(userId) {
      if (!requirePermission('user.update')) return;
      const user = state.items.find((item) => item.UserID === userId);
      if (user) openUserForm(user);
    },
    async delete(userId) {
      if (!requirePermission('user.delete')) return;
      const user = state.items.find((item) => item.UserID === userId);
      if (!user) return;
      if (me && user.UserID === me.UserID) {
        toast('Bạn không thể xóa tài khoản đang đăng nhập.', 'warning');
        return;
      }
      const ok = await confirmDialog({
        title: 'Xóa người dùng',
        message: html`Bạn có chắc muốn xóa người dùng <strong>${user.Username}</strong> (${user.FullName})?`,
        details: html`<p class="muted small">Tài khoản sẽ không thể đăng nhập nữa. Thao tác này không thể hoàn tác.</p>`,
        confirmText: 'Xóa',
        danger: true,
      });
      if (!ok || disposed) return;
      try {
        await api.users.remove(user.UserID);
        toast(`Đã xóa người dùng ${user.Username}.`, 'success');
        const remaining = Math.max(0, state.total - 1);
        state.page = Math.min(state.page, Math.max(1, Math.ceil(remaining / state.pageSize)));
        load();
      } catch (error) {
        showError(error, 'Không thể xóa người dùng.');
        if (error.status === 404) load();
      }
    },
    /** Quick lock / unlock: partial PUT { IsActive } (the API also refuses locking yourself / the last admin). */
    async toggleActive(userId) {
      if (!requirePermission('user.update')) return;
      const user = state.items.find((item) => item.UserID === userId);
      if (!user) return;
      const next = !user.IsActive;
      if (!next) {
        const ok = await confirmDialog({
          title: 'Khóa tài khoản',
          message: html`Khóa tài khoản <strong>${user.Username}</strong> (${user.FullName})?`,
          details: html`<p class="muted small">Người dùng sẽ không thể đăng nhập; phiên đang mở sẽ hết hiệu lực ở thao tác tiếp theo.</p>`,
          confirmText: 'Khóa tài khoản',
          danger: true,
        });
        if (!ok || disposed) return;
      }
      try {
        await api.users.update(user.UserID, { IsActive: next });
        toast(next ? `Đã mở khóa tài khoản ${user.Username}.` : `Đã khóa tài khoản ${user.Username}.`, 'success');
        load();
      } catch (error) {
        showError(error, 'Không thể cập nhật trạng thái tài khoản.');
        if (error.status === 404) load();
      }
    },
    search() {
      els.search.focus();
      els.search.select();
    },
  };

  function applySearch(value) {
    const q = String(value || '').trim();
    if (q === state.q) return;
    state.q = q;
    state.page = 1;
    load();
  }
  const debouncedSearch = debounce(() => applySearch(els.search.value), 300);
  els.search.addEventListener('input', debouncedSearch);
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      debouncedSearch.cancel();
      applySearch(els.search.value);
    }
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const rowId = Number(button.closest('tr[data-id]')?.dataset.id);
    switch (button.dataset.action) {
      case 'create':
        actions.create();
        break;
      case 'edit':
        actions.edit(rowId);
        break;
      case 'delete':
        actions.delete(rowId);
        break;
      case 'toggle-active':
        actions.toggleActive(rowId);
        break;
      case 'reload':
        load();
        break;
      default:
    }
  });

  bindPager(els.pager, {
    onPage(page) {
      if (!Number.isInteger(page) || page < 1 || page > state.totalPages || page === state.page) return;
      state.page = page;
      load();
    },
    onPageSize(size) {
      state.pageSize = PAGE_SIZES.includes(size) ? size : 10;
      state.page = 1;
      load();
    },
  });

  const unregisterShortcuts = registerViewShortcuts({
    create: { run: () => actions.create(), permission: 'user.create', label: 'Thêm người dùng' },
    search: { run: () => actions.search(), label: 'Tìm người dùng' },
  });

  render();
  load();

  return () => {
    disposed = true;
    debouncedSearch.cancel();
    unregisterShortcuts();
  };
}
