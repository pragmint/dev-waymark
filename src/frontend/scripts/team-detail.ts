(function () {
  // Handle expand/collapse of capabilities view
  const toggleViewLink = document.getElementById('toggle-view');
  const targetedCapabilities = document.getElementById('targeted-capabilities');
  const expandedCapabilities = document.getElementById('expanded-capabilities');
  let isExpanded = false;

  if (toggleViewLink && targetedCapabilities && expandedCapabilities) {
    toggleViewLink.addEventListener('click', (e: Event) => {
      e.preventDefault();

      isExpanded = !isExpanded;

      if (isExpanded) {
        targetedCapabilities.style.display = 'none';
        expandedCapabilities.classList.add('visible');
        toggleViewLink.textContent = 'View Targeted Capabilities';
      } else {
        targetedCapabilities.style.display = 'grid';
        expandedCapabilities.classList.remove('visible');
        toggleViewLink.textContent = 'View All Capabilities';
      }
    });
  }

  // Handle capability tile clicks - navigate to capability detail page
  const capabilityTiles = document.querySelectorAll<HTMLElement>('.capability-tile');

  capabilityTiles.forEach(tile => {
    tile.addEventListener('click', () => {
      const capabilityId = tile.getAttribute('data-capability-id');
      if (capabilityId) {
        window.location.href = `/catalog/capability/${capabilityId}`;
      }
    });
  });

  // Experiment capability filter
  const multiselect = document.getElementById('capability-filter');
  if (multiselect) {
    const toggle = multiselect.querySelector<HTMLButtonElement>('.multiselect-toggle');
    const dropdown = multiselect.querySelector<HTMLElement>('.multiselect-dropdown');
    const checkboxes = multiselect.querySelectorAll<HTMLInputElement>(
      '.multiselect-option input[type="checkbox"]'
    );
    const cards = document.querySelectorAll<HTMLElement>('.experiment-card');

    if (toggle && dropdown) {
      // Toggle dropdown open/close
      toggle.addEventListener('click', () => {
        dropdown.classList.toggle('open');
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e: Event) => {
        if (!multiselect.contains(e.target as Node)) {
          dropdown.classList.remove('open');
        }
      });

      // Select all / deselect all
      const actions = multiselect.querySelectorAll<HTMLButtonElement>('.multiselect-action');
      actions.forEach(btn => {
        btn.addEventListener('click', () => {
          const checked = btn.dataset.action === 'select-all';
          checkboxes.forEach(cb => {
            cb.checked = checked;
          });
          filterCards();
        });
      });

      // Filter on checkbox change
      checkboxes.forEach(cb => {
        cb.addEventListener('change', filterCards);
      });
    }

    function filterCards() {
      const selected = new Set<string>();
      checkboxes.forEach(cb => {
        if (cb.checked) selected.add(cb.value);
      });

      // Update toggle button text
      if (toggle) {
        if (selected.size === checkboxes.length) {
          toggle.textContent = 'All capabilities \u25BE';
        } else {
          toggle.textContent = `${selected.size} of ${checkboxes.length} capabilities \u25BE`;
        }
      }

      // Show/hide cards
      cards.forEach(card => {
        const attr = card.getAttribute('data-capability-ids');
        const capIds: string[] = attr ? JSON.parse(attr) : [];

        // Cards with no capabilities are always visible
        if (capIds.length === 0) {
          card.style.display = '';
          return;
        }

        const match = capIds.some(id => selected.has(id));
        card.style.display = match ? '' : 'none';
      });
    }
  }
})();
