/** FR-UX-002: light / dark / system. Stored per browser; "system" follows the OS setting. */
export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'pm_theme';
const query = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref = getThemePreference()) {
  const dark = pref === 'dark' || (pref === 'system' && query()?.matches === true);
  document.documentElement.classList.toggle('dark', dark);
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Private mode: the choice still applies for this page view.
  }
  applyTheme(pref);
}

/** Re-applies when the OS theme changes while "system" is selected. */
export function watchSystemTheme() {
  query()?.addEventListener?.('change', () => applyTheme());
}
