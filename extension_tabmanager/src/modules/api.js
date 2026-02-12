import { state } from './store.js';

/**
 * Fetches all windows and tabs, updating the store.
 */
export async function fetchWindowsAndTabs() {
  await refreshUiWindowId();
  try {
    // 1. Get Open Groups (Read Only)
    if (chrome.tabGroups) {
        const groups = await chrome.tabGroups.query({});
        state.setTabGroups(groups);
    }

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

// --- Group Action Helpers ---

export async function getTabsInGroup(groupId) {
    return await chrome.tabs.query({ groupId });
}

export async function ungroupTabs(groupId) {
    const tabs = await getTabsInGroup(groupId);
    const ids = tabs.map(t => t.id);
    if(ids.length) await chrome.tabs.ungroup(ids);
    
    const storage = await chrome.storage.local.get({ groupMappings: {} });
    if(storage.groupMappings[groupId]) {
        delete storage.groupMappings[groupId];
        await chrome.storage.local.set({ groupMappings: storage.groupMappings });
    }
}

export async function closeGroupTabs(groupId) {
    const tabs = await getTabsInGroup(groupId);
    const ids = tabs.map(t => t.id);
    if(ids.length) await chrome.tabs.remove(ids);
}

export async function moveGroupToNewWindow(groupId) {
    const tabs = await getTabsInGroup(groupId);
    if(!tabs.length) return;
    
    let groupMeta = null;
    try {
        if(chrome.tabGroups) groupMeta = await chrome.tabGroups.get(groupId);
    } catch(e) {}

    const first = tabs[0];
    const rest = tabs.slice(1);
    
    const newWin = await chrome.windows.create({ tabId: first.id });
    
    if(rest.length) {
        await chrome.tabs.move(rest.map(t=>t.id), { windowId: newWin.id, index: -1 });
    }
    
    const newIds = tabs.map(t => t.id);
    const newGroupId = await chrome.tabs.group({ tabIds: newIds, createProperties: { windowId: newWin.id } });
    
    if (groupMeta && chrome.tabGroups) {
        await chrome.tabGroups.update(newGroupId, { 
            title: groupMeta.title, 
            color: groupMeta.color, 
            collapsed: groupMeta.collapsed 
        });
        
        const storage = await chrome.storage.local.get({ groupMappings: {} });
        if (storage.groupMappings[groupId]) {
            storage.groupMappings[newGroupId] = storage.groupMappings[groupId];
            delete storage.groupMappings[groupId];
            await chrome.storage.local.set({ groupMappings: storage.groupMappings });
        }
    }
}

export async function addTabToGroup(groupId) {
    const tabs = await getTabsInGroup(groupId);
    if(!tabs.length) return;
    const lastTab = tabs[tabs.length-1];
    const newTab = await chrome.tabs.create({ windowId: lastTab.windowId, index: lastTab.index + 1 });
    await chrome.tabs.group({ tabIds: newTab.id, groupId: groupId });
}

export async function restoreGroup(groupData) {
    if (!groupData.tabs.length) return;

    await chrome.storage.local.set({ pendingRestoreId: groupData.id });

    const firstTabUrl = groupData.tabs[0].url;
    const newTab = await chrome.tabs.create({ url: firstTabUrl, active: true });
    
    const tabIds = [newTab.id];
    for (let i = 1; i < groupData.tabs.length; i++) {
        const t = await chrome.tabs.create({ url: groupData.tabs[i].url, active: false });
        tabIds.push(t.id);
    }

    const groupId = await chrome.tabs.group({ tabIds });
    
    if (chrome.tabGroups) {
        await chrome.tabGroups.update(groupId, {
            title: groupData.title,
            color: groupData.color
        });
    }

    const storage = await chrome.storage.local.get({ groupMappings: {} });
    storage.groupMappings[groupId] = groupData.id;
    await chrome.storage.local.set({ groupMappings: storage.groupMappings });
}

export async function deleteSavedGroup(savedGroupId) {
    const storage = await chrome.storage.local.get({ savedGroups: [], groupMappings: {} });
    
    const newSavedGroups = storage.savedGroups.filter(g => g.id !== savedGroupId);
    
    let linkedOpenGroupId = null;
    for (const [openId, savedId] of Object.entries(storage.groupMappings)) {
        if (savedId === savedGroupId) {
            linkedOpenGroupId = Number(openId);
            delete storage.groupMappings[openId];
            break;
        }
    }

    await chrome.storage.local.set({ 
        savedGroups: newSavedGroups,
        groupMappings: storage.groupMappings 
    });

    if (linkedOpenGroupId) {
        await closeGroupTabs(linkedOpenGroupId);
    }
}