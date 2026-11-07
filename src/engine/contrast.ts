// A critter's outline has to show on both of GitHub's pages, since GIF transparency is all or nothing.
export const LIGHT_PAGE: readonly number[] = [255, 255, 255];
export const DARK_PAGE: readonly number[] = [0x0d, 0x11, 0x17];
export const MIN_EDGE_CONTRAST = 2;

export function luminance(r: number, g: number, b: number): number {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: readonly number[], b: readonly number[]): number {
  const la = luminance(a[0], a[1], a[2]);
  const lb = luminance(b[0], b[1], b[2]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whether a colour is clear enough against both pages to sit on the edge of a critter. */
export function showsOnBothPages(rgb: readonly number[], margin = 1): boolean {
  return (
    contrast(rgb, LIGHT_PAGE) >= MIN_EDGE_CONTRAST * margin && contrast(rgb, DARK_PAGE) >= MIN_EDGE_CONTRAST * margin
  );
}
