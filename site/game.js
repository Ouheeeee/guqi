/**
 * 孤棋 · 游戏规则引擎
 *
 * 棋盘以长度 N*N 的一维数组表示：
 *   0 = 空位，1 = 黑棋，2 = 白棋
 * 黑方先行，终局以“间”（连通块数）少者获胜。
 * 先手黑方按规则贴 0.5 / 1 / 1.5 间，再比较双方调整后的间数；
 * 贴目后同数或原始间数相同，均由后手白方获胜。
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const BOARD_SIZES = [13, 15];
export const PRESET_COUNT = Object.freeze({ 13: 6, 15: 7 });
export const KOMI_OPTIONS = Object.freeze([0, 0.5, 1, 1.5]);
export const DEFAULT_KOMI = 0.5;
export const MAX_MATCHES = 6;

const ORTHOGONAL = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function colorName(color) {
  return color === BLACK ? '黑方' : '白方';
}

export function createEmptyBoard(size) {
  return new Array(size * size).fill(EMPTY);
}

export function indexOf(row, col, size) {
  return row * size + col;
}

export function rowOf(index, size) {
  return Math.floor(index / size);
}

export function colOf(index, size) {
  return index % size;
}

export function coordinateLabel(index, size) {
  const row = rowOf(index, size);
  const col = colOf(index, size);
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

export function isCenterZone(row, col, size) {
  const center = (size - 1) / 2;
  return Math.abs(row - center) <= 1 && Math.abs(col - center) <= 1;
}

/**
 * 以棋盘中心十字为界划分四象限。返回 0..3，位于中线时返回 -1。
 */
export function quadrantOf(row, col, size) {
  const center = (size - 1) / 2;
  if (row === center || col === center) return -1;
  if (row < center) return col < center ? 0 : 1;
  return col < center ? 2 : 3;
}

export function chebyshevDistance(a, b, size) {
  return Math.max(
    Math.abs(rowOf(a, size) - rowOf(b, size)),
    Math.abs(colOf(a, size) - colOf(b, size)),
  );
}

export function mirrorIndex(index, size) {
  const row = rowOf(index, size);
  const col = colOf(index, size);
  return indexOf(size - 1 - row, size - 1 - col, size);
}

function shuffled(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function cellsInQuadrants(size, edgeMargin = 0) {
  const center = (size - 1) / 2;
  const quadrants = [[], [], [], []];
  const all = [];
  const edgeCells = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const edge = Math.min(row, col, size - 1 - row, size - 1 - col);
      if (edge < edgeMargin) continue;
      const quadrant = quadrantOf(row, col, size);
      if (quadrant === -1 || isCenterZone(row, col, size)) continue;
      const index = indexOf(row, col, size);
      quadrants[quadrant].push(index);
      all.push(index);
      if (edge === 0) edgeCells.push(index);
    }
  }

  return { quadrants, all, edgeCells, center };
}

function buildCandidate(size, rng, edgeMargin = 1) {
  const stonePairs = PRESET_COUNT[size];
  const { quadrants, all, edgeCells, center } = cellsInQuadrants(size, edgeMargin);

  for (let attempt = 0; attempt < 140; attempt += 1) {
    const stones = [];
    const black = [];

    const isAvailable = (index) => {
      const row = rowOf(index, size);
      const col = colOf(index, size);
      if (isCenterZone(row, col, size)) return false;

      const mirrorRow = size - 1 - row;
      const mirrorCol = size - 1 - col;

      for (const stone of stones) {
        const stoneRow = rowOf(stone, size);
        const stoneCol = colOf(stone, size);
        if (Math.max(Math.abs(row - stoneRow), Math.abs(col - stoneCol)) < 2) return false;
        if (
          Math.max(
            Math.abs(mirrorRow - stoneRow),
            Math.abs(mirrorCol - stoneCol),
          ) < 2
        ) {
          return false;
        }
      }
      return true;
    };

    const add = (index) => {
      black.push(index);
      stones.push(index);
      stones.push(mirrorIndex(index, size));
    };

    // 强制最外层至少有一颗黑子；中心对称会同时给白方一颗外圈子。
    const forcedEdge = shuffled(edgeCells, rng).find(isAvailable);
    if (forcedEdge === undefined) continue;
    add(forcedEdge);
    const forcedQuadrant = quadrantOf(rowOf(forcedEdge, size), colOf(forcedEdge, size), size);

    let valid = true;
    for (const quadrant of shuffled([0, 1, 2, 3].filter((value) => value !== forcedQuadrant), rng)) {
      const candidate = shuffled(quadrants[quadrant], rng).find(isAvailable);
      if (candidate === undefined) {
        valid = false;
        break;
      }
      add(candidate);
    }

    if (!valid) continue;

    for (const candidate of shuffled(all, rng)) {
      if (black.length >= stonePairs) break;
      if (isAvailable(candidate)) add(candidate);
    }

    if (black.length !== stonePairs) continue;

    const board = createEmptyBoard(size);
    for (const blackIndex of black) {
      board[blackIndex] = BLACK;
      board[mirrorIndex(blackIndex, size)] = WHITE;
    }

    return {
      board,
      black: black.slice(),
      white: black.map((index) => mirrorIndex(index, size)),
      center,
    };
  }

  return null;
}

