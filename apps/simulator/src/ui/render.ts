import type { RosterEntry } from '@roommix/server/protocol';
import type { AppState } from '../state.js';
import { $ } from './dom.js';

/** Maps an RMS level to a meter width: -60 dBFS is empty, 0 dBFS is full. */
export function levelToPercent(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/**
 * The page is static HTML; rendering means updating the handful of nodes that
 * show state. The participant list is the only part rebuilt wholesale.
 */
export function createRenderer() {
  const connection = $('connection');
  const leave = $('leave');
  const notice = $('notice');
  const noticeText = $('notice-text');
  const noticeAction = $<HTMLButtonElement>('notice-action');
  const lobby = $('lobby');
  const session = $('session');
  const sessionRoom = $('session-room');
  const sessionName = $('session-name');
  const participantsCard = $('participants-card');
  const participants = $<HTMLUListElement>('participants');

  let renderedRoster: RosterEntry[] | null = null;
  let renderedDominant: string | null = null;

  return function render(state: AppState): void {
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
    for (const card of [session, participantsCard]) card.classList.toggle('hidden', !joined);
    leave.classList.toggle('hidden', !joined);
    sessionRoom.textContent = state.room;
    sessionName.textContent = state.name;

    if (state.roster !== renderedRoster || state.dominant !== renderedDominant) {
      renderedRoster = state.roster;
      renderedDominant = state.dominant;
      participants.replaceChildren(
        ...state.roster.map((entry) =>
          participantRow(
            entry,
            entry.clientId === state.dominant,
            entry.clientId === state.clientId,
          ),
        ),
      );
    }
  };
}

function participantRow(entry: RosterEntry, isDominant: boolean, isSelf: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = isDominant ? 'participant dominant' : 'participant';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = isSelf ? `${entry.name} (you)` : entry.name;

  const state = document.createElement('span');
  state.className = `state ${entry.state}`;
  state.textContent = isDominant ? `${entry.state} · dominant` : entry.state;

  const meter = document.createElement('div');
  meter.className = 'meter';
  const fill = document.createElement('div');
  fill.className = 'meter-fill';
  fill.style.width = `${levelToPercent(entry.level)}%`;
  meter.append(fill);

  const details = document.createElement('div');
  details.className = 'details';
  const facts = [
    `gain ${Math.round(entry.gain * 100)} %`,
    `buffer ${entry.bufferMs} ms`,
    `underruns ${entry.underruns}`,
    `drops ${entry.drops}`,
  ];
  if (entry.skipped > 0) facts.push(`skipped ${entry.skipped}`);
  for (const fact of facts) {
    const span = document.createElement('span');
    span.textContent = fact;
    details.append(span);
  }

  li.append(name, state, meter, details);
  return li;
}
