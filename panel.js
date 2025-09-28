const express = require("express");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const multer = require("multer");
const { spawn } = require("child_process");
const session = require("express-session");
const bcrypt = require("bcrypt");
const speakeasy = require("speakeasy");

const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

const BOTS_DIR = path.join(__dirname, "bots");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const upload = multer({ dest: "uploads/" });
const nodeVersions = ["14", "16", "18", "20"];

[BOTS_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USERS_FILE = path.join(__dirname, "user.json"); // presupun că salvezi userul aici

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: "adpanel", resave: false, saveUninitialized: true }));


function loadUser() {
  if (!fs.existsSync(USERS_FILE)) return null;
  const data = fs.readFileSync(USERS_FILE);
  return JSON.parse(data);
}

function saveUser(user) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(user));
}

function isAuthenticated(req) {
  return req.session && req.session.user;
}


app.post("/register", (req, res) => {
  const { email, password, code } = req.body;

  if (!email || !password || !code || !req.session.secret) {
    return res.send("Complete all boxes.");
  }

  if (loadUser()) return res.redirect("/login");

  const verified = speakeasy.totp.verify({
    secret: req.session.secret,
    encoding: "base32",
    token: code,
    window: 2 // toleranță la diferențe de timp
  });

  if (!verified) return res.send("Cod 2FA invalid");

  const hashed = bcrypt.hashSync(password, 10);
  saveUser({ email, password: hashed, secret: req.session.secret });
  delete req.session.secret;

  res.redirect("/login");
});


app.get("/login", (req, res) => {
  res.render("login");
});

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password'); // fără .ejs
});

app.post("/login", (req, res) => {
  const { email, password, code } = req.body;
  const user = loadUser();
  if (
    !user ||
    user.email !== email ||
    !bcrypt.compareSync(password, user.password)
  ) {
    return res.send("Email sau parolă incorecte.");
  }

  const verified = speakeasy.totp.verify({
    secret: user.secret,
    encoding: "base32",
    token: code,
  });

  if (!verified) return res.send("Cod 2FA invalid");

  req.session.user = user.email;
  res.redirect("/");
});

app.use((req, res, next) => {
  if (req.path.startsWith("/login") || req.path.startsWith("/register"))
    return next();
  if (!isAuthenticated(req)) return res.redirect("/login");
  next();
});

app.use("/", require("./routes/upload"));

function findRoot(dir) {
  const entries = fs.readdirSync(dir);
  if (entries.some((f) => f.endsWith(".js") || f.endsWith(".html"))) return dir;
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      const found = findRoot(full);
      if (found) return found;
    }
  }
  return null;
}

const LOG_BUFFER_SIZE = 500;
const buffers = {};
function initBuffer(bot) {
  if (!buffers[bot]) buffers[bot] = [];
}
function pushBuffer(bot, line) {
  initBuffer(bot);
  const buf = buffers[bot];
  buf.push(line);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
}

app.get("/", (req, res) => {
  const bots = fs.readdirSync(BOTS_DIR);
  res.render("index", { bots });
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.redirect("/");
  try {
    const zip = new AdmZip(req.file.path);
    const name = path.parse(req.file.originalname).name.replace(/[^\w-]/g, "");
    const temp = path.join(UPLOADS_DIR, name);
    zip.extractAllTo(temp, true);

    function findRoot(dir) {
      const files = fs.readdirSync(dir);
      if (files.some((f) => f.endsWith(".js"))) return dir;
      for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          const r = findRoot(full);
          if (r) return r;
        }
      }
      return null;
    }

    const src = findRoot(temp);
    const dest = path.join(BOTS_DIR, name);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(src, dest);
    fs.rmSync(req.file.path, { force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  } catch (e) {
    console.error(e);
  }
  res.redirect("/");
});

app.get("/bot/:bot", (req, res) => {
  const botDir = path.join(BOTS_DIR, req.params.bot);
  if (!fs.existsSync(botDir)) return res.redirect("/");
  res.render("bot", {
    bot: req.params.bot,
    nodeVersions,
  });
});

