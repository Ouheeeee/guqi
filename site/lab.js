import {
  BLACK,
  WHITE,
  EMPTY,
  analyzeGroups,
  coordinateLabel,
  colorName,
  createGame,
  formatNumber,
  judgeScores,
} from './game.js?v=1.9.3';
import { findSecondLineEyeShapes, describeEyeShape } from './eye-model.js?v=lab14';

const $ = (selector) => document.querySelector(selector);
const dom = {
  shell: $('.lab-shell'),
  board: $('#labBoard'),
  coordTop: $('#labCoordTop'),
  coordLeft: $('#labCoordLeft'),
  source: $('#labSource'),
  file: $('#recordFile'),
  select: $('#gameSelect'),
  policy: $('#policySelect'),
  demoSize: $('#demoSize'),
  aiStart: $('#aiStart'),
  aiExit: $('#aiExit'),
  aiSide: $('#aiSide'),
  aiLevel: $('#aiLevel'),
  aiStatus: $('#aiStatus'),
  stepBar: $('#labStep'),
  slider: $('#labSlider'),
  stepLabel: $('#labStepLabel'),
  prev: $('#labPrev'),
  next: $('#labNext'),
  black: $('#labBlack'),
  white: $('#labWhite'),
  turn: $('#labTurn'),
  empty: $('#labEmpty'),
  rule: $('#labRule'),
  phase: $('#labPhase'),
  judge: $('#labJudge'),
  analyze: $('#labAnalyze'),
  verdict: $('#labVerdict'),
  winbar: $('#labWinbar'),
  winBlack: $('#labWinBlack'),
  winWhite: $('#labWinWhite'),
  candidates: $('#labCandidates'),
  meta: $('#labMeta'),
};

const MAX_ROOT_CANDIDATES = 60;
const SIMULATION_TIME_BUDGET = 2600;
const MIN_ROLLOUTS_PER_CANDIDATE = 4;
const MAX_ROLLOUTS_PER_CANDIDATE = 1200;
const EXACT_EMPTY_LIMIT = 18;
const EXACT_TIME_LIMIT = 12000;

let source = null;
let loadedGames = [];
let step = 0;
let position = [];
let turn = BLACK;
let ended = false;
let busy = false;
let policy = 'baseline';
let aiMode = false;
let aiHumanColor = BLACK;
let aiThinking = false;
let aiTimer = null;
let aiLevel = 'mcts';

function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function stoneMarkup(color) {
  const stone = document.createElement('span');
  stone.className = `stone stone-${color === BLACK ? 'black' : 'white'}`;
  stone.dataset.color = String(color);
  stone.setAttribute('aria-hidden', 'true');
  return stone;
}

function buildBoard(size) {
  dom.shell.style.setProperty('--n', String(size));
  dom.board.style.setProperty('--n', String(size));
  dom.coordTop.replaceChildren();
  dom.coordLeft.replaceChildren();
  for (let col = 0; col < size; col += 1) {
    dom.coordTop.append(makeElement('span', '', String.fromCharCode(65 + col)));
  }
  for (let row = 0; row < size; row += 1) {
    dom.coordLeft.append(makeElement('span', '', String(row + 1)));
  }
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < size * size; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = String(index);
    fragment.append(cell);
  }
  dom.board.replaceChildren(fragment);
  dom.board.setAttribute('aria-label', `${size} 路实验棋盘`);
}

function makeElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function renderBoard() {
  if (!source) return;
  const size = source.size;
  const cells = dom.board.children;
  if (cells.length !== size * size) buildBoard(size);
  const lastMove = step > 0 ? source.history[step - 1] : null;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const value = position[index];
    cell.replaceChildren();
    cell.classList.toggle('occupied', value !== EMPTY);
    cell.classList.toggle('is-black', value === BLACK);
    cell.classList.toggle('is-white', value === WHITE);
    cell.classList.remove('star');
    if (value !== EMPTY) {
      const stone = stoneMarkup(value);
      if (lastMove && lastMove.index === index) stone.classList.add('last');
      cell.append(stone);
      cell.setAttribute('aria-label', `${coordinateLabel(index, size)}，${colorName(value)}`);
    } else {
      cell.setAttribute('aria-label', `${coordinateLabel(index, size)}，空位`);
    }
  }
  dom.stepLabel.textContent = `第 ${step} / ${source.history.length} 手`;
  dom.slider.max = String(source.history.length);
  dom.slider.value = String(step);
  dom.prev.disabled = step === 0;
  dom.next.disabled = step === source.history.length;
  dom.board.setAttribute('aria-label', `实验棋盘，第 ${step} 手，共 ${source.history.length} 手`);
}

function renderStats() {
  if (!source) return;
  const analysis = analyzeGroups(position, source.size);
  const adjusted = { black: analysis.black + source.komi, white: analysis.white };
  dom.black.textContent = String(analysis.black);
  dom.white.textContent = String(analysis.white);
  dom.turn.textContent = colorName(turn);
  dom.empty.textContent = String(position.filter((value) => value === EMPTY).length);
  dom.rule.textContent = `黑方加贴 ${formatNumber(source.komi)} 间后，间数少者胜；同数白胜。`;
  const rem = remainingStats(position, source.size, turn);
  const eyeShapes = ended
    ? []
    : [...findSecondLineEyeShapes(position, source.size, BLACK), ...findSecondLineEyeShapes(position, source.size, WHITE)];
  const eyeText = eyeShapes.slice(0, 2).map((shape) => `${colorName(shape.defender)}${describeEyeShape(shape)}`).join(' / ');
  const basePhase = ended
    ? '终局 · 精确计分'
    : rem.empty <= 50 && rem.activeMerges === 0
      ? `官子阶段 · 中性 ${rem.neutralBoth} / 双方各加一 ${rem.doubleNew} / 单方新块 ${rem.blackOnlyNew + rem.whiteOnlyNew}`
      : `${source.title} · 第 ${step} 手 · 黑 ${adjusted.black} / 白 ${adjusted.white} · 单关 ${rem.neutralBoth}`;
  dom.phase.textContent = eyeText ? `${basePhase} · 二线眼位 ${eyeText}` : basePhase;
}

