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

**Level meter: RMS with a 10 ms attack and a 300 ms release; noise floor as a minimum follower that rises at most 3 dB/s, capped at −30 dBFS.** The fast attack lets the gain shares follow speech onsets within a frame; the slow release is what stops two equal talkers from fluttering. Pauses in speech reset the floor at once; speech itself cannot become the floor; a loud steady signal cannot mute itself. Activity, the quantity the mixer shares, is level above this floor.

## Timing

**Per-source jitter buffer, 60 ms target, 200 ms maximum.** Play-out starts
once 60 ms is queued, which absorbs arrival jitter below that; anything over
200 ms (a burst after a stall) is trimmed back to target so latency stays
bounded. 60 ms is a small fraction of the speech-to-translation budget. An
adaptive target (grow with observed jitter) was left out; it would be a few
lines in the same window logic.

**Refill to target after a gap.** When the buffer runs dry it waits for a full
target before resuming, so one late packet does not turn into a run of tiny
gaps and dips.

**One rule for clicks: fade at every seam.** The frame before a gap is faded
out (the buffer knows a gap is coming because nothing follows that frame) and
the first frame after a gap, drop or repeat is faded in; 3 ms linear ramps.
Alternatives: packet loss concealment (repeat or extrapolate the last frame),
crossfades. Fades are free, need no lookahead delay, and the test suite shows
no sample step above 1.5× the signal's own slope through join, stall, burst,
leave and gain changes. Concealment would hide short gaps better but adds
artefacts and state; it is the obvious next step if gaps prove audible.

**Drift: watch the trend, correct at quiet moments.** Every 10 s the buffer
checks the shallowest and deepest it got. If it never fell to target, a frame
of surplus has accumulated: drop one. If it never reached target, it is running
dry: repeat one. Corrections wait for a frame below the noise floor plus 6 dB,
and act anyway after 5 s. Alternative: adaptive resampling (nudge the ratio by
the measured ppm). Dropping and repeating is simpler, inaudible in pauses, and
needs no extra DSP; at ±200 ppm it is one frame every 100 s. The resampler
already takes any ratio, so adaptive resampling would replace only the
correction step.

**Overrun is trimmed at push time.** Bursts arrive after stalls, and after a
stall the last played frame already ended in a fade, so trimming the queue as
it fills is click-free in practice and keeps memory bounded. Gradual growth
never reaches the limit because the drift logic acts first.

**Catch-up is capped at 1 s.** If the host process stalls for longer, the mixer
skips ahead instead of emitting hundreds of stale frames at once.

## Mixing

**Gain sharing (Dugan automixer).** Each source's gain is its activity (level
above its own noise floor) divided by the total activity, so gains sum to one.
The talker's own device dominates; the other devices, which hear the same voice
quieter and later, are attenuated in proportion, and because the gain multiplies
an already quieter copy the duplicate is suppressed as the square of its level
ratio. Alternatives: gating (loudest wins; choppy and loses overlaps), number-
of-open-mics attenuation (needs a gate), aligning the copies by
cross-correlation and summing (needs long windows, breaks when both talk).
Measured for a copy 10 dB down and 3 ms late: comb ripple 5.74 dB with plain
sum, 1.81 dB with gain sharing; two identical streams come out at +0.00 dB
instead of +6.02 dB; eight noise sources sum to −8.9 dB instead of +8.8 dB.

**Shares in the amplitude domain, not power.** Power-domain shares would
suppress the duplicate as the cube of its ratio (about 0.5 dB ripple) but duck a
quieter second talker harder. The amplitude version is the conservative choice
for a conversation; switching is a one-line change in the strategy.

**1/N in silence.** When no source is above its floor every source gets 1/N.
This is the property that keeps noise from building up as devices join, and it
means nobody's gain jumps when speech starts.

**Gains are smoothed symmetrically (20 ms).** One coefficient in both directions keeps the smoothed gains summing to one even mid-transition; an asymmetric attack and release would let the sum exceed one during a handover. Flutter between two equal talkers is prevented upstream by the level meter's 300 ms release, not by slowing the gains. Within a frame the gain ramps per sample, so there are no steps.

**Dominant source with 3 dB hysteresis.** The indicator only changes when a
challenger is clearly ahead, so two equal talkers do not make it flicker.

