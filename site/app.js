import {
  BLACK,
  EMPTY,
  WHITE,
  BOARD_SIZES,
  PRESET_COUNT,
  KOMI_OPTIONS,
  DEFAULT_KOMI,
  MAX_MATCHES,
  analyzeGroups,
  coordinateLabel,
  createGame,
  colOf,
  formatNumber,
  placeStone,
  remainingCells,
  resignGame,
  resultDescription,
  resultLabel,
  rowOf,
  setKomi,
  startGame,
  undoMove,
  colorName,
} from './game.js?v=1.3.0';

const STAR_POINTS = {
  13: new Set(['3,3', '3,9', '6,6', '9,3', '9,9']),
  15: new Set(['3,3', '3,11', '7,7', '11,3', '11,11']),
};

const dom = {
  board: document.querySelector('#board'),
  boardShell: document.querySelector('#boardShell'),
  coordTop: document.querySelector('#coordTop'),
  coordLeft: document.querySelector('#coordLeft'),
  matchLabel: document.querySelector('#matchLabel'),
  matchTabs: document.querySelector('#matchTabs'),
  matchCount: document.querySelector('#matchCount'),
  matchLimit: document.querySelector('#matchLimit'),
  newMatchBtn: document.querySelector('#newMatchBtn'),
  turnStone: document.querySelector('#turnStone'),
  statusTitle: document.querySelector('#statusTitle'),
  statusSub: document.querySelector('#statusSub'),
  phaseBadge: document.querySelector('#phaseBadge'),
  phaseText: document.querySelector('#phaseText'),
  lastMoveText: document.querySelector('#lastMoveText'),
  scorePanel: document.querySelector('#scorePanel'),
  blackCard: document.querySelector('#blackCard'),
  whiteCard: document.querySelector('#whiteCard'),
  blackCount: document.querySelector('#blackCount'),
  whiteCount: document.querySelector('#whiteCount'),
  blackMetric: document.querySelector('#blackMetric'),
  whiteMetric: document.querySelector('#whiteMetric'),
  scoreFoot: document.querySelector('#scoreFoot'),
  ruleSummary: document.querySelector('#ruleSummary'),
  countToggle: document.querySelector('#countToggle'),
  startBtn: document.querySelector('#startBtn'),
  startBtnText: document.querySelector('#startBtnText'),
  startBtnHint: document.querySelector('#startBtnHint'),
  mobileStartWrap: document.querySelector('#mobileStartWrap'),
  mobileStartBtn: document.querySelector('#mobileStartBtn'),
  newGameBtn: document.querySelector('#newGameBtn'),
  regenerateBtn: document.querySelector('#regenerateBtn'),
  undoBtn: document.querySelector('#undoBtn'),
  resignBtn: document.querySelector('#resignBtn'),
  sizeButtons: Array.from(document.querySelectorAll('[data-size]')),
  komiButtons: Array.from(document.querySelectorAll('[data-komi]')),
  toast: document.querySelector('#toast'),
  resultModal: document.querySelector('#resultModal'),
  resultCard: document.querySelector('.result-card'),
  resultKicker: document.querySelector('#resultKicker'),
  resultStone: document.querySelector('#resultStone'),
  resultTitle: document.querySelector('#resultTitle'),
  resultDesc: document.querySelector('#resultDesc'),
  resultKomi: document.querySelector('#resultKomi'),
  modalBlackScore: document.querySelector('#modalBlackScore'),
  modalWhiteScore: document.querySelector('#modalWhiteScore'),
  modalCloseBtn: document.querySelector('#modalCloseBtn'),
  modalViewBtn: document.querySelector('#modalViewBtn'),
  modalNewBtn: document.querySelector('#modalNewBtn'),
};

