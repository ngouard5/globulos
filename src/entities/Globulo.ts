import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';

export type Team = 'red' | 'yellow';

export class Globulo {
  scene: Phaser.Scene;
  body: MatterJS.BodyType;
  graphics: Phaser.GameObjects.Graphics;
  team: Team;
  id: number;
  alive: boolean = true;

  private arrowGraphics: Phaser.GameObjects.Graphics;
  private _pendingForce: { x: number; y: number } | null = null;
  private _squishing = false;

  constructor(scene: Phaser.Scene, x: number, y: number, team: Team, id: number) {
    this.scene = scene;
    this.team = team;
    this.id = id;

    const cfg = GAME_CONFIG.globulo;
    const color = GAME_CONFIG.teams[team].color;

    this.body = (scene.matter.add.circle(x, y, cfg.radius, {
      mass: cfg.mass,
      friction: cfg.friction,
      frictionAir: cfg.frictionAir,
      restitution: cfg.restitution,
      label: `globulo-${team}-${id}`,
    }) as unknown) as MatterJS.BodyType;

    this.graphics = scene.add.graphics();
    this.arrowGraphics = scene.add.graphics();

    this.drawCircle(color);
  }

  private drawCircle(color: number) {
    const r = GAME_CONFIG.globulo.radius;
    this.graphics.clear();

    // Drop shadow
    this.graphics.fillStyle(0x000000, 0.22);
    this.graphics.fillCircle(3, 5, r);

    // Spiky/bumpy border
    const numSpikes = 11;
    const dark = this.darkenColor(color, 0.58);
    this.graphics.fillStyle(dark, 1);
    const spikePoints: { x: number; y: number }[] = [];
    for (let i = 0; i < numSpikes * 2; i++) {
      const angle = (i / (numSpikes * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 3.5 : r - 1;
      spikePoints.push({ x: Math.cos(angle) * rad, y: Math.sin(angle) * rad });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.graphics.fillPoints(spikePoints as any, true);

    // Main body
    this.graphics.fillStyle(color, 1);
    this.graphics.fillCircle(0, 0, r);

    // Specular highlight (top-left shine)
    this.graphics.fillStyle(0xffffff, 0.32);
    this.graphics.fillEllipse(-r * 0.26, -r * 0.32, r * 0.62, r * 0.42);

    // Eyes — whites
    this.graphics.fillStyle(0xffffff, 1);
    this.graphics.fillCircle(-5, -4, 5);
    this.graphics.fillCircle(5, -4, 5);
    // Pupils
    this.graphics.fillStyle(0x111111, 1);
    this.graphics.fillCircle(-4, -3.5, 2.8);
    this.graphics.fillCircle(6, -3.5, 2.8);
    // Eye shine
    this.graphics.fillStyle(0xffffff, 0.85);
    this.graphics.fillCircle(-2.8, -5, 1.1);
    this.graphics.fillCircle(7.2, -5, 1.1);
  }

  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  setPendingForce(fx: number, fy: number) {
    this._pendingForce = { x: fx, y: fy };
  }

  clearPendingForce() {
    this._pendingForce = null;
    this.arrowGraphics.clear();
  }

  get pendingForce() {
    return this._pendingForce;
  }

  drawArrow(toX: number, toY: number) {
    const pos = this.body.position;
    const dx = toX - pos.x;
    const dy = toY - pos.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const maxLen = GAME_CONFIG.turn.arrowMaxLength;
    const clampedLen = Math.min(len, maxLen);
    const angle = Math.atan2(dy, dx);

    const endX = pos.x + Math.cos(angle) * clampedLen;
    const endY = pos.y + Math.sin(angle) * clampedLen;

    const teamColor = GAME_CONFIG.teams[this.team].color;
    const headLen = 16;
    const a1 = angle - 0.42;
    const a2 = angle + 0.42;

    this.arrowGraphics.clear();

    // --- Ombre portée (décalage + flou simulé) ---
    this.arrowGraphics.lineStyle(8, 0x000000, 0.18);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x + 3, pos.y + 4);
    this.arrowGraphics.lineTo(endX + 3, endY + 4);
    this.arrowGraphics.strokePath();

    // --- Contour sombre du trait ---
    this.arrowGraphics.lineStyle(7, 0x000000, 0.55);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x, pos.y);
    this.arrowGraphics.lineTo(endX, endY);
    this.arrowGraphics.strokePath();

    // --- Trait coloré (couleur équipe) ---
    this.arrowGraphics.lineStyle(4, teamColor, 0.95);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x, pos.y);
    this.arrowGraphics.lineTo(endX, endY);
    this.arrowGraphics.strokePath();

    // --- Contour de la pointe ---
    this.arrowGraphics.fillStyle(0x000000, 0.65);
    this.arrowGraphics.fillTriangle(
      endX, endY,
      endX - (headLen + 4) * Math.cos(a1), endY - (headLen + 4) * Math.sin(a1),
      endX - (headLen + 4) * Math.cos(a2), endY - (headLen + 4) * Math.sin(a2),
    );

    // --- Pointe colorée ---
    this.arrowGraphics.fillStyle(teamColor, 1);
    this.arrowGraphics.fillTriangle(
      endX, endY,
      endX - headLen * Math.cos(a1), endY - headLen * Math.sin(a1),
      endX - headLen * Math.cos(a2), endY - headLen * Math.sin(a2),
    );
  }

