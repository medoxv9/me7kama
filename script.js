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
let myName = '';
let myRole = '';

function show(screen) {
  [startScreen, lobbyScreen, roleScreen, gameScreen].forEach((item) => item.classList.add('hidden'));
  screen.classList.remove('hidden');
}

async function createRoom() {
  const response = await fetch('/api/rooms', { method: 'POST' });
  const data = await response.json();
  history.replaceState({}, '', `/${data.roomCode}`);
  connect(data.roomCode);
}

function connect(roomCode) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/?room=${roomCode}`);
  socket.addEventListener('open', () => { roomInfo.textContent = `كود الجلسة: ${roomCode}`; roomLink.value = `${location.origin}/${roomCode}`; show(lobbyScreen); });
  socket.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
  socket.addEventListener('close', () => { if (!currentState || currentState.phase !== 'verdict') log.textContent = 'تقطع الاتصال بالسيرفر.'; });
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
  updateRoleAvailability(state);
  const myServerPlayer = state.players.find((player) => player.id === myPlayerId);
  if (myServerPlayer?.name && myServerPlayer?.role) {
    roomInfo.textContent = `${myServerPlayer.name} اختار دور ${myServerPlayer.role}. كنتسناو اللاعبين الآخرين.`;
  } else if (state.players.length === 3 && state.players.every((player) => player.name && player.role)) {
    roomInfo.textContent = 'كاملين واجدين، غادي تبدا الجلسة...';
  }
}

function updateRoleAvailability(state) {
  const occupiedRoles = new Set(state.players.filter((player) => player.id !== myPlayerId).map((player) => player.role));
  document.querySelectorAll('.role').forEach((role) => {
    const unavailable = occupiedRoles.has(role.dataset.role);
    role.classList.toggle('unavailable', unavailable);
    role.setAttribute('aria-disabled', String(unavailable));
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function updateGame(state) {
  document.querySelector('#sessionNumber').textContent = String(state.session).padStart(2, '0');
  document.querySelector('#caseTitle').textContent = state.case.title;
  document.querySelector('#caseDescription').textContent = state.case.description;
  document.querySelector('#caseClue').textContent = state.case.clue;
  document.querySelector('#chosenRole').textContent = selectedRole;
  startLocalTimer(state);
  document.querySelectorAll('.player').forEach((card) => {
    const role = card.dataset.player;
    const player = state.players.find((item) => item.role === role);
    card.querySelector('h3').textContent = `${player?.name || 'كيتسنى'} · ${role}`;
    card.classList.toggle('turn', state.phase === 'playing' && state.players[state.currentTurn]?.role === role);
    card.querySelector('.status').textContent = card.classList.contains('turn') ? 'دابا كيهضر' : 'كيتسنى';
    card.querySelectorAll('.action').forEach((button) => { button.disabled = state.phase !== 'playing' || state.players[state.currentTurn]?.role !== role; });
  });
  const activeRole = state.phase === 'verdict' ? 'القاضي' : state.players[state.currentTurn]?.role;
  talkLabel.textContent = state.phase === 'verdict' ? 'دابا القاضي يعطي الحكم' : `الكلمة ديال ${activeRole || 'القاضي'}`;
  talkInput.placeholder = state.phase === 'verdict' ? 'كتب الحكم ديالك هنا...' : `كتب كلام ${activeRole || 'القاضي'} هنا...`;
  talkInput.disabled = !state.players.find((item) => item.id === myPlayerId)?.role || (state.phase === 'playing' && state.players[state.currentTurn]?.role !== state.players.find((item) => item.id === myPlayerId)?.role) || (state.phase === 'verdict' && state.players.find((item) => item.id === myPlayerId)?.role !== 'القاضي');
  document.querySelector('#talkButton').disabled = talkInput.disabled;
  if (state.phase === 'verdict') log.textContent = 'سال وقت المرافعة. عند القاضي 50 ثانية باش يعطي الحكم.';
}

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function startLocalTimer(state) {
  clearInterval(timerInterval);
  const render = () => {
    const remaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    timer.textContent = formatTime(remaining);
  };
  render();
  timerInterval = setInterval(render, 250);
}

document.querySelector('#startButton').addEventListener('click', createRoom);
document.querySelector('#chooseRoleButton').addEventListener('click', () => show(roleScreen));
document.querySelector('#copyRoom').addEventListener('click', async () => {
  const link = roomLink.value;
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link);
      copied = true;
    }
  } catch (error) {
    copied = false;
  }
  if (!copied) {
    roomLink.focus();
    roomLink.select();
    roomLink.setSelectionRange(0, link.length);
    copied = document.execCommand('copy');
  }
  roomInfo.textContent = copied ? 'تنسخ الرابط، صيفطو لصحابك.' : 'حدد الرابط بيدك ودير نسخ.';
});
document.querySelectorAll('.role').forEach((role) => role.addEventListener('click', () => { if (role.classList.contains('unavailable')) { roomInfo.textContent = `الدور ديال ${role.dataset.role} خداوه لاعب آخر.`; return; } document.querySelectorAll('.role').forEach((item) => item.classList.remove('active')); role.classList.add('active'); selectedRole = role.dataset.role; }));
document.querySelector('#joinButton').addEventListener('click', () => { const name = playerName.value.trim(); if (!name) { nameError.textContent = 'كتب سميتك عاد دخل للجلسة.'; playerName.focus(); return; } if (!socket || socket.readyState !== WebSocket.OPEN) { nameError.textContent = 'تسنى شوية حتى يتصل السيرفر.'; return; } myName = name; myRole = selectedRole; nameError.textContent = ''; socket.send(JSON.stringify({ type: 'join', name, role: selectedRole })); roomInfo.textContent = `${name} اختار دور ${selectedRole}. كنتسناو اللاعبين الآخرين.`; show(lobbyScreen); });
document.querySelectorAll('.action').forEach((button) => button.addEventListener('click', () => socket.send(JSON.stringify({ type: 'action', text: button.dataset.message }))));
document.querySelector('#talkButton').addEventListener('click', () => { const text = talkInput.value.trim(); if (!text) return talkInput.focus(); socket.send(JSON.stringify({ type: currentState.phase === 'verdict' ? 'verdict' : 'talk', text })); talkInput.value = ''; });

const roomFromUrl = new URLSearchParams(location.search).get('room') || location.pathname.match(/^\/([A-Z0-9]{6})$/i)?.[1];
if (roomFromUrl) { connect(roomFromUrl.toUpperCase()); }
