export function createVerifiedBadge({ avatar = false } = {}) {
  const badge = document.createElement('span');
  badge.className = `verified-badge${avatar ? ' avatar-badge' : ' inline-badge'}`;
  if (avatar) {
    badge.setAttribute('style', 'position:absolute; bottom:-2px; right:-2px; width:20px; height:20px; z-index:10;');
    badge.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="12" fill="#1DA1F2" stroke="white" stroke-width="2"/><path d="M7.5 12.5 L10.5 15.5 L16.5 8.5" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    badge.setAttribute('style', 'display:inline-flex; width:16px; height:16px; margin-left:4px; vertical-align:middle;');
    badge.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="12" fill="#1DA1F2"/><path d="M7.5 12.5 L10.5 15.5 L16.5 8.5" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  badge.setAttribute('aria-label', 'Verified admin');
  return badge;
}
