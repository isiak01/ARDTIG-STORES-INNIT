import { requireMemberSession } from './member-session.js';
import { idToken } from './firebase.js';

const session = await requireMemberSession();
const searchInput = document.querySelector('#help-search');
const resultsBox = document.querySelector('#help-results');
const messageBox = document.querySelector('#help-message');
const dialog = document.querySelector('#help-transfer-dialog');
const transferTitle = document.querySelector('#transfer-title');
const transferSummary = document.querySelector('#transfer-summary');
const transferAmount = document.querySelector('#transfer-amount');
const transferTotal = document.querySelector('#transfer-total');
const transferRecipient = document.querySelector('#transfer-recipient');
const transferConfirm = document.querySelector('#transfer-confirm');
const transferWarning = document.querySelector('#transfer-warning');
const transferSend = document.querySelector('#transfer-send');
const transferCancel = document.querySelector('#transfer-cancel');
const transferFee = 100;
let activeRecipient = null;
let walletBalance = 0;
let searchTimer = null;

if (session) {
  const { db, doc, getDoc, onSnapshot } = session.firebase;
  const profilePromise = getDoc(doc(db, 'users', session.user.uid));
  onSnapshot(doc(db, 'users', session.user.uid), (snapshot) => {
    walletBalance = Number(snapshot.exists() ? snapshot.data().walletBalance || 0 : 0);
    if (activeRecipient) updateTransferFormState();
  });
  await profilePromise;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => runUserSearch(searchInput.value), 300);
  });
  transferAmount.addEventListener('input', updateTransferFormState);
  transferConfirm.addEventListener('change', updateTransferFormState);
  transferCancel.addEventListener('click', () => dialog.close());
  transferSend.addEventListener('click', submitTransfer);
}

async function runUserSearch(value) {
  const query = value.trim();
  resultsBox.innerHTML = '';
  if (!query || query.length < 2) {
    resultsBox.innerHTML = '<div class="empty-result">No user found</div>';
    return;
  }
  try {
    const response = await fetch(`/api/user-search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${await idToken()}` },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The search could not load.');
    const users = (result.users || []).filter((user) => user.uid !== session.user.uid);
    if (!users.length) {
      resultsBox.innerHTML = '<div class="empty-result">No user found</div>';
      return;
    }
    resultsBox.replaceChildren(...users.map((user) => createUserCard(user)));
  } catch (error) {
    messageBox.textContent = error.message || 'The search could not load.';
    resultsBox.innerHTML = '<div class="empty-result">No user found</div>';
  }
}

function createUserCard(user) {
  const row = document.createElement('article');
  row.className = 'friend-result';
  const avatar = document.createElement('div');
  avatar.className = 'friend-user';
  const thumb = document.createElement('div');
  thumb.className = 'friend-avatar';
  thumb.innerHTML = user.photoURL ? `<img src="${escapeAttribute(user.photoURL)}" alt="${escapeText(user.username || 'PLAYER')} avatar">` : '<span aria-hidden="true">👤</span>';
  const nameWrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'friend-name';
  name.textContent = user.username || 'PLAYER';
  const badge = document.createElement('span');
  badge.className = 'mini-badge';
  badge.textContent = '✓';
  badge.title = 'Verified user';
  nameWrap.append(name, user.role === 'admin' ? badge : null);
  avatar.append(thumb, nameWrap);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'friend-button';
  button.textContent = 'Send Money';
  button.disabled = !!user.banned;
  button.addEventListener('click', () => openTransferModal(user));
  row.append(avatar, button);
  return row;
}

function openTransferModal(user) {
  activeRecipient = user;
  transferTitle.textContent = `Send Money to @${user.username || 'PLAYER'}?`;
  transferSummary.textContent = `Are you sure you want to send money from your wallet balance to '${user.username || 'PLAYER'}'? Note that the amount would be deducted from your balance! Transfer fee: ₦${transferFee.toLocaleString('en-NG')}`;
  transferAmount.value = '';
  transferConfirm.checked = false;
  transferWarning.textContent = '';
  transferTotal.textContent = '₦0.00';
  transferRecipient.textContent = '₦0.00';
  transferSend.disabled = true;
  dialog.showModal();
  updateTransferFormState();
}

function updateTransferFormState() {
  if (!activeRecipient) return;
  const amount = Number(transferAmount.value || 0);
  const total = amount + transferFee;
  const safeAmount = Number.isFinite(amount) && amount >= 100;
  const enoughBalance = walletBalance >= total;
  const sameUser = session.user.uid === activeRecipient.uid;
  const bannedRecipient = activeRecipient.banned === true;

  if (sameUser) {
    transferWarning.textContent = 'You cannot send money to yourself.';
  } else if (bannedRecipient) {
    transferWarning.textContent = 'This user is banned and cannot receive funds.';
  } else if (!safeAmount) {
    transferWarning.textContent = 'Amount must be at least ₦100.';
  } else if (!enoughBalance) {
    transferWarning.textContent = `Insufficient balance. You need ₦${total.toLocaleString('en-NG')} but you have ₦${walletBalance.toLocaleString('en-NG')}. Topup wallet.`;
  } else {
    transferWarning.textContent = '';
  }

  transferTotal.textContent = `₦${total.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  transferRecipient.textContent = `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  transferSend.disabled = !(safeAmount && enoughBalance && transferConfirm.checked && !sameUser && !bannedRecipient);
}

async function submitTransfer() {
  if (!activeRecipient) return;
  const amount = Number(transferAmount.value || 0);
  if (!Number.isFinite(amount) || amount < 100) {
    transferWarning.textContent = 'Amount must be at least ₦100.';
    return;
  }
  if (session.user.uid === activeRecipient.uid) {
    transferWarning.textContent = 'You cannot send money to yourself.';
    return;
  }
  if (walletBalance < amount + transferFee) {
    transferWarning.textContent = `Insufficient balance. You need ₦${(amount + transferFee).toLocaleString('en-NG')} but you have ₦${walletBalance.toLocaleString('en-NG')}. Topup wallet.`;
    return;
  }
  transferSend.disabled = true;
  transferSend.textContent = 'Sending...';
  try {
    const response = await fetch('/api/send-money', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUid: activeRecipient.uid, amount }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Transfer failed, please try again');
    dialog.close();
    messageBox.textContent = `Transfer sent to @${activeRecipient.username}.`;
    messageBox.classList.add('success');
    searchInput.value = '';
    resultsBox.innerHTML = '<div class="empty-result">No user found</div>';
    transferSend.textContent = 'SEND MONEY';
    transferConfirm.checked = false;
    activeRecipient = null;
  } catch (error) {
    transferSend.textContent = 'SEND MONEY';
    transferSend.disabled = false;
    transferWarning.textContent = error.message || 'Transfer failed, please try again';
  }
}

function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', '&quot;');
}
