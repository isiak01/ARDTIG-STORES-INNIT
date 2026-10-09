import { initializeTheme } from './theme.js';
import { initializeNavigation } from './navbar.js';
import { initializeStorefront } from './store.js';
import { registerServiceWorker } from './pwa.js';
import { currentUser, getFirebase } from './firebase.js';
import { createVerifiedBadge } from './badges.js';

initializeTheme();
initializeNavigation();
initializeStorefront();
registerServiceWorker();

document.querySelector('#year').textContent = new Date().getFullYear();
showHeroUsername();

async function showHeroUsername() {
	const usernameElement = document.querySelector('#hero-username');
	try {
		const user = await currentUser();
		if (!user || !usernameElement) return;
		const { db, doc, getDoc } = await getFirebase();
		const profile = await getDoc(doc(db, 'users', user.uid));
		const username = profile.exists() ? profile.data().username : '';
		if (typeof username === 'string' && username.trim()) {
			usernameElement.textContent = `${username.trim()}!!`;
			if (profile.exists() && profile.data().role === 'admin') usernameElement.append(createVerifiedBadge());
		}
	} catch (error) {
		console.warn('Hero username is unavailable:', error);
	}
}
