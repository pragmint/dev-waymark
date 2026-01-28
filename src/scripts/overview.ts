(function () {
  // Handle expand/collapse of capabilities view
  const toggleViewLink = document.getElementById('toggle-view');
  const topCapabilities = document.getElementById('top-capabilities');
  const expandedCapabilities = document.getElementById('expanded-capabilities');
  let isExpanded = false;

  if (toggleViewLink && topCapabilities && expandedCapabilities) {
    toggleViewLink.addEventListener('click', (e: Event) => {
      e.preventDefault();

      isExpanded = !isExpanded;

      if (isExpanded) {
        topCapabilities.style.display = 'none';
        expandedCapabilities.classList.add('visible');
        toggleViewLink.textContent = 'View Top 3 Capabilities';
      } else {
        topCapabilities.style.display = 'grid';
        expandedCapabilities.classList.remove('visible');
        toggleViewLink.textContent = 'View All Capabilities';
      }
    });
  }

  // Handle capability tile clicks - navigate to capability catalog page
  const capabilityTiles = document.querySelectorAll<HTMLElement>('.capability-tile');

  capabilityTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      const capabilityId = tile.getAttribute('data-capability-id');
      if (capabilityId) {
        window.location.href = `/catalog/capability/${capabilityId}`;
      }
    });
  });

  // Handle summary date selector dropdown
  const summaryDateSelect = document.getElementById('summary-date-select') as HTMLSelectElement | null;

  if (summaryDateSelect) {
    summaryDateSelect.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLSelectElement;
      const selectedDate = target.value;
      const options = target.options;
      const mostRecentDate = options[0].value;

      if (selectedDate === mostRecentDate) {
        window.location.href = '/';
      } else {
        window.location.href = `/archive/${selectedDate}/`;
      }
    });
  }
})();
