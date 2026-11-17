#!/usr/bin/env node
/**
 * AeroForge 3D — command line.
 *   node cli.js presets
 *   node cli.js audit [preset_id]
 *   node cli.js dogfight [player_preset] [enemy_preset ...]   (1 to 4 enemies)
 */
const P = require('./static/af_physics.js');
const D = require('./static/af_dogfight.js');

const cmd = process.argv[2] || 'audit';
if (cmd === 'presets') {
  for (const [k, cfg] of Object.entries(P.PRESETS)) {
    const b = P.compute(cfg);
    console.log(`${k.padEnd(18)} | ${b.cfg.name.padEnd(22)} | Mach ${b.propulsion.maxMach.toFixed(2)} | T/W ${b.propulsion.twRatio.toFixed(2)} | RCS ${b.stealth.rcsDbsm.toFixed(1)} dBsm | $${(b.costUsd / 1e6).toFixed(1)}M`);
  }
} else if (cmd === 'dogfight') {
  const pKey = P.PRESETS[process.argv[3]] ? process.argv[3] : 'usa_f22a_raptor';
  let foes = process.argv.slice(4).filter((k) => P.PRESETS[k]).slice(0, 4);
  if (!foes.length) foes = ['rus_su57m_felon', 'chn_j20a_dragon'];
  const m = D.createMatch(P.PRESETS[pKey], foes.map((k) => P.PRESETS[k]), { seed: 42, difficulty: 'topgun' });
  while (!m.over) D.stepMatch(m, D.DT, null);
  console.log(JSON.stringify({
    player: m.jets[0].name,
    enemies: m.jets.slice(1).map((j) => ({ name: j.name, hull: Math.round(j.hp) })),
    result: m.winner === 0 ? 'player won' : 'player lost',
    reason: m.reason,
    playerHull: Math.round(m.jets[0].hp),
    lastEvents: m.events.slice(-6).map((e) => `${e.t.toFixed(1)}s ${e.text}`),
  }, null, 2));
} else {
  const key = P.PRESETS[process.argv[3]] ? process.argv[3] : 'usa_f22a_raptor';
  const b = P.compute(P.PRESETS[key]);
  console.log(JSON.stringify({
    name: b.cfg.name,
    nation: b.nation.name,
    era: b.era.name,
    airframe: b.airframe.name,
    engine: b.engine.name,
    geom: b.geom,
    mass: b.mass,
    propulsion: b.propulsion,
    aero: b.aero,
    performance: b.performance,
    stealth: { rcsFrontM2: b.stealth.rcsFrontM2, rcsDbsm: b.stealth.rcsDbsm },
    checks: b.checks,
  }, null, 2));
}