**Limiter without lookahead.** With gain sharing the mix gains sum to one, so
the limiter mostly matters for the plain-sum baseline. It ramps its gain across
the frame (a step would click) and clamps anything that overshoots during the
ramp. Lookahead would add 20 ms of latency for the baseline's benefit.

**Plain sum kept as a second strategy.** It is the baseline the tests and the
simulator compare against. A strategy is a name and one function.

**Both talking at once is a known limit.** When two people speak together both
sources get similar gains and each voice is still comb-filtered by its own
crosstalk copy (up to ±2.4 dB with the copy 10 dB down). Removing that needs
alignment or separation, both out of scope; the test for this case uses
frequencies where the comb is neutral so it isolates what gain sharing does.

## Lifecycle

**Core reports states, the host decides removal.** A source is `joining` until
its buffer primes, `live` while frames flow, `stalled` after 200 ms without
frames, `left` after `removeSource`. The core never removes a source itself,
because only the host knows whether a stall is a dead phone or a paused tab.
Stalled and silent are different things: stalled means no frames arriving,
silent means frames near the noise floor; the state machine looks only at
arrivals.

**Removal fades.** `removeSource` plays one more faded frame, then reports
`left`. A new source may be added under the same id immediately.

**Zero sources idles.** With nobody in the room the mixer emits nothing and
re-anchors its clock when someone arrives, so there is no burst of owed frames
and no silent stream to nowhere. Frame sequence numbers continue, so a
consumer can see the gap.

**Reconnect with the same id replaces the old connection.** The old socket is
told `replaced` and closed; its source is removed; the new connection joins
clean. The simulator keeps the id in `sessionStorage`, which is per tab, so two
tabs are two participants but a reload or a network drop is the same one.

**Last leave tears the room down; rooms hold at most 8.** Timers stop, memory
goes; the cap keeps CPU and fan-out bounded per room.

## Server

**Raw PCM16 in binary frames, JSON in text frames.** No per-chunk header:
TCP keeps order, the core accepts any chunk size, and the sequence number rides
in the roster. The codec question (Opus) is answered by the transport swap, not
by a header format.

**Rooms talk to clients only through `Connection` and `Transport`.** The interfaces come first, with an in-memory fake for tests, so room and session logic is written and tested without a socket in sight. A WebSocket adapter, a WebRTC data channel or any other ordered byte pipe plugs in behind them.

**Roster at 10 Hz, not per frame.** The UI needs about 10 updates a second;
per-frame metadata would be 50 messages a second to every client.

**A client's first message is always its own `joined`.** Nothing is broadcast ad hoc on join, leave or strategy change; the next 100 ms roster carries it. Clients can therefore treat the first text frame as the acknowledgement and never see a roster for a room they do not know they are in.

**Slow subscribers skip frames.** Once a subscriber's socket has more than
64 KB (about 2 s) queued, frames are skipped for that subscriber and counted.
The mixer never waits, and 2 s of lag is already useless for a live monitor.

**WebSocket with `ws`, 60 lines behind the transport interface.** Alternatives: Socket.IO (heavier, its own framing), WebRTC (left out, see below). Binary frames, ordered delivery, TLS-friendly and native in every browser.

**Liveness belongs to the transport.** The adapter pings every 5 s and
terminates a peer that misses two pongs. Browsers answer protocol pings
automatically, so a tab closed without leaving, a phone that lost the network
or went to sleep is removed within 10 s. A peer that stays connected but sends
no audio stays in the room as `stalled` and contributes silence.

**Plain HTTP in production, self-signed HTTPS in development.** TLS termination
is the ingress's job in any deployment; for phones on a laptop, the Vite dev
server offers a self-signed certificate.

**The server serves the built simulator.** One process is the whole
deployment, which keeps the Dockerfile and the quick start short.

## Simulator

**Vanilla TypeScript for the simulator.** The page is static HTML plus one
`render(state)` function; about 700 lines in all. A framework would add a
build-time dependency, a mental model to explain, and nothing the page needs.

**Reconnect with backoff; the join is replayed with the known id.** The server
then replaces the old participant and the tab re-announces its source and
subscription.

**getUserMedia plus AudioWorklet.** `MediaRecorder` produces compressed
containers at its own cadence; `ScriptProcessorNode` is deprecated and runs on
the main thread. The worklet taps the stream on the audio thread and posts
20 ms PCM16 chunks.

