/**
 * Main UI initialization for the Tab Manager extension.
 * Sets up the user interface, loads windows and tabs, and attaches event handlers.
 * @async
 * @returns {Promise<void>}
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Basic UI Setup (Theme, Event Listeners, Buttons)
  setupUserInterface();
  setupSearchFilter()
  
  // 2. Load Configuration (Feature Flags)
  // We await this so 'moveTabsEnabled' is updated BEFORE we attach drag handlers
  await loadFeatureFlags();

  // 3. Load Data and Attach Complex Handlers
  loadWindowsAndTabs();
  attachDragSelectionHandlers();
});

/**
  * Sets up the basic user interface elements, including theme handling
  * and static control buttons.
  * @returns {void}
*/
function setupUserInterface() {
  document.body.classList.add('user-select-none'); 
  document.body.classList.toggle('light-theme', window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.body.addEventListener('keydown', (event) => {
    // Check if the pressed key's 'key' property is 'Escape'
    if (event.key === 'Escape') { 
      // --- Force any focused element (like Search or Window Title) to blur ---
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }

      // Clear all selections and reset merge mode
      blueSelection = [];
      redSelection = [];
      yellowSelection = [];
      mergeMode = null;
      renderWindowContent();
      console.log('Escape key pressed - selections cleared');
    }

    if (event.key === 'Delete' && blueSelection.length) {
      const tabIdsToRemove = [...blueSelection];
      blueSelection = [];
      try { 
        chrome.tabs.remove(tabIdsToRemove, () => {
          loadWindowsAndTabs();
        });
      } catch (err) { 
        console.error('Error closing tabs:', err);
      }
      event.preventDefault(); 
    }
    
  });

  // Add listener in setupUserInterface()
  document.getElementById('tabSearchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.page-card');
    cards.forEach(card => {
      const title = card.querySelector('.page-card-title').textContent.toLowerCase();
      const url = card.querySelector('.page-url').textContent.toLowerCase();
      // Toggle visibility based on match
      if (title.includes(term) || url.includes(term)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  });


  // Setup ONLY the Theme Toggle here (Static, far right)
  const controlsContainer = document.getElementById('staticControls');
  if (controlsContainer) {
    controlsContainer.innerHTML = '';

    // -- Create Theme Toggle Button --
    const themeToggle = document.createElement('button');
    themeToggle.className = 'window-tab-theme-toggle-btn';
    themeToggle.innerHTML = '🌓';
    themeToggle.title = 'Toggle light/dark theme';
    themeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.toggle('light-theme');
    });

    controlsContainer.appendChild(themeToggle);
  }
}
/** Global state variables */
let windowsData = [];
let activeWindowId = null;
let lastSnapshot = null;

/**
 * The windowId where the UI page (ui.html) currently lives. Kept up-to-date
 * by calling `refreshUiWindowId()` before actions that depend on the UI's window.
 */
let uiWindowId = null;

/**
 * Selection state tracking for the three-state merge workflow:
 * - blueSelection: Currently selected tabs (tab IDs)
 * - redSelection: Merge source selection (tab IDs)
 * - yellowSelection: Merge target selection (tab IDs)
 * - mergeMode: null, 'red' (source stage), or 'yellow' (target stage)
 */
let blueSelection = []; // Current selection (tab IDs)
let redSelection = []; // Merge source selection (tab IDs)
let yellowSelection = []; // Merge target selection (tab IDs)
let mergeMode = null; // null, 'red', or 'yellow'

/**
 * Drag selection state for marquee selection:
 * - isDragging: Whether a drag operation is in progress
 * - dragStart: Starting coordinates {x, y} of the drag
 * - marqueeEl: The marquee selection box DOM element
 * - dragWasActive: Flag to suppress click after a drag completes
 */
let isDragging = false;
let dragStart = null;
let marqueeEl = null;
let dragWasActive = false; // suppress click after a drag

/**
 * Feature flag for move-tabs experimental feature
 */
let moveTabsEnabled = false; // default enabled

/**
 * Load feature flags from storage
 * @async
 * @returns {Promise<void>}
 */
async function loadFeatureFlags() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ moveTabsEnabled: false }, (items) => {
      moveTabsEnabled = items.moveTabsEnabled;
      resolve();
    });
  });
}

/**
 * Loads all open windows and their tabs from Chrome, updates the UI,
 * and attaches control handlers. Implements snapshot-based change detection
 * to avoid unnecessary re-renders.
 * @async
 * @returns {Promise<void>}
 */
async function loadWindowsAndTabs() {
  await refreshUiWindowId();
  try {
    // Get all windows with their tabs
    const windows = await chrome.windows.getAll({ populate: true });
    const sorted = windows.sort((a, b) => a.id - b.id);

    const storage = await chrome.storage.local.get({ savedWindowNames: {} });
    const savedNames = storage.savedWindowNames;

    sorted.forEach(w => {
      if (savedNames[w.id]) {
        w.customName = savedNames[w.id];
      }
    });

    // Create a lightweight snapshot (window id -> ordered tab ids)
    const snapshot = JSON.stringify(sorted.map(w => ({ id: w.id, tabs: w.tabs.map(t => t.id), customName: w.customName })));

    // If nothing changed since last snapshot, avoid re-rendering
    if (lastSnapshot !== snapshot) {
    lastSnapshot = snapshot;
    }

    windowsData = sorted;
    
    if (windowsData.length === 0) {
      showEmptyState();
      return;
    }

    // Set active window to first one if not set
    if (!activeWindowId) {
      activeWindowId = windowsData[0].id;
    }

    if (searchTargetWindowIds.size === 0 && activeWindowId) {
      searchTargetWindowIds.add(activeWindowId);
    }

    renderWindowTabs();
    renderWindowContent();
    attachTopControls();
  } catch (error) {
    console.error('Error loading windows:', error);
  }
}


