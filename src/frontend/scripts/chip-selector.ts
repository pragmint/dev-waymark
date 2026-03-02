/**
 * ChipSelector URL State Manager
 *
 * Manages multiple chip selector instances on a page, each with its own URL query parameter.
 * Uses URLSearchParams API and window.history to sync state without page reloads.
 */

/**
 * Get current URL search params
 */
function getUrlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Update URL with new params without triggering page reload
 */
function updateUrl(params: URLSearchParams): void {
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;

  window.history.replaceState({}, '', newUrl);
}

/**
 * Get selected values for a specific query key
 */
function getSelectedValues(queryKey: string): Set<string> {
  const params = getUrlParams();
  const value = params.get(queryKey);

  if (!value) {
    return new Set();
  }

  return new Set(value.split(',').filter(v => v.length > 0));
}

/**
 * Update selected values for a specific query key
 */
function setSelectedValues(queryKey: string, values: Set<string>): void {
  const params = getUrlParams();

  if (values.size === 0) {
    params.delete(queryKey);
  } else {
    params.set(queryKey, Array.from(values).join(','));
  }

  updateUrl(params);
}

/**
 * Toggle a chip's selection state
 */
function toggleChip(queryKey: string, value: string): void {
  const selected = getSelectedValues(queryKey);

  if (selected.has(value)) {
    selected.delete(value);
  } else {
    selected.add(value);
  }

  setSelectedValues(queryKey, selected);
  updateChipUI(queryKey);
}

/**
 * Clear all selections for a specific query key
 */
function clearChips(queryKey: string): void {
  setSelectedValues(queryKey, new Set());
  updateChipUI(queryKey);
}

/**
 * Update chip UI to reflect current URL state
 */
function updateChipUI(queryKey: string): void {
  const selected = getSelectedValues(queryKey);
  const chips = document.querySelectorAll<HTMLButtonElement>(`.chip[data-query-key="${queryKey}"]`);

  chips.forEach(chip => {
    const value = chip.getAttribute('data-value');
    if (value && selected.has(value)) {
      chip.classList.add('chip-selected');
    } else {
      chip.classList.remove('chip-selected');
    }
  });
}

/**
 * Update scroll indicators based on scroll position
 */
function updateScrollIndicators(container: HTMLElement): void {
  const hasScrollTop = container.scrollTop > 0;
  const hasScrollBottom = container.scrollTop < container.scrollHeight - container.clientHeight - 1;

  if (hasScrollTop) {
    container.classList.add('has-scroll-top');
  } else {
    container.classList.remove('has-scroll-top');
  }

  if (hasScrollBottom) {
    container.classList.add('has-scroll-bottom');
  } else {
    container.classList.remove('has-scroll-bottom');
  }
}

/**
 * Setup scroll behavior for a chip options container
 */
function setupScrollBehavior(container: HTMLElement): void {
  // Update indicators on scroll
  container.addEventListener('scroll', () => {
    updateScrollIndicators(container);
  });

  // Initial check for scroll indicators
  updateScrollIndicators(container);

  // Update on window resize
  const resizeObserver = new ResizeObserver(() => {
    updateScrollIndicators(container);
  });
  resizeObserver.observe(container);
}

/**
 * Initialize all chip selectors on the page
 */
function initializeChipSelectors(): void {
  // Find all unique query keys
  const selectors = document.querySelectorAll<HTMLElement>('.chip-selector');
  const queryKeys = new Set<string>();

  selectors.forEach(selector => {
    const queryKey = selector.getAttribute('data-query-key');
    if (queryKey) {
      queryKeys.add(queryKey);
    }
  });

  // Initialize UI for each query key
  queryKeys.forEach(queryKey => {
    updateChipUI(queryKey);

    // Setup scroll behavior for chip options container
    const optionsContainer = document.querySelector<HTMLElement>(
      `.chip-selector[data-query-key="${queryKey}"] .chip-selector-options`
    );
    if (optionsContainer) {
      setupScrollBehavior(optionsContainer);
    }

    // Attach click handlers to chips
    const chips = document.querySelectorAll<HTMLButtonElement>(
      `.chip[data-query-key="${queryKey}"]`
    );
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.getAttribute('data-value');
        if (value) {
          toggleChip(queryKey, value);
        }
      });
    });

    // Attach click handler to clear button
    const clearBtn = document.querySelector<HTMLButtonElement>(
      `.chip-clear-btn[data-query-key="${queryKey}"]`
    );
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        clearChips(queryKey);
      });
    }
  });

  // Listen for popstate (browser back/forward)
  window.addEventListener('popstate', () => {
    queryKeys.forEach(queryKey => {
      updateChipUI(queryKey);
    });
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChipSelectors);
} else {
  initializeChipSelectors();
}
