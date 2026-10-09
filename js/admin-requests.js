import { requireAdmin } from './admin-guard.js';
import { createVerifiedBadge } from './badges.js';

const collections = { freefire: 'freefire_accounts', cod: 'cod_accounts', efootball: 'efootball_accounts', diamonds: 'diamonds' };
const panel = document.querySelector('#requests-list');
const message = document.querySelector('#admin-message');
let access;
let activeType = 'freefire';
let activeStatus = 'pending';
let statusFilter;

access = await requireAdmin();
if (access) {
  const topupsTab = document.createElement('button');
  topupsTab.className = 'admin-tab';
  topupsTab.dataset.requestType = 'topups';
  topupsTab.innerHTML = 'TOPUPS <b class="tab-count">0</b>';
  document.querySelector('.admin-tabs').append(topupsTab);
  const transfersTab = document.createElement('button');
  transfersTab.className = 'admin-tab';
  transfersTab.dataset.requestType = 'transfers';
  transfersTab.innerHTML = 'TRANSFERS <b class="tab-count">0</b>';
  document.querySelector('.admin-tabs').append(transfersTab);
  document.querySelectorAll('[data-request-type]').forEach((tab) => tab.addEventListener('click', () => {
    activeType = tab.dataset.requestType;
    document.querySelectorAll('[data-request-type]').forEach((item) => item.classList.toggle('is-active', item === tab));
    loadRequests();
  }));
  statusFilter = document.createElement('select');
  statusFilter.className = 'text-input request-status-select';
  statusFilter.setAttribute('aria-label', 'Filter payment request status');
  statusFilter.innerHTML = '<option value="pending">PENDING</option><option value="approved">APPROVED</option><option value="rejected">REJECTED</option><option value="cancelled">CANCELLED</option>';
  document.querySelector('.admin-tabs').after(statusFilter);
  statusFilter.addEventListener('change', () => { activeStatus = statusFilter.value; loadRequests(); });
  await loadPendingCounts();
  await loadRequests();
}

async function loadPendingCounts() {
  try {
    const { counts } = await fetchAdminReceipts('counts');
    Object.entries(counts).forEach(([type, count]) => {
      const badge = document.querySelector(`[data-request-type="${type}"] .tab-count`);
      if (badge) badge.textContent = String(count);
    });
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Receipt counts could not load.';
  }
}

async function loadRequests() {
  if (!access) return;
  if (activeType === 'diamonds') {
    statusFilter.hidden = true;
    return loadDiamondOrders();
  }
  statusFilter.hidden = false;
  if (activeType === 'topups') return loadTopupRequests();
  if (activeType === 'transfers') return loadTransfers();
  panel.innerHTML = '<p class="loading-state">LOADING REQUESTS…</p>';
  try {
    const { requests } = await fetchAdminReceipts(activeType, activeStatus);
    if (activeStatus === 'pending') document.querySelector(`[data-request-type="${activeType}"] .tab-count`).textContent = String(requests.length);
    if (!requests.length) {
      panel.innerHTML = `<div class="empty-market"><div><span class="stock-label"><i></i> QUEUE CLEAR</span><h3>NO ${activeStatus.toUpperCase()}<br>REQUESTS.</h3></div></div>`;
      return;
    }
    panel.replaceChildren(...requests.map((request) => createRequestCard(request.id, request)));
    panel.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action, button.dataset.requestId)));
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Payment requests could not load.';
  }
}

async function loadTopupRequests() {
  panel.innerHTML = '<p class="loading-state">LOADING TOP-UPS…</p>';
  try {
    const { requests } = await fetchAdminReceipts('topups', activeStatus);
    if (activeStatus === 'pending') document.querySelector('[data-request-type="topups"] .tab-count').textContent = String(requests.length);
    if (!requests.length) {
      panel.innerHTML = `<div class="empty-market"><div><span class="stock-label"><i></i> QUEUE CLEAR</span><h3>NO ${activeStatus.toUpperCase()} TOP-UPS.</h3></div></div>`;
      return;
    }
    panel.replaceChildren();
    requests.sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt));
    requests.forEach((topup) => panel.append(createTopupCard(topup)));
    panel.querySelectorAll('[data-topup-action]').forEach((button) => button.addEventListener('click', () => reviewTopup(button.dataset.topupAction, button.dataset.requestId, button)));
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Top-up requests could not load.';
  }
}

