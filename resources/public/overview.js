(function () {
  'use strict';

  // Handle expand/collapse of capabilities view
  const toggleViewLink = document.getElementById('toggle-view');
  const topCapabilities = document.getElementById('top-capabilities');
  const expandedCapabilities = document.getElementById('expanded-capabilities');
  let isExpanded = false;

  if (toggleViewLink) {
    toggleViewLink.addEventListener('click', function (e) {
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
  const capabilityTiles = document.querySelectorAll('.capability-tile');

  capabilityTiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      const capabilityId = tile.getAttribute('data-capability-id');
      if (capabilityId) {
        // Navigate to the capability's catalog page
        window.location.href = '/catalog/capability/' + capabilityId;
      }
    });
  });

  // Handle summary date selector dropdown
  const summaryDateSelect = document.getElementById('summary-date-select');

  if (summaryDateSelect) {
    summaryDateSelect.addEventListener('change', function (e) {
      const selectedDate = e.target.value;

      // Get all options to find the most recent (first option)
      const options = e.target.options;
      const mostRecentDate = options[0].value;

      if (selectedDate === mostRecentDate) {
        // Navigate to the main overview page for the most recent summary
        window.location.href = '/';
      } else {
        // Navigate to the archive page for older summaries
        window.location.href = '/archive/' + selectedDate + '/';
      }
    });
  }
})();
