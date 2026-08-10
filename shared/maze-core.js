(function attachMazeCore(root, factory) {
  const questionFormat = typeof module === 'object' && module.exports
    ? require('./question-format.js')
    : root.RotateAfterQuestion;
  const api = factory(questionFormat);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterMaze = api;
})(typeof globalThis === 'object' ? globalThis : this, function createMazeCore(QuestionFormat) {
  'use strict';

  if (!QuestionFormat) throw new Error('RotateAfterQuestion must be loaded before RotateAfterMaze.');

  const DIRS = Object.freeze([
    Object.freeze([-1, 0]),
    Object.freeze([0, 1]),
    Object.freeze([1, 0]),
    Object.freeze([0, -1]),
  ]);
  const SOUTH = 2;

  function cloneWalls(walls) {
    return {
      hw: walls.hw.map(row => row.slice()),
      vw: walls.vw.map(row => row.slice()),
    };
  }

  function emptyWalls(size = QuestionFormat.SIZE, exitCol = QuestionFormat.EXIT_COL) {
    const hw = Array.from({ length: size + 1 }, () => Array(size).fill(false));
    const vw = Array.from({ length: size }, () => Array(size + 1).fill(false));
    for (let c = 0; c < size; c += 1) {
      hw[0][c] = true;
      hw[size][c] = true;
    }
    for (let r = 0; r < size; r += 1) {
      vw[r][0] = true;
      vw[r][size] = true;
    }
    hw[size][exitCol] = false;
    return { hw, vw };
  }

  function supportEdges(balls) {
    return balls.map(ball => ({ type: 'h', r: ball.ir + 1, c: ball.ic }));
  }

  function addSupports(walls, balls) {
    for (const edge of supportEdges(balls)) walls.hw[edge.r][edge.c] = true;
    return walls;
  }

  function canonicalQuestionWalls(question) {
    const walls = cloneWalls(question.initialWalls);
    const size = question.size;
    for (let c = 0; c < size; c += 1) {
      walls.hw[0][c] = true;
      walls.hw[size][c] = true;
    }
    for (let r = 0; r < size; r += 1) {
      walls.vw[r][0] = true;
      walls.vw[r][size] = true;
    }
    walls.hw[size][question.exitCol] = false;
    return addSupports(walls, question.balls);
  }

  function createQuestionState(rawQuestion) {
    const result = QuestionFormat.validate(rawQuestion);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const question = result.question;
    const questionWalls = canonicalQuestionWalls(question);
    question.initialWalls = cloneWalls(questionWalls);
    return {
      question,
      questionWalls,
      walls: cloneWalls(questionWalls),
    };
  }

  function composeWalls(questionWalls, answerWalls) {
    const combined = cloneWalls(questionWalls);
    if (!answerWalls) return combined;
    for (let r = 0; r < combined.hw.length; r += 1) {
      for (let c = 0; c < combined.hw[r].length; c += 1) {
        combined.hw[r][c] = combined.hw[r][c] || Boolean(answerWalls.hw?.[r]?.[c]);
      }
    }
    for (let r = 0; r < combined.vw.length; r += 1) {
      for (let c = 0; c < combined.vw[r].length; c += 1) {
        combined.vw[r][c] = combined.vw[r][c] || Boolean(answerWalls.vw?.[r]?.[c]);
      }
    }
    return combined;
  }

  function isInternalEdge(edge, size = QuestionFormat.SIZE) {
    if (!edge || !Number.isInteger(edge.r) || !Number.isInteger(edge.c)) return false;
    if (edge.type === 'h') return edge.r > 0 && edge.r < size && edge.c >= 0 && edge.c < size;
    if (edge.type === 'v') return edge.r >= 0 && edge.r < size && edge.c > 0 && edge.c < size;
    return false;
  }

  function wallAt(walls, edge) {
    return edge.type === 'h' ? walls.hw[edge.r][edge.c] : walls.vw[edge.r][edge.c];
  }

  function setWall(walls, edge, value) {
    if (edge.type === 'h') walls.hw[edge.r][edge.c] = value;
    else walls.vw[edge.r][edge.c] = value;
  }

  function toggleAnswerWall(questionWalls, combinedWalls, edge) {
    const size = questionWalls.vw.length;
    if (!isInternalEdge(edge, size) || wallAt(questionWalls, edge)) return false;
    setWall(combinedWalls, edge, !wallAt(combinedWalls, edge));
    return true;
  }

  function answerWallCount(questionWalls, combinedWalls) {
    const size = questionWalls.vw.length;
    let count = 0;
    for (let r = 1; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (combinedWalls.hw[r][c] && !questionWalls.hw[r][c]) count += 1;
      }
    }
    for (let r = 0; r < size; r += 1) {
      for (let c = 1; c < size; c += 1) {
        if (combinedWalls.vw[r][c] && !questionWalls.vw[r][c]) count += 1;
      }
    }
    return count;
  }

  function occupiedCells(balls) {
    const occupied = new Set();
    for (const ball of balls) if (ball.alive) occupied.add(`${ball.r},${ball.c}`);
    return occupied;
  }

  function hasWall(walls, r, c, gravity) {
    if (gravity === 0) return walls.hw[r][c];
    if (gravity === 1) return walls.vw[r][c + 1];
    if (gravity === 2) return walls.hw[r + 1][c];
    return walls.vw[r][c];
  }

  function settlePass(balls, gravity, walls, question, record) {
    const indices = balls
      .map((ball, index) => ({ ball, index }))
      .filter(item => item.ball.alive)
      .sort((left, right) => {
        const leftValue = left.ball.r * DIRS[gravity][0] + left.ball.c * DIRS[gravity][1];
        const rightValue = right.ball.r * DIRS[gravity][0] + right.ball.c * DIRS[gravity][1];
        return rightValue - leftValue;
      })
      .map(item => item.index);

    const occupied = occupiedCells(balls);
    const exits = [];
    let moved = false;

    for (const index of indices) {
      const ball = balls[index];
      if (!ball.alive) continue;

      if (gravity === SOUTH
        && ball.r === question.size - 1
        && ball.c === question.exitCol
        && !walls.hw[question.size][question.exitCol]) {
        ball.alive = false;
        occupied.delete(`${ball.r},${ball.c}`);
        record.push(ball.id);
        exits.push(ball.id);
        moved = true;
        continue;
      }

      const nextR = ball.r + DIRS[gravity][0];
      const nextC = ball.c + DIRS[gravity][1];
      if (nextR < 0 || nextR >= question.size || nextC < 0 || nextC >= question.size) continue;
      if (hasWall(walls, ball.r, ball.c, gravity)) continue;
      if (occupied.has(`${nextR},${nextC}`)) continue;

      occupied.delete(`${ball.r},${ball.c}`);
      ball.r = nextR;
      ball.c = nextC;
      occupied.add(`${ball.r},${ball.c}`);
      moved = true;
    }

    return { moved, exits };
  }

  function snapshotPositions(balls) {
    const positions = {};
    for (const ball of balls) positions[ball.id] = ball.alive ? [ball.r, ball.c] : null;
    return positions;
  }

  function scoreRelease(record, releaseSteps, question) {
    const ordered = record.length === question.target.length
      && record.every((id, index) => id === question.target[index]);
    const lastStep = releaseSteps[record.length - 1];
    const completed = ordered
      && Number.isInteger(lastStep)
      && lastStep >= 1
      && lastStep <= question.instructions.length;
    return {
      completed,
      completionStep: completed ? lastStep : null,
      aheadBy: completed ? question.instructions.length - lastStep : null,
    };
  }

  function simulate(rawQuestion, answerWalls) {
    const state = createQuestionState(rawQuestion);
    const question = state.question;
    const walls = composeWalls(state.questionWalls, answerWalls);
    const balls = question.balls.map(ball => ({
      id: ball.id,
      r: ball.ir,
      c: ball.ic,
      alive: true,
    }));
    const record = [];
    const releaseSteps = [];
    const events = [];
    let gravity = SOUTH;
    let theta = 0;
    let currentStep = 0;

    function settle() {
      while (true) {
        const pass = settlePass(balls, gravity, walls, question, record);
        if (!pass.moved) break;
        for (let i = 0; i < pass.exits.length; i += 1) releaseSteps.push(currentStep);
        events.push({
          t: 'set',
          pos: snapshotPositions(balls),
          exits: pass.exits.slice(),
          step: currentStep,
        });
      }
    }

    settle();
    for (const direction of question.instructions) {
      currentStep += 1;
      if (direction === 1) {
        gravity = (gravity + 3) % 4;
        theta += 90;
      } else {
        gravity = (gravity + 1) % 4;
        theta -= 90;
      }
      events.push({ t: 'rot', theta, g: gravity, step: currentStep });
      settle();
    }

    return {
      record,
      releaseSteps,
      score: scoreRelease(record, releaseSteps, question),
      events,
      final: balls.map(ball => ({ ...ball })),
    };
  }

  function groupEventsByStep(events, instructionCount) {
    const groups = Array.from({ length: instructionCount + 1 }, () => []);
    for (const event of events) {
      const step = Number.isInteger(event.step) ? event.step : 0;
      if (step >= 0 && step < groups.length) groups[step].push(event);
    }
    return groups;
  }

  return Object.freeze({
    DIRS,
    SOUTH,
    cloneWalls,
    emptyWalls,
    supportEdges,
    addSupports,
    createQuestionState,
    composeWalls,
    isInternalEdge,
    toggleAnswerWall,
    answerWallCount,
    scoreRelease,
    simulate,
    groupEventsByStep,
  });
});
