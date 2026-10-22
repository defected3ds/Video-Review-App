import { useSyncExternalStore } from 'react';

const key = 'pipelife-theme', changed = 'pipelife-theme-change';
const system = matchMedia('(prefers-color-scheme: dark)');
function readPreference() {
  try { const value = localStorage.getItem(key); return ['light', 'dark'].includes(value) ? value : null; } catch { return null; }
}
let preference = readPreference();
function apply() {
  const theme = preference || (system.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101a2a' : '#003087');
  window.dispatchEvent(new Event(changed));
}
export function setTheme(theme) {
  preference = theme === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(key, preference); } catch {}
  apply();
}
function subscribe(listener) {
  window.addEventListener(changed, listener);
  return () => window.removeEventListener(changed, listener);
}
const snapshot = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
export function useTheme() { return useSyncExternalStore(subscribe, snapshot); }
window.addEventListener('storage', event => { if (event.key === key || event.key === null) { preference = readPreference(); apply(); } });
system.addEventListener('change', () => { if (!preference) apply(); });
apply();
