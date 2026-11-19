/* Entorno Virtual 3D Rayos X e Isométricos Vectoriales — Instalaciones Sanitarias */
(() => {
  const SYS_COLORS = {
    AF:   { hex: 0x00f5ff, label: "Agua Fría (PVC-SAP C10)" },
    AC:   { hex: 0xff5500, label: "Agua Caliente (CPVC)" },
    DES:  { hex: 0xff14f0, label: "Desagüe Doméstico (PVC-SAL)" },
    VENT: { hex: 0x39ff14, label: "Ventilación Sanitaria" },
    PLUV: { hex: 0xffe600, label: "Aguas Pluviales" },
    ACI:  { hex: 0xff2244, label: "Contra Incendios (EXT + Previsión)" },
  };

  let scene, camera, renderer, composer, bloomPass, controls;
  let sysGroups = {};
  let wallMats = [];
  let slabMats = [];
  let pickables = [];
  let animPulses = [];
  let selectedMesh = null;
  let autoRotate = false;
  let bimData = null;

  // Center of 7x20x10 house -> offset to origin
  const CX = 3.5, CY = 4.2, CZ = 10.0;

  async function init() {
    const res = await fetch("./assets/data/bim_model.json");
    bimData = await res.json();
    initThree();
    buildXRayArchitecture(bimData.floors);
    buildPipesAndAccessories(bimData.pipes, bimData.accessories);
    initUI();
    initSvgViewer(bimData.svgs);
    animate();
  }

  function initThree() {
    const canvas = document.getElementById("three-canvas");
    const container = document.getElementById("view-3d");
    const w = container.clientWidth || window.innerWidth - 325;
    const h = container.clientHeight || window.innerHeight - 94;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050811);
    scene.fog = new THREE.FogExp2(0x050811, 0.015);

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 180);
    camera.position.set(14.5, 9.8, 15.5);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.2, 0);
    controls.minDistance = 2.0;
    controls.maxDistance = 45.0;

    // HDR Bloom pipeline equilibrado para brillos fosforescentes nítidos sin quemado blanco
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.30, 0.82);
    composer.addPass(bloomPass);

    // Iluminación ambiental + direccional suave
    scene.add(new THREE.AmbientLight(0x94a3b8, 0.65));
    const dl1 = new THREE.DirectionalLight(0xe0f2fe, 1.1);
    dl1.position.set(14, 22, 16);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0x38bdf8, 0.45);
    dl2.position.set(-14, 8, -12);
    scene.add(dl2);

    // Grilla sutil del terreno 7x20 m
    const grid = new THREE.GridHelper(32, 32, 0x1e3a5f, 0x0f172a);
    grid.position.set(0, -CY, 0);
    scene.add(grid);

    ["AF", "AC", "DES", "VENT", "PLUV", "ACI", "ARCH"].forEach(k => {
      const g = new THREE.Group();
      scene.add(g);
      sysGroups[k] = g;
    });

    // Raycasting por clic (diferenciando de arrastre)
    let downPos = null;
    renderer.domElement.addEventListener("pointerdown", e => { downPos = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", e => {
      if (!downPos) return;
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 5) {
        pickAt(e.clientX, e.clientY);
      }
      downPos = null;
    });

    window.addEventListener("resize", handleResize);
  }

  function handleResize() {
    const view3d = document.getElementById("view-3d");
    if (view3d.hidden) return;
    const w = view3d.clientWidth || 800;
    const h = view3d.clientHeight || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }

  function worldVec(arr) {
    return new THREE.Vector3(arr[0] - CX, arr[1] - CY, arr[2] - CZ);
  }

  function buildXRayArchitecture(floors) {
    const archGroup = sysGroups.ARCH;
    const linePts = [];

    // Losas translúcidas (P1, P2, P3, Azotea) + contorno brillante Rayos X
    const slabs = [0.15, 2.95, 5.65, 8.35];
    const slabGeo = new THREE.BoxGeometry(7.0, 0.08, 20.0);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(7.0, 0.08, 20.0));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });

    slabs.forEach(z => {
      const sm = new THREE.MeshStandardMaterial({
        color: 0x1e293b, transparent: true, opacity: 0.14, roughness: 0.4, depthWrite: false
      });
      slabMats.push(sm);
      const slab = new THREE.Mesh(slabGeo, sm);
      slab.position.set(0, z - CY, 0);
      archGroup.add(slab);
      const wires = new THREE.LineSegments(edgeGeo, edgeMat);
      wires.position.copy(slab.position);
      archGroup.add(wires);
    });

    // Muros reales extraídos del DXF arquitectónico (alambre + planos rayos X)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x334155, transparent: true, opacity: 0.12, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false
    });
    wallMats.push(wallMat);

    floors.forEach(fl => {
      const yBase = fl.z0 - CY;
      const wh = fl.h;
      fl.segs.forEach(s => {
        const [x1, z1] = s.p[0];
        const [x2, z2] = s.p[1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 0.15) return;

        // Líneas de borde Rayos X abajo y arriba
        linePts.push(x1 - CX, yBase, z1 - CZ, x2 - CX, yBase, z2 - CZ);
        if (s.w) {
          linePts.push(x1 - CX, yBase + wh, z1 - CZ, x2 - CX, yBase + wh, z2 - CZ);
          linePts.push(x1 - CX, yBase, z1 - CZ, x1 - CX, yBase + wh, z1 - CZ);
          // Plano muro translúcido
          const planeGeo = new THREE.PlaneGeometry(len, wh);
          const m = new THREE.Mesh(planeGeo, wallMat);
          m.position.set((x1 + x2) / 2 - CX, yBase + wh / 2, (z1 + z2) / 2 - CZ);
          m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
          archGroup.add(m);
        }
      });
    });

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePts, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.24 });
    archGroup.add(new THREE.LineSegments(lineGeo, lineMat));
  }

  function makeGlowMaterial(hexColor, intensity = 0.65) {
    return new THREE.MeshStandardMaterial({
      color: hexColor,
      emissive: hexColor,
      emissiveIntensity: intensity,
      roughness: 0.25,
      metalness: 0.3,
    });
  }

  function addTubeChain(group, pts, radius, mat, metaData) {
    const vectors = pts.map(worldVec);
    for (let i = 0; i < vectors.length - 1; i++) {
      const a = vectors[i], b = vectors[i + 1];
      const dist = a.distanceTo(b);
      if (dist < 0.01) continue;
      const geo = new THREE.CylinderGeometry(radius, radius, dist, 12);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      mesh.userData = metaData;
      group.add(mesh);
      pickables.push(mesh);

      // Esfera unión en nodo (codo / tee)
      const jGeo = new THREE.SphereGeometry(radius * 1.45, 10, 10);
      const jMesh = new THREE.Mesh(jGeo, mat);
      jMesh.position.copy(b);
      jMesh.userData = metaData;
      group.add(jMesh);
      pickables.push(jMesh);
    }
    return vectors;
  }

  function buildPipesAndAccessories(pipes, accessories) {
    const pulseGeo = new THREE.SphereGeometry(0.055, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    pipes.forEach(p => {
      const cfg = SYS_COLORS[p.sys] || SYS_COLORS.AF;
      const baseInt = p.crit ? 0.90 : 0.60;
      const mat = makeGlowMaterial(cfg.hex, baseInt);
      const grp = sysGroups[p.sys];
      const meta = { kind: "pipe", data: p, baseHex: cfg.hex, baseInt };
      const vecs = addTubeChain(grp, p.pts, p.r || 0.028, mat, meta);
      (p.subs || []).forEach(sp => addTubeChain(grp, sp, (p.r || 0.025) * 0.85, mat, meta));

      // Añadir partícula animada de flujo en tramos principales
      if (vecs.length >= 2 && (p.sys === "AF" || p.sys === "AC" || p.sys === "PLUV" || p.id.startsWith("COLECTOR"))) {
        const dot = new THREE.Mesh(pulseGeo, pulseMat);
        grp.add(dot);
        animPulses.push({ mesh: dot, path: vecs, t: Math.random(), speed: 0.18 + Math.random() * 0.14 });
      }
    });

    accessories.forEach(acc => {
      const cfg = SYS_COLORS[acc.sys] || SYS_COLORS.AF;
      const grp = sysGroups[acc.sys];
      const pos = worldVec(acc.pos);
      let meshHex = cfg.hex;
      let baseInt = 0.82;
      let mesh;

      if (acc.kind === "valvula_compuerta") {
        meshHex = 0x00ffff;
        baseInt = 0.88;
        const meta = { kind: "acc", data: acc, baseHex: meshHex, baseInt };
        const g = new THREE.Group();
        const m = makeGlowMaterial(meshHex, baseInt);
        const coneGeo = new THREE.ConeGeometry(0.08, 0.14, 6);
        const c1 = new THREE.Mesh(coneGeo, m); c1.rotation.z = -Math.PI / 2; c1.position.x = -0.07;
        const c2 = new THREE.Mesh(coneGeo, m); c2.rotation.z = Math.PI / 2; c2.position.x = 0.07;
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), m); stem.position.y = 0.09;
        [c1, c2, stem].forEach(ch => { ch.userData = meta; g.add(ch); pickables.push(ch); });
        g.position.copy(pos);
        grp.add(g);
        return;
      } else if (acc.kind === "therma") {
        meshHex = 0xff6b00; baseInt = 0.80;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.72, 16), makeGlowMaterial(meshHex, baseInt));
      } else if (acc.kind === "medidor") {
        meshHex = 0xfacc15; baseInt = 0.85;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.20, 0.22), makeGlowMaterial(meshHex, baseInt));
      } else if (acc.kind === "caja_registro") {
        meshHex = 0xff22ee; baseInt = 0.78;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.56), makeGlowMaterial(meshHex, baseInt));
      } else if (acc.kind === "sumidero") {
        meshHex = 0xffe600; baseInt = 0.82;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.26), makeGlowMaterial(meshHex, baseInt));
      } else if (acc.kind === "sombrero") {
        meshHex = 0x39ff14; baseInt = 0.82;
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.20, 10), makeGlowMaterial(meshHex, baseInt));
      } else {
        meshHex = 0xff2244; baseInt = 0.90;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12), makeGlowMaterial(meshHex, baseInt));
      }
      mesh.position.copy(pos);
      mesh.userData = { kind: "acc", data: acc, baseHex: meshHex, baseInt };
      grp.add(mesh);
      pickables.push(mesh);
    });
  }

  function isGroupVisible(obj) {
    let cur = obj;
    while (cur) {
      if (cur.visible === false) return false;
      cur = cur.parent;
    }
    return true;
  }

  function pickAt(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(pickables, false).filter(h => isGroupVisible(h.object));
    if (!hits.length) return;
    const hit = hits[0].object;

    if (selectedMesh && selectedMesh.material) {
      selectedMesh.material.emissive.setHex(selectedMesh.userData.baseHex);
      selectedMesh.material.emissiveIntensity = selectedMesh.userData.baseInt || 0.65;
    }
    selectedMesh = hit;
    if (hit.material) {
      hit.material.emissive.setHex(0xffffff);
      hit.material.emissiveIntensity = 1.35;
    }
    renderInspector(hit.userData);
  }

  function renderInspector(u) {
    const body = document.getElementById("inspector-body");
    const d = u.data;
    if (u.kind === "pipe") {
      body.innerHTML = `
        <div class="insp-title">${d.id} · ${SYS_COLORS[d.sys].label}</div>
        <dl class="insp-kv">
          <dt>Piso:</dt><dd>${d.piso}</dd>
          <dt>Diámetro:</dt><dd>${d.diam}</dd>
          <dt>Long. Total:</dt><dd>${d.ltot} m</dd>
          <dt>Hunter / Carga:</dt><dd>${d.ug}</dd>
          <dt>Caudal / Vel.:</dt><dd>${d.q} L/s · ${d.v} m/s</dd>
          <dt>Accesorios:</dt><dd>${d.acc || "Tramo continuo"}</dd>
          <dt>Pérd. Tramo / Acum.:</dt><dd>${d.hf} / ${d.cum_hf} mca</dd>
          <dt>Presión 20 vs 15 mca:</dt><dd>${d.p20} / ${d.p15} mca</dd>
        </dl>
        <p class="gpu-note">${d.desc}</p>`;
    } else {
      body.innerHTML = `
        <div class="insp-title">${d.id}</div>
        <dl class="insp-kv">
          <dt>Especialidad:</dt><dd>${SYS_COLORS[d.sys].label}</dd>
          <dt>Ubicación:</dt><dd>${d.piso}</dd>
          <dt>Tipo:</dt><dd>${d.kind.replace("_", " ")}</dd>
        </dl>
        <p class="gpu-note">${d.desc}</p>`;
    }
  }

  let triggerFitSvg = () => {};

  function initUI() {
    // Tabs 3D vs Isométricos
    const tab3d = document.getElementById("tab-3d");
    const tabIso = document.getElementById("tab-iso");
    const view3d = document.getElementById("view-3d");
    const viewIso = document.getElementById("view-iso");
    const ctrl3d = document.getElementById("controls-3d");
    const ctrlIso = document.getElementById("controls-iso");

    function setTab(is3d) {
      tab3d.classList.toggle("active", is3d);
      tabIso.classList.toggle("active", !is3d);
      tab3d.setAttribute("aria-pressed", String(is3d));
      tabIso.setAttribute("aria-pressed", String(!is3d));
      view3d.hidden = !is3d; ctrl3d.hidden = !is3d;
      viewIso.hidden = is3d; ctrlIso.hidden = is3d;
      if (is3d) handleResize();
      else setTimeout(() => triggerFitSvg(), 30);
    }
    tab3d.addEventListener("click", () => setTab(true));
    tabIso.addEventListener("click", () => setTab(false));

    // Toggle capas de especialidad fosforescentes
    document.querySelectorAll(".layer-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const sys = btn.dataset.sys;
        const next = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(next));
        if (sysGroups[sys]) sysGroups[sys].visible = next;
      });
    });

    // Presets cámara pisos
    const camPresets = {
      ALL: { pos: [14.5, 9.8, 15.5], target: [0, 0.2, 0] },
      P1:  { pos: [10.5, 1.5, 8.0], target: [0, -2.8, 0] },
      P2:  { pos: [10.5, 4.2, 8.0], target: [0, 0.0, 0] },
      P3:  { pos: [10.5, 6.9, 8.0], target: [0, 2.7, 0] },
      AZ:  { pos: [10.5, 10.2, 8.0], target: [0, 4.8, 0] },
    };
    document.querySelectorAll(".cam-btn[data-floor]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".cam-btn[data-floor]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const p = camPresets[btn.dataset.floor];
        camera.position.set(...p.pos);
        controls.target.set(...p.target);
        controls.update();
      });
    });

    const btnRot = document.getElementById("btn-autorotate");
    btnRot.addEventListener("click", () => {
      autoRotate = !autoRotate;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.4;
      btnRot.setAttribute("aria-pressed", String(autoRotate));
    });

    document.getElementById("rng-bloom").addEventListener("input", e => {
      const v = parseFloat(e.target.value);
      document.getElementById("val-bloom").textContent = v.toFixed(2);
      bloomPass.strength = v;
    });
    document.getElementById("rng-xray").addEventListener("input", e => {
      const v = parseFloat(e.target.value);
      document.getElementById("val-xray").textContent = v.toFixed(2);
      wallMats.forEach(m => { m.opacity = v; });
      slabMats.forEach(m => { m.opacity = Math.min(0.45, v * 1.15); });
    });
  }

  function initSvgViewer(svgs) {
    const listEl = document.getElementById("svg-selector-list");
    const imgEl = document.getElementById("cad-svg-img");
    const layer = document.getElementById("svg-transform-layer");
    const stage = document.getElementById("svg-stage");
    const hudTitle = document.getElementById("hud-svg-title");
    const hudZoom = document.getElementById("hud-zoom-pct");

    let scale = 1, panX = 20, panY = 20;
    function applyTx() {
      layer.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
      hudZoom.textContent = `${Math.round(scale * 100)}%`;
    }
    function fitView() {
      const sw = stage.clientWidth || 900, sh = stage.clientHeight || 600;
      const iw = imgEl.naturalWidth || 1200, ih = imgEl.naturalHeight || 800;
      scale = Math.min((sw - 40) / iw, (sh - 40) / ih);
      panX = (sw - iw * scale) / 2;
      panY = (sh - ih * scale) / 2;
      applyTx();
    }
    triggerFitSvg = fitView;

    function loadSvg(item, btn) {
      document.querySelectorAll(".svg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hudTitle.textContent = item.title;
      imgEl.onload = fitView;
      imgEl.src = `./assets/svgs/${item.file}`;
    }

    svgs.forEach((it, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "svg-btn" + (idx === 1 ? " active" : "");
      b.textContent = it.title;
      b.addEventListener("click", () => loadSvg(it, b));
      listEl.appendChild(b);
      if (idx === 1) loadSvg(it, b); // Arranca por defecto en IS-01 Isométrico 30°
    });

    stage.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.16 : 0.86;
      const nextScale = Math.min(16, Math.max(0.15, scale * factor));
      panX = mx - (mx - panX) * (nextScale / scale);
      panY = my - (my - panY) * (nextScale / scale);
      scale = nextScale;
      applyTx();
    }, { passive: false });

    let drag = null;
    stage.addEventListener("pointerdown", e => { drag = { x: e.clientX - panX, y: e.clientY - panY }; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener("pointermove", e => { if (!drag) return; panX = e.clientX - drag.x; panY = e.clientY - drag.y; applyTx(); });
    stage.addEventListener("pointerup", () => { drag = null; });

    document.getElementById("btn-zoom-in").addEventListener("click", () => { scale = Math.min(16, scale * 1.25); applyTx(); });
    document.getElementById("btn-zoom-out").addEventListener("click", () => { scale = Math.max(0.15, scale * 0.8); applyTx(); });
    document.getElementById("btn-zoom-fit").addEventListener("click", fitView);
  }

  let clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    animPulses.forEach(p => {
      p.t = (p.t + dt * p.speed) % 1;
      const segCount = p.path.length - 1;
      const f = p.t * segCount;
      const idx = Math.min(segCount - 1, Math.floor(f));
      const frac = f - idx;
      p.mesh.position.lerpVectors(p.path[idx], p.path[idx + 1], frac);
    });
    controls.update();
    composer.render();
  }

  init();
})();
