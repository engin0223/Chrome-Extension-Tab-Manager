chrome.action.onClicked.addListener(async () => {
  const packagedUrl = chrome.runtime.getURL('src/pages/ui/ui.html');
  const tabs = await chrome.tabs.query({ url: packagedUrl });

  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    chrome.tabs.create({ url: packagedUrl });
  }
});

// Service Worker for Tab Manager

// Map to hold debounce timers
const saveTimers = {};

// --- Helper Functions ---

async function getTabsInGroup(groupId) {
    return await chrome.tabs.query({ groupId });
}

// Check if an existing (but currently closed/unmapped) saved group matches the current one
function findMatchingSavedGroup(groupMeta, tabs, savedGroups, groupMappings) {
    const activeSavedIds = new Set(Object.values(groupMappings));
    const currentTitle = groupMeta.title || 'Untitled Group';
    const currentUrls = tabs.map(t => t.url);

    return savedGroups.find(saved => {
        // 1. Skip if this saved group is already open elsewhere (mapped)
        if (activeSavedIds.has(saved.id)) return false;

        // 2. Title and Color must match
        if (saved.title !== currentTitle) return false;
        if (saved.color !== groupMeta.color) return false;

        // 3. Tabs must match (checking URLs)
        // We use a strict check here to ensure we don't accidentally merge different groups
        if (saved.tabs.length !== tabs.length) return false;
        
        for (let i = 0; i < tabs.length; i++) {
            if (saved.tabs[i].url !== tabs[i].url) return false;
        }

        return true;
    });
}

// Core logic: updates the storage for a specific group
// Now DEBOUNCED to prevent duplicates from rapid events
async function autoSaveGroup(groupId) {
    if (groupId === -1 || !groupId) return;

    // Clear any pending save for this group
    if (saveTimers[groupId]) {
        clearTimeout(saveTimers[groupId]);
    }

    // Set a new timer (200ms delay)
    saveTimers[groupId] = setTimeout(async () => {
        try {
            await performGroupSave(groupId);
        } catch (err) {
            console.error("Auto-save error:", err);
        } finally {
            delete saveTimers[groupId];
        }
    }, 200);
}

// The actual save operation
async function performGroupSave(groupId) {
    // 1. Get current group data from Chrome
    let groupMeta;
    try {
        groupMeta = await chrome.tabGroups.get(groupId);
    } catch (e) {
        // Group likely closed
        return;
    }

    const tabs = await getTabsInGroup(groupId);
    if (!tabs || tabs.length === 0) return;

    // 2. Get existing storage
    const storage = await chrome.storage.local.get({ groupMappings: {}, savedGroups: [], pendingRestoreId: null });
    let savedGroupId = storage.groupMappings[groupId];
    
    // 3. Create mapping if it doesn't exist
    if (!savedGroupId) {
        if (storage.pendingRestoreId) {
            // Case A: We are restoring a specific ID
            savedGroupId = storage.pendingRestoreId;
            await chrome.storage.local.remove('pendingRestoreId');
        } else {
            // Case B: This might be a NEW group, OR a re-creation of an old one (Deduplication)
            const duplicate = findMatchingSavedGroup(groupMeta, tabs, storage.savedGroups, storage.groupMappings);
            
            if (duplicate) {
                // Found a match! Reuse the old ID to prevent duplicates.
                savedGroupId = duplicate.id;
            } else {
                // Truly new group
                savedGroupId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            }
        }
        
        storage.groupMappings[groupId] = savedGroupId;
        await chrome.storage.local.set({ groupMappings: storage.groupMappings });
    }

    // 4. Construct Data
    const groupData = {
        id: savedGroupId,
        title: groupMeta.title || 'Untitled Group',
        color: groupMeta.color,
        tabs: tabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl })),
        savedAt: Date.now(),
        autoSync: true
    };

    // 5. Update Storage (Atomic-ish replace)
    const otherGroups = storage.savedGroups.filter(g => g.id !== savedGroupId);
    const newSavedGroups = [groupData, ...otherGroups];

    await chrome.storage.local.set({ savedGroups: newSavedGroups });
}

// --- Sync on Startup ---
async function syncAllOpenGroups() {
    if (!chrome.tabGroups) return;
    const groups = await chrome.tabGroups.query({});
    groups.forEach(g => autoSaveGroup(g.id));
}

// --- Event Listeners ---

if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener((group) => {
        autoSaveGroup(group.id);
    });

    chrome.tabGroups.onUpdated.addListener((group) => {
        autoSaveGroup(group.id);
    });
    
    chrome.tabGroups.onRemoved.addListener(async (group) => {
        if (saveTimers[group.id]) clearTimeout(saveTimers[group.id]);
        
        const storage = await chrome.storage.local.get({ groupMappings: {} });
        if (storage.groupMappings[group.id]) {
            delete storage.groupMappings[group.id];
            await chrome.storage.local.set({ groupMappings: storage.groupMappings });
        }
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if ((changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) && tab.groupId > -1) {
        autoSaveGroup(tab.groupId);
    }
});

chrome.tabs.onCreated.addListener((tab) => {
    if (tab.groupId > -1) autoSaveGroup(tab.groupId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.groupId > -1) autoSaveGroup(tab.groupId);
    });
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
     chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.groupId > -1) autoSaveGroup(tab.groupId);
    });
});

syncAllOpenGroups();