/**
 * 布局均匀度评分：越小越好。
 * 通过大量候选之间择优，减少边角子、近距对子和同色扎堆。
 */
function layoutScore(layout, size) {
  const stones = [];
  for (let index = 0; index < layout.board.length; index += 1) {
    if (layout.board[index] === EMPTY) continue;
    stones.push({
      index,
      color: layout.board[index],
      row: rowOf(index, size),
      col: colOf(index, size),
    });
  }

  let score = 0;
  for (let a = 0; a < stones.length; a += 1) {
    const one = stones[a];
    for (let b = a + 1; b < stones.length; b += 1) {
      const two = stones[b];
      const distance = Math.max(Math.abs(one.row - two.row), Math.abs(one.col - two.col));
      const sameColor = one.color === two.color;
      if (distance === 2) {
        score += 110 + (sameColor ? 85 : 0);
      } else if (distance === 3) {
        score += 8 + (sameColor ? 22 : 0);
      } else if (distance === 4 && sameColor) {
        score += 4;
      }
    }
  }

  for (const stone of stones) {
    const edge = Math.min(stone.row, stone.col, size - 1 - stone.row, size - 1 - stone.col);
    if (edge === 0) score += 700;
    else if (edge === 1) score += 150;
    else if (edge === 2) score += 25;
  }

  const quadrants = [0, 0, 0, 0];
  for (const stone of stones) {
    quadrants[quadrantOf(stone.row, stone.col, size)] += 1;
  }
  const target = stones.length / 4;
  for (const total of quadrants) score += Math.abs(total - target) * 24;

  // 行、列方向的分布也尽量均匀，避免某一带堆积。
  const rows = new Array(size).fill(0);
  const cols = new Array(size).fill(0);
  for (const stone of stones) {
    rows[stone.row] += 1;
    cols[stone.col] += 1;
  }
  for (const count of rows) score += count * count * 14;
  for (const count of cols) score += count * count * 14;

  return score;
}

function interiorCount(layout, size) {
  let count = 0;
  for (let index = 0; index < layout.board.length; index += 1) {
    if (layout.board[index] === EMPTY) continue;
    const row = rowOf(index, size);
    const col = colOf(index, size);
    if (Math.min(row, col, size - 1 - row, size - 1 - col) >= 3) count += 1;
  }
  return count;
}

/**
 * 随机生成中心对称的预设布局。
 *
 * 硬性条件：
 *  1. 任意黑子 (r,c) 的对称点 (N-1-r,N-1-c) 必为白子；
 *  2. 四个象限内，黑白双方都至少各有一子；
 *  3. 任意两子切比雪夫距离 >= 2；
 *  4. 中心 3×3 区域无预设子；
 *  5. 棋盘最外层至少有一枚预设子。
 *
 * 软性偏好：生成多组候选并择优，避免除最外层以外的棋子继续向边缘集中，
 * 同时拉开间距、均衡四象限与行列分布。
 */
