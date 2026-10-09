import { getFirebase, currentUser, idToken } from './firebase.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const type = params.get('type');
const collectionNames = { freefire: 'freefire_accounts', cod: 'cod_accounts', efootball: 'efootball_accounts', diamonds: 'diamonds' };
const form = document.querySelector('#payment-form');
const feedback = document.querySelector('#payment-message');
const proofInput = document.querySelector('#receipt-proof');
const proofUpload = document.querySelector('#upload-proof');
const submitButton = document.querySelector('#submit-payment');
const paymentSummary = document.querySelector('.payment-summary');
const successPanel = document.createElement('section');
successPanel.className = 'payment-success empty-market';
successPanel.hidden = true;
successPanel.setAttribute('role', 'status');
successPanel.innerHTML = '<div class="empty-symbol">✓</div><div><span class="stock-label"><i></i> REQUEST SUBMITTED</span><h3>YOUR REQUEST WAS SUBMITTED SUCCESSFULLY.</h3><p>Your payment is pending admin review. We will notify you when it is updated.</p><a class="form-button" href="/">BROWSE MORE ACCOUNTS ↗</a></div>';
form.insertAdjacentElement('afterend', successPanel);
let user;
let listing;
let receiptURL = '';

try {
  user = await currentUser();
  if (!user) location.replace(`/pages/auth.html?return=${encodeURIComponent(location.pathname + location.search)}`);
  if (!id || !collectionNames[type]) throw new Error('The listing link is incomplete.');
  const { db, doc, getDoc } = await getFirebase();
  const [account, paymentInfo] = await Promise.all([
    getDoc(doc(db, collectionNames[type], id)),
    getDoc(doc(db, 'config', 'paymentInfo')),
  ]);
  if (!account.exists() || account.data().status === 'sold') throw new Error('This listing is no longer available.');
  listing = account.data();
  document.querySelector('#payment-price').textContent = `₦${Number(listing.price || 0).toLocaleString('en-NG')}`;
  if (type === 'diamonds') document.querySelector('#diamond-fields').hidden = false;
  if (paymentInfo.exists()) renderPaymentInfo(paymentInfo.data());
} catch (error) {
  showMessage(error.message);
  submitButton.disabled = true;
}

proofInput.addEventListener('change', () => {
  const file = proofInput.files?.[0];
  receiptURL = '';
  submitButton.disabled = true;
  proofUpload.disabled = !file;
  if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
    proofInput.value = '';
    proofUpload.disabled = true;
    showMessage('Choose an image no larger than 5 MB.');
  }
});

proofUpload.addEventListener('click', async () => {
  const file = proofInput.files?.[0];
  if (!file) return;
  proofUpload.disabled = true;
  proofUpload.textContent = 'UPLOADING…';
  try {
    const token = await idToken();
    const body = new FormData();
    body.append('image', file);
    const response = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    receiptURL = result.url;
    showMessage('Proof uploaded and ready to submit.');
    checkReady();
  } catch (error) {
    showMessage(error.message);
    proofUpload.disabled = false;
  } finally {
    proofUpload.textContent = 'UPLOAD PROOF';
  }
});

form.addEventListener('input', checkReady);
form.addEventListener('change', checkReady);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!user || !listing || !receiptURL || !document.querySelector('#payment-accepted').checked) return;
  submitButton.disabled = true;
  try {
    const request = {
      accountId: id,
      accountType: type,
      receiptURL,
      price: Number(listing.price || 0),
    };
    if (type === 'diamonds') {
      request.uid = document.querySelector('#player-uid').value.trim();
      request.gameName = document.querySelector('#game-name').value.trim();
      if (!request.uid || !request.gameName) throw new Error('Enter both your UID and game name.');
    }
    const token = await idToken();
    const response = await fetch('/api/payment-request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not submit your request.');
    form.hidden = true;
    paymentSummary.hidden = true;
    if (type === 'diamonds') {
      successPanel.querySelector('h3').textContent = 'YOUR DIAMOND ORDER IS PENDING APPROVAL.';
      successPanel.querySelector('a').href = '/pages/myaccounts.html';
      successPanel.querySelector('a').textContent = 'VIEW MY ORDERS →';
    } else {
      successPanel.querySelector('a').href = `/pages/${type}.html`;
    }
    successPanel.hidden = false;
  } catch (error) {
    showMessage(error.message || 'Could not submit your request.');
    submitButton.disabled = false;
  }
});

function checkReady() {
  const accepted = document.querySelector('#payment-accepted').checked;
  const diamondReady = type !== 'diamonds' || (document.querySelector('#player-uid').value.trim() && document.querySelector('#game-name').value.trim());
  submitButton.disabled = !(receiptURL && accepted && diamondReady && user && listing);
}

function renderPaymentInfo(info) {
  const box = document.querySelector('#bank-details');
  const fields = [['BANK NAME', info.bankName], ['ACCOUNT NAME', info.accountName], ['ACCOUNT NUMBER', info.accountNumber]];
  box.innerHTML = fields.map(([label, value]) => value ? `<div class="bank-row"><span><small>${label}</small><b>${escapeText(value)}</b></span><button type="button" class="copy-button" data-copy="${escapeAttribute(value)}" aria-label="Copy ${label.toLowerCase()}">COPY</button></div>` : '').join('') || '<p class="panel-intro">Admin has not added account details yet.</p>';
  box.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'COPIED'; }
    catch { button.textContent = 'COPY FAILED'; }
  }));
}

function showMessage(text) { feedback.textContent = text; feedback.hidden = false; }
function escapeText(value) { const node = document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
function escapeAttribute(value) { return escapeText(value).replaceAll('"', '&quot;'); }