/**
 * Sets up the search filter button and menu for selecting which windows to include in search.
 * @returns {void}
 */
function setupSearchFilter() {
  const btn = document.getElementById('searchFilterBtn');
  const menu = document.getElementById('searchFilterMenu');
  const list = document.getElementById('filterWindowList');
  const selectAll = document.getElementById('filterSelectAll');
  const selectNone = document.getElementById('filterSelectNone');
  const searchInput = document.getElementById('tabSearchInput');

  // Toggle Menu Visibility
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderFilterOptions(); // Refresh list before showing
    menu.classList.toggle('visible');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('visible');
    }
  });

  // Select All
  selectAll.addEventListener('click', () => {
    windowsData.forEach(w => searchTargetWindowIds.add(w.id));
    renderFilterOptions();
    renderWindowContent(); // Trigger search update
  });

  // Select None (Revert to just active window or empty)
  selectNone.addEventListener('click', () => {
    searchTargetWindowIds.clear();
    renderFilterOptions();
    renderWindowContent();
  });

  // Search Input Listener
  searchInput.addEventListener('input', () => {
    renderWindowContent();
  });

  // Helper to render the checkboxes inside the popup
  function renderFilterOptions() {
    list.innerHTML = '';
    windowsData.forEach(win => {
      const row = document.createElement('label');
      row.className = 'filter-option';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = searchTargetWindowIds.has(win.id);
      
      // Determine name (Custom name or Window ID)
      const winName = win.customName || `Window ${win.id}`;
      const count = win.tabs.length;
      
      const span = document.createElement('span');
      span.textContent = `${winName} (${count} tabs)`;
      
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          searchTargetWindowIds.add(win.id);
        } else {
          searchTargetWindowIds.delete(win.id);
        }
        // Live update the search results
        renderWindowContent();
      });

      row.appendChild(checkbox);
      row.appendChild(span);
      list.appendChild(row);
    });
  }
}

/**
 * Updates the UI window ID by querying for tabs matching the extension UI URL.
 * This is called before operations to ensure we know which window the UI currently lives in.
 * @async
 * @returns {Promise<number|null>} The window ID of the UI, or null if not found
 */
async function refreshUiWindowId() {

  try {
    // Fallback: find a tab that matches the extension UI URL
    const url = chrome.runtime.getURL('ui.html');
    const tabs = await new Promise(resolve => chrome.tabs.query({ url }, resolve));
    if (tabs && tabs.length) {
      uiWindowId = tabs[0].windowId;
      return uiWindowId;
    }
  } catch (e) {
    // ignore
  }

  return uiWindowId;
}


/** Saves a custom window name to local storage.
 * @param {string} name - The custom name to save
 * @param {number} windowId - The ID of the window
 * @returns {void}
*/
async function saveWindowName(name, windowId) {
  const storageObject = await chrome.storage.local.get({ savedWindowNames: {} });
  const windowNamesMap = storageObject.savedWindowNames;

  windowNamesMap[windowId] = name;

  await chrome.storage.local.set({ savedWindowNames: windowNamesMap });
}


/**
 * Renders the sidebar navigation list of browser windows by synchronizing the DOM
 * with the global `windowsData` state.
 *
 * This function performs a DOM reconciliation in three phases:
 * 1. **Cleanup:** Removes DOM elements for windows that are no longer present in `windowsData`.
 * 2. **Re-ordering & Update:** Iterates through the data to create new elements or update existing ones.
 * - Uses `appendChild` on existing elements to sort them visually according to the array order.
 * - Updates visual state classes (active, selection colors).
 * - Updates the window title (unless the element is currently focused/being edited).
 * 3. **Static Elements:** Ensures the "New Window" button is appended at the bottom of the list.
 *
 * @global {Array<Object>} windowsData - Array of window objects (Source of Truth).
 * @global {number|null} activeWindowId - The ID of the currently active window in the extension UI.
 * @global {Array<number>} redSelection - Collection of tab IDs currently selected in the Red group.
 * @global {Array<number>} yellowSelection - Collection of tab IDs currently selected in the Yellow group.
 * @global {Array<number>} blueSelection - Collection of tab IDs currently selected in the Blue group.
 *
 * @requires saveWindowName - Helper to persist custom window names on blur.
 * @requires chrome.windows - Chrome Extension API for creating/removing windows.
 *
 * @returns {void}
 */
