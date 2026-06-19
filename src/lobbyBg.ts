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

  ctx.fillStyle = '#3b7a24';
  ctx.fillRect(0, 0, W, H);

  const rng = seededRandom(42);

  drawGrass(ctx, W, H, rng);
  drawClovers(ctx, W, H, rng);
  drawFlowers(ctx, W, H, rng);
  drawPebbles(ctx, W, H, rng);
  drawTufts(ctx, W, H, rng);
  drawLeafClusters(ctx, W, H, rng);

  drawGlobulo(ctx, W * 0.18, H * 0.5 - 20, 44, 0xe84444);
  drawGlobulo(ctx, W * 0.82, H * 0.5 + 30, 44, 0xf5c842);
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
    const col = darken(0x7ec850, shade);
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
    ctx.fillStyle = rgbStr(rng() < 0.5 ? 0x5db838 : 0x6cc44a, 0.45);
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
    ctx.strokeStyle = rgbStr(0x4a9928, 0.5);
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

function drawLeafClusters(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  rng: () => number,
) {
  const count = 6 + Math.floor((W * H) / 120000);
  for (let i = 0; i < count; i++) {
    const side = rng();
    let x: number, y: number;
    if (side < 0.25) { x = rng() * W * 0.15; y = rng() * H; }
    else if (side < 0.5) { x = W - rng() * W * 0.15; y = rng() * H; }
    else if (side < 0.75) { x = rng() * W; y = rng() * H * 0.12; }
    else { x = rng() * W; y = H - rng() * H * 0.12; }
    const rx = 40 + rng() * 35;
    const ry = 30 + rng() * 25;
    const colors = [0x3d9020, 0x4aaa22, 0x48a820, 0x50b025];
    const col = colors[Math.floor(rng() * colors.length)];

    ctx.fillStyle = rgbStr(darken(col, 0.55), 0.5);
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 6, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbStr(col, 0.85);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbStr(darken(col, 1.25), 0.35);
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.2, y - ry * 0.2, rx * 0.45, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
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

  // Drop shadow
  ctx.fillStyle = rgbStr(0x000000, 0.22);
  ctx.beginPath();
  ctx.arc(x + 4, y + 6, r, 0, Math.PI * 2);
  ctx.fill();

  // Spiky border
  const dark = darken(color, 0.58);
  ctx.fillStyle = rgbStr(dark, 1);
  ctx.beginPath();
  const spikes = 22;
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r + 5 : r - 2;
    const sx = x + Math.cos(angle) * rad;
    const sy = y + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();

  // Main body
  ctx.fillStyle = rgbStr(color, 1);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.fillStyle = rgbStr(0xffffff, 0.3);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.22, y - r * 0.28, r * 0.36, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyeScale = r / 18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x - 7 * eyeScale, y - 5 * eyeScale, 6.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 7 * eyeScale, y - 5 * eyeScale, 6.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(x - 5.5 * eyeScale, y - 4 * eyeScale, 3.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 8 * eyeScale, y - 4 * eyeScale, 3.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();

  // Eye shine
  ctx.fillStyle = rgbStr(0xffffff, 0.85);
  ctx.beginPath();
  ctx.arc(x - 3.5 * eyeScale, y - 6.5 * eyeScale, 1.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 9.5 * eyeScale, y - 6.5 * eyeScale, 1.5 * eyeScale, 0, Math.PI * 2);
  ctx.fill();

  // Mouth — small happy curve
  ctx.strokeStyle = rgbStr(darken(color, 0.45), 0.7);
  ctx.lineWidth = 2 * eyeScale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x + 1 * eyeScale, y + 4 * eyeScale, 5 * eyeScale, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.restore();
}
