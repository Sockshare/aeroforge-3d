/**
 * AeroForge 3D — arena environment and combat effects.
 *
 * Builds the dogfight world (sun, sky, clouds, forested terrain with a river and a mountain range)
 * from the terrain function shared with the simulation, and draws every combat effect in 3D:
 * missiles with exhaust flame and smoke trails, tracer rounds, flares, wing-tip vapour, damage smoke,
 * burning wrecks, fireballs, shockwaves, sparks, debris, dust, scorch marks and smoke columns.
 *
 * The only downloaded asset is static/assets/terrain_detail.jpg (Poly Haven, CC0), used as ground detail.
 */
(function (root) {
  'use strict';

  function create(THREE, Df, Mdl, P, opts) {
    opts = opts || {};
    const HAS_DOM = typeof document !== 'undefined';
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const lerp = (a, b, t) => a + (b - a) * t;
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

    const scene = new THREE.Scene();
    const HAZE = new THREE.Color('#c9d9e6');
    scene.fog = new THREE.Fog(HAZE.getHex(), 3500, 19000);
    if (opts.envTexture) scene.environment = opts.envTexture;

    // ---- Sun and sky ----
    const sunDir = new THREE.Vector3(-0.511, 0.407, 0.757).normalize();   // ahead and to the left of the starting heading
    scene.add(new THREE.HemisphereLight('#dfeeff', '#6f7f5f', 0.8));
    const sunLight = new THREE.DirectionalLight('#fff1d6', 1.65);
    sunLight.position.copy(sunDir).multiplyScalar(1000);
    scene.add(sunLight);

    const skyGeo = new THREE.SphereGeometry(45000, 32, 20);
    {
      const cols = [], top = new THREE.Color('#2f77cf'), warm = new THREE.Color('#ffe9c4'), c = new THREE.Color();
      const pos = skyGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        const t = clamp(_v.y, 0, 1);
        c.copy(HAZE).lerp(top, Math.pow(t, 0.55));
        c.lerp(warm, Math.pow(Math.max(0, _v.dot(sunDir)), 6) * 0.65);
        cols.push(c.r, c.g, c.b);
      }
      skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    }
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -5;
    sky.frustumCulled = false;
    scene.add(sky);

    function canvasTexture(size, draw) {
      if (!HAS_DOM) return null;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      draw(cv.getContext('2d'), size);
      return new THREE.CanvasTexture(cv);
    }
    const glowTex = canvasTexture(256, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.08, 'rgba(255,252,235,1)');
      gr.addColorStop(0.16, 'rgba(255,236,180,0.55)');
      gr.addColorStop(0.45, 'rgba(255,220,150,0.14)');
      gr.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    const cloudTex = canvasTexture(256, (g, s) => {
      let seed = 11;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 26; i++) {
        const x = s * (0.18 + r() * 0.64), y = s * (0.38 + r() * 0.26), rad = s * (0.1 + r() * 0.14);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
    });

    let sunSprite = null;
    if (glowTex) {
      sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sunSprite.scale.set(15000, 15000, 1);
      scene.add(sunSprite);
    }
    if (cloudTex) {
      const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false });
      let seed = 5;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 34; i++) {
        const sp = new THREE.Sprite(cloudMat);
        const w = 2600 + r() * 3200;
        sp.position.set((r() - 0.5) * 30000, 6900 + r() * 1900, (r() - 0.5) * 30000);
        sp.scale.set(w, w * 0.5, 1);
        scene.add(sp);
      }
    }

    // ---- Terrain: forest floor, meadows, rock, snow caps, river bed ----
    const SIZE = 22000, N = 180, HALF = SIZE / 2, STEP = SIZE / N, N1 = N + 1;
    const renderHeight = (x, z) => {
      const e = sstep(9600, 10800, Math.hypot(x, z));   // beyond the far mountains the land flattens into the haze
      return Df.terrainHeight(x, z) * (1 - e) + 20 * e;
    };
    {
      const pos = new Float32Array(N1 * N1 * 3), col = new Float32Array(N1 * N1 * 3), uv = new Float32Array(N1 * N1 * 2);
      const hs = new Float32Array(N1 * N1);
      for (let iz = 0; iz < N1; iz++) for (let ix = 0; ix < N1; ix++) hs[iz * N1 + ix] = renderHeight(-HALF + ix * STEP, -HALF + iz * STEP);
      const mix = (a, b, t, out) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); };
      const FOREST = [0.13, 0.25, 0.10], MEADOW = [0.37, 0.45, 0.18], ROCK = [0.43, 0.41, 0.37], SNOW = [0.95, 0.96, 1.0], SAND = [0.56, 0.51, 0.35], BED = [0.16, 0.25, 0.25];
      const c = [0, 0, 0];
      for (let iz = 0; iz < N1; iz++) {
        for (let ix = 0; ix < N1; ix++) {
          const i = iz * N1 + ix, x = -HALF + ix * STEP, z = -HALF + iz * STEP, h = hs[i];
          const hx = hs[iz * N1 + Math.min(N, ix + 1)] - hs[iz * N1 + Math.max(0, ix - 1)];
          const hz = hs[Math.min(N, iz + 1) * N1 + ix] - hs[Math.max(0, iz - 1) * N1 + ix];
          const slope = Math.hypot(hx, hz) / (2 * STEP);
          const dens = Df.forestDensity(x, z);
          mix(MEADOW, FOREST, sstep(0.42, 0.55, dens), c);
          mix(c, ROCK, Math.max(sstep(0.45, 0.85, slope), sstep(760, 900, h)), c);
          mix(c, SNOW, sstep(980, 1180, h + (dens - 0.5) * 300) * (1 - sstep(0.9, 1.4, slope)), c);
          mix(c, SAND, 1 - sstep(4, 22, h), c);
          mix(c, BED, 1 - sstep(-6, 2, h), c);
          const v = 0.9 + 0.2 * Df.forestDensity(x * 3.1 + 500, z * 3.1 - 300);
          pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
          col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v;
          uv[i * 2] = x / 650; uv[i * 2 + 1] = z / 650;
        }
      }
      const idx = new Uint16Array(N * N * 6);
      let k = 0;
      for (let iz = 0; iz < N; iz++) {
        for (let ix = 0; ix < N; ix++) {
          const a = iz * N1 + ix, b = a + 1, cI = a + N1, d = cI + 1;
          idx[k++] = a; idx[k++] = cI; idx[k++] = b;
          idx[k++] = b; idx[k++] = cI; idx[k++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 });
      // The detail photo modulates brightness at two scales (so it never visibly tiles) instead of replacing the terrain colours
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', [
          '#ifdef USE_MAP',
          '  float dLum = dot( texture2D( map, vUv ).rgb, vec3( 0.3333 ) );',
          '  float fLum = dot( texture2D( map, vUv * 0.11 ).rgb, vec3( 0.3333 ) );',
          '  diffuseColor.rgb *= clamp( 0.5 + 1.4 * dLum, 0.45, 1.6 ) * clamp( 0.65 + 1.0 * fLum, 0.6, 1.5 );',
          '#endif',
        ].join('\n'));
      };
      if (HAS_DOM) {
        new THREE.TextureLoader().load('/static/assets/terrain_detail.jpg', (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 4;
          mat.map = tex;
          mat.needsUpdate = true;
        }, undefined, () => { /* the terrain still renders with its vertex colours */ });
      }
      scene.add(new THREE.Mesh(geo, mat));
    }

    // River water (visible wherever the terrain dips below y = 0) and a far ground skirt under the haze
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ color: '#2a6a9e', roughness: 0.16, metalness: 0.35, envMapIntensity: 1.1 }));
    water.rotation.x = -Math.PI / 2;
    scene.add(water);
    const skirt = new THREE.Mesh(new THREE.RingGeometry(10700, 95000, 48), new THREE.MeshBasicMaterial({ color: '#4f6b45', side: THREE.DoubleSide }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = 19;
    scene.add(skirt);

    // ---- Forest: instanced conifers placed where the forest-density function is high ----
    let treeCount = 0;
    {
      const MAX = 16000, CELL = 62, R = 5700;
      const geo = new THREE.ConeGeometry(1, 1, 6, 1, true);
      geo.translate(0, 0.5, 0);
      const trees = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), MAX);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
      let seed = 99;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let gz = -R; gz < R && treeCount < MAX; gz += CELL) {
        for (let gx = -R; gx < R && treeCount < MAX; gx += CELL) {
          const x = gx + r() * CELL, z = gz + r() * CELL, keep = r(), sz = r(), tint = r();
          const dens = Df.forestDensity(x, z);
          if (keep > sstep(0.44, 0.6, dens)) continue;
          const h = Df.terrainHeight(x, z);
          if (h < 8 || h > 830) continue;
          const slope = Math.abs(Df.terrainHeight(x + 40, z) - h) / 40 + Math.abs(Df.terrainHeight(x, z + 40) - h) / 40;
          if (slope > 0.9) continue;
          const tall = 46 + sz * 38;
          p.set(x, h - 2, z);
          s.set(tall * 0.34, tall, tall * 0.34);
          mtx.compose(p, q, s);
          trees.setMatrixAt(treeCount, mtx);
          c.setRGB(0.07 + tint * 0.07, 0.19 + tint * 0.13, 0.06 + tint * 0.05);
          trees.setColorAt(treeCount, c);
          treeCount++;
        }
      }
      trees.count = treeCount;
      trees.instanceMatrix.needsUpdate = true;
      if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
      trees.frustumCulled = false;
      scene.add(trees);
    }

    // ---- Particles ----
    function makeParticles(max, order) {
      const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
      const st = new Float32Array(max * 16); // vx vy vz life maxLife s0 s1 r0 g0 b0 r1 g1 b1 a0 drag grav
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 965 } },
        vertexShader: [
          'attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;',
          'void main() {',
          '  vColor = aColor;',
          '  vec4 mv = modelViewMatrix * vec4( position, 1.0 );',
          '  gl_Position = projectionMatrix * mv;',
          '  gl_PointSize = clamp( aSize * uScale / max( 1.0, -mv.z ), 0.0, 1024.0 );',
          '}',
        ].join('\n'),
        fragmentShader: [
          'varying vec4 vColor;',
          'void main() {',
          '  float d = length( gl_PointCoord - 0.5 ) * 2.0;',
          '  float a = smoothstep( 1.0, 0.3, d ) * vColor.a;',
          '  if ( a < 0.004 ) discard;',
          '  gl_FragColor = vec4( vColor.rgb, a );',
          '}',
        ].join('\n'),
        transparent: true, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = order;
      scene.add(pts);
      let head = 0;
      function emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, drag, grav) {
        const i = head; head = (head + 1) % max;
        const o = i * 16;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        st[o] = vx; st[o + 1] = vy; st[o + 2] = vz; st[o + 3] = life; st[o + 4] = life; st[o + 5] = s0; st[o + 6] = s1;
        st[o + 7] = c0[0]; st[o + 8] = c0[1]; st[o + 9] = c0[2]; st[o + 10] = c1[0]; st[o + 11] = c1[1]; st[o + 12] = c1[2];
        st[o + 13] = a0; st[o + 14] = drag || 0; st[o + 15] = grav || 0;
        size[i] = s0; col[i * 4 + 3] = 0;
      }
      function update(dt) {
        for (let i = 0; i < max; i++) {
          const o = i * 16;
          let life = st[o + 3];
          if (life <= 0) continue;
          life -= dt;
          if (life <= 0) { st[o + 3] = 0; size[i] = 0; col[i * 4 + 3] = 0; continue; }
          st[o + 3] = life;
          const k = Math.max(0, 1 - st[o + 14] * dt);
          st[o] *= k; st[o + 1] = st[o + 1] * k + st[o + 15] * dt; st[o + 2] *= k;
          pos[i * 3] += st[o] * dt; pos[i * 3 + 1] += st[o + 1] * dt; pos[i * 3 + 2] += st[o + 2] * dt;
          const t = 1 - life / st[o + 4];
          size[i] = st[o + 5] + (st[o + 6] - st[o + 5]) * Math.sqrt(t);
          col[i * 4] = st[o + 7] + (st[o + 10] - st[o + 7]) * t;
          col[i * 4 + 1] = st[o + 8] + (st[o + 11] - st[o + 8]) * t;
          col[i * 4 + 2] = st[o + 9] + (st[o + 12] - st[o + 9]) * t;
          col[i * 4 + 3] = st[o + 13] * Math.min(1, t * 10) * Math.pow(1 - t, 1.3);
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
      }
      function clear() { st.fill(0); size.fill(0); col.fill(0); }
      return { emit, update, clear, mat };
    }
    const smoke = makeParticles(4500, 5);
    const fire = makeParticles(2500, 6);

    const C = {
      white: [0.96, 0.96, 0.96], pale: [0.82, 0.83, 0.85], grey: [0.5, 0.5, 0.52], dark: [0.16, 0.15, 0.15], black: [0.05, 0.05, 0.05],
      dust: [0.55, 0.47, 0.34], dustPale: [0.7, 0.64, 0.52],
      hot: [1.0, 0.97, 0.8], yellow: [1.0, 0.82, 0.3], orange: [1.0, 0.5, 0.1], red: [0.6, 0.14, 0.04], ember: [0.25, 0.08, 0.04],
    };
    const puff = (x, y, z, sp, life, s0, s1, c0, c1, a, up) =>
      smoke.emit(x, y, z, rnd(-sp, sp), rnd(-sp, sp) + (up || 0), rnd(-sp, sp), life, s0, s1, c0, c1, a, 0.8, 0);
    const flame = (x, y, z, sp, life, s0, s1, c0, c1, a) =>
      fire.emit(x, y, z, rnd(-sp, sp), rnd(-sp, sp), rnd(-sp, sp), life, s0, s1, c0, c1, a, 1.5, 0);

    // ---- Pooled meshes: tracers, fireballs, shockwave rings, flashes, debris, scorch marks ----
    const pool = (n, make) => { const a = []; for (let i = 0; i < n; i++) { const o = make(i); o.visible = false; scene.add(o); a.push(o); } return a; };
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = [new THREE.MeshBasicMaterial({ color: '#fff3b0', fog: false, toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#ffb46b', fog: false, toneMapped: false })];
    const tracers = pool(140, () => new THREE.Mesh(tracerGeo, tracerMat[0]));

    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    const balls = pool(10, () => new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, depthWrite: false, fog: false, toneMapped: false })));
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    const rings = pool(6, () => new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })));
    const flashes = glowTex ? pool(6, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false }))) : [];
    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    const debrisMat = new THREE.MeshStandardMaterial({ color: '#3b4048', roughness: 0.7, metalness: 0.5 });
    const debris = pool(36, () => new THREE.Mesh(debrisGeo, debrisMat));
    const scorchGeo = new THREE.CircleGeometry(1, 20);
    scorchGeo.rotateX(-Math.PI / 2);
    const scorches = pool(8, () => new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ color: '#17140f', transparent: true, opacity: 0.7, depthWrite: false })));
    let ballI = 0, ringI = 0, flashI = 0, debrisI = 0, scorchI = 0;

    const missileMeshes = new Map();
    function dropMissile(mesh) {
      scene.remove(mesh);
      mesh.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
    }
    const columns = [];
    const acc = [];           // per-jet emission accumulators
    const api = { scene, sunDir, shake: 0, treeCount };

    function explosion(x, y, z, r, ground, big, cam) {
      const b = balls[ballI++ % balls.length];
      b.visible = true; b.position.set(x, y, z); b.userData = { t: 0, life: big ? 0.6 : 0.42, r };
      if (flashes.length) {
        const f = flashes[flashI++ % flashes.length];
        f.visible = true; f.position.set(x, y, z); f.userData = { t: 0, life: 0.22, r };
      }
      if (big || ground) {
        const g = rings[ringI++ % rings.length];
        g.visible = true; g.position.set(x, y + (ground ? 8 : 0), z); g.userData = { t: 0, life: 0.7, r, ground };
        if (ground) g.rotation.set(-Math.PI / 2, 0, 0); else if (cam) g.lookAt(cam.position);
      }
      const nFire = big ? 44 : 20, nSmoke = big ? 40 : 16, nSpark = big ? 34 : 14;
      for (let i = 0; i < nFire; i++) {
        _v.set(rnd(-1, 1), rnd(ground ? 0 : -1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.2, 1.1) * r);
        fire.emit(x + _v.x * 0.2, y + _v.y * 0.2, z + _v.z * 0.2, _v.x, _v.y + (ground ? r * 0.4 : 0), _v.z, rnd(0.45, 1.0), r * 0.35, r * rnd(0.8, 1.3), i % 3 ? C.yellow : C.hot, C.red, 0.95, 2.2, 0);
      }
      for (let i = 0; i < nSmoke; i++) {
        _v.set(rnd(-1, 1), rnd(ground ? 0 : -1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.15, 0.7) * r);
        smoke.emit(x + _v.x * 0.3, y + _v.y * 0.3, z + _v.z * 0.3, _v.x, _v.y + 10, _v.z, rnd(3, 6.5), r * 0.5, r * rnd(1.6, 2.6), C.dark, C.grey, 0.75, 1.0, 0);
      }
      for (let i = 0; i < nSpark; i++) {
        _v.set(rnd(-1, 1), rnd(ground ? 0.1 : -1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(1.2, 3.2) * r);
        fire.emit(x, y, z, _v.x, _v.y, _v.z, rnd(0.7, 1.6), r * 0.09, r * 0.03, C.hot, C.orange, 1.0, 0.6, -60);
      }
      if (big) {
        for (let i = 0; i < 9; i++) {
          const d = debris[debrisI++ % debris.length];
          d.visible = true; d.position.set(x, y, z);
          d.scale.set(rnd(4, 11), rnd(1, 3.5), rnd(6, 16));
          _v.set(rnd(-1, 1), rnd(ground ? 0.3 : -0.6, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(60, 170));
          d.userData = { vx: _v.x, vy: _v.y, vz: _v.z, sx: rnd(-6, 6), sy: rnd(-6, 6), sz: rnd(-6, 6), life: rnd(3, 5.5), acc: 0 };
        }
      }
      if (ground) {
        for (let i = 0; i < 26; i++) {
          const a = rnd(0, Math.PI * 2), sp = rnd(0.4, 1.4) * r;
          smoke.emit(x, y + 4, z, Math.cos(a) * sp, rnd(10, 0.6 * r), Math.sin(a) * sp, rnd(2.5, 5), r * 0.3, r * rnd(1.2, 2.2), C.dust, C.dustPale, 0.7, 1.4, -6);
        }
        const s = scorches[scorchI++ % scorches.length];
        s.visible = true; s.position.set(x, Math.max(0, Df.terrainHeight(x, z)) + 7, z); s.scale.setScalar(r * 0.75);
        if (big) { columns.push({ x, y: y + 6, z, t: 26, acc: 0 }); if (columns.length > 6) columns.shift(); }
      }
      if (cam) api.shake = Math.max(api.shake, clamp((r * 6) / Math.max(60, cam.position.distanceTo(_v.set(x, y, z))), 0, 1));
    }

    function handleFx(f, jets3d, cam) {
      if (f.type === 'explosion') explosion(f.x, f.y, f.z, f.r, f.ground, f.big, cam);
      else if (f.type === 'hit') {
        for (let i = 0; i < 7; i++) fire.emit(f.x, f.y, f.z, rnd(-90, 90), rnd(-90, 90), rnd(-90, 90), rnd(0.25, 0.6), 7, 2, C.hot, C.orange, 1, 1.5, -40);
        puff(f.x, f.y, f.z, 12, 1.2, 10, 34, C.grey, C.pale, 0.5);
      } else if (f.type === 'dust') {
        for (let i = 0; i < 3; i++) smoke.emit(f.x, f.y + 3, f.z, rnd(-10, 10), rnd(18, 45), rnd(-10, 10), rnd(1.0, 1.8), 8, 34, C.dust, C.dustPale, 0.6, 1.5, -10);
      } else if (f.type === 'muzzle') {
        const m3 = jets3d[f.idx];
        if (!m3) return;
        m3.root.localToWorld(_v.set(0, 0, m3.scaleLength * 0.52));
        flame(_v.x, _v.y, _v.z, 8, 0.07, 16, 9, C.hot, C.orange, 0.95);
      }
    }

    function reset() {
      smoke.clear(); fire.clear();
      for (const a of [tracers, balls, rings, flashes, debris, scorches]) for (const o of a) o.visible = false;
      missileMeshes.forEach((mesh) => dropMissile(mesh));
      missileMeshes.clear();
      columns.length = 0; acc.length = 0;
      api.shake = 0;
    }

    function update(dt, m, jets3d, cam) {
      // Sky, sun and the far ground follow the camera
      sky.position.copy(cam.position);
      if (sunSprite) sunSprite.position.copy(cam.position).addScaledVector(sunDir, 40000);
      const uScale = (opts.viewH || 900) / (2 * Math.tan((cam.fov * Math.PI) / 360));
      smoke.mat.uniforms.uScale.value = uScale;
      fire.mat.uniforms.uScale.value = uScale;
      api.shake *= Math.exp(-5 * dt);

      for (const m3 of jets3d) if (m3) m3.root.updateMatrixWorld(true);
      for (const f of m.fx) handleFx(f, jets3d, cam);
      m.fx.length = 0;

      // Tracer rounds: glowing streaks aligned with each round's velocity
      for (let i = 0; i < tracers.length; i++) {
        const t = tracers[i], b = m.bullets[i];
        if (!b) { t.visible = false; continue; }
        t.visible = true;
        t.material = tracerMat[b.team ? 1 : 0];
        t.position.set(b.x, b.y, b.z);
        t.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
        t.scale.set(0.6, 0.6, 42);
      }

      // Missiles: a 3D missile with a bright motor flame and a thick white smoke trail while the motor burns
      const seen = new Set();
      for (const ms of m.missiles) {
        seen.add(ms);
        let mesh = missileMeshes.get(ms);
        if (!mesh) {
          mesh = Mdl.buildStore3D(THREE, ms.kind === 'bvr' ? 'bvr_msl' : 'wvr_msl', 1).group;
          mesh.scale.setScalar(ms.kind === 'bvr' ? 24 : 20);
          mesh.userData = { lx: ms.x, ly: ms.y, lz: ms.z, acc: 0 };
          scene.add(mesh);
          missileMeshes.set(ms, mesh);
        }
        mesh.position.set(ms.x, ms.y, ms.z);
        mesh.lookAt(ms.x + ms.dx, ms.y + ms.dy, ms.z + ms.dz);
        const ud = mesh.userData;
        if (ms.burning) {
          const tx = ms.x - ms.dx * 13, ty = ms.y - ms.dy * 13, tz = ms.z - ms.dz * 13;
          flame(tx, ty, tz, 3, 0.09, 26, 12, C.hot, C.orange, 1.0);
          flame(tx - ms.dx * 14, ty - ms.dy * 14, tz - ms.dz * 14, 4, 0.12, 16, 6, C.yellow, C.red, 0.8);
          ud.acc += dt * 46;
          const n = Math.floor(ud.acc);
          ud.acc -= n;
          for (let k = 0; k < n; k++) {
            const u = (k + Math.random()) / Math.max(1, n);
            puff(lerp(ud.lx, tx, u), lerp(ud.ly, ty, u), lerp(ud.lz, tz, u), 3, rnd(2.8, 4.2), 9, rnd(34, 50), C.white, C.pale, 0.55);
          }
          ud.lx = tx; ud.ly = ty; ud.lz = tz;
        }
      }
      missileMeshes.forEach((mesh, ms) => { if (!seen.has(ms)) { dropMissile(mesh); missileMeshes.delete(ms); } });

      // Flares: a burning point with a thin smoke trail
      for (const f of m.flares) {
        flame(f.x, f.y, f.z, 2, 0.1, 30, 14, C.hot, C.yellow, 1.0);
        if (Math.random() < dt * 22) puff(f.x, f.y, f.z, 2, 1.6, 6, 22, C.white, C.pale, 0.4);
      }

      // Aircraft: wing-tip vapour under high G, damage smoke, and burning wrecks
      m.jets.forEach((j, i) => {
        const m3 = jets3d[i];
        if (!m3 || j.gone) return;
        acc[i] = acc[i] || 0;
        m3.root.localToWorld(_v.set(0, 0, -m3.scaleLength * 0.42));
        const tx = _v.x, ty = _v.y, tz = _v.z;
        if (j.hp <= 0) {
          acc[i] += dt * 55;
          for (; acc[i] >= 1; acc[i]--) {
            puff(tx, ty, tz, 9, rnd(4, 7), 26, rnd(90, 140), C.black, C.dark, 0.85, 6);
            if (Math.random() < 0.6) flame(j.x + rnd(-14, 14), j.y + rnd(-8, 8), j.z + rnd(-14, 14), 16, rnd(0.25, 0.5), 30, 58, C.yellow, C.red, 0.95);
          }
          return;
        }
        if (j.hp < 60) {
          const heavy = j.hp < 30;
          acc[i] += dt * (heavy ? 30 : 13);
          for (; acc[i] >= 1; acc[i]--) {
            puff(tx, ty, tz, 4, rnd(2.5, 4.5), 12, heavy ? 80 : 50, heavy ? C.black : C.grey, heavy ? C.dark : C.pale, heavy ? 0.75 : 0.45, 3);
            if (heavy && Math.random() < 0.35) flame(tx, ty, tz, 6, 0.3, 16, 30, C.yellow, C.red, 0.9);
          }
        }
        if (j.gLoad > 3.2 && j.speed > 110 && Math.random() < dt * 40) {
          for (const sgn of [-1, 1]) {
            m3.root.localToWorld(_v2.set(sgn * m3.scaleSpan * 0.5, 0.02, -m3.scaleLength * 0.2));
            puff(_v2.x, _v2.y, _v2.z, 1.5, rnd(0.9, 1.5), 3.5, 13, C.white, C.white, 0.4);
          }
        }
      });

      // Smoke columns rising from crash sites
      for (let i = columns.length - 1; i >= 0; i--) {
        const c = columns[i];
        c.t -= dt; c.acc += dt * 9;
        for (; c.acc >= 1; c.acc--) {
          smoke.emit(c.x + rnd(-15, 15), c.y, c.z + rnd(-15, 15), rnd(-6, 6) + 9, rnd(28, 48), rnd(-6, 6), rnd(6, 9), 45, rnd(170, 240), C.black, C.grey, 0.8, 0.25, 0);
          if (c.t > 12 && Math.random() < 0.5) flame(c.x + rnd(-20, 20), c.y + rnd(0, 14), c.z + rnd(-20, 20), 8, rnd(0.3, 0.6), 26, 50, C.yellow, C.red, 0.9);
        }
        if (c.t <= 0) columns.splice(i, 1);
      }

      // Fireballs, flashes, shockwaves, debris
      for (const b of balls) {
        if (!b.visible) continue;
        const u = b.userData; u.t += dt;
        const t = u.t / u.life;
        if (t >= 1) { b.visible = false; continue; }
        b.scale.setScalar(u.r * (0.35 + 0.75 * Math.sqrt(t)));
        b.material.color.setRGB(1, lerp(0.95, 0.35, t), lerp(0.75, 0.05, t));
        b.material.opacity = 0.95 * (1 - t * t);
      }
      for (const f of flashes) {
        if (!f.visible) continue;
        const u = f.userData; u.t += dt;
        const t = u.t / u.life;
        if (t >= 1) { f.visible = false; continue; }
        f.scale.setScalar(u.r * (5 + 6 * t));
        f.material.opacity = 1 - t;
      }
      for (const g of rings) {
        if (!g.visible) continue;
        const u = g.userData; u.t += dt;
        const t = u.t / u.life;
        if (t >= 1) { g.visible = false; continue; }
        g.scale.setScalar(u.r * (0.4 + 3.4 * t));
        g.material.opacity = 0.55 * (1 - t);
        if (!u.ground) g.lookAt(cam.position);
      }
      for (const d of debris) {
        if (!d.visible) continue;
        const u = d.userData;
        u.life -= dt; u.vy -= 45 * dt;
        d.position.x += u.vx * dt; d.position.y += u.vy * dt; d.position.z += u.vz * dt;
        d.rotation.x += u.sx * dt; d.rotation.y += u.sy * dt; d.rotation.z += u.sz * dt;
        u.acc += dt * 16;
        for (; u.acc >= 1; u.acc--) puff(d.position.x, d.position.y, d.position.z, 2, rnd(1.2, 2.2), 6, 26, C.dark, C.grey, 0.55);
        const gh = Math.max(0, Df.terrainHeight(d.position.x, d.position.z));
        if (d.position.y <= gh) {
          for (let k = 0; k < 3; k++) smoke.emit(d.position.x, gh + 3, d.position.z, rnd(-10, 10), rnd(15, 35), rnd(-10, 10), rnd(1, 2), 8, 36, C.dust, C.dustPale, 0.6, 1.5, -8);
          d.visible = false;
        } else if (u.life <= 0) d.visible = false;
      }

      smoke.update(dt);
      fire.update(dt);
    }

    api.update = update;
    api.reset = reset;
    return api;
  }

  const API = { create };
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.AFArena = API;
})(typeof self !== 'undefined' ? self : this);
