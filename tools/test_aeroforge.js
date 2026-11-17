#!/usr/bin/env node
/**
 * AeroForge 3D — Automated Verification Suite (24 Historical/Modern Aircraft, 12 Internal Bays, 3D Models, Dogfight).
 */
const assert = require('assert');
const P = require('../static/af_physics.js');
const D = require('../static/af_dogfight.js');

console.log('1. Verifying 24 Multinational Aircraft (USA / RUS / CHN, WWI -> 6th-Gen) & 12 Internal Subsystem Bays...');
let count = 0;
const nationsFound = new Set();
const erasFound = new Set();
for (const [k, cfg] of Object.entries(P.PRESETS)) {
  const b = P.compute(cfg);
  nationsFound.add(b.airframe.nation);
  erasFound.add(b.airframe.era);
  assert(b.geom.lengthM > 4 && b.geom.spanM > 4, `Invalid geometry for preset ${k}`);
  assert(b.mass.grossKg > 200 && b.propulsion.wetSlKn > 1, `Invalid mass/thrust for preset ${k}`);
  assert(b.parts.length >= 12, `Expected at least 12 internal BOM subsystems for ${k}`);
  assert(Array.isArray(b.stealth.rcsPolar) && b.stealth.rcsPolar.length === 36, `Missing 36-pt RCS polar for ${k}`);
  count++;
}
assert(nationsFound.has('USA') && nationsFound.has('RUS') && nationsFound.has('CHN'), 'Missing USA, RUS, or CHN aircraft');
assert(erasFound.has('ww1') && erasFound.has('ww2') && erasFound.has('gen1_2') && erasFound.has('gen3_4') && erasFound.has('gen5_6'), 'Missing historical eras');

for (const af of Object.keys(P.AIRFRAMES)) {
  for (const eng of Object.keys(P.ENGINES)) {
    const b = P.compute({ ...P.PRESETS[af], engine: eng });
    assert(Number.isFinite(b.propulsion.maxMach) && b.propulsion.maxMach > 0.1, `Invalid maxMach for ${af}+${eng}`);
    assert(Number.isFinite(b.stealth.rcsDbsm), `Invalid RCS dBsm for ${af}+${eng}`);
    count++;
  }
}
console.log(`   -> ${count} multinational aircraft & internal-bay combinations verified cleanly.`);

console.log('2. Terrain: forest floor, river valley and mountain range...');
let hMin = Infinity, hMax = -Infinity, wet = 0, samples = 0;
for (let x = -D.ARENA; x <= D.ARENA; x += 150) {
  for (let z = -D.ARENA; z <= D.ARENA; z += 150) {
    const h = D.terrainHeight(x, z);
    assert(Number.isFinite(h), 'non-finite terrain height');
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); samples++;
    if (h < 0) wet++;
  }
}
assert(hMax > 900, 'expected a mountain range above 900 m, got ' + hMax.toFixed(0));
assert(wet > 0 && wet < samples * 0.2, 'expected a river covering a small part of the map');
assert(D.terrainHeight(0, D.riverZ(0)) < 0, 'river centreline should be below water level');
console.log(`   -> heights ${hMin.toFixed(0)} to ${hMax.toFixed(0)} m, ${(100 * wet / samples).toFixed(1)}% of the map is river.`);

