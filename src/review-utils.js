export const colors = ['#ec4047', '#009fe3', '#f4b400', '#00a474'];
export const clock = (time = 0, precise = false) => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}${precise ? '.' + String(Math.floor((time % 1) * 1000 + .001)).padStart(3, '0') : ''}`;
export const statusClass = value => value.toLowerCase().replaceAll(' ', '-');
export const initials = name => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
export const json = (method, value) => ({ method, body: JSON.stringify(value) });
