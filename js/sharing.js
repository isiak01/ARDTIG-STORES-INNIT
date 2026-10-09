let shareDialog;
let activeShare;

export function bindShareButton(button, listing) {
  button.addEventListener('click', () => openShareDialog(button, listing));
}

function openShareDialog(button, listing) {
  const dialog = getShareDialog();
  const input = dialog.querySelector('#share-link');
  const link = new URL(`/pages/view.html?id=${encodeURIComponent(listing.accountId)}&type=${encodeURIComponent(listing.accountType)}`, location.origin).href;
  activeShare = { button, listing, link };
  dialog.querySelector('#share-title').textContent = listing.title;
  input.value = link;
  dialog.querySelector('[data-whatsapp]').href = `https://wa.me/?text=${encodeURIComponent(`${listing.title}\n${link}`)}`;
  dialog.querySelector('[data-native-share]').hidden = typeof navigator.share !== 'function';
  dialog.querySelector('[data-share-feedback]').textContent = '';
  dialog.showModal();
}

function getShareDialog() {
  if (shareDialog) return shareDialog;
  shareDialog = document.createElement('dialog');
  shareDialog.className = 'share-dialog';
  shareDialog.setAttribute('aria-labelledby', 'share-title');
  shareDialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Close">×</button><p class="eyebrow">SHARE LISTING</p><h2 id="share-title"></h2><label class="field-label" for="share-link">ACCOUNT LINK</label><div class="share-link-row"><input id="share-link" type="url" readonly><button class="form-button" type="button" data-copy-link>COPY LINK</button></div><div class="share-actions"><a class="form-button secondary" data-whatsapp target="_blank" rel="noopener">WHATSAPP ↗</a><button class="form-button secondary" type="button" data-native-share hidden>MORE OPTIONS ↗</button></div><p class="share-feedback" data-share-feedback role="status" aria-live="polite"></p>';
  document.body.append(shareDialog);
  shareDialog.querySelector('.dialog-close').addEventListener('click', () => shareDialog.close());
  shareDialog.querySelector('[data-copy-link]').addEventListener('click', copyShareLink);
  shareDialog.querySelector('[data-whatsapp]').addEventListener('click', async () => {
    if (!activeShare) return;
    try {
      const count = await recordShare(activeShare);
      shareDialog.querySelector('[data-share-feedback]').textContent = `WhatsApp opened. ${count} shares recorded.`;
    } catch (error) {
      showShareError(error);
    }
  });
  shareDialog.querySelector('[data-native-share]').addEventListener('click', shareWithSystem);
  return shareDialog;
}

async function copyShareLink() {
  if (!activeShare) return;
  const input = shareDialog.querySelector('#share-link');
  try {
    try {
      await navigator.clipboard.writeText(activeShare.link);
    } catch {
      input.focus();
      input.select();
      if (!document.execCommand('copy')) throw new Error('Copy is not available in this browser. Select and copy the link instead.');
    }
    const count = await recordShare(activeShare);
    shareDialog.querySelector('[data-share-feedback]').textContent = `Link copied. ${count} shares recorded.`;
  } catch (error) {
    showShareError(error);
  }
}

async function shareWithSystem() {
  if (!activeShare) return;
  try {
    await navigator.share({ title: activeShare.listing.title, url: activeShare.link });
    await recordShare(activeShare);
    shareDialog.close();
  } catch (error) {
    if (error.name !== 'AbortError') showShareError(error);
  }
}

async function recordShare(share) {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: share.listing.accountId, accountType: share.listing.accountType }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The share count could not be updated.');
  const count = Number(result.shares || 0);
  share.button.querySelector('[data-share-count]').textContent = String(count);
  share.button.setAttribute('aria-label', `Share this account, ${count} shares`);
  return count;
}

function showShareError(error) {
  if (shareDialog?.open) shareDialog.querySelector('[data-share-feedback]').textContent = error.message || 'The share count could not be updated.';
}