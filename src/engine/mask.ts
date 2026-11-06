export type Point = readonly [number, number];

/** A grid of on/off pixels. Critters are drawn by combining these. */
export class Mask {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bits = new Uint8Array(width * height);
  }

  private blank(): Mask {
    return new Mask(this.width, this.height);
  }

  /** Switch on every pixel that is on in `other`. */
  add(other: Mask): this {
    const { bits } = this;
    const from = other.bits;
    for (let i = 0; i < bits.length; i++) bits[i] |= from[i];
    return this;
  }

  /** A new mask of the pixels on in both this and `other`. */
  and(other: Mask): Mask {
    const out = this.blank();
    for (let i = 0; i < out.bits.length; i++) out.bits[i] = this.bits[i] & other.bits[i];
    return out;
  }

  /** A new mask of the pixels on in this but not in `other`. */
  minus(other: Mask): Mask {
    const out = this.blank();
    for (let i = 0; i < out.bits.length; i++) out.bits[i] = this.bits[i] & (other.bits[i] ^ 1);
    return out;
  }

  /** A new mask grown by one pixel, without corners, for clean pixel-art outlines. */
  grown(): Mask {
    const { width, height, bits } = this;
    const out = this.blank();
    const to = out.bits;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (!bits[i]) continue;
        to[i] = 1;
        if (x > 0) to[i - 1] = 1;
        if (x < width - 1) to[i + 1] = 1;
        if (y > 0) to[i - width] = 1;
        if (y < height - 1) to[i + width] = 1;
      }
    }
    return out;
  }

  /** A new mask shifted by whole pixels. Whatever leaves the grid is dropped. */
  moved(dx: number, dy: number): Mask {
    const { width, height, bits } = this;
    const out = this.blank();
    for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x++) {
        out.bits[(y + dy) * width + x + dx] = bits[y * width + x];
      }
    }
    return out;
  }

  addDisc(x: number, y: number, radius: number): this {
    const { width, height, bits } = this;
    const x0 = Math.max(0, Math.trunc(x - radius - 1));
    const x1 = Math.min(width, Math.trunc(x + radius + 2));
    const y0 = Math.max(0, Math.trunc(y - radius - 1));
    const y1 = Math.min(height, Math.trunc(y + radius + 2));
    const limit = radius * radius;
    for (let gy = y0; gy < y1; gy++) {
      const dy2 = (gy - y) * (gy - y);
      for (let gx = x0; gx < x1; gx++) {
        if ((gx - x) * (gx - x) + dy2 <= limit) bits[gy * width + gx] = 1;
      }
    }
    return this;
  }

  addPixel(x: number, y: number): this {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.bits[y * this.width + x] = 1;
    }
    return this;
  }

  private addRow(x0: number, y: number, x1: number): void {
    if (y < 0 || y >= this.height) return;
    const from = Math.max(0, Math.min(x0, x1));
    const to = Math.min(this.width - 1, Math.max(x0, x1));
    for (let x = from; x <= to; x++) this.bits[y * this.width + x] = 1;
  }

  /** Fill a polygon with hard pixel edges: vertices snap down to whole pixels. */
  addPolygon(points: readonly Point[]): this {
    const xs = points.map((p) => Math.trunc(p[0]));
    const ys = points.map((p) => Math.trunc(p[1]));
    const edges: { y0: number; x0: number; low: number; high: number; slope: number }[] = [];
    let top = this.height - 1;
    let bottom = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      if (xs[i] === xs[j] && ys[i] === ys[j]) continue;
      const low = Math.min(ys[i], ys[j]);
      const high = Math.max(ys[i], ys[j]);
      top = Math.min(top, low);
      bottom = Math.max(bottom, high);
      if (low === high) {
        this.addRow(xs[i], low, xs[j]);
      } else {
        edges.push({ y0: ys[i], x0: xs[i], low, high, slope: (xs[j] - xs[i]) / (ys[j] - ys[i]) });
      }
    }
    top = Math.max(0, top);
    bottom = Math.min(this.height, bottom);
    const crossings: number[] = [];
    for (let y = top; y <= bottom; y++) {
      crossings.length = 0;
      for (const edge of edges) {
        if (y < edge.low || y > edge.high) continue;
        const x = (y - edge.y0) * edge.slope + edge.x0;
        crossings.push(x);
        // An edge ending on this row counts twice, which keeps corners filled.
        if (y === edge.high && y < bottom) crossings.push(x);
      }
      crossings.sort((a, b) => a - b);
      let next = 0;
      for (let i = 1; i < crossings.length; i += 2) {
        const end = Math.ceil(crossings[i] - 0.5);
        if (end < next) continue;
        const start = Math.max(next, Math.floor(crossings[i - 1] + 0.5));
        if (end < start) continue;
        this.addRow(start, y, end);
        next = end + 1;
      }
    }
    return this;
  }

  /** Draw connected one-pixel lines. Points snap down to whole pixels. */
  addLine(points: readonly Point[]): this {
    for (let i = 0; i + 1 < points.length; i++) {
      let x = Math.trunc(points[i][0]);
      let y = Math.trunc(points[i][1]);
      const x1 = Math.trunc(points[i + 1][0]);
      const y1 = Math.trunc(points[i + 1][1]);
      const dx = Math.abs(x1 - x);
      const dy = Math.abs(y1 - y);
      const stepX = x1 >= x ? 1 : -1;
      const stepY = y1 >= y ? 1 : -1;
      if (dx > dy) {
        let error = 2 * dy - dx;
        for (let n = 0; n < dx; n++) {
          this.addPixel(x, y);
          if (error >= 0) {
            y += stepY;
            error -= 2 * dx;
          }
          error += 2 * dy;
          x += stepX;
        }
      } else {
        let error = 2 * dx - dy;
        for (let n = 0; n < dy; n++) {
          this.addPixel(x, y);
          if (error >= 0) {
            x += stepX;
            error -= 2 * dy;
          }
          error += 2 * dx;
          y += stepY;
        }
      }
      if (i + 2 === points.length) this.addPixel(x1, y1);
    }
    return this;
  }
}
