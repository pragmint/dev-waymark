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

  capabilityTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      const capabilityId = tile.getAttribute('data-capability-id');
      if (capabilityId) {
        window.location.href = `/catalog/capability/${capabilityId}`;
      }
    });
  });
})();
