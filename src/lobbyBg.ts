let lobbyAnimId = 0;

export function drawLobbyBackground(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#c7f554';
  ctx.fillRect(0, 0, W, H);

  const rng = seededRandom(42);

  drawGrass(ctx, W, H, rng);
  drawClovers(ctx, W, H, rng);
  drawFlowers(ctx, W, H, rng);
  drawPebbles(ctx, W, H, rng);
  drawTufts(ctx, W, H, rng);
  drawSvgLeaves(ctx, W, H, rng);

  const staticImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const globulos = [
    { baseX: W * 0.18, baseY: H * 0.5 - 20, r: 44, color: 0xe84444, phase: 0 },
    { baseX: W * 0.82, baseY: H * 0.5 + 30, r: 44, color: 0xf5c842, phase: Math.PI * 0.7 },
  ];

  if (lobbyAnimId) cancelAnimationFrame(lobbyAnimId);

  function animate(time: number) {
    ctx.putImageData(staticImage, 0, 0);
    for (const g of globulos) {
      const bob = Math.sin(time * 0.0015 + g.phase) * 2.5;
      const breathX = 1 + Math.sin(time * 0.002 + g.phase + 1) * 0.02;
      const breathY = 1 - Math.sin(time * 0.002 + g.phase + 1) * 0.015;
      ctx.save();
      ctx.translate(g.baseX, g.baseY + bob);
      ctx.scale(breathX, breathY);
      drawGlobulo(ctx, 0, 0, g.r, g.color);
      ctx.restore();
    }
    lobbyAnimId = requestAnimationFrame(animate);
  }
  lobbyAnimId = requestAnimationFrame(animate);
}

export function stopLobbyAnimation() {
  if (lobbyAnimId) { cancelAnimationFrame(lobbyAnimId); lobbyAnimId = 0; }
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function rgbStr(hex: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darken(hex: number, f: number): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    (Math.min(255, Math.floor(r * f)) << 16) |
    (Math.min(255, Math.floor(g * f)) << 8) |
    Math.min(255, Math.floor(b * f))
  );
}

// ── Textures ──

