// Dot & Jar: the live 3D glass jar on Today.
// One dot = a fixed slice of today's money (see jarUnit in the app). A spend makes dots fly out
// through the mouth; money coming in drops new dots in. Drag spins the jar, the pointer tilts it,
// and the dots slide with the tilt. If WebGL is missing, the drawn jar stays.
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const AMBER = [0xFFB23F, 0xFF9A1F, 0xFFC766];
const MAX = 170, R = 0.12;
const reducedOS = matchMedia('(prefers-reduced-motion: reduce)');

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,160,50,.5)'); gr.addColorStop(.4, 'rgba(255,120,20,.14)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

class Jar {
  constructor() {
    this.loop = this.loop.bind(this); this.raf = 0; this.last = performance.now();
    const rd = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    rd.setPixelRatio(Math.min(devicePixelRatio, 2));
    rd.toneMapping = THREE.ACESFilmicToneMapping;
    this.canvas = rd.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(rd).fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x1a1410, 0.4); scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-4, 6, 5); scene.add(key);
    this.rimLight = new THREE.DirectionalLight(0xffc27a, 2.2); this.rimLight.position.set(5, 3, -4); scene.add(this.rimLight);

    const g = this.group = new THREE.Group(); scene.add(g);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.position.set(0, 1.0, -1.3); this.glow.scale.set(4.2, 4.2, 1); scene.add(this.glow);
    // glass with real thickness: outer wall up, inner wall back down
    const prof = [[0.001, 0], [0.86, 0], [1.0, 0.08], [1.07, 0.3], [1.08, 1.95], [1.02, 2.22], [0.84, 2.38], [0.78, 2.46], [0.78, 2.62], [0.83, 2.66], [0.8, 2.7], [0.72, 2.66], [0.72, 2.46], [0.78, 2.38], [0.97, 2.22], [1.02, 1.95], [1.01, 0.32], [0.95, 0.12], [0.82, 0.06], [0.001, 0.06]];
    this.glassMat = new THREE.MeshPhysicalMaterial({ roughness: 0.04, metalness: 0, transparent: true, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 96), this.glassMat);
    glass.renderOrder = 3; g.add(glass);
    // lid hovers open, tipped, so dots can come and go
    const lid = new THREE.Group();
    this.lidMat = new THREE.MeshStandardMaterial({ metalness: 0.85, roughness: 0.32 });
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.91, 0.035, 12, 96), this.lidMat); ridge.rotation.x = Math.PI / 2; ridge.position.y = -0.1;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 16), new THREE.MeshStandardMaterial({ color: 0xFFB23F, emissive: 0xFF8A1F, emissiveIntensity: 0.4, roughness: 0.25 }));
    knob.position.y = 0.22;
    lid.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.92, 0.34, 96), this.lidMat), ridge, knob);
    lid.position.set(0.35, 3.15, 0); lid.rotation.z = -0.32; this.lid = lid; g.add(lid);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = -0.02; this.shadow.scale.set(1, 0.85, 1); scene.add(this.shadow);
    this.inner = new THREE.PointLight(0xffa040, 0, 7, 1.2); this.inner.position.set(0, 0.7, 0); g.add(this.inner);

    this.dotMat = new THREE.MeshPhysicalMaterial({ roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0xff7a00 });
    const mesh = this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(R, 22, 16), this.dotMat, MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    for (let i = 0; i < MAX; i++) mesh.setColorAt(i, col.setHex(AMBER[i % 3]));
    g.add(mesh);
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.st = new Uint8Array(MAX); this.wait = new Float32Array(MAX); this.s = new Float32Array(MAX); // st: 0 empty, 1 in jar, 2 leaving, 3 queued
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.gv = new THREE.Vector3();
    this.spin = 0; this.spinV = 0; this.tilt = { x: 0, z: 0, tx: 0, tz: 0 };
    this.first = true; this.el = null; this.dark = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.input();
  }
  theme() {
    const d = isDark(); if (d === this.dark) return; this.dark = d;
    this.glassMat.color.set(d ? 0x9fb0d8 : 0xffffff); this.glassMat.opacity = d ? 0.09 : 0.13; this.glassMat.envMapIntensity = d ? 2.2 : 1.6;
    this.lidMat.color.set(d ? 0x2A2D3A : 0x1B1E2A);
    this.shadow.material.color.set(d ? 0x000000 : 0x5a6275); this.shadow.material.opacity = d ? 0.5 : 0.16;
    this.dotMat.emissiveIntensity = d ? 0.28 : 0.06;
    this.hemi.groundColor.set(d ? 0x1a1410 : 0xdde3ee); this.hemi.intensity = d ? 0.4 : 1;
    this.rimLight.intensity = d ? 2.2 : 0.6; this.glow.visible = d;
  }
  attach(el) {
    if (this.el === el) return;
    if (this.el) this.ro.unobserve(this.el);
    this.el = el;
    if (!el) return;
    el.prepend(this.canvas); el.classList.add('gl');
    this.ro.observe(el); this.resize();
  }
  resize() {
    if (!this.el) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const a = w / h; this.camera.aspect = a;
    // on Today the number card sits bottom-left, so the jar stands right of centre;
    // in the Add spend sheet it is small and centred
    const mini = this.el.classList.contains('mini3d');
    const dist = mini ? 8.4 * Math.max(1, 0.8 / a) : 9.6 * Math.max(1, 1.1 / a);
    this.group.position.x = this.glow.position.x = this.shadow.position.x = mini ? 0 : 0.75;
    this.camera.position.set(0, 2.2, dist); this.camera.lookAt(0, mini ? 1.7 : 1.55, 0);
    this.camera.updateProjectionMatrix(); this.kick();
  }
  input() {
    const c = this.canvas; let x0 = null;
    c.addEventListener('pointerdown', e => { x0 = e.clientX; });
    addEventListener('pointerup', () => { x0 = null; });
    addEventListener('pointermove', e => {
      if (!this.el) return;
      const r = this.el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside && x0 === null) { this.tilt.tx = this.tilt.tz = 0; return; }
      const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
      if (this.motion) { this.tilt.tz = -nx * 0.16; this.tilt.tx = ny * 0.08; }
      if (x0 !== null) { const dx = e.clientX - x0; x0 = e.clientX; this.spinV = dx * 0.5; this.spin += dx * 0.01; }
      this.kick();
    }, { passive: true });
  }
  alive() { let n = 0; for (let i = 0; i < MAX; i++) if (this.st[i] === 1 || this.st[i] === 3) n++; return n; }
  setCount(n, instant) {
    n = Math.max(0, Math.min(MAX, n | 0));
    let have = this.alive();
    const { p, v, st, wait } = this;
    if (n > have) {
      let k = 0;
      for (let i = 0; i < MAX && have < n; i++) {
        if (st[i] !== 0) continue;
        if (instant) {
          st[i] = 1; this.s[i] = 1;
          const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * 0.8;
          p[i * 3] = Math.cos(a) * d; p[i * 3 + 1] = 0.25 + Math.random() * 1.6; p[i * 3 + 2] = Math.sin(a) * d;
          v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
        } else { st[i] = 3; wait[i] = k++ * 0.03; }
        have++;
      }
      if (instant) for (let s = 0; s < 240; s++) this.step(1 / 60);
    } else if (n < have) {
      for (let i = 0; i < MAX && have > n; i++) if (st[i] === 3) { st[i] = 0; have--; }
      const order = [];
      for (let i = 0; i < MAX; i++) if (st[i] === 1) order.push(i);
      order.sort((a, b) => p[b * 3 + 1] - p[a * 3 + 1]);
      for (let j = 0; j < order.length && have > n; j++, have--) {
        const i = order[j];
        if (instant) { st[i] = 0; continue; }
        st[i] = 2; wait[i] = j * 0.03; v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
      }
    }
    this.kick();
  }
  step(dt) {
    const { p, v, st, wait } = this;
    this.q.copy(this.group.quaternion).invert();
    this.gv.set(0, -16, 0).applyQuaternion(this.q); // gravity in the jar's frame: tilt it and the dots slide
    const gx = this.gv.x, gy = this.gv.y, gz = this.gv.z;
    const W = 1.0 - R, F = 0.07 + R, M = 0.72 - R;
    for (let i = 0; i < MAX; i++) {
      const o = i * 3;
      if (st[i] === 3) {
        wait[i] -= dt;
        if (wait[i] <= 0) {
          st[i] = 1; this.s[i] = 1;
          const a = Math.random() * 6.283, d = Math.random() * 0.35;
          p[o] = Math.cos(a) * d; p[o + 1] = 3.4 + Math.random() * 0.4; p[o + 2] = Math.sin(a) * d;
          v[o] = 0; v[o + 1] = -3; v[o + 2] = 0;
        }
        continue;
      }
      if (st[i] === 1) {
        v[o] += gx * dt; v[o + 1] += gy * dt; v[o + 2] += gz * dt;
        v[o] *= 0.99; v[o + 2] *= 0.99;
        p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
        if (p[o + 1] < F) { p[o + 1] = F; v[o + 1] *= -0.28; v[o] *= 0.86; v[o + 2] *= 0.86; }
        const lim = p[o + 1] > 2.3 ? M : W, d = Math.hypot(p[o], p[o + 2]);
        if (d > lim) {
          const nx = p[o] / d, nz = p[o + 2] / d;
          p[o] = nx * lim; p[o + 2] = nz * lim;
          const vn = v[o] * nx + v[o + 2] * nz;
          if (vn > 0) { v[o] -= 1.35 * vn * nx; v[o + 2] -= 1.35 * vn * nz; }
        }
      } else if (st[i] === 2) {
        if (wait[i] > 0) { wait[i] -= dt; continue; }
        if (p[o + 1] < 2.95 && v[o + 1] >= 0) {
          v[o + 1] = 10; p[o] *= 0.82; p[o + 2] *= 0.82; p[o + 1] += v[o + 1] * dt;
          if (p[o + 1] >= 2.95) { const a = Math.random() * 6.283; v[o] = Math.cos(a) * 2.6; v[o + 2] = Math.sin(a) * 2.6 + 1.3; v[o + 1] = 4.5; }
        } else {
          v[o + 1] -= 16 * dt;
          p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
          this.s[i] = Math.max(0, this.s[i] - dt * 1.2);
          if (this.s[i] <= 0) st[i] = 0;
        }
      }
    }
    const D = 2 * R, D2 = D * D;
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < MAX; i++) {
        if (st[i] !== 1) continue;
        const a = i * 3;
        for (let j = i + 1; j < MAX; j++) {
          if (st[j] !== 1) continue;
          const b = j * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const q = dx * dx + dy * dy + dz * dz;
          if (q >= D2 || q === 0) continue;
          const d = Math.sqrt(q), push = (D - d) / d * 0.5;
          p[a] -= dx * push; p[a + 1] -= dy * push; p[a + 2] -= dz * push;
          p[b] += dx * push; p[b + 1] += dy * push; p[b + 2] += dz * push;
          const rv = ((v[b] - v[a]) * dx + (v[b + 1] - v[a + 1]) * dy + (v[b + 2] - v[a + 2]) * dz) / d;
          if (rv < 0) { const k = rv * 0.6 / d; v[a] += dx * k; v[a + 1] += dy * k; v[a + 2] += dz * k; v[b] -= dx * k; v[b + 1] -= dy * k; v[b + 2] -= dz * k; }
        }
      }
    }
  }
  moving() {
    for (let i = 0; i < MAX; i++) {
      if (this.st[i] === 2 || this.st[i] === 3) return true;
      if (this.st[i] === 1 && Math.abs(this.v[i * 3 + 1]) > 0.05) return true;
    }
    return Math.abs(this.spinV) > 0.01 || Math.abs(this.tilt.x - this.tilt.tx) > 0.002 || Math.abs(this.tilt.z - this.tilt.tz) > 0.002 || Math.abs(this.spin) > 0.002;
  }
  draw(t) {
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const sc = this.st[i] === 1 || this.st[i] === 2 ? this.s[i] : 0;
      if (this.st[i] === 1) n++;
      this.m.makeScale(sc, sc, sc); this.m.setPosition(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.inner.intensity = (this.dark ? 3 : 1) + n * (this.dark ? 0.09 : 0.02);
    this.glow.material.opacity = 0.45 + Math.min(1, n / 120) * 0.55;
    this.group.rotation.set(this.tilt.x, this.spin, this.tilt.z);
    this.lid.position.y = 3.15 + (this.motion ? Math.sin(t / 900) * 0.04 : 0);
    this.renderer.render(this.scene, this.camera);
  }
  kick() { if (!this.raf && this.el && !document.hidden) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  loop(t) {
    this.raf = 0;
    if (!this.el) return;
    const dt = Math.min((t - this.last) / 1000, 1 / 30); this.last = t;
    this.tilt.x += (this.tilt.tx - this.tilt.x) * Math.min(1, dt * 5);
    this.tilt.z += (this.tilt.tz - this.tilt.z) * Math.min(1, dt * 5);
    this.step(dt / 2); this.step(dt / 2);
    // drag spins it; it springs back so it always faces you, with a slow sway while motion is on
    this.spinV *= 0.9;
    const rest = this.motion ? Math.sin(t / 2600) * 0.3 : 0;
    this.spin += this.spinV * dt + (rest - this.spin) * Math.min(1, dt * 1.6);
    this.draw(t);
    if (this.motion || this.moving()) this.kick();
  }
  sync() {
    const st = window.DJ_JAR_STATE || {};
    this.motion = !!st.motion && !reducedOS.matches;
    this.theme();
    this.attach(st.el && st.el.isConnected ? st.el : null);
    if (!this.el) return;
    this.setCount(st.count || 0, this.first && !this.motion);
    this.first = false;
    this.kick();
  }
}

let jar = null;
try { jar = new Jar(); } catch (e) { console.warn('3D jar off, drawn jar stays:', e); }
if (jar) {
  window.DJJAR = jar;
  document.addEventListener('visibilitychange', () => jar.kick());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { jar.theme(); jar.kick(); });
  jar.sync();
}