  squish(normalX: number, normalY: number) {
    if (this._squishing || !this.alive) return;
    this._squishing = true;

    const angle = Math.atan2(normalY, normalX);
    this.graphics.setRotation(angle);

    this.scene.tweens.add({
      targets: this.graphics,
      scaleX: 0.55,
      scaleY: 1.45,
      duration: 70,
      ease: 'Quad.Out',
      yoyo: true,
      onComplete: () => {
        this.graphics.setRotation(0);
        this.graphics.setScale(1, 1);
        this._squishing = false;
      },
    });
  }

  applyForce() {
    if (!this._pendingForce) return;
    const scale = GAME_CONFIG.turn.maxForce / GAME_CONFIG.turn.arrowMaxLength;
    const vx = this._pendingForce.x * scale;
    const vy = this._pendingForce.y * scale;
    // Use Matter.js Body.setVelocity via Phaser's internal Matter reference
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MatterBody = (Phaser.Physics.Matter as any).Matter.Body;
    MatterBody.setVelocity(this.body, { x: vx, y: vy });
    this._pendingForce = null;
    this.arrowGraphics.clear();
  }

  fallIntoPit(pitX: number, pitY: number, onComplete: () => void) {
    this.alive = false;
    this.arrowGraphics.destroy();
    this.scene.matter.world.remove(this.body);

    // Spin + shrink into the pit
    this.scene.tweens.add({
      targets: this.graphics,
      rotation: Math.PI * 4,
      scaleX: 0.38,
      scaleY: 0.38,
      duration: 550,
      ease: 'Quad.In',
      onComplete: () => {
        // Land at a random spot inside the pit
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 28;
        this.graphics.setPosition(
          pitX + Math.cos(angle) * dist,
          pitY + Math.sin(angle) * dist,
        );
        this.graphics.setRotation(Math.random() * Math.PI * 2);
        this.drawDead();
        onComplete();
      },
    });
  }

  private drawDead() {
    const r = GAME_CONFIG.globulo.radius;
    const color = GAME_CONFIG.teams[this.team].color;
    this.graphics.clear();

    // Corps légèrement assombri
    this.graphics.fillStyle(color, 0.65);
    this.graphics.fillCircle(0, 0, r);
    this.graphics.lineStyle(2, 0x000000, 0.3);
    this.graphics.strokeCircle(0, 0, r);

    // Yeux en X
    this.graphics.lineStyle(2.5, 0x000000, 1);
    const s = 4;
    // X gauche
    this.graphics.beginPath();
    this.graphics.moveTo(-7 - s, -6 - s); this.graphics.lineTo(-7 + s, -6 + s);
    this.graphics.moveTo(-7 + s, -6 - s); this.graphics.lineTo(-7 - s, -6 + s);
    this.graphics.strokePath();
    // X droit
    this.graphics.beginPath();
    this.graphics.moveTo(7 - s, -6 - s); this.graphics.lineTo(7 + s, -6 + s);
    this.graphics.moveTo(7 + s, -6 - s); this.graphics.lineTo(7 - s, -6 + s);
    this.graphics.strokePath();
  }

  update() {
    if (!this.alive) return;
    const pos = this.body.position;
    this.graphics.setPosition(pos.x, pos.y);
  }

  destroy() {
    this.alive = false;
    this.graphics.destroy();
    this.arrowGraphics.destroy();
    this.scene.matter.world.remove(this.body);
  }
}
