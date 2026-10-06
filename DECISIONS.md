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
| 44.1 vs 48 kHz inputs | pending |
| browsers ignoring the requested rate | pending |
| arbitrary chunk sizes, including 128 samples | pending |
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
