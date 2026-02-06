import { state } from './store.js';
import { saveWindowName, closeWindow, createNewWindow, closeTab, activateTab } from './api.js';

export function renderWindowTabs(onClickCallback, onDblClickCallback) {
  const tabsList = document.getElementById('windowTabsList');
  const validWindowIds = new Set(state.windowsData.map(w => w.id));
  
  // Cleanup
  Array.from(tabsList.children).forEach(el => {
    if (el.dataset.windowId && !validWindowIds.has(Number(el.dataset.windowId))) {
      el.remove();
    }
  });

  // Render/Update
  state.windowsData.forEach(windowData => {
    let tab = tabsList.querySelector(`.window-tab[data-window-id="${windowData.id}"]`);
    let label, badge;

    if (!tab) {
      tab = document.createElement('div');
      tab.dataset.windowId = windowData.id;
      tab.style.cursor = 'pointer';
      
      const icon = document.createElement('span');
      icon.className = 'window-tab-icon';
      icon.textContent = '📁';

      badge = document.createElement('span');
      badge.className = 'window-tab-count-badge';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'window-tab-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.onclick = (e) => { e.stopPropagation(); closeWindow(windowData.id); };

      label = document.createElement('span');
      label.className = 'window-tab-label';
      label.textContent = windowData.customName || `Window ${windowData.id}`;
      if (!windowData.customName) saveWindowName(label.textContent, windowData.id);

      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
      });
      label.addEventListener('blur', () => {
        saveWindowName(label.textContent.trim(), windowData.id);
      });

      tab.addEventListener('click', (e) => onClickCallback(e, windowData.id, label));
      tab.addEventListener('dblclick', () => onDblClickCallback(windowData.id));

      tab.append(icon, label, badge, closeBtn);
      tabsList.appendChild(tab);
    } else {
        label = tab.querySelector('.window-tab-label');
    }

    // Update classes
    const classes = ['window-tab'];
    if (windowData.id === state.activeWindowId) {
        classes.push('active');
        if(!label.isContentEditable) label.contentEditable = true;
    } else {
        label.contentEditable = false;
    }

    const tabIds = windowData.tabs.map(t => t.id);
    if (tabIds.length > 0) {
      if (tabIds.every(id => state.redSelection.includes(id))) classes.push('selected-red');
      else if (tabIds.every(id => state.yellowSelection.includes(id))) classes.push('selected-yellow');
      else if (tabIds.every(id => state.blueSelection.includes(id))) classes.push('selected-blue');
    }
    tab.className = classes.join(' ');
    tab.querySelector('.window-tab-count-badge').textContent = windowData.tabs.length;
  });

  // New Window Button
  let newBtn = document.getElementById('newWindowBtn');
  if (!newBtn) {
    newBtn = document.createElement('button');
    newBtn.id = 'newWindowBtn';
    newBtn.className = 'window-tab-new-btn';
    newBtn.innerHTML = '✛';
    newBtn.onclick = (e) => { e.stopPropagation(); createNewWindow(); };
    tabsList.appendChild(newBtn);
  } else {
    tabsList.appendChild(newBtn);
  }
}

export function renderWindowContent(onCardClick) {
  const contentArea = document.getElementById('windowContent');
  const searchInput = document.getElementById('tabSearchInput');
  const filterTerm = searchInput ? searchInput.value.toLowerCase() : '';

  contentArea.innerHTML = '';
  contentArea.classList.add('active');

  let tabsToRender = [];
  state.windowsData.forEach(win => {
    if (state.searchTargetWindowIds.has(win.id)) {
      win.tabs.forEach(tab => {
        const title = (tab.title || 'Untitled').toLowerCase();
        const url = (tab.url || 'about:blank').toLowerCase();
        if (!filterTerm || title.includes(filterTerm) || url.includes(filterTerm)) {
          tabsToRender.push({ tab, windowId: win.id, windowName: win.customName });
        }
      });
    }
  });

  if (tabsToRender.length === 0 && filterTerm) {
    contentArea.innerHTML = '<div class="empty-state">No matching tabs found</div>';
    return;
  }

  // Grouping Logic
  const groups = [];
  const processed = new Set();
  tabsToRender.forEach(item => {
    if (processed.has(item.tab.id)) return;
    const splitId = item.tab.splitViewId;
    if (splitId && splitId !== -1) {
       const partners = tabsToRender.filter(t => t.tab.splitViewId === splitId && t.windowId === item.windowId);
       if (partners.length > 1) {
         groups.push({ type: 'split', items: partners });
         partners.forEach(p => processed.add(p.tab.id));
       } else {
         groups.push({ type: 'single', item });
         processed.add(item.tab.id);
       }
    } else {
      groups.push({ type: 'single', item });
      processed.add(item.tab.id);
    }
  });

  groups.forEach(g => {
    if (g.type === 'split') contentArea.appendChild(createSplitCard(g.items, onCardClick));
    else contentArea.appendChild(createCard(g.item.tab, g.item.windowId, g.item.windowName, onCardClick));
  });
}

