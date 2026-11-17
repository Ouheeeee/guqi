/**
 * 孤棋搜索引擎（search fork）
 *
 * 规则唯一来源：site/game.js（只读引用，不修改）。
 *   棋盘填满后结束；终局比较“间”（连通块数），黑先手贴 komi 间；
 *   黑方 adjusted = blackGroups + komi，白方 = whiteGroups；
 *   若 adjusted 相同（含原始间数相同/贴目后相同），后手白方获胜。
 *   因此从黑方视角的终局优势 = whiteGroups - blackGroups - komi。
 *
 * 本文件实现：
 *   1) 增量连通块（gid + gsize + 并查集式“大组合并小组合”重贴标签），
 *      走子/撤销均为增量，不整盘重算。
 *   2) Negamax + Alpha-Beta（fail-soft），置换表带 exact / lower / upper 三种标志，
 *      仅在“完整搜索完该节点”后按 alphaOrig/beta 判定边界再写入，
 *      不会把 fail-soft 边界当成 exact 值缓存。
 *   3) 走子顺序：自己有效合并 > 挡对方合并 > 挡对方新块 > 中性 > 双方各加一 > 自己新块，
 *      同层用合并数、己方相邻子数、空邻数（空间）做次级排序。
 *   4) 迭代加深 + 时间/节点预算；叶子使用手工估值（块数差 + 合并潜力 + 相邻潜力 + 空间/安全点 + 行棋方）。
 *   5) 可选静态搜索（qsearch）：只延伸“合并/挡合并”这类战术着法。
 */

import {
  analyzeGroups,
  judgeScores,
  createGame,
  BLACK,
  WHITE,
  EMPTY,
  otherColor,
} from './game.js?v=1.9.3';

export { analyzeGroups, judgeScores, createGame, BLACK, WHITE, EMPTY, otherColor };

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const now = () =>
  typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();

export const INF = 1e9;
const TIMEOUT = Symbol('search-timeout');

/**
 * 手工估值权重（整数，便于 TT 用 Int32 存精确值）。
 *
 * INITIAL_WEIGHTS 是第一版手设权重；DEFAULT_WEIGHTS 是在 13 路 seeds 0-14 上调参后的权重
 * （调参只用于选择权重，最终基准在未参与调参的 seeds 上验证）。
 *
 * 注意：旧版本这里曾有一个 `tempo` 字段，但 evalBlack 从未使用它 —— 属于死参数。
 * 本版已删除；删除不改变任何搜索行为（旧字段本来就无效），但避免命令行/报告误以为
 * 估值里存在“行棋方奖励”项。
 */
export const INITIAL_WEIGHTS = Object.freeze({
  group: 1000, // 当前块数差，1 间 = 1000
  merge: 350, // 每多一个“合并潜力点”的价值
  adj: 60, // 空点周围己方相邻子数差
  safe: 80, // 只对己方安全、对对方会新开块的空点数差
});

export const DEFAULT_WEIGHTS = Object.freeze({
  group: 1000,
  merge: 100,
  adj: 100,
  safe: 160,
});

const WEIGHT_KEYS = new Set(Object.keys(DEFAULT_WEIGHTS));

function normalizeWeights(overrides) {
  if (!overrides) return { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(overrides)) {
    if (!WEIGHT_KEYS.has(key)) {
      throw new Error(
        `unknown eval weight "${key}" (supported: ${[...WEIGHT_KEYS].join(', ')})`,
      );
    }
  }
  return { ...DEFAULT_WEIGHTS, ...overrides };
}

/* 走子顺序层级：数值越大越先搜索。 */
const ORDER_OWN_MERGE = 20;
const ORDER_BLOCK_MERGE = 16;
const ORDER_DENY_OPP_NEW = 8;
const ORDER_NEUTRAL = 6;
const ORDER_DOUBLE_NEW = 4;
const ORDER_OWN_NEW = 3;

/* fail-soft TT 标志（导出给测试用，数值与内部判定一致） */
export const TT_FLAG = Object.freeze({
  NONE: 0,
  EXACT: 1,
  LOWER: 2, // 真实值 >= 存值
  UPPER: 3, // 真实值 <= 存值
});
const { NONE: TT_NONE, EXACT: TT_EXACT, LOWER: TT_LOWER, UPPER: TT_UPPER } = TT_FLAG;

const LOG_CAP = 1 << 17;

/* ------------------------------------------------------------------ */
/* 引擎                                                               */
/* ------------------------------------------------------------------ */

