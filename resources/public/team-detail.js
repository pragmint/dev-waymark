(function () {
  'use strict';

  // Handle expand/collapse of capabilities view
  const toggleViewLink = document.getElementById('toggle-view');
  const targetedCapabilities = document.getElementById('targeted-capabilities');
  const expandedCapabilities = document.getElementById('expanded-capabilities');
  let isExpanded = false;

  if (toggleViewLink) {
    toggleViewLink.addEventListener('click', function (e) {
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
  const capabilityTiles = document.querySelectorAll('.capability-tile');

  capabilityTiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      const capabilityId = tile.getAttribute('data-capability-id');
      if (capabilityId) {
        // Navigate to the capability detail page
        window.location.href = '/catalog/capability/' + capabilityId;
      }
    });
  });
})();
