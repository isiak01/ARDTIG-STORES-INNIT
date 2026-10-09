const THEME_KEY = 'ardtig-theme';

export function initializeTheme() {
  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  const savedTheme = localStorage.getItem(THEME_KEY);
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  function setTheme(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    toggle.firstElementChild.textContent = theme === 'dark' ? '◐' : '☼';
    localStorage.setItem(THEME_KEY, theme);
  }

  setTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : systemTheme);
  toggle.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
}
