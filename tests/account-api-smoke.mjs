/**
 * 账户与云存档 API 冒烟测试。会创建真实账户和测试存档。
 * 运行：npm run test:account
 */
import assert from 'node:assert/strict';
import { createGame, placeStone, startGame } from '../site/game.js';

const API = 'https://guqi-online-api.pages.dev';
const ORIGIN = 'https://ouheeeee.github.io';

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const allHeaders = { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers };
  if (token) allHeaders['X-Account-Token'] = token;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: allHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function ok(path, options) {
  const { response, data } = await request(path, options);
  assert.ok(response.ok, `${options?.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

const email = `guqi-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const passwordA = 'test-password-8';
const passwordB = 'test-password-9';
const registerA = await ok('/api/auth/register', {
  method: 'POST',
  body: { email, password: passwordA, displayName: '第一个账户' },
});
assert.equal(registerA.user.email, email);
assert.equal(registerA.user.displayName, '第一个账户');
assert.ok(registerA.token);
const accountToken = registerA.token;

const me = await ok('/api/auth/me', { token: accountToken });
assert.equal(me.user.id, registerA.user.id);

const registerB = await ok('/api/auth/register', {
  method: 'POST',
  body: { email, password: passwordB, displayName: '第二个账户' },
});
assert.notEqual(registerB.user.id, registerA.user.id);
assert.equal(registerB.user.email, email);
const secondToken = registerB.token;

const duplicatePassword = await request('/api/auth/register', {
  method: 'POST',
  body: { email, password: passwordA, displayName: '重复密码' },
});
assert.equal(duplicatePassword.response.status, 409);

const wrong = await request('/api/auth/login', {
  method: 'POST',
  body: { email, password: 'not-the-password' },
});
assert.equal(wrong.response.status, 401);

const loginA = await ok('/api/auth/login', {
  method: 'POST',
  body: { email, password: passwordA },
});
assert.equal(loginA.user.id, registerA.user.id);
const loginB = await ok('/api/auth/login', {
  method: 'POST',
  body: { email, password: passwordB },
});
assert.equal(loginB.user.id, registerB.user.id);
const loginToken = loginA.token;

let state = startGame(createGame(13, { komi: 1 }));
for (let move = 0; move < 3; move += 1) {
  state = placeStone(state, state.board.findIndex((cell) => cell === 0));
}
const saved = await ok('/api/games', {
  method: 'POST',
  token: accountToken,
  body: { title: '测试存档', state },
});
assert.ok(saved.game.id);
assert.equal(saved.game.kind, 'local');
assert.equal(saved.game.moves, 3);

const list = await ok('/api/games', { token: accountToken });
assert.ok(list.games.some((game) => game.id === saved.game.id));
const secondList = await ok('/api/games', { token: secondToken });
assert.equal(secondList.games.length, 0, '同邮箱的另一个账户不应看到这个存档');
const detail = await ok(`/api/games/${saved.game.id}`, { token: accountToken });
assert.equal(detail.game.state.history.length, 3);
assert.equal(detail.game.state.board.length, 169);

const updatedState = placeStone(state, state.board.findIndex((cell) => cell === 0));
const updated = await ok('/api/games', {
  method: 'POST',
  token: accountToken,
  body: { id: saved.game.id, title: '测试存档（已更新）', state: updatedState },
});
assert.equal(updated.game.id, saved.game.id);
assert.equal(updated.game.moves, 4);
assert.equal(updated.game.title, '测试存档（已更新）');

await ok(`/api/games/${saved.game.id}`, { method: 'DELETE', token: accountToken });
const afterDelete = await request(`/api/games/${saved.game.id}`, { token: accountToken });
assert.equal(afterDelete.response.status, 404);

await ok('/api/auth/logout', { method: 'POST', token: loginToken });
const afterLogout = await request('/api/auth/me', { token: loginToken });
assert.equal(afterLogout.response.status, 401);

console.log('ACCOUNT API SMOKE PASSED');