let matches = [];
let activeMatchId = null;
let game = null;
let matchSerial = 0;
let countVisible = true;
let previousCounts = null;
let toastTimer = null;
let resultTimer = null;
let modalPreviousFocus = null;
let freshTimer = null;
let pendingCloseMatchId = null;
let pendingCloseTimer = null;

const phaseNames = {
  ready: '布局阶段',
  playing: '对局进行中',
  ended: '终局',
};

const matchStateNames = {
  ready: '待开始',
  playing: '进行中',
  ended: '已结束',
};

const backgroundRegions = [
  document.querySelector('.topbar'),
  document.querySelector('.page'),
  document.querySelector('.footer'),
];

function activeIndex() {
  return matches.findIndex((match) => match.id === activeMatchId);
}

function activeNumber() {
  const index = activeIndex();
  return index >= 0 ? index + 1 : 1;
}

function makeSession({
  size,
  komi = DEFAULT_KOMI,
  start = false,
  id = null,
  previousSignature = null,
} = {}) {
  let state;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    state = createGame(size, { komi });
    if (!previousSignature || state.board.join('') !== previousSignature) break;
  }
  return {
    ...(start ? startGame(state) : state),
    id: id ?? `match-${++matchSerial}`,
  };
}

function commitActive(nextGame) {
  const index = activeIndex();
  if (index === -1) return;
  matches[index] = nextGame;
  game = nextGame;
}

function stoneMarkup(color) {
  const stone = document.createElement('span');
  stone.className = `stone stone-${color === BLACK ? 'black' : 'white'}`;
  stone.dataset.color = String(color);
  stone.setAttribute('aria-hidden', 'true');
  return stone;
}

function buildBoard() {
  const size = game.size;
  dom.boardShell.style.setProperty('--n', String(size));
  dom.coordTop.replaceChildren();
  dom.coordLeft.replaceChildren();

  for (let col = 0; col < size; col += 1) {
    const label = document.createElement('span');
    label.textContent = String.fromCharCode(65 + col);
    dom.coordTop.append(label);
  }

  for (let row = 0; row < size; row += 1) {
    const label = document.createElement('span');
    label.textContent = String(row + 1);
    dom.coordLeft.append(label);
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < size * size; index += 1) {
    const row = rowOf(index, size);
    const col = colOf(index, size);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;
    if (STAR_POINTS[size]?.has(`${row},${col}`)) cell.classList.add('star');
    fragment.append(cell);
  }

  dom.board.replaceChildren(fragment);
  dom.board.style.setProperty('--n', String(size));
  dom.board.setAttribute('aria-label', `${size} 路孤棋棋盘，点击空格落子`);

  if (freshTimer) window.clearTimeout(freshTimer);
  dom.board.classList.remove('board-fresh');
  void dom.board.offsetWidth;
  dom.board.classList.add('board-fresh');
  freshTimer = window.setTimeout(() => {
    dom.board.classList.remove('board-fresh');
    freshTimer = null;
  }, 360);
}

function syncBoard(animateIndex = null) {
  const size = game.size;
  const cells = dom.board.children;
  const isPlaying = game.phase === 'playing';

  dom.board.dataset.phase = game.phase;
  dom.board.dataset.turn = String(game.turn);
  dom.board.classList.toggle('is-playing', isPlaying);
  dom.board.classList.toggle('is-ended', game.phase === 'ended');

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const value = game.board[index];
    const occupied = value !== EMPTY;
    const expectedColor = occupied ? String(value) : null;
    let stone = cell.firstElementChild;

    cell.classList.toggle('occupied', occupied);
    cell.classList.toggle('is-black', value === BLACK);
    cell.classList.toggle('is-white', value === WHITE);

    if (occupied) {
      if (!stone || stone.dataset.color !== expectedColor) {
        stone?.remove();
        stone = stoneMarkup(value);
        cell.append(stone);
      }
      stone.classList.toggle('last', game.lastMove === index);
      stone.classList.toggle('just-moved', animateIndex === index);
    } else if (stone) {
      stone.remove();
    }

    const coordinate = coordinateLabel(index, size);
    if (value === BLACK) {
      cell.setAttribute('aria-label', `${coordinate}，黑棋`);
    } else if (value === WHITE) {
      cell.setAttribute('aria-label', `${coordinate}，白棋`);
    } else {
      cell.setAttribute('aria-label', `${coordinate}，空位${isPlaying ? '，可落子' : ''}`);
    }
    cell.setAttribute('aria-disabled', String(occupied || !isPlaying));
  }
}

