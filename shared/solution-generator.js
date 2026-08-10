(function attachSolutionGenerator(root, factory) {
  const dependencies = typeof module === 'object' && module.exports
    ? {
      format: require('./question-format.js'),
      maze: require('./maze-core.js'),
    }
    : { format: root.RotateAfterQuestion, maze: root.RotateAfterMaze };
  const api = factory(dependencies.format, dependencies.maze);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterSolver = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSolutionGenerator(Format, Maze) {
  'use strict';

  function emptyAnswerWalls(question) {
    const size = Number(question?.size || Format.SIZE);
    return {
      hw: Array.from({ length: size + 1 }, () => Array(size).fill(false)),
      vw: Array.from({ length: size }, () => Array(size + 1).fill(false)),
    };
  }

  function isSolvedRecord(record, target) {
    return Array.isArray(record)
      && Array.isArray(target)
      && record.length === target.length
      && record.every((id, index) => id === target[index]);
  }

  function lcsLength(left, right) {
    const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        rows[i][j] = left[i - 1] === right[j - 1]
          ? rows[i - 1][j - 1] + 1
          : Math.max(rows[i - 1][j], rows[i][j - 1]);
      }
    }
    return rows[left.length][right.length];
  }

  function edgeKey(edge) {
    return `${edge.type}:${edge.r}:${edge.c}`;
  }

  function wallAt(walls, edge) {
    return edge.type === 'h' ? walls.hw[edge.r][edge.c] : walls.vw[edge.r][edge.c];
  }

  function setWall(walls, edge, value) {
    if (edge.type === 'h') walls.hw[edge.r][edge.c] = value;
    else walls.vw[edge.r][edge.c] = value;
  }

  function toggleWall(walls, edge) {
    setWall(walls, edge, !wallAt(walls, edge));
  }

  function editableEdges(question) {
    const state = Maze.createQuestionState(question);
    const edges = [];
    for (let r = 1; r < state.question.size; r += 1) {
      for (let c = 0; c < state.question.size; c += 1) {
        if (!state.questionWalls.hw[r][c]) edges.push({ type: 'h', r, c });
      }
    }
    for (let r = 0; r < state.question.size; r += 1) {
      for (let c = 1; c < state.question.size; c += 1) {
        if (!state.questionWalls.vw[r][c]) edges.push({ type: 'v', r, c });
      }
    }
    return edges;
  }

  function answerFingerprint(question, walls) {
    return editableEdges(question)
      .filter(edge => wallAt(walls, edge))
      .map(edgeKey)
      .join('|');
  }

  function evaluate(question, answerWalls) {
    const state = Maze.createQuestionState(question);
    const simulation = Maze.simulate(state.question, answerWalls);
    const combined = Maze.composeWalls(state.questionWalls, answerWalls);
    let prefix = 0;
    while (prefix < state.question.target.length
      && simulation.record[prefix] === state.question.target[prefix]) prefix += 1;
    let proximity = 0;
    for (const ball of simulation.final) {
      if (!ball.alive) continue;
      proximity += (state.question.size - 1 - ball.r) + Math.abs(ball.c - state.question.exitCol);
    }
    return {
      solved: isSolvedRecord(simulation.record, state.question.target),
      simulation,
      prefix,
      drops: simulation.record.length,
      lcs: lcsLength(simulation.record, state.question.target),
      proximity,
      completionStep: simulation.score.completionStep,
      wallCount: Maze.answerWallCount(state.questionWalls, combined),
    };
  }

  function normalizedRandom(rng) {
    return Math.max(0, Math.min(0.999999999, Number(rng())));
  }

  function shuffle(values, rng) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(normalizedRandom(rng) * (index + 1));
      [values[index], values[swap]] = [values[swap], values[index]];
    }
    return values;
  }

  function asSolution(question, walls, result = evaluate(question, walls)) {
    const copy = Maze.cloneWalls(walls);
    return {
      ...result,
      walls: copy,
      fingerprint: answerFingerprint(question, copy),
    };
  }

  function pruneSolution(question, answerWalls, options = {}) {
    const rng = options.rng || Math.random;
    const walls = Maze.cloneWalls(answerWalls);
    let baseline = evaluate(question, walls);
    if (!baseline.solved) return asSolution(question, walls, baseline);
    let removed = true;
    while (removed) {
      removed = false;
      const edges = shuffle(editableEdges(question).filter(edge => wallAt(walls, edge)), rng);
      for (const edge of edges) {
        setWall(walls, edge, false);
        const candidate = evaluate(question, walls);
        if (candidate.solved && candidate.completionStep <= baseline.completionStep) {
          baseline = candidate;
          removed = true;
        } else {
          setWall(walls, edge, true);
        }
      }
    }
    return asSolution(question, walls, baseline);
  }

  async function pruneSolutionAsync(question, answerWalls, options = {}) {
    const rng = options.rng || Math.random;
    const now = options.now || (() => (typeof performance === 'object' ? performance.now() : Date.now()));
    const deadline = Number.isFinite(options.deadline) ? options.deadline : Infinity;
    const isCancelled = options.isCancelled || (() => false);
    const yieldControl = options.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const walls = Maze.cloneWalls(answerWalls);
    let baseline = evaluate(question, walls);
    if (!baseline.solved) return asSolution(question, walls, baseline);
    let removed = true;
    let lastYield = now();
    let evaluationsSinceYield = 0;

    while (removed) {
      if (isCancelled()) return null;
      removed = false;
      const edges = shuffle(editableEdges(question).filter(edge => wallAt(walls, edge)), rng);
      for (const edge of edges) {
        if (isCancelled()) return null;
        if (now() >= deadline) return asSolution(question, walls, baseline);
        setWall(walls, edge, false);
        const candidate = evaluate(question, walls);
        evaluationsSinceYield += 1;
        if (candidate.solved && candidate.completionStep <= baseline.completionStep) {
          baseline = candidate;
          removed = true;
        } else {
          setWall(walls, edge, true);
        }

        const timestamp = now();
        if (evaluationsSinceYield >= 16 || timestamp - lastYield >= 16) {
          await yieldControl();
          evaluationsSinceYield = 0;
          lastYield = now();
          if (isCancelled()) return null;
        }
      }
    }
    return asSolution(question, walls, baseline);
  }

  function compareSolutions(left, right) {
    const leftStep = Number.isInteger(left.completionStep) ? left.completionStep : Infinity;
    const rightStep = Number.isInteger(right.completionStep) ? right.completionStep : Infinity;
    return leftStep - rightStep
      || Number(left.wallCount ?? Infinity) - Number(right.wallCount ?? Infinity)
      || String(left.fingerprint || '').localeCompare(String(right.fingerprint || ''));
  }

  function gravityTimeline(question) {
    let gravity = Maze.SOUTH;
    return question.instructions.map(direction => {
      gravity = direction === 1 ? (gravity + 3) % 4 : (gravity + 1) % 4;
      return gravity;
    });
  }

  function edgeInDirection(r, c, gravity) {
    if (gravity === 0) return { type: 'h', r, c };
    if (gravity === 1) return { type: 'v', r, c: c + 1 };
    if (gravity === 2) return { type: 'h', r: r + 1, c };
    return { type: 'v', r, c };
  }

  function reverseSeedWalls(question, variant = 0) {
    const walls = emptyAnswerWalls(question);
    const allowed = new Set(editableEdges(question).map(edgeKey));
    const reverseGravity = gravityTimeline(question).slice().reverse();
    if (!reverseGravity.length) return walls;
    question.target.slice().reverse().forEach((id, rank) => {
      let r = question.size - 1;
      let c = question.exitCol;
      let placed = 0;
      const offset = (variant * 7 + rank * 3) % reverseGravity.length;
      for (let turn = 0; turn < reverseGravity.length && placed < 3; turn += 1) {
        const gravity = reverseGravity[(turn + offset) % reverseGravity.length];
        const back = (gravity + 2) % 4;
        let nextR = r + Maze.DIRS[back][0];
        let nextC = c + Maze.DIRS[back][1];
        if (nextR < 0 || nextR >= question.size || nextC < 0 || nextC >= question.size) {
          const side = (variant + rank + turn) % 2 === 0 ? (gravity + 1) % 4 : (gravity + 3) % 4;
          nextR = r + Maze.DIRS[side][0];
          nextC = c + Maze.DIRS[side][1];
        }
        if (nextR < 0 || nextR >= question.size || nextC < 0 || nextC >= question.size) continue;
        r = nextR;
        c = nextC;
        const edge = edgeInDirection(r, c, gravity);
        if (allowed.has(edgeKey(edge)) && !wallAt(walls, edge)) {
          setWall(walls, edge, true);
          placed += 1;
        }
      }
    });
    return walls;
  }

  function randomSearchWalls(question, edges, variant, rng) {
    const walls = reverseSeedWalls(question, variant);
    const density = 0.04 + normalizedRandom(rng) * 0.15;
    for (const edge of edges) {
      if (!wallAt(walls, edge) && normalizedRandom(rng) < density) setWall(walls, edge, true);
    }
    return walls;
  }

  function phaseAScore(result) {
    return result.drops * 200 - result.proximity * 2 + result.prefix * 12 + result.lcs * 4;
  }

  function phaseBScore(result, question) {
    if (result.solved && Number.isInteger(result.completionStep)) {
      return 1000000 + (question.instructions.length - result.completionStep) * 10000 - result.wallCount;
    }
    let score = result.prefix * 1000 + result.lcs * 50;
    if (result.prefix < question.target.length) {
      const wrongIndex = result.simulation.record.indexOf(question.target[result.prefix]);
      if (wrongIndex >= 0) score += (question.target.length - wrongIndex) * 20;
    }
    return score;
  }

  function mutate(walls, edges, rng, amount = 1) {
    const changed = [];
    for (let index = 0; index < amount; index += 1) {
      const edge = edges[Math.floor(normalizedRandom(rng) * edges.length)];
      if (!edge) continue;
      toggleWall(walls, edge);
      changed.push(edge);
    }
    return changed;
  }

  function revertMutation(walls, changed) {
    for (const edge of changed) toggleWall(walls, edge);
  }

  async function generateSolutions(rawQuestion, options = {}) {
    const validated = Format.validate(rawQuestion);
    if (!validated.ok) throw new Error(validated.errors.join('\n'));
    const question = validated.question;
    const requestedCount = Math.max(1, Math.min(12, Number(options.count || 3)));
    const timeLimitMs = Math.max(0, Number(options.timeLimitMs ?? 45000));
    const rng = options.rng || Math.random;
    const now = options.now || (() => (typeof performance === 'object' ? performance.now() : Date.now()));
    const yieldControl = options.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
    const signal = options.signal;
    const isCancelled = () => Boolean(signal?.aborted) || shouldCancel();
    const solutions = [];
    const fingerprints = new Set();

    if (isCancelled()) return [];

    async function store(walls, deadline = Infinity) {
      if (isCancelled()) return false;
      const evaluated = evaluate(question, walls);
      if (!evaluated.solved) return false;
      const solution = await pruneSolutionAsync(question, walls, {
        rng,
        now,
        deadline,
        isCancelled,
        yieldControl,
      });
      if (!solution || isCancelled()) return false;
      if (!solution.solved || fingerprints.has(solution.fingerprint)) return false;
      fingerprints.add(solution.fingerprint);
      solutions.push(solution);
      solutions.sort(compareSolutions);
      return true;
    }

    for (const seed of options.seedWalls || []) {
      await store(seed);
      if (isCancelled()) return [];
      if (solutions.length >= requestedCount) return solutions.slice(0, requestedCount);
    }

    const startedAt = now();
    const deadline = startedAt + timeLimitMs;
    const edges = editableEdges(question);
    let restarts = 0;
    let bestPrefix = solutions.length ? question.target.length : 0;
    let lastYield = startedAt;

    async function reportProgress(force = false) {
      const timestamp = now();
      if (!force && timestamp - lastYield < 16) return;
      onProgress({
        elapsedMs: timestamp - startedAt,
        found: solutions.length,
        requested: requestedCount,
        bestPrefix,
        ballCount: question.ballCount,
        restarts,
      });
      await yieldControl();
      lastYield = now();
    }

    while (now() < deadline && solutions.length < requestedCount && !isCancelled()) {
      const walls = randomSearchWalls(question, edges, restarts, rng);
      restarts += 1;
      let current = evaluate(question, walls);
      bestPrefix = Math.max(bestPrefix, current.prefix);

      for (let iteration = 0;
        iteration < 420 && now() < deadline && !isCancelled()
          && current.drops < question.target.length;
        iteration += 1) {
        const changed = mutate(walls, edges, rng, 1);
        const candidate = evaluate(question, walls);
        if (phaseAScore(candidate) >= phaseAScore(current)) current = candidate;
        else revertMutation(walls, changed);
        bestPrefix = Math.max(bestPrefix, current.prefix);
        if (iteration % 24 === 23) await reportProgress(true);
      }

      if (!isCancelled() && current.drops === question.target.length) {
        for (let iteration = 0;
          iteration < 900 + current.prefix * 250 && now() < deadline && !isCancelled();
          iteration += 1) {
          if (current.solved) {
            await store(walls, deadline);
            break;
          }
          const changed = mutate(walls, edges, rng, 1 + Math.floor(normalizedRandom(rng) * 2));
          const candidate = evaluate(question, walls);
          if (candidate.drops === question.target.length
            && phaseBScore(candidate, question) >= phaseBScore(current, question)) current = candidate;
          else revertMutation(walls, changed);
          bestPrefix = Math.max(bestPrefix, current.prefix);
          if (iteration % 24 === 23) await reportProgress(true);
        }
      }

      await reportProgress(true);
    }

    if (isCancelled()) return [];
    solutions.sort(compareSolutions);
    return solutions.slice(0, requestedCount);
  }

  return Object.freeze({
    emptyAnswerWalls,
    editableEdges,
    isSolvedRecord,
    answerFingerprint,
    evaluate,
    pruneSolution,
    compareSolutions,
    reverseSeedWalls,
    generateSolutions,
  });
});
