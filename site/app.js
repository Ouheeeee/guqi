import {
  BLACK,
  EMPTY,
  WHITE,
  BOARD_SIZES,
  PRESET_COUNT,
  analyzeGroups,
  coordinateLabel,
  createGame,
  colOf,
  placeStone,
  remainingCells,
  resignGame,
  resultDescription,
  resultLabel,
  rowOf,
  startGame,
  undoMove,
  colorName,
} from './game.js';

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
  toast: document.querySelector('#toast'),
  resultModal: document.querySelector('#resultModal'),
  resultCard: document.querySelector('.result-card'),
  resultKicker: document.querySelector('#resultKicker'),
  resultStone: document.querySelector('#resultStone'),
  resultTitle: document.querySelector('#resultTitle'),
  resultDesc: document.querySelector('#resultDesc'),
  modalBlackScore: document.querySelector('#modalBlackScore'),
  modalWhiteScore: document.querySelector('#modalWhiteScore'),
  modalCloseBtn: document.querySelector('#modalCloseBtn'),
  modalViewBtn: document.querySelector('#modalViewBtn'),
  modalNewBtn: document.querySelector('#modalNewBtn'),
};

let game = createGame(13);
let countVisible = true;
let previousCounts = null;
let toastTimer = null;
let resultTimer = null;
let modalPreviousFocus = null;
let freshTimer = null;

const phaseNames = {
  ready: '布局阶段',
  playing: '对局进行中',
  ended: '终局',
};

const backgroundRegions = [
  document.querySelector('.topbar'),
  document.querySelector('.page'),
  document.querySelector('.footer'),
];

function stoneMarkup(color) {
  const stone = document.createElement('span');
  stone.className = `stone stone-${color === BLACK ? 'black' : 'white'}`;
  stone.dataset.color = String(color);
  stone.setAttribute('aria-hidden', 'true');
  return stone;
}

function layoutSignature() {
  return game.board.join('');
}

function makeGame(size, previousSignature = null) {
  let next = createGame(size);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (next.board.join('') !== previousSignature) break;
    next = createGame(size);
  }
  return next;
}

function buildBoard() {
  const size = game.size;
  dom.boardShell.style.setProperty('--n', String(size));
  dom.matchLabel.textContent = `${size} 路棋盘`;
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
    countVisible ? `黑方孤棋数 ${counts.black} 间` : '黑方孤棋数已隐藏',
  );
  dom.whiteMetric.setAttribute(
    'aria-label',
    countVisible ? `白方孤棋数 ${counts.white} 间` : '白方孤棋数已隐藏',
  );

  const blackActive = game.phase === 'playing' && game.turn === BLACK;
  const whiteActive = game.phase === 'playing' && game.turn === WHITE;
  dom.blackCard.classList.toggle('is-active', blackActive);
  dom.whiteCard.classList.toggle('is-active', whiteActive);
  dom.blackCard.setAttribute(
    'aria-label',
    `黑方，${blackActive ? '行棋中，' : ''}${countVisible ? `孤棋数 ${counts.black} 间` : '孤棋数已隐藏'}`,
  );
  dom.whiteCard.setAttribute(
    'aria-label',
    `白方，${whiteActive ? '行棋中，' : ''}${countVisible ? `孤棋数 ${counts.white} 间` : '孤棋数已隐藏'}`,
  );

  const hiddenNote = countVisible ? '' : ' · 孤棋数已隐藏';
  if (game.phase === 'ready') {
    const preset = PRESET_COUNT[game.size];
    dom.scoreFoot.textContent = `预设布局 · 黑 ${preset} 子 / 白 ${preset} 子${hiddenNote}`;
  } else if (game.phase === 'playing') {
    dom.scoreFoot.textContent = `已落 ${game.history.length} 手 · 余 ${remainingCells(game)} 格${hiddenNote}`;
  } else {
    dom.scoreFoot.textContent = `终局 · 共 ${game.history.length} 手${hiddenNote}`;
  }

  previousCounts = counts;
}

