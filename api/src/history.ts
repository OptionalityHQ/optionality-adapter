/**
 * A rolling record of this session, for the screen's own chart.
 *
 * The gateway is the only place that sees the index and a marked position on the
 * same read, so it is the only place that can draw the two over time. What it
 * keeps is deliberately small and deliberately labelled: one sample a second, a
 * few minutes deep, gone when the process is. Calling that "history" would be a
 * lie the page then repeats, so the payload says how long it spans and how often
 * it was sampled, and the chart prints it.
 */
export interface Sample {
  atMs: number;
  /** The index the read saw, in dollars. */
  spot: number | null;
  /** What the open tickets were worth against their cost, at what a close pays. */
  open: number | null;
}

export interface SessionHistory {
  points: Sample[];
  /** Seconds between the first and last sample. */
  spanS: number;
  /** Seconds between samples, so a reader can tell a flat line from a gap. */
  sampledEveryS: number;
}

export class History {
  private samples: Sample[] = [];
  private readonly capacity: number;
  private readonly everyMs: number;

  constructor(capacity = 300, everyMs = 1_000) {
    this.capacity = capacity;
    this.everyMs = everyMs;
  }

  /**
   * Record a read into the second it belongs to.
   *
   * Two reads in the same interval update one point rather than adding two: the
   * chart's right edge is then always the last thing the gateway saw, while the
   * body of the series stays evenly spaced. Measuring from the *last append* would
   * have kept sliding the head forward, and a poll faster than the interval would
   * never have grown the series at all.
   */
  push(sample: Sample): void {
    const last = this.samples[this.samples.length - 1];
    const bucket = (atMs: number) => Math.floor(atMs / this.everyMs);
    if (last && bucket(sample.atMs) === bucket(last.atMs)) {
      this.samples[this.samples.length - 1] = sample;
      return;
    }
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  series(): SessionHistory {
    const points = this.samples.slice();
    const spanS =
      points.length > 1 ? (points[points.length - 1].atMs - points[0].atMs) / 1000 : 0;
    return { points, spanS, sampledEveryS: this.everyMs / 1000 };
  }

  get length(): number {
    return this.samples.length;
  }
}
