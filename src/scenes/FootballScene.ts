import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';
import { Globulo } from '../entities/Globulo';
import { Ball } from '../entities/Ball';
import type { Team } from '../entities/Globulo';
import type { Client } from '../network/Client';
import type { LocalClient } from '../network/LocalClient';

type Phase = 'planning' | 'resolving' | 'waiting' | 'gameover';
type Move = { id: number; fx: number; fy: number };

const S = GAME_CONFIG.scale;

export class FootballScene extends Phaser.Scene {
  private globulos: Globulo[] = [];
  private ball!: Ball;
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

  private scoreRedValue = 0;
  private scoreYellowValue = 0;
  private goalScored = false;
  private startingPositions!: {
    globulos: { team: Team; id: number; x: number; y: number }[];
    ballX: number;
    ballY: number;
  };

  constructor() {
    super({ key: 'FootballScene' });
  }

  preload() {
    this.load.svg('field-border', 'football-field-border.svg', { width: 647 * 3, height: 335 * 3 });
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
    this.scoreRedValue = 0;
    this.scoreYellowValue = 0;
    this.goalScored = false;

    this.matter.world.setGravity(0, 0);

    this.drawField();
    this.spawnEntities();
    this.setupInput();
    this.createUI();
    this.setupNetwork();
    this.startGame();
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
    this.goalScored = false;

    this.globulos
      .filter((g) => g.team === this.myTeam && g.alive)
      .forEach((g) => g.clearPendingForce());

    this.btnText.setText('Valider');
    this.btnBg.setAlpha(1);
    this.statusText.setText('');
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
          id: g.id,
          fx: (g.pendingForce?.x ?? 0) / S,
          fy: (g.pendingForce?.y ?? 0) / S,
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

    const forceScale = this.isLocal ? 1 : S;
    for (const team of ['red', 'yellow'] as Team[]) {
      const teamMoves = moves[team] ?? [];
      teamMoves.forEach((m) => {
        const g = this.globulos.find(
          (gl) => gl.team === team && gl.id === m.id,
        );
        if (g?.alive) g.setPendingForce(m.fx * forceScale, m.fy * forceScale);
      });
    }

    this.globulos.forEach((g) => g.applyForce());
    this.resolveTimer = 0;
  }

  // ───────────────── Field drawing ─────────────────

