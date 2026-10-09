import { getFirebase } from './firebase.js';

const root = document.querySelector('#sold-list');
const status = document.querySelector('#sold-status');
try {
  const { db, collection, query, where, getDocs } = await getFirebase();
  const snapshot = await getDocs(query(collection(db, 'sold_accounts'), where('status', '==', 'sold')));
  if (snapshot.empty) status.textContent = 'No sold listings yet.';
  else {
    status.textContent = `${snapshot.size} SOLD LISTING${snapshot.size === 1 ? '' : 'S'}`;
    snapshot.forEach((item) => {
      const account = item.data();
      const image = account.images?.[0] || account.photo || '';
      const name = account.prime || `${(account.accountType || '').toUpperCase()} ACCOUNT`;
      const card = document.createElement('article');
      card.className = 'account-card sold-card';
      card.innerHTML = `<a class="account-image" href="/pages/view.html?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(account.accountType || 'freefire')}">${image ? `<img src="${safeAttribute(image)}" alt="${safeText(name)}" loading="lazy">` : '<span>ARCHIVED LISTING</span>'}<i>SOLD</i></a><div class="account-card-content"><div class="account-title-line"><h3>${safeText(name)}</h3><span class="purchase-status status-sold">SOLD</span></div><a class="card-view-link" href="/pages/view.html?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(account.accountType || 'freefire')}">VIEW LISTING <span>↗</span></a></div>`;
      root.append(card);
    });
  }
} catch (error) { status.textContent = error.message || 'Sold listings could not load.'; }
function safeText(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; }
function safeAttribute(value) { return safeText(value).replaceAll('"', '&quot;'); }
