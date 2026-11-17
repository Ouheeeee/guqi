import { BLACK, WHITE, EMPTY } from './game.js?v=1.9.3';

export const EYE_TABLE = Object.freeze({
  1: { 0: [0, 0], 1: [0, 0], 2: [0, 0], white: 'none', black: 'none' },
  2: { 0: [0, 0], 1: [0, 0], 2: [0, 0], white: 'none', black: 'none' },
  3: { 0: [1, 1], 1: [1, 0], 2: [1, 0], white: 'stand', black: 'hane' },
  4: { 0: [1, 1], 1: [1, 0], 2: [1, 0], white: 'stand', black: 'hane' },
  5: { 0: [2, 1], 1: [2, 1], 2: [2, 1], white: 'point-center', black: 'point-center' },
  6: { 0: [2, 2], 1: [2, 2], 2: [2, 2], white: 'split', black: 'point-one' },
  7: { 0: [2, 2], 1: [2, 2], 2: [2, 2], white: 'split', black: 'point-one' },
  8: { 0: [2, 2], 1: [2, 2], 2: [2, 2], white: 'split', black: 'point-one' },
});

export function eyeValue(length, caps) {
  const l = Math.max(1, Math.min(8, Number(length) | 0));
  const c = Math.max(0, Math.min(2, Number(caps) | 0));
  const row = EYE_TABLE[l] || EYE_TABLE[8];
  return { sente: row[c][0], gote: row[c][1], whiteResponse: row.white, blackResponse: row.black };
}

const cell = (row, col, size) => row * size + col;

/**
 * 二线连续 defender 子 + opponent 端盖。
 * sente = defender 先，gote = opponent 先。
 * 眼位空间在连续子正上方（runRow - 1）。
 */
export function findSecondLineEyeShapes(board, size, defender = WHITE) {
  const opponent = defender === BLACK ? WHITE : BLACK;
  const out = [];
  for (const runRow of [1, size - 2]) {
    const eyeRow = runRow - 1;
    for (let start = 1; start < size - 1; start += 1) {
      if (board[cell(runRow, start, size)] !== defender) continue;
      let end = start;
      while (end + 1 < size - 1 && board[cell(runRow, end + 1, size)] === defender) end += 1;
      const length = end - start + 1;
      if (length < 3 || length > 8) continue;
      const leftCap = board[cell(runRow, start - 1, size)] === opponent;
      const rightCap = board[cell(runRow, end + 1, size)] === opponent;
      const caps = (leftCap ? 1 : 0) + (rightCap ? 1 : 0);
      let eyeEmpty = 0;
      for (let col = start; col <= end; col += 1) {
        if (board[cell(eyeRow, col, size)] === EMPTY) eyeEmpty += 1;
      }
      if (eyeEmpty < 1) continue;
      const value = eyeValue(length, caps);
      const keyPoints = new Set([cell(eyeRow, start, size), cell(eyeRow, end, size)]);
      if (length >= 5) keyPoints.add(cell(eyeRow, Math.floor((start + end) / 2), size));
      out.push({
        defender,
        opponent,
        runRow,
        eyeRow,
        start,
        end,
        length,
        caps,
        senteEyes: value.sente,
        goteEyes: value.gote,
        whiteResponse: value.whiteResponse,
        blackResponse: value.blackResponse,
        keyPoints: [...keyPoints],
      });
      start = end;
    }
  }
  return out;
}

export function describeEyeShape(shape) {
  return `二线${shape.length}子·${shape.caps}端盖·${shape.senteEyes}/${shape.goteEyes}眼`;
}
