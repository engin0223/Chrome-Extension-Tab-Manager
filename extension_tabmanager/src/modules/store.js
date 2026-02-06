/**
 * Central State Management
 */
class Store {
  constructor() {
    this.windowsData = [];
    this.activeWindowId = null;
    this.lastSnapshot = null;
    this.searchTargetWindowIds = new Set();
    this.uiWindowId = null;
    this.savedWindowNames = {};
    
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