import { requireAdmin } from './admin-guard.js';

const root = document.querySelector('#analytics-grid');
const message = document.querySelector('#admin-message');
const result = await requireAdmin();
if (result) loadAnalytics(result);

async function loadAnalytics({ db, firebase }) {
  const groups = [
    ['USERS', 'users', null],
    ['FREE FIRE', 'freefire_accounts', 'status'],
    ['CALL OF DUTY', 'cod_accounts', 'status'],
    ['E FOOTBALL', 'efootball_accounts', 'status'],
    ['DIAMONDS', 'diamonds', null],
    ['VOTES', 'votes', null],
  ];
  try {
    const entries = await Promise.all(groups.map(async ([label, path]) => {
      const snapshot = await firebase.getDocs(firebase.collection(db, path));
      if (label === 'VOTES') {
        return { label, total: snapshot.docs.reduce((total, item) => total + (item.data().userIds || []).length, 0), note: 'ACROSS ALL CATEGORIES' };
      }
      if (!['USERS', 'DIAMONDS'].includes(label)) {
        return { label, total: snapshot.size, available: snapshot.docs.filter((item) => item.data().status === 'available').length, sold: snapshot.docs.filter((item) => item.data().status === 'sold').length };
      }
      return { label, total: snapshot.size };
    }));
    root.innerHTML = entries.map((entry) => `<article class="analytics-card"><small>${entry.label}</small><b>${entry.total}</b>${entry.available !== undefined ? `<span>${entry.available} AVAILABLE / ${entry.sold} SOLD</span>` : `<span>${entry.note || 'TOTAL RECORDS'}</span>`}</article>`).join('');
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Analytics could not load.';
  }
}
