#!/usr/bin/env node
// Builds the two bundled "device" clips from synthesized speech.
// macOS only (uses `say`); needs ffmpeg and ffprobe on PATH.
//
// Two people talk in turns. Each device hears its own person loud and the
// other person 10 dB quieter and 3 ms later: the duplicate problem the mixer
// exists to solve. deviceA is 48 kHz and deviceB is 44.1 kHz so a reviewer
// running the CLI on them also exercises the resampler.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GAP_SECONDS = 0.5;
const CROSSTALK_GAIN = 10 ** (-10 / 20); // -10 dB
const CROSSTALK_DELAY_MS = 3;
const TRACK_GAIN = 0.7; // headroom so the sum of both voices never clips

const turns = [
  ['A', 'Hi! Excuse me, do you know how to get to the central station from here?'],
  ['B', 'Sure. Go straight down this street, then turn left at the second traffic light.'],
  ['A', 'Second traffic light, got it. Is it far? I have a train in twenty minutes.'],
  ['B', 'About ten minutes on foot. If you hurry you will make it.'],
  ['A', 'Perfect, thank you so much!'],
  ['B', 'You are welcome. Have a safe trip!'],
];
const voices = { A: 'Samantha', B: 'Daniel' };

const work = mkdtempSync(join(tmpdir(), 'fixtures-'));
const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim();

try {
  // 1. Render each line and lay the turns out one after another.
  let t = 0;
  const lines = turns.map(([who, text], i) => {
    const aiff = join(work, `${i}.aiff`);
    const wav = join(work, `${i}.wav`);
    run('say', ['-v', voices[who], '-o', aiff, text]);
    run('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      aiff,
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      wav,
    ]);
    const seconds = Number(
      run('ffprobe', [
        '-loglevel',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        wav,
      ]),
    );
    const line = { who, wav, startMs: Math.round(t * 1000) };
    t += seconds + GAP_SECONDS;
    return line;
  });
  const totalSeconds = (t + 0.3).toFixed(3);

  // 2. One clean track per person, padded to the full conversation length.
  const track = (who) => {
    const mine = lines.filter((l) => l.who === who);
    const inputs = mine.flatMap((l) => ['-i', l.wav]);
    const delayed = mine.map((l, i) => `[${i}]adelay=${l.startMs}|${l.startMs}[d${i}]`).join(';');
    const labels = mine.map((_, i) => `[d${i}]`).join('');
    const out = join(work, `track${who}.wav`);
    run('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      `${delayed};${labels}amix=inputs=${mine.length}:normalize=0,apad=whole_dur=${totalSeconds},volume=${TRACK_GAIN}[out]`,
      '-map',
      '[out]',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      out,
    ]);
    return out;
  };
  const trackA = track('A');
  const trackB = track('B');

  // 3. What each device actually hears: own voice plus the other, quieter and later.
  const device = (near, far, rate, out) => {
    run('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      near,
      '-i',
      far,
      '-filter_complex',
      `[1]adelay=${CROSSTALK_DELAY_MS}|${CROSSTALK_DELAY_MS},volume=${CROSSTALK_GAIN.toFixed(4)}[far];[0][far]amix=inputs=2:normalize=0[out]`,
      '-map',
      '[out]',
      '-ar',
      String(rate),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      out,
    ]);
  };
  device(trackA, trackB, 48000, 'fixtures/deviceA.wav');
  device(trackB, trackA, 44100, 'fixtures/deviceB.wav');
  console.log(
    `wrote fixtures/deviceA.wav (48 kHz) and fixtures/deviceB.wav (44.1 kHz), ${totalSeconds} s each`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
