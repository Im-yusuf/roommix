# roommix

Real-time audio mixing for a face-to-face translation feature. Two or more
people in the same room each record on their own phone; every device hears
both voices. This service takes those live streams and merges them into one
clean 16 kHz mono stream for backend processing.

Three parts, one repository:

| package | what it is |
|---|---|
| `@roommix/core` | the mixer as a pure TypeScript library: PCM in at any rate, mixed PCM16 frames out. Zero runtime dependencies, no sockets, no timers. |
| `@roommix/server` | a thin WebSocket adapter: rooms, one mixer per room, fan-out of the mixed stream. Also serves the simulator. |
| simulator | a single web page to join, record, listen and download the mix from several devices or tabs. |

Plus `@roommix/cli`, which mixes WAV files offline through the same core.

## The problem it solves

Adding the samples together is not enough:

- **Time.** The devices share no clock: different start times, network jitter,
  sample clocks that drift apart. The mixer owns the output clock and each
  source has a jitter buffer that also corrects drift.
- **Duplication.** Each voice arrives twice, at different levels and a few
  milliseconds apart. Summing them comb-filters the voice, which hurts speech
  recognition. The default strategy is gain sharing (a Dugan automixer): each
  source gets the share of the total that its own activity represents, so the
  talker's device dominates and the quieter copy is attenuated.
- **Lifecycle.** Sources join, stall and vanish mid-stream. Each source has a
  state machine with fades at every seam; the mix never waits on a source.

[DECISIONS.md](DECISIONS.md) records every significant choice, the
alternatives, and what was deliberately left out.

## Quick start

Needs Node 22.12 or newer (24 is what CI and the Docker image use) and pnpm
(`npm install -g pnpm`).

```bash
pnpm install
pnpm build
pnpm start
```

Open http://localhost:8080 in two tabs. Switch on "Advanced" in the top bar
of both, use the same room name, pick "Audio file: device A" as the input in
one tab and "device B" in the other, and press Start in both. In one tab press
"Play mix" (use headphones) and watch the participant list: the talker's
device shows the higher gain, the other device is turned down, and the gains
always add up to 100 %. Switch the strategy to "Plain sum" to hear the
difference.

The page opens in its simple view: join, start the microphone, play, record.
The "Advanced" switch reveals the input source (microphone or the two fixture
clips), capture details, the per-device figures, the monitor statistics, the
strategy toggle and the network simulation. Switching it off resets the
strategy to gain sharing and clears the network simulation.

Or with Docker:

```bash
docker build -t roommix . && docker run --rm -p 8080:8080 roommix
```

For development, `pnpm dev` runs the server with reload on port 8080 and the
simulator on Vite at http://localhost:5173 (it proxies `/ws` to the server).
If 8080 is taken, `PORT=8081 pnpm dev` moves the server and the proxy together.

## Running the simulator on two phones

Browsers only expose the microphone on a secure page, so a phone needs HTTPS:

1. Put the laptop and the phones on the same Wi-Fi.
2. Run `HTTPS=1 pnpm dev` (add `PORT=8081` if 8080 is taken). Vite prints a
   `https://<laptop-ip>:5173` address.
3. Open that address on each phone and accept the self-signed certificate
   warning (the certificate is generated locally by the dev server).
4. Join the same room on each phone, press "Start microphone", and allow the
   microphone when asked.
5. On a laptop tab, join the same room and press "Play mix" with headphones.
   Playing the mix through speakers in the same room feeds it back into every
   microphone.

The production server speaks plain HTTP and WebSocket; put TLS termination in
front of it (any reverse proxy or ingress) when deploying.

## What the simulator shows

- **Lobby**: what the service does in one sentence, the join form, and the
  figures measured in the test suite (comb ripple and level change with plain
  sum versus gain sharing), so the mechanism is visible before anything plays.
- **Gain share**: one bar split between the devices in the room. With gain
  sharing it always adds up to 100 % and re-balances as the dominant device
  changes; with plain sum the caption says what the gains add up to instead.
- **Participants**: name, state (`joining`, `live`, `stalled`, `idle`, `left`),
  live level meter, and with Advanced on the current gain, jitter buffer depth,
  underruns and drops. The dominant source is highlighted.
