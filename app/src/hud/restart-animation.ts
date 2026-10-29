/** Replays a CSS animation class (remove, force a style flush, add back). */
export function restartAnimation(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  el.getBoundingClientRect();
  el.classList.add(className);
}
