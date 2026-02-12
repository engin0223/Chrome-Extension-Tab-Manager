import { state } from '../../modules/store.js';
import * as API from '../../modules/api.js';
import * as Renderer from '../../modules/ui-renderer.js';
import { initializeSessionManager } from '../../modules/session-manager.js';
import { attachDragHandlers } from '../../modules/drag-drop.js';

const COLOR_MAP = {
  grey: '#bdc1c6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
  green: '#81c995', pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Theme & Basic Config
    document.body.classList.toggle('light-theme', window.matchMedia('(prefers-color-scheme: light)').matches);
    const prefs = await chrome.storage.sync.get({ moveTabsEnabled: false });
    state.moveTabsEnabled = prefs.moveTabsEnabled;

    // 2. Initial Data Load
    await API.fetchWindowsAndTabs();
    
    // 3. Render Initial State
    refreshUI();
    
    // 4. Attach Event Listeners
    setupTopControls();
    setupSearch();
    setupContextMenu(); 
    initializeSessionManager();
    attachDragHandlers(document.getElementById('windowContent'), refreshUI);
    
    // 5. Chrome Event Listeners
    const reload = () => API.fetchWindowsAndTabs().then(refreshUI);
    chrome.tabs.onCreated.addListener(reload);
    chrome.tabs.onRemoved.addListener(reload);
    chrome.tabs.onUpdated.addListener(reload);
    chrome.tabs.onMoved.addListener(reload); 
    chrome.tabs.onAttached.addListener(reload);
    chrome.tabs.onDetached.addListener(reload);
    chrome.windows.onCreated.addListener(reload);
    chrome.windows.onRemoved.addListener(reload);
    
    // 6. Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape: Close modals and clear selection
        if (e.key === 'Escape') {
            document.getElementById('groupModalOverlay').classList.remove('visible');
            document.getElementById('groupContextMenu').style.display = 'none';
            state.clearAllSelections();
            refreshUI();
            
            // Also blur any active editable elements
            if (document.activeElement && document.activeElement.isContentEditable) {
                document.activeElement.blur();
            }
        }
        
        // Delete: Remove selected tabs (but not if editing text)
        if (e.key === 'Delete' && state.blueSelection.length > 0) {
            if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
            
            const tabsToRemove = [...state.blueSelection];
            state.clearAllSelections();
            refreshUI();
            tabsToRemove.forEach(id => API.closeTab(id));
        }
        
        // Ctrl+A: Select All Cards
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            // CHECK: If user is editing text, let default browser behavior happen (select text)
            if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            e.preventDefault(); // Prevent default browser "Select All" for the page body
            
            const cards = document.querySelectorAll('.page-card');
            let newSelection = [];
            cards.forEach(card => {
                if (card.dataset.tabIds) {
                    try { newSelection.push(...JSON.parse(card.dataset.tabIds)); } catch (err) {}
                } else if (card.dataset.tabId) {
                    newSelection.push(Number(card.dataset.tabId));
                }
            });
            state.blueSelection = [...new Set(newSelection)];
            refreshUI();
        }
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'window-tab-theme-toggle-btn';
    toggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    toggleBtn.title = 'Toggle light/dark theme';
    toggleBtn.onclick = () => document.body.classList.toggle('light-theme');
    document.getElementById('staticControls').appendChild(toggleBtn);
});

function refreshUI() {
    Renderer.renderWindowTabs(handleWindowTabClick, (id) => {
        API.activateTab(id, state.windowsData.find(w=>w.id===id).tabs[0].id);
    });
    Renderer.renderWindowContent(handleCardClick, handleContextMenu);
}

let activeContextMenuGroupId = null;

function handleContextMenu({ x, y, groupId }) {
    activeContextMenuGroupId = groupId;
    const menu = document.getElementById('groupContextMenu');
    menu.style.display = 'block';
    
    const menuRect = menu.getBoundingClientRect();
    let left = x, top = y;
    if (x + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 10;
    if (y + menuRect.height > window.innerHeight) top = window.innerHeight - menuRect.height - 10;
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function setupContextMenu() {
    const menu = document.getElementById('groupContextMenu');
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) menu.style.display = 'none';
    });

    document.getElementById('ctxNewTabInGroup').onclick = async () => {
        if (activeContextMenuGroupId !== null) await API.addTabToGroup(activeContextMenuGroupId);
        menu.style.display = 'none';
        await API.fetchWindowsAndTabs(); refreshUI();
    };
    document.getElementById('ctxMoveGroupToWindow').onclick = async () => {
        if (activeContextMenuGroupId !== null) await API.moveGroupToNewWindow(activeContextMenuGroupId);
        menu.style.display = 'none';
        await API.fetchWindowsAndTabs(); refreshUI();
    };
    document.getElementById('ctxCloseGroup').onclick = async () => {
        if (activeContextMenuGroupId !== null) {
            await API.closeGroupTabs(activeContextMenuGroupId);
        }
        menu.style.display = 'none';
        await API.fetchWindowsAndTabs(); refreshUI();
    };
    document.getElementById('ctxUngroup').onclick = async () => {
        if (activeContextMenuGroupId !== null) await API.ungroupTabs(activeContextMenuGroupId);
        menu.style.display = 'none';
        await API.fetchWindowsAndTabs(); refreshUI();
    };
    document.getElementById('ctxDeleteGroup').onclick = async () => {
        if (activeContextMenuGroupId !== null) {
             if(confirm("Permanently delete this group from Saved Groups?")) {
                 const storage = await chrome.storage.local.get({ groupMappings: {} });
                 const savedId = storage.groupMappings[activeContextMenuGroupId];
                 if(savedId) await API.deleteSavedGroup(savedId);
                 else await API.closeGroupTabs(activeContextMenuGroupId);
             }
        }
        menu.style.display = 'none';
        await API.fetchWindowsAndTabs(); refreshUI();
    };
}

