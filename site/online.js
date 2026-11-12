import {
  BLACK,
  WHITE,
  KOMI_OPTIONS,
  formatNumber,
  komiLabel,
  komiRuleText,
  coordinateLabel,
  resultLabel,
  resultDescription,
} from './game.js?v=1.5.1';
import {
  accountUrl,
  initAccountLink,
  saveOnlineRecord,
} from './auth-client.js?v=1.5.1';

const API_BASE = 'https://guqi-online-api.pages.dev';
const TOKEN_PREFIX = 'guqi.online.token.';
const STAR_POINTS = {
  13: new Set(['3,3', '3,9', '6,6', '9,3', '9,9']),
  15: new Set(['3,3', '3,11', '7,7', '11,3', '11,11']),
};

const $ = (selector) => document.querySelector(selector);
const dom = {
  lobbyView: $('#lobbyView'),
  roomView: $('#roomView'),
  createForm: $('#createForm'),
  createBtn: $('#createBtn'),
  createError: $('#createError'),
  createSizeControl: $('#createSizeControl'),
  createKomiControl: $('#createKomiControl'),
  joinForm: $('#joinForm'),
  joinCode: $('#joinCode'),
  joinBtn: $('#joinBtn'),
  joinError: $('#joinError'),
  roomCodeLabel: $('#roomCodeLabel'),
  roomCodeDisplay: $('#roomCodeDisplay'),
  roomCodeTiny: $('#roomCodeTiny'),
  roomTitle: $('#roomTitle'),
  roomSub: $('#roomSub'),
  onlinePhaseKicker: $('#onlinePhaseKicker'),
  copyLinkBtn: $('#copyLinkBtn'),
  accountLink: $('#accountLink'),
  backBtn: $('#backBtn'),
  leaveBtn: $('#leaveBtn'),
  onlineRule: $('#onlineRule'),
  onlineRuleShort: $('#onlineRuleShort'),
  hostPlayer: $('#hostPlayer'),
  guestPlayer: $('#guestPlayer'),
  hostVoteBadge: $('#hostVoteBadge'),
  guestVoteBadge: $('#guestVoteBadge'),
  hostPresence: $('#hostPresence'),
  guestPresence: $('#guestPresence'),
  onlineBoard: $('#onlineBoard'),
  onlineBoardShell: $('#onlineBoardShell'),
  onlineCoordTop: $('#onlineCoordTop'),
  onlineCoordLeft: $('#onlineCoordLeft'),
  onlineLastMove: $('#onlineLastMove'),
  waitingPanel: $('#waitingPanel'),
  waitingCode: $('#waitingCode'),
  waitingCopyBtn: $('#waitingCopyBtn'),
  waitingNewLayoutBtn: $('#waitingNewLayoutBtn'),
  votingPanel: $('#votingPanel'),
  yourVoteText: $('#yourVoteText'),
  opponentVoteText: $('#opponentVoteText'),
  approveBtn: $('#approveBtn'),
  rejectBtn: $('#rejectBtn'),
  newLayoutBtn: $('#newLayoutBtn'),
  playingPanel: $('#playingPanel'),
  turnTitle: $('#turnTitle'),
  onlineBlackCount: $('#onlineBlackCount'),
  onlineWhiteCount: $('#onlineWhiteCount'),
  pendingBox: $('#pendingBox'),
  pendingText: $('#pendingText'),
  pendingActions: $('#pendingActions'),
  acceptPendingBtn: $('#acceptPendingBtn'),
  rejectPendingBtn: $('#rejectPendingBtn'),
  undoBtn: $('#undoBtn'),
  settleBtn: $('#settleBtn'),
  resignBtn: $('#resignBtn'),
  komiRequestButtons: Array.from(document.querySelectorAll('[data-komi-request]')),
  actionHint: $('#actionHint'),
  endPanel: $('#endPanel'),
  onlineResultTitle: $('#onlineResultTitle'),
  onlineResultDesc: $('#onlineResultDesc'),
  resultBlackCount: $('#resultBlackCount'),
  resultWhiteCount: $('#resultWhiteCount'),
  onlineResultKomi: $('#onlineResultKomi'),
  recordBox: $('#recordBox'),
  recordStatus: $('#recordStatus'),
  saveRecordBtn: $('#saveRecordBtn'),
  recordLogin: $('#recordLogin'),
  resultBackBtn: $('#resultBackBtn'),
  toast: $('#toast'),
};