async function loadTransfers() {
  panel.innerHTML = '<p class="loading-state">LOADING TRANSFERS…</p>';
  try {
    const { transfers } = await fetchAdminReceipts('transfers');
    if (!transfers.length) {
      panel.innerHTML = '<div class="empty-market"><div><span class="stock-label"><i></i> ACCOUNT LEDGER</span><h3>NO TRANSFERS YET.</h3></div></div>';
      return;
    }
    panel.replaceChildren();
    transfers.forEach((transfer) => panel.append(createTransferCard(transfer, transfer.id)));
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Transfers could not load.';
  }
}

async function loadDiamondOrders() {
  panel.innerHTML = '<p class="loading-state">LOADING DIAMOND ORDERS…</p>';
  try {
    const { orders, legacyRequests } = await fetchAdminReceipts('diamonds');
    const openOrders = orders.sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt));
    document.querySelector('[data-request-type="diamonds"] .tab-count').textContent = String(openOrders.length + legacyRequests.length);
    if (!openOrders.length && !legacyRequests.length) {
      panel.innerHTML = '<div class="empty-market"><div><span class="stock-label"><i></i> TOP-UP QUEUE CLEAR</span><h3>NO OPEN DIAMOND ORDERS.</h3></div></div>';
      return;
    }
    panel.replaceChildren(...legacyRequests.map((request) => createRequestCard(request.id, request)), ...openOrders.map(createDiamondOrderCard));
    panel.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action, button.dataset.requestId)));
    panel.querySelectorAll('[data-diamond-action]').forEach((button) => button.addEventListener('click', () => handleDiamondAction(button.dataset.diamondAction, button.dataset.orderId, button)));
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'Diamond orders could not load.';
  }
}

async function fetchAdminReceipts(category, status) {
  const url = new URL('/api/admin-receipts', location.origin);
  url.searchParams.set('category', category);
  if (status) url.searchParams.set('status', status);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await access.user.getIdToken()}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Receipts could not be loaded.');
  return result;
}

function createDiamondOrderCard(order) {
  const card = document.createElement('article');
  card.className = 'request-card diamond-order-card';
  const paid = order.paymentStatus === 'successful';
  const paymentLabel = order.paymentMethod === 'wallet' ? 'WALLET - PAID' : paid ? 'MANUAL - PAID' : order.paymentStatus === 'rejected' ? 'MANUAL - REJECTED' : 'MANUAL - PENDING';
  const paymentClass = paid ? 'is-paid' : order.paymentStatus === 'rejected' ? 'is-rejected' : 'is-pending';
  const orderLabel = (order.orderStatus || 'pending').replaceAll('_', ' ').toUpperCase();
  const detail = document.createElement('div');
  detail.className = 'diamond-order-heading';
  detail.innerHTML = `<div><b>${safeText(order.username || 'PLAYER')}</b><small>UID ${safeText(order.uidGame || '—')} · ${safeText(order.gameName || '—')}</small></div><span class="diamond-payment-badge ${paymentClass}">${paymentLabel}</span>`;
  const fields = document.createElement('dl');
  fields.className = 'detail-list diamond-order-details';
  fields.innerHTML = `<div><dt>PACKAGE</dt><dd>${safeText(order.package || 'Free Fire diamonds')}</dd></div><div><dt>PRICE</dt><dd>₦${Number(order.price || 0).toLocaleString('en-NG')}</dd></div><div><dt>TIME</dt><dd>${formatDate(order.createdAt)}</dd></div><div><dt>ORDER STATUS</dt><dd>${safeText(orderLabel)}</dd></div>`;
  card.append(detail, fields);
  if (order.paymentMethod === 'wallet') {
    const note = document.createElement('p');
    note.className = 'diamond-order-note';
    note.textContent = 'Payment already successful, balance already deducted. Please top up diamonds for the user.';
    card.append(note);
  } else if (order.receiptUrl) {
    const receipt = document.createElement('a');
    receipt.className = 'diamond-order-receipt';
    receipt.href = safeAttribute(order.receiptUrl);
    receipt.target = '_blank';
    receipt.rel = 'noopener';
    receipt.innerHTML = `<img src="${safeAttribute(order.receiptUrl)}" alt="Diamond order payment receipt" loading="lazy"><span>VIEW RECEIPT</span>`;
    card.append(receipt);
  }
  const actions = document.createElement('div');
  actions.className = 'request-actions';
  if (order.paymentMethod === 'manual' && order.paymentStatus === 'pending') {
    actions.innerHTML = `<button class="form-button approve-button" data-diamond-action="approve" data-order-id="${safeAttribute(order.id)}">APPROVE PAYMENT</button><button class="form-button reject-button" data-diamond-action="reject" data-order-id="${safeAttribute(order.id)}">REJECT PAYMENT</button>`;
  } else if (paid && order.orderStatus === 'in_progress') {
    actions.innerHTML = `<button class="form-button approve-button" data-diamond-action="complete" data-order-id="${safeAttribute(order.id)}">SUCCESSFUL TOPUP</button><button class="form-button reject-button" data-diamond-action="failed" data-order-id="${safeAttribute(order.id)}">FAILED</button>`;
  }
  if (actions.childElementCount) card.append(actions);
  return card;
}

