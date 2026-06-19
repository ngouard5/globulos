import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';
import { Globulo } from '../entities/Globulo';
import type { Team } from '../entities/Globulo';
import type { Client } from '../network/Client';
import type { LocalClient } from '../network/LocalClient';

type Phase = 'planning' | 'resolving' | 'waiting' | 'gameover';
type Move = { id: number; fx: number; fy: number };

const S = GAME_CONFIG.scale;

export class ArenaScene extends Phaser.Scene {
  private globulos: Globulo[] = [];
  private myTeam!: Team;
  private client!: Client | LocalClient;
  private isLocal = false;
  private phase: Phase = 'planning';
  private selectedGlobulo: Globulo | null = null;
  private isDragging = false;

  private panelRed!: Phaser.GameObjects.Graphics;
  private panelYellow!: Phaser.GameObjects.Graphics;
  private scoreRed!: Phaser.GameObjects.Text;
  private scoreYellow!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private btnBg!: Phaser.GameObjects.Graphics;
  private btnText!: Phaser.GameObjects.Text;
  private myPanelGlow!: Phaser.GameObjects.Graphics;
  private resolveTimer = 0;
  private submitted = false;
  private opponentReady = false;
  private countdown = 30;
  private countdownEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  create() {
    this.myTeam = this.game.registry.get('team');
    this.client = this.game.registry.get('client');
    this.isLocal = this.game.registry.get('isLocal') ?? false;

    this.globulos = [];
    this.phase = 'planning';
    this.selectedGlobulo = null;
    this.isDragging = false;
    this.resolveTimer = 0;
    this.submitted = false;
    this.opponentReady = false;
    this.countdown = 30;
    this.countdownEvent = null;

    this.matter.world.setGravity(0, 0);

    this.drawArena();
    this.spawnGlobulos();
    this.setupInput();
    this.createUI();
    this.setupNetwork();
  }

  // ───────────────── Network ─────────────────

  private setupNetwork() {
    this.client.removeAllListeners();

    this.client.on('round-start', (data) => {
      this.startRound(data.duration as number);
    });

    this.client.on('opponent-ready', () => {
      this.opponentReady = true;
      if (this.submitted) {
        this.statusText.setText('Les deux sont prêts...');
      } else {
        this.statusText.setText('Adversaire prêt !');
      }
    });

    this.client.on('resolve', (data) => {
      const moves = data.moves as { red: Move[]; yellow: Move[] };
      this.resolveRound(moves);
    });

    this.client.on('opponent-disconnected', () => {
      this.phase = 'gameover';
      if (this.countdownEvent) this.countdownEvent.destroy();
      this.showDisconnect();
    });
  }

  private startRound(duration: number) {
    this.phase = 'planning';
    this.submitted = false;
    this.opponentReady = false;
    this.countdown = duration;

    this.globulos
      .filter((g) => g.team === this.myTeam && g.alive)
      .forEach((g) => g.clearPendingForce());

    this.btnText.setText('Valider');
    this.btnBg.setAlpha(1);
    this.statusText.setText(this.isLocal ? 'Déplacez vos Globulos' : 'Déplacez vos Globulos');
    this.updateTimerDisplay();
    this.updateScores();

    if (this.countdownEvent) this.countdownEvent.destroy();
    this.countdownEvent = this.time.addEvent({
      delay: 1000,
      repeat: duration - 1,
      callback: () => {
        this.countdown--;
        this.updateTimerDisplay();
        if (this.countdown <= 0 && !this.submitted) {
          this.submitMoves();
        }
      },
    });
  }

  private submitMoves() {
    if (this.submitted || this.phase !== 'planning') return;
    this.submitted = true;

    if (this.selectedGlobulo) {
      this.selectedGlobulo = null;
      this.isDragging = false;
    }

    if (this.isLocal) {
      const collectTeam = (team: Team): Move[] =>
        this.globulos.filter((g) => g.team === team && g.alive).map((g) => ({
          id: g.id, fx: g.pendingForce?.x ?? 0, fy: g.pendingForce?.y ?? 0,
        }));
      this.client.send({ type: 'submit-local', moves: { red: collectTeam('red'), yellow: collectTeam('yellow') } });
    } else {
      const moves: Move[] = this.globulos
        .filter((g) => g.team === this.myTeam && g.alive)
        .map((g) => ({
          id: g.id, fx: g.pendingForce?.x ?? 0, fy: g.pendingForce?.y ?? 0,
        }));
      this.client.send({ type: 'submit', moves });
    }

    this.btnText.setText(this.isLocal ? '...' : 'En attente...');
    this.btnBg.setAlpha(0.6);
    if (!this.isLocal) {
      this.statusText.setText(
        this.opponentReady ? 'Les deux sont prêts...' : "En attente de l'adversaire...",
      );
    }
  }

