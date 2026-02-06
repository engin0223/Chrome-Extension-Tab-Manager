import { state } from './store.js';
import { rectsIntersect } from './utils.js';
import { fetchWindowsAndTabs, refreshUiWindowId, moveTabs } from './api.js';
import { renderWindowContent } from './ui-renderer.js';

export function attachDragHandlers(container, refreshCallback) {
  let isDragging = false;
  let dragStart = null;
  let marqueeEl = null;
  let dragWasActive = false;

  // Move Drag Vars
  let isMoveDragging = false;
  let moveGhost = null;
  let moveDragStart = null;
  let moveDirection = 0;
  let currentInsertIndex = -1;
  let insertionPlaceholder = null;

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.page-card-close-btn')) return;

    if (document.activeElement) {
        const tagName = document.activeElement.tagName;
        const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA';
        const isEditable = document.activeElement.isContentEditable;

        if (isInput || isEditable) {
            document.activeElement.blur();
        }
    }
    
    // Check if dragging selected card
    const card = e.target.closest('.page-card');
    if (card && state.moveTabsEnabled) {
        const tid = Number(card.dataset.tabId);
        if (state.blueSelection.includes(tid)) {
            isMoveDragging = true;
            moveDragStart = { x: e.clientX, y: e.clientY };
            dragWasActive = false;
            
            // Create Ghost
            moveGhost = document.createElement('div');
            moveGhost.className = 'drag-ghost';
            moveGhost.style.cssText = 'position:fixed; z-index:9999; transform:scale(0.95); display:flex; flex-direction:column; gap:6px; pointer-events:none;';
            state.blueSelection.forEach(id => {
                const el = container.querySelector(`.page-card[data-tab-id="${id}"]`);
                if(el) {
                    const cl = el.cloneNode(true);
                    cl.style.width = el.getBoundingClientRect().width + 'px';
                    moveGhost.appendChild(cl);
                    el.style.display = 'none';
                }
            });
            document.body.appendChild(moveGhost);
            e.preventDefault();
            return;
        }
    }

    // Marquee Start
    isDragging = true;
    dragWasActive = false;
    const rect = container.getBoundingClientRect();
    dragStart = { x: e.clientX - rect.left + container.scrollLeft, y: e.clientY - rect.top + container.scrollTop };
    
    marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee';
    marqueeEl.style.left = dragStart.x + 'px';
    marqueeEl.style.top = dragStart.y + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
    container.appendChild(marqueeEl);
    e.preventDefault();
  });

  container.addEventListener('mousemove', (e) => {
    // 1. Handle Move Drag
    if (isMoveDragging && moveGhost) {
        dragWasActive = true;
        moveGhost.style.left = (e.clientX + 10) + 'px';
        moveGhost.style.top = (e.clientY + 10) + 'px';
        
        moveDirection = (e.clientX - moveDragStart.x) > 0 ? 1 : -1;
        
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const card = under ? under.closest('.page-card') : null;
        
        // Reset classes
        container.querySelectorAll('.page-card').forEach(c => {
            c.classList.remove('drop-target', 'insert-before', 'insert-after');
        });

        if (card) {
            card.classList.add('drop-target');
            card.classList.add(moveDirection > 0 ? 'insert-after' : 'insert-before');
            
            // Calc index
            const targetWinId = Number(card.dataset.windowId);
            const targetTabId = Number(card.dataset.tabId);
            const targetWin = state.windowsData.find(w => w.id === targetWinId);
            if (targetWin) {
                const idx = targetWin.tabs.findIndex(t => t.id === targetTabId);
                currentInsertIndex = moveDirection > 0 ? idx + 1 : idx;
            }
        }
        return;
    }

    // 2. Handle Marquee
    if (!isDragging || !marqueeEl) return;
    dragWasActive = true;
    const rect = container.getBoundingClientRect();
    const currX = e.clientX - rect.left + container.scrollLeft;
    const currY = e.clientY - rect.top + container.scrollTop;
    
    const x1 = Math.min(dragStart.x, currX);
    const y1 = Math.min(dragStart.y, currY);
    const x2 = Math.max(dragStart.x, currX);
    const y2 = Math.max(dragStart.y, currY);
    
    marqueeEl.style.left = x1 + 'px';
    marqueeEl.style.top = y1 + 'px';
    marqueeEl.style.width = (x2 - x1) + 'px';
    marqueeEl.style.height = (y2 - y1) + 'px';

    const marqueeRect = { left: x1 - container.scrollLeft + rect.left, top: y1 - container.scrollTop + rect.top, right: x2 - container.scrollLeft + rect.left, bottom: y2 - container.scrollTop + rect.top };
    
    container.querySelectorAll('.page-card').forEach(card => {
        if (rectsIntersect(marqueeRect, card.getBoundingClientRect())) card.classList.add('selected-blue');
        else if (!state.blueSelection.includes(Number(card.dataset.tabId))) card.classList.remove('selected-blue');
    });
  });

  const endDrag = async (e) => {
    if (isMoveDragging) {
        isMoveDragging = false;
        moveGhost.remove();
        moveGhost = null;
        container.querySelectorAll('.page-card').forEach(c => {
            c.style.display = ''; // Restore visibility
            c.classList.remove('drop-target', 'insert-before', 'insert-after');
        });
        
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const card = el ? el.closest('.page-card') : null;
        const winBtn = el ? el.closest('.window-tab') : null;
        let targetWinId = state.activeWindowId;
        
        if (card) targetWinId = Number(card.dataset.windowId);
        else if (winBtn) targetWinId = Number(winBtn.dataset.windowId);

        if (state.blueSelection.length) {
            await refreshUiWindowId();
            // Simple logic: move to end if no specific index
            const index = currentInsertIndex > -1 ? currentInsertIndex : -1;
            await moveTabs(state.blueSelection, targetWinId, index);
            
            setTimeout(() => {
                state.activeWindowId = targetWinId;
                state.blueSelection = [];
                fetchWindowsAndTabs().then(refreshCallback);
            }, 300);
        }
        return;
    }

    if (!isDragging) return;
    isDragging = false;
    if (marqueeEl) marqueeEl.remove();
    
    if (dragWasActive) {
        // Finalize Marquee Selection
        const selected = container.querySelectorAll('.page-card.selected-blue');
        const ids = Array.from(selected).map(c => Number(c.dataset.tabId));
        
        if (e.shiftKey || e.metaKey) state.blueSelection = [...new Set([...state.blueSelection, ...ids])];
        else state.blueSelection = ids;
        
        refreshCallback();
    }
  };

  container.addEventListener('mouseup', endDrag);
  container.addEventListener('mouseleave', endDrag);
}

export function wasDragActive() { return false; } // Simplified holder