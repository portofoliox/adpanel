// panel.js
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
const PUBLIC_DIR = path.join(__dirname, "public");
const DASHBOARD_CSS = path.join(PUBLIC_DIR, "dashboard.css");
const STYLE_CSS = path.join(PUBLIC_DIR, "style.css");
const CONFIG_FILE = path.join(__dirname, "config.json");

const upload = multer({ dest: "uploads/" });
const nodeVersions = ["14", "16", "18", "20"];

[BOTS_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USERS_FILE = path.join(__dirname, "user.json");

/* -------------------- helpers: users.json (array) -------------------- */

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) return [parsed];
    return [];
  } catch (e) {
    console.warn("Failed to parse users file, returning empty array", e);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Failed to save users:", e);
    return false;
  }
}

function findUserByEmail(email) {
  if (!email) return null;
  const users = loadUsers();
  return users.find((u) => String(u.email).toLowerCase() === String(email).toLowerCase()) || null;
}

function updateUser(updatedUser) {
  const users = loadUsers();
  const idx = users.findIndex((u) => String(u.email).toLowerCase() === String(updatedUser.email).toLowerCase());
  if (idx === -1) {
    users.push(updatedUser);
  } else {
    users[idx] = updatedUser;
  }
  return saveUsers(users);
}

/* -------------------- express / view setup -------------------- */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "25mb" })); // allow big dataurls if user uploads as base64
app.use(session({ secret: "adpanel", resave: false, saveUninitialized: true }));

function isAuthenticated(req) {
  if (!req.session || !req.session.user) return false;
  const u = findUserByEmail(req.session.user);
  return !!u;
}

function isAdmin(req) {
  const u = req.session && req.session.user ? findUserByEmail(req.session.user) : null;
  return !!(u && u.admin);
}

/* -------------------- Auth routes -------------------- */

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.get("/register", (req, res) => {
  const secret = speakeasy.generateSecret({ length: 20 });
  req.session.secret = secret.base32;
  res.render("register", { secret: req.session.secret });
});

app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { error: null, success: null });
});

app.post("/register", (req, res) => {
  const { email, password, code } = req.body;
  if (!email || !password || !code || !req.session.secret) {
    return res.status(400).send("Complete all boxes.");
  }

  const existing = findUserByEmail(email);
  if (existing) {
    return res.redirect("/login");
  }

  const verified = speakeasy.totp.verify({
    secret: req.session.secret,
    encoding: "base32",
    token: code,
    window: 2
  });

  if (!verified) return res.status(400).send("Invalid 2FA code.");

  const hashed = bcrypt.hashSync(password, 10);
  const newUser = {
    email,
    password: hashed,
    secret: req.session.secret,
    admin: true
  };

  const users = loadUsers();
  users.push(newUser);
  saveUsers(users);

  delete req.session.secret;
  return res.redirect("/login");
});

app.post("/login", (req, res) => {
  const { email, password, code } = req.body;
  const user = findUserByEmail(email);
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).send("Email or password incorrect.");
  }
  const verified = speakeasy.totp.verify({
    secret: user.secret,
    encoding: "base32",
    token: code,
  });
  if (!verified) return res.status(400).send("Invalid 2FA code.");
  req.session.user = user.email;
  res.redirect("/");
});

app.post("/forgot-password", (req, res) => {
  const { email, newPassword } = req.body;
  const user = findUserByEmail(email);
  if (!user) return res.status(400).send("Email not found.");
  if (!newPassword || newPassword.length < 4) return res.status(400).send("New password invalid or too short.");
  user.password = bcrypt.hashSync(newPassword, 10);
  updateUser(user);
  res.send("Password has been reset. Please log in with the new password.");
});

/* allow unauthenticated access to login/register/forgot-password */
app.use((req, res, next) => {
  if (
    req.path.startsWith("/login") ||
    req.path.startsWith("/register") ||
    req.path.startsWith("/forgot-password")
  ) return next();
  if (!isAuthenticated(req)) return res.redirect("/login");
  next();
});

/* -------------------- Index and Settings -------------------- */

app.get("/", (req, res) => {
  const bots = fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR) : [];
  // pass isAdmin and a sanitized user object (email + admin) to the template
  const userObj = req.session && req.session.user ? findUserByEmail(req.session.user) : null;
  const safeUser = userObj ? { email: userObj.email, admin: !!userObj.admin } : null;
  res.render("index", { bots, isAdmin: safeUser ? safeUser.admin : false, user: safeUser });
});