export class SearchEngine {
  constructor(options = {}) {
    this.size = options.size ?? 13;
    this.n = this.size * this.size;
    this.maxPly = this.n + 8;

    // 邻接表：每个格子 4 个邻居，越界记 -1。
    this.neighbors = new Int32Array(this.n * 4);
    for (let index = 0; index < this.n; index += 1) {
      const row = Math.floor(index / this.size);
      const col = index % this.size;
      const base = index * 4;
      this.neighbors[base] = row > 0 ? index - this.size : -1;
      this.neighbors[base + 1] = row < this.size - 1 ? index + this.size : -1;
      this.neighbors[base + 2] = col > 0 ? index - 1 : -1;
      this.neighbors[base + 3] = col < this.size - 1 ? index + 1 : -1;
    }

    this.weights = normalizeWeights(options.weights);
    this.komi = options.komi ?? 0.5;
    this.komiScaled = Math.round(this.komi * 1000);
    this.useQSearch = options.qsearch ?? false;
    this.useTT = options.useTT ?? true;
    this.qDepth = options.qDepth ?? 4;
    this.verbose = options.verbose ?? false;

    // 置换表：2^ttBits 槽位。
    this.ttBits = options.ttBits ?? 20;
    const ttSize = 1 << this.ttBits;
    this.ttSize = ttSize;
    this.ttMask = ttSize - 1;
    this.ttKey = new Float64Array(ttSize);
    this.ttDepth = new Uint8Array(ttSize);
    this.ttFlag = new Uint8Array(ttSize);
    this.ttVal = new Int32Array(ttSize);
    this.ttMove = new Int16Array(ttSize).fill(-1);
    this.ttGen = new Uint16Array(ttSize);
    this.ttSeeded = false;
    this.gen = 0;

    // Zobrist：53 bit（hi 21 bit + lo 32 bit），按 (color, cell) 随机。
    const rng = mulberry32(options.seed ?? 0x51ed2701);
    this.keyHi = new Int32Array(2 * this.n);
    this.keyLo = new Int32Array(2 * this.n);
    for (let color = 0; color < 2; color += 1) {
      for (let cell = 0; cell < this.n; cell += 1) {
        this.keyHi[color * this.n + cell] = Math.floor(rng() * 0x200000);
        this.keyLo[color * this.n + cell] = (rng() * 0x100000000) >>> 0;
      }
    }
    this.turnHi = [Math.floor(rng() * 0x200000), Math.floor(rng() * 0x200000)];
    this.turnLo = [
      (rng() * 0x100000000) >>> 0,
      (rng() * 0x100000000) >>> 0,
    ];

    // 棋盘与分组结构。
    this.board = new Uint8Array(this.n);
    this.gid = new Int32Array(this.n).fill(-1);
    this.gsize = new Int32Array(this.n + 1);
    this.gcountB = 0;
    this.gcountW = 0;
    this.nextGid = 0;
    this.emptyCount = 0;
    this.hashHi = 0;
    this.hashLo = 0;
    this.depth = 0; // 当前已走步数

    // 撤销日志（只记录 gid / gsize 的变化；棋盘按落子点直接回退）。
    this.logCell = new Int32Array(LOG_CAP);
    this.logOld = new Int32Array(LOG_CAP);
    this.logSizeIdx = new Int32Array(LOG_CAP);
    this.logSizeOld = new Int32Array(LOG_CAP);
    this.gidPtr = 0;
    this.sizePtr = 0;
    // 洪水填充用的临时栈
    this.flood = new Int32Array(this.n);

    // 每层帧。
    this.fMv = new Int32Array(this.maxPly);
    this.fB = new Int32Array(this.maxPly);
    this.fW = new Int32Array(this.maxPly);
    this.fNext = new Int32Array(this.maxPly);
    this.fHi = new Int32Array(this.maxPly);
    this.fLo = new Int32Array(this.maxPly);
    this.fGidPtr = new Int32Array(this.maxPly);
    this.fSizePtr = new Int32Array(this.maxPly);
    this.fEmpty = new Int32Array(this.maxPly);

    // 每层走子缓冲（避免每个节点分配内存）。
    this.mvBufs = new Array(this.maxPly);
    this.ordBufs = new Array(this.maxPly);

    // 搜索统计
    this.nodes = 0;
    this.leaves = 0;
    this.ttHits = 0;
    this.ttStores = 0;
    this.cutoffs = 0;
    this.seldepth = 0;
    this.deadline = Infinity;
    this.nodeLimit = Infinity;
    this.aborted = false;
    this.rootTurn = BLACK;
    this.iterBest = -1;
    this.iterBestVal = -INF;
    this.iterSearchedMoves = 0;
    this.prevBest = -1;
    this.qnodes = 0;
    this.maxDepthReached = 0;
  }