async function handleDiamondAction(action, orderId, button) {
  const prompts = {
    approve: 'Confirm the manual payment and start this diamond top-up?',
    reject: 'Reject this manual diamond payment?',
    complete: 'Confirm that the diamonds have been topped up?',
    failed: 'Mark this diamond top-up as failed?',
  };
  if (!window.confirm(prompts[action])) return;
  const card = button.closest('.diamond-order-card');
  card.querySelectorAll('button').forEach((item) => { item.disabled = true; });
  try {
    const review = action === 'approve' || action === 'reject';
    const response = await fetch(review ? '/api/diamond-order-review' : '/api/diamond-order-finish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await access.user.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, decision: review ? action : action }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The diamond order could not be updated.');
    await loadDiamondOrders();
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'The diamond order could not be updated.';
    card.querySelectorAll('button').forEach((item) => { item.disabled = false; });
  }
}

function createTopupCard(topup) {
  const card = document.createElement('article');
  card.className = 'request-card topup-request-card';
  const receipt = document.createElement('a');
  receipt.href = safeAttribute(topup.receiptUrl);
  receipt.target = '_blank';
  receipt.rel = 'noopener';
  receipt.className = 'topup-receipt-link';
  const image = document.createElement('img');
  image.src = safeAttribute(topup.receiptUrl);
  image.alt = 'Top-up receipt';
  image.loading = 'lazy';
  receipt.append(image);
  const details = document.createElement('div');
  details.className = 'topup-request-details';
  details.innerHTML = `<b>${safeText(topup.username || 'PLAYER')}</b><strong>₦${Number(topup.amount || 0).toLocaleString('en-NG')}</strong><small>${formatDate(topup.createdAt)}</small><span class="purchase-status status-${safeAttribute(topup.status)}">${safeText((topup.status || 'pending').toUpperCase())}</span>`;
  if (topup.userRole === 'admin') details.querySelector('b').append(createVerifiedBadge());
  const row = document.createElement('div');
  row.className = 'topup-request-layout';
  row.append(receipt, details);
  card.append(row);
  if (topup.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'request-actions';
    actions.innerHTML = `<button class="form-button approve-button" data-topup-action="approve" data-request-id="${safeAttribute(topup.id)}">APPROVE</button><button class="form-button reject-button" data-topup-action="reject" data-request-id="${safeAttribute(topup.id)}">REJECT</button>`;
    card.append(actions);
  }
  return card;
}

async function reviewTopup(decision, requestId, button) {
  const verb = decision === 'approve' ? 'Approve this top-up and add the amount to the user wallet?' : 'Reject this top-up request?';
  if (!window.confirm(verb)) return;
  const card = button.closest('.topup-request-card');
  card.querySelectorAll('button').forEach((item) => { item.disabled = true; });
  try {
    const response = await fetch('/api/topup-review', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await access.user.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, decision }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The top-up could not be reviewed.');
    await loadTopupRequests();
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || 'The top-up could not be reviewed.';
    card.querySelectorAll('button').forEach((item) => { item.disabled = false; });
  }
}