// Only allow admins to access /settings
app.get("/settings", (req, res) => {
  if (!isAdmin(req)) {
    // redirect to index if not admin
    return res.redirect("/");
  }
  const user = findUserByEmail(req.session.user);
  res.render("settings", { user });
});

/* -------------------- Background CSS updater -------------------- */

function makeCssBackground(value, type) {
  if (!value) return null;
  if (type === "color") {
    return `${value}`;
  } else {
    const escaped = String(value).replace(/"/g, '\\"');
    return `url("${escaped}") center/cover no-repeat`;
  }
}

function setBodyBackgroundInFile(filePath, cssBackgroundValue) {
  try {
    let content = "";
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, "utf8");
    } else {
      content = "";
    }

    const bodyBlockRe = /body\s*{[^}]*}/s;
    const hasBody = bodyBlockRe.test(content);

    const bgDeclaration = (cssBackgroundValue || "").trim();
    let newContent;
    if (hasBody) {
      newContent = content.replace(bodyBlockRe, (block) => {
        if (/background(-image)?\s*:/i.test(block)) {
          block = block.replace(/background(-image)?\s*:[^;}]*(;?)/ig, `background: ${bgDeclaration};`);
          return block;
        } else {
          return block.replace(/\{\s*/, `{ \n  background: ${bgDeclaration};\n  `);
        }
      });
    } else {
      const block = `body { background: ${bgDeclaration}; }\n\n`;
      newContent = block + content;
    }

    fs.writeFileSync(filePath, newContent, "utf8");
    return true;
  } catch (err) {
    console.error("Failed to write CSS file", filePath, err);
    return false;
  }
}

app.post("/api/settings/background", (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "not authenticated" });

  const { type, value } = req.body;
  if (!type || typeof value === "undefined") return res.status(400).json({ error: "missing type/value" });

  const cssVal = makeCssBackground(value, type);
  if (!cssVal) return res.status(400).json({ error: "invalid background value" });

  const ok1 = setBodyBackgroundInFile(DASHBOARD_CSS, cssVal);
  const ok2 = setBodyBackgroundInFile(STYLE_CSS, cssVal);

  if (ok1 && ok2) {
    return res.json({ ok: true });
  } else {
    return res.status(500).json({ error: "failed to update files" });
  }
});

/* -------------------- Change password (multi-user) -------------------- */

app.post("/api/settings/change-password", (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "not authenticated" });

  const { current, newPassword, confirm } = req.body;
  if (!current || !newPassword || !confirm) return res.status(400).json({ error: "missing fields" });
  if (typeof newPassword !== "string" || newPassword.length < 8) return res.status(400).json({ error: "new password too short" });
  if (newPassword !== confirm) return res.status(400).json({ error: "Passwords do not match" });

  const userEmail = req.session.user;
  const user = findUserByEmail(userEmail);
  if (!user || !user.password) return res.status(500).json({ error: "user not found" });

  const currentMatches = bcrypt.compareSync(current, user.password);
  if (!currentMatches) return res.status(400).json({ error: "Current password incorrect" });

  const newSameAsCurrent = bcrypt.compareSync(newPassword, user.password);
  if (newSameAsCurrent) return res.status(400).json({ error: "New password is the same as current password" });

  try {
    const hashed = bcrypt.hashSync(newPassword, 10);
    user.password = hashed;
    const ok = updateUser(user);
    if (!ok) {
      return res.status(500).json({ error: "failed to save user" });
    }

    // remove 'password' from config.json if present (best-effort)
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        const cfg = JSON.parse(raw);
        if (cfg && Object.prototype.hasOwnProperty.call(cfg, "password")) {
          delete cfg.password;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
        }
      }
    } catch (cfgErr) {
      console.warn("Failed to update config file (non-fatal):", cfgErr);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("Failed to change password", e);
    return res.status(500).json({ error: "failed to update password" });
  }
});

/* -------------------- Upload / bots / process / sockets -------------------- */

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

    const src = findRoot(temp) || temp;
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

/* Process management and websockets */

const LOG_BUFFER_SIZE = 500;
const buffers = {};
function initBuffer(bot) { if (!buffers[bot]) buffers[bot] = []; }
function pushBuffer(bot, line) {
  initBuffer(bot);
  const buf = buffers[bot];
  buf.push(line);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
}

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
      socket.emit("output", "Procesul nu rulează sau nu poate primi comenzi.\n");
    }
  });
});

http.listen(3000, () => {
  console.log("ADPanel running on http://localhost:3000");
});
