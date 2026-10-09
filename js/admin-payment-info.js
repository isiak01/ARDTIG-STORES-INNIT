import { requireAdmin } from './admin-guard.js';

const result = await requireAdmin();
const form = document.querySelector('#payment-info-form');
const message = document.querySelector('#admin-message');

if (result) {
  const { db, firebase } = result;
  const reference = firebase.doc(db, 'config', 'paymentInfo');
  try {
    const info = await firebase.getDoc(reference);
    if (info.exists()) {
      for (const field of ['bankName', 'accountName', 'accountNumber']) form.elements.namedItem(field).value = info.data()[field] || '';
    }
  } catch (error) { showMessage(error.message); }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await firebase.setDoc(reference, {
        bankName: form.elements.namedItem('bankName').value.trim(),
        accountName: form.elements.namedItem('accountName').value.trim(),
        accountNumber: form.elements.namedItem('accountNumber').value.trim(),
        updatedAt: firebase.serverTimestamp(),
      });
      showMessage('Payment details saved.');
    } catch (error) { showMessage(error.message); }
    finally { button.disabled = false; }
  });
}
function showMessage(text) { message.hidden = false; message.textContent = text; }
