import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.static(join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
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

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerTeam = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        const code = generateCode();
        const room = {
          code,
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
          send(p.ws, { type: 'game-start', team: p.team });
        });
        setTimeout(() => startRound(room), 1000);
        break;
      }

      case 'submit': {
        if (!playerRoom || playerRoom.phase !== 'planning') return;
        if (playerRoom.moves[playerTeam] !== null) return;
        playerRoom.moves[playerTeam] = msg.moves || [];
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
      if (playerRoom.timer) clearTimeout(playerRoom.timer);
      const opponent = playerRoom.players.find((p) => p.team !== playerTeam);
      if (opponent) send(opponent.ws, { type: 'opponent-disconnected' });
      rooms.delete(playerRoom.code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Globulos server listening on port ${PORT}`);
});