function setStep(nextStep) {
  if (!source) return;
  step = Math.max(0, Math.min(source.history.length, Number(nextStep) || 0));
  position = source.start.slice();
  for (let index = 0; index < step; index += 1) {
    const move = source.history[index];
    position[move.index] = move.color;
  }
  turn = step % 2 === 0 ? BLACK : WHITE;
  ended = source.ended && step === source.history.length;
  renderBoard();
  renderStats();
  clearOutput();
  if (ended) showExact();
}

function clearOutput() {
  dom.verdict.replaceChildren(makeElement('p', '', '点「自动判定」得到精确结果或 AI 估计。'));
  dom.winbar.hidden = true;
  dom.candidates.replaceChildren();
  dom.meta.textContent = '';
}

function exactResult() {
  const analysis = analyzeGroups(position, source.size);
  return judgeScores({ black: analysis.black, white: analysis.white }, source.komi);
}

function resultText(result) {
  const adjusted = result.adjustedScores;
  const label = result.winner === BLACK ? '黑胜' : '白胜';
  return `${label} · 黑 ${result.scores.black} + 贴 ${formatNumber(source.komi)} = ${formatNumber(adjusted.black)}，白 ${result.scores.white}`;
}

function showExact() {
  if (!source) return;
  const result = exactResult();
  const isDraw = result.isTie;
  dom.verdict.replaceChildren(
    makeElement('p', '', ''),
    makeElement('p', '', ''),
  );
  const first = dom.verdict.children[0];
  first.innerHTML = `<strong class="is-exact">精确判定</strong> · ${result.winner === BLACK ? '黑胜' : '白胜'}${isDraw ? '（同数白胜）' : ''}`;
  dom.verdict.children[1].textContent = resultText(result);
  dom.winbar.hidden = true;
  dom.candidates.replaceChildren();
  dom.meta.textContent = '终局计分是精确的；没有可继续落子的空点。';
}

function adjacentOwnGroups(board, size, index, color, analysis) {
  const row = Math.floor(index / size);
  const col = index % size;
  const groups = new Set();
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
    const next = nr * size + nc;
    if (board[next] === color) groups.add(analysis.groupIndex[next]);
  }
  return groups;
}

function candidateLabel(delta, opponentDelta = 1) {
  if (delta < 0) return `合并 ${1 - delta} 块`;
  if (opponentDelta < 0) return `挡对方合并 ${1 - opponentDelta} 块`;
  if (delta === 0) return '延伸';
  return '新块';
}

function isObviouslyBad(entry) {
  if (entry.delta <= 0) return false;
  if (entry.opponentDelta < 0) return false;
  if (policy === 'conservative') return entry.emptyNeighbors === 0;
  if (policy === 'strict') return true;
  return false;
}

function filterByPolicy(entries) {
  if (policy === 'baseline') return entries;
  const safe = entries.filter((entry) => !isObviouslyBad(entry));
  return safe.length ? safe : entries;
}

function makeRootCandidates() {
  const analysis = analyzeGroups(position, source.size);
  const entries = [];
  for (let index = 0; index < position.length; index += 1) {
    if (position[index] !== EMPTY) continue;
    const own = adjacentOwnGroups(position, source.size, index, turn, analysis);
    const opponent = adjacentOwnGroups(position, source.size, index, otherColor(turn), analysis);
    const delta = own.size === 0 ? 1 : 1 - own.size;
    const opponentDelta = opponent.size === 0 ? 1 : 1 - opponent.size;
    const row = Math.floor(index / source.size);
    const col = index % source.size;
    let emptyNeighbors = 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= source.size || nc < 0 || nc >= source.size) continue;
      if (position[nr * source.size + nc] === EMPTY) emptyNeighbors += 1;
    }
    entries.push({ index, delta, opponentDelta, emptyNeighbors, priority: delta + opponentDelta * 0.35 });
  }
  const sorted = filterByPolicy(entries).sort((a, b) => a.priority - b.priority || a.index - b.index);
  const selected = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry || seen.has(entry.index)) return;
    seen.add(entry.index);
    selected.push(entry);
  };
  if (sorted.length <= MAX_ROOT_CANDIDATES) {
    sorted.forEach(add);
    return selected;
  }
  for (const entry of sorted) {
    if (entry.delta >= 0 || selected.length >= 30) break;
    add(entry);
  }
  for (const entry of sorted) {
    if (entry.delta !== 0 || selected.length >= 44) break;
    add(entry);
  }
  for (const entry of sorted) {
    if (entry.opponentDelta >= 0) continue;
    if (selected.length >= MAX_ROOT_CANDIDATES) break;
    add(entry);
  }
  const rest = sorted.filter((entry) => entry.delta > 0 && entry.opponentDelta >= 0);
  while (selected.length < MAX_ROOT_CANDIDATES && rest.length) {
    add(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  }
  return selected;
}

