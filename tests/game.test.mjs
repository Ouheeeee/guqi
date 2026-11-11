import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLACK,
  EMPTY,
  WHITE,
  PRESET_COUNT,
  analyzeGroups,
  computeOutcome,
  createGame,
  generateLayout,
  groupCounts,
  mirrorIndex,
  placeStone,
  resignGame,
  resultDescription,
  resultLabel,
  startGame,
  undoMove,
} from '../site/game.js';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function validateLayout(size, layout) {
  const { board, black, white } = layout;
  const mid = (size - 1) / 2;
  const stoneCount = PRESET_COUNT[size];

  assert.equal(black.length, stoneCount, '黑子数量');
  assert.equal(white.length, stoneCount, '白子数量');
  assert.equal(board.filter((cell) => cell === BLACK).length, stoneCount);
  assert.equal(board.filter((cell) => cell === WHITE).length, stoneCount);

  const stones = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) stones.push(index);
  }
  assert.equal(stones.length, stoneCount * 2);

  const quadrants = [
    { black: 0, white: 0 },
    { black: 0, white: 0 },
    { black: 0, white: 0 },
    { black: 0, white: 0 },
  ];

  for (const index of stones) {
    const row = Math.floor(index / size);
    const col = index % size;
    const color = board[index];

    assert.notEqual(row, mid, '预设不应落在中线');
    assert.notEqual(col, mid, '预设不应落在中线');
    assert.ok(!(Math.abs(row - mid) <= 1 && Math.abs(col - mid) <= 1), '中心 3×3 必须为空');

    const quadrant = (row < mid ? 0 : 2) + (col < mid ? 0 : 1);
    if (color === BLACK) quadrants[quadrant].black += 1;
    else quadrants[quadrant].white += 1;
  }

  for (const blackIndex of black) {
    assert.equal(board[mirrorIndex(blackIndex, size)], WHITE, '中心对称');
  }
  for (const whiteIndex of white) {
    assert.equal(board[mirrorIndex(whiteIndex, size)], BLACK, '中心对称');
  }

  for (let a = 0; a < stones.length; a += 1) {
    const rowA = Math.floor(stones[a] / size);
    const colA = stones[a] % size;
    for (let b = a + 1; b < stones.length; b += 1) {
      const rowB = Math.floor(stones[b] / size);
      const colB = stones[b] % size;
      const distance = Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB));
      assert.ok(distance >= 2, '任意两子切比雪夫距离必须至少为 2');
    }
  }

  for (const quadrant of quadrants) {
    assert.ok(quadrant.black >= 1, '每象限至少一枚黑子');
    assert.ok(quadrant.white >= 1, '每象限至少一枚白子');
  }

  assert.equal(groupCounts(board, size).black, stoneCount, '预设阶段黑方间数');
  assert.equal(groupCounts(board, size).white, stoneCount, '预设阶段白方间数');
}

test('13 路与 15 路的预设布局在大量随机样本中始终满足全部约束', () => {
  for (const size of [13, 15]) {
    const rng = seededRandom(size * 991);
    for (let sample = 0; sample < 1200; sample += 1) {
      validateLayout(size, generateLayout(size, rng));
    }
  }
});

test('随机生成的布局具有明显差异，而不是固定图案', () => {
  const signatures = new Set();
  for (let i = 0; i < 20; i += 1) {
    signatures.add(generateLayout(15).board.join(''));
  }
  assert.ok(signatures.size > 15, '随机布局应具有明显差异');
});

test('连通块仅按横竖相邻计，斜角不连接', () => {
  const board = [
    BLACK, BLACK, EMPTY,
    BLACK, WHITE, WHITE,
    EMPTY, WHITE, BLACK,
  ];
  const analysis = analyzeGroups(board, 3);
  assert.equal(analysis.black, 2);
  assert.equal(analysis.white, 1);
  assert.equal(analysis.groups.length, 3);

  const diagonal = [
    BLACK, EMPTY, EMPTY,
    EMPTY, BLACK, EMPTY,
    EMPTY, EMPTY, BLACK,
  ];
  assert.deepEqual(groupCounts(diagonal, 3), { black: 3, white: 0 });
  assert.deepEqual(groupCounts(new Array(9).fill(EMPTY), 3), { black: 0, white: 0 });
});

