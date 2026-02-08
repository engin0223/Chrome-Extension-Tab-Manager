// 1. Apply Theme
const applyTheme = () => {
  const isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  document.body.classList.toggle('light-theme', isLight);
};
applyTheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

// 2. Settings Logic
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