app.get("/explore/:bot", (req, res) => {
  const bot = req.params.bot;
  const rel = req.query.path || "";
  const dir = path.join(BOTS_DIR, bot, rel);
  if (!fs.existsSync(dir)) return res.json({ error: "No such dir" });
  const entries = fs.readdirSync(dir).map((n) => {
    const full = path.join(dir, n);
    return { name: n, isDir: fs.statSync(full).isDirectory() };
  });
  res.json({ path: rel, entries });
});

const processes = {};

io.on("connection", (socket) => {
  socket.on("join", (bot) => {
    socket.join(bot);
    initBuffer(bot);
    buffers[bot].forEach((line) => socket.emit("output", line));
  });

  socket.on("readFile", ({ bot, path: rel }) => {
    const full = path.join(BOTS_DIR, bot, rel);
    const c = fs.readFileSync(full, "utf8");
    socket.emit("fileData", { path: rel, content: c });
  });

  socket.on("writeFile", ({ bot, path: rel, content }) => {
    fs.writeFileSync(path.join(BOTS_DIR, bot, rel), content);
    socket.emit("output", `Saved ${rel}\n`);
  });

  socket.on("deleteFile", ({ bot, path: rel, isDir }) => {
    fs.rmSync(path.join(BOTS_DIR, bot, rel), { recursive: isDir, force: true });
    socket.emit("output", `Deleted ${rel}\n`);
  });

  socket.on("action", (data) => {
    const { bot, cmd, file, version, port } = data;
    const cwd = path.join(BOTS_DIR, bot);

    function logAndBroadcast(chunk) {
      const str = chunk.toString();
      pushBuffer(bot, str);
      io.to(bot).emit("output", str);
    }

    if (cmd === "run") {
      if (processes[bot]) processes[bot].kill("SIGKILL");
      initBuffer(bot);
      const ext = path.extname(file);

      if (ext === ".js") {
        processes[bot] = spawn(
          "node",
          [
            "--max-old-space-size=128",
            "--optimize_for_size",
            "--gc-global",
            "--no-warnings",
            "--lazy",
            file,
          ],
          {
            cwd,
            env: { ...process.env, NODE_ENV: "production" },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } else {
        processes[bot] = spawn(
          "npx",
          ["http-server", ".", "-p", port || 3001],
          {
            cwd,
            env: { ...process.env, NODE_ENV: "production" },
          },
        );
      }

      processes[bot].stdout.on("data", logAndBroadcast);
      processes[bot].stderr.on("data", logAndBroadcast);
      processes[bot].on("exit", () => {
        delete processes[bot];
        const msg = "Bot process exited\n";
        pushBuffer(bot, msg);
        io.to(bot).emit("output", msg);
      });
    } else if (cmd === "stop") {
      if (processes[bot]) {
        try {
          const pid = processes[bot].pid;
          process.kill(pid, "SIGKILL");
          delete processes[bot];
          const msg = "Process forcefully stopped\n";
          pushBuffer(bot, msg);
          io.to(bot).emit("output", msg);
        } catch (err) {
          const msg = "Failed to stop process\n";
          pushBuffer(bot, msg);
          io.to(bot).emit("output", msg);
        }
      } else {
        io.to(bot).emit("output", "No running process to stop\n");
      }
    } else if (cmd === "install") {
      initBuffer(bot);
      const script = `wget -qO- https://deb.nodesource.com/setup_${version} | bash - && apt-get install -y nodejs`;
      const inst = spawn("bash", ["-c", script]);
      inst.stdout.on("data", logAndBroadcast);
      inst.stderr.on("data", logAndBroadcast);
    }
  });

  socket.on("command", ({ bot, command }) => {
    const proc = processes[bot];
    if (proc && !proc.killed && proc.stdin.writable) {
      proc.stdin.write(command + "\n");
      pushBuffer(bot, `> ${command}\n`);
      io.to(bot).emit("output", `> ${command}\n`);
    } else {
      socket.emit(
        "output",
        "Procesul nu rulează sau nu poate primi comenzi.\n",
      );
    }
  });
});

http.listen(3000, () => {
  console.log("ADPanel running on http://localhost:3000");
});