function bumpMetric(element) {
  if (!element) return;
  element.classList.remove('metric-bump');
  void element.offsetWidth;
  element.classList.add('metric-bump');
}

function renderStats({ animate = false } = {}) {
  const counts = analyzeGroups(game.board, game.size);
  const blackDisplay = countVisible ? String(counts.black) : '—';
  const whiteDisplay = countVisible ? String(counts.white) : '—';

  if (animate && countVisible && previousCounts) {
    if (counts.black !== previousCounts.black) bumpMetric(dom.blackCount);
    if (counts.white !== previousCounts.white) bumpMetric(dom.whiteCount);
  }

  dom.blackCount.textContent = blackDisplay;
  dom.whiteCount.textContent = whiteDisplay;
  dom.scorePanel.classList.toggle('counts-hidden', !countVisible);
  dom.blackMetric.setAttribute(
    'aria-label',
    countVisible ? `黑方原始孤棋数 ${counts.black} 间` : '黑方孤棋数已隐藏',
  );
  dom.whiteMetric.setAttribute(
    'aria-label',
    countVisible ? `白方原始孤棋数 ${counts.white} 间` : '白方孤棋数已隐藏',
  );
  dom.ruleSummary.textContent = `先手贴 ${formatNumber(game.komi)} 间`;

  const blackActive = game.phase === 'playing' && game.turn === BLACK;
  const whiteActive = game.phase === 'playing' && game.turn === WHITE;
  dom.blackCard.classList.toggle('is-active', blackActive);
  dom.whiteCard.classList.toggle('is-active', whiteActive);
  dom.blackCard.setAttribute(
    'aria-label',
    `黑方，${blackActive ? '行棋中，' : ''}${countVisible ? `原始孤棋数 ${counts.black} 间` : '孤棋数已隐藏'}`,
  );
  dom.whiteCard.setAttribute(
    'aria-label',
    `白方，${whiteActive ? '行棋中，' : ''}${countVisible ? `原始孤棋数 ${counts.white} 间` : '孤棋数已隐藏'}`,
  );

  const hiddenNote = countVisible ? '' : ' · 孤棋数已隐藏';
  const matchNote = `第 ${activeNumber()} 场`;
  if (game.phase === 'ready') {
    const preset = PRESET_COUNT[game.size];
    dom.scoreFoot.textContent = `${matchNote} · 预设黑 ${preset} 子 / 白 ${preset} 子${hiddenNote}`;
  } else if (game.phase === 'playing') {
    dom.scoreFoot.textContent = `${matchNote} · 已落 ${game.history.length} 手 · 余 ${remainingCells(game)} 格${hiddenNote}`;
  } else {
    dom.scoreFoot.textContent = `${matchNote} · 终局 · 共 ${game.history.length} 手${hiddenNote}`;
  }

  previousCounts = counts;
}

