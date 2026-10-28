/** Minimal horizontal bar chart (SVG) for the benchmark report. Debug tooling only. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 640;
const LABEL_W = 72;
const VALUE_W = 120;
const BAR_H = 16;
const BAR_GAP = 2;
const ROW_GAP = 14;
const AXIS_H = 22;
/** Band above the plot for reference-line labels, so they never collide with bar values. */
const REF_H = 18;

export interface BarSeries {
  name: string;
  /** CSS color for the bars. */
  color: string;
  values: readonly number[];
}

export interface BarChartOptions {
  categories: readonly string[];
  series: readonly BarSeries[];
  unit: string;
  /** Optional tick per category drawn over the first series, e.g. a p95. */
  markers?: { name: string; values: readonly number[] };
  /** Vertical reference lines, e.g. a frame budget. */
  references?: readonly { value: number; label: string }[];
  digits?: number;
}

/** Returns a figure element; hover any bar for exact values. */
export function barChart(options: BarChartOptions): HTMLElement {
  const { categories, series, unit, markers, references = [], digits = 1 } = options;
  const fmt = (v: number) => `${v.toFixed(digits)} ${unit}`;

  const max =
    Math.max(
      ...series.flatMap((s) => s.values),
      ...(markers?.values ?? []),
      ...references.map((r) => r.value),
    ) * 1.08 || 1;
  const rowH = series.length * BAR_H + (series.length - 1) * BAR_GAP;
  const plotW = WIDTH - LABEL_W - VALUE_W;
  const plotTop = references.length > 0 ? REF_H : 0;
  const plotBottom = plotTop + categories.length * (rowH + ROW_GAP);
  const height = plotBottom + AXIS_H;
  const xOf = (v: number) => LABEL_W + (v / max) * plotW;

  const figure = document.createElement('figure');
  figure.className = 'bench-chart';
  if (series.length > 1) figure.append(legend(series));

  const svg = el('svg', { viewBox: `0 0 ${String(WIDTH)} ${String(height)}`, role: 'img' });
  const tooltip = document.createElement('div');
  tooltip.className = 'bench-tooltip';
  tooltip.hidden = true;

  for (const tick of niceTicks(max)) {
    const x = xOf(tick);
    svg.append(
      el('line', { x1: x, x2: x, y1: plotTop, y2: plotBottom, class: 'grid' }),
      text(String(tick), x, height - 6, 'axis', 'middle'),
    );
  }

  // Reference lines go under the bars and labels.
  for (const ref of references) {
    const x = xOf(ref.value);
    svg.append(
      el('line', { x1: x, x2: x, y1: plotTop - 4, y2: plotBottom, class: 'reference' }),
      text(ref.label, x, REF_H - 8, 'reference-label', 'middle'),
    );
  }

  categories.forEach((category, row) => {
    const top = plotTop + row * (rowH + ROW_GAP);
    svg.append(text(category, LABEL_W - 10, top + rowH / 2 + 5, 'category', 'end'));
    series.forEach((s, k) => {
      const value = s.values[row] ?? 0;
      const y = top + k * (BAR_H + BAR_GAP);
      const bar = el('path', {
        d: roundedBar(LABEL_W, y, xOf(value) - LABEL_W, BAR_H),
        fill: s.color,
      });
      const hit = el('rect', { x: LABEL_W, y, width: plotW, height: BAR_H, class: 'hit' });
      const details = [
        `${category} · ${s.name}: ${fmt(value)}`,
        ...(k === 0 && markers ? [`${markers.name}: ${fmt(markers.values[row] ?? 0)}`] : []),
      ];
      hit.addEventListener('pointerenter', () => {
        tooltip.textContent = details.join('\n');
        tooltip.hidden = false;
      });
      hit.addEventListener('pointermove', (e) => {
        const box = figure.getBoundingClientRect();
        tooltip.style.transform = `translate(${String(e.clientX - box.left + 12)}px, ${String(e.clientY - box.top + 12)}px)`;
      });
      hit.addEventListener('pointerleave', () => {
        tooltip.hidden = true;
      });
      // The label starts past both the bar end and its marker, and names the marker's value
      // so the number beside the tick is never mistaken for it.
      let labelX = xOf(value);
      let label = fmt(value);
      if (k === 0 && markers) {
        const markerValue = markers.values[row] ?? 0;
        const mx = xOf(markerValue);
        svg.append(el('line', { x1: mx, x2: mx, y1: y - 3, y2: y + BAR_H + 3, class: 'marker' }));
        labelX = Math.max(labelX, mx);
        label += ` · ${markers.name} ${markerValue.toFixed(digits)}`;
      }
      svg.append(bar, text(label, labelX + 6, y + BAR_H - 4, 'value', 'start'));
      svg.append(hit);
    });
  });

  figure.append(svg, tooltip);
  return figure;
}

function legend(series: readonly BarSeries[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'bench-legend';
  for (const s of series) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.style.background = s.color;
    item.append(swatch, s.name);
    list.append(item);
  }
  return list;
}

/** Bar with 4px rounded corners on the data end only, anchored at the baseline. */
function roundedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return '';
  return `M${String(x)},${String(y)}h${String(w - r)}a${String(r)},${String(r)} 0 0 1 ${String(r)},${String(r)}v${String(h - 2 * r)}a${String(r)},${String(r)} 0 0 1 ${String(-r)},${String(r)}h${String(-(w - r))}z`;
}

function niceTicks(max: number): number[] {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(Number(t.toPrecision(6)));
  return ticks;
}

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(content: string, x: number, y: number, cls: string, anchor: string): SVGElement {
  const node = el('text', { x, y, class: cls, 'text-anchor': anchor });
  node.textContent = content;
  return node;
}
