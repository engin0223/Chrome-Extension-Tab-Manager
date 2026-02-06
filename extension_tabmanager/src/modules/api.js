import { state } from './store.js';

/**
 * Fetches all windows and tabs, updating the store.
 */
export async function fetchWindowsAndTabs() {
  await refreshUiWindowId();
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const sorted = windows.sort((a, b) => a.id - b.id);

    // Load saved names
    const storage = await chrome.storage.local.get({ savedWindowNames: {} });
    state.savedWindowNames = storage.savedWindowNames;

    sorted.forEach(w => {
      if (state.savedWindowNames[w.id]) {
        w.customName = state.savedWindowNames[w.id];
      }
    });

    state.setWindows(sorted);
    
    // Default active window logic
    if (state.windowsData.length > 0) {
      const validIds = new Set(state.windowsData.map(w => w.id));
      // Cleanup search targets
      for (const id of state.searchTargetWindowIds) {
        if (!validIds.has(id)) state.searchTargetWindowIds.delete(id);
      }
      
      if (!state.activeWindowId || !validIds.has(state.activeWindowId)) {
        state.activeWindowId = state.windowsData[state.windowsData.length - 1].id;
      }
      
      if (!state.searchTargetWindowIds.has(state.activeWindowId)) {
        state.searchTargetWindowIds.add(state.activeWindowId);
      }
    }
  } catch (error) {
    console.error('Error fetching windows:', error);
  }
}

export async function refreshUiWindowId() {
  try {
    const url = chrome.runtime.getURL('src/pages/ui/ui.html');
    const tabs = await new Promise(resolve => chrome.tabs.query({ url }, resolve));
    if (tabs && tabs.length) {
      state.uiWindowId = tabs[0].windowId;
    }
  } catch (e) { /* ignore */ }
}

export async function saveWindowName(name, windowId) {
  state.savedWindowNames[windowId] = name;
  await chrome.storage.local.set({ savedWindowNames: state.savedWindowNames });
}

export async function createNewWindow() {
    await chrome.windows.create({ state: 'normal' });
    await fetchWindowsAndTabs();
}

export async function closeWindow(id) {
    await chrome.windows.remove(id);
    await fetchWindowsAndTabs();
}

export async function closeTab(id) {
    await chrome.tabs.remove(id);
}

export async function activateTab(windowId, tabId) {
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
}

export async function moveTabs(tabIds, targetWindowId, index = -1) {
    await chrome.tabs.move(tabIds, { windowId: targetWindowId, index });
}

export async function createSplitWindow(tabIds) {
    const firstId = tabIds.shift();
    const newWin = await chrome.windows.create({ tabId: firstId, state: 'normal' });
    if (tabIds.length > 0) {
        await chrome.tabs.move(tabIds, { windowId: newWin.id, index: -1 });
    }
    return newWin;
}