  private drawField() {
    const { centerX: cx, centerY: cy, fieldWidth: fw, fieldHeight: fh, goalWidth: gw, goalHeight: gh } = GAME_CONFIG.football;

    const g = this.add.graphics();

    // Green grass rectangle filling the field area
    g.fillStyle(0xc7f554, 1);
    g.fillRect(cx - fw / 2, cy - fh / 2, fw, fh);

    // Goal zones on left and right
    g.fillStyle(0xf8ba55, 1);
    g.fillRect(cx - fw / 2 - gw, cy - gh / 2, gw, gh);
    g.fillRect(cx + fw / 2, cy - gh / 2, gw, gh);

    // Grass texture
    const grassRng = new Phaser.Math.RandomDataGenerator(['football-grass']);
    for (let i = 0; i < 300; i++) {
      const rx = cx - fw / 2 + grassRng.frac() * fw;
      const ry = cy - fh / 2 + grassRng.frac() * fh;
      const shade = grassRng.frac() < 0.5 ? 0xb8e848 : 0xd4ff68;
      g.fillStyle(shade, 0.25);
      g.fillCircle(rx, ry, (1 + grassRng.frac() * 2.5) * S);
    }

    // White field markings
    g.lineStyle(2 * S, 0xffffff, 0.3);
    // Center line
    g.beginPath();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (g as any).moveTo(cx, cy - fh / 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (g as any).lineTo(cx, cy + fh / 2);
    g.strokePath();
    // Center circle
    g.strokeCircle(cx, cy, 50 * S);
    // Center dot
    g.fillStyle(0xffffff, 0.3);
    g.fillCircle(cx, cy, 4 * S);

    // Illustrated border frame (wooden goal posts + sidelines), overlaid on the grass.
    // The artwork's goal-mouth edges (raw SVG x=76 / x=570 in the 647-wide viewBox) are
    // calibrated to land exactly on the pitch edges so the drawn goal line matches the
    // invisible scoring boundary used below.
    const svgWidth = 647;
    const svgHeight = 335;
    const svgLeftLip = 76;
    const svgRightLip = 570;
    const borderScale = fw / (svgRightLip - svgLeftLip);
    const borderW = svgWidth * borderScale;
    const borderH = svgHeight * borderScale;
    const borderCenterX = cx - fw / 2 - svgLeftLip * borderScale + borderW / 2;
    this.add.image(borderCenterX, cy, 'field-border').setDisplaySize(borderW, borderH);

    this.createFieldBorder();
  }

  // ───────────────── Physics border ─────────────────

  private createFieldBorder() {
    const { centerX: cx, centerY: cy, fieldWidth: fw, fieldHeight: fh, goalWidth: gw, goalHeight: gh, wallThickness: wt } = GAME_CONFIG.football;

    const wallOpts = { isStatic: true, friction: 0.1, restitution: 0.4, label: 'wall' };

    // Top wall (full width including goal area)
    this.matter.add.rectangle(cx, cy - fh / 2 - wt / 2, fw + 2 * gw + 2 * wt, wt, wallOpts);
    // Bottom wall
    this.matter.add.rectangle(cx, cy + fh / 2 + wt / 2, fw + 2 * gw + 2 * wt, wt, wallOpts);

    // Left wall — split into 2 segments with goal opening in the middle
    const sideH = (fh - gh) / 2;
    // Left-top
    this.matter.add.rectangle(cx - fw / 2 - wt / 2, cy - gh / 2 - sideH / 2, wt, sideH, wallOpts);
    // Left-bottom
    this.matter.add.rectangle(cx - fw / 2 - wt / 2, cy + gh / 2 + sideH / 2, wt, sideH, wallOpts);
    // Right-top
    this.matter.add.rectangle(cx + fw / 2 + wt / 2, cy - gh / 2 - sideH / 2, wt, sideH, wallOpts);
    // Right-bottom
    this.matter.add.rectangle(cx + fw / 2 + wt / 2, cy + gh / 2 + sideH / 2, wt, sideH, wallOpts);

    // Goal boxes (U-shape outside the field)
    // Left goal: back + top + bottom
    this.matter.add.rectangle(cx - fw / 2 - gw - wt / 2, cy, wt, gh + 2 * wt, wallOpts);
    this.matter.add.rectangle(cx - fw / 2 - gw / 2, cy - gh / 2 - wt / 2, gw + wt, wt, wallOpts);
    this.matter.add.rectangle(cx - fw / 2 - gw / 2, cy + gh / 2 + wt / 2, gw + wt, wt, wallOpts);
    // Right goal: back + top + bottom
    this.matter.add.rectangle(cx + fw / 2 + gw + wt / 2, cy, wt, gh + 2 * wt, wallOpts);
    this.matter.add.rectangle(cx + fw / 2 + gw / 2, cy - gh / 2 - wt / 2, gw + wt, wt, wallOpts);
    this.matter.add.rectangle(cx + fw / 2 + gw / 2, cy + gh / 2 + wt / 2, gw + wt, wt, wallOpts);
  }

  // ───────────────── Spawn ─────────────────

  private spawnEntities() {
    const { centerX: cx, centerY: cy, fieldWidth: fw } = GAME_CONFIG.football;

    const positions: { team: Team; id: number; x: number; y: number }[] = [
      // Red team — triangle formation on left third
      { team: 'red', id: 0, x: cx - fw * 0.3, y: cy - 55 * S },
      { team: 'red', id: 1, x: cx - fw * 0.3, y: cy + 55 * S },
      { team: 'red', id: 2, x: cx - fw * 0.15, y: cy },
      // Yellow team — mirrored on right third
      { team: 'yellow', id: 0, x: cx + fw * 0.3, y: cy - 55 * S },
      { team: 'yellow', id: 1, x: cx + fw * 0.3, y: cy + 55 * S },
      { team: 'yellow', id: 2, x: cx + fw * 0.15, y: cy },
    ];

    for (const pos of positions) {
      this.globulos.push(new Globulo(this, pos.x, pos.y, pos.team, pos.id));
    }

    this.ball = new Ball(this, cx, cy);

    this.startingPositions = {
      globulos: positions.map((p) => ({ team: p.team, id: p.id, x: p.x, y: p.y })),
      ballX: cx,
      ballY: cy,
    };
  }

  // ───────────────── Input ─────────────────

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.phase !== 'planning' || this.submitted) return;
      const hit = this.getGlobuloAt(p.worldX, p.worldY);
      if (hit) {
        this.selectedGlobulo = hit;
        this.isDragging = true;
        hit.select();
      }
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

      if (this.selectedGlobulo) this.selectedGlobulo.deselect();
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

        // Check if a globulo hit the ball
        const isBallA = pair.bodyA.label === 'ball';
        const isBallB = pair.bodyB.label === 'ball';
        const globuloHitBall = (gA && isBallB) || (gB && isBallA);

