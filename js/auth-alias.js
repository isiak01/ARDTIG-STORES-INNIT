import { currentUser } from './firebase.js';

const user = await currentUser().catch(() => null);
if (user) location.replace('/');
else location.replace('/pages/auth.html');
