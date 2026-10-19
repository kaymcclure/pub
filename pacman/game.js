// Babylon.js renderer for the Rust Pac-Man engine.
//
// All game rules live in engine.wasm. This file only forwards input, calls
// tick() once per frame, and draws whatever state the engine reports.
(async function () {
  "use strict";

  const BUILD = "2a84d6ec0bc94e009911abab5ab9eec630ce3f05";

  // Engine phase codes (see Phase::code in engine/src/game.rs).
  const PHASE = { START: 0, READY: 1, PLAYING: 2, DYING: 3, LEVEL_CLEAR: 4, GAME_OVER: 5 };
  // Engine tile codes (see engine/src/maze.rs).
  const TILE = { EMPTY: 0, WALL: 1, DOT: 2, POWER: 3, DOOR: 4 };
  // Direction code -> yaw so a model's local +x faces that way.
  const YAW = [0, -Math.PI / 2, 0, Math.PI / 2, Math.PI];

  const GHOST_COLORS = [
    [1.0, 0.0, 0.0], // Blinky
    [1.0, 0.72, 1.0], // Pinky
    [0.0, 1.0, 1.0], // Inky
    [1.0, 0.72, 0.32], // Clyde
  ];

  // ---- Load the engine ------------------------------------------------------

  const response = await fetch(`engine.wasm?v=${BUILD}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const wasm = instance.exports;
  wasm.new_game((Math.random() * 0xffffffff) >>> 0 || 1);

  const W = wasm.maze_width();
  const H = wasm.maze_height();
  const STATE_LEN = wasm.state_len();
  // Memory can grow, which detaches old views, so build fresh ones each read.
  const readState = () => new Float32Array(wasm.memory.buffer, wasm.state_ptr(), STATE_LEN);
  const readTiles = () => new Uint8Array(wasm.memory.buffer, wasm.tiles_ptr(), W * H);

  // Tile (x, y) -> world (x, z). Row 0 is the top of the maze, at +z.
  const worldX = (x) => x - (W - 1) / 2;
  const worldZ = (y) => (H - 1) / 2 - y;

  // ---- Scene ----------------------------------------------------------------

  const canvas = document.getElementById("game");
  const engine = new BABYLON.Engine(canvas, true, { stencil: true }, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);

  const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, 0.42, 40, new BABYLON.Vector3(0, 0, -0.5), scene);
  camera.fov = 0.8;
  const fitCamera = () => {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    const half = Math.tan(camera.fov / 2);
    const byHeight = (H / 2 + 3) / half;
    // Extra side margin: the tilt makes the near edge of the maze wider.
    const byWidth = (W / 2 + 3) / (half * aspect);
    camera.radius = Math.max(byHeight, byWidth);
  };
  fitCamera();

  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new BABYLON.Color3(0.1, 0.1, 0.2);
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.4, -1, 0.6), scene);
  sun.intensity = 0.7;

  const glow = new BABYLON.GlowLayer("glow", scene, { mainTextureSamples: 2 });
  glow.intensity = 0.55;

  const material = (name, rgb, emissive = 0.35) => {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = new BABYLON.Color3(...rgb);
    m.emissiveColor = new BABYLON.Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
    m.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
    return m;
  };

  // ---- Maze -----------------------------------------------------------------

  const floor = BABYLON.MeshBuilder.CreateGround("floor", { width: W + 1, height: H + 1 }, scene);
  floor.position.y = -0.01;
  floor.material = material("floorMat", [0.02, 0.02, 0.06], 0);

  const wallMat = material("wallMat", [0.13, 0.13, 0.85], 0.45);
  const wall = BABYLON.MeshBuilder.CreateBox("wall", { width: 1, height: 0.7, depth: 1 }, scene);
  wall.material = wallMat;

  const door = BABYLON.MeshBuilder.CreateBox("door", { width: 1, height: 0.15, depth: 0.2 }, scene);
  door.material = material("doorMat", [1, 0.72, 1], 0.6);

  const dotTemplate = BABYLON.MeshBuilder.CreateSphere("dot", { diameter: 0.24, segments: 6 }, scene);
  dotTemplate.material = material("dotMat", [1, 0.78, 0.65], 0.8);
  dotTemplate.isVisible = false;
  const powerTemplate = BABYLON.MeshBuilder.CreateSphere("power", { diameter: 0.6, segments: 12 }, scene);
  powerTemplate.material = material("powerMat", [1, 0.78, 0.65], 0.9);
  powerTemplate.isVisible = false;

  const pellets = new Map(); // tile index -> mesh instance
  const powerPellets = [];
  const shadowTiles = new Uint8Array(W * H);
  {
    const tiles = readTiles();
    const wallMatrices = [];
    const doors = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const t = tiles[i];
        if (t === TILE.WALL) {
          wallMatrices.push(BABYLON.Matrix.Translation(worldX(x), 0.35, worldZ(y)));
        } else if (t === TILE.DOOR) {
          doors.push([x, y]);
        } else if (t === TILE.DOT || t === TILE.POWER) {
          const template = t === TILE.DOT ? dotTemplate : powerTemplate;
          const inst = template.createInstance(`pellet${i}`);
          inst.position.set(worldX(x), 0.3, worldZ(y));
          pellets.set(i, inst);
          if (t === TILE.POWER) powerPellets.push(inst);
        }
      }
    }
    const buf = new Float32Array(wallMatrices.length * 16);
    wallMatrices.forEach((m, k) => m.copyToArray(buf, k * 16));
    wall.thinInstanceSetBuffer("matrix", buf, 16, true);

    // One stretched bar across the door tiles.
    const xs = doors.map((d) => worldX(d[0]));
    door.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0.3, worldZ(doors[0][1]) - 0.3);
    door.scaling.x = doors.length;
    shadowTiles.set(tiles);
  }

  const syncPellets = () => {
    const tiles = readTiles();
    for (const [i, mesh] of pellets) {
      if (tiles[i] !== shadowTiles[i]) {
        mesh.setEnabled(tiles[i] === TILE.DOT || tiles[i] === TILE.POWER);
      }
    }
    shadowTiles.set(tiles);
  };

  // ---- Pac-Man --------------------------------------------------------------

  const pacMat = material("pacMat", [1, 0.9, 0], 0.45);
  pacMat.backFaceCulling = false;
  // Two half-spheres split by the vertical plane through the facing (+x)
  // axis. They hinge about the vertical axis, so the mouth reads as the
  // classic wedge from the overhead camera.
  const pac = new BABYLON.TransformNode("pac", scene);
  const makeJaw = (name, side) => {
    const hinge = new BABYLON.TransformNode(`${name}Hinge`, scene);
    hinge.parent = pac;
    const dome = BABYLON.MeshBuilder.CreateSphere(name, { diameter: 0.9, slice: 0.5, segments: 20, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    dome.material = pacMat;
    dome.rotation.x = (side * Math.PI) / 2;
    dome.parent = hinge;
    const cap = BABYLON.MeshBuilder.CreateDisc(`${name}Cap`, { radius: 0.45, tessellation: 32, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    cap.material = pacMat;
    cap.parent = hinge;
    return hinge;
  };
  const leftJaw = makeJaw("leftJaw", 1);
  const rightJaw = makeJaw("rightJaw", -1);
  pac.position.y = 0.45;

  // ---- Ghosts ---------------------------------------------------------------

  const eyeWhite = material("eyeWhite", [1, 1, 1], 0.5);
  const pupilMat = material("pupil", [0.1, 0.2, 1], 0.5);
  const frightMat = material("fright", [0.15, 0.2, 1], 0.6);
  const flashMat = material("flash", [1, 1, 1], 0.7);

  const ghosts = GHOST_COLORS.map((rgb, i) => {
    const root = new BABYLON.TransformNode(`ghost${i}`, scene);
    const skirt = BABYLON.MeshBuilder.CreateCylinder(`ghostSkirt${i}`, { height: 0.45, diameter: 0.86, tessellation: 24 }, scene);
    skirt.position.y = 0.22;
    const dome = BABYLON.MeshBuilder.CreateSphere(`ghostDome${i}`, { diameter: 0.86, slice: 0.5, segments: 16 }, scene);
    dome.position.y = 0.45;
    const body = BABYLON.Mesh.MergeMeshes([skirt, dome], true);
    body.name = `ghostBody${i}`;
    body.parent = root;
    const normalMat = material(`ghostMat${i}`, rgb, 0.4);
    body.material = normalMat;

    // Eyes sit on a node that turns to face the ghost's direction (+x local).
    const face = new BABYLON.TransformNode(`ghostFace${i}`, scene);
    face.parent = root;
    const pupils = [];
    for (const side of [-1, 1]) {
      const white = BABYLON.MeshBuilder.CreateSphere(`eye${i}${side}`, { diameter: 0.26, segments: 8 }, scene);
      white.material = eyeWhite;
      white.position.set(0.3, 0.55, side * 0.16);
      white.parent = face;
      const pupil = BABYLON.MeshBuilder.CreateSphere(`pupil${i}${side}`, { diameter: 0.13, segments: 6 }, scene);
      pupil.material = pupilMat;
      pupil.position.set(0.41, 0.55, side * 0.16);
      pupil.parent = face;
      pupils.push(pupil);
    }
    return { root, body, face, pupils, normalMat };
  });

  // ---- HUD and input ----------------------------------------------------------

  const hud = {
    score: document.getElementById("score"),
    high: document.getElementById("high"),
    level: document.getElementById("level"),
    message: document.getElementById("message"),
    lives: document.getElementById("lives"),
  };
  let shown = {};
  const setText = (key, el, value, html = false) => {
    if (shown[key] === value) return;
    shown[key] = value;
    if (html) el.innerHTML = value;
    else el.textContent = value;
  };

  const KEYS = {
    ArrowUp: 1, KeyW: 1,
    ArrowRight: 2, KeyD: 2,
    ArrowDown: 3, KeyS: 3,
    ArrowLeft: 4, KeyA: 4,
  };
  window.addEventListener("keydown", (e) => {
    const dir = KEYS[e.code];
    if (dir) {
      wasm.set_input(dir);
      e.preventDefault();
    }
  });

  // Swipes steer; a tap on the start or game-over screen starts a game.
  let touchStart = null;
  canvas.addEventListener("pointerdown", (e) => {
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
      const phase = readState()[21];
      if (phase === PHASE.START || phase === PHASE.GAME_OVER) wasm.set_input(4);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) wasm.set_input(dx > 0 ? 2 : 4);
    else wasm.set_input(dy > 0 ? 3 : 1);
  });

  // On-screen D-pad for touch devices. A finger can slide from one arrow to
  // another without lifting, like a real D-pad.
  const dpad = document.querySelector(".dpad");
  let pressed = null;
  const press = (e) => {
    const button = document.elementFromPoint(e.clientX, e.clientY)?.closest(".dpad button");
    if (button === pressed) return;
    pressed?.classList.remove("pressed");
    pressed = button;
    if (button) {
      button.classList.add("pressed");
      wasm.set_input(Number(button.dataset.dir));
    }
  };
  const release = () => {
    pressed?.classList.remove("pressed");
    pressed = null;
  };
  dpad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dpad.setPointerCapture(e.pointerId);
    press(e);
  });
  dpad.addEventListener("pointermove", (e) => {
    if (pressed || e.buttons) press(e);
  });
  dpad.addEventListener("pointerup", release);
  dpad.addEventListener("pointercancel", release);
  dpad.addEventListener("contextmenu", (e) => e.preventDefault());

  // Show the D-pad on touch screens, or as soon as anything touches the page.
  let touchMode = false;
  const enableTouch = () => {
    if (touchMode) return;
    touchMode = true;
    document.body.classList.add("touch");
  };
  if (window.matchMedia("(pointer: coarse)").matches) enableTouch();
  window.addEventListener("touchstart", enableTouch, { passive: true });

  // ---- Frame loop -------------------------------------------------------------

  let clock = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime();
    clock += dt / 1000;
    wasm.tick(dt);
    const s = readState();
    const phase = s[21];
    const phaseTime = s[22];
    syncPellets();

    // Power pellets pulse; the walls flash when a level is cleared.
    const pulse = 0.75 + 0.25 * Math.sin(clock * 8);
    for (const p of powerPellets) p.scaling.setAll(pulse);
    const flashWalls = phase === PHASE.LEVEL_CLEAR && Math.floor(phaseTime * 4) % 2 === 1;
    wallMat.emissiveColor.set(flashWalls ? 0.9 : 0.06, flashWalls ? 0.9 : 0.06, flashWalls ? 0.9 : 0.38);

    // Pac-Man: position, facing, chomping, and shrinking away when caught.
    pac.position.x = worldX(s[0]);
    pac.position.z = worldZ(s[1]);
    pac.rotation.y = YAW[s[2]] ?? 0;
    const chomping = s[3] === 1 && phase === PHASE.PLAYING;
    const mouth = chomping ? 0.05 + 0.5 * Math.abs(Math.sin(clock * 14)) : 0.3;
    leftJaw.rotation.y = -mouth;
    rightJaw.rotation.y = mouth;
    const dying = phase === PHASE.DYING;
    pac.scaling.setAll(dying ? Math.max(0.01, 1 - phaseTime / 1.2) : 1);
    if (dying) pac.rotation.y += phaseTime * 12;
    pac.setEnabled(phase !== PHASE.GAME_OVER);

    // Ghosts.
    const frightLeft = s[20];
    const flashing = frightLeft < 2 && Math.floor(clock * 5) % 2 === 0;
    const hideGhosts = dying || phase === PHASE.LEVEL_CLEAR || phase === PHASE.GAME_OVER;
    ghosts.forEach((g, i) => {
      const b = 4 + i * 4;
      const look = s[b + 3];
      g.root.setEnabled(!hideGhosts);
      g.root.position.set(worldX(s[b]), 0.02 + 0.04 * Math.sin(clock * 10 + i), worldZ(s[b + 1]));
      g.face.rotation.y = YAW[s[b + 2]] ?? 0;
      g.body.setEnabled(look !== 2);
      g.body.material = look === 1 ? (flashing ? flashMat : frightMat) : g.normalMat;
      for (const p of g.pupils) p.setEnabled(look !== 1);
    });

    // HUD.
    setText("score", hud.score, String(s[23]));
    setText("high", hud.high, String(s[24]));
    setText("level", hud.level, String(s[26]));
    const spare = phase === PHASE.START ? 2 : Math.max(0, s[25] - 1);
    setText("lives", hud.lives, "<i></i>".repeat(spare), true);
    let message = "";
    const how = touchMode ? "TAP AN ARROW OR SWIPE" : "PRESS AN ARROW KEY";
    if (phase === PHASE.START) message = `PAC-MAN<span class="sub">${how} TO PLAY</span>`;
    else if (phase === PHASE.READY) message = "READY!";
    else if (phase === PHASE.LEVEL_CLEAR) message = "LEVEL CLEAR!";
    else if (phase === PHASE.GAME_OVER) {
      message = phaseTime > 1.5 ? `GAME OVER<span class="sub">${how} TO PLAY AGAIN</span>` : "GAME OVER";
    }
    setText("message", hud.message, message, true);
  });

  // The stage changes size on window resizes, rotation, and when the
  // touch controls appear; refit the maze each time.
  new ResizeObserver(() => {
    engine.resize();
    fitCamera();
  }).observe(document.getElementById("stage"));
  engine.runRenderLoop(() => scene.render());

  // Lets automated browser tests drive and inspect the game.
  window.__pacman = { wasm, readState, readTiles, scene, camera };
})();
