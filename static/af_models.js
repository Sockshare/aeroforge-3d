/**
 * AeroForge 3D — High-Fidelity Procedural 3D Aircraft & 65+ Internal Sub-Part CAD Assembler.
 *
 * Builds authentic external & internal 3D geometry across 5 distinct aircraft configurations
 * (WWI Biplanes, WWII Piston Fighters, Early Nose-Intake Swept Jets, Shock-Cone Delta Jets,
 * and Modern 4th/5th/6th-Gen Twin/Single Stealth & Super-Maneuverable Fighters) and renders
 * ALL 12 internal modular bays inside the fuselage and wings:
 *   1. Structural Bulkhead Frames (8 CNC Titanium/Duralumin/Spruce Ring Bulkheads + Keel Beam + Wing Spars)
 *   2. Nose Radar / Optical Sight Bay (AESA Gold Array, PESA Dish, Shock-Cone Radar, or Gyro/Optical Sight)
 *   3. Cockpit & Life-Support Bay (Ejection Seat / Wicker Seat, Control Stick, Throttle, Instrument Pedestal, HUD)
 *   4. Flight Control System (FCS) Bay (Quad Digital FBW Computers / Pushrods + Wing/Tail Servo Actuators)
 *   5. Internal Fuel System (Forward Header Tank, Main Center Bladder, Dorsal Saddle Tank, Left/Right Wet-Wing Cells + Plumbing)
 *   6. Hydraulics & Electrical Power Bay (Dual 3000/5000 PSI Pumps, Titanium Accumulators, 270V Li-Ion Battery & Generator)
 *   7. ECS & OBOGS Bay (Molecular-Sieve OBOGS Concentrator, Bleed-Air Pre-Cooler, Ram-Air Heat Exchanger)
 *   8. Retractable Undercarriage Rig (Nose/Tail Oleo Strut, Twin/Single Tyres, Torque Links, Main Wing Gear & Wheel Wells)
 *   9. Internal Gun & Ammo Bay (6-Barrel M61A2 Vulcan / GSh-30-1 / NR-37 / Synchronized Vickers + Helical Ammo Drum & Chute)
 *  10. Defensive EW & Countermeasure Bay (Forward/Rear RWR Receivers, DRFM Jammer Racks, Ventral Chaff/Flare Magazines)
 *  11. Propulsion & Multi-Stage Turbine / Piston Engine Core (Spinning Propeller or 3-Stage LPC Fan, 6-Stage HPC Discs,
 *      Annular Combustor Cans, HPT/LPT Rotors, Afterburner Spray Rings, TVC Petals & Shock-Diamond Plume)
 *  12. External / Internal Ordnance Stations (Pylons, Rotary Launchers, Fins, Seekers & Boosters)
 */
