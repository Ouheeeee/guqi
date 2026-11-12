import {
  BLACK,
  WHITE,
  BOARD_SIZES,
  KOMI_OPTIONS,
  generateLayout,
  placeStone,
  undoMove,
  setKomi,
  settleGame,
  groupCounts,
  judgeScores,
  analyzeGroups,
} from '../../../site/game.js';

const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ONLINE_MS = 12000;
const TOUCH_MS = 4000;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100000;
const MAX_STATE_LENGTH = 60000;
const MAX_ACCOUNTS_PER_EMAIL = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA==';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const defaultOrigins = [
  'https://ouheeeee.github.io',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'http://localhost:4173',
  'http://localhost:4174',
];

function allowedOrigins(env) {
  return new Set([
    ...defaultOrigins,
    ...(env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ]);
}

function corsHeaders(origin, env) {
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization,Content-Type,X-Account-Token,X-Room-Token';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function response(body, status, origin, env, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

function errorResponse(error, origin, env) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error(error);
  return response({ error: status === 500 ? '服务器开小差了，请稍后再试' : error.message }, status, origin, env);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function accountToken(request) {
  return (request.headers.get('X-Account-Token') || '').trim();
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

async function passwordDigest(env, email, password, salt, iterations) {
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) {
    throw new HttpError(503, '登录服务尚未配置，请稍后再试');
  }
  const rounds = Number(iterations) || PASSWORD_ITERATIONS;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > PASSWORD_ITERATIONS) {
    throw new HttpError(500, '账户密码参数异常');
  }
  const encoder = new TextEncoder();
  const pepperKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AUTH_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const peppered = await crypto.subtle.sign('HMAC', pepperKey, encoder.encode(`${email}\n${password}`));
  const material = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToBytes(salt), iterations: rounds, hash: 'SHA-256' },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function randomSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function createAccountSession(env, userId) {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(tokenHash, userId, now, now + SESSION_TTL_MS).run();
  return token;
}

async function accountFromRequest(request, env, { required = true } = {}) {
  const token = accountToken(request);
  if (!token) {
    if (required) throw new HttpError(401, '请先登录');
    return null;
  }
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.created_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  if (!row || Number(row.expires_at) <= Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    if (required) throw new HttpError(401, '登录状态已过期，请重新登录');
    return null;
  }
  return publicUser(row);
}

async function requireAccount(request, env) {
  return accountFromRequest(request, env);
}

function gameMetadata(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    size: row.size,
    komi: row.komi,
    phase: row.phase,
    moves: row.moves,
    winner: row.winner,
    reason: row.reason,
    roomCode: row.room_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function savedGameState(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, '棋局数据格式错误');
  const size = Number(raw.size);
  if (!BOARD_SIZES.includes(size)) throw new HttpError(400, '不支持的棋盘尺寸');
  if (!Array.isArray(raw.board) || raw.board.length !== size * size) {
    throw new HttpError(400, '棋盘数据不完整');
  }
  const board = raw.board.map(Number);
  if (board.some((cell) => cell !== 0 && cell !== 1 && cell !== 2)) {
    throw new HttpError(400, '棋盘棋子数据无效');
  }
  const komi = Number(raw.komi);
  if (!KOMI_OPTIONS.includes(komi)) throw new HttpError(400, '不支持的贴目规则');
  const phase = ['ready', 'playing', 'ended'].includes(raw.phase) ? raw.phase : 'ready';
  const turn = raw.turn === WHITE ? WHITE : BLACK;
  if (!Array.isArray(raw.history) || raw.history.length > size * size) {
    throw new HttpError(400, '棋谱数据无效');
  }
  const history = raw.history.map((move, index) => {
    if (!move || !Number.isInteger(move.index) || move.index < 0 || move.index >= size * size) {
      throw new HttpError(400, '棋谱落子位置无效');
    }
    if (move.color !== BLACK && move.color !== WHITE) throw new HttpError(400, '棋谱颜色无效');
    return {
      index: move.index,
      color: move.color,
      moveNumber: Number.isInteger(move.moveNumber) ? move.moveNumber : index + 1,
    };
  });
  const lastMove = Number.isInteger(raw.lastMove) && raw.lastMove >= 0 && raw.lastMove < size * size
    ? raw.lastMove
    : null;
  const result = raw.result && typeof raw.result === 'object' ? raw.result : null;
  const state = {
    size,
    komi,
    board,
    phase,
    turn,
    history,
    lastMove,
    result,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    layoutId: typeof raw.layoutId === 'string' ? raw.layoutId.slice(0, 80) : null,
  };
  if (JSON.stringify(state).length > MAX_STATE_LENGTH) throw new HttpError(413, '棋局数据过大');
  return state;
}

function savedGameTitle(value, state) {
  const cleaned = cleanText(value, 80);
  if (cleaned) return cleaned;
  const phase = state.phase === 'ready' ? '待开始' : state.phase === 'ended' ? '已结束' : '进行中';
  return `${state.size} 路 · ${phase} · ${state.history.length} 手`;
}

async function registerUser(request, env, origin) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const displayName = cleanText(body.displayName, 24);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new HttpError(400, '请输入有效的邮箱地址');
  if (displayName.length < 1) throw new HttpError(400, '请输入昵称');
  if (password.length < 8) throw new HttpError(400, '密码至少需要 8 个字符');
  if (password.length > 128) throw new HttpError(400, '密码太长了');
  const existingRows = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(email, MAX_ACCOUNTS_PER_EMAIL + 1).all();
  const existingAccounts = existingRows.results || [];
  if (existingAccounts.length > MAX_ACCOUNTS_PER_EMAIL) {
    throw new HttpError(409, '这个邮箱下的账户数量已达上限');
  }
  for (const account of existingAccounts) {
    const existingHash = await passwordDigest(
      env, email, password, account.password_salt, Number(account.password_iterations),
    );
    if (safeEqual(existingHash, account.password_hash)) {
      throw new HttpError(409, '这个邮箱下已有使用该密码的账户，请直接登录');
    }
  }

  const salt = randomSalt();
  const hash = await passwordDigest(env, email, password, salt, PASSWORD_ITERATIONS);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, password_iterations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, email, displayName, hash, salt, PASSWORD_ITERATIONS, now).run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      throw new HttpError(409, '这个邮箱已经注册过');
    }
    throw error;
  }
  const token = await createAccountSession(env, id);
  return response({ user: { id, email, displayName, createdAt: now }, token }, 201, origin, env);
}

