import { getFirebase, currentUser, idToken } from './firebase.js';
import { bindShareButton } from './sharing.js';

const categories = {
  freefire: { label: 'FREE FIRE', page: '/pages/freefire.html', plural: 'Free Fire accounts', collection: 'freefire_accounts' },
  cod: { label: 'CALL OF DUTY', page: '/pages/cod.html', plural: 'Call of Duty accounts', collection: 'cod_accounts' },
  efootball: { label: 'E FOOTBALL', page: '/pages/efootball.html', plural: 'eFootball accounts', collection: 'efootball_accounts' },
  diamonds: { label: 'DIAMONDS', page: '/pages/diamonds.html', plural: 'Free Fire diamonds', collection: 'diamonds' },
};

export function initializeStorefront() {
  const grid = document.querySelector('#featured-grid');
  const tabs = [...document.querySelectorAll('.category-tab')];
  setupCategoryCountBadges(tabs);
  const loginDialog = document.querySelector('#login-dialog');
  const featuredLink = document.querySelector('.view-all');

  async function showCategory(categoryId, maxItems = 2) {
    const category = categories[categoryId];
    featuredLink.href = category.page;
    featuredLink.innerHTML = `${category.label} <span>↗</span>`;
    grid.innerHTML = '<p class="loading-state">LOADING ACCOUNTS…</p>';
    try {
      const { db, collection, query, where, limit, getDocs, doc, getDoc } = await getFirebase();
      const listingsQuery = query(collection(db, category.collection), where('status', '==', 'available'), limit(maxItems));
      const snapshot = await getDocs(listingsQuery);
      const voteSummary = await loadVoteSummary(categoryId).catch(() => ({ count: 0, voted: false }));
      if (snapshot.empty) {
        showEmptyCategory(categoryId, '', voteSummary);
        return;
      }
      grid.innerHTML = '';
      const user = await currentUser().catch(() => null);
      snapshot.forEach((item) => grid.append(createAccountCard(item.id, item.data(), categoryId, user?.uid)));
      const count = voteSummary.count;
      const buttonLabel = voteSummary.voted ? 'VOTED ✓' : 'VOTE ↗';
      grid.insertAdjacentHTML('beforeend', `<div class="vote-strip"><span class="vote-count">${count} PLAYER${count === 1 ? '' : 'S'} VOTED FOR MORE ${category.label}</span><button class="vote-button${voteSummary.voted ? ' is-voted' : ''}" type="button" data-vote="${categoryId}" aria-pressed="${voteSummary.voted}">${buttonLabel}</button></div>`);
      grid.querySelector('[data-vote]').addEventListener('click', () => toggleVote(categoryId, () => showCategory(categoryId)));
    } catch (error) {
      showEmptyCategory(categoryId, error.message);
    }
  }

  function showEmptyCategory(categoryId, errorMessage = '', voteSummary = { count: 0, voted: false }) {
    const category = categories[categoryId];
    const position = Object.keys(categories).indexOf(categoryId) + 1;
    const status = errorMessage ? 'MARKET CONNECTION' : 'MARKET UPDATE';
    const heading = errorMessage ? 'THE LIVE MARKET IS UNAVAILABLE.' : `NO ${category.plural.toUpperCase()} HAVE BEEN POSTED YET.`;
    const body = errorMessage ? 'The live market could not connect. Check the Firebase web configuration and try again.' : `VOTE IF YOU WANT TO SEE ${category.plural.toUpperCase()}.`;
    const voteButton = `<div class="vote-actions"><span class="vote-count">${voteSummary.count} PLAYER${voteSummary.count === 1 ? '' : 'S'} VOTED</span><button class="vote-button${voteSummary.voted ? ' is-voted' : ''}" type="button" data-vote="${categoryId}" aria-pressed="${voteSummary.voted}">${voteSummary.voted ? 'VOTED ✓' : `VOTE FOR ${category.label} ↗`}</button></div>`;
    grid.innerHTML = `<article class="empty-market"><div class="empty-symbol">＋</div><div><span class="stock-label"><i></i> ${status}</span><h3>${heading}</h3><p>${body}</p>${voteButton}</div><span class="empty-number">0${position} / 04</span></article>`;
    grid.querySelector('[data-vote]')?.addEventListener('click', () => toggleVote(categoryId, () => showCategory(categoryId)));
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    showCategory(tab.dataset.category);
  }));

  grid.querySelector('[data-vote]')?.addEventListener('click', () => toggleVote('freefire', () => showCategory('freefire')));
  document.querySelector('.dialog-close').addEventListener('click', () => loginDialog.close());
  loginDialog.addEventListener('click', (event) => {
    if (event.target === loginDialog) loginDialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && loginDialog.open) loginDialog.close();
  });
  showCategory('freefire');
}

