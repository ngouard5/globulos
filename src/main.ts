import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene';
import { FootballScene } from './scenes/FootballScene';
import { GAME_CONFIG } from './config/game';
import { Client } from './network/Client';
import { LocalClient } from './network/LocalClient';
import { drawLobbyBackground, stopLobbyAnimation } from './lobbyBg';
import type { Team } from './entities/Globulo';

type GameMode = 'arena' | 'football';

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

let selectedMode: GameMode = 'arena';

// ── Mode selector ──
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = (btn as HTMLElement).dataset.mode as GameMode;
  });
});

function launchGame(team: Team, gameClient: GameClient, isLocal: boolean, mode: GameMode) {
  stopLobbyAnimation();
  lobby.style.display = 'none';
  lobbyBg.style.display = 'none';
  appEl.style.display = 'block';

  const scene = mode === 'football' ? [FootballScene] : [ArenaScene];

  new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_CONFIG.width,
    height: GAME_CONFIG.height,
    backgroundColor: '#c7f554',
    physics: {
      default: 'matter',
      matter: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene,
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
}

function setOnlineEnabled(enabled: boolean) {
  btnCreate.disabled = !enabled;
  btnJoin.disabled = !enabled;
  roomInput.disabled = !enabled;
}

// ── Local ──
btnLocal.addEventListener('click', () => {
  launchGame('red', new LocalClient(), true, selectedMode);
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

  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom && urlRoom.length >= 4) {
    window.history.replaceState({}, '', window.location.pathname);
    client.send({ type: 'join', room: urlRoom });
  }

  btnCreate.addEventListener('click', () => {
    lobbyError.textContent = '';
    client.send({ type: 'create', mode: selectedMode });
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
    const code = data.room as string;
    roomCodeEl.textContent = code;
    lobbyMenu.style.display = 'none';
    lobbyWaiting.style.display = 'block';

    const joinUrl = `${window.location.origin}?room=${code}`;
    const linkEl = document.getElementById('room-link') as HTMLInputElement;
    linkEl.value = joinUrl;
    linkEl.style.display = 'block';
    linkEl.addEventListener('click', () => {
      linkEl.select();
      navigator.clipboard.writeText(joinUrl);
      linkEl.value = 'Copié !';
      setTimeout(() => { linkEl.value = joinUrl; }, 1500);
    });
  });

  client.on('error', (data) => {
    lobbyError.textContent = data.message as string;
  });

  client.on('game-start', (data) => {
    const mode = (data.mode as GameMode) || 'arena';
    launchGame(data.team as Team, client, false, mode);
  });

  client.on('opponent-disconnected', () => {
    lobbyError.textContent = 'Adversaire déconnecté';
  });
}

init();
