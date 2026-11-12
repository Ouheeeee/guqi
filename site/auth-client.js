export const API_BASE = 'https://guqi-online-api.pages.dev';
const ACCOUNT_TOKEN_KEY = 'guqi.account.token';

export class AccountApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getAccountToken() {
  try {
    return localStorage.getItem(ACCOUNT_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAccountToken(token) {
  try {
    if (token) localStorage.setItem(ACCOUNT_TOKEN_KEY, token);
    else localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  } catch {
    // 无痕浏览可能禁用 localStorage，本次页面仍可使用内存中的 session。
  }
}

export function clearAccountToken() {
  setAccountToken('');
}

async function accountRequest(path, { method = 'GET', body, roomToken, token = getAccountToken() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Account-Token'] = token;
  if (roomToken) headers['X-Room-Token'] = roomToken;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountApiError(0, '网络连接失败，请检查网络');
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new AccountApiError(response.status, '服务器返回异常');
  }
  if (!response.ok) {
    if (response.status === 401 && token) clearAccountToken();
    throw new AccountApiError(response.status, data.error || '请求失败');
  }
  return data;
}

export async function getMe() {
  if (!getAccountToken()) return null;
  try {
    const data = await accountRequest('/api/auth/me');
    return data.user || null;
  } catch (error) {
    if (error.status === 401) clearAccountToken();
    return null;
  }
}

export async function registerAccount({ email, password, displayName }) {
  const data = await accountRequest('/api/auth/register', {
    method: 'POST',
    token: '',
    body: { email, password, displayName },
  });
  setAccountToken(data.token);
  return data.user;
}

export async function loginAccount({ email, password }) {
  const data = await accountRequest('/api/auth/login', {
    method: 'POST',
    token: '',
    body: { email, password },
  });
  setAccountToken(data.token);
  return data.user;
}

export async function logoutAccount() {
  try {
    await accountRequest('/api/auth/logout', { method: 'POST' });
  } catch {
    // 即使网络失败，也清理本机 session。
  }
  clearAccountToken();
}

export async function listSavedGames() {
  const data = await accountRequest('/api/games');
  return data.games || [];
}

export async function getSavedGame(id) {
  const data = await accountRequest(`/api/games/${encodeURIComponent(id)}`);
  return data.game;
}

export async function saveLocalGame(game, { id = '', title = '' } = {}) {
  const state = {
    size: game.size,
    komi: game.komi,
    board: game.board,
    phase: game.phase,
    turn: game.turn,
    history: game.history,
    lastMove: game.lastMove,
    result: game.result,
    startedAt: game.startedAt,
    layoutId: game.layoutId,
  };
  const data = await accountRequest('/api/games', {
    method: 'POST',
    body: { id: id || undefined, title, state },
  });
  return data.game;
}

export async function deleteSavedGame(id) {
  await accountRequest(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function saveOnlineRecord(code, roomToken) {
  const data = await accountRequest('/api/games/online', {
    method: 'POST',
    roomToken,
    body: { code },
  });
  return data.game;
}

export function accountUrl(returnTo = location.pathname + location.search) {
  const url = new URL('./account.html', location.href);
  if (returnTo) url.searchParams.set('return', returnTo);
  return `${url.pathname}${url.search}`;
}

export async function initAccountLink(element, returnTo = location.pathname + location.search) {
  if (!element) return null;
  element.href = accountUrl(returnTo);
  element.textContent = '登录';
  const user = await getMe();
  if (user) element.textContent = '我的';
  return user;
}
