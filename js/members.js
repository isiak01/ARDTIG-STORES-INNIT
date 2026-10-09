import { requireMemberSession } from './member-session.js';
import { createVerifiedBadge } from './badges.js';
import { showBannedScreen } from './banned-screen.js';

const message = document.querySelector('[data-page-message]');
const adminList = document.querySelector('#admin-members');
const playerList = document.querySelector('#player-members');
const search = document.querySelector('#memberSearch');
const session = await requireMemberSession();
let directoryMembers = [];

if (session) {
  try {
    await sendRequest('/api/member-sync', session.user);
    await sendRequest('/api/member-directory-sync', session.user);
    search.hidden = session.profile.role !== 'admin';
    search.addEventListener('input', renderDirectory);
    const { collection, onSnapshot } = session.firebase;
    onSnapshot(collection(session.db, 'public_members'), (snapshot) => {
      directoryMembers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderDirectory();
    });
  } catch (error) {
    message.textContent = error.message || 'The member directory could not load.';
    adminList.replaceChildren();
    playerList.replaceChildren();
  }
}

function renderDirectory() {
  const needle = session.profile.role === 'admin' ? search.value.trim().toLocaleLowerCase() : '';
  const members = directoryMembers.filter((member) => String(member.username || '').toLocaleLowerCase().includes(needle));
  const admins = members.filter((member) => member.role === 'admin').sort((left, right) => timestamp(left.adminSince || left.createdAt) - timestamp(right.adminSince || right.createdAt) || compareNames(left.username, right.username));
  const players = members.filter((member) => member.role !== 'admin').sort((left, right) => compareNames(left.username, right.username));
  fillList(adminList, admins, session);
  fillList(playerList, players, session);
}

function fillList(list, members, session) {
  list.replaceChildren();
  if (!members.length) {
    const empty = document.createElement('li');
    empty.className = 'member-empty';
    empty.textContent = 'No members to show yet.';
    list.append(empty);
    return;
  }
  members.forEach((member, index) => {
    const row = document.createElement('li');
    row.className = 'member-row';
    const rank = document.createElement('span');
    rank.className = 'member-rank';
    rank.textContent = String(index + 1);
    const avatar = document.createElement('span');
    avatar.className = 'member-avatar';
    const photo = document.createElement('img');
    photo.className = 'member-photo';
    photo.src = member.photoURL || '/logo.png';
    photo.alt = '';
    photo.loading = 'lazy';
    avatar.append(photo);
    const identity = document.createElement('span');
    identity.className = 'member-identity';
    const username = document.createElement('span');
    username.className = 'member-username';
    username.textContent = member.username || 'PLAYER';
    if (member.role === 'admin') username.append(createVerifiedBadge());
    identity.append(username);
    if (member.banned) {
      const banned = document.createElement('small');
      banned.className = 'member-status-banned';
      banned.textContent = 'BANNED';
      identity.append(banned);
    }
    row.append(rank, avatar, identity);
    if (session.profile.role === 'admin') {
      const button = document.createElement('button');
      button.className = 'member-ban-button';
      button.type = 'button';
      button.disabled = member.banned === true;
      button.textContent = member.banned ? 'BANNED' : 'BAN';
      button.addEventListener('click', () => banMember(member, button, session));
      row.append(button);
    }
    list.append(row);
  });
}

async function banMember(member, button, session) {
  if (!window.confirm(`Ban ${member.username}? This will block the account from using the store.`)) return;
  button.disabled = true;
  try {
    await sendRequest('/api/ban-member', session.user, { userId: member.id });
    message.textContent = `${member.username} was banned.`;
    if (member.id === session.user.uid) {
      showBannedScreen();
    }
  } catch (error) {
    message.textContent = error.message || 'The member could not be banned.';
    button.disabled = false;
  }
}

async function sendRequest(path, user, payload = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function timestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNames(left = '', right = '') {
  const leftName = String(left);
  const rightName = String(right);
  const leftIsLetter = /^[a-z]/i.test(leftName);
  const rightIsLetter = /^[a-z]/i.test(rightName);
  if (leftIsLetter !== rightIsLetter) return leftIsLetter ? -1 : 1;
  return leftName.localeCompare(rightName, 'en', { sensitivity: 'base', numeric: true });
}