function chooseRolloutMove(board, size, color) {
  const analysis = analyzeGroups(board, size);
  const entries = [];
  let bestPriority = Infinity;
  let best = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    const own = new Set();
    const opponent = new Set();
    let emptyNeighbors = 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === color) own.add(analysis.groupIndex[next]);
      else if (board[next] === otherColor(color)) opponent.add(analysis.groupIndex[next]);
      else emptyNeighbors += 1;
    }
    const delta = own.size === 0 ? 1 : 1 - own.size;
    const opponentDelta = opponent.size === 0 ? 1 : 1 - opponent.size;
    entries.push({ index, delta, opponentDelta, emptyNeighbors, priority: delta + opponentDelta * 0.35 });
  }
  if (!entries.length) return -1;
  const candidates = filterByPolicy(entries);
  for (const entry of candidates) {
    if (entry.priority < bestPriority) {
      bestPriority = entry.priority;
      best = [entry.index];
    } else if (entry.priority === bestPriority) {
      best.push(entry.index);
    }
  }
  if (Math.random() < 0.08) return candidates[Math.floor(Math.random() * candidates.length)].index;
  return best[Math.floor(Math.random() * best.length)];
}

function simulateGame(board, starter, size) {
  const copy = board.slice();
  let player = starter;
  let guard = size * size + 4;
  while (guard-- > 0) {
    const move = chooseRolloutMove(copy, size, player);
    if (move < 0) break;
    copy[move] = player;
    player = otherColor(player);
  }
  const analysis = analyzeGroups(copy, size);
  const result = judgeScores({ black: analysis.black, white: analysis.white }, source.komi);
  const blackLead = result.adjustedScores.white - result.adjustedScores.black;
  return { winner: result.winner, blackLead };
}

function countEmpty(board) {
  let count = 0;
  for (const value of board) if (value === EMPTY) count += 1;
  return count;
}

function remainingStats(board, size, starter) {
  const analysis = analyzeGroups(board, size);
  let empty = 0;
  let neutralBoth = 0;
  let doubleNew = 0;
  let blackOnlyNew = 0;
  let whiteOnlyNew = 0;
  let activeMerges = 0;
  let creations = 0;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    empty += 1;
    const row = Math.floor(index / size);
    const col = index % size;
    const adjacent = { [BLACK]: new Set(), [WHITE]: new Set() };
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === BLACK) adjacent[BLACK].add(analysis.groupIndex[next]);
      else if (board[next] === WHITE) adjacent[WHITE].add(analysis.groupIndex[next]);
    }
    const blackDelta = adjacent[BLACK].size === 0 ? 1 : 1 - adjacent[BLACK].size;
    const whiteDelta = adjacent[WHITE].size === 0 ? 1 : 1 - adjacent[WHITE].size;
    if (blackDelta === 0 && whiteDelta === 0) neutralBoth += 1;
    else if (blackDelta > 0 && whiteDelta > 0) doubleNew += 1;
    else if (blackDelta > 0) blackOnlyNew += 1;
    else if (whiteDelta > 0) whiteOnlyNew += 1;
    if (blackDelta < 0 || whiteDelta < 0) activeMerges += 1;
    if (blackDelta > 0 || whiteDelta > 0) creations += 1;
  }
  return { empty, neutralBoth, doubleNew, blackOnlyNew, whiteOnlyNew, activeMerges, creations };
}

function isolatedNeutralPoints(board, size) {
  const analysis = analyzeGroups(board, size);
  const out = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    let emptyNeighbors = 0;
    const blackGroups = new Set();
    const whiteGroups = new Set();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === EMPTY) emptyNeighbors += 1;
      else if (board[next] === BLACK) blackGroups.add(analysis.groupIndex[next]);
      else whiteGroups.add(analysis.groupIndex[next]);
    }
    if (emptyNeighbors === 0 && blackGroups.size === 1 && whiteGroups.size === 1) out.push(index);
  }
  return out;
}

