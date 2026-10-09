import { requireAdmin } from './admin-guard.js';

const settings = {
  freefire: { collection: 'freefire_accounts', secret: true, fields: ['prime', 'level', 'evoGuns', 'heroicCS', 'heroicBR', 'booyahPass', 'diamonds', 'price'] },
  cod: { collection: 'cod_accounts', secret: true, fields: ['level', 'mythicGuns', 'emotes', 'skins', 'cp', 'price'] },
  efootball: { collection: 'efootball_accounts', secret: true, fields: ['level', 'players', 'price'] },
  diamonds: { collection: 'diamonds', secret: false, fields: ['diamonds', 'price', 'packageName'] },
};
const form = document.querySelector('#post-form');
const category = document.body.dataset.postCategory;
const config = settings[category];
const status = document.querySelector('#admin-message');

if (config) {
  if (category === 'freefire' || category === 'diamonds') {
    const diamondsLabel = form.elements.namedItem('diamonds')?.closest('.admin-field')?.querySelector('.field-label');
    if (diamondsLabel) diamondsLabel.textContent = 'AVAILABLE DIAMONDS';
  }
  if (category === 'freefire') {
    const booyahLabel = form.elements.namedItem('booyahPass')?.closest('.admin-field')?.querySelector('.field-label');
    if (booyahLabel) booyahLabel.textContent = 'THIS MONTH BOOYAH PASS';
  }
  const levelSelect = form.elements.namedItem('level');
  if (levelSelect) {
    for (let level = 1; level <= 100; level += 1) levelSelect.add(new Option(String(level), String(level)));
  }
  document.querySelector('#prime')?.addEventListener('input', (event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); });
  document.querySelector('#listing-images')?.addEventListener('change', (event) => {
    const { files } = event.currentTarget;
    if (files.length > 10 || files.length < 1) {
      event.currentTarget.setCustomValidity('Choose between 1 and 10 images.');
      event.currentTarget.reportValidity();
    } else event.currentTarget.setCustomValidity('');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const authorization = await requireAdmin();
    if (!authorization) return;
    const { db, firebase } = authorization;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.hidden = false;
    status.textContent = 'Saving listing…';
    try {
      const publicData = { status: 'available', likes: 0, likesBy: [], createdAt: firebase.serverTimestamp() };
      for (const field of config.fields) {
        const input = form.elements.namedItem(field);
        if (!input) continue;
        publicData[field] = input.type === 'number' ? Number(input.value) : input.value.trim();
      }
      if (category === 'freefire') publicData.prime = publicData.prime.toUpperCase();
      if (category === 'diamonds') {
        const [image] = form.elements.namedItem('listing-images').files;
        publicData.photo = await uploadFile(image, status);
      } else {
        const images = [...form.elements.namedItem('listing-images').files];
        publicData.images = [];
        for (let index = 0; index < images.length; index += 1) {
          status.textContent = `Uploading image ${index + 1} of ${images.length}…`;
          publicData.images.push(await uploadFile(images[index]));
        }
      }
      const accountRef = firebase.doc(firebase.collection(db, config.collection));
      const batch = firebase.writeBatch(db);
      batch.set(accountRef, publicData);
      if (config.secret) {
        batch.set(firebase.doc(db, 'account_secrets', accountRef.id), {
          accountId: accountRef.id,
          email: form.elements.namedItem('accountEmail').value.trim(),
          password: form.elements.namedItem('accountPassword').value,
          createdAt: firebase.serverTimestamp(),
        });
      }
      await batch.commit();
      form.reset();
      status.textContent = 'Listing published.';
    } catch (error) {
      status.textContent = error.message || 'Listing could not be saved.';
    } finally {
      submit.disabled = false;
    }
  });
}

async function uploadFile(file, output = status) {
  const token = await (await import('./firebase.js')).idToken();
  const body = new FormData();
  body.append('image', file);
  const response = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Image upload failed.');
  if (output) output.textContent = 'Image uploaded.';
  return result.url;
}
