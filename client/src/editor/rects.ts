/**
 * The smallest rectangle around an element's boxes in client coordinates, like
 * `getBoundingClientRect`, but without empty boxes. In WebKit an element in a multi-column box with
 * column spanners (the pages of a document with columns) also has an empty box for each later row
 * of columns, at a wrong place, and `getBoundingClientRect` includes them.
 */
export function clientRect(element: Element): DOMRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of element.getClientRects()) {
    if (rect.width === 0 && rect.height === 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (left === Infinity) return element.getBoundingClientRect();
  return new DOMRect(left, top, right - left, bottom - top);
}
