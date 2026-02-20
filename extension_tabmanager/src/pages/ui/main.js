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
    
    // --- ONE-TIME OBSERVER FOR FOCUSED TAB STYLING ---
    state.addFocusObserver((newId) => {
        // We use setTimeout to allow the current stack (like `refreshUI()`) to finish 
        // updating the DOM before we attempt to style the element.
        setTimeout(() => {
            // Clear previous outlines
            document.querySelectorAll('.page-card').forEach(c => {
                c.style.outline = '';
                c.style.outlineOffset = '';
            });

            // Apply focus outline and scroll into view
            if (newId !== null) {
                const newCard = document.querySelector(`.page-card[data-tab-id="${newId}"]`);
                if (newCard) {
                    newCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    newCard.style.outline = '2px solid var(--text-primary)';
                    newCard.style.outlineOffset = '-1px';
                }
            }
        }, 0);
    });

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

        // Custom Navigation Logic for Arrow Keys & Tab (Page Cards)
        const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
        if (navKeys.includes(e.key)) {
            // Let default behavior work inside input fields and renamable items
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            e.preventDefault(); // Stop native button traversal/scrolling

            const cards = Array.from(document.querySelectorAll('.page-card'));
            if (cards.length === 0) return;

            // Find current focused index
            let currentIndex = cards.findIndex(c => {
                if (c.dataset.tabIds) {
                    try { return JSON.parse(c.dataset.tabIds).includes(state.focusedTabId); } catch(err){}
                }
                return Number(c.dataset.tabId) === state.focusedTabId;
            });

            // Fallback starting position
            if (currentIndex === -1) {
                if (state.blueSelection.length > 0) {
                    const lastSel = state.blueSelection[state.blueSelection.length - 1];
                    currentIndex = cards.findIndex(c => {
                        if (c.dataset.tabIds) {
                            try { return JSON.parse(c.dataset.tabIds).includes(lastSel); } catch(err){}
                        }
                        return Number(c.dataset.tabId) === lastSel;
                    });
                }
                if (currentIndex === -1) {
                    currentIndex = 0;
                    const firstCard = cards[0];
                    if (firstCard.dataset.tabIds) {
                        try { state.focusedTabId = JSON.parse(firstCard.dataset.tabIds)[0]; } catch(err){}
                    } else {
                        state.focusedTabId = Number(firstCard.dataset.tabId);
                    }
                }
            } else {
                let nextIndex = currentIndex;

                // Calculate directional moves
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIndex = currentIndex + 1;
                    if (nextIndex >= cards.length) nextIndex = cards.length - 1; // Clamp to end
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIndex = currentIndex - 1;
                    if (nextIndex < 0) nextIndex = 0; // Clamp to start
                } else if (e.key === 'Tab') {
                    nextIndex = currentIndex + 1;
                    if (nextIndex >= cards.length) nextIndex = 0; // Loop to start
                }

                const forceSelect = (state.blueSelection.length === 0);

                // Trigger updates if we moved index or need initial forced selection
                if (nextIndex !== currentIndex || forceSelect) {
                    const targetCard = cards[nextIndex];
                    let targetIds = [];
                    if (targetCard.dataset.tabIds) {
                        try { targetIds = JSON.parse(targetCard.dataset.tabIds); } catch(err){}
                    } else {
                        targetIds = [Number(targetCard.dataset.tabId)];
                    }

                    if (e.shiftKey) {
                        // --- Range Selection Mode ---
                        if (!state.shiftSelectionStartId) {
                            state.shiftSelectionStartId = state.focusedTabId;
                        }

                        let anchorIndex = cards.findIndex(c => {
                            if (c.dataset.tabIds) {
                                try { return JSON.parse(c.dataset.tabIds).includes(state.shiftSelectionStartId); } catch(err){}
                            }
                            return Number(c.dataset.tabId) === state.shiftSelectionStartId;
                        });

                        // Safe fallback if anchor was somehow lost
                        if (anchorIndex === -1) {
                            anchorIndex = currentIndex;
                            state.shiftSelectionStartId = state.focusedTabId;
                        }

                        const startIdx = Math.min(anchorIndex, nextIndex);
                        const endIdx = Math.max(anchorIndex, nextIndex);

                        let rangeSelection = [];
                        for (let i = startIdx; i <= endIdx; i++) {
                            const c = cards[i];
                            if (c.dataset.tabIds) {
                                try { rangeSelection.push(...JSON.parse(c.dataset.tabIds)); } catch(err){}
                            } else {
                                rangeSelection.push(Number(c.dataset.tabId));
                            }
                        }

                        state.blueSelection = [...new Set(rangeSelection)];
                    } else {
                        // --- Normal Move: Solo Selection ---
                        state.shiftSelectionStartId = null; // Clear anchor so next shift-click starts fresh
                        state.blueSelection = [...targetIds];
                    }

                    // Simply updating focusedTabId will trigger our observer to apply styling
                    state.focusedTabId = targetIds[0];

                    refreshUI();
                }
            }
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
    state.shiftSelectionStartId = null; // Reset shift anchor
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

    // Update keyboard cursor focus to synchronize with mouse click
    // (This automatically triggers the observer)
    state.focusedTabId = tabIds[0];
    state.shiftSelectionStartId = null; // Reset shift anchor on mouse click

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

    // --- MERGE ALL (WITH GROUP INTEGRITY) ---
    document.getElementById('mergeAllBtn').onclick = async () => {
        const target = state.activeWindowId;

        // 1. Collect all groups from other windows
        const groupsToRegroup = [];
        for (const w of state.windowsData) {
            if (w.id !== target) {
                const groupMap = {};
                for (const t of w.tabs) {
                    if (t.groupId > -1) {
                        if (!groupMap[t.groupId]) groupMap[t.groupId] = [];
                        groupMap[t.groupId].push(t.id);
                    }
                }
                for (const [gIdStr, tabIds] of Object.entries(groupMap)) {
                    const gId = Number(gIdStr);
                    const gMeta = state.tabGroups.find(g => g.id === gId);
                    groupsToRegroup.push({ tabIds, color: gMeta ? gMeta.color : 'grey', title: gMeta ? gMeta.title : '' });
                }
            }
        }

        // 2. Move tabs
        for (const w of state.windowsData) {
            if (w.id !== target) await API.moveTabs(w.tabs.map(t=>t.id), target);
        }

        // 3. Regroup in target window
        for (const g of groupsToRegroup) {
            try {
                const newGroupId = await chrome.tabs.group({ tabIds: g.tabIds, createProperties: { windowId: target } });
                if (chrome.tabGroups) await chrome.tabGroups.update(newGroupId, { title: g.title, color: g.color });
            } catch (err) { console.error("Regroup failed", err); }
        }

        await API.fetchWindowsAndTabs();
        refreshUI();
    };

    // --- MERGE SELECTED (WITH GROUP INTEGRITY) ---
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

            const groupsToRegroup = [];
            const draggedGroups = {};
            for (const win of state.windowsData) {
                for (const t of win.tabs) {
                    if (combined.includes(t.id) && t.groupId > -1) {
                        if (!draggedGroups[t.groupId]) draggedGroups[t.groupId] = [];
                        draggedGroups[t.groupId].push(t.id);
                    }
                }
            }

            for (const [gIdStr, tabIds] of Object.entries(draggedGroups)) {
                const gId = Number(gIdStr);
                const gMeta = state.tabGroups.find(g => g.id === gId);
                groupsToRegroup.push({ tabIds, color: gMeta ? gMeta.color : 'grey', title: gMeta ? gMeta.title : '' });
            }

            const newWin = await API.createSplitWindow([...combined]);

            for (const g of groupsToRegroup) {
                try {
                    const newGroupId = await chrome.tabs.group({ tabIds: g.tabIds, createProperties: { windowId: newWin.id } });
                    if (chrome.tabGroups) await chrome.tabGroups.update(newGroupId, { title: g.title, color: g.color });
                } catch(err) {}
            }

            state.clearAllSelections();
            await API.fetchWindowsAndTabs();
            refreshUI();
        }
        refreshUI();
    };

    // --- SPLIT WINDOW (WITH GROUP INTEGRITY) ---
    document.getElementById('splitBtn').onclick = async () => {
        if (!state.blueSelection.length) return alert("Select tabs");
        const selection = [...state.blueSelection];
        
        const groupsToRegroup = [];
        const draggedGroups = {};
        for (const win of state.windowsData) {
            for (const t of win.tabs) {
                if (selection.includes(t.id) && t.groupId > -1) {
                    if (!draggedGroups[t.groupId]) draggedGroups[t.groupId] = [];
                    draggedGroups[t.groupId].push(t.id);
                }
            }
        }

        for (const [gIdStr, tabIds] of Object.entries(draggedGroups)) {
            const gId = Number(gIdStr);
            const gMeta = state.tabGroups.find(g => g.id === gId);
            groupsToRegroup.push({ tabIds, color: gMeta ? gMeta.color : 'grey', title: gMeta ? gMeta.title : '' });
        }

        const newWin = await API.createSplitWindow([...selection]);
        
        for (const g of groupsToRegroup) {
            try {
                const newGroupId = await chrome.tabs.group({ tabIds: g.tabIds, createProperties: { windowId: newWin.id } });
                if (chrome.tabGroups) await chrome.tabGroups.update(newGroupId, { title: g.title, color: g.color });
            } catch(err) {}
        }

        state.clearAllSelections();
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