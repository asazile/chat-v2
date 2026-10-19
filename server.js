const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) {}
  return fallback;
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

let users = readJSON(USERS_FILE, {});
let messages = readJSON(MESSAGES_FILE, []);
let sessions = readJSON(SESSIONS_FILE, {});

function saveUsers() { writeJSON(USERS_FILE, users); }
function saveMessages() { writeJSON(MESSAGES_FILE, messages); }
function saveSessions() { writeJSON(SESSIONS_FILE, sessions); }

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const app = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password || !nickname) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '请填写完整信息' }));
          return;
        }
        if (users[username]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '用户名已存在' }));
          return;
        }
        users[username] = {
          username,
          password: hashPassword(password),
          nickname: nickname.trim().slice(0, 20),
          createdAt: Date.now()
        };
        saveUsers();
        const token = generateToken();
        sessions[token] = { username, createdAt: Date.now() };
        saveSessions();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: users[username].nickname } }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '服务器错误' }));
      }
    });
    return;
  }

  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== hashPassword(password)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '用户名或密码错误' }));
          return;
        }
        const token = generateToken();
        sessions[token] = { username, createdAt: Date.now() };
        saveSessions();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: user.nickname } }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '服务器错误' }));
      }
    });
    return;
  }

  if (req.url === '/api/logout' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (token && sessions[token]) {
          delete sessions[token];
          saveSessions();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  if (req.url === '/api/messages' && req.method === 'GET') {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.replace('Bearer ', '');
    if (!token || !sessions[token]) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: '未授权' }));
      return;
    }
    const limit = parseInt(req.headers['x-msg-limit']) || 100;
    const recentMessages = messages.slice(-limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, messages: recentMessages }));
    return;
  }

  if (req.url === '/api/user' && req.method === 'GET') {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.replace('Bearer ', '');
    if (!token || !sessions[token]) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false }));
      return;
    }
    const session = sessions[token];
    const user = users[session.username];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, user: { username: user.username, nickname: user.nickname } }));
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: app });

const clients = new Map();

wss.on('connection', (ws, req) => {
  ws.authenticated = false;
  ws.user = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'auth' && msg.token) {
      const session = sessions[msg.token];
      if (!session) {
        ws.send(JSON.stringify({ type: 'auth-fail', text: '认证失败，请重新登录' }));
        ws.close();
        return;
      }
      const user = users[session.username];
      ws.authenticated = true;
      ws.user = user;
      ws.token = msg.token;

      clients.set(ws, {
        username: user.username,
        nickname: user.nickname,
        name: user.nickname
      });

      broadcast({
        type: 'system',
        text: `${user.nickname} 加入了房间（当前 ${clients.size} 人在线）`,
        online: clients.size,
      });

      const recentMessages = messages.slice(-50);
      ws.send(JSON.stringify({ type: 'auth-ok', user: { username: user.username, nickname: user.nickname }, messages: recentMessages }));
      ws.send(JSON.stringify({ type: 'system', text: `欢迎回来，${user.nickname}！`, online: clients.size }));
      return;
    }

    if (!ws.authenticated) {
      ws.send(JSON.stringify({ type: 'error', text: '请先登录' }));
      ws.close();
      return;
    }

    if (msg.type === 'rename' && typeof msg.name === 'string') {
      const next = msg.name.trim().slice(0, 20);
      if (!next) return;
      const old = ws.user.nickname;
      ws.user.nickname = next;
      if (ws.token && sessions[ws.token]) {
        sessions[ws.token] = { ...sessions[ws.token], nickname: next };
      }
      users[ws.user.username].nickname = next;
      saveUsers();
      clients.set(ws, { ...clients.get(ws), name: next, nickname: next });
      broadcast({ type: 'system', text: `${old} 改名为 ${next}`, online: clients.size });
      ws.send(JSON.stringify({ type: 'rename-ok', name: next }));
      return;
    }

    if (msg.type === 'message' && typeof msg.text === 'string') {
      const cleanText = msg.text.slice(0, 1000);
      const messageObj = {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        username: ws.user.username,
        name: ws.user.nickname,
        text: cleanText,
        ts: Date.now(),
        type: 'message'
      };
      messages.push(messageObj);
      saveMessages();
      broadcast({ type: 'message', name: ws.user.nickname, text: cleanText, ts: messageObj.ts, id: messageObj.id });
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta && ws.authenticated) {
      broadcast({
        type: 'system',
        text: `${meta.name} 离开了房间（当前 ${clients.size} 人在线）`,
        online: clients.size
      });
    }
  });

  ws.on('error', () => {
    clients.delete(ws);
  });

  function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const client of clients.keys()) {
      if (client.readyState === ws.OPEN) client.send(data);
    }
  }
});

app.listen(PORT, () => {
  console.log(`quick-chat listening on http://localhost:${PORT}`);
});