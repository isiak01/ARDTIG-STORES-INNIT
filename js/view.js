import { getFirebase, currentUser } from './firebase.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const type = params.get('type');
const collections = { freefire: 'freefire_accounts', cod: 'cod_accounts', efootball: 'efootball_accounts', diamonds: 'diamonds' };
const details = document.querySelector('#listing-details');
const gallery = document.querySelector('#listing-gallery');
const buy = document.querySelector('#buy-listing');
const loginDialog = document.querySelector('#login-dialog');
const buyMethodDialog = document.createElement('dialog');
buyMethodDialog.className = 'buy-method-dialog';
buyMethodDialog.setAttribute('aria-labelledby', 'buy-method-title');
buyMethodDialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Close">×</button><p class="eyebrow">CHECKOUT</p><h2 id="buy-method-title">CHOOSE PAYMENT.</h2><div class="buy-method-actions"><a class="form-button wallet-method" data-wallet-method>PAY WITH ARDTIG BALANCE</a><a class="form-button secondary" data-manual-method>PAY WITH MANUAL TRANSFER</a></div>';
document.body.append(buyMethodDialog);
buyMethodDialog.querySelector('.dialog-close').addEventListener('click', () => buyMethodDialog.close());
document.title = 'Account details | ARDTIG STORES';
buy.textContent = type === 'diamonds' ? 'BUY DIAMONDS →' : 'BUY THIS ACCOUNT →';

buy.addEventListener('click', async (event) => {
  if (buy.disabled || buy.hidden) return;
  event.preventDefault();
  const user = await currentUser().catch(() => null);
  if (user) {
    buyMethodDialog.querySelector('[data-wallet-method]').href = `/pages/wallet-checkout.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;
    buyMethodDialog.querySelector('[data-manual-method]').href = buy.href;
    buyMethodDialog.showModal();
  }
  else {
    loginDialog.querySelector('.login-continue').href = `/pages/auth.html?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
    if (!loginDialog.open) loginDialog.showModal();
  }
});
document.querySelector('#login-dialog-close')?.addEventListener('click', () => loginDialog.close());

if (!id || !collections[type]) showError('This listing link is incomplete.');
else {
  try {
    const { db, doc, getDoc } = await getFirebase();
    const snapshot = await getDoc(doc(db, collections[type], id));
    if (!snapshot.exists()) showError('This listing could not be found.');
    else renderListing(snapshot.data());
  } catch (error) {
    showError('The listing could not load. Check the Firebase configuration and try again.');
  }
}

function renderListing(account) {
  const images = type === 'diamonds' ? (account.photo ? [account.photo] : []) : (account.images || []);
  const mainImage = document.querySelector('#main-image');
  mainImage.src = images[0] || '/logo.png';
  mainImage.alt = `${type} listing image`;
  gallery.innerHTML = images.map((url, index) => `<button class="gallery-thumb ${index === 0 ? 'is-current' : ''}" data-image-index="${index}" aria-label="Show image ${index + 1}"><img src="${safeAttribute(url)}" alt="" loading="lazy"></button>`).join('');
  gallery.querySelectorAll('[data-image-index]').forEach((button) => button.addEventListener('click', () => {
    mainImage.src = images[Number(button.dataset.imageIndex)];
    gallery.querySelectorAll('.gallery-thumb').forEach((thumb) => thumb.classList.toggle('is-current', thumb === button));
  }));
  const fields = type === 'diamonds' ? [['DIAMONDS', account.diamonds]] : Object.entries(account).filter(([key,value]) => !['images','likes','likesBy','shares','status','createdAt','logs','uid'].includes(key) && ['string','number','boolean'].includes(typeof value)).map(([key,value]) => [key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase(), value]);
  details.innerHTML = `<p class="eyebrow"><span>${type.toUpperCase()}</span> ACCOUNT DETAILS</p><h1 class="onboard-heading">${safeText(account.prime || `${type.toUpperCase()} ACCOUNT`)} <em>FOR SALE.</em></h1><span class="listing-status ${account.status === 'sold' ? 'is-sold' : ''}">${account.status === 'sold' ? 'SOLD' : 'AVAILABLE'}</span><dl class="detail-list">${fields.map(([label,value]) => `<div><dt>${safeText(label)}</dt><dd>${safeText(value)}</dd></div>`).join('')}<div><dt>PRICE</dt><dd class="price-value">₦${Number(account.price || 0).toLocaleString('en-NG')}</dd></div></dl>`;
  if (account.status === 'sold') {
    buy.textContent = 'SOLD';
    buy.disabled = true;
    buy.classList.add('is-disabled');
  } else buy.href = `/pages/payment.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;
}

function showError(message) {
  details.innerHTML = `<p class="eyebrow"><span>ACCOUNT</span> UNAVAILABLE</p><h1 class="onboard-heading">WE COULDN’T FIND <em>THAT ONE.</em></h1><p class="panel-intro">${message}</p>`;
  buy.hidden = true;
}
function safeText(value) { const node = document.createElement('span'); node.textContent = String(value ?? '—'); return node.innerHTML; }
function safeAttribute(value) { return safeText(value).replaceAll('"', '&quot;'); }
