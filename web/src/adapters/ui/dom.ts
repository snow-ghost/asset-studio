// el finds an element the page promises to have. Failing at startup with the id in the message beats a
// null dereference later, when the designer has already made something.
export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}
