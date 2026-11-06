/**
 * Students view: toolbar, debounced server-side search, selectable table, pager.
 * Buttons and keyboard shortcuts call the same `actions` functions (which check permissions).
 */
import { api } from '../../api.js';
import { html, setHtml } from '../../html.js';
import { icon } from '../../icons.js';
import { can } from '../../session.js';
import { toast, showError, confirmDialog, requirePermission, debounce, spinner } from '../../ui.js';
import { formatNumber, studentCode } from '../../format.js';
import { registerViewShortcuts, openShortcutHelp } from '../../shortcuts.js';
import { renderPager, bindPager } from '../../components/pager.js';
import { loadColumnPrefs, visibleColumns, openColumnConfig } from './columns.js';
import { openStudentForm } from './form.js';
import { openStudentDetail } from './detail.js';
import { openImportModal, openExportModal } from './import-export.js';

const PAGE_SIZES = [10, 15];
const PAGE_SIZE_KEY = 'qlsv.students.pageSize';

function readPageSize() {
  try {
    const size = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(size) ? size : 10;
  } catch {
    return 10;
  }
}

function savePageSize(size) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    /* ignore */
  }
}

function toolbarButton(action, label, iconName, keys, { variant = 'btn-secondary', permission = null, title = label } = {}) {
  if (permission && !can(permission)) return '';
  return html`<button type="button" class="btn ${variant}" data-action="${action}" aria-keyshortcuts="${keys}" title="${title} (${keys})">
    ${icon(iconName, { size: 16 })}<span class="btn__label">${label}</span><kbd class="btn__kbd">${keys}</kbd>
  </button>`;
}

