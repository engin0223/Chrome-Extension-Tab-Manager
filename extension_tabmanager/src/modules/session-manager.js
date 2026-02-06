import { state } from './store.js';
import { fetchWindowsAndTabs } from './api.js';

export function initializeSessionManager() {
    const sidebarContent = document.getElementById('sidebarContent');
    const saveBtn = document.getElementById('saveSessionBtn');

    sidebarContent.addEventListener('click', (e) => {
        if (e.target.closest('.restore-session-btn')) {
            restoreSession(e.target.closest('.sidebar-session').dataset.sessionId);
            return;
        }
        if (e.target.closest('.delete-session-btn')) {
            deleteSession(e.target.closest('.sidebar-session').dataset.sessionId);
            return;
        }
        // Expand/Collapse logic
        const header = e.target.closest('.sidebar-session-header');
        if (header) {
            const sess = header.closest('.sidebar-session');
            sess.classList.toggle('expanded');
        }
        const winHeader = e.target.closest('.window-header');
        if (winHeader) {
            winHeader.closest('.session-window').classList.toggle('expanded');
        }
    });

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentSession);
    renderSessions();
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
    renderSessions();
}

/**
 * Loads sessions from storage and renders them into the sidebar.
 */
async function renderSessions() {
    const container = document.getElementById('sidebarContent');
    const storage = await chrome.storage.local.get({ sessions: [] });
    const sessions = storage.sessions;

    // Handle Empty State with specific styling
    if (sessions.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 20px; font-size: 12px; color: var(--text-muted); text-align: center;">No saved sessions.<br>Click "Save Current" to start.</div>';
        return;
    }

    // Clear container before rendering
    container.innerHTML = '';

    sessions.forEach(session => {
        // Calculate session metadata
        const sessionDate = new Date(session.created).toLocaleDateString();
        const winCount = session.windows.length;
        const totalTabs = session.windows.reduce((acc, w) => acc + w.tabs.length, 0);

        // [FIX] Removed onerror attribute from img tags below to fix CSP violation
        const html = `
            <div class="sidebar-session" data-session-id="${session.id}">
                <div class="sidebar-session-header">
                    <div class="session-info" style="display:flex; flex-direction:column; overflow:hidden; flex:1;">
                        <span class="session-title" title="${session.name}">${session.name}</span>
                        <span class="session-meta" style="font-size:10px; color:var(--text-muted);">${winCount} Wins • ${totalTabs} Tabs • ${sessionDate}</span>
                    </div>
                    <div class="session-actions" style="display:flex; gap:4px; align-items:center;">
                         <button class="session-header-btn restore-session-btn" title="Restore Session">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                         </button>
                         <button class="session-header-btn delete-session-btn" title="Delete Session">
                            ✕
                         </button>
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

        // Create temporary element to convert string to DOM and append
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html.trim();
        container.appendChild(tempDiv.firstChild);
    });
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
        if (winData.name) {
            // Re-save name logic would go here if we persist ID mapping
        }
    }
    setTimeout(fetchWindowsAndTabs, 1000);
}

async function deleteSession(id) {
    if (!confirm("Delete this session?")) return;
    const storage = await chrome.storage.local.get({ sessions: [] });
    const sessions = storage.sessions.filter(s => s.id !== id);
    await chrome.storage.local.set({ sessions });
    renderSessions();
}