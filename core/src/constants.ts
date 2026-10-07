/**
 * Every tunable in the mixer lives here so a reviewer can see the whole
 * parameter space at once. Values are in the unit named by the suffix.
 */

// ---- Canonical output format --------------------------------------------
export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000; // 320

// ---- Input validation ---------------------------------------------------
export const MIN_SAMPLE_RATE = 8_000;
export const MAX_SAMPLE_RATE = 192_000;
/** A single push may not carry more audio than this; anything larger is a bug or an attack. */
export const MAX_CHUNK_MS = 1_000;

// ---- DC blocker ---------------------------------------------------------
/** Below speech; removes mic offset so levels and gains are not biased. */
export const DC_BLOCK_CUTOFF_HZ = 20;

// ---- Resampler ----------------------------------------------------------
/** Fractional positions the windowed sinc is tabulated at. Timing error is at most 1/(2*PHASES) sample. */
export const RESAMPLER_PHASES = 512;
/** Low-pass cutoff as a fraction of the lower of the two rates. */
export const RESAMPLER_CUTOFF_RATIO = 0.45;
/** Transition band width as a fraction of the lower rate; sets the filter length. */
export const RESAMPLER_TRANSITION_RATIO = 0.1;
/** Blackman window: transition width ~= this many bins / filter length. */
export const BLACKMAN_TRANSITION_BINS = 5.5;

// ---- Jitter buffer ------------------------------------------------------
/** Frames are held this long before play-out so late arrivals still make it. */
export const JITTER_TARGET_MS = 60;
/** Above this depth the buffer drops back to target; bounds latency after a burst. */
export const JITTER_MAX_MS = 200;
/** Consecutive underrun time before a source is reported as stalled. */
export const STALL_AFTER_MS = 200;
/** Drift is judged over windows of this length. */
export const DRIFT_WINDOW_MS = 10_000;
/** A pending drift correction waits this long for a quiet frame, then acts anyway. */
export const DRIFT_QUIET_WAIT_MS = 5_000;

// ---- Clock --------------------------------------------------------------
/** If the host stalls longer than this, frames are skipped instead of emitted in a burst. */
export const MAX_CATCHUP_MS = 1_000;

// ---- Fades --------------------------------------------------------------
/** Every discontinuity (join, leave, gap, drop) is softened by a ramp this long. */
export const EDGE_FADE_MS = 3;
export const EDGE_FADE_SAMPLES = (SAMPLE_RATE * EDGE_FADE_MS) / 1000; // 48

// ---- Level meter --------------------------------------------------------
export const LEVEL_ATTACK_MS = 10;
export const LEVEL_RELEASE_MS = 300;
/** The tracked noise floor may rise at most this fast, so speech never becomes "floor". */
export const FLOOR_RISE_DB_PER_S = 3;
/** The floor is capped so a loud steady signal cannot mute itself. */
export const FLOOR_MAX_DBFS = -30;
/** Lowest floor; also the initial value and the value for digital silence. */
export const FLOOR_MIN_DBFS = -90;
/** A frame is "quiet" (safe to drop or insert) when its RMS is below the floor by less than this. */
export const QUIET_MARGIN_DB = 6;

// ---- Gain sharing -------------------------------------------------------
/**
 * Time constant for following the strategy's target gains. The same value in
 * both directions keeps the gains summing to one even while they move; the
 * level meter's slow release is what stops two equal talkers from fluttering.
 */
export const GAIN_SMOOTHING_MS = 20;
/** A new source becomes "dominant" only when it beats the current one by this much. */
export const DOMINANT_HYSTERESIS_DB = 3;

// ---- Limiter ------------------------------------------------------------
export const LIMITER_CEILING = 0.98;
export const LIMITER_RELEASE_MS = 500;

// ---- Stats --------------------------------------------------------------
export const STATS_INTERVAL_MS = 200;