- **Monitor**: playback of the mixed stream (off by default), output meter,
  and a recorder that plays the recording back in the page or downloads it as
  a 16 kHz WAV; with Advanced on, the playback buffer depth and underruns, the
  latency estimate and the strategy toggle (gain sharing by default).
- **Network simulation** (Advanced): added delay, jitter and dropped chunks on
  this device's uplink, to watch the jitter buffer and counters react.
- Every failure (microphone blocked, no microphone, connection lost, room full,
  joined from another tab) shows a plain message and a button that does the
  obvious next thing.

## Mixing files offline

```bash
pnpm mix fixtures/deviceA.wav fixtures/deviceB.wav -o out/mix.wav
pnpm mix fixtures/deviceA.wav fixtures/deviceB.wav -o out/sum.wav --strategy plain-sum
```

Inputs are 16-bit PCM WAV at any rate, mono or stereo; the output is 16 kHz
mono. The files are pushed 20 ms at a time against a simulated clock, so the
same jitter buffers, resamplers and strategy run as on the server.

The two fixture clips are synthesised speech (`scripts/make-fixtures.mjs`,
macOS only). Each clip is what one device would hear: its own speaker loud and
the other speaker 10 dB quieter and 3 ms late. Device A is 48 kHz, device B is
44.1 kHz.

## Using the core in your own service

```ts
import { createMixer, MixerError } from '@roommix/core';

const mixer = createMixer(); // or createMixer({ strategy: 'plain-sum', jitterTargetMs: 80 })

// One source per device. PCM16 little-endian at the device's own rate; stereo is downmixed.
mixer.addSource('phone-1', { sampleRate: 48000 });
mixer.addSource('phone-2', { sampleRate: 44100, channels: 2 });

// Push audio whenever it arrives, in chunks of any size (up to one second each).
socket1.on('message', (bytes) => mixer.push('phone-1', bytes));

// Every 20 ms the mixer emits one frame: 320 samples of 16 kHz mono PCM16.
mixer.on('frame', ({ sequence, pcm, dominant, sources }) => {
  recogniser.write(pcm); // Int16Array, sample-accurate, never waits on a slow source
});

// Per-source state and counters, every 200 ms and on each state change.
mixer.on('stats', (s) => console.log(s.id, s.state, s.bufferMs, s.underruns, s.drops));

// Drive the clock from anywhere monotonic. Call as often as you like; the
// mixer computes how many frames are owed, so interval spacing does not matter.
setInterval(() => mixer.tick(performance.now()), 10);

mixer.removeSource('phone-1'); // fades out over one frame, then reports state 'left'
```

Malformed input throws a `MixerError` with a stable `code`
(`invalid_sample_rate`, `invalid_chunk`, `chunk_too_large`, `unknown_source`,
`duplicate_source`, `unknown_strategy`). With no sources the mixer idles and
emits nothing. All tunables live in
[`packages/core/src/constants.ts`](packages/core/src/constants.ts).

## Wire protocol

Text frames carry JSON control messages; binary frames carry audio.

Client to server:

| message | fields | meaning |
|---|---|---|
| `join` | `room`, `name`, `clientId?` | enter a room; pass the `clientId` from an earlier `joined` to reclaim that identity (the old connection is replaced) |
| `start` | `sampleRate`, `channels?` | begin sending audio at this rate (1 or 2 interleaved channels) |
| `stop` | | stop sending; the source fades out |
| `subscribe` | `enabled` | receive the mixed stream |
| `strategy` | `name` | `gain-sharing` or `plain-sum`, for the whole room |
| `leave` | | |
| binary | | PCM16 little-endian at the `start` rate, any chunk size up to 1 s |

Server to client:

| message | fields | meaning |
|---|---|---|
| `joined` | `clientId`, `room`, `strategy` | always the first message after a join |
| `roster` | `participants[]`, `dominant`, `strategy`, `sequence` | ten times a second; each participant has `state`, `level`, `gain`, `bufferMs`, `underruns`, `drops`, `skipped` |
| `error` | `code`, `message`, `fatal` | `bad_message`, `not_joined`, `no_source`, `invalid_audio`, `room_full` (fatal), `replaced` (fatal) |
| binary | | 640 bytes = 20 ms of 16 kHz mono PCM16 little-endian, to subscribers only |