        if (gA || gB) {
          const contact = pair.collision.supports?.[0] ?? pair.collision;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cx = (contact as any).x ?? (gA ? gA.body.position.x : gB!.body.position.x);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cy = (contact as any).y ?? (gA ? gA.body.position.y : gB!.body.position.y);
          const speed = gA && gB
            ? Math.sqrt(Math.pow(gA.body.velocity.x - gB.body.velocity.x, 2) + Math.pow(gA.body.velocity.y - gB.body.velocity.y, 2))
            : Math.sqrt(Math.pow((gA ?? gB)!.body.velocity.x, 2) + Math.pow((gA ?? gB)!.body.velocity.y, 2));

          if (globuloHitBall) {
            // White impact particles for globulo-ball collision
            this.spawnImpactParticles(cx, cy, normal.x, normal.y, speed, null, null);
          } else {
            this.spawnImpactParticles(cx, cy, normal.x, normal.y, speed, gA, gB);
          }
          if (speed > 4 * S) this.shakeCamera(Math.min(speed * 0.3, 6 * S));
        }
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
    this.scoreRed = this.add.text(100 * S, topBarY, '0', {
      fontSize: `${48 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0, 0.5);

    this.drawMiniGlobulo(topBarBg, W - 55 * S, topBarY, GAME_CONFIG.teams.yellow.color, true, globR);
    this.scoreYellow = this.add.text(W - 100 * S, topBarY, '0', {
      fontSize: `${48 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(1, 0.5);

    this.timerText = this.add.text(W / 2, topBarY, '0:30', {
      fontSize: `${38 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    if (!this.isLocal) {
      const myColor = GAME_CONFIG.teams[this.myTeam].color;
      const labelX = this.myTeam === 'red' ? 55 * S : W - 55 * S;
      this.add.text(labelX, topBarY + 34 * S, 'Vous', {
        fontSize: `${14 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
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

    this.statusText = this.add.text(W / 2, H - 100 * S, '', {
      fontSize: `${22 * S}px`, fontFamily: 'Fredoka, sans-serif',
      color: '#fff8e8', stroke: '#00000044', strokeThickness: 2 * S,
    }).setOrigin(0.5);

    const btnW = 280 * S;
    const btnH = 72 * S;
    const btnX = W / 2 - btnW / 2;
    const btnY = H - 90 * S;
    this.btnBg = this.add.graphics();
    this.drawWoodButton(this.btnBg, btnX, btnY, btnW, btnH);

    this.btnText = this.add.text(W / 2, btnY + btnH / 2, 'Valider', {
      fontSize: `${26 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    const hitZone = this.add.zone(W / 2, btnY + btnH / 2, btnW + 20 * S, btnH + 20 * S)
      .setInteractive({ useHandCursor: true });
    hitZone.on('pointerdown', () => { if (this.phase === 'planning') this.submitMoves(); });
  }

  private createDesktopUI(W: number, H: number) {
    const cy = H / 2;
    const panelCx = 46 * S;

    this.scoreRed = this.add.text(panelCx, cy + 26 * S, '0', {
      fontSize: `${44 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.scoreYellow = this.add.text(W - panelCx, cy + 26 * S, '0', {
      fontSize: `${44 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.timerText = this.add.text(W / 2, 30 * S, '0:30', {
      fontSize: `${32 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.statusText = this.add.text(W / 2, H - 68 * S, '', {
      fontSize: `${15 * S}px`, fontFamily: 'Fredoka, sans-serif',
      color: '#fff8e8', stroke: '#00000044', strokeThickness: 2 * S,
    }).setOrigin(0.5);

    const btnW = 170 * S;
    const btnH = 50 * S;
    const btnX = W / 2 - btnW / 2;
    const btnY = H - 62 * S;

    this.btnBg = this.add.graphics();
    this.drawWoodButton(this.btnBg, btnX, btnY, btnW, btnH);

    this.btnText = this.add.text(W / 2, btnY + btnH / 2, 'Valider', {
      fontSize: `${17 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
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
        fontSize: `${11 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
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
    this.scoreRed.setText(String(this.scoreRedValue));
    this.scoreYellow.setText(String(this.scoreYellowValue));
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
    const sc = r / (22 * S);
    g.setAlpha(isActive ? 1 : 0.3);

    g.fillStyle(0x000000, 0.15);
    g.fillEllipse(x + 1 * S, y + 4 * S * sc, r * 2, r * 1.3);

    const dark = this.darkenColor(color, 0.65);
    g.fillStyle(dark, 1);
    g.fillCircle(x, y, r + 2 * S * sc);

    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);

    g.fillStyle(0xffffff, 0.3);
    g.fillEllipse(x - r * 0.15, y - r * 0.35, r * 0.7, r * 0.4);

    const er = 5 * S * sc;
    const esp = 5 * S * sc;
    const ey = y - 2 * S * sc;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x - esp, ey, er);
    g.fillCircle(x + esp, ey, er);
    g.fillStyle(0x222222, 1);
    g.fillCircle(x - esp + 0.5 * S * sc, ey + 0.5 * S * sc, er * 0.55);
    g.fillCircle(x + esp + 0.5 * S * sc, ey + 0.5 * S * sc, er * 0.55);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(x - esp - 1 * S * sc, ey - 1.2 * S * sc, 1.2 * S * sc);
    g.fillCircle(x + esp - 1 * S * sc, ey - 1.2 * S * sc, 1.2 * S * sc);

    g.setAlpha(1);
  }

  // ───────────────── Color helpers ─────────────────

  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  private startGame() {
    this.phase = 'planning';
    if (this.isLocal) {
      (this.client as import('../network/LocalClient').LocalClient).start();
    }
  }

  // ───────────────── Juice ─────────────────

  private spawnImpactParticles(
    cx: number, cy: number, nx: number, ny: number, speed: number,
    gA: Globulo | null, gB: Globulo | null,
  ) {
    const count = Math.min(Math.floor(speed * 0.8), 10);
    const colors: number[] = [];
    if (gA) colors.push(GAME_CONFIG.teams[gA.team].color);
    if (gB) colors.push(GAME_CONFIG.teams[gB.team].color);
    colors.push(0xffffff);

    for (let i = 0; i < count; i++) {
      const g = this.add.graphics();
      const col = colors[i % colors.length];
      const size = (1.5 + Math.random() * 2.5) * S;
      g.fillStyle(col, 0.9);
      g.fillCircle(0, 0, size);
      g.setPosition(cx, cy);

      const spread = Math.PI * 0.7;
      const baseAngle = Math.atan2(ny, nx);
      const a = baseAngle + (Math.random() - 0.5) * spread;
      const dist = (20 + Math.random() * 25) * S;

      this.tweens.add({
        targets: g,
        x: cx + Math.cos(a) * dist,
        y: cy + Math.sin(a) * dist,
        alpha: 0,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 250 + Math.random() * 150,
        ease: 'Quad.Out',
        onComplete: () => g.destroy(),
      });
    }
  }

  private shakeCamera(intensity: number) {
    this.cameras.main.shake(80, intensity / (GAME_CONFIG.width * 1.5));
  }

  // ───────────────── Goal handling ─────────────────

  private onGoal(team: Team) {
    if (team === 'red') {
      this.scoreRedValue++;
    } else {
      this.scoreYellowValue++;
    }
    this.updateScores();

    // Screen shake + brief flash
    this.shakeCamera(6 * S);
    const flash = this.add.graphics();
    flash.fillStyle(0xffffff, 0.3);
    flash.fillRect(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 400, ease: 'Quad.Out',
      onComplete: () => flash.destroy(),
    });

    // "BUUUUUT !" animation
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;
    const teamColor = GAME_CONFIG.teams[team].color;
    const goalText = this.add.text(W / 2, H / 2, 'BUUUUUT !', {
      fontSize: `${50 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#' + teamColor.toString(16).padStart(6, '0'),
      stroke: '#ffffff', strokeThickness: 6 * S,
    }).setOrigin(0.5).setDepth(60).setScale(0.1).setAlpha(0);

    this.tweens.add({
      targets: goalText,
      scaleX: 1, scaleY: 1, alpha: 1,
      duration: 300, ease: 'Back.Out',
    });
    this.tweens.add({
      targets: goalText,
      y: H / 2 - 20 * S,
      duration: 800, ease: 'Sine.InOut',
    });
    this.tweens.add({
      targets: goalText,
      alpha: 0, scaleX: 1.3, scaleY: 1.3,
      delay: 900, duration: 400, ease: 'Quad.In',
      onComplete: () => goalText.destroy(),
    });

    // Check for winner
    if (this.scoreRedValue >= GAME_CONFIG.football.scoreToWin) {
      this.endGame('red');
      return;
    }
    if (this.scoreYellowValue >= GAME_CONFIG.football.scoreToWin) {
      this.endGame('yellow');
      return;
    }

    // After delay, reset positions and continue
    this.time.delayedCall(1500, () => {
      this.resetPositions();
      this.client.send({ type: 'ready' });
      this.phase = 'waiting';
    });
  }

  private resetPositions() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MatterBody = (Phaser.Physics.Matter as any).Matter.Body;

    // Respawn dead globulos, reposition alive ones
    const newGlobulos: Globulo[] = [];
    for (const saved of this.startingPositions.globulos) {
      const existing = this.globulos.find((gl) => gl.team === saved.team && gl.id === saved.id);
      if (existing && existing.alive) {
        MatterBody.setPosition(existing.body, { x: saved.x, y: saved.y });
        MatterBody.setVelocity(existing.body, { x: 0, y: 0 });
        existing.clearPendingForce();
        newGlobulos.push(existing);
      } else {
        if (existing) existing.destroy();
        const g = new Globulo(this, saved.x, saved.y, saved.team, saved.id);
        newGlobulos.push(g);
      }
    }
    this.globulos = newGlobulos;

    this.ball.reset(this.startingPositions.ballX, this.startingPositions.ballY);
    this.goalScored = false;
  }

  // ───────────────── Game logic ─────────────────

  private isSettled(): boolean {
    const globulosSettled = this.globulos.filter((g) => g.alive).every((g) => {
      const v = g.body.velocity;
      return Math.abs(v.x) < 0.1 * S && Math.abs(v.y) < 0.1 * S;
    });

    const bv = this.ball.body.velocity;
    const ballSettled = Math.abs(bv.x) < 0.1 * S && Math.abs(bv.y) < 0.1 * S;

    return globulosSettled && ballSettled;
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

    this.add.text(W / 2, H / 2 - 28 * S, label, {
      fontSize: `${38 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: (this.isLocal || isMe) ? '#fff8e8' : '#ffcccc', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 2 * S, `${this.scoreRedValue} - ${this.scoreYellowValue}`, {
      fontSize: `${28 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    const rBtnW = 200 * S;
    const rBtnH = 44 * S;
    const rBtnX = W / 2 - rBtnW / 2;
    const rBtnY = H / 2 + 38 * S;
    const rBtn = this.add.graphics();
    this.drawWoodButton(rBtn, rBtnX, rBtnY, rBtnW, rBtnH);

    this.add.text(W / 2, rBtnY + rBtnH / 2, 'Nouvelle partie', {
      fontSize: `${16 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
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
      fontSize: `${24 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#ffcccc', stroke: '#5a3a18', strokeThickness: 3 * S,
    }).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 24 * S, 'Cliquez pour revenir au menu principal', {
      fontSize: `${14 * S}px`, fontFamily: 'Fredoka, sans-serif', color: '#fff8e8',
    }).setOrigin(0.5);

    this.input.once('pointerdown', () => window.location.reload());
  }

  // ───────────────── Update loop ─────────────────

  update(_time: number, delta: number) {
    this.globulos.forEach((g) => g.update());
    this.ball.update();

    if (this.phase === 'resolving') {
      this.resolveTimer += delta;

      // Check for entities in goal zones
      const { centerX, centerY, fieldWidth: fw, goalWidth: gw, goalHeight: gh } = GAME_CONFIG.football;
      const goalLeftX = centerX - fw / 2;
      const goalRightX = centerX + fw / 2;

      // Globulos falling into goals
      this.globulos.filter((g) => g.alive).forEach((g) => {
        const pos = g.body.position;
        const inGoalY = Math.abs(pos.y - centerY) < gh / 2;
        if (inGoalY && pos.x < goalLeftX) {
          g.fallIntoPit(goalLeftX - gw / 2, centerY, () => {});
        } else if (inGoalY && pos.x > goalRightX) {
          g.fallIntoPit(goalRightX + gw / 2, centerY, () => {});
        }
      });

      // Ball entering a goal — counts once more than half the ball has crossed into the goal mouth
      if (!this.goalScored) {
        const bx = this.ball.body.position.x;
        const by = this.ball.body.position.y;
        const inGoalY = by > centerY - gh / 2 && by < centerY + gh / 2;

        if (inGoalY && bx < goalLeftX) {
          this.goalScored = true;
          this.onGoal('yellow');
          return;
        }
        if (inGoalY && bx > goalRightX) {
          this.goalScored = true;
          this.onGoal('red');
          return;
        }
      }

      if (this.resolveTimer > 300 && this.isSettled() && !this.goalScored) {
        this.updateScores();
        this.client.send({ type: 'ready' });
        this.phase = 'waiting';
      }
    }
  }
}
