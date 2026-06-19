import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';
import { Globulo } from '../entities/Globulo';
import type { Team } from '../entities/Globulo';
import type { Client } from '../network/Client';

type Phase = 'planning' | 'resolving' | 'waiting' | 'gameover';
type Move = { id: number; fx: number; fy: number };

export class ArenaScene extends Phaser.Scene {
  private globulos: Globulo[] = [];
  private myTeam!: Team;
  private client!: Client;
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
    this.statusText.setText('Choisissez vos mouvements');
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

    const moves: Move[] = this.globulos
      .filter((g) => g.team === this.myTeam && g.alive)
      .map((g) => ({
        id: g.id,
        fx: g.pendingForce?.x ?? 0,
        fy: g.pendingForce?.y ?? 0,
      }));

    this.client.send({ type: 'submit', moves });

    this.btnText.setText('En attente...');
    this.btnBg.setAlpha(0.6);
    this.statusText.setText(
      this.opponentReady
        ? 'Les deux sont prêts...'
        : "En attente de l'adversaire...",
    );
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
    g.fillCircle(centerX + 5, centerY + 8, radius);

    g.fillStyle(0x7ec850, 1);
    g.fillCircle(centerX, centerY, radius);

    const rng = new Phaser.Math.RandomDataGenerator(['arena-grass']);
    const grassCount = 420;
    for (let i = 0; i < grassCount; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = rng.frac() * (radius - 18);
      const x = centerX + Math.cos(a) * r;
      const y = centerY + Math.sin(a) * r;
      const len = 6 + rng.frac() * 14;
      const tilt = (rng.frac() - 0.5) * 0.6;
      const shade = 0.92 + rng.frac() * 0.12;
      const col = this.darkenColor(0x7ec850, shade);
      g.lineStyle(rng.frac() < 0.08 ? 1.5 : 0.9, col, 0.85);
      g.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(x, y);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(
        x + Math.cos(a + tilt) * len,
        y + Math.sin(a + tilt) * len,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }

    for (let i = 0; i < 18; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 30 + rng.frac() * (radius - 60);
      const cx2 = centerX + Math.cos(a) * r;
      const cy2 = centerY + Math.sin(a) * r;
      const cloverR = 3 + rng.frac() * 2;
      const shade = rng.frac() < 0.5 ? 0x5db838 : 0x6cc44a;
      g.fillStyle(shade, 0.55);
      for (let j = 0; j < 3; j++) {
        const la = (j / 3) * Math.PI * 2 - Math.PI / 2;
        g.fillCircle(
          cx2 + Math.cos(la) * cloverR,
          cy2 + Math.sin(la) * cloverR,
          cloverR * 0.8,
        );
      }
    }

    const flowerColors = [0xf5e663, 0xffffff, 0xe8a0d0, 0xaaddff];
    for (let i = 0; i < 14; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 40 + rng.frac() * (radius - 70);
      const fx = centerX + Math.cos(a) * r;
      const fy = centerY + Math.sin(a) * r;
      const fCol = flowerColors[i % flowerColors.length];
      const petalR = 2.2 + rng.frac() * 1.5;
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        g.fillStyle(fCol, 0.7);
        g.fillCircle(
          fx + Math.cos(pa) * petalR * 1.2,
          fy + Math.sin(pa) * petalR * 1.2,
          petalR * 0.7,
        );
      }
      g.fillStyle(0xffee44, 0.9);
      g.fillCircle(fx, fy, petalR * 0.5);
    }

    for (let i = 0; i < 10; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 25 + rng.frac() * (radius - 50);
      const px = centerX + Math.cos(a) * r;
      const py = centerY + Math.sin(a) * r;
      const sw = 3 + rng.frac() * 3;
      const sh = 2 + rng.frac() * 2;
      const stoneCol = rng.frac() < 0.5 ? 0xaaa890 : 0x9a9580;
      g.fillStyle(stoneCol, 0.5);
      g.fillEllipse(px, py, sw * 2, sh * 2);
      g.fillStyle(0xffffff, 0.12);
      g.fillEllipse(px - 1, py - 1, sw, sh * 0.6);
    }