async function renderWindowTabs() {
  const tabsList = document.getElementById('windowTabsList');

  // --- 1. CLEANUP (Remove closed windows) ---
  const validWindowIds = new Set(windowsData.map(w => w.id));
  const existingElements = Array.from(tabsList.children);
  
  existingElements.forEach(el => {
    // Check if this is a window tab (it has a window-id)
    if (el.dataset.windowId) {
        const domId = Number(el.dataset.windowId);
        // If the window ID is no longer valid, remove it
        if (!validWindowIds.has(domId)) {
            el.remove();
        }
    }
    // Note: We intentionally IGNORE elements without windowId (like the New Window button)
    // so they are not removed.
  });

  const storageObject = await chrome.storage.local.get({savedWindowNames: {}});
  let savedNames = storageObject.savedWindowNames;


  // --- 2. RENDER WINDOW TABS (Create or Update) ---
  windowsData.forEach(async windowData => {
    let tab = tabsList.querySelector(`.window-tab[data-window-id="${windowData.id}"]`);
    let label; 

    // [Block A] Create only if missing
    if (!tab) {
      tab = document.createElement('div');
      tab.dataset.windowId = windowData.id;
      tab.style.cursor = 'pointer';
      
      const icon = document.createElement('span');
      icon.className = 'window-tab-icon';
      icon.textContent = '📁';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'window-tab-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await chrome.windows.remove(windowData.id); loadWindowsAndTabs(); } 
          catch (err) { console.error(err); }
      });

      label = document.createElement('span');
      label.className = 'window-tab-label';
      
      console.log(savedNames[windowData.id]);
      if (savedNames[windowData.id] === undefined) {
        console.log('setting default name for window', windowData.id); 
        console.log('saved name:', savedNames[windowData.id]);
        label.textContent = `Window ${windowData.id} (${windowData.tabs.length})`;
        saveWindowName(label.textContent, windowData.id);
      } else {
        label.textContent = savedNames[windowData.id];
      }


      label.style.userSelect = 'text'; 
      label.style.cursor = 'text';

      if (activeWindowId == windowData.id && !label.isContentEditable) {
        label.contentEditable = true;
      }

      // Label Listeners
      label.addEventListener('mousedown', (e) => e.stopPropagation());
      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
        if (e.ctrlKey) {e.preventDefault();}
      });
      label.addEventListener('blur', async () => {
        const newName = label.textContent.trim();
        label.textContent = newName;
        saveWindowName(newName, windowData.id);
      });

      // Tab Listeners
      tab.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
            toggleAllTabsInWindow(windowData.id);
            renderWindowTabs();
            renderWindowContent();
        } else {
            if (activeWindowId != windowData.id){
              let oldtab = tabsList.querySelector(`.window-tab[data-window-id="${activeWindowId}"]`);
              oldtab.children[1].contentEditable = false;
              activeWindowId = windowData.id;
              searchTargetWindowIds = new Set([activeWindowId]);
              label.contentEditable = true;
              renderWindowTabs();
              renderWindowContent();
            }
        }
      });

      tab.addEventListener('dblclick', () => {
        if (document.activeElement === label) return;
        selectAllTabsInWindow(windowData.id);
        renderWindowTabs();
        renderWindowContent();
      });

      tab.appendChild(icon);
      tab.appendChild(label);
      tab.appendChild(closeBtn);
      
      tabsList.appendChild(tab);
    } else {
      label = tab.querySelector('.window-tab-label');
      // Re-append existing tab to ensure it is in the correct sort order
      tabsList.appendChild(tab);
    }

    // [Block B] Always Update Dynamic Classes/Text
    const classes = ['window-tab'];
    if (windowData.id === activeWindowId) classes.push('active');
    
    const tabIds = windowData.tabs.map(t => t.id);
    if (tabIds.length > 0) {
      if (tabIds.every(id => redSelection.includes(id))) classes.push('selected-red');
      else if (tabIds.every(id => yellowSelection.includes(id))) classes.push('selected-yellow');
      else if (tabIds.every(id => blueSelection.includes(id))) classes.push('selected-blue');
    }
    tab.className = classes.join(' ');

  });

  // --- 3. HANDLE NEW WINDOW BUTTON (Append at the end) ---
  // We check if it exists in the list. If not, create it.
  // Then we appendChild it, which moves it to the very end of the list.
  let newBtn = document.getElementById('newWindowBtn');
  
  if (!newBtn) {
    newBtn = document.createElement('button');
    newBtn.id = 'newWindowBtn'; // ID ensures we can find it next time
    newBtn.className = 'window-tab-new-btn';
    newBtn.innerHTML = '✛';
    newBtn.title = 'New window';
    newBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); 
      try {
        await chrome.windows.create({ state: 'normal' });
        loadWindowsAndTabs();
      } catch (error) { console.error(error); }
    });
    tabsList.appendChild(newBtn);
  } else {
    // If it exists, just move it to the end
    tabsList.appendChild(newBtn);
  }
}

/**
 * Attaches the top control buttons (merge, merge all, split) and defines their click handlers.
 * These buttons manage the three-stage merge workflow and split functionality.
 * @returns {void}
 */