  /* ---------------- 初始化 ---------------- */

  initFromBoard(board) {
    if (board.length !== this.n) throw new Error('board size mismatch');
    this.board.set(board);
    this.gid.fill(-1);
    this.gsize.fill(0);
    this.gcountB = 0;
    this.gcountW = 0;
    this.nextGid = 0;
    this.gidPtr = 0;
    this.sizePtr = 0;
    this.depth = 0;
    this.emptyCount = 0;

    const stack = this.flood;
    for (let index = 0; index < this.n; index += 1) {
      const color = board[index];
      if (color === EMPTY) {
        this.emptyCount += 1;
        continue;
      }
      if (this.gid[index] !== -1) continue;
      const group = this.nextGid;
      this.nextGid += 1;
      let sp = 0;
      stack[sp] = index;
      sp += 1;
      this.gid[index] = group;
      let count = 0;
      while (sp > 0) {
        sp -= 1;
        const cell = stack[sp];
        count += 1;
        const base = cell * 4;
        for (let k = 0; k < 4; k += 1) {
          const next = this.neighbors[base + k];
          if (next < 0) continue;
          if (board[next] !== color || this.gid[next] !== -1) continue;
          this.gid[next] = group;
          stack[sp] = next;
          sp += 1;
        }
      }
      this.gsize[group] = count;
      if (color === BLACK) this.gcountB += 1;
      else this.gcountW += 1;
    }

    let hi = 0;
    let lo = 0;
    for (let index = 0; index < this.n; index += 1) {
      const color = board[index];
      if (color === EMPTY) continue;
      const slot = (color === BLACK ? 0 : 1) * this.n + index;
      hi ^= this.keyHi[slot];
      lo ^= this.keyLo[slot];
    }
    this.hashHi = hi;
    this.hashLo = lo;
    return this;
  }

  /** 设置行棋方（并把它异或进 Zobrist）。 */
  setTurn(turn) {
    this.hashHi = 0;
    this.hashLo = 0;
    for (let index = 0; index < this.n; index += 1) {
      const color = this.board[index];
      if (color === EMPTY) continue;
      const slot = (color === BLACK ? 0 : 1) * this.n + index;
      this.hashHi ^= this.keyHi[slot];
      this.hashLo ^= this.keyLo[slot];
    }
    this.hashHi ^= this.turnHi[turn === BLACK ? 0 : 1];
    this.hashLo ^= this.turnLo[turn === BLACK ? 0 : 1];
  }

  /* ---------------- 走子 / 撤销 ---------------- */

  logSize(index, oldValue) {
    if (this.sizePtr >= LOG_CAP) throw new Error('size log overflow');
    this.logSizeIdx[this.sizePtr] = index;
    this.logSizeOld[this.sizePtr] = oldValue;
    this.sizePtr += 1;
  }

  logGid(cell, oldValue) {
    if (this.gidPtr >= LOG_CAP) throw new Error('gid log overflow');
    this.logCell[this.gidPtr] = cell;
    this.logOld[this.gidPtr] = oldValue;
    this.gidPtr += 1;
  }

