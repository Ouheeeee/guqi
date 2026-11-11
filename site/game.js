/**
 * 孤棋 · 游戏规则引擎
 *
 * 棋盘以长度 N*N 的一维数组表示：
 *   0 = 空位，1 = 黑棋，2 = 白棋
 * 黑方先行，终局以“间”（连通块数）少者获胜，同数白方胜。
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const BOARD_SIZES = [13, 15];
export const PRESET_COUNT = Object.freeze({ 13: 6, 15: 7 });

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

function cellsInQuadrants(size) {
  const center = (size - 1) / 2;
  const quadrants = [[], [], [], []];
  const all = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const quadrant = quadrantOf(row, col, size);
      if (quadrant === -1 || isCenterZone(row, col, size)) continue;
      const index = indexOf(row, col, size);
      quadrants[quadrant].push(index);
      all.push(index);
    }
  }

  return { quadrants, all, center };
}

/**
 * 随机生成中心对称的预设布局。
 *
 * 同时满足：
 *  1. 任意黑子 (r,c) 的对称点 (N-1-r,N-1-c) 必为白子；
 *  2. 四个象限内，黑白双方都至少各有一子（等价于黑子遍布四象限）；
 *  3. 任意两子切比雪夫距离 >= 2；
 *  4. 中心 3×3 区域无预设子。
 */
export function generateLayout(size, rng = Math.random) {
  if (!PRESET_COUNT[size]) {
    throw new Error(`Unsupported board size: ${size}`);
  }

  const stonePairs = PRESET_COUNT[size];
  const { quadrants, all, center } = cellsInQuadrants(size);
  const maxAttempts = 600;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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

    let valid = true;
    for (const quadrant of shuffled([0, 1, 2, 3], rng)) {
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

  throw new Error('Could not generate a valid preset layout');
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

export function computeOutcome(board, size) {
  const scores = groupCounts(board, size);
  const isTie = scores.black === scores.white;
  const winner = isTie ? WHITE : scores.black < scores.white ? BLACK : WHITE;

  return {
    winner,
    loser: otherColor(winner),
    scores,
    isTie,
    reason: 'board-full',
  };
}

export function createGame(size = 13, options = {}) {
  if (!PRESET_COUNT[size]) {
    throw new Error(`Unsupported board size: ${size}`);
  }

  const layout = generateLayout(size, options.rng ?? Math.random);

  return {
    size,
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
      result: computeOutcome(board, game.size),
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

  const scores = groupCounts(game.board, game.size);
  return {
    ...game,
    phase: 'ended',
    result: {
      winner: otherColor(game.turn),
      loser: game.turn,
      scores,
      isTie: false,
      reason: 'resign',
    },
  };
}

export function remainingCells(game) {
  return game.board.reduce((total, cell) => total + (cell === EMPTY ? 1 : 0), 0);
}

export function resultLabel(result) {
  if (!result) return '';
  if (result.reason === 'board-full' && result.isTie) return '白胜因平局';
  return result.winner === BLACK ? '黑胜' : '白胜';
}

export function resultDescription(result) {
  if (!result) return '';
  if (result.reason === 'resign') {
    return `${colorName(result.loser)}认输，${colorName(result.winner)}直接获胜。`;
  }
  if (result.isTie) {
    return `双方各 ${result.scores.black} 间，依规后手白方获胜。`;
  }
  const winnerScore = result.scores[result.winner === BLACK ? 'black' : 'white'];
  const loserScore = result.scores[result.winner === BLACK ? 'white' : 'black'];
  return `${colorName(result.winner)}以 ${winnerScore} 间对 ${loserScore} 间胜出。`;
}
