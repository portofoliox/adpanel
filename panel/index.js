// index.js (backend)
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 2025;

app.use(bodyParser.json());
app.use(session({
  secret: 'secretkey123',
  resave: false,
  saveUninitialized: false,
}));

// Dummy user storage (in real app pui DB)
const USERS = [{ username: 'admin', password: 'admin' }];

// Simple auth middleware
function auth(req, res, next) {
  if (req.session.user) next();
  else res.status(401).json({ error: 'Unauthorized' });
}

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (user) {
    req.session.user = { username };
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Serve static frontend (poți face foldere React build sau simplu HTML)
app.use(express.static(path.join(__dirname, 'public')));

const SERVERS_BASE = path.join(__dirname, 'servers');
if (!fs.existsSync(SERVERS_BASE)) fs.mkdirSync(SERVERS_BASE);

let servers = {}; // { serverId: {user, port, path, nodeVersion, process} }
let portsInUse = new Set();

function getFreePort() {
  for (let p = 3000; p < 4000; p++) {
    if (!portsInUse.has(p)) return p;
  }
  throw new Error('No free ports');
}

// API: list servere ale userului
app.get('/api/servers', auth, (req, res) => {
  const userServers = Object.entries(servers)
    .filter(([id, srv]) => srv.user === req.session.user.username)
    .map(([id, srv]) => ({ id, port: srv.port, nodeVersion: srv.nodeVersion, running: !!srv.process }));
  res.json(userServers);
});

// API: creează server nou
app.post('/api/servers', auth, (req, res) => {
  const { nodeVersion } = req.body;
  const id = uuidv4();
  const port = getFreePort();
  const serverPath = path.join(SERVERS_BASE, id);
  fs.mkdirSync(serverPath);

  // Creezi fișier minimal index.js
  fs.writeFileSync(path.join(serverPath, 'index.js'), `
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.end("Hello from server ${id}!");
    });
    server.listen(process.env.PORT || ${port});
  `);

  servers[id] = { user: req.session.user.username, port, path: serverPath, nodeVersion: nodeVersion || 'default', process: null };
  portsInUse.add(port);

  res.json({ id, port });
});

// API: start server
app.post('/api/servers/:id/start', auth, (req, res) => {
  const id = req.params.id;
  const srv = servers[id];
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.user !== req.session.user.username) return res.status(403).json({ error: 'Forbidden' });
  if (srv.process) return res.status(400).json({ error: 'Already running' });

  // Dacă ai nvm configurat, poți rula cu nvm exec <versiune> node
  const child = spawn('node', ['index.js'], {
    cwd: srv.path,
    env: { ...process.env, PORT: srv.port },
    shell: true,
  });

  srv.process = child;
  child.stdout.on('data', d => console.log(`srv ${id}: ${d}`));
  child.stderr.on('data', d => console.error(`srv ${id}: ${d}`));
  child.on('exit', () => {
    srv.process = null;
  });

  res.json({ message: 'Server started' });
});

// API: stop server
app.post('/api/servers/:id/stop', auth, (req, res) => {
  const id = req.params.id;
  const srv = servers[id];
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.user !== req.session.user.username) return res.status(403).json({ error: 'Forbidden' });
  if (!srv.process) return res.status(400).json({ error: 'Not running' });

  srv.process.kill();
  srv.process = null;

  res.json({ message: 'Server stopped' });
});

// TODO: Consola live + file manager APIs

app.listen(PORT, () => console.log(`Panel running on http://localhost:${PORT}`));