Limits: 8 participants per room, names up to 32 characters, room names
`[A-Za-z0-9_.-]{1,32}`, text messages up to 4 KB. Subscribers whose socket
falls more than 64 KB (about 2 s) behind skip frames rather than slow the
mixer. A connection that misses two heartbeats (10 s) is removed. The room is
torn down when the last participant leaves.

## Configuration

Server environment: `PORT` (default 8080), `HOST` (default 0.0.0.0),
`STATIC_DIR` (directory with the built simulator; defaults to
`apps/simulator/dist` when it exists).

Mixer options: `strategy` (`gain-sharing`), `jitterTargetMs` (60),
`jitterMaxMs` (200). The remaining tunables are named constants:

| constant | value | role |
|---|---|---|
| `JITTER_TARGET_MS` / `JITTER_MAX_MS` | 60 / 200 | play-out delay; burst trim threshold |
| `DRIFT_WINDOW_MS` / `DRIFT_QUIET_WAIT_MS` | 10 000 / 5 000 | drift judged per window; correction waits this long for a quiet frame |
| `STALL_AFTER_MS` | 200 | underrun time before a source is `stalled` |
| `EDGE_FADE_MS` | 3 | ramp at every seam |
| `LEVEL_ATTACK_MS` / `LEVEL_RELEASE_MS` | 10 / 300 | level meter |
| `FLOOR_RISE_DB_PER_S` / `FLOOR_MAX_DBFS` | 3 / −30 | noise floor tracker |
| `GAIN_SMOOTHING_MS` | 20 | how fast gains follow the strategy |
| `DOMINANT_HYSTERESIS_DB` | 3 | stability of the dominant indicator |
| `LIMITER_CEILING` / `LIMITER_RELEASE_MS` | 0.98 / 500 | output limiter |
| `MAX_CATCHUP_MS` | 1 000 | frames skipped instead of burst after a host stall |

## Tests

```bash
pnpm test        # about five seconds
pnpm check       # lint, typecheck, test, build; what the GitHub workflow runs
```

The audio quality bar is proven on synthetic signals with a fake clock, so
every number below is measured by the suite:

| property | plain sum | gain sharing |
|---|---|---|
| comb ripple with the duplicate 10 dB down and 3 ms late, 100 to 3333 Hz | 5.74 dB | 1.81 dB |
| identical stream on two sources, level vs one source | +6.02 dB | +0.00 dB |
| eight independent noise sources, level vs one source | +8.8 dB | −8.9 dB |

Also covered: unity pass-through for a single source; no clipping with
full-scale input on every source; no sample jump above 1.5× the signal's own
slope through join, stall, burst, leave and gain changes; a late joiner heard
within the jitter target; arrival jitter plus a 500 ms stall and burst with
latency bounded; 30 simulated minutes at ±200 ppm clock drift with buffer depth
bounded and no underruns; the resampler passing 1 kHz at 0.00 dB, attenuating
10 kHz by 97 dB, and producing bit-identical output for any chunking (including
128-sample chunks); malformed payloads; the full lifecycle; room limits,
reconnect-replaces, slow subscribers and heartbeats on the server.

## Known limits

- When both people talk at once, both sources get similar gains and each voice
  keeps the comb filtering of its own crosstalk copy. Fixing that needs
  alignment or separation, which are out of scope.
- No listening test was done; all quality claims are measurements on tones and
  noise.
- The limiter has no lookahead, so a sudden overload clamps during its first
  ramp. With gain sharing the mix gains sum to one and the limiter rarely acts.
- The resampler holds back the last ~1.7 ms of a stream (filter lookahead), so
  the CLI drops that much from the end of a file.
- Rooms are open: no authentication or rate limiting. State is in memory in
  one process; rooms are independent, so sharding by room name is the scaling
  path.
- The monitor is for listening: its own 100 ms buffer adds latency that the
  product path does not have.
- The fixture clips are synthesised speech, not recordings.