  makeMove(mv, color) {
    const d = this.depth;
    if (d >= this.maxPly) throw new Error('ply overflow');
    this.fMv[d] = mv;
    this.fB[d] = this.gcountB;
    this.fW[d] = this.gcountW;
    this.fNext[d] = this.nextGid;
    this.fHi[d] = this.hashHi;
    this.fLo[d] = this.hashLo;
    this.fGidPtr[d] = this.gidPtr;
    this.fSizePtr[d] = this.sizePtr;
    this.fEmpty[d] = this.emptyCount;

    const board = this.board;
    board[mv] = color;
    this.emptyCount -= 1;

    const neighbors = this.neighbors;
    const gid = this.gid;
    const base = mv * 4;

    // 收集相邻同色“不同组”。
    const ids = [-1, -1, -1, -1];
    const reps = [-1, -1, -1, -1];
    let count = 0;
    for (let k = 0; k < 4; k += 1) {
      const cell = neighbors[base + k];
      if (cell < 0 || board[cell] !== color) continue;
      const group = gid[cell];
      let dup = false;
      for (let j = 0; j < count; j += 1) {
        if (ids[j] === group) {
          dup = true;
          break;
        }
      }
      if (!dup) {
        ids[count] = group;
        reps[count] = cell;
        count += 1;
      }
    }

    if (count === 0) {
      const group = this.nextGid;
      this.nextGid += 1;
      this.gid[mv] = group;
      this.gsize[group] = 1;
      if (color === BLACK) this.gcountB += 1;
      else this.gcountW += 1;
    } else {
      // 合并：目标组选最大的（union-by-size），其余组整组重贴标签。
      let targetIndex = 0;
      for (let j = 1; j < count; j += 1) {
        if (this.gsize[ids[j]] > this.gsize[ids[targetIndex]]) targetIndex = j;
      }
      const target = ids[targetIndex];
      let total = 1;
      for (let j = 0; j < count; j += 1) total += this.gsize[ids[j]];
      this.logSize(target, this.gsize[target]);
      for (let j = 0; j < count; j += 1) {
        if (j === targetIndex) continue;
        const source = ids[j];
        this.logSize(source, this.gsize[source]);
        this.gsize[source] = 0;
        this.relabelGroup(source, target, reps[j]);
      }
      this.gsize[target] = total;
      this.gid[mv] = target;
      if (color === BLACK) this.gcountB += 1 - count;
      else this.gcountW += 1 - count;
    }

    const slot = (color === BLACK ? 0 : 1) * this.n + mv;
    this.hashHi ^= this.keyHi[slot] ^ this.turnHi[0] ^ this.turnHi[1];
    this.hashLo ^= this.keyLo[slot] ^ this.turnLo[0] ^ this.turnLo[1];

    this.depth = d + 1;
  }

  /** 把 source 组所有格子改成 target（source 必须是 target 相邻的旧组）。 */
  relabelGroup(source, target, start) {
    const gid = this.gid;
    const board = this.board;
    const neighbors = this.neighbors;
    const stack = this.flood;
    let sp = 0;
    stack[sp] = start;
    sp += 1;
    while (sp > 0) {
      sp -= 1;
      const cell = stack[sp];
      if (gid[cell] !== source) continue;
      this.logGid(cell, source);
      gid[cell] = target;
      const base = cell * 4;
      const color = board[cell];
      for (let k = 0; k < 4; k += 1) {
        const next = neighbors[base + k];
        if (next < 0) continue;
        if (board[next] === color && gid[next] === source) {
          stack[sp] = next;
          sp += 1;
        }
      }
    }
  }

  undoMove() {
    if (this.depth === 0) return;
    this.depth -= 1;
    const d = this.depth;
    const mv = this.fMv[d];

    while (this.sizePtr > this.fSizePtr[d]) {
      this.sizePtr -= 1;
      this.gsize[this.logSizeIdx[this.sizePtr]] = this.logSizeOld[this.sizePtr];
    }
    while (this.gidPtr > this.fGidPtr[d]) {
      this.gidPtr -= 1;
      this.gid[this.logCell[this.gidPtr]] = this.logOld[this.gidPtr];
    }
    this.board[mv] = EMPTY;
    this.gid[mv] = -1;
    this.gcountB = this.fB[d];
    this.gcountW = this.fW[d];
    this.nextGid = this.fNext[d];
    this.hashHi = this.fHi[d];
    this.hashLo = this.fLo[d];
    this.emptyCount = this.fEmpty[d];
  }

  /* ---------------- 叶子估值 ---------------- */

