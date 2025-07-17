const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const app = express();
app.use(express.json());

const SERVERS_PATH = path.join(__dirname, 'servers');
if (!fs.existsSync(SERVERS_PATH)) {
  fs.mkdirSync(SERVERS_PATH);
}

// Stocare procese pentru serverele pornite
const runningServers = {};

// Listare servere (foldere din servers/)
app.get('/api/servers', (req, res) => {
  fs.readdir(SERVERS_PATH, (err, files) => {
    if (err) return res.status(500).json({ error: 'Eroare la listarea serverelor' });

    const servers = files.filter(file => {
      return fs.statSync(path.join(SERVERS_PATH, file)).isDirectory();
    });

    res.json({ servers });
  });
});

// Creare server nou cu nume și versiune node
app.post('/api/servers', (req, res) => {
  const { name, nodeVersion } = req.body;
  if (!name || !nodeVersion) return res.status(400).json({ error: 'Lipsește name sau nodeVersion' });

  const serverDir = path.join(SERVERS_PATH, name);
  if (fs.existsSync(serverDir)) return res.status(400).json({ error: 'Server deja există' });

  fs.mkdirSync(serverDir);

  // Salvăm versiunea Node într-un fișier (poți folosi mai departe pentru a instala sau folosi nvm)
  fs.writeFileSync(path.join(serverDir, 'nodeVersion.txt'), nodeVersion);

  // Fișier index.js simplu ca demo
  const defaultIndexJs = `
    console.log('Serverul ${name} pornit cu Node.js versiunea ${nodeVersion}');
    setInterval(() => console.log('Serverul ${name} rulează...'), 5000);
  `;

  fs.writeFileSync(path.join(serverDir, 'index.js'), defaultIndexJs.trim());

  res.json({ message: 'Server creat', name, nodeVersion });
});

// Pornire server (pornește proces node index.js în folderul serverului)
app.post('/api/servers/:name/start', (req, res) => {
  const { name } = req.params;
  const serverDir = path.join(SERVERS_PATH, name);
  if (!fs.existsSync(serverDir)) return res.status(404).json({ error: 'Server inexistent' });

  if (runningServers[name]) return res.status(400).json({ error: 'Serverul este deja pornit' });

  // Citește versiunea node din fișier
  const nodeVersion = fs.readFileSync(path.join(serverDir, 'nodeVersion.txt'), 'utf8').trim();

  // Pentru simplificare, rulăm comanda node direct (fără schimbare versiune node)
  // Dacă vrei versiuni diferite, trebuie să integrezi nvm sau alte metode.
  const child = spawn('node', ['index.js'], { cwd: serverDir, detached: true });

  runningServers[name] = child;

  child.stdout.on('data', (data) => {
    console.log(`[${name} stdout]: ${data}`);
  });

  child.stderr.on('data', (data) => {
    console.error(`[${name} stderr]: ${data}`);
  });

  child.on('close', (code) => {
    console.log(`[${name}] proces încheiat cu codul ${code}`);
    delete runningServers[name];
  });

  res.json({ message: `Serverul ${name} pornit` });
});

// Oprire server
app.post('/api/servers/:name/stop', (req, res) => {
  const { name } = req.params;
  const proc = runningServers[name];
  if (!proc) return res.status(400).json({ error: 'Serverul nu este pornit' });

  process.kill(-proc.pid); // ucidem procesul și copiii (pentru Unix-like)

  delete runningServers[name];
  res.json({ message: `Serverul ${name} oprit` });
});

// File manager - listare fișiere din folderul serverului
app.get('/api/servers/:name/files', (req, res) => {
  const { name } = req.params;
  const dir = path.join(SERVERS_PATH, name);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Server inexistent' });

  fs.readdir(dir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Eroare la listarea fișierelor' });

    res.json({ files });
  });
});

// Pornim serverul panel
app.listen(2025, () => {
  console.log('ADPanel rulează la http://localhost:2025');
});