function solveStructured(board, starter, size, komi, timeLimit = 5000) {
  const work = board.slice();
  const isolated = isolatedNeutralPoints(board, size);
  const isolatedSet = new Set(isolated);
  const residual = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === EMPTY && !isolatedSet.has(index)) residual.push(index);
  }
  const started = performance.now();
  const tt = new Map();
  let nodes = 0;
  let timedOut = false;
  let bestMove = -2;
  const terminal = () => {
    const analysis = analyzeGroups(work, size);
    const result = judgeScores({ black: analysis.black, white: analysis.white }, komi);
    return result.adjustedScores.black - result.adjustedScores.white;
  };
  const order = (player) => {
    const analysis = analyzeGroups(work, size);
    const out = [];
    for (const index of residual) {
      if (work[index] !== EMPTY) continue;
      const row = Math.floor(index / size);
      const col = index % size;
      const groups = new Set();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const next = nr * size + nc;
        if (work[next] === player) groups.add(analysis.groupIndex[next]);
      }
      out.push([index, groups.size]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  };
  function search(player, remaining, passes, alpha, beta, depth) {
    nodes += 1;
    if ((nodes & 2047) === 0 && performance.now() - started > timeLimit) {
      timedOut = true;
      return 0;
    }
    if (!remaining.length) return terminal();
    const key = work.join('') + '|' + remaining.join(',') + '|' + player + '|' + passes;
    const cached = tt.get(key);
    if (cached !== undefined) return cached;
    const ordered = order(player);
    let best = player === WHITE ? -Infinity : Infinity;
    for (const [index] of ordered) {
      work[index] = player;
      const rest = remaining.filter((value) => value !== index);
      const value = search(player === BLACK ? WHITE : BLACK, rest, passes, alpha, beta, depth + 1);
      work[index] = EMPTY;
      if (timedOut) return best;
      if (player === WHITE) {
        if (value > best) { best = value; if (depth === 0) bestMove = index; }
        if (best > alpha) alpha = best;
      } else {
        if (value < best) { best = value; if (depth === 0) bestMove = index; }
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    if (!timedOut && passes > 0) {
      const value = search(player === BLACK ? WHITE : BLACK, remaining, passes - 1, alpha, beta, depth + 1);
      if (!timedOut) {
        if (player === WHITE) { if (value > best) { best = value; if (depth === 0) bestMove = -1; } }
        else if (value < best) { best = value; if (depth === 0) bestMove = -1; }
      }
    }
    if (!timedOut) tt.set(key, best);
    return best;
  }
  const whiteAdvantage = search(starter, residual, isolated.length, -Infinity, Infinity, 0);
  return {
    solved: !timedOut,
    whiteAdvantage,
    bestMove,
    nodes,
    ms: performance.now() - started,
    ttSize: tt.size,
    passes: isolated.length,
    residual: residual.length,
  };
}

function solveExact(board, starter, size, timeLimit = EXACT_TIME_LIMIT) {
  const work = board.slice();
  const started = performance.now();
  const tt = new Map();
  let nodes = 0;
  let timedOut = false;
  let bestMove = -1;
  let bestValue = starter === WHITE ? -Infinity : Infinity;

  function terminal() {
    const analysis = analyzeGroups(work, size);
    return analysis.black + source.komi - analysis.white;
  }

  function orderedMoves(player) {
    const analysis = analyzeGroups(work, size);
    const empties = [];
    for (let index = 0; index < work.length; index += 1) {
      if (work[index] !== EMPTY) continue;
      const row = Math.floor(index / size);
      const col = index % size;
      const groups = new Set();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const next = nr * size + nc;
        if (work[next] === player) groups.add(analysis.groupIndex[next]);
      }
      empties.push([index, groups.size]);
    }
    return empties.sort((a, b) => b[1] - a[1]);
  }

  function search(player, alpha, beta, depth) {
    nodes += 1;
    if ((nodes & 8191) === 0 && performance.now() - started > timeLimit) {
      timedOut = true;
      return 0;
    }
    const empties = [];
    for (let index = 0; index < work.length; index += 1) {
      if (work[index] === EMPTY) empties.push(index);
    }
    if (!empties.length) return terminal();
    const key = work.join('') + player;
    const cached = tt.get(key);
    if (cached !== undefined) return cached;
    const ordered = orderedMoves(player);
    if (player === WHITE) {
      let best = -Infinity;
      for (const [index] of ordered) {
        work[index] = WHITE;
        const value = search(BLACK, alpha, beta, depth + 1);
        work[index] = EMPTY;
        if (timedOut) return best;
        if (value > best) {
          best = value;
          if (depth === 0) {
            bestValue = value;
            bestMove = index;
          }
        }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      if (!timedOut) tt.set(key, best);
      return best;
    }
    let best = Infinity;
    for (const [index] of ordered) {
      work[index] = BLACK;
      const value = search(WHITE, alpha, beta, depth + 1);
      work[index] = EMPTY;
      if (timedOut) return best;
      if (value < best) {
        best = value;
        if (depth === 0) {
          bestValue = value;
          bestMove = index;
        }
      }
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    if (!timedOut) tt.set(key, best);
    return best;
  }

  const whiteAdvantage = search(starter, -Infinity, Infinity, 0);
  return {
    solved: !timedOut,
    whiteAdvantage,
    bestMove: timedOut ? -1 : bestMove,
    nodes,
    ms: performance.now() - started,
    ttSize: tt.size,
  };
}

function estimate() {
  const started = performance.now();
  const candidates = makeRootCandidates();
  const stats = candidates.map((candidate) => ({
    ...candidate,
    rollouts: 0,
    currentWins: 0,
    blackWins: 0,
    leadSum: 0,
  }));
  const deadline = started + SIMULATION_TIME_BUDGET;

  const runOne = (item) => {
    const board = position.slice();
    board[item.index] = turn;
    const outcome = simulateGame(board, otherColor(turn), source.size);
    item.rollouts += 1;
    if (outcome.winner === turn) item.currentWins += 1;
    if (outcome.winner === BLACK) item.blackWins += 1;
    item.leadSum += outcome.blackLead;
  };

  // Every candidate gets a minimum sample; then round-robin uses the remaining budget evenly.
  for (const item of stats) {
    if (item.rollouts >= MIN_ROLLOUTS_PER_CANDIDATE) continue;
    while (item.rollouts < MIN_ROLLOUTS_PER_CANDIDATE && performance.now() < deadline) runOne(item);
  }
  let progressed = true;
  while (progressed && performance.now() < deadline) {
    progressed = false;
    for (const item of stats) {
      if (performance.now() >= deadline) break;
      if (item.rollouts >= MAX_ROLLOUTS_PER_CANDIDATE) continue;
      runOne(item);
      progressed = true;
    }
  }

  const total = stats.reduce((sum, item) => sum + item.rollouts, 0);
  const results = stats
    .filter((item) => item.rollouts > 0)
    .map((item) => ({
      ...item,
      currentRate: item.currentWins / item.rollouts,
      blackRate: item.blackWins / item.rollouts,
      lead: item.leadSum / item.rollouts,
    }))
    .sort((a, b) => b.currentRate - a.currentRate || b.lead - a.lead);
  const best = results[0] || { currentWins: 0, rollouts: 0, currentRate: 0, blackRate: 0, lead: 0 };
  return {
    results: results.slice(0, 3),
    best,
    blackRate: best.blackRate,
    lead: best.lead,
    total,
    candidates: stats.length,
    perCandidate: stats.length ? Math.round(total / stats.length) : 0,
    ms: performance.now() - started,
  };
}

function showQuietExact(stats) {
  const analysis = analyzeGroups(position, source.size);
  let black = analysis.black;
  let white = analysis.white;
  const neutral = stats.neutralBoth;
  const pairs = stats.doubleNew;
  if (pairs > 0) {
    const firstIsBlack = (neutral % 2 === 0 ? turn : otherColor(turn)) === BLACK;
    const firstCount = Math.ceil(pairs / 2);
    const secondCount = Math.floor(pairs / 2);
    if (firstIsBlack) { black += firstCount; white += secondCount; }
    else { white += firstCount; black += secondCount; }
  }
  const result = judgeScores({ black, white }, source.komi);
  const lead = Math.abs(result.adjustedScores.black - result.adjustedScores.white);
  const winner = result.winner === BLACK ? '黑胜' : '白胜';
  dom.verdict.replaceChildren(makeElement('p', '', ''),
    makeElement('p', '', ''));
  dom.verdict.children[0].innerHTML = `<strong class="is-exact">官子已定</strong> · ${winner}`;
  dom.verdict.children[1].textContent = `${stats.empty} 个剩余点：${neutral} 个双方中性单关，${pairs} 个“谁下谁加一块”的对称点；按等待与交替直接精确计算，${winner}，差 ${formatNumber(lead)} 间。`;
  dom.winbar.hidden = true;
  dom.candidates.replaceChildren();
  dom.meta.textContent = `官子闭式判定 · 中性 ${neutral} / 双方各加一 ${pairs} · ${source.size} 路`;
}

function showExactSolve(result) {
  const winner = result.whiteAdvantage >= 0 ? WHITE : BLACK;
  const lead = Math.abs(result.whiteAdvantage);
  const label = winner === WHITE ? '白胜' : '黑胜';
  dom.verdict.replaceChildren(
    makeElement('p', '', ''),
    makeElement('p', '', ''),
  );
  dom.verdict.children[0].innerHTML = `<strong class="is-exact">精确求解</strong> · ${label}`;
  dom.verdict.children[1].textContent = `${lead === 0 ? '同数白胜' : `${label}方最优结果领先 ${formatNumber(lead)} 间`}；这是双方最优下的终局结果。`;
  dom.winbar.hidden = true;
  dom.candidates.replaceChildren();
  if (result.bestMove === -1) {
    const item = makeElement('div', 'lab-candidate');
    item.append(makeElement('b', '', 'PASS'));
    item.append(makeElement('span', '', `${result.passes} 个孤立中性单关`));
    item.append(makeElement('strong', '', 'EXACT'));
    dom.candidates.append(item);
  } else if (result.bestMove >= 0) {
    const item = makeElement('div', 'lab-candidate');
    item.append(makeElement('b', '', coordinateLabel(result.bestMove, source.size)));
    item.append(makeElement('span', '', '精确最优落点'));
    item.append(makeElement('strong', '', 'EXACT'));
    dom.candidates.append(item);
  }
  dom.meta.textContent = `结构精确搜索 ${result.nodes.toLocaleString()} 节点 · ${Math.round(result.ms)} ms · 残局 ${result.residual} 点 + ${result.passes} 个孤立中性 Pass · ${result.ttSize.toLocaleString()} 个缓存`;
}

function showEstimate(estimateResult, note = '') {
  const blackPct = Math.round(estimateResult.blackRate * 100);
  const whitePct = 100 - blackPct;
  const lead = estimateResult.lead;
  const leadText = Math.abs(lead) < 0.05 ? '大致持平' : lead > 0 ? `黑平均领先 ${formatNumber(lead)} 间` : `白平均领先 ${formatNumber(-lead)} 间`;
  dom.verdict.replaceChildren(
    makeElement('p', '', ''),
    makeElement('p', '', ''),
  );
  dom.verdict.children[0].innerHTML = `<strong class="is-estimate">AI 估计${note ? '（未算清）' : ''}</strong> · 最佳候选胜率：黑 ${blackPct}% / 白 ${whitePct}%`;
  dom.verdict.children[1].textContent = `${leadText.replace('平均','')}；这是最佳候选的 ${estimateResult.best.rollouts} 局结果，总计 ${estimateResult.total} 局。不是精确解。${note ? ` ${note}` : ''}`;
  dom.winbar.hidden = false;
  dom.winBlack.style.width = `${blackPct}%`;
  dom.winWhite.style.width = `${whitePct}%`;
  dom.candidates.replaceChildren();
  for (const [index, candidate] of estimateResult.results.entries()) {
    const item = makeElement('div', 'lab-candidate');
    item.append(makeElement('b', '', coordinateLabel(candidate.index, source.size)));
    item.append(makeElement('span', '', `${candidateLabel(candidate.delta, candidate.opponentDelta)} · 当前方胜率 ${Math.round(candidate.currentRate * 100)}%`));
    item.append(makeElement('strong', '', `#${index + 1}`));
    dom.candidates.append(item);
  }
  dom.meta.textContent = `${estimateResult.candidates} 个候选 · 共 ${estimateResult.total.toLocaleString()} 局 · 约 ${estimateResult.perCandidate} 局/候选 · ${Math.round(estimateResult.ms)} ms · ${source.size} 路 · 策略：${policy}`;
}

async function runAnalysis({ judgeOnly = false } = {}) {
  if (!source || busy) return;
  if (ended) {
    showExact();
    return;
  }
  busy = true;
  const originalJudge = dom.judge.textContent;
  const originalAnalyze = dom.analyze.textContent;
  dom.judge.disabled = true;
  dom.analyze.disabled = true;
  dom.judge.textContent = '计算中…';
  dom.analyze.textContent = '计算中…';
  const emptyCount = countEmpty(position);
  const stats = remainingStats(position, source.size, turn);
  let note = '';
  if (stats.empty > 0 && stats.activeMerges === 0 && stats.blackOnlyNew === 0 && stats.whiteOnlyNew === 0) {
    showQuietExact(stats);
    busy = false;
    dom.judge.disabled = false;
    dom.analyze.disabled = false;
    dom.judge.textContent = originalJudge;
    dom.analyze.textContent = originalAnalyze;
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  try {
    dom.verdict.replaceChildren(makeElement('p', '', '正在做结构精确搜索…'));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const exact = solveStructured(position, turn, source.size, source.komi, 5000);
    if (exact.solved) {
      showExactSolve(exact);
      return;
    }
    note = `${emptyCount} 个空点：${stats.neutralBoth} 中性、${stats.doubleNew} 双方各加一、${stats.blackOnlyNew + stats.whiteOnlyNew} 单方新块、${stats.activeMerges} 有效合并点；结构搜索在 5 秒内未完成，下面只是启发式估计。`;
    dom.verdict.replaceChildren(makeElement('p', '', '精确搜索未完成，继续跑启发式模拟…'));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const result = estimate();
    showEstimate(result, note);
  } catch (error) {
    dom.verdict.replaceChildren(makeElement('p', '', `分析失败：${error.message || error}`));
  } finally {
    busy = false;
    dom.judge.disabled = false;
    dom.analyze.disabled = false;
    dom.judge.textContent = originalJudge;
    dom.analyze.textContent = originalAnalyze;
  }
}

function loadSource(nextSource) {
  if (aiMode) stopAiMode();
  source = nextSource;
  step = nextSource.history.length;
  position = nextSource.start.slice();
  dom.source.textContent = nextSource.title;
  dom.slider.max = String(nextSource.history.length);
  dom.slider.value = String(step);
  buildBoard(nextSource.size);
  setStep(step);
  if (ended) showExact();
}

function clearAiTimer() {
  if (aiTimer) window.clearTimeout(aiTimer);
  aiTimer = null;
}

function updateAiStatus(text) {
  dom.aiStatus.textContent = text || '';
}

function stopAiMode() {
  aiMode = false;
  aiThinking = false;
  clearAiTimer();
  dom.aiStart.hidden = false;
  dom.aiExit.hidden = true;
  dom.stepBar.style.display = '';
  dom.board.classList.remove('ai-mode');
  dom.judge.disabled = false;
  dom.analyze.disabled = false;
  updateAiStatus('');
}

function aiMovePriority(entry, weights) {
  return entry.delta + weights.opp * entry.opponentDelta - weights.space * (entry.emptyNeighbors / 4);
}

function chooseAiMove(board, size, color) {
  const analysis = analyzeGroups(board, size);
  const entries = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    const own = new Set();
    const opponent = new Set();
    let emptyNeighbors = 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === color) own.add(analysis.groupIndex[next]);
      else if (board[next] === otherColor(color)) opponent.add(analysis.groupIndex[next]);
      else emptyNeighbors += 1;
    }
    entries.push({
      index,
      delta: own.size === 0 ? 1 : 1 - own.size,
      opponentDelta: opponent.size === 0 ? 1 : 1 - opponent.size,
      emptyNeighbors,
    });
  }
  if (!entries.length) return -1;
  const weights = { opp: 0.224, random: 0.03, space: 0.093 };
  const eyes = ownEyePoints(board, size, color);
  const eyeKeys = new Set(findSecondLineEyeShapes(board, size, color).flatMap((shape) => shape.keyPoints));
  const safeEntries = entries.filter((entry) => !eyes.has(entry.index));
  const candidates = filterByPolicy(safeEntries.length ? safeEntries : entries);
  if (Math.random() < weights.random) return candidates[Math.floor(Math.random() * candidates.length)].index;
  let best = Infinity;
  const picks = [];
  for (const entry of candidates) {
    const p = aiMovePriority(entry, weights) - (eyeKeys.has(entry.index) ? 0.55 : 0);
    if (p < best) { best = p; picks.length = 0; picks.push(entry.index); }
    else if (p === best) picks.push(entry.index);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

function chooseMctsMove(board, size, color) {
  const allCandidates = makeRootCandidates();
  const eyes = ownEyePoints(board, size, color);
  const safeCandidates = allCandidates.filter((candidate) => !eyes.has(candidate.index));
  const candidates = (safeCandidates.length ? safeCandidates : allCandidates).slice(0, 6);
  if (!candidates.length) return chooseAiMove(board, size, color);
  const stats = candidates.map((candidate) => ({
    index: candidate.index,
    rollouts: 0,
    wins: 0,
    lead: 0,
  }));
  const deadline = performance.now() + 220;
  const runOne = (item) => {
    const next = board.slice();
    next[item.index] = color;
    const outcome = simulateGame(next, otherColor(color), size);
    item.rollouts += 1;
    if (outcome.winner === color) item.wins += 1;
    item.lead += outcome.blackLead;
  };
  for (const item of stats) {
    if (performance.now() >= deadline) break;
    runOne(item);
  }
  let progressed = true;
  while (progressed && performance.now() < deadline) {
    progressed = false;
    for (const item of stats) {
      if (performance.now() >= deadline) break;
      runOne(item);
      progressed = true;
    }
  }
  const scored = stats.map((item) => ({
    ...item,
    rate: item.rollouts ? item.wins / item.rollouts : 0,
    averageLead: item.rollouts ? item.lead / item.rollouts : 0,
  }));
  scored.sort((a, b) => b.rate - a.rate || b.averageLead - a.averageLead);
  return scored[0].index;
}

function ownEyePoints(board, size, color) {
  const seen = new Uint8Array(board.length);
  const eyes = new Set();
  for (let start = 0; start < board.length; start += 1) {
    if (board[start] !== EMPTY || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    const cells = [];
    let bad = false;
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      cells.push(cell);
      const row = Math.floor(cell / size);
      const col = cell % size;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) { bad = true; continue; }
        const next = nr * size + nc;
        if (board[next] === EMPTY) {
          if (!seen[next]) { seen[next] = 1; queue.push(next); }
        } else if (board[next] !== color) {
          bad = true;
        }
      }
    }
    if (!bad) for (const cell of cells) eyes.add(cell);
  }
  return eyes;
}

function abEvaluate(board, size, komi) {
  const analysis = analyzeGroups(board, size);
  let score = 1000 * (analysis.black + komi - analysis.white);
  let blackBest = Infinity;
  let whiteBest = Infinity;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    const blackGroups = new Set();
    const whiteGroups = new Set();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === BLACK) blackGroups.add(analysis.groupIndex[next]);
      else if (board[next] === WHITE) whiteGroups.add(analysis.groupIndex[next]);
    }
    const bd = blackGroups.size === 0 ? 1 : 1 - blackGroups.size;
    const wd = whiteGroups.size === 0 ? 1 : 1 - whiteGroups.size;
    if (bd < blackBest) blackBest = bd;
    if (wd < whiteBest) whiteBest = wd;
  }
  return score + 90 * blackBest - 90 * whiteBest;
}