  /** 从黑方视角的手工估值（整数）。 */
  evalBlack() {
    const weights = this.weights;
    const board = this.board;
    const gid = this.gid;
    const neighbors = this.neighbors;
    const n = this.n;

    let mergeB = 0;
    let mergeW = 0;
    let adjB = 0;
    let adjW = 0;
    let safeB = 0;
    let safeW = 0;

    for (let mv = 0; mv < n; mv += 1) {
      if (board[mv] !== EMPTY) continue;
      const base = mv * 4;
      // 4 邻居去重用标量，避免每个空点分配数组。
      let b0 = -1;
      let b1 = -1;
      let b2 = -1;
      let b3 = -1;
      let w0 = -1;
      let w1 = -1;
      let w2 = -1;
      let w3 = -1;
      let cntB = 0;
      let cntW = 0;
      let nB = 0;
      let nW = 0;
      for (let k = 0; k < 4; k += 1) {
        const cell = neighbors[base + k];
        if (cell < 0) continue;
        const color = board[cell];
        if (color === EMPTY) continue;
        const group = gid[cell];
        if (color === BLACK) {
          nB += 1;
          if (cntB === 0) {
            b0 = group;
            cntB = 1;
          } else if (group !== b0 && group !== b1 && group !== b2 && group !== b3) {
            if (cntB === 1) b1 = group;
            else if (cntB === 2) b2 = group;
            else b3 = group;
            cntB += 1;
          }
        } else {
          nW += 1;
          if (cntW === 0) {
            w0 = group;
            cntW = 1;
          } else if (group !== w0 && group !== w1 && group !== w2 && group !== w3) {
            if (cntW === 1) w1 = group;
            else if (cntW === 2) w2 = group;
            else w3 = group;
            cntW += 1;
          }
        }
      }
      if (cntB >= 2) mergeB += cntB - 1;
      if (cntW >= 2) mergeW += cntW - 1;
      adjB += nB;
      adjW += nW;
      if (cntB > 0 && cntW === 0) safeB += 1;
      if (cntW > 0 && cntB === 0) safeW += 1;
    }

    const groupDiff = this.gcountW - this.gcountB;
    return (
      weights.group * groupDiff -
      this.komiScaled +
      weights.merge * (mergeB - mergeW) +
      weights.adj * (adjB - adjW) +
      weights.safe * (safeB - safeW)
    );
  }

  /** 行棋方视角的静态估值。 */
  evalSideToMove(turn) {
    const value = this.evalBlack();
    return turn === BLACK ? value : -value;
  }

  turnAtPly(ply) {
    return ply % 2 === 0 ? this.rootTurn : otherColor(this.rootTurn);
  }

  terminalScore(ply) {
    const turn = this.turnAtPly(ply);
    // 黑方视角：白块 - 黑块 - 贴目（贴目按 1000 缩放）。
    const blackAdvantage =
      this.weights.group * (this.gcountW - this.gcountB) - this.komiScaled;
    return turn === BLACK ? blackAdvantage : -blackAdvantage;
  }

  /* ---------------- 走子生成 + 顺序 ---------------- */

  mvBuf(ply) {
    let buf = this.mvBufs[ply];
    if (!buf) {
      buf = new Int32Array(this.n);
      this.mvBufs[ply] = buf;
    }
    return buf;
  }

  ordBuf(ply) {
    let buf = this.ordBufs[ply];
    if (!buf) {
      buf = new Int32Array(this.n);
      this.ordBufs[ply] = buf;
    }
    return buf;
  }

  /**
   * 生成走子并写入顺序分（越大越先）。
   * 返回走子数。
   */
  genMoves(turn) {
    const ply = this.depth;
    const mvBuf = this.mvBuf(ply);
    const ordBuf = this.ordBuf(ply);
    const board = this.board;
    const gid = this.gid;
    const neighbors = this.neighbors;
    const n = this.n;
    let count = 0;

    for (let mv = 0; mv < n; mv += 1) {
      if (board[mv] !== EMPTY) continue;
      const base = mv * 4;
      let ownStones = 0;
      let oppStones = 0;
      let ownCnt = 0;
      let oppCnt = 0;
      let o0 = -1;
      let o1 = -1;
      let o2 = -1;
      let o3 = -1;
      let p0 = -1;
      let p1 = -1;
      let p2 = -1;
      let p3 = -1;
      let emptyNbrs = 0;
      for (let k = 0; k < 4; k += 1) {
        const cell = neighbors[base + k];
        if (cell < 0) continue;
        const color = board[cell];
        if (color === EMPTY) {
          emptyNbrs += 1;
        } else {
          const group = gid[cell];
          if (color === turn) {
            ownStones += 1;
            if (ownCnt === 0) {
              o0 = group;
              ownCnt = 1;
            } else if (group !== o0 && group !== o1 && group !== o2 && group !== o3) {
              if (ownCnt === 1) o1 = group;
              else if (ownCnt === 2) o2 = group;
              else o3 = group;
              ownCnt += 1;
            }
          } else {
            oppStones += 1;
            if (oppCnt === 0) {
              p0 = group;
              oppCnt = 1;
            } else if (group !== p0 && group !== p1 && group !== p2 && group !== p3) {
              if (oppCnt === 1) p1 = group;
              else if (oppCnt === 2) p2 = group;
              else p3 = group;
              oppCnt += 1;
            }
          }
        }
      }

      const deltaOwn = ownCnt === 0 ? 1 : 1 - ownCnt;
      const deltaOpp = oppCnt === 0 ? 1 : 1 - oppCnt;

      let tier;
      let mag = 0;
      if (deltaOwn < 0) {
        tier = ORDER_OWN_MERGE;
        mag = -deltaOwn;
      } else if (deltaOpp < 0) {
        tier = ORDER_BLOCK_MERGE;
        mag = -deltaOpp;
      } else if (deltaOwn <= 0 && deltaOpp > 0) {
        tier = ORDER_DENY_OPP_NEW; // 我下这里挡掉对方一次“新开块”的机会
      } else if (deltaOwn === 0 && deltaOpp === 0) {
        tier = ORDER_NEUTRAL;
      } else if (deltaOwn > 0 && deltaOpp > 0) {
        tier = ORDER_DOUBLE_NEW;
      } else {
        tier = ORDER_OWN_NEW;
      }

      const order =
        tier * 1000000 +
        mag * 100000 +
        ownStones * 1000 +
        emptyNbrs * 10;
      mvBuf[count] = mv;
      ordBuf[count] = order;
      count += 1;
    }
    return count;
  }

