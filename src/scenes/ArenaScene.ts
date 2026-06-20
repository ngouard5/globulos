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
    this.showTutorial();
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

  // ───────────────── Arena drawing ─────────────────

  private drawArena() {
    const { centerX, centerY, radius, pitRadius } = GAME_CONFIG.arena;

    this.drawEnvironment(centerX, centerY, radius);

    const g = this.add.graphics();
    const depth = 18 * S;

    const arenaSc = (radius * 2.5) / 564;

    // Layer 1: outer ring (arena_ring.svg)
    this.drawSvgShape(g, centerX, centerY, 564, 572, arenaSc, [
      [[94,81.5],[87,110.5],[65.5,120.5],[57,139],[29.5,165],[29.5,183],[20,204],[0,215.5],[5,236.5],[0,246],[5,277.5],[0,302],[0,328.5],[13.5,363.5],[20,397],[49,430.5],[57,463.5],[90,484],[110.5,507.5],[125.5,529],[166.5,544.5],[212,554],[262.5,571.5],[295,563.5],[339.5,563.5],[365.5,554],[410.5,544.5],[428,544.5],[439,529],[444.5,513],[465,507.5],[491,495.5],[503.5,480.5],[515.5,448.5],[522.5,441.5],[530.5,421.5],[552.5,383],[558,316],[564,277.5],[544.5,224.5],[544.5,189.5],[522.5,143.5],[503.5,128],[491,100.5],[470.5,90],[453,69.5],[401,35],[410.5,24],[410.5,5.5],[377.5,0],[365.5,10.5],[365.5,24],[321.5,17.5],[295,5.5],[262.5,17.5],[249,10.5],[183,24],[172.5,35],[158.5,41],[130,54],[125.5,61],[94,81.5]],
    ], 0xf8ba55);

    // Layer 2: panels (arena_pannels.svg)
    const arenaPanels: { pts: number[][]; color: number }[] = [
      { pts: [[118,44.5],[110.5,55.5],[130.5,79],[138.5,71],[118,44.5]], color: 0xb47d20 },
      { pts: [[110.5,55.5],[85,78],[105.5,100],[130.5,79],[110.5,55.5]], color: 0xd59234 },
      { pts: [[85,78],[69,86.5],[90.5,112.5],[105.5,100],[85,78]], color: 0x99610f },
      { pts: [[69,86.5],[63,102],[83,123],[90.5,112.5],[69,86.5]], color: 0xba7a20 },
      { pts: [[63,102],[45.5,126.5],[69,141.5],[83,123],[63,102]], color: 0x975602 },
      { pts: [[45.5,126.5],[29.5,142.5],[58.5,155.5],[69,141.5],[45.5,126.5]], color: 0xd59234 },
      { pts: [[29.5,142.5],[25.5,166],[49.5,170.5],[58.5,155.5],[29.5,142.5]], color: 0x99610f },
      { pts: [[25.5,166],[16.5,190],[42,193.5],[49.5,170.5],[25.5,166]], color: 0xd59234 },
      { pts: [[16.5,190],[6.5,239.5],[31.5,240.5],[42,193.5],[16.5,190]], color: 0xba7a20 },
      { pts: [[6.5,239.5],[0,250.5],[28.5,253],[31.5,240.5],[6.5,239.5]], color: 0x975602 },
      { pts: [[0,250.5],[6,264],[27,265],[28.5,253],[0,250.5]], color: 0x99610f },
      { pts: [[6,264],[6,320],[31,320],[27,265],[6,264]], color: 0xd59234 },
      { pts: [[6,320],[13.5,336.5],[34.5,336.5],[31,320],[6,320]], color: 0x99610f },
      { pts: [[13.5,336.5],[27,365.5],[46,363.5],[34.5,336.5],[13.5,336.5]], color: 0xba7a20 },
      { pts: [[27,365.5],[47,401.5],[64,399.5],[46,363.5],[27,365.5]], color: 0xd59234 },
      { pts: [[47,401.5],[53,423],[71.5,415.5],[64,399.5],[47,401.5]], color: 0x99610f },
      { pts: [[53,423],[66.5,431.5],[80,423.5],[71.5,415.5],[53,423]], color: 0xd59234 },
      { pts: [[66.5,431.5],[86,459],[102.5,449],[80,423.5],[66.5,431.5]], color: 0xba7a20 },
      { pts: [[86,459],[100,464.5],[111,455.5],[102.5,449],[86,459]], color: 0x99610f },
      { pts: [[100,464.5],[114,483],[128,472],[111,455.5],[100,464.5]], color: 0xba7a20 },
      { pts: [[114,483],[131,486.5],[142,477.5],[128,472],[114,483]], color: 0xd59234 },
      { pts: [[161.5,502],[198,512.5],[201.5,503],[168.5,490],[161.5,502]], color: 0xba7a20 },
      { pts: [[131,486.5],[161.5,502],[168.5,490],[142,477.5],[131,486.5]], color: 0x99610f },
      { pts: [[198,512.5],[212.5,523],[214.5,508],[201.5,503],[198,512.5]], color: 0x975602 },
      { pts: [[212.5,523],[222,521],[222,509],[214.5,508],[212.5,523]], color: 0xd59234 },
      { pts: [[222,521],[262,522.5],[262,511],[222,509],[222,521]], color: 0xa16914 },
      { pts: [[262,522.5],[278.5,529.5],[278.5,512.5],[262,511],[262,522.5]], color: 0xd59234 },
      { pts: [[278.5,529.5],[293,521.5],[293,510],[278.5,512.5],[278.5,529.5]], color: 0xba7a20 },
      { pts: [[293,521.5],[310,520],[310,507.5],[293,510],[293,521.5]], color: 0xd59234 },
      { pts: [[310,520],[328,516],[326.5,504],[310,507.5],[310,520]], color: 0xcf8c2f },
      { pts: [[328,516],[342.5,518.5],[341.5,502.5],[326.5,504],[328,516]], color: 0xba7a20 },
      { pts: [[342.5,518.5],[357.5,513],[350,500.5],[341.5,502.5],[342.5,518.5]], color: 0xd59234 },
      { pts: [[350,500.5],[365.5,490],[369.5,502],[357.5,513],[350,500.5]], color: 0x975602 },
      { pts: [[369.5,502],[398,488.5],[392,475],[365.5,490],[369.5,502]], color: 0xd59234 },
      { pts: [[392,475],[414.5,458.5],[421.5,472],[398,488.5],[392,475]], color: 0xba7a20 },
      { pts: [[414.5,458.5],[446,431],[456.5,439.5],[421.5,472],[414.5,458.5]], color: 0x975602 },
      { pts: [[446,431],[460,415.5],[477,424.5],[456.5,439.5],[446,431]], color: 0xa16914 },
      { pts: [[460,415.5],[467.5,400],[482,407],[477,424.5],[460,415.5]], color: 0xd59234 },
      { pts: [[467.5,400],[483.5,367.5],[508.5,375],[482,407],[467.5,400]], color: 0xa16914 },
      { pts: [[508.5,375],[515,354.5],[492.5,347],[483.5,367.5],[508.5,375]], color: 0x975602 },
      { pts: [[515,354.5],[524,334.5],[495.5,331.5],[492.5,347],[515,354.5]], color: 0xd59234 },
      { pts: [[524,334.5],[524,299],[501.5,296.5],[495.5,331.5],[524,334.5]], color: 0xba7a20 },
      { pts: [[524,299],[524.5,280.5],[502.5,279.5],[501.5,296.5],[524,299]], color: 0xcf8c2f },
      { pts: [[524.5,280.5],[531,264],[502.5,264],[502.5,279.5],[524.5,280.5]], color: 0xa16914 },
      { pts: [[531,264],[524,249.5],[501,248.5],[502.5,264],[531,264]], color: 0x975602 },
      { pts: [[524,249.5],[518.5,207.5],[495,215.5],[501,248.5],[524,249.5]], color: 0xa16914 },
      { pts: [[518.5,207.5],[515.5,173.5],[490.5,189.5],[495,215.5],[518.5,207.5]], color: 0xcf8c2f },
      { pts: [[515.5,173.5],[499.5,154],[480.5,168.5],[490.5,189.5],[515.5,173.5]], color: 0xba7a20 },
      { pts: [[499.5,154],[499,137],[476,156],[480.5,168.5],[499.5,154]], color: 0x975602 },
      { pts: [[499,137],[472.5,110],[449.5,125],[476,156],[499,137]], color: 0xa16914 },
      { pts: [[472.5,110],[449.5,83],[434,105],[449.5,125],[472.5,110]], color: 0xba7a20 },
      { pts: [[449.5,83],[444,68.5],[425.5,95.5],[434,105],[449.5,83]], color: 0x975602 },
      { pts: [[444,68.5],[430.5,65],[405.5,83],[425.5,95.5],[444,68.5]], color: 0xa16914 },
      { pts: [[430.5,65],[358.5,24],[357.5,55.5],[405.5,83],[430.5,65]], color: 0xba7a20 },
      { pts: [[358.5,24],[343,10.5],[335,45],[357.5,55.5],[358.5,24]], color: 0xa76710 },
      { pts: [[343,10.5],[319.5,11.5],[317,41.5],[335,45],[343,10.5]], color: 0xa16914 },
      { pts: [[302,7.5],[278,6],[278,35.5],[301.5,39.5],[302,7.5]], color: 0x975602 },
      { pts: [[265.5,0],[254,7.5],[254,37.5],[265.5,34.5],[265.5,0]], color: 0xba7a20 },
      { pts: [[254,7.5],[239,7.5],[240.5,37.5],[254,37.5],[254,7.5]], color: 0x975602 },
      { pts: [[239,7.5],[225.5,2],[229,37.5],[240.5,37.5],[239,7.5]], color: 0xb47d20 },
      { pts: [[225.5,2],[214,11.5],[222,40.5],[229,37.5],[225.5,2]], color: 0xcf8c2f },
      { pts: [[214,11.5],[155.5,31.5],[168.5,55.5],[222,40.5],[214,11.5]], color: 0x99610f },
      { pts: [[138.5,32],[118,44.5],[138.5,71],[157.5,60.5],[138.5,32]], color: 0xcf8c2f },
      { pts: [[155.5,31.5],[138.5,32],[157.5,60.5],[168.5,55.5],[155.5,31.5]], color: 0x975602 },
      { pts: [[265.5,34.5],[265.5,0],[278,6],[278,35.5],[265.5,34.5]], color: 0xd59234 },
      { pts: [[319.5,11.5],[302,7.5],[301.5,39.5],[317,41.5],[319.5,11.5]], color: 0xba7a20 },
    ];
    const panelArenaSc = (radius * 2.3) / 531;
    for (const p of arenaPanels) {
      this.drawSvgShape(g, centerX, centerY, 531, 530, panelArenaSc, [p.pts], p.color);
    }

    // Arena grass floor — shadow layer first (B7E14D), then main layer on top (C7F554)
    const arenaBgPts = [[130.5,79],[138.5,71],[157.5,60.5],[168.5,55.5],[222,40.5],[229,37.5],[240.5,37.5],[254,37.5],[265.5,34.5],[278,35.5],[301.5,39.5],[317,41.5],[335,45],[357.5,55.5],[405.5,83],[425.5,95.5],[434,105],[449.5,125],[476,156],[480.5,168.5],[490.5,189.5],[495,215.5],[501,248.5],[502.5,264],[502.5,279.5],[501.5,296.5],[495.5,331.5],[492.5,347],[483.5,367.5],[467.5,400],[460,415.5],[446,431],[414.5,458.5],[392,475],[365.5,490],[350,500.5],[341.5,502.5],[326.5,504],[310,507.5],[293,510],[278.5,512.5],[262,511],[222,509],[214.5,508],[201.5,503],[168.5,490],[142,477.5],[128,472],[111,455.5],[102.5,449],[80,423.5],[71.5,415.5],[64,399.5],[46,363.5],[34.5,336.5],[31,320],[27,265],[28.5,253],[31.5,240.5],[42,193.5],[49.5,170.5],[58.5,155.5],[69,141.5],[83,123],[90.5,112.5],[105.5,100],[130.5,79]];
    this.drawSvgShape(g, centerX, centerY, 531, 530, panelArenaSc, [arenaBgPts], 0xb7e14d);
    // Main floor — the curve from shadow SVG approximated with intermediate points
    const arenaMainPts = [
      [358.5,56],[405.5,83],[425.5,95.5],[434,105],[449.5,125],[476,156],
      [480.5,168.5],[490.5,189.5],[495,215.5],[501,248.5],[502.5,264],
      [502.5,279.5],[501.5,296.5],[495.5,331.5],[492.5,347],[483.5,367.5],
      [467.5,400],[460,415.5],[446,431],[414.5,458.5],[392,475],[365.5,490],
      [350,500.5],[341.5,502.5],[326.5,504],[310,507.5],[293,510],
      [278.5,512.5],[262,511],[222,509],[214.5,508],[201.5,503],[168.5,490],
      [142,477.5],[128,472],[111,455.5],[102.5,449],[80,423.5],[71.5,415.5],
      [64,399.5],[46,363.5],
      [34.5,337],
      [40,305],[38,275],[37,245],[40,215],[48,190],
      [60,165],[78,140],[100,118],[130,100],[165,85],
      [205,72],[250,62],[305,56],[358.5,56],
    ];
    this.drawSvgShape(g, centerX, centerY, 531, 530, panelArenaSc, [arenaMainPts], 0xc7f554);

    // Grass texture
    const grassRng = new Phaser.Math.RandomDataGenerator(['arena-grass']);
    for (let i = 0; i < 200; i++) {
      const a = grassRng.frac() * Math.PI * 2;
      const r = grassRng.frac() * (radius - 10 * S);
      const x = centerX + Math.cos(a) * r;
      const y = centerY + Math.sin(a) * r;
      const shade = grassRng.frac() < 0.5 ? 0xb8e848 : 0xd4ff68;
      g.fillStyle(shade, 0.25);
      g.fillCircle(x, y, (1 + grassRng.frac() * 2.5) * S);
    }

    this.drawPit(g, centerX, centerY, pitRadius, depth);

    this.drawLeaves(centerX, centerY, radius);

    this.createArenaBorder(centerX, centerY, radius);
  }

  private drawEnvironment(cx: number, cy: number, arenaRadius: number) {
    const g = this.add.graphics();

    const bubbles = [
      { x: cx - arenaRadius - 100 * S, y: cy + 15 * S, r: 10 * S },
      { x: cx + arenaRadius + 90 * S, y: cy - 15 * S, r: 8 * S },
      { x: cx - arenaRadius - 75 * S, y: cy - 120 * S, r: 9 * S },
      { x: cx + arenaRadius + 70 * S, y: cy + 120 * S, r: 10 * S },
    ];
    bubbles.forEach(({ x, y, r }) => {
      g.fillStyle(0xc7f554, 0.5);
      g.fillCircle(x, y, r);
      g.lineStyle(1.5 * S, 0xd8ff88, 0.4);
      g.strokeCircle(x, y, r);
    });
  }

  private drawLeaves(cx: number, cy: number, arenaRadius: number) {
    const g = this.add.graphics();
    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const leaf1 = { w: 142, h: 137, paths: [
      { pts: [[141.5,80.5],[106.5,7.5],[106.5,31],[104,83.5],[83,110],[39.5,100.5],[62.5,135],[114.5,137],[141.5,114],[141.5,80.5]], color: 0x000000, alpha: 0.08 },
      { pts: [[92.5,16.5],[105,6.5],[109.5,16.5],[102,26],[109.5,42],[109.5,89],[83.5,114.5],[30.5,106],[0,71.5],[4,21],[34,3],[65,0],[92.5,16.5]], color: 0x95df42, alpha: 1 },
      { pts: [[66.5,62.5],[107.5,11.5],[107.5,17.5],[103,26],[110,47.5],[110,90],[84,115],[31.5,107],[17.5,90],[66.5,62.5]], color: 0x82cc2f, alpha: 1 },
    ] };
    const leaf2 = { w: 99, h: 70, paths: [
      { pts: [[57.5,34.5],[8.5,17.5],[4,23.5],[34,34.5],[38,55.5],[57.5,70],[85,70],[98.5,50.5],[85,29],[57.5,34.5]], color: 0x000000, alpha: 0.08 },
      { pts: [[7,9],[0,20.5],[4,23],[11,13.5],[25,15.5],[30.5,40.5],[40.5,50],[74,46.5],[76,37],[84,29.5],[74,9],[51,0],[30.5,6],[7,9]], color: 0x95df42, alpha: 1 },
      { pts: [[3.5,24],[0,21.5],[6.5,8.5],[27,6],[46.5,11.5],[76.5,35.5],[74,47],[42,50],[30,41],[25.5,16],[11.5,13],[3.5,24]], color: 0x82cc2f, alpha: 1 },
    ] };

    const m = 55 * S;
    const off = 20 * S;
    const leafPlacements = [
      { leaf: leaf1, x: m, y: m, sc: 0.8 * S, rot: 0 },
      { leaf: leaf2, x: W - m, y: m + 10 * S, sc: 0.85 * S, rot: 0.3 },
      { leaf: leaf1, x: m + 10 * S, y: H - m, sc: 0.75 * S, rot: -0.8 },
      { leaf: leaf2, x: W - m, y: H - m, sc: 0.8 * S, rot: 2.5 },
      { leaf: leaf1, x: cx - arenaRadius - off * 2.5, y: cy - off * 2, sc: 0.85 * S, rot: -0.4 },
      { leaf: leaf2, x: cx - arenaRadius - off * 2, y: cy + off * 3, sc: 0.75 * S, rot: 1.8 },
      { leaf: leaf1, x: cx + arenaRadius + off * 2.5, y: cy - off * 2, sc: 0.8 * S, rot: 0.6 },
      { leaf: leaf2, x: cx + arenaRadius + off * 2, y: cy + off * 2.5, sc: 0.75 * S, rot: 3.2 },
    ];

    for (const lp of leafPlacements) {
      const lsc = lp.sc;
      for (const path of lp.leaf.paths) {
        g.fillStyle(path.color, path.alpha);
        g.beginPath();
        for (let i = 0; i < path.pts.length; i++) {
          const dx = (path.pts[i][0] - lp.leaf.w / 2) * lsc;
          const dy = (path.pts[i][1] - lp.leaf.h / 2) * lsc;
          const rx = dx * Math.cos(lp.rot) - dy * Math.sin(lp.rot);
          const ry = dx * Math.sin(lp.rot) + dy * Math.cos(lp.rot);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (i === 0) (g as any).moveTo(lp.x + rx, lp.y + ry);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else (g as any).lineTo(lp.x + rx, lp.y + ry);
        }
        g.fillPath();
      }
    }
  }

  private drawPit(g: Phaser.GameObjects.Graphics, cx: number, cy: number, pitRadius: number, _arenaDepth: number) {
    const sc = (pitRadius * 2.4) / 160;

    // Layer 1: outer ring (pit_ring.svg)
    this.drawSvgShape(g, cx, cy, 160, 168, sc, [
      [[129,152],[115.5,155],[113.5,168],[121,163.5],[129,163.5],[129,152]],
      [[73.5,160],[52,160],[41.5,148.5],[25.5,139.5],[11.5,127],[0,75],[8.5,56],[8.5,41.5],[25.5,16.5],[45,14.5],[52,0],[70,0],[87,9],[123,16.5],[141.5,28],[155.5,58.5],[159.5,92.5],[147.5,112.5],[137,127],[131.5,146],[115.5,146],[104.5,160],[73.5,160]],
    ], 0xf8ba55);

    // Layer 2: panels (pit_pannels.svg) — each path with its own color
    const panels: { pts: number[][]; color: number }[] = [
      { pts: [[40,0],[50,27],[67.5,24.5],[67.5,0],[40,0]], color: 0xcf8c2f },
      { pts: [[67.5,24.5],[67.5,0],[88,4],[88,28.5],[67.5,24.5]], color: 0xb47d20 },
      { pts: [[88,28.5],[88,4],[117.5,15],[100.5,36.5],[88,28.5]], color: 0x975602 },
      { pts: [[117.5,15],[100.5,36.5],[111.5,52.5],[133,37.5],[117.5,15]], color: 0xba7a20 },
      { pts: [[133,37.5],[111.5,52.5],[113.5,69.5],[132,69.5],[133,37.5]], color: 0xd59234 },
      { pts: [[132,69.5],[113.5,69.5],[113.5,80.5],[132,89],[132,69.5]], color: 0x975602 },
      { pts: [[132,89],[113.5,80.5],[95,106.5],[111.5,111],[132,89]], color: 0xba7a20 },
      { pts: [[111.5,111],[95,106.5],[88,114.5],[95,127.5],[111.5,111]], color: 0xa16914 },
      { pts: [[71,127.5],[95,127.5],[88,114.5],[73,117.5],[71,127.5]], color: 0xba7a20 },
      { pts: [[71,127.5],[73,117.5],[49.5,115.5],[41,121.5],[71,127.5]], color: 0x975602 },
      { pts: [[49.5,115.5],[41,121.5],[19.5,113],[40.5,109],[49.5,115.5]], color: 0xba7a20 },
      { pts: [[40.5,109],[19.5,113],[8.5,86.5],[25,85.5],[40.5,109]], color: 0xa16914 },
      { pts: [[25,85.5],[8.5,86.5],[0,69.5],[19.5,69.5],[25,85.5]], color: 0x975602 },
      { pts: [[19.5,69.5],[0,69.5],[2,38.5],[24,52.5],[19.5,69.5]], color: 0xba7a20 },
      { pts: [[2,38.5],[24,52.5],[50,27],[40,0],[2,38.5]], color: 0x99610f },
    ];
    const panelSc = (pitRadius * 2.1) / 133;
    for (const p of panels) {
      this.drawSvgShape(g, cx, cy, 133, 128, panelSc, [p.pts], p.color);
    }

    // Layer 3: background — full shape in shadow color, then main (excluding shadow crescent) on top
    const pitBgSc = (pitRadius * 1.5) / 94;
    this.drawSvgShape(g, cx, cy, 94, 93, pitBgSc, [
      [[48,0],[30.5,2.5],[4.5,28],[0,45],[5.5,61],[21,84.5],[30,91],[53.5,93],[68.5,90],[75.5,82],[94,56],[94,45],[92,28],[81,12],[68.5,4],[48,0]],
    ], 0xe4ac4b);
    this.drawSvgShape(g, cx, cy, 94, 93, pitBgSc, [
      [[68.5,4],[81,12],[92,28],[94,45],[94,56],[75.5,82],[68.5,90],[53.5,93],[30,91],[21,84.5],[5.5,61],
       [7,50],[10,40],[16,30],[24,22],[35,16],[48,10],[60,6],[68.5,4]],
    ], 0xf8bb51);
  }

  private drawSvgShape(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    svgW: number, svgH: number, sc: number,
    paths: number[][][], color: number,
  ) {
    g.fillStyle(color, 1);
    for (const path of paths) {
      g.beginPath();
      for (let i = 0; i < path.length; i++) {
        const px = cx + (path[i][0] - svgW / 2) * sc;
        const py = cy + (path[i][1] - svgH / 2) * sc;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (i === 0) (g as any).moveTo(px, py);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else (g as any).lineTo(px, py);
      }
      g.fillPath();
    }
  }


  // ───────────────── Color helpers ─────────────────

  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }



  // ───────────────── Ready screen + Tutorial ─────────────────


  private showTutorial() {
    const firstTime = !localStorage.getItem('globulos-tutorial-done');
    if (!firstTime) {
      this.startGame();
      return;
    }

    const W = GAME_CONFIG.width;
    const H = GAME_CONFIG.height;

    const overlay = this.add.graphics().setDepth(50);
    overlay.fillStyle(0x000000, 0.5);
    overlay.fillRect(0, 0, W, H);

    const steps = [
      'Glissez sur un Globulo\npour choisir sa direction',
      'Validez pour lancer\ntous vos Globulos',
      'Poussez les adversaires\ndans le trou !',
    ];
    let step = 0;

    const text = this.add.text(W / 2, H / 2 - 20 * S, steps[0], {
      fontSize: `${20 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 3 * S,
      align: 'center',
    }).setOrigin(0.5).setDepth(52);

    const counter = this.add.text(W / 2, H / 2 + 30 * S, `1 / ${steps.length}`, {
      fontSize: `${13 * S}px`, fontFamily: 'Fredoka, sans-serif',
      color: '#fff8e8', stroke: '#00000044', strokeThickness: 2 * S,
    }).setOrigin(0.5).setDepth(52);

    const hint = this.add.text(W / 2, H / 2 + 55 * S, 'Tapez pour continuer', {
      fontSize: `${12 * S}px`, fontFamily: 'Fredoka, sans-serif',
      color: 'rgba(255,248,232,0.6)',
    }).setOrigin(0.5).setDepth(52);

    const zone = this.add.zone(W / 2, H / 2, W, H)
      .setInteractive().setDepth(53);

    zone.on('pointerdown', () => {
      step++;
      if (step >= steps.length) {
        localStorage.setItem('globulos-tutorial-done', '1');
        overlay.destroy();
        text.destroy();
        counter.destroy();
        hint.destroy();
        zone.destroy();
        this.startGame();
      } else {
        text.setText(steps[step]);
        counter.setText(`${step + 1} / ${steps.length}`);
      }
    });
  }

  private startGame() {
    this.phase = 'planning';
    if (this.isLocal) {
      (this.client as import('../network/LocalClient').LocalClient).start();
    }
  }

  // ───────────────── Physics border ─────────────────

  private createArenaBorder(cx: number, cy: number, r: number) {
    const segments = 48;
    const thickness = 20 * S;
    const wallR = r * 1.08;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const midAngle = (angle + nextAngle) / 2;

      const x = cx + (wallR + thickness / 2) * Math.cos(midAngle);
      const y = cy + (wallR + thickness / 2) * Math.sin(midAngle);
      const segLen = 2 * (wallR + thickness) * Math.tan(Math.PI / segments) + 2;

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

        if (gA || gB) {
          const contact = pair.collision.supports?.[0] ?? pair.collision;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cx = (contact as any).x ?? (gA ? gA.body.position.x : gB!.body.position.x);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cy = (contact as any).y ?? (gA ? gA.body.position.y : gB!.body.position.y);
          const speed = gA && gB
            ? Math.sqrt(Math.pow(gA.body.velocity.x - gB.body.velocity.x, 2) + Math.pow(gA.body.velocity.y - gB.body.velocity.y, 2))
            : Math.sqrt(Math.pow((gA ?? gB)!.body.velocity.x, 2) + Math.pow((gA ?? gB)!.body.velocity.y, 2));
          this.spawnImpactParticles(cx, cy, normal.x, normal.y, speed, gA, gB);
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
    this.scoreRed = this.add.text(100 * S, topBarY, '3', {
      fontSize: `${48 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0, 0.5);

    this.drawMiniGlobulo(topBarBg, W - 55 * S, topBarY, GAME_CONFIG.teams.yellow.color, true, globR);
    this.scoreYellow = this.add.text(W - 100 * S, topBarY, '3', {
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

    this.scoreRed = this.add.text(panelCx, cy + 26 * S, '3', {
      fontSize: `${44 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: '#fff8e8', stroke: '#5a3a18', strokeThickness: 4 * S,
    }).setOrigin(0.5);

    this.scoreYellow = this.add.text(W - panelCx, cy + 26 * S, '3', {
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

  // ───────────────── Game logic ─────────────────

  private isSettled(): boolean {
    return this.globulos.filter((g) => g.alive).every((g) => {
      const v = g.body.velocity;
      return Math.abs(v.x) < 0.1 * S && Math.abs(v.y) < 0.1 * S;
    });
  }

  private checkFallen() {
    const { centerX, centerY, pitRadius, radius: arenaRadius } = GAME_CONFIG.arena;
    // Fall zone matches pit_background.svg (scaled by 1.5, avg radius ~47/94 of that)
    const bgR = pitRadius * 1.5 / 2;
    const fallR = bgR;
    this.globulos.filter((g) => g.alive).forEach((g) => {
      const pos = g.body.position;
      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < fallR) {
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
      fontSize: `${38 * S}px`, fontFamily: 'Fredoka, sans-serif', fontStyle: 'bold',
      color: (this.isLocal || isMe) ? '#fff8e8' : '#ffcccc', stroke: '#5a3a18', strokeThickness: 4 * S,
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

    this.add.text(W / 2, H / 2 + 24 * S, 'Cliquez pour revenir au lobby', {
      fontSize: `${14 * S}px`, fontFamily: 'Fredoka, sans-serif', color: '#fff8e8',
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
        this.statusText.setText('');
      }
    }
  }
}