function attachTopControls() {
  const controls = document.getElementById('windowControls');
  if (!controls) return;
  const mergeBtn = document.getElementById('mergeBtn');
  const mergeAllBtn = document.getElementById('mergeAllBtn');
  const splitBtn = document.getElementById('splitBtn');
  controls.setAttribute('aria-hidden', 'false');

  
  mergeBtn.onclick = async () => {
    // Ensure we know which window the UI currently lives in (may have moved)
    await refreshUiWindowId();
    if (blueSelection.length === 0 && mergeMode !== 'yellow') {
      alert('No tabs selected');
      return;
    }

    if (mergeMode === null) {
      // Stage 1: Mark blue selection as red (source)
      redSelection = [...blueSelection];
      blueSelection = [];
      mergeMode = 'red';
      renderWindowContent();
    } else if (mergeMode === 'red') {
      // Stage 2: Mark current selection as yellow (target)
      yellowSelection = [...blueSelection];
      blueSelection = [];
      mergeMode = 'yellow';
      renderWindowContent();

      if (yellowSelection.length === 0) {
        alert('No target tabs selected');
        mergeMode = 'red';
        renderWindowContent();
        return;
      }
    } else if (mergeMode === 'yellow') {

      try {
        // Combine both lists
        const combined = [...redSelection, ...yellowSelection];

        // Create new window using the first tab
        const firstTabId = combined[0];
        const newWin = await new Promise((resolve) => {
          chrome.windows.create({ tabId: firstTabId, state: 'normal' }, (w) => resolve(w));
        });

        // Move all other tabs to that new window
        const remaining = combined.slice(1);
        if (remaining.length > 0) {
          await chrome.tabs.move(remaining, { windowId: newWin.id, index: -1 });
        }

        mergeMode = null;
        redSelection = [];
        yellowSelection = [];
        loadWindowsAndTabs();
      } catch (err) {
        console.error('Merge failed:', err);
        alert('Merge failed');
        mergeMode = null;
        redSelection = [];
        yellowSelection = [];
        renderWindowContent();
      }
    }

  };

  mergeAllBtn.onclick = async () => {
    // Refresh UI window id so we merge into the window that currently hosts the UI
    await refreshUiWindowId();
    const targetWindowId = uiWindowId || activeWindowId || (windowsData[0] && windowsData[0].id);
    if (!targetWindowId) return alert('No target window to merge into');
    try {
      // Merge each window into the target (sequentially)
      for (const win of windowsData) {
        if (win.id === targetWindowId) continue;
        await mergeFromWindow(targetWindowId, win.id);
      }
      loadWindowsAndTabs();
    } catch (err) {
      console.error('Merge All failed:', err);
      alert('Merge All failed');
    }
  };

  splitBtn.onclick = async () => {
    // Ensure UI window id is up-to-date (UI tab might have moved)
    await refreshUiWindowId();
    if (blueSelection.length === 0) {
      alert('No tabs selected');
      return;
    }
    try {
      // Take all blue selected tabs
      const tabsToMove = [...blueSelection];
      // Create new window with first tab
      const firstTabId = tabsToMove.shift();
      const newWin = await new Promise(resolve => {
        chrome.windows.create({ tabId: firstTabId, state: 'normal' }, w => resolve(w));
      });
      // Move remaining tabs to new window
      if (tabsToMove.length > 0) {
        await chrome.tabs.move(tabsToMove, { windowId: newWin.id, index: -1 });
      }
      // Clear selection
      blueSelection = [];
      renderWindowContent();
      loadWindowsAndTabs();
    } catch (err) {
      console.error('Split failed:', err);
      alert('Split failed');
    }
  };
}

/**
 * Finds the window ID that contains any of the given tab IDs.
 * @param {number[]} tabIds - Array of tab IDs to search for
 * @returns {number|null} The window ID containing one of the tabs, or null if not found
 */
function getWindowIdForTabs(tabIds) {
  for (const win of windowsData) {
    for (const tab of win.tabs) {
      if (tabIds.includes(tab.id)) {
        return win.id;
      }
    }
  }
  return null;
}

/**
 * Merges all tabs from a source window into a target window.
 * Moves all tabs from the source to the end of the target and focuses the target.
 * @async
 * @param {number} targetWindowId - The window to merge tabs into
 * @param {number} sourceWindowId - The window to move tabs from
 * @returns {Promise<void>}
 */
async function mergeFromWindow(targetWindowId, sourceWindowId) {
  if (sourceWindowId === targetWindowId) return;
  const source = await chrome.windows.get(sourceWindowId, { populate: true });
  const tabIds = source.tabs.map(t => t.id).filter(Boolean);
  if (tabIds.length === 0) return;
  // Move all tabs to end of target window
  await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
  // Optional: focus the target window after merge
  await chrome.windows.update(targetWindowId, { focused: true });
}

/**
 * Splits tabs from the current window into a new window based on the specified option.
 * Supports moving either the other (non-active) tabs to a new window or the active tab to a new window.
 * @async
 * @param {number} windowId - The window ID to split
 * @param {string} [option='others-to-new'] - Split strategy: 'others-to-new' (keep active) or 'active-to-new' (move active)
 * @returns {Promise<void>}
 */
async function splitCurrentWindow(windowId, option = 'others-to-new') {
  // option: 'others-to-new' (keep active in original), 'active-to-new' (move active to new)
  const win = await chrome.windows.get(windowId, { populate: true });
  if (!win || !win.tabs || win.tabs.length <= 1) return alert('Not enough tabs to split');
  const activeTab = win.tabs.find(t => t.active) || win.tabs[0];

  if (option === 'others-to-new') {
    const otherTabIds = win.tabs.filter(t => t.id !== activeTab.id).map(t => t.id);
    // create new window with other tabs
    const firstId = otherTabIds.shift();
    const newWin = await new Promise((resolve) => {
      chrome.windows.create({ tabId: firstId, state: 'normal' }, (w) => resolve(w));
    });
    if (otherTabIds.length) {
      await chrome.tabs.move(otherTabIds, { windowId: newWin.id, index: -1 });
    }
    await chrome.windows.update(newWin.id, { focused: true });
  } else if (option === 'active-to-new') {
    await chrome.windows.create({ tabId: activeTab.id, state: 'normal' });
  }
  loadWindowsAndTabs();
}

/**
  * Renders the main content area showing tabs from selected windows,
  * applying the current search filter.
 * @returns {void}
 */
