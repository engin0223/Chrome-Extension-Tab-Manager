# Tab Manager (Chrome extension)

Lightweight Chrome extension to help merge, split, and organize tabs between windows using a compact UI.

This extension provides quick actions to merge and split windows and tabs via the packaged UI (`ui.html`).

**Key features**
- **Visual UI** for viewing windows and selecting tabs to merge or split.
- **Search & Filter**: Quickly find tabs across all or specific windows.
- **Window Renaming**: Give custom names to your windows for better organization.
- **Theme Support**: Toggle between Dark and Light modes.
- **Drag (marquee) selection** and multi-select with Ctrl/Cmd for flexible tab grouping.
- **One-click merge/split** operations from the UI.
- **Experimental Drag-and-Drop**: Reorder tabs or move them between windows (enable in Options).

**Works with:** Chrome Manifest V3

**Quick install (developer)**
1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder (`extension_tabmanager` inside the repo).
5. The extension icon should appear in the toolbar. Click the action icon to open the UI.

**Usage**
-- Click the extension action (toolbar icon) to open the packaged UI (`ui.html`) which shows windows and tabs. All management operations are performed from this UI.

## Detailed Usage — UI controls, clicks and keys

This section explains how to use the packaged UI (`ui.html`) and the meanings of clicks, gestures, and shortcuts.

### Window List (Sidebar)
- **Select Window**: Single click to make it the active window and view its tabs.
- **Rename Window**: Click on the window title (when active) to rename it. Press **Enter** to save.
- **Selection**:
    - **Ctrl/Cmd + Click**: Toggle selection of all tabs in that window.
    - **Double-click**: Switch to that window and select all its tabs.
- **New Window**: Click the **+** button at the bottom of the list to create a blank window.
- **Close Window**: Click the **✕** button to close the window and all its tabs.

### Tab Cards (Main Content)
- **Selection**:
	- **Single click**: Select the tab (blue selection).
	- **Ctrl/Cmd + click**: Toggle selection (add/remove from blue selection).
- **Marquee Selection**: Click and drag in an empty space to draw a box. Cards touching the box become selected.
    - Hold **Shift** while dragging to add to the existing selection.
- **Switch Tab**: Double-click a card to focus that tab in the browser.
- **Close Tab**: Click the **✕** button on a card to close it.

### Top Controls
- **Search**: Type in the search bar to filter tabs by title or URL.
    - Click the **Filter icon** next to the search bar to choose which windows to include in the search (All, None, or specific windows).
- **Theme Toggle**: Click the **🌓** icon to switch between Light and Dark themes.
- **Merge Actions**:
	- `Merge` (multi-stage):
		1. **Stage 1**: Select tabs (blue) to be the *source*, then click `Merge` (turns red).
		2. **Stage 2**: Select tabs (blue) to be the *target* group, then click `Merge` (turns yellow).
		3. **Stage 3**: Click `Merge` again to execute. A new window is created combining the source and target groups.
	- `Merge All`: Moves all tabs from *other* windows into the currently active window.
	- `Split`: Moves the currently selected tabs (blue) into a newly created window.

### Keyboard Shortcuts
- `Escape`: Clear all selections and exit merge mode.
- `Delete`: Close the currently selected tabs.
- `Enter`: Save window name (while renaming).

### Experimental Features (Options)
Right-click the extension icon and select **Options** to enable experimental features:
- **Enable Move Tabs**: When checked, you can drag selected tabs (blue) to reorder them or drop them onto another window in the sidebar to move them instantly.

## Files of interest
- `manifest.json` — Extension metadata and permissions (Manifest V3).
- `background.js` — Service worker; opens the packaged UI.
- `ui.html`, `ui.js`, `ui.css` — The main interface for managing tabs.
- `options.html`, `options.js` — Settings page for feature flags.

**Permissions required**
- `tabs` — To move, query, and close tabs.
- `windows` — To create and manage browser windows.
- `storage` — To save custom window names and settings.
- `favicon` — To display tab icons.