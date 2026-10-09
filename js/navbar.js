import { getFirebase } from './firebase.js';
import { showBannedScreen } from './banned-screen.js';

export function initializeNavigation() {
  ensureInnerHeader();
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');
  ensureRoleNavigation(nav);
  const wallet = ensureWalletWidget(document.querySelector('.header-actions'));
  const loggedOut = document.querySelector('#header-auth-controls');
  const memberLinks = document.querySelector('#member-links');
  const adminNav = nav.querySelector('.admin-nav-links');
  const notificationButton = document.querySelector('.notification-button');
  const notificationPanel = document.querySelector('#notifications-panel');
  const notificationList = document.querySelector('#notification-list');
  const badge = document.querySelector('.notification-count');

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
    nav.classList.toggle('is-open', !isOpen);
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }
  });

  if (!loggedOut || !memberLinks) return;
  let stopWalletUpdates;
  getFirebase().then(({ auth, db, onAuthStateChanged, doc, getDoc, collection, query, where, orderBy, limit, onSnapshot, getDocs, updateDoc, deleteDoc }) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        loggedOut.hidden = false;
        memberLinks.hidden = true;
        adminNav.hidden = true;
        wallet.hidden = true;
        stopWalletUpdates?.();
        nav.querySelectorAll('[data-user-nav]').forEach((item) => { item.hidden = false; });
        return;
      }
      loggedOut.hidden = true;
      memberLinks.hidden = false;
      wallet.hidden = false;
      stopWalletUpdates?.();
      stopWalletUpdates = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        const balance = Number(snapshot.exists() ? snapshot.data().walletBalance || 0 : 0);
        wallet.querySelector('#walletBalance').textContent = `₦${balance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      });
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const profile = userDoc.exists() ? userDoc.data() : {};
      if (profile.banned === true) {
        showBannedScreen();
        return;
      }
      const isAdmin = profile.role === 'admin';
      adminNav.hidden = !isAdmin;
      nav.querySelectorAll('[data-user-nav]').forEach((item) => { item.hidden = isAdmin; });
      memberLinks.innerHTML = `${isAdmin ? '' : '<a href="/pages/myaccounts.html">MY ACCOUNTS</a><a href="/pages/sold.html">SOLD</a>'}<button type="button" class="logout-link">LOG OUT</button>`;
      memberLinks.querySelector('.logout-link').addEventListener('click', async () => {
        const { signOut } = await getFirebase();
        await signOut(auth);
        location.assign('/');
      });
      const notificationItems = collection(db, 'notifications', user.uid, 'items');
      const unreadItems = query(notificationItems, where('read', '==', false));
      onSnapshot(unreadItems, (snapshot) => {
        badge.hidden = snapshot.empty;
        badge.textContent = String(snapshot.size);
        snapshot.forEach((item) => maybeShowTournamentToast(user.uid, item.id, item.data()));
      });
      const items = query(notificationItems, orderBy('createdAt', 'desc'), limit(15));
      onSnapshot(items, (snapshot) => {
        notificationList.innerHTML = snapshot.empty ? '<p class="notification-empty">NO NOTIFICATIONS YET.</p>' : '';
        snapshot.forEach((item) => {
          const notification = item.data();
          const row = document.createElement('article');
          row.className = `notification-item ${notification.read ? '' : 'is-unread'}`;
          row.setAttribute('role', 'button');
          row.tabIndex = 0;
          row.innerHTML = `<div><b></b><p></p></div><button type="button" aria-label="Delete notification">×</button>`;
          row.querySelector('b').textContent = notification.title || 'UPDATE';
          row.querySelector('p').textContent = notification.message || '';
          const activateNotification = async (event) => {
            if (event.target.closest('button')) await deleteDoc(doc(db, 'notifications', user.uid, 'items', item.id));
            else {
              if (!notification.read) await updateDoc(doc(db, 'notifications', user.uid, 'items', item.id), { read: true, status: 'read' });
              notificationPanel.hidden = true;
              if (notification.type === 'tournament_ongoing') location.assign('/pages/tournaments.html?tab=ongoing');
              else if (notification.type === 'tournament_finished') location.assign('/pages/tournaments.html?tab=finished');
            }
          };
          row.addEventListener('click', activateNotification);
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              activateNotification(event);
            }
          });
          notificationList.append(row);
        });
      });
      const markAllRead = document.querySelector('#mark-all-read');
      if (markAllRead && markAllRead.dataset.bound !== 'true') {
        markAllRead.dataset.bound = 'true';
        markAllRead.addEventListener('click', async () => {
          const snapshot = await getDocs(items);
          await Promise.all(snapshot.docs.filter((item) => item.data().read !== true).map((item) => updateDoc(doc(db, 'notifications', user.uid, 'items', item.id), { read: true, status: 'read' })));
        });
      }
    });
  }).catch((error) => console.warn('Member navigation is unavailable:', error));

  notificationButton?.addEventListener('click', () => {
    if (memberLinks.hidden) return location.assign('/pages/auth.html');
    notificationPanel.hidden = !notificationPanel.hidden;
  });
  document.addEventListener('click', (event) => {
    if (notificationPanel && !notificationPanel.hidden && !notificationPanel.contains(event.target) && !notificationButton.contains(event.target)) notificationPanel.hidden = true;
  });
}

function showTournamentToast() {
  const toast = document.createElement('a');
  toast.className = 'tournament-live-toast';
  toast.href = '/pages/tournaments.html?tab=ongoing';
  toast.textContent = 'Tournament is ongoing. Go to Ongoing tab to see room details.';
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 8000);
}

function maybeShowTournamentToast(userId, notificationId, notification) {
  if (notification.type !== 'tournament_ongoing') return;
  const toastKey = `${userId}:${notificationId}`;
  if (!window.__ardtigTournamentToasts) window.__ardtigTournamentToasts = new Set();
  if (window.__ardtigTournamentToasts.has(toastKey)) return;
  window.__ardtigTournamentToasts.add(toastKey);
  showTournamentToast();
}

function ensureInnerHeader() {
  const header = document.querySelector('.page-topbar');
  if (!header || header.querySelector('.primary-nav')) return;
  header.classList.add('inner-header');
  const back = header.querySelector('.back-link');
  const nav = document.createElement('nav');
  nav.className = 'primary-nav';
  nav.setAttribute('aria-label', 'Main navigation');
  nav.innerHTML = '<a href="/pages/freefire.html">FREE FIRE</a><a href="/pages/diamonds.html">DIAMONDS</a><a href="/pages/cod.html">COD ACCOUNTS</a><a href="/pages/efootball.html">E FOOTBALL</a><a href="/pages/members.html">MEMBERS</a><a href="/pages/leaderboard.html">LEADERBOARD</a><a href="/pages/help-a-friend.html">HELP A FRIEND</a><a href="/pages/tournaments.html">TOURNAMENTS</a><button class="icon-button theme-toggle" type="button" aria-label="Switch theme" title="Switch theme"><span aria-hidden="true">☼</span></button><div class="auth-links" id="header-auth-controls"><a href="/pages/auth.html">LOG IN</a><a href="/pages/auth.html">SIGN UP</a></div><div class="member-links" id="member-links" hidden></div><button class="install-button" id="install-app" type="button" hidden>INSTALL <span aria-hidden="true">↓</span></button>';
  header.insertBefore(nav, back);
  const actions = document.createElement('div');
  actions.className = 'header-actions';
  actions.innerHTML = '<button class="icon-button notification-button" type="button" aria-label="Notifications" title="Notifications"><span aria-hidden="true">🔔</span><i class="notification-count" hidden>0</i></button><button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false"><i></i><i></i><i></i></button>';
  header.append(actions);
  const panel = document.createElement('section');
  panel.className = 'notifications-panel';
  panel.id = 'notifications-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Notifications');
  panel.innerHTML = '<div class="notification-heading"><b>NOTIFICATIONS</b><button type="button" id="mark-all-read">MARK ALL READ</button></div><div id="notification-list"></div>';
  header.append(panel);
}

function ensureRoleNavigation(nav) {
  nav.querySelectorAll(':scope > a, :scope > .theme-toggle').forEach((link) => link.setAttribute('data-user-nav', ''));
  if (nav.querySelector('.admin-nav-links')) return;
  const controls = nav.querySelector('.auth-links');
  const adminNav = document.createElement('div');
  adminNav.className = 'admin-nav-links';
  adminNav.hidden = true;
  adminNav.innerHTML = '<a href="/pages/admin/analytics.html">DASHBOARD</a><a href="/pages/admin/requests.html">ORDERS</a><a href="/pages/admin/post-freefire.html">MANAGE ACCOUNTS</a><a href="/pages/admin/host-tournament.html">HOST TOURNAMENT</a><a href="/pages/members.html">MEMBERS</a><a href="/pages/leaderboard.html">LEADERBOARD</a><a href="/pages/help-a-friend.html">HELP A FRIEND</a><a href="/pages/tournaments.html">TOURNAMENTS</a><button class="icon-button theme-toggle" type="button" aria-label="Switch theme" title="Switch theme"><span aria-hidden="true">☼</span></button>';
  nav.insertBefore(adminNav, controls);
}

function ensureWalletWidget(actions) {
  let wallet = actions.querySelector('.wallet-widget');
  if (!wallet) {
    wallet = document.createElement('div');
    wallet.className = 'wallet-widget';
    wallet.hidden = true;
    wallet.innerHTML = '<span id="walletBalance">₦0.00</span><button type="button" id="wallet-topup" aria-label="Top up ARDTIG balance" title="Top up wallet">+</button>';
    const notificationButton = actions.querySelector('.notification-button');
    actions.insertBefore(wallet, notificationButton);
    wallet.querySelector('#wallet-topup').addEventListener('click', () => { location.assign('/topup.html'); });
  }
  return wallet;
}
