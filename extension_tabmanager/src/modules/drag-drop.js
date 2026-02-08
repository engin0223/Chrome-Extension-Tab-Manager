import { state } from './store.js';
import { rectsIntersect } from './utils.js';
import { fetchWindowsAndTabs, refreshUiWindowId, moveTabs, createSplitWindow } from './api.js';

// --- Constants & Config ---
const DRAG_THRESHOLD = 5;
const SCROLL_DELAY = 700;

// Global tracker
let globalDragWasActive = false;

export function wasDragActive() {
  return globalDragWasActive;
}

export function attachDragHandlers(container, refreshCallback) {
  // --- State Containers ---
  let dragState = {
    active: false,
    pending: false,
    ghost: null,
    placeholder: null,
    start: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    cardDims: { width: 0, height: 0 },
    insertIndex: -1,
    lastMouseX: 0,
    hoverWindowTimer: null,
    lastHoverWindowId: null,
    sortedSelection: []
  };

  let marqueeState = {
    active: false,
    el: null,
    start: { x: 0, y: 0 }
  };

  // --- Helpers ---

  const clearHoverTimer = () => {
    if (dragState.hoverWindowTimer) {
      clearTimeout(dragState.hoverWindowTimer);
      dragState.hoverWindowTimer = null;
      dragState.lastHoverWindowId = null;
    }
  };

  // Helper to get selected IDs sorted by their actual DOM order (visual order)
  const getSortedSelection = () => {
    const allCards = Array.from(container.querySelectorAll('.page-card'));
    return allCards
      .map(card => Number(card.dataset.tabId))
      .filter(id => state.blueSelection.includes(id));
  };

  const createGhost = (e) => {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    Object.assign(ghost.style, {
      position: 'fixed', zIndex: 9999, transform: 'scale(0.95)',
      display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'none',
      boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
      left: (e.clientX - dragState.offset.x) + 'px',
      top: (e.clientY - dragState.offset.y) + 'px'
    });

    // CHANGE: Iterate through DOM elements to ensure Ghost items are sorted by original index
    const allCards = Array.from(container.querySelectorAll('.page-card'));
    
    allCards.forEach(el => {
      const tabId = Number(el.dataset.tabId);
      if (state.blueSelection.includes(tabId)) {
        const clone = el.cloneNode(true);
        clone.style.width = Math.min(el.getBoundingClientRect().width, 340) + 'px';
        clone.style.margin = '0';
        clone.classList.remove('drop-target', 'insert-before', 'insert-after', 'selected-blue');
        ghost.appendChild(clone);
        el.style.display = 'none'; // Hide original
      }
    });

    return ghost;
  };

  const updatePlaceholder = (targetCard, insertAfter) => {
    if (!dragState.placeholder) {
      dragState.placeholder = document.createElement('div');
      dragState.placeholder.className = 'insertion-placeholder';
      Object.assign(dragState.placeholder.style, {
        pointerEvents: 'none', flexShrink: '0', borderRadius: '8px',
        background: 'rgba(0,0,0,0.03)',
        width: dragState.cardDims.width + 'px',
        height: dragState.cardDims.height + 'px'
      });
    }

    if (insertAfter) {
      // If we are appending after the last card
      if (!targetCard.nextSibling) container.appendChild(dragState.placeholder);
      else container.insertBefore(dragState.placeholder, targetCard.nextSibling);
    } else {
      container.insertBefore(dragState.placeholder, targetCard);
    }
  };

  // --- Core Logic ---

  const startMoveDrag = (e) => {
    dragState.active = true;
    dragState.pending = false;
    globalDragWasActive = false;

    // Capture dimensions of the first selected card (in DOM order) for the placeholder
    dragState.sortedSelection = getSortedSelection();
    if (dragState.sortedSelection.length > 0) {
      const firstId = dragState.sortedSelection[0];
      const firstEl = container.querySelector(`.page-card[data-tab-id="${firstId}"]`);
      if (firstEl) {
        const rect = firstEl.getBoundingClientRect();
        dragState.cardDims = { width: rect.width, height: rect.height };
      }
    }

    dragState.ghost = createGhost(e);
    document.body.appendChild(dragState.ghost);
  };

const handleMoveDrag = (e) => {
    globalDragWasActive = true;
    const { ghost, offset } = dragState;

    // 1. Update Ghost Position
    ghost.style.left = (e.clientX - offset.x) + 'px';
    ghost.style.top = (e.clientY - offset.y) + 'px';

    // 2. Peek under the placeholder/ghost to find the real element
    if (dragState.placeholder) dragState.placeholder.style.display = 'none';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (dragState.placeholder) dragState.placeholder.style.display = 'block';

    if (!elUnder) return;

    // --- New Window Handling ---
    const newWinBtn = elUnder.closest('#newWindowBtn');
    const btnEl = document.getElementById('newWindowBtn');
    if (btnEl) btnEl.classList.toggle('drop-target', !!newWinBtn);

    if (newWinBtn) {
      if (dragState.placeholder) { dragState.placeholder.remove(); dragState.placeholder = null; }
      dragState.insertIndex = -1;
      return;
    }

    // --- Sidebar Window Hover (Switching Windows) ---
    const winBtn = elUnder.closest('.window-tab');
    const hoveredWinId = winBtn ? Number(winBtn.dataset.windowId) : null;

    if (hoveredWinId && hoveredWinId !== dragState.lastHoverWindowId) {
      dragState.lastHoverWindowId = hoveredWinId;
      if (dragState.hoverWindowTimer) clearTimeout(dragState.hoverWindowTimer);
      dragState.hoverWindowTimer = setTimeout(() => {
        state.activeWindowId = hoveredWinId;
        state.searchTargetWindowIds = new Set([hoveredWinId]);
        refreshCallback();
      }, SCROLL_DELAY);
    } else if (!hoveredWinId) {
      clearHoverTimer();
    }

    // --- Core Insertion Logic ---
    let card = elUnder.closest('.page-card');
    let forceInsertAfter = false;

    // Edge Case: Hovering in empty space at the bottom of the list
    if (!card) {
      // Find visible cards only (ignore the ones we are dragging which are display:none)
      const visibleCards = Array.from(container.querySelectorAll('.page-card:not([style*="display: none"])'));
      if (visibleCards.length > 0) {
        const lastCard = visibleCards[visibleCards.length - 1];
        const rect = lastCard.getBoundingClientRect();
        // If mouse is below the last visible card
        if (e.clientY > rect.bottom) {
          card = lastCard;
          forceInsertAfter = true;
        }
      }
    }

    if (card) {
      const targetWinId = Number(card.dataset.windowId);
      const targetWin = state.windowsData.find(w => w.id === targetWinId);

      if (targetWin) {
        // A. CREATE THE "CLEAN LIST"
        // This is the list of tabs as they will look AFTER we remove the dragged items
        // but BEFORE we insert them in the new spot.
        const cleanTabs = targetWin.tabs.filter(t => !state.blueSelection.includes(t.id));

        // B. Find the target's index within this Clean List
        const targetTabId = Number(card.dataset.tabId);
        let cleanIndex = cleanTabs.findIndex(t => t.id === targetTabId);

        if (cleanIndex !== -1 || forceInsertAfter) {
          // Geometry Check: Are we in the top half (insert before) or bottom half (insert after)?
          const rect = card.getBoundingClientRect();
          const midY = rect.top + (rect.height / 2);
          const isBottomHalf = e.clientY > midY;

          const shouldInsertAfter = forceInsertAfter || isBottomHalf;

          // C. CALCULATE FINAL INDEX
          // If inserting after, we add 1 to the clean index.
          // Example: List [A, B], Target A (idx 0). Insert After -> Index 1. 
          // Result: [A, (New), B]
          dragState.insertIndex = shouldInsertAfter ? cleanIndex + 1 : cleanIndex;

          console.log(dragState.insertIndex);

          // D. UPDATE PLACEHOLDER VISUALLY
          // We still use the DOM element 'card' for visual placement
          updatePlaceholder(card, shouldInsertAfter);
        }
      }
    }
  };

  const handleMarqueeDrag = (e) => {
    const { start } = marqueeState;
    const rect = container.getBoundingClientRect();
    const currX = e.clientX - rect.left + container.scrollLeft;
    const currY = e.clientY - rect.top + container.scrollTop;

    // Threshold check
    if (!globalDragWasActive) {
      if (Math.abs(currX - start.x) < DRAG_THRESHOLD && Math.abs(currY - start.y) < DRAG_THRESHOLD) return;
      globalDragWasActive = true;
    }

    // Update Visuals
    const x1 = Math.min(start.x, currX), y1 = Math.min(start.y, currY);
    const x2 = Math.max(start.x, currX), y2 = Math.max(start.y, currY);

    marqueeState.el.style.left = x1 + 'px';
    marqueeState.el.style.top = y1 + 'px';
    marqueeState.el.style.width = (x2 - x1) + 'px';
    marqueeState.el.style.height = (y2 - y1) + 'px';

    // Selection Logic
    const marqueeRect = {
      left: x1 - container.scrollLeft + rect.left,
      top: y1 - container.scrollTop + rect.top,
      right: x2 - container.scrollLeft + rect.left,
      bottom: y2 - container.scrollTop + rect.top
    };

    const isAdditive = e.shiftKey || e.metaKey || e.ctrlKey;

    container.querySelectorAll('.page-card').forEach(card => {
      const isIntersecting = rectsIntersect(marqueeRect, card.getBoundingClientRect());
      const tabId = Number(card.dataset.tabId);

      if (isIntersecting) {
        card.classList.add('selected-blue');
      } else if (isAdditive) {
        // In additive mode, only deselect if it wasn't already selected before drag
        if (!state.blueSelection.includes(tabId)) card.classList.remove('selected-blue');
      } else {
        card.classList.remove('selected-blue');
      }
    });
  };

  // --- Event Listeners ---

  const onMouseMove = (e) => {
    if (dragState.pending) {
      const dist = Math.sqrt(Math.pow(e.clientX - dragState.start.x, 2) + Math.pow(e.clientY - dragState.start.y, 2));
      if (dist > DRAG_THRESHOLD) startMoveDrag(e);
    } else if (dragState.active) {
      handleMoveDrag(e);
    } else if (marqueeState.active) {
      handleMarqueeDrag(e);
    }
  };

  const onMouseUp = async (e) => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    // Cleanup drag state
    dragState.pending = false;
    clearHoverTimer();

    // 1. Handle Move Drop
    if (dragState.active) {
      // --- FIX: Calculate offset based on DOM position before removing placeholder ---
      let blueTabsBeforePlaceholder = 0;
      if (dragState.placeholder) {
        let sibling = dragState.placeholder.previousElementSibling;
        while (sibling) {
          // Check if sibling is a card and is part of the current blue selection
          if (sibling.classList.contains('page-card')) {
             const tId = Number(sibling.dataset.tabId);
             if (state.blueSelection.includes(tId)) {
               blueTabsBeforePlaceholder++;
             }
          }
          sibling = sibling.previousElementSibling;
        }
      }
      // -----------------------------------------------------------------------------

      dragState.active = false;
      if (dragState.ghost) { dragState.ghost.remove(); dragState.ghost = null; }
      if (dragState.placeholder) { dragState.placeholder.remove(); dragState.placeholder = null; }

      const newWinBtn = document.getElementById('newWindowBtn');
      if (newWinBtn) newWinBtn.classList.remove('drop-target');

      // Restore hidden originals
      state.blueSelection.forEach(id => {
        const el = container.querySelector(`.page-card[data-tab-id="${id}"]`);
        if (el) el.style.display = '';
      });

      // Determine drop action
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isNewWindowDrop = el && el.closest('#newWindowBtn');

      const sortedSelection = dragState.sortedSelection;

      if (isNewWindowDrop && sortedSelection.length) {
        // --- CASE: Drop on New Window (Sequential) ---
        await refreshUiWindowId();

        state.blueSelection = [];
        container.querySelectorAll('.page-card.selected-blue').forEach(c => c.classList.remove('selected-blue'));

        // 1. Create window with ONLY the FIRST tab
        const firstTabId = sortedSelection[0];
        const remainingTabs = sortedSelection.slice(1);
        
        // Create window using just the first item
        const newWin = await createSplitWindow([firstTabId]);
        
        state.activeWindowId = newWin.id;
        state.searchTargetWindowIds = new Set([newWin.id]);

        // 2. Move the remaining tabs one by one into that new window
        let targetIndex = 1;
        
        for (const tabId of remainingTabs) {
          await moveTabs([tabId], newWin.id, targetIndex);
          targetIndex++; 
        }

        await new Promise(r => setTimeout(r, 200)); 
        await fetchWindowsAndTabs();
        refreshCallback();

      } else {
        // --- CASE: Reorder / Move to Window (Sequential) ---
        let targetWinId = state.activeWindowId;
        const card = el ? el.closest('.page-card') : null;
        const winBtn = el ? el.closest('.window-tab') : null;

        // 1. Determine Target Window
        if (card) targetWinId = Number(card.dataset.windowId);
        else if (winBtn) targetWinId = Number(winBtn.dataset.windowId);

        // 2. FIX: Handle Fast Drop (Determine Index)
        let finalInsertIndex = dragState.insertIndex;

        if (winBtn && !card) {
          const targetWinData = state.windowsData.find(w => w.id === targetWinId);
          if (targetWinData) {
            finalInsertIndex = targetWinData.tabs.length;
          }
        }

        if (sortedSelection.length) {
          await refreshUiWindowId();
          
          let offsetIndex = blueTabsBeforePlaceholder; 

          // Loop through selected tabs
          for (const tabId of sortedSelection) {
            await moveTabs([tabId], targetWinId, finalInsertIndex + offsetIndex);
          }

          setTimeout(() => {
            state.activeWindowId = targetWinId;
            state.blueSelection = [];
            fetchWindowsAndTabs().then(() => {
              state.searchTargetWindowIds = new Set([targetWinId]); 
              refreshCallback();
            });
          }, 300);
        }
      }
      return;
    }

    // 2. Handle Marquee End
    if (marqueeState.active) {
      marqueeState.active = false;
      if (marqueeState.el) marqueeState.el.remove();

      if (globalDragWasActive) {
        const selected = container.querySelectorAll('.page-card.selected-blue');
        const ids = Array.from(selected).map(c => Number(c.dataset.tabId));
        
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          state.blueSelection = [...new Set([...state.blueSelection, ...ids])];
        } else {
          state.blueSelection = ids;
        }
        refreshCallback();
      }
      setTimeout(() => { globalDragWasActive = false; }, 0);
    }
  };

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.page-card-close-btn')) return;

    // Blur active inputs
    if (document.activeElement && (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable)) {
      document.activeElement.blur();
    }

    const card = e.target.closest('.page-card');

    // Case A: Start Move Drag
    if (card && state.moveTabsEnabled) {
      const tid = Number(card.dataset.tabId);

      // CHANGE: Check if card is selected OR if Alt key is held
      const isSelected = state.blueSelection.includes(tid);
      const isAltDrag = e.altKey;
      const rect = card.getBoundingClientRect();

      if (isSelected || isAltDrag) {
        
        // If using Alt-Drag on an unselected item, select it immediately.
        // This ensures createGhost and handleMoveDrag recognize the item.
        if (isAltDrag && !isSelected) {
          // 1. Update State to singular selection
          state.blueSelection = [tid];

          // 2. Update Visuals immediately (needed for createGhost to pick up the style)
          container.querySelectorAll('.page-card.selected-blue')
            .forEach(c => c.classList.remove('selected-blue'));
          card.classList.add('selected-blue');

          // 3. Notify parent/store
          refreshCallback();
        }

        dragState.pending = true;
        dragState.start = { x: e.clientX, y: e.clientY };
        dragState.lastMouseX = e.clientX;
        console.log("Drag Start:", dragState.start); 
        dragState.offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        
        e.preventDefault();
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return;
      }
    }

    // Case B: Start Marquee
    marqueeState.active = true;
    globalDragWasActive = false;
    const rect = container.getBoundingClientRect();
    marqueeState.start = { 
      x: e.clientX - rect.left + container.scrollLeft, 
      y: e.clientY - rect.top + container.scrollTop 
    };

    marqueeState.el = document.createElement('div');
    marqueeState.el.className = 'marquee';
    Object.assign(marqueeState.el.style, {
      left: marqueeState.start.x + 'px', top: marqueeState.start.y + 'px',
      width: '0px', height: '0px'
    });
    container.appendChild(marqueeState.el);

    e.preventDefault();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}