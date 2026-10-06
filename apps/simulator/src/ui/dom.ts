/** Looks up a required element by id; the page is static, so a miss is a programming error. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
