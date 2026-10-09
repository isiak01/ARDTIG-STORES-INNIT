import { getFirebase, currentUser } from './firebase.js';
import { showBannedScreen } from './banned-screen.js';

export async function requireAdmin() {
  try {
    const user = await currentUser();
    if (!user) return location.replace('/pages/auth.html');
    const { db, doc, getDoc } = await getFirebase();
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    if (snapshot.exists() && snapshot.data().banned === true) {
      showBannedScreen();
      return null;
    }
    if (!snapshot.exists() || snapshot.data().role !== 'admin') return location.replace('/');
    document.documentElement.classList.add('admin-authorized');
    return { user, db, firebase: await getFirebase() };
  } catch (error) {
    const message = document.querySelector('#admin-message');
    if (message) {
      message.textContent = error.message || 'Admin access could not be verified.';
      message.hidden = false;
    }
    document.querySelector('main')?.setAttribute('aria-busy', 'true');
    return null;
  }
}
