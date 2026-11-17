/**
 * AeroForge 3D — Main Interactive Studio, 3D Renderer (WebGL + CPU Software Rasterizer Fallback),
 * 12-Bay Internal Cutaway & Callout Label Projector, Mach Wind-Tunnel CFD, and 3D Dogfight HUD.
 */
(function () {
  'use strict';

  const P = window.AFPhysics;
  const Mdl = window.AFModels;
  const Df = window.AFDogfight;
  const Arena = window.AFArena;
  const THREE = window.THREE;
  const W = 1600, H = 900;
  const $ = (id) => document.getElementById(id);

  // Viewport scaling
  const appEl = $('app');
  function fitViewport() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    const tx = (window.innerWidth - W * s) * 0.5;
    const ty = (window.innerHeight - H * s) * 0.5;
    appEl.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
  }
  window.addEventListener('resize', fitViewport);
  fitViewport();

  // ---------------------------------------------------------------------------
  // 1. RENDERER INITIALIZATION (WebGL with ACESFilmicToneMapping + CPU Z-Buffer Fallback)
  // ---------------------------------------------------------------------------
  const glCanvas = $('gl-canvas');
  const hudCanvas = $('hud-canvas');
  const hudCtx = hudCanvas.getContext('2d');
  let renderer = null;

  function createCpuFallbackRenderer(canvasEl) {
    const ctx = canvasEl.getContext('2d');
    const cw = 800, ch = 450;
    const off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    const octx = off.getContext('2d');
    const img = octx.createImageData(cw, ch);
    const pix = new Uint32Array(img.data.buffer);
    const zbuf = new Float32Array(cw * ch);
    const mvp = new THREE.Matrix4(), vp = new THREE.Matrix4();

    return {
      isSoftware: true,
      render(scn, cam) {
        scn.updateMatrixWorld(true);
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        pix.fill(0xffc8b8a6);
        zbuf.fill(0);

        scn.traverse((node) => {
          if (!node.visible || !node.isMesh || !node.geometry) return;
          let cur = node;
          while (cur) { if (!cur.visible) return; cur = cur.parent; }
          const mat = Array.isArray(node.material) ? node.material[0] : node.material;
          if (mat && mat.colorWrite === false) return; // stencil masks are never drawn as colour
          if (mat && mat.transparent && mat.opacity < 0.25) return; // skip translucent X-ray skin in software pass so internals shine clearly!
          const pos = node.geometry.attributes.position;
          const norm = node.geometry.attributes.normal;
          if (!pos) return;
          if (!norm) node.geometry.computeVertexNormals();
          const nArr = node.geometry.attributes.normal.array;
          const pArr = pos.array;
          const col = (mat && mat.color) || { r: 0.7, g: 0.75, b: 0.8 };
          mvp.multiplyMatrices(vp, node.matrixWorld);
          const e = mvp.elements, mw = node.matrixWorld.elements;
          const idx = node.geometry.index ? node.geometry.index.array : null;
          const count = idx ? idx.length : pos.count;

          for (let i = 0; i < count; i += 3) {
            const i0 = (idx ? idx[i] : i) * 3;
            const i1 = (idx ? idx[i + 1] : i + 1) * 3;
            const i2 = (idx ? idx[i + 2] : i + 2) * 3;
            const x0 = pArr[i0], y0 = pArr[i0 + 1], z0 = pArr[i0 + 2];
            const x1 = pArr[i1], y1 = pArr[i1 + 1], z1 = pArr[i1 + 2];
            const x2 = pArr[i2], y2 = pArr[i2 + 1], z2 = pArr[i2 + 2];
            const w0 = e[3] * x0 + e[7] * y0 + e[11] * z0 + e[15];
            const w1 = e[3] * x1 + e[7] * y1 + e[11] * z1 + e[15];
            const w2 = e[3] * x2 + e[7] * y2 + e[11] * z2 + e[15];
            if (w0 <= 0.1 || w1 <= 0.1 || w2 <= 0.1) continue;
            const iw0 = 1 / w0, iw1 = 1 / w1, iw2 = 1 / w2;
            const sx0 = ((e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12]) * iw0 * 0.5 + 0.5) * cw;
            const sy0 = (-(e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13]) * iw0 * 0.5 + 0.5) * ch;
            const sx1 = ((e[0] * x1 + e[4] * y1 + e[8] * z1 + e[12]) * iw1 * 0.5 + 0.5) * cw;
            const sy1 = (-(e[1] * x1 + e[5] * y1 + e[9] * z1 + e[13]) * iw1 * 0.5 + 0.5) * ch;
            const sx2 = ((e[0] * x2 + e[4] * y2 + e[8] * z2 + e[12]) * iw2 * 0.5 + 0.5) * cw;
            const sy2 = (-(e[1] * x2 + e[5] * y2 + e[9] * z2 + e[13]) * iw2 * 0.5 + 0.5) * ch;
            const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
            const maxX = Math.min(cw - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
            const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
            const maxY = Math.min(ch - 1, Math.ceil(Math.max(sy0, sy1, sy2)));
            if (minX > maxX || minY > maxY) continue;
            const area = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
            if (Math.abs(area) < 0.2) continue;
            const nx = mw[0] * nArr[i0] + mw[4] * nArr[i0 + 1] + mw[8] * nArr[i0 + 2];
            const ny = mw[1] * nArr[i0] + mw[5] * nArr[i0 + 1] + mw[9] * nArr[i0 + 2];
            const nz = mw[2] * nArr[i0] + mw[6] * nArr[i0 + 1] + mw[10] * nArr[i0 + 2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            const lit = Math.max(0.32, Math.min(1.40, 0.48 + ((-0.4 * nx + 0.8 * ny + 0.4 * nz) / nl) * 0.78));
            const r = Math.min(255, (col.r * 255 * lit) | 0);
            const g = Math.min(255, (col.g * 255 * lit) | 0);
            const b = Math.min(255, (col.b * 255 * lit) | 0);
            const abgr = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
            const zAvg = (iw0 + iw1 + iw2) * 0.333;
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                const w0e = (sx1 - sx0) * (y - sy0) - (sy1 - sy0) * (x - sx0);
                const w1e = (sx2 - sx1) * (y - sy1) - (sy2 - sy1) * (x - sx1);
                const w2e = (sx0 - sx2) * (y - sy2) - (sy0 - sy2) * (x - sx2);
                if ((w0e >= 0 && w1e >= 0 && w2e >= 0) || (w0e <= 0 && w1e <= 0 && w2e <= 0)) {
                  const pIdx = y * cw + x;
                  if (zAvg > zbuf[pIdx]) { zbuf[pIdx] = zAvg; pix[pIdx] = abgr; }
                }
              }
            }
          }
        });
        octx.putImageData(img, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(off, 0, 0, W, H);
      },
    };
  }

  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (gl) {
      renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(W, H, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.28;
      }
    }
  } catch (e) { renderer = null; }
  if (!renderer) renderer = createCpuFallbackRenderer(glCanvas);

  // ---------------------------------------------------------------------------
  // 2. 3D HANGAR / WIND-TUNNEL SCENE (bright, evenly lit daylight studio)
  // ---------------------------------------------------------------------------
  const studioScene = new THREE.Scene();
  studioScene.fog = new THREE.Fog('#9aa8b9', 16, 36);
  const studioCam = new THREE.PerspectiveCamera(29, W / H, 0.1, 150);

  studioScene.add(new THREE.HemisphereLight('#ffffff', '#8a8f98', 0.95));
  const keyLight = new THREE.DirectionalLight('#ffffff', 1.5);
  keyLight.position.set(-6, 12, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -7; keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 40;
  keyLight.shadow.bias = -0.0006;      // stops shadow striping flickering across the airframe as it turns
  keyLight.shadow.normalBias = 0.03;
  studioScene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#dbeafe', 0.6);
  fillLight.position.set(8, 6, -6);
  studioScene.add(fillLight);

  // Daylight reflection environment shared by the hangar and the arena: with a dark environment,
  // metallic skins reflect black and the aircraft vanish against the background at some angles.
  let envTexture = null;
  if (!renderer.isSoftware) {
    try {
      const envScn = new THREE.Scene();
      const mkBox = (w, h, d, x, y, z, c) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
        m.position.set(x, y, z); envScn.add(m);
      };
      mkBox(60, 60, 60, 0, 0, 0, '#a9c6e8');   // sky
      mkBox(30, 0.5, 30, 0, 14, 0, '#ffffff'); // overhead light
      mkBox(58, 0.5, 58, 0, -12, 0, '#77736c'); // ground
      const pmrem = new THREE.PMREMGenerator(renderer);
      envTexture = pmrem.fromScene(envScn, 0.03).texture;
      studioScene.environment = envTexture;
      pmrem.dispose();
    } catch (e) { envTexture = null; }
  }

  const floorGrp = new THREE.Group();
  studioScene.add(floorGrp);
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: '#8f959d', roughness: 0.95, metalness: 0 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorGrp.add(floorMesh);

  const gridHelper = new THREE.GridHelper(40, 40, '#6b7280', '#7d848e');
  gridHelper.position.y = 0.003;
  floorGrp.add(gridHelper);

  function disposeModel(rootObj) {
    const mats = new Set();
    rootObj.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => mats.add(mt));
    });
    mats.forEach((mt) => mt.dispose());
  }

  // ---------------------------------------------------------------------------
  // 3. APPLICATION STATE
  // ---------------------------------------------------------------------------
  const state = {
    mode: 'cad',          // 'cad' | 'teardown' | 'cfd' | 'dogfight'
    subTab: 'airframe',   // 'airframe' | 'propulsion' | 'avionics' | 'systems' | 'weapons' | 'geometry' | 'stealth' | 'tunnel'
    nationFilter: 'ALL',  // 'ALL' | 'USA' | 'RUS' | 'CHN'
    eraFilter: 'ALL',     // 'ALL' | 'ww1' | 'ww2' | 'gen1_2' | 'gen3_4' | 'gen5_6'
    activePreset: 'usa_f22a_raptor',
    cfg: JSON.parse(JSON.stringify(P.PRESETS.usa_f22a_raptor)),
    build: null,
    model3d: null,
    showCfd: false,
    xray: false,
    showLabels: false,
    turntable: true,
    teardown: 0,
    orbit: { az: 0.68, el: 0.30, dist: 8.6 },
    time: 0,
    // Dogfight state
    dfMatch: null,
    dfScene: null,
    dfCam: null,
    dfJets3d: [],
    dfTrails: [],
    dfTrailT: 0,
    dfEnemies: 2,
    dfCycle: false,
    dfArena: null,
    dfCamFwd: null,
    dfCamMode: 'chase',
    dfAutopilot: true,
    keys: new Set(),
  };

  function rebuildAircraft() {
    state.build = P.compute(state.cfg);
    if (state.model3d) {
      studioScene.remove(state.model3d.root);
      disposeModel(state.model3d.root);
    }
    state.model3d = Mdl.buildAircraft3D(THREE, state.build, { showCfd: state.showCfd });
    state.model3d.setXray(state.xray);
    state.model3d.setTeardown(state.teardown);
    floorGrp.position.y = state.model3d.groundY - 0.004; // wheels rest on the floor
    studioScene.add(state.model3d.root);
    updateUI();
  }

  // ---------------------------------------------------------------------------
  // 4. UI RENDERING (8 LEFT TABS, NATION/ERA FILTERS, RIGHT TELEMETRY, CALLOUTS)
  // ---------------------------------------------------------------------------
  function filteredAirframes() {
    return Object.values(P.AIRFRAMES).filter((af) => {
      if (state.nationFilter !== 'ALL' && af.nation !== state.nationFilter) return false;
      if (state.eraFilter !== 'ALL' && af.era !== state.eraFilter) return false;
      return true;
    });
  }

  function renderPresetStrip() {
    const strip = $('preset-strip');
    const list = filteredAirframes();
    strip.innerHTML = list.map((af) =>
      `<button class="preset-pill${state.cfg.airframe === af.id ? ' active' : ''}" data-preset="${af.id}">${P.NATIONS[af.nation].flag} ${af.name.split(' (')[0]}</button>`
    ).join('');
  }

  function renderLeftPanel() {
    const box = $('left-body');
    const c = state.cfg, b = state.build;

    if (state.subTab === 'airframe') {
      const list = filteredAirframes();
      box.innerHTML = `
        <div class="sec-lbl"><span>FILTER BY NATION (USA / RUSSIA / CHINA)</span><span>${list.length} AIRCRAFT</span></div>
        <div class="filter-row">
          ${Object.values(P.NATIONS).map((n) => `<button class="filter-pill${state.nationFilter === n.id ? ' active' : ''}" data-nation="${n.id}">${n.flag} ${n.id}</button>`).join('')}
        </div>
        <div class="sec-lbl"><span>FILTER BY HISTORICAL ERA (1917–2030)</span></div>
        <div class="filter-row">
          ${Object.values(P.ERAS).map((er) => `<button class="filter-pill${state.eraFilter === er.id ? ' active' : ''}" data-era="${er.id}">${er.short || 'ALL ERAS'}</button>`).join('')}
        </div>
        <div class="sec-lbl"><span>SELECT AIRCRAFT / AIRFRAME PLANFORM</span></div>
        ${list.map((af) => `
          <div class="item-card${af.id === c.airframe ? ' active' : ''}" data-pick-af="${af.id}">
            <div class="row1"><b>${af.name}</b><span class="tag">${af.tag}</span></div>
            <small>${af.desc}</small>
          </div>
        `).join('')}
      `;
    } else if (state.subTab === 'propulsion') {
      box.innerHTML = `
        <div class="sec-lbl"><span>03 · MODULAR PROPULSION & TURBINE / PISTON CORES (21)</span></div>
        ${Object.values(P.ENGINES).map((en) => `
          <div class="item-card${en.id === c.engine ? ' active' : ''}" data-pick-key="engine" data-val="${en.id}">
            <div class="row1"><b>${en.name}</b><span class="tag">M ${en.maxMach.toFixed(2)} · TVC ±${en.tvcDeg}°</span></div>
            <small>${en.spec} · Mass ${en.massKg} kg</small>
          </div>
        `).join('')}
      `;
    } else if (state.subTab === 'avionics') {
      box.innerHTML = `
        <div class="sec-lbl"><span>04 · NOSE RADAR / OPTICAL GUNSIGHT BAY (10)</span></div>
        <select data-select-key="radar">
          ${Object.values(P.RADARS).map((r) => `<option value="${r.id}"${c.radar === r.id ? ' selected' : ''}>${r.name} (${r.rangeKm} km · ${r.massKg} kg)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>05 · COCKPIT TUB, EJECTION SEAT & HMDS BAY (8)</span></div>
        <select data-select-key="cockpit">
          ${Object.values(P.COCKPITS).map((ck) => `<option value="${ck.id}"${c.cockpit === ck.id ? ' selected' : ''}>${ck.name} (+${ck.maxGBonus}G · ${ck.massKg} kg)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>06 · FLIGHT CONTROL SYSTEM (FCS) & ACTUATORS (6)</span></div>
        <select data-select-key="fcs">
          ${Object.values(P.FCS).map((f) => `<option value="${f.id}"${c.fcs === f.id ? ' selected' : ''}>${f.name} (+${f.turnBonus}°/s)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>12 · DEFENSIVE EW, RWR & COUNTERMEASURE BAY (5)</span></div>
        <select data-select-key="ewSuite">
          ${Object.values(P.EW_SUITES).map((ew) => `<option value="${ew.id}"${c.ewSuite === ew.id ? ' selected' : ''}>${ew.name} (+${ew.flareBonus} Flares)</option>`).join('')}
        </select>
      `;
    } else if (state.subTab === 'systems') {
      box.innerHTML = `
        <div class="sec-lbl"><span>07 · INTERNAL FUEL TANKS & INERTING PLUMBING (4)</span></div>
        <select data-select-key="fuelSys">
          ${Object.values(P.FUEL_SYSTEMS).map((fs) => `<option value="${fs.id}"${c.fuelSys === fs.id ? ' selected' : ''}>${fs.name}</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>08 · HYDRAULIC PUMPS & 270V EHA POWER BUS (4)</span></div>
        <select data-select-key="hydraulics">
          ${Object.values(P.HYDRAULICS).map((h) => `<option value="${h.id}"${c.hydraulics === h.id ? ' selected' : ''}>${h.name} (${h.massKg} kg)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>09 · OBOGS LIFE-SUPPORT & THERMAL ECS LOOP (4)</span></div>
        <select data-select-key="ecs">
          ${Object.values(P.ECS).map((ec) => `<option value="${ec.id}"${c.ecs === ec.id ? ' selected' : ''}>${ec.name} (Ceiling ${ec.maxAltFt.toLocaleString()} ft)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>10 · UNDERCARRIAGE & CARRIER ARRESTING RIG (5)</span></div>
        <select data-select-key="landingGear">
          ${Object.values(P.LANDING_GEAR).map((lg) => `<option value="${lg.id}"${c.landingGear === lg.id ? ' selected' : ''}>${lg.name} (${lg.massKg} kg)</option>`).join('')}
        </select>

        <div class="sec-lbl"><span>11 · INTERNAL GUN BAY & ROTARY AMMO DRUM (8)</span></div>
        <select data-select-key="gunBay">
          ${Object.values(P.GUN_BAYS).map((g) => `<option value="${g.id}"${c.gunBay === g.id ? ' selected' : ''}>${g.name} (${g.ammo} rds)</option>`).join('')}
        </select>
      `;
    } else if (state.subTab === 'weapons') {
      box.innerHTML = `
        <div class="sec-lbl"><span>13 · 5 MODULAR HARDPOINT STATIONS (US / RUS / CHN / WWI / WWII)</span></div>
        ${P.STATIONS.map((st) => `
          <div class="ctrl-row" style="margin-bottom:5px;">
            <label><span>${P.STATION_NAMES[st]}</span><b>${b.stations[st].massKg} KG</b></label>
            <select data-station="${st}">
              ${Object.values(P.PAYLOADS).map((pl) => `<option value="${pl.id}"${c.stations[st] === pl.id ? ' selected' : ''}>[${pl.nation}] ${pl.name} (${pl.massKg} kg)</option>`).join('')}
            </select>
          </div>
        `).join('')}
      `;
    } else if (state.subTab === 'geometry') {
      box.innerHTML = `
        <div class="sec-lbl"><span>PARAMETRIC AIRFRAME & WING SCALING</span></div>
        <div class="ctrl-row">
          <label><span>AIRCRAFT DESIGNATION</span></label>
          <input type="text" id="inp-name" value="${c.name}" maxlength="28">
        </div>
        <div class="ctrl-row">
          <label><span>WINGSPAN SCALE</span><b>${b.geom.spanM} m (${Math.round(c.spanScale * 100)}%)</b></label>
          <input type="range" data-range="spanScale" min="0.78" max="1.32" step="0.01" value="${c.spanScale}">
        </div>
        <div class="ctrl-row">
          <label><span>FUSELAGE LENGTH SCALE</span><b>${b.geom.lengthM} m (${Math.round(c.lengthScale * 100)}%)</b></label>
          <input type="range" data-range="lengthScale" min="0.80" max="1.28" step="0.01" value="${c.lengthScale}">
        </div>
        <div class="ctrl-row">
          <label><span>LEADING-EDGE SWEEP OFFSET</span><b>${b.geom.sweepDeg}°</b></label>
          <input type="range" data-range="sweepOffsetDeg" min="-15" max="15" step="1" value="${c.sweepOffsetDeg}">
        </div>
        <div class="ctrl-row">
          <label><span>INTERNAL FUEL FILL</span><b>${Math.round(c.fuelFraction * 100)}% (${b.mass.fuelKg} kg)</b></label>
          <input type="range" data-range="fuelFraction" min="0.20" max="1.00" step="0.05" value="${c.fuelFraction}">
        </div>
      `;
    } else if (state.subTab === 'stealth') {
      box.innerHTML = `
        <div class="sec-lbl"><span>01/02 · STRUCTURAL & RADAR-ABSORBENT SKIN (8)</span></div>
        ${Object.values(P.MATERIALS).map((mt) => `
          <div class="item-card${mt.id === c.material ? ' active' : ''}" data-pick-key="material" data-val="${mt.id}">
            <div class="row1"><b>${mt.name}</b><span class="tag">${mt.maxTempC}°C · ${mt.strengthG}G</span></div>
            <small>RCS Multiplier ×${mt.rcsMult} · Density ×${mt.densityFactor}</small>
          </div>
        `).join('')}
        <div class="sec-lbl"><span>HISTORICAL & MODERN SQUADRON LIVERY (20)</span></div>
        <select data-select-key="livery">
          ${Object.values(P.LIVERIES).map((lv) => `<option value="${lv.id}"${lv.id === c.livery ? ' selected' : ''}>${lv.name}</option>`).join('')}
        </select>
      `;
    } else if (state.subTab === 'tunnel') {
      box.innerHTML = `
        <div class="sec-lbl"><span>MACH WIND-TUNNEL & ATMOSPHERE CONDITIONS</span></div>
        <div class="ctrl-row">
          <label><span>FREESTREAM MACH NUMBER</span><b>MACH ${c.machTest.toFixed(2)}</b></label>
          <input type="range" data-range="machTest" min="0.15" max="4.20" step="0.05" value="${c.machTest}">
        </div>
        <div class="ctrl-row">
          <label><span>PRESSURE ALTITUDE</span><b>${c.altitudeFt.toLocaleString()} FT</b></label>
          <input type="range" data-range="altitudeFt" min="0" max="70000" step="1000" value="${c.altitudeFt}">
        </div>
        <div class="ctrl-row">
          <label><span>ANGLE OF ATTACK (AoA α)</span><b>${c.aoaDeg.toFixed(1)}°</b></label>
          <input type="range" data-range="aoaDeg" min="-4" max="30" step="0.5" value="${c.aoaDeg}">
        </div>
      `;
    }
  }

  function drawTelemetryChart(b) {
    const cv = $('telemetry-chart');
    if (!cv) return;
    const g = cv.getContext('2d');
    const cw = cv.width, ch = cv.height;
    g.clearRect(0, 0, cw, ch);

    // Left half: 360° Radar Cross Section Polar Rose
    const cx = 75, cy = ch * 0.50, rMax = 54;
    g.strokeStyle = '#1e293b'; g.lineWidth = 1;
    for (const r of [rMax * 0.35, rMax * 0.68, rMax]) {
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
    g.beginPath(); g.moveTo(cx - rMax, cy); g.lineTo(cx + rMax, cy); g.moveTo(cx, cy - rMax); g.lineTo(cx, cy + rMax); g.stroke();

    g.beginPath();
    b.stealth.rcsPolar.forEach((pt, i) => {
      const ang = (pt.deg - 90) * (Math.PI / 180);
      const norm = P.clamp((pt.dbsm + 35) / 55, 0.14, 1.0);
      const x = cx + Math.cos(ang) * rMax * norm;
      const y = cy + Math.sin(ang) * rMax * norm;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.fillStyle = 'rgba(56, 189, 248, 0.24)'; g.fill();
    g.strokeStyle = '#38bdf8'; g.lineWidth = 1.8; g.stroke();
    g.fillStyle = '#94a3b8'; g.font = '700 9px monospace'; g.textAlign = 'center';
    g.fillText(`RCS ${b.stealth.rcsDbsm.toFixed(1)} dBsm`, cx, ch - 5);

    // Right half: Thrust vs Drag across Mach
    const gx0 = 158, gx1 = cw - 10, gy0 = 16, gy1 = ch - 20;
    g.strokeStyle = '#1e293b'; g.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
    const maxKn = Math.max(15, ...b.machCurve.map((q) => Math.max(q.thrustKn, q.dragKn)));
    const plotCurve = (key, color) => {
      g.beginPath();
      b.machCurve.forEach((pt, i) => {
        const x = gx0 + (i / Math.max(1, b.machCurve.length - 1)) * (gx1 - gx0);
        const y = gy1 - P.clamp(pt[key] / maxKn, 0, 1) * (gy1 - gy0);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    };
    plotCurve('thrustKn', '#22c55e');
    plotCurve('dragKn', '#f97316');
    g.fillStyle = '#22c55e'; g.fillText('THRUST', gx0 + 26, gy0 + 11);
    g.fillStyle = '#f97316'; g.fillText('DRAG vs MACH', gx1 - 42, gy0 + 11);
  }

  function updateUI() {
    const b = state.build;
    $('hdr-class').textContent = `${b.nation.flag} ${b.nation.name} · ${b.era.short}`;
    $('hdr-name').textContent = b.cfg.name;
    $('top-wt').textContent = `${b.mass.grossKg.toLocaleString()} / ${b.mass.mtowKg.toLocaleString()} KG`;
    $('top-mach').textContent = `MACH ${b.propulsion.maxMach.toFixed(2)}`;
    $('top-rcs').textContent = `${b.stealth.rcsDbsm > 0 ? '+' : ''}${b.stealth.rcsDbsm.toFixed(1)} dBsm`;
    $('top-rcs').className = b.stealth.rcsDbsm <= -5 ? 'ok' : 'warn';
    $('top-cost').textContent = b.costUsd >= 1e6 ? `$${(b.costUsd / 1e6).toFixed(1)}M` : `$${(b.costUsd / 1e3).toFixed(0)}K`;
    $('top-status').textContent = b.fails ? `${b.fails} FAIL` : b.warns ? `${b.warns} WARN` : 'ALL PASS';
    $('top-status').className = b.fails || b.warns ? 'warn' : 'ok';

    if (state.model3d) {
      $('left-count').textContent = `24 JETS · ${state.model3d.explodeList.length} 3D SUB-PARTS`;
    }

    $('m-tw').textContent = b.propulsion.twRatio.toFixed(2);
    $('m-ld').textContent = b.aero.ldCruise.toFixed(1);
    $('m-turn').textContent = b.performance.instTurnDegS.toFixed(1);
    $('m-ps').textContent = (b.performance.psMs >= 0 ? '+' : '') + Math.round(b.performance.psMs);
    $('m-sc').textContent = b.propulsion.supercruiseMach > 1.0 ? `M ${b.propulsion.supercruiseMach.toFixed(2)}` : 'SUBSONIC';
    $('m-range').textContent = b.performance.rangeKm.toLocaleString();

    drawTelemetryChart(b);

    $('checks-list').innerHTML = b.checks.map((c) => `
      <div class="check-item">
        <div class="dot ${c.status}"></div>
        <div><b style="color:#fff;font-size:9.8px;">${c.label}</b><div style="color:var(--muted);font-size:9.5px;">${c.detail}</div></div>
      </div>
    `).join('');

    $('bom-list').innerHTML = b.parts.map((p) => `
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #162032;padding:3px 0;gap:6px;">
        <span style="color:#e2e8f0;font-weight:600;">${p.cat}: <span style="color:#94a3b8;font-weight:400;">${p.name}</span></span>
        <span style="color:var(--cyan);font-family:monospace;white-space:nowrap;">${p.massKg} kg</span>
      </div>
    `).join('');

    renderPresetStrip();
    renderLeftPanel();
  }

  // Draw 2D Leader Callout Labels over the 3D Exploded / Cutaway Sub-Parts!
  function drawSubPartCallouts() {
    hudCtx.clearRect(0, 0, W, H);
    if (!state.showLabels || !state.model3d) return;

    const seenCats = new Set();
    const wp = new THREE.Vector3();
    hudCtx.font = '700 10px "JetBrains Mono", monospace';

    state.model3d.explodeList.forEach((obj, idx) => {
      const ud = obj.userData;
      if (!ud || !ud.part) return;
      // Show one clean representative callout per category + key engine stages so labels never overlap
      const key = ud.cat + (ud.part.includes('STAGE 1') || ud.part.includes('COMBUSTION') || ud.part.includes('NOZZLE') || ud.part.includes('FAN') ? ud.part.slice(0, 12) : '');
      if (seenCats.has(key) && state.teardown < 0.4) return;
      seenCats.add(key);

      obj.getWorldPosition(wp);
      wp.project(studioCam);
      if (wp.z > 1) return;
      const sx = (wp.x * 0.5 + 0.5) * W;
      const sy = (-wp.y * 0.5 + 0.5) * H;
      if (sx < 400 || sx > 1210 || sy < 110 || sy > 815) return;

      const dx = (idx % 2 === 0 ? -1 : 1) * 48;
      const dy = ((idx % 5) - 2) * 22;
      const lx = sx + dx, ly = sy + dy;

      hudCtx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      hudCtx.lineWidth = 1.2;
      hudCtx.beginPath(); hudCtx.moveTo(sx, sy); hudCtx.lineTo(lx, ly); hudCtx.stroke();
      hudCtx.fillStyle = '#f97316';
      hudCtx.beginPath(); hudCtx.arc(sx, sy, 3, 0, Math.PI * 2); hudCtx.fill();

      const labelText = ud.part.length > 36 ? ud.part.slice(0, 36) + '…' : ud.part;
      const tw = hudCtx.measureText(labelText).width + 10;
      const bx = dx < 0 ? lx - tw : lx;
      hudCtx.fillStyle = 'rgba(7, 11, 20, 0.88)';
      hudCtx.fillRect(bx, ly - 9, tw, 17);
      hudCtx.strokeStyle = '#1e293b';
      hudCtx.strokeRect(bx, ly - 9, tw, 17);
      hudCtx.fillStyle = '#e2e8f0';
      hudCtx.fillText(labelText, bx + 5, ly + 3);
    });
  }

  // ---------------------------------------------------------------------------
  // 5. DOGFIGHT ARENA — daylight sky, you against 1 to 4 enemies, full-screen view
  // ---------------------------------------------------------------------------
  const DF_SCALE = 14;                       // jets are drawn larger than life so they stay readable at range
  const TEAM_COL = ['#1d4ed8', '#dc2626'];   // you = blue, enemies = red
  const _v = new THREE.Vector3();

  function initDogfightArena() {
    const era = state.build.airframe.era;
    const others = Object.keys(P.PRESETS).filter((k) => k !== state.cfg.airframe);
    const sameEra = others.filter((k) => P.AIRFRAMES[k].era === era);
    const pool = (sameEra.length ? sameEra : others).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[r]] = [pool[r], pool[i]];
    }
    const enemies = [];
    for (let i = 0; i < state.dfEnemies; i++) enemies.push(P.PRESETS[pool[i % pool.length]]);
    state.dfMatch = Df.createMatch(state.build, enemies, { seed: Date.now() & 0x7fffffff, difficulty: 'topgun' });

    if (!state.dfScene) {
      // Sun, sky, forest, river, mountains and all combat effects live in af_arena.js
      state.dfArena = Arena.create(THREE, Df, Mdl, P, { envTexture, viewH: H });
      state.dfScene = state.dfArena.scene;
      state.dfCam = new THREE.PerspectiveCamera(50, W / H, 4, 100000);
    }
    for (const m3 of state.dfJets3d) { state.dfScene.remove(m3.root); disposeModel(m3.root); }
    state.dfJets3d = state.dfMatch.jets.map((j) => {
      const m3 = Mdl.buildAircraft3D(THREE, j.build, { showCfd: false });
      m3.root.scale.setScalar(DF_SCALE);
      m3.root.rotation.order = 'YXZ';
      state.dfScene.add(m3.root);
      return m3;
    });
    state.dfArena.reset();
    state.dfCamFwd = null;
  }

  function readPlayerFlightInput() {
    if (state.dfAutopilot) { state.dfCycle = false; return null; }
    const k = state.keys;
    const yawCmd = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
    const space = k.has('Space');
    const up = k.has('ArrowUp'), down = k.has('ArrowDown'), left = k.has('ArrowLeft'), right = k.has('ArrowRight');
    const inp = {
      pitchCmd: (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
      yawCmd,
      rollCmd: -yawCmd,
      throttleDelta: (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
      fireBvr: space && up,
      fireWvr: space && (left || right),
      dropFlare: (space && down) || k.has('KeyX'),
      fireGun: space && !up && !down && !left && !right,
      cycleTarget: state.dfCycle,
    };
    state.dfCycle = false;
    return inp;
  }

  function renderDogfightFrame(dt) {
    const m = state.dfMatch;
    if (!m) return;
    const inp = readPlayerFlightInput();
    const steps = Math.max(1, Math.min(4, Math.round(dt / Df.DT)));
    for (let i = 0; i < steps; i++) {
      Df.stepMatch(m, Df.DT, inp);
      if (inp) inp.cycleTarget = false;
    }

    const me = m.jets[0];
    const cockpit = state.dfCamMode === 'cockpit';
    m.jets.forEach((j, i) => {
      const m3 = state.dfJets3d[i];
      if (!m3) return;
      m3.root.visible = !j.gone && !(i === 0 && cockpit && j.hp > 0);   // destroyed jets fall as burning wrecks until they hit the ground
      m3.root.position.set(j.x, j.y, j.z);
      m3.root.rotation.set(-j.pitch, j.yaw, j.roll);
      m3.stepAnimation(state.time, { afterburner: j.afterburner, showCfd: false });
    });

    // Camera
    const cam = state.dfCam;
    const fwd = Df.forwardVec(me);
    if (!state.dfCamFwd) state.dfCamFwd = new THREE.Vector3(fwd.x, fwd.y, fwd.z);
    state.dfCamFwd.lerp(_v.set(fwd.x, fwd.y, fwd.z), Math.min(1, dt * 5)).normalize();
    const cf = state.dfCamFwd;
    if (cockpit) {
      cam.position.set(me.x + fwd.x * 26, me.y + 9 + fwd.y * 26, me.z + fwd.z * 26);
      cam.lookAt(me.x + fwd.x * 600, me.y + 9 + fwd.y * 600, me.z + fwd.z * 600);
    } else if (state.dfCamMode === 'tactical') {
      const alive = m.jets.filter((j) => j.hp > 0);
      let cx = 0, cy = 0, cz = 0;
      alive.forEach((j) => { cx += j.x; cy += j.y; cz += j.z; });
      cx /= alive.length || 1; cy /= alive.length || 1; cz /= alive.length || 1;
      let rad = 0;
      alive.forEach((j) => { rad = Math.max(rad, Math.hypot(j.x - cx, j.y - cy, j.z - cz)); });
      const d = Math.max(900, rad * 1.9);
      cam.position.set(cx + d * 0.55, cy + d * 0.6, cz - d * 0.6);
      cam.lookAt(cx, cy, cz);
    } else {
      cam.position.set(me.x - cf.x * 200, me.y + 58 - cf.y * 200, me.z - cf.z * 200);
      cam.lookAt(me.x + cf.x * 420, me.y + 12 + cf.y * 420, me.z + cf.z * 420);
    }
    const floorY = Math.max(0, Df.terrainHeight(cam.position.x, cam.position.z)) + 14;   // the camera never goes underground
    if (cam.position.y < floorY) cam.position.y = floorY;
    const sh = state.dfArena.shake;                                                      // nearby explosions shake the camera
    if (sh > 0.01) {
      cam.position.x += (Math.random() - 0.5) * sh * 16;
      cam.position.y += (Math.random() - 0.5) * sh * 16;
      cam.position.z += (Math.random() - 0.5) * sh * 16;
    }
    cam.updateMatrixWorld(true);
    state.dfArena.update(dt, m, state.dfJets3d, cam);
    renderer.render(state.dfScene, cam);
    drawArenaHud(m);
  }

  function drawArenaHud(m) {
    const g = hudCtx;
    g.clearRect(0, 0, W, H);
    const cam = state.dfCam;
    const me = m.jets[0];
    const MONO = '"JetBrains Mono", monospace';
    const FOCAL = (H * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
    const proj = (x, y, z) => {
      _v.set(x, y, z).project(cam);
      return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H, front: _v.z < 1 };
    };
    const camDist = (o) => Math.hypot(o.x - cam.position.x, o.y - cam.position.y, o.z - cam.position.z);
    const text = (str, x, y, color, font, align) => {
      g.font = font || `700 12px ${MONO}`;
      g.textAlign = align || 'left';
      g.lineJoin = 'round';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(8, 15, 30, 0.85)';
      g.strokeText(str, x, y);
      g.fillStyle = color;
      g.fillText(str, x, y);
    };
    const bar = (x, y, w, h, frac, color) => {
      g.fillStyle = 'rgba(8, 15, 30, 0.75)';
      g.fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle = color;
      g.fillRect(x, y, w * P.clamp(frac, 0, 1), h);
    };
    const panel = (x, y, w, h) => {
      g.fillStyle = 'rgba(8, 15, 30, 0.72)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(148, 163, 184, 0.5)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    };
    const fadingLine = (pts, color, width) => {
      if (pts.length < 2) return;
      g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
      let prev = proj(pts[0][0], pts[0][1], pts[0][2]);
      for (let k = 1; k < pts.length; k++) {
        const cur = proj(pts[k][0], pts[k][1], pts[k][2]);
        if (prev.front && cur.front) {
          g.globalAlpha = 0.12 + 0.68 * (k / pts.length);
          g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(cur.x, cur.y); g.stroke();
        }
        prev = cur;
      }
      g.globalAlpha = 1;
    };

    // Missiles, tracers, flares, smoke and explosions are drawn in 3D by af_arena.js.
    // Missiles heading for you also get a red warning diamond so they are easy to spot.
    m.missiles.forEach((ms) => {
      if (ms.target !== 0 || ms.spoofed) return;
      const p = proj(ms.x, ms.y, ms.z);
      if (!p.front) return;
      g.strokeStyle = '#ef4444'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(p.x, p.y - 12); g.lineTo(p.x + 12, p.y); g.lineTo(p.x, p.y + 12); g.lineTo(p.x - 12, p.y); g.closePath(); g.stroke();
    });

    // Aircraft markers: a box on every enemy in view, an arrow at the screen edge for every enemy out of view
    m.jets.forEach((j, i) => {
      if (j.hp <= 0) return;
      if (i === 0 && state.dfCamMode !== 'tactical') return;
      const col = TEAM_COL[j.team];
      const isTgt = i === me.target;
      const p = proj(j.x, j.y, j.z);
      const rangeKm = (Math.hypot(j.x - me.x, j.y - me.y, j.z - me.z) / 1000).toFixed(1);
      const onScreen = p.front && p.x > 40 && p.x < W - 40 && p.y > 135 && p.y < H - 40;
      if (onScreen) {
        const half = P.clamp((42 * FOCAL) / camDist(j), 18, 95);
        const cn = half * 0.4;
        g.strokeStyle = col; g.lineWidth = isTgt ? 3.5 : 2.5; g.lineCap = 'butt';
        g.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          g.moveTo(p.x + sx * half, p.y + sy * (half - cn));
          g.lineTo(p.x + sx * half, p.y + sy * half);
          g.lineTo(p.x + sx * (half - cn), p.y + sy * half);
        }
        g.stroke();
        text(i === 0 ? 'YOU' : `${j.name} · ${rangeKm} km`, p.x, p.y - half - 16, '#ffffff', `700 12px ${MONO}`, 'center');
        bar(p.x - 32, p.y - half - 10, 64, 5, j.hp / 100, col);
        if (isTgt) {
          const locked = me.lockProgress >= 1;
          g.strokeStyle = locked ? '#dc2626' : '#f59e0b'; g.lineWidth = 3;
          g.beginPath(); g.arc(p.x, p.y, half + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * me.lockProgress); g.stroke();
          text(locked ? 'LOCKED — FIRE' : 'TARGET', p.x, p.y + half + 26, locked ? '#fecaca' : '#fde68a', `800 13px ${MONO}`, 'center');
        }
      } else {
        _v.set(j.x, j.y, j.z).applyMatrix4(cam.matrixWorldInverse);
        let dx = _v.x, dy = -_v.y;
        const n = Math.hypot(dx, dy) || 1;
        dx /= n; dy /= n;
        const ax = W / 2 + dx * 420, ay = H / 2 + 40 + dy * 300;
        const ang = Math.atan2(dy, dx);
        g.save();
        g.translate(ax, ay); g.rotate(ang);
        g.fillStyle = col; g.strokeStyle = '#ffffff'; g.lineWidth = isTgt ? 3 : 1.5;
        g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -13); g.lineTo(-12, 13); g.closePath(); g.fill(); g.stroke();
        g.restore();
        text(`${i === 0 ? 'YOU' : 'ENEMY'} ${rangeKm} km`, ax - dx * 44, ay - dy * 44 + 4, '#ffffff', `700 11px ${MONO}`, 'center');
      }
    });

    // Gun sight: where your guns are pointing 800 m ahead
    if (state.dfCamMode !== 'tactical' && me.hp > 0) {
      const f = Df.forwardVec(me);
      const p = proj(me.x + f.x * 800, me.y + f.y * 800, me.z + f.z * 800);
      if (p.front) {
        g.strokeStyle = 'rgba(8, 15, 30, 0.8)'; g.lineWidth = 4;
        g.beginPath(); g.arc(p.x, p.y, 16, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = '#22c55e'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y, 16, 0, Math.PI * 2);
        g.moveTo(p.x - 28, p.y); g.lineTo(p.x - 16, p.y); g.moveTo(p.x + 16, p.y); g.lineTo(p.x + 28, p.y);
        g.moveTo(p.x, p.y - 28); g.lineTo(p.x, p.y - 16); g.stroke();
        g.fillStyle = '#22c55e'; g.beginPath(); g.arc(p.x, p.y, 2, 0, Math.PI * 2); g.fill();
      }
    }

    // Your aircraft status (bottom left)
    panel(24, H - 190, 330, 166);
    text('YOU · ' + me.name, 38, H - 166, '#93c5fd', `800 13px ${MONO}`);
    bar(38, H - 156, 300, 10, me.hp / 100, me.hp > 35 ? '#22c55e' : '#ef4444');
    text(`HULL ${Math.round(me.hp)}%`, 38, H - 128, '#ffffff');
    text(`${Math.round(me.speed * P.MS_TO_KT)} KT`, 150, H - 128, '#ffffff');
    text(`${Math.round(me.y * P.M_TO_FT).toLocaleString()} FT`, 240, H - 128, '#ffffff');
    text(`THROTTLE ${Math.round(me.throttle * 100)}%   G ${me.gLoad.toFixed(1)}`, 38, H - 106, '#cbd5e1');
    text(`GUN ${me.ammoGun}`, 38, H - 82, '#fde68a');
    text(`LONG-RANGE MSL ${me.mslBvr}`, 150, H - 82, '#fde68a');
    text(`SHORT-RANGE MSL ${me.mslWvr}`, 38, H - 60, '#fde68a');
    text(`FLARES ${me.flares}`, 240, H - 60, '#fde68a');
    text(`KILLS ${m.kills} / ${m.jets.length - 1}     TIME ${Math.max(0, Math.ceil(m.limit - m.t))} s`, 38, H - 38, '#ffffff');

    // Enemy list (top right)
    const enemies = m.jets.slice(1);
    panel(W - 354, 170, 330, 30 + enemies.length * 34);
    text(`ENEMIES · ${enemies.filter((j) => j.hp > 0).length} OF ${enemies.length} REMAINING`, W - 340, 190, '#fecaca', `800 12px ${MONO}`);
    enemies.forEach((j, k) => {
      const y = 212 + k * 34;
      const dead = j.hp <= 0;
      text(`${j.idx === me.target && !dead ? '▶ ' : ''}${j.name}`.slice(0, 34), W - 340, y, dead ? '#64748b' : '#ffffff', `700 11px ${MONO}`);
      if (dead) text('DESTROYED', W - 38, y, '#64748b', `700 11px ${MONO}`, 'right');
      else bar(W - 340, y + 6, 302, 6, j.hp / 100, '#dc2626');
    });

    // Radar (bottom right): you at the centre facing up, 4 km range
    const rx = W - 124, ry = H - 124, rr = 100, sc = rr / 4000;
    g.fillStyle = 'rgba(8, 15, 30, 0.72)';
    g.beginPath(); g.arc(rx, ry, rr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(148, 163, 184, 0.55)'; g.lineWidth = 1;
    g.beginPath(); g.arc(rx, ry, rr, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(rx, ry, rr * 0.5, 0, Math.PI * 2); g.stroke();
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const toRadar = (o) => {
      const dx = o.x - me.x, dz = o.z - me.z;
      let px = -(dx * cy - dz * sy) * sc, py = -(dx * sy + dz * cy) * sc;
      const n = Math.hypot(px, py);
      if (n > rr - 6) { px *= (rr - 6) / n; py *= (rr - 6) / n; }
      return [rx + px, ry + py];
    };
    m.missiles.forEach((ms) => { const [x, y] = toRadar(ms); g.fillStyle = '#ffffff'; g.fillRect(x - 1.5, y - 1.5, 3, 3); });
    enemies.forEach((j) => {
      if (j.hp <= 0) return;
      const [x, y] = toRadar(j);
      g.fillStyle = '#ef4444'; g.beginPath(); g.arc(x, y, j.idx === me.target ? 6 : 4.5, 0, Math.PI * 2); g.fill();
      if (j.idx === me.target) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke(); }
    });
    g.fillStyle = '#60a5fa';
    g.beginPath(); g.moveTo(rx, ry - 9); g.lineTo(rx - 6, ry + 6); g.lineTo(rx + 6, ry + 6); g.closePath(); g.fill();
    text('RADAR 4 KM', rx, ry - rr - 8, '#ffffff', `700 11px ${MONO}`, 'center');

    // Warnings and messages
    const incoming = m.missiles.some((ms) => ms.target === 0 && !ms.spoofed);
    if (incoming && me.hp > 0 && Math.floor(state.time * 4) % 2 === 0) {
      text('MISSILE INBOUND — DROP FLARES (SPACE + ↓)', W / 2, H - 150, '#fecaca', `800 20px ${MONO}`, 'center');
    }
    if (Math.abs(me.x) > Df.ARENA * 0.9 || Math.abs(me.z) > Df.ARENA * 0.9) {
      text('LEAVING COMBAT AREA — TURN BACK', W / 2, H - 185, '#fde68a', `800 18px ${MONO}`, 'center');
    }
    const agl = me.y - Math.max(0, Df.terrainHeight(me.x, me.z));
    if (!state.dfAutopilot && me.hp > 0 && agl < 260 && Math.floor(state.time * 5) % 2 === 0) {
      text('PULL UP', W / 2, H / 2 + 130, '#fca5a5', `900 30px ${MONO}`, 'center');
    }
    if (state.dfAutopilot && !m.over) {
      text('AUTOPILOT IS FLYING — PRESS W, A, S OR D TO TAKE CONTROL', W / 2, H - 46, '#ffffff', `700 14px ${MONO}`, 'center');
    }
    if (m.events.length) {
      const ev = m.events[m.events.length - 1];
      if (m.t - ev.t < 3) text(ev.text, W / 2, 196, '#ffffff', `800 17px ${MONO}`, 'center');
    }
    if (m.over) {
      g.fillStyle = 'rgba(8, 15, 30, 0.55)';
      g.fillRect(0, H / 2 - 90, W, 150);
      text(m.winner === 0 ? 'MISSION COMPLETE' : 'MISSION FAILED', W / 2, H / 2 - 28, m.winner === 0 ? '#86efac' : '#fca5a5', '900 44px Inter, sans-serif', 'center');
      text(m.reason, W / 2, H / 2 + 10, '#ffffff', `700 18px ${MONO}`, 'center');
      text('PRESS "NEW SORTIE" TO FLY AGAIN', W / 2, H / 2 + 40, '#cbd5e1', `700 13px ${MONO}`, 'center');
    }
    g.textAlign = 'left';
  }

  // ---------------------------------------------------------------------------
  // 6. EVENT LISTENERS
  // ---------------------------------------------------------------------------
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('cad-toolbar').style.display = mode === 'dogfight' ? 'none' : 'flex';
    $('dogfight-bar').style.display = mode === 'dogfight' ? 'flex' : 'none';
    // The arena uses the whole screen: the design panels are hidden while you fly
    document.querySelectorAll('.side-panel, .center-bottom').forEach((el) => { el.style.display = mode === 'dogfight' ? 'none' : ''; });
    hudCtx.clearRect(0, 0, W, H);

    if (mode === 'teardown') {
      state.teardown = Math.max(0.78, state.teardown);
      state.xray = true;
      state.showLabels = true;
      $('btn-xray').classList.add('on');
      $('btn-labels').classList.add('on');
      $('teardown-slider').value = String(state.teardown);
      $('teardown-val').textContent = `${Math.round(state.teardown * 100)}%`;
      rebuildAircraft();
    } else if (mode === 'cfd') {
      state.showCfd = true;
      state.xray = false;
      state.showLabels = false;
      state.teardown = 0;
      state.subTab = 'tunnel';
      $('btn-cfd').classList.add('on');
      $('btn-xray').classList.remove('on');
      $('btn-labels').classList.remove('on');
      $('teardown-slider').value = '0';
      $('teardown-val').textContent = '0%';
      rebuildAircraft();
    } else if (mode === 'dogfight') {
      initDogfightArena();
    } else {
      state.showCfd = false;
      state.xray = false;
      state.showLabels = false;
      state.teardown = 0;
      $('btn-cfd').classList.remove('on');
      $('btn-xray').classList.remove('on');
      $('btn-labels').classList.remove('on');
      $('teardown-slider').value = '0';
      $('teardown-val').textContent = '0%';
      rebuildAircraft();
    }
    document.querySelectorAll('.sub-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.subTab));
  }

  function applyAirframePreset(afId) {
    if (!P.PRESETS[afId]) return;
    state.activePreset = afId;
    state.cfg = JSON.parse(JSON.stringify(P.PRESETS[afId]));
    rebuildAircraft();
    if (state.mode === 'dogfight') initDogfightArena();
  }

  document.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('.mode-tab');
    if (modeBtn) return setMode(modeBtn.dataset.mode);

    const subBtn = e.target.closest('.sub-tab');
    if (subBtn) {
      state.subTab = subBtn.dataset.tab;
      document.querySelectorAll('.sub-tab').forEach((b) => b.classList.toggle('active', b === subBtn));
      return renderLeftPanel();
    }

    const natBtn = e.target.closest('[data-nation]');
    if (natBtn) { state.nationFilter = natBtn.dataset.nation; renderPresetStrip(); return renderLeftPanel(); }

    const eraBtn = e.target.closest('[data-era]');
    if (eraBtn) { state.eraFilter = eraBtn.dataset.era; renderPresetStrip(); return renderLeftPanel(); }

    const presetBtn = e.target.closest('[data-preset]');
    if (presetBtn) return applyAirframePreset(presetBtn.dataset.preset);

    const afCard = e.target.closest('[data-pick-af]');
    if (afCard) return applyAirframePreset(afCard.dataset.pickAf);

    const keyCard = e.target.closest('[data-pick-key]');
    if (keyCard) {
      state.cfg[keyCard.dataset.pickKey] = keyCard.dataset.val;
      return rebuildAircraft();
    }

    const dfnBtn = e.target.closest('[data-dfn]');
    if (dfnBtn) {
      state.dfEnemies = parseInt(dfnBtn.dataset.dfn, 10) || 2;
      document.querySelectorAll('[data-dfn]').forEach((b) => b.classList.toggle('on', b === dfnBtn));
      return initDogfightArena();
    }

    const dfCamBtn = e.target.closest('[data-dfcam]');
    if (dfCamBtn) {
      state.dfCamMode = dfCamBtn.dataset.dfcam;
      document.querySelectorAll('[data-dfcam]').forEach((b) => b.classList.toggle('on', b === dfCamBtn));
    }
    return undefined;
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'teardown-slider') {
      state.teardown = parseFloat(t.value) || 0;
      $('teardown-val').textContent = `${Math.round(state.teardown * 100)}%`;
      if (state.model3d) state.model3d.setTeardown(state.teardown);
      return;
    }
    if (t.dataset.range) {
      state.cfg[t.dataset.range] = parseFloat(t.value);
      rebuildAircraft();
      return;
    }
    if (t.id === 'inp-name') {
      state.cfg.name = t.value.toUpperCase();
      updateUI();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.selectKey) {
      state.cfg[t.dataset.selectKey] = t.value;
      rebuildAircraft();
    } else if (t.dataset.station) {
      state.cfg.stations[t.dataset.station] = t.value;
      rebuildAircraft();
    }
  });

  $('btn-xray').addEventListener('click', () => {
    state.xray = !state.xray;
    $('btn-xray').classList.toggle('on', state.xray);
    rebuildAircraft();
  });
  $('btn-labels').addEventListener('click', () => {
    state.showLabels = !state.showLabels;
    $('btn-labels').classList.toggle('on', state.showLabels);
  });
  $('btn-cfd').addEventListener('click', () => {
    state.showCfd = !state.showCfd;
    $('btn-cfd').classList.toggle('on', state.showCfd);
    rebuildAircraft();
  });
  $('btn-ab').addEventListener('click', () => {
    state.cfg.afterburner = !state.cfg.afterburner;
    $('btn-ab').classList.toggle('on', state.cfg.afterburner);
    rebuildAircraft();
  });
  $('btn-spin').addEventListener('click', () => {
    state.turntable = !state.turntable;
    $('btn-spin').classList.toggle('on', state.turntable);
  });
  $('btn-launch-dogfight').addEventListener('click', () => setMode('dogfight'));
  $('btn-df-restart').addEventListener('click', () => initDogfightArena());
  $('btn-df-autopilot').addEventListener('click', () => {
    state.dfAutopilot = !state.dfAutopilot;
    $('btn-df-autopilot').classList.toggle('on', state.dfAutopilot);
    $('btn-df-autopilot').textContent = state.dfAutopilot ? 'AUTOPILOT: ON' : 'AUTOPILOT: OFF — YOU FLY';
  });
  $('btn-random').addEventListener('click', () => {
    const keys = Object.keys(P.PRESETS);
    applyAirframePreset(keys[Math.floor(Math.random() * keys.length)]);
  });

  // Orbit Camera Mouse Controls
  let dragging = null;
  glCanvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || state.mode === 'dogfight') return;
    state.orbit.az -= (e.clientX - dragging.x) * 0.006;
    state.orbit.el = P.clamp(state.orbit.el + (e.clientY - dragging.y) * 0.005, 0.05, 1.35);
    dragging = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => { dragging = null; });
  glCanvas.addEventListener('wheel', (e) => {
    if (state.mode === 'dogfight') return;
    state.orbit.dist = P.clamp(state.orbit.dist * Math.exp(e.deltaY * 0.001), 4.0, 18.0);
  });

  window.addEventListener('keydown', (e) => {
    state.keys.add(e.code);
    if (state.mode === 'dogfight') {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if ((e.code === 'KeyT' || e.code === 'Tab') && !e.repeat) state.dfCycle = true;
    }
    if (state.mode === 'dogfight' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      state.dfAutopilot = false;
      $('btn-df-autopilot').classList.remove('on');
      $('btn-df-autopilot').textContent = 'AUTOPILOT: OFF — YOU FLY';
    }
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));

  // Handle for automated visual checks: lets a test script fast-forward the arena without waiting for rendered frames
  window.AFDebug = {
    state, Df,
    advance(seconds) {
      const m = state.dfMatch;
      for (let n = Math.round(seconds * 60); n > 0; n--) {
        Df.stepMatch(m, Df.DT, null);
        m.jets.forEach((j, i) => {
          const m3 = state.dfJets3d[i];
          m3.root.visible = !j.gone;
          m3.root.position.set(j.x, j.y, j.z);
          m3.root.rotation.set(-j.pitch, j.yaw, j.roll);
        });
        state.dfArena.update(Df.DT, m, state.dfJets3d, state.dfCam);
      }
      state.dfCamFwd = null;
    },
  };
  rebuildAircraft();
  let lastMs = performance.now();

  function tick(nowMs) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastMs) * 0.001));
    lastMs = nowMs;
    state.time += dt;

    if (state.mode === 'dogfight') {
      renderDogfightFrame(dt);
      return;
    }

    if (state.turntable && !dragging) state.orbit.az += dt * 0.30;
    if (state.model3d) {
      state.model3d.stepAnimation(state.time, { afterburner: state.cfg.afterburner, showCfd: state.showCfd });
    }

    const r = state.orbit.dist * (1 + state.teardown * 0.38);
    studioCam.position.set(
      r * Math.cos(state.orbit.el) * Math.sin(state.orbit.az),
      r * Math.sin(state.orbit.el),
      r * Math.cos(state.orbit.el) * Math.cos(state.orbit.az)
    );
    studioCam.lookAt(0, 0, 0);
    studioCam.updateMatrixWorld(true);
    renderer.render(studioScene, studioCam);
    drawSubPartCallouts();
  }
  requestAnimationFrame(tick);
})();