let createSize = 13;
let createKomi = 0.5;
let room = null;
let roomCode = null;
let sessionToken = null;
let pollTimer = null;
let pollInFlight = false;
let actionInFlight = false;
let pollFailures = 0;
let toastTimer = null;
let boardSize = 0;
let lastPhase = null;
let lastPendingKey = null;
let accountUser = null;
let recordRoom = null;
let recordState = 'idle';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function showToast(message) {
  if (toastTimer) window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
    toastTimer = null;
  }, 2600);
}

function setError(element, message = '') {
  if (!element) return;
  element.textContent = message;
}

function setBusy(button, busy, busyLabel, label) {
  if (!button) return;
  button.disabled = busy;
  const text = button.querySelector('span');
  if (text) text.textContent = busy ? busyLabel : label;
}

async function api(path, { method = 'GET', token = sessionToken, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status, '服务器返回异常');
  }
  if (!response.ok) throw new ApiError(response.status, data.error || '请求失败');
  return data;
}

function tokenKey(code) {
  return `${TOKEN_PREFIX}${code}`;
}

function saveToken(code, token) {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    // 无痕浏览可能禁用 localStorage，当前页面仍可继续使用 token。
  }
}

function loadStoredToken(code) {
  try {
    return localStorage.getItem(tokenKey(code));
  } catch {
    return null;
  }
}

function clearStoredToken(code) {
  try {
    localStorage.removeItem(tokenKey(code));
  } catch {
    // ignore
  }
}