function renderStatus() {
  const phase = game.phase;
  dom.phaseBadge.dataset.phase = phase;
  dom.phaseText.textContent = phaseNames[phase];
  dom.matchLabel.textContent = `${game.size} 路 · 贴 ${formatNumber(game.komi)} 间`;

  dom.turnStone.className = 'turn-stone';
  if (phase === 'playing') {
    dom.turnStone.classList.add(game.turn === BLACK ? 'is-black' : 'is-white');
    dom.statusTitle.textContent = `轮到${colorName(game.turn)}落子`;
    dom.statusSub.textContent = `第 ${game.history.length + 1} 手 · 先手贴 ${formatNumber(game.komi)} 间。`;
  } else if (phase === 'ended') {
    dom.turnStone.classList.add(game.result?.winner === WHITE ? 'is-white' : 'is-black');
    dom.statusTitle.textContent = resultLabel(game.result);
    dom.statusSub.textContent = resultDescription(game.result);
  } else {
    dom.turnStone.classList.add('is-idle');
    dom.statusTitle.textContent = '布局已定';
    dom.statusSub.textContent = `先手贴 ${formatNumber(game.komi)} 间 · 请检查预设布局，准备好后开始对局。`;
  }

  if (phase === 'ready') {
    dom.lastMoveText.textContent = '等待开始对局';
  } else if (phase === 'ended') {
    dom.lastMoveText.textContent = `对局结束 · 共 ${game.history.length} 手`;
  } else if (game.history.length === 0) {
    dom.lastMoveText.textContent = '对局开始 · 黑方先行';
  } else {
    const last = game.history[game.history.length - 1];
    dom.lastMoveText.textContent = `上一手 ${colorName(last.color)} ${coordinateLabel(last.index, game.size)} · 第 ${last.moveNumber} 手`;
  }

  document.title = matches.length > 1
    ? `对局 ${activeNumber()} / ${matches.length} · 孤棋`
    : '孤棋 · 双人同屏对战';
}

function renderControls() {
  const isReady = game.phase === 'ready';
  const isPlaying = game.phase === 'playing';
  const atLimit = matches.length >= MAX_MATCHES;

  dom.startBtn.disabled = !isReady;
  dom.mobileStartBtn.disabled = !isReady;
  dom.mobileStartWrap.hidden = !isReady;
  dom.undoBtn.disabled = game.history.length === 0;
  dom.resignBtn.disabled = !isPlaying;
  dom.newGameBtn.disabled = atLimit;
  dom.newGameBtn.title = atLimit
    ? `最多同时保留 ${MAX_MATCHES} 场对局`
    : '保留当前对局，并开启一场新的对局';
  dom.newMatchBtn.disabled = atLimit;
  dom.newMatchBtn.title = atLimit
    ? `已达 ${MAX_MATCHES} 场上限，请先关闭一场`
    : '开启新对局';

  if (isReady) {
    dom.startBtnText.textContent = '开始对局';
    dom.startBtnHint.textContent = '黑方先行';
  } else if (isPlaying) {
    dom.startBtnText.textContent = '对局进行中';
    dom.startBtnHint.textContent = `第 ${game.history.length + 1} 手`;
  } else {
    dom.startBtnText.textContent = '对局已结束';
    dom.startBtnHint.textContent = resultLabel(game.result);
  }

  for (const button of dom.sizeButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.size) === game.size));
  }
  for (const button of dom.komiButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.komi) === game.komi));
  }
}

function revealActiveTab() {
  window.requestAnimationFrame(() => {
    const activeTab = dom.matchTabs.querySelector('.match-tab.is-active');
    if (!activeTab) return;
    const tabRect = activeTab.getBoundingClientRect();
    const containerRect = dom.matchTabs.getBoundingClientRect();
    if (tabRect.left < containerRect.left) {
      dom.matchTabs.scrollLeft -= containerRect.left - tabRect.left + 4;
    } else if (tabRect.right > containerRect.right) {
      dom.matchTabs.scrollLeft += tabRect.right - containerRect.right + 4;
    }
  });
}

function clearPendingCloseState() {
  if (pendingCloseTimer) window.clearTimeout(pendingCloseTimer);
  pendingCloseTimer = null;
  pendingCloseMatchId = null;
}