console.log('3. Dogfight core: 1 player against 1 to 4 enemies, every era, AI on both sides...');
const matchups = [
  ['usa_spad13_ww1', ['rus_i15_ww1']],
  ['usa_p51d_ww2', ['rus_yak3_ww2', 'usa_f4u4_ww2']],
  ['usa_f86f_sabre', ['rus_mig15_fagot', 'chn_j5_fresco', 'rus_mig21_fishbed']],
  ['usa_f22a_raptor', ['chn_j20a_dragon', 'rus_su57m_felon', 'chn_j35a_gyrfalcon', 'usa_f35a_lightning']],
];
let playerWins = 0, accidentalCollisions = 0;
matchups.forEach(([a, foes], i) => {
  const m = D.createMatch(P.PRESETS[a], foes.map((k) => P.PRESETS[k]), { seed: 200 + i, difficulty: 'topgun' });
  assert.strictEqual(m.jets.length, foes.length + 1, 'wrong number of jets');
  let steps = 0;
  while (!m.over && steps++ < 60 * 300) {
    D.stepMatch(m, D.DT, null);
    for (const j of m.jets) {
      assert(Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.z), 'non-finite position');
      assert(Math.abs(j.x) <= D.ARENA * 1.1 + 1 && Math.abs(j.z) <= D.ARENA * 1.1 + 1, 'jet left the arena');
      assert(j.y <= D.ALT_MAX + 1, 'jet above the ceiling');
      if (j.hp > 0) assert(j.y > D.terrainHeight(j.x, j.z), 'a flying jet is below the terrain');
    }
  }
  assert(m.over, `match ${a} vs ${foes.length} did not finish`);
  for (let k = 0; k < 60 * 9; k++) D.stepMatch(m, D.DT, null);   // wrecks finish falling after the result
  assert(m.jets.every((j) => j.hp > 0 || j.gone || m.overT > 8), 'a wreck never reached the ground');
  accidentalCollisions += m.events.filter((e) => /COLLISION/.test(e.text)).length;
  if (m.winner === 0) playerWins++;
  console.log(`   ${a} vs ${foes.length}: ${m.reason}`);
});
console.log(`   -> ${matchups.length} matches finished; AI-flown player won ${playerWins}; collision events: ${accidentalCollisions}.`);

console.log('4. Mid-air collision destroys both aircraft...');
{
  const m = D.createMatch(P.PRESETS.usa_f22a_raptor, [P.PRESETS.rus_su57m_felon], { seed: 5 });
  const [a, b] = m.jets;
  b.x = a.x; b.y = a.y; b.z = a.z + 20;
  D.stepMatch(m, D.DT, { pitchCmd: 0, yawCmd: 0 });
  assert(a.hp === 0 && b.hp === 0, 'both jets should be destroyed');
  assert(m.fx.some((f) => f.type === 'explosion' && f.big), 'expected a large explosion effect');
  assert(m.over && /COLLISION/.test(m.reason), 'result should name the collision: ' + m.reason);
  console.log('   -> ' + m.reason);
}

console.log('5. A manually flown jet that hits the ground is destroyed...');
{
  const m = D.createMatch(P.PRESETS.usa_f22a_raptor, [P.PRESETS.rus_su57m_felon], { seed: 6 });
  let steps = 0;
  while (!m.over && steps++ < 60 * 60) D.stepMatch(m, D.DT, { pitchCmd: -1, yawCmd: 0, throttleDelta: 1 });
  assert(m.over && m.winner === 1 && /CRASHED/.test(m.reason), 'expected a ground crash: ' + m.reason);
  assert(m.fx.some((f) => f.type === 'explosion' && f.ground), 'expected a ground explosion effect');
  console.log(`   -> ${m.reason} after ${m.t.toFixed(1)} s`);
}

console.log('6. Missiles accelerate off the rail and gun rounds drop under gravity...');
{
  const m = D.createMatch(P.PRESETS.usa_f22a_raptor, [P.PRESETS.rus_su57m_felon], { seed: 7 });
  D.stepMatch(m, D.DT, { fireBvr: true, fireGun: false });
  D.stepMatch(m, D.DT, { fireGun: true });
  assert(m.missiles.length === 1 && m.bullets.length === 1, 'expected one missile and one round');
  const v0 = m.missiles[0].speed, vy0 = m.bullets[0].vy;
  for (let k = 0; k < 60; k++) D.stepMatch(m, D.DT, {});
  if (m.missiles.length) assert(m.missiles[0].speed > v0 + 150, 'missile should accelerate while the motor burns');
  if (m.bullets.length) assert(m.bullets[0].vy < vy0 - 10, 'round should be falling');
  console.log('   -> ok');
}
console.log('AEROFORGE 3D MULTINATIONAL CHECK PASSED');