  /* ---------------- 置换表 ---------------- */

  hashKey() {
    // 53 bit 精确整数：hi 取低 21 位，lo 取 32 位。
    return (this.hashHi & 0x1fffff) * 4294967296 + (this.hashLo >>> 0);
  }

  ttSlot(key) {
    return this.hashLo & this.ttMask;
  }

  /** 返回槽位号；命中返回 >=0，否则返回 -1。 */
  ttProbe(key) {
    const slot = this.ttSlot(key);
    if (this.ttKey[slot] === key) return slot;
    return -1;
  }

  /** 清空置换表（测试用）。 */
  clearTT() {
    this.ttKey.fill(0);
    this.ttDepth.fill(0);
    this.ttFlag.fill(0);
    this.ttVal.fill(0);
    this.ttMove.fill(-1);
    this.ttGen.fill(0);
  }

  ttStore(key, depth, flag, value, move) {
    const slot = this.ttSlot(key);
    const oldKey = this.ttKey[slot];
    if (oldKey === key) {
      // 同一局面：绝不用更浅的结果覆盖更深的条目（否则迭代加深/重复搜索会自毁信息）。
      if (this.ttDepth[slot] > depth) return;
    } else if (oldKey !== 0 && this.ttGen[slot] === this.gen && this.ttDepth[slot] > depth + 3) {
      // 同槽冲突（不同局面）：本代更深的条目保留，避免被浅搜索挤掉。
      return;
    }
    this.ttKey[slot] = key;
    this.ttDepth[slot] = depth;
    this.ttFlag[slot] = flag;
    this.ttVal[slot] = value;
    this.ttMove[slot] = move;
    this.ttGen[slot] = this.gen;
    this.ttStores += 1;
  }

  /* ---------------- 静态搜索 ---------------- */

  qsearch(turn, alpha, beta, ply, qdepth) {
    this.nodes += 1;
    this.qnodes += 1;
    if ((this.nodes & 255) === 0) this.checkBudget();
    if (ply > this.seldepth) this.seldepth = ply;

    const stand = this.evalSideToMove(turn);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return stand;

    const count = this.genMoves(turn);
    const mvBuf = this.mvBuf(ply);
    const ordBuf = this.ordBuf(ply);
    // 只延伸“合并 / 挡合并”这层战术着法。
    let best = stand;
    let remaining = 0;
    for (let i = 0; i < count; i += 1) {
      if (ordBuf[i] < ORDER_BLOCK_MERGE * 1000000) ordBuf[i] = -INF;
      else remaining += 1;
    }
    if (remaining === 0) return best;
    for (let i = 0; i < count; i += 1) {
      let bi = -1;
      let bv = -INF;
      for (let j = 0; j < count; j += 1) {
        if (ordBuf[j] > bv) {
          bv = ordBuf[j];
          bi = j;
        }
      }
      if (bi < 0) break;
      const mv = mvBuf[bi];
      ordBuf[bi] = -INF;
      this.makeMove(mv, turn);
      const value = -this.qsearch(otherColor(turn), -beta, -alpha, ply + 1, qdepth - 1);
      this.undoMove();
      if (value > best) {
        best = value;
        if (best > alpha) alpha = best;
        if (alpha >= beta) {
          this.cutoffs += 1;
          break;
        }
      }
    }
    return best;
  }

  checkBudget() {
    if (this.nodes >= this.nodeLimit) throw TIMEOUT;
    if (now() >= this.deadline) throw TIMEOUT;
  }

  /* ---------------- 主搜索 ---------------- */

