import { idToken } from './firebase.js';
import { requireMemberSession } from './member-session.js';
import { createVerifiedBadge } from './badges.js';

const root = document.querySelector('#leaderboard-list');
const message = document.querySelector('[data-page-message]');
const session = await requireMemberSession();

if (session) {
  try {
    const response = await fetch('/api/leaderboard', { headers: { Authorization: `Bearer ${await idToken()}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The leaderboard could not load.');
    render(result.entries || []);
  } catch (error) {
    message.textContent = error.message || 'The leaderboard could not load.';
    root.replaceChildren();
  }
}

function render(entries) {
  root.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'Topup or buy an account to join the leaderboard';
    root.append(empty);
    return;
  }
  entries.forEach((entry, index) => {
    const card = document.createElement('article');
    card.className = 'leaderboard-card';
    const rank = document.createElement('span');
    rank.className = 'leaderboard-rank';
    rank.textContent = `#${index + 1}`;
    const avatar = document.createElement('span');
    avatar.className = 'member-avatar';
    const photo = document.createElement('img');
    photo.className = 'member-photo';
    photo.src = entry.photoURL || '/logo.png';
    photo.alt = '';
    avatar.append(photo);
    if (entry.role === 'admin') avatar.append(createVerifiedBadge({ avatar: true }));
    const name = document.createElement('strong');
    name.className = 'member-username';
    name.textContent = entry.username || 'PLAYER';
    if (entry.role === 'admin') name.append(createVerifiedBadge());
    if (index === 0) {
      const crown = document.createElement('span');
      crown.className = 'leaderboard-winner';
      crown.textContent = 'ARDTIG MUSK 😁';
      name.append(crown);
    }
    const identity = document.createElement('div');
    identity.className = 'leaderboard-identity';
    identity.append(name);
    const stats = document.createElement('dl');
    stats.className = 'leaderboard-stats';
    const labels = [
      ['freefire', 'Free fire accounts'],
      ['cod', 'Call of Duty accounts'],
      ['efootball', 'E Football accounts'],
      ['diamonds', 'Free fire diamonds purchase'],
    ];
    labels.forEach(([key, label]) => {
      if (!entry[key]) return;
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = label;
      value.textContent = String(entry[key]);
      row.append(term, value);
      stats.append(row);
    });
    const topups = document.createElement('div');
    const topupsLabel = document.createElement('dt');
    const topupsValue = document.createElement('dd');
    topupsLabel.textContent = 'Total Topups';
    topupsValue.textContent = `₦${Number(entry.totalTopups || 0).toLocaleString('en-NG')}`;
    topups.append(topupsLabel, topupsValue);
    stats.append(topups);
    const total = document.createElement('p');
    total.className = 'leaderboard-total';
    total.textContent = `Total Purchases — ₦${Number(entry.purchaseAmount || 0).toLocaleString('en-NG')}`;
    card.append(rank, avatar, identity, stats, total);
    root.append(card);
  });
}
