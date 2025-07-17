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
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'secretkey123',
  resave: false,
  saveUninitialized: false,
}));

// Dummy user
const USERS = [{ username: 'admin', password: 'admin' }];

// Auth middleware
function auth(req, res, next) {
  if (req.session.user) next();
  else res.redirect('/');
}

// Serve static files (css/js etc)
app.use(express.static(path.join(__dirname, 'public')));

const SERVERS_BASE = path.join(__dirname, 'servers');
if (!fs.existsSync(SERVERS_BASE)) fs.mkdirSync(SERVERS_BASE);

// Server state
let servers = {}; // { id: {user, port, path, nodeVersion, process} }
let portsInUse = new Set();

function getFreePort() {
  for (let p = 3000; p < 4000; p++) {
    if (!portsInUse.has(p)) return p;
  }
  throw new Error('No free ports');
}

// Routes

// Login page + dashboard page served by same HTML file, frontend JS face toggle

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// API Login
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

// API Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API get user's servers
app.get('/api/servers', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const userServers = Object.entries(servers)
    .filter(([id, srv]) => srv.user === req.session.user.username)
    .map(([id, srv]) => ({
      id,
      port: srv.port,
      nodeVersion: srv.nodeVersion,
      running: !!srv.process,
    }));
  res.json(userServers);
});

// API create new server
app.post('/api/servers', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const nodeVersion = req.body.nodeVersion || 'default';
  const id = uuidv4();
  const port = getFreePort();
  const serverPath = path.join(SERVERS_BASE, id);

  fs.mkdirSync(serverPath);

  // Write minimal index.js server file
  fs.writeFileSync(path.join(serverPath, 'index.js'), `
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.end("Hello from server ${id}! (Node.js ${nodeVersion})");
    });
    server.listen(process.env.PORT || ${port});
  `);

  servers[id] = { user: req.session.user.username, port, path: serverPath, nodeVersion, process: null };
  portsInUse.add(port);

  res.json({ id, port });
});

// API start server
app.post('/api/servers/:id/start', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const id = req.params.id;
  const srv = servers[id];
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.user !== req.session.user.username) return res.status(403).json({ error: 'Forbidden' });
  if (srv.process) return res.status(400).json({ error: 'Server already running' });

  // spawn process (node index.js)
  const child = spawn('node', ['index.js'], {
    cwd: srv.path,
    env: { ...process.env, PORT: srv.port },
    shell: true,
  });

  srv.process = child;

  child.stdout.on('data', (data) => {
    console.log(`[Server ${id} stdout] ${data}`);
  });
  child.stderr.on('data', (data) => {
    console.error(`[Server ${id} stderr] ${data}`);
  });
  child.on('exit', (code) => {
    console.log(`[Server ${id}] exited with code ${code}`);
    srv.process = null;
  });

  res.json({ success: true });
});

// API stop server
app.post('/api/servers/:id/stop', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const id = req.params.id;
  const srv = servers[id];
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.user !== req.session.user.username) return res.status(403).json({ error: 'Forbidden' });
  if (!srv.process) return res.status(400).json({ error: 'Server not running' });

  srv.process.kill();
  srv.process = null;

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Panel running on http://localhost:${PORT}`);
});