  private resolveRound(moves: { red: Move[]; yellow: Move[] }) {
    if (this.countdownEvent) this.countdownEvent.destroy();
    this.phase = 'resolving';
    this.statusText.setText('');
    this.timerText.setText('');
    this.btnText.setText('...');
    this.btnBg.setAlpha(0.5);

    this.globulos.forEach((g) => g.clearPendingForce());

    for (const team of ['red', 'yellow'] as Team[]) {
      const teamMoves = moves[team] ?? [];
      teamMoves.forEach((m) => {
        const g = this.globulos.find(
          (gl) => gl.team === team && gl.id === m.id,
        );
        if (g?.alive) g.setPendingForce(m.fx, m.fy);
      });
    }

    this.globulos.forEach((g) => g.applyForce());
    this.resolveTimer = 0;
  }

  // ───────────────── Arena drawing ─────────────────

  private drawArena() {
    const { centerX, centerY, radius, pitRadius } = GAME_CONFIG.arena;

    this.drawEnvironment(centerX, centerY, radius);

    const g = this.add.graphics();

    g.fillStyle(0x1a3a08, 0.55);
    g.fillCircle(centerX + 5 * S, centerY + 8 * S, radius);

    g.fillStyle(0x7ec850, 1);
    g.fillCircle(centerX, centerY, radius);

    const rng = new Phaser.Math.RandomDataGenerator(['arena-grass']);
    const grassCount = 420;
    for (let i = 0; i < grassCount; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = rng.frac() * (radius - 18 * S);
      const x = centerX + Math.cos(a) * r;
      const y = centerY + Math.sin(a) * r;
      const len = (6 + rng.frac() * 14) * S;
      const tilt = (rng.frac() - 0.5) * 0.6;
      const shade = 0.92 + rng.frac() * 0.12;
      const col = this.darkenColor(0x7ec850, shade);
      g.lineStyle((rng.frac() < 0.08 ? 1.5 : 0.9) * S, col, 0.85);
      g.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(x, y);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(x + Math.cos(a + tilt) * len, y + Math.sin(a + tilt) * len);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }

    for (let i = 0; i < 18; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 30 * S + rng.frac() * (radius - 60 * S);
      const cx2 = centerX + Math.cos(a) * r;
      const cy2 = centerY + Math.sin(a) * r;
      const cloverR = (3 + rng.frac() * 2) * S;
      const shade = rng.frac() < 0.5 ? 0x5db838 : 0x6cc44a;
      g.fillStyle(shade, 0.55);
      for (let j = 0; j < 3; j++) {
        const la = (j / 3) * Math.PI * 2 - Math.PI / 2;
        g.fillCircle(cx2 + Math.cos(la) * cloverR, cy2 + Math.sin(la) * cloverR, cloverR * 0.8);
      }
    }

    const flowerColors = [0xf5e663, 0xffffff, 0xe8a0d0, 0xaaddff];
    for (let i = 0; i < 14; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 40 * S + rng.frac() * (radius - 70 * S);
      const fx = centerX + Math.cos(a) * r;
      const fy = centerY + Math.sin(a) * r;
      const fCol = flowerColors[i % flowerColors.length];
      const petalR = (2.2 + rng.frac() * 1.5) * S;
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        g.fillStyle(fCol, 0.7);
        g.fillCircle(fx + Math.cos(pa) * petalR * 1.2, fy + Math.sin(pa) * petalR * 1.2, petalR * 0.7);
      }
      g.fillStyle(0xffee44, 0.9);
      g.fillCircle(fx, fy, petalR * 0.5);
    }

    for (let i = 0; i < 10; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 25 * S + rng.frac() * (radius - 50 * S);
      const px = centerX + Math.cos(a) * r;
      const py = centerY + Math.sin(a) * r;
      const sw = (3 + rng.frac() * 3) * S;
      const sh = (2 + rng.frac() * 2) * S;
      const stoneCol = rng.frac() < 0.5 ? 0xaaa890 : 0x9a9580;
      g.fillStyle(stoneCol, 0.5);
      g.fillEllipse(px, py, sw * 2, sh * 2);
      g.fillStyle(0xffffff, 0.12);
      g.fillEllipse(px - S, py - S, sw, sh * 0.6);
    }

