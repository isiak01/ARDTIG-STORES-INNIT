import { requireMemberSession } from './member-session.js';
import { createVerifiedBadge } from './badges.js';

const root = document.querySelector('#tournament-list');
const message = document.querySelector('[data-page-message]');
const tabs = [...document.querySelectorAll('[data-status]')];
const session = await requireMemberSession();
let tournaments = [];
let activeStatus = 'upcoming';

if (session) {
  try {
    session.firebase.onSnapshot(session.firebase.collection(session.db, 'tournaments'), (snapshot) => {
      tournaments = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderTournaments();
    }, (error) => {
      message.textContent = error.message || 'Tournaments could not load.';
    });
  } catch (error) {
    message.textContent = error.message || 'Tournaments could not load.';
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
  activeStatus = tab.dataset.status;
  tabs.forEach((item) => {
    const selected = item === tab;
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  renderTournaments();
}));

function renderTournaments() {
  root.replaceChildren();
  const visible = tournaments.filter((tournament) => tournament.status === activeStatus)
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard-empty';
    empty.textContent = `No ${activeStatus} tournaments right now.`;
    root.append(empty);
    return;
  }
  visible.forEach((tournament) => root.append(createTournamentCard(tournament)));
}

function createTournamentCard(tournament) {
  const card = document.createElement('article');
  card.className = 'tournament-card';
  const image = document.createElement('img');
  image.className = 'tournament-image';
  image.src = tournament.imageUrl || '/logo.png';
  image.alt = `${tournament.game || 'Free Fire'} tournament preview`;
  image.loading = 'lazy';
  const content = document.createElement('div');
  content.className = 'tournament-content';
  const heading = document.createElement('div');
  heading.className = 'tournament-heading';
  const title = document.createElement('h2');
  title.textContent = tournament.game || 'FREE FIRE';
  const status = document.createElement('span');
  status.className = `tournament-status ${tournament.status}`;
  status.textContent = tournament.status.toUpperCase();
  heading.append(title, status);
  const details = document.createElement('dl');
  details.className = 'tournament-details';
  [
    ['GAME', tournament.game], ['MAP', tournament.map], ['NUMBER OF PLAYERS NEEDED', tournament.playersNeeded],
    ['MATCH TYPE', tournament.matchType], ['TEAM SIZE', tournament.teamSize], ['MATCH TIME', tournament.matchTime],
    ['PRICE', tournament.price], ['PRICE TYPE', tournament.priceType], ['VOTES', tournament.votes || 0],
  ].forEach(([label, value]) => appendDetail(details, label, value));
  const room = document.createElement('div');
  room.className = 'tournament-room';
  if (tournament.status === 'upcoming') {
    room.textContent = 'Admin will drop room code here when its time';
  } else {
    appendDetail(room, 'ROOM CODE', tournament.roomCode || 'Not posted');
    appendDetail(room, 'ROOM PASSWORD', tournament.roomPassword || 'Not posted');
  }
  const actions = document.createElement('div');
  actions.className = 'tournament-actions';
  const registered = (tournament.registeredUsers || []).some((entry) => entry.username === session.profile.username);
  const register = document.createElement('button');
  register.type = 'button';
  register.className = 'tournament-register';
  register.disabled = tournament.status !== 'upcoming' || registered;
  if (tournament.status === 'finished') register.textContent = 'TOURNAMENT HAS ENDED';
  else if (tournament.status === 'ongoing') register.textContent = 'REGISTRATION CLOSED';
  else if (registered) register.textContent = 'REGISTERED';
  else register.textContent = 'REGISTER FOR TOURNAMENT';
  register.addEventListener('click', () => registerForTournament(tournament, register));
  actions.append(register);
  const note = document.createElement('small');
  note.className = 'tournament-note';
  note.textContent = 'Register to get notification when room details are dropped';
  actions.append(note);
  if (session.profile.role === 'admin') addAdminActions(actions, tournament);
  content.append(heading, details, room, actions);
  card.append(image, content);
  return card;
}

