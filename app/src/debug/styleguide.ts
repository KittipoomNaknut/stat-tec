import './styleguide.css';

/**
 * `?styleguide` — the HUD building blocks composed like a real chapter screen, to judge type
 * sizes, contrast and spacing on the kiosk TV (research 011). `?styleguide&dwell=0.6` sets the
 * hovered button's dwell fill.
 */
export function showStyleguide(parent: HTMLElement, search: string): void {
  const dwell = Number(new URLSearchParams(search).get('dwell') ?? '0.6');
  const view = document.createElement('div');
  view.className = 'styleguide';
  view.innerHTML = `
    <header class="styleguide-top">
      <div class="hud-panel hud-tile">
        <p class="hud-label">Chapter <span class="hud-label-accent">02</span> / 05</p>
        <ol class="hud-progress">
          <li class="is-done"></li><li class="is-current"></li><li></li><li></li><li></li>
        </ol>
      </div>
      <div class="hud-panel hud-tile styleguide-profit">
        <p class="hud-label-th">กำไรสะสม</p>
        <span class="hud-number">฿1,240,000</span>
      </div>
    </header>

    <section class="styleguide-center">
      <p class="hud-label hud-label-accent">Regression &amp; Optimization</p>
      <h1 class="hud-headline">ตั้งราคากาแฟ</h1>
      <span class="hud-number hud-number-hero">฿75</span>
      <div class="styleguide-buttons">
        <div class="hud-panel hud-button is-hover" style="--dwell: ${String(dwell)}">
          <span>ตั้งราคานี้</span><span class="hud-button-hint">HOLD</span>
        </div>
        <div class="hud-panel hud-button"><span>ข้าม</span><span class="hud-button-hint">SKIP</span></div>
      </div>
    </section>

    <aside class="styleguide-swatches">
      ${['bg', 'bg-grid', 'primary', 'accent', 'positive', 'negative', 'text', 'text-dim']
        .map(
          (t) =>
            `<div><i style="background: var(--${t})"></i><span class="hud-label">${t}</span></div>`,
        )
        .join('')}
    </aside>

    <div class="hud-panel hud-caption is-speaking">
      <div class="hud-caption-speaker">
        <span class="hud-voice"><i></i><i></i><i></i></span>
        <p class="hud-label hud-label-accent">[AI_NAME]</p>
      </div>
      <p class="hud-caption-text">ท่านตั้งราคา <b>฿75</b> — รายได้ <b>฿18,400</b> / วัน<br />ทีนี้… ให้ AI วิเคราะห์บ้าง</p>
    </div>`;
  parent.append(view);
}
