import { getFirebase, currentUser } from './firebase.js';

const root = document.querySelector('#purchase-list');
const notice = document.querySelector('#page-message');
try {
  const user = await currentUser();
  if (!user) location.replace('/pages/auth.html');
  else await loadPurchases(user);
} catch (error) { showMessage(error.message || 'Your purchases could not load.'); }

async function loadPurchases(user) {
  const { db, collection, query, where, getDocs, doc, getDoc } = await getFirebase();
  const requests = await getDocs(query(collection(db, 'payment_requests'), where('userId', '==', user.uid)));
  if (requests.empty) {
    root.innerHTML = '<div class="empty-market"><div><span class="stock-label"><i></i> MEMBER ACCOUNT</span><h3>YOUR NEXT PURCHASE<br>STARTS HERE.</h3><p>Submitted payment requests and updates will appear here.</p><a class="form-button" href="/">BROWSE THE MARKET →</a></div></div>';
    return;
  }
  root.innerHTML = '';
  for (const requestDoc of requests.docs) {
    const request = requestDoc.data();
    const card = document.createElement('article');
    card.className = 'purchase-card';
    const status = request.status || 'pending';
    card.innerHTML = `<div class="purchase-heading"><div><span class="eyebrow"><span>${escapeText(request.accountType.toUpperCase())}</span> PAYMENT REQUEST</span><h2>₦${Number(request.price || 0).toLocaleString('en-NG')}</h2></div><span class="purchase-status status-${escapeAttribute(status)}">${escapeText(status.toUpperCase())}</span></div><p class="purchase-date">SUBMITTED ${formatDate(request.createdAt?.toDate?.())}</p>${request.rejectionReason ? `<p class="rejection-note">${escapeText(request.rejectionReason)}</p>` : ''}<div class="delivery-slot"></div>`;
    root.append(card);
    if (status === 'approved' && request.accountType !== 'diamonds') {
      const purchaseId = `${user.uid}_${request.accountId}`;
      const [purchase, secret] = await Promise.all([
        getDoc(doc(db, 'user_purchases', purchaseId)),
        getDoc(doc(db, 'account_secrets', purchaseId)),
      ]);
      if (purchase.exists() && purchase.data().status === 'approved' && secret.exists()) {
        const secrets = secret.data();
        card.querySelector('.delivery-slot').innerHTML = `<section class="secret-delivery"><h3>YOUR ACCOUNT DETAILS</h3><div><span>EMAIL</span><b>${escapeText(secrets.email)}</b><button type="button" data-copy="email">COPY</button></div><div><span>PASSWORD</span><b>${escapeText(secrets.password)}</b><button type="button" data-copy="password">COPY</button></div><a href="/pages/view.html?id=${encodeURIComponent(request.accountId)}&type=${encodeURIComponent(request.accountType)}">VIEW LISTING ↗</a></section>`;
        card.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(secrets[button.dataset.copy]); button.textContent = 'COPIED'; }
          catch { button.textContent = 'COPY FAILED'; }
        }));
      }
    } else if (status === 'approved') {
      card.querySelector('.delivery-slot').innerHTML = '<p class="panel-intro">Your diamond request was approved. Check the Free Fire account linked to your UID for delivery.</p>';
    }
  }
}

function showMessage(text) { notice.hidden = false; notice.textContent = text; }
function formatDate(date) { return date instanceof Date ? date.toLocaleString() : 'DATE PENDING'; }
function escapeText(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; }
function escapeAttribute(value) { return escapeText(value).replaceAll('"', '&quot;'); }
