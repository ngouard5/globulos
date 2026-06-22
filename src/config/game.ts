const S = Math.min(window.devicePixelRatio ?? 1, 2);
const isMobile = window.innerHeight > window.innerWidth;

export const GAME_CONFIG = {
  width: (isMobile ? 600 : 800) * S,
  height: (isMobile ? 960 : 660) * S,
  isMobile,

  arena: {
    centerX: (isMobile ? 300 : 400) * S,
    centerY: (isMobile ? 400 : 300) * S,
    radius: 250 * S,
    pitRadius: 80 * S,
  },

  globulo: {
    radius: 18 * S,
    mass: 1,
    friction: 0.02,
    frictionAir: 0.03,
    restitution: 0.4,
  },

  teams: {
    red: { color: 0xe84444, count: 4 },
    yellow: { color: 0xf5c842, count: 4 },
  },

  turn: {
    maxForce: 12 * S,
    arrowMaxLength: 100 * S,
  },

  football: {
    fieldWidth: 500 * S,
    fieldHeight: 300 * S,
    centerX: (isMobile ? 300 : 400) * S,
    centerY: (isMobile ? 400 : 300) * S,
    goalWidth: 22 * S,
    goalHeight: 100 * S,
    wallThickness: 20 * S,
    ball: {
      radius: 12 * S,
      mass: 0.08,
      friction: 0.01,
      frictionAir: 0.045,
      restitution: 0.6,
    },
    playersPerTeam: 3,
    scoreToWin: 3,
  },

  scale: S,
};
