# Tab Manager (Chrome extension)

A powerful, lightweight Chrome extension to help organize, merge, split, and save tabs and groups between windows using a comprehensive dashboard UI.

**Key features**
- **Visual Dashboard**: View all open windows and tabs in a card-based layout.
- **Session Management**: Save your current window setups as named sessions and restore them later.
- **Persistent Tab Groups**: Auto-syncs open tab groups and allows you to save/restore groups from the sidebar.
- **Advanced Search & Filter**: Find tabs by title or URL across all windows or specific selected windows.
- **Window Organization**: Rename windows, create new ones, or merge entire windows with one click.
- **Drag & Drop**:
  - **Marquee Selection**: Drag to select multiple tabs.
  - **Reorder & Move**: Drag tabs to reorder them or move them between windows (Enable in Options).
- **Context Menus**: Right-click on groups for quick actions like "Move to New Window", "Ungroup", or "Delete".
- **Theme Support**: Built-in Dark and Light modes.

**Works with:** Chrome Manifest V3

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `extension_tabmanager` folder inside the project directory.
6. The extension icon should appear in your toolbar. Click it to open the dashboard.

---

## Usage Guide

Click the extension icon to open the main dashboard (`ui.html`).

### 1. The Sidebar (Sessions & Groups)
Access saved content by toggling the sidebar button (top-left).
- **Saved Groups**:
  - Automatically tracks open groups.
  - Click "Save Current" to snapshot your current windows as a Session.
  - **Restore**: Click the restore icon next to a group or session to open it.
  - **Auto-Sync**: Open groups are automatically synced to storage to prevent data loss.

### 2. Main Dashboard (Windows & Tabs)
- **Selection**:
    - **Click**: Select a single tab.
    - **Ctrl/Cmd + Click**: Add/remove individual tabs from selection.
    - **Marquee (Drag)**: Click and drag in empty space to select multiple tabs at once.
    - **Ctrl + A**: Select all tabs.
- **Window Management**:
    - **Rename**: Click a window's title tab at the top to rename it.
    - **Switch**: Click a window tab to view its contents.
    - **New Window**: Click the **+** button in the tab bar.

### 3. Top Toolbar Actions
- **Merge**:
    - *Stage 1*: Select tabs (Source) -> Click Merge.
    - *Stage 2*: Select tabs (Target) -> Click Merge.
    - *Stage 3*: Click Merge again to combine them into a new split window.
- **Merge All**: Consolidates all tabs from all other windows into the current active window.
- **Split**: Moves currently selected tabs into a brand new window.
- **Group Selected**: Creates a native Chrome Tab Group from the selected tabs (with color/name picker).

### 4. Search
- Type in the search bar to filter tabs instantly.
- Click the **Filter icon** to toggle which windows are included in the search results.

### 5. Context Menus
- **Right-click** on a tab group or split-view card to access specific actions:
    - New tab in group
    - Move group to new window
    - Ungroup
    - Close/Delete group

---

## Configuration & Options
Right-click the extension icon in the toolbar and select **Options**.
- **Enable Drag-and-Drop Move**: Allows you to physically drag selected tabs to different windows or reorder them within the list.

---

## Project Structure

This extension uses a modular JavaScript architecture.

- `manifest.json`: Configuration and permissions.
- `src/background/`:
  - `service-worker.js`: Handles background events and opens the main UI.
- `src/modules/`: Core logic libraries.
  - `api.js`: Wrappers for Chrome APIs (Windows, Tabs, Groups).
  - `store.js`: Central state management.
  - `session-manager.js`: Logic for saving/restoring sessions and groups.
  - `drag-drop.js`: Drag-and-drop interaction logic.
  - `ui-renderer.js`: Generates the HTML for cards and lists.
- `src/pages/`:
  - `ui/`: Main dashboard files (`ui.html`, `main.js`).
  - `options/`: Settings page.
- `src/assets/`: Styles (CSS) and images.

## Permissions

- `tabs`: To access title, URL, and manipulate tab state.
- `windows`: To create, close, and focus windows.
- `tabGroups`: To query, save, and restore tab groups.
- `storage`: To persist saved sessions, window names, and user preferences.
- `favicon`: To display favicons for tabs.