function abOrderMoves(board, size, color, limit) {
  const analysis = analyzeGroups(board, size);
  const eyeKeys = new Set(findSecondLineEyeShapes(board, size, color).flatMap((shape) => shape.keyPoints));
  const entries = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / size);
    const col = index % size;
    const own = new Set();
    const opponent = new Set();
    let space = 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (board[next] === color) own.add(analysis.groupIndex[next]);
      else if (board[next] === otherColor(color)) opponent.add(analysis.groupIndex[next]);
      else space += 1;
    }
    const delta = own.size === 0 ? 1 : 1 - own.size;
    const oppDelta = opponent.size === 0 ? 1 : 1 - opponent.size;
    entries.push({ index, priority: delta + 0.2727 * oppDelta - 0.0048 * (space / 4) - (eyeKeys.has(index) ? 0.55 : 0) });
  }
  entries.sort((a, b) => a.priority - b.priority);
  const eyes = ownEyePoints(board, size, color);
  const safeEntries = entries.filter((entry) => !eyes.has(entry.index));
  return (safeEntries.length ? safeEntries : entries).slice(0, limit).map((entry) => entry.index);
}

function chooseAbMove(board, size, color, komi, timeLimit = 320) {
  const started = performance.now();
  const tt = new Map();
  let nodes = 0;
  let timedOut = false;
  let bestMove = -1;
  const terminal = (work) => {
    const analysis = analyzeGroups(work, size);
    const result = judgeScores({ black: analysis.black, white: analysis.white }, komi);
    return result.adjustedScores.black - result.adjustedScores.white;
  };
  function search(work, player, depth, alpha, beta) {
    nodes += 1;
    if ((nodes & 511) === 0 && performance.now() - started > timeLimit) {
      timedOut = true;
      return 0;
    }
    let emptyCount = 0;
    for (const value of work) if (value === EMPTY) emptyCount += 1;
    if (emptyCount === 0) return terminal(work);
    if (depth <= 0) return abEvaluate(work, size, komi);
    const key = work.join('') + '|' + player + '|' + depth;
    const cached = tt.get(key);
    if (cached !== undefined) return cached;
    const limit = emptyCount > 80 ? 6 : emptyCount > 40 ? 8 : 10;
    const moves = abOrderMoves(work, size, player, limit);
    const alphaOrig = alpha;
    let best = player === WHITE ? -Infinity : Infinity;
    for (const index of moves) {
      work[index] = player;
      const value = search(work, otherColor(player), depth - 1, alpha, beta);
      work[index] = EMPTY;
      if (timedOut) return best;
      if (player === WHITE) {
        if (value > best) best = value;
        if (best > alpha) alpha = best;
      } else {
        if (value < best) best = value;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    if (!timedOut && best > alphaOrig && best < beta) tt.set(key, best);
    return best;
  }
  const rootMoves = abOrderMoves(board, size, color, Infinity);
  if (!rootMoves.length) return -1;
  for (let depth = 1; depth <= 4; depth += 1) {
    let depthBest = -1;
    let depthValue = color === WHITE ? -Infinity : Infinity;
    for (const index of rootMoves) {
      const work = board.slice();
      work[index] = color;
      const value = search(work, otherColor(color), depth - 1, -Infinity, Infinity);
      if (timedOut) break;
      if (color === WHITE ? value > depthValue : value < depthValue) {
        depthValue = value;
        depthBest = index;
      }
    }
    if (timedOut) break;
    if (depthBest >= 0) bestMove = depthBest;
  }
  return bestMove >= 0 ? bestMove : rootMoves[0];
}

function placeAiMove(index, color) {
  if (position[index] !== EMPTY) return false;
  position[index] = color;
  source.history.push({ index, color, moveNumber: source.history.length + 1 });
  step = source.history.length;
  turn = otherColor(color);
  if (position.every((value) => value !== EMPTY)) {
    ended = true;
    source.ended = true;
    renderBoard();
    renderStats();
    showExact();
    updateAiStatus('终局');
    dom.aiExit.hidden = false;
    aiThinking = false;
    return true;
  }
  renderBoard();
  renderStats();
  clearOutput();
  return true;
}

function scheduleAiMove() {
  if (!aiMode || ended || aiThinking || turn === aiHumanColor) return;
  aiThinking = true;
  updateAiStatus(aiLevel === 'ab' ? 'AB 思考中…' : aiLevel === 'mcts' ? 'MCTS 思考中…' : 'AI 思考中…');
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (!aiMode || ended || turn === aiHumanColor) { aiThinking = false; return; }
    let index = -1;
    const empty = position.filter((value) => value === EMPTY).length;
    if (empty <= 18) {
      const solved = solveExact(position, turn, source.size, 3000);
      if (solved.solved && solved.bestMove >= 0) index = solved.bestMove;
    }
    if (index < 0) {
      if (aiLevel === 'ab') index = chooseAbMove(position, source.size, turn, source.komi, 320);
      else if (aiLevel === 'mcts' && empty <= 70) index = chooseMctsMove(position, source.size, turn);
      else index = chooseAiMove(position, source.size, turn);
    }
    if (index >= 0) placeAiMove(index, turn);
    aiThinking = false;
    if (!ended) updateAiStatus(turn === aiHumanColor ? '轮到你' : 'AI 思考中…');
    if (!ended && turn !== aiHumanColor) scheduleAiMove();
  }, 320);
}

