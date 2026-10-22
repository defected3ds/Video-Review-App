import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.mjs';

test('Admin settings require the owner and persist profile/password changes without invalidating guest links', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pvr-settings-'));
  let server = await startServer(dir), cookie = '', invitation;
  const request = (route, method = 'GET', body, sessionCookie = cookie, headers = {}) => fetch(server.base + route, { method, headers: { ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  try {
    await t.test('anonymous and guest sessions cannot change settings', async () => {
      assert.equal((await request('/api/settings/profile', 'PATCH', { name: 'Other' })).status, 401);
      assert.equal((await request('/api/settings/password', 'POST', { currentPassword: 'review', newPassword: 'newpass' })).status, 401);
      const setup = await request('/api/setup', 'POST', { name: 'Owner', password: 'review' }); assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
      invitation = await (await request('/api/assets/demo/share', 'POST')).json();
      assert.equal((await request('/api/settings/profile?review=' + invitation.token, 'PATCH', { name: 'Client' }, '')).status, 401);
      assert.equal((await request('/api/settings/password', 'POST', { currentPassword: 'review', newPassword: 'newpass' }, cookie, { Origin: 'https://attacker.example' })).status, 403);
    });
    await t.test('display name validation and persistence do not expose credentials', async () => {
      for (const name of ['', '  ', 'x'.repeat(81), 123]) assert.equal((await request('/api/settings/profile', 'PATCH', { name })).status, 400);
      const response = await request('/api/settings/profile', 'PATCH', { name: '  Anna  ' }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { name: 'Anna' });
      const session = await (await request('/api/session')).json(); assert.equal(session.name, 'Anna'); assert.equal(session.password_hash, undefined);
    });
    await t.test('invalid password changes leave current sessions and password intact', async () => {
      assert.equal((await request('/api/settings/password', 'POST', { currentPassword: 'wrong', newPassword: 'newpass' })).status, 400);
      assert.equal((await request('/api/settings/password', 'POST', { currentPassword: 'review', newPassword: 'short' })).status, 400);
      assert.equal((await request('/api/session')).status, 200); assert.equal((await (await request('/api/session')).json()).authenticated, true);
    });
    await t.test('password update rotates the active session and revokes other team sessions while guest links remain valid', async () => {
      const otherLogin = await request('/api/login', 'POST', { password: 'review' }, ''); assert.equal(otherLogin.status, 200);
      const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0], oldCookie = cookie;
      const response = await request('/api/settings/password', 'POST', { currentPassword: 'review', newPassword: 'newpass' }); assert.equal(response.status, 200);
      assert.ok(response.headers.get('set-cookie').includes('HttpOnly')); cookie = response.headers.get('set-cookie').split(';')[0]; assert.notEqual(cookie, oldCookie);
      for (const revokedCookie of [oldCookie, otherCookie]) assert.equal((await request('/api/projects', 'GET', null, revokedCookie)).status, 401);
      assert.equal((await request('/api/projects')).status, 200);
      assert.equal((await request('/api/login', 'POST', { password: 'review' }, '')).status, 401);
      assert.equal((await request('/api/reviews/' + invitation.token, 'GET', null, '')).status, 200);
    });
    await t.test('new credentials and profile survive restart', async () => {
      await server.stop(); server = await startServer(dir);
      assert.equal((await (await request('/api/session')).json()).name, 'Anna');
      const login = await request('/api/login', 'POST', { password: 'newpass' }, ''); assert.equal(login.status, 200); assert.equal((await login.json()).name, 'Anna');
      assert.equal((await request('/api/setup', 'POST', { name: 'Replacement', password: 'review' }, '')).status, 409);
    });
  } finally { await server.stop(); rmSync(dir, { recursive: true, force: true }); }
});