    for (let i = 0; i < 22; i++) {
      const a = rng.frac() * Math.PI * 2;
      const r = 20 + rng.frac() * (radius - 40);
      const tx = centerX + Math.cos(a) * r;
      const ty = centerY + Math.sin(a) * r;
      g.lineStyle(1.2, 0x4a9928, 0.6);
      for (let b = -1; b <= 1; b++) {
        const ba = -Math.PI / 2 + b * 0.4;
        const bLen = 6 + rng.frac() * 5;
        g.beginPath();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).moveTo(tx, ty);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).lineTo(
          tx + Math.cos(ba) * bLen,
          ty + Math.sin(ba) * bLen,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g as any).strokePath();
      }
    }

    g.lineStyle(10, 0x5aaa32, 0.35);
    g.strokeCircle(centerX, centerY, radius - 5);

    this.drawPit(g, centerX, centerY, pitRadius);

    this.createArenaBorder(centerX, centerY, radius);
  }

  private drawEnvironment(cx: number, cy: number, arenaRadius: number) {
    const g = this.add.graphics();
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const leaves = [
      { x: 55, y: 55, rx: 58, ry: 42, color: 0x3d9020 },
      { x: W - 55, y: 55, rx: 52, ry: 45, color: 0x4aaa22 },
      { x: 65, y: H - 60, rx: 60, ry: 40, color: 0x48a820 },
      { x: W - 60, y: H - 55, rx: 50, ry: 48, color: 0x3d9820 },
      {
        x: cx - arenaRadius - 62,
        y: cy - 70,
        rx: 68,
        ry: 50,
        color: 0x4aaa22,
      },
      {
        x: cx - arenaRadius - 55,
        y: cy + 75,
        rx: 52,
        ry: 62,
        color: 0x3d9020,
      },
      {
        x: cx + arenaRadius + 58,
        y: cy - 65,
        rx: 62,
        ry: 52,
        color: 0x50b025,
      },
      {
        x: cx + arenaRadius + 52,
        y: cy + 70,
        rx: 55,
        ry: 45,
        color: 0x44a020,
      },
      { x: cx - 80, y: 32, rx: 60, ry: 32, color: 0x4aaa22 },
      { x: cx + 70, y: 28, rx: 55, ry: 28, color: 0x3d9020 },
      { x: cx - 60, y: H - 32, rx: 65, ry: 32, color: 0x48a820 },
      { x: cx + 75, y: H - 28, rx: 58, ry: 28, color: 0x50b025 },
    ];

    leaves.forEach(({ x, y, rx, ry, color }) => {
      g.fillStyle(this.darkenColor(color, 0.55), 0.6);
      g.fillEllipse(x + 5, y + 7, rx * 2, ry * 2);
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
      { x: cx - arenaRadius - 110, y: cy + 15, r: 12 },
      { x: cx + arenaRadius + 100, y: cy - 15, r: 9 },
      { x: cx - arenaRadius - 85, y: cy - 130, r: 10 },
      { x: cx + arenaRadius + 80, y: cy + 130, r: 11 },
    ];
    bubbles.forEach(({ x, y, r }) => {
      g.fillStyle(0x88dd44, 0.35);
      g.fillCircle(x, y, r);
      g.lineStyle(1.5, 0xaaffaa, 0.4);
      g.strokeCircle(x, y, r);
    });
  }

  private drawPit(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    pitRadius: number,
  ) {
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(
      cx + 5,
      cy + 7,
      (pitRadius + 18) * 1.1,
      (pitRadius + 12) * 0.9,
    );

    g.fillStyle(0x8b6842, 1);
    g.fillCircle(cx, cy, pitRadius + 10);
    g.lineStyle(5, 0x6d5030, 0.6);
    g.strokeCircle(cx, cy, pitRadius + 10);

    const numBumps = 18;
    for (let i = 0; i < numBumps; i++) {
      const angle = (i / numBumps) * Math.PI * 2 + 0.17;
      const size = 10 + (i % 3 === 0 ? 3 : i % 3 === 1 ? -2 : 0);
      g.fillStyle(i % 2 === 0 ? 0x9a7550 : 0x7a5a38, 1);
      g.fillCircle(
        cx + Math.cos(angle) * pitRadius,
        cy + Math.sin(angle) * pitRadius,
        size,
      );
    }

    const rings = 8;
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const edge = 0x6e4e30;
      const core = 0x4a3520;
      const col = this.interpolateColor(edge, core, t);
      const rr = pitRadius - 4 - (i * (pitRadius - 10)) / rings;
      g.fillStyle(col, 0.92 - t * 0.08);
      g.fillCircle(cx, cy, rr);
    }

    const rng = new Phaser.Math.RandomDataGenerator(['pit-tex']);
    for (let i = 0; i < 30; i++) {
      const a = rng.frac() * Math.PI * 2;
      const d = rng.frac() * (pitRadius - 12);
      const sx = cx + Math.cos(a) * d;
      const sy = cy + Math.sin(a) * d;
      g.fillStyle(rng.frac() < 0.5 ? 0x8a6a48 : 0x5c4028, 0.35);
      g.fillCircle(sx, sy, 1 + rng.frac() * 2.5);
    }

    g.fillStyle(0xffffff, 0.1);
    g.fillEllipse(cx - 12, cy - 16, pitRadius * 0.8, pitRadius * 0.45);

    g.lineStyle(2, 0xc8a878, 0.3);
    g.beginPath();
    g.arc(cx, cy, pitRadius + 8, -Math.PI * 0.8, -Math.PI * 0.2, false);
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
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    const r = Math.min(255, Math.round(ar + (br - ar) * t));
    const g = Math.min(255, Math.round(ag + (bg - ag) * t));
    const bl = Math.min(255, Math.round(ab + (bb - ab) * t));
    return (r << 16) | (g << 8) | bl;
  }

  // ───────────────── Physics border ─────────────────

  private createArenaBorder(cx: number, cy: number, r: number) {
    const segments = 48;
    const thickness = 20;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const midAngle = (angle + nextAngle) / 2;

      const x = cx + (r + thickness / 2) * Math.cos(midAngle);
      const y = cy + (r + thickness / 2) * Math.sin(midAngle);
      const segLen =
        2 * (r + thickness) * Math.tan(Math.PI / segments) + 2;

      const wall = this.matter.add.rectangle(x, y, segLen, thickness, {
        isStatic: true,
        angle: midAngle,
        friction: 0.1,
        restitution: 0.4,
        label: 'wall',
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
        { x: centerX + safeRadius * 0.6, y: centerY - 60 },
        { x: centerX + safeRadius * 0.6, y: centerY },
        { x: centerX + safeRadius * 0.6, y: centerY + 60 },
      ],
      yellow: [
        { x: centerX - safeRadius * 0.6, y: centerY - 60 },
        { x: centerX - safeRadius * 0.6, y: centerY },
        { x: centerX - safeRadius * 0.6, y: centerY + 60 },
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
      const hit = this.getGlobuloAt(p.x, p.y);
      if (hit) {
        this.selectedGlobulo = hit;
        this.isDragging = true;
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.selectedGlobulo) return;
      this.selectedGlobulo.drawArrow(p.x, p.y);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.selectedGlobulo) return;
      this.isDragging = false;

      const pos = this.selectedGlobulo.body.position;
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const maxLen = GAME_CONFIG.turn.arrowMaxLength;
      const clampedLen = Math.min(len, maxLen);

      if (clampedLen > 5) {
        const angle = Math.atan2(dy, dx);
        this.selectedGlobulo.setPendingForce(
          Math.cos(angle) * clampedLen,
          Math.sin(angle) * clampedLen,
        );
      }

      this.selectedGlobulo = null;
    });

    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.phase === 'planning') this.submitMoves();
    });

    this.matter.world.on(
      'collisionstart',
      (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
        event.pairs.forEach((pair) => {
          const normal = pair.collision.normal;
          const gA = this.findGlobuloByBody(pair.bodyA);
          const gB = this.findGlobuloByBody(pair.bodyB);
          if (gA) gA.squish(normal.x, normal.y);
          if (gB) gB.squish(-normal.x, -normal.y);
        });
      },
    );
  }

  private findGlobuloByBody(body: MatterJS.BodyType): Globulo | null {
    return this.globulos.find((g) => g.alive && g.body === body) ?? null;
  }

  private getGlobuloAt(x: number, y: number): Globulo | null {
    for (const g of this.globulos) {
      if (!g.alive || g.team !== this.myTeam) continue;
      const pos = g.body.position;
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < GAME_CONFIG.globulo.radius + 6)
        return g;
    }
    return null;
  }

  // ───────────────── UI ─────────────────

  private createUI() {
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;
    const cy = H / 2;

    this.myPanelGlow = this.add.graphics();
    this.panelRed = this.add.graphics();
    this.panelYellow = this.add.graphics();

    this.scoreRed = this.add
      .text(46, cy + 26, '3', {
        fontSize: '44px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.scoreYellow = this.add
      .text(W - 46, cy + 26, '3', {
        fontSize: '44px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // Timer
    this.timerText = this.add
      .text(W / 2, 30, '0:30', {
        fontSize: '32px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // Status text
    this.statusText = this.add
      .text(W / 2, H - 106, 'Connexion...', {
        fontSize: '15px',
        fontFamily: 'Georgia, serif',
        color: '#fff8e8',
        stroke: '#00000044',
        strokeThickness: 2,
      })
      .setOrigin(0.5);

    // Wooden validate button
    const btnW = 170;
    const btnH = 50;
    const btnX = W / 2 - btnW / 2;
    const btnY = H - 72;

    this.btnBg = this.add.graphics();
    this.drawWoodButton(this.btnBg, btnX, btnY, btnW, btnH);

    this.btnText = this.add
      .text(W / 2, btnY + btnH / 2, 'Valider', {
        fontSize: '17px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    const hitZone = this.add
      .zone(W / 2, btnY + btnH / 2, btnW + 16, btnH + 16)
      .setInteractive({ useHandCursor: true });

    hitZone.on('pointerdown', () => {
      if (this.phase === 'planning') this.submitMoves();
    });
    hitZone.on('pointerover', () => {
      if (!this.submitted) this.btnBg.setAlpha(1.1);
    });
    hitZone.on('pointerout', () => {
      if (!this.submitted) this.btnBg.setAlpha(1);
    });

    // Draw panels (own team = active, opponent = inactive)
    const isRed = this.myTeam === 'red';
    this.drawPanel(
      this.panelRed,
      46,
      GAME_CONFIG.teams.red.color,
      isRed,
    );
    this.drawPanel(
      this.panelYellow,
      W - 46,
      GAME_CONFIG.teams.yellow.color,
      !isRed,
    );

    // Glow around own panel
    const myColor = GAME_CONFIG.teams[this.myTeam].color;
    const myCx = this.myTeam === 'red' ? 46 : W - 46;
    const panelCy = H / 2;
    this.myPanelGlow.lineStyle(4, myColor, 0.7);
    this.myPanelGlow.strokeRoundedRect(
      myCx - 44,
      panelCy - 65,
      88,
      130,
      18,
    );
    this.myPanelGlow.lineStyle(8, myColor, 0.2);
    this.myPanelGlow.strokeRoundedRect(
      myCx - 48,
      panelCy - 69,
      96,
      138,
      22,
    );

    this.tweens.add({
      targets: this.myPanelGlow,
      alpha: { from: 1, to: 0.4 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    // "Vous" label on own panel
    this.add
      .text(myCx, panelCy - 54, 'Vous', {
        fontSize: '11px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  private updateTimerDisplay() {
    const mins = Math.floor(this.countdown / 60);
    const secs = this.countdown % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
    if (this.countdown <= 5) {
      this.timerText.setColor('#ff4444');
    } else if (this.countdown <= 10) {
      this.timerText.setColor('#ffaa22');
    } else {
      this.timerText.setColor('#fff8e8');
    }
  }

  private updateScores() {
    const countRed = this.globulos.filter(
      (g) => g.team === 'red' && g.alive,
    ).length;
    const countYellow = this.globulos.filter(
      (g) => g.team === 'yellow' && g.alive,
    ).length;
    this.scoreRed.setText(String(countRed));
    this.scoreYellow.setText(String(countYellow));
  }

  // ───────────────── Panel / button drawing ─────────────────

  private drawPanel(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    color: number,
    isActive: boolean,
  ) {
    const cy = GAME_CONFIG.height / 2;
    const pw = 76;
    const ph = 118;
    g.clear();
    const left = cx - pw / 2;
    const top = cy - ph / 2;

    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(left + 6, top + 8, pw, ph, 14);

    const woodBase = isActive ? 0x9b6b36 : 0x7a5a30;
    g.fillStyle(woodBase, isActive ? 1 : 0.75);
    g.fillRoundedRect(left, top, pw, ph, 14);

    g.lineStyle(2, 0x704a2a, 0.95);
    g.strokeRoundedRect(left, top, pw, ph, 14);
    g.lineStyle(1.2, 0xffffff, 0.06);
    g.strokeRoundedRect(left + 1, top + 1, pw - 2, ph - 2, 12);

    for (let i = 0; i < 6; i++) {
      const y = top + 18 + i * ((ph - 36) / 5) + Math.sin(i * 1.3) * 2;
      g.lineStyle(1, 0x6a4326, 0.25);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(left + 8, y);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(left + pw - 8, y + Math.sin(i * 0.9) * 3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }

    for (let k = 0; k < 3; k++) {
      const ky = top + 28 + k * 28 + (Math.random() * 6 - 3);
      const kx = left + 18 + Math.random() * (pw - 36);
      g.fillStyle(0x6b3f25, 0.55);
      g.fillEllipse(kx, ky, 10, 6);
      g.fillStyle(0xffffff, 0.06);
      g.fillEllipse(kx - 2, ky - 2, 4, 2);
    }

    if (isActive) {
      g.fillStyle(color, 0.12);
      g.fillRoundedRect(left + 6, top + 8, pw - 12, 36, 8);
      g.lineStyle(1.6, color, 0.28);
      g.strokeRoundedRect(left + 6, top + 8, pw - 12, 36, 8);
    }

    this.drawMiniGlobulo(g, cx, cy - 20, color, isActive);
  }

  private drawWoodButton(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const r = 10;
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x + 4, y + 6, w, h, r);
    g.fillStyle(0x8b5e30, 1);
    g.fillRoundedRect(x, y, w, h, r);
    g.fillStyle(0x6a4420, 0.7);
    g.fillRoundedRect(x, y + h - 8, w, 8, { tl: 0, tr: 0, bl: r, br: r });
    g.fillStyle(0xb8884a, 0.5);
    g.fillRoundedRect(x, y, w, 8, { tl: r, tr: r, bl: 0, br: 0 });
    g.lineStyle(2, 0x5a3818, 0.9);
    g.strokeRoundedRect(x, y, w, h, r);
    g.lineStyle(1, 0xd4a86a, 0.2);
    g.strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, r - 2);
    for (let i = 0; i < 4; i++) {
      const gy = y + 10 + (i * (h - 20)) / 3;
      g.lineStyle(0.8, 0x704020, 0.2);
      g.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).moveTo(x + 10, gy);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).lineTo(x + w - 10, gy + Math.sin(i * 1.2) * 2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g as any).strokePath();
    }
  }

  private drawMiniGlobulo(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    isActive: boolean,
  ) {
    const r = 22;
    const alpha = isActive ? 1 : 0.3;
    g.setAlpha(alpha);

    g.fillStyle(0x000000, 0.22);
    g.fillCircle(x + 2, y + 3, r);

    const dark = this.darkenColor(color, 0.58);
    g.fillStyle(dark, 1);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 3 : r - 1;
      pts.push({
        x: x + Math.cos(angle) * rad,
        y: y + Math.sin(angle) * rad,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.fillPoints(pts as any, true);

    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);

    g.fillStyle(0xffffff, 0.28);
    g.fillEllipse(x - 6, y - 7, 14, 9);

    g.fillStyle(0xffffff, 1);
    g.fillCircle(x - 7, y - 5, 6);
    g.fillCircle(x + 7, y - 5, 6);
    g.fillStyle(0x111111, 1);
    g.fillCircle(x - 6, y - 4.5, 3.2);
    g.fillCircle(x + 8, y - 4.5, 3.2);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(x - 4, y - 6.5, 1.2);
    g.fillCircle(x + 10, y - 6.5, 1.2);

    g.setAlpha(1);
  }

  // ───────────────── Game logic ─────────────────

  private isSettled(): boolean {
    return this.globulos
      .filter((g) => g.alive)
      .every((g) => {
        const v = g.body.velocity;
        return Math.abs(v.x) < 0.1 && Math.abs(v.y) < 0.1;
      });
  }

  private checkFallen() {
    const { centerX, centerY, pitRadius, radius: arenaRadius } =
      GAME_CONFIG.arena;

    this.globulos
      .filter((g) => g.alive)
      .forEach((g) => {
        const pos = g.body.position;
        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < pitRadius - GAME_CONFIG.globulo.radius) {
          g.fallIntoPit(centerX, centerY, () => {});
        } else if (dist > arenaRadius + 20) {
          g.destroy();
        }
      });
  }

  private checkWinner(): Team | null {
    const redAlive = this.globulos.filter(
      (g) => g.team === 'red' && g.alive,
    ).length;
    const yellowAlive = this.globulos.filter(
      (g) => g.team === 'yellow' && g.alive,
    ).length;
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
    const label = isMe ? 'Victoire !' : 'Défaite...';

    const winColor = GAME_CONFIG.teams[winner].color;

    const signW = 340;
    const signH = 140;
    const signX = W / 2 - signW / 2;
    const signY = H / 2 - signH / 2 - 10;
    const sign = this.add.graphics();

    sign.fillStyle(0x000000, 0.45);
    sign.fillRoundedRect(signX + 6, signY + 8, signW, signH, 16);
    sign.fillStyle(0x8b5e30, 1);
    sign.fillRoundedRect(signX, signY, signW, signH, 16);
    sign.fillStyle(0x6a4420, 0.6);
    sign.fillRoundedRect(signX, signY + signH - 14, signW, 14, {
      tl: 0,
      tr: 0,
      bl: 16,
      br: 16,
    });
    sign.fillStyle(0xb8884a, 0.4);
    sign.fillRoundedRect(signX, signY, signW, 14, {
      tl: 16,
      tr: 16,
      bl: 0,
      br: 0,
    });
    sign.lineStyle(3, 0x5a3818, 0.9);
    sign.strokeRoundedRect(signX, signY, signW, signH, 16);
    sign.lineStyle(1.5, 0xd4a86a, 0.15);
    sign.strokeRoundedRect(
      signX + 3,
      signY + 3,
      signW - 6,
      signH - 6,
      14,
    );

    for (let i = 0; i < 5; i++) {
      const gy = signY + 22 + (i * (signH - 44)) / 4;
      sign.lineStyle(0.9, 0x704020, 0.18);
      sign.beginPath();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).moveTo(signX + 16, gy);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).lineTo(
        signX + signW - 16,
        gy + Math.sin(i * 1.3) * 3,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sign as any).strokePath();
    }

    sign.fillStyle(winColor, 0.15);
    sign.fillRoundedRect(
      signX + 12,
      signY + 12,
      signW - 24,
      signH - 24,
      10,
    );

    this.add
      .text(W / 2, H / 2 - 18, label, {
        fontSize: '38px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: isMe ? '#fff8e8' : '#ffcccc',
        stroke: '#5a3a18',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    const rBtnW = 200;
    const rBtnH = 44;
    const rBtnX = W / 2 - rBtnW / 2;
    const rBtnY = H / 2 + 38;
    const rBtn = this.add.graphics();
    this.drawWoodButton(rBtn, rBtnX, rBtnY, rBtnW, rBtnH);

    this.add
      .text(W / 2, rBtnY + rBtnH / 2, 'Nouvelle partie', {
        fontSize: '16px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#fff8e8',
        stroke: '#5a3a18',
        strokeThickness: 2,
      })
      .setOrigin(0.5);

    const replayZone = this.add
      .zone(W / 2, rBtnY + rBtnH / 2, rBtnW + 16, rBtnH + 16)
      .setInteractive({ useHandCursor: true });
    replayZone.on('pointerdown', () => window.location.reload());
  }

  private showDisconnect() {
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const signW = 320;
    const signH = 120;
    const signX = W / 2 - signW / 2;
    const signY = H / 2 - signH / 2;
    const sign = this.add.graphics();

    sign.fillStyle(0x000000, 0.45);
    sign.fillRoundedRect(signX + 6, signY + 8, signW, signH, 16);
    sign.fillStyle(0x8b5e30, 1);
    sign.fillRoundedRect(signX, signY, signW, signH, 16);
    sign.lineStyle(3, 0x5a3818, 0.9);
    sign.strokeRoundedRect(signX, signY, signW, signH, 16);

    this.add
      .text(W / 2, H / 2 - 12, 'Adversaire déconnecté', {
        fontSize: '24px',
        fontFamily: 'Georgia, serif',
        fontStyle: 'bold',
        color: '#ffcccc',
        stroke: '#5a3a18',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.add
      .text(W / 2, H / 2 + 24, 'Cliquez pour revenir au lobby', {
        fontSize: '14px',
        fontFamily: 'Georgia, serif',
        color: '#fff8e8',
      })
      .setOrigin(0.5);

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
        if (winner) {
          this.endGame(winner);
          return;
        }
        this.updateScores();
        this.client.send({ type: 'ready' });
        this.phase = 'waiting';
        this.statusText.setText('Prochain tour...');
      }
    }
  }
}
