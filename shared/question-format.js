(function attachQuestionFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterQuestion = api;
})(typeof globalThis === 'object' ? globalThis : this, function createQuestionFormat() {
  'use strict';

  const APP_NAME = '旋转之后';
  const VERSION = 4;
  const SIZE = 10;
  const EXIT_COL = 5;
  const EXIT_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
  const EXIT_SIDE_NAMES = Object.freeze({ top: '上边', right: '右边', bottom: '下边', left: '左边' });
  const DEFAULT_EXIT = Object.freeze({ side: 'bottom', index: EXIT_COL });
  const TARGET = Object.freeze(['R', 'Y', 'B', 'G', 'P']);
  const BALL_ORDER = Object.freeze(['R', 'Y', 'B', 'G', 'P', 'O']);
  const BALL_META = Object.freeze({
    R: Object.freeze({ name: '红', color: '#ef4848' }),
    Y: Object.freeze({ name: '黄', color: '#f1c82d' }),
    B: Object.freeze({ name: '蓝', color: '#4382e8' }),
    G: Object.freeze({ name: '绿', color: '#28c76f' }),
    P: Object.freeze({ name: '紫', color: '#a358e6' }),
    O: Object.freeze({ name: '橙', color: '#f28a32' }),
  });
  const MIN_BALL_COUNT = 3;
  const MAX_BALL_COUNT = 6;
  const DEFAULT_NAME = '未命名题目';

  function targetForCount(count) {
    return BALL_ORDER.slice(0, Number(count));
  }

  function inferBallCount(source) {
    if (Number.isInteger(source.ballCount)) return source.ballCount;
    if (Array.isArray(source.balls)
      && source.balls.length >= MIN_BALL_COUNT
      && source.balls.length <= MAX_BALL_COUNT) return source.balls.length;
    if (Array.isArray(source.target)
      && source.target.length >= MIN_BALL_COUNT
      && source.target.length <= MAX_BALL_COUNT) return source.target.length;
    return TARGET.length;
  }

  function copyGrid(grid) {
    return Array.isArray(grid)
      ? grid.map(row => Array.isArray(row) ? row.slice() : row)
      : [];
  }

  function copyWalls(walls) {
    return {
      hw: copyGrid(walls && walls.hw),
      vw: copyGrid(walls && walls.vw),
    };
  }

  function normalizeExit(source) {
    if (source?.exit && typeof source.exit === 'object') {
      return { side: source.exit.side, index: source.exit.index };
    }
    if (Object.prototype.hasOwnProperty.call(source || {}, 'exitSide')
      || Object.prototype.hasOwnProperty.call(source || {}, 'exitIndex')) {
      return { side: source.exitSide, index: source.exitIndex };
    }
    return { side: 'bottom', index: source?.exitCol };
  }

  function validExit(exit, size = SIZE) {
    return Boolean(exit
      && EXIT_SIDES.includes(exit.side)
      && Number.isInteger(exit.index)
      && exit.index >= 0
      && exit.index < size);
  }

  function exitCell(exit, size = SIZE) {
    if (!validExit(exit, size)) return null;
    if (exit.side === 'top') return { r: 0, c: exit.index };
    if (exit.side === 'right') return { r: exit.index, c: size - 1 };
    if (exit.side === 'bottom') return { r: size - 1, c: exit.index };
    return { r: exit.index, c: 0 };
  }

  function exitEdge(exit, size = SIZE) {
    if (!validExit(exit, size)) return null;
    if (exit.side === 'top') return { type: 'h', r: 0, c: exit.index };
    if (exit.side === 'right') return { type: 'v', r: exit.index, c: size };
    if (exit.side === 'bottom') return { type: 'h', r: size, c: exit.index };
    return { type: 'v', r: exit.index, c: 0 };
  }

  function exitGravity(exit) {
    return EXIT_SIDES.indexOf(exit?.side);
  }

  function isExitCell(exit, r, c, size = SIZE) {
    const cell = exitCell(exit, size);
    return Boolean(cell && cell.r === r && cell.c === c);
  }

  function exitLabel(exit) {
    if (!validExit(exit)) return '出口未设置';
    return `${EXIT_SIDE_NAMES[exit.side]}第 ${exit.index + 1} 格`;
  }

  function normalize(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const sourceInstructions = Array.isArray(source.instructions)
      ? source.instructions
      : source.instr;
    const hasExtraInitialWalls = Object.prototype.hasOwnProperty.call(source, 'extraInitialWalls');

    return {
      app: APP_NAME,
      version: VERSION,
      name: String(source.name || DEFAULT_NAME).trim().slice(0, 40) || DEFAULT_NAME,
      size: source.size,
      exit: normalizeExit(source),
      ballCount: inferBallCount(source),
      target: Array.isArray(source.target) ? source.target.slice() : [],
      balls: Array.isArray(source.balls)
        ? source.balls.map(ball => ({
          id: ball && ball.id,
          ir: ball && ball.ir,
          ic: ball && ball.ic,
        }))
        : [],
      instructions: Array.isArray(sourceInstructions) ? sourceInstructions.slice() : [],
      initialWalls: copyWalls(source.initialWalls),
      extraInitialWalls: hasExtraInitialWalls && source.extraInitialWalls != null
        ? copyWalls(source.extraInitialWalls)
        : null,
    };
  }

  function validGrid(grid, rows, cols) {
    return Array.isArray(grid)
      && grid.length === rows
      && grid.every(row => Array.isArray(row)
        && row.length === cols
        && row.every(value => typeof value === 'boolean'));
  }

  function savedSolutionsForSerialization(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(solution => {
      if (!solution || typeof solution !== 'object'
        || !Number.isInteger(solution.completionStep)
        || solution.completionStep < 0
        || !Number.isInteger(solution.wallCount)
        || solution.wallCount < 0
        || typeof solution.fingerprint !== 'string'
        || !validGrid(solution.walls?.hw, SIZE + 1, SIZE)
        || !validGrid(solution.walls?.vw, SIZE, SIZE + 1)) return [];
      return [{
        completionStep: solution.completionStep,
        wallCount: solution.wallCount,
        fingerprint: solution.fingerprint,
        walls: copyWalls(solution.walls),
      }];
    });
  }

  function validate(raw) {
    const question = normalize(raw);
    const errors = [];
    const source = raw && typeof raw === 'object' ? raw : {};

    if (Object.prototype.hasOwnProperty.call(source, 'app') && source.app !== APP_NAME) {
      errors.push('题目文件不属于“旋转之后”项目。');
    }
    if (Object.prototype.hasOwnProperty.call(source, 'version')
      && (!Number.isInteger(source.version) || source.version < 1 || source.version > VERSION)) {
      errors.push(`题目文件版本不受支持，当前最高支持 v${VERSION}。`);
    }

    if (question.size !== SIZE) errors.push('棋盘必须为固定的 10×10。');
    if (!EXIT_SIDES.includes(question.exit.side)) errors.push('出口方向必须为上、右、下、左四边之一。');
    if (!Number.isInteger(question.exit.index)
      || question.exit.index < 0
      || question.exit.index >= SIZE) errors.push('出口位置必须为所选边的第 1 至 10 格。');
    const validBallCount = Number.isInteger(question.ballCount)
      && question.ballCount >= MIN_BALL_COUNT
      && question.ballCount <= MAX_BALL_COUNT;
    const expectedTarget = validBallCount ? targetForCount(question.ballCount) : [];
    if (!validBallCount) errors.push('球的数量必须为 3、4、5 或 6 颗。');
    if (!validBallCount
      || question.target.length !== expectedTarget.length
      || !question.target.every((id, index) => id === expectedTarget[index])) {
      const names = expectedTarget.map(id => BALL_META[id].name).join('') || '所选球数对应颜色';
      errors.push(`目标顺序必须固定为${names}。`);
    }

    if (!validBallCount || question.balls.length !== question.ballCount) {
      errors.push(`题目必须包含 ${validBallCount ? question.ballCount : '3 至 6'} 颗球。`);
    }

    const ids = new Set();
    const cells = new Set();
    let hasUnknownId = false;
    let hasOutOfRange = false;
    let hasExitBall = false;
    let hasOverlap = false;

    for (const ball of question.balls) {
      if (!expectedTarget.includes(ball.id) || ids.has(ball.id)) hasUnknownId = true;
      ids.add(ball.id);

      if (!Number.isInteger(ball.ir) || !Number.isInteger(ball.ic)
        || ball.ir < 0 || ball.ir >= SIZE || ball.ic < 0 || ball.ic >= SIZE) {
        hasOutOfRange = true;
        continue;
      }
      if (validExit(question.exit) && isExitCell(question.exit, ball.ir, ball.ic)) hasExitBall = true;
      const cell = `${ball.ir},${ball.ic}`;
      if (cells.has(cell)) hasOverlap = true;
      cells.add(cell);
    }

    if (hasUnknownId || ids.size !== expectedTarget.length) {
      const names = expectedTarget.map(id => BALL_META[id].name).join('、') || '所选颜色';
      errors.push(`球颜色必须为${names}且各一颗。`);
    }
    if (hasOutOfRange) errors.push('所有球位必须位于棋盘范围内。');
    if (hasExitBall) errors.push('球的初始位置不能占用出口格。');
    if (hasOverlap) errors.push('所有球必须位于不同格子。');

    if (question.instructions.length < 1 || question.instructions.length > 20) {
      errors.push('旋转次数必须为 1 至 20。');
    } else if (!question.instructions.every(value => value === 1 || value === -1)) {
      errors.push('每一步旋转只能是顺时针或逆时针。');
    }

    if (!validGrid(question.initialWalls.hw, SIZE + 1, SIZE)
      || !validGrid(question.initialWalls.vw, SIZE, SIZE + 1)) {
      errors.push('初始板块数据尺寸错误。');
    }
    if (question.extraInitialWalls !== null
      && (!validGrid(question.extraInitialWalls.hw, SIZE + 1, SIZE)
        || !validGrid(question.extraInitialWalls.vw, SIZE, SIZE + 1))) {
      errors.push('额外初始板块数据尺寸错误。');
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, question, errors: [] };
  }

  function serialize(question) {
    const result = validate(question);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const payload = { ...result.question };
    const savedSolutions = savedSolutionsForSerialization(question?.savedSolutions);
    if (savedSolutions.length) payload.savedSolutions = savedSolutions;
    return JSON.stringify(payload, null, 2);
  }

  function fileName(question) {
    const normalized = normalize(question);
    const safeName = normalized.name.replace(/[\\/:*?"<>|]/g, '_');
    return `${safeName}-${normalized.instructions.length}步.json`;
  }

  return Object.freeze({
    APP_NAME,
    VERSION,
    SIZE,
    EXIT_COL,
    EXIT_SIDES,
    EXIT_SIDE_NAMES,
    DEFAULT_EXIT,
    TARGET,
    BALL_ORDER,
    BALL_META,
    MIN_BALL_COUNT,
    MAX_BALL_COUNT,
    DEFAULT_NAME,
    targetForCount,
    copyWalls,
    normalizeExit,
    validExit,
    exitCell,
    exitEdge,
    exitGravity,
    isExitCell,
    exitLabel,
    normalize,
    validate,
    serialize,
    fileName,
  });
});
