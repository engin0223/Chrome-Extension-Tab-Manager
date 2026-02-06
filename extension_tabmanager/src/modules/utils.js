/**
 * Determines if two rectangles intersect using AABB.
 */
export function rectsIntersect(a, b) {
  return !(a.left > b.right || a.right < b.left || a.top > b.bottom || a.bottom < b.top);
}

/**
 * Helper to debounce function calls.
 */
export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}