function createRequestCard(id, request) {
  const card = document.createElement('article');
  card.className = 'request-card';
  card.dataset.id = id;
  const actions = request.status === 'pending' ? `<button class="form-button approve-button" data-action="approve" data-request-id="${safeAttribute(id)}">APPROVE</button><button class="form-button reject-button" data-action="reject" data-request-id="${safeAttribute(id)}">REJECT</button>` : request.status === 'approved' ? `<button class="form-button reject-button" data-action="cancel" data-request-id="${safeAttribute(id)}">CANCEL APPROVAL</button>` : '';
  card.innerHTML = `<div class="request-user"><img src="${safeAttribute(request.userPhoto || '/logo.png')}" alt=""><div><b>${safeText(request.username || 'PLAYER')}</b><small>${safeText((request.accountType || 'ACCOUNT').toUpperCase())} · ${formatDate(request.createdAt)}</small></div></div><dl class="detail-list"><div><dt>AMOUNT</dt><dd>₦${Number(request.price || 0).toLocaleString('en-NG')}</dd></div>${request.uid ? `<div><dt>GAME UID</dt><dd>${safeText(request.uid)}</dd></div>` : ''}${request.gameName ? `<div><dt>GAME NAME</dt><dd>${safeText(request.gameName)}</dd></div>` : ''}</dl><div class="request-links"><a href="${safeAttribute(request.receiptURL)}" target="_blank" rel="noopener">VIEW RECEIPT ↗</a><a href="/pages/view.html?id=${encodeURIComponent(request.accountId)}&type=${encodeURIComponent(request.accountType)}" target="_blank" rel="noopener">VIEW LISTING ↗</a></div><div class="request-actions">${actions}</div>`;
  if (request.userRole === 'admin') {
    card.querySelector('.request-user b').append(createVerifiedBadge());
    const photo = card.querySelector('.request-user img');
    const avatar = document.createElement('span');
    avatar.className = 'request-avatar';
    photo.replaceWith(avatar);
    avatar.append(photo, createVerifiedBadge({ avatar: true }));
  }
  return card;
}

async function handleAction(action, requestId) {
  const { db, doc, getDoc, updateDoc, setDoc, addDoc, collection, serverTimestamp, writeBatch } = access.firebase;
  const requestRef = doc(db, 'payment_requests', requestId);
  const requestSnapshot = await getDoc(requestRef);
  if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'pending') return loadRequests();
  const request = requestSnapshot.data();
  if (action === 'cancel') {
    if (!window.confirm('Cancel this approval? The listing will return to the available market.')) return;
    const batch = writeBatch(db);
    batch.update(requestRef, { status: 'cancelled', reviewedAt: serverTimestamp() });
    if (request.accountType !== 'diamonds') {
      batch.update(doc(db, collections[request.accountType], request.accountId), { status: 'available' });
      batch.delete(doc(db, 'user_purchases', `${request.userId}_${request.accountId}`));
      batch.delete(doc(db, 'account_secrets', `${request.userId}_${request.accountId}`));
      batch.delete(doc(db, 'sold_accounts', request.accountId));
    }
    await batch.commit();
    await addNotification(request.userId, 'Approval cancelled', 'Your purchase approval was cancelled. Please contact the store if you need help.');
    return loadRequests();
  }
  if (action === 'reject') {
    const reason = window.prompt('Reason for rejecting this payment request:');
    if (!reason?.trim()) return;
    await updateDoc(requestRef, { status: 'rejected', rejectionReason: reason.trim(), reviewedAt: serverTimestamp() });
    await addNotification(request.userId, 'Payment request rejected', `Your account request was rejected. Reason: ${reason.trim()}`);
    return loadRequests();
  }
  if (!await askApprovalConfirmation()) return;
  const accountRef = doc(db, collections[request.accountType], request.accountId);
  const accountSnapshot = await getDoc(accountRef);
  if (!accountSnapshot.exists()) throw new Error('The requested listing no longer exists.');
  const batch = writeBatch(db);
  batch.update(requestRef, { status: 'approved', reviewedAt: serverTimestamp() });
  if (request.accountType !== 'diamonds') {
    const account = accountSnapshot.data();
    const purchaseId = `${request.userId}_${request.accountId}`;
    const secretRef = doc(db, 'account_secrets', request.accountId);
    const secretSnapshot = await getDoc(secretRef);
    if (!secretSnapshot.exists()) throw new Error('Private delivery details are missing; approval stopped.');
    batch.set(doc(db, 'user_purchases', purchaseId), {
      userId: request.userId,
      accountId: request.accountId,
      accountType: request.accountType,
      status: 'approved',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'account_secrets', purchaseId), {
      ...secretSnapshot.data(), uid: request.userId, accountId: request.accountId,
    });
    batch.set(doc(db, 'accountLogs', purchaseId), {
      uid: request.userId,
      accountId: request.accountId,
      accountType: request.accountType,
      status: 'approved',
      createdAt: serverTimestamp(),
      ...secretSnapshot.data(),
    });
    batch.update(accountRef, { status: 'sold' });
    batch.set(doc(db, 'sold_accounts', request.accountId), {
      ...account,
      id: request.accountId,
      accountType: request.accountType,
      status: 'sold',
      soldAt: serverTimestamp(),
    });
  }
  await batch.commit();
  await addNotification(request.userId, 'Payment approved', request.accountType === 'diamonds' ? 'Your diamonds request was approved. Check your Free Fire account for delivery.' : 'Your payment was approved. Go to My Accounts to view your account details.');
  await loadRequests();
}

