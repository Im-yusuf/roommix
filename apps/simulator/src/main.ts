import { createApp } from './app.js';
import type { InputKind } from './audio/capture.js';
import { createStore, initialState } from './state.js';
import { $ } from './ui/dom.js';
import { createRenderer } from './ui/render.js';

const store = createStore(initialState);
const app = createApp(store);
const render = createRenderer();
store.subscribe(render);
render(store.state);

const roomInput = $<HTMLInputElement>('room');
const nameInput = $<HTMLInputElement>('name');
nameInput.value = localStorage.getItem('roommix:name') ?? '';

$<HTMLFormElement>('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  localStorage.setItem('roommix:name', nameInput.value.trim());
  app.join(roomInput.value.trim(), nameInput.value.trim());
});
$('leave').onclick = () => void app.leave();
$('mic-toggle').onclick = () => void app.toggleInput();
$<HTMLSelectElement>('input-kind').onchange = (event) => {
  app.setInputKind((event.target as HTMLSelectElement).value as InputKind);
};
$('notice-dismiss').onclick = () => app.dismissNotice();
