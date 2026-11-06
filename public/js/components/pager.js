/**
 * Pager: page size select, "Tổng: N …", first / prev / numbered / next / last.
 * Buttons carry data-page (target page) and data-pager-key (to restore keyboard focus after re-render).
 */
import { html, setHtml } from '../html.js';
import { icon } from '../icons.js';
import { formatNumber } from '../format.js';

function pageWindow(page, totalPages, size = 5) {
  let start = Math.max(1, page - Math.floor(size / 2));
  const end = Math.min(totalPages, start + size - 1);
  start = Math.max(1, end - size + 1);
  const pages = [];
  for (let p = start; p <= end; p += 1) pages.push(p);
  return pages;
}

export function pagerTemplate({ page, totalPages, total, pageSize, pageSizes, unit, count }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = total === 0 ? 0 : from + Math.max(0, count - 1);
  const navButton = (key, target, label, iconName, disabled) =>
    html`<button type="button" class="pager__btn" data-pager-key="${key}" data-page="${target}" aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>${icon(iconName, { size: 16 })}</button>`;

  return html`<div class="pager__info">
      <span>Tổng: <strong>${formatNumber(total)}</strong> ${unit}</span>
      ${total ? html`<span class="pager__range">Hiển thị ${formatNumber(from)}–${formatNumber(to)} · Trang ${page}/${totalPages}</span>` : ''}
    </div>
    <div class="pager__controls">
      <label class="pager__size">
        <span>Số dòng/trang</span>
        <select class="input input--sm" data-pager="size" data-pager-key="size">
          ${pageSizes.map((size) => html`<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`)}
        </select>
      </label>
      <nav class="pager__nav" aria-label="Phân trang">
        ${navButton('first', 1, 'Trang đầu', 'chevronsLeft', page <= 1)}
        ${navButton('prev', page - 1, 'Trang trước', 'chevronLeft', page <= 1)}
        ${pageWindow(page, totalPages).map(
          (p) => html`<button type="button" class="pager__btn pager__num ${p === page ? 'is-current' : ''}" data-pager-key="p${p}" data-page="${p}"
            aria-label="Trang ${p}" ${p === page ? html`aria-current="page"` : ''}>${p}</button>`,
        )}
        ${navButton('next', page + 1, 'Trang sau', 'chevronRight', page >= totalPages)}
        ${navButton('last', totalPages, 'Trang cuối', 'chevronsRight', page >= totalPages)}
      </nav>
    </div>`;
}

export function renderPager(container, options) {
  const active = document.activeElement;
  const focusKey = active && container.contains(active) ? active.dataset.pagerKey : null;
  setHtml(container, pagerTemplate(options));
  if (focusKey) {
    const target =
      container.querySelector(`[data-pager-key="${focusKey}"]:not(:disabled)`) ||
      container.querySelector('[aria-current="page"]');
    target?.focus();
  }
}

export function bindPager(container, { onPage, onPageSize }) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    onPage(Number(button.dataset.page));
  });
  container.addEventListener('change', (event) => {
    if (event.target.matches('select[data-pager="size"]')) onPageSize(Number(event.target.value));
  });
}
