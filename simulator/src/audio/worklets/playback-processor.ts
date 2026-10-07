const RATE = 16000;
const CAPACITY = RATE * 2;
/** Play-out starts once this much is buffered, so network jitter does not cause gaps. */
const TARGET = RATE * 0.1;
const STATS_SECONDS = 0.2;

/**
 * Runs on the audio thread. Mixed 16 kHz frames arrive over the port and are
 * played from a ring buffer. If the browser refused a 16 kHz context, the read
 * position advances by 16000/sampleRate with linear interpolation; this is a
 * monitor, not the product path.
 */
class PlaybackProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(CAPACITY);
  private readPos = 0; // fractional, unwrapped, in 16 kHz samples
  private writePos = 0; // unwrapped
  private primed = false;
  private underruns = 0;
  private dropped = 0;
  private sumSquares = 0;
  private sinceStats = 0;
  private readonly step = RATE / sampleRate;
  private readonly statsEvery = Math.round(sampleRate * STATS_SECONDS);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
      this.write(new Int16Array(event.data));
  }

  private write(frame: Int16Array): void {
    const overflow = this.writePos + frame.length - Math.floor(this.readPos) - CAPACITY;
    if (overflow > 0) {
      this.readPos += overflow; // the buffer is full: let go of the oldest audio
      this.dropped += overflow;
    }
    for (let i = 0; i < frame.length; i++)
      this.ring[(this.writePos + i) % CAPACITY] = frame[i] / 32768;
    this.writePos += frame.length;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0][0];
    if (!this.primed && this.writePos - this.readPos >= TARGET) this.primed = true;
    for (let i = 0; i < out.length; i++) {
      if (!this.primed || this.writePos - Math.floor(this.readPos) < 2) {
        if (this.primed) {
          this.underruns++;
          this.primed = false;
        }
        out[i] = 0;
        continue;
      }
      const base = Math.floor(this.readPos);
      const frac = this.readPos - base;
      const a = this.ring[base % CAPACITY];
      const b = this.ring[(base + 1) % CAPACITY];
      out[i] = a + (b - a) * frac;
      this.readPos += this.step;
    }
    this.report(out);
    return true;
  }

  private report(out: Float32Array): void {
    for (let i = 0; i < out.length; i++) this.sumSquares += out[i] * out[i];
    this.sinceStats += out.length;
    if (this.sinceStats < this.statsEvery) return;
    this.port.postMessage({
      bufferMs: Math.max(0, (this.writePos - this.readPos) / RATE) * 1000,
      underruns: this.underruns,
      dropped: this.dropped,
      rms: Math.sqrt(this.sumSquares / this.sinceStats),
    });
    this.sumSquares = 0;
    this.sinceStats = 0;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
