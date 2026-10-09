import { getFirebase } from './firebase.js';

export function showBannedScreen() {
  if (document.querySelector('.banned-screen')) return;
  const screen = document.createElement('main');
  screen.className = 'banned-screen';
  screen.setAttribute('role', 'alert');
  screen.innerHTML = '<section class="banned-panel"><h1>ACCOUNT BANNED</h1><p>This account was banned due to negative activities. You cannot access ARDTIG STORE.</p><button type="button">LOG OUT</button></section>';
  document.body.replaceChildren(screen);
  screen.querySelector('button').addEventListener('click', async () => {
    try {
      const { auth, signOut } = await getFirebase();
      await signOut(auth);
    } finally {
      location.replace('/');
    }
  });
}
