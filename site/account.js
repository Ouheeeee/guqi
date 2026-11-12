import {
  getMe,
  loginAccount,
  registerAccount,
  logoutAccount,
  listSavedGames,
  getSavedGame,
  deleteSavedGame,
} from './auth-client.js?v=1.5.0';
import {
  BLACK,
  WHITE,
  colorName,
  coordinateLabel,
  formatNumber,
  resultDescription,
  resultLabel,
} from './game.js?v=1.5.0';

const $ = (selector) => document.querySelector(selector);
const dom = {
  loadingView: $('#loadingView'),
  authView: $('#authView'),
  dashboardView: $('#dashboardView'),
  loginTab: $('#loginTab'),
  registerTab: $('#registerTab'),
  authForm: $('#authForm'),
  authTitle: $('#authTitle'),
  authLead: $('#authLead'),
  authEmail: $('#authEmail'),
  authDisplayName: $('#authDisplayName'),
  displayNameField: $('#displayNameField'),
  authPassword: $('#authPassword'),
  authPasswordHint: $('#authPasswordHint'),
  authError: $('#authError'),
  authSubmit: $('#authSubmit'),
  profileInitial: $('#profileInitial'),
  profileName: $('#profileName'),
  profileEmail: $('#profileEmail'),
  profileJoined: $('#profileJoined'),
  logoutBtn: $('#logoutBtn'),
  localCount: $('#localCount'),
  onlineCount: $('#onlineCount'),
  localList: $('#localList'),
  onlineList: $('#onlineList'),
  localEmpty: $('#localEmpty'),
  onlineEmpty: $('#onlineEmpty'),
  refreshLibrary: $('#refreshLibrary'),
  recordModal: $('#recordModal'),
  recordClose: $('#recordClose'),
  recordKind: $('#recordKind'),
  recordTitle: $('#recordTitle'),
  recordSummary: $('#recordSummary'),
  recordScores: $('#recordScores'),
  recordMoves: $('#recordMoves'),
  toast: $('#toast'),
};

let authMode = 'login';
let currentUser = null;
let savedGames = [];
let toastTimer = null;
let recordOpener = null;
const returnTo = safeReturnTo(new URLSearchParams(location.search).get('return'));