function renderStatus() {
  const phase = game.phase;
  dom.phaseBadge.dataset.phase = phase;
  dom.phaseText.textContent = phaseNames[phase];

  dom.turnStone.className = 'turn-stone';
  if (phase === 'playing') {
    dom.turnStone.classList.add(game.turn === BLACK ? 'is-black' : 'is-white');
    dom.statusTitle.textContent = `轮到${colorName(game.turn)}落子`;
    dom.statusSub.textContent = `第 ${game.history.length + 1} 手 · 横竖相连，斜角不算。`;
  } else if (phase === 'ended') {
    dom.turnStone.classList.add(game.result?.winner === WHITE ? 'is-white' : 'is-black');
    dom.statusTitle.textContent = resultLabel(game.result);
    dom.statusSub.textContent = resultDescription(game.result);
  } else {
    dom.turnStone.classList.add('is-idle');
    dom.statusTitle.textContent = '布局已定';
    dom.statusSub.textContent = '请检查预设布局，准备好后开始对局。';
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
}

function renderControls() {
  const isReady = game.phase === 'ready';
  const isPlaying = game.phase === 'playing';

  dom.startBtn.disabled = !isReady;
  dom.mobileStartBtn.disabled = !isReady;
  dom.mobileStartWrap.hidden = !isReady;
  dom.undoBtn.disabled = game.history.length === 0;
  dom.resignBtn.disabled = !isPlaying;

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
}

function renderAll(options = {}) {
  syncBoard(options.animateMove ?? null);
  renderStatus();
  renderStats({ animate: Boolean(options.animateCounts) });
  renderControls();
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
  }, 2400);
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
        dom.newGameBtn.focus({ preventScroll: true });
      }
    });
  }
}

function openResult() {
  if (!game.result || !dom.resultModal.hidden) return;

  hideToast();
  const result = game.result;
  const title = resultLabel(result);
  dom.resultKicker.textContent = result.reason === 'resign' ? '终局 · 认输' : '终局 · 棋枰已满';
  dom.resultStone.className = `result-stone ${result.winner === BLACK ? 'is-black' : 'is-white'}`;
  dom.resultTitle.textContent = title;
  dom.resultDesc.textContent = resultDescription(result);
  dom.modalBlackScore.textContent = String(result.scores.black);
  dom.modalWhiteScore.textContent = String(result.scores.white);

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

function resetToGame(nextGame, { start = false, message = '' } = {}) {
  clearResultTimer();
  closeResult({ restoreFocus: false });
  game = start ? startGame(nextGame) : nextGame;
  buildBoard();
  renderAll();
  if (message) showToast(message);
}

function handleNewGame() {
  const previous = layoutSignature();
  resetToGame(makeGame(game.size, previous), {
    start: true,
    message: '新对局开始 · 黑方先行',
  });
}

function handleRegenerate() {
  const previous = layoutSignature();
  resetToGame(makeGame(game.size, previous), {
    start: false,
    message: '预设布局已重新生成 · 点击「开始对局」',
  });
}

function handleStart() {
  if (game.phase !== 'ready') return;
  game = startGame(game);
  renderAll();
  showToast('对局开始 · 黑方先行');
  window.requestAnimationFrame(focusFirstPlayable);
}

function handleUndo() {
  if (game.history.length === 0) return;
  clearResultTimer();
  closeResult({ restoreFocus: false });
  game = undoMove(game);
  renderAll({ animateCounts: true });
  showToast(`已悔棋 · 轮到${colorName(game.turn)}落子`);
}

function handleResign() {
  if (game.phase !== 'playing') return;
  game = resignGame(game);
  renderAll({ animateCounts: true });
  openResult();
}

function handleCell(index) {
  if (game.phase !== 'playing') return;
  if (!Number.isInteger(index) || game.board[index] !== EMPTY) return;

  const next = placeStone(game, index);
  if (next === game) return;

  game = next;
  renderAll({ animateMove: index, animateCounts: true });
  if (game.phase === 'ended') scheduleResult();
}

function handleSizeChange(size) {
  if (!BOARD_SIZES.includes(size) || size === game.size) return;
  resetToGame(makeGame(size), {
    start: false,
    message: `已切换至 ${size} 路棋盘 · 请开始对局`,
  });
}

function handleCountToggle() {
  countVisible = dom.countToggle.checked;
  renderStats();
  showToast(countVisible ? '实时孤棋数已显示' : '实时孤棋数已隐藏');
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

dom.modalCloseBtn.addEventListener('click', () => closeResult());
dom.modalViewBtn.addEventListener('click', () => closeResult());
dom.modalNewBtn.addEventListener('click', () => {
  closeResult({ restoreFocus: false });
  handleNewGame();
  window.requestAnimationFrame(focusFirstPlayable);
});
dom.resultModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-modal-close]')) closeResult();
});
dom.resultModal.addEventListener('keydown', trapModalFocus);

buildBoard();
renderAll();

// 便于自动化验收：只读快照，不暴露任何可修改入口。
Object.defineProperty(window, '__guqi', {
  value: {
    snapshot: () => ({
      size: game.size,
      phase: game.phase,
      turn: game.turn,
      moves: game.history.length,
      counts: analyzeGroups(game.board, game.size),
      result: game.result,
    }),
  },
  configurable: false,
  writable: false,
});