function appendDetail(list, label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
  row.append(term, description);
  list.append(row);
}

function addAdminActions(actions, tournament) {
  if (tournament.status === 'upcoming') {
    const roomButton = document.createElement('button');
    roomButton.className = 'form-button secondary';
    roomButton.type = 'button';
    roomButton.textContent = 'ADD ROOM DETAILS';
    roomButton.addEventListener('click', () => showRoomDialog(tournament));
    actions.append(roomButton);
    const usersButton = document.createElement('button');
    usersButton.className = 'form-button secondary';
    usersButton.type = 'button';
    usersButton.textContent = 'VIEW REGISTERED USERS';
    usersButton.addEventListener('click', () => showRegistrants(tournament));
    actions.append(usersButton);
  } else if (tournament.status === 'ongoing') {
    const finishButton = document.createElement('button');
    finishButton.className = 'form-button secondary';
    finishButton.type = 'button';
    finishButton.textContent = 'MARK AS FINISHED';
    finishButton.addEventListener('click', () => finishTournament(tournament.id, finishButton));
    actions.append(finishButton);
  }
}

async function registerForTournament(tournament, button) {
  button.disabled = true;
  try {
    await sendRequest('/api/tournament-register', { tournamentId: tournament.id });
    button.textContent = 'REGISTERED';
    message.textContent = 'You are registered. We will notify you when room details are posted.';
  } catch (error) {
    message.textContent = error.message || 'Registration failed.';
    button.disabled = false;
  }
}

async function finishTournament(tournamentId, button) {
  if (!window.confirm('Mark this tournament as finished?')) return;
  button.disabled = true;
  try {
    await sendRequest('/api/tournament-finish', { tournamentId });
  } catch (error) {
    message.textContent = error.message || 'The tournament could not be updated.';
    button.disabled = false;
  }
}

function showRoomDialog(tournament) {
  const dialog = createDialog('ADD ROOM DETAILS', '<label class="field-label">ROOM CODE<input class="text-input" name="roomCode" required maxlength="80"></label><label class="field-label">ROOM PASSWORD<input class="text-input" name="roomPassword" required maxlength="80"></label><button class="form-button" type="submit">SAVE AND OPEN ROOM</button>');
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await sendRequest('/api/tournament-room', {
        tournamentId: tournament.id,
        roomCode: form.elements.namedItem('roomCode').value.trim(),
        roomPassword: form.elements.namedItem('roomPassword').value.trim(),
      });
      dialog.close();
      message.textContent = 'Room details posted. Registered players have been notified.';
    } catch (error) {
      form.querySelector('[data-dialog-message]').textContent = error.message || 'Room details could not be saved.';
      button.disabled = false;
    }
  });
  dialog.showModal();
}

function showRegistrants(tournament) {
  const dialog = createDialog('REGISTERED PLAYERS', '<ol class="registered-list"></ol>');
  const list = dialog.querySelector('.registered-list');
  (tournament.registeredUsers || []).forEach((entry) => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    const time = document.createElement('time');
    name.textContent = entry.username || 'PLAYER';
    if (entry.role === 'admin') name.append(createVerifiedBadge());
    time.textContent = formatTime(timestamp(entry.time));
    row.append(name, time);
    list.append(row);
  });
  if (!list.children.length) list.textContent = 'No players registered yet.';
  dialog.showModal();
}

function createDialog(title, fields) {
  const dialog = document.createElement('dialog');
  dialog.className = 'tournament-dialog';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const close = document.createElement('button');
  close.className = 'dialog-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  const form = document.createElement('form');
  form.innerHTML = `${fields}<p data-dialog-message role="status"></p>`;
  dialog.append(close, heading, form);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  return dialog;
}

async function sendRequest(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await session.user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function timestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : value || '');
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString();
}