function inviteUrl() {
  return `${location.origin}${location.pathname}?room=${roomCode}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('邀请链接已复制');
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('邀请链接已复制');
    } catch {
      showToast('复制失败，请手动复制地址栏链接');
    }
    textarea.remove();
  }
}

function setCreateChoice(kind, value) {
  if (kind === 'size') createSize = Number(value);
  if (kind === 'komi') createKomi = Number(value);
  for (const button of dom.createSizeControl.querySelectorAll('[data-create-size]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.createSize) === createSize));
  }
  for (const button of dom.createKomiControl.querySelectorAll('[data-create-komi]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.createKomi) === createKomi));
  }
}

function setLobbyVisible(visible) {
  dom.lobbyView.hidden = !visible;
  dom.roomView.hidden = visible;
}

function stopPolling() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(delay) {
  stopPolling();
  if (!roomCode || !sessionToken || document.hidden) return;
  pollTimer = window.setTimeout(pollRoom, delay);
}

function pollDelay() {
  if (!room) return 2000;
  if (room.phase === 'waiting') return 2600;
  if (room.phase === 'ended') return 5000;
  return 1400;
}

function showLobby({ message = '', keepCode = false } = {}) {
  stopPolling();
  room = null;
  roomCode = keepCode ? roomCode : null;
  sessionToken = null;
  boardSize = 0;
  lastPhase = null;
  lastPendingKey = null;
  setLobbyVisible(true);
  if (!keepCode) {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + url.search);
  }
  if (message) showToast(message);
}

function enterRoom(code, token, state) {
  roomCode = code.toUpperCase();
  sessionToken = token;
  recordRoom = null;
  recordState = 'idle';
  saveToken(roomCode, token);
  setLobbyVisible(false);
  room = null;
  lastPhase = null;
  lastPendingKey = null;
  const url = new URL(location.href);
  url.searchParams.set('room', roomCode);
  history.replaceState(null, '', url.pathname + url.search);
  applyState(state, { notify: false });
  schedulePoll(pollDelay());
}

async function loadRoom(code, token) {
  sessionToken = token;
  const data = await api(`/api/rooms/${code}`, { token });
  enterRoom(code, token, data.state);
}

async function pollRoom() {
  if (!roomCode || !sessionToken || pollInFlight || actionInFlight) {
    schedulePoll(pollDelay());
    return;
  }
  pollInFlight = true;
  try {
    const data = await api(`/api/rooms/${roomCode}`, { token: sessionToken });
    pollFailures = 0;
    applyState(data.state, { notify: true });
    schedulePoll(pollDelay());
  } catch (error) {
    if (error.status === 401 || error.status === 404) {
      clearStoredToken(roomCode);
      showLobby({ message: error.message, keepCode: true });
    } else {
      pollFailures += 1;
      if (pollFailures === 3) showToast('连接不稳定，正在重试…');
      schedulePoll(Math.min(6000, pollDelay() + pollFailures * 1000));
    }
  } finally {
    pollInFlight = false;
  }
}

function buildBoard(size) {
  boardSize = size;
  dom.onlineBoardShell.style.setProperty('--n', String(size));
  dom.onlineCoordTop.replaceChildren();
  dom.onlineCoordLeft.replaceChildren();
  for (let col = 0; col < size; col += 1) {
    const label = document.createElement('span');
    label.textContent = String.fromCharCode(65 + col);
    dom.onlineCoordTop.append(label);
  }
  for (let row = 0; row < size; row += 1) {
    const label = document.createElement('span');
    label.textContent = String(row + 1);
    dom.onlineCoordLeft.append(label);
  }
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < size * size; index += 1) {
    const row = Math.floor(index / size);
    const col = index % size;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = String(index);
    cell.tabIndex = -1;
    if (STAR_POINTS[size]?.has(`${row},${col}`)) cell.classList.add('star');
    fragment.append(cell);
  }
  dom.onlineBoard.replaceChildren(fragment);
  dom.onlineBoard.style.setProperty('--n', String(size));
  dom.onlineBoard.setAttribute('aria-label', `${size} 路联机棋盘`);
}

function stoneMarkup(color) {
  const stone = document.createElement('span');
  stone.className = `stone stone-${color === 'black' ? 'black' : 'white'}`;
  stone.dataset.color = color;
  stone.setAttribute('aria-hidden', 'true');
  return stone;
}

function isMyTurn() {
  return room?.phase === 'playing' && room.turn === room.youColor && !room.pending && !actionInFlight;
}

function renderBoard() {
  if (!room) return;
  if (boardSize !== room.size) buildBoard(room.size);

  const cells = dom.onlineBoard.children;
  const playable = isMyTurn();
  dom.onlineBoard.dataset.phase = room.phase;
  dom.onlineBoard.dataset.turn = room.turn || 'black';
  dom.onlineBoard.classList.toggle('is-playing', playable);
  let firstPlayable = -1;

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const value = room.board[index];
    const color = value === BLACK ? 'black' : value === WHITE ? 'white' : null;
    const expected = cell.firstElementChild?.dataset.color || null;
    const canPlay = playable && !color;

    cell.classList.toggle('occupied', Boolean(color));
    cell.classList.toggle('is-black', color === 'black');
    cell.classList.toggle('is-white', color === 'white');
    cell.classList.toggle('online-turn', canPlay);

    if (color) {
      if (!cell.firstElementChild || expected !== color) {
        cell.replaceChildren(stoneMarkup(color));
      }
      cell.firstElementChild.classList.toggle('last', room.lastMove === index);
    } else {
      cell.replaceChildren();
    }

    const coordinate = coordinateLabel(index, room.size);
    if (color) cell.setAttribute('aria-label', `${coordinate}，${color === 'black' ? '黑棋' : '白棋'}`);
    else cell.setAttribute('aria-label', `${coordinate}，空位${canPlay ? '，可落子' : ''}`);
    cell.setAttribute('aria-disabled', String(!canPlay));
    cell.tabIndex = canPlay && firstPlayable === -1 ? 0 : -1;
    if (canPlay && firstPlayable === -1) firstPlayable = index;
  }

  dom.onlineLastMove.textContent = lastMoveLabel();
}

function lastMoveLabel() {
  if (!room) return '';
  if (room.phase === 'waiting') return '等待对手加入';
  if (room.phase === 'voting') return '双方确认后开始';
  if (room.phase === 'ended') return `对局结束 · 共 ${room.moveCount} 手`;
  if (!room.lastMove) return '对局开始 · 黑方先行';
  return `上一手 ${room.lastMoveColor === 'black' ? '黑方' : '白方'} ${coordinateLabel(room.lastMove, room.size)} · 第 ${room.moveCount} 手`;
}

function voteText(value) {
  if (value === true) return '已同意';
  if (value === false) return '不同意';
  return '待表态';
}

function voteKind(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'none';
}

function setVoteBadge(element, value, visible) {
  element.hidden = !visible;
  if (!visible) return;
  element.textContent = voteText(value);
  element.dataset.vote = voteKind(value);
}

function setPresence(element, { online, present }) {
  element.classList.remove('is-online', 'is-offline');
  if (!present) {
    element.textContent = '未加入';
    return;
  }
  element.textContent = online ? '在线' : '离线';
  element.classList.add(online ? 'is-online' : 'is-offline');
}

function renderPlayers() {
  const votesVisible = ['waiting', 'voting'].includes(room.phase);
  const host = room.players.host;
  const guest = room.players.guest;
  const youHost = room.you === 'host';
  const hostActive = room.phase === 'playing' && room.turn === 'black';
  const guestActive = room.phase === 'playing' && room.turn === 'white';

  dom.hostPlayer.classList.toggle('is-you', youHost);
  dom.guestPlayer.classList.toggle('is-you', !youHost);
  dom.hostPlayer.classList.toggle('is-turn', hostActive);
  dom.guestPlayer.classList.toggle('is-turn', guestActive);
  dom.hostPlayer.querySelector('.online-player-copy strong').textContent = youHost ? '你 · 黑方' : '对手 · 黑方';
  dom.hostPlayer.querySelector('.online-player-sub').textContent = '房主 · 先手';
  dom.guestPlayer.querySelector('.online-player-copy strong').textContent = youHost ? '对手 · 白方' : '你 · 白方';
  dom.guestPlayer.querySelector('.online-player-sub').textContent = guest ? '客方 · 后手' : '等待加入';
  setPresence(dom.hostPresence, { online: host.online, present: true });
  setPresence(dom.guestPresence, { online: guest?.online, present: Boolean(guest) });
  setVoteBadge(dom.hostVoteBadge, room.votes.host, votesVisible);
  setVoteBadge(dom.guestVoteBadge, room.votes.guest, votesVisible);
}

function renderPhasePanels() {
  const phase = room.phase;
  dom.waitingPanel.hidden = phase !== 'waiting';
  dom.votingPanel.hidden = phase !== 'voting';
  dom.playingPanel.hidden = phase !== 'playing';
  dom.endPanel.hidden = phase !== 'ended';

  const yourVote = room.you === 'host' ? room.votes.host : room.votes.guest;
  const opponentVote = room.you === 'host' ? room.votes.guest : room.votes.host;
  dom.yourVoteText.textContent = voteText(yourVote);
  dom.yourVoteText.dataset.vote = voteKind(yourVote);
  dom.opponentVoteText.textContent = voteText(opponentVote);
  dom.opponentVoteText.dataset.vote = voteKind(opponentVote);
  dom.approveBtn.disabled = actionInFlight || phase !== 'voting';
  dom.rejectBtn.disabled = actionInFlight || phase !== 'voting';
  dom.newLayoutBtn.disabled = actionInFlight || phase !== 'voting';
  dom.approveBtn.classList.toggle('is-selected', yourVote === true);
  dom.rejectBtn.classList.toggle('is-selected', yourVote === false);
  dom.approveBtn.setAttribute('aria-pressed', String(yourVote === true));
  dom.rejectBtn.setAttribute('aria-pressed', String(yourVote === false));
  dom.waitingNewLayoutBtn.disabled = actionInFlight;

  dom.onlineBlackCount.textContent = String(room.counts.black);
  dom.onlineWhiteCount.textContent = String(room.counts.white);
  dom.resultBlackCount.textContent = String(room.counts.black);
  dom.resultWhiteCount.textContent = String(room.counts.white);

  const yourTurn = room.phase === 'playing' && room.turn === room.youColor;
  dom.turnTitle.textContent = yourTurn ? '轮到你落子' : '等待对方落子';
  dom.undoBtn.disabled = actionInFlight || !room.canRequestUndo;
  dom.settleBtn.disabled = actionInFlight || !room.canRequestSettle;
  dom.resignBtn.disabled = actionInFlight;
  for (const button of dom.komiRequestButtons) {
    const value = Number(button.dataset.komiRequest);
    button.disabled = actionInFlight || !room.canRequestKomi || value === room.komi;
    button.setAttribute('aria-pressed', String(value === room.komi));
  }

  renderPending();
}

function renderPending() {
  const pending = room.pending;
  dom.pendingBox.hidden = !pending;
  if (!pending) {
    lastPendingKey = null;
    return;
  }
  const byYou = pending.by === room.you;
  const isUndo = pending.kind === 'undo';
  const isSettle = pending.kind === 'settle';
  if (isUndo) {
    dom.pendingText.textContent = byYou
      ? '你已请求悔棋，正在等待对方确认。'
      : '对方请求悔棋，是否同意撤销上一手？';
  } else if (isSettle) {
    dom.pendingText.textContent = byYou
      ? '你已请求按当前孤棋数立即结算，等待对方确认。'
      : '对方请求按当前孤棋数立即结算，是否同意？';
  } else {
    const requestText = Number(pending.value) === 0
      ? '取消先手贴目'
      : `将先手贴目调整为 ${formatNumber(pending.value)} 间`;
    dom.pendingText.textContent = byYou
      ? `你已申请${requestText}，等待对方确认。`
      : `对方申请${requestText}，是否同意？`;
  }
  dom.pendingActions.hidden = byYou;
  dom.acceptPendingBtn.textContent = isUndo ? '同意悔棋' : isSettle ? '同意结算' : '同意变更';
  dom.rejectPendingBtn.textContent = '拒绝';

  const key = `${pending.kind}:${pending.by}:${pending.value ?? ''}`;
  if (lastPendingKey !== key && !byYou) {
    showToast(isUndo ? '对方发来悔棋请求' : isSettle ? '对方发来立即结算请求' : '对方发来贴目变更请求');
  }
  lastPendingKey = key;
}

function updateRecordUI() {
  const ended = room?.phase === 'ended';
  dom.recordBox.hidden = !ended;
  if (!ended) return;
  dom.recordLogin.href = accountUrl(`online.html?room=${room.code}`);
  if (!accountUser) {
    dom.recordLogin.hidden = false;
    dom.saveRecordBtn.hidden = true;
    dom.recordStatus.textContent = '登录后可以把本局保存为棋谱。';
    return;
  }
  dom.recordLogin.hidden = true;
  if (recordState === 'saving') {
    dom.recordStatus.textContent = '正在把棋谱保存到账户…';
    dom.saveRecordBtn.hidden = true;
  } else if (recordState === 'saved') {
    dom.recordStatus.textContent = '棋谱已保存到账户。';
    dom.saveRecordBtn.hidden = true;
  } else if (recordState === 'failed') {
    dom.recordStatus.textContent = '棋谱保存失败，可以重试。';
    dom.saveRecordBtn.hidden = false;
    dom.saveRecordBtn.textContent = '重试保存';
  } else {
    dom.recordStatus.textContent = '准备保存棋谱…';
    dom.saveRecordBtn.hidden = true;
  }
}

async function maybeSaveOnlineRecord() {
  if (!accountUser || !room || room.phase !== 'ended' || !sessionToken) {
    updateRecordUI();
    return;
  }
  if (recordRoom === room.code) {
    updateRecordUI();
    return;
  }
  recordRoom = room.code;
  recordState = 'saving';
  updateRecordUI();
  try {
    await saveOnlineRecord(room.code, sessionToken);
    recordState = 'saved';
  } catch (error) {
    recordState = 'failed';
    if (error.status === 401) {
      accountUser = null;
      dom.accountLink.textContent = '登录';
    }
  }
  updateRecordUI();
}

async function initAccount() {
  const user = await initAccountLink(dom.accountLink);
  accountUser = user;
  if (user) dom.accountLink.textContent = '我的';
  await maybeSaveOnlineRecord();
}

function renderRoom() {
  if (!room) return;
  dom.roomCodeLabel.textContent = room.code;
  dom.roomCodeDisplay.textContent = room.code;
  dom.roomCodeTiny.textContent = room.code;
  dom.waitingCode.textContent = room.code;
  dom.onlineRule.textContent = `${room.size} 路 · ${komiRuleText(room.komi)}`;
  dom.onlineRuleShort.textContent = `${room.size} 路 · ${komiLabel(room.komi)}`;

  const phaseTitles = {
    waiting: '等待对手加入',
    voting: '请确认开局布局',
    playing: '对局进行中',
    ended: '对局结束',
  };
  const kickers = {
    waiting: 'WAITING',
    voting: 'LAYOUT APPROVAL',
    playing: 'PLAYING',
    ended: 'FINISHED',
  };
  dom.roomTitle.textContent = phaseTitles[room.phase] || '联机对局';
  dom.onlinePhaseKicker.textContent = kickers[room.phase] || 'ONLINE';

  if (room.phase === 'waiting') {
    dom.roomSub.textContent = '把房间码发给朋友，对方加入后即可确认布局。';
  } else if (room.phase === 'voting') {
    dom.roomSub.textContent = '系统已生成预设布局。双方都同意后才开始对局，房主执黑先行。';
  } else if (room.phase === 'playing') {
    const you = room.youColor === 'black' ? '黑方' : '白方';
    dom.roomSub.textContent = `你执${you} · ${room.turn === room.youColor ? '轮到你落子' : '等待对方落子'}`;
  } else {
    dom.roomSub.textContent = resultDescription(room.result);
  }

  renderPlayers();
  renderBoard();
  renderPhasePanels();

  if (room.phase === 'ended') {
    dom.onlineResultTitle.textContent = resultLabel(room.result);
    dom.onlineResultDesc.textContent = resultDescription(room.result);
    dom.onlineResultKomi.textContent = `${komiRuleText(room.result.komi)} · 贴目后 黑 ${formatNumber(room.result.adjustedScores.black)} / 白 ${formatNumber(room.result.adjustedScores.white)} 间`;
  }

  const yourTurn = room.phase === 'playing' && room.turn === room.youColor;
  if (room.pending) {
    dom.actionHint.textContent = room.pending.by === room.you ? '等待对方处理你的请求。' : '请处理对方的请求后再继续落子。';
  } else if (room.phase === 'playing') {
    dom.actionHint.textContent = yourTurn
      ? (room.players[room.you === 'host' ? 'guest' : 'host']?.online ? '点击棋盘空格落子。' : '对手当前离线，你仍可落子。')
      : '等待对方落子。';
  }

  document.title = room.phase === 'waiting'
    ? `等待对手 · 孤棋联机`
    : `${phaseTitles[room.phase]} · 孤棋联机`;

  updateRecordUI();
  if (room.phase === 'ended') void maybeSaveOnlineRecord();
}

function applyState(state, { notify = true } = {}) {
  const previous = room;
  room = state;
  roomCode = state.code;
  renderRoom();
  schedulePoll(pollDelay());

  if (!notify || !previous) {
    lastPhase = state.phase;
    return;
  }
  if (previous.phase === 'waiting' && state.phase === 'voting') {
    showToast('对手已加入，请确认预设布局');
  } else if (previous.phase === 'voting' && state.phase === 'playing') {
    showToast('双方已同意布局 · 对局开始');
  } else if (previous.phase === 'playing' && state.phase === 'ended') {
    showToast('对局结束');
  }
  lastPhase = state.phase;
}

async function sendAction(action, successMessage = '') {
  if (!roomCode || !sessionToken || actionInFlight) return;
  actionInFlight = true;
  renderBoard();
  renderPhasePanels();
  try {
    const data = await api(`/api/rooms/${roomCode}/actions`, {
      method: 'POST',
      token: sessionToken,
      body: { action },
    });
    actionInFlight = false;
    applyState(data.state, { notify: false });
    if (successMessage) showToast(successMessage);
  } catch (error) {
    actionInFlight = false;
    if (error.status === 401) {
      clearStoredToken(roomCode);
      showLobby({ message: error.message, keepCode: true });
    } else {
      showToast(error.message);
      renderBoard();
      renderPhasePanels();
    }
  }
}

async function pollAfterAction() {
  schedulePoll(900);
}

async function createRoom(event) {
  event.preventDefault();
  setError(dom.createError);
  setBusy(dom.createBtn, true, '创建中…', '创建房间');
  try {
    const data = await api('/api/rooms', {
      method: 'POST',
      token: '',
      body: { size: createSize, komi: createKomi },
    });
    enterRoom(data.code, data.token, data.state);
    showToast('房间已创建，等待对手加入');
  } catch (error) {
    setError(dom.createError, error.message);
  } finally {
    setBusy(dom.createBtn, false, '创建中…', '创建房间');
  }
}

async function joinRoom(event) {
  event.preventDefault();
  const code = dom.joinCode.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    setError(dom.joinError, '请输入正确的六位房间码');
    return;
  }
  setError(dom.joinError);
  setBusy(dom.joinBtn, true, '加入中…', '加入对局');
  const stored = loadStoredToken(code);
  try {
    if (stored) {
      try {
        await loadRoom(code, stored);
        return;
      } catch (error) {
        if (error.status !== 401 && error.status !== 404) throw error;
        clearStoredToken(code);
      }
    }
    const data = await api(`/api/rooms/${code}/join`, { method: 'POST', token: '' });
    enterRoom(code, data.token, data.state);
    showToast('已加入房间，请确认布局');
  } catch (error) {
    setError(dom.joinError, error.message);
  } finally {
    setBusy(dom.joinBtn, false, '加入中…', '加入对局');
  }
}

function leaveRoom() {
  // 保留房间 token，避免误点离开后无法回到原座位。
  showLobby({ message: '已返回大厅，可凭房间码重新进入' });
}

function copyInvite() {
  if (!roomCode) return;
  copyText(inviteUrl());
}

async function respondPending(accept) {
  if (!room?.pending) return;
  const pending = room.pending;
  const type = pending.kind === 'undo'
    ? 'respond-undo'
    : pending.kind === 'settle'
      ? 'respond-settle'
      : 'respond-komi';
  await sendAction({ type, accept }, accept ? '已同意' : '已拒绝');
  pollAfterAction();
}

function bindEvents() {
  dom.createForm.addEventListener('submit', createRoom);
  dom.joinForm.addEventListener('submit', joinRoom);
  dom.createSizeControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-create-size]');
    if (button) setCreateChoice('size', button.dataset.createSize);
  });
  dom.createKomiControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-create-komi]');
    if (button) setCreateChoice('komi', button.dataset.createKomi);
  });
  dom.joinCode.addEventListener('input', () => {
    dom.joinCode.value = dom.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setError(dom.joinError);
  });
  dom.copyLinkBtn.addEventListener('click', copyInvite);
  dom.waitingCopyBtn.addEventListener('click', copyInvite);
  dom.backBtn.addEventListener('click', () => showLobby());
  dom.leaveBtn.addEventListener('click', leaveRoom);
  dom.resultBackBtn.addEventListener('click', leaveRoom);
  dom.waitingNewLayoutBtn.addEventListener('click', () => {
    sendAction({ type: 'new-layout' }, '已生成新的预设布局');
    pollAfterAction();
  });
  dom.approveBtn.addEventListener('click', () => {
    sendAction({ type: 'vote', approve: true }, '已同意该布局');
    pollAfterAction();
  });
  dom.rejectBtn.addEventListener('click', () => {
    sendAction({ type: 'vote', approve: false }, '已标记为不同意');
    pollAfterAction();
  });
  dom.newLayoutBtn.addEventListener('click', () => {
    sendAction({ type: 'new-layout' }, '已生成新的预设布局');
    pollAfterAction();
  });
  dom.undoBtn.addEventListener('click', () => {
    sendAction({ type: 'request-undo' }, '已发送悔棋请求');
    pollAfterAction();
  });
  dom.settleBtn.addEventListener('click', () => {
    sendAction({ type: 'request-settle' }, '已发送结算请求，等待对方确认');
    pollAfterAction();
  });
  dom.resignBtn.addEventListener('click', () => {
    if (window.confirm('确定要认输吗？对局将立即结束。')) {
      sendAction({ type: 'resign' }, '你已认输');
      pollAfterAction();
    }
  });
  dom.acceptPendingBtn.addEventListener('click', () => respondPending(true));
  dom.rejectPendingBtn.addEventListener('click', () => respondPending(false));
  for (const button of dom.komiRequestButtons) {
    button.addEventListener('click', () => {
      sendAction({ type: 'request-komi', value: Number(button.dataset.komiRequest) }, '已发送贴目变更请求');
      pollAfterAction();
    });
  }
  dom.onlineBoard.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !cell.classList.contains('online-turn') || !isMyTurn()) return;
    sendAction({ type: 'move', index: Number(cell.dataset.index) });
    pollAfterAction();
  });
  dom.onlineBoard.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const current = event.target.closest('.cell');
    if (!current || !room) return;
    const index = Number(current.dataset.index);
    const row = Math.floor(index / room.size);
    const col = index % room.size;
    let nextRow = row;
    let nextCol = col;
    if (event.key === 'ArrowUp') nextRow = Math.max(0, row - 1);
    if (event.key === 'ArrowDown') nextRow = Math.min(room.size - 1, row + 1);
    if (event.key === 'ArrowLeft') nextCol = Math.max(0, col - 1);
    if (event.key === 'ArrowRight') nextCol = Math.min(room.size - 1, col + 1);
    event.preventDefault();
    const next = dom.onlineBoard.children[nextRow * room.size + nextCol];
    for (const cell of dom.onlineBoard.children) cell.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && roomCode && sessionToken) pollRoom();
  });
}

async function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').toUpperCase();
  if (code) {
    dom.joinCode.value = code;
    const stored = loadStoredToken(code);
    if (stored) {
      try {
        await loadRoom(code, stored);
        return;
      } catch (error) {
        if (error.status === 401 || error.status === 404) {
          clearStoredToken(code);
          setError(dom.joinError, error.message);
        } else {
          setError(dom.joinError, error.message);
        }
      }
    }
    dom.joinCode.focus();
  }
}

bindEvents();
setCreateChoice('size', 13);
setCreateChoice('komi', 0.5);
initAccount();
restoreFromUrl();
