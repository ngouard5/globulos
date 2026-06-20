import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';

export type Team = 'red' | 'yellow';

const S = GAME_CONFIG.scale;

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
  private breathTween: Phaser.Tweens.Tween | null = null;
  private bobTween: Phaser.Tweens.Tween | null = null;
  private bobOffset = 0;
  private dustTimer = 0;

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
    this.startBreathing();
  }

  private startBreathing() {
    const delay = 200 + Math.random() * 400;
    this.scene.time.delayedCall(delay, () => {
      if (!this.alive) return;
      this.breathTween = this.scene.tweens.add({
        targets: this.graphics,
        scaleX: { from: 1, to: 1.02 },
        scaleY: { from: 1, to: 0.98 },
        duration: 1200 + Math.random() * 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    });
    this.startBobbing();
  }

  private stopIdleAnimations() {
    if (this.breathTween) { this.breathTween.stop(); this.breathTween = null; }
    if (this.bobTween) { this.bobTween.stop(); this.bobTween = null; }
    this.bobOffset = 0;
  }

  private startBobbing() {
    const bobTarget = { v: 0 };
    this.bobTween = this.scene.tweens.add({
      targets: bobTarget,
      v: { from: -1.2 * S, to: 1.2 * S },
      duration: 1800 + Math.random() * 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      onUpdate: () => { this.bobOffset = bobTarget.v; },
    });
  }

  private drawCircle(color: number) {
    const r = GAME_CONFIG.globulo.radius;
    const g = this.graphics;
    g.clear();

    // Shadow
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(2 * S, 5 * S, r * 2.1, r * 1.4);

    // Darker outline ring
    const dark = this.darkenColor(color, 0.65);
    g.fillStyle(dark, 1);
    g.fillCircle(0, 0, r + 2 * S);

    // Main body
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, r);

    // Lighter belly highlight
    const light = this.darkenColor(color, 1.2);
    g.fillStyle(light, 0.4);
    g.fillEllipse(0, r * 0.15, r * 1.2, r * 0.9);

    // Top shine
    g.fillStyle(0xffffff, 0.35);
    g.fillEllipse(-r * 0.15, -r * 0.35, r * 0.7, r * 0.4);

    // Eyes — big, round, cute
    const ey = -2 * S;
    const esp = 5.5 * S;
    const er = 5.5 * S;

    // Eye whites
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-esp, ey, er);
    g.fillCircle(esp, ey, er);

    // Pupils — centered, looking slightly forward
    const pr = 3 * S;
    g.fillStyle(0x222222, 1);
    g.fillCircle(-esp + 0.5 * S, ey + 0.5 * S, pr);
    g.fillCircle(esp + 0.5 * S, ey + 0.5 * S, pr);

    // Pupil shine
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(-esp - 1 * S, ey - 1.5 * S, 1.3 * S);
    g.fillCircle(esp - 1 * S, ey - 1.5 * S, 1.3 * S);

    // Mouth — small happy arc
    g.lineStyle(1.8 * S, this.darkenColor(color, 0.4), 0.6);
    g.beginPath();
    g.arc(0, 3 * S, 4 * S, 0.3, Math.PI - 0.3, false);
    g.strokePath();

    // Cheek blush
    g.fillStyle(this.darkenColor(color, 0.85), 0.25);
    g.fillEllipse(-r * 0.55, 3 * S, 5 * S, 3.5 * S);
    g.fillEllipse(r * 0.55, 3 * S, 5 * S, 3.5 * S);
  }

  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  select() {
    this.stopIdleAnimations();
    this.scene.tweens.add({
      targets: this.graphics,
      scaleX: 0.9, scaleY: 0.9,
      duration: 80, ease: 'Quad.Out',
    });
  }

  deselect() {
    this.scene.tweens.add({
      targets: this.graphics,
      scaleX: 1, scaleY: 1,
      duration: 100, ease: 'Quad.Out',
      onComplete: () => this.startBreathing(),
    });
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

    const arrowColor = 0x5cb832;
    const headLen = 14 * S;
    const a1 = angle - 0.45;
    const a2 = angle + 0.45;

    this.arrowGraphics.clear();

    // Shadow
    this.arrowGraphics.lineStyle(7 * S, 0x000000, 0.15);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x + 2 * S, pos.y + 3 * S);
    this.arrowGraphics.lineTo(endX + 2 * S, endY + 3 * S);
    this.arrowGraphics.strokePath();

    // Dark outline
    this.arrowGraphics.lineStyle(6 * S, 0x2a6e10, 0.7);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x, pos.y);
    this.arrowGraphics.lineTo(endX, endY);
    this.arrowGraphics.strokePath();

    // Green line
    this.arrowGraphics.lineStyle(3.5 * S, arrowColor, 1);
    this.arrowGraphics.beginPath();
    this.arrowGraphics.moveTo(pos.x, pos.y);
    this.arrowGraphics.lineTo(endX, endY);
    this.arrowGraphics.strokePath();

    // Arrow head outline
    this.arrowGraphics.fillStyle(0x2a6e10, 0.8);
    this.arrowGraphics.fillTriangle(
      endX + Math.cos(angle) * 2 * S, endY + Math.sin(angle) * 2 * S,
      endX - (headLen + 3 * S) * Math.cos(a1), endY - (headLen + 3 * S) * Math.sin(a1),
      endX - (headLen + 3 * S) * Math.cos(a2), endY - (headLen + 3 * S) * Math.sin(a2),
    );

    // Arrow head
    this.arrowGraphics.fillStyle(arrowColor, 1);
    this.arrowGraphics.fillTriangle(
      endX + Math.cos(angle) * 1 * S, endY + Math.sin(angle) * 1 * S,
      endX - headLen * Math.cos(a1), endY - headLen * Math.sin(a1),
      endX - headLen * Math.cos(a2), endY - headLen * Math.sin(a2),
    );
  }

  squish(normalX: number, normalY: number) {
    if (this._squishing || !this.alive) return;
    this._squishing = true;

    this.stopIdleAnimations();

    const angle = Math.atan2(normalY, normalX);
    this.graphics.setRotation(angle);

    this.scene.tweens.add({
      targets: this.graphics,
      scaleX: 0.6,
      scaleY: 1.4,
      duration: 70,
      ease: 'Quad.Out',
      yoyo: true,
      onComplete: () => {
        this.graphics.setRotation(0);
        this.graphics.setScale(1, 1);
        this._squishing = false;
        this.startBreathing();
      },
    });
  }

  applyForce() {
    if (!this._pendingForce) return;
    const scale = GAME_CONFIG.turn.maxForce / GAME_CONFIG.turn.arrowMaxLength;
    const vx = this._pendingForce.x * scale;
    const vy = this._pendingForce.y * scale;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MatterBody = (Phaser.Physics.Matter as any).Matter.Body;
    MatterBody.setVelocity(this.body, { x: vx, y: vy });
    this._pendingForce = null;
    this.arrowGraphics.clear();
  }

  emitDust() {
    const pos = this.body.position;
    const v = this.body.velocity;
    const angle = Math.atan2(v.y, v.x) + Math.PI;
    const g = this.scene.add.graphics();
    const size = (2 + Math.random() * 3) * S;
    const ox = (Math.random() - 0.5) * 8 * S;
    const oy = (Math.random() - 0.5) * 8 * S;
    g.fillStyle(0xd4c4a0, 0.45);
    g.fillCircle(0, 0, size);
    g.setPosition(pos.x + Math.cos(angle) * GAME_CONFIG.globulo.radius + ox, pos.y + Math.sin(angle) * GAME_CONFIG.globulo.radius + oy);
    this.scene.tweens.add({
      targets: g,
      alpha: 0, scaleX: 2.5, scaleY: 2.5,
      x: g.x + (Math.random() - 0.5) * 10 * S,
      y: g.y + (Math.random() - 0.5) * 10 * S,
      duration: 300 + Math.random() * 200,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  fallIntoPit(pitX: number, pitY: number, onComplete: () => void) {
    this.alive = false;
    this.stopIdleAnimations();
    this.arrowGraphics.destroy();
    this.scene.matter.world.remove(this.body);

    const color = GAME_CONFIG.teams[this.team].color;
    for (let i = 0; i < 12; i++) {
      const g = this.scene.add.graphics();
      const starSize = (2 + Math.random() * 3) * S;
      g.fillStyle(i % 3 === 0 ? 0xffff66 : (i % 3 === 1 ? color : 0xffffff), 0.9);
      this.drawStar(g, 0, 0, starSize);
      g.setPosition(this.graphics.x, this.graphics.y);
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
      const dist = (40 + Math.random() * 30) * S;
      this.scene.tweens.add({
        targets: g,
        x: g.x + Math.cos(a) * dist, y: g.y + Math.sin(a) * dist,
        alpha: 0, scaleX: 0.2, scaleY: 0.2,
        duration: 400 + Math.random() * 200,
        ease: 'Quad.Out',
        onComplete: () => g.destroy(),
      });
    }

    this.scene.tweens.add({
      targets: this.graphics,
      rotation: Math.PI * 4, scaleX: 0.38, scaleY: 0.38,
      duration: 550, ease: 'Quad.In',
      onComplete: () => {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 28 * S;
        this.graphics.setPosition(pitX + Math.cos(angle) * dist, pitY + Math.sin(angle) * dist);
        this.graphics.setRotation(Math.random() * Math.PI * 2);
        this.drawDead();
        onComplete();
      },
    });
  }

  private drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.4;
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.fillPoints(pts as any, true);
  }

  private drawDead() {
    const r = GAME_CONFIG.globulo.radius;
    const color = GAME_CONFIG.teams[this.team].color;
    const g = this.graphics;
    g.clear();

    g.fillStyle(this.darkenColor(color, 0.65), 0.5);
    g.fillCircle(0, 0, r + 2 * S);
    g.fillStyle(color, 0.55);
    g.fillCircle(0, 0, r);

    g.lineStyle(2 * S, 0x000000, 0.8);
    const s = 3.5 * S;
    g.beginPath();
    g.moveTo(-5 * S - s, -4 * S - s); g.lineTo(-5 * S + s, -4 * S + s);
    g.moveTo(-5 * S + s, -4 * S - s); g.lineTo(-5 * S - s, -4 * S + s);
    g.strokePath();
    g.beginPath();
    g.moveTo(5 * S - s, -4 * S - s); g.lineTo(5 * S + s, -4 * S + s);
    g.moveTo(5 * S + s, -4 * S - s); g.lineTo(5 * S - s, -4 * S + s);
    g.strokePath();
  }

  update() {
    if (!this.alive) return;
    const pos = this.body.position;
    this.graphics.setPosition(pos.x, pos.y + this.bobOffset);

    const v = this.body.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    if (speed > 3 * S) {
      this.dustTimer++;
      if (this.dustTimer % 3 === 0) this.emitDust();
    } else {
      this.dustTimer = 0;
    }
  }

  destroy() {
    this.alive = false;
    this.stopIdleAnimations();
    this.graphics.destroy();
    this.arrowGraphics.destroy();
    this.scene.matter.world.remove(this.body);
  }
}
