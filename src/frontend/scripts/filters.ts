document.addEventListener('DOMContentLoaded', () => {
  const addForm = document.querySelector<HTMLFormElement>('[data-filter-add-form]');
  const filterForm = document.querySelector<HTMLFormElement>('[data-filter-form]');

  if (!filterForm) return;

  // Ensure all widget panels start hidden with all inputs disabled,
  // except panels in editing mode (server-rendered open).
  filterForm.querySelectorAll<HTMLElement>('.filter-widget-panel').forEach(panel => {
    if (panel.dataset.filterEditing === 'true') return;
    panel.style.display = 'none';
    disableAllInputs(panel);
  });

  function disableAllInputs(container: HTMLElement) {
    container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach(el => {
        el.disabled = true;
        if (el instanceof HTMLInputElement) el.value = '';
        if (el instanceof HTMLSelectElement)
          Array.from(el.options).forEach(o => (o.selected = false));
      });
  }

  function openPanel(key: string) {
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const panel = filterForm!.querySelector<HTMLElement>(
      `.filter-widget-panel[data-filter-key="${escaped}"]`
    );
    if (!panel) return;

    panel.style.display = '';

    // If the panel has a mode system, only enable the active mode's inputs.
    const modesEl = panel.querySelector<HTMLElement>('[data-active-mode]');
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(el => {
      if (modesEl) {
        const modeContent = el.closest<HTMLElement>('[data-mode-content]');
        if (modeContent && modeContent.dataset.modeContent !== modesEl.dataset.activeMode) {
          return; // leave inactive mode inputs disabled
        }
      }
      el.disabled = false;
    });

    panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')?.focus();
    wireModeTabsForPanel(panel);
  }

  function closePanel(panel: HTMLElement) {
    panel.style.display = 'none';
    disableAllInputs(panel);
  }

  function wireModeTabsForPanel(panel: HTMLElement) {
    panel.querySelectorAll<HTMLButtonElement>('[data-mode-tab]').forEach(tab => {
      // Avoid double-wiring on repeated openPanel calls
      if (tab.dataset.wired) return;
      tab.dataset.wired = '1';

      tab.addEventListener('click', () => {
        const newMode = tab.dataset.modeTab!;
        const modesEl = panel.querySelector<HTMLElement>('[data-active-mode]');
        if (!modesEl || modesEl.dataset.activeMode === newMode) return;

        // Deactivate current mode
        const currentContent = modesEl.querySelector<HTMLElement>(
          `[data-mode-content="${modesEl.dataset.activeMode}"]`
        );
        if (currentContent) {
          currentContent.style.display = 'none';
          disableAllInputs(currentContent);
        }

        // Activate new mode
        const newContent = modesEl.querySelector<HTMLElement>(`[data-mode-content="${newMode}"]`);
        if (newContent) {
          newContent.style.display = '';
          newContent
            .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
            .forEach(el => (el.disabled = false));
          newContent.querySelector<HTMLElement>('input, select')?.focus();
        }

        modesEl.dataset.activeMode = newMode;

        panel.querySelectorAll<HTMLButtonElement>('[data-mode-tab]').forEach(t => {
          t.classList.toggle('filter-mode-tab--active', t.dataset.modeTab === newMode);
        });
      });
    });
  }

  // Cancel buttons inside widget panels
  filterForm.querySelectorAll<HTMLButtonElement>('[data-filter-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest<HTMLElement>('.filter-widget-panel');
      if (panel) closePanel(panel);
    });
  });

  if (!addForm) return;

  // Hide the no-JS submit button now that JS is running
  const addSubmit = addForm.querySelector<HTMLButtonElement>('[data-filter-add-submit]');
  if (addSubmit) addSubmit.hidden = true;

  const addSelect = addForm.querySelector<HTMLSelectElement>('[data-filter-add-select]');
  if (!addSelect) return;

  addSelect.addEventListener('change', () => {
    const key = addSelect.value;
    filterForm.querySelectorAll<HTMLElement>('.filter-widget-panel').forEach(closePanel);
    if (key) {
      openPanel(key);
      addSelect.value = '';
    }
  });

  // Save dataset panel toggle
  const saveBtn = document.getElementById('save-dataset-btn');
  const savePanel = document.getElementById('save-dataset-panel');
  const saveCancel = document.getElementById('save-dataset-cancel');

  if (saveBtn && savePanel) {
    saveBtn.addEventListener('click', () => {
      savePanel.style.display = '';
      savePanel.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    });
  }
  if (saveCancel && savePanel) {
    saveCancel.addEventListener('click', () => {
      savePanel.style.display = 'none';
    });
  }
});
