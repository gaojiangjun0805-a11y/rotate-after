(function attachBoardUI(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RotateAfterBoard = api;
})(typeof globalThis === 'object' ? globalThis : this, function createBoardAPI(root) {
  'use strict';

  const LOGICAL_BOARD = 600;
  const BOARD_INSET = 0.09;
  const BALL_COLORS = Object.freeze({
    R: 0xe94343,
    Y: 0xf2c927,
    B: 0x3f7edc,
    G: 0x2dbd68,
    P: 0x9650d8,
    O: 0xf28a32,
  });

  function sameEdge(left, right) {
    return Boolean(left && right
      && left.type === right.type
      && left.r === right.r
      && left.c === right.c);
  }

  function pickEdge(x, y, size = 10, boardSize = LOGICAL_BOARD) {
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || y < 0 || x > boardSize || y > boardSize) return null;
    const cell = boardSize / size;
    const tolerance = cell * 0.42;
    const verticalColumn = Math.round(x / cell);
    const horizontalRow = Math.round(y / cell);
    const verticalDistance = Math.abs(x - verticalColumn * cell);
    const horizontalDistance = Math.abs(y - horizontalRow * cell);
    const row = Math.min(size - 1, Math.max(0, Math.floor(y / cell)));
    const column = Math.min(size - 1, Math.max(0, Math.floor(x / cell)));
    const vertical = verticalColumn > 0 && verticalColumn < size && verticalDistance <= tolerance
      ? { type: 'v', r: row, c: verticalColumn, distance: verticalDistance }
      : null;
    const horizontal = horizontalRow > 0 && horizontalRow < size && horizontalDistance <= tolerance
      ? { type: 'h', r: horizontalRow, c: column, distance: horizontalDistance }
      : null;
    const chosen = vertical && horizontal
      ? (vertical.distance <= horizontal.distance ? vertical : horizontal)
      : (vertical || horizontal);
    return chosen ? { type: chosen.type, r: chosen.r, c: chosen.c } : null;
  }

  function clientToBoard(clientX, clientY, rect, logicalWidth = 960, logicalHeight = 600) {
    return {
      x: (clientX - rect.left) / rect.width * logicalWidth,
      y: (clientY - rect.top) / rect.height * logicalHeight,
    };
  }

  function easeInOut(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
  }

  function compactPlaybackEvents(events) {
    const compacted = [];
    for (let index = 0; index < (events || []).length;) {
      const event = events[index];
      if (event?.t !== 'set') {
        compacted.push(event);
        index += 1;
        continue;
      }

      const exits = [];
      const exited = new Set();
      let finalEvent = event;
      while (index < events.length && events[index]?.t === 'set') {
        finalEvent = events[index];
        for (const id of finalEvent.exits || []) {
          if (!exited.has(id)) {
            exited.add(id);
            exits.push(id);
          }
        }
        index += 1;
      }
      compacted.push({ ...finalEvent, exits });
    }
    return compacted;
  }

  function rotationFitScale(degrees) {
    const radians = Number(degrees || 0) * Math.PI / 180;
    const rotatedExtent = 5.8 * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
    return Math.min(1, 5.9 / rotatedExtent);
  }

  function exitLayout(question) {
    const size = Number(question?.size || 10);
    const exit = question?.exit || { side: 'bottom', index: Number(question?.exitCol ?? 5) };
    const index = Number(exit.index);
    const horizontal = exit.side === 'top' || exit.side === 'bottom';
    const cellX = index + 0.5 - size / 2;
    const cellY = size / 2 - index - 0.5;
    const edge = 5.43;
    const outside = 6.05;

    if (horizontal) {
      const y = exit.side === 'top' ? edge : -edge;
      return {
        side: exit.side,
        index,
        orientation: 'horizontal',
        main: { width: 1.05, height: 0.55, x: cellX, y },
        caps: [
          { width: 0.12, height: 0.55, x: cellX - 0.56, y },
          { width: 0.12, height: 0.55, x: cellX + 0.56, y },
        ],
        target: { x: cellX, y: exit.side === 'top' ? outside : -outside },
      };
    }

    const x = exit.side === 'right' ? edge : -edge;
    return {
      side: exit.side,
      index,
      orientation: 'vertical',
      main: { width: 0.55, height: 1.05, x, y: cellY },
      caps: [
        { width: 0.55, height: 0.12, x, y: cellY - 0.56 },
        { width: 0.55, height: 0.12, x, y: cellY + 0.56 },
      ],
      target: { x: exit.side === 'right' ? outside : -outside, y: cellY },
    };
  }

  function create(options = {}) {
    if (!root.document) throw new Error('RotateAfterBoard.create requires a browser document.');
    const host = typeof options.host === 'string'
      ? root.document.querySelector(options.host)
      : options.host;
    if (!host) throw new Error('Board host element was not found.');

    host.classList.add('maze-stage');
    const overlay = root.document.createElement('canvas');
    overlay.className = 'maze-hit-layer';
    overlay.width = LOGICAL_BOARD;
    overlay.height = LOGICAL_BOARD;
    overlay.setAttribute('aria-label', '迷宫棋盘编辑区');
    host.appendChild(overlay);
    const overlayContext = overlay.getContext('2d');

    let renderer = null;
    let scene = null;
    let camera = null;
    let boardGroup = null;
    let fallback = null;
    let fallbackContext = null;
    let resizeObserver = null;
    let animationFrame = 0;
    let destroyed = false;
    let dirty = true;
    let playToken = 0;
    let playing = false;
    let hoverEdge = null;
    let pressedEdge = null;
    let drag = null;
    let question = null;
    let questionWalls = null;
    let walls = null;
    let displayRecord = [];
    let currentStep = 0;
    let currentTheta = 0;
    let interaction = {
      wallEditing: false,
      ballDragging: false,
      onEdge: null,
      onBallMove: null,
    };
    const ballMeshes = new Map();

    function makeWoodTexture(light, dark) {
      const canvas = root.document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = light;
      context.fillRect(0, 0, 256, 256);
      context.strokeStyle = dark;
      context.globalAlpha = 0.22;
      context.lineWidth = 2;
      for (let y = 10; y < 256; y += 17) {
        context.beginPath();
        for (let x = 0; x <= 256; x += 8) {
          const wave = Math.sin((x + y) * 0.055) * 3 + Math.sin(x * 0.13) * 1.5;
          if (x === 0) context.moveTo(x, y + wave);
          else context.lineTo(x, y + wave);
        }
        context.stroke();
      }
      const texture = new root.THREE.CanvasTexture(canvas);
      texture.wrapS = root.THREE.RepeatWrapping;
      texture.wrapT = root.THREE.RepeatWrapping;
      texture.repeat.set(2.2, 2.2);
      return texture;
    }

    function initThree() {
      if (!root.THREE) return false;
      try {
        renderer = new root.THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.domElement.className = 'maze-webgl';
        renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = root.THREE.PCFSoftShadowMap;
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = root.THREE.SRGBColorSpace;
        host.insertBefore(renderer.domElement, overlay);

        scene = new root.THREE.Scene();
        camera = new root.THREE.OrthographicCamera(-6.1, 6.1, 6.1, -6.1, 0.1, 60);
        camera.position.set(0, 0, 16);
        camera.lookAt(0, 0, 0);
        scene.add(new root.THREE.HemisphereLight(0xfff1d6, 0x1b2530, 2.2));
        const key = new root.THREE.DirectionalLight(0xffd8a2, 3.4);
        key.position.set(-5, 7, 12);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        scene.add(key);
        const rim = new root.THREE.DirectionalLight(0x78d9d0, 1.2);
        rim.position.set(7, -5, 7);
        scene.add(rim);
        return true;
      } catch (error) {
        if (renderer?.domElement?.parentNode) renderer.domElement.remove();
        renderer = null;
        return false;
      }
    }

    function initFallback() {
      fallback = root.document.createElement('canvas');
      fallback.className = 'maze-fallback';
      fallback.width = LOGICAL_BOARD;
      fallback.height = LOGICAL_BOARD;
      host.insertBefore(fallback, overlay);
      fallbackContext = fallback.getContext('2d');
    }

    if (!initThree()) initFallback();

    function localCellPosition(r, c) {
      return {
        x: c + 0.5 - question.size / 2,
        y: question.size / 2 - r - 0.5,
      };
    }

    function disposeObject(object) {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      object.traverse?.(child => {
        if (child.geometry) geometries.add(child.geometry);
        const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of childMaterials) {
          if (!material) continue;
          materials.add(material);
          if (material.map) textures.add(material.map);
        }
      });
      geometries.forEach(geometry => geometry.dispose?.());
      textures.forEach(texture => texture.dispose?.());
      materials.forEach(material => material.dispose?.());
    }

    function addBox(group, width, height, depth, x, y, z, material) {
      const mesh = new root.THREE.Mesh(new root.THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function buildThreeBoard() {
      if (!renderer || !question || !walls) return;
      if (boardGroup) {
        scene.remove(boardGroup);
        disposeObject(boardGroup);
      }
      boardGroup = new root.THREE.Group();
      boardGroup.rotation.z = -currentTheta * Math.PI / 180;
      boardGroup.scale.setScalar(rotationFitScale(currentTheta));
      scene.add(boardGroup);
      ballMeshes.clear();

      const floorTexture = makeWoodTexture('#ad713d', '#5c341f');
      const railTexture = makeWoodTexture('#d3a15f', '#6e3b20');
      const floorMaterial = new root.THREE.MeshStandardMaterial({ map: floorTexture, color: 0xffffff, roughness: 0.72, metalness: 0.02 });
      const frameMaterial = new root.THREE.MeshStandardMaterial({ map: railTexture, color: 0xf0c77f, roughness: 0.62 });
      const fixedMaterial = new root.THREE.MeshStandardMaterial({ color: 0x4b2818, roughness: 0.72 });
      const answerMaterial = new root.THREE.MeshStandardMaterial({ color: 0xe4b86f, roughness: 0.58 });
      const gridMaterial = new root.THREE.MeshBasicMaterial({ color: 0x6b4327, transparent: true, opacity: 0.32 });
      const exitMaterial = new root.THREE.MeshStandardMaterial({ color: 0x45c795, emissive: 0x173e34, roughness: 0.55 });

      addBox(boardGroup, 10.9, 10.9, 0.42, 0, 0, -0.28, frameMaterial);
      addBox(boardGroup, 10.12, 10.12, 0.28, 0, 0, -0.03, floorMaterial);
      for (let index = 1; index < question.size; index += 1) {
        const position = index - question.size / 2;
        addBox(boardGroup, 0.018, 10, 0.012, position, 0, 0.13, gridMaterial);
        addBox(boardGroup, 10, 0.018, 0.012, 0, -position, 0.13, gridMaterial);
      }

      const wallDepth = 0.42;
      const wallThickness = 0.15;
      function addWall(type, r, c, fixed) {
        const material = fixed ? fixedMaterial : answerMaterial;
        if (type === 'h') {
          addBox(boardGroup, 1.02, wallThickness, wallDepth, c + 0.5 - question.size / 2, question.size / 2 - r, 0.28, material);
        } else {
          addBox(boardGroup, wallThickness, 1.02, wallDepth, c - question.size / 2, question.size / 2 - r - 0.5, 0.28, material);
        }
      }
      for (let r = 0; r <= question.size; r += 1) {
        for (let c = 0; c < question.size; c += 1) {
          if (walls.hw[r][c]) addWall('h', r, c, Boolean(questionWalls.hw[r][c]));
        }
      }
      for (let r = 0; r < question.size; r += 1) {
        for (let c = 0; c <= question.size; c += 1) {
          if (walls.vw[r][c]) addWall('v', r, c, Boolean(questionWalls.vw[r][c]));
        }
      }

      const exit = exitLayout(question);
      addBox(
        boardGroup,
        exit.main.width,
        exit.main.height,
        0.16,
        exit.main.x,
        exit.main.y,
        -0.02,
        exitMaterial,
      );
      for (const cap of exit.caps) {
        addBox(boardGroup, cap.width, cap.height, 0.32, cap.x, cap.y, 0.13, exitMaterial);
      }

      for (const ball of question.balls) {
        const material = new root.THREE.MeshStandardMaterial({
          color: BALL_COLORS[ball.id],
          roughness: 0.18,
          metalness: 0.32,
          transparent: true,
        });
        const mesh = new root.THREE.Mesh(new root.THREE.SphereGeometry(0.29, 28, 20), material);
        const position = localCellPosition(ball.ir, ball.ic);
        mesh.position.set(position.x, position.y, 0.56);
        mesh.castShadow = true;
        mesh.userData.ballId = ball.id;
        boardGroup.add(mesh);
        ballMeshes.set(ball.id, mesh);
      }
      dirty = true;
    }

    function drawFallback() {
      if (!fallbackContext || !question || !walls) return;
      const context = fallbackContext;
      const size = LOGICAL_BOARD;
      const cell = size / question.size;
      context.clearRect(0, 0, size, size);
      const floor = context.createLinearGradient(0, 0, size, size);
      floor.addColorStop(0, '#bd8149');
      floor.addColorStop(1, '#8d542d');
      context.fillStyle = floor;
      context.fillRect(0, 0, size, size);
      context.strokeStyle = 'rgba(83,45,25,.34)';
      context.lineWidth = 1;
      for (let index = 1; index < question.size; index += 1) {
        context.beginPath(); context.moveTo(index * cell, 0); context.lineTo(index * cell, size); context.stroke();
        context.beginPath(); context.moveTo(0, index * cell); context.lineTo(size, index * cell); context.stroke();
      }
      context.lineCap = 'square';
      context.lineWidth = 10;
      function line(type, r, c, fixed) {
        context.strokeStyle = fixed ? '#4b2818' : '#e4b86f';
        context.beginPath();
        if (type === 'h') { context.moveTo(c * cell, r * cell); context.lineTo((c + 1) * cell, r * cell); }
        else { context.moveTo(c * cell, r * cell); context.lineTo(c * cell, (r + 1) * cell); }
        context.stroke();
      }
      for (let r = 0; r <= question.size; r += 1) for (let c = 0; c < question.size; c += 1) {
        if (walls.hw[r][c]) line('h', r, c, questionWalls.hw[r][c]);
      }
      for (let r = 0; r < question.size; r += 1) for (let c = 0; c <= question.size; c += 1) {
        if (walls.vw[r][c]) line('v', r, c, questionWalls.vw[r][c]);
      }
      const exit = exitLayout(question);
      context.fillStyle = '#45c795';
      const marker = 12;
      if (exit.side === 'top') context.fillRect(exit.index * cell, 0, cell, marker);
      else if (exit.side === 'right') context.fillRect(size - marker, exit.index * cell, marker, cell);
      else if (exit.side === 'bottom') context.fillRect(exit.index * cell, size - marker, cell, marker);
      else context.fillRect(0, exit.index * cell, marker, cell);
      for (const ball of question.balls) {
        if (displayRecord.includes(ball.id)) continue;
        const mesh = ballMeshes.get(ball.id);
        const r = mesh?.userData?.displayR ?? ball.ir;
        const c = mesh?.userData?.displayC ?? ball.ic;
        const gradient = context.createRadialGradient((c + 0.42) * cell, (r + 0.4) * cell, 2, (c + 0.5) * cell, (r + 0.5) * cell, cell * 0.34);
        const css = `#${BALL_COLORS[ball.id].toString(16).padStart(6, '0')}`;
        gradient.addColorStop(0, '#fff'); gradient.addColorStop(0.18, css); gradient.addColorStop(1, '#121212');
        context.fillStyle = gradient;
        context.beginPath(); context.arc((c + 0.5) * cell, (r + 0.5) * cell, cell * 0.29, 0, Math.PI * 2); context.fill();
      }
    }

    function drawOverlay() {
      overlayContext.clearRect(0, 0, LOGICAL_BOARD, LOGICAL_BOARD);
      if (!hoverEdge || playing || !interaction.wallEditing) return;
      const cell = LOGICAL_BOARD / (question?.size || 10);
      overlayContext.save();
      overlayContext.strokeStyle = 'rgba(116, 239, 218, .92)';
      overlayContext.shadowColor = '#4de6cf';
      overlayContext.shadowBlur = 12;
      overlayContext.lineWidth = 13;
      overlayContext.lineCap = 'round';
      overlayContext.beginPath();
      if (hoverEdge.type === 'h') {
        overlayContext.moveTo(hoverEdge.c * cell + 5, hoverEdge.r * cell);
        overlayContext.lineTo((hoverEdge.c + 1) * cell - 5, hoverEdge.r * cell);
      } else {
        overlayContext.moveTo(hoverEdge.c * cell, hoverEdge.r * cell + 5);
        overlayContext.lineTo(hoverEdge.c * cell, (hoverEdge.r + 1) * cell - 5);
      }
      overlayContext.stroke();
      overlayContext.restore();
    }

    function renderLoop() {
      if (destroyed) return;
      if (renderer && dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
      if (!renderer && dirty) {
        drawFallback();
        dirty = false;
      }
      animationFrame = root.requestAnimationFrame(renderLoop);
    }

    function resize() {
      if (!renderer) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      dirty = true;
    }

    if (root.ResizeObserver) {
      resizeObserver = new root.ResizeObserver(resize);
      resizeObserver.observe(host);
    } else root.addEventListener?.('resize', resize);
    resize();
    animationFrame = root.requestAnimationFrame(renderLoop);

    function setState(next = {}) {
      question = next.question || question;
      if (!question) throw new Error('Board state requires a question.');
      const maze = root.RotateAfterMaze;
      const base = next.questionWalls
        || questionWalls
        || maze?.createQuestionState(question).questionWalls;
      questionWalls = maze?.cloneWalls(base) || {
        hw: base.hw.map(row => row.slice()),
        vw: base.vw.map(row => row.slice()),
      };
      const combined = next.walls || walls || questionWalls;
      walls = maze?.cloneWalls(combined) || {
        hw: combined.hw.map(row => row.slice()),
        vw: combined.vw.map(row => row.slice()),
      };
      displayRecord = Array.isArray(next.record) ? next.record.slice() : displayRecord;
      currentStep = Number.isInteger(next.step) ? next.step : currentStep;
      buildThreeBoard();
      dirty = true;
      drawOverlay();
      return api;
    }

    function setInteraction(next = {}) {
      interaction = { ...interaction, ...next };
      overlay.style.pointerEvents = interaction.wallEditing || interaction.ballDragging ? 'auto' : 'none';
      hoverEdge = null;
      drawOverlay();
      return api;
    }

    function eventPoint(event) {
      const rect = overlay.getBoundingClientRect();
      return clientToBoard(event.clientX, event.clientY, rect, LOGICAL_BOARD, LOGICAL_BOARD);
    }

    function ballAt(point) {
      if (!question) return null;
      const cell = LOGICAL_BOARD / question.size;
      let best = null;
      for (const ball of question.balls) {
        const x = (ball.ic + 0.5) * cell;
        const y = (ball.ir + 0.5) * cell;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= cell * 0.38 && (!best || distance < best.distance)) best = { ball, distance };
      }
      return best?.ball || null;
    }

    function handlePointerDown(event) {
      if (playing || !question) return;
      const point = eventPoint(event);
      const ball = interaction.ballDragging ? ballAt(point) : null;
      if (ball) {
        drag = { id: ball.id, pointerId: event.pointerId };
        host.classList.add('is-dragging');
        overlay.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }
      if (interaction.wallEditing) pressedEdge = pickEdge(point.x, point.y, question.size, LOGICAL_BOARD);
    }

    function handlePointerMove(event) {
      if (playing || !question) return;
      const point = eventPoint(event);
      if (drag) {
        const mesh = ballMeshes.get(drag.id);
        if (mesh) {
          mesh.position.x = point.x / LOGICAL_BOARD * question.size - question.size / 2;
          mesh.position.y = question.size / 2 - point.y / LOGICAL_BOARD * question.size;
          dirty = true;
        }
        event.preventDefault();
        return;
      }
      const nextEdge = interaction.wallEditing ? pickEdge(point.x, point.y, question.size, LOGICAL_BOARD) : null;
      if (!sameEdge(nextEdge, hoverEdge)) {
        hoverEdge = nextEdge;
        drawOverlay();
      }
    }

    function handlePointerUp(event) {
      if (playing || !question) return;
      const point = eventPoint(event);
      if (drag) {
        const cell = LOGICAL_BOARD / question.size;
        const r = Math.max(0, Math.min(question.size - 1, Math.floor(point.y / cell)));
        const c = Math.max(0, Math.min(question.size - 1, Math.floor(point.x / cell)));
        const id = drag.id;
        drag = null;
        host.classList.remove('is-dragging');
        overlay.releasePointerCapture?.(event.pointerId);
        interaction.onBallMove?.(id, r, c);
        dirty = true;
        return;
      }
      const releasedEdge = interaction.wallEditing ? pickEdge(point.x, point.y, question.size, LOGICAL_BOARD) : null;
      if (sameEdge(pressedEdge, releasedEdge) && releasedEdge) interaction.onEdge?.(releasedEdge);
      pressedEdge = null;
    }

    overlay.addEventListener('pointerdown', handlePointerDown);
    overlay.addEventListener('pointermove', handlePointerMove);
    overlay.addEventListener('pointerup', handlePointerUp);
    overlay.addEventListener('pointercancel', handlePointerUp);
    overlay.addEventListener('pointerleave', () => {
      if (!drag) { hoverEdge = null; drawOverlay(); }
    });

    function animate(duration, update, token) {
      if (duration <= 0 || root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        update(1);
        dirty = true;
        return Promise.resolve(token === playToken);
      }
      return new Promise(resolve => {
        const start = root.performance.now();
        function frame(now) {
          if (token !== playToken || destroyed) { resolve(false); return; }
          const progress = Math.min(1, (now - start) / duration);
          update(easeInOut(progress));
          dirty = true;
          if (progress < 1) root.requestAnimationFrame(frame);
          else resolve(true);
        }
        root.requestAnimationFrame(frame);
      });
    }

    function resetAnimation() {
      playToken += 1;
      playing = false;
      host.classList.remove('is-playing');
      displayRecord = [];
      currentStep = 0;
      currentTheta = 0;
      if (boardGroup) boardGroup.rotation.z = 0;
      if (boardGroup) boardGroup.scale.setScalar(1);
      if (question) {
        for (const ball of question.balls) {
          const mesh = ballMeshes.get(ball.id);
          if (!mesh) continue;
          const position = localCellPosition(ball.ir, ball.ic);
          mesh.position.set(position.x, position.y, 0.56);
          mesh.visible = true;
          mesh.material.opacity = 1;
        }
      }
      dirty = true;
      return api;
    }

    async function playEvents(events, options = {}) {
      if (!question) throw new Error('Board state requires a question before playback.');
      if (options.reset !== false) resetAnimation();
      const token = ++playToken;
      playing = true;
      host.classList.add('is-playing');
      hoverEdge = null;
      drawOverlay();
      const rotationDuration = options.rotationDuration ?? 430;
      const moveDuration = options.moveDuration ?? 360;
      const playbackEvents = compactPlaybackEvents(events);

      for (const event of playbackEvents) {
        if (token !== playToken) return { cancelled: true, record: displayRecord.slice(), step: currentStep };
        if (event.t === 'rot') {
          const from = currentTheta;
          const to = event.theta;
          const completed = await animate(rotationDuration, progress => {
            currentTheta = from + (to - from) * progress;
            if (boardGroup) {
              boardGroup.rotation.z = -currentTheta * Math.PI / 180;
              boardGroup.scale.setScalar(rotationFitScale(currentTheta));
            }
          }, token);
          if (!completed) return { cancelled: true, record: displayRecord.slice(), step: currentStep };
          currentTheta = to;
          currentStep = event.step;
          options.onStep?.(currentStep, event);
        } else if (event.t === 'set') {
          const starts = new Map();
          const targets = new Map();
          for (const ball of question.balls) {
            const mesh = ballMeshes.get(ball.id);
            if (!mesh || !mesh.visible) continue;
            starts.set(ball.id, { x: mesh.position.x, y: mesh.position.y, opacity: mesh.material.opacity });
            const position = event.pos[ball.id];
            if (position) targets.set(ball.id, { ...localCellPosition(position[0], position[1]), exiting: false });
            else if (event.exits.includes(ball.id)) {
              targets.set(ball.id, { ...exitLayout(question).target, exiting: true });
            }
          }
          const completed = await animate(moveDuration, progress => {
            for (const [id, target] of targets) {
              const mesh = ballMeshes.get(id);
              const start = starts.get(id);
              mesh.position.x = start.x + (target.x - start.x) * progress;
              mesh.position.y = start.y + (target.y - start.y) * progress;
              if (target.exiting) mesh.material.opacity = 1 - progress;
            }
          }, token);
          if (!completed) return { cancelled: true, record: displayRecord.slice(), step: currentStep };
          for (const id of event.exits) {
            const mesh = ballMeshes.get(id);
            if (mesh) mesh.visible = false;
            if (!displayRecord.includes(id)) displayRecord.push(id);
          }
          options.onRecord?.(displayRecord.slice(), event);
        }
        options.onEvent?.(event);
      }
      playing = false;
      host.classList.remove('is-playing');
      options.onComplete?.({ record: displayRecord.slice(), step: currentStep });
      return { cancelled: false, record: displayRecord.slice(), step: currentStep };
    }

    function destroy() {
      destroyed = true;
      playToken += 1;
      root.cancelAnimationFrame?.(animationFrame);
      resizeObserver?.disconnect();
      if (!resizeObserver) root.removeEventListener?.('resize', resize);
      if (boardGroup) disposeObject(boardGroup);
      renderer?.dispose?.();
      renderer?.domElement?.remove();
      fallback?.remove();
      overlay.remove();
    }

    const api = {
      setState,
      setInteraction,
      playEvents,
      resetAnimation,
      destroy,
      get playing() { return playing; },
      get record() { return displayRecord.slice(); },
      get step() { return currentStep; },
      get walls() { return walls; },
    };

    if (options.question) setState(options);
    if (options.interaction) setInteraction(options.interaction);
    return api;
  }

  return Object.freeze({
    LOGICAL_BOARD,
    BOARD_INSET,
    pickEdge,
    clientToBoard,
    rotationFitScale,
    exitLayout,
    compactPlaybackEvents,
    create,
  });
});