function renderWindowContent() {
  const contentArea = document.getElementById('windowContent');
  const searchInput = document.getElementById('tabSearchInput');
  const filterTerm = searchInput ? searchInput.value.toLowerCase() : '';

  contentArea.innerHTML = '';
  contentArea.classList.add('active');

  // 1. Gather all tabs from the SELECTED windows
  let tabsToRender = [];
  
  // If no windows selected, maybe show empty or default to active?
  // Let's assume user wants to see nothing if they unchecked everything.
  
  windowsData.forEach(win => {
    // Only process this window if it is in our "Checked" set
    if (searchTargetWindowIds.has(win.id)) {
      win.tabs.forEach(tab => {
      const title = (tab.title || 'Untitled').toLowerCase();
      const url = (tab.url || 'about:blank').toLowerCase();
      
        // Filter match? (If empty string, it matches everything)
        if (filterTerm === '' || title.includes(filterTerm) || url.includes(filterTerm)) {
          tabsToRender.push({
            tab: tab,
            windowId: win.id,
            windowName: win.customName || `Window ${win.id}`
          });
        }
      });
    }
  });

  if (tabsToRender.length === 0 && filterTerm !== '') {
    contentArea.innerHTML = '<div class="empty-state">No matching tabs found</div>';
    return;
    }

  // 2. Render Cards
  tabsToRender.forEach(item => {
    // We pass the Window Name so createPageCard can display a badge
    const card = createPageCard(item.tab, item.windowId, item.windowName);
    contentArea.appendChild(card);
  });

  // Ensure the sidebar still highlights the "Main" active window correctly
  renderWindowTabs();
}

/**
 * Creates a DOM element representing a single tab (page card) with favicon, title, URL, and close button.
 * Attaches click handlers for selection and drag-to-select functionality.
 * Displays a window badge if applicable.
 * @param {Object} tab - The tab object from Chrome's tabs API
 * @param {number} tab.id - The unique tab ID
 * @param {string} tab.title - The page title
 * @param {string} tab.url - The page URL
 * @param {string} [tab.favIconUrl] - The favicon URL
 * @param {number} windowId - The window ID this tab belongs to
 * @param {string} windowName - The custom name of the window this tab belongs to
 * @returns {HTMLElement} The created page card DOM element
 */
function createPageCard(tab, windowId, windowName) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.tabId = tab.id;
  card.dataset.windowId = windowId;

  const header = document.createElement('div');
  header.className = 'page-card-header';

  const existingIds = new Set(windowsData.map(win => win.id));

  searchTargetWindowIds = new Set(
    [...searchTargetWindowIds].filter(id => existingIds.has(id))
  );

  if (windowName && (searchTargetWindowIds.size > 1 || windowId !== activeWindowId)) {
    const badge = document.createElement('span');
    badge.textContent = windowName;
    badge.style.fontSize = '10px';
    badge.style.background = 'var(--bg-element-interactive)';
    badge.style.padding = '2px 5px';
    badge.style.borderRadius = '3px';
    badge.style.marginRight = '6px';
    badge.style.color = 'var(--text-muted)';
    badge.style.whiteSpace = 'nowrap';
    badge.style.maxWidth = '80px';
    badge.style.overflow = 'hidden';
    badge.style.textOverflow = 'ellipsis';
    header.appendChild(badge);
  }

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'page-card-favicon';
  favicon.src = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23999"/></svg>';
  favicon.onerror = () => {
    favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23999"/></svg>';
  };

  // Title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'page-card-title';
  titleSpan.title = tab.title;
  titleSpan.textContent = tab.title || 'Untitled';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'page-card-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close tab';
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); // Prevent card selection when closing
    try {
      await chrome.tabs.remove(tab.id);
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';
      setTimeout(() => {
        card.remove();
        // Check if window is empty
        if (document.querySelectorAll('.page-card').length === 0) {
          loadWindowsAndTabs();
        }
      }, 200);
    } catch (error) {
      console.error('Error closing tab:', error);
    }
  });

  header.appendChild(favicon);
  header.appendChild(titleSpan);
  header.appendChild(closeBtn);

  // Content
  const content = document.createElement('div');
  content.className = 'page-card-content';
  
  const urlSpan = document.createElement('span');
  urlSpan.className = 'page-url';
  urlSpan.title = tab.url;
  urlSpan.textContent = tab.url || 'about:blank';
  content.appendChild(urlSpan);

  card.appendChild(header);
  card.appendChild(content);

  // Selection click handlers
  card.addEventListener('click', (e) => {
    if (!redSelection.includes(tab.id) && !yellowSelection.includes(tab.id)) {
      // If a drag just happened, suppress the click
      if (dragWasActive) { dragWasActive = false; return; }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click: toggle selection in current mode
        toggleTabSelection(tab.id);
      } else {
        // Regular click: start new blue selection
        blueSelection = [tab.id];
      }
    }
  });

  // Update visual state
  updateCardSelectionState(card, tab.id);

  return card;
}

/**
 * Updates the visual selection state of a page card (tab).
 * Removes or adds selection classes (selected-red, selected-yellow, selected-blue) and badges.
 * @param {HTMLElement} card - The page card DOM element to update
 * @param {number} tabId - The tab ID corresponding to the card
 * @returns {void}
 */
function updateCardSelectionState(card, tabId) {
  let badge = card.querySelector('.selection-badge');
  if (badge) badge.remove();

  if (redSelection.includes(tabId)) {
    card.classList.add('selected-red');
    badge = document.createElement('div');
    badge.className = 'selection-badge';
    badge.textContent = 'selected';
    card.appendChild(badge);
  } else if (yellowSelection.includes(tabId)) {
    card.classList.add('selected-yellow');
    badge = document.createElement('div');
    badge.className = 'selection-badge';
    badge.textContent = 'selected';
    card.appendChild(badge);
  } else if (blueSelection.includes(tabId)) {
    card.classList.add('selected-blue');
  }
}

