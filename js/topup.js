import { currentUser, getFirebase, idToken } from './firebase.js';

const dialog = document.querySelector('#topup-dialog');
const form = document.querySelector('#topup-request-form');
const receiptInput = document.querySelector('#topup-receipt');
const uploadButton = document.querySelector('#topup-upload');
const submitButton = document.querySelector('#topup-submit');
const message = document.querySelector('#topup-dialog-message');
const pageMessage = document.querySelector('#topup-message');
let user;
let amount = 0;
let receiptUrl = '';

try {
  user = await currentUser();
  if (!user) location.replace(`/pages/auth.html?return=${encodeURIComponent(location.pathname + location.search)}`);
  const { db, doc, getDoc, onSnapshot } = await getFirebase();
  const [profile, paymentInfo] = await Promise.all([
    getDoc(doc(db, 'users', user.uid)),
    getDoc(doc(db, 'config', 'paymentInfo')),
  ]);
  const renderBalance = (snapshot) => {
    const balance = Number(snapshot.exists() ? snapshot.data().walletBalance || 0 : 0);
    document.querySelector('#topup-balance').textContent = `₦${balance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  renderBalance(profile);
  onSnapshot(doc(db, 'users', user.uid), renderBalance);
  if (paymentInfo.exists()) renderBankDetails(paymentInfo.data());
  else document.querySelector('#topup-bank-details').innerHTML = '<p class="panel-intro">Admin has not added bank account details yet.</p>';
} catch (error) {
  pageMessage.hidden = false;
  pageMessage.textContent = error.message || 'Wallet details could not load.';
}

document.querySelectorAll('[data-amount]').forEach((button) => button.addEventListener('click', () => openCheckout(Number(button.dataset.amount))));
document.querySelector('#custom-topup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const customAmount = Number(document.querySelector('#custom-amount').value);
  if (!Number.isSafeInteger(customAmount) || customAmount < 1) {
    pageMessage.hidden = false;
    pageMessage.textContent = 'Enter a valid whole-naira amount.';
    return;
  }
  openCheckout(customAmount);
});
document.querySelector('#topup-close').addEventListener('click', () => dialog.close());

receiptInput.addEventListener('change', () => {
  receiptUrl = '';
  submitButton.disabled = true;
  uploadButton.disabled = !receiptInput.files?.[0];
  const file = receiptInput.files?.[0];
  if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
    receiptInput.value = '';
    uploadButton.disabled = true;
    message.textContent = 'Choose an image no larger than 5 MB.';
  } else message.textContent = '';
});

uploadButton.addEventListener('click', async () => {
  const file = receiptInput.files?.[0];
  if (!file) return;
  uploadButton.disabled = true;
  uploadButton.textContent = 'UPLOADING…';
  try {
    const body = new FormData();
    body.append('image', file);
    const response = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${await idToken()}` }, body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Receipt upload failed.');
    receiptUrl = result.url;
    message.textContent = 'Receipt uploaded. Confirm payment to submit.';
    updateSubmitState();
  } catch (error) {
    message.textContent = error.message || 'Receipt upload failed.';
    uploadButton.disabled = false;
  } finally {
    uploadButton.textContent = 'UPLOAD RECEIPT';
  }
});

document.querySelector('#topup-confirm').addEventListener('change', updateSubmitState);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!receiptUrl || !document.querySelector('#topup-confirm').checked || !amount) return;
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/topup-request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, receiptUrl }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Your top-up request could not be submitted.');
    form.hidden = true;
    document.querySelector('#topup-bank-details').hidden = true;
    document.querySelector('#topup-dialog h2').textContent = 'TOP-UP REQUEST SENT';
    message.textContent = 'Topup request sent, awaiting admin approval';
  } catch (error) {
    message.textContent = error.message || 'Your top-up request could not be submitted.';
    updateSubmitState();
  }
});

function openCheckout(value) {
  amount = value;
  receiptUrl = '';
  form.reset();
  form.hidden = false;
  document.querySelector('#topup-bank-details').hidden = false;
  document.querySelector('#topup-dialog h2').innerHTML = `PAY <em id="topup-amount">₦${amount.toLocaleString('en-NG')}</em>`;
  message.textContent = '';
  uploadButton.disabled = true;
  submitButton.disabled = true;
  dialog.showModal();
}

function updateSubmitState() {
  submitButton.disabled = !(receiptUrl && document.querySelector('#topup-confirm').checked);
}

function renderBankDetails(info) {
  const box = document.querySelector('#topup-bank-details');
  const fields = [['BANK NAME', info.bankName], ['ACCOUNT NAME', info.accountName], ['ACCOUNT NUMBER', info.accountNumber]];
  box.innerHTML = fields.map(([label, value]) => value ? `<div class="bank-row"><span><small>${label}</small><b>${escapeText(value)}</b></span><button type="button" class="copy-button" data-copy="${escapeAttribute(value)}" aria-label="Copy ${label.toLowerCase()}">COPY</button></div>` : '').join('') || '<p class="panel-intro">Admin has not added bank account details yet.</p>';
  box.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'COPIED'; }
    catch { button.textContent = 'COPY FAILED'; }
  }));
}

function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}
function escapeAttribute(value) { return escapeText(value).replaceAll('"', '&quot;'); }
