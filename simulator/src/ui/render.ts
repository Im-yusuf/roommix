import type { RosterEntry } from '@roommix/server/protocol';
import type { AppState } from '../state.js';
import { $ } from './dom.js';

type SavedRecording = AppState['monitor']['recordings'][number];

/** The actions a dynamically rendered row can trigger. */
export interface RowActions {
  playRecording(id: number): void;
  deleteRecording(id: number): void;
}

const INPUT_LABELS = { mic: 'microphone', fileA: 'file A', fileB: 'file B' } as const;
const FACT_KEYS = ['gain', 'buffer', 'underruns', 'drops', 'skipped'] as const;

type FactKey = (typeof FACT_KEYS)[number];

/** Maps an RMS level to a meter width: -60 dBFS is empty, 0 dBFS is full. */
export function levelToPercent(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/** One saved recording, kept between renders like a participant row. */
interface RecordingRow {
  li: HTMLLIElement;
  play: HTMLButtonElement;
  download: HTMLAnchorElement;
  fill: HTMLElement;
}

/** The fill stays full width and is clipped to the level, so a meter never re-lays out. */
function setMeter(fill: HTMLElement, rms: number): void {
  fill.style.clipPath = `inset(0 ${100 - levelToPercent(rms)}% 0 0 round 999px)`;
}

/** One participant row, kept between renders so meters and gains animate in place. */
interface Row {
  li: HTMLLIElement;
  name: HTMLElement;
  state: HTMLElement;
  stateText: Text;
  dominantTag: HTMLElement;
  fill: HTMLElement;
  values: Record<FactKey, HTMLElement>;
  skippedFact: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * The page is static HTML; rendering means updating the handful of nodes that
 * show state. Participant rows and gain-share segments are keyed by client so
 * their widths can transition instead of being rebuilt ten times a second.
 */
export function createRenderer(actions: RowActions) {
  const connection = $('connection');
  const advanced = $<HTMLInputElement>('advanced');
  const leave = $('leave');
  const notice = $('notice');
  const noticeText = $('notice-text');
  const noticeAction = $<HTMLButtonElement>('notice-action');
  const lobby = $('lobby');
  const session = $('session');
  const sessionRoom = $('session-room');
  const sessionName = $('session-name');
  const inputKind = $<HTMLSelectElement>('input-kind');
  const micToggle = $<HTMLButtonElement>('mic-toggle');
  const inputMeter = $('input-meter');
  const captureInfo = $('capture-info');
  const participantsCard = $('participants-card');
  const participants = $<HTMLUListElement>('participants');
  const gainShare = $('gain-share');
  const gainShareCaption = $('gain-share-caption');
  const monitorCard = $('monitor-card');
  const playToggle = $<HTMLButtonElement>('play-toggle');
  const outputMeter = $('output-meter');
  const dominant = $('dominant');
  const playbackBuffer = $('playback-buffer');
  const latency = $('latency');
  const playbackUnderruns = $('playback-underruns');
  const sequence = $('sequence');
  const leveler = $('leveler');
  const strategy = $<HTMLSelectElement>('strategy');
  const recordToggle = $<HTMLButtonElement>('record-toggle');
  const recordings = $<HTMLUListElement>('recordings');
  const recordingsCount = $('recordings-count');
  const networkCard = $('network-card');
  const ranges = {
    delayMs: { input: $<HTMLInputElement>('delay'), output: $('delay-value'), unit: 'ms' },
    jitterMs: { input: $<HTMLInputElement>('jitter'), output: $('jitter-value'), unit: 'ms' },
    dropPercent: { input: $<HTMLInputElement>('drop'), output: $('drop-value'), unit: '%' },
  } as const;

  const rows = new Map<string, Row>();
  const segments = new Map<string, HTMLElement>();
  const recordingRows = new Map<number, RecordingRow>();
  let renderedRecordings: SavedRecording[] | null = null;
  let renderedRoster: RosterEntry[] | null = null;
  let renderedDominant: string | null = null;
  let renderedStrategy: AppState['strategy'] | null = null;

  function syncParticipants(state: AppState): void {
    const seen = new Set<string>();
    state.roster.forEach((entry, index) => {
      seen.add(entry.clientId);
      let row = rows.get(entry.clientId);
      if (!row) {
        row = createRow();
        rows.set(entry.clientId, row);
      }
      updateRow(row, entry, entry.clientId === state.dominant, entry.clientId === state.clientId);
      if (participants.children[index] !== row.li)
        participants.insertBefore(row.li, participants.children[index] ?? null);
    });
    for (const [clientId, row] of rows) {
      if (seen.has(clientId)) continue;
      row.li.remove();
      rows.delete(clientId);
    }
  }

  function syncGainShare(state: AppState): void {
    const total = state.roster.reduce((sum, entry) => sum + entry.gain, 0);
    // Gain sharing sums to one and fills the bar exactly; plain sum exceeds it and is scaled down.
    const scale = Math.max(1, total);
    const seen = new Set<string>();
    const tracks: string[] = [];
    let index = 0;
    for (const entry of state.roster) {
      if (entry.gain < 0.005) continue;
      seen.add(entry.clientId);
      tracks.push(`minmax(0, ${entry.gain / scale}fr)`);
      let segment = segments.get(entry.clientId);
      if (!segment) {
        segment = el('div', 'seg');
        segment.append(el('span', 'seg-name'));
        segments.set(entry.clientId, segment);
      }
      const percent = Math.round(entry.gain * 100);
      // The visible name hides below a readable width; the title and label keep it.
      (segment.firstChild as HTMLElement).textContent = entry.name;
      segment.title = `${entry.name}: gain ${percent} %`;
      segment.setAttribute('aria-label', `${entry.name}: gain ${percent} %`);
      segment.classList.toggle('dominant', entry.clientId === state.dominant);
      if (gainShare.children[index] !== segment)
        gainShare.insertBefore(segment, gainShare.children[index] ?? null);
      index += 1;
    }
    for (const [clientId, segment] of segments) {
      if (seen.has(clientId)) continue;
      segment.remove();
      segments.delete(clientId);
    }
    gainShare.style.gridTemplateColumns = tracks.join(' ');
    gainShareCaption.textContent =
      state.roster.length === 0
        ? 'waiting for the roster'
        : total < 0.005
          ? 'no device is sending audio'
          : state.strategy === 'plain-sum'
            ? `adds up to ${Math.round(total * 100)} %: plain sum keeps every device at full gain`
            : `adds up to ${Math.round(total * 100)} %`;
  }

  function createRecordingRow(recording: SavedRecording): RecordingRow {
    const li = el('li', 'recording');
    const who = el('div', 'who');
    const name = el('span', 'name');
    name.textContent = recording.name;
    const facts = el('span', 'facts');
    facts.textContent = `${(recording.durationMs / 1000).toFixed(1)} s · ${Math.round(recording.bytes / 1024)} KB`;
    who.append(name, facts);
    const meter = el('div', 'meter');
    meter.setAttribute('aria-label', 'Playback level');
    const fill = el('div', 'meter-fill');
    meter.append(fill);
    const controls = el('div', 'row');
    const play = el('button', 'btn small');
    play.type = 'button';
    play.onclick = () => actions.playRecording(recording.id);
    const download = el('a', 'btn small');
    download.textContent = 'Download WAV';
    download.href = recording.url;
    download.download = `roommix-${recording.name.replace(/[^\w.-]+/g, '-')}.wav`;
    const remove = el('button', 'btn small');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.onclick = () => actions.deleteRecording(recording.id);
    controls.append(play, download, remove);
    li.append(who, meter, controls);
    return { li, play, download, fill };
  }

  function syncRecordings(state: AppState): void {
    const { recordings: list, playingRecording, recordingLevel } = state.monitor;
    if (list !== renderedRecordings) {
      renderedRecordings = list;
      const seen = new Set<number>();
      list.forEach((recording, index) => {
        seen.add(recording.id);
        let row = recordingRows.get(recording.id);
        if (!row) {
          row = createRecordingRow(recording);
          recordingRows.set(recording.id, row);
        }
        if (recordings.children[index] !== row.li)
          recordings.insertBefore(row.li, recordings.children[index] ?? null);
      });
      for (const [id, row] of recordingRows) {
        if (seen.has(id)) continue;
        row.li.remove();
        recordingRows.delete(id);
      }
      recordingsCount.textContent =
        list.length === 0 ? 'kept in this browser' : `${list.length} kept in this browser`;
    }
    for (const [id, row] of recordingRows) {
      const playing = id === playingRecording;
      row.li.classList.toggle('playing', playing);
      row.play.classList.toggle('active', playing);
      row.play.textContent = playing ? 'Pause' : 'Play';
      setMeter(row.fill, playing ? recordingLevel : 0);
    }
  }

  return function render(state: AppState): void {
    document.body.dataset.phase = state.phase;
    document.body.classList.toggle('advanced', state.advanced);
    if (advanced.checked !== state.advanced) advanced.checked = state.advanced;
    connection.textContent = state.connection;
    connection.className = `pill ${state.connection}`;

    notice.classList.toggle('hidden', state.notice === null);
    if (!state.notice) noticeText.textContent = '';
    if (state.notice) {
      notice.classList.toggle('error', state.notice.tone === 'error');
      noticeText.textContent = state.notice.message;
      noticeAction.classList.toggle('hidden', !state.notice.action);
      noticeAction.textContent = state.notice.action?.label ?? '';
      noticeAction.onclick = state.notice.action?.run ?? null;
    }

    const joined = state.phase === 'joined';
    lobby.classList.toggle('hidden', joined);
    for (const card of [session, participantsCard, monitorCard, networkCard])
      card.classList.toggle('hidden', !joined);
    leave.classList.toggle('hidden', !joined);
    sessionRoom.textContent = state.room;
    sessionName.textContent = state.name;

    if (inputKind.value !== state.inputKind) inputKind.value = state.inputKind;
    const input = INPUT_LABELS[state.inputKind];
    micToggle.disabled = state.mic === 'starting';
    micToggle.classList.toggle('active', state.mic === 'on' || state.mic === 'paused');
    micToggle.textContent =
      state.mic === 'off'
        ? `Start ${input}`
        : state.mic === 'starting'
          ? 'Starting…'
          : state.mic === 'paused'
            ? `Paused · stop ${input}`
            : `Stop ${input}`;
    setMeter(inputMeter, state.inputLevel);
    captureInfo.textContent = state.captureRate
      ? `Sending ${state.captureRate} Hz PCM16 in 20 ms chunks; the server resamples to 16 kHz.`
      : '';

    if (
      state.roster !== renderedRoster ||
      state.dominant !== renderedDominant ||
      state.strategy !== renderedStrategy
    ) {
      renderedRoster = state.roster;
      renderedDominant = state.dominant;
      renderedStrategy = state.strategy;
      syncParticipants(state);
      syncGainShare(state);
    }

    playToggle.textContent = state.monitor.playing ? 'Stop playback' : 'Play mix';
    playToggle.classList.toggle('active', state.monitor.playing);
    setMeter(outputMeter, state.monitor.outputLevel);
    dominant.textContent = state.roster.find((p) => p.clientId === state.dominant)?.name ?? '–';
    playbackBuffer.textContent = state.monitor.playing
      ? `${Math.round(state.monitor.bufferMs)} ms`
      : '–';
    // Mixer-side buffering of the deepest live source, one frame of mixing, and the playback buffer.
    const deepest = Math.max(
      0,
      ...state.roster.filter((p) => p.state === 'live').map((p) => p.bufferMs),
    );
    latency.textContent = state.monitor.playing
      ? `~${Math.round(deepest + 20 + state.monitor.bufferMs)} ms`
      : '–';
    playbackUnderruns.textContent = String(state.monitor.underruns);
    sequence.textContent = String(state.sequence);
    leveler.textContent = `${state.levelerDb > 0 ? '+' : ''}${state.levelerDb.toFixed(1)} dB`;
    if (strategy.value !== state.strategy) strategy.value = state.strategy;

    recordToggle.textContent = state.monitor.recording
      ? `Stop recording (${(state.monitor.recordedMs / 1000).toFixed(0)} s)`
      : 'Record mix';
    recordToggle.classList.toggle('active', state.monitor.recording);
    syncRecordings(state);

    for (const [key, { input: range, output, unit }] of Object.entries(ranges)) {
      const value = state.net[key as keyof typeof ranges];
      if (Number(range.value) !== value) range.value = String(value);
      output.textContent = `${value} ${unit}`;
    }
  };
}

function createRow(): Row {
  const li = el('li', 'participant');
  const who = el('div', 'who');
  const name = el('span', 'name');
  const state = el('span', 'state');
  const stateText = document.createTextNode('');
  const dominantTag = el('b', 'dominant-tag');
  dominantTag.textContent = 'dominant';
  state.append(el('i', 'dot'), stateText, dominantTag);
  who.append(name, state);

  const meter = el('div', 'meter');
  meter.setAttribute('aria-label', 'Level');
  const fill = el('div', 'meter-fill');
  meter.append(fill);

  const details = el('div', 'details advanced-only');
  const values = {} as Record<FactKey, HTMLElement>;
  const facts = {} as Record<FactKey, HTMLElement>;
  for (const key of FACT_KEYS) {
    const fact = el('span', 'fact');
    const label = el('span', 'k');
    label.textContent = key;
    const value = el('span', 'v');
    fact.append(label, value);
    details.append(fact);
    values[key] = value;
    facts[key] = fact;
  }

  li.append(who, meter, details);
  return { li, name, state, stateText, dominantTag, fill, values, skippedFact: facts.skipped };
}

function updateRow(row: Row, entry: RosterEntry, isDominant: boolean, isSelf: boolean): void {
  row.li.classList.toggle('dominant', isDominant);
  row.name.textContent = isSelf ? `${entry.name} (you)` : entry.name;
  row.state.className = `state ${entry.state}`;
  row.stateText.data = entry.state;
  row.dominantTag.classList.toggle('hidden', !isDominant);
  setMeter(row.fill, entry.level);
  row.values.gain.textContent = `${Math.round(entry.gain * 100)} %`;
  row.values.buffer.textContent = `${entry.bufferMs} ms`;
  row.values.underruns.textContent = String(entry.underruns);
  row.values.drops.textContent = String(entry.drops);
  row.values.skipped.textContent = String(entry.skipped);
  row.skippedFact.classList.toggle('hidden', entry.skipped === 0);
}
