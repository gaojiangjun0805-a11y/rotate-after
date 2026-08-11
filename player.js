(function attachPlayer(root, factory) {
  const dependencies = typeof module === 'object' && module.exports
    ? {
      format: require('./shared/question-format.js'),
      maze: require('./shared/maze-core.js'),
    }
    : { format: root.RotateAfterQuestion, maze: root.RotateAfterMaze };
  const api = factory(root, dependencies.format, dependencies.maze);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterPlayer = api;
  if (root.document) root.addEventListener('DOMContentLoaded', () => api.boot());
})(typeof globalThis === 'object' ? globalThis : this, function createPlayer(root, Format, Maze) {
  'use strict';

  const BALL_META = Format.BALL_META;
  const PLAYER_STAGE_WIDTH = 1920;
  const PLAYER_STAGE_HEIGHT = 1080;

  function calculateStageScale(viewportWidth, viewportHeight) {
    const width = Number(viewportWidth);
    const height = Number(viewportHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
    return Math.min(width / PLAYER_STAGE_WIDTH, height / PLAYER_STAGE_HEIGHT);
  }

  async function setFullscreen(document, enabled) {
    if (!document) return false;
    if (enabled) {
      if (document.fullscreenElement) return true;
      if (typeof document.documentElement?.requestFullscreen !== 'function') return false;
      try {
        await document.documentElement.requestFullscreen();
        return Boolean(document.fullscreenElement);
      } catch (error) {
        return false;
      }
    }

    if (!document.fullscreenElement) return true;
    if (typeof document.exitFullscreen !== 'function') return false;
    try {
      await document.exitFullscreen();
      return !document.fullscreenElement;
    } catch (error) {
      return false;
    }
  }

  function makeModel(question, questionWalls, walls) {
    const combined = Maze.cloneWalls(walls);
    return {
      question,
      questionWalls: Maze.cloneWalls(questionWalls),
      walls: combined,
      answerWallCount: Maze.answerWallCount(questionWalls, combined),
    };
  }

  function loadQuestion(rawQuestion) {
    const state = Maze.createQuestionState(rawQuestion);
    return makeModel(state.question, state.questionWalls, state.questionWalls);
  }

  function toggleAnswerWall(model, edge) {
    if (!Maze.isInternalEdge(edge, model.question.size)) throw new Error('只能在棋盘内部摆放板块。');
    const walls = Maze.cloneWalls(model.walls);
    if (!Maze.toggleAnswerWall(model.questionWalls, walls, edge)) throw new Error('题面固定板不能删除或覆盖。');
    return makeModel(model.question, model.questionWalls, walls);
  }

  function resetAnswer(model) {
    return makeModel(model.question, model.questionWalls, model.questionWalls);
  }

  function eventsThroughStep(events, step) {
    if (!Number.isInteger(step)) return events.slice();
    return events.filter(event => !Number.isInteger(event.step) || event.step <= step);
  }

  function createVerification(model) {
    const simulation = Maze.simulate(model.question, model.walls);
    return {
      simulation,
      groups: Maze.groupEventsByStep(simulation.events, model.question.instructions.length),
      wallCount: model.answerWallCount,
    };
  }

  function boot() {
    const gate = root.document.getElementById('questionGate');
    const stage = root.document.getElementById('playerStage');
    if (!gate || !stage || !root.RotateAfterBoard) return null;
    const workspace = root.document.getElementById('playerWorkspace');
    const fileInput = root.document.getElementById('questionFileInput');
    const gateResult = root.document.getElementById('gateResult');
    const gateTitle = root.document.getElementById('questionGateTitle');
    const gateCopy = root.document.getElementById('questionGateCopy');
    const questionList = root.document.getElementById('questionList');
    const loadQuestionButton = root.document.getElementById('loadQuestionBtn');
    const playerResult = root.document.getElementById('playerResult');
    const instructionGrid = root.document.getElementById('instructionGrid');
    const targetOrder = root.document.getElementById('targetOrder');
    const stepButton = root.document.getElementById('stepVerifyBtn');
    const continuousButton = root.document.getElementById('continuousVerifyBtn');
    const returnButton = root.document.getElementById('returnEditBtn');
    const clearButton = root.document.getElementById('clearAnswerWallsBtn');
    const fullscreenToggle = root.document.getElementById('fullscreenToggle');
    const questionEntries = [];
    let activeEntry = null;
    let nextQuestionId = 1;
    let model = null;
    let board = null;
    let mode = 'gate';
    let session = null;
    let stepCursor = 0;
    let record = [];
    let busy = false;
    let verificationGeneration = 0;

    function syncStageScale() {
      stage.style.setProperty('--player-scale', String(calculateStageScale(root.innerWidth, root.innerHeight)));
    }

    syncStageScale();
    root.addEventListener('resize', syncStageScale, { passive: true });
    fullscreenToggle.addEventListener('change', async () => {
      await setFullscreen(root.document, fullscreenToggle.checked);
      fullscreenToggle.checked = Boolean(root.document.fullscreenElement);
      syncStageScale();
    });
    root.document.addEventListener('fullscreenchange', () => {
      fullscreenToggle.checked = Boolean(root.document.fullscreenElement);
      syncStageScale();
    });

    function setGateMessage(message, error = false) {
      gateResult.textContent = message;
      gateResult.className = `result-box${error ? ' error' : ''}`;
    }

    function setResult(message, kind = '') {
      playerResult.textContent = message;
      playerResult.className = `result-box${kind ? ` ${kind}` : ''}`;
    }

    function setActiveModel(nextModel) {
      model = nextModel;
      if (activeEntry) activeEntry.model = nextModel;
    }

    function renderQuestionLibrary() {
      questionList.innerHTML = '';
      gateTitle.textContent = questionEntries.length ? '选择比赛题目' : '读取比赛题目';
      gateCopy.textContent = questionEntries.length
        ? '每道题会分别保留自己的答题板，选择后继续作答。'
        : '可一次选择多个由“旋转之后 · 出题端”保存的题目文件。';
      loadQuestionButton.textContent = questionEntries.length ? '继续添加题目' : '读取题目';

      questionEntries.forEach((entry, index) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.className = `question-option${entry === activeEntry ? ' current' : ''}`;
        button.dataset.questionId = entry.id;

        const name = root.document.createElement('strong');
        name.textContent = `${String(index + 1).padStart(2, '0')} · ${entry.model.question.name}`;
        const meta = root.document.createElement('span');
        meta.textContent = `${entry.model.question.ballCount} 颗球 · ${entry.model.question.instructions.length} 步 · ${Format.exitLabel(entry.model.question.exit)} · 已放 ${entry.model.answerWallCount} 块板${entry === activeEntry ? ' · 当前题目' : ''}`;
        const source = root.document.createElement('span');
        source.textContent = entry.fileName;
        button.append(name, meta, source);
        button.addEventListener('click', () => selectQuestion(entry.id));
        questionList.appendChild(button);
      });
    }

    function renderInstructions(activeStep = 0) {
      instructionGrid.innerHTML = '';
      model.question.instructions.forEach((direction, index) => {
        const chip = root.document.createElement('div');
        const step = index + 1;
        chip.className = `instruction-chip ${direction === 1 ? 'cw' : 'ccw'}${step < activeStep ? ' done' : ''}${step === activeStep ? ' active' : ''}`;
        chip.title = direction === 1 ? '顺时针' : '逆时针';
        chip.innerHTML = `<span class="step-no">${String(step).padStart(2, '0')}</span><span class="turn-icon">${direction === 1 ? '↻' : '↺'}</span>`;
        instructionGrid.appendChild(chip);
      });
    }

    function renderReleaseOrder() {
      root.document.getElementById('releasedCount').textContent = `${record.length} / ${model.question.ballCount}`;
      root.document.getElementById('releaseOrder').textContent = record.length
        ? `当前出球：${record.map(id => BALL_META[id]?.name || id).join(' → ')}`
        : '当前出球：无';
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
      root.document.getElementById('targetHeading').textContent = model.question.target
        .map(id => BALL_META[id].name)
        .join(' → ');
    }

    function updateMetrics() {
      root.document.getElementById('answerWallCount').textContent = String(model.answerWallCount);
      root.document.getElementById('metricWallCount').textContent = String(model.answerWallCount);
      root.document.getElementById('currentStepDisplay').textContent = `${stepCursor} / ${model.question.instructions.length}`;
      renderReleaseOrder();
      renderInstructions(stepCursor);
    }

    function setControlMode(nextMode) {
      mode = nextMode;
      const editing = mode === 'edit';
      stepButton.disabled = busy || mode === 'continuous' || mode === 'done';
      continuousButton.disabled = busy || !editing;
      clearButton.disabled = !editing;
      returnButton.disabled = editing;
      stepButton.textContent = mode === 'step' ? '下一步' : '逐步验证';
      board?.setInteraction({ wallEditing: editing, ballDragging: false });
    }

    function renderEditBoard() {
      record = [];
      stepCursor = 0;
      session = null;
      board.resetAnimation();
      board.setState({
        question: model.question,
        questionWalls: model.questionWalls,
        walls: model.walls,
        record: [],
        step: 0,
      });
      updateMetrics();
      setControlMode('edit');
    }

    function initializeBoard() {
      if (board) board.destroy();
      board = root.RotateAfterBoard.create({
        host: root.document.getElementById('mazeBoard'),
        question: model.question,
        questionWalls: model.questionWalls,
        walls: model.walls,
        interaction: {
          wallEditing: true,
          ballDragging: false,
          onEdge(edge) {
            if (mode !== 'edit') return;
            try {
              setActiveModel(toggleAnswerWall(model, edge));
              board.setState({ question: model.question, questionWalls: model.questionWalls, walls: model.walls, record: [], step: 0 });
              updateMetrics();
              setResult('答案板块已更新。');
            } catch (error) {
              setResult(error.message, 'error');
            }
          },
        },
      });
      renderEditBoard();
    }

    function showQuestionLibrary(message) {
      verificationGeneration += 1;
      busy = false;
      session = null;
      record = [];
      stepCursor = 0;
      mode = 'library';
      board?.resetAnimation();
      gate.hidden = false;
      workspace.hidden = true;
      renderQuestionLibrary();
      setGateMessage(message || (questionEntries.length
        ? `已读取 ${questionEntries.length} 道题，请选择题目。`
        : '尚未读取题目。'));
    }

    function selectQuestion(id) {
      const entry = questionEntries.find(item => item.id === id);
      if (!entry) return false;
      verificationGeneration += 1;
      busy = false;
      session = null;
      activeEntry = entry;
      model = entry.model;
      gate.hidden = true;
      workspace.hidden = false;
      root.document.getElementById('questionName').textContent = model.question.name;
      root.document.getElementById('questionHeader').textContent = `${model.question.name} · ${Format.exitLabel(model.question.exit)} · ${model.question.ballCount} 颗球 · ${model.question.instructions.length} 步`;
      renderTarget();
      initializeBoard();
      setResult(model.answerWallCount
        ? `已恢复这道题的答题状态，共 ${model.answerWallCount} 块新增板。`
        : '题目已打开，可以开始摆板。', 'success');
      return true;
    }

    async function acceptFiles(files) {
      const added = [];
      const rejected = [];
      for (const file of Array.from(files || [])) {
        try {
          const entry = {
            id: `question-${nextQuestionId++}`,
            fileName: file.name,
            model: loadQuestion(JSON.parse(await file.text())),
          };
          questionEntries.push(entry);
          added.push(entry);
        } catch (error) {
          rejected.push(`${file.name}：${String(error.message).split('\n')[0]}`);
        }
      }

      const summary = added.length
        ? `已读取 ${questionEntries.length} 道题${rejected.length ? `，${rejected.length} 个文件无效` : ''}，请选择题目。`
        : (rejected.length ? `没有读取到有效题目：${rejected.join('；')}` : '没有选择题目文件。');
      showQuestionLibrary(summary);
      if (!added.length && rejected.length) setGateMessage(summary, true);
      return { added, rejected };
    }

    async function acceptFile(file) {
      const result = await acceptFiles(file ? [file] : []);
      if (result.added.length === 1) selectQuestion(result.added[0].id);
      return result;
    }

    function openFilePicker() {
      fileInput.click();
    }

    loadQuestionButton.addEventListener('click', openFilePicker);
    root.document.getElementById('changeQuestionBtn').addEventListener('click', () => showQuestionLibrary());
    fileInput.addEventListener('change', async () => {
      await acceptFiles(fileInput.files);
      fileInput.value = '';
    });

    clearButton.addEventListener('click', () => {
      if (!model || mode !== 'edit') return;
      setActiveModel(resetAnswer(model));
      renderEditBoard();
      setResult('新增板已清空，题面固定板保持不变。');
    });

    root.document.getElementById('resetAnswerBtn').addEventListener('click', () => {
      if (!model) return;
      verificationGeneration += 1;
      busy = false;
      setActiveModel(resetAnswer(model));
      renderEditBoard();
      setResult('答案已重置，新增板数为 0。');
    });

    returnButton.addEventListener('click', () => {
      if (!model) return;
      verificationGeneration += 1;
      busy = false;
      renderEditBoard();
      setResult('已返回摆板，当前新增板保持不变。');
    });

    function startSession() {
      session = createVerification(model);
      record = [];
      stepCursor = 0;
      board.resetAnimation();
      updateMetrics();
    }

    function playbackOptions(generation) {
      return {
        reset: false,
        onStep(step) {
          if (generation !== verificationGeneration) return;
          stepCursor = step;
          updateMetrics();
        },
        onRecord(nextRecord) {
          if (generation !== verificationGeneration) return;
          record = nextRecord;
          renderReleaseOrder();
        },
      };
    }

    function showFinalResult() {
      const score = session.simulation.score;
      if (score.completed) {
        setResult(`作答正确：${score.completionStep} 步，使用 ${model.answerWallCount} 块板。`, 'success');
      } else {
        const actual = session.simulation.record.length
          ? session.simulation.record.map(id => BALL_META[id]?.name || id).join(' → ')
          : '没有球出盘';
        setResult(`作答未通过：${actual}。`, 'error');
      }
      setControlMode('done');
    }

    stepButton.addEventListener('click', async () => {
      if (!model || busy || mode === 'continuous' || mode === 'done') return;
      if (mode === 'edit') {
        verificationGeneration += 1;
        startSession();
        setControlMode('step');
      }
      const generation = verificationGeneration;
      const nextStep = stepCursor + 1;
      if (nextStep > model.question.instructions.length) {
        showFinalResult();
        return;
      }
      busy = true;
      setControlMode('step');
      setResult(`正在验证第 ${nextStep} 步。`);
      const events = nextStep === 1
        ? [...session.groups[0], ...session.groups[1]]
        : session.groups[nextStep];
      const played = await board.playEvents(events, playbackOptions(generation));
      if (generation !== verificationGeneration || played.cancelled) return;
      stepCursor = nextStep;
      busy = false;
      updateMetrics();
      const completionStep = session.simulation.score.completionStep;
      if (completionStep === stepCursor || stepCursor === model.question.instructions.length) showFinalResult();
      else {
        setControlMode('step');
        setResult(`第 ${stepCursor} 步完成，可以继续下一步。`);
      }
    });

    continuousButton.addEventListener('click', async () => {
      if (!model || busy || mode !== 'edit') return;
      verificationGeneration += 1;
      const generation = verificationGeneration;
      startSession();
      busy = true;
      setControlMode('continuous');
      setResult('正在连续验证。');
      const completionStep = session.simulation.score.completionStep;
      const events = eventsThroughStep(session.simulation.events, completionStep);
      const played = await board.playEvents(events, playbackOptions(generation));
      if (generation !== verificationGeneration || played.cancelled) return;
      busy = false;
      stepCursor = completionStep || model.question.instructions.length;
      record = session.simulation.record.slice();
      updateMetrics();
      showFinalResult();
    });

    renderQuestionLibrary();

    return {
      get model() { return model; },
      get mode() { return mode; },
      get questionCount() { return questionEntries.length; },
      acceptFile,
      acceptFiles,
      selectQuestion,
    };
  }

  return Object.freeze({
    loadQuestion,
    toggleAnswerWall,
    resetAnswer,
    eventsThroughStep,
    createVerification,
    calculateStageScale,
    setFullscreen,
    boot,
  });
});
