// Adds paging-arrow behavior to any [data-table-scroll-wrap] element on the page.
// Each click moves the inner [data-table-scroll-container] by ~one viewport-width
// of columns. Arrows hide entirely when there's no overflow.
//
// Re-runs on the `entities:results-swapped` event so freshly fetched tables get
// wired after the results region is replaced by the filter auto-apply path.

const COLUMN_PEEK_PX = 60;

function initTableScrollers(root: ParentNode = document) {
  const wraps = root.querySelectorAll<HTMLElement>('[data-table-scroll-wrap]');

  wraps.forEach(wrap => {
    if (wrap.dataset.tableScrollWired === '1') return;
    wrap.dataset.tableScrollWired = '1';

    const container = wrap.querySelector<HTMLElement>('[data-table-scroll-container]');
    const leftBtn = wrap.querySelector<HTMLButtonElement>('[data-table-scroll="left"]');
    const rightBtn = wrap.querySelector<HTMLButtonElement>('[data-table-scroll="right"]');
    if (!container || !leftBtn || !rightBtn) return;

    const pageWidth = () => Math.max(container.clientWidth - COLUMN_PEEK_PX, 100);

    const updateButtons = () => {
      const max = container.scrollWidth - container.clientWidth;
      const hasOverflow = max > 1;
      wrap.classList.toggle('table-scroll-wrap--has-overflow', hasOverflow);
      leftBtn.disabled = !hasOverflow || container.scrollLeft <= 0;
      rightBtn.disabled = !hasOverflow || container.scrollLeft >= max - 1;
    };

    leftBtn.addEventListener('click', () => {
      container.scrollBy({ left: -pageWidth(), behavior: 'smooth' });
    });
    rightBtn.addEventListener('click', () => {
      container.scrollBy({ left: pageWidth(), behavior: 'smooth' });
    });

    container.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons);
    updateButtons();
  });
}

document.addEventListener('DOMContentLoaded', () => initTableScrollers());
document.addEventListener('entities:results-swapped', () => initTableScrollers());
