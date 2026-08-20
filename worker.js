const ROLES = ['القاضي', 'المحامي', 'المتهم'];
const CASES = [
  { title: 'سرّ اللوحة المفقودة', description: 'المتهم متابع بسرقة لوحة فنية من المتحف الوطني', clue: 'الدليل الوحيد هو تسجيل كاميرا مقطوع لمدة سبع دقائق.' },
  { title: 'سرقة الطوموبيل الحمراء', description: 'المتهم متابع بسرقة طوموبيل من قدّام محطة القطار', clue: 'الكاميرا صورت شخصاً لابس جاكيطة، ولكن الوجه ما باينش.' },
  { title: 'لغز الجريمة فالليل', description: 'المتهم متابع بجريمة قتل وقعات فدار مهجورة', clue: 'الشاهد الوحيد سمع صوتاً فالليل، ولكن ما شاف حتى واحد.' }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (value) => chars[value % chars.length]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const roomCode = code();
      const id = env.ROOMS.idFromName(roomCode);
      const room = env.ROOMS.get(id);
      await room.fetch(new Request(`https://room/create?code=${roomCode}`, { method: 'POST' }));
      return json({ roomCode }, 201);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const roomCode = url.searchParams.get('room')?.toUpperCase();
      if (!roomCode) return json({ message: 'Room code missing' }, 400);
      const id = env.ROOMS.idFromName(roomCode);
      return env.ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Room {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.players = new Map();
    this.sockets = new Map();
    this.room = { phase: 'lobby', session: 3, caseIndex: 0, currentTurn: 0, endsAt: 0 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create') return new Response('ok');
    if (url.pathname !== '/connect') return new Response('Not found', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    if (this.sockets.size >= 3) { server.accept(); server.send(JSON.stringify({ type: 'error', message: 'الجلسة عامرة، فيها 3 لاعبين.' })); server.close(); return new Response(null, { status: 101, webSocket: client }); }
    server.accept();
    this.sockets.set(id, server);
    this.players.set(id, { id, name: '', role: '' });
    server.addEventListener('message', async (event) => { try { await this.message(id, JSON.parse(event.data)); } catch {} });
    server.addEventListener('close', () => { this.sockets.delete(id); this.players.delete(id); this.broadcast(); });
    server.send(JSON.stringify({ type: 'connected', playerId: id }));
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async message(id, message) {
    const player = this.players.get(id);
    if (!player) return;
    if (message.type === 'join') {
      const role = ROLES.includes(message.role) ? message.role : '';
      if (role && [...this.players.values()].some((item) => item.id !== id && item.role === role)) { this.send(id, { type: 'error', message: `الدور ديال ${role} خداوه لاعب آخر، اختار دور آخر.` }); return; }
      player.name = String(message.name || '').trim().slice(0, 20); player.role = role; this.broadcast();
      if (this.players.size === 3 && [...this.players.values()].every((item) => item.name && item.role)) this.startRound();
      return;
    }
    if (this.room.phase === 'verdict' && message.type === 'verdict' && player.role === 'القاضي') { this.broadcastLog(`الحكم ديال ${player.name}: «${String(message.text || '').slice(0, 180)}»`); this.nextRound(); return; }
    if (this.room.phase !== 'playing') return;
    const active = [...this.players.values()][this.room.currentTurn];
    if (!active || active.role !== player.role) return;
    if (message.text) this.broadcastLog(`${player.role} قال: «${String(message.text).slice(0, 180)}»`);
    this.room.currentTurn = (this.room.currentTurn + 1) % 3; this.broadcast();
  }

  startRound() { this.room.phase = 'playing'; this.room.currentTurn = 0; this.room.endsAt = Date.now() + 90000; this.storage.setAlarm(this.room.endsAt); this.broadcast(); }
  startVerdict() { this.room.phase = 'verdict'; this.room.currentTurn = 0; this.room.endsAt = Date.now() + 50000; this.storage.setAlarm(this.room.endsAt); this.broadcast(); }
  nextRound() { this.room.caseIndex = (this.room.caseIndex + 1) % CASES.length; this.room.session += 1; this.startRound(); }
  async alarm() { if (Date.now() < this.room.endsAt) { this.storage.setAlarm(this.room.endsAt); return; } if (this.room.phase === 'playing') this.startVerdict(); else if (this.room.phase === 'verdict') this.nextRound(); }
  state() { return { type: 'state', phase: this.room.phase, session: this.room.session, case: CASES[this.room.caseIndex], currentTurn: this.room.currentTurn, endsAt: this.room.endsAt, secondsLeft: Math.max(0, Math.ceil((this.room.endsAt - Date.now()) / 1000)), players: [...this.players.values()] }; }
  send(id, data) { this.sockets.get(id)?.send(JSON.stringify(data)); }
  broadcast() { const data = JSON.stringify(this.state()); for (const socket of this.sockets.values()) socket.send(data); }
  broadcastLog(text) { const data = JSON.stringify({ type: 'log', text }); for (const socket of this.sockets.values()) socket.send(data); }
}