**File as microphone goes through the same worklet.** A looping decoded clip
replaces the microphone node; nothing else changes. The two bundled clips are
synthesised with macOS `say` and mixed so that each "device" hears its own
speaker loud and the other 10 dB down and 3 ms late, which is the duplicate
problem the mixer exists to solve, reproducible on one laptop.

**The native capture rate is sent as is.** Browsers largely ignore requested
rates, so the page reports whatever rate the context runs at and the server
resamples. This also exercises the real pipeline.

**Monitor playback: a 16 kHz AudioContext, a worklet ring buffer with 100 ms
of prebuffer, off by default, with a headphones warning.** The monitor is for
listening, not the product path, so its own buffering is deliberately plain.
If the browser refuses a 16 kHz context the worklet interpolates. The monitor
plays the full mix on purpose: it exists to verify the stream the backend
receives, so a device that is both recording and monitoring hears its own
microphone about 150 ms late. The page says so and suggests monitoring from a
device that is not recording. Removing the listener's own source (a mix-minus)
would mean no longer hearing the final stream, so it was not built.

**Automatic gain control off, noise suppression on, echo cancellation on.**
Browser AGC would fight the mixer's own level tracking; noise suppression lowers
the floor the tracker sees; echo cancellation is the browser default and helps
when the monitor plays through speakers anyway.

**Network simulation on the uplink.** Delay, jitter and drop are applied to
this client's outgoing chunks, in order, so the jitter buffer, stall handling
and underrun counters can be exercised without a bad network.

## Testing

**A simulation harness drives every integration test.** `simulate()` in the test helpers feeds the mixer with a fake clock: every 20 ms each live source renders exactly the audio covering that interval at its own rate (with an optional clock error), chunks arrive after an optional seeded network delay, sources join, stall and leave at given times, and the mixer ticks once. Thirty simulated minutes run in about a second, and every quality and timing test is a few lines on top of it.

**Synthetic signals and a fake clock; thresholds derived from theory.** No
audio was listened to. Each quality claim is a measurement with a threshold
that follows from the model (comb ripple for a given level ratio, +6 dB for
doubling, 3 dB per doubling of noise sources, resampler stopband). Clicks are
detected as sample-to-sample jumps above 1.5× the test tone's own slope.

**Fixture clips are synthesised speech.** Two people talk in turns, made with macOS `say` and mixed with ffmpeg so that each clip is what one device would hear: its own speaker loud and the other 10 dB quieter and 3 ms late, the duplicate problem the mixer exists to solve. Device A is 48 kHz and device B is 44.1 kHz, so the CLI and the simulator both exercise the resampler. Real recordings would be better; these are reproducible and need no microphone.

**Server tests use an in-memory connection and fake timers; one test uses real sockets end to end.**

## Edge cases, one by one

Every edge case from the brief, with the test that covers it or the decision
that answers it. Test names are `describe > it` titles in `packages/*/test`.

