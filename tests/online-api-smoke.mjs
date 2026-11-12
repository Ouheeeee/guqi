/**
 * 联机 API 冒烟测试。会创建真实房间并写入线上 D1。
 * 运行：npm run test:online
 * 仅用于手动发版前验证，不进入 npm test。
 */
import assert from 'node:assert/strict';

const API = 'https://guqi-online-api.pages.dev';
const ORIGIN = 'https://ouheeeee.github.io';

async function request(path, { method = 'GET', token, body, headers: extraHeaders = {} } = {}) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}

const health = await request('/api/health');
assert.equal(health.ok, true);

const created = await request('/api/rooms', {
  method: 'POST',
  body: { size: 13, komi: 0.5 },
});
const code = created.code;
const hostToken = created.token;
const host = (state) => ({ token: hostToken, state });
assert.equal(created.state.phase, 'waiting');

const joined = await request(`/api/rooms/${code}/join`, { method: 'POST', body: {} });
const guestToken = joined.token;
assert.equal(joined.state.phase, 'voting');
assert.equal(joined.state.players.guest.online, true);

let hostState = (await request(`/api/rooms/${code}`, { token: hostToken })).state;
let guestState = (await request(`/api/rooms/${code}`, { token: guestToken })).state;
assert.equal(hostState.phase, 'voting');
assert.equal(guestState.phase, 'voting');

await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'vote', approve: true } },
});
guestState = (await request(`/api/rooms/${code}`, { token: guestToken })).state;
assert.equal(guestState.votes.host, true);
assert.equal(guestState.phase, 'voting');

await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'vote', approve: false } },
});
await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: guestToken, body: { action: { type: 'vote', approve: false } },
});
guestState = (await request(`/api/rooms/${code}`, { token: guestToken })).state;
assert.equal(guestState.phase, 'voting');

await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'new-layout' } },
});
await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'vote', approve: true } },
});
const started = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: guestToken, body: { action: { type: 'vote', approve: true } },
});
assert.equal(started.state.phase, 'playing');
assert.equal(started.state.turn, 'black');

const empty = started.state.board.findIndex((value) => value === 0);
const moved = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'move', index: empty } },
});
assert.equal(moved.state.turn, 'white');
assert.equal(moved.state.canRequestUndo, true);

const undoRequest = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'request-undo' } },
});
assert.equal(undoRequest.state.pending.kind, 'undo');
const undone = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: guestToken, body: { action: { type: 'respond-undo', accept: true } },
});
assert.equal(undone.state.pending, null);
assert.equal(undone.state.turn, 'black');

const komiRequest = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: guestToken, body: { action: { type: 'request-komi', value: 1 } },
});
assert.equal(komiRequest.state.pending.kind, 'komi');
const komiAccepted = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: hostToken, body: { action: { type: 'respond-komi', accept: true } },
});
assert.equal(komiAccepted.state.komi, 1);

const resigned = await request(`/api/rooms/${code}/actions`, {
  method: 'POST', token: guestToken, body: { action: { type: 'resign' } },
});
assert.equal(resigned.state.phase, 'ended');
assert.equal(resigned.state.result.reason, 'resign');
const finalState = (await request(`/api/rooms/${code}`, { token: hostToken })).state;
assert.equal(finalState.phase, 'ended');

// 第二局：双方都同意后才允许立即结算；拒绝时继续对局。
const settleCreated = await request('/api/rooms', {
  method: 'POST',
  body: { size: 13, komi: 0.5 },
});
const settleCode = settleCreated.code;
const settleHost = settleCreated.token;
const settleJoined = await request(`/api/rooms/${settleCode}/join`, { method: 'POST', body: {} });
const settleGuest = settleJoined.token;
await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleHost, body: { action: { type: 'vote', approve: true } },
});
const settleStarted = await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleGuest, body: { action: { type: 'vote', approve: true } },
});
assert.equal(settleStarted.state.phase, 'playing');
assert.equal(settleStarted.state.canRequestSettle, true);

const settleEmpty = settleStarted.state.board.findIndex((value) => value === 0);
await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleHost, body: { action: { type: 'move', index: settleEmpty } },
});
const settleRequested = await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleHost, body: { action: { type: 'request-settle' } },
});
assert.equal(settleRequested.state.pending.kind, 'settle');
const settleRejected = await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleGuest, body: { action: { type: 'respond-settle', accept: false } },
});
assert.equal(settleRejected.state.pending, null);
assert.equal(settleRejected.state.phase, 'playing');

await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleHost, body: { action: { type: 'request-settle' } },
});
const settleAccepted = await request(`/api/rooms/${settleCode}/actions`, {
  method: 'POST', token: settleGuest, body: { action: { type: 'respond-settle', accept: true } },
});
assert.equal(settleAccepted.state.phase, 'ended');
assert.equal(settleAccepted.state.result.reason, 'settle');
assert.deepEqual(settleAccepted.state.result.scores, settleAccepted.state.counts);
assert.equal(settleAccepted.state.canRequestSettle, false);

// 登录账户后，把已结束的联机对局保存为棋谱。
const email = `guqi-online-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const account = await request('/api/auth/register', {
  method: 'POST',
  body: { email, password: 'test-password-8', displayName: '联机测试' },
});
const accountToken = account.token;
const recordResponse = await fetch(`${API}/api/games/online`, {
  method: 'POST',
  headers: {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'X-Account-Token': accountToken,
    'X-Room-Token': hostToken,
  },
  body: JSON.stringify({ code }),
});
const record = await recordResponse.json();
assert.ok(recordResponse.ok, JSON.stringify(record));
assert.equal(record.game.kind, 'online');
assert.equal(record.game.reason, 'resign');
const recordsResponse = await fetch(`${API}/api/games`, {
  headers: { Origin: ORIGIN, 'X-Account-Token': accountToken },
});
const records = await recordsResponse.json();
assert.ok(recordsResponse.ok, JSON.stringify(records));
assert.ok(records.games.some((game) => game.id === record.game.id));

console.log('ONLINE API SMOKE PASSED');
