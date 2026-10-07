import { describe, expect, it } from 'vitest';
import { LEVELER_MAX_BOOST_DB, LEVELER_TARGET_DBFS } from '../src/index.js';
import { db, rmsOf, sampleAt, simulate, sine } from './helpers.js';

const TURN_S = 5;
const SPEECH_S = 4;
const QUIET = 0.05; // a −29 dBFS RMS tone
const LOUD = 0.3; // −13.5 dBFS

/** Turns of four seconds of speech and a second of silence; the quiet talker takes the even turns. */
function talker(amplitude: number, freq: number, evenTurns: boolean) {
  return (t: number) => {
    if (t < 0 || t % TURN_S >= SPEECH_S) return 0;
    if ((Math.floor(t / TURN_S) % 2 === 0) !== evenTurns) return 0;
    return amplitude * Math.sin(2 * Math.PI * freq * t);
  };
}
const quiet = talker(QUIET, 400, true);
const loud = talker(LOUD, 900, false);

/** The second quiet turn and the second loud turn, well after the leveler has settled. */
const QUIET_WINDOW = [13_000, 13_900] as const;
const LOUD_WINDOW = [18_000, 18_900] as const;

/** Output loudness in dBFS over a window. */
const windowDb = (pcm: Int16Array, [fromMs, toMs]: readonly [number, number]) =>
  db(rmsOf(pcm, sampleAt(fromMs), sampleAt(toMs)) / 32768);

/** Two people on two phones; each phone hears the other 10 dB down and 3 ms late. */
function twoPhones(leveler: boolean) {
  const crosstalk = 10 ** (-10 / 20);
  return simulate({
    leveler,
    durationMs: 20_000,
    sources: [
      {
        id: 'quietPhone',
        sampleRate: 16000,
        signal: (t) => quiet(t) + crosstalk * loud(t - 0.003),
      },
      { id: 'loudPhone', sampleRate: 16000, signal: (t) => loud(t) + crosstalk * quiet(t - 0.003) },
    ],
  });
}

/** Two people, one phone: a loud bot from a speaker and a quiet reply. */
function onePhone(leveler: boolean) {
  return simulate({
    leveler,
    durationMs: 20_000,
    sources: [{ id: 'phone', sampleRate: 16000, signal: (t) => quiet(t) + loud(t) }],
  });
}

describe('leveler', () => {
  it('brings a quiet talker and a loud talker on two phones to the same loudness', () => {
    const raw = twoPhones(false).pcm;
    expect(windowDb(raw, LOUD_WINDOW) - windowDb(raw, QUIET_WINDOW)).toBeGreaterThan(12);

    const { pcm } = twoPhones(true);
    const quietTurn = windowDb(pcm, QUIET_WINDOW);
    const loudTurn = windowDb(pcm, LOUD_WINDOW);
    expect(Math.abs(quietTurn - loudTurn)).toBeLessThan(2);
    expect(Math.abs(quietTurn - LEVELER_TARGET_DBFS)).toBeLessThan(2);
  });

  it('does the same for two talkers on one phone', () => {
    const raw = onePhone(false).pcm;
    expect(windowDb(raw, LOUD_WINDOW) - windowDb(raw, QUIET_WINDOW)).toBeGreaterThan(14);

    const { pcm } = onePhone(true);
    expect(Math.abs(windowDb(pcm, QUIET_WINDOW) - windowDb(pcm, LOUD_WINDOW))).toBeLessThan(2);
    expect(Math.abs(windowDb(pcm, LOUD_WINDOW) - LEVELER_TARGET_DBFS)).toBeLessThan(2);
  });

  it('never boosts by more than the bound', () => {
    const amplitude = 10 ** (-50 / 20) * Math.SQRT2; // a −50 dBFS RMS tone
    const { pcm, frames } = simulate({
      leveler: true,
      durationMs: 4000,
      sources: [{ id: 'faint', sampleRate: 16000, signal: sine(500, amplitude) }],
    });
    expect(windowDb(pcm, [3000, 4000])).toBeLessThan(-50 + LEVELER_MAX_BOOST_DB + 0.5);
    expect(Math.max(...frames.map((f) => f.levelerGain))).toBeLessThanOrEqual(
      10 ** (LEVELER_MAX_BOOST_DB / 20) + 1e-6,
    );
  });

  it('starts from unity and holds its gain through silence', () => {
    const { frames } = simulate({
      leveler: true,
      durationMs: 5000,
      sources: [
        {
          id: 'a',
          sampleRate: 16000,
          signal: (t) => (t < 2 ? QUIET * Math.sin(2 * Math.PI * 300 * t) : 0),
        },
      ],
    });
    expect(frames[0].levelerGain).toBe(1);
    const settledAt = sampleAt(2500) / 320;
    const settled = frames[settledAt].levelerGain;
    // The −29 dBFS talker is brought up 9 dB, and the meter's release tail after
    // 2 s does not teach the leveler anything.
    expect(settled).toBeCloseTo(10 ** ((LEVELER_TARGET_DBFS + 29) / 20), 1);
    for (const frame of frames.slice(settledAt))
      expect(frame.levelerGain / settled).toBeCloseTo(1, 2);
  });

  it('leaves the duplicate suppression alone', () => {
    // The comb-ripple measurement from the quality tests, with the leveler on.
    const amplitude = 0.25;
    const response = (freq: number) => {
      const { pcm } = simulate({
        leveler: true,
        durationMs: 1500,
        sources: [
          { id: 'near', sampleRate: 16000, signal: sine(freq, amplitude) },
          { id: 'far', sampleRate: 16000, signal: sine(freq, amplitude * 10 ** (-10 / 20), 0.003) },
        ],
      });
      return windowDb(pcm, [1000, 1500]);
    };
    const freqs = Array.from({ length: 20 }, (_, k) => ((k + 1) * 1000) / 6);
    const levels = freqs.map(response);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(2.5);
  });

  it('is off when asked', () => {
    const { frames } = simulate({
      leveler: false,
      durationMs: 1000,
      sources: [{ id: 'a', sampleRate: 16000, signal: sine(500, 0.02) }],
    });
    expect(frames.every((f) => f.levelerGain === 1)).toBe(true);
  });
});