function drawGrass(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const count = Math.floor((W * H) / 900);
  for (let i = 0; i < count; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const a = rng() * Math.PI * 2;
    const len = 6 + rng() * 14;
    const shade = 0.9 + rng() * 0.15;
    const col = darken(0xc7f554, shade);
    ctx.strokeStyle = rgbStr(col, 0.5);
    ctx.lineWidth = rng() < 0.08 ? 1.5 : 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

function drawClovers(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const count = Math.floor((W * H) / 18000);
  for (let i = 0; i < count; i++) {
    const cx = rng() * W;
    const cy = rng() * H;
    const r = 3 + rng() * 2.5;
    ctx.fillStyle = rgbStr(rng() < 0.5 ? 0x82cc2f : 0x9ae040, 0.45);
    for (let j = 0; j < 3; j++) {
      const la = (j / 3) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(la) * r, cy + Math.sin(la) * r, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFlowers(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const colors = [0xf5e663, 0xffffff, 0xe8a0d0, 0xaaddff];
  const count = Math.floor((W * H) / 25000);
  for (let i = 0; i < count; i++) {
    const fx = rng() * W;
    const fy = rng() * H;
    const col = colors[Math.floor(rng() * colors.length)];
    const pr = 2.2 + rng() * 1.8;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2;
      ctx.fillStyle = rgbStr(col, 0.6);
      ctx.beginPath();
      ctx.arc(fx + Math.cos(pa) * pr * 1.2, fy + Math.sin(pa) * pr * 1.2, pr * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgbStr(0xffee44, 0.85);
    ctx.beginPath();
    ctx.arc(fx, fy, pr * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPebbles(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const count = Math.floor((W * H) / 40000);
  for (let i = 0; i < count; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const sw = 3 + rng() * 4;
    const sh = 2 + rng() * 3;
    const col = rng() < 0.5 ? 0xaaa890 : 0x9a9580;
    ctx.fillStyle = rgbStr(col, 0.4);
    ctx.beginPath();
    ctx.ellipse(px, py, sw, sh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgbStr(0xffffff, 0.1);
    ctx.beginPath();
    ctx.ellipse(px - 1, py - 1, sw * 0.5, sh * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTufts(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const count = Math.floor((W * H) / 20000);
  for (let i = 0; i < count; i++) {
    const tx = rng() * W;
    const ty = rng() * H;
    ctx.strokeStyle = rgbStr(0x82cc2f, 0.5);
    ctx.lineWidth = 1.2;
    for (let b = -1; b <= 1; b++) {
      const ba = -Math.PI / 2 + b * 0.4;
      const bLen = 6 + rng() * 6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(ba) * bLen, ty + Math.sin(ba) * bLen);
      ctx.stroke();
    }
  }
}

function drawSvgLeaves(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const leaf1paths = [
    { pts: [[141.5,80.5],[106.5,7.5],[106.5,31],[104,83.5],[83,110],[39.5,100.5],[62.5,135],[114.5,137],[141.5,114],[141.5,80.5]], color: 0x000000, alpha: 0.08 },
    { pts: [[92.5,16.5],[105,6.5],[109.5,16.5],[102,26],[109.5,42],[109.5,89],[83.5,114.5],[30.5,106],[0,71.5],[4,21],[34,3],[65,0],[92.5,16.5]], color: 0x95df42, alpha: 1 },
    { pts: [[66.5,62.5],[107.5,11.5],[107.5,17.5],[103,26],[110,47.5],[110,90],[84,115],[31.5,107],[17.5,90],[66.5,62.5]], color: 0x82cc2f, alpha: 1 },
  ];
  const leaf2paths = [
    { pts: [[57.5,34.5],[8.5,17.5],[4,23.5],[34,34.5],[38,55.5],[57.5,70],[85,70],[98.5,50.5],[85,29],[57.5,34.5]], color: 0x000000, alpha: 0.08 },
    { pts: [[7,9],[0,20.5],[4,23],[11,13.5],[25,15.5],[30.5,40.5],[40.5,50],[74,46.5],[76,37],[84,29.5],[74,9],[51,0],[30.5,6],[7,9]], color: 0x95df42, alpha: 1 },
    { pts: [[3.5,24],[0,21.5],[6.5,8.5],[27,6],[46.5,11.5],[76.5,35.5],[74,47],[42,50],[30,41],[25.5,16],[11.5,13],[3.5,24]], color: 0x82cc2f, alpha: 1 },
  ];
  const leaves = [
    { paths: leaf1paths, w: 142, h: 137 },
    { paths: leaf2paths, w: 99, h: 70 },
  ];

  const m = 60;
  const placements = [
    { leaf: 0, x: m + rng() * 40, y: m + rng() * 40, sc: 0.8 + rng() * 0.3, rot: rng() * 0.5 },
    { leaf: 1, x: W - m - rng() * 40, y: m + rng() * 40, sc: 0.8 + rng() * 0.3, rot: 0.2 + rng() * 0.4 },
    { leaf: 0, x: m + rng() * 40, y: H - m - rng() * 40, sc: 0.7 + rng() * 0.3, rot: -0.6 + rng() * 0.3 },
    { leaf: 1, x: W - m - rng() * 40, y: H - m - rng() * 40, sc: 0.8 + rng() * 0.3, rot: 2.2 + rng() * 0.5 },
    { leaf: 1, x: W * 0.3, y: m + rng() * 20, sc: 0.6 + rng() * 0.2, rot: 1.0 + rng() * 0.5 },
    { leaf: 0, x: W * 0.7, y: H - m - rng() * 20, sc: 0.6 + rng() * 0.2, rot: 1.8 + rng() * 0.5 },
    { leaf: 0, x: m, y: H * 0.45, sc: 0.7 + rng() * 0.2, rot: -0.3 + rng() * 0.3 },
    { leaf: 1, x: W - m, y: H * 0.55, sc: 0.7 + rng() * 0.2, rot: 3.0 + rng() * 0.3 },
  ];

  for (const p of placements) {
    const lf = leaves[p.leaf];
    for (const path of lf.paths) {
      ctx.fillStyle = rgbStr(path.color, path.alpha);
      ctx.beginPath();
      for (let i = 0; i < path.pts.length; i++) {
        const dx = (path.pts[i][0] - lf.w / 2) * p.sc;
        const dy = (path.pts[i][1] - lf.h / 2) * p.sc;
        const rx = dx * Math.cos(p.rot) - dy * Math.sin(p.rot);
        const ry = dx * Math.sin(p.rot) + dy * Math.cos(p.rot);
        if (i === 0) ctx.moveTo(p.x + rx, p.y + ry);
        else ctx.lineTo(p.x + rx, p.y + ry);
      }
      ctx.fill();
    }
  }
}

// ── Globulo ──

function drawGlobulo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: number,
) {
  ctx.save();
  const e = r / 18;

  // Shadow
  ctx.fillStyle = rgbStr(0x000000, 0.15);
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 5, r * 1.05, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Darker outline ring
  ctx.fillStyle = rgbStr(darken(color, 0.65), 1);
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();

  // Main body
  ctx.fillStyle = rgbStr(color, 1);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Lighter belly
  ctx.fillStyle = rgbStr(darken(color, 1.2), 0.35);
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.15, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top shine
  ctx.fillStyle = rgbStr(0xffffff, 0.35);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.15, y - r * 0.35, r * 0.35, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const ey = y - 2 * e;
  const esp = 5.5 * e;
  const er = 5.5 * e;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x - esp, ey, er, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + esp, ey, er, 0, Math.PI * 2); ctx.fill();

  // Pupils
  const pr = 3 * e;
  ctx.fillStyle = '#222222';
  ctx.beginPath(); ctx.arc(x - esp + 0.5 * e, ey + 0.5 * e, pr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + esp + 0.5 * e, ey + 0.5 * e, pr, 0, Math.PI * 2); ctx.fill();

  // Pupil shine
  ctx.fillStyle = rgbStr(0xffffff, 0.9);
  ctx.beginPath(); ctx.arc(x - esp - 1 * e, ey - 1.5 * e, 1.3 * e, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + esp - 1 * e, ey - 1.5 * e, 1.3 * e, 0, Math.PI * 2); ctx.fill();

  // Mouth
  ctx.strokeStyle = rgbStr(darken(color, 0.4), 0.6);
  ctx.lineWidth = 1.8 * e;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 3 * e, 4 * e, 0.3, Math.PI - 0.3);
  ctx.stroke();

  // Cheek blush
  ctx.fillStyle = rgbStr(darken(color, 0.85), 0.2);
  ctx.beginPath(); ctx.ellipse(x - r * 0.55, y + 3 * e, 5 * e, 3.5 * e, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + r * 0.55, y + 3 * e, 5 * e, 3.5 * e, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}
