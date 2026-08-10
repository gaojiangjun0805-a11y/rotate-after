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

  function cloneSavedSolutions(solutions = []) {
    return solutions.map(solution => ({
      solved: true,
      completionStep: solution.completionStep,
      wallCount: solution.wallCount,
      fingerprint: solution.fingerprint,
      walls: Maze.cloneWalls(solution.walls),
    }));
  }

  function normalizedAnswerWalls(question, walls) {
    const size = question.size;
    const validGrid = (grid, rows, cols) => Array.isArray(grid)
      && grid.length === rows
      && grid.every(row => Array.isArray(row)
        && row.length === cols
        && row.every(value => typeof value === 'boolean'));
    if (!validGrid(walls?.hw, size + 1, size)
      || !validGrid(walls?.vw, size, size + 1)) return null;
    const normalized = Solver.emptyAnswerWalls(question);
    for (const edge of Solver.editableEdges(question)) {
      if (edge.type === 'h') normalized.hw[edge.r][edge.c] = walls.hw[edge.r][edge.c];
      else normalized.vw[edge.r][edge.c] = walls.vw[edge.r][edge.c];
    }
    return normalized;
  }

  function canonicalSavedSolution(question, rawSolution) {
    if (!Solver || !rawSolution?.walls) return null;
    try {
      const walls = normalizedAnswerWalls(question, rawSolution.walls);
      if (!walls) return null;
      const result = Solver.evaluate(question, walls);
      if (!result.solved) return null;
      return {
        solved: true,
        completionStep: result.completionStep,
        wallCount: result.wallCount,
        fingerprint: Solver.answerFingerprint(question, walls),
        walls,
      };
    } catch (_error) {
      return null;
    }
  }

  function hydrateSavedSolutions(question, rawSolutions) {
    const unique = new Map();
    for (const rawSolution of Array.isArray(rawSolutions) ? rawSolutions : []) {
      const solution = canonicalSavedSolution(question, rawSolution);
      if (!solution || unique.has(solution.fingerprint)) continue;
      unique.set(solution.fingerprint, solution);
    }
    return [...unique.values()].sort(Solver.compareSolutions);
  }

  function composeQuestionWalls(balls, extras, exit = Format.DEFAULT_EXIT) {
    const walls = Maze.emptyWalls(Format.SIZE, exit);
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
    const base = Maze.emptyWalls(question.size, question.exit);
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

  function makeModel(question, extras, savedSolutions = []) {
    const copiedExtras = cloneExtras(extras);
    const ballCount = Number(question.ballCount || question.balls.length || Format.TARGET.length);
    const target = Format.targetForCount(ballCount);
    const copiedQuestion = {
      app: Format.APP_NAME,
      version: Format.VERSION,
      name: question.name,
      size: Format.SIZE,
      exit: { side: question.exit.side, index: question.exit.index },
      ballCount,
      target,
      balls: copyBalls(question.balls),
      instructions: question.instructions.slice(),
      initialWalls: blankExtras(),
      extraInitialWalls: cloneExtras(copiedExtras),
    };
    const questionWalls = composeQuestionWalls(copiedQuestion.balls, copiedExtras, copiedQuestion.exit);
    copiedQuestion.initialWalls = Maze.cloneWalls(questionWalls);
    return {
      question: copiedQuestion,
      extraInitialWalls: copiedExtras,
      questionWalls,
      savedSolutions: cloneSavedSolutions(savedSolutions),
    };
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
      exit: { ...Format.DEFAULT_EXIT },
      ballCount,
      target: Format.targetForCount(ballCount),
      balls,
      instructions: DEFAULT_INSTRUCTIONS.slice(),
      initialWalls: composeQuestionWalls(balls, extras, Format.DEFAULT_EXIT),
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
    const model = makeModel(state.question, extras);
    return makeModel(
      model.question,
      model.extraInitialWalls,
      hydrateSavedSolutions(model.question, rawQuestion.savedSolutions),
    );
  }

  function moveBall(model, id, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c)
      || r < 0 || r >= Format.SIZE || c < 0 || c >= Format.SIZE) throw new Error('球位超出棋盘。');
    if (Format.isExitCell(model.question.exit, r, c)) throw new Error('球不能放在出口格。');
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

  function shuffledCells(exit, rng) {
    const cells = [];
    for (let r = 0; r < Format.SIZE; r += 1) {
      for (let c = 0; c < Format.SIZE; c += 1) {
        if (!Format.isExitCell(exit, r, c)) cells.push({ r, c });
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
    const cells = shuffledCells(model.question.exit, rng);
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
        && !Format.isExitCell(model.question.exit, position.ir, position.ic)
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

  function setExit(model, side, index) {
    const exit = { side, index: Number(index) };
    if (!Format.validExit(exit)) throw new Error('出口必须位于四条边的第 1 至 10 格。');
    if (model.question.exit.side === exit.side && model.question.exit.index === exit.index) return model;
    const cell = Format.exitCell(exit);
    if (model.question.balls.some(ball => ball.ir === cell.r && ball.ic === cell.c)) {
      throw new Error('该出口格已有球，请先移动小球。');
    }
    return makeModel({ ...model.question, exit }, model.extraInitialWalls);
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
    if (!Number.isInteger(value)
      || value < Format.MIN_INSTRUCTION_COUNT
      || value > Format.MAX_INSTRUCTION_COUNT) {
      throw new Error(`旋转次数必须为 ${Format.MIN_INSTRUCTION_COUNT} 至 ${Format.MAX_INSTRUCTION_COUNT}。`);
    }
    const instructions = model.question.instructions.slice(0, value);
    while (instructions.length < value) {
      instructions.push(DEFAULT_INSTRUCTIONS[instructions.length % DEFAULT_INSTRUCTIONS.length]);
    }
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
    return makeModel(
      { ...model.question, name: normalized },
      model.extraInitialWalls,
      model.savedSolutions,
    );
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
    const exported = result.question;
    if (model.savedSolutions.length) {
      exported.savedSolutions = model.savedSolutions.map(solution => ({
        completionStep: solution.completionStep,
        wallCount: solution.wallCount,
        fingerprint: solution.fingerprint,
        walls: Maze.cloneWalls(solution.walls),
      }));
    }
    return exported;
  }

  function saveExcellentSolution(model, solution) {
    const saved = canonicalSavedSolution(model.question, solution);
    if (!saved) throw new Error('该答案无法通过当前题面验证，不能保存。');
    const savedSolutions = hydrateSavedSolutions(
      model.question,
      [...model.savedSolutions, saved],
    );
    return makeModel(model.question, model.extraInitialWalls, savedSolutions);
  }

  function removeExcellentSolution(model, fingerprint) {
    const savedSolutions = model.savedSolutions.filter(solution => solution.fingerprint !== fingerprint);
    return makeModel(model.question, model.extraInitialWalls, savedSolutions);
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

  function mergeSolutions(current, incoming, limit = 3) {
    const unique = new Map();
    for (const solution of [...(current || []), ...(incoming || [])]) {
      if (!solution || typeof solution.fingerprint !== 'string') continue;
      const saved = unique.get(solution.fingerprint);
      if (!saved || Solver.compareSolutions(solution, saved) < 0) {
        unique.set(solution.fingerprint, solution);
      }
    }
    return [...unique.values()]
      .sort(Solver.compareSolutions)
      .slice(0, Math.max(1, Number(limit) || 3));
  }

  function eventsThroughStep(events, step) {
    if (!Number.isInteger(step)) return events.slice();
    return events.filter(event => !Number.isInteger(event.step) || event.step <= step);
  }

  function createSolutionVerification(model, solution) {
    const preview = previewSolution(model, solution);
    return {
      simulation: preview.simulation,
      groups: Maze.groupEventsByStep(
        preview.simulation.events,
        model.question.instructions.length,
      ),
      wallCount: preview.wallCount,
      walls: preview.walls,
    };
  }

  function boot() {
    const boardElement = root.document.getElementById('mazeBoard');
    if (!boardElement || !root.RotateAfterBoard) return null;

    let model = createModel();
    let board = null;
    let solutions = [];
    let activeSolution = null;
    let solving = false;
    let solutionSearchMode = 'idle';
    let solutionGeneration = 0;
    let solveController = null;
    let verificationSession = null;
    let verificationStep = 0;
    let verificationRecord = [];
    let verificationMode = 'idle';
    let verificationBusy = false;
    let verificationGeneration = 0;
    const result = root.document.getElementById('setterResult');
    const solutionResult = root.document.getElementById('solutionResult');
    const solutionList = root.document.getElementById('solutionList');
    const savedSolutionList = root.document.getElementById('savedSolutionList');
    const savedSolutionCount = root.document.getElementById('savedSolutionCount');
    const generateButton = root.document.getElementById('generateSolutionsBtn');
    const improveBestButton = root.document.getElementById('improveBestSolutionBtn');
    const deployBestButton = root.document.getElementById('deployBestSolutionBtn');
    const returnQuestionButton = root.document.getElementById('returnQuestionBtn');
    const stepVerifyButton = root.document.getElementById('stepVerifySolutionBtn');
    const continuousVerifyButton = root.document.getElementById('continuousVerifySolutionBtn');
    const resetVerifyButton = root.document.getElementById('resetSolutionVerifyBtn');
    const solutionStepDisplay = root.document.getElementById('solutionStepDisplay');
    const solutionReleasedCount = root.document.getElementById('solutionReleasedCount');
    const solutionWallCount = root.document.getElementById('solutionWallCount');
    const nameInput = root.document.getElementById('questionNameInput');
    const countInput = root.document.getElementById('rotationCountInput');
    const ballCountSelect = root.document.getElementById('ballCountSelect');
    const exitSideSelect = root.document.getElementById('exitSideSelect');
    const exitIndexSelect = root.document.getElementById('exitIndexSelect');
    const instructionGrid = root.document.getElementById('instructionGrid');
    const targetOrder = root.document.getElementById('targetOrder');
    const fileInput = root.document.getElementById('questionFileInput');

    for (let count = Format.MIN_BALL_COUNT; count <= Format.MAX_BALL_COUNT; count += 1) {
      const option = root.document.createElement('option');
      option.value = String(count);
      option.textContent = `${count} 颗`;
      ballCountSelect.appendChild(option);
    }

    for (const side of Format.EXIT_SIDES) {
      const option = root.document.createElement('option');
      option.value = side;
      option.textContent = Format.EXIT_SIDE_NAMES[side];
      exitSideSelect.appendChild(option);
    }

    for (let index = 0; index < Format.SIZE; index += 1) {
      const option = root.document.createElement('option');
      option.value = String(index);
      option.textContent = `第 ${index + 1} 格`;
      exitIndexSelect.appendChild(option);
    }

    function setMessage(message, kind = '') {
      result.textContent = message;
      result.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function setSolutionMessage(message, kind = '') {
      solutionResult.textContent = message;
      solutionResult.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function getActiveSolution() {
      return activeSolution;
    }

    function sameSolution(left, right) {
      return Boolean(left && right && left.fingerprint === right.fingerprint);
    }

    function getBestKnownSolution() {
      return mergeSolutions(solutions, model.savedSolutions, 1)[0] || null;
    }

    function isExcellentSolution(solution) {
      return model.savedSolutions.some(saved => sameSolution(saved, solution));
    }

    function renderSearchControls() {
      const generating = solving && solutionSearchMode === 'generate';
      const improving = solving && solutionSearchMode === 'improve';
      generateButton.disabled = solving && !generating;
      generateButton.textContent = generating
        ? '停止生成'
        : (getBestKnownSolution() ? '继续生成 3 个答案' : '生成 3 个答案');
      improveBestButton.disabled = (!getBestKnownSolution() && !improving) || (solving && !improving);
      improveBestButton.textContent = improving ? '停止寻找' : '寻找更优解';
    }

    function renderVerificationControls() {
      const active = getActiveSolution();
      const canVerify = Boolean(active) && !solving;
      deployBestButton.disabled = !getBestKnownSolution() || solving || verificationBusy;
      returnQuestionButton.disabled = !active;
      stepVerifyButton.disabled = !canVerify
        || verificationBusy
        || verificationMode === 'continuous'
        || verificationMode === 'done';
      continuousVerifyButton.disabled = !canVerify
        || verificationBusy
        || verificationMode !== 'ready';
      resetVerifyButton.disabled = !canVerify;
      stepVerifyButton.textContent = verificationMode === 'step' ? '下一步' : '逐步验证';
      solutionStepDisplay.textContent = `${verificationStep} / ${model.question.instructions.length}`;
      solutionReleasedCount.textContent = `${verificationRecord.length} / ${model.question.ballCount}`;
      solutionWallCount.textContent = String(active?.wallCount || 0);
      renderSearchControls();
    }

    function resetVerification(mode = activeSolution ? 'ready' : 'idle') {
      verificationGeneration += 1;
      verificationSession = null;
      verificationStep = 0;
      verificationRecord = [];
      verificationMode = mode;
      verificationBusy = false;
      board?.resetAnimation();
      renderVerificationControls();
    }

    function deploySolution(solution, label = '答案') {
      if (solving || !solution) return;
      activeSolution = solution;
      resetVerification('ready');
      render();
      setSolutionMessage(`${label} 已部署：${solution.completionStep} 步，${solution.wallCount} 块板。可以逐步或连续验证。`, 'success');
    }

    function renderSolutionList() {
      solutionList.innerHTML = '';
      solutions.forEach((solution, index) => {
        const row = root.document.createElement('div');
        row.className = 'solution-row';
        const button = root.document.createElement('button');
        button.type = 'button';
        button.className = `solution-option${sameSolution(solution, activeSolution) ? ' active' : ''}`;
        const label = sameSolution(solution, getBestKnownSolution()) ? '当前最优解' : `生成答案 ${index + 1}`;
        button.innerHTML = `<strong>${label}</strong><span>${solution.completionStep} 步 · ${solution.wallCount} 块板</span>`;
        button.title = `${label}，点击部署到当前题目`;
        button.disabled = solving || verificationBusy;
        button.addEventListener('click', () => deploySolution(solution, label));

        const saved = isExcellentSolution(solution);
        const saveButton = root.document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = `solution-save-button${saved ? ' saved' : ''}`;
        saveButton.textContent = saved ? '★ 已保存' : '☆ 保存';
        saveButton.title = saved ? '从优秀答案中移除' : '保存为优秀答案';
        saveButton.disabled = solving || verificationBusy;
        saveButton.addEventListener('click', () => {
          model = saved
            ? removeExcellentSolution(model, solution.fingerprint)
            : saveExcellentSolution(model, solution);
          render();
          setSolutionMessage(saved
            ? '已从优秀答案中移除。'
            : `已保存优秀答案：${solution.completionStep} 步，${solution.wallCount} 块板。`, 'success');
        });
        row.append(button, saveButton);
        solutionList.appendChild(row);
      });
      renderSavedSolutionList();
      renderVerificationControls();
    }

    function renderSavedSolutionList() {
      savedSolutionList.innerHTML = '';
      savedSolutionCount.textContent = String(model.savedSolutions.length);
      if (!model.savedSolutions.length) {
        const empty = root.document.createElement('p');
        empty.className = 'solution-list-empty';
        empty.textContent = '生成答案后，可将满意的答案保存到这里。';
        savedSolutionList.appendChild(empty);
        return;
      }
      model.savedSolutions.forEach((solution, index) => {
        const row = root.document.createElement('div');
        row.className = 'solution-row';
        const button = root.document.createElement('button');
        button.type = 'button';
        button.className = `solution-option${sameSolution(solution, activeSolution) ? ' active' : ''}`;
        button.innerHTML = `<strong>优秀答案 ${index + 1}</strong><span>${solution.completionStep} 步 · ${solution.wallCount} 块板</span>`;
        button.title = `优秀答案 ${index + 1}，点击部署到当前题目`;
        button.disabled = solving || verificationBusy;
        button.addEventListener('click', () => deploySolution(solution, `优秀答案 ${index + 1}`));

        const removeButton = root.document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'solution-save-button saved';
        removeButton.textContent = '移除';
        removeButton.title = '从优秀答案中移除';
        removeButton.disabled = solving || verificationBusy;
        removeButton.addEventListener('click', () => {
          model = removeExcellentSolution(model, solution.fingerprint);
          if (sameSolution(solution, activeSolution)
            && !solutions.some(candidate => sameSolution(candidate, solution))) {
            activeSolution = null;
            resetVerification('idle');
          }
          render();
          setSolutionMessage('已从优秀答案中移除。');
        });
        row.append(button, removeButton);
        savedSolutionList.appendChild(row);
      });
    }

    function invalidateSolutions(message = '题面已改变，请重新生成答案。') {
      solutionGeneration += 1;
      if (solveController) solveController.abort();
      solveController = null;
      solving = false;
      solutionSearchMode = 'idle';
      solutions = [];
      activeSolution = null;
      resetVerification('idle');
      renderSolutionList();
      setSolutionMessage(message);
    }

    function renderInstructions() {
      instructionGrid.innerHTML = '';
      model.question.instructions.forEach((direction, index) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        const step = index + 1;
        button.className = `instruction-chip ${direction === 1 ? 'cw' : 'ccw'}${step < verificationStep ? ' done' : ''}${step === verificationStep && verificationStep > 0 ? ' active' : ''}`;
        button.title = direction === 1 ? '顺时针' : '逆时针';
        button.innerHTML = `<span class="step-no">${String(index + 1).padStart(2, '0')}</span><span class="turn-icon">${direction === 1 ? '↻' : '↺'}</span>`;
        button.disabled = solving || Boolean(getActiveSolution()) || verificationBusy;
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
      countInput.value = String(model.question.instructions.length);
      ballCountSelect.value = String(model.question.ballCount);
      exitSideSelect.value = model.question.exit.side;
      exitIndexSelect.value = String(model.question.exit.index);
      root.document.getElementById('headerStatus').textContent = `10×10 · ${Format.exitLabel(model.question.exit)} · ${model.question.ballCount} 颗球`;
      root.document.getElementById('initialWallCount').textContent = String(extraWallCount(model));
      renderInstructions();
      renderTarget();
      renderSolutionList();
      const activeSolution = getActiveSolution();
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
      renderVerificationControls();
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
    countInput.addEventListener('change', () => {
      try {
        model = setRotationCount(model, Number(countInput.value));
        invalidateSolutions();
        render();
        setMessage(`旋转次数已设为 ${model.question.instructions.length} 步。`);
      } catch (error) {
        countInput.value = String(model.question.instructions.length);
        setMessage(error.message, 'error');
      }
    });
    ballCountSelect.addEventListener('change', () => {
      model = setBallCount(model, Number(ballCountSelect.value));
      invalidateSolutions();
      render();
      setMessage(`题目球数已设为 ${model.question.ballCount} 颗，承托板已同步。`);
    });
    function applyExitSelection() {
      try {
        model = setExit(model, exitSideSelect.value, Number(exitIndexSelect.value));
        invalidateSolutions();
        render();
        setMessage(`出口已设为${Format.exitLabel(model.question.exit)}。`);
      } catch (error) {
        render();
        setMessage(error.message, 'error');
      }
    }
    exitSideSelect.addEventListener('change', applyExitSelection);
    exitIndexSelect.addEventListener('change', applyExitSelection);
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
        setMessage(`题目“${question.name}”已保存，包含 ${model.savedSolutions.length} 个优秀答案。`, 'success');
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
        invalidateSolutions(model.savedSolutions.length
          ? `题目已读取，并恢复 ${model.savedSolutions.length} 个优秀答案。`
          : '题目已读取，请为当前题面生成答案。');
        render();
        setMessage(`题目“${model.question.name}”读取成功，优秀答案 ${model.savedSolutions.length} 个。`, 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });

    function startVerificationSession() {
      const active = getActiveSolution();
      if (!active) return false;
      verificationSession = createSolutionVerification(model, active);
      verificationStep = 0;
      verificationRecord = [];
      board.resetAnimation();
      renderInstructions();
      renderVerificationControls();
      return true;
    }

    function verificationPlaybackOptions(generation) {
      return {
        reset: false,
        onStep(step) {
          if (generation !== verificationGeneration) return;
          verificationStep = step;
          renderInstructions();
          renderVerificationControls();
        },
        onRecord(record) {
          if (generation !== verificationGeneration) return;
          verificationRecord = record;
          renderVerificationControls();
        },
      };
    }

    function showVerificationResult() {
      if (!verificationSession) return;
      verificationBusy = false;
      verificationMode = 'done';
      const score = verificationSession.simulation.score;
      if (score.completed) {
        setSolutionMessage(`验证通过：按顺序完成于第 ${score.completionStep} 步，使用 ${verificationSession.wallCount} 块板。`, 'success');
      } else {
        const actual = verificationSession.simulation.record.length
          ? verificationSession.simulation.record.map(id => BALL_META[id]?.name || id).join(' → ')
          : '没有球出盘';
        setSolutionMessage(`验证未通过：${actual}。`, 'error');
      }
      renderInstructions();
      renderVerificationControls();
    }

    deployBestButton.addEventListener('click', () => deploySolution(getBestKnownSolution(), '当前最优解'));

    stepVerifyButton.addEventListener('click', async () => {
      if (!getActiveSolution() || verificationBusy
        || verificationMode === 'continuous' || verificationMode === 'done') return;
      if (verificationMode === 'ready') {
        verificationGeneration += 1;
        if (!startVerificationSession()) return;
        verificationMode = 'step';
      }
      const generation = verificationGeneration;
      const nextStep = verificationStep + 1;
      if (nextStep > model.question.instructions.length) {
        showVerificationResult();
        return;
      }
      verificationBusy = true;
      renderVerificationControls();
      setSolutionMessage(`正在验证第 ${nextStep} 步。`);
      const events = nextStep === 1
        ? [...verificationSession.groups[0], ...verificationSession.groups[1]]
        : verificationSession.groups[nextStep];
      const played = await board.playEvents(events, verificationPlaybackOptions(generation));
      if (generation !== verificationGeneration || played.cancelled) return;
      verificationStep = nextStep;
      verificationBusy = false;
      renderInstructions();
      renderVerificationControls();
      const completionStep = verificationSession.simulation.score.completionStep;
      if (completionStep === verificationStep
        || verificationStep === model.question.instructions.length) showVerificationResult();
      else setSolutionMessage(`第 ${verificationStep} 步完成，可以继续下一步。`);
    });

    continuousVerifyButton.addEventListener('click', async () => {
      if (!getActiveSolution() || verificationBusy || verificationMode !== 'ready') return;
      verificationGeneration += 1;
      const generation = verificationGeneration;
      if (!startVerificationSession()) return;
      verificationMode = 'continuous';
      verificationBusy = true;
      renderVerificationControls();
      setSolutionMessage('正在连续验证已部署答案。');
      const completionStep = verificationSession.simulation.score.completionStep;
      const events = eventsThroughStep(verificationSession.simulation.events, completionStep);
      const played = await board.playEvents(events, verificationPlaybackOptions(generation));
      if (generation !== verificationGeneration || played.cancelled) return;
      verificationStep = completionStep || model.question.instructions.length;
      verificationRecord = verificationSession.simulation.record.slice();
      showVerificationResult();
    });

    resetVerifyButton.addEventListener('click', () => {
      if (!getActiveSolution()) return;
      resetVerification('ready');
      render();
      setSolutionMessage('验证已重置，答案板块保持部署状态。');
    });

    returnQuestionButton.addEventListener('click', () => {
      activeSolution = null;
      resetVerification('idle');
      render();
      setSolutionMessage(getBestKnownSolution() ? '已返回题面，生成结果与优秀答案仍然保留。' : '尚未生成答案。');
    });

    function stopSolutionSearch() {
      const stoppedMode = solutionSearchMode;
      solutionGeneration += 1;
      if (solveController) solveController.abort();
      solveController = null;
      solving = false;
      solutionSearchMode = 'idle';
      render();
      setSolutionMessage(stoppedMode === 'improve' ? '已停止寻找更优解。' : '已停止生成。');
    }

    async function runSolutionSearch(mode) {
      if (solving) {
        stopSolutionSearch();
        return;
      }
      if (!Solver) {
        setSolutionMessage('答案生成器未加载。', 'error');
        return;
      }
      const previousBest = getBestKnownSolution();
      if (mode === 'improve' && !previousBest) {
        setSolutionMessage('请先生成并保存一个最优解。', 'error');
        return;
      }
      const generation = ++solutionGeneration;
      const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      solveController = controller;
      solving = true;
      solutionSearchMode = mode;
      activeSolution = null;
      resetVerification('idle');
      render();
      setSolutionMessage(mode === 'improve'
        ? `正在寻找优于 ${previousBest.completionStep} 步、${previousBest.wallCount} 块板的答案。`
        : (previousBest
          ? `正在继续搜索。当前最优解：${previousBest.completionStep} 步，${previousBest.wallCount} 块板。`
          : '正在逆向搜索并逐板删减，请稍候。'));
      try {
        const question = exportQuestion(model);
        const requestedCount = mode === 'improve' ? 1 : 3;
        const found = await Solver.generateSolutions(question, {
          count: requestedCount,
          timeLimitMs: 45000,
          betterThan: mode === 'improve' ? previousBest : null,
          signal: controller?.signal,
          shouldCancel: () => generation !== solutionGeneration,
          onProgress(progress) {
            if (generation !== solutionGeneration) return;
            setSolutionMessage(mode === 'improve'
              ? `正在寻找更优解：已搜索 ${progress.restarts} 轮，目标优于 ${previousBest.completionStep} 步、${previousBest.wallCount} 块板。`
              : `正在生成：已找到 ${progress.found} / ${requestedCount} 个，当前最好顺序 ${progress.bestPrefix} / ${progress.ballCount}。`);
          },
        });
        if (generation !== solutionGeneration) return;
        solutions = mergeSolutions(solutions, found, 3);
        if (mode === 'improve' && found.length) {
          const best = getBestKnownSolution();
          setSolutionMessage(`已找到更优解：${best.completionStep} 步，${best.wallCount} 块板，已替换原最优解。`, 'success');
        } else if (mode === 'improve') {
          setSolutionMessage(`没有找到更优解，继续保留：${previousBest.completionStep} 步，${previousBest.wallCount} 块板。`);
        } else if (found.length && getBestKnownSolution()) {
          const best = getBestKnownSolution();
          const improved = !previousBest || Solver.compareSolutions(best, previousBest) < 0;
          setSolutionMessage(`本轮生成 ${found.length} 个有效答案。${improved ? '已更新' : '继续保留'}最优解：${best.completionStep} 步，${best.wallCount} 块板。`, 'success');
        } else if (getBestKnownSolution()) {
          const best = getBestKnownSolution();
          setSolutionMessage(`本轮未找到新答案，继续保留最优解：${best.completionStep} 步，${best.wallCount} 块板。`);
        } else {
          setSolutionMessage('本次未找到有效答案。可以调整题面或再次生成。', 'error');
        }
      } catch (error) {
        if (generation === solutionGeneration) setSolutionMessage(error.message, 'error');
      } finally {
        if (generation === solutionGeneration) {
          if (solveController === controller) solveController = null;
          solving = false;
          solutionSearchMode = 'idle';
          render();
        }
      }
    }

    generateButton.addEventListener('click', () => runSolutionSearch('generate'));
    improveBestButton.addEventListener('click', () => runSolutionSearch('improve'));

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
    setExit,
    setRotationCount,
    toggleInstruction,
    clearExtraWalls,
    renameQuestion,
    extraWallCount,
    exportQuestion,
    saveExcellentSolution,
    removeExcellentSolution,
    previewSolution,
    mergeSolutions,
    eventsThroughStep,
    createSolutionVerification,
    boot,
  });
});