function startAiGame() {
  stopAiMode();
  aiHumanColor = dom.aiSide.value === 'white' ? WHITE : BLACK;
  const size = Number(dom.demoSize.value) || 13;
  const demo = createGame(size, { komi: 0.5 });
  demo.phase = 'playing';
  demo.turn = BLACK;
  loadSource({
    title: `AI 对弈 · ${size} 路 · 你执${aiHumanColor === BLACK ? '黑' : '白'}`,
    size: demo.size,
    komi: demo.komi,
    start: demo.board.slice(),
    history: [],
    ended: false,
  });
  aiMode = true;
  aiThinking = false;
  dom.aiStart.hidden = true;
  dom.aiExit.hidden = false;
  dom.stepBar.style.display = 'none';
  dom.board.classList.add('ai-mode');
  dom.judge.disabled = true;
  dom.analyze.disabled = true;
  updateAiStatus(turn === aiHumanColor ? '轮到你' : 'AI 先手');
  if (turn !== aiHumanColor) scheduleAiMove();
}

function handleAiBoard(event) {
  if (!aiMode || ended || aiThinking || turn !== aiHumanColor) return;
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const index = Number(cell.dataset.index);
  if (!Number.isInteger(index) || position[index] !== EMPTY) return;
  const color = turn;
  if (!placeAiMove(index, color)) return;
  if (!ended) {
    updateAiStatus(aiLevel === 'ab' ? 'AB 思考中…' : aiLevel === 'mcts' ? 'MCTS 思考中…' : 'AI 思考中…');
    scheduleAiMove();
  }
}