function resetPendingClose() {
  const pendingId = pendingCloseMatchId;
  clearPendingCloseState();
  if (!pendingId) return;
  const button = dom.matchTabs.querySelector(`[data-close-match-id="${pendingId}"]`);
  if (!button) return;
  button.classList.remove('is-confirming');
  button.setAttribute('aria-label', button.dataset.closeLabel);
  button.title = button.dataset.closeLabel;
}

function armCloseConfirm(button) {
  resetPendingClose();
  pendingCloseMatchId = button.dataset.closeMatchId;
  button.classList.add('is-confirming');
  button.setAttribute('aria-label', '再次点击确认关闭本局');
  button.title = '再次点击确认关闭';
  pendingCloseTimer = window.setTimeout(resetPendingClose, 3600);
  showToast('再次点击 × 确认关闭该场对局');
}

function focusActiveTab() {
  const activeTab = dom.matchTabs.querySelector('.match-tab.is-active .match-tab-main');
  activeTab?.focus({ preventScroll: true });
}

function renderMatchTabs() {
  clearPendingCloseState();
  const tabs = matches.map((match, index) => {
    const isActive = match.id === activeMatchId;
    const stateLabel = matchStateNames[match.phase];
    const resultNote = match.phase === 'ended' && match.result
      ? `，${resultLabel(match.result)}`
      : '';

    const tab = document.createElement('div');
    tab.className = `match-tab${isActive ? ' is-active' : ''}`;
    tab.dataset.matchId = match.id;
    tab.setAttribute('role', 'presentation');

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'match-tab-main';
    select.dataset.matchId = match.id;
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(isActive));
    select.tabIndex = isActive ? 0 : -1;
    select.setAttribute(
      'aria-label',
      `对局 ${index + 1}，${stateLabel}，${match.size} 路，先手贴 ${formatNumber(match.komi)} 间${resultNote}`,
    );
    select.title = `对局 ${index + 1} · ${match.size} 路 · 先手贴 ${formatNumber(match.komi)} 间 · ${stateLabel}${resultNote}`;

    const number = document.createElement('span');
    number.className = 'match-tab-no';
    number.textContent = String(index + 1).padStart(2, '0');
    const state = document.createElement('span');
    state.className = 'match-tab-state';
    state.textContent = stateLabel;
    select.append(number, state);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'match-tab-close';
    close.dataset.closeMatchId = match.id;
    close.tabIndex = isActive ? 0 : -1;
    close.textContent = '×';
    close.dataset.closeLabel = `关闭对局 ${index + 1}`;
    close.setAttribute('aria-label', close.dataset.closeLabel);
    close.title = close.dataset.closeLabel;

    tab.append(select, close);
    return tab;
  });

  dom.matchTabs.replaceChildren(...tabs);
  dom.matchCount.textContent = String(matches.length);
  dom.matchLimit.textContent = `/ ${MAX_MATCHES}`;
  revealActiveTab();
}

function renderAll(options = {}) {
  syncBoard(options.animateMove ?? null);
  renderStatus();
  renderStats({ animate: Boolean(options.animateCounts) });
  renderControls();
  renderMatchTabs();
}

function hideToast() {
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = null;
  dom.toast.classList.remove('is-visible');
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

function clearResultTimer() {
  if (resultTimer) {
    window.clearTimeout(resultTimer);
    resultTimer = null;
  }
}

function setBackgroundInert(isInert) {
  for (const region of backgroundRegions) {
    if (region) region.inert = isInert;
  }
}

function closeResult({ restoreFocus = true } = {}) {
  clearResultTimer();
  if (dom.resultModal.hidden) return;
  dom.resultModal.hidden = true;
  document.body.classList.remove('modal-open');
  setBackgroundInert(false);
  const target = modalPreviousFocus;
  modalPreviousFocus = null;
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      if (target && !target.disabled && document.contains(target)) {
        target.focus({ preventScroll: true });
      } else {
        focusActiveTab();
      }
    });
  }
}

