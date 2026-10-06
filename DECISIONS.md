# Decisions

A running log: each entry says what was decided, what else was considered,
and why. Entries are added in the commit that makes the decision. The edge
case table at the end is the checklist for the whole project; a row is
filled in by the commit that covers it.

## Architecture

**A pure core with an injected clock.** `@roommix/core` has no sockets and no
timers; the host calls `mixer.tick(nowMs)` and the mixer works out how many
20 ms frames are owed since the last call. Alternatives: the core running its
own `setInterval`; passing a clock object into `createMixer`. The call-based
form makes every timing test deterministic and fast (30 simulated minutes run
in about a second), lets the same code run in a browser or worker, and leaves
the host free to pick its loop. `setInterval` spacing is never trusted: the
interval only wakes the mixer, the clock decides.

**Monorepo with a hard dependency boundary.** Core, server, CLI and simulator
are separate packages so "zero runtime dependencies" is enforced by a
`package.json`, not a convention, and so the integration surface other teams
see is one package. A single package would have been simpler to set up but
would blur that line.

**Canonical format: 16 kHz mono PCM16, 20 ms frames, float inside.** 16 kHz
mono is what speech recognisers consume; 20 ms is the frame size of the codecs
that would replace raw PCM later; mixing in Float32 avoids int16 overflow and
rounding until the final conversion.

**The contract is written before the code.** `types.ts` fixes the API (`addSource`, `push` of any chunk size, `removeSource`, `tick(now)`, a `frame` event with sequence, dominant source and per-source levels, and per-source `stats` events) and `constants.ts` holds every tunable in one place, so the integration surface and the parameter space are visible from the start.

**Biome, Vitest, tsx.** One tool for lint and format, one for tests, one to run
TypeScript in development. All dev-only.

## Pipeline

**Validate at the edge, then never again.** `push` turns odd byte lengths, chunks over a second, unaligned byte views and bad sample rates into `MixerError`s with stable codes, so every later stage can assume clean input. Unaligned views (socket buffers are often slices of a pool) are copied; aligned ones are viewed in place.

**DC blocker at 20 Hz, before resampling.** A one-pole high-pass with state across chunks. Microphone offset would otherwise inflate every level reading and bias the gain shares; 20 Hz is far below speech, and the test shows speech-band tones pass within 0.1 dB.

**Resampler: windowed sinc, tabulated at 512 phases.** A Blackman-windowed
sinc low-pass at 0.45× the lower rate, about 165 taps for 48 kHz, applied by
dot product at the nearest tabulated fractional offset; position is tracked
with integer arithmetic so there is no float drift. Alternatives: linear
interpolation (aliases), naive decimation (aliases), a port of libsamplerate
(a dependency), an exact rational polyphase filter (exact phases, more code).
Measured: 1 kHz passes at 0.00 dB, flat to 6.6 kHz, −57 dB at 7.9 kHz,
−97 dB at 10 kHz; output is bit-identical for any chunking. The nearest-phase
timing error is at most 1/1024 sample, about −61 dB at 7 kHz, far below the
filter's own stopband. The filter needs `half` samples of lookahead, so a
stream's last ~1.7 ms is held until more input arrives.

## Edge cases, one by one

Every edge case from the brief, with the test that covers it or the decision
that answers it. Test names are `describe > it` titles in `packages/*/test`.

| edge case | covered by |
|---|---|
| same voice on both devices | pending |
| two tabs sharing one mic | pending |
| both people talking at once | pending |
| mismatched mic sensitivity | pending |
| similar levels causing gain flutter | pending |
| noise build-up as sources increase | pending |
| browser automatic gain control | pending |
| monitor playback feeding back | pending |
| arrival jitter | pending |
| burst after a stall | pending |
| clock drift | pending |
| 44.1 vs 48 kHz inputs | tests: *resampler > handles the non-integer 44.1 kHz ratio*, *passes a 1 kHz tone from 48 kHz to 16 kHz within 0.5 dB* |
| browsers ignoring the requested rate | pending |
| arbitrary chunk sizes, including 128 samples | test: *resampler > is identical whether fed in one chunk or in arbitrary small chunks* (1, 7, 128, 333, 960, 4000) |
| late joiner | pending |
| slow subscriber | pending |
| tab closed without leaving | pending |
| stalled vs genuinely silent | pending |
| reconnect with the same id | pending |
| zero sources | pending |
| one source | pending |
| last leave tears the room down | pending |
| room size cap | pending |
| malformed payloads | test: *pcm > rejects an odd byte length*; more rows land with the mixer and the server |
| host process stalls | pending |
| mic permission denied | pending |
| input device changed mid-session | pending |
| phone lock or call interrupting capture | pending |
| getUserMedia needing HTTPS off localhost | pending |