export function generateLayout(size, rng = Math.random) {
  if (!PRESET_COUNT[size]) {
    throw new Error(`Unsupported board size: ${size}`);
  }

  const candidateCount = 240;
  const candidates = [];
  for (let attempt = 0; attempt < candidateCount * 2 && candidates.length < candidateCount; attempt += 1) {
    const candidate = buildCandidate(size, rng, 0);
    if (candidate && interiorCount(candidate, size) >= 2) {
      candidates.push({ ...candidate, score: layoutScore(candidate, size) });
    }
  }

  // 极端随机流下放宽“至少两子远离边缘”的偏好，但保留最外层有子等硬性规则。
  if (candidates.length === 0) {
    for (let attempt = 0; attempt < candidateCount * 2 && candidates.length === 0; attempt += 1) {
      const candidate = buildCandidate(size, rng, 0);
      if (candidate) {
        candidates.push({ ...candidate, score: layoutScore(candidate, size) });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('Could not generate a valid preset layout');
  }

  candidates.sort((a, b) => a.score - b.score);
  const poolSize = Math.max(1, Math.ceil(candidates.length * 0.05));
  const chosen = candidates[Math.floor(rng() * poolSize)];

  return {
    board: chosen.board,
    black: chosen.black,
    white: chosen.white,
    center: chosen.center,
  };
}

export function startGame(game) {
  if (game.phase !== 'ready') return game;
  return {
    ...game,
    phase: 'playing',
    turn: BLACK,
    result: null,
    startedAt: Date.now(),
  };
}

/**
 * 统计连通块（间）。横竖相邻，斜角不算。
 */
export function analyzeGroups(board, size) {
  const groupIndex = new Array(board.length).fill(-1);
  const groups = [];

  for (let index = 0; index < board.length; index += 1) {
    const color = board[index];
    if (color === EMPTY || groupIndex[index] !== -1) continue;

    const groupNumber = groups.length;
    const cells = [];
    const queue = [index];
    groupIndex[index] = groupNumber;

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      cells.push(current);
      const row = rowOf(current, size);
      const col = colOf(current, size);

      for (const [dr, dc] of ORTHOGONAL) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) continue;
        const next = indexOf(nextRow, nextCol, size);
        if (board[next] !== color || groupIndex[next] !== -1) continue;
        groupIndex[next] = groupNumber;
        queue.push(next);
      }
    }

    groups.push({ color, cells });
  }

  return {
    groups,
    groupIndex,
    black: groups.reduce((total, group) => total + (group.color === BLACK ? 1 : 0), 0),
    white: groups.reduce((total, group) => total + (group.color === WHITE ? 1 : 0), 0),
  };
}

export function groupCounts(board, size) {
  const analysis = analyzeGroups(board, size);
  return { black: analysis.black, white: analysis.white };
}

export function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function komiLabel(komi) {
  const value = Number(komi);
  return value === 0 ? '不贴' : `贴 ${formatNumber(value)} 间`;
}

export function komiRuleText(komi) {
  const value = Number(komi);
  return value === 0 ? '先手不贴' : `先手贴 ${formatNumber(value)} 间`;
}

export function isValidKomi(komi) {
  return KOMI_OPTIONS.includes(Number(komi));
}

export function normalizeKomi(komi) {
  const value = Number(komi);
  return KOMI_OPTIONS.includes(value) ? value : DEFAULT_KOMI;
}

function requireKomi(komi) {
  const value = Number(komi);
  if (!KOMI_OPTIONS.includes(value)) {
    throw new Error(`Unsupported komi: ${komi}`);
  }
  return value;
}

export function adjustedScores(scores, komi = DEFAULT_KOMI) {
  const value = normalizeKomi(komi);
  return {
    black: scores.black + value,
    white: scores.white,
  };
}

/**
 * 按先手贴目规则判定胜负。
 * 原始间数相同，或黑方加贴后与白方相同，均由白方获胜。
 */
export function judgeScores(scores, komi = DEFAULT_KOMI) {
  const value = requireKomi(komi);
  const adjusted = adjustedScores(scores, value);
  const rawTie = scores.black === scores.white;
  const handicapTie = !rawTie && adjusted.black === adjusted.white;
  const winner = adjusted.black < adjusted.white ? BLACK : WHITE;

  return {
    winner,
    loser: otherColor(winner),
    scores: { black: scores.black, white: scores.white },
    komi: value,
    adjustedScores: adjusted,
    rawTie,
    handicapTie,
    isTie: rawTie || handicapTie,
  };
}

export function computeOutcome(board, size, komi = DEFAULT_KOMI) {
  return {
    ...judgeScores(groupCounts(board, size), komi),
    reason: 'board-full',
  };
}

export function createGame(size = 13, options = {}) {
  if (!PRESET_COUNT[size]) {
    throw new Error(`Unsupported board size: ${size}`);
  }

  const layout = generateLayout(size, options.rng ?? Math.random);
  const komi = requireKomi(options.komi ?? DEFAULT_KOMI);

  return {
    size,
    komi,
    board: layout.board,
    presets: {
      black: layout.black,
      white: layout.white,
      blackCount: PRESET_COUNT[size],
      whiteCount: PRESET_COUNT[size],
    },
    phase: 'ready',
    turn: BLACK,
    history: [],
    lastMove: null,
    result: null,
    startedAt: null,
    layoutId: options.layoutId ?? null,
  };
}

export function setKomi(game, komi) {
  const value = requireKomi(komi);
  if (game.komi === value) return game;

  let result = game.result;
  if (game.phase === 'ended' && result) {
    if (result.reason === 'board-full') {
      result = computeOutcome(game.board, game.size, value);
    } else if (result.reason === 'settle') {
      result = {
        ...judgeScores(result.scores, value),
        reason: result.reason,
      };
    } else {
      result = {
        ...judgeScores(result.scores, value),
        winner: result.winner,
        loser: result.loser,
        reason: result.reason,
      };
    }
  }

  return { ...game, komi: value, result };
}