function renderResultContent() {
  const result = game.result;
  const title = resultLabel(result);
  const reason = result.reason === 'resign'
    ? '认输'
    : result.rawTie
      ? '平局裁定'
      : result.handicapTie
        ? '贴目同数'
        : '棋枰已满';
  dom.resultKicker.textContent = `对局 ${activeNumber()} · 终局 · ${reason}`;
  dom.resultStone.className = `result-stone ${result.winner === BLACK ? 'is-black' : 'is-white'}`;
  dom.resultTitle.textContent = title;
  dom.resultDesc.textContent = resultDescription(result);
  dom.modalBlackScore.textContent = String(result.scores.black);
  dom.modalWhiteScore.textContent = String(result.scores.white);
  dom.resultKomi.textContent = `先手贴 ${formatNumber(result.komi)} 间 · 贴目后 黑 ${formatNumber(result.adjustedScores.black)} / 白 ${formatNumber(result.adjustedScores.white)} 间`;

  const atLimit = matches.length >= MAX_MATCHES;
  dom.modalNewBtn.disabled = atLimit;
  dom.modalNewBtn.textContent = atLimit ? `已达 ${MAX_MATCHES} 场上限` : '再开一局';
  dom.modalNewBtn.title = atLimit ? '请先关闭一场，再开启新对局' : '保留本场并开启新对局';
}

function openResult() {
  if (!game.result || !dom.resultModal.hidden) return;

  hideToast();
  renderResultContent();
  modalPreviousFocus = document.activeElement;
  dom.resultModal.hidden = false;
  document.body.classList.add('modal-open');
  setBackgroundInert(true);
  dom.resultCard.focus({ preventScroll: true });
}

function scheduleResult() {
  clearResultTimer();
  resultTimer = window.setTimeout(() => {
    resultTimer = null;
    openResult();
  }, 280);
}

function focusFirstPlayable() {
  const cell = Array.from(dom.board.children).find((candidate) => !candidate.classList.contains('occupied'));
  if (!cell) return;
  for (const other of dom.board.children) other.tabIndex = -1;
  cell.tabIndex = 0;
  cell.focus({ preventScroll: true });
}

function switchMatch(id, { focusTab = false, announce = true } = {}) {
  const target = matches.find((match) => match.id === id);
  if (!target) return;

  if (id === activeMatchId) {
    if (focusTab) focusActiveTab();
    return;
  }

  clearResultTimer();
  closeResult({ restoreFocus: false });
  resetPendingClose();
  activeMatchId = target.id;
  game = target;
  previousCounts = null;
  buildBoard();
  renderAll();
  if (announce) showToast(`已切换到第 ${activeNumber()} 场对局`);
  if (focusTab) window.requestAnimationFrame(focusActiveTab);
}

function handleNewGame() {
  if (matches.length >= MAX_MATCHES) {
    showToast(`最多同时保留 ${MAX_MATCHES} 场对局，请先关闭一场`);
    return;
  }

  clearResultTimer();
  closeResult({ restoreFocus: false });
  const source = game;
  const next = makeSession({
    size: source.size,
    komi: source.komi,
    start: true,
    previousSignature: source.board.join(''),
  });

  matches.push(next);
  activeMatchId = next.id;
  game = next;
  previousCounts = null;
  buildBoard();
  renderAll();
  showToast(`已开启第 ${matches.length} 场 · 原对局已保留`);
  window.requestAnimationFrame(focusFirstPlayable);
}

function handleRegenerate() {
  const previousSignature = game.board.join('');
  const next = makeSession({
    size: game.size,
    komi: game.komi,
    start: false,
    id: game.id,
    previousSignature,
  });
  clearResultTimer();
  closeResult({ restoreFocus: false });
  commitActive(next);
  buildBoard();
  renderAll();
  showToast('本场预设布局已重新生成 · 点击「开始对局」');
}