function startDemo(size = 13) {
  const demo = createGame(size, { komi: 0.5 });
  demo.phase = 'playing';
  demo.turn = BLACK;
  loadSource({
    title: `体验局面 · ${size} 路`,
    size: demo.size,
    komi: demo.komi,
    start: demo.board.slice(),
    history: [],
    ended: false,
  });
}

function loadRecord(detail) {
  if (!detail?.state) throw new Error('棋谱缺少 state');
  const state = detail.state;
  const size = Number(state.size);
  const start = state.board.slice();
  for (const move of state.history || []) start[move.index] = 0;
  const endedNow = state.phase === 'ended' || (Array.isArray(state.board) && state.board.every((value) => value !== 0));
  loadSource({
    title: detail.title || `${size} 路棋谱`,
    size,
    komi: Number(state.komi),
    start,
    history: (state.history || []).slice(),
    ended: endedNow,
  });
}

async function importFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const games = Array.isArray(data.games) ? data.games : data.game ? [data.game] : [];
  if (!games.length) throw new Error('没有找到 games');
  loadedGames = games;
  dom.select.replaceChildren();
  for (const [index, game] of games.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = game.title || `棋谱 ${index + 1}`;
    dom.select.append(option);
  }
  dom.select.hidden = games.length <= 1;
  loadRecord(games[0]);
}

