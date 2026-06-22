import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const MAX_ROOMS = 500;
const MAX_MOVES_PER_TEAM = 6;
const MAX_FORCE = 500;
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 15;

const app = express();
app.use(express.static(join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const rooms = new Map();

function generateCode() {
  if (rooms.size >= MAX_ROOMS) return null;
  let code;
  let attempts = 0;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
    attempts++;
    if (attempts > 100) return null;
  } while (rooms.has(code));
  return code;
}

function validateMoves(moves) {
  if (!Array.isArray(moves)) return [];
  const valid = [];
  for (let i = 0; i < Math.min(moves.length, MAX_MOVES_PER_TEAM); i++) {
    const m = moves[i];
    if (
      m &&
      typeof m === 'object' &&
      typeof m.id === 'number' &&
      typeof m.fx === 'number' &&
      typeof m.fy === 'number' &&
      Number.isFinite(m.fx) &&
      Number.isFinite(m.fy)
    ) {
      valid.push({
        id: m.id,
        fx: Math.max(-MAX_FORCE, Math.min(MAX_FORCE, m.fx)),
        fy: Math.max(-MAX_FORCE, Math.min(MAX_FORCE, m.fy)),
      });
    }
  }
  return valid;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  room.players.forEach((p) => send(p.ws, msg));
}

function startRound(room) {
  room.moves = { red: null, yellow: null };
  room.readyCount = 0;
  room.phase = 'planning';
  broadcast(room, { type: 'round-start', duration: 30 });
  room.timer = setTimeout(() => {
    if (room.moves.red === null) room.moves.red = [];
    if (room.moves.yellow === null) room.moves.yellow = [];
    resolveRound(room);
  }, 30000);
}

function resolveRound(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.phase = 'resolving';
  broadcast(room, { type: 'resolve', moves: room.moves });
}

function cleanupRoom(room) {
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(room.code);
}

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerTeam = null;
  let msgCount = 0;
  let msgWindowStart = Date.now();

  ws.on('message', (raw) => {
    // Rate limiting
    const now = Date.now();
    if (now - msgWindowStart > RATE_LIMIT_WINDOW) {
      msgCount = 0;
      msgWindowStart = now;
    }
    msgCount++;
    if (msgCount > RATE_LIMIT_MAX) return;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'create': {
        // Cleanup previous room if any
        if (playerRoom) {
          const opponent = playerRoom.players.find((p) => p.team !== playerTeam);
          if (opponent) send(opponent.ws, { type: 'opponent-disconnected' });
          cleanupRoom(playerRoom);
          playerRoom = null;
          playerTeam = null;
        }

        const code = generateCode();
        if (!code) {
          send(ws, { type: 'error', message: 'Serveur plein, réessayez plus tard' });
          return;
        }
        const room = {
          code,
          mode: msg.mode || 'arena',
          players: [{ ws, team: 'red' }],
          moves: { red: null, yellow: null },
          timer: null,
          phase: 'waiting',
          readyCount: 0,
        };
        rooms.set(code, room);
        playerRoom = room;
        playerTeam = 'red';
        send(ws, { type: 'room-created', room: code });
        break;
      }

      case 'join': {
        const code = (msg.room || '').toUpperCase();
        const room = rooms.get(code);
        if (!room || room.phase !== 'waiting' || room.players.length >= 2) {
          send(ws, {
            type: 'error',
            message: 'Partie introuvable ou déjà pleine',
          });
          return;
        }
        room.players.push({ ws, team: 'yellow' });
        playerRoom = room;
        playerTeam = 'yellow';
        room.players.forEach((p) => {
          send(p.ws, { type: 'game-start', team: p.team, mode: room.mode });
        });
        setTimeout(() => startRound(room), 1000);
        break;
      }

      case 'submit': {
        if (!playerRoom || playerRoom.phase !== 'planning') return;
        if (playerRoom.moves[playerTeam] !== null) return;
        playerRoom.moves[playerTeam] = validateMoves(msg.moves);
        const opponent = playerRoom.players.find(
          (p) => p.team !== playerTeam,
        );
        if (opponent) send(opponent.ws, { type: 'opponent-ready' });
        if (playerRoom.moves.red !== null && playerRoom.moves.yellow !== null) {
          resolveRound(playerRoom);
        }
        break;
      }

      case 'ready': {
        if (!playerRoom || playerRoom.phase !== 'resolving') return;
        playerRoom.readyCount = (playerRoom.readyCount || 0) + 1;
        if (playerRoom.readyCount >= 2) {
          startRound(playerRoom);
        }
        break;
      }

      case 'game-over': {
        if (!playerRoom) return;
        if (playerRoom.timer) {
          clearTimeout(playerRoom.timer);
          playerRoom.timer = null;
        }
        playerRoom.phase = 'gameover';
        break;
      }
    }
  });

  ws.on('close', () => {
    if (playerRoom) {
      const opponent = playerRoom.players.find((p) => p.team !== playerTeam);
      if (opponent) send(opponent.ws, { type: 'opponent-disconnected' });
      cleanupRoom(playerRoom);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Globulos server listening on port ${PORT}`);
});