    for (let i = 0; i < 22; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 20 * S + rng.frac() * (radius - 40 * S);
      const tx = centerX + Math.cos(a) * r;
      const ty = centerY + Math.sin(a) * r;
      g.lineStyle(1.2 * S, 0x4a9928, 0.6);
      for (let b = -1; b <= 1; b++) {
        const ba = -Math.PI / 2 + b * 0.4;
        const bLen = (6 + rng.frac() * 5) * S;
        g.beginPath();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).moveTo(tx, ty);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).lineTo(tx + Math.cos(ba) * bLen, ty + Math.sin(ba) * bLen);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).strokePath();
      }
    }

    g.lineStyle(10 * S, 0x5aaa32, 0.35);
    g.strokeCircle(centerX, centerY, radius - 5 * S);

    this.drawPit(g, centerX, centerY, pitRadius);

    this.createArenaBorder(centerX, centerY, radius);
  }

  private drawEnvironment(cx: number, cy: number, arenaRadius: number) {
    const g = this.add.graphics();
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const leaves = [
      { x: 55 * S, y: 55 * S, rx: 58 * S, ry: 42 * S, color: 0x3d9020 },
      { x: W - 55 * S, y: 55 * S, rx: 52 * S, ry: 45 * S, color: 0x4aaa22 },
      { x: 65 * S, y: H - 60 * S, rx: 60 * S, ry: 40 * S, color: 0x48a820 },
      { x: W - 60 * S, y: H - 55 * S, rx: 50 * S, ry: 48 * S, color: 0x3d9820 },
      { x: cx - arenaRadius - 62 * S, y: cy - 70 * S, rx: 68 * S, ry: 50 * S, color: 0x4aaa22 },
      { x: cx - arenaRadius - 55 * S, y: cy + 75 * S, rx: 52 * S, ry: 62 * S, color: 0x3d9020 },
      { x: cx + arenaRadius + 58 * S, y: cy - 65 * S, rx: 62 * S, ry: 52 * S, color: 0x50b025 },
      { x: cx + arenaRadius + 52 * S, y: cy + 70 * S, rx: 55 * S, ry: 45 * S, color: 0x44a020 },
      { x: cx - 80 * S, y: 32 * S, rx: 60 * S, ry: 32 * S, color: 0x4aaa22 },
      { x: cx + 70 * S, y: 28 * S, rx: 55 * S, ry: 28 * S, color: 0x3d9020 },
      { x: cx - 60 * S, y: H - 32 * S, rx: 65 * S, ry: 32 * S, color: 0x48a820 },
      { x: cx + 75 * S, y: H - 28 * S, rx: 58 * S, ry: 28 * S, color: 0x50b025 },
    ];

    leaves.forEach(({ x, y, rx, ry, color }) => {
      g.fillStyle(this.darkenColor(color, 0.55), 0.6);
      g.fillEllipse(x + 5 * S, y + 7 * S, rx * 2, ry * 2);
    });
    leaves.forEach(({ x, y, rx, ry, color }) => {
      g.fillStyle(color, 1);
      g.fillEllipse(x, y, rx * 2, ry * 2);
    });
    leaves.forEach(({ x, y, rx, ry, color }) => {
      g.fillStyle(this.lightenColor(color, 1.25), 0.45);
      g.fillEllipse(x - rx * 0.2, y - ry * 0.2, rx * 0.9, ry * 0.7);
    });

    const bubbles = [
      { x: cx - arenaRadius - 110 * S, y: cy + 15 * S, r: 12 * S },
      { x: cx + arenaRadius + 100 * S, y: cy - 15 * S, r: 9 * S },
      { x: cx - arenaRadius - 85 * S, y: cy - 130 * S, r: 10 * S },
      { x: cx + arenaRadius + 80 * S, y: cy + 130 * S, r: 11 * S },
    ];
    bubbles.forEach(({ x, y, r }) => {
      g.fillStyle(0x88dd44, 0.35);
      g.fillCircle(x, y, r);
      g.lineStyle(1.5 * S, 0xaaffaa, 0.4);
      g.strokeCircle(x, y, r);
    });
  }

  private drawPit(g: Phaser.GameObjects.Graphics, cx: number, cy: number, pitRadius: number) {
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(cx + 5 * S, cy + 7 * S, (pitRadius + 18 * S) * 1.1, (pitRadius + 12 * S) * 0.9);

    g.fillStyle(0x8b6842, 1);
    g.fillCircle(cx, cy, pitRadius + 10 * S);
    g.lineStyle(5 * S, 0x6d5030, 0.6);
    g.strokeCircle(cx, cy, pitRadius + 10 * S);

    const numBumps = 18;
    for (let i = 0; i < numBumps; i++) {
      const angle = (i / numBumps) * Math.PI * 2 + 0.17;
      const size = (10 + (i % 3 === 0 ? 3 : i % 3 === 1 ? -2 : 0)) * S;
      g.fillStyle(i % 2 === 0 ? 0x9a7550 : 0x7a5a38, 1);
      g.fillCircle(cx + Math.cos(angle) * pitRadius, cy + Math.sin(angle) * pitRadius, size);
    }

    const rings = 8;
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const col = this.interpolateColor(0x6e4e30, 0x4a3520, t);
      const rr = pitRadius - 4 * S - (i * (pitRadius - 10 * S)) / rings;
      g.fillStyle(col, 0.92 - t * 0.08);
      g.fillCircle(cx, cy, rr);
    }

    const rng = new Phaser.Math.RandomDataGenerator(['pit-tex']);
    for (let i = 0; i < 30; i++) {
      const a = rng.frac() * Math.PI * 2;
      const d = rng.frac() * (pitRadius - 12 * S);
      const sx = cx + Math.cos(a) * d;
      const sy = cy + Math.sin(a) * d;
      g.fillStyle(rng.frac() < 0.5 ? 0x8a6a48 : 0x5c4028, 0.35);
      g.fillCircle(sx, sy, (1 + rng.frac() * 2.5) * S);
    }

    g.fillStyle(0xffffff, 0.1);
    g.fillEllipse(cx - 12 * S, cy - 16 * S, pitRadius * 0.8, pitRadius * 0.45);

    g.lineStyle(2 * S, 0xc8a878, 0.3);
    g.beginPath();
    g.arc(cx, cy, pitRadius + 8 * S, -Math.PI * 0.8, -Math.PI * 0.2, false);
    g.strokePath();
  }

  // ───────────────── Color helpers ─────────────────

  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  private lightenColor(color: number, factor: number): number {
    return this.darkenColor(color, factor);
  }

  private interpolateColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.min(255, Math.round(ar + (br - ar) * t));
    const g = Math.min(255, Math.round(ag + (bg - ag) * t));
    const bl = Math.min(255, Math.round(ab + (bb - ab) * t));
    return (r << 16) | (g << 8) | bl;
  }

  // ───────────────── Physics border ─────────────────

  private createArenaBorder(cx: number, cy: number, r: number) {
    const segments = 48;
    const thickness = 20 * S;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const midAngle = (angle + nextAngle) / 2;

      const x = cx + (r + thickness / 2) * Math.cos(midAngle);
      const y = cy + (r + thickness / 2) * Math.sin(midAngle);
      const segLen = 2 * (r + thickness) * Math.tan(Math.PI / segments) + 2;

      const wall = this.matter.add.rectangle(x, y, segLen, thickness, {
        isStatic: true, angle: midAngle, friction: 0.1, restitution: 0.4, label: 'wall',
      });
      void wall;
    }
  }

  // ───────────────── Spawn ─────────────────

  private spawnGlobulos() {
    const { centerX, centerY, radius, pitRadius } = GAME_CONFIG.arena;
    const safeRadius = (radius + pitRadius) / 2;

    const positions: Record<Team, { x: number; y: number }[]> = {
      red: [
        { x: centerX + safeRadius * 0.6, y: centerY - 60 * S },
        { x: centerX + safeRadius * 0.6, y: centerY },
        { x: centerX + safeRadius * 0.6, y: centerY + 60 * S },
      ],
      yellow: [
        { x: centerX - safeRadius * 0.6, y: centerY - 60 * S },
        { x: centerX - safeRadius * 0.6, y: centerY },
        { x: centerX - safeRadius * 0.6, y: centerY + 60 * S },
      ],
    };

    (['red', 'yellow'] as Team[]).forEach((team) => {
      positions[team].forEach((pos, i) => {
        this.globulos.push(new Globulo(this, pos.x, pos.y, team, i));
      });
    });
  }

  // ───────────────── Input ─────────────────

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.phase !== 'planning' || this.submitted) return;
      const hit = this.getGlobuloAt(p.worldX, p.worldY);
      if (hit) { this.selectedGlobulo = hit; this.isDragging = true; }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.selectedGlobulo) return;
      this.selectedGlobulo.drawArrow(p.worldX, p.worldY);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.selectedGlobulo) return;
      this.isDragging = false;

      const pos = this.selectedGlobulo.body.position;
      const dx = p.worldX - pos.x;
      const dy = p.worldY - pos.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const maxLen = GAME_CONFIG.turn.arrowMaxLength;
      const clampedLen = Math.min(len, maxLen);

      if (clampedLen > 5 * S) {
        const angle = Math.atan2(dy, dx);
        this.selectedGlobulo.setPendingForce(Math.cos(angle) * clampedLen, Math.sin(angle) * clampedLen);
      }

      this.selectedGlobulo = null;
    });

    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.phase === 'planning') this.submitMoves();
    });

    this.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      event.pairs.forEach((pair) => {
        const normal = pair.collision.normal;
        const gA = this.findGlobuloByBody(pair.bodyA);
        const gB = this.findGlobuloByBody(pair.bodyB);
        if (gA) gA.squish(normal.x, normal.y);
        if (gB) gB.squish(-normal.x, -normal.y);
      });
    });
  }

  private findGlobuloByBody(body: MatterJS.BodyType): Globulo | null {
    return this.globulos.find((g) => g.alive && g.body === body) ?? null;
  }

  private getGlobuloAt(x: number, y: number): Globulo | null {
    for (const g of this.globulos) {
      if (!g.alive || (!this.isLocal && g.team !== this.myTeam)) continue;
      const pos = g.body.position;
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < GAME_CONFIG.globulo.radius + 6 * S) return g;
    }
    return null;
  }

  // ───────────────── UI ─────────────────

  private createUI() {
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;
    const mobile = GAME_CONFIG.isMobile;

    this.myPanelGlow = this.add.graphics();
    this.panelRed = this.add.graphics();
    this.panelYellow = this.add.graphics();

    if (mobile) {
      this.createMobileUI(W, H);
    } else {
      this.createDesktopUI(W, H);
    }
  }

  private createMobileUI(W: number, H: number) {
    const M = 1.5;
    const topBarH = 90 * S;
    const topBarY = topBarH / 2 + 4 * S;
    const topBarBg = this.add.graphics();
    this.drawWoodButton(topBarBg, 8 * S, 6 * S, W - 16 * S, topBarH);

    const globR = 22 * M;
    this.drawMiniGlobulo(topBarBg, 55 * S, topBarY, GAME_CONFIG.teams.red.color, true, globR);
    this.scoreRed = this.add.text(100 * S, topBarY, '3', {
      fontSize: `${48 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0, 0.5);

    this.drawMiniGlobulo(topBarBg, W - 55 * S, topBarY, GAME_CONFIG.teams.yellow.color, true, globR);
    this.scoreYellow = this.add.text(W - 100 * S, topBarY, '3', {
      fontSize: `${48 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(1, 0.5);

    this.timerText = this.add.text(W / 2, topBarY, '0:30', {
      fontSize: `${38 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    if (!this.isLocal) {
      const myColor = GAME_CONFIG.teams[this.myTeam].color;
      const labelX = this.myTeam === 'red' ? 55 * S : W - 55 * S;
      this.add.text(labelX, topBarY + 34 * S, 'Vous', {
        fontSize: `${14 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
        color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 2 * S,
      }).setOrigin(0.5).setDepth(10);

      this.myPanelGlow.lineStyle(3 * S, myColor, 0.6);
      const glowX = this.myTeam === 'red' ? 18 * S : W - 118 * S;
      this.myPanelGlow.strokeRoundedRect(glowX, 8 * S, 100 * S, topBarH - 4 * S, 12 * S);
      this.tweens.add({
        targets: this.myPanelGlow, alpha: { from: 1, to: 0.3 },
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut',
      });
    }

    this.statusText = this.add.text(W / 2, H - 100 * S, 'Connexion...', {
      fontSize: `${22 * S}px`, fontFamily: 'Georgia, serif',
      color: '#fff8e8', stroke: '#00000044', strokeThickness: 2 * S,
    }).setOrigin(0.5);

    const btnW = 280 * S;
    const btnH = 72 * S;
    const btnX = W / 2 - btnW / 2;
    const btnY = H - 80 * S;
    this.btnBg = this.add.graphics();
    this.drawWoodButton(this.btnBg, btnX, btnY, btnW, btnH);

    this.btnText = this.add.text(W / 2, btnY + btnH / 2, 'Valider', {
      fontSize: `${26 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    const hitZone = this.add.zone(W / 2, btnY + btnH / 2, btnW + 20 * S, btnH + 20 * S)
      .setInteractive({ useHandCursor: true });
    hitZone.on('pointerdown', () => { if (this.phase === 'planning') this.submitMoves(); });
  }

  private createDesktopUI(W: number, H: number) {
    const cy = H / 2;
    const panelCx = 46 * S;

    this.scoreRed = this.add.text(panelCx, cy + 26 * S, '3', {
      fontSize: `${44 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.scoreYellow = this.add.text(W - panelCx, cy + 26 * S, '3', {
      fontSize: `${44 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.timerText = this.add.text(W / 2, 30 * S, '0:30', {
      fontSize: `${32 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.statusText = this.add.text(W / 2, H - 68 * S, 'Connexion...', {
      fontSize: `${15 * S}px`, fontFamily: 'Georgia, serif',
      color: '#fff8e8', stroke: '#00000044', strokeThickness: 2 * S,
    }).setOrigin(0.5);

    const btnW = 170 * S;
    const btnH = 50 * S;
    const btnX = W / 2 - btnW / 2;
    const btnY = H - 52 * S;

    this.btnBg = this.add.graphics();
    this.drawWoodButton(this.btnBg, btnX, btnY, btnW, btnH);

    this.btnText = this.add.text(W / 2, btnY + btnH / 2, 'Valider', {
      fontSize: `${17 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    const hitZone = this.add.zone(W / 2, btnY + btnH / 2, btnW + 16 * S, btnH + 16 * S)
      .setInteractive({ useHandCursor: true });
    hitZone.on('pointerdown', () => { if (this.phase === 'planning') this.submitMoves(); });
    hitZone.on('pointerover', () => { if (!this.submitted) this.btnBg.setAlpha(1.1); });
    hitZone.on('pointerout', () => { if (!this.submitted) this.btnBg.setAlpha(1); });

    this.drawPanel(this.panelRed, panelCx, GAME_CONFIG.teams.red.color, this.isLocal || this.myTeam === 'red');
    this.drawPanel(this.panelYellow, W - panelCx, GAME_CONFIG.teams.yellow.color, this.isLocal || this.myTeam === 'yellow');

    if (this.isLocal) {
      // Both panels active, no glow
    } else {
      const myColor = GAME_CONFIG.teams[this.myTeam].color;
      const myCx = this.myTeam === 'red' ? panelCx : W - panelCx;
      this.myPanelGlow.lineStyle(4 * S, myColor, 0.7);
      this.myPanelGlow.strokeRoundedRect(myCx - 44 * S, cy - 65 * S, 88 * S, 130 * S, 18 * S);
      this.myPanelGlow.lineStyle(8 * S, myColor, 0.2);
      this.myPanelGlow.strokeRoundedRect(myCx - 48 * S, cy - 69 * S, 96 * S, 138 * S, 22 * S);

      this.tweens.add({
        targets: this.myPanelGlow, alpha: { from: 1, to: 0.4 },
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut',
      });

      this.add.text(myCx, cy - 54 * S, 'Vous', {
        fontSize: `${11 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
        color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 2 * S,
      }).setOrigin(0.5).setDepth(10);
    }
  }

  private updateTimerDisplay() {
    const mins = Math.floor(this.countdown / 60);
    const secs = this.countdown % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
    if (this.countdown <= 5) this.timerText.setColor('#ff4444');
    else if (this.countdown <= 10) this.timerText.setColor('#ffaa22');
    else this.timerText.setColor('#fff8e8');
  }

  private updateScores() {
    this.scoreRed.setText(String(this.globulos.filter((g) => g.team === 'red' && g.alive).length));
    this.scoreYellow.setText(String(this.globulos.filter((g) => g.team === 'yellow' && g.alive).length));
  }

  // ───────────────── Panel / button drawing ─────────────────

  private drawPanel(g: Phaser.GameObjects.Graphics, cx: number, color: number, isActive: boolean) {
    const cy = GAME_CONFIG.height / 2;
    const pw = 76 * S;
    const ph = 118 * S;
    g.clear();
    const left = cx - pw / 2;
    const top = cy - ph / 2;

    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(left + 6 * S, top + 8 * S, pw, ph, 14 * S);

    const woodBase = isActive ? 0x9b6b36 : 0x7a5a30;
    g.fillStyle(woodBase, isActive ? 1 : 0.75);
    g.fillRoundedRect(left, top, pw, ph, 14 * S);

    g.lineStyle(2 * S, 0x704a2a, 0.95);
    g.strokeRoundedRect(left, top, pw, ph, 14 * S);
    g.lineStyle(1.2 * S, 0xffffff, 0.06);
    g.strokeRoundedRect(left + S, top + S, pw - 2 * S, ph - 2 * S, 12 * S);

    for (let i = 0; i < 6; i++) {
      const y = top + 18 * S + i * ((ph - 36 * S) / 5) + Math.sin(i * 1.3) * 2 * S;
      g.lineStyle(S, 0x6a4326, 0.25);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(left + 8 * S, y);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(left + pw - 8 * S, y + Math.sin(i * 0.9) * 3 * S);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }

    for (let k = 0; k < 3; k++) {
      const ky = top + 28 * S + k * 28 * S + (Math.random() * 6 - 3) * S;
      const kx = left + 18 * S + Math.random() * (pw - 36 * S);
      g.fillStyle(0x6b3f25, 0.55);
      g.fillEllipse(kx, ky, 10 * S, 6 * S);
      g.fillStyle(0xffffff, 0.06);
      g.fillEllipse(kx - 2 * S, ky - 2 * S, 4 * S, 2 * S);
    }

    if (isActive) {
      g.fillStyle(color, 0.12);
      g.fillRoundedRect(left + 6 * S, top + 8 * S, pw - 12 * S, 36 * S, 8 * S);
      g.lineStyle(1.6 * S, color, 0.28);
      g.strokeRoundedRect(left + 6 * S, top + 8 * S, pw - 12 * S, 36 * S, 8 * S);
    }

    this.drawMiniGlobulo(g, cx, cy - 20 * S, color, isActive);
  }

  private drawWoodButton(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    const r = 10 * S;
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x + 4 * S, y + 6 * S, w, h, r);
    g.fillStyle(0x8b5e30, 1);
    g.fillRoundedRect(x, y, w, h, r);
    g.fillStyle(0x6a4420, 0.7);
    g.fillRoundedRect(x, y + h - 8 * S, w, 8 * S, { tl: 0, tr: 0, bl: r, br: r });
    g.fillStyle(0xb8884a, 0.5);
    g.fillRoundedRect(x, y, w, 8 * S, { tl: r, tr: r, bl: 0, br: 0 });
    g.lineStyle(2 * S, 0x5a3818, 0.9);
    g.strokeRoundedRect(x, y, w, h, r);
    g.lineStyle(S, 0xd4a86a, 0.2);
    g.strokeRoundedRect(x + 2 * S, y + 2 * S, w - 4 * S, h - 4 * S, r - 2 * S);
    for (let i = 0; i < 4; i++) {
      const gy = y + 10 * S + (i * (h - 20 * S)) / 3;
      g.lineStyle(0.8 * S, 0x704020, 0.2);
      g.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(x + 10 * S, gy);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(x + w - 10 * S, gy + Math.sin(i * 1.2) * 2 * S);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }
  }

  private drawMiniGlobulo(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, isActive: boolean, customR?: number) {
    const r = customR ?? 22 * S;
    g.setAlpha(isActive ? 1 : 0.3);

    g.fillStyle(0x000000, 0.22);
    g.fillCircle(x + 2 * S, y + 3 * S, r);

    const dark = this.darkenColor(color, 0.58);
    g.fillStyle(dark, 1);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 3 * S : r - S;
      pts.push({ x: x + Math.cos(angle) * rad, y: y + Math.sin(angle) * rad });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.fillPoints(pts as any, true);

    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);

    g.fillStyle(0xffffff, 0.28);
    g.fillEllipse(x - 6 * S, y - 7 * S, 14 * S, 9 * S);

    g.fillStyle(0xffffff, 1);
    g.fillCircle(x - 7 * S, y - 5 * S, 6 * S);
    g.fillCircle(x + 7 * S, y - 5 * S, 6 * S);
    g.fillStyle(0x111111, 1);
    g.fillCircle(x - 6 * S, y - 4.5 * S, 3.2 * S);
    g.fillCircle(x + 8 * S, y - 4.5 * S, 3.2 * S);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(x - 4 * S, y - 6.5 * S, 1.2 * S);
    g.fillCircle(x + 10 * S, y - 6.5 * S, 1.2 * S);

    g.setAlpha(1);
  }

  // ───────────────── Game logic ─────────────────

  private isSettled(): boolean {
    return this.globulos.filter((g) => g.alive).every((g) => {
      const v = g.body.velocity;
      return Math.abs(v.x) < 0.1 * S && Math.abs(v.y) < 0.1 * S;
    });
  }

  private checkFallen() {
    const { centerX, centerY, pitRadius, radius: arenaRadius } = GAME_CONFIG.arena;
    this.globulos.filter((g) => g.alive).forEach((g) => {
      const pos = g.body.position;
      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < pitRadius - GAME_CONFIG.globulo.radius) {
        g.fallIntoPit(centerX, centerY, () => {});
      } else if (dist > arenaRadius + 20 * S) {
        g.destroy();
      }
    });
  }

  private checkWinner(): Team | null {
    const redAlive = this.globulos.filter((g) => g.team === 'red' && g.alive).length;
    const yellowAlive = this.globulos.filter((g) => g.team === 'yellow' && g.alive).length;
    if (redAlive === 0) return 'yellow';
    if (yellowAlive === 0) return 'red';
    return null;
  }

  private endGame(winner: Team) {
    this.phase = 'gameover';
    this.client.send({ type: 'game-over' });
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const isMe = winner === this.myTeam;
    const label = this.isLocal
      ? (winner === 'red' ? 'Rouge gagne !' : 'Jaune gagne !')
      : (isMe ? 'Victoire !' : 'Défaite...');
    const winColor = GAME_CONFIG.teams[winner].color;

    const signW = 340 * S;
    const signH = 140 * S;
    const signX = W / 2 - signW / 2;
    const signY = H / 2 - signH / 2 - 10 * S;
    const sign = this.add.graphics();

    sign.fillStyle(0x000000, 0.45);
    sign.fillRoundedRect(signX + 6 * S, signY + 8 * S, signW, signH, 16 * S);
    sign.fillStyle(0x8b5e30, 1);
    sign.fillRoundedRect(signX, signY, signW, signH, 16 * S);
    sign.fillStyle(0x6a4420, 0.6);
    sign.fillRoundedRect(signX, signY + signH - 14 * S, signW, 14 * S, { tl: 0, tr: 0, bl: 16 * S, br: 16 * S });
    sign.fillStyle(0xb8884a, 0.4);
    sign.fillRoundedRect(signX, signY, signW, 14 * S, { tl: 16 * S, tr: 16 * S, bl: 0, br: 0 });
    sign.lineStyle(3 * S, 0x5a3818, 0.9);
    sign.strokeRoundedRect(signX, signY, signW, signH, 16 * S);
    sign.lineStyle(1.5 * S, 0xd4a86a, 0.15);
    sign.strokeRoundedRect(signX + 3 * S, signY + 3 * S, signW - 6 * S, signH - 6 * S, 14 * S);

    for (let i = 0; i < 5; i++) {
      const gy = signY + 22 * S + (i * (signH - 44 * S)) / 4;
      sign.lineStyle(0.9 * S, 0x704020, 0.18);
      sign.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).moveTo(signX + 16 * S, gy);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).lineTo(signX + signW - 16 * S, gy + Math.sin(i * 1.3) * 3 * S);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).strokePath();
    }

    sign.fillStyle(winColor, 0.15);
    sign.fillRoundedRect(signX + 12 * S, signY + 12 * S, signW - 24 * S, signH - 24 * S, 10 * S);

    this.add.text(W / 2, H / 2 - 18 * S, label, {
      fontSize: `${38 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: (this.isLocal || isMe) ? '#fff8e8' : '#ffcccc', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    const rBtnW = 200 * S;
    const rBtnH = 44 * S;
    const rBtnX = W / 2 - rBtnW / 2;
    const rBtnY = H / 2 + 38 * S;
    const rBtn = this.add.graphics();
    this.drawWoodButton(rBtn, rBtnX, rBtnY, rBtnW, rBtnH);

    this.add.text(W / 2, rBtnY + rBtnH / 2, 'Nouvelle partie', {
      fontSize: `${16 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 2 * S,
    }).setOrigin(0.5);

    const replayZone = this.add.zone(W / 2, rBtnY + rBtnH / 2, rBtnW + 16 * S, rBtnH + 16 * S)
      .setInteractive({ useHandCursor: true });
    replayZone.on('pointerdown', () => window.location.reload());
  }

  private showDisconnect() {
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const signW = 320 * S;
    const signH = 120 * S;
    const signX = W / 2 - signW / 2;
    const signY = H / 2 - signH / 2;
    const sign = this.add.graphics();

    sign.fillStyle(0x000000, 0.45);
    sign.fillRoundedRect(signX + 6 * S, signY + 8 * S, signW, signH, 16 * S);
    sign.fillStyle(0x8b5e30, 1);
    sign.fillRoundedRect(signX, signY, signW, signH, 16 * S);
    sign.lineStyle(3 * S, 0x5a3818, 0.9);
    sign.strokeRoundedRect(signX, signY, signW, signH, 16 * S);

    this.add.text(W / 2, H / 2 - 12 * S, 'Adversaire déconnecté', {
      fontSize: `${24 * S}px`, fontFamily: 'Georgia, serif', fontStyle: 'bold',
      color: '#ffcccc', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 24 * S, 'Cliquez pour revenir au lobby', {
      fontSize: `${14 * S}px`, fontFamily: 'Georgia, serif', color: '#fff8e8',
    }).setOrigin(0.5);

    this.input.once('pointerdown', () => window.location.reload());
  }

  // ───────────────── Update loop ─────────────────

  update(_time: number, delta: number) {
    this.globulos.forEach((g) => g.update());

    if (this.phase === 'resolving') {
      this.resolveTimer += delta;
      this.checkFallen();

      if (this.resolveTimer > 300 && this.isSettled()) {
        const winner = this.checkWinner();
        if (winner) { this.endGame(winner); return; }
        this.updateScores();
        this.client.send({ type: 'ready' });
        this.phase = 'waiting';
        this.statusText.setText('Prochain tour...');
      }
    }
  }
}