dom.file.addEventListener('change', async () => {
  const file = dom.file.files?.[0];
  if (!file) return;
  try {
    await importFile(file);
  } catch (error) {
    dom.source.textContent = '导入失败';
    dom.verdict.replaceChildren(makeElement('p', '', error.message || '无法读取 JSON'));
  }
});

dom.policy.addEventListener('change', () => {
  policy = dom.policy.value;
  clearOutput();
});

dom.select.addEventListener('change', () => {
  const game = loadedGames[Number(dom.select.value)];
  if (game) loadRecord(game);
});

dom.prev.addEventListener('click', () => setStep(step - 1));
dom.next.addEventListener('click', () => setStep(step + 1));
dom.slider.addEventListener('input', () => setStep(Number(dom.slider.value)));
dom.judge.addEventListener('click', () => runAnalysis({ judgeOnly: true }));
dom.analyze.addEventListener('click', () => runAnalysis({ judgeOnly: false }));

dom.demoSize.addEventListener('change', () => { if (!aiMode) startDemo(Number(dom.demoSize.value)); });
dom.aiLevel.addEventListener('change', () => { aiLevel = dom.aiLevel.value; });
  dom.aiStart.addEventListener('click', startAiGame);
dom.aiExit.addEventListener('click', () => { stopAiMode(); startDemo(Number(dom.demoSize.value) || 13); });
dom.board.addEventListener('click', handleAiBoard);
startDemo(Number(dom.demoSize.value) || 13);


