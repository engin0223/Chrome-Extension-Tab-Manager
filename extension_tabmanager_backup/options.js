/**
 * Load settings from storage and restore checkbox state
 */
function loadSettings() {
  chrome.storage.sync.get({ moveTabsEnabled: false }, (items) => {
    document.getElementById('enableMoveTabs').checked = items.moveTabsEnabled;
  });
}

/**
 * Save settings to storage when checkbox is toggled
 */
document.getElementById('enableMoveTabs').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.storage.sync.set({ moveTabsEnabled: enabled }, () => {
    // Show success message briefly
    const msg = document.getElementById('statusMessage');
    msg.classList.add('success');
    setTimeout(() => {
      msg.classList.remove('success');
    }, 2000);
  });
});

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);
