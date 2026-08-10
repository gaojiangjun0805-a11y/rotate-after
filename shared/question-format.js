(function attachQuestionFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterQuestion = api;
})(typeof globalThis === 'object' ? globalThis : this, function createQuestionFormat() {
  'use strict';

  const APP_NAME = '旋转之后';
  const VERSION = 3;
  const SIZE = 10;
  const EXIT_COL = 5;
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
      exitCol: source.exitCol,
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
    if (question.exitCol !== EXIT_COL) errors.push('出口必须固定在底边第 6 列。');
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
      if (ball.ir === SIZE - 1 && ball.ic === EXIT_COL) hasExitBall = true;
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
    return JSON.stringify(result.question, null, 2);
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
    TARGET,
    BALL_ORDER,
    BALL_META,
    MIN_BALL_COUNT,
    MAX_BALL_COUNT,
    DEFAULT_NAME,
    targetForCount,
    copyWalls,
    normalize,
    validate,
    serialize,
    fileName,
  });
});
