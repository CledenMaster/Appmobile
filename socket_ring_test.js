/*
 * Test E2E de la sonnerie d'appel Socket.IO :
 * 1. login client + login d'un client tiers (sans rapport avec le ticket)
 * 2. création d'un technicien, ticket + acceptation → membres du ticket
 * 3. POSITIF  : client émet call-user → le technicien reçoit incoming-call (membership OK)
 * 4. NÉGATIF  : call-user vers un utilisateur hors ticket → aucun relais (membership KO)
 */
const BASE = 'http://localhost:4000';
const { io } = require('socket.io-client');

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error("timeout 'authenticated'")), 5000);
    s.on('authenticated', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    s.emit('authenticate', token);
  });
}

function waitFor(socket, event, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeout);
    const handler = (payload) => {
      if (pred && !pred(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

(async () => {
  const stamp = Date.now();

  // 1. comptes
  const client = await api('/auth/login', {
    method: 'POST',
    body: { email: 'client17875@test.fr', mot_de_passe: 'Passw0rd!' },
  });
  const outsider = await api('/auth/login', {
    method: 'POST',
    body: { email: 'client12514@test.fr', mot_de_passe: 'Passw0rd!' },
  });
  const tech = await api('/auth/register', {
    method: 'POST',
    body: {
      nom: 'Tech Ring',
      email: `tech_ring_${stamp}@test.fr`,
      mot_de_passe: 'Passw0rd!',
      role: 'technicien',
    },
  });
  const idC = client.user.id;
  const tokenC = client.token;
  const idX = outsider.user.id;
  const tokenX = outsider.token;
  const idT = tech.user.id;
  const tokenT = tech.token;

  // 2. ticket du client (existant en attente, sinon créé) puis accepté par le technicien
  const tickets = await api('/api/tickets', { token: tokenC });
  let ticket = (tickets || []).find((t) => t.status === 'en_attente');
  if (!ticket) {
    ticket = await api('/api/tickets', {
      method: 'POST',
      token: tokenC,
      body: { categorie: 'reseau', description: 'Test sonnerie E2E' },
    });
  }
  const ticketId = ticket.id;
  await api(`/api/tickets/${ticketId}/accept`, { method: 'POST', token: tokenT });

  // 3. sockets authentifiées (les rooms user-<id> sont jointes côté serveur)
  const sockC = await connectSocket(tokenC);
  const sockT = await connectSocket(tokenT);

  // 4. POSITIF : le technicien (membre du ticket) reçoit l'appel
  const positive = waitFor(sockT, 'incoming-call', (p) => p.callerId === idC);
  sockC.emit('call-user', { targetUserId: idT, callType: 'video', ticketId });
  const got = await positive;
  if (!got) {
    console.log('RESULTAT: KO - incoming-call non reçu par le technicien (relais ou membership)');
    process.exit(1);
  }
  if (got.callType !== 'video' || Number(got.ticketId) !== Number(ticketId)) {
    console.log(`RESULTAT: KO - payload incorrect: ${JSON.stringify(got)}`);
    process.exit(1);
  }

  // 5. NÉGATIF : un client hors ticket ne reçoit aucun relais
  const sockX = await connectSocket(tokenX);
  const negative = waitFor(sockX, 'incoming-call', null, 2000);
  sockC.emit('call-user', { targetUserId: idX, callType: 'audio', ticketId });
  const leak = await negative;
  if (leak) {
    console.log(`RESULTAT: KO - fuite vers un utilisateur hors ticket: ${JSON.stringify(leak)}`);
    process.exit(1);
  }

  sockC.close();
  sockT.close();
  sockX.close();
  console.log(`RESULTAT: OK - sonnerie relayée (ticket ${ticketId}) et membership respectée`);
  process.exit(0);
})().catch((e) => {
  console.log(`RESULTAT: ERREUR - ${e.message}`);
  process.exit(1);
});