async function loginUser(request, env, origin) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_PATTERN.test(email) || !password) throw new HttpError(401, '邮箱或密码不正确');
  const rows = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(email, MAX_ACCOUNTS_PER_EMAIL).all();
  const accounts = rows.results || [];
  if (!accounts.length) {
    await passwordDigest(env, email, password, DUMMY_SALT, PASSWORD_ITERATIONS);
    throw new HttpError(401, '邮箱或密码不正确');
  }
  let matched = null;
  for (const account of accounts) {
    const hash = await passwordDigest(
      env, email, password, account.password_salt, Number(account.password_iterations),
    );
    if (safeEqual(hash, account.password_hash)) {
      matched = account;
      break;
    }
  }
  if (!matched) throw new HttpError(401, '邮箱或密码不正确');
  const token = await createAccountSession(env, matched.id);
  return response({ user: publicUser(matched), token }, 200, origin, env);
}

async function logoutUser(request, env, origin) {
  const token = accountToken(request);
  if (token) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return response({ ok: true }, 200, origin, env);
}

async function getMe(request, env, origin) {
  const user = await requireAccount(request, env);
  return response({ user }, 200, origin, env);
}

async function listGames(request, env, origin, user) {
  const rows = await env.DB.prepare(
    `SELECT id, kind, title, size, komi, phase, moves, winner, reason, room_code, created_at, updated_at
     FROM games WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
  ).bind(user.id).all();
  return response({ games: (rows.results || []).map(gameMetadata) }, 200, origin, env);
}

async function saveLocalGame(request, env, origin, user) {
  const body = await readJson(request);
  const state = savedGameState(body.state);
  const title = savedGameTitle(body.title, state);
  const stateJson = JSON.stringify(state);
  const now = Date.now();
  const winner = state.result && Number.isInteger(state.result.winner) ? state.result.winner : null;
  const reason = state.result && typeof state.result.reason === 'string' ? state.result.reason.slice(0, 40) : null;
  const requestedId = typeof body.id === 'string' ? body.id.trim() : '';
  let id = requestedId;

  if (id) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, '存档标识无效');
    const result = await env.DB.prepare(
      `UPDATE games SET title = ?, size = ?, komi = ?, phase = ?, moves = ?, winner = ?, reason = ?,
       state = ?, updated_at = ? WHERE id = ? AND user_id = ? AND kind = 'local'`,
    ).bind(title, state.size, state.komi, state.phase, state.history.length, winner, reason, stateJson, now, id, user.id).run();
    if (!result.meta.changes) throw new HttpError(404, '存档不存在或已删除');
  } else {
    id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO games (id, user_id, kind, title, size, komi, phase, moves, winner, reason, room_code, state, created_at, updated_at)
       VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(id, user.id, title, state.size, state.komi, state.phase, state.history.length, winner, reason, stateJson, now, now).run();
  }
  const row = await env.DB.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  return response({ game: gameMetadata(row) }, requestedId ? 200 : 201, origin, env);
}

async function getSavedGame(request, env, origin, user, id) {
  const row = await env.DB.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) throw new HttpError(404, '棋谱不存在或已删除');
  let state;
  try { state = JSON.parse(row.state); } catch { throw new HttpError(500, '棋谱数据损坏'); }
  return response({ game: { ...gameMetadata(row), state } }, 200, origin, env);
}

async function deleteSavedGame(request, env, origin, user, id) {
  const result = await env.DB.prepare('DELETE FROM games WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!result.meta.changes) throw new HttpError(404, '棋谱不存在或已删除');
  return response({ ok: true }, 200, origin, env);
}

async function saveOnlineRecord(request, env, origin, user) {
  const body = await readJson(request);
  const code = String(body.code || body.roomCode || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new HttpError(400, '房间号格式不正确');
  const roomToken = (request.headers.get('X-Room-Token') || '').trim();
  if (!roomToken) throw new HttpError(401, '缺少房间身份');
  const row = await loadRoom(env, code);
  const seat = await seatFor(row, roomToken);
  if (!seat) throw new HttpError(401, '房间身份无效');
  const state = parseState(row);
  if (state.phase !== 'ended' || !state.game?.result) throw new HttpError(409, '对局尚未结束，暂时不能保存棋谱');
  const existing = await env.DB.prepare(
    `SELECT * FROM games WHERE user_id = ? AND kind = 'online' AND room_code = ?`,
  ).bind(user.id, code).first();
  if (existing) return response({ game: gameMetadata(existing) }, 200, origin, env);

  const gameState = savedGameState({ ...state.game, size: state.size, komi: state.komi });
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO games (id, user_id, kind, title, size, komi, phase, moves, winner, reason, room_code, state, created_at, updated_at)
       VALUES (?, ?, 'online', ?, ?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, user.id, `联机对局 · ${code}`, gameState.size, gameState.komi, gameState.history.length,
      Number.isInteger(gameState.result?.winner) ? gameState.result.winner : null,
      typeof gameState.result?.reason === 'string' ? gameState.result.reason.slice(0, 40) : null,
      code, JSON.stringify(gameState), now, now,
    ).run();
  } catch (error) {
    const raced = await env.DB.prepare(
      `SELECT * FROM games WHERE user_id = ? AND kind = 'online' AND room_code = ?`,
    ).bind(user.id, code).first();
    if (raced) return response({ game: gameMetadata(raced) }, 200, origin, env);
    throw error;
  }
  const saved = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first();
  return response({ game: gameMetadata(saved) }, 201, origin, env);
}

async function seatFor(row, token) {
  if (!token) return null;
  const hash = await hashToken(token);
  if (hash === row.host_hash) return 'host';
  if (row.guest_hash && hash === row.guest_hash) return 'guest';
  return null;
}

async function loadRoom(env, code) {
  const row = await env.DB.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();
  if (!row) throw new HttpError(404, '房间不存在或已过期');
  return row;
}

function parseState(row) {
  return JSON.parse(row.state);
}

function layoutProposal(size) {
  const layout = generateLayout(size);
  return { board: layout.board };
}

function colorOfSeat(seat) {
  return seat === 'host' ? BLACK : WHITE;
}

function colorName(color) {
  return color === BLACK ? 'black' : 'white';
}

function countsOf(board, size) {
  const analysis = analyzeGroups(board, size);
  return { black: analysis.black, white: analysis.white };
}

function publicState(row, state, seat) {
  const now = Date.now();
  const game = state.game;
  const board = game?.board || state.proposal?.board || [];
  const last = game?.history?.length ? game.history[game.history.length - 1] : null;
  const yourColor = colorOfSeat(seat);
  const canRequestUndo = Boolean(
    state.phase === 'playing' &&
    !state.pending &&
    last &&
    last.color === yourColor,
  );

  return {
    code: row.code,
    you: seat,
    youColor: colorName(yourColor),
    phase: state.phase,
    version: row.version,
    size: state.size,
    komi: state.komi,
    players: {
      host: { color: 'black', online: now - row.host_seen <= ONLINE_MS },
      guest: row.guest_hash
        ? { color: 'white', online: now - row.guest_seen <= ONLINE_MS }
        : null,
    },
    votes: state.votes,
    board,
    counts: countsOf(board, state.size),
    turn: game && state.phase === 'playing' ? colorName(game.turn) : null,
    lastMove: game?.lastMove ?? null,
    lastMoveColor: last ? colorName(last.color) : null,
    moveCount: game?.history?.length ?? 0,
    result: game?.result || null,
    pending: state.pending || null,
    canRequestUndo,
    canRequestKomi: state.phase === 'playing' && !state.pending,
    canRequestSettle: state.phase === 'playing' && !state.pending,
    komiOptions: [...KOMI_OPTIONS],
  };
}

async function touchSeen(env, row, seat) {
  const now = Date.now();
  const column = seat === 'host' ? 'host_seen' : 'guest_seen';
  const previous = row[column] || 0;
  if (now - previous >= TOUCH_MS) {
    await env.DB.prepare(`UPDATE rooms SET ${column} = ? WHERE code = ?`).bind(now, row.code).run();
    row[column] = now;
  }
}

async function saveState(env, row, state, seat) {
  const now = Date.now();
  const column = seat === 'host' ? 'host_seen' : 'guest_seen';
  const result = await env.DB.prepare(
    `UPDATE rooms SET state = ?, version = version + 1, updated_at = ?, ${column} = ?
     WHERE code = ? AND version = ?`,
  ).bind(JSON.stringify(state), now, now, row.code, row.version).run();
  if (!result.meta.changes) return false;
  row.state = JSON.stringify(state);
  row.version += 1;
  row[column] = now;
  return true;
}

function startGame(state) {
  state.game = {
    size: state.size,
    komi: state.komi,
    board: state.proposal.board.slice(),
    turn: BLACK,
    history: [],
    lastMove: null,
    result: null,
    phase: 'playing',
  };
  state.phase = 'playing';
  state.proposal = null;
  state.pending = null;
}

function assertPlaying(state) {
  if (state.phase !== 'playing') throw new HttpError(409, '对局尚未开始或已经结束');
}

function assertNoPending(state) {
  if (state.pending) throw new HttpError(409, '有未处理的请求，请先完成当前确认');
}

function actionVote(state, action, row, seat) {
  if (!row.guest_hash) throw new HttpError(409, '请等待对手加入');
  if (state.phase !== 'voting') throw new HttpError(409, '当前不在布局确认阶段');
  if (typeof action.approve !== 'boolean') throw new HttpError(400, '请选择同意或不同意');
  state.votes[seat] = action.approve;
  if (state.votes.host === true && state.votes.guest === true) startGame(state);
}

function actionNewLayout(state, row) {
  if (!['waiting', 'voting'].includes(state.phase)) {
    throw new HttpError(409, '对局开始后不能重新生成开局');
  }
  state.proposal = layoutProposal(state.size);
  state.votes = { host: null, guest: null };
  state.pending = null;
  state.phase = row.guest_hash ? 'voting' : 'waiting';
}

function actionUpdateRules(state, action, row, seat) {
  if (seat !== 'host') throw new HttpError(403, '只有房主可以修改开局设置');
  if (!['waiting', 'voting'].includes(state.phase)) {
    throw new HttpError(409, '对局开始后不能修改开局设置');
  }
  if (action.size !== undefined) {
    const size = Number(action.size);
    if (!BOARD_SIZES.includes(size)) throw new HttpError(400, '不支持的棋盘尺寸');
    state.size = size;
  }
  if (action.komi !== undefined) {
    const komi = Number(action.komi);
    if (!KOMI_OPTIONS.includes(komi)) throw new HttpError(400, '不支持的贴目规则');
    state.komi = komi;
  }
  state.proposal = layoutProposal(state.size);
  state.votes = { host: null, guest: null };
  state.pending = null;
  state.phase = row.guest_hash ? 'voting' : 'waiting';
}

function actionMove(state, action, seat) {
  assertPlaying(state);
  assertNoPending(state);
  const game = state.game;
  if (game.turn !== colorOfSeat(seat)) throw new HttpError(409, '还没轮到你落子');
  const index = Number(action.index);
  if (!Number.isInteger(index)) throw new HttpError(400, '落子位置无效');
  const next = placeStone(game, index);
  if (next === game) throw new HttpError(409, '这个位置不能落子');
  state.game = next;
  if (next.phase === 'ended') {
    state.phase = 'ended';
    state.pending = null;
  }
}

function actionResign(state, seat) {
  assertPlaying(state);
  const game = state.game;
  const resigner = colorOfSeat(seat);
  const winner = resigner === BLACK ? WHITE : BLACK;
  const judged = judgeScores(groupCounts(game.board, game.size), game.komi);
  game.result = { ...judged, winner, loser: resigner, reason: 'resign' };
  state.phase = 'ended';
  state.pending = null;
}

function actionRequestUndo(state, seat) {
  assertPlaying(state);
  assertNoPending(state);
  const game = state.game;
  const last = game.history[game.history.length - 1];
  if (!last) throw new HttpError(409, '还没有落子可以撤销');
  if (last.color !== colorOfSeat(seat)) throw new HttpError(409, '只能申请撤销自己刚下的一手');
  state.pending = { kind: 'undo', by: seat };
}

function actionRespondUndo(state, action, seat) {
  assertPlaying(state);
  const pending = state.pending;
  if (!pending || pending.kind !== 'undo') throw new HttpError(409, '没有待处理的悔棋请求');
  if (pending.by === seat) throw new HttpError(403, '不能自己同意自己的请求');
  if (typeof action.accept !== 'boolean') throw new HttpError(400, '请选择同意或拒绝');
  if (action.accept) state.game = undoMove(state.game);
  state.pending = null;
}

function actionRequestKomi(state, action, seat) {
  assertPlaying(state);
  assertNoPending(state);
  const value = Number(action.value);
  if (!KOMI_OPTIONS.includes(value)) throw new HttpError(400, '不支持的贴目规则');
  if (value === state.komi) throw new HttpError(409, '贴目没有变化');
  state.pending = { kind: 'komi', by: seat, value };
}

function actionRespondKomi(state, action, seat) {
  assertPlaying(state);
  const pending = state.pending;
  if (!pending || pending.kind !== 'komi') throw new HttpError(409, '没有待处理的贴目变更请求');
  if (pending.by === seat) throw new HttpError(403, '不能自己同意自己的请求');
  if (typeof action.accept !== 'boolean') throw new HttpError(400, '请选择同意或拒绝');
  if (action.accept) {
    state.komi = pending.value;
    state.game = setKomi(state.game, pending.value);
  }
  state.pending = null;
}

function actionRequestSettle(state, seat) {
  assertPlaying(state);
  assertNoPending(state);
  state.pending = { kind: 'settle', by: seat };
}

function actionRespondSettle(state, action, seat) {
  assertPlaying(state);
  const pending = state.pending;
  if (!pending || pending.kind !== 'settle') throw new HttpError(409, '没有待处理的结算请求');
  if (pending.by === seat) throw new HttpError(403, '不能自己同意自己的请求');
  if (typeof action.accept !== 'boolean') throw new HttpError(400, '请选择同意或拒绝');
  if (action.accept) {
    state.game = settleGame(state.game);
    state.phase = 'ended';
  }
  state.pending = null;
}

function applyAction(state, action, row, seat) {
  switch (action.type) {
    case 'vote': actionVote(state, action, row, seat); break;
    case 'new-layout': actionNewLayout(state, row); break;
    case 'update-rules': actionUpdateRules(state, action, row, seat); break;
    case 'move': actionMove(state, action, seat); break;
    case 'resign': actionResign(state, seat); break;
    case 'request-undo': actionRequestUndo(state, seat); break;
    case 'respond-undo': actionRespondUndo(state, action, seat); break;
    case 'request-komi': actionRequestKomi(state, action, seat); break;
    case 'respond-komi': actionRespondKomi(state, action, seat); break;
    case 'request-settle': actionRequestSettle(state, seat); break;
    case 'respond-settle': actionRespondSettle(state, action, seat); break;
    default: throw new HttpError(400, '未知操作');
  }
}

async function createRoom(request, env, origin, ctx) {
  const body = await readJson(request);
  const size = Number(body.size);
  const komi = Number(body.komi);
  if (!BOARD_SIZES.includes(size)) throw new HttpError(400, '不支持的棋盘尺寸');
  if (!KOMI_OPTIONS.includes(komi)) throw new HttpError(400, '不支持的贴目规则');

  const hostToken = randomToken();
  const hostHash = await hashToken(hostToken);
  const state = {
    size,
    komi,
    phase: 'waiting',
    votes: { host: null, guest: null },
    proposal: layoutProposal(size),
    game: null,
    pending: null,
  };
  const now = Date.now();
  if (ctx) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(now - ROOM_TTL_MS).run());
  }
  let code = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    code = randomCode();
    try {
      await env.DB.prepare(
        `INSERT INTO rooms (code, host_hash, guest_hash, host_seen, guest_seen, state, version, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, ?, 1, ?, ?)`,
      ).bind(code, hostHash, now, JSON.stringify(state), now, now).run();
      break;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }

  const row = {
    code,
    host_hash: hostHash,
    guest_hash: null,
    host_seen: now,
    guest_seen: null,
    state: JSON.stringify(state),
    version: 1,
  };
  return response({ code, token: hostToken, state: publicState(row, state, 'host') }, 201, origin, env);
}

async function joinRoom(request, env, origin, code) {
  const row = await loadRoom(env, code);
  if (row.guest_hash) throw new HttpError(409, '房间已满');
  const state = parseState(row);
  if (state.phase !== 'waiting') throw new HttpError(409, '对局已经开始或结束');

  const guestToken = randomToken();
  const guestHash = await hashToken(guestToken);
  const now = Date.now();
  state.phase = 'voting';
  state.votes.guest = null;
  const result = await env.DB.prepare(
    `UPDATE rooms SET guest_hash = ?, guest_seen = ?, state = ?, version = version + 1, updated_at = ?
     WHERE code = ? AND guest_hash IS NULL AND version = ?`,
  ).bind(guestHash, now, JSON.stringify(state), now, code, row.version).run();
  if (!result.meta.changes) throw new HttpError(409, '房间状态已变化，请刷新后重试');

  row.guest_hash = guestHash;
  row.guest_seen = now;
  row.state = JSON.stringify(state);
  row.version += 1;
  return response({ code, token: guestToken, state: publicState(row, state, 'guest') }, 200, origin, env);
}

async function getRoom(request, env, origin, code) {
  const row = await loadRoom(env, code);
  const seat = await seatFor(row, bearerToken(request));
  if (!seat) throw new HttpError(401, '需要有效的房间身份，请重新加入');
  await touchSeen(env, row, seat);
  return response({ state: publicState(row, parseState(row), seat) }, 200, origin, env);
}

async function actOnRoom(request, env, origin, code) {
  const body = await readJson(request);
  const action = body.action;
  if (!action || typeof action.type !== 'string') throw new HttpError(400, '缺少操作类型');
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, '需要有效的房间身份，请重新加入');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await loadRoom(env, code);
    const seat = await seatFor(row, token);
    if (!seat) throw new HttpError(401, '需要有效的房间身份，请重新加入');
    const state = parseState(row);
    applyAction(state, action, row, seat);
    if (await saveState(env, row, state, seat)) {
      return response({ state: publicState(row, state, seat) }, 200, origin, env);
    }
  }
  throw new HttpError(409, '房间状态刚刚发生变化，请重试');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);

    if (request.method === 'OPTIONS') {
      if (origin && !allowed.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (origin && !allowed.has(origin)) {
      return new Response(JSON.stringify({ error: '来源不允许' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    try {
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/api/health' && request.method === 'GET') {
        return response({ ok: true, service: 'guqi-online' }, 200, origin, env);
      }

      if (path === '/api/auth/register') {
        if (request.method !== 'POST') throw new HttpError(405, '请求方法不支持');
        return await registerUser(request, env, origin);
      }
      if (path === '/api/auth/login') {
        if (request.method !== 'POST') throw new HttpError(405, '请求方法不支持');
        return await loginUser(request, env, origin);
      }
      if (path === '/api/auth/logout') {
        if (request.method !== 'POST') throw new HttpError(405, '请求方法不支持');
        return await logoutUser(request, env, origin);
      }
      if (path === '/api/auth/me') {
        if (request.method !== 'GET') throw new HttpError(405, '请求方法不支持');
        return await getMe(request, env, origin);
      }

      if (path === '/api/games') {
        const user = await requireAccount(request, env);
        if (request.method === 'GET') return await listGames(request, env, origin, user);
        if (request.method === 'POST') return await saveLocalGame(request, env, origin, user);
        throw new HttpError(405, '请求方法不支持');
      }
      if (path === '/api/games/online') {
        if (request.method !== 'POST') throw new HttpError(405, '请求方法不支持');
        const user = await requireAccount(request, env);
        return await saveOnlineRecord(request, env, origin, user);
      }
      const gameMatch = path.match(/^\/api\/games\/([A-Za-z0-9_-]{8,64})$/);
      if (gameMatch) {
        const user = await requireAccount(request, env);
        const gameId = gameMatch[1];
        if (request.method === 'GET') return await getSavedGame(request, env, origin, user, gameId);
        if (request.method === 'DELETE') return await deleteSavedGame(request, env, origin, user, gameId);
        throw new HttpError(405, '请求方法不支持');
      }

      if (path === '/api/rooms' && request.method === 'POST') {
        return await createRoom(request, env, origin, ctx);
      }

      const parts = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)(?:\/(join|actions))?$/);
      if (parts) {
        const code = parts[1].toUpperCase();
        if (!CODE_PATTERN.test(code)) throw new HttpError(404, '房间号格式不正确');
        const action = parts[2];
        if (!action && request.method === 'GET') return await getRoom(request, env, origin, code);
        if (action === 'join' && request.method === 'POST') return await joinRoom(request, env, origin, code);
        if (action === 'actions' && request.method === 'POST') return await actOnRoom(request, env, origin, code);
        throw new HttpError(405, '请求方法不支持');
      }

      throw new HttpError(404, '接口不存在');
    } catch (error) {
      return errorResponse(error, origin, env);
    }
  },
};