  negamax(turn, depth, alpha, beta, ply) {
    this.nodes += 1;
    if ((this.nodes & 255) === 0) this.checkBudget();
    if (ply > this.seldepth) this.seldepth = ply;

    if (this.emptyCount === 0) return this.terminalScore(ply);

    const key = this.hashKey();
    const slot = this.useTT ? this.ttProbe(key) : -1;
    let ttMove = -1;
    if (slot >= 0) {
      ttMove = this.ttMove[slot];
      if (this.ttDepth[slot] >= depth) {
        const flag = this.ttFlag[slot];
        const value = this.ttVal[slot];
        if (flag === TT_EXACT) {
          this.ttHits += 1;
          return value;
        }
        if (flag === TT_LOWER && value >= beta) {
          this.ttHits += 1;
          this.cutoffs += 1;
          return value;
        }
        if (flag === TT_UPPER && value <= alpha) {
          this.ttHits += 1;
          return value;
        }
      }
    }

    if (depth <= 0) {
      this.leaves += 1;
      if (this.useQSearch) return this.qsearch(turn, alpha, beta, ply, this.qDepth);
      return this.evalSideToMove(turn);
    }

    const alphaOrig = alpha;
    const count = this.genMoves(turn);
    if (count === 0) return this.terminalScore(ply);
    const mvBuf = this.mvBuf(ply);
    const ordBuf = this.ordBuf(ply);

    // 置换表着法优先。
    if (ttMove >= 0) {
      for (let i = 0; i < count; i += 1) {
        if (mvBuf[i] === ttMove) {
          ordBuf[i] += 1 << 28;
          break;
        }
      }
    }

    let bestValue = -INF;
    let bestMove = -1;
    for (let round = 0; round < count; round += 1) {
      let bi = -1;
      let bv = -INF;
      for (let j = 0; j < count; j += 1) {
        if (ordBuf[j] > bv) {
          bv = ordBuf[j];
          bi = j;
        }
      }
      if (bi < 0) break;
      const mv = mvBuf[bi];
      ordBuf[bi] = -INF;

      this.makeMove(mv, turn);
      const value = -this.negamax(otherColor(turn), depth - 1, -beta, -alpha, ply + 1);
      this.undoMove();

      if (value > bestValue) {
        bestValue = value;
        bestMove = mv;
      }
      if (bestValue > alpha) alpha = bestValue;
      if (alpha >= beta) {
        this.cutoffs += 1;
        break;
      }
    }

    // fail-soft 边界判定：只有完成本节点搜索后，才按 alphaOrig/beta 写标志。
    let flag;
    if (bestValue <= alphaOrig) flag = TT_UPPER;
    else if (bestValue >= beta) flag = TT_LOWER;
    else flag = TT_EXACT;
    if (this.useTT) this.ttStore(key, depth, flag, bestValue, bestMove);
    return bestValue;
  }

  rootSearch(turn, depth) {
    this.iterBest = -1;
    this.iterBestVal = -INF;
    this.iterSearchedMoves = 0;
    const count = this.genMoves(turn);
    if (count === 0) return this.terminalScore(0);
    const mvBuf = this.mvBuf(0);
    const ordBuf = this.ordBuf(0);
    // 上一轮最佳着法优先。
    if (this.prevBest >= 0) {
      for (let i = 0; i < count; i += 1) {
        if (mvBuf[i] === this.prevBest) {
          ordBuf[i] += 1 << 28;
          break;
        }
      }
    }
    // TT 中的最佳着法也优先。
    const key = this.hashKey();
    const slot = this.useTT ? this.ttProbe(key) : -1;
    if (slot >= 0 && this.ttMove[slot] >= 0 && this.ttMove[slot] !== this.prevBest) {
      for (let i = 0; i < count; i += 1) {
        if (mvBuf[i] === this.ttMove[slot]) {
          ordBuf[i] += 1 << 27;
          break;
        }
      }
    }

    let alpha = -INF;
    const beta = INF;
    let bestValue = -INF;
    let bestMove = -1;
    for (let round = 0; round < count; round += 1) {
      let bi = -1;
      let bv = -INF;
      for (let j = 0; j < count; j += 1) {
        if (ordBuf[j] > bv) {
          bv = ordBuf[j];
          bi = j;
        }
      }
      if (bi < 0) break;
      const mv = mvBuf[bi];
      ordBuf[bi] = -INF;

      this.makeMove(mv, turn);
      const value = -this.negamax(otherColor(turn), depth - 1, -beta, -alpha, 1);
      this.undoMove();
      this.iterSearchedMoves += 1;

      if (value > bestValue) {
        bestValue = value;
        bestMove = mv;
        // 立刻记录下来：本轮若超时，可以接受“已完整搜出的更好着法”。
        this.iterBest = bestMove;
        this.iterBestVal = bestValue;
      }
      if (value > alpha) alpha = value;
    }
    this.iterBest = bestMove;
    this.iterBestVal = bestValue;
    return bestValue;
  }

