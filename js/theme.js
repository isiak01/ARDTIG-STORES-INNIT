const THEME_KEY = 'ardtig-theme';

export function initializeTheme() {
  const root = document.documentElement;
  const toggles = document.querySelectorAll('.theme-toggle');
  if (!toggles.length) return;
  const savedTheme = localStorage.getItem(THEME_KEY);
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  function setTheme(theme) {
    root.dataset.theme = theme;
    toggles.forEach((toggle) => {
      const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      toggle.firstElementChild.textContent = theme === 'dark' ? '◐' : '☼';
    });
    localStorage.setItem(THEME_KEY, theme);
  }

  setTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : systemTheme);
  toggles.forEach((toggle) => toggle.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')));
}
