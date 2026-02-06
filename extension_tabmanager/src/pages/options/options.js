document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get({ moveTabsEnabled: false }, (items) => {
    document.getElementById('enableMoveTabs').checked = items.moveTabsEnabled;
  });
});

document.getElementById('enableMoveTabs').addEventListener('change', (e) => {
  chrome.storage.sync.set({ moveTabsEnabled: e.target.checked }, () => {
    const status = document.getElementById('status');
    status.classList.add('show');
    setTimeout(() => status.classList.remove('show'), 1500);
  });
});