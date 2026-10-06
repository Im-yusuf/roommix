import { createApp } from './app.js';
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
$('leave').onclick = () => app.leave();
$('notice-dismiss').onclick = () => app.dismissNotice();