function askApprovalConfirmation() {
  const dialog = document.createElement('dialog');
  dialog.className = 'login-dialog approval-dialog';
  dialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Close">×</button><p class="eyebrow">PAYMENT REVIEW</p><h2>CONFIRM <em>PAYMENT.</em></h2><p>Have you verified the transfer? Account details will be sent to the purchaser.</p><label class="terms-check"><input type="checkbox"><span>I confirm that the exact payment has been received and verified.</span></label><div class="request-actions"><form method="dialog"><button class="form-button secondary" value="cancel">GO BACK</button><button class="form-button approve-button" value="approved" disabled>APPROVE &amp; DELIVER</button></form></div>';
  const checkbox = dialog.querySelector('input[type="checkbox"]');
  const confirmButton = dialog.querySelector('button[value="approved"]');
  checkbox.addEventListener('change', () => { confirmButton.disabled = !checkbox.checked; });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close('cancel'));
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { const approved = dialog.returnValue === 'approved'; dialog.remove(); resolve(approved); }, { once: true });
    dialog.showModal();
  });
}

async function addNotification(userId, title, text) {
  const { db, collection, addDoc, serverTimestamp } = access.firebase;
  await addDoc(collection(db, 'notifications', userId, 'items'), { title, message: text, read: false, createdAt: serverTimestamp() });
}
function createTransferCard(transfer, id) {
  const card = document.createElement('article');
  card.className = 'request-card';
  card.innerHTML = `
    <div class="request-user">
      <div><b>${safeText(transfer.fromUsername || 'PLAYER')}</b><small>FROM</small></div>
    </div>
    <dl class="detail-list">
      <div><dt>TO</dt><dd>${safeText(transfer.toUsername || 'PLAYER')}</dd></div>
      <div><dt>AMOUNT</dt><dd>₦${Number(transfer.amount || 0).toLocaleString('en-NG')}</dd></div>
      <div><dt>FEE</dt><dd>₦${Number(transfer.fee || 0).toLocaleString('en-NG')}</dd></div>
      <div><dt>TIME</dt><dd>${formatDate(transfer.createdAt)}</dd></div>
    </dl>
    <div class="request-links"><span class="purchase-status status-approved">${safeText((transfer.status || 'completed').toUpperCase())}</span></div>
  `;
  return card;
}

function safeText(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; }
function safeAttribute(value) { return safeText(value).replaceAll('"', '&quot;'); }
function dateValue(value) { return typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : Date.parse(value || '') || 0; }
function formatDate(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'DATE PENDING';
}
