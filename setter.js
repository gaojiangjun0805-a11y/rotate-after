(function attachSetter(root, factory) {
  const dependencies = typeof module === 'object' && module.exports
    ? {
      format: require('./shared/question-format.js'),
      maze: require('./shared/maze-core.js'),
    }
    : { format: root.RotateAfterQuestion, maze: root.RotateAfterMaze };
  const api = factory(root, dependencies.format, dependencies.maze);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterSetter = api;
  if (root.document) root.addEventListener('DOMContentLoaded', () => api.boot());
})(typeof globalThis === 'object' ? globalThis : this, function createSetter(root, Format, Maze) {
  'use strict';

  const DEFAULT_INSTRUCTIONS = Object.freeze([
    1, -1, 1, 1, -1, -1, 1, -1, -1, 1,
    1, -1, 1, 1, -1, -1, 1, -1, -1, 1,
  ]);
  const DEFAULT_BALLS = Object.freeze([
    Object.freeze({ id: 'R', ir: 1, ic: 1 }),
    Object.freeze({ id: 'Y', ir: 1, ic: 8 }),
    Object.freeze({ id: 'B', ir: 5, ic: 5 }),
    Object.freeze({ id: 'G', ir: 7, ic: 1 }),
    Object.freeze({ id: 'P', ir: 7, ic: 8 }),
  ]);
  const BALL_META = Object.freeze({
    R: { name: '红', color: '#ef4848' },
    Y: { name: '黄', color: '#f1c82d' },
    B: { name: '蓝', color: '#4382e8' },
    G: { name: '绿', color: '#28c76f' },
    P: { name: '紫', color: '#a358e6' },
  });

  function copyBalls(balls) {
    return balls.map(ball => ({ id: ball.id, ir: ball.ir, ic: ball.ic }));
  }

  function blankExtras() {
    return {
      hw: Array.from({ length: Format.SIZE + 1 }, () => Array(Format.SIZE).fill(false)),
      vw: Array.from({ length: Format.SIZE }, () => Array(Format.SIZE + 1).fill(false)),
    };
  }

  function cloneExtras(extras) {
    return Maze.cloneWalls(extras);
  }

  function composeQuestionWalls(balls, extras) {
    const walls = Maze.emptyWalls(Format.SIZE, Format.EXIT_COL);
    for (let r = 1; r < Format.SIZE; r += 1) {
      for (let c = 0; c < Format.SIZE; c += 1) walls.hw[r][c] = Boolean(extras.hw[r][c]);
    }
    for (let r = 0; r < Format.SIZE; r += 1) {
      for (let c = 1; c < Format.SIZE; c += 1) walls.vw[r][c] = Boolean(extras.vw[r][c]);
    }
    Maze.addSupports(walls, balls);
    return walls;
  }

  function extractExtras(question) {
    const extras = blankExtras();
    const base = Maze.emptyWalls(question.size, question.exitCol);
    Maze.addSupports(base, question.balls);
    for (let r = 1; r < question.size; r += 1) {
      for (let c = 0; c < question.size; c += 1) {
        extras.hw[r][c] = Boolean(question.initialWalls.hw[r][c] && !base.hw[r][c]);
      }
    }
    for (let r = 0; r < question.size; r += 1) {
      for (let c = 1; c < question.size; c += 1) {
        extras.vw[r][c] = Boolean(question.initialWalls.vw[r][c] && !base.vw[r][c]);
      }
    }
    return extras;
  }

  function makeModel(question, extras) {
    const copiedExtras = cloneExtras(extras);
    const copiedQuestion = {
      app: Format.APP_NAME,
      version: Format.VERSION,
      name: question.name,
      size: Format.SIZE,
      exitCol: Format.EXIT_COL,
      target: Format.TARGET.slice(),
      balls: copyBalls(question.balls),
      instructions: question.instructions.slice(),
      initialWalls: blankExtras(),
    };
    const questionWalls = composeQuestionWalls(copiedQuestion.balls, copiedExtras);
    copiedQuestion.initialWalls = Maze.cloneWalls(questionWalls);
    return { question: copiedQuestion, extraInitialWalls: copiedExtras, questionWalls };
  }

  function defaultQuestion() {
    const extras = blankExtras();
    const question = {
      app: Format.APP_NAME,
      version: Format.VERSION,
      name: Format.DEFAULT_NAME,
      size: Format.SIZE,
      exitCol: Format.EXIT_COL,
      target: Format.TARGET.slice(),
      balls: copyBalls(DEFAULT_BALLS),
      instructions: DEFAULT_INSTRUCTIONS.slice(),
      initialWalls: composeQuestionWalls(DEFAULT_BALLS, extras),
    };
    return question;
  }

  function createModel(rawQuestion) {
    if (!rawQuestion) return makeModel(defaultQuestion(), blankExtras());
    const result = Format.validate(rawQuestion);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const state = Maze.createQuestionState(result.question);
    const extras = extractExtras({ ...state.question, initialWalls: state.questionWalls });
    return makeModel(state.question, extras);
  }

  function moveBall(model, id, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c)
      || r < 0 || r >= Format.SIZE || c < 0 || c >= Format.SIZE) throw new Error('球位超出棋盘。');
    if (r === Format.SIZE - 1 && c === Format.EXIT_COL) throw new Error('球不能放在固定出口格。');
    if (model.question.balls.some(ball => ball.id !== id && ball.ir === r && ball.ic === c)) {
      throw new Error('该位置已有球。');
    }
    const balls = copyBalls(model.question.balls);
    const ball = balls.find(item => item.id === id);
    if (!ball) throw new Error('未找到要移动的球。');
    ball.ir = r;
    ball.ic = c;
    return makeModel({ ...model.question, balls }, model.extraInitialWalls);
  }

  function isSupport(model, edge) {
    return Maze.supportEdges(model.question.balls).some(support => (
      support.type === edge.type && support.r === edge.r && support.c === edge.c
    ));
  }

  function toggleInitialWall(model, edge) {
    if (!Maze.isInternalEdge(edge, Format.SIZE)) throw new Error('只能编辑棋盘内部板块。');
    if (isSupport(model, edge)) throw new Error('球下方承托板会随球移动，不能单独删除。');
    const extras = cloneExtras(model.extraInitialWalls);
    if (edge.type === 'h') extras.hw[edge.r][edge.c] = !extras.hw[edge.r][edge.c];
    else extras.vw[edge.r][edge.c] = !extras.vw[edge.r][edge.c];
    return makeModel(model.question, extras);
  }

  function shuffledCells(rng) {
    const cells = [];
    for (let r = 0; r < Format.SIZE; r += 1) {
      for (let c = 0; c < Format.SIZE; c += 1) {
        if (!(r === Format.SIZE - 1 && c === Format.EXIT_COL)) cells.push({ r, c });
      }
    }
    for (let index = cells.length - 1; index > 0; index -= 1) {
      const value = Math.max(0, Math.min(0.999999999, Number(rng())));
      const swap = Math.floor(value * (index + 1));
      [cells[index], cells[swap]] = [cells[swap], cells[index]];
    }
    return cells;
  }

  function randomizeBalls(model, rng = Math.random) {
    const cells = shuffledCells(rng);
    const balls = Format.TARGET.map((id, index) => ({ id, ir: cells[index].r, ic: cells[index].c }));
    return makeModel({ ...model.question, balls }, model.extraInitialWalls);
  }

  function randomizeInstructions(model, rng = Math.random) {
    const instructions = model.question.instructions.map(() => rng() < 0.5 ? -1 : 1);
    return makeModel({ ...model.question, instructions }, model.extraInitialWalls);
  }

  function randomizeQuestion(model, rng = Math.random) {
    const ballsModel = randomizeBalls(model, rng);
    const instructions = ballsModel.question.instructions.map(() => rng() < 0.5 ? -1 : 1);
    return makeModel({ ...ballsModel.question, instructions }, blankExtras());
  }

  function setRotationCount(model, count) {
    const value = Number(count);
    if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error('旋转次数必须为 1 至 20。');
    const instructions = model.question.instructions.slice(0, value);
    while (instructions.length < value) instructions.push(DEFAULT_INSTRUCTIONS[instructions.length]);
    return makeModel({ ...model.question, instructions }, model.extraInitialWalls);
  }

  function toggleInstruction(model, index) {
    if (!Number.isInteger(index) || index < 0 || index >= model.question.instructions.length) {
      throw new Error('旋转步骤不存在。');
    }
    const instructions = model.question.instructions.slice();
    instructions[index] = instructions[index] === 1 ? -1 : 1;
    return makeModel({ ...model.question, instructions }, model.extraInitialWalls);
  }

  function clearExtraWalls(model) {
    return makeModel(model.question, blankExtras());
  }

  function renameQuestion(model, name) {
    const normalized = String(name || '').trim().slice(0, 40) || Format.DEFAULT_NAME;
    return makeModel({ ...model.question, name: normalized }, model.extraInitialWalls);
  }

  function extraWallCount(model) {
    const base = composeQuestionWalls(model.question.balls, blankExtras());
    return Maze.answerWallCount(base, model.questionWalls);
  }

  function exportQuestion(model) {
    const question = {
      ...model.question,
      balls: copyBalls(model.question.balls),
      instructions: model.question.instructions.slice(),
      target: Format.TARGET.slice(),
      initialWalls: Maze.cloneWalls(model.questionWalls),
    };
    const result = Format.validate(question);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    return result.question;
  }

  function boot() {
    const boardElement = root.document.getElementById('mazeBoard');
    if (!boardElement || !root.RotateAfterBoard) return null;

    let model = createModel();
    let board = null;
    const result = root.document.getElementById('setterResult');
    const nameInput = root.document.getElementById('questionNameInput');
    const countSelect = root.document.getElementById('rotationCountSelect');
    const instructionGrid = root.document.getElementById('instructionGrid');
    const targetOrder = root.document.getElementById('targetOrder');
    const fileInput = root.document.getElementById('questionFileInput');

    for (let count = 1; count <= 20; count += 1) {
      const option = root.document.createElement('option');
      option.value = String(count);
      option.textContent = `${count} 步`;
      countSelect.appendChild(option);
    }

    for (const id of Format.TARGET) {
      const ball = root.document.createElement('span');
      ball.className = 'target-ball';
      ball.style.background = BALL_META[id].color;
      ball.textContent = BALL_META[id].name;
      targetOrder.appendChild(ball);
      if (id !== Format.TARGET.at(-1)) {
        const arrow = root.document.createElement('span');
        arrow.className = 'target-arrow';
        arrow.textContent = '→';
        targetOrder.appendChild(arrow);
      }
    }

    function setMessage(message, kind = '') {
      result.textContent = message;
      result.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function renderInstructions() {
      instructionGrid.innerHTML = '';
      model.question.instructions.forEach((direction, index) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.className = `instruction-chip ${direction === 1 ? 'cw' : 'ccw'}`;
        button.title = direction === 1 ? '顺时针' : '逆时针';
        button.innerHTML = `<span class="step-no">${String(index + 1).padStart(2, '0')}</span><span class="turn-icon">${direction === 1 ? '↻' : '↺'}</span>`;
        button.addEventListener('click', () => {
          model = toggleInstruction(model, index);
          render();
          setMessage(`第 ${index + 1} 步已改为${model.question.instructions[index] === 1 ? '顺时针' : '逆时针'}。`);
        });
        instructionGrid.appendChild(button);
      });
    }

    function render() {
      if (nameInput !== root.document.activeElement) nameInput.value = model.question.name;
      countSelect.value = String(model.question.instructions.length);
      root.document.getElementById('initialWallCount').textContent = String(extraWallCount(model));
      renderInstructions();
      board.setState({
        question: model.question,
        questionWalls: model.questionWalls,
        walls: model.questionWalls,
        record: [],
        step: 0,
      });
    }

    board = root.RotateAfterBoard.create({
      host: boardElement,
      question: model.question,
      questionWalls: model.questionWalls,
      walls: model.questionWalls,
      interaction: {
        wallEditing: true,
        ballDragging: true,
        onEdge(edge) {
          try {
            model = toggleInitialWall(model, edge);
            render();
            setMessage('初始题面板块已更新。');
          } catch (error) {
            setMessage(error.message, 'error');
          }
        },
        onBallMove(id, r, c) {
          try {
            model = moveBall(model, id, r, c);
            render();
            setMessage('球位与承托板已同步移动。');
          } catch (error) {
            render();
            setMessage(error.message, 'error');
          }
        },
      },
    });

    nameInput.addEventListener('change', () => {
      model = renameQuestion(model, nameInput.value);
      render();
    });
    countSelect.addEventListener('change', () => {
      model = setRotationCount(model, Number(countSelect.value));
      render();
      setMessage(`旋转次数已设为 ${model.question.instructions.length} 步。`);
    });
    root.document.getElementById('randomBallsBtn').addEventListener('click', () => {
      model = randomizeBalls(model);
      render();
      setMessage('球位已随机，旋转步骤和额外初始板保持不变。');
    });
    root.document.getElementById('randomInstructionsBtn').addEventListener('click', () => {
      model = randomizeInstructions(model);
      render();
      setMessage('旋转步骤已随机，球位和初始板保持不变。');
    });
    root.document.getElementById('randomQuestionBtn').addEventListener('click', () => {
      model = randomizeQuestion(model);
      render();
      setMessage('已生成随机题面，额外初始板已清空。');
    });
    root.document.getElementById('clearInitialWallsBtn').addEventListener('click', () => {
      model = clearExtraWalls(model);
      render();
      setMessage('额外初始板已清空，五块承托板保留。');
    });
    root.document.getElementById('resetQuestionBtn').addEventListener('click', () => {
      model = createModel();
      render();
      setMessage('已恢复默认题面。');
    });
    root.document.getElementById('saveQuestionBtn').addEventListener('click', () => {
      try {
        model = renameQuestion(model, nameInput.value);
        const question = exportQuestion(model);
        const blob = new Blob([Format.serialize(question)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = root.document.createElement('a');
        link.href = url;
        link.download = Format.fileName(question);
        root.document.body.appendChild(link);
        link.click();
        link.remove();
        root.setTimeout(() => URL.revokeObjectURL(url), 0);
        render();
        setMessage(`题目“${question.name}”已保存。`, 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      }
    });
    root.document.getElementById('loadQuestionBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const [file] = fileInput.files;
      if (!file) return;
      try {
        model = createModel(JSON.parse(await file.text()));
        render();
        setMessage(`题目“${model.question.name}”读取成功。`, 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });

    render();
    return { get model() { return model; }, board };
  }

  return Object.freeze({
    createModel,
    moveBall,
    toggleInitialWall,
    randomizeBalls,
    randomizeInstructions,
    randomizeQuestion,
    setRotationCount,
    toggleInstruction,
    clearExtraWalls,
    renameQuestion,
    extraWallCount,
    exportQuestion,
    boot,
  });
});
