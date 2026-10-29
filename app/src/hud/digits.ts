/**
 * Writes a number into fixed-width digit cells. Orbitron has no tabular figures ("1" is 39 px,
 * "8" is 83 px at 100 px), so a counting number in plain text shakes sideways; cells keep every
 * digit in place (research 016). Separators get narrow cells.
 */
export function setDigits(el: HTMLElement, text: string): void {
  // Digits, separators and ฿ only: one code point per cell.
  const chars = Array.from(text);
  if (el.dataset['text'] === text) return;
  el.dataset['text'] = text;
  el.classList.add('hud-digits');
  const cells = el.children;
  // Rebuild only when the shape changes (more digits, a new separator); otherwise edit in place.
  const shape = chars.map((c) => (/\d/.test(c) ? 'd' : c)).join('');
  if (el.dataset['shape'] !== shape) {
    el.dataset['shape'] = shape;
    el.replaceChildren(
      ...chars.map((c) => {
        const i = document.createElement('i');
        if (!/\d/.test(c)) i.className = c === '฿' ? 'is-currency' : 'is-narrow';
        i.textContent = c;
        return i;
      }),
    );
    return;
  }
  chars.forEach((c, k) => {
    const cell = cells[k];
    if (cell && cell.textContent !== c) cell.textContent = c;
  });
}