/**
 * Helper to generate the correct Favicon URL using chrome.runtime
 */
function getFaviconUrl(pageUrl) {
    if (!pageUrl) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23999"/></svg>';
    try {
        const url = new URL(chrome.runtime.getURL('/_favicon/'));
        url.searchParams.set('pageUrl', pageUrl);
        url.searchParams.set('size', '64');
        return url.toString();
    } catch (e) {
        return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23999"/></svg>';
    }
}

function createCard(tab, windowId, windowName, onCardClick) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.dataset.tabId = tab.id;
    card.dataset.windowId = windowId;

    const header = document.createElement('div');
    header.className = 'page-card-header';

    if (windowName && (state.searchTargetWindowIds.size > 1 || windowId !== state.activeWindowId)) {
        const badge = document.createElement('span');
        badge.textContent = windowName;
        badge.style.cssText = 'font-size:10px; background:var(--bg-element-interactive); padding:2px 5px; border-radius:3px; margin-right:6px; color:var(--text-muted); max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        header.appendChild(badge);
    }

    const fav = document.createElement('img');
    fav.className = 'page-card-favicon';
    // --- FIX: Use helper for robust favicon loading ---
    fav.src = getFaviconUrl(tab.url);
    
    const title = document.createElement('span');
    title.className = 'page-card-title';
    title.textContent = tab.title || 'Untitled';
    title.title = tab.title;

    const close = document.createElement('button');
    close.className = 'page-card-close-btn';
    close.innerHTML = '✕';
    close.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); card.remove(); };

    header.append(fav, title, close);

    const content = document.createElement('div');
    content.className = 'page-card-content';
    const url = document.createElement('span');
    url.className = 'page-url';
    url.textContent = tab.url;
    content.appendChild(url);

    card.append(header, content);

    card.addEventListener('click', (e) => onCardClick(e, tab.id));
    card.addEventListener('dblclick', (e) => { e.stopPropagation(); activateTab(windowId, tab.id); });

    updateSelectionVisuals(card, [tab.id]);
    return card;
}

function createSplitCard(items, onCardClick) {
    const card = document.createElement('div');
    card.className = 'page-card split-view-card';
    const tabIds = items.map(i => i.tab.id);
    card.dataset.tabIds = JSON.stringify(tabIds);
    card.dataset.windowId = items[0].windowId;
    card.dataset.tabId = tabIds[0];

    const closeGroup = document.createElement('button');
    closeGroup.className = 'split-group-close-btn';
    closeGroup.innerHTML = '✕';
    closeGroup.onclick = (e) => { e.stopPropagation(); items.forEach(i => closeTab(i.tab.id)); card.remove(); };
    card.appendChild(closeGroup);

    items.forEach(({ tab, windowId }) => {
        const pane = document.createElement('div');
        pane.className = 'split-pane';
        pane.addEventListener('dblclick', (e) => { e.stopPropagation(); activateTab(windowId, tab.id); });
        
        const h = document.createElement('div');
        h.className = 'page-card-header';
        
        const fav = document.createElement('img');
        fav.className = 'page-card-favicon';
        // --- FIX: Use helper for robust favicon loading ---
        fav.src = getFaviconUrl(tab.url);
        
        const t = document.createElement('span');
        t.className = 'page-card-title';
        t.textContent = tab.title;

        const c = document.createElement('button');
        c.className = 'page-card-close-btn';
        c.innerHTML = '✕';
        c.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };

        h.append(fav, t, c);
        
        const content = document.createElement('div');
        content.className = 'page-card-content';
        const u = document.createElement('span');
        u.className = 'page-url';
        u.textContent = tab.url;
        content.appendChild(u);
        
        pane.append(h, content);
        card.appendChild(pane);
    });

    card.addEventListener('click', (e) => {
        if(e.target.closest('button')) return;
        onCardClick(e, tabIds, true); 
    });

    updateSelectionVisuals(card, tabIds);
    return card;
}

function updateSelectionVisuals(card, ids) {
    const isRed = ids.every(id => state.redSelection.includes(id));
    const isYellow = ids.every(id => state.yellowSelection.includes(id));
    const isBlue = ids.every(id => state.blueSelection.includes(id));

    if (isRed) card.classList.add('selected-red');
    else if (isYellow) card.classList.add('selected-yellow');
    else if (isBlue) card.classList.add('selected-blue');
    
    if (isRed || isYellow) {
        const b = document.createElement('div');
        b.className = 'selection-badge';
        b.textContent = 'selected';
        card.appendChild(b);
    }
}