export function placeStone(game, index) {
  if (game.phase !== 'playing') return game;
  if (!Number.isInteger(index) || index < 0 || index >= game.board.length) return game;
  if (game.board[index] !== EMPTY) return game;

  const board = game.board.slice();
  board[index] = game.turn;

  const history = game.history.concat({
    index,
    color: game.turn,
    moveNumber: game.history.length + 1,
  });

  const isFull = board.every((cell) => cell !== EMPTY);
  if (isFull) {
    return {
      ...game,
      board,
      history,
      lastMove: index,
      phase: 'ended',
      result: computeOutcome(board, game.size, game.komi),
    };
  }

  return {
    ...game,
    board,
    history,
    lastMove: index,
    turn: otherColor(game.turn),
    result: null,
  };
}

export function undoMove(game) {
  if (game.history.length === 0) return game;

  const history = game.history.slice(0, -1);
  const removed = game.history[game.history.length - 1];
  const board = game.board.slice();
  board[removed.index] = EMPTY;

  return {
    ...game,
    board,
    history,
    lastMove: history.length > 0 ? history[history.length - 1].index : null,
    turn: removed.color,
    phase: 'playing',
    result: null,
  };
}

export function resignGame(game) {
  if (game.phase !== 'playing') return game;

  const judged = judgeScores(groupCounts(game.board, game.size), game.komi);
  return {
    ...game,
    phase: 'ended',
    result: {
      ...judged,
      winner: otherColor(game.turn),
      loser: game.turn,
      reason: 'resign',
    },
  };
}

export function settleGame(game) {
  if (game.phase !== 'playing') return game;

  const judged = judgeScores(groupCounts(game.board, game.size), game.komi);
  return {
    ...game,
    phase: 'ended',
    result: {
      ...judged,
      reason: 'settle',
    },
  };
}

export function remainingCells(game) {
  return game.board.reduce((total, cell) => total + (cell === EMPTY ? 1 : 0), 0);
}

export function resultLabel(result) {
  if (!result) return '';
  if (result.reason === 'board-full' || result.reason === 'settle') {
    if (result.rawTie) return '白胜因平局';
    if (result.handicapTie) return '白胜因贴目';
  }
  return result.winner === BLACK ? '黑胜' : '白胜';
}

export function resultDescription(result) {
  if (!result) return '';

  const komi = formatNumber(result.komi);
  const noKomi = Number(result.komi) === 0;
  if (result.reason === 'resign') {
    return `${colorName(result.loser)}认输，${colorName(result.winner)}直接获胜。`;
  }

  if (result.reason === 'settle') {
    if (result.rawTie) {
      return noKomi
        ? `按当前孤棋数结算：黑白原始间数同为 ${result.scores.black} 间；后手白方胜。`
        : `按当前孤棋数结算：黑白原始间数同为 ${result.scores.black} 间；按先手贴 ${komi} 间规则，后手白方胜。`;
    }
    if (result.handicapTie) {
      return `按当前孤棋数结算：先手贴 ${komi} 间后，双方同为 ${formatNumber(result.adjustedScores.black)} 间；依规后手白方获胜。`;
    }
    return noKomi
      ? `按当前孤棋数结算：黑方 ${result.scores.black} 间、白方 ${result.scores.white} 间；${colorName(result.winner)}胜出。`
      : `按当前孤棋数结算：黑方 ${result.scores.black} 间、白方 ${result.scores.white} 间；先手贴 ${komi} 间后，${colorName(result.winner)}胜出。`;
  }

  if (result.rawTie) {
    return noKomi
      ? `双方原始间数同为 ${result.scores.black} 间；后手白方胜。`
      : `双方原始间数同为 ${result.scores.black} 间；按先手贴 ${komi} 间规则，后手白方胜。`;
  }

  if (result.handicapTie) {
    return `先手贴 ${komi} 间后，双方同为 ${formatNumber(result.adjustedScores.black)} 间；依规后手白方获胜。`;
  }

  return noKomi
    ? `黑方 ${formatNumber(result.adjustedScores.black)} 间、白方 ${formatNumber(result.adjustedScores.white)} 间；${colorName(result.winner)}胜出。`
    : `先手贴 ${komi} 间后，黑方 ${formatNumber(result.adjustedScores.black)} 间、白方 ${formatNumber(result.adjustedScores.white)} 间；${colorName(result.winner)}胜出。`;
}
