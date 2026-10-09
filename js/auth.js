import { currentUser, getFirebase } from './firebase.js';
import { showBannedScreen } from './banned-screen.js';

const form = document.querySelector('#google-signin');
const message = document.querySelector('#auth-message');
const requestedReturn = new URLSearchParams(location.search).get('return');
const safeReturn = requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : '/';

redirectIfSignedIn();

async function redirectIfSignedIn() {
  const user = await currentUser().catch(() => null);
  if (!user) return;
  try {
    const { db, doc, getDoc } = await getFirebase();
    const profile = await getDoc(doc(db, 'users', user.uid));
    if (profile.exists() && profile.data().banned === true) {
      showBannedScreen();
      return;
    }
    location.replace(profile.exists() ? '/' : '/pages/onboarding.html');
  } catch {
    message.textContent = 'Your account could not be verified. Please try again.';
    message.classList.add('is-error');
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = 'Connecting to Google…';
  message.className = 'form-message';
  try {
    const { auth, provider, signInWithPopup } = await getFirebase();
    const result = await signInWithPopup(auth, provider);
    const { db, doc, getDoc } = await getFirebase();
    const profile = await getDoc(doc(db, 'users', result.user.uid));
    if (profile.exists() && profile.data().banned === true) {
      showBannedScreen();
      return;
    }
    location.assign(profile.exists() ? safeReturn : `/pages/onboarding.html?return=${encodeURIComponent(safeReturn)}`);
    return result;
  } catch (error) {
    message.textContent = error.message || 'Sign-in failed. Please try again.';
    message.classList.add('is-error');
    button.disabled = false;
  }
});
