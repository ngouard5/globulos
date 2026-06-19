import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene';
import { GAME_CONFIG } from './config/game';
import { Client } from './network/Client';
import { LocalClient } from './network/LocalClient';
import { drawLobbyBackground } from './lobbyBg';
import type { Team } from './entities/Globulo';

function getWsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl) return envUrl;
  const isDev = window.location.port === '5173' || window.location.port === '5174';
  if (isDev) return `ws://${window.location.hostname}:3001`;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}`;
}

const lobby = document.getElementById('lobby')!;
const lobbyMenu = document.getElementById('lobby-menu')!;
const lobbyWaiting = document.getElementById('lobby-waiting')!;
const lobbyError = document.getElementById('lobby-error')!;
const roomCodeEl = document.getElementById('room-code')!;
const roomInput = document.getElementById('room-input') as HTMLInputElement;
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const btnLocal = document.getElementById('btn-local')!;
const onlineStatus = document.getElementById('online-status')!;
const appEl = document.getElementById('app')!;

const lobbyBg = document.getElementById('lobby-bg') as HTMLCanvasElement;
drawLobbyBackground(lobbyBg);

type GameClient = Client | LocalClient;

function launchGame(team: Team, gameClient: GameClient, isLocal: boolean) {
  lobby.style.display = 'none';
  lobbyBg.style.display = 'none';
  appEl.style.display = 'block';

  new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_CONFIG.width,
    height: GAME_CONFIG.height,
    backgroundColor: '#3b7a24',
    physics: {
      default: 'matter',
      matter: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [ArenaScene],
    parent: 'app',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    callbacks: {
      preBoot: (game) => {
        game.registry.set('team', team);
        game.registry.set('client', gameClient);
        game.registry.set('isLocal', isLocal);
      },
    },
  });

  if (gameClient instanceof LocalClient) {
    gameClient.start();
  }
}

function setOnlineEnabled(enabled: boolean) {
  btnCreate.disabled = !enabled;
  btnJoin.disabled = !enabled;
  roomInput.disabled = !enabled;
}

// ── Local ──
btnLocal.addEventListener('click', () => {
  launchGame('red', new LocalClient(), true);
});

// ── Online ──
async function init() {
  const client = new Client();

  try {
    await client.connect(getWsUrl());
    onlineStatus.textContent = '';
    setOnlineEnabled(true);
  } catch {
    onlineStatus.innerHTML = 'Serveur indisponible';
    onlineStatus.classList.add('offline-msg');
    return;
  }

  btnCreate.addEventListener('click', () => {
    lobbyError.textContent = '';
    client.send({ type: 'create' });
  });

  btnJoin.addEventListener('click', () => {
    const code = roomInput.value.trim();
    if (code.length < 4) {
      lobbyError.textContent = 'Entrez un code à 4 caractères';
      return;
    }
    lobbyError.textContent = '';
    client.send({ type: 'join', room: code });
  });

  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });

  client.on('room-created', (data) => {
    roomCodeEl.textContent = data.room as string;
    lobbyMenu.style.display = 'none';
    lobbyWaiting.style.display = 'block';
  });

  client.on('error', (data) => {
    lobbyError.textContent = data.message as string;
  });

  client.on('game-start', (data) => {
    launchGame(data.team as Team, client, false);
  });

  client.on('opponent-disconnected', () => {
    lobbyError.textContent = 'Adversaire déconnecté';
  });
}

init();
