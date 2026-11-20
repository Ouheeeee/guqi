import { analyzeGroups, judgeScores, BLACK, WHITE, EMPTY } from './game.js?v=1.9.4';

const neighborsOf = (index, size) => {
  const row = Math.floor(index / size);
  const col = index % size;
  const out = [];
  if (row > 0) out.push(index - size);
  if (row + 1 < size) out.push(index + size);
  if (col > 0) out.push(index - 1);
  if (col + 1 < size) out.push(index + 1);
  return out;
};

const countEmpty = (board) => board.reduce((sum, value) => sum + (value === EMPTY ? 1 : 0), 0);

function neutralPoints(board, size) {
  const analysis = analyzeGroups(board, size);
  const out = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const black = new Set();
    const white = new Set();
    for (const next of neighborsOf(index, size)) {
      if (board[next] === BLACK) black.add(analysis.groupIndex[next]);
      else if (board[next] === WHITE) white.add(analysis.groupIndex[next]);
    }
    if (black.size === 1 && white.size === 1) out.push(index);
  }
  return out;
}

function doubleNewPoints(board, size) {
  const analysis = analyzeGroups(board, size);
  const out = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const black = new Set();
    const white = new Set();
    for (const next of neighborsOf(index, size)) {
      if (board[next] === BLACK) black.add(analysis.groupIndex[next]);
      else if (board[next] === WHITE) white.add(analysis.groupIndex[next]);
    }
    const blackDelta = black.size === 0 ? 1 : 1 - black.size;
    const whiteDelta = white.size === 0 ? 1 : 1 - white.size;
    if (blackDelta === 1 && whiteDelta === 1) out.push(index);
  }
  return out;
}

function solveStructured(board, starter, size, komi, timeLimit) {
  const work = board.slice();
  const neutral = neutralPoints(board, size);
  const neutralSet = new Set(neutral);
  const doubles = doubleNewPoints(board, size);
  const paired = new Set();
  for (let i = 0; i + 1 < doubles.length; i += 2) {
    paired.add(doubles[i]);
    paired.add(doubles[i + 1]);
  }
  const skip = new Set([...neutralSet, ...paired]);
  const residual = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === EMPTY && !skip.has(index)) residual.push(index);
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

  const order = () => {
    const analysis = analyzeGroups(work, size);
    const out = [];
    for (const index of residual) {
      if (work[index] !== EMPTY) continue;
      const groups = new Set();
      for (const next of neighborsOf(index, size)) {
        if (work[next] === BLACK || work[next] === WHITE) groups.add(analysis.groupIndex[next]);
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
    const key = work.join('') + '|' + player + '|' + passes;
    const cached = tt.get(key);
    if (cached !== undefined) return cached;
    const ordered = order();
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

  const score = search(starter, residual, neutral.length, -Infinity, Infinity, 0);
  return { solved: !timedOut, score, winner: score < 0 ? BLACK : WHITE, margin: Math.abs(score), bestMove: timedOut ? -1 : bestMove, nodes, ms: performance.now() - started, empty: countEmpty(board) };
}

function chooseRolloutMove(board, size, color) {
  const analysis = analyzeGroups(board, size);
  const entries = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const own = new Set();
    const opponent = new Set();
    for (const next of neighborsOf(index, size)) {
      if (board[next] === color) own.add(analysis.groupIndex[next]);
      else if (board[next] === (color === BLACK ? WHITE : BLACK)) opponent.add(analysis.groupIndex[next]);
    }
    const delta = own.size === 0 ? 1 : 1 - own.size;
    const opponentDelta = opponent.size === 0 ? 1 : 1 - opponent.size;
    entries.push({ index, priority: delta + opponentDelta * 0.35 });
  }
  if (!entries.length) return -1;
  entries.sort((a, b) => a.priority - b.priority);
  const bestPriority = entries[0].priority;
  const best = entries.filter((entry) => entry.priority === bestPriority);
  if (Math.random() < 0.08) return entries[Math.floor(Math.random() * entries.length)].index;
  return best[Math.floor(Math.random() * best.length)].index;
}

function estimateWinRate(board, starter, size, komi, timeLimit) {
  const started = performance.now();
  let samples = 0;
  let blackWins = 0;
  const deadline = started + timeLimit;
  while (performance.now() < deadline) {
    const copy = board.slice();
    let player = starter;
    let guard = size * size + 4;
    while (guard-- > 0) {
      const move = chooseRolloutMove(copy, size, player);
      if (move < 0) break;
      copy[move] = player;
      player = player === BLACK ? WHITE : BLACK;
    }
    const analysis = analyzeGroups(copy, size);
    const result = judgeScores({ black: analysis.black, white: analysis.white }, komi);
    samples += 1;
    if (result.winner === BLACK) blackWins += 1;
  }
  return { samples, blackRate: samples ? blackWins / samples : 0, ms: performance.now() - started };
}

export function analyzePosition(board, starter, size, komi, options = {}) {
  const empty = countEmpty(board);
  if (empty === 0) {
    const analysis = analyzeGroups(board, size);
    const result = judgeScores({ black: analysis.black, white: analysis.white }, komi);
    return { kind: 'exact', winner: result.winner, margin: Math.abs(result.adjustedScores.black - result.adjustedScores.white), empty: 0, ms: 0 };
  }
  const exactLimit = options.exactLimit ?? 2500;
  if (empty <= 26) {
    const exact = solveStructured(board, starter, size, komi, exactLimit);
    if (exact.solved) return { kind: 'exact', ...exact };
  }
  const estimate = estimateWinRate(board, starter, size, komi, options.estimateLimit ?? 1200);
  return { kind: 'estimate', ...estimate, empty };
}