| edge case | covered by |
|---|---|
| same voice on both devices | test: *mix quality > suppresses the duplicate*; decision: gain sharing |
| two tabs sharing one mic | test: *mix quality > keeps identical streams at single-source level*: two identical sources get 0.5 each, the mix is one copy at the original level |
| both people talking at once | test: *mix quality > keeps both talkers when they speak at once*; decision: comb filtering remains, see Mixing |
| mismatched mic sensitivity | test: the duplicate test uses one device 10 dB quieter; a more sensitive device simply carries more of the share, and the quieter copy of each voice is suppressed as the square of its ratio |
| similar levels causing gain flutter | test: *mix quality > does not flutter when two sources sit at nearly the same level*; decision: level meter release and symmetric gain smoothing, dominant hysteresis |
| noise build-up as sources increase | test: *mix quality > does not build up noise as sources are added* (eight sources: −8.9 dB) |
| browser automatic gain control | decision: `autoGainControl: false`, `noiseSuppression: true` in the simulator's constraints |
| monitor playback feeding back | decision: playback off by default, headphones warning, browser echo cancellation left on; the monitor is deliberately the full backend mix, see Simulator |
| arrival jitter | test: *timing > absorbs arrival jitter and bounds latency after a stall and burst* |
| burst after a stall | same test: the burst is trimmed to the maximum depth, no new underruns afterwards |
| clock drift | tests: *timing > keeps buffer depth bounded over 30 minutes at ±200 ppm*; *still corrects drift, click-free, when the source is never quiet* |
| 44.1 vs 48 kHz inputs | tests: *resampler > handles the non-integer 44.1 kHz ratio*, *passes a 1 kHz tone from 48 kHz to 16 kHz within 0.5 dB*; *mixFiles > mixes files of different rates and channel counts into 16 kHz mono* |
| browsers ignoring the requested rate | decision: the simulator never requests a rate; it reports the context's actual rate in `start` and the server resamples |
| arbitrary chunk sizes, including 128 samples | tests: *resampler > is identical whether fed in one chunk or in arbitrary small chunks* (1, 7, 128, 333, 960, 4000); *mixer api > validates sources and chunks* pushes 128 samples |
| late joiner | test: *timing > a late joiner is heard within the jitter target and disturbs nothing* |
| slow subscriber | test: *rooms and sessions > skips frames for a slow subscriber instead of holding up the mixer*; decision: bounded by buffered bytes, frames skipped and counted |
| tab closed without leaving | tests: *websocket transport > terminates a peer that stops answering pings*; *rooms and sessions > tears the room down when the last participant leaves or drops*; removal fades the source out |
| stalled vs genuinely silent | test: *source state machine > goes joining -> live -> stalled -> live -> left*; decision: the state looks only at arrivals |
| reconnect with the same id | test: *rooms and sessions > replaces the earlier connection when the same client id reconnects* |
| zero sources | test: *mixer api > idles with no sources and emits one frame per 20 ms once a source exists* |
| one source | test: *mix quality > passes a single source through at unity* |
| last leave tears the room down | test: *rooms and sessions > tears the room down when the last participant leaves or drops* (timers gone too) |
| room size cap | test: *rooms and sessions > refuses a join beyond the room size* |
| malformed payloads | tests: *pcm > rejects an odd byte length*; *mixer api > validates sources and chunks* (odd byte length, oversize, NaN and fractional rates); *protocol > describes what is wrong with malformed messages*; *rooms and sessions > answers malformed traffic with error messages and stays up* |
| host process stalls | test: *mixer api > skips ahead instead of bursting after a long host stall* |
| mic permission denied | decision: `NotAllowedError` becomes "Microphone access was blocked …" with a Try again button; verified by hand in a browser that blocks the microphone |
| input device changed mid-session | decision: the track's `ended` event stops capture and shows "Your microphone was disconnected" with Try again; `mute`/`unmute` show a paused state and recover by themselves. Not exercised by a test. |
| phone lock or call interrupting capture | decision: the AudioContext `statechange` and the page's `visibilitychange` events pause and resume capture, with a notice while paused. Not exercised by a test. |
| getUserMedia needing HTTPS off localhost | decision: a missing `mediaDevices` becomes a message pointing at HTTPS with "use an audio file" as the way out; `HTTPS=1 pnpm dev` serves a self-signed certificate; production terminates TLS in front |


## Deliberately left out

- **WebRTC and Opus.** Browsers would send Opus over SRTP with built-in jitter
  handling. Plug-in point: a WebRTC server (for example mediasoup) decodes to
  PCM and pushes into the same mixer; the `Transport` interface already keeps
  rooms away from the socket type.
- **Cross-correlation alignment.** Aligning the duplicate so it adds in phase
  instead of comb-filtering. Plug-in point: a per-source delay stage before the
  mix; the strategy interface would need frames, not just levels.
- **Adaptive resampling.** Correcting drift by nudging the resampler ratio
  instead of dropping or repeating frames. Plug-in point: the drift decision in
  the jitter buffer; the resampler already takes any ratio.
- **ML voice activity detection.** Plug-in point: the strategy consumes an
  activity number per source; a VAD probability could replace level minus floor.
- **Echo cancellation beyond the browser's.** Plug-in point: a per-source stage
  before the jitter buffer, with the mixed output as the reference.
- **Source separation.** Would replace the mix step entirely.
- **Horizontal scaling.** Rooms are independent in-memory objects; shard rooms
  across processes by room name behind a sticky router. Nothing persists.
- **Authentication, authorization, rate limiting.** Rooms are open. A token in
  the join message is the obvious addition.
- **Lookahead limiting, packet loss concealment, adaptive jitter target.** See
  the entries above for where each would go.