function safeReturnTo(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return null;
    if (!/\.html?$/.test(url.pathname) && !url.pathname.endsWith('/')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
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

function setAuthError(message = '') {
  dom.authError.textContent = message;
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatJoined(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(timestamp));
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function resultText(game) {
  if (game.phase !== 'ended' || !game.result) {
    return game.phase === 'playing' ? '进行中' : '待开始';
  }
  return resultLabel(game.result);
}

function gamePhaseText(game) {
  if (game.phase === 'playing') return '进行中';
  if (game.phase === 'ended') return game.winner === WHITE ? '白胜' : game.winner === BLACK ? '黑胜' : '已结束';
  return '待开始';
}

function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  dom.loginTab.classList.toggle('is-active', !registering);
  dom.registerTab.classList.toggle('is-active', registering);
  dom.loginTab.setAttribute('aria-selected', String(!registering));
  dom.registerTab.setAttribute('aria-selected', String(registering));
  dom.authTitle.textContent = registering ? '建立你的账户' : '欢迎回来';
  dom.authLead.textContent = registering ? '同一邮箱可用不同密码创建独立账户。' : '继续你的存档与棋谱。';
  dom.displayNameField.hidden = !registering;
  dom.authDisplayName.required = registering;
  dom.authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  dom.authPasswordHint.textContent = registering ? '密码至少 8 个字符。' : '登录已有账户。';
  dom.authSubmit.textContent = registering ? '注册并登录' : '登录';
  setAuthError();
}

function showLoading() {
  dom.loadingView.hidden = false;
  dom.authView.hidden = true;
  dom.dashboardView.hidden = true;
}

function showAuth(message = '') {
  dom.loadingView.hidden = true;
  dom.authView.hidden = false;
  dom.dashboardView.hidden = true;
  setAuthMode(authMode);
  setAuthError(message);
  window.requestAnimationFrame(() => dom.authEmail.focus({ preventScroll: true }));
}

function showDashboard(user) {
  currentUser = user;
  dom.loadingView.hidden = true;
  dom.authView.hidden = true;
  dom.dashboardView.hidden = false;
  const initial = Array.from(user.displayName || '棋')[0] || '棋';
  dom.profileInitial.textContent = initial;
  dom.profileName.textContent = user.displayName;
  dom.profileEmail.textContent = user.email;
  dom.profileJoined.textContent = `加入于 ${formatJoined(user.createdAt)}`;
  loadLibrary();
}

function addAction(container, label, className, onClickNode) {
  const element = makeElement(onClickNode.tag || 'button', className, label);
  if (element.tagName === 'BUTTON') element.type = 'button';
  if (onClickNode.href) element.href = onClickNode.href;
  if (onClickNode.onClick) element.addEventListener('click', onClickNode.onClick);
  container.append(element);
  return element;
}

function renderLocalGame(game) {
  const item = makeElement('article', 'account-item');
  const main = makeElement('div', 'account-item-main');
  const kicker = makeElement('div', 'account-item-kicker');
  kicker.append(makeElement('span', '', '同屏存档'), makeElement('strong', '', gamePhaseText(game)));
  main.append(kicker);
  main.append(makeElement('h3', '', game.title));
  main.append(makeElement('p', 'account-item-meta', `${game.size} 路 · 贴 ${formatNumber(game.komi)} 间 · ${game.moves} 手 · 更新于 ${formatDate(game.updatedAt)}`));
  item.append(main);

  const actions = makeElement('div', 'account-item-actions');
  addAction(actions, '继续对局', 'btn btn-soft', {
    tag: 'a',
    href: `./index.html?resume=${encodeURIComponent(game.id)}`,
  });
  addAction(actions, '查看棋谱', 'btn btn-soft', {
    onClick: () => openRecord(game),
  });
  addAction(actions, '删除', 'text-button', {
    onClick: () => removeGame(game),
  });
  item.append(actions);
  return item;
}

function renderOnlineGame(game) {
  const item = makeElement('article', 'account-item');
  const main = makeElement('div', 'account-item-main');
  const kicker = makeElement('div', 'account-item-kicker');
  kicker.append(makeElement('span', '', '联机棋谱'), makeElement('strong', '', gamePhaseText(game)));
  main.append(kicker);
  main.append(makeElement('h3', '', game.title));
  main.append(makeElement('p', 'account-item-meta', `${game.size} 路 · 贴 ${formatNumber(game.komi)} 间 · ${game.moves} 手 · ${formatDate(game.updatedAt)}`));
  item.append(main);

  const actions = makeElement('div', 'account-item-actions');
  addAction(actions, '查看棋谱', 'btn btn-soft', {
    onClick: () => openRecord(game),
  });
  addAction(actions, '删除', 'text-button', {
    onClick: () => removeGame(game),
  });
  item.append(actions);
  return item;
}

function renderLibrary() {
  const local = savedGames.filter((game) => game.kind === 'local');
  const online = savedGames.filter((game) => game.kind === 'online');
  dom.localCount.textContent = String(local.length);
  dom.onlineCount.textContent = String(online.length);
  dom.localList.replaceChildren(...local.map(renderLocalGame));
  dom.onlineList.replaceChildren(...online.map(renderOnlineGame));
  for (const list of [dom.localList, dom.onlineList]) {
    [...list.children].forEach((item, index) => item.style.setProperty('--i', String(index)));
  }
  dom.localEmpty.hidden = local.length > 0;
  dom.onlineEmpty.hidden = online.length > 0;
}

async function loadLibrary() {
  if (!currentUser) return;
  dom.refreshLibrary.disabled = true;
  try {
    savedGames = await listSavedGames();
    renderLibrary();
  } catch (error) {
    if (error.status === 401) {
      currentUser = null;
      showAuth('登录状态已过期，请重新登录。');
    } else {
      showToast(error.message || '读取棋谱失败');
    }
  } finally {
    dom.refreshLibrary.disabled = false;
  }
}

async function removeGame(game) {
  if (!window.confirm(`确定删除「${game.title}」吗？此操作无法撤销。`)) return;
  try {
    await deleteSavedGame(game.id);
    savedGames = savedGames.filter((item) => item.id !== game.id);
    renderLibrary();
    showToast('已删除');
  } catch (error) {
    showToast(error.message || '删除失败');
  }
}

async function openRecord(game) {
  recordOpener = document.activeElement;
  dom.recordTitle.textContent = game.title;
  dom.recordKind.textContent = game.kind === 'online' ? '联机棋谱' : '云端存档';
  dom.recordSummary.textContent = '正在读取棋谱…';
  dom.recordScores.replaceChildren();
  dom.recordMoves.replaceChildren();
  dom.recordModal.hidden = false;
  dom.recordClose.focus({ preventScroll: true });
  try {
    const detail = await getSavedGame(game.id);
    const state = detail.state;
    const result = state.result;
    dom.recordTitle.textContent = detail.title;
    dom.recordKind.textContent = detail.kind === 'online' ? '联机棋谱' : '云端存档';
    if (result) {
      dom.recordSummary.textContent = resultDescription(result);
      const black = makeElement('span', '', `黑 ${result.scores.black} 间`);
      const white = makeElement('span', '', `白 ${result.scores.white} 间`);
      const komi = makeElement('span', '', `先手贴 ${formatNumber(result.komi)} 间`);
      dom.recordScores.append(black, white, komi);
    } else {
      dom.recordSummary.textContent = `${detail.size} 路 · 贴 ${formatNumber(detail.komi)} 间 · ${detail.phase === 'playing' ? '进行中' : '待开始'} · 共 ${detail.moves} 手`;
    }
    if (!state.history.length) {
      dom.recordMoves.append(makeElement('li', 'record-empty', '还没有落子。'));
      return;
    }
    for (const move of state.history) {
      const item = makeElement('li', move.color === WHITE ? 'is-white' : '');
      item.append(makeElement('strong', '', String(move.moveNumber ?? '').padStart(2, '0')));
      item.append(makeElement('em', '', `${colorName(move.color)} ${coordinateLabel(move.index, state.size)}`));
      dom.recordMoves.append(item);
    }
  } catch (error) {
    dom.recordSummary.textContent = error.message || '棋谱读取失败';
  }
}

function closeRecord() {
  if (dom.recordModal.hidden) return;
  dom.recordModal.hidden = true;
  if (recordOpener && document.contains(recordOpener)) {
    recordOpener.focus({ preventScroll: true });
  }
  recordOpener = null;
}

function setBusy(busy) {
  dom.authSubmit.disabled = busy;
  dom.authSubmit.textContent = busy
    ? (authMode === 'register' ? '注册中…' : '登录中…')
    : (authMode === 'register' ? '注册并登录' : '登录');
  for (const input of dom.authForm.querySelectorAll('input')) input.disabled = busy;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (dom.authSubmit.disabled) return;
  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value;
  const displayName = dom.authDisplayName.value.trim();
  setAuthError();
  if (authMode === 'register' && displayName.length < 1) {
    setAuthError('请输入昵称');
    dom.authDisplayName.focus();
    return;
  }
  if (!email || !password) {
    setAuthError('请填写邮箱和密码');
    return;
  }
  if (password.length < 8) {
    setAuthError('密码至少需要 8 个字符');
    dom.authPassword.focus();
    return;
  }
  setBusy(true);
  try {
    const user = authMode === 'register'
      ? await registerAccount({ email, password, displayName })
      : await loginAccount({ email, password });
    if (returnTo) {
      location.assign(returnTo);
      return;
    }
    showDashboard(user);
    dom.authForm.reset();
    showToast(authMode === 'register' ? '账户已建立' : '已登录');
  } catch (error) {
    setAuthError(error.message || '登录失败');
  } finally {
    setBusy(false);
  }
}

async function handleLogout() {
  await logoutAccount();
  currentUser = null;
  savedGames = [];
  showAuth();
  showToast('已退出登录');
}

function bindEvents() {
  dom.loginTab.addEventListener('click', () => setAuthMode('login'));
  dom.registerTab.addEventListener('click', () => setAuthMode('register'));
  dom.authForm.addEventListener('submit', handleAuthSubmit);
  dom.logoutBtn.addEventListener('click', handleLogout);
  dom.refreshLibrary.addEventListener('click', loadLibrary);
  dom.recordClose.addEventListener('click', closeRecord);
  dom.recordModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-record-close]')) closeRecord();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeRecord();
  });
}

async function bootstrap() {
  bindEvents();
  showLoading();
  const urlError = new URLSearchParams(location.search).get('auth');
  try {
    const user = await getMe();
    if (user) showDashboard(user);
    else showAuth(urlError === 'required' ? '请先登录后继续。' : '');
  } catch {
    showAuth(urlError === 'required' ? '请先登录后继续。' : '');
  }
}

bootstrap();
