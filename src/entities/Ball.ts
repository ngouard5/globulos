import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/game';

const S = GAME_CONFIG.scale;
const cfg = GAME_CONFIG.football.ball;

export class Ball {
  scene: Phaser.Scene;
  body: MatterJS.BodyType;
  graphics: Phaser.GameObjects.Graphics;
  private dustTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;

    this.body = (scene.matter.add.circle(x, y, cfg.radius, {
      mass: cfg.mass,
      friction: cfg.friction,
      frictionAir: cfg.frictionAir,
      restitution: cfg.restitution,
      label: 'ball',
    }) as unknown) as MatterJS.BodyType;

    this.graphics = scene.add.graphics();
    this.draw();
  }

  private draw() {
    const r = cfg.radius;
    const g = this.graphics;
    g.clear();

    // Shadow
    g.fillStyle(0x000000, 0.15);
    g.fillEllipse(2 * S, 4 * S, r * 2, r * 1.3);

    // Outline
    g.fillStyle(0xdddddd, 1);
    g.fillCircle(0, 0, r + 1.5 * S);

    // White body
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, r);

    // Pentagon pattern (simplified)
    const pentR = r * 0.38;
    g.fillStyle(0x333333, 1);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(a) * pentR, y: Math.sin(a) * pentR });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.fillPoints(pts as any, true);

    // Top shine
    g.fillStyle(0xffffff, 0.5);
    g.fillEllipse(-r * 0.2, -r * 0.3, r * 0.5, r * 0.3);
  }

  update() {
    const pos = this.body.position;
    this.graphics.setPosition(pos.x, pos.y);

    const v = this.body.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    if (speed > 3 * S) {
      this.dustTimer++;
      if (this.dustTimer % 4 === 0) this.emitDust();
    } else {
      this.dustTimer = 0;
    }
  }

  private emitDust() {
    const pos = this.body.position;
    const v = this.body.velocity;
    const angle = Math.atan2(v.y, v.x) + Math.PI;
    const g = this.scene.add.graphics();
    const size = (1.5 + Math.random() * 2) * S;
    g.fillStyle(0xccddaa, 0.4);
    g.fillCircle(0, 0, size);
    g.setPosition(
      pos.x + Math.cos(angle) * cfg.radius + (Math.random() - 0.5) * 6 * S,
      pos.y + Math.sin(angle) * cfg.radius + (Math.random() - 0.5) * 6 * S,
    );
    this.scene.tweens.add({
      targets: g,
      alpha: 0, scaleX: 2, scaleY: 2,
      duration: 250 + Math.random() * 150,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  reset(x: number, y: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MatterBody = (Phaser.Physics.Matter as any).Matter.Body;
    MatterBody.setPosition(this.body, { x, y });
    MatterBody.setVelocity(this.body, { x: 0, y: 0 });
    this.graphics.setPosition(x, y);
  }

  destroy() {
    this.graphics.destroy();
    this.scene.matter.world.remove(this.body);
  }
}