  /**
   * 对给定局面做迭代加深 Alpha-Beta。
   * @param {ArrayLike<number>} board
   * @param {number} turn BLACK / WHITE
   * @param {{timeMs?:number,nodeLimit?:number,maxDepth?:number}} options
   */
  search(board, turn, options = {}) {
    const timeMs = options.timeMs ?? 50;
    this.turnRoot = turn;
    this.initFromBoard(board);
    this.setTurn(turn);
    // 棋盘填满后最多只能再走 emptyCount 步，更深的迭代没有意义。
    const maxDepth = Math.min(options.maxDepth ?? this.n, this.emptyCount);
    if (this.emptyCount === 0) {
      return {
        move: -1,
        score: this.terminalScore(0),
        depth: 0,
        partial: false,
        nodes: 0,
        elapsed: 0,
        ttHits: 0,
        ttStores: 0,
        cutoffs: 0,
        seldepth: 0,
        qnodes: 0,
        nps: 0,
        groups: { black: this.gcountB, white: this.gcountW },
        empty: 0,
      };
    }
    this.gen += 1;
    this.nodes = 0;
    this.leaves = 0;
    this.ttHits = 0;
    this.ttStores = 0;
    this.cutoffs = 0;
    this.seldepth = 0;
    this.qnodes = 0;
    this.rootTurn = turn;

    const start = now();
    this.deadline = timeMs === Infinity ? Infinity : start + timeMs;
    this.nodeLimit = options.nodeLimit ?? Infinity;
    this.prevBest = -1;
    this.maxDepthReached = 0;

    let bestMove = -1;
    let bestValue = 0;
    let completedDepth = 0;
    let partial = false;
    const startNodes = this.nodes;

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      this.iterBest = -1;
      this.iterBestVal = -INF;
      this.iterSearchedMoves = 0;
      try {
        const value = this.rootSearch(turn, depth);
        bestMove = this.iterBest;
        bestValue = value;
        completedDepth = depth;
        this.maxDepthReached = Math.max(this.maxDepthReached, depth);
        this.prevBest = bestMove;
      } catch (error) {
        if (error !== TIMEOUT) throw error;
        // TIMEOUT 是从 makeMove 中途抛出的，上层 undoMove 没有执行，增量状态已损坏。
        // 必须先按输入局面重建引擎状态，再返回结果（否则调用方复用引擎/读 groups 会出错）。
        this.initFromBoard(board);
        this.setTurn(turn);
        this.depth = 0;
        // 超时：若本轮已经完整搜出比上一轮更好的着法，接受它。
        if (
          this.iterBest >= 0 &&
          this.iterBest !== this.prevBest &&
          this.iterSearchedMoves > 0
        ) {
          bestMove = this.iterBest;
          bestValue = this.iterBestVal;
          partial = true;
        }
        break;
      }
      if (this.nodes >= this.nodeLimit) break;
      if (now() >= this.deadline) break;
      // 已经搜到终局且分值达到终局理论上限：没有必要再加深。
      if (this.emptyCount === 0) break;
    }

    const elapsed = now() - start;
    return {
      move: bestMove,
      score: bestValue,
      depth: completedDepth,
      partial,
      nodes: this.nodes,
      elapsed,
      ttHits: this.ttHits,
      ttStores: this.ttStores,
      cutoffs: this.cutoffs,
      seldepth: this.seldepth,
      qnodes: this.qnodes,
      nps: elapsed > 0 ? this.nodes / elapsed * 1000 : 0,
      groups: { black: this.gcountB, white: this.gcountW },
      empty: this.emptyCount,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 便捷函数                                                           */
/* ------------------------------------------------------------------ */

export function chooseSearchMove(board, turn, options = {}) {
  const engine = new SearchEngine(options);
  return engine.search(board, turn, options);
}

/** 供测试：合法着法数量与分组是否可逆。 */
export function verifyState(engine) {
  const analysis = analyzeGroups(engine.board, engine.size);
  return {
    black: engine.gcountB,
    white: engine.gcountW,
    ok: engine.gcountB === analysis.black && engine.gcountW === analysis.white,
  };
}
