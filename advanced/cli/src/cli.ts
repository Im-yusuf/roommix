#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import {
  decodeWav,
  encodeWav,
  SAMPLE_RATE,
  STRATEGY_NAMES,
  type StrategyName,
} from '@roommix/core';
import { mixFiles } from './mix-files.js';

const USAGE = `Usage: roommix-mix <input.wav> [more.wav ...] -o <output.wav> [--strategy ${STRATEGY_NAMES.join('|')}]

Mixes 16-bit PCM WAV files (any rate, mono or stereo) into one 16 kHz mono WAV
using the same core as the live service.`;

function main(argv: string[]): number {
  const inputs: string[] = [];
  let output: string | undefined;
  let strategy: StrategyName = 'gain-sharing';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') output = argv[++i];
    else if (arg === '--strategy') strategy = argv[++i] as StrategyName;
    else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      return 0;
    } else inputs.push(arg);
  }
  if (inputs.length === 0 || !output) {
    console.error(USAGE);
    return 1;
  }
  if (!STRATEGY_NAMES.includes(strategy)) {
    console.error(`Unknown strategy "${strategy}". Use one of: ${STRATEGY_NAMES.join(', ')}`);
    return 1;
  }

  const wavs = inputs.map((path) => decodeWav(new Uint8Array(readFileSync(path))));
  const { pcm } = mixFiles(wavs, strategy);
  writeFileSync(output, encodeWav(pcm, SAMPLE_RATE, 1));

  inputs.forEach((path, i) => {
    const wav = wavs[i];
    const seconds = wav.samples.length / wav.channels / wav.sampleRate;
    console.log(`${path}: ${wav.sampleRate} Hz, ${wav.channels} ch, ${seconds.toFixed(2)} s`);
  });
  console.log(
    `${output}: ${SAMPLE_RATE} Hz mono, ${(pcm.length / SAMPLE_RATE).toFixed(2)} s, strategy ${strategy}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
