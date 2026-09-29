import { localPreferences } from './persistence/preferences.mjs';
import { persistenceKeys } from './persistence/keys.mjs';
export type Theme = 'light' | 'dark';

export function readTheme(preferences = localPreferences): Theme {
  return preferences.getText(persistenceKeys.theme) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: string, root = document.documentElement): Theme {
  const next = theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = next;
  root.style.colorScheme = next;
  return next;
}

export function saveTheme(theme: Theme): Theme {
  const next = applyTheme(theme);
  localPreferences.setText(persistenceKeys.theme, next);
  return next;
}
