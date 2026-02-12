import { state } from './store.js';
import { fetchWindowsAndTabs, restoreGroup, deleteSavedGroup, renameSavedSession, renameSavedGroup } from './api.js';

export function initializeSessionManager() {
    const sidebarContent = document.getElementById('sidebarContent');
    const saveBtn = document.getElementById('saveSessionBtn');

    sidebarContent.addEventListener('click', (e) => {
        // --- Actions ---
        if (e.target.closest('.restore-session-btn')) {
            restoreSession(e.target.closest('.sidebar-session').dataset.sessionId);
            return;
        }
        if (e.target.closest('.delete-session-btn')) {
            deleteSession(e.target.closest('.sidebar-session').dataset.sessionId);
            return;
        }
        
        if (e.target.closest('.restore-group-btn')) {
            const grpEl = e.target.closest('.sidebar-saved-group');
            handleRestoreGroupClick(grpEl.dataset.savedGroupId);
            return;
        }
        if (e.target.closest('.delete-group-btn')) {
            const grpEl = e.target.closest('.sidebar-saved-group');
            handleDeleteGroupClick(grpEl.dataset.savedGroupId);
            return;
        }

        // --- Expansion Logic ---
        const sessionHeader = e.target.closest('.sidebar-session-header');
        if (sessionHeader) {
            sessionHeader.closest('.sidebar-session').classList.toggle('expanded');
            return;
        }
        const winHeader = e.target.closest('.window-header');
        if (winHeader) {
            winHeader.closest('.session-window').classList.toggle('expanded');
            return;
        }

        const groupHeader = e.target.closest('.sidebar-saved-group-header');
        if (groupHeader) {
            groupHeader.closest('.sidebar-saved-group').classList.toggle('expanded');
            return;
        }
    });

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentSession);
    renderSidebarContent();
    
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.sessions || changes.savedGroups)) {
            renderSidebarContent();
        }
    });
}

async function saveCurrentSession() {
    const sessionName = prompt("Enter a name for this session:", `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`);
    if (!sessionName) return;

    const extensionUrl = chrome.runtime.getURL('src/pages/ui/ui.html');
    const windowsToSave = state.windowsData.map(win => {
        const validTabs = win.tabs.filter(t => t.url !== extensionUrl);
        if (validTabs.length === 0) return null;
        return {
            name: win.customName || `Window ${win.id}`,
            tabs: validTabs.map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl }))
        };
    }).filter(w => w !== null);

    if (windowsToSave.length === 0) return alert("Empty session.");

    const newSession = {
        id: Date.now().toString(),
        name: sessionName,
        created: Date.now(),
        windows: windowsToSave
    };

    const storage = await chrome.storage.local.get({ sessions: [] });
    await chrome.storage.local.set({ sessions: [newSession, ...storage.sessions] });
}

/**
 * Auto-saves a tab group to storage whenever it changes. Uses debouncing to avoid excessive writes.
 * @param {number} groupId - The ID of the tab group to save.
 */
