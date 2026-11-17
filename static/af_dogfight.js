/**
 * AeroForge 3D — dogfight core.
 *
 * Pure, seeded, fixed-step air-combat simulation that runs in Node (tests, CLI) and in the browser.
 * One player jet (index 0, team 0) fights 1 to 4 enemy jets (team 1) over a forested valley with a
 * river and a mountain range. The terrain is a deterministic height function shared with the renderer.
 *
 * Player input: { pitchCmd, yawCmd, rollCmd, throttleDelta, fireGun, fireBvr, fireWvr, dropFlare, cycleTarget }.
 * Passing null as the input lets the built-in AI fly the player jet as well (with ground avoidance).
 *
 * Visual one-shot effects (explosions, dust, muzzle flashes) are queued in match.fx for the renderer to drain.
 */
(function (root) {
  'use strict';

  const IS_NODE = typeof module === 'object' && !!module.exports;
  const PHYS = IS_NODE ? require('./af_physics.js') : null;
  const PH = () => PHYS || root.AFPhysics;

  const DogfightCore = (function () {
    const DT = 1 / 60;
    const ARENA = 4500;          // half-width of the play area, metres
    const ALT_MAX = 6000;
    const COLLIDE_R = 38;        // two jets closer than this collide
    const SKILL = { rookie: 0.55, topgun: 0.75, ace: 0.95 };
    const TEAM_MSL_CD = { rookie: 7.0, topgun: 5.0, ace: 3.5 }; // seconds between enemy missile launches (whole enemy team)

    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const lerp = (a, b, t) => a + (b - a) * t;
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const wrap = (a) => { const t = Math.PI * 2; return ((((a + Math.PI) % t) + t) % t) - Math.PI; };

    // ---- Terrain: rolling forest, a mountain range to the north, a river valley to the south ----
    function hash2(ix, iz) {
      let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function vnoise(x, z) {
      const ix = Math.floor(x), iz = Math.floor(z);
      const fx = x - ix, fz = z - iz;
      const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
      return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), u), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), u), v);
    }
    function fbm(x, z, oct) {
      let amp = 0.5, f = 1, s = 0, n = 0;
      for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); n += amp; amp *= 0.5; f *= 2.03; }
      return s / n;
    }
    const riverZ = (x) => -1500 + 620 * Math.sin(x / 1600 + 0.6) + 220 * Math.sin(x / 520);
    const forestDensity = (x, z) => fbm(x / 900 + 40.5, z / 900 + 17.3, 3);
    function terrainHeight(x, z) {
      let h = 40 + fbm(x / 1400 + 11.3, z / 1400 + 7.1, 4) * 230;
      const zc = 2700 + 650 * Math.sin(x / 2100);
      const band = Math.exp(-Math.pow((z - zc) / 1300, 2));
      const ridged = 1 - Math.abs(2 * fbm(x / 1700 + 3.7, z / 1700 + 9.2, 4) - 1);
      h += band * (300 + 1050 * ridged * ridged);
      const ring = sstep(6200, 9500, Math.hypot(x, z));              // distant mountains around the play area
      h += ring * (500 + 1500 * fbm(x / 2600 + 21, z / 2600 + 5, 3));
      const valley = sstep(70, 650, Math.abs(z - riverZ(x)));        // river bed sits below the water level (y = 0)
      return -14 + (h + 14) * valley;
    }

    function rand(m) {
      m.seed = (m.seed + 0x6d2b79f5) | 0;
      let t = Math.imul(m.seed ^ (m.seed >>> 15), 1 | m.seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function pushFx(m, o) {
      m.fx.push(o);
      if (m.fx.length > 400) m.fx.splice(0, 100);
    }

    function storeCount(build, kind) {
      let n = 0, name = '';
      for (const st of Object.keys(build.stations)) {
        const p = build.stations[st];
        if (p && p.kind === kind) {
          n += Math.max(1, p.ammo || 1);
          if (!name) name = p.name.split(' (')[0];
        }
      }
      return { n, name };
    }

    function makeJet(build, idx, team, x, y, z, yaw) {
      const p = PH();
      const b = build && build.geom ? build : p.compute(build || {});
      const bvr = storeCount(b, 'bvr_msl');
      const wvr = storeCount(b, 'wvr_msl');
      // Arcade speed band: scaled down from the real top speed so jets stay inside the arena and in view
      const vMax = clamp(b.propulsion.maxMach * 295 * 0.45, 55, 330);
      return {
        idx, team,
        name: b.cfg.name,
        build: b,
        x, y, z, yaw,
        pitch: 0, roll: 0,
        vMax, vMin: vMax * 0.45,
        speed: vMax * 0.75,
        turnRad: clamp(b.performance.instTurnDegS || 20, 14, 45) * Math.PI / 180,
        throttle: 0.75,
        afterburner: false,
        gLoad: 1.0,
        hp: 100,
        gone: false,                 // true once a destroyed jet's wreck has hit the ground
        wvx: 0, wvy: 0, wvz: 0,      // wreck velocity
        ammoGun: b.gunBay ? b.gunBay.ammo : 0,
        gunDmg: clamp(((b.gunBay && b.gunBay.damage) || 20) / 20, 0.6, 2.2),
        mslBvr: bvr.n, bvrName: bvr.name || 'BVR MISSILE',
        mslWvr: wvr.n, wvrName: wvr.name || 'WVR MISSILE',
        flares: 6 + Math.round(((b.ewSuite && b.ewSuite.flareBonus) || 0) / 4),
        cdGun: 0, cdMsl: 0, cdFlare: 0,
        gunSide: 1,
        target: -1,
        lockProgress: 0,
        hitsLanded: 0,
        damageDealt: 0,
      };
    }

    function createMatch(playerBuild, enemyBuilds, opts) {
      opts = opts || {};
      const enemies = (Array.isArray(enemyBuilds) ? enemyBuilds : [enemyBuilds]).slice(0, 4);
      const m = {
        seed: (opts.seed || 1337) | 0,
        t: 0,
        limit: opts.limit || 240,
        difficulty: SKILL[opts.difficulty] ? opts.difficulty : 'topgun',
        over: false,
        overT: 0,
        winner: -1,          // 0 = player, 1 = enemy team
        reason: '',
        kills: 0,            // enemy aircraft destroyed, by any cause
        enemyMslCd: 3.0,
        jets: [],
        missiles: [],
        bullets: [],
        flares: [],
        fx: [],
        events: [],
      };
      // Player starts over the river valley heading north (+Z) toward the mountains; enemies start ahead, heading back
      m.jets.push(makeJet(playerBuild, 0, 0, 0, 2000, -900, 0));
      const n = enemies.length;
      enemies.forEach((eb, i) => {
        const spread = (i - (n - 1) / 2) * 520;
        m.jets.push(makeJet(eb, i + 1, 1, spread, 2100 + (i % 2 ? 260 : -120) + i * 70, 1500 + (i % 2) * 350, Math.PI));
      });
      return m;
    }

    function forwardVec(j) {
      const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
      return { x: Math.sin(j.yaw) * cp, y: sp, z: Math.cos(j.yaw) * cp };
    }

    const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const foesOf = (m, j) => m.jets.filter((o) => o.team !== j.team && o.hp > 0);

    function retarget(m, j, cycle) {
      const foes = foesOf(m, j);
      if (!foes.length) { j.target = -1; return; }
      const cur = m.jets[j.target];
      const valid = cur && cur.hp > 0 && cur.team !== j.team;
      if (valid && cycle) {
        const k = foes.indexOf(cur);
        j.target = foes[(k + 1) % foes.length].idx;
        j.lockProgress = 0;
      } else if (!valid) {
        let best = foes[0];
        for (const f of foes) if (dist3(f, j) < dist3(best, j)) best = f;
        j.target = best.idx;
        j.lockProgress = 0;
      }
    }

    function aiInput(m, j) {
      const foe = m.jets[j.target];
      const skill = j.team === 0 ? 0.9 : SKILL[m.difficulty];
      let tx = 0, ty = 2000, tz = 0, foeDist = Infinity;
      if (foe && foe.hp > 0) {
        foeDist = dist3(foe, j);
        const lead = clamp(foeDist / 900, 0, 1.2) * skill;
        const ff = forwardVec(foe);
        tx = foe.x + ff.x * foe.speed * lead;
        ty = foe.y + ff.y * foe.speed * lead;
        tz = foe.z + ff.z * foe.speed * lead;
      }
      // Turn back toward the centre before reaching the arena edge
      if (Math.abs(j.x) > ARENA * 0.8 || Math.abs(j.z) > ARENA * 0.8) { tx = 0; tz = 0; ty = 2200; }
      ty = Math.max(ty, terrainHeight(tx, tz) + 300);
      const dx = tx - j.x, dy = ty - j.y, dz = tz - j.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      let desiredYaw = Math.atan2(dx, dz);
      let desiredPitch = clamp(Math.asin(clamp(dy / d, -0.85, 0.85)), -0.7, 0.7);

      // Keep clear of every other aircraft (friend or foe): predict the closest approach over the next
      // few seconds and break away if the predicted miss distance is too small.
      let near = null, nearT = 0, worst = 170;
      const mv = forwardVec(j);
      for (const o of m.jets) {
        if (o === j || o.hp <= 0) continue;
        const ov = forwardVec(o);
        const rx = o.x - j.x, ry = o.y - j.y, rz = o.z - j.z;
        const vx = ov.x * o.speed - mv.x * j.speed, vy = ov.y * o.speed - mv.y * j.speed, vz = ov.z * o.speed - mv.z * j.speed;
        const vv = vx * vx + vy * vy + vz * vz || 1;
        const tc = clamp(-(rx * vx + ry * vy + rz * vz) / vv, 0, 3);
        const miss = Math.hypot(rx + vx * tc, ry + vy * tc, rz + vz * tc);
        const rl = Math.hypot(rx, ry, rz) || 1;
        const closing = -(rx * vx + ry * vy + rz * vz) / rl;   // m/s; a tail chase closes slowly and is not a collision risk
        if ((closing > 180 && miss < worst) || rl < 110) { worst = Math.min(worst, miss); near = o; nearT = tc; }
      }
      if (near) {
        const up = j.y > near.y || (j.y === near.y && j.idx < near.idx);
        desiredPitch = up ? 0.6 : -0.45;
        desiredYaw = j.yaw + (j.idx < near.idx ? 0.9 : -0.9);
        void nearT;
      }

      // Terrain avoidance: look along the current heading and climb if the ground ahead is too close
      let need = terrainHeight(j.x, j.z);
      const sy = Math.sin(j.yaw), cy = Math.cos(j.yaw);
      for (const t of [1.5, 3, 5]) need = Math.max(need, terrainHeight(j.x + sy * j.speed * t, j.z + cy * j.speed * t));
      const clearance = j.y - need;
      if (clearance < 450) desiredPitch = Math.max(desiredPitch, clamp((450 - clearance) / 400, 0.15, 0.95));
      if (j.y > ALT_MAX - 700) desiredPitch = Math.min(desiredPitch, -0.25);

      const yawErr = wrap(desiredYaw - j.yaw);
      const pitchErr = desiredPitch - j.pitch;
      const aligned = !near && Math.abs(yawErr) < 0.22 && Math.abs(pitchErr) < 0.22;
      const incoming = m.missiles.some((ms) => ms.target === j.idx && !ms.spoofed && dist3(ms, j) < 700);
      return {
        pitchCmd: clamp(pitchErr * 3.0 * skill, -1, 1),
        yawCmd: clamp(yawErr * 2.6 * skill, -1, 1),
        rollCmd: clamp(-yawErr * 2.4, -1, 1),
        throttleDelta: foeDist > 1200 ? 1 : foeDist < 400 ? -0.6 : 0.2,
        fireGun: foeDist < 650 && aligned && Math.abs(yawErr) < 0.12,
        fireBvr: foeDist > 1100 && foeDist < 3600 && aligned,
        fireWvr: foeDist > 300 && foeDist <= 1300 && aligned,
        dropFlare: incoming && rand(m) < 0.5 * skill + 0.2,
        cycleTarget: false,
      };
    }

    function killJet(m, j, text, onGround) {
      if (j.hp <= 0 && j.gone) return;
      const f = forwardVec(j);
      j.hp = 0;
      j.wvx = f.x * j.speed * 0.8; j.wvy = f.y * j.speed * 0.5; j.wvz = f.z * j.speed * 0.8;
      if (onGround) j.gone = true;
      pushFx(m, { type: 'explosion', x: j.x, y: j.y, z: j.z, r: onGround ? 200 : 150, ground: !!onGround, big: true });
      m.events.push({ t: m.t, text: text || `SPLASH! ${j.name} DESTROYED` });
      if (j.team === 1) m.kills++;
    }

    function damage(m, target, amount, owner) {
      if (target.hp <= 0 || m.over) return;
      const skill = SKILL[m.difficulty];
      const dealt = target.team === 0 ? amount * (0.35 + 0.35 * skill) : amount; // the outnumbered player is tougher
      owner.hitsLanded++;
      owner.damageDealt += dealt;
      if (target.hp - dealt <= 0) killJet(m, target);
      else target.hp -= dealt;
    }

    // A destroyed jet keeps falling as a burning wreck until it hits the ground
    function stepWreck(m, j, dt) {
      j.wvy -= 38 * dt;
      const k = Math.max(0, 1 - 0.25 * dt);
      j.wvx *= k; j.wvz *= k;
      j.x += j.wvx * dt; j.y += j.wvy * dt; j.z += j.wvz * dt;
      j.roll += 2.6 * dt;
      j.pitch = lerp(j.pitch, -1.0, Math.min(1, 0.8 * dt));
      const gh = Math.max(0, terrainHeight(j.x, j.z));
      if (j.y <= gh + 4) {
        j.y = gh + 4;
        j.gone = true;
        pushFx(m, { type: 'explosion', x: j.x, y: j.y, z: j.z, r: 190, ground: true, big: true });
      }
    }

    function stepMatch(m, dt, playerInput) {
      dt = dt || DT;
      if (m.over) {            // keep the world moving for a few seconds after the result so wrecks finish falling
        m.overT += dt;
        if (m.overT > 8) return m;
      }
      m.t += dt;
      m.enemyMslCd = Math.max(0, m.enemyMslCd - dt);

      for (const j of m.jets) {
        if (j.hp <= 0) { if (!j.gone) stepWreck(m, j, dt); continue; }
        const manual = j.idx === 0 && !!playerInput;
        retarget(m, j, manual && playerInput.cycleTarget);
        const inp = manual ? playerInput : aiInput(m, j);
        const foe = m.jets[j.target];

        // Flight model
        j.throttle = clamp(j.throttle + (inp.throttleDelta || 0) * dt * 0.5, 0.2, 1.0);
        j.afterburner = j.throttle > 0.8;
        const targetSpeed = j.vMin + j.throttle * (j.vMax - j.vMin);
        j.speed = clamp(j.speed + (targetSpeed - j.speed) * dt * 0.8 - Math.abs(inp.pitchCmd || 0) * 6 * dt, j.vMin * 0.8, j.vMax);
        const yawCmd = clamp(inp.yawCmd || 0, -1, 1), pitchCmd = clamp(inp.pitchCmd || 0, -1, 1);
        j.yaw = wrap(j.yaw + yawCmd * j.turnRad * dt);
        j.pitch = clamp(j.pitch + pitchCmd * j.turnRad * 0.9 * dt, -1.1, 1.1);
        const rollTarget = clamp(inp.rollCmd != null ? inp.rollCmd : -yawCmd, -1, 1) * 1.15;
        j.roll += (rollTarget - j.roll) * Math.min(1, 5 * dt);
        j.gLoad = 1.0 + Math.hypot(pitchCmd, yawCmd) * Math.max(0, (j.build.performance.nInstMax || 6) - 1);

        const fwd = forwardVec(j);
        j.x = clamp(j.x + fwd.x * j.speed * dt, -ARENA * 1.1, ARENA * 1.1);
        j.y = Math.min(ALT_MAX, j.y + fwd.y * j.speed * dt);
        j.z = clamp(j.z + fwd.z * j.speed * dt, -ARENA * 1.1, ARENA * 1.1);
        if (j.y >= ALT_MAX && j.pitch > 0) j.pitch = Math.max(0, j.pitch - 1.5 * dt);

        // Ground: a manually flown jet that touches the terrain is destroyed; AI-flown jets get automatic ground avoidance
        const gh = Math.max(0, terrainHeight(j.x, j.z));
        if (manual) {
          if (j.y <= gh + 10) { j.y = gh + 10; killJet(m, j, `${j.name} CRASHED INTO THE GROUND`, true); continue; }
        } else if (j.y < gh + 150) {
          j.y = Math.max(gh + 40, j.y + (gh + 150 - j.y) * Math.min(1, 4 * dt));
          j.pitch = Math.max(j.pitch, 0.25);
        }

        j.cdGun = Math.max(0, j.cdGun - dt);
        j.cdMsl = Math.max(0, j.cdMsl - dt);
        j.cdFlare = Math.max(0, j.cdFlare - dt);

        // Lock-on
        let ux = 0, uy = 0, uz = 0, fd = Infinity;
        if (foe && foe.hp > 0) {
          const dx = foe.x - j.x, dy = foe.y - j.y, dz = foe.z - j.z;
          fd = Math.hypot(dx, dy, dz) || 1;
          ux = dx / fd; uy = dy / fd; uz = dz / fd;
          const dot = fwd.x * ux + fwd.y * uy + fwd.z * uz;
          j.lockProgress = clamp(j.lockProgress + (dot > 0.9 && fd < 3800 ? dt * 1.2 : -dt * 0.8), 0, 1);
        } else {
          j.lockProgress = 0;
        }

        // Gun: rounds leave with muzzle velocity plus the jet's own speed, a little dispersion, and then fall under gravity
        if (inp.fireGun && j.cdGun <= 0 && j.ammoGun > 0) {
          j.cdGun = 0.07;
          j.ammoGun--;
          j.gunSide = -j.gunSide;
          const v = j.speed + 850;
          const sx = (rand(m) - 0.5) * 0.012, sy2 = (rand(m) - 0.5) * 0.012;
          const assist = fd < 900 ? 110 : 0;   // slight aim assist toward the locked target
          m.bullets.push({
            owner: j.idx, team: j.team, dmg: j.gunDmg,
            x: j.x + fwd.x * 34 + Math.cos(j.yaw) * 7 * j.gunSide, y: j.y + fwd.y * 34, z: j.z + fwd.z * 34 - Math.sin(j.yaw) * 7 * j.gunSide,
            vx: (fwd.x + sx) * v + ux * assist, vy: (fwd.y + sy2) * v + uy * assist, vz: (fwd.z - sx) * v + uz * assist,
            life: 1.5,
          });
          pushFx(m, { type: 'muzzle', idx: j.idx });
        }

        // Missiles
        const wantB = inp.fireBvr && j.mslBvr > 0, wantW = !wantB && inp.fireWvr && j.mslWvr > 0;
        if ((wantB || wantW) && j.cdMsl <= 0 && foe && foe.hp > 0) {
          const enemyHeld = j.team === 1 && (m.enemyMslCd > 0 || j.lockProgress < 1);
          if (!enemyHeld) {
            if (j.team === 1) m.enemyMslCd = TEAM_MSL_CD[m.difficulty];
            if (wantB) j.mslBvr--; else j.mslWvr--;
            j.cdMsl = 1.3;
            j.gunSide = -j.gunSide;
            const name = wantB ? j.bvrName : j.wvrName;
            m.missiles.push({
              owner: j.idx, team: j.team, target: foe.idx, kind: wantB ? 'bvr' : 'wvr', name,
              x: j.x + Math.cos(j.yaw) * 18 * j.gunSide, y: j.y - 9, z: j.z - Math.sin(j.yaw) * 18 * j.gunSide,
              dx: fwd.x, dy: fwd.y, dz: fwd.z,
              speed: j.speed,
              vmax: wantB ? 640 : 570,
              turn: wantB ? 2.1 : 3.1,          // maximum turn rate, rad/s
              burn: wantB ? 5.0 : 3.5,          // motor burn time, s
              damage: wantB ? 36 : 28,
              life: wantB ? 9.5 : 6.5,
              age: 0,
              burning: false,
              spoofed: false,
            });
            m.events.push({ t: m.t, text: `${j.name}: FOX-${wantB ? '3' : '2'} (${name})` });
          }
        }

        // Flares
        if (inp.dropFlare && j.cdFlare <= 0 && j.flares > 0) {
          j.flares--;
          j.cdFlare = 1.0;
          for (let f = 0; f < 4; f++) {
            const side = (f % 2 ? 1 : -1) * (30 + rand(m) * 40);
            m.flares.push({
              owner: j.idx,
              x: j.x - fwd.x * 25, y: j.y - 6, z: j.z - fwd.z * 25,
              vx: fwd.x * j.speed * 0.55 + Math.cos(j.yaw) * side, vy: -20 - rand(m) * 30, vz: fwd.z * j.speed * 0.55 - Math.sin(j.yaw) * side,
              life: 2.6,
            });
          }
          for (const ms of m.missiles) {
            if (ms.target === j.idx && !ms.spoofed && dist3(ms, j) < 900 && rand(m) < 0.72) {
              ms.spoofed = true;
              m.events.push({ t: m.t, text: `${j.name} DECOYED ${ms.name}` });
            }
          }
        }
      }

      // Mid-air collisions: both aircraft are destroyed
      for (let a = 0; a < m.jets.length; a++) {
        const ja = m.jets[a];
        if (ja.hp <= 0) continue;
        for (let b = a + 1; b < m.jets.length; b++) {
          const jb = m.jets[b];
          if (jb.hp <= 0 || dist3(ja, jb) > COLLIDE_R) continue;
          pushFx(m, { type: 'explosion', x: (ja.x + jb.x) / 2, y: (ja.y + jb.y) / 2, z: (ja.z + jb.z) / 2, r: 230, big: true });
          killJet(m, ja, `MID-AIR COLLISION: ${ja.name} AND ${jb.name}`);
          killJet(m, jb, `MID-AIR COLLISION: ${ja.name} AND ${jb.name}`);
          break;
        }
      }

      // Bullets
      for (let i = m.bullets.length - 1; i >= 0; i--) {
        const b = m.bullets[i];
        b.vy -= 9.81 * 2 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.life -= dt;
        let done = b.life <= 0;
        for (const tgt of m.jets) {
          if (done || tgt.team === b.team || tgt.hp <= 0) continue;
          if (dist3(b, tgt) < 45) {
            pushFx(m, { type: 'hit', x: b.x, y: b.y, z: b.z });
            damage(m, tgt, b.dmg, m.jets[b.owner]);
            done = true;
          }
        }
        if (!done && b.y <= Math.max(0, terrainHeight(b.x, b.z))) {
          pushFx(m, { type: 'dust', x: b.x, y: b.y, z: b.z });
          done = true;
        }
        if (done) m.bullets.splice(i, 1);
      }

      // Missiles: drop clear of the rail, light the motor, accelerate, then steer with a limited turn rate toward a lead point
      for (let i = m.missiles.length - 1; i >= 0; i--) {
        const ms = m.missiles[i];
        ms.age += dt;
        ms.burning = ms.age > 0.25 && ms.age < 0.25 + ms.burn;
        if (ms.age <= 0.25) ms.y -= 30 * dt;
        else if (ms.burning) ms.speed = Math.min(ms.vmax, ms.speed + 460 * dt);
        else ms.speed = Math.max(150, ms.speed * (1 - 0.07 * dt));

        const tgt = m.jets[ms.target];
        let detonate = false, onGround = false;
        if (tgt && tgt.hp > 0 && !ms.spoofed && ms.age > 0.25) {
          const d = dist3(tgt, ms) || 1;
          if (d < 55) {
            m.events.push({ t: m.t, text: `HIT! ${ms.name} STRUCK ${tgt.name}` });
            pushFx(m, { type: 'explosion', x: ms.x, y: ms.y, z: ms.z, r: 85 });
            damage(m, tgt, ms.damage, m.jets[ms.owner]);
            m.missiles.splice(i, 1);
            continue;
          }
          const tv = forwardVec(tgt);
          const tl = clamp(d / Math.max(200, ms.speed), 0, 2.5) * 0.85;
          let ax = tgt.x + tv.x * tgt.speed * tl - ms.x, ay = tgt.y + tv.y * tgt.speed * tl - ms.y, az = tgt.z + tv.z * tgt.speed * tl - ms.z;
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al;
          const dot = clamp(ms.dx * ax + ms.dy * ay + ms.dz * az, -1, 1);
          if (dot < 0.2 && ms.age > 1.0) {
            ms.spoofed = true;           // target left the seeker's field of view
          } else {
            const ang = Math.acos(dot);
            if (ang > 1e-4) {
              const t = Math.min(1, (ms.turn * dt) / ang);
              const s = Math.sin(ang), wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
              ms.dx = ms.dx * wa + ax * wb; ms.dy = ms.dy * wa + ay * wb; ms.dz = ms.dz * wa + az * wb;
              const nl = Math.hypot(ms.dx, ms.dy, ms.dz) || 1;
              ms.dx /= nl; ms.dy /= nl; ms.dz /= nl;
            }
          }
        }
        ms.x += ms.dx * ms.speed * dt; ms.y += ms.dy * ms.speed * dt; ms.z += ms.dz * ms.speed * dt;
        if (ms.y <= Math.max(0, terrainHeight(ms.x, ms.z))) { detonate = true; onGround = true; }
        if (ms.age >= ms.life) detonate = true;
        if (detonate) {
          pushFx(m, { type: 'explosion', x: ms.x, y: ms.y, z: ms.z, r: onGround ? 80 : 45, ground: onGround });
          m.missiles.splice(i, 1);
        }
      }

      for (let i = m.flares.length - 1; i >= 0; i--) {
        const f = m.flares[i];
        const k = Math.max(0, 1 - 1.2 * dt);
        f.vx *= k; f.vz *= k;
        f.vy -= 25 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.life -= dt;
        if (f.life <= 0) m.flares.splice(i, 1);
      }

      // Result
      if (!m.over) {
        const player = m.jets[0];
        const total = m.jets.length - 1;
        const enemiesLeft = m.jets.filter((j) => j.team === 1 && j.hp > 0).length;
        if (player.hp <= 0) {
          m.over = true; m.winner = 1;
          m.reason = m.events.length && /COLLISION|CRASHED/.test(m.events[m.events.length - 1].text)
            ? m.events[m.events.length - 1].text
            : `YOU WERE SHOT DOWN AT ${m.t.toFixed(0)} s`;
        } else if (enemiesLeft === 0) {
          m.over = true; m.winner = 0; m.reason = `ALL ${total} ENEMIES DESTROYED IN ${m.t.toFixed(0)} s`;
        } else if (m.t >= m.limit) {
          m.over = true;
          m.winner = m.kills > 0 ? 0 : 1;
          m.reason = `TIME UP · ${m.kills} OF ${total} ENEMIES DESTROYED`;
        }
      }
      return m;
    }

    return { createMatch, stepMatch, forwardVec, terrainHeight, forestDensity, riverZ, DT, ARENA, ALT_MAX, COLLIDE_R };
  })();

  if (IS_NODE) module.exports = DogfightCore;
  root.AFDogfight = DogfightCore;
})(typeof self !== 'undefined' ? self : this);
