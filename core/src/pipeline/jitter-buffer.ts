import { DRIFT_QUIET_WAIT_MS, DRIFT_WINDOW_MS, FRAME_MS } from '../constants.js';
import { fadeIn, fadeOut } from './fade.js';

export interface JitterBufferConfig {
  targetMs: number;
  maxMs: number;
}

export interface JitterBufferStats {
  depthFrames: number;
  underruns: number;
  /** Frames discarded: bursts trimmed back to target, plus drift corrections. */
  drops: number;
  /** Frames repeated to correct a slow source clock. */
  inserts: number;
}

const WINDOW_FRAMES = DRIFT_WINDOW_MS / FRAME_MS;
const QUIET_WAIT_FRAMES = DRIFT_QUIET_WAIT_MS / FRAME_MS;

/**
 * Per-source queue of fixed frames that absorbs arrival jitter and clock drift.
 *
 * Play-out starts once `target` frames are waiting, so a source that arrives
 * late by up to the target still plays without a gap. After a gap the buffer
 * refills to target before resuming, so one late packet does not turn into a
 * run of tiny gaps. If the queue grows past `max` (a burst after a stall) the
 * oldest frames are dropped back to target so latency stays bounded.
 *
 * Clock drift shows up as a slow trend in depth. Every DRIFT_WINDOW_MS the
 * buffer looks at the shallowest and deepest it got: if it never dipped to
 * target a surplus is accumulating and one frame is dropped; if it never
 * reached target it is running dry and one frame is repeated. Corrections wait
 * for a quiet frame (judged by `isQuiet`) so they are not heard, and act anyway
 * after DRIFT_QUIET_WAIT_MS.
 *
 * Every seam is softened: the frame before a gap, drop or repeat is faded out
 * (we hold that frame when we decide) and the first frame after one is faded
 * in. That single rule is what keeps joins, stalls, bursts and drift
 * corrections click-free.
 */
export function createJitterBuffer(
  { targetMs, maxMs }: JitterBufferConfig,
  isQuiet: (frame: Float32Array) => boolean,
) {
  const targetFrames = Math.max(1, Math.round(targetMs / FRAME_MS));
  const maxFrames = Math.max(targetFrames + 1, Math.round(maxMs / FRAME_MS));
  /** Oldest frame first. */
  const queue: Float32Array[] = [];
  /** False until `targetFrames` have queued up (at the start and after every underrun); pulls return silence meanwhile. */
  let primed = false;
  /** Set whenever the last frame played ended at a seam, so the next one must start from silence. */
  let needsFadeIn = true;
  let underruns = 0;
  let drops = 0;
  let inserts = 0;

  // Drift detection: the shallowest and deepest queue seen during the current window.
  let windowMin = Number.POSITIVE_INFINITY;
  let windowMax = Number.NEGATIVE_INFINITY;
  let windowCount = 0;
  /** A drift correction that has been decided but is waiting for a quiet frame. */
  let pending: 'drop' | 'insert' | null = null;
  /** Frames the pending correction has waited; past QUIET_WAIT_FRAMES it acts anyway. */
  let pendingAge = 0;

  function resetWindow(): void {
    windowMin = Number.POSITIVE_INFINITY;
    windowMax = Number.NEGATIVE_INFINITY;
    windowCount = 0;
  }

  /** Records the depth seen at a pull and, at the end of a window, decides whether drift needs correcting. */
  function observe(depth: number): void {
    windowMin = Math.min(windowMin, depth);
    windowMax = Math.max(windowMax, depth);
    windowCount++;
    if (windowCount < WINDOW_FRAMES) return;
    // Jitter makes depth wobble around the target; drift shifts the whole range.
    // Only a range that sat entirely above or entirely below the target means drift.
    if (pending === null) {
      if (windowMin > targetFrames) pending = 'drop';
      else if (windowMax < targetFrames) pending = 'insert';
      pendingAge = 0;
    }
    resetWindow();
  }

  return {
    push(frame: Float32Array): void {
      queue.push(frame);
      // Too deep: drop the oldest frames, keeping the newest `targetFrames`, so latency snaps back to target.
      if (queue.length > maxFrames) {
        // Bursts follow stalls, so the last played frame already ended in a fade.
        const excess = queue.length - targetFrames;
        queue.splice(0, excess);
        drops += excess;
        needsFadeIn = true;
      }
    },

    /** The next frame to play, or null when the mix should use silence for this source. */
    pull(): Float32Array | null {
      // Still filling up: play silence until a full target's worth is waiting.
      if (!primed) {
        if (queue.length < targetFrames) return null;
        primed = true;
      }
      observe(queue.length);
      const frame = queue.shift();
      if (!frame) {
        // Ran dry. Go back to filling up, and drop any drift decision: an
        // underrun says nothing reliable about the clock.
        underruns++;
        primed = false;
        needsFadeIn = true;
        pending = null;
        resetWindow();
        return null;
      }
      if (needsFadeIn) {
        fadeIn(frame);
        needsFadeIn = false;
      }

      // Drift correction, if one is due. A drop removes 20 ms from a source that
      // runs fast; an insert adds 20 ms to one that runs slow.
      if (pending !== null) {
        pendingAge++;
        const forced = pendingAge >= QUIET_WAIT_FRAMES;
        if (pending === 'drop' && queue.length > 0 && (forced || isQuiet(queue[0]))) {
          // Skip the frame after this one; fade across the seam.
          queue.shift();
          drops++;
          pending = null;
          fadeOut(frame);
          needsFadeIn = true;
        } else if (pending === 'insert' && (forced || isQuiet(frame))) {
          // Play this frame twice: a faded copy now, the real one next tick.
          queue.unshift(frame);
          inserts++;
          pending = null;
          const copy = frame.slice();
          fadeOut(copy);
          needsFadeIn = true;
          return copy;
        }
      }

      if (queue.length === 0) {
        // Nothing follows: fade now so a gap starts from silence. If a frame
        // does arrive in time it simply fades back in; a 3 ms dip, not a click.
        fadeOut(frame);
        needsFadeIn = true;
      }
      return frame;
    },

    get stats(): JitterBufferStats {
      return { depthFrames: queue.length, underruns, drops, inserts };
    },
  };
}