async function renderSidebarContent() {
    const container = document.getElementById('sidebarContent');
    const storage = await chrome.storage.local.get({ sessions: [], savedGroups: [], groupMappings: {} });
    const { sessions, savedGroups, groupMappings } = storage;
    
    const activeSavedIds = new Set(Object.values(groupMappings));

    container.innerHTML = '';

    // --- SECTION 1: SAVED GROUPS ---
    const groupsSection = document.createElement('div');
    groupsSection.className = 'sidebar-section-container';

    const groupsTitle = document.createElement('h3');
    groupsTitle.className = 'sidebar-section-title';
    groupsTitle.textContent = 'Saved Groups';
    groupsSection.appendChild(groupsTitle);

    const groupsList = document.createElement('div');
    groupsList.className = 'sidebar-section-list';

    if (savedGroups.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-state-text';
        emptyMsg.textContent = 'No saved groups.';
        groupsList.appendChild(emptyMsg);
    } else {
        savedGroups.forEach(g => {
            const isSyncing = activeSavedIds.has(g.id);
            const groupColor = getColorHex(g.color);
            
            const html = `
                <div class="sidebar-saved-group" data-saved-group-id="${g.id}">
                    <div class="sidebar-saved-group-header" style="border-left: 4px solid ${groupColor};">
                         <div class="session-info" style="display:flex; flex-direction:column; overflow:hidden; flex:1;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="session-title editable-title" title="Click to rename">${g.title}</span>
                                ${isSyncing ? '<span title="Auto-Syncing" style="width:6px; height:6px; border-radius:50%; background-color:var(--accent-green); display:inline-block; flex-shrink:0;"></span>' : ''}
                            </div>
                            <span class="session-meta" style="font-size:10px; color:var(--text-muted);">${g.tabs.length} Tabs</span>
                        </div>
                        <div class="session-actions" style="display:flex; gap:4px; align-items:center;">
                             <button class="session-header-btn restore-group-btn" title="Restore Group">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                             </button>
                             <button class="session-header-btn delete-group-btn" title="Delete Saved Group">✕</button>
                        </div>
                    </div>
                    
                    <div class="sidebar-saved-group-content">
                        <ul class="window-tab-list" style="overflow-y: hidden !important;">
                            ${g.tabs.map(tab => `
                                <li class="window-tab-item">
                                    <img src="${tab.favIconUrl || ''}" style="width:12px; height:12px; margin-right:6px; flex-shrink:0; border-radius:2px;">
                                    <span class="window-tab-title" title="${tab.title}">${tab.title}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html.trim();
            groupsList.appendChild(tempDiv.firstChild);
        });
    }
    groupsSection.appendChild(groupsList);
    container.appendChild(groupsSection);


    // --- SECTION 2: WINDOW SESSIONS ---
    const sessionsSection = document.createElement('div');
    sessionsSection.className = 'sidebar-section-container';

    const sessionsTitle = document.createElement('h3');
    sessionsTitle.className = 'sidebar-section-title';
    sessionsTitle.textContent = 'Window Sessions';
    sessionsSection.appendChild(sessionsTitle);

    const sessionsList = document.createElement('div');
    sessionsList.className = 'sidebar-section-list';

    if (sessions.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-state-text';
        emptyMsg.textContent = 'No saved sessions.';
        sessionsList.appendChild(emptyMsg);
    } else {
        sessions.forEach(session => {
            const sessionDate = new Date(session.created).toLocaleDateString();
            const winCount = session.windows.length;
            const totalTabs = session.windows.reduce((acc, w) => acc + w.tabs.length, 0);

            const html = `
                <div class="sidebar-session" data-session-id="${session.id}">
                    <div class="sidebar-session-header">
                        <div class="session-info" style="display:flex; flex-direction:column; overflow:hidden; flex:1;">
                            <span class="session-title editable-title" title="Click to rename">${session.name}</span>
                            <span class="session-meta" style="font-size:10px; color:var(--text-muted);">${winCount} Wins • ${totalTabs} Tabs • ${sessionDate}</span>
                        </div>
                        <div class="session-actions" style="display:flex; gap:4px; align-items:center;">
                             <button class="session-header-btn restore-session-btn" title="Restore Session">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                             </button>
                             <button class="session-header-btn delete-session-btn" title="Delete Session">✕</button>
                        </div>
                    </div>
                    <div class="sidebar-session-content">
                        ${session.windows.map(win => `
                            <div class="session-window" data-window-id="${win.id}">
                                <div class="window-header">
                                    <span class="window-icon">☐</span> 
                                    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${win.name}</span>
                                    <span class="session-tab-count" style="font-size:10px; color:var(--text-muted);">${win.tabs.length}</span> 
                                </div>
                                <ul class="window-tab-list" style="overflow-y: hidden !important;">
                                    ${win.tabs.map(tab => `
                                        <li class="window-tab-item">
                                            <img src="${tab.favIconUrl || ''}" style="width:12px; height:12px; margin-right:6px; flex-shrink:0;">
                                            <span class="window-tab-title" title="${tab.title}">${tab.title}</span>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html.trim();
            sessionsList.appendChild(tempDiv.firstChild);
        });
    }
    sessionsSection.appendChild(sessionsList);
    container.appendChild(sessionsSection);
}

function getColorHex(colorName) {
    const colors = {
        grey: '#bdc1c6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
        green: '#81c995', pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70'
    };
    return colors[colorName] || '#bdc1c6';
}

async function restoreSession(id) {
    const storage = await chrome.storage.local.get({ sessions: [] });
    const session = storage.sessions.find(s => s.id === id);
    if (!session || !confirm(`Restore "${session.name}"?`)) return;

    for (const winData of session.windows) {
        if (!winData.tabs.length) continue;
        const newWin = await chrome.windows.create({ url: winData.tabs[0].url, focused: false });
        for (let i = 1; i < winData.tabs.length; i++) {
            await chrome.tabs.create({ windowId: newWin.id, url: winData.tabs[i].url, active: false });
        }
    }
    setTimeout(fetchWindowsAndTabs, 1000);
}

async function deleteSession(id) {
    if (!confirm("Delete this session?")) return;
    const storage = await chrome.storage.local.get({ sessions: [] });
    const sessions = storage.sessions.filter(s => s.id !== id);
    await chrome.storage.local.set({ sessions });
}

async function handleRestoreGroupClick(savedGroupId) {
    const storage = await chrome.storage.local.get({ savedGroups: [] });
    const groupData = storage.savedGroups.find(g => g.id === savedGroupId);
    if(groupData) {
        if(confirm(`Restore group "${groupData.title}"?`)) {
            await restoreGroup(groupData);
            setTimeout(fetchWindowsAndTabs, 500);
        }
    }
}

async function handleDeleteGroupClick(savedGroupId) {
    if(confirm("Permanently delete this saved group?")) {
        await deleteSavedGroup(savedGroupId);
    }
}