/**
 * Toggles a tab's inclusion in the blue selection (current selection state).
 * @param {number} tabId - The tab ID to toggle
 * @returns {void}
 */
function toggleTabSelection(tabId) {
  if (blueSelection.includes(tabId)) {
    blueSelection = blueSelection.filter(id => id !== tabId);
  } else {
    blueSelection.push(tabId);
  }
}

/**
 * Selects all tabs in a given window by adding them to the blue selection.
 * Updates the UI to reflect the selection changes.
 * @param {number} windowId - The window ID whose tabs should be selected
 * @returns {void}
 */
function selectAllTabsInWindow(windowId) {
  const window = windowsData.find(w => w.id === windowId);
  if (window) {
    blueSelection = [...blueSelection, ...window.tabs.map(t => t.id)];
    // update UI so top-level window tabs reflect the selection
    renderWindowTabs();
    renderWindowContent();
  }
}

/**
 * Toggles the selection state of all tabs in a window.
 * If all tabs are already selected, deselects them; otherwise, selects all.
 * Updates both the window tabs bar and main content area.
 * @param {number} windowId - The window ID whose tabs should be toggled
 * @returns {void}
 */
async function toggleAllTabsInWindow(windowId) {
  const window = windowsData.find(w => w.id === windowId);
  if (!window) return;

  const tabIds = window.tabs.map(t => t.id);

  // Check if all tabs for this window are already selected
  const allSelected = await tabIds.every(id => blueSelection.includes(id));

  if (allSelected) {
    // Remove all of the window's tabs from blueSelection
    blueSelection = blueSelection.filter(id => !tabIds.includes(id));
  } else {
    // Add only the tabs that are NOT yet in blueSelection
    tabIds.forEach(id => {
      if (!blueSelection.includes(id)) {
        blueSelection.push(id);
      }
    });
  }

  renderWindowTabs();
  renderWindowContent();
}


/**
 * Determines if two rectangles intersect using axis-aligned bounding box collision detection.
 * @param {Object} a - First rectangle {left, right, top, bottom}
 * @param {Object} b - Second rectangle {left, right, top, bottom}
 * @returns {boolean} True if the rectangles intersect, false otherwise
 */
function rectsIntersect(a, b) {
  return !(a.left > b.right || a.right < b.left || a.top > b.bottom || a.bottom < b.top);
}

/**
 * Attaches mousedown, mousemove, mouseup, and mouseleave handlers to enable marquee (drag-to-select) functionality.
 * Allows users to click and drag to create a selection rectangle that selects all cards within it.
 * Handles shift and ctrl modifiers for union and replace selection modes.
 * @returns {void}
 */
