document.addEventListener('DOMContentLoaded', () => {
  wireTypeAndPresetControls();
  wireSavePresetPanel();
  wirePresetCombo();
  wirePresetNameDraftDetection();
  wireDeletePresetConfirm();
  wireFilterWidgets();
});

function wireTypeAndPresetControls() {
  // Hide all no-JS fallback "Go" buttons.
  document.querySelectorAll<HTMLElement>('[data-js-fallback]').forEach(el => {
    el.hidden = true;
  });

  const typeSelect = document.querySelector<HTMLSelectElement>('[data-type-select]');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const value = typeSelect.value;
      if (!value) return;
      location.href = `/entities?mf__entity_type__eq=${encodeURIComponent(value)}`;
    });
  }

  const presetSelect = document.querySelector<HTMLSelectElement>('[data-preset-select]');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const value = presetSelect.value;
      if (!value) return;
      location.href = value;
    });
  }
}

function wireSavePresetPanel() {
  const btn = document.getElementById('save-preset-btn');
  const panel = document.getElementById('save-preset-panel');
  const cancel = document.getElementById('save-preset-cancel');

  if (btn && panel) {
    btn.addEventListener('click', () => {
      panel.style.display = '';
      panel.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    });
  }
  if (cancel && panel) {
    cancel.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
}

function wirePresetCombo() {
  const combo = document.querySelector<HTMLElement>('[data-preset-combo]');
  if (!combo) return;

  const toggle = combo.querySelector<HTMLButtonElement>('[data-preset-combo-toggle]');
  const list = combo.querySelector<HTMLElement>('[data-preset-combo-list]');
  if (!toggle || !list) return;

  function open() {
    list!.hidden = false;
    toggle!.setAttribute('aria-expanded', 'true');
  }
  function close() {
    list!.hidden = true;
    toggle!.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    if (list.hidden) open();
    else close();
  });

  // Click outside closes the popup.
  document.addEventListener('click', e => {
    if (!combo.contains(e.target as Node)) close();
  });

  // Escape closes and returns focus to the toggle.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !list.hidden) {
      close();
      toggle.focus();
    }
  });
}

function wirePresetNameDraftDetection() {
  const form = document.querySelector<HTMLFormElement>('[data-preset-save-changes]');
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('[data-preset-name-input]');
  if (!input) return;

  const originalName = input.dataset.originalName ?? '';

  function sync() {
    // Server may have already marked this draft from the filter side. If JS
    // detects a name change too, force draft on; if neither, leave server's
    // call alone (don't downgrade — filter draft can be true while name is
    // unchanged).
    const nameChanged = input!.value !== originalName;
    if (nameChanged) {
      form!.dataset.isDraft = 'true';
    } else if (form!.dataset.serverIsDraft !== 'true') {
      form!.dataset.isDraft = 'false';
    }
  }

  // Capture the server's initial decision so we can fall back to it when the
  // name is reverted to its original value.
  form.dataset.serverIsDraft = form.dataset.isDraft ?? 'false';

  input.addEventListener('input', sync);
}

function wireDeletePresetConfirm() {
  const form = document.querySelector<HTMLFormElement>('[data-preset-delete-form]');
  if (!form) return;
  const name = form.dataset.presetName ?? 'this preset';
  form.addEventListener('submit', e => {
    if (!confirm(`Delete preset "${name}"?`)) {
      e.preventDefault();
    }
  });
}

function wireFilterWidgets() {
  const addForm = document.querySelector<HTMLFormElement>('[data-filter-add-form]');
  const filterForm = document.querySelector<HTMLFormElement>('[data-filter-form]');

  if (!filterForm) return;

  // Ensure all widget panels start hidden with all inputs disabled,
  // except panels in editing mode (server-rendered open).
  filterForm.querySelectorAll<HTMLElement>('.filter-widget-panel').forEach(panel => {
    if (panel.dataset.filterEditing === 'true') {
      wireModeTabsForPanel(panel);
      return;
    }
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
}