export function mountStudents(root) {
  const state = {
    page: 1,
    pageSize: readPageSize(),
    q: '',
    items: [],
    total: 0,
    totalPages: 1,
    selected: new Set(),
    highlight: new Set(),
    columnPrefs: loadColumnPrefs(),
    loading: false,
    loadedOnce: false,
    error: null,
    busy: false,
    opening: false,
    seq: 0,
  };
  let disposed = false;

  setHtml(
    root,
    html`<div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">Danh sách sinh viên</h1>
          <p class="page-subtitle">Tra cứu, cập nhật hồ sơ và nhập/xuất dữ liệu sinh viên.</p>
        </div>
      </div>
      <section class="card">
        <div class="toolbar" role="group" aria-label="Thao tác với sinh viên" data-role="toolbar">
          <div class="toolbar__group">
            ${toolbarButton('create', 'Thêm', 'plus', 'Alt+N', { variant: 'btn-primary', permission: 'student.create', title: 'Thêm sinh viên' })}
            ${toolbarButton('edit', 'Sửa', 'edit', 'Alt+U', { permission: 'student.update', title: 'Sửa sinh viên đang chọn' })}
            ${toolbarButton('view', 'Xem', 'eye', 'Alt+V', { permission: 'student.read', title: 'Xem chi tiết sinh viên đang chọn' })}
            ${toolbarButton('delete', 'Xóa', 'trash', 'Alt+X', { variant: 'btn-danger-soft', permission: 'student.delete', title: 'Xóa các sinh viên đang chọn' })}
            ${toolbarButton('copy', 'Sao chép', 'copy', 'Alt+C', { permission: 'student.create', title: 'Sao chép các sinh viên đang chọn' })}
          </div>
          <div class="toolbar__group">
            ${toolbarButton('import', 'Nhập file', 'upload', 'Alt+I', { permission: 'student.import' })}
            ${toolbarButton('export', 'Xuất file', 'download', 'Alt+E', { permission: 'student.export', title: 'Xuất file (xlsx/json/xml)' })}
            ${toolbarButton('columns', 'Cột', 'columns', 'Alt+K', { title: 'Cấu hình cột hiển thị' })}
            ${toolbarButton('help', 'Phím tắt', 'keyboard', 'Alt+H', { variant: 'btn-ghost', title: 'Danh sách phím tắt' })}
          </div>
        </div>
        <div class="filters">
          <div class="search-box">
            ${icon('search', { size: 18 })}
            <label class="sr-only" for="student-search">Tìm kiếm sinh viên</label>
            <input id="student-search" class="input" type="search" maxlength="100" autocomplete="off" spellcheck="false"
              placeholder="Tìm theo mã SV, họ tên, lớp, ngành, email, SĐT…" aria-keyshortcuts="Alt+Q" enterkeyhint="search">
            <kbd class="search-box__kbd" aria-hidden="true">Alt+Q</kbd>
          </div>
          <div class="selection-bar" data-role="selection" aria-live="polite"></div>
        </div>
        <div class="table-wrap" data-role="table-wrap" role="region" aria-label="Bảng danh sách sinh viên" tabindex="0">
          <table class="data-table data-table--students">
            <caption class="sr-only" data-role="caption"></caption>
            <thead data-role="thead"></thead>
            <tbody data-role="tbody"></tbody>
          </table>
          <div class="table-overlay" aria-hidden="true">${spinner()}<span>Đang tải…</span></div>
        </div>
        <div class="pager" data-role="pager"></div>
      </section>`,
  );

  const els = {
    toolbar: root.querySelector('[data-role="toolbar"]'),
    search: root.querySelector('#student-search'),
    selection: root.querySelector('[data-role="selection"]'),
    wrap: root.querySelector('[data-role="table-wrap"]'),
    caption: root.querySelector('[data-role="caption"]'),
    thead: root.querySelector('[data-role="thead"]'),
    tbody: root.querySelector('[data-role="tbody"]'),
    pager: root.querySelector('[data-role="pager"]'),
  };

  /* ------------------------------------------------------------ data */

  async function load({ highlight = [] } = {}) {
    const seq = (state.seq += 1);
    state.loading = true;
    renderLoading();
    try {
      const response = await api.students.list({ page: state.page, pageSize: state.pageSize, q: state.q });
      if (disposed || seq !== state.seq) return;
      state.items = Array.isArray(response?.items) ? response.items : [];
      state.total = Number(response?.total) || 0;
      state.totalPages = Math.max(1, Number(response?.totalPages) || 1);
      state.page = Number(response?.page) || state.page; // the server clamps page > totalPages
      const visibleIds = new Set(state.items.map((s) => s.StudentID));
      for (const selectedId of [...state.selected]) if (!visibleIds.has(selectedId)) state.selected.delete(selectedId);
      state.highlight = new Set(highlight);
      state.error = null;
    } catch (error) {
      if (disposed || seq !== state.seq) return;
      state.error = error;
      showError(error, 'Không tải được danh sách sinh viên.');
    } finally {
      if (!disposed && seq === state.seq) {
        state.loading = false;
        state.loadedOnce = true;
        renderAll();
      }
    }
  }

  /* ------------------------------------------------------------ render */

  function renderLoading() {
    // Skeleton rows cover the first load; afterwards an overlay dims the current rows.
    els.wrap.classList.toggle('is-loading', state.loading && state.loadedOnce);
    els.wrap.setAttribute('aria-busy', String(state.loading));
  }

  function rowActions(s) {
    const label = `${s.FullName} (${s.StudentCode || studentCode(s.StudentID)})`;
    const button = (action, iconName, text, permission, extra = '') =>
      can(permission)
        ? html`<button type="button" class="btn-icon ${extra}" data-action="${action}" title="${text}" aria-label="${text} ${label}">${icon(iconName, { size: 16 })}</button>`
        : '';
    return html`${button('view', 'eye', 'Xem', 'student.read')}${button('edit', 'edit', 'Sửa', 'student.update')}${button('copy', 'copy', 'Sao chép', 'student.create')}${button('delete', 'trash', 'Xóa', 'student.delete', 'btn-icon--danger')}`;
  }

  function rowTemplate(s, columns) {
    const selected = state.selected.has(s.StudentID);
    const classes = [selected ? 'is-selected' : '', state.highlight.has(s.StudentID) ? 'is-highlight' : ''].join(' ').trim();
    return html`<tr data-id="${s.StudentID}" class="${classes}">
      <td class="col-select"><input type="checkbox" data-role="select-row" value="${s.StudentID}" ${selected ? 'checked' : ''}
        aria-label="Chọn ${s.FullName} (${s.StudentCode || studentCode(s.StudentID)})"></td>
      ${columns.map((column) => column.cell(s))}
      <td class="col-actions"><div class="row-actions">${rowActions(s)}</div></td>
    </tr>`;
  }

  function messageRow(colspan, content) {
    return html`<tr class="table-message"><td colspan="${colspan}">${content}</td></tr>`;
  }

  function renderTable() {
    const columns = visibleColumns(state.columnPrefs);
    const colspan = columns.length + 2;
    setHtml(
      els.thead,
      html`<tr>
        <th scope="col" class="col-select"><input type="checkbox" data-role="select-all" aria-label="Chọn tất cả sinh viên trên trang này"></th>
        ${columns.map((column) => html`<th scope="col" class="${column.className}">${column.label}</th>`)}
        <th scope="col" class="col-actions">Thao tác</th>
      </tr>`,
    );

    let body;
    if (!state.loadedOnce) {
      body = Array.from({ length: Math.min(state.pageSize, 8) }, () =>
        html`<tr class="skeleton-row" aria-hidden="true">${Array.from({ length: colspan }, () => html`<td><span class="skeleton"></span></td>`)}</tr>`,
      );
    } else if (state.error && !state.items.length) {
      body = messageRow(
        colspan,
        html`<div class="empty-state">${icon('alert', { size: 28 })}<p>Không tải được danh sách sinh viên.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="reload">${icon('refresh', { size: 16 })} Thử lại</button></div>`,
      );
    } else if (!state.items.length) {
      body = messageRow(
        colspan,
        state.q
          ? html`<div class="empty-state">${icon('search', { size: 28 })}<p>Không tìm thấy sinh viên phù hợp với “<strong>${state.q}</strong>”.</p>
              <button type="button" class="btn btn-secondary btn-sm" data-action="clear-search">Xóa từ khóa tìm kiếm</button></div>`
          : html`<div class="empty-state">${icon('student', { size: 28 })}<p>Chưa có sinh viên nào.</p>
              ${can('student.create') ? html`<button type="button" class="btn btn-primary btn-sm" data-action="create">${icon('plus', { size: 16 })} Thêm sinh viên</button>` : ''}</div>`,
      );
    } else {
      body = state.items.map((s) => rowTemplate(s, columns));
    }
    setHtml(els.tbody, html`${body}`);
    els.caption.textContent = `Danh sách sinh viên, trang ${state.page}/${state.totalPages}, tổng ${state.total} sinh viên`;
    state.highlight.clear(); // animate only once
    updateSelectionUI();
  }

  function renderPagerArea() {
    renderPager(els.pager, {
      page: state.page,
      totalPages: state.totalPages,
      total: state.total,
      pageSize: state.pageSize,
      pageSizes: PAGE_SIZES,
      unit: 'sinh viên',
      count: state.items.length,
    });
  }

  function renderAll() {
    renderLoading();
    renderTable();
    renderPagerArea();
    updateToolbarState();
  }

  function updateSelectionUI() {
    els.tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      const on = state.selected.has(Number(row.dataset.id));
      row.classList.toggle('is-selected', on);
      const checkbox = row.querySelector('[data-role="select-row"]');
      if (checkbox) checkbox.checked = on;
    });
    const count = state.selected.size;
    const pageCount = state.items.length;
    const selectAll = els.thead.querySelector('[data-role="select-all"]');
    if (selectAll) {
      selectAll.checked = pageCount > 0 && count === pageCount;
      selectAll.indeterminate = count > 0 && count < pageCount;
      selectAll.disabled = pageCount === 0;
    }
    setHtml(
      els.selection,
      count
        ? html`<span>Đã chọn <strong>${count}</strong> sinh viên trên trang này</span>
            <button type="button" class="btn-link" data-action="clear-selection">Bỏ chọn</button>`
        : html`<span class="muted">${state.q ? html`Kết quả cho “${state.q}”: ${formatNumber(state.total)} sinh viên` : 'Chọn dòng bằng ô đánh dấu hoặc nhấp vào dòng.'}</span>`,
    );
  }

  function updateToolbarState() {
    els.toolbar.querySelectorAll('[data-action="delete"], [data-action="copy"]').forEach((button) => {
      button.disabled = state.busy;
    });
  }

  /* ------------------------------------------------------------ selection */

  const selectedIds = () => state.items.filter((s) => state.selected.has(s.StudentID)).map((s) => s.StudentID);

  function clearSelection() {
    state.selected.clear();
    updateSelectionUI();
  }

  function setSelected(studentId, on) {
    if (on) state.selected.add(studentId);
    else state.selected.delete(studentId);
    updateSelectionUI();
  }

  function selectAllOnPage(on) {
    for (const s of state.items) {
      if (on) state.selected.add(s.StudentID);
      else state.selected.delete(s.StudentID);
    }
    updateSelectionUI();
  }

  function exactlyOne(ids, verb) {
    if (ids.length === 1) return ids[0];
    toast(
      ids.length === 0
        ? `Vui lòng chọn 1 sinh viên để ${verb}.`
        : `Chỉ chọn đúng 1 sinh viên để ${verb} (đang chọn ${ids.length}).`,
      'warning',
    );
    return null;
  }

  const findStudent = (studentId) => state.items.find((s) => s.StudentID === studentId);
  const goToPage = (page) => {
    state.page = page;
    clearSelection();
    load();
  };

  /* ------------------------------------------------------------ actions (buttons + shortcuts) */

  const actions = {
    create() {
      if (!requirePermission('student.create')) return;
      openStudentForm({
        onSaved: (saved) => {
          state.page = 1;
          clearSelection();
          load({ highlight: saved ? [saved.StudentID] : [] });
        },
      });
    },

    async edit(ids = selectedIds()) {
      if (!requirePermission('student.update')) return;
      const studentId = exactlyOne(ids, 'sửa');
      if (studentId == null || state.opening) return;
      state.opening = true;
      try {
        const student = await api.students.get(studentId);
        if (disposed) return;
        openStudentForm({
          student,
          onSaved: (saved) => load({ highlight: saved ? [saved.StudentID] : [] }),
          onNotFound: () => load(),
        });
      } catch (error) {
        showError(error, 'Không tải được thông tin sinh viên.');
        if (error.status === 404) load();
      } finally {
        state.opening = false;
      }
    },

    view(ids = selectedIds()) {
      if (!requirePermission('student.read')) return;
      const studentId = exactlyOne(ids, 'xem');
      if (studentId == null) return;
      openStudentDetail(studentId, { onEdit: (sid) => actions.edit([sid]), onNotFound: () => load() });
    },

    async delete(ids = selectedIds()) {
      if (!requirePermission('student.delete')) return;
      if (!ids.length) {
        toast('Vui lòng chọn ít nhất 1 sinh viên để xóa.', 'warning');
        return;
      }
      if (state.busy) return;
      const targets = ids.map(findStudent).filter(Boolean);
      const single = ids.length === 1 ? targets[0] : null;
      const preview = targets.slice(0, 5);
      const ok = await confirmDialog({
        title: ids.length === 1 ? 'Xóa sinh viên' : `Xóa ${ids.length} sinh viên`,
        message: single
          ? html`Bạn có chắc muốn xóa sinh viên <strong>${single.FullName}</strong> (${single.StudentCode || studentCode(single.StudentID)})?`
          : html`Bạn có chắc muốn xóa <strong>${ids.length}</strong> sinh viên đã chọn?`,
        details: html`${!single && preview.length
            ? html`<ul class="confirm__list">${preview.map((s) => html`<li>${s.FullName} <span class="muted">(${s.StudentCode || studentCode(s.StudentID)})</span></li>`)}
                ${targets.length > preview.length ? html`<li class="muted">… và ${targets.length - preview.length} sinh viên khác</li>` : ''}</ul>`
            : ''}
          <p class="muted small">Thao tác này không thể hoàn tác.</p>`,
        confirmText: 'Xóa',
        danger: true,
      });
      if (!ok || disposed) return;
      state.busy = true;
      updateToolbarState();
      try {
        const result = ids.length === 1 ? await api.students.remove(ids[0]) : await api.students.bulkDelete(ids);
        const deleted = Number(result?.deleted) || ids.length;
        toast(`Đã xóa ${deleted} sinh viên.`, 'success');
        const remaining = Math.max(0, state.total - deleted);
        state.page = Math.min(state.page, Math.max(1, Math.ceil(remaining / state.pageSize))); // nearest valid page
        clearSelection();
        await load();
      } catch (error) {
        showError(error, 'Không thể xóa sinh viên.');
        if (error.status === 404) {
          clearSelection();
          load();
        }
      } finally {
        state.busy = false;
        if (!disposed) updateToolbarState();
      }
    },

    async copy(ids = selectedIds()) {
      if (!requirePermission('student.create')) return;
      if (!ids.length) {
        toast('Vui lòng chọn ít nhất 1 sinh viên để sao chép.', 'warning');
        return;
      }
      if (state.busy) return;
      state.busy = true;
      updateToolbarState();
      try {
        const result = await api.students.bulkCopy(ids);
        const items = Array.isArray(result?.items) ? result.items : [];
        toast(`Đã sao chép ${Number(result?.copied) || items.length} sinh viên.`, 'success');
        state.page = 1; // copies get the newest IDs -> first page (ORDER BY StudentID DESC)
        clearSelection();
        await load({ highlight: items.map((s) => s.StudentID) });
      } catch (error) {
        showError(error, 'Không thể sao chép sinh viên.');
        if (error.status === 404) load();
      } finally {
        state.busy = false;
        if (!disposed) updateToolbarState();
      }
    },

    search() {
      els.search.focus();
      els.search.select();
    },

    import() {
      if (!requirePermission('student.import')) return;
      openImportModal({
        onImported: () => {
          state.page = 1;
          clearSelection();
          load();
        },
      });
    },

    export() {
      if (!requirePermission('student.export')) return;
      openExportModal({ q: state.q, total: state.total });
    },

    columns() {
      openColumnConfig({
        prefs: state.columnPrefs,
        onChange: (prefs) => {
          state.columnPrefs = prefs;
          renderTable();
        },
      });
    },

    help() {
      openShortcutHelp();
    },
  };

  /* ------------------------------------------------------------ events */

  function applySearch(value) {
    const q = String(value || '').trim();
    if (q === state.q) return;
    state.q = q;
    state.page = 1;
    clearSelection();
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
    if (button && root.contains(button)) {
      if (button.disabled) return;
      const rowId = button.closest('tr[data-id]')?.dataset.id;
      const ids = rowId ? [Number(rowId)] : undefined;
      switch (button.dataset.action) {
        case 'clear-selection':
          clearSelection();
          break;
        case 'clear-search':
          els.search.value = '';
          applySearch('');
          els.search.focus();
          break;
        case 'reload':
          load();
          break;
        default:
          actions[button.dataset.action]?.(ids);
      }
      return;
    }
    /* Clicking a row (outside controls) toggles its selection. */
    const row = event.target.closest('tbody tr[data-id]');
    if (row && !event.target.closest('a, button, input, label, select, textarea')) {
      const studentId = Number(row.dataset.id);
      setSelected(studentId, !state.selected.has(studentId));
    }
  });

  root.addEventListener('dblclick', (event) => {
    const row = event.target.closest('tbody tr[data-id]');
    if (row && !event.target.closest('a, button, input, label')) actions.view([Number(row.dataset.id)]);
  });

  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-role="select-all"]')) selectAllOnPage(event.target.checked);
    else if (event.target.matches('[data-role="select-row"]')) setSelected(Number(event.target.value), event.target.checked);
  });

  /* Broken image -> placeholder initials (error events don't bubble: use capture). */
  root.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (img instanceof HTMLImageElement && img.classList.contains('avatar')) {
        const placeholder = document.createElement('span');
        placeholder.className = 'avatar avatar--sm avatar--c0';
        placeholder.textContent = img.dataset.initials || '?';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', 'Không tải được ảnh');
        img.replaceWith(placeholder);
      }
    },
    true,
  );

  bindPager(els.pager, {
    onPage(page) {
      if (!Number.isInteger(page) || page < 1 || page > state.totalPages || page === state.page) return;
      goToPage(page);
    },
    onPageSize(size) {
      const next = PAGE_SIZES.includes(size) ? size : 10;
      if (next === state.pageSize) return;
      const firstIndex = (state.page - 1) * state.pageSize; // keep the first visible row on screen
      state.pageSize = next;
      savePageSize(next);
      goToPage(Math.floor(firstIndex / next) + 1);
    },
  });

  const unregisterShortcuts = registerViewShortcuts({
    create: { run: () => actions.create(), permission: 'student.create', label: 'Thêm sinh viên' },
    edit: { run: () => actions.edit(), permission: 'student.update' },
    view: { run: () => actions.view(), permission: 'student.read' },
    delete: { run: () => actions.delete(), permission: 'student.delete' },
    copy: { run: () => actions.copy(), permission: 'student.create' },
    search: { run: () => actions.search() },
    import: { run: () => actions.import(), permission: 'student.import' },
    export: { run: () => actions.export(), permission: 'student.export' },
    columns: { run: () => actions.columns() },
  });

  renderAll();
  load();

  return () => {
    disposed = true;
    debouncedSearch.cancel();
    unregisterShortcuts();
  };
}