function handleStart() {
  if (game.phase !== 'ready') return;
  commitActive(startGame(game));
  renderAll();
  showToast('对局开始 · 黑方先行');
  window.requestAnimationFrame(focusFirstPlayable);
}

function handleUndo() {
  if (game.history.length === 0) return;
  clearResultTimer();
  closeResult({ restoreFocus: false });
  commitActive(undoMove(game));
  renderAll({ animateCounts: true });
  showToast(`已悔棋 · 轮到${colorName(game.turn)}落子`);
}

function handleResign() {
  if (game.phase !== 'playing') return;
  commitActive(resignGame(game));
  renderAll({ animateCounts: true });
  openResult();
}

function handleCell(index) {
  if (game.phase !== 'playing') return;
  if (!Number.isInteger(index) || game.board[index] !== EMPTY) return;

  const next = placeStone(game, index);
  if (next === game) return;

  commitActive(next);
  renderAll({ animateMove: index, animateCounts: true });
  if (game.phase === 'ended') scheduleResult();
}

function handleSizeChange(size) {
  if (!BOARD_SIZES.includes(size) || size === game.size) return;
  clearResultTimer();
  closeResult({ restoreFocus: false });
  const next = makeSession({
    size,
    komi: game.komi,
    start: false,
    id: game.id,
  });
  commitActive(next);
  buildBoard();
  renderAll();
  showToast(`本场已切换至 ${size} 路棋盘 · 请开始对局`);
}

function handleKomiChange(komi) {
  const value = Number(komi);
  if (!KOMI_OPTIONS.includes(value) || value === game.komi) return;
  commitActive(setKomi(game, value));
  renderAll();
  if (!dom.resultModal.hidden) renderResultContent();
  const resultNote = game.phase === 'ended' ? ` · ${resultLabel(game.result)}` : '';
  showToast(`本场先手贴 ${formatNumber(value)} 间${resultNote}`);
}

function closeMatch(matchId) {
  const index = matches.findIndex((match) => match.id === matchId);
  if (index === -1) return;

  clearResultTimer();
  closeResult({ restoreFocus: false });
  const wasActive = matchId === activeMatchId;
  resetPendingClose();

  // 关闭最后一场时，自动生成一场新的布局，保证页面始终有可操作的对局。
  if (matches.length === 1) {
    const next = makeSession({ size: game.size, komi: game.komi, start: false });
    matches = [next];
    activeMatchId = next.id;
    game = next;
    previousCounts = null;
    buildBoard();
    renderAll();
    showToast('已关闭本场，并新建一场布局');
    window.requestAnimationFrame(focusActiveTab);
    return;
  }

  matches.splice(index, 1);
  if (wasActive) {
    const next = matches[Math.max(0, index - 1)] ?? matches[0];
    activeMatchId = next.id;
    game = next;
    previousCounts = null;
    buildBoard();
  }
  renderAll();
  showToast(`已关闭对局 · 剩余 ${matches.length} 场`);
  window.requestAnimationFrame(focusActiveTab);
}

function handleCountToggle() {
  countVisible = dom.countToggle.checked;
  renderStats();
  showToast(countVisible ? '实时孤棋数已显示' : '实时孤棋数已隐藏');
}

function handleTabsClick(event) {
  const closeButton = event.target.closest('[data-close-match-id]');
  if (closeButton) {
    event.preventDefault();
    event.stopPropagation();
    if (pendingCloseMatchId === closeButton.dataset.closeMatchId) {
      closeMatch(closeButton.dataset.closeMatchId);
    } else {
      armCloseConfirm(closeButton);
    }
    return;
  }

  resetPendingClose();
  const tab = event.target.closest('.match-tab-main');
  if (!tab) return;
  switchMatch(tab.dataset.matchId, { focusTab: true });
}

function handleTabsKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(dom.matchTabs.querySelectorAll('.match-tab-main'));
  if (tabs.length < 2) return;
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex === -1) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = tabs.length - 1;

  event.preventDefault();
  switchMatch(tabs[nextIndex].dataset.matchId, { focusTab: true });
}

