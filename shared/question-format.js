(function attachQuestionFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterQuestion = api;
})(typeof globalThis === 'object' ? globalThis : this, function createQuestionFormat() {
  'use strict';

  const APP_NAME = '旋转之后';
  const VERSION = 2;
  const SIZE = 10;
  const EXIT_COL = 5;
  const TARGET = Object.freeze(['R', 'Y', 'B', 'G', 'P']);
  const DEFAULT_NAME = '未命名题目';

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

    return {
      app: APP_NAME,
      version: VERSION,
      name: String(source.name || DEFAULT_NAME).trim().slice(0, 40) || DEFAULT_NAME,
      size: source.size,
      exitCol: source.exitCol,
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

    if (question.size !== SIZE) errors.push('棋盘必须为固定的 10×10。');
    if (question.exitCol !== EXIT_COL) errors.push('出口必须固定在底边第 6 列。');
    if (question.target.length !== TARGET.length
      || !question.target.every((id, index) => id === TARGET[index])) {
      errors.push('目标顺序必须固定为红黄蓝绿紫。');
    }

    if (question.balls.length !== TARGET.length) {
      errors.push('题目必须包含红、黄、蓝、绿、紫五颗球。');
    }

    const ids = new Set();
    const cells = new Set();
    let hasUnknownId = false;
    let hasOutOfRange = false;
    let hasExitBall = false;
    let hasOverlap = false;

    for (const ball of question.balls) {
      if (!TARGET.includes(ball.id) || ids.has(ball.id)) hasUnknownId = true;
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

    if (hasUnknownId || ids.size !== TARGET.length) errors.push('球颜色必须为红、黄、蓝、绿、紫且各一颗。');
    if (hasOutOfRange) errors.push('所有球位必须位于棋盘范围内。');
    if (hasExitBall) errors.push('球的初始位置不能占用出口格。');
    if (hasOverlap) errors.push('五颗球必须位于不同格子。');

    if (question.instructions.length < 1 || question.instructions.length > 20) {
      errors.push('旋转次数必须为 1 至 20。');
    } else if (!question.instructions.every(value => value === 1 || value === -1)) {
      errors.push('每一步旋转只能是顺时针或逆时针。');
    }

    if (!validGrid(question.initialWalls.hw, SIZE + 1, SIZE)
      || !validGrid(question.initialWalls.vw, SIZE, SIZE + 1)) {
      errors.push('初始板块数据尺寸错误。');
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
    DEFAULT_NAME,
    copyWalls,
    normalize,
    validate,
    serialize,
    fileName,
  });
});
