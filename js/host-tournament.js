import { requireAdmin } from './admin-guard.js';

const form = document.querySelector('#tournament-form');
const message = document.querySelector('#host-message');
const access = await requireAdmin();

if (access) form.addEventListener('submit', submitTournament);

async function submitTournament(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  message.hidden = false;
  message.textContent = 'Uploading image…';
  try {
    const file = form.elements.namedItem('image').files[0];
    const token = await access.user.getIdToken();
    const imageBody = new FormData();
    imageBody.append('image', file);
    const imageResponse = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: imageBody });
    const imageResult = await imageResponse.json().catch(() => ({}));
    if (!imageResponse.ok) throw new Error(imageResult.error || 'Tournament image upload failed.');
    const payload = {
      game: form.elements.namedItem('game').value,
      map: form.elements.namedItem('map').value.trim(),
      playersNeeded: Number(form.elements.namedItem('playersNeeded').value),
      matchType: form.elements.namedItem('matchType').value.trim(),
      teamSize: form.elements.namedItem('teamSize').value,
      matchTime: form.elements.namedItem('matchTime').value,
      price: Number(form.elements.namedItem('price').value),
      priceType: form.elements.namedItem('priceType').value.trim(),
      imageUrl: imageResult.url,
    };
    message.textContent = 'Posting tournament and notifying members…';
    const response = await fetch('/api/tournament', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The tournament could not be posted.');
    form.reset();
    message.textContent = 'Tournament posted. Members have been notified.';
  } catch (error) {
    message.textContent = error.message || 'The tournament could not be posted.';
  } finally {
    button.disabled = false;
  }
}
