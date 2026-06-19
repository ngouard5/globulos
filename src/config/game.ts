export const GAME_CONFIG = {
  width: 800,
  height: 600,

  arena: {
    centerX: 400,
    centerY: 300,
    radius: 250,
    pitRadius: 80,
  },

  globulo: {
    radius: 18,
    mass: 1,
    friction: 0.02,
    frictionAir: 0.03,
    restitution: 0.4,
  },

  teams: {
    red: { color: 0xe84444, count: 3 },
    yellow: { color: 0xf5c842, count: 3 },
  },

  turn: {
    maxForce: 12,
    arrowMaxLength: 100,
  },
};
