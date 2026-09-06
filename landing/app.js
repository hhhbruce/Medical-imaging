(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none)').matches;
  const canvas = $('#gl');
  const status = $('#preloader-status');
  const bar = $('#preloader-bar');
  const pct = $('#preloader-pct');
  const rand = (seed) => { let n = seed >>> 0; return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const R = rand(9137);

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function radialTexture(inner, outer, size = 256) {
    const c = makeCanvas(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner); g.addColorStop(.3, inner); g.addColorStop(.7, outer); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, size, size); return c;
  }
  function texture(c, options = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = options.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; if (options.repeat) t.repeat.set(...options.repeat); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; }
  function noiseTexture(w, h, seed, tint) {
    const c = makeCanvas(w, h), x = c.getContext('2d'), im = x.createImageData(w, h), r = rand(seed);
    const col = tint || [90, 150, 155];
    for (let i = 0; i < w * h; i++) { const n = r(); im.data[i * 4] = col[0] * (.35 + n * .65); im.data[i * 4 + 1] = col[1] * (.35 + n * .65); im.data[i * 4 + 2] = col[2] * (.35 + n * .65); im.data[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  }
  function gridTexture(size = 512) {
    const c = makeCanvas(size, size), x = c.getContext('2d'); x.fillStyle = '#071118'; x.fillRect(0, 0, size, size); x.strokeStyle = 'rgba(83,175,177,.14)'; x.lineWidth = 1;
    for (let i = 0; i <= size; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, size); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(size, i); x.stroke(); }
    x.strokeStyle = 'rgba(101,215,208,.1)'; for (let i = 0; i <= size; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, size); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(size, i); x.stroke(); }
    return c;
  }
  function glowSprite(color, size = 256) { return texture(radialTexture(`rgba(${color},.95)`, `rgba(${color},.08)`, size)); }
  function lineMaterial(color, opacity = 1) { return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false }); }
  function addBox(group, size, pos, material, rotation) { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.set(...pos); if (rotation) m.rotation.set(...rotation); group.add(m); return m; }

  let renderer, scene, camera, clock = 0, frames = 0, running = false;
  const WORLD = { movers: [], pulses: [], points: [], cards: [] };
  const RIG = { progress: 0, smooth: 0, mx: 0, my: 0, tx: 0, ty: 0, focus: -1, focusAmt: 0 };
  const CAM = [
    { p: [0, 7, 17], t: [0, 8, -24], f: 37 },
    { p: [-8, 5, 8], t: [0, 7, -25], f: 43 },
    { p: [8, 5, -3], t: [0, 8, -25], f: 42 },
    { p: [7, 4, -12], t: [-1, 7, -30], f: 45 },
    { p: [0, 11, -9], t: [0, 9, -31], f: 42 },
    { p: [0, 8, -4], t: [0, 8, -37], f: 39 }
  ];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), t0 = new THREE.Vector3(), t1 = new THREE.Vector3();

  function initGL() {
    if (!window.THREE || !canvas.getContext) throw new Error('Three.js is unavailable');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.8)); renderer.setSize(innerWidth, innerHeight, true); renderer.setClearColor(0x050a10, 1);
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050a10); scene.fog = new THREE.FogExp2(0x07121a, .018);
    camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 220); scene.add(camera);
  }

  function buildEnvironment() {
    const floorMat = new THREE.MeshStandardMaterial({ map: texture(gridTexture(), { repeat: [10, 16] }), color: 0x526c70, roughness: .76, metalness: .28, transparent: true, opacity: .72 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 190), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, -3.2, -45); scene.add(floor);
    const grid = new THREE.GridHelper(150, 60, 0x21585b, 0x153237); grid.position.set(0, -3.12, -45); grid.material.transparent = true; grid.material.opacity = .25; scene.add(grid);
    const wallMat = new THREE.MeshStandardMaterial({ map: texture(noiseTexture(256, 256, 771, [24, 56, 62]), { repeat: [4, 5] }), color: 0x58797b, roughness: .88, metalness: .15 });
    addBox(scene, [80, 34, 1], [0, 14, -68], wallMat); addBox(scene, [1, 34, 80], [-40, 14, -28], wallMat); addBox(scene, [1, 34, 80], [40, 14, -28], wallMat);
    const cyan = new THREE.MeshBasicMaterial({ color: 0x56d6d0, transparent: true, opacity: .45, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 18; i++) { const y = -2.5 + i * 1.7; const line = new THREE.Mesh(new THREE.BoxGeometry(52 - i * .7, .012, .012), cyan); line.position.set(0, y, -66 + i * .015); scene.add(line); }
  }

  function buildPortal() {
    const group = new THREE.Group(); group.position.set(0, 8, -43); scene.add(group); WORLD.portal = group;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite('54,210,204'), color: 0x4ad5ce, transparent: true, opacity: .21, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(22, 22, 1); glow.position.z = .8; group.add(glow);
    [6, 7.2, 8.4].forEach((r, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .035 + i * .018, 8, 128), new THREE.MeshBasicMaterial({ color: i === 2 ? 0x9deae2 : 0x2eb5b1, transparent: true, opacity: .82 - i * .16, blending: THREE.AdditiveBlending })); ring.rotation.x = 0; ring.userData.speed = (i + 1) * .06; group.add(ring); WORLD.movers.push(ring); });
    const inner = new THREE.Mesh(new THREE.CircleGeometry(5.7, 64), new THREE.MeshBasicMaterial({ color: 0x0b242d, transparent: true, opacity: .67, side: THREE.DoubleSide })); inner.position.z = -.08; group.add(inner);
    const cross = new THREE.Group(); const lm = lineMaterial(0x7fe6dc, .43); [new THREE.BoxGeometry(16,.012,.012), new THREE.BoxGeometry(.012,16,.012)].forEach((geo, i) => { const m = new THREE.Mesh(geo, lm); cross.add(m); }); cross.position.z = .12; cross.scale.set(.6,.6,.6); group.add(cross);
  }

  function buildGantry() {
    const g = new THREE.Group(); g.position.set(0, 0, -30); scene.add(g); const metal = new THREE.MeshStandardMaterial({ color: 0x314d53, metalness: .86, roughness: .26 }); const edge = lineMaterial(0x6bd8d2, .65);
    [[-14, 7, 0], [14, 7, 0]].forEach(p => { addBox(g, [1.1, 20, 1.1], p, metal); const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1,20,1.1)), edge); e.position.set(...p); g.add(e); });
    [11, 3, -5].forEach(y => addBox(g, [29, .55, .55], [0, y, 0], metal));
    for (let i = -12; i <= 12; i += 4) addBox(g, [.04, 19, .04], [i, 0, .3], lineMaterial(0x275b5d, .5));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff765d })); beacon.position.set(0, 11.5, 0); g.add(beacon); WORLD.beacon = beacon;
  }

  function buildScanVolume() {
    const g = new THREE.Group(); g.position.set(0, 7.5, -29); scene.add(g); WORLD.volume = g;
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(4.7, 3), new THREE.MeshBasicMaterial({ color: 0x56d6d0, wireframe: true, transparent: true, opacity: .22, blending: THREE.AdditiveBlending })); g.add(shell); WORLD.shell = shell;
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(3.7, 2), new THREE.MeshStandardMaterial({ color: 0x254c53, emissive: 0x1c7e80, emissiveIntensity: .42, transparent: true, opacity: .22, roughness: .32, metalness: .2 })); g.add(inner);
    for (let i = 0; i < 7; i++) { const y = -3 + i; const plane = new THREE.Mesh(new THREE.PlaneGeometry(7.8 - Math.abs(i - 3) * .38, 5.7 - Math.abs(i - 3) * .24), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x66e1d6 : 0x2a9b9b, transparent: true, opacity: .08, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); plane.position.y = y; plane.rotation.y = (i - 3) * .08; g.add(plane); WORLD.pulses.push(plane); }
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(8, 8, 8)); const box = new THREE.LineSegments(edgeGeo, lineMaterial(0x8bece4, .46)); g.add(box);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite('71,221,210'), color: 0x54d6d0, transparent: true, opacity: .25, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(17,17,1); halo.position.z = 1; g.add(halo);
  }

  function buildMonoliths() {
    const g = new THREE.Group(); scene.add(g); const mat = new THREE.MeshStandardMaterial({ color: 0x10252b, emissive: 0x0b3035, emissiveIntensity: .28, roughness: .62, metalness: .55 }); const edge = lineMaterial(0x397f80, .55);
    [[-12, 5, -19, -.18], [12, 4, -22, .14], [-16, 1, -42, -.1], [16, 1, -42, .12]].forEach(([x, y, z, ry], i) => { const m = addBox(g, [2.6 + i * .18, 8 + i, 1.8], [x,y,z], mat, [0,ry,0]); const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edge); e.position.copy(m.position); e.rotation.copy(m.rotation); g.add(e); const light = new THREE.Mesh(new THREE.BoxGeometry(.04, 3.5 + i, .04), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff765d : 0x65d7d0, transparent: true, opacity: .7, blending: THREE.AdditiveBlending })); light.position.set(x - 1.31, y, z - .92); g.add(light); });
  }

  function makeLabel(text, color = '#65d7d0') {
    const c = makeCanvas(220, 64), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height); x.font = '500 22px Microsoft YaHei, sans-serif'; x.fillStyle = color; x.fillText(text, 8, 30);
    x.fillStyle = 'rgba(101,215,208,.45)'; x.fillRect(8, 42, Math.min(150, 12 + text.length * 22), 1);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(c), transparent: true, opacity: .8, depthWrite: false })); s.scale.set(3.7, 1.08, 1); return s;
  }

  function makeOrganMaterial(color, emissive, opacity = .88) {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: .5, roughness: .36, metalness: .18, transparent: true, opacity, side: THREE.DoubleSide });
  }

  function makeOrganContour(mesh, color = 0x8ceae1) {
    const contour = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }));
    contour.position.copy(mesh.position); contour.rotation.copy(mesh.rotation); contour.scale.copy(mesh.scale).multiplyScalar(1.018); return contour;
  }

  function makeKidneyShape() {
    const shape = new THREE.Shape();
    shape.moveTo(.15, 1.55); shape.bezierCurveTo(-.85, 1.62, -1.35, .82, -1.22, -.1); shape.bezierCurveTo(-1.12, -.94, -.62, -1.5, .02, -1.42); shape.bezierCurveTo(.58, -1.34, .84, -.8, .62, -.2); shape.bezierCurveTo(.49, .16, .34, .27, .56, .62); shape.bezierCurveTo(.78, .98, .62, 1.46, .15, 1.55); return shape;
  }

  function buildOrgans() {
    const root = new THREE.Group(); root.position.set(0, 7.35, -26.6); root.scale.setScalar(1.02); scene.add(root); WORLD.organs = root;
    const liver = new THREE.Group(); liver.name = 'liver'; liver.position.set(.15, .25, .1); root.add(liver);
    const liverMat = makeOrganMaterial(0xd2665d, 0x9c3f37, .92);
    const liverMain = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), liverMat); liverMain.scale.set(3.1, 1.35, 1.72); liverMain.rotation.z = -.1; liver.add(liverMain);
    const liverLobe = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), liverMat); liverLobe.position.set(-2.15, .15, .05); liverLobe.scale.set(1.18, 1.02, 1.28); liver.add(liverLobe);
    const liverContour = new THREE.Mesh(new THREE.SphereGeometry(1.025, 32, 24), new THREE.MeshBasicMaterial({ color: 0xff9e84, wireframe: true, transparent: true, opacity: .19, blending: THREE.AdditiveBlending, depthWrite: false })); liverContour.scale.copy(liverMain.scale).multiplyScalar(1.02); liverContour.rotation.copy(liverMain.rotation); liver.add(liverContour);
    const vesselMat = new THREE.MeshBasicMaterial({ color: 0xffa381, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false });
    const vessel = new THREE.Mesh(new THREE.TorusGeometry(.53, .045, 8, 32), vesselMat); vessel.position.set(.15, .32, 1.72); vessel.rotation.x = Math.PI / 2; liver.add(vessel);
    const liverLabel = makeLabel('肝脏  /  结构目标', '#ffb09a'); liverLabel.position.set(3.9, 1.2, .4); liver.add(liverLabel);

    const lungs = new THREE.Group(); lungs.name = 'lungs'; lungs.position.set(0, .2, -.95); root.add(lungs);
    const lungMat = makeOrganMaterial(0x4fc8c2, 0x167e80, .72);
    [-1, 1].forEach(side => { const lung = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 22), lungMat); lung.position.set(side * 1.18, .18, 0); lung.scale.set(1.2, 2.15, .82); lungs.add(lung); const lobe = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), lungMat); lobe.position.set(side * 1.2, -1.05, .02); lobe.scale.set(.98, 1.18, .76); lungs.add(lobe); });
    const trachea = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 2.1, 18), new THREE.MeshBasicMaterial({ color: 0x9dece1, transparent: true, opacity: .56, blending: THREE.AdditiveBlending })); trachea.position.set(0, 1.85, .12); lungs.add(trachea);
    const bronchiMat = lineMaterial(0x8ee8df, .5); const branchPts = [new THREE.Vector3(0,1.1,.15),new THREE.Vector3(-.68,.35,.15),new THREE.Vector3(-.9,-.35,.15)]; lungs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(branchPts), bronchiMat)); const branchPts2 = branchPts.map(v => new THREE.Vector3(-v.x,v.y,v.z)); lungs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(branchPts2), bronchiMat));
    const lungLabel = makeLabel('肺部  /  双侧结构', '#8fe8df'); lungLabel.position.set(3.35, 2.2, -.3); lungs.add(lungLabel);

    const kidneys = new THREE.Group(); kidneys.name = 'kidneys'; kidneys.position.set(0, -2.0, .5); root.add(kidneys);
    const kidneyMat = makeOrganMaterial(0x9c7fc5, 0x5a2f76, .82); const kidneyGeo = new THREE.ExtrudeGeometry(makeKidneyShape(), { depth: 1.05, bevelEnabled: true, bevelSegments: 3, bevelSize: .12, bevelThickness: .12 }); kidneyGeo.center();
    [-1, 1].forEach(side => { const kidney = new THREE.Mesh(kidneyGeo, kidneyMat); kidney.position.set(side * 1.45, 0, 0); kidney.scale.set(.82, .88, .74); kidney.rotation.z = side * -.08; kidneys.add(kidney); const contour = makeOrganContour(kidney, 0xb6a1da); kidneys.add(contour); });
    const kidneyLabel = makeLabel('肾脏  /  成对器官', '#b6a1da'); kidneyLabel.position.set(3.15, -.1, .3); kidneys.add(kidneyLabel);

    const target = new THREE.Mesh(new THREE.RingGeometry(.44, .53, 40), new THREE.MeshBasicMaterial({ color: 0xff765d, transparent: true, opacity: .72, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); target.position.set(.15, .25, 2.08); target.rotation.x = Math.PI / 2; root.add(target); WORLD.organTarget = target;
    root.traverse(obj => { if (obj.isMesh) obj.renderOrder = 3; });
    const organLight = new THREE.PointLight(0x65d7d0, 3.8, 18, 2); organLight.position.set(0, 9, -22); scene.add(organLight); WORLD.organLight = organLight;
  }

  function buildPointCloud() {
    const count = 1650, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), sizes = new Float32Array(count); const c = new THREE.Color();
    for (let i = 0; i < count; i++) { const a = R() * TAU, radius = Math.pow(R(), .55) * 26, y = -2.3 + R() * 22; positions[i*3] = Math.cos(a) * radius; positions[i*3+1] = y; positions[i*3+2] = -13 - R() * 54; c.setHSL(R() > .88 ? .03 : .49 + R() * .06, .64, .48 + R() * .24); colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b; sizes[i] = .4 + R() * 1.5; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions,3)); geo.setAttribute('color', new THREE.BufferAttribute(colors,3)); geo.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));
    const mat = new THREE.PointsMaterial({ size: .18, vertexColors: true, transparent: true, opacity: .6, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false }); const pts = new THREE.Points(geo, mat); scene.add(pts); WORLD.points.push(pts);
  }

  function buildDataLines() {    const g = new THREE.Group(); scene.add(g); WORLD.data = g;
    for (let j = 0; j < 16; j++) { const pts = []; const x = -18 + j * 2.4; for (let i = 0; i < 14; i++) pts.push(new THREE.Vector3(x + Math.sin(i * .8 + j) * .22, -2 + i * 1.25, -15 - j * 2.4)); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial(j % 5 === 0 ? 0xff765d : 0x3aaead, j % 5 === 0 ? .55 : .22)); g.add(line); WORLD.movers.push(line); }
  }

  function buildAtmosphere() {
    const tex = glowSprite('104,210,214'); for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: i % 4 === 0 ? 0xff765d : 0x54c9c6, transparent: true, opacity: .12 + R() * .12, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(1.5 + R()*3, 1.5 + R()*3, 1); s.position.set(-24 + R()*48, -1 + R()*21, -12 - R()*54); scene.add(s); WORLD.movers.push(s); }
    const rainCount = 360, pos = new Float32Array(rainCount*3); for (let i=0;i<rainCount;i++){pos[i*3]=-26+R()*52;pos[i*3+1]=-2+R()*24;pos[i*3+2]=-6-R()*60} const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); const rain=new THREE.Points(geo,new THREE.PointsMaterial({color:0x6bd8d2,size:.035,transparent:true,opacity:.28,blending:THREE.AdditiveBlending}));scene.add(rain);WORLD.rain=rain;
  }

  function buildWorld() { buildEnvironment(); buildPortal(); buildGantry(); buildScanVolume(); buildOrgans(); buildMonoliths(); buildPointCloud(); buildDataLines(); buildAtmosphere(); const hemi = new THREE.HemisphereLight(0x55a8a9,0x03070b,.55); scene.add(hemi); const key = new THREE.DirectionalLight(0xa8f0ea,1.1); key.position.set(-15,26,12); scene.add(key); const warm = new THREE.PointLight(0xff634b,2.2,32,2); warm.position.set(8,7,-22); scene.add(warm); WORLD.warm=warm; }

  function makeCardCanvas(canvas, type) {
    const x = canvas.getContext('2d'); let t = 0; const draw = () => { const w = canvas.clientWidth || 500, h = canvas.clientHeight || 400, d = Math.min(devicePixelRatio || 1, 2); if (canvas.width !== w*d || canvas.height !== h*d) { canvas.width=w*d; canvas.height=h*d; } x.setTransform(d,0,0,d,0,0); const W=w,H=h; x.fillStyle='#07131a';x.fillRect(0,0,W,H); x.globalAlpha=.5; x.strokeStyle='#164247';x.lineWidth=1; for(let i=0;i<W;i+=22){x.beginPath();x.moveTo(i,0);x.lineTo(i,H);x.stroke()}for(let i=0;i<H;i+=22){x.beginPath();x.moveTo(0,i);x.lineTo(W,i);x.stroke()} x.globalAlpha=1;
      if(type==='slice'){ const g=x.createRadialGradient(W*.53,H*.48,8,W*.53,H*.48,W*.32);g.addColorStop(0,'#d08c75');g.addColorStop(.28,'#824c58');g.addColorStop(.55,'#193b45');g.addColorStop(1,'#08171f');x.fillStyle=g;x.beginPath();x.ellipse(W*.53,H*.5,W*.32,H*.36,0,0,TAU);x.fill();x.strokeStyle='rgba(117,231,218,.55)';x.beginPath();x.ellipse(W*.53,H*.5,W*.2,H*.24,0,0,TAU);x.stroke();x.strokeStyle='rgba(255,118,93,.5)';x.beginPath();x.arc(W*.53,H*.5,Math.min(W,H)*.11,0,TAU);x.stroke(); for(let i=0;i<7;i++){x.strokeStyle=`rgba(120,225,217,${.12+i*.02})`;x.beginPath();x.arc(W*.53,H*.5,20+i*15+Math.sin(t+i)*2,0,TAU);x.stroke()}}
      if(type==='segment'){x.fillStyle='rgba(51,126,130,.3)';x.beginPath();x.ellipse(W*.5,H*.48,W*.33,H*.37,0,0,TAU);x.fill();x.strokeStyle='rgba(104,223,210,.45)';x.lineWidth=2;x.beginPath();for(let i=0;i<36;i++){const a=i/36*TAU,r=Math.min(W,H)*(.25+Math.sin(i*3.1)*.025);const px=W*.5+Math.cos(a)*r,py=H*.5+Math.sin(a)*r*.9;i?x.lineTo(px,py):x.moveTo(px,py)}x.closePath();x.stroke();x.fillStyle='rgba(255,118,93,.75)';x.beginPath();x.arc(W*.55,H*.42,5+Math.sin(t*2)*1.5,0,TAU);x.fill();x.strokeStyle='#ff765d';x.setLineDash([4,5]);x.strokeRect(W*.34,H*.26,W*.32,H*.42);x.setLineDash([])}
      if(type==='report'){x.fillStyle='rgba(83,162,160,.13)';x.fillRect(W*.19,H*.15,W*.62,H*.7);x.strokeStyle='rgba(101,215,208,.5)';x.strokeRect(W*.19,H*.15,W*.62,H*.7);x.fillStyle='#8ce5dc';x.fillRect(W*.28,H*.24,W*.16,3);for(let i=0;i<8;i++){x.fillStyle=i===3?'rgba(255,118,93,.8)':'rgba(119,195,192,.38)';x.fillRect(W*.28,H*(.35+i*.055),W*(.39-(i%3)*.08),2)}} x.fillStyle='rgba(101,215,208,.65)';x.fillRect(0,H-2,W,2); if(!reduce){t+=.018;requestAnimationFrame(draw)}}; draw(); }

  function buildCards() { $$('.card__canvas').forEach(c => { const card = c.closest('.card'); makeCardCanvas(c,c.dataset.card); card.addEventListener('mouseenter',()=>RIG.focus=+card.dataset.focus);card.addEventListener('mouseleave',()=>RIG.focus=-1); }); }

  let sections = [], anchors = [], maxScroll = 1, active = 0;
  function measure() { sections = $$('[data-cam]'); maxScroll=Math.max(1,document.documentElement.scrollHeight-innerHeight); anchors=sections.map((el,i)=>i===0?0:i===sections.length-1?maxScroll:clamp(el.offsetTop+el.offsetHeight*.5-innerHeight*.5,0,maxScroll)); }
  function progressFor(y){if(y<=anchors[0])return 0;for(let i=0;i<anchors.length-1;i++)if(y<=anchors[i+1])return i+(y-anchors[i])/(anchors[i+1]-anchors[i]);return anchors.length-1;}
  function applyCamera(){const n=CAM.length-1,u=clamp(RIG.smooth/n,0,1),i=clamp(Math.floor(RIG.smooth),0,n-1),f=clamp(RIG.smooth-i,0,1);p0.fromArray(CAM[i].p);p1.fromArray(CAM[i+1].p);t0.fromArray(CAM[i].t);t1.fromArray(CAM[i+1].t);const p=p0.clone().lerp(p1,f),t=t0.clone().lerp(t1,f);const fov=lerp(CAM[i].f,CAM[i+1].f,f);p.x+=RIG.mx*.75;p.y+=RIG.my*.38;t.x-=RIG.mx*.18;t.y-=RIG.my*.1;camera.position.copy(p);camera.lookAt(t);if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix()}}
  function wireReveals(){const items=$$('.reveal');const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.style.transitionDelay=`${(e.target.parentElement? [...e.target.parentElement.children].indexOf(e.target):0)*80}ms`;e.target.classList.add('in');io.unobserve(e.target)}}),{rootMargin:'0px 0px -10% 0px',threshold:.02});items.forEach(i=>io.observe(i));}

  function wireNav(){const nav=$('#nav'), burger=$('#menu-button'), links=$$('.nav-link'); let last=0; const close=()=>{nav.classList.remove('menu-open');burger.classList.remove('active');burger.setAttribute('aria-expanded','false');document.documentElement.style.overflow=''}; burger.addEventListener('click',()=>{const open=!nav.classList.contains('menu-open');nav.classList.toggle('menu-open',open);burger.classList.toggle('active',open);burger.setAttribute('aria-expanded',String(open));document.documentElement.style.overflow=open?'hidden':''}); links.forEach(a=>a.addEventListener('click',close)); addEventListener('keydown',e=>{if(e.key==='Escape')close()}); $$('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const el=$(a.getAttribute('href'));if(!el)return;e.preventDefault();scrollTo({top:a.getAttribute('href')==='#top'?0:el.offsetTop-35,behavior:reduce?'auto':'smooth'});close()})); addEventListener('scroll',()=>{const y=scrollY;nav.classList.toggle('stuck',y>36);nav.classList.toggle('hide',!nav.classList.contains('menu-open')&&y>last+4&&y>innerHeight*.72);last=y;const idx=Math.round(progressFor(y));if(idx!==active){active=idx;$$('.rail button').forEach((b,i)=>b.classList.toggle('on',i===idx));links.forEach(a=>a.classList.toggle('on',a.getAttribute('href')===`#${sections[idx]?.id}`))}},{passive:true});}
  function wireLinks(){const map=window.NEXUS_LINKS||{};$$('[data-link]').forEach(a=>{const v=map[a.dataset.link];if(!v)return;a.setAttribute('href',v);a.setAttribute('target','_blank');a.setAttribute('rel','noopener')});}
  function wireRail(){const rail=$('#rail');sections.forEach((s,i)=>{const b=document.createElement('button');b.title=s.id;b.setAttribute('aria-label',`Go to ${s.id}`);b.innerHTML='<i></i>';b.addEventListener('click',()=>scrollTo({top:anchors[i],behavior:reduce?'auto':'smooth'}));rail.appendChild(b)});rail.firstChild?.classList.add('on');}
  function wireCursor(){if(coarse){$('#cursor').style.display='none';return}const dot=$('#cursor');let x=innerWidth/2,y=innerHeight/2,tx=x,ty=y;addEventListener('pointermove',e=>{tx=e.clientX;ty=e.clientY;RIG.tx=e.clientX/innerWidth*2-1;RIG.ty=-(e.clientY/innerHeight*2-1)},{passive:true});$$('[data-cursor]').forEach(el=>{el.addEventListener('mouseenter',()=>dot.classList.add('act'));el.addEventListener('mouseleave',()=>dot.classList.remove('act'))});const tick=()=>{x=lerp(x,tx,.17);y=lerp(y,ty,.17);dot.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;requestAnimationFrame(tick)};tick()}
  function wireHeroExit(){const hero=$('#hero'); const els=[$('.hero__visual-note'),$('.hero__readout'),$('.hero__signal'),$('.hero__metrics')].filter(Boolean); const update=()=>{if(!hero)return;const q=clamp(scrollY/(innerHeight*.6),0,1);els.forEach((el,i)=>{const a=1-smooth(i*.12,.45+i*.12,q);el.style.opacity=a;el.style.transform=`translate3d(0,${(1-a)*18}px,0)`})};addEventListener('scroll',update,{passive:true});update()}

  function update(dt){RIG.progress=progressFor(scrollY);RIG.smooth=reduce?RIG.progress:damp(RIG.smooth,RIG.progress,4.8,dt);RIG.mx=damp(RIG.mx,RIG.tx,2.2,dt);RIG.my=damp(RIG.my,RIG.ty,2.2,dt);RIG.focusAmt=damp(RIG.focusAmt,RIG.focus>=0?1:0,5,dt);WORLD.movers.forEach((m,i)=>{if(m.userData.speed)m.rotation.z+=dt*m.userData.speed});if(WORLD.organs){WORLD.organs.rotation.y=Math.sin(clock*.18)*.08;WORLD.organs.rotation.x=Math.sin(clock*.23)*.025;WORLD.organs.scale.setScalar(.88+RIG.focusAmt*.045);if(WORLD.organTarget){WORLD.organTarget.rotation.z+=dt*(.55+RIG.focusAmt*.4);WORLD.organTarget.material.opacity=.48+Math.sin(clock*2.4)*.18+RIG.focusAmt*.2}}if(WORLD.portal){WORLD.portal.rotation.z+=dt*.025;WORLD.portal.scale.setScalar(1+Math.sin(clock*1.2)*.018+RIG.focusAmt*.03)}if(WORLD.shell){WORLD.shell.rotation.x+=dt*.08;WORLD.shell.rotation.y+=dt*.18;WORLD.shell.material.opacity=.18+RIG.focusAmt*.1}if(WORLD.volume)WORLD.volume.rotation.y+=dt*.025;if(WORLD.beacon)WORLD.beacon.material.opacity=.45+Math.sin(clock*3.2)*.35;if(WORLD.warm)WORLD.warm.intensity=2.1+Math.sin(clock*1.4)*.25+RIG.focusAmt*.8;WORLD.pulses.forEach((p,i)=>{p.position.x=Math.sin(clock*.5+i)*.06;p.material.opacity=.045+Math.sin(clock*1.4+i*.5)*.025});if(WORLD.rain){const a=WORLD.rain.geometry.attributes.position.array;for(let i=1;i<a.length;i+=3){a[i]-=dt*3.7;if(a[i]<-3)a[i]=21}WORLD.rain.geometry.attributes.position.needsUpdate=true}if(WORLD.points.length)WORLD.points[0].rotation.y+=dt*.012;applyCamera()}
  function render(){renderer.render(scene,camera)}
  function resize(){if(!renderer)return;renderer.setSize(innerWidth,innerHeight,true);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();measure()}
  function loop(now){if(!running)return;const dt=Math.min((now-(loop.last||now))/1000,.05);loop.last=now;clock+=dt;frames++;update(dt);render();const f=$('#telemetry-frame');if(f)f.textContent=`FRAME ${String(frames).padStart(5,'0')}`;requestAnimationFrame(loop)}

  async function boot(){document.body.classList.add('is-locked');wireReveals();wireNav();wireLinks();wireCursor();wireHeroExit();initGL();buildWorld();buildCards();measure();wireRail();addEventListener('resize',resize,{passive:true});let jobs=['正在校准影像空间','正在加载三维体数据','正在连接提示分割层','正在准备辅助报告界面','系统就绪'];for(let i=0;i<jobs.length;i++){status.textContent=jobs[i];await new Promise(r=>setTimeout(r,location.search.includes('instant')?0:(reduce?20:100)));const p=Math.round((i+1)/jobs.length*100);bar.style.width=p+'%';pct.textContent=p}$('#preloader').classList.add('done');document.body.classList.remove('is-locked');running=true;requestAnimationFrame(loop)}
  function fallback(err){console.error('[nexus landing]',err);document.documentElement.classList.add('no-webgl');document.body.classList.remove('is-locked');$('#preloader').classList.add('done');running=false;}
  addEventListener('load',()=>boot().catch(fallback));
})();
