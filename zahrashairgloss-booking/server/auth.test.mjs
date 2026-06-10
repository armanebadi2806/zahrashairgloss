import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database.mjs';
import { createAuth, hashPassword } from './auth.mjs';

function response() {
  const headers = {};
  return { headers, setHeader(name, value) { headers[name] = value; } };
}

test('admin login creates an HttpOnly strict session and validates it', () => {
  const db = createDatabase(':memory:');
  const auth = createAuth(db, { passwordHash: hashPassword('ein-sehr-sicheres-passwort') });
  const res = response();
  auth.login({ socket: { remoteAddress: 'test' }, headers: {} }, res, 'ein-sehr-sicheres-passwort');
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  assert.match(res.headers['Set-Cookie'], /SameSite=Strict/);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  assert.ok(auth.session({ headers: { cookie } }));
});

test('wrong password does not create a session', () => {
  const db = createDatabase(':memory:');
  const auth = createAuth(db, { passwordHash: hashPassword('ein-sehr-sicheres-passwort') });
  assert.throws(() => auth.login({ socket: { remoteAddress: 'wrong-test' }, headers: {} }, response(), 'falsch'), /nicht korrekt/);
});

test('logout removes the stored session', () => {
  const db = createDatabase(':memory:');
  const auth = createAuth(db, { passwordHash: hashPassword('ein-sehr-sicheres-passwort') });
  const loginResponse = response();
  auth.login({ socket: { remoteAddress: 'logout-test' }, headers: {} }, loginResponse, 'ein-sehr-sicheres-passwort');
  const cookie = loginResponse.headers['Set-Cookie'].split(';')[0];
  const request = { headers: { cookie } };
  assert.ok(auth.session(request));
  auth.logout(request, response());
  assert.equal(auth.session(request), null);
});