function handleWindowTabClick(e, id) {
    if (e.ctrlKey) {
        // Toggle selection logic for window tabs
        const win = state.windowsData.find(w => w.id === id);
        const ids = win.tabs.map(t => t.id);
        const allSel = ids.every(i => state.blueSelection.includes(i));
        if (allSel) state.blueSelection = state.blueSelection.filter(i => !ids.includes(i));
        else state.blueSelection = [...new Set([...state.blueSelection, ...ids])];
    } else {
        // Switch active window
        if (state.activeWindowId !== id) {
            state.activeWindowId = id;
            state.searchTargetWindowIds = new Set([id]);
        }
    }
    refreshUI();
}

function handleCardClick(e, tabIds) {
    if(!Array.isArray(tabIds)) tabIds = [tabIds];
    if (state.mergeMode) return; 

    if (e.ctrlKey || e.metaKey) {
        const allSelected = tabIds.every(id => state.blueSelection.includes(id));
        if (allSelected) state.blueSelection = state.blueSelection.filter(id => !tabIds.includes(id));
        else state.blueSelection = [...state.blueSelection, ...tabIds];
    } else {
        state.blueSelection = [...tabIds];
    }
    refreshUI();
}

function setupTopControls() {
    document.getElementById('sessionBtn').onclick = () => document.getElementById('wrapper').classList.toggle('sidebar-open');

    document.getElementById('mergeBtn').onclick = async () => {
        if (state.blueSelection.length === 0 && state.mergeMode !== 'yellow') return alert('No tabs selected');
        if (state.mergeMode === null) {
            state.redSelection = [...state.blueSelection];
            state.blueSelection = [];
            state.mergeMode = 'red';
        } else if (state.mergeMode === 'red') {
            state.yellowSelection = [...state.blueSelection];
            state.blueSelection = [];
            state.mergeMode = 'yellow';
            
            // Execute Merge
            const combined = [...state.redSelection, ...state.yellowSelection];
            await API.createSplitWindow(combined);
            state.clearAllSelections();
            await API.fetchWindowsAndTabs();
        }
        refreshUI();
    };

    document.getElementById('splitBtn').onclick = async () => {
        if (!state.blueSelection.length) return alert("Select tabs");
        await API.createSplitWindow([...state.blueSelection]);
        state.clearAllSelections();
        await API.fetchWindowsAndTabs();
        refreshUI();
    };
    
    document.getElementById('mergeAllBtn').onclick = async () => {
        const target = state.activeWindowId;
        for (const w of state.windowsData) {
            if (w.id !== target) await API.moveTabs(w.tabs.map(t=>t.id), target);
        }
        await API.fetchWindowsAndTabs();
        refreshUI();
    };

    const groupBtn = document.getElementById('groupBtn');
    const modal = document.getElementById('groupModalOverlay');
    const colorContainer = document.getElementById('colorPickerContainer');
    const nameInput = document.getElementById('groupNameInput');
    let selectedColor = 'grey';

    colorContainer.innerHTML = '';
    Object.entries(COLOR_MAP).forEach(([name, hex]) => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = hex;
        swatch.dataset.colorName = name;
        swatch.onclick = () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            selectedColor = name;
        };
        colorContainer.appendChild(swatch);
    });

    groupBtn.onclick = () => {
        if (!state.blueSelection.length) return alert("Select tabs to group");
        nameInput.value = '';
        selectedColor = 'grey';
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        const greySwatch = colorContainer.querySelector('[data-color-name="grey"]');
        if (greySwatch) greySwatch.classList.add('selected');
        modal.classList.add('visible');
        nameInput.focus();
    };

    document.getElementById('cancelGroupBtn').onclick = () => modal.classList.remove('visible');
    document.getElementById('confirmGroupBtn').onclick = async () => {
        try {
            const groupName = nameInput.value.trim();
            const groupId = await chrome.tabs.group({ tabIds: state.blueSelection });
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, { title: groupName, color: selectedColor });
            }
            state.clearAllSelections();
            modal.classList.remove('visible');
            await API.fetchWindowsAndTabs();
            refreshUI();
        } catch (e) {
            console.error(e);
            alert("Failed to group tabs. " + e.message);
            modal.classList.remove('visible');
        }
    };
}

function setupSearch() {
    const btn = document.getElementById('searchFilterBtn');
    const menu = document.getElementById('searchFilterMenu');
    const list = document.getElementById('filterWindowList');
    btn.onclick = (e) => {
        e.stopPropagation();
        menu.classList.toggle('visible');
        list.innerHTML = '';
        state.windowsData.forEach(w => {
            const div = document.createElement('div');
            div.className = 'filter-option';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = state.searchTargetWindowIds.has(w.id);
            chk.onchange = () => {
                if(chk.checked) state.searchTargetWindowIds.add(w.id);
                else state.searchTargetWindowIds.delete(w.id);
                refreshUI();
            };
            div.append(chk, w.customName || `Window ${w.id}`);
            list.appendChild(div);
        });
    };
    document.getElementById('tabSearchInput').addEventListener('input', refreshUI);
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('visible');
    });
    document.getElementById('filterSelectAll').onclick = () => {
        state.windowsData.forEach(w => state.searchTargetWindowIds.add(w.id));
        refreshUI();
    };
    document.getElementById('filterSelectNone').onclick = () => {
        state.searchTargetWindowIds.clear();
        refreshUI();
    };
}