(function (root) {
  'use strict';

  const P = root.AFPhysics;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  function buildAircraft3D(THREE, build, opts) {
    opts = opts || {};
    const cfg = build.cfg, af = build.airframe, eng = build.engine, mat = build.material, liv = build.livery;
    const rootGrp = new THREE.Group();
    const meshes = [];
    const explodeList = [];
    const anim = {
      props: [], fans: [], nozzles: [], plumes: [], canards: [], surfaces: [],
      radar: null, cfdLines: null, shockCone: null,
    };

    const std = (color, rough, metal, extra) => new THREE.MeshStandardMaterial(Object.assign({
      color, roughness: rough, metalness: metal, envMapIntensity: 1.0, side: THREE.DoubleSide,
    }, extra || {}));
    const glow = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    });

    const M = {
      skinPrimary: std(liv.primary, clamp(mat.rough + 0.14, 0.32, 0.9), mat.metal * 0.55),
      skinSecondary: std(liv.secondary, clamp(mat.rough + 0.18, 0.32, 0.9), mat.metal * 0.5),
      accent: std(liv.accent, 0.25, 0.45),
      titanium: std('#9aa4b2', 0.22, 0.95),
      duralumin: std('#cbd5e1', 0.24, 0.90),
      spruceWood: std('#9a6b3b', 0.65, 0.08),
      brass: std('#eab308', 0.20, 0.94),
      copper: std('#d97706', 0.24, 0.92),
      chrome: std('#e2e8f0', 0.10, 1.00),
      darkSteel: std('#1e242d', 0.30, 0.88),
      gunmetal: std('#11151c', 0.28, 0.92),
      fuelBladder: std('#d97706', 0.45, 0.18),
      avionicsBlack: std('#0f172a', 0.32, 0.65),
      hydBlue: std('#0284c7', 0.22, 0.85),
      ecsGreen: std('#10b981', 0.28, 0.72),
      ewPurple: std('#8b5cf6', 0.25, 0.78),
      canopyGlass: std(new THREE.Color(liv.canopy || '#eab308').lerp(new THREE.Color('#0b1220'), 0.5), 0.04, 0.9, { transparent: true, opacity: 0.62, envMapIntensity: 1.6 }),
      canopyFrame: std('#1c222b', 0.5, 0.55),
      leather: std('#5a3a22', 0.8, 0.05),
      cockpitFloor: std('#0d1117', 0.9, 0.1),
      radome: std(af.era === 'ww1' || af.era === 'ww2' ? liv.secondary : '#171b24', 0.30, 0.25),
      aesaGold: std('#facc15', 0.16, 0.96),
      hudGlass: glow('#22c55e', 0.62),
      ordWhite: std('#f1f5f9', 0.25, 0.48),
      ordDark: std('#1e293b', 0.30, 0.65),
      ordSeeker: std('#f59e0b', 0.14, 0.92),
      abOuter: glow('#f97316', 0.65),
      abCore: glow('#fef08a', 0.90),
      abBlue: glow('#38bdf8', 0.82),
      tyre: std('#0f1115', 0.85, 0.08),
    };

    // Normalise visual scene size so both a 6.2m WWI SPAD and a 22m J-20 fill the viewport cleanly
    const normScale = af.era === 'ww1' ? 0.52 : af.era === 'ww2' ? 0.38 : 0.24;
    const L = build.geom.lengthM * normScale;
    const W = build.geom.spanM * normScale;
    const H = L * (af.config === 'biplane' || af.config === 'mono_prop' ? 0.17 : 0.135);
    const sweepRad = build.geom.sweepDeg * DEG;

    // Pieces inside an assembly (weapon sections, wheels, gun barrels...) that separate further in teardown
    const subList = [];
    function sub(obj, ex) {
      obj.userData.sub = { home: obj.position.clone(), ex: new THREE.Vector3(ex[0], ex[1], ex[2]) };
      subList.push(obj);
      return obj;
    }

    function addPart(parent, geo, material, partName, cat, isOuterSkin, exVec, px, py, pz, rx, ry, rz) {
      const m = new THREE.Mesh(geo, isOuterSkin ? material.clone() : material);
      m.position.set(px || 0, py || 0, pz || 0);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData = {
        part: partName,
        cat,
        isOuterSkin: !!isOuterSkin,
        homePos: m.position.clone(),
        ex: new THREE.Vector3(exVec[0] || 0, exVec[1] || 0, exVec[2] || 0),
      };
      parent.add(m);
      meshes.push(m);
      explodeList.push(m);
      return m;
    }

    // =========================================================================
    // A. EXTERNAL MONOCOQUE SKIN & RADOME (isOuterSkin = true so X-Ray / Cutaway reveals internals!)
    // =========================================================================
    const radomeLen = L * 0.22;
    if (af.config === 'nose_intake_jet' || af.config === 'shock_cone_delta') {
      // Open Pitot Nose Intake Ring (MiG-15, F-86, J-5, MiG-21, J-7)
      const lipGeo = new THREE.CylinderGeometry(H * 0.56, H * 0.66, radomeLen * 0.75, 20, 1, true);
      lipGeo.rotateX(Math.PI / 2);
      addPart(rootGrp, lipGeo, M.skinSecondary, 'SUPERSONIC PITOT NOSE INTAKE COWL', 'AIRFRAME', true, [0, 0.1, 1.45], 0, 0, L * 0.36);
      if (af.config === 'shock_cone_delta') {
        const coneGeo = new THREE.ConeGeometry(H * 0.38, radomeLen * 0.95, 18);
        coneGeo.rotateX(Math.PI / 2);
        addPart(rootGrp, coneGeo, M.radome, 'TRANSLATING MACH SHOCK-CONE RADOME', 'RADAR', false, [0, 0.15, 1.65], 0, 0, L * 0.40);
      }
    } else if (af.propType === 'nose_prop') {
      // WWI / WWII Engine Cowling + Spinner
      const cowlGeo = new THREE.CylinderGeometry(H * 0.62, H * 0.72, radomeLen * 0.85, 20);
      cowlGeo.rotateX(Math.PI / 2);
      addPart(rootGrp, cowlGeo, M.skinSecondary, 'FORWARD ENGINE ARMORED COWLING', 'AIRFRAME', true, [0, 0.35, 1.35], 0, 0, L * 0.35);
    } else {
      // Smooth Chined Ogive Stealth / Supersonic Radome
      const radGeo = new THREE.ConeGeometry(H * 0.68, radomeLen, 16);
      radGeo.rotateX(Math.PI / 2);
      radGeo.scale(1.38, 0.68, 1);
      addPart(rootGrp, radGeo, M.radome, 'DIELECTRIC / RAM STEALTH NOSE RADOME', 'AIRFRAME', true, [0, 0.08, 1.50], 0, 0, L * 0.39);
    }

    // Left & Right Split Fuselage Monocoque Half-Shells (pull apart laterally in Teardown or go translucent in X-Ray!)
    const fuseLen = L * 0.64;
    for (const s of [-1, 1]) {
      const shellGeo = new THREE.CylinderGeometry(H * 0.65, H * 0.82, fuseLen, 14, 1, false, s < 0 ? Math.PI : 0, Math.PI);
      shellGeo.rotateX(Math.PI / 2);
      shellGeo.scale(1.42, 0.66, 1);
      addPart(rootGrp, shellGeo, M.skinPrimary, `${s < 0 ? 'PORT' : 'STARBOARD'} MONOCOQUE FUSELAGE SKIN SHELL`, 'AIRFRAME', true, [s * 0.95, 0.45, 0], 0, 0, -L * 0.03);
    }

    // Ventral Belly Access Doors
    const bellyGeo = new THREE.BoxGeometry(H * 1.45, 0.035, fuseLen * 0.82);
    addPart(rootGrp, bellyGeo, M.skinSecondary, 'VENTRAL ENGINE & WEAPON BAY ACCESS DOORS', 'AIRFRAME', true, [0, -1.05, 0], 0, -H * 0.48, -L * 0.04);

    // Side Intakes for Jet Fighters
    if (af.propType === 'jet' && af.config !== 'nose_intake_jet' && af.config !== 'shock_cone_delta') {
      for (const s of [-1, 1]) {
        const inGeo = new THREE.BoxGeometry(H * 0.52, H * 0.50, L * 0.42);
        addPart(rootGrp, inGeo, M.skinPrimary, `${s < 0 ? 'LEFT' : 'RIGHT'} SUPERSONIC S-DUCT INTAKE TRUNK`, 'AIRFRAME', true, [s * 1.12, -0.12, 0.25], s * H * 0.92, -H * 0.05, L * 0.01, 0, s * 0.05, s * -0.12);
      }
    }

    // =========================================================================
    // B. INTERNAL SUBSYSTEM BAY 1: STRUCTURAL SKELETON (8 BULKHEAD RINGS, KEEL BEAM & SPARS)
    // =========================================================================
    const frameMat = af.era === 'ww1' ? M.spruceWood : af.era === 'ww2' ? M.duralumin : M.titanium;
    // Central Titanium / Spruce Keel Spine Beam
    const keelGeo = new THREE.BoxGeometry(0.06, H * 0.55, fuseLen * 0.96);
    addPart(rootGrp, keelGeo, frameMat, 'PRIMARY LONGITUDINAL KEEL SPINE BEAM', 'STRUCTURE', false, [0, -0.45, 0], 0, -H * 0.12, -L * 0.03);

    // 8 Machined Ring Bulkheads along the fuselage
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      const bz = L * 0.25 - u * fuseLen * 0.92;
      const rScale = 0.72 + Math.sin(u * Math.PI) * 0.28;
      const ringGeo = new THREE.RingGeometry(H * 0.36 * rScale, H * 0.58 * rScale, 16);
      ringGeo.scale(1.36, 0.62, 1); // match the 1.42 x 0.66 elliptical hull section, just inside the skin
      addPart(rootGrp, ringGeo, frameMat, `MACHINED STRUCTURAL BULKHEAD FRAME #${i + 1}`, 'STRUCTURE', false, [0, 0.68 + i * 0.06, (0.5 - u) * 0.45], 0, 0, bz);
    }

    // =========================================================================
    // C. INTERNAL SUBSYSTEM BAY 2: NOSE RADAR / OPTICAL SIGHT + AVIONICS RACK
    // =========================================================================
    const radObj = build.radar;
    const radGrp = new THREE.Group();
    radGrp.position.set(0, 0.02, L * 0.29);
    rootGrp.add(radGrp);
    const dishMat = radObj.kind.startsWith('aesa') ? M.aesaGold : radObj.kind === 'pesa' ? M.chrome : M.titanium;
    const dishGeo = new THREE.CylinderGeometry(H * 0.36, H * 0.36, 0.045, 18);
    dishGeo.rotateX(Math.PI / 2);
    const dishMesh = new THREE.Mesh(dishGeo, dishMat);
    dishMesh.rotation.x = 0.18;
    const gimbalBack = new THREE.Mesh(new THREE.BoxGeometry(H * 0.55, H * 0.42, 0.12), M.avionicsBlack);
    gimbalBack.position.z = -0.09;
    radGrp.add(dishMesh, gimbalBack);
    sub(dishMesh, [0, 0, L * 0.06]); sub(gimbalBack, [0, 0, -L * 0.04]);
    radGrp.userData = { part: `04 · ${radObj.name}`, cat: 'RADAR', isOuterSkin: false, homePos: radGrp.position.clone(), ex: new THREE.Vector3(0, 0.42, 1.25) };
    explodeList.push(radGrp);
    anim.radar = dishMesh;

    // Forward Avionics Signal-Processor & Mission Computer LRU Rack
    for (let b = 0; b < 3; b++) {
      const lruGeo = new THREE.BoxGeometry(H * 0.58, H * 0.18, 0.11);
      addPart(rootGrp, lruGeo, M.avionicsBlack, `RADAR SIGNAL PROCESSOR & MISSION COMPUTER LRU #${b + 1}`, 'RADAR', false, [0, 0.55 + b * 0.15, 0.95], 0, -H * 0.12 + b * 0.09, L * 0.22);
    }

    // =========================================================================
    // D. INTERNAL SUBSYSTEM BAY 3: COCKPIT TUB, EJECTION SEAT, HOTAS & HUD
    // =========================================================================
    const ckObj = build.cockpit;
    // The cockpit is its own assembly: a dark coaming collar rises out of the fuselage, a sill frame sits on it,
    // and the tinted canopy with its bow frames sits on the sill. It reads as a separate piece joined to the hull.
    const openPit = af.era === 'ww1';
    const ckZ = openPit ? -L * 0.13 : L * 0.12;
    const rimX = H * 0.40, rimZ = H * (openPit ? 0.5 : 1.03), sillY = H * 0.52, floorY = H * 0.49;
    const frameMatCk = openPit ? M.leather : M.canopyFrame;

    addPart(rootGrp, new THREE.BoxGeometry(H * 0.68, H * 0.36, Math.min(L * 0.16, rimZ * 1.9)), M.darkSteel, 'PRESSURIZED ARMORED COCKPIT TUB', 'COCKPIT', false, [0, 0.85, 0.35], 0, H * 0.05, ckZ);

    const floorGeo = new THREE.CircleGeometry(1, 28);
    floorGeo.rotateX(-Math.PI / 2);
    addPart(rootGrp, floorGeo, M.cockpitFloor, 'COCKPIT FLOOR & SIDE CONSOLES', 'COCKPIT', false, [0, 1.0, 0.35], 0, floorY, ckZ).scale.set(rimX * 0.99, 1, rimZ * 0.99);

    const coamGeo = new THREE.CylinderGeometry(1, 1.05, H * 0.22, 32, 1, true);
    addPart(rootGrp, coamGeo, frameMatCk, 'COCKPIT COAMING COLLAR', 'COCKPIT', false, [0, 1.2, 0.35], 0, sillY - H * 0.10, ckZ).scale.set(rimX * 1.05, 1, rimZ * 1.03);

    const sillGeo = new THREE.TorusGeometry(1, 0.05, 8, 40);
    sillGeo.rotateX(Math.PI / 2);
    addPart(rootGrp, sillGeo, frameMatCk, 'CANOPY SILL FRAME & SEAL', 'COCKPIT', false, [0, 1.4, 0.35], 0, sillY, ckZ).scale.set(rimX * 1.02, H * 0.5, rimZ * 1.01);

    const seatMat = openPit ? M.spruceWood : M.gunmetal;
    addPart(rootGrp, new THREE.BoxGeometry(H * 0.34, H * 0.24, 0.05), seatMat, `05 · ${ckObj.name}`, 'COCKPIT', false, [0, 1.18, 0.32], 0, floorY + H * 0.12, ckZ - rimZ * 0.25, -0.22, 0, 0);
    addPart(rootGrp, new THREE.BoxGeometry(H * 0.44, H * 0.12, 0.06), M.avionicsBlack, 'INSTRUMENT PANEL & GLARESHIELD', 'COCKPIT', false, [0, 1.08, 0.52], 0, floorY + H * 0.07, ckZ + rimZ * 0.45);
    addPart(rootGrp, new THREE.BoxGeometry(H * 0.2, H * 0.11, 0.01), M.hudGlass, 'HUD / GUNSIGHT COMBINER GLASS', 'COCKPIT', false, [0, 1.28, 0.58], 0, floorY + H * 0.19, ckZ + rimZ * 0.43, -0.35, 0, 0);

    if (!openPit) {
      const canGeo = new THREE.SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI * 0.5);
      addPart(rootGrp, canGeo, M.canopyGlass, 'TINTED CANOPY TRANSPARENCY', 'COCKPIT', true, [0, 1.6, 0.35], 0, sillY, ckZ).scale.set(rimX, H * 0.30, rimZ);
      for (const dz of [0.42, -0.45]) {
        const f = Math.sqrt(1 - dz * dz);
        const bowGeo = new THREE.TorusGeometry(1, 0.045, 8, 24, Math.PI);
        addPart(rootGrp, bowGeo, M.canopyFrame, dz > 0 ? 'CANOPY FORWARD BOW FRAME' : 'CANOPY AFT BOW FRAME', 'COCKPIT', false, [0, 1.6, 0.35], 0, sillY, ckZ + dz * rimZ)
          .scale.set(rimX * f * 1.015, H * 0.30 * f * 1.015, H * 0.55);
      }
    }

    // =========================================================================
    // E. INTERNAL SUBSYSTEM BAY 4: FLIGHT CONTROL SYSTEM (FCS COMPUTERS & SERVOS)
    // =========================================================================
    const fcsGeo = new THREE.BoxGeometry(H * 0.52, H * 0.22, L * 0.09);
    addPart(rootGrp, fcsGeo, M.hydBlue, `06 · ${build.fcs.name}`, 'FCS', false, [-0.55, 0.72, 0.35], 0, -H * 0.18, L * 0.11);

    // =========================================================================
    // F. INTERNAL SUBSYSTEM BAY 5: FUEL TANKS (FORWARD, MAIN CENTER, SADDLE & WET-WING)
    // =========================================================================
    const fTank1 = new THREE.CylinderGeometry(H * 0.32, H * 0.34, L * 0.14, 12);
    fTank1.rotateX(Math.PI / 2);
    addPart(rootGrp, fTank1, M.fuelBladder, `07 · FORWARD FUSELAGE FUEL CELL (${build.fuelSys.name})`, 'FUEL', false, [0, 0.92, 0.05], 0, H * 0.06, L * 0.01);

    const fTank2 = new THREE.BoxGeometry(H * 0.88, H * 0.46, L * 0.18);
    addPart(rootGrp, fTank2, M.fuelBladder, 'MAIN CENTERLINE SELF-SEALING FUEL BLADDER', 'FUEL', false, [0, 1.05, -0.15], 0, H * 0.08, -L * 0.12);

    // Titanium Fuel Transfer Manifold Pipe
    const pipeGeo = new THREE.CylinderGeometry(0.02, 0.02, L * 0.45, 8);
    pipeGeo.rotateX(Math.PI / 2);
    addPart(rootGrp, pipeGeo, M.brass, 'HIGH-PRESSURE FUEL TRANSFER MANIFOLD LINE', 'FUEL', false, [0.35, 0.82, -0.10], H * 0.22, H * 0.22, -L * 0.05);

    // =========================================================================
    // G. INTERNAL SUBSYSTEM BAY 6 & 7: HYDRAULICS, EHA POWER & OBOGS / ECS BAY
    // =========================================================================
    const hydCyl = new THREE.CylinderGeometry(H * 0.18, H * 0.18, L * 0.14, 12);
    hydCyl.rotateZ(Math.PI / 2);
    addPart(rootGrp, hydCyl, M.hydBlue, `08 · ${build.hydraulics.name}`, 'HYDRAULICS', false, [-0.75, -0.45, -0.15], -H * 0.32, -H * 0.18, -L * 0.08);

    const ecsBox = new THREE.BoxGeometry(H * 0.36, H * 0.26, L * 0.12);
    addPart(rootGrp, ecsBox, M.ecsGreen, `09 · ${build.ecs.name}`, 'ECS', false, [0.75, -0.45, 0.15], H * 0.32, -H * 0.18, L * 0.04);

    // =========================================================================
    // H. INTERNAL SUBSYSTEM BAY 8: INTERNAL GUN, ROTARY BARRELS & AMMO DRUM
    // =========================================================================
    if (build.gunBay.id !== 'clean_no_gun') {
      const gunGrp = new THREE.Group();
      gunGrp.position.set(-H * 0.42, H * 0.04, L * 0.16);
      rootGrp.add(gunGrp);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.22, H * 0.22, L * 0.10, 14), M.brass);
      drum.rotation.z = Math.PI / 2;
      // Barrel cluster: six rotating barrels for Gatling guns, two for twin cannon, one otherwise
      const gName = build.gunBay.name;
      const nB = /6-BARREL|VULCAN|GATLING/.test(gName) ? 6 : /TWIN|2×|6×/.test(gName) ? 2 : 1;
      const barrels = new THREE.Group();
      for (let bI = 0; bI < nB; bI++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, L * 0.12, 8), M.gunmetal);
        br.rotation.x = Math.PI / 2;
        if (nB > 1) br.position.set(Math.cos((bI / nB) * TAU) * 0.024, Math.sin((bI / nB) * TAU) * 0.024, 0);
        barrels.add(br);
      }
      const clamp1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), M.darkSteel);
      clamp1.rotation.x = Math.PI / 2; clamp1.position.z = L * 0.04;
      barrels.add(clamp1);
      barrels.position.z = L * 0.08;
      gunGrp.add(drum, barrels);
      sub(barrels, [0, 0, L * 0.1]);
      gunGrp.userData = { part: `11 · ${build.gunBay.name}`, cat: 'GUN_BAY', isOuterSkin: false, homePos: gunGrp.position.clone(), ex: new THREE.Vector3(-0.95, 0.35, 0.65) };
      explodeList.push(gunGrp);
    }

    // =========================================================================
    // I. INTERNAL SUBSYSTEM BAY 9: DEFENSIVE EW SUITE & CHAFF/FLARE MAGAZINES
    // =========================================================================
    for (const s of [-1, 1]) {
      const ewGeo = new THREE.BoxGeometry(0.08, H * 0.22, L * 0.12);
      addPart(rootGrp, ewGeo, M.ewPurple, `12 · ${build.ewSuite.name} (${s < 0 ? 'PORT' : 'STBD'} ARRAY)`, 'EW_SUITE', false, [s * 0.88, 0.25, -0.75], s * H * 0.58, 0, -L * 0.26);
    }

    // =========================================================================
    // J. INTERNAL SUBSYSTEM BAY 10: RETRACTABLE / FIXED LANDING GEAR & WHEEL WELLS
    // =========================================================================
    const buildGearUnit = (name, gx, gy, gz, exV) => {
      const gGrp = new THREE.Group();
      gGrp.position.set(gx, gy, gz);
      rootGrp.add(gGrp);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, H * 0.58, 10), M.chrome);
      strut.position.y = -H * 0.28;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.18, H * 0.18, 0.055, 16), M.tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = -H * 0.56;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.09, H * 0.09, 0.06, 12), M.duralumin);
      rim.rotation.z = Math.PI / 2;
      rim.position.y = -H * 0.56;
      gGrp.add(strut, wheel, rim);
      sub(wheel, [0, -H * 0.3, 0]); sub(rim, [(gx >= 0 ? 1 : -1) * H * 0.35, -H * 0.3, 0]);
      gGrp.userData = { part: `10 · ${name} (${build.landingGear.name})`, cat: 'LANDING_GEAR', isOuterSkin: false, homePos: gGrp.position.clone(), ex: new THREE.Vector3(exV[0], exV[1], exV[2]) };
      explodeList.push(gGrp);
    };
    buildGearUnit('NOSE / FORWARD OLEO GEAR', 0, -H * 0.22, L * 0.20, [0, -1.25, 0.55]);
    buildGearUnit('PORT MAIN LANDING GEAR', -H * 0.72, -H * 0.22, -L * 0.08, [-0.85, -1.25, -0.15]);
    buildGearUnit('STARBOARD MAIN LANDING GEAR', H * 0.72, -H * 0.22, -L * 0.08, [0.85, -1.25, -0.15]);

    // =========================================================================
    // K. INTERNAL SUBSYSTEM BAY 11: MULTI-STAGE TURBINE / PISTON ENGINE CORE
    // =========================================================================
    if (af.propType === 'nose_prop') {
      // Detailed V12 / Radial Piston Cylinder Block + Spinning Multi-Blade Propeller
      const blkGeo = eng.kind === 'piston_radial'
        ? new THREE.CylinderGeometry(H * 0.55, H * 0.55, L * 0.14, 9)
        : new THREE.BoxGeometry(H * 0.52, H * 0.58, L * 0.22);
      if (eng.kind === 'piston_radial') blkGeo.rotateX(Math.PI / 2);
      addPart(rootGrp, blkGeo, M.darkSteel, `03 · ${eng.name} CYLINDER BLOCK & SUPERCHARGER`, 'PROPULSION', false, [0, 0.45, 1.05], 0, 0.02, L * 0.28);

      // Exhaust stacks
      for (const s of [-1, 1]) {
        const exStack = new THREE.BoxGeometry(0.06, 0.05, L * 0.18);
        addPart(rootGrp, exStack, M.copper, 'INCONEL EXHAUST MANIFOLD STACKS', 'PROPULSION', false, [s * 0.75, 0.2, 1.05], s * H * 0.38, 0.04, L * 0.28);
      }

      // Spinning Propeller + Spinner Cone
      const propGrp = new THREE.Group();
      propGrp.position.set(0, 0, L * 0.45);
      rootGrp.add(propGrp);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(H * 0.24, H * 0.45, 16), M.accent);
      spinner.rotation.x = Math.PI / 2;
      propGrp.add(spinner);
      sub(spinner, [0, 0, L * 0.08]);
      const nBlades = af.era === 'ww1' ? 2 : 4;
      const bladeMat = af.era === 'ww1' ? M.spruceWood : M.gunmetal;
      for (let b = 0; b < nBlades; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(H * 1.85, 0.065, 0.018), bladeMat);
        bl.rotation.z = (b / nBlades) * Math.PI;
        bl.rotation.x = 0.22;
        propGrp.add(bl);
      }
      propGrp.userData = { part: 'CONSTANT-SPEED PROPELLER & SPINNER ASSEMBLY', cat: 'PROPULSION', isOuterSkin: false, homePos: propGrp.position.clone(), ex: new THREE.Vector3(0, 0, 1.75) };
      explodeList.push(propGrp);
      anim.props.push(propGrp);
    } else {
      // Multi-Stage Axial / Centrifugal Jet Engine(s): LPC Fan -> 5 HPC Discs -> Combustor -> HPT -> Afterburner -> TVC Nozzle
      const nEng = build.propulsion.nEng;
      const engOffsets = nEng === 2 ? [-H * 0.45, H * 0.45] : [0];
      const engR = H * (nEng === 2 ? 0.35 : 0.40);

      engOffsets.forEach((exX, idx) => {
        const sgn = exX < 0 ? -1 : exX > 0 ? 1 : 0;

        // 1. Rotating LPC Titanium Blisk Fan Stage
        const fanGrp = new THREE.Group();
        fanGrp.position.set(exX, 0, L * 0.02);
        rootGrp.add(fanGrp);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(engR * 0.34, engR * 0.72, 14), M.titanium);
        cone.rotation.x = Math.PI / 2;
        fanGrp.add(cone);
        sub(cone, [0, 0, L * 0.05]);
        for (let b = 0; b < 14; b++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(engR * 0.90, 0.015, engR * 0.22), M.chrome);
          bl.rotation.z = (b / 14) * TAU;
          bl.rotation.x = 0.42;
          fanGrp.add(bl);
        }
        fanGrp.userData = { part: `LOW-PRESSURE TITANIUM FAN BLISK #${idx + 1}`, cat: 'PROPULSION', isOuterSkin: false, homePos: fanGrp.position.clone(), ex: new THREE.Vector3(sgn * 0.45, -0.35, 0.52) };
        explodeList.push(fanGrp);
        anim.fans.push(fanGrp);

        // 2. 4 Individual High-Pressure Compressor (HPC) Rotor Discs
        for (let stg = 0; stg < 4; stg++) {
          const rDisc = engR * (0.86 - stg * 0.035);
          const dGeo = new THREE.CylinderGeometry(rDisc, rDisc, L * 0.032, 16);
          dGeo.rotateX(Math.PI / 2);
          addPart(rootGrp, dGeo, M.titanium, `HPC COMPRESSOR STAGE ${stg + 1} ROTOR DISC (ENG #${idx + 1})`, 'PROPULSION', false, [sgn * (0.52 + stg * 0.05), -0.45 - stg * 0.08, -0.25 - stg * 0.12], exX, 0, -L * (0.04 + stg * 0.045));
        }

        // 3. Annular Inconel Combustion Chamber & Fuel Injectors
        const combGeo = new THREE.CylinderGeometry(engR * 0.82, engR * 0.85, L * 0.09, 16);
        combGeo.rotateX(Math.PI / 2);
        addPart(rootGrp, combGeo, M.copper, `ANNULAR INCONEL COMBUSTION CHAMBER #${idx + 1}`, 'PROPULSION', false, [sgn * 0.72, -0.72, -0.78], exX, 0, -L * 0.23);

        // 4. Single-Crystal High-Pressure Turbine (HPT) & Low-Pressure Turbine (LPT)
        const hptGeo = new THREE.CylinderGeometry(engR * 0.88, engR * 0.84, L * 0.06, 16);
        hptGeo.rotateX(Math.PI / 2);
        addPart(rootGrp, hptGeo, M.brass, `SINGLE-CRYSTAL HPT / LPT TURBINE ROTOR #${idx + 1}`, 'PROPULSION', false, [sgn * 0.78, -0.58, -0.98], exX, 0, -L * 0.30);

        // 5. Variable-Geometry Thrust-Vectoring Exhaust Nozzle
        const nozGeo = new THREE.CylinderGeometry(engR * 0.76, engR * 0.96, L * 0.11, 14);
        nozGeo.rotateX(Math.PI / 2);
        const nozMesh = addPart(rootGrp, nozGeo, M.gunmetal, `SERRATED THRUST-VECTORING NOZZLE #${idx + 1}`, 'PROPULSION', false, [sgn * 0.65, -0.25, -1.35], exX, 0, -L * 0.365);
        anim.nozzles.push(nozMesh);

        // 6. Volumetric Shock-Diamond Afterburner Plume
        const plumeGrp = new THREE.Group();
        plumeGrp.position.set(exX, 0, -L * 0.42);
        const outerCone = new THREE.Mesh(new THREE.ConeGeometry(engR * 0.74, L * 0.48, 16, 1, true), M.abOuter);
        outerCone.rotation.x = -Math.PI / 2;
        outerCone.position.z = -L * 0.24;
        const innerCone = new THREE.Mesh(new THREE.ConeGeometry(engR * 0.46, L * 0.32, 14), M.abCore);
        innerCone.rotation.x = -Math.PI / 2;
        innerCone.position.z = -L * 0.16;
        plumeGrp.add(outerCone, innerCone);
        for (let d = 0; d < 4; d++) {
          const dia = new THREE.Mesh(new THREE.OctahedronGeometry(engR * (0.28 - d * 0.045), 0), M.abBlue);
          dia.scale.set(1, 1, 1.8);
          dia.position.z = -L * (0.07 + d * 0.085);
          plumeGrp.add(dia);
        }
        plumeGrp.visible = !!cfg.afterburner;
        rootGrp.add(plumeGrp);
        anim.plumes.push(plumeGrp);
      });
    }

    // =========================================================================
    // L. WINGS, INTERNAL WING SPARS, BIPLANE STRUTS & CONTROL SURFACES
    // =========================================================================
    const halfSpan = Math.max(0.85, W * 0.5 - H * 0.68);
    const rootChord = L * (af.config === 'tailless_stealth' ? 0.68 : af.config === 'delta_canard' || af.config === 'shock_cone_delta' ? 0.56 : af.config === 'biplane' ? 0.30 : 0.44);
    const tipChord = rootChord * af.taper;
    const tipZOffset = -Math.tan(sweepRad) * halfSpan;

    const buildWingPair = (yLevel, labelPrefix, exY) => {
      for (const s of [-1, 1]) {
        const side = s < 0 ? 'PORT' : 'STBD';
        // One pivot per wing half: the skin, spar, fuel cell and flaperon share the same dihedral,
        // so the internal parts always sit inside the wing slab.
        const wg = new THREE.Group();
        wg.position.set(s * H * 0.68, yLevel, -L * 0.04);
        wg.rotation.z = s * af.dihedralDeg * DEG;
        rootGrp.add(wg);

        const sparLen = Math.hypot(halfSpan, tipZOffset) * 0.9;
        const sparAng = Math.atan2(tipZOffset, s * halfSpan);
        addPart(wg, new THREE.BoxGeometry(sparLen, 0.022, 0.03), frameMat, `${side} ${labelPrefix} MAIN WING SPAR`, 'STRUCTURE', false,
          [s * 1.15, exY + 0.25, -0.05], s * halfSpan * 0.48, 0, tipZOffset * 0.48, 0, -sparAng, 0);

        if (af.era !== 'ww1') {
          addPart(wg, new THREE.BoxGeometry(halfSpan * 0.42, 0.02, rootChord * 0.24), M.fuelBladder, `${side} WET-WING INTEGRAL FUEL TANK`, 'FUEL', false,
            [s * 1.05, exY + 0.45, -0.05], s * halfSpan * 0.30, 0, tipZOffset * 0.30 - rootChord * 0.04, 0, -sparAng, 0);
        }

        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, rootChord * 0.45);
        wingShape.lineTo(s * halfSpan, tipZOffset + tipChord * 0.45);
        wingShape.lineTo(s * halfSpan, tipZOffset - tipChord * 0.55);
        wingShape.lineTo(0, -rootChord * 0.55);
        wingShape.closePath();
        const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.010, bevelSegments: 2 });
        wingGeo.rotateX(Math.PI / 2);
        addPart(wg, wingGeo, M.skinPrimary, `${side} ${labelPrefix} WING SKIN PANEL`, 'AIRFRAME', true, [s * 1.35, exY, -0.10], 0, 0.018, 0);

        // Flaperon sits on the trailing edge and is slightly thicker than the wing, so the two never share a surface
        const flapChord = rootChord * 0.13;
        const teRootZ = -rootChord * 0.55, teTipZ = tipZOffset - tipChord * 0.55;
        const teAng = Math.atan2(teTipZ - teRootZ, s * halfSpan);
        const flapMesh = addPart(wg, new THREE.BoxGeometry(halfSpan * 0.46, 0.062, flapChord), M.skinSecondary, `${side} ${labelPrefix} FLAPERON / AILERON`, 'FCS', false,
          [s * 1.45, exY - 0.15, -0.55], s * halfSpan * 0.5, 0, teRootZ + (teTipZ - teRootZ) * 0.5 + flapChord * 0.45, 0, -teAng, 0);
        anim.surfaces.push({ mesh: flapMesh, side: s });
      }
    };

    if (af.config === 'biplane') {
      // Upper Parasol Wing + Lower Wing + Interplane N-Struts & Rigging Wires
      buildWingPair(H * 0.72, 'UPPER BIPLANE', 0.65);
      buildWingPair(-H * 0.32, 'LOWER BIPLANE', -0.45);
      for (const s of [-1, 1]) {
        for (const frac of [0.35, 0.78]) {
          const strutGeo = new THREE.CylinderGeometry(0.016, 0.016, H * 1.05, 8);
          addPart(rootGrp, strutGeo, M.spruceWood, 'SPRUCE INTERPLANE CABANE / N-STRUT', 'STRUCTURE', false, [s * 1.25, 0.1, 0], s * (H * 0.68 + halfSpan * frac), H * 0.20, -L * 0.04);
        }
      }
    } else {
      buildWingPair(0.02, 'MAIN', 0.12);
    }

    // Active Canards (J-20, J-10C, Su-35/57)
    if (af.canards) {
      for (const s of [-1, 1]) {
        const canShape = new THREE.Shape();
        canShape.moveTo(0, 0.22);
        canShape.lineTo(s * halfSpan * 0.32, -0.05);
        canShape.lineTo(s * halfSpan * 0.32, -0.22);
        canShape.lineTo(0, -0.18);
        canShape.closePath();
        const canGeo = new THREE.ExtrudeGeometry(canShape, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005 });
        canGeo.rotateX(Math.PI / 2);
        const cm = addPart(rootGrp, canGeo, M.skinSecondary, `${s < 0 ? 'PORT' : 'STBD'} ALL-MOVING FOREPLANE CANARD`, 'FCS', false, [s * 1.05, 0.25, 0.45], s * H * 0.82, H * 0.08, L * 0.16);
        anim.canards.push({ mesh: cm, side: s });
      }
    }

    // Vertical & Horizontal Tail Stabilizers
    if (af.tailType !== 'tailless') {
      const tailH = H * 2.1;
      const tailChord = L * 0.21;
      const buildFin = (s, cantRad, xOff) => {
        const tShape = new THREE.Shape();
        tShape.moveTo(0, 0);
        tShape.lineTo(-tailChord * 0.55, tailH);
        tShape.lineTo(-tailChord * 1.12, tailH);
        tShape.lineTo(-tailChord, 0);
        tShape.closePath();
        const tGeo = new THREE.ExtrudeGeometry(tShape, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006 });
        tGeo.rotateY(Math.PI / 2);
        addPart(rootGrp, tGeo, M.skinPrimary, `${s === 0 ? 'CENTER' : s < 0 ? 'PORT' : 'STBD'} VERTICAL STABILIZER & RUDDER`, 'FCS', false, [s * 0.75, 0.95, -0.75], xOff, H * 0.20, -L * 0.24, 0, 0, -s * cantRad);
      };
      if (af.tailType.startsWith('single') || af.tailType === 't_tail_swept') {
        buildFin(0, 0, 0);
      } else {
        const cant = af.tailType === 'twin_canted' ? 0.34 : 0.04;
        for (const s of [-1, 1]) buildFin(s, cant, s * H * 0.70);
      }
    }

    // =========================================================================
    // M. SUBSYSTEM BAY 12: 5 MODULAR ORDNANCE STATIONS
    // =========================================================================
    const dihRise = Math.sin(af.dihedralDeg * DEG) * halfSpan; // stores follow the wing's dihedral
    const stationCoords = {
      bay:    { x: 0,                    y: -H * 0.42, z: -L * 0.02, ex: [0, -1.35, 0] },
      innerL: { x: -(H * 0.68 + halfSpan * 0.36), y: -0.06 + dihRise * 0.36, z: -L * 0.04 + tipZOffset * 0.35, ex: [-1.05, -0.95, 0.1] },
      innerR: { x:  (H * 0.68 + halfSpan * 0.36), y: -0.06 + dihRise * 0.36, z: -L * 0.04 + tipZOffset * 0.35, ex: [ 1.05, -0.95, 0.1] },
      tipL:   { x: -(H * 0.68 + halfSpan * 0.96), y: dihRise * 0.96, z: -L * 0.04 + tipZOffset * 0.94, ex: [-1.55, -0.45, 0.1] },
      tipR:   { x:  (H * 0.68 + halfSpan * 0.96), y: dihRise * 0.96, z: -L * 0.04 + tipZOffset * 0.94, ex: [ 1.55, -0.45, 0.1] },
    };

    P.STATIONS.forEach((st) => {
      const p = build.stations[st];
      if (!p || p.id === 'none') return;
      const sc = stationCoords[st];
      const storeGrp = new THREE.Group();
      storeGrp.position.set(sc.x, sc.y, sc.z);
      rootGrp.add(storeGrp);

      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, L * 0.11), M.titanium);
      pylon.position.y = 0.035;
      pylon.castShadow = true;
      storeGrp.add(pylon);

      // The store itself is a detailed model (seeker, guidance section, body, bands, wings, fins, nozzle...)
      const store = buildStore3D(THREE, p.kind);
      const mLen = L * ({ strike: 0.26, fuel: 0.28, bvr_msl: 0.2, wvr_msl: 0.16 }[p.kind] || 0.2);
      store.group.scale.setScalar(mLen);
      store.group.position.y = -store.radius * mLen - 0.004;
      storeGrp.add(store.group);
      store.group.children.forEach((c) => { if (c.userData.sub) subList.push(c); });

      storeGrp.userData = {
        part: `13 · ${P.STATION_NAMES[st]} · ${p.name}`,
        cat: 'ORDNANCE',
        isOuterSkin: false,
        homePos: storeGrp.position.clone(),
        ex: new THREE.Vector3(sc.ex[0], sc.ex[1], sc.ex[2]),
      };
      explodeList.push(storeGrp);
    });

    // =========================================================================
    // N. 3D WIND-TUNNEL CFD STREAMLINES & MACH SHOCK CONE
    // =========================================================================
    const cfdGrp = new THREE.Group();
    cfdGrp.visible = !!opts.showCfd;
    rootGrp.add(cfdGrp);

    const mach = Math.max(1.02, cfg.machTest);
    const coneHalfAngle = Math.asin(1 / clamp(mach, 1.02, 4.5));
    const coneLen = L * 1.35;
    const coneRad = Math.tan(coneHalfAngle) * coneLen;
    const shockGeo = new THREE.ConeGeometry(clamp(coneRad, H * 1.2, L * 1.6), coneLen, 28, 1, true);
    shockGeo.rotateX(-Math.PI / 2);
    const shockMat = glow('#38bdf8', cfg.machTest >= 1.0 ? 0.16 : 0.0);
    const shockMesh = new THREE.Mesh(shockGeo, shockMat);
    shockMesh.position.set(0, 0, L * 0.48 - coneLen * 0.5);
    cfdGrp.add(shockMesh);
    anim.shockCone = shockMesh;

    for (let i = -8; i <= 8; i++) {
      if (i === 0) continue;
      const x0 = (i / 8) * (W * 0.52);
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        const z = L * 0.75 - u * L * 1.65;
        const overWing = Math.exp(-Math.pow((z + L * 0.05) / (L * 0.25), 2));
        const liftDeflect = overWing * (0.12 + cfg.aoaDeg * 0.012) * (1 - Math.abs(i) / 10);
        const tipVortex = Math.abs(i) >= 7 && z < 0 ? Math.sin(u * 18) * 0.06 : 0;
        pts.push(new THREE.Vector3(x0 + tipVortex, H * 0.08 + liftDeflect, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 28, 0.012, 5, false);
      const tubeMat = glow(Math.abs(i) <= 3 ? '#f97316' : '#22d3ee', 0.54);
      cfdGrp.add(new THREE.Mesh(tubeGeo, tubeMat));
    }
    anim.cfdLines = cfdGrp;

    // ---- Solid airframe -----------------------------------------------------------------------
    // Closed: everything that lives inside the hull or wings is hidden.
    // X-ray: the skin turns to glass and an outline mask of the airframe is drawn into the stencil
    //        buffer first, so internal parts are only ever drawn inside the airframe's outline.
    // Teardown: parts are meant to leave the airframe, so the mask is switched off.
    const INTERNAL_CATS = { FUEL: 1, HYDRAULICS: 1, ECS: 1, GUN_BAY: 1, EW_SUITE: 1 };
    function isInternalPart(ud) {
      if (!ud || ud.isOuterSkin) return false;
      const name = ud.part || '';
      if (INTERNAL_CATS[ud.cat]) return true;
      if (ud.cat === 'STRUCTURE') return !/STRUT/.test(name);
      if (ud.cat === 'RADAR') return !/RADOME/.test(name);
      if (ud.cat === 'FCS') return /^06/.test(name);
      if (ud.cat === 'PROPULSION') return !/NOZZLE|PROPELLER|EXHAUST/.test(name);
      return false;
    }

    const skinMeshes = meshes.filter((m) => m.userData && m.userData.isOuterSkin);
    for (const sm of skinMeshes) {
      sm.userData.baseOpacity = sm.material.opacity;
      sm.userData.baseTransparent = sm.material.transparent;
    }
    const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    maskMat.stencilWrite = true;
    maskMat.stencilRef = 1;
    maskMat.stencilFunc = THREE.AlwaysStencilFunc;
    maskMat.stencilFail = maskMat.stencilZFail = maskMat.stencilZPass = THREE.ReplaceStencilOp;
    const masks = skinMeshes.map((sm) => {
      const mk = new THREE.Mesh(sm.geometry, maskMat);
      mk.renderOrder = -10;   // drawn before everything else
      mk.visible = false;
      sm.add(mk);
      return mk;
    });

    const internalMats = [];
    const matCache = new Map();
    for (const obj of explodeList) {
      obj.userData.internal = isInternalPart(obj.userData);
      if (!obj.userData.internal) continue;
      obj.traverse((n) => {
        if (!n.isMesh) return;
        let cm = matCache.get(n.material);
        if (!cm) {
          cm = n.material.clone();
          cm.stencilWrite = true;
          cm.stencilRef = 1;
          cm.stencilFunc = THREE.AlwaysStencilFunc;
          matCache.set(n.material, cm);
          internalMats.push(cm);
        }
        n.material = cm;
        n.renderOrder = 2;
      });
    }

    const view = { xray: false, teardown: 0 };
    function refreshView() {
      const open = view.teardown > 0.02;
      const show = view.xray || open;
      const contain = view.xray && !open;
      for (const obj of explodeList) if (obj.userData.internal) obj.visible = show;
      for (const mk of masks) mk.visible = contain;
      for (const cm of internalMats) cm.stencilFunc = contain ? THREE.EqualStencilFunc : THREE.AlwaysStencilFunc;
      for (const sm of skinMeshes) {
        const mt = sm.material;
        mt.transparent = view.xray ? true : sm.userData.baseTransparent;
        mt.opacity = view.xray ? 0.18 : sm.userData.baseOpacity;
        mt.depthWrite = !view.xray && !sm.userData.baseTransparent;
        mt.needsUpdate = true;
      }
    }
    function setXray(on) { view.xray = !!on; refreshView(); }

    function setTeardown(amount) {
      const a = P.clamp(amount, 0, 1);
      view.teardown = a;
      for (const obj of explodeList) {
        const ud = obj.userData;
        if (!ud || !ud.homePos || !ud.ex) continue;
        obj.position.copy(ud.homePos).addScaledVector(ud.ex, a * L * 0.55);
      }
      for (const sp of subList) sp.position.copy(sp.userData.sub.home).addScaledVector(sp.userData.sub.ex, a);
      refreshView();
    }
    refreshView();

    function stepAnimation(t, stateOpts) {
      stateOpts = stateOpts || {};
      for (const pr of anim.props) pr.rotation.z = t * 28;
      const spinRate = stateOpts.afterburner !== false ? 22 : 12;
      for (const f of anim.fans) f.rotation.z = t * spinRate;
      for (const p of anim.plumes) {
        p.visible = !build.propulsion.isPiston && stateOpts.afterburner !== false;
        const pulse = 0.92 + 0.14 * Math.sin(t * 38);
        p.scale.set(1, 1, pulse);
      }
      for (const n of anim.nozzles) {
        n.rotation.x = Math.sin(t * 2.4) * (eng.tvcDeg * DEG * 0.35);
      }
      for (const c of anim.canards) c.mesh.rotation.x = Math.sin(t * 0.9) * 0.05;
      for (const s of anim.surfaces) s.mesh.rotation.x = Math.sin(t * 1.1) * 0.05 * s.side;
      if (anim.radar) anim.radar.rotation.y = Math.sin(t * 3.1) * 0.35;
      if (anim.cfdLines) anim.cfdLines.visible = !!stateOpts.showCfd;
    }

    return { root: rootGrp, meshes, explodeList, anim, setTeardown, setXray, stepAnimation, scaleLength: L, scaleSpan: W, groundY: -0.96 * H };
  }

  /**
   * Detailed weapon / pod model, one unit long, centred on the origin with its nose toward +Z.
   * Every section is a separate mesh carrying its own teardown offset (userData.sub).
   * kind: 'bvr_msl' | 'wvr_msl' | 'strike' | 'fuel' | 'de_laser' | 'ew_ecm'
   */
  function buildStore3D(THREE, kind) {
    const g = new THREE.Group();
    const mk = (color, rough, metal) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
    const M = {
      body: mk('#e6e9ec', 0.45, 0.2), grey: mk('#8d949c', 0.5, 0.4), dark: mk('#262b33', 0.5, 0.55), steel: mk('#b8bec6', 0.3, 0.85),
      nozzle: mk('#14161a', 0.6, 0.6), radome: mk('#d9d2bd', 0.55, 0.05), glass: mk('#0c1118', 0.05, 0.9),
      yellow: mk('#e0b316', 0.6, 0.1), brown: mk('#7a4a22', 0.6, 0.1), pod: mk('#59616b', 0.5, 0.4),
    };
    const put = (geo, mat, x, y, z, ex) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.sub = { home: m.position.clone(), ex: new THREE.Vector3(ex[0], ex[1], ex[2]) };
      g.add(m);
      return m;
    };
    const tube = (rFront, rBack, len) => { const c = new THREE.CylinderGeometry(rFront, rBack, len, 16); c.rotateX(Math.PI / 2); return c; };
    const ogive = (r, len) => {   // base at z = 0, tip at z = len
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(Math.max(0.0002, r * (1 - Math.pow(t, 2.2))), t * len)); }
      const l = new THREE.LatheGeometry(pts, 16);
      l.rotateX(Math.PI / 2);
      return l;
    };
    const fins = (n, r, span, chord, sweep, z, mat, ex, phase) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, -chord / 2); sh.lineTo(0, chord / 2); sh.lineTo(span, chord / 2 - sweep); sh.lineTo(span, -chord / 2); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0.002, 0);
      for (let k = 0; k < n; k++) {
        const a = phase + (k / n) * TAU;
        put(geo, mat, Math.cos(a) * r, Math.sin(a) * r, z, [Math.cos(a) * ex, Math.sin(a) * ex, -0.03]).rotation.z = a;
      }
    };
    let R;
    if (kind === 'bvr_msl') {            // radar-guided: ogive radome, guidance section, mid-body wings, tail fins
      R = 0.026;
      put(ogive(R, 0.14), M.radome, 0, 0, 0.36, [0, 0, 0.30]);
      put(tube(R, R, 0.08), M.grey, 0, 0, 0.32, [0, 0, 0.18]);
      put(tube(R, R, 0.72), M.body, 0, 0, -0.08, [0, 0, 0]);
      put(tube(R * 1.04, R * 1.04, 0.02), M.yellow, 0, 0, 0.14, [0, 0, 0.07]);
      put(tube(R * 1.04, R * 1.04, 0.02), M.brown, 0, 0, -0.16, [0, 0, -0.07]);
      fins(4, R, 0.05, 0.17, 0.07, -0.02, M.grey, 0.12, Math.PI / 4);
      fins(4, R, 0.055, 0.09, 0.03, -0.39, M.steel, 0.14, Math.PI / 4);
      put(tube(R * 0.8, R * 0.62, 0.06), M.nozzle, 0, 0, -0.47, [0, 0, -0.25]);
    } else if (kind === 'wvr_msl') {     // heat-seeking: glass seeker dome, nose canards, large tail fins
      R = 0.022;
      put(new THREE.SphereGeometry(R, 14, 10), M.glass, 0, 0, 0.455, [0, 0, 0.34]);
      put(tube(R, R, 0.07), M.steel, 0, 0, 0.42, [0, 0, 0.2]);
      fins(4, R, 0.04, 0.07, 0.04, 0.36, M.steel, 0.1, Math.PI / 4);
      put(tube(R, R, 0.83), M.body, 0, 0, -0.03, [0, 0, 0]);
      put(tube(R * 1.04, R * 1.04, 0.02), M.yellow, 0, 0, 0.2, [0, 0, 0.07]);
      put(tube(R * 1.04, R * 1.04, 0.02), M.brown, 0, 0, -0.1, [0, 0, -0.07]);
      fins(4, R, 0.075, 0.15, 0.07, -0.36, M.grey, 0.14, Math.PI / 4);
      put(tube(R * 0.8, R * 0.62, 0.06), M.nozzle, 0, 0, -0.47, [0, 0, -0.25]);
    } else if (kind === 'strike') {      // bomb / cruise missile: ogive nose, warhead band, wing kit, boat-tail with fins
      R = 0.07;
      put(ogive(R, 0.2), M.pod, 0, 0, 0.26, [0, 0, 0.3]);
      put(tube(R, R, 0.62), M.pod, 0, 0, -0.05, [0, 0, 0]);
      put(tube(R * 1.03, R * 1.03, 0.025), M.yellow, 0, 0, 0.18, [0, 0, 0.08]);
      put(new THREE.BoxGeometry(0.44, 0.006, 0.08), M.dark, 0, R * 0.92, -0.02, [0, 0.2, 0]);
      put(tube(R, R * 0.45, 0.14), M.grey, 0, 0, -0.43, [0, 0, -0.2]);
      fins(4, R * 0.6, 0.085, 0.13, 0.05, -0.42, M.dark, 0.13, Math.PI / 4);
    } else if (kind === 'fuel') {        // drop tank: streamlined body with three stabilising fins
      R = 0.085;
      const pts = [];
      for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(new THREE.Vector2(Math.max(0.0002, R * Math.pow(Math.sin(Math.PI * t), 0.6)), t - 0.5)); }
      const body = new THREE.LatheGeometry(pts, 18);
      body.rotateX(Math.PI / 2);
      put(body, M.grey, 0, 0, 0, [0, 0, 0]);
      put(tube(R * 1.01, R * 1.01, 0.012), M.dark, 0, 0, 0.02, [0, 0, 0.1]);
      fins(3, R * 0.5, 0.07, 0.12, 0.05, -0.37, M.grey, 0.12, Math.PI / 6);
    } else {                             // sensor / laser / jammer pod
      R = 0.06;
      put(tube(R, R, 0.62), M.pod, 0, 0, 0, [0, 0, 0]);
      const laser = kind === 'de_laser';
      put(new THREE.SphereGeometry(R, 14, 10), laser ? M.glass : M.radome, 0, 0, 0.31, [0, 0, 0.25]).scale.z = 1.6;
      put(new THREE.SphereGeometry(R, 14, 10), laser ? M.pod : M.radome, 0, 0, -0.31, [0, 0, -0.25]).scale.z = 1.6;
      if (laser) {
        put(new THREE.SphereGeometry(R * 0.7, 14, 10), M.glass, 0, -R * 0.75, 0.2, [0, -0.15, 0.1]);
        put(new THREE.BoxGeometry(R * 1.2, R * 0.5, 0.12), M.dark, 0, -R * 0.85, -0.12, [0, -0.15, -0.05]);
      } else {
        for (const z of [0.15, -0.15]) put(new THREE.BoxGeometry(0.004, 0.06, 0.08), M.dark, 0, -R - 0.03, z, [0, -0.14, 0]);
      }
    }
    return { group: g, radius: R };
  }

  const API = { buildAircraft3D, buildStore3D };
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.AFModels = API;
})(typeof self !== 'undefined' ? self : this);
