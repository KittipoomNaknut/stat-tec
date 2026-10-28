/** Renderer settings (ARCHITECTURE §11.1). */
export const renderConfig = {
  /**
   * Internal resolution cap in device pixels: a 4K TV renders at ~1440p and upscales (HUD text
   * stays sharp because it is DOM). `?maxh=1080` lowers it on site if the kiosk GPU struggles.
   */
  maxInternalHeight: 1440,
};

export function renderConfigFromUrl(search: string): typeof renderConfig {
  const maxh = Number(new URLSearchParams(search).get('maxh'));
  return { maxInternalHeight: maxh > 0 ? maxh : renderConfig.maxInternalHeight };
}