test('落子交替行棋，悔棋可连续撤销 25 手并精确还原', () => {
  const initial = startGame(createGame(13, { rng: seededRandom(7) }));
  const presetBoard = initial.board.join('');
  let state = initial;

  for (let move = 0; move < 25; move += 1) {
    const empty = state.board.findIndex((cell) => cell === EMPTY);
    const expectedTurn = state.turn;
    state = placeStone(state, empty);
    assert.equal(state.phase, 'playing');
    assert.equal(state.history.length, move + 1);
    assert.equal(state.board[empty], expectedTurn);
    assert.equal(state.turn, expectedTurn === BLACK ? WHITE : BLACK);
  }

  assert.equal(state.history.length, 25);
  for (let move = 25; move > 0; move -= 1) {
    state = undoMove(state);
    assert.equal(state.history.length, move - 1);
  }

  assert.equal(state.board.join(''), presetBoard);
  assert.equal(state.turn, BLACK);
  assert.equal(state.lastMove, null);
  assert.equal(state.phase, 'playing');
  assert.equal(undoMove(state), state, '没有落子时悔棋应无操作');
});

test('当前行棋方认输时对方立即获胜，悔棋可重新开始', () => {
  let state = startGame(createGame(13, { rng: seededRandom(11) }));
  const firstEmpty = state.board.findIndex((cell) => cell === EMPTY);
  state = placeStone(state, firstEmpty); // 黑落，轮到白

  const resigned = resignGame(state);
  assert.equal(resigned.phase, 'ended');
  assert.equal(resigned.result.reason, 'resign');
  assert.equal(resigned.result.winner, BLACK);
  assert.equal(resigned.result.loser, WHITE);
  assert.equal(resultLabel(resigned.result), '黑胜');
  assert.match(resultDescription(resigned.result), /白方认输/);

  const reopened = undoMove(resigned);
  assert.equal(reopened.phase, 'playing');
  assert.equal(reopened.result, null);
  assert.equal(reopened.turn, BLACK, '撤销黑方上一手后轮到黑方重下');

  const blackResigns = resignGame({ ...startGame(createGame(15)), phase: 'playing', turn: BLACK });
  assert.equal(blackResigns.result.winner, WHITE);
});

test('棋盘填满后按间数结算，同数时后手白方获胜', () => {
  let state = startGame(createGame(13, { rng: seededRandom(21) }));
  const totalMoves = 13 * 13 - PRESET_COUNT[13] * 2;

  while (state.phase === 'playing') {
    const empty = state.board.findIndex((cell) => cell === EMPTY);
    state = placeStone(state, empty);
  }

  assert.equal(state.phase, 'ended');
  assert.equal(state.history.length, totalMoves);
  assert.equal(state.board.includes(EMPTY), false);
  const scores = groupCounts(state.board, 13);
  assert.deepEqual(state.result.scores, scores);
  assert.equal(state.result.reason, 'board-full');

  if (scores.black === scores.white) {
    assert.equal(state.result.isTie, true);
    assert.equal(state.result.winner, WHITE);
    assert.equal(resultLabel(state.result), '白胜因平局');
  } else {
    assert.equal(state.result.isTie, false);
    assert.equal(state.result.winner, scores.black < scores.white ? BLACK : WHITE);
  }

  const undone = undoMove(state);
  assert.equal(undone.phase, 'playing');
  assert.equal(undone.result, null);
  assert.equal(undone.history.length, totalMoves - 1);
});

test('平局裁定与黑方少间获胜的结算逻辑', () => {
  const tied = [
    BLACK, BLACK,
    WHITE, WHITE,
  ];
  const tieOutcome = computeOutcome(tied, 2);
  assert.equal(tieOutcome.scores.black, 1);
  assert.equal(tieOutcome.scores.white, 1);
  assert.equal(tieOutcome.winner, WHITE);
  assert.equal(tieOutcome.isTie, true);
  assert.equal(resultLabel(tieOutcome), '白胜因平局');
  assert.match(resultDescription(tieOutcome), /后手白方获胜/);

  const blackWins = [
    BLACK, BLACK, WHITE,
    WHITE, WHITE, BLACK,
    BLACK, WHITE, BLACK,
  ];
  const outcome = computeOutcome(blackWins, 3);
  assert.equal(outcome.scores.black, 3);
  assert.equal(outcome.scores.white, 2);
  assert.equal(outcome.winner, WHITE, '白方间数更少，白方胜');

  assert.throws(() => generateLayout(12), /Unsupported/);
  assert.throws(() => createGame(14), /Unsupported/);
});
