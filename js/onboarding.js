import { getFirebase, currentUser, idToken } from './firebase.js';

const steps = [...document.querySelectorAll('[data-onboarding-step]')];
const form = document.querySelector('#onboarding-form');
const usernameInput = document.querySelector('#username');
const usernameStatus = document.querySelector('#username-status');
const usernameNext = document.querySelector('#username-next');
const photoNext = document.querySelector('#photo-next');
const termsInput = document.querySelector('#terms-accepted');
const finishButton = document.querySelector('#finish-onboarding');
const photoFile = document.querySelector('#profile-photo');
const preview = document.querySelector('#profile-preview');
const feedback = document.querySelector('#onboarding-message');
let signedInUser;
let photoURL = '';
let selectedUsername = '';
let debounceTimer;

try {
  signedInUser = await currentUser();
  if (!signedInUser) location.replace('/pages/auth.html');
} catch (error) {
  showMessage(error.message);
}

usernameInput.addEventListener('input', () => {
  window.clearTimeout(debounceTimer);
  const username = usernameInput.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  usernameInput.value = username;
  selectedUsername = '';
  usernameNext.disabled = true;
  usernameStatus.textContent = username.length < 3 ? 'Use at least 3 letters or numbers.' : 'Checking availability…';
  usernameStatus.className = 'field-note';
  if (username.length < 3) return;
  debounceTimer = window.setTimeout(() => checkUsername(username), 500);
});

async function checkUsername(username) {
  usernameStatus.className = 'field-note is-loading';
  try {
    const token = await idToken();
    const response = await fetch('/api/check-username', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not check this username.');
    selectedUsername = result.available ? username : '';
    usernameStatus.textContent = result.available ? 'Username is available' : 'Username is taken';
    usernameStatus.className = `field-note ${result.available ? 'is-success' : 'is-error'}`;
    usernameNext.disabled = !result.available;
  } catch (error) {
    usernameStatus.textContent = error.message;
    usernameStatus.className = 'field-note is-error';
  }
}

document.querySelector('#suggest-username').addEventListener('click', () => {
  const base = (signedInUser?.displayName || 'player').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 9) || 'player';
  usernameInput.value = `${base}${Math.floor(100 + Math.random() * 9000)}`;
  usernameInput.dispatchEvent(new Event('input'));
});

usernameNext.addEventListener('click', () => showStep(2));
photoFile.addEventListener('change', () => {
  const file = photoFile.files?.[0];
  photoNext.disabled = true;
  photoURL = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showMessage('Choose a JPG, PNG, or WEBP image no larger than 5 MB.');
    photoFile.value = '';
    return;
  }
  preview.src = URL.createObjectURL(file);
  document.querySelector('#upload-photo').disabled = false;
});

document.querySelector('#upload-photo').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const file = photoFile.files?.[0];
  if (!file) return;
  button.disabled = true;
  button.textContent = 'UPLOADING…';
  try {
    const token = await idToken();
    const data = new FormData();
    data.append('image', file);
    const response = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    photoURL = result.url;
    photoNext.disabled = false;
    showMessage('Profile photo uploaded.');
  } catch (error) {
    showMessage(error.message);
    button.disabled = false;
  } finally {
    button.textContent = 'UPLOAD PHOTO';
  }
});

photoNext.addEventListener('click', () => showStep(3));
document.querySelectorAll('[data-back-step]').forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.backStep))));
termsInput.addEventListener('change', () => { finishButton.disabled = !termsInput.checked; });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signedInUser || !selectedUsername || !photoURL || !termsInput.checked) return;
  finishButton.disabled = true;
  try {
    const { db, doc, runTransaction, serverTimestamp } = await getFirebase();
    const userRef = doc(db, 'users', signedInUser.uid);
    const usernameRef = doc(db, 'usernames', selectedUsername);
    await runTransaction(db, async (transaction) => {
      if ((await transaction.get(usernameRef)).exists()) throw new Error('That username was just taken. Choose another.');
      transaction.set(usernameRef, { uid: signedInUser.uid, createdAt: serverTimestamp() });
      transaction.set(userRef, {
        uid: signedInUser.uid,
        email: signedInUser.email || '',
        username: selectedUsername,
        photoURL,
        role: 'user',
        walletBalance: 0,
        totalTopups: 0,
        banned: false,
        createdAt: serverTimestamp(),
      });
    });
    const token = await signedInUser.getIdToken();
    await fetch('/api/member-sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const requestedReturn = new URLSearchParams(location.search).get('return');
    const safeReturn = requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : '/';
    location.assign(safeReturn);
  } catch (error) {
    showMessage(error.message);
    finishButton.disabled = !termsInput.checked;
  }
});

function showStep(step) {
  steps.forEach((panel) => {
    const active = Number(panel.dataset.onboardingStep) === step;
    panel.hidden = !active;
    panel.classList.toggle('is-current', active);
  });
  document.querySelectorAll('[data-step-indicator]').forEach((item) => item.classList.toggle('is-current', Number(item.dataset.stepIndicator) === step));
}

function showMessage(text) {
  feedback.textContent = text;
  feedback.hidden = !text;
}
