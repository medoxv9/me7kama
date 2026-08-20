const startScreen = document.querySelector('#startScreen');
const lobbyScreen = document.querySelector('#lobbyScreen');
const roleScreen = document.querySelector('#roleScreen');
const gameScreen = document.querySelector('#gameScreen');
const playerName = document.querySelector('#playerName');
const nameError = document.querySelector('#nameError');
const roomInfo = document.querySelector('#roomInfo');
const roomLink = document.querySelector('#roomLink');
const lobbyPlayers = document.querySelector('#lobbyPlayers');
const timer = document.querySelector('#timer');
const log = document.querySelector('#log');
const talkInput = document.querySelector('#talkInput');
const talkLabel = document.querySelector('#talkLabel');
const roles = ['القاضي', 'المحامي', 'المتهم'];
let selectedRole = 'القاضي';
let socket;
let myPlayerId = '';
let currentState;
let timerInterval;

function show(screen) {
  [startScreen, lobbyScreen, roleScreen, gameScreen].forEach((item) => item.classList.add('hidden'));
  screen.classList.remove('hidden');
}

async function createRoom() {
  const button = document.querySelector('#startButton');
  button.disabled = true;
  button.textContent = 'كنوجدو الجلسة...';
  try {
    const response = await fetch('/api/rooms', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.roomCode) throw new Error(data.message || 'تعذر إنشاء الجلسة.');
    history.replaceState({}, '', `/${data.roomCode}`);
    connect(data.roomCode);
  } catch (error) {
    roomInfo.textContent = error.message || 'وقع مشكل فالاتصال بالسيرفر.';
    button.disabled = false;
    button.textContent = 'عاود المحاولة ←';
  }
}

function connect(roomCode) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/?room=${roomCode}`);
  const timeout = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      socket.close();
      roomInfo.textContent = 'الاتصال بالسيرفر تأخر. عاود المحاولة.';
      const button = document.querySelector('#startButton');
      button.disabled = false;
      button.textContent = 'عاود المحاولة ←';
      show(startScreen);
    }
  }, 10000);
  socket.addEventListener('open', () => { clearTimeout(timeout); roomInfo.textContent = `كود الجلسة: ${roomCode}`; roomLink.value = `${location.origin}/${roomCode}`; show(lobbyScreen); });
  socket.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
  socket.addEventListener('error', () => { roomInfo.textContent = 'ما قدرناش نتاصلو بالسيرفر.'; });
  socket.addEventListener('close', () => { if (!currentState || currentState.phase !== 'verdict') roomInfo.textContent = 'تقطع الاتصال بالسيرفر.'; });
}

function handleMessage(message) {
  if (message.type === 'error') { roomInfo.textContent = message.message; return; }
  if (message.type === 'connected') { myPlayerId = message.playerId; return; }
  if (message.type === 'log') { log.textContent = message.text; return; }
  if (message.type !== 'state') return;
  currentState = message;
  if (message.phase === 'lobby') { updateLobby(message); show(lobbyScreen); return; }
  show(gameScreen);
  updateGame(message);
}

function updateLobby(state) {
  lobbyPlayers.innerHTML = state.players.map((player) => `<span class="lobby-player">${escapeHtml(player.name || 'كيتسنى الاسم')}${player.role ? ` اختار دور ${escapeHtml(player.role)}` : ' مازال ما اختارش الدور'}</span>`).join('');
  const occupiedRoles = new Set(state.players.filter((player) => player.id !== myPlayerId).map((player) => player.role));
  document.querySelectorAll('.role').forEach((role) => role.classList.toggle('unavailable', occupiedRoles.has(role.dataset.role)));
  const mine = state.players.find((player) => player.id === myPlayerId);
  if (mine?.name && mine.role) roomInfo.textContent = `${mine.name} اختار دور ${mine.role}. كنتسناو اللاعبين الآخرين.`;
}

function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

function updateGame(state) {
  document.querySelector('#sessionNumber').textContent = String(state.session).padStart(2, '0');
  document.querySelector('#caseTitle').textContent = state.case.title;
  document.querySelector('#caseDescription').textContent = state.case.description;
  document.querySelector('#caseClue').textContent = state.case.clue;
  startLocalTimer(state);
  document.querySelectorAll('.player').forEach((card) => {
    const role = card.dataset.player;
    const player = state.players.find((item) => item.role === role);
    card.querySelector('h3').textContent = `${player?.name || 'كيتسنى'} · ${role}`;
    const active = state.phase === 'playing' && state.players[state.currentTurn]?.role === role;
    card.classList.toggle('turn', active);
    card.querySelector('.status').textContent = active ? 'دابا كيهضر' : 'كيتسنى';
    card.querySelectorAll('.action').forEach((button) => { button.disabled = !active; });
  });
  const mine = state.players.find((player) => player.id === myPlayerId);
  const activeRole = state.phase === 'verdict' ? 'القاضي' : state.players[state.currentTurn]?.role;
  talkLabel.textContent = state.phase === 'verdict' ? 'دابا القاضي يعطي الحكم' : `الكلمة ديال ${activeRole || 'القاضي'}`;
  talkInput.placeholder = state.phase === 'verdict' ? 'كتب الحكم ديالك هنا...' : `كتب كلام ${activeRole || 'القاضي'} هنا...`;
  talkInput.disabled = !mine || (state.phase === 'playing' && mine.role !== activeRole) || (state.phase === 'verdict' && mine.role !== 'القاضي');
  document.querySelector('#talkButton').disabled = talkInput.disabled;
}

function startLocalTimer(state) {
  clearInterval(timerInterval);
  const render = () => {
    const remaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  };
  render();
  timerInterval = setInterval(render, 250);
}

document.querySelector('#startButton').addEventListener('click', createRoom);
document.querySelector('#chooseRoleButton').addEventListener('click', () => show(roleScreen));
document.querySelector('#copyRoom').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomLink.value); roomInfo.textContent = 'تنسخ الرابط، صيفطو لصحابك.'; } catch { roomLink.select(); document.execCommand('copy'); roomInfo.textContent = 'تنسخ الرابط، صيفطو لصحابك.'; } });
document.querySelectorAll('.role').forEach((role) => role.addEventListener('click', () => { if (role.classList.contains('unavailable')) { roomInfo.textContent = `الدور ديال ${role.dataset.role} خداوه لاعب آخر.`; return; } document.querySelectorAll('.role').forEach((item) => item.classList.remove('active')); role.classList.add('active'); selectedRole = role.dataset.role; }));
document.querySelector('#joinButton').addEventListener('click', () => { const name = playerName.value.trim(); if (!name) { nameError.textContent = 'كتب سميتك عاد دخل للجلسة.'; return; } if (!socket || socket.readyState !== WebSocket.OPEN) { nameError.textContent = 'تسنى شوية حتى يتصل السيرفر.'; return; } socket.send(JSON.stringify({ type: 'join', name, role: selectedRole })); show(lobbyScreen); });
document.querySelectorAll('.action').forEach((button) => button.addEventListener('click', () => socket?.send(JSON.stringify({ type: 'action', text: button.dataset.message }))));
document.querySelector('#talkButton').addEventListener('click', () => { const text = talkInput.value.trim(); if (!text) return; socket?.send(JSON.stringify({ type: currentState?.phase === 'verdict' ? 'verdict' : 'talk', text })); talkInput.value = ''; });

const roomFromUrl = new URLSearchParams(location.search).get('room') || location.pathname.match(/^\/([A-Z0-9]{6})$/i)?.[1];
if (roomFromUrl) connect(roomFromUrl.toUpperCase());
