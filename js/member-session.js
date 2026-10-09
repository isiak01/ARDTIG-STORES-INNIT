import { currentUser, getFirebase } from './firebase.js';
import { showBannedScreen } from './banned-screen.js';

export async function requireMemberSession() {
  const user = await currentUser().catch(() => null);
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    location.replace(`/pages/auth.html?return=${encodeURIComponent(returnTo)}`);
    return null;
  }
  try {
    const { db, doc, getDoc } = await getFirebase();
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    if (!snapshot.exists()) {
      location.replace(`/pages/onboarding.html?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return null;
    }
    const profile = snapshot.data();
    if (profile.banned === true) {
      showBannedScreen();
      return null;
    }
    return { user, profile, db, firebase: await getFirebase() };
  } catch (error) {
    const message = document.querySelector('[data-page-message]');
    if (message) message.textContent = error.message || 'Your account could not be verified.';
    return null;
  }
}