function attachDragSelectionHandlers() {
  const container = document.getElementById('windowContent');
  if (!container) return;
  // Drag-to-select marquee vs dragging selected tabs to move
  let isMoveDragging = false;
  let moveGhost = null;
  let moveDragStart = null;
  let moveDirection = 0; // -1 left, 1 right
  let currentTargetCard = null;
  let currentInsertIndex = -1;
  let insertionPlaceholder = null;
  let hoverWindowTimer = null;
  let lastHoverWindowId = null;

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left button only
    // don't start drag when clicking on controls inside cards
    if (e.target.closest('.page-card-close-btn')) return;

    if (document.activeElement) {
        const tagName = document.activeElement.tagName;
        const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA';
        const isEditable = document.activeElement.isContentEditable;

        // Force it to lose focus
        if (isInput || isEditable) {
        document.activeElement.blur(); 
        }
    }

    const clickedCard = e.target.closest('.page-card');
    if (clickedCard) {
      const tabId = Number(clickedCard.dataset.tabId);
      // if clicking a card that is already part of blueSelection, start a move-drag (only if feature enabled)
      if (blueSelection.includes(tabId) && moveTabsEnabled) {
        isMoveDragging = true;
        moveDragStart = { x: e.clientX, y: e.clientY };
        dragWasActive = false;
        moveDirection = 0;
        currentTargetCard = null;
        currentInsertIndex = -1;

        // create ghost container and shallow clones of selected page cards
        moveGhost = document.createElement('div');
        moveGhost.className = 'drag-ghost';
        moveGhost.style.position = 'fixed';
        moveGhost.style.pointerEvents = 'none';
        moveGhost.style.zIndex = 9999;
        moveGhost.style.display = 'flex';
        moveGhost.style.flexDirection = 'column';
        moveGhost.style.gap = '6px';
        moveGhost.style.transform = 'scale(0.95)';

        // clone each selected card and append to ghost
        blueSelection.forEach(id => {
          const orig = container.querySelector(`.page-card[data-tab-id="${id}"]`);
          if (orig) {
            const clone = orig.cloneNode(true);
            clone.style.pointerEvents = 'none';
            clone.style.margin = '0';
            clone.style.width = `${Math.min(orig.getBoundingClientRect().width, 340)}px`;
            moveGhost.appendChild(clone);
            // hide original while dragging
            orig.style.display = 'none';
          }
        });

        document.body.appendChild(moveGhost);
        e.preventDefault();
        return;
      }
    }

    // otherwise start marquee selection
    isDragging = true;
    dragWasActive = false;
    dragStart = { x: e.clientX, y: e.clientY };

    marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee';
    marqueeEl.style.left = '0px';
    marqueeEl.style.top = '0px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
    container.appendChild(marqueeEl);

    e.preventDefault();
  });

  container.addEventListener('mousemove', (e) => {
    // handle move-drag (moving selected tabs)
    if (isMoveDragging && moveGhost) {
      dragWasActive = true;
      moveGhost.style.left = `${e.clientX + 12}px`;
      moveGhost.style.top = `${e.clientY + 12}px`;

      // compute direction
      const dx = e.clientX - moveDragStart.x;
      moveDirection = dx === 0 ? moveDirection : (dx > 0 ? 1 : -1);

      // detect hovering over window buttons to auto-switch after delay
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const winBtn = el ? el.closest('.window-tab') : null;
      const winId = winBtn ? Number(winBtn.dataset.windowId) : null;
      if (winId && winId !== lastHoverWindowId) {
        lastHoverWindowId = winId;
        if (hoverWindowTimer) clearTimeout(hoverWindowTimer);
        hoverWindowTimer = setTimeout(() => {
          activeWindowId = winId;
          renderWindowContent();
        }, 700);
      } else if (!winId) {
        if (hoverWindowTimer) { clearTimeout(hoverWindowTimer); hoverWindowTimer = null; lastHoverWindowId = null; }
      }

      // highlight potential drop target card under cursor and show insertion side
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const card = under ? under.closest('.page-card') : null;
      Array.from(container.querySelectorAll('.page-card')).forEach(c => { c.classList.remove('drop-target'); c.classList.remove('insert-before'); c.classList.remove('insert-after'); });
      currentTargetCard = null;
      //currentInsertIndex = -1;
      if (card) {
        currentTargetCard = card;
        card.classList.add('drop-target');
        // determine insert before/after based on drag direction
        if (moveDirection > 0) {
          card.classList.add('insert-after');
        } else {
          card.classList.add('insert-before');
        }  
        // compute tentative insert index
        const targetTabId = Number(card.dataset.tabId);
        const targetWin = windowsData.find(w => w.id === Number(card.dataset.windowId));
        if (targetWin) {
          let idx = targetWin.tabs.findIndex(t => t.id === targetTabId);
          if (idx !== -1) {
            currentInsertIndex = (moveDirection > 0) ? idx + 1 : idx;
          }
        }
        // create or move insertion placeholder to show sliding
        if (currentInsertIndex !== -1) {
          if (!insertionPlaceholder) {
            insertionPlaceholder = document.createElement('div');
            insertionPlaceholder.className = 'insertion-placeholder';
          }
          // determine where to insert among page-card elements
          const cards = Array.from(container.querySelectorAll('.page-card'));
          const ref = cards[currentInsertIndex] || null;
          if (!cards[currentInsertIndex+1] !== null) {
            if (ref.parentNode !== container || container.children[currentInsertIndex] !== insertionPlaceholder) {
              container.insertBefore(insertionPlaceholder, ref);
            } else {
              const ref2 = cards[currentInsertIndex] || null;
              container.insertBefore(insertionPlaceholder, ref);
              // append at end
              console.log(currentInsertIndex);
              //if (insertionPlaceholder.parentNode !== container) container.appendChild(insertionPlaceholder);
            }
          } else {
            // append at end
            if (insertionPlaceholder.parentNode !== container) container.appendChild(insertionPlaceholder);
          }
        }
      }
      return;
    }

    // marquee selection
    if (!isDragging || !marqueeEl) return;
    dragWasActive = true;
    const rect = container.getBoundingClientRect();
    const x1 = Math.min(dragStart.x, e.clientX);
    const y1 = Math.min(dragStart.y, e.clientY);
    const x2 = Math.max(dragStart.x, e.clientX);
    const y2 = Math.max(dragStart.y, e.clientY);

    const left = x1 - rect.left;
    const top = y1 - rect.top;
    const width = x2 - x1;
    const height = y2 - y1;

    marqueeEl.style.left = `${left}px`;
    marqueeEl.style.top = `${top}px`;
    marqueeEl.style.width = `${width}px`;
    marqueeEl.style.height = `${height}px`;

    // compute intersection with cards and highlight temporarily
    const marqueeClient = { left: x1, top: y1, right: x2, bottom: y2 };
    const cards = Array.from(container.querySelectorAll('.page-card'));
    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      if (rectsIntersect(marqueeClient, r)) {
        card.classList.add('selected-blue');
      } else {
        // only remove if not in permanent selection
        const id = Number(card.dataset.tabId);
        if (!blueSelection.includes(id) && !redSelection.includes(id) && !yellowSelection.includes(id)) {
          card.classList.remove('selected-blue');
        }
      }
    });
  });

  function endDrag(e) {
    // handle ending either marquee drag or move-drag
    if (!isDragging && !isMoveDragging) return;

    // Clear any hover timer
    if (hoverWindowTimer) { clearTimeout(hoverWindowTimer); hoverWindowTimer = null; lastHoverWindowId = null; }

    // If we were move-dragging, perform move on mouseup
    if (isMoveDragging) {
      isMoveDragging = false;
      // determine drop target windowId
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let targetWindowId = null;
      const card = el ? el.closest('.page-card') : null;
      const winBtn = el ? el.closest('.window-tab') : null;
      if (card) targetWindowId = Number(card.dataset.windowId);
      else if (winBtn) targetWindowId = Number(winBtn.dataset.windowId);
      else targetWindowId = activeWindowId;
      // cleanup ghost and visuals
      if (moveGhost && moveGhost.parentNode) moveGhost.parentNode.removeChild(moveGhost);
      moveGhost = null;
      Array.from(document.querySelectorAll('.page-card.drop-target')).forEach(c => c.classList.remove('drop-target'));
      Array.from(document.querySelectorAll('.page-card.insert-before')).forEach(c => c.classList.remove('insert-before'));
      Array.from(document.querySelectorAll('.page-card.insert-after')).forEach(c => c.classList.remove('insert-after'));

      // always restore hidden originals (they were hidden while dragging)
      blueSelection.forEach(id => {
        const orig = container.querySelector(`.page-card[data-tab-id="${id}"]`);
        if (orig) orig.style.display = '';
      });

      // remove insertion placeholder if present
      if (insertionPlaceholder && insertionPlaceholder.parentNode) insertionPlaceholder.parentNode.removeChild(insertionPlaceholder);
      insertionPlaceholder = null;

      // perform the move only if there are selected tabs
      if (blueSelection.length) {
        (async () => {
          try {
            await refreshUiWindowId();
            const tabIds = blueSelection.slice();
            const srcWindowId = getWindowIdForTabs(tabIds);
            let index = currentInsertIndex != null && currentInsertIndex >= 0 ? currentInsertIndex : -1;
            
            // If moving within the same window, we must adjust the index to account for removed tabs
            if (srcWindowId === targetWindowId && index !== -1) {
              const srcWin = windowsData.find(w => w.id === srcWindowId);
              if (srcWin) {
                // count how many selected tabs are located before the desired index
                let beforeCount = 0;
                for (const t of srcWin.tabs) {
                  if (t.id === undefined) continue;
                  if (tabIds.includes(t.id) && srcWin.tabs.findIndex(tt => tt.id === t.id) < index) {
                    beforeCount++;
                  }
                }
                index = Math.max(0, index + beforeCount);
              }
            }

            // restore original cards visibility before moving (UI will refresh later)
            blueSelection.forEach(id => {
              const orig = container.querySelector(`.page-card[data-tab-id="${id}"]`);
              if (orig) orig.style.display = '';
            });

            await chrome.tabs.move(tabIds, { windowId: targetWindowId, index });

            // focus and show target window in UI after a short wait
            setTimeout(async () => {
              try { await chrome.windows.update(targetWindowId, { focused: true }); } catch (e) {}
              activeWindowId = targetWindowId;
              blueSelection = [];
              loadWindowsAndTabs();
            }, 300);
          } catch (err) {
            console.error('Move failed:', err);
            // restore originals if something failed
            blueSelection.forEach(id => {
              const orig = container.querySelector(`.page-card[data-tab-id="${id}"]`);
              if (orig) orig.style.display = '';
            });
            loadWindowsAndTabs();
          }
        })();
      }

      return;
    }

    // otherwise handle marquee end
    isDragging = false;
    const rect = container.getBoundingClientRect();
    const x1 = Math.min(dragStart.x, e.clientX);
    const y1 = Math.min(dragStart.y, e.clientY);
    const x2 = Math.max(dragStart.x, e.clientX);
    const y2 = Math.max(dragStart.y, e.clientY);
    const marqueeClient = { left: x1, top: y1, right: x2, bottom: y2 };

    const cards = Array.from(container.querySelectorAll('.page-card'));
    const selectedIds = [];
    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      if (rectsIntersect(marqueeClient, r)) {
        selectedIds.push(Number(card.dataset.tabId));
      }
      // remove temporary visual (will be re-rendered properly below)
      card.classList.remove('selected-blue');
    });

    if (selectedIds.length) {
      if (e.shiftKey || e.metaKey) {
        // union
        blueSelection = Array.from(new Set([...blueSelection, ...selectedIds]));
      } else if (!e.ctrlKey){
        // replace
        blueSelection = selectedIds;
      }
    } else if (!dragWasActive) {
      // It was a click with no drag — do nothing here, click handlers will handle it
    }

    // cleanup marquee
    if (marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
    marqueeEl = null;

    // small timeout to allow click suppression
    setTimeout(() => {
      dragWasActive = false;
      renderWindowContent();
    }, 0);
  }

  container.addEventListener('mouseup', (e) => endDrag(e));
  container.addEventListener('mouseleave', (e) => endDrag(e));
}

/**
 * Displays an empty state UI when there are no windows or no tabs in the active window.
 * Clears both the window tabs list and content area.
 * @returns {void}
 */
function showEmptyState() {
  const tabsList = document.getElementById('windowTabsList');
  const contentArea = document.getElementById('windowContent');
  
  tabsList.innerHTML = '';
  contentArea.innerHTML = '<div class="empty-state">No windows available</div>';
  contentArea.classList.remove('active');
}

// Listen for changes in tabs
chrome.tabs.onCreated.addListener(() => {
  loadWindowsAndTabs();
});

chrome.tabs.onRemoved.addListener(() => {
  loadWindowsAndTabs();
});

chrome.tabs.onMoved.addListener(() => {
  loadWindowsAndTabs();
});

chrome.windows.onCreated.addListener(() => {
  loadWindowsAndTabs();
});

chrome.windows.onRemoved.addListener(() => {
  loadWindowsAndTabs();
});

// Refresh every 2 seconds to show updated data
// Removed polling: UI updates are driven by tab/window events and snapshot diffs

