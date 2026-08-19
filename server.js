const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const port = process.env.PORT || 3000;
const rooms = new Map();
const roles = ['القاضي', 'المحامي', 'المتهم'];
const cases = [
  { title: 'سرّ اللوحة المفقودة', description: 'المتهم متابع بسرقة لوحة فنية من المتحف الوطني', clue: 'الدليل الوحيد هو تسجيل كاميرا مقطوع لمدة سبع دقائق.' },
  { title: 'سرقة الطوموبيل الحمراء', description: 'المتهم متابع بسرقة طوموبيل من قدّام محطة القطار', clue: 'الكاميرا صورت شخصاً لابس جاكيطة، ولكن الوجه ما باينش.' },
  { title: 'لغز الجريمة فالليل', description: 'المتهم متابع بجريمة قتل وقعات فدار مهجورة', clue: 'الشاهد الوحيد سمع صوتاً فالليل، ولكن ما شاف حتى واحد.' }
];

function makeRoomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(code));
  return code;
}

function publicState(room) {
  return {
    type: 'state',
    roomCode: room.code,
    phase: room.phase,
    session: room.session,
    case: cases[room.caseIndex],
    secondsLeft: room.secondsLeft,
    endsAt: room.endsAt,
    currentTurn: room.currentTurn,
    players: room.players.map(({ id, name, role }) => ({ id, name, role }))
  };
}

function broadcast(room) {
  const message = JSON.stringify(publicState(room));
  room.clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(message); });
}

function beginRound(room) {
  room.phase = 'playing';
  room.secondsLeft = 90;
  room.endsAt = Date.now() + 90 * 1000;
  room.currentTurn = 0;
  broadcast(room);
  clearInterval(room.clock);
    room.clock = setInterval(() => {
      if (Date.now() >= room.endsAt) beginVerdict(room);
  }, 1000);
}

function beginVerdict(room) {
  clearInterval(room.clock);
  room.phase = 'verdict';
  room.secondsLeft = 50;
  room.endsAt = Date.now() + 50 * 1000;
  room.currentTurn = 0;
  broadcast(room);
  room.clock = setInterval(() => {
     if (Date.now() >= room.endsAt) nextRound(room);
  }, 1000);
}

function nextRound(room) {
  clearInterval(room.clock);
  room.caseIndex = (room.caseIndex + 1) % cases.length;
  room.session += 1;
  beginRound(room);
}

function createRoom() {
  const code = makeRoomCode();
  const room = { code, phase: 'lobby', session: 3, caseIndex: 0, secondsLeft: 90, currentTurn: 0, players: [], clients: new Set(), clock: null };
  rooms.set(code, room);
  return room;
}

function send(client, data) { client.send(JSON.stringify(data)); }

const server = http.createServer((request, response) => {
  if (request.url === '/api/rooms' && request.method === 'POST') {
    const room = createRoom();
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ roomCode: room.code }));
    return;
  }
  const requestedPath = request.url.split('?')[0];
  const requested = requestedPath === '/' || /^\/[A-Z0-9]{6}$/.test(requestedPath) ? '/index.html' : requestedPath;
  const filePath = path.join(__dirname, requested);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json' };
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

const websocketServer = new WebSocket.Server({ server });
websocketServer.on('connection', (client, request) => {
  const roomCode = new URL(request.url, `http://${request.headers.host}`).searchParams.get('room');
  const room = rooms.get(roomCode);
  if (!room) { send(client, { type: 'error', message: 'هاد الجلسة ما لقاتش.' }); client.close(); return; }
  const player = { id: crypto.randomUUID(), name: '', role: '', client };
  if (room.players.length >= 3) { send(client, { type: 'error', message: 'الجلسة عامرة، فيها 3 لاعبين.' }); client.close(); return; }
  room.players.push(player);
  room.clients.add(client);
  send(client, { type: 'connected', playerId: player.id, roomCode: room.code });
  broadcast(room);

  client.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'join') {
      player.name = String(message.name || '').trim().slice(0, 20);
      const requestedRole = roles.includes(message.role) ? message.role : '';
      const roleTaken = room.players.some((item) => item !== player && item.role === requestedRole);
      if (roleTaken) { send(client, { type: 'error', message: `الدور ديال ${requestedRole} خداوه لاعب آخر، اختار دور آخر.` }); return; }
      player.role = requestedRole;
      broadcast(room);
      if (room.players.length === 3 && room.players.every((item) => item.name && item.role) && new Set(room.players.map((item) => item.role)).size === 3) beginRound(room);
      return;
    }
    if (message.type === 'action' || message.type === 'talk' || message.type === 'verdict') {
      if (room.phase === 'verdict' && message.type === 'verdict' && player.role === 'القاضي' && message.text) { broadcastLog(room, `الحكم ديال ${player.name}: «${message.text.slice(0, 180)}»`); nextRound(room); return; }
      if (room.phase !== 'playing' || room.players[room.currentTurn]?.role !== player.role) return;
      if (message.type === 'talk' && message.text) broadcastLog(room, `${player.role} قال: «${message.text.slice(0, 180)}»`);
      if (message.type === 'action') broadcastLog(room, message.text || `${player.role} دار حركة.`);
      room.currentTurn = (room.currentTurn + 1) % 3;
      broadcast(room);
    }
  });

  client.on('close', () => { room.clients.delete(client); room.players = room.players.filter((item) => item.client !== client); broadcast(room); });
});

function broadcastLog(room, text) {
  room.clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'log', text })); });
}

server.listen(port, () => console.log(`Courtroom online: http://localhost:${port}`));
