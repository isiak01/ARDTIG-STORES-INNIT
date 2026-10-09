import { requireMemberSession } from './member-session.js';

const params = new URLSearchParams(location.search);
const accountId = params.get('id');
const accountType = params.get('type');
const collectionByType = { freefire: 'freefire_accounts', cod: 'cod_accounts', efootball: 'efootball_accounts', diamonds: 'diamonds' };
const panel = document.querySelector('#wallet-checkout-panel');
const message = document.querySelector('#wallet-checkout-message');
const payButton = document.querySelector('#wallet-pay-button');
const session = await requireMemberSession();
let account;
let walletBalance = 0;
let stopBalanceListener;

if (session) await loadCheckout();

async function loadCheckout() {
  try {
    if (!accountId || !collectionByType[accountType]) throw new Error('The listing link is incomplete.');
    const { doc, getDoc, onSnapshot } = session.firebase;
    const listing = await getDoc(doc(session.db, collectionByType[accountType], accountId));
    if (!listing.exists() || listing.data().status !== 'available') throw new Error('This listing is no longer available.');
    account = listing.data();
    document.querySelector('#wallet-listing-name').textContent = account.prime || (accountType === 'diamonds' ? `${Number(account.diamonds || 0).toLocaleString()} diamonds` : `${accountType.toUpperCase()} account`);
    document.querySelector('#wallet-price').textContent = formatNaira(account.price);
    document.querySelector('#wallet-manual-link').href = `/pages/payment.html?id=${encodeURIComponent(accountId)}&type=${encodeURIComponent(accountType)}`;
    if (accountType === 'diamonds') document.querySelector('#wallet-diamond-fields').hidden = false;
    document.querySelector('#wallet-player-uid').addEventListener('input', updatePayState);
    document.querySelector('#wallet-game-name').addEventListener('input', updatePayState);
    stopBalanceListener = onSnapshot(doc(session.db, 'users', session.user.uid), (profile) => {
      walletBalance = Number(profile.exists() ? profile.data().walletBalance || 0 : 0);
      document.querySelector('#wallet-checkout-balance').textContent = formatNaira(walletBalance);
      const insufficient = walletBalance < Number(account.price || 0);
      document.querySelector('#wallet-insufficient').hidden = !insufficient;
      document.querySelector('#wallet-alternatives').hidden = !insufficient;
      updatePayState();
    });
    panel.hidden = false;
  } catch (error) {
    document.querySelector('[data-page-message]').textContent = error.message || 'Wallet checkout could not load.';
  }
}

function updatePayState() {
  const enough = account && walletBalance >= Number(account.price || 0);
  const diamondDetailsValid = accountType !== 'diamonds' || (
    document.querySelector('#wallet-player-uid').value.trim() && document.querySelector('#wallet-game-name').value.trim()
  );
  payButton.disabled = !(enough && diamondDetailsValid);
  payButton.textContent = `PAY ${account ? formatNaira(account.price) : ''} WITH BALANCE`;
}

document.querySelector('#wallet-purchase-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!account || walletBalance < Number(account.price || 0)) return;
  payButton.disabled = true;
  message.textContent = 'Processing wallet payment…';
  try {
    const payload = { accountId, accountType };
    if (accountType === 'diamonds') {
      payload.uid = document.querySelector('#wallet-player-uid').value.trim();
      payload.gameName = document.querySelector('#wallet-game-name').value.trim();
    }
    const response = await fetch('/api/wallet-purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await session.user.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Wallet payment could not be completed.');
    stopBalanceListener?.();
    panel.hidden = true;
    await showPurchase(result.walletBalance);
  } catch (error) {
    message.textContent = error.message || 'Wallet payment could not be completed.';
    updatePayState();
  }
});

async function showPurchase(newBalance) {
  const success = document.querySelector('#wallet-purchase-success');
  success.hidden = false;
  if (accountType === 'diamonds') {
    success.innerHTML = `<h2>PAYMENT SUCCESSFUL!</h2><span class="diamond-order-status">IN PROGRESS</span><p>Your payment was successful. Your diamonds will appear in your account soon.</p><p>Remaining balance: <strong>${formatNaira(newBalance)}</strong></p><a class="form-button" href="/pages/myaccounts.html">MY ORDERS</a>`;
    return;
  }
  success.innerHTML = `<h2>PAYMENT APPROVED</h2><p>Your wallet payment succeeded. Remaining balance: <strong>${formatNaira(newBalance)}</strong></p><p>Account details are available in My Accounts.</p><a class="form-button" href="/pages/myaccounts.html">MY ACCOUNTS</a>`;
  const purchaseId = `${session.user.uid}_${accountId}`;
  const { doc, getDoc } = session.firebase;
  try {
    const secret = await getDoc(doc(session.db, 'account_secrets', purchaseId));
    if (!secret.exists()) return;
    const details = secret.data();
    success.innerHTML = `<h2>PAYMENT APPROVED</h2><p>Your wallet payment succeeded. Remaining balance: <strong>${formatNaira(newBalance)}</strong></p><div class="wallet-delivery"><div><span>EMAIL</span><b>${escapeText(details.email)}</b></div><div><span>PASSWORD</span><b>${escapeText(details.password)}</b></div></div><a class="form-button" href="/pages/myaccounts.html">MY ACCOUNTS</a>`;
  } catch {
    return;
  }
}

function formatNaira(value) {
  return `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}
