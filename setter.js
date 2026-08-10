(function attachSetter(root, factory) {
  const dependencies = typeof module === 'object' && module.exports
    ? {
      format: require('./shared/question-format.js'),
      maze: require('./shared/maze-core.js'),
      solver: require('./shared/solution-generator.js'),
    }
    : { format: root.RotateAfterQuestion, maze: root.RotateAfterMaze, solver: root.RotateAfterSolver };
  const api = factory(root, dependencies.format, dependencies.maze, dependencies.solver);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterSetter = api;
  if (root.document) root.addEventListener('DOMContentLoaded', () => api.boot());
})(typeof globalThis === 'object' ? globalThis : this, function createSetter(root, Format, Maze, Solver) {
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
    Object.freeze({ id: 'O', ir: 4, ic: 2 }),
  ]);
  const BALL_META = Format.BALL_META;

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
    const ballCount = Number(question.ballCount || question.balls.length || Format.TARGET.length);
    const target = Format.targetForCount(ballCount);
    const copiedQuestion = {
      app: Format.APP_NAME,
      version: Format.VERSION,
      name: question.name,
      size: Format.SIZE,
      exitCol: Format.EXIT_COL,
      ballCount,
      target,
      balls: copyBalls(question.balls),
      instructions: question.instructions.slice(),
      initialWalls: blankExtras(),
      extraInitialWalls: cloneExtras(copiedExtras),
    };
    const questionWalls = composeQuestionWalls(copiedQuestion.balls, copiedExtras);
    copiedQuestion.initialWalls = Maze.cloneWalls(questionWalls);
    return { question: copiedQuestion, extraInitialWalls: copiedExtras, questionWalls };
  }

  function defaultQuestion() {
    const extras = blankExtras();
    const ballCount = Format.TARGET.length;
    const balls = copyBalls(DEFAULT_BALLS.slice(0, ballCount));
    const question = {
      app: Format.APP_NAME,
      version: Format.VERSION,
      name: Format.DEFAULT_NAME,
      size: Format.SIZE,
      exitCol: Format.EXIT_COL,
      ballCount,
      target: Format.targetForCount(ballCount),
      balls,
      instructions: DEFAULT_INSTRUCTIONS.slice(),
      initialWalls: composeQuestionWalls(balls, extras),
      extraInitialWalls: cloneExtras(extras),
    };
    return question;
  }

  function createModel(rawQuestion) {
    if (!rawQuestion) return makeModel(defaultQuestion(), blankExtras());
    const result = Format.validate(rawQuestion);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const state = Maze.createQuestionState(result.question);
    const extras = result.question.extraInitialWalls
      ? cloneExtras(result.question.extraInitialWalls)
      : extractExtras({ ...state.question, initialWalls: state.questionWalls });
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
    const balls = model.question.target.map((id, index) => ({ id, ir: cells[index].r, ic: cells[index].c }));
    return makeModel({ ...model.question, balls }, model.extraInitialWalls);
  }

  function setBallCount(model, count) {
    const value = Number(count);
    if (!Number.isInteger(value)
      || value < Format.MIN_BALL_COUNT
      || value > Format.MAX_BALL_COUNT) throw new Error('球的数量必须为 3、4、5 或 6 颗。');
    const target = Format.targetForCount(value);
    const current = new Map(model.question.balls.map(ball => [ball.id, ball]));
    const occupied = new Set();
    const balls = [];

    function available(position) {
      return position
        && !(position.ir === Format.SIZE - 1 && position.ic === Format.EXIT_COL)
        && !occupied.has(`${position.ir},${position.ic}`);
    }

    function firstFreePosition() {
      for (let r = 0; r < Format.SIZE; r += 1) {
        for (let c = 0; c < Format.SIZE; c += 1) {
          const position = { ir: r, ic: c };
          if (available(position)) return position;
        }
      }
      throw new Error('棋盘没有可用球位。');
    }

    for (const id of target) {
      const existing = current.get(id);
      const fallback = DEFAULT_BALLS.find(ball => ball.id === id);
      const position = available(existing) ? existing : (available(fallback) ? fallback : firstFreePosition());
      balls.push({ id, ir: position.ir, ic: position.ic });
      occupied.add(`${position.ir},${position.ic}`);
    }
    return makeModel({ ...model.question, ballCount: value, target, balls }, model.extraInitialWalls);
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
      ballCount: model.question.ballCount,
      balls: copyBalls(model.question.balls),
      instructions: model.question.instructions.slice(),
      target: model.question.target.slice(),
      initialWalls: Maze.cloneWalls(model.questionWalls),
      extraInitialWalls: cloneExtras(model.extraInitialWalls),
    };
    const result = Format.validate(question);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    return result.question;
  }

  function previewSolution(model, solution) {
    if (!solution?.walls) throw new Error('答案板块数据不存在。');
    const walls = Maze.composeWalls(model.questionWalls, solution.walls);
    const simulation = Maze.simulate(model.question, solution.walls);
    return {
      walls,
      simulation,
      wallCount: Maze.answerWallCount(model.questionWalls, walls),
    };
  }

  function boot() {
    const boardElement = root.document.getElementById('mazeBoard');
    if (!boardElement || !root.RotateAfterBoard) return null;

    let model = createModel();
    let board = null;
    let solutions = [];
    let activeSolutionIndex = -1;
    let solving = false;
    let solutionGeneration = 0;
    let solveController = null;
    const result = root.document.getElementById('setterResult');
    const solutionResult = root.document.getElementById('solutionResult');
    const solutionList = root.document.getElementById('solutionList');
    const generateButton = root.document.getElementById('generateSolutionsBtn');
    const returnQuestionButton = root.document.getElementById('returnQuestionBtn');
    const nameInput = root.document.getElementById('questionNameInput');
    const countSelect = root.document.getElementById('rotationCountSelect');
    const ballCountSelect = root.document.getElementById('ballCountSelect');
    const instructionGrid = root.document.getElementById('instructionGrid');
    const targetOrder = root.document.getElementById('targetOrder');
    const fileInput = root.document.getElementById('questionFileInput');

    for (let count = 1; count <= 20; count += 1) {
      const option = root.document.createElement('option');
      option.value = String(count);
      option.textContent = `${count} 步`;
      countSelect.appendChild(option);
    }

    for (let count = Format.MIN_BALL_COUNT; count <= Format.MAX_BALL_COUNT; count += 1) {
      const option = root.document.createElement('option');
      option.value = String(count);
      option.textContent = `${count} 颗`;
      ballCountSelect.appendChild(option);
    }

    function setMessage(message, kind = '') {
      result.textContent = message;
      result.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function setSolutionMessage(message, kind = '') {
      solutionResult.textContent = message;
      solutionResult.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function renderSolutionList() {
      solutionList.innerHTML = '';
      solutions.forEach((solution, index) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.className = `solution-option${index === activeSolutionIndex ? ' active' : ''}`;
        const label = index === 0 ? '★ 最优答案' : `答案 ${index + 1}`;
        button.innerHTML = `<strong>${label}</strong><span>${solution.completionStep} 步 · ${solution.wallCount} 块板</span>`;
        button.addEventListener('click', () => {
          activeSolutionIndex = index;
          render();
          setSolutionMessage(`正在预览${label}：${solution.completionStep} 步，${solution.wallCount} 块板。`, 'success');
        });
        solutionList.appendChild(button);
      });
      returnQuestionButton.disabled = activeSolutionIndex < 0;
    }

    function invalidateSolutions(message = '题面已改变，请重新生成答案。') {
      solutionGeneration += 1;
      if (solveController) solveController.abort();
      solveController = null;
      solving = false;
      solutions = [];
      activeSolutionIndex = -1;
      generateButton.disabled = false;
      generateButton.textContent = '生成 3 个答案';
      renderSolutionList();
      setSolutionMessage(message);
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
          invalidateSolutions();
          render();
          setMessage(`第 ${index + 1} 步已改为${model.question.instructions[index] === 1 ? '顺时针' : '逆时针'}。`);
        });
        instructionGrid.appendChild(button);
      });
    }

    function renderTarget() {
      targetOrder.innerHTML = '';
      model.question.target.forEach((id, index) => {
        const ball = root.document.createElement('span');
        ball.className = 'target-ball';
        ball.style.background = BALL_META[id].color;
        ball.textContent = BALL_META[id].name;
        targetOrder.appendChild(ball);
        if (index < model.question.target.length - 1) {
          const arrow = root.document.createElement('span');
          arrow.className = 'target-arrow';
          arrow.textContent = '→';
          targetOrder.appendChild(arrow);
        }
      });
    }

    function render() {
      if (nameInput !== root.document.activeElement) nameInput.value = model.question.name;
      countSelect.value = String(model.question.instructions.length);
      ballCountSelect.value = String(model.question.ballCount);
      root.document.getElementById('headerStatus').textContent = `10×10 · 固定出口 · ${model.question.ballCount} 颗球`;
      root.document.getElementById('initialWallCount').textContent = String(extraWallCount(model));
      renderInstructions();
      renderTarget();
      renderSolutionList();
      const activeSolution = solutions[activeSolutionIndex];
      const preview = activeSolution ? previewSolution(model, activeSolution) : null;
      board.setState({
        question: model.question,
        questionWalls: model.questionWalls,
        walls: preview?.walls || model.questionWalls,
        record: [],
        step: 0,
      });
      board.setInteraction({
        wallEditing: !activeSolution && !solving,
        ballDragging: !activeSolution && !solving,
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
            invalidateSolutions();
            render();
            setMessage('初始题面板块已更新。');
          } catch (error) {
            setMessage(error.message, 'error');
          }
        },
        onBallMove(id, r, c) {
          try {
            model = moveBall(model, id, r, c);
            invalidateSolutions();
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
      invalidateSolutions();
      render();
      setMessage(`旋转次数已设为 ${model.question.instructions.length} 步。`);
    });
    ballCountSelect.addEventListener('change', () => {
      model = setBallCount(model, Number(ballCountSelect.value));
      invalidateSolutions();
      render();
      setMessage(`题目球数已设为 ${model.question.ballCount} 颗，承托板已同步。`);
    });
    root.document.getElementById('randomBallsBtn').addEventListener('click', () => {
      model = randomizeBalls(model);
      invalidateSolutions();
      render();
      setMessage('球位已随机，旋转步骤和额外初始板保持不变。');
    });
    root.document.getElementById('randomInstructionsBtn').addEventListener('click', () => {
      model = randomizeInstructions(model);
      invalidateSolutions();
      render();
      setMessage('旋转步骤已随机，球位和初始板保持不变。');
    });
    root.document.getElementById('randomQuestionBtn').addEventListener('click', () => {
      model = randomizeQuestion(model);
      invalidateSolutions();
      render();
      setMessage('已生成随机题面，额外初始板已清空。');
    });
    root.document.getElementById('clearInitialWallsBtn').addEventListener('click', () => {
      model = clearExtraWalls(model);
      invalidateSolutions();
      render();
      setMessage(`额外初始板已清空，${model.question.ballCount} 块承托板保留。`);
    });
    root.document.getElementById('resetQuestionBtn').addEventListener('click', () => {
      model = createModel();
      invalidateSolutions('已恢复默认题面，可以生成新答案。');
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
        invalidateSolutions('题目已读取，请为当前题面生成答案。');
        render();
        setMessage(`题目“${model.question.name}”读取成功。`, 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });

    returnQuestionButton.addEventListener('click', () => {
      activeSolutionIndex = -1;
      board.resetAnimation();
      render();
      setSolutionMessage(solutions.length ? '已返回题面，可选择其他答案继续预览。' : '尚未生成答案。');
    });

    generateButton.addEventListener('click', async () => {
      if (solving) {
        solutionGeneration += 1;
        if (solveController) solveController.abort();
        solveController = null;
        solving = false;
        generateButton.textContent = '生成 3 个答案';
        render();
        setSolutionMessage('已停止生成。');
        return;
      }
      if (!Solver) {
        setSolutionMessage('答案生成器未加载。', 'error');
        return;
      }
      const generation = ++solutionGeneration;
      const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      solveController = controller;
      solving = true;
      solutions = [];
      activeSolutionIndex = -1;
      generateButton.textContent = '停止生成';
      render();
      setSolutionMessage('正在逆向搜索并逐板删减，请稍候。');
      try {
        const question = exportQuestion(model);
        const found = await Solver.generateSolutions(question, {
          count: 3,
          timeLimitMs: 45000,
          signal: controller?.signal,
          shouldCancel: () => generation !== solutionGeneration,
          onProgress(progress) {
            if (generation !== solutionGeneration) return;
            setSolutionMessage(`正在生成：已找到 ${progress.found} / 3 个，当前最好顺序 ${progress.bestPrefix} / ${progress.ballCount}。`);
          },
        });
        if (generation !== solutionGeneration) return;
        solutions = found;
        activeSolutionIndex = solutions.length ? 0 : -1;
        if (solutions.length) {
          const best = solutions[0];
          setSolutionMessage(`已生成 ${solutions.length} 个有效答案。最优：${best.completionStep} 步，${best.wallCount} 块板。`, 'success');
        } else {
          setSolutionMessage('本次未找到有效答案。可以调整题面或再次生成。', 'error');
        }
      } catch (error) {
        if (generation === solutionGeneration) setSolutionMessage(error.message, 'error');
      } finally {
        if (generation === solutionGeneration) {
          if (solveController === controller) solveController = null;
          solving = false;
          generateButton.textContent = '再生成 3 个答案';
          render();
        }
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
    setBallCount,
    setRotationCount,
    toggleInstruction,
    clearExtraWalls,
    renameQuestion,
    extraWallCount,
    exportQuestion,
    previewSolution,
    boot,
  });
});