function moveCellFocus(index) {
  const cell = dom.board.children[index];
  if (!cell) return;
  for (const other of dom.board.children) other.tabIndex = -1;
  cell.tabIndex = 0;
  cell.focus();
}

function handleBoardKeydown(event) {
  const target = event.target.closest('.cell');
  if (!target) return;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;

  const row = rowOf(index, game.size);
  const col = colOf(index, game.size);
  let nextRow = row;
  let nextCol = col;

  switch (event.key) {
    case 'ArrowUp':
      nextRow = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      nextRow = Math.min(game.size - 1, row + 1);
      break;
    case 'ArrowLeft':
      nextCol = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      nextCol = Math.min(game.size - 1, col + 1);
      break;
    case 'Home':
      nextCol = 0;
      break;
    case 'End':
      nextCol = game.size - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  moveCellFocus(nextRow * game.size + nextCol);
}

function trapModalFocus(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeResult();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    dom.resultCard.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => element.offsetParent !== null);

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

dom.board.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  handleCell(Number(cell.dataset.index));
});

dom.board.addEventListener('keydown', handleBoardKeydown);

dom.board.addEventListener('focusin', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  for (const other of dom.board.children) other.tabIndex = -1;
  cell.tabIndex = 0;
});

dom.matchTabs.addEventListener('click', handleTabsClick);
dom.matchTabs.addEventListener('keydown', handleTabsKeydown);
dom.newMatchBtn.addEventListener('click', handleNewGame);
dom.countToggle.addEventListener('change', handleCountToggle);
dom.startBtn.addEventListener('click', handleStart);
dom.mobileStartBtn.addEventListener('click', handleStart);
dom.newGameBtn.addEventListener('click', handleNewGame);
dom.regenerateBtn.addEventListener('click', handleRegenerate);
dom.undoBtn.addEventListener('click', handleUndo);
dom.resignBtn.addEventListener('click', handleResign);

for (const button of dom.sizeButtons) {
  button.addEventListener('click', () => handleSizeChange(Number(button.dataset.size)));
}

for (const button of dom.komiButtons) {
  button.addEventListener('click', () => handleKomiChange(Number(button.dataset.komi)));
}

dom.modalCloseBtn.addEventListener('click', () => closeResult());
dom.modalViewBtn.addEventListener('click', () => closeResult());
dom.modalNewBtn.addEventListener('click', () => {
  if (dom.modalNewBtn.disabled) return;
  closeResult({ restoreFocus: false });
  handleNewGame();
  window.requestAnimationFrame(focusFirstPlayable);
});
dom.resultModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-modal-close]')) closeResult();
});
dom.resultModal.addEventListener('keydown', trapModalFocus);

const initialMatch = makeSession({ size: 13, komi: DEFAULT_KOMI, start: false });
matches = [initialMatch];
activeMatchId = initialMatch.id;
game = initialMatch;

buildBoard();
renderAll();

// 便于自动化验收：只读快照，不暴露任何可修改入口。
Object.defineProperty(window, '__guqi', {
  value: {
    snapshot: () => {
      const counts = analyzeGroups(game.board, game.size);
      return {
        activeId: activeMatchId,
        matchCount: matches.length,
        matchLimit: MAX_MATCHES,
        activeIndex: activeIndex(),
        size: game.size,
        komi: game.komi,
        phase: game.phase,
        turn: game.turn,
        moves: game.history.length,
        counts: { black: counts.black, white: counts.white },
        result: game.result,
        matches: matches.map((match, index) => ({
          index: index + 1,
          id: match.id,
          size: match.size,
          komi: match.komi,
          phase: match.phase,
          moves: match.history.length,
          result: match.result,
        })),
      };
    },
  },
  configurable: false,
  writable: false,
});