function createAccountCard(id, account, categoryId, userId) {
  const article = document.createElement('article');
  article.className = 'account-card';
  const image = categoryId === 'diamonds' ? account.photo : account.images?.[0];
  const price = Number(account.price || 0).toLocaleString('en-NG');
  const title = categoryId === 'freefire' ? `${account.prime || 'FREE FIRE'} / LEVEL ${account.level || '—'}` : categoryId === 'diamonds' ? `${Number(account.diamonds || 0).toLocaleString()} DIAMONDS` : `${categoryId === 'cod' ? 'CALL OF DUTY' : 'E FOOTBALL'} / LEVEL ${account.level || '—'}`;
  article.innerHTML = `<a class="account-image" href="/pages/view.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(categoryId)}">${image ? `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(title)}" loading="lazy">` : '<span>IMAGE PENDING</span>'}<i>AVAILABLE</i></a><div class="account-card-content"><div class="account-title-line"><h3>${escapeText(title)}</h3><span class="card-social-actions"><button class="like-button" type="button" aria-label="Like this account"><span>♡</span><b>${Number(account.likes || 0)}</b></button><button class="share-button" type="button" aria-label="Share this account, ${Number(account.shares || 0)} shares"><span aria-hidden="true">↗</span><b data-share-count>${Number(account.shares || 0)}</b></button></span></div><dl class="account-facts">${account.prime ? `<div><dt>PRIME</dt><dd>${escapeText(account.prime)}</dd></div>` : ''}${account.level ? `<div><dt>LEVEL</dt><dd>${escapeText(account.level)}</dd></div>` : ''}${account.diamonds ? `<div><dt>DIAMONDS</dt><dd>${Number(account.diamonds).toLocaleString()}</dd></div>` : ''}<div><dt>PRICE</dt><dd class="price-value">₦${price}</dd></div></dl><a class="card-view-link" href="/pages/view.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(categoryId)}">VIEW ACCOUNT <span>↗</span></a></div>`;
  bindShareButton(article.querySelector('.share-button'), { accountId: id, accountType: categoryId, title });
  const likeButton = article.querySelector('.like-button');
  const alreadyLiked = userId && (account.likesBy || []).includes(userId);
  likeButton.classList.toggle('is-liked', Boolean(alreadyLiked));
  likeButton.setAttribute('aria-pressed', String(Boolean(alreadyLiked)));
  likeButton.addEventListener('click', async () => {
    if (likeButton.disabled) return;
    try {
      const user = await currentUser();
      if (!user) {
        const dialog = document.querySelector('#login-dialog');
        if (!dialog.open) dialog.showModal();
        return;
      }
      const { db, doc, updateDoc, increment, arrayUnion, arrayRemove } = await getFirebase();
      const liked = likeButton.classList.contains('is-liked');
      const count = likeButton.querySelector('b');
      const oldCount = Number(count.textContent);
      likeButton.disabled = true;
      likeButton.classList.toggle('is-liked', !liked);
      likeButton.setAttribute('aria-pressed', String(!liked));
      likeButton.setAttribute('aria-label', `${liked ? 'Like' : 'Unlike'} this account`);
      count.textContent = String(Math.max(0, oldCount + (liked ? -1 : 1)));
      try {
        await updateDoc(doc(db, categories[categoryId].collection, id), {
          likes: increment(liked ? -1 : 1),
          likesBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
        });
      } catch (error) {
        likeButton.classList.toggle('is-liked', liked);
        likeButton.setAttribute('aria-pressed', String(liked));
        likeButton.setAttribute('aria-label', `${liked ? 'Unlike' : 'Like'} this account`);
        count.textContent = String(oldCount);
        throw error;
      } finally {
        likeButton.disabled = false;
      }
    } catch (error) {
      console.error('Could not update listing like:', error);
    }
  });
  return article;
}

async function toggleVote(categoryId, refreshCategory) {
  const grid = document.querySelector('#featured-grid');
  const button = grid.querySelector(`[data-vote="${categoryId}"]`);
  if (button?.disabled) return;
  const originalMarkup = button?.innerHTML;
  try {
    const user = await currentUser().catch(() => null);
    if (!user) {
      const dialog = document.querySelector('#login-dialog');
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'SAVING VOTE…';
    }
    const response = await fetch('/api/vote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Your vote could not be saved.');
    await refreshCategory();
  } catch (error) {
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalMarkup;
    }
    let feedback = grid.querySelector('.vote-feedback');
    if (!feedback) {
      feedback = document.createElement('p');
      feedback.className = 'vote-feedback';
      feedback.setAttribute('role', 'status');
      grid.append(feedback);
    }
    feedback.textContent = error.message || 'Your vote could not be saved. Try again.';
  }
}

async function loadVoteSummary(categoryId) {
  const user = await currentUser().catch(() => null);
  const headers = user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
  const response = await fetch(`/api/votes?categoryId=${encodeURIComponent(categoryId)}`, { headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Vote totals could not be loaded.');
  return result;
}

function escapeText(value) {
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', '&quot;');
}

function setupCategoryCountBadges(tabs) {
  const targets = new Map();
  const addTarget = (categoryId, target) => {
    const categoryTargets = targets.get(categoryId) || [];
    categoryTargets.push(target);
    targets.set(categoryId, categoryTargets);
  };
  for (const tab of tabs) {
    addTarget(tab.dataset.category, tab);
  }
  for (const row of document.querySelectorAll('.category-row')) {
    const path = new URL(row.href).pathname;
    const match = Object.entries(categories).find(([, category]) => category.page === path);
    if (match) addTarget(match[0], row);
  }

  for (const [categoryId, categoryTargets] of targets) {
    for (const target of categoryTargets) {
      const badge = document.createElement('span');
      badge.className = 'category-count-badge';
      badge.dataset.categoryCount = categoryId;
      badge.hidden = true;
      target.append(badge);
    }
  }

  getFirebase().then(({ db, collection, query, where, onSnapshot }) => {
    for (const [categoryId, category] of Object.entries(categories)) {
      const availableListings = query(collection(db, category.collection), where('status', '==', 'available'));
      onSnapshot(availableListings, (snapshot) => {
        const count = snapshot.size;
        document.querySelectorAll(`[data-category-count="${categoryId}"]`).forEach((badge) => {
          badge.textContent = String(count);
          badge.hidden = count === 0;
          badge.setAttribute('aria-label', `${count} available`);
        });
      }, (error) => console.warn(`Could not load ${categoryId} count:`, error));
    }
  }).catch((error) => console.warn('Category counts are unavailable:', error));
}

