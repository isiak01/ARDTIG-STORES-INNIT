import { getFirebase, currentUser, idToken } from './firebase.js';
import { bindShareButton } from './sharing.js';

const categoryId = document.body.dataset.category;
const collections = { freefire: 'freefire_accounts', cod: 'cod_accounts', efootball: 'efootball_accounts', diamonds: 'diamonds' };
const names = { freefire: 'FREE FIRE', cod: 'CALL OF DUTY', efootball: 'E FOOTBALL', diamonds: 'DIAMONDS' };
const grid = document.querySelector('#account-grid');
const status = document.querySelector('#category-status');
const search = document.querySelector('#listing-search');
let entries = [];
let availableCount = 0;
let voteSummary = { count: 0, voted: false };

try {
  const { db, collection, query, where, onSnapshot } = await getFirebase();
  const listingsQuery = query(collection(db, collections[categoryId]), where('status', '==', 'available'));
  voteSummary = await loadVoteSummary().catch(() => voteSummary);
  onSnapshot(listingsQuery, (snapshot) => {
    entries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    availableCount = snapshot.size;
    render(entries);
  }, (error) => {
    status.textContent = error.message || 'Could not load the live market.';
  });
} catch (error) {
  status.textContent = 'Could not load the live market. Firebase web configuration may be incomplete.';
}

search.addEventListener('input', () => {
  const needle = search.value.trim().toLowerCase();
  render(entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(needle)));
});

document.querySelector('#category-vote')?.addEventListener('click', toggleVote);

function render(list) {
  status.textContent = list.length ? `${list.length} ${categoryId === 'diamonds' ? 'TOP-UP' : 'ACCOUNT'}${list.length === 1 ? '' : 'S'} AVAILABLE` : 'NOT AVAILABLE RIGHT NOW';
  const countBadge = document.createElement('span');
  countBadge.className = 'category-count-badge category-page-count';
  countBadge.textContent = String(availableCount);
  countBadge.hidden = availableCount === 0;
  countBadge.setAttribute('aria-label', `${availableCount} available`);
  status.append(countBadge);
  if (!list.length) {
    const heading = categoryId === 'diamonds' ? 'NO FREE FIRE DIAMONDS HAVE BEEN POSTED YET.' : `NO ${names[categoryId]} ACCOUNTS HAVE BEEN POSTED YET.`;
    const voteControls = `<span class="vote-count">${voteSummary.count} PLAYER${voteSummary.count === 1 ? '' : 'S'} VOTED</span><button class="form-button vote-button${voteSummary.voted ? ' is-voted' : ''}" type="button" id="empty-vote" aria-pressed="${voteSummary.voted}">${voteSummary.voted ? 'VOTED ✓' : 'VOTE IF YOU WANT TO SEE THESE'}</button>`;
    grid.innerHTML = `<div class="empty-market category-empty"><div class="empty-symbol">＋</div><div><span class="stock-label"><i></i> MARKET UPDATE</span><h3>${heading}</h3><p>Vote if you want to see more ${names[categoryId]}.</p>${voteControls}</div></div>`;
    grid.querySelector('#empty-vote')?.addEventListener('click', toggleVote);
    return;
  }
  grid.innerHTML = '';
  list.forEach((entry) => grid.append(createCard(entry)));
}

function createCard(account) {
  const card = document.createElement('article');
  card.className = 'account-card';
  const image = categoryId === 'diamonds' ? account.photo : account.images?.[0];
  const title = categoryId === 'freefire' ? `${account.prime || 'FREE FIRE'} / LEVEL ${account.level || '—'}` : categoryId === 'diamonds' ? `${Number(account.diamonds || 0).toLocaleString()} DIAMONDS` : `${names[categoryId]} / LEVEL ${account.level || '—'}`;
  card.innerHTML = `<a class="account-image" href="/pages/view.html?id=${encodeURIComponent(account.id)}&type=${categoryId}">${image ? `<img src="${escapeAttribute(image)}" alt="${escapeText(title)}" loading="lazy">` : '<span>IMAGE PENDING</span>'}<i>AVAILABLE</i></a><div class="account-card-content"><div class="account-title-line"><h3>${escapeText(title)}</h3><span class="card-social-actions"><span class="card-likes">♡ ${Number(account.likes || 0)}</span><button class="share-button" type="button" aria-label="Share this account, ${Number(account.shares || 0)} shares"><span aria-hidden="true">↗</span><b data-share-count>${Number(account.shares || 0)}</b></button></span></div><dl class="account-facts">${[['PRIME',account.prime],['LEVEL',account.level],['PLAYERS',account.players],['DIAMONDS',account.diamonds],['MYTHIC GUNS',account.mythicGuns],['EMOTES',account.emotes],['SKINS',account.skins],['CP',account.cp],['EVO GUNS',account.evoGuns],['HEROIC CS',account.heroicCS],['HEROIC BR',account.heroicBR],['THIS MONTH BOOYAH PASS',account.booyahPass]].filter(([,value]) => value !== undefined && value !== '').slice(0,4).map(([label,value]) => `<div><dt>${label}</dt><dd>${escapeText(value)}</dd></div>`).join('')}<div><dt>PRICE</dt><dd class="price-value">₦${Number(account.price || 0).toLocaleString('en-NG')}</dd></div></dl><a class="card-view-link" href="/pages/view.html?id=${encodeURIComponent(account.id)}&type=${categoryId}">VIEW ACCOUNT <span>↗</span></a></div>`;
  bindShareButton(card.querySelector('.share-button'), { accountId: account.id, accountType: categoryId, title });
  return card;
}

async function toggleVote() {
  const user = await currentUser().catch(() => null);
  if (!user) return location.assign('/pages/auth.html');
  try {
    const response = await fetch('/api/vote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your vote could not be saved.');
    voteSummary.voted = result.voted;
    voteSummary.count += result.voted ? 1 : -1;
    if (!entries.length) render(entries);
    updateVoteButtons();
  } catch (error) {
    status.textContent = error.message || 'Your vote could not be saved.';
  }
}

async function loadVoteSummary() {
  const user = await currentUser().catch(() => null);
  const headers = user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
  const response = await fetch(`/api/votes?categoryId=${encodeURIComponent(categoryId)}`, { headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Vote totals could not be loaded.');
  return result;
}

function updateVoteButtons() {
  document.querySelectorAll('#category-vote, #empty-vote').forEach((button) => {
    button.classList.toggle('is-voted', voteSummary.voted);
    button.setAttribute('aria-pressed', String(voteSummary.voted));
    button.textContent = voteSummary.voted ? 'VOTED ✓' : 'VOTE FOR THIS CATEGORY ↗';
  });
  const count = grid.querySelector('.vote-count');
  if (count) count.textContent = `${voteSummary.count} PLAYER${voteSummary.count === 1 ? '' : 'S'} VOTED`;
}

function escapeText(value) {
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}
function escapeAttribute(value) { return escapeText(value).replaceAll('"', '&quot;'); }
