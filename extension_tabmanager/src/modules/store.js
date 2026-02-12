/**
 * Central State Management
 */
class Store {
  constructor() {
    this.windowsData = []; // Array of window objects with their tabs
    this.activeWindowId = null; // ID of the currently active window
    this.lastSnapshot = null; // Last snapshot of windows/tabs for change detection;
    this.searchTargetWindowIds = new Set(); // Windows currently targeted by search
    this.uiWindowId = null; // Window ID where the UI is currently open
    this.savedWindowNames = {}; // Map of windowId to saved name for renaming purposes
    
    // New: Store Tab Groups Data
    this.tabGroups = [];

    // Selection State
    this.blueSelection = []; // Current selection (tab IDs)
    this.redSelection = [];  // Merge source
    this.yellowSelection = []; // Merge target
    this.mergeMode = null;   // null, 'red', 'yellow'
    
    // Flags
    this.moveTabsEnabled = false;
  }

  setWindows(data) {
    this.windowsData = data;
  }

  // New: Setter for Tab Groups
  setTabGroups(groups) {
    this.tabGroups = groups;
  }

  getActiveWindowId() {
    return this.activeWindowId;
  }

  setActiveWindowId(id) {
    this.activeWindowId = id;
  }

  clearAllSelections() {
    this.blueSelection = [];
    this.redSelection = [];
    this.yellowSelection = [];
    this.mergeMode = null;
  }
}

export const state = new Store();