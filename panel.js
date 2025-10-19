// panel.js (complete) - with user-access auto-sync on startup
const express = require("express");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const multer = require("multer");
const { spawn } = require("child_process");
const session = require("express-session");
const bcrypt = require("bcrypt");
const speakeasy = require("speakeasy");
const tar = require("tar");

const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

const BOTS_DIR = path.join(__dirname, "bots");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const DASHBOARD_CSS = path.join(PUBLIC_DIR, "dashboard.css");
const STYLE_CSS = path.join(PUBLIC_DIR, "style.css");
const CONFIG_FILE = path.join(__dirname, "config.json");

const USER_ACCESS_FILE = path.join(__dirname, "user-access.json");

const upload = multer({ dest: UPLOADS_DIR });
const nodeVersions = ["14", "16", "18", "20"];

[BOTS_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USERS_FILE = path.join(__dirname, "user.json");

/* -------------------- Ensure user-access.json exists (non-destructive) -------------------- */
try {
  if (!fs.existsSync(USER_ACCESS_FILE)) {
    const defaultAccess = [];
    fs.writeFileSync(USER_ACCESS_FILE, JSON.stringify(defaultAccess, null, 2), "utf8");
    console.log("[user-access] Created default user-access.json");
  }
} catch (e) {
  console.warn("[user-access] Could not create default file:", e && e.message);
}

/* -------------------- Rate limiter (security.json) -------------------- */
const SECURITY_FILE = path.join(__dirname, "security.json");

// Default security config
let security = {
  rate_limiting: false,
  limit: 5,
  window_seconds: 120,
};

try {
  if (!fs.existsSync(SECURITY_FILE)) {
    fs.writeFileSync(SECURITY_FILE, JSON.stringify(security, null, 2), "utf8");
    console.log("[rate-limiter] Created default security.json");
  } else {
    try {
      const raw = fs.readFileSync(SECURITY_FILE, "utf8");
      const parsed = JSON.parse(raw);
      security = Object.assign(security, parsed || {});
      console.log("[rate-limiter] Loaded security.json:", security);
    } catch (e) {
      console.warn("[rate-limiter] Failed to parse existing security.json, using defaults:", e && e.message);
    }
  }
} catch (err) {
  console.error("[rate-limiter] Error ensuring security.json:", err);
}

try {
  fs.watch(SECURITY_FILE, (evtType) => {
    if (evtType === "change" || evtType === "rename") {
      try {
        const raw = fs.readFileSync(SECURITY_FILE, "utf8");
        const parsed = JSON.parse(raw);
        security = Object.assign(security, parsed || {});
        console.log("[rate-limiter] security.json reloaded:", security);
      } catch (e) {
        console.warn("[rate-limiter] Failed to reload security.json:", e && e.message);
      }
    }
  });
} catch (e) {
  console.warn("[rate-limiter] fs.watch failed or not available:", e && e.message);
}

const rateRequests = new Map();

function rateLimiterMiddleware(req, res, next) {
  try {
    if (!security || security.rate_limiting !== true) return next();

    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : (req.ip || req.connection.remoteAddress || "unknown");

    const now = Date.now();
    const windowMs = (security.window_seconds || 120) * 1000;
    const limit = security.limit || 5;

    let arr = rateRequests.get(ip) || [];

    arr = arr.filter(ts => (now - ts) <= windowMs);

    if (arr.length >= limit) {
      const oldest = arr[0] || now;
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).send("429 Too Many Requests - Access temporarily blocked by rate limiter. If you're an admin, you can disable that setting false in security.json.");
    }

    arr.push(now);
    rateRequests.set(ip, arr);

    return next();
  } catch (e) {
    console.warn("[rate-limiter] middleware error:", e && e.message);
    return next();
  }
}

setInterval(() => {
  try {
    const now = Date.now();
    const windowMs = (security.window_seconds || 120) * 1000;
    for (const [ip, arr] of rateRequests.entries()) {
      const kept = arr.filter(ts => (now - ts) <= windowMs);
      if (kept.length > 0) rateRequests.set(ip, kept);
      else rateRequests.delete(ip);
    }
  } catch (e) {
    console.warn("[rate-limiter] cleanup error:", e && e.message);
  }
}, 30_000);

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

/* -------------------- helpers: user-access.json -------------------- */

function loadUserAccess() {
  try {
    if (!fs.existsSync(USER_ACCESS_FILE)) return [];
    const raw = fs.readFileSync(USER_ACCESS_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[user-access] failed to read/parse user-access.json:", e && e.message);
    return [];
  }
}

function saveUserAccess(arr) {
  try {
    fs.writeFileSync(USER_ACCESS_FILE, JSON.stringify(Array.isArray(arr) ? arr : [], null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("[user-access] failed to write user-access.json:", e && e.message);
    return false;
  }
}

function getAccessListForEmail(email) {
  if (!email) return [];
  const arr = loadUserAccess();
  const record = arr.find(r => String(r.email).toLowerCase() === String(email).toLowerCase());
  if (!record) return [];
  return Array.isArray(record.servers) ? record.servers : [];
}

function setAccessListForEmail(email, servers) {
  if (!email) return false;
  const arr = loadUserAccess();
  const idx = arr.findIndex(r => String(r.email).toLowerCase() === String(email).toLowerCase());
  if (idx === -1) {
    arr.push({ email, servers: Array.isArray(servers) ? servers : [] });
  } else {
    arr[idx].servers = Array.isArray(servers) ? servers : [];
  }
  return saveUserAccess(arr);
}

function addAccessForEmail(email, server) {
  if (!email || !server) return false;
  const arr = loadUserAccess();
  let rec = arr.find(r => String(r.email).toLowerCase() === String(email).toLowerCase());
  if (!rec) {
    rec = { email, servers: [server] };
    arr.push(rec);
    return saveUserAccess(arr);
  }
  if (!Array.isArray(rec.servers)) rec.servers = [];
  if (!rec.servers.includes(server)) rec.servers.push(server);
  return saveUserAccess(arr);
}

function removeAccessForEmail(email, server) {
  if (!email || !server) return false;
  const arr = loadUserAccess();
  const rec = arr.find(r => String(r.email).toLowerCase() === String(email).toLowerCase());
  if (!rec) return saveUserAccess(arr);
  if (!Array.isArray(rec.servers)) rec.servers = [];
  rec.servers = rec.servers.filter(s => s !== server);
  return saveUserAccess(arr);
}

function userHasAccessToServer(email, botName) {
  if (!email) return false;
  const u = findUserByEmail(email);
  if (u && u.admin) return true;
  const access = getAccessListForEmail(email);
  if (!access || access.length === 0) return false;
  if (access.includes("all")) return true;
  return access.includes(botName);
}

/* -------------------- Sync user.json -> user-access.json on startup -------------------- */

/**
 * Reads all emails from user.json and ensures each email exists in user-access.json.
 * If an email missing, adds { email, servers: [] }.
 * Does not modify existing records or servers arrays.
 */
function syncUserAccessWithUsers() {
  try {
    const users = loadUsers(); // array of user objects with .email
    if (!Array.isArray(users) || users.length === 0) {
      console.log("[user-access] No users found in user.json to sync.");
      return;
    }

    const access = loadUserAccess(); // existing records
    const lowerSet = new Set(access.map(r => String(r.email).toLowerCase()));

    let added = 0;
    users.forEach(u => {
      const email = u && u.email ? String(u.email).trim() : null;
      if (!email) return;
      const lower = email.toLowerCase();
      if (!lowerSet.has(lower)) {
        // add a new entry with empty servers array
        access.push({ email, servers: [] });
        lowerSet.add(lower);
        added++;
      }
    });

    if (added > 0) {
      const ok = saveUserAccess(access);
      if (ok) {
        console.log(`[user-access] Synced users -> user-access.json: added ${added} entries.`);
      } else {
        console.warn("[user-access] Failed to save user-access.json after sync.");
      }
    } else {
      console.log("[user-access] user-access.json already contains all users from user.json.");
    }
  } catch (e) {
    console.error("[user-access] sync failed:", e && e.message);
  }
}

// perform initial sync at startup (after ensuring file exists)
syncUserAccessWithUsers();

/* -------------------- express / view setup -------------------- */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(session({ secret: "adpanel", resave: false, saveUninitialized: true }));

app.set("trust proxy", true);

app.use(rateLimiterMiddleware);

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

app.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to logout' });
      }
      res.clearCookie('connect.sid');
      return res.json({ success: true });
    });
  } else {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  }
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
  const allBots = fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR) : [];
  const userObj = req.session && req.session.user ? findUserByEmail(req.session.user) : null;
  const safeUser = userObj ? { email: userObj.email, admin: !!userObj.admin } : null;

  let botsToShow = [];
  if (safeUser && safeUser.admin) {
    botsToShow = allBots.filter(n => {
      try {
        return fs.statSync(path.join(BOTS_DIR, n)).isDirectory();
      } catch (e) {
        return false;
      }
    });
  } else {
    const access = getAccessListForEmail(req.session.user);
    if (access && access.includes("all")) {
      botsToShow = allBots.filter(n => {
        try {
          return fs.statSync(path.join(BOTS_DIR, n)).isDirectory();
        } catch (e) {
          return false;
        }
      });
    } else {
      botsToShow = allBots.filter(n => {
        try {
          if (!fs.statSync(path.join(BOTS_DIR, n)).isDirectory()) return false;
          if (!access || access.length === 0) return false;
          return access.includes(n);
        } catch (e) {
          return false;
        }
      });
    }
  }

  res.render("index", { bots: botsToShow, isAdmin: safeUser ? safeUser.admin : false, user: safeUser });
});

app.get("/settings", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/");
  const user = findUserByEmail(req.session.user);
  res.render("settings", { user });
});

app.get("/settings/servers", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/");
  res.render("server", { user: findUserByEmail(req.session.user) });
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

/* -------------------- Servers API (for settings UI) -------------------- */

app.get("/api/settings/servers", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "not authorized" });
  try {
    if (!fs.existsSync(BOTS_DIR)) return res.json({ names: [] });
    const entries = fs.readdirSync(BOTS_DIR, { withFileTypes: true });
    const names = entries.filter(e => e.isDirectory()).map(d => d.name);
    return res.json({ names });
  } catch (e) {
    console.error("Failed to list servers:", e);
    return res.status(500).json({ error: "failed to read servers" });
  }
});

/**
 * GET /api/my-servers
 * Returns JSON { names: [<folder names>] } for the current user (non-admin users)
 */
app.get("/api/my-servers", (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "not authenticated" });
  try {
    const all = fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR, { withFileTypes: true }) : [];
    const dirNames = all.filter(e => e.isDirectory()).map(d => d.name);

    const userEmail = req.session.user;
    const u = findUserByEmail(userEmail);
    if (u && u.admin) {
      return res.json({ names: dirNames });
    }

    const access = getAccessListForEmail(userEmail) || [];
    let names = [];
    if (access.includes("all")) {
      names = dirNames;
    } else {
      names = dirNames.filter(n => access.includes(n));
    }
    return res.json({ names });
  } catch (e) {
    console.error("Failed to list my-servers:", e);
    return res.status(500).json({ error: "failed to read servers" });
  }
});

/* -------------------- Accounts API (admin-only) -------------------- */
/**
 * GET /api/settings/accounts
 * Returns { accounts: [ { email, servers } ], bots: [<all bot folders>] }
 * Admin-only. Admin users (those with admin:true in user.json) are excluded from the returned accounts list.
 */
app.get("/api/settings/accounts", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "not authorized" });
  try {
    const accountsRaw = loadUserAccess(); // array of { email, servers }
    const users = loadUsers(); // to check admin flags
    const adminEmails = users.filter(u => u && u.admin).map(u => String(u.email).toLowerCase());

    const accounts = Array.isArray(accountsRaw) ? accountsRaw.map(a => ({
      email: a.email,
      servers: Array.isArray(a.servers) ? a.servers : []
    })) : [];

    // exclude admin emails from the list (as requested)
    const filtered = accounts.filter(a => !adminEmails.includes(String(a.email).toLowerCase()));

    // list all bot folders
    const allBots = fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(d => d.name) : [];

    return res.json({ accounts: filtered, bots: allBots });
  } catch (e) {
    console.error("Failed to read accounts:", e);
    return res.status(500).json({ error: "failed to read accounts" });
  }
});

/**
 * POST /api/settings/accounts/:email/add
 * body: { server: "<serverName>" }
 * Admin-only. Adds server to user's access list (creates record if missing).
 */
app.post("/api/settings/accounts/:email/add", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "not authorized" });
  const encoded = req.params.email || "";
  let email;
  try { email = decodeURIComponent(encoded); } catch (e) { email = encoded; }
  const server = req.body && req.body.server ? String(req.body.server) : "";
  if (!email || !server) return res.status(400).json({ error: "missing email or server" });

  const allBots = fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(d => d.name) : [];
  if (!allBots.includes(server) && server !== "all") {
    return res.status(400).json({ error: "server not found" });
  }

  try {
    const ok = addAccessForEmail(email, server);
    if (!ok) return res.status(500).json({ error: "failed to save access" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("Failed to add access:", e);
    return res.status(500).json({ error: "failed to add access" });
  }
});

/**
 * POST /api/settings/accounts/:email/remove
 * body: { server: "<serverName>" }
 * Admin-only. Removes server from user's access list.
 */
app.post("/api/settings/accounts/:email/remove", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "not authorized" });
  const encoded = req.params.email || "";
  let email;
  try { email = decodeURIComponent(encoded); } catch (e) { email = encoded; }
  const server = req.body && req.body.server ? String(req.body.server) : "";
  if (!email || !server) return res.status(400).json({ error: "missing email or server" });

  try {
    const ok = removeAccessForEmail(email, server);
    if (!ok) return res.status(500).json({ error: "failed to save access" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("Failed to remove access:", e);
    return res.status(500).json({ error: "failed to remove access" });
  }
});

/* -------------------- Create / Rename / Explore ... -------------------- */

app.post("/create", (req, res) => {
  const { bot, type, name, path: relPath } = req.body || {};
  if (!bot || !type || !name) return res.status(400).send("Missing fields");
  const safeName = String(name).trim();
  if (safeName === "" || safeName.includes("..") || safeName.includes("/") || safeName.includes("\\")) {
    return res.status(400).send("Invalid name");
  }
  if (type !== "file" && type !== "folder") return res.status(400).send("Invalid type");

  const base = path.resolve(BOTS_DIR);
  const destDir = relPath ? path.join(BOTS_DIR, bot, relPath) : path.join(BOTS_DIR, bot);
  const resolvedDestDir = path.resolve(destDir);
  if (!resolvedDestDir.startsWith(base + path.sep) && resolvedDestDir !== base) {
    return res.status(400).send("Invalid path");
  }

  try {
    fs.mkdirSync(resolvedDestDir, { recursive: true });
    if (type === "folder") {
      const folderPath = path.join(resolvedDestDir, safeName);
      const resolvedFolder = path.resolve(folderPath);
      if (!resolvedFolder.startsWith(base + path.sep)) return res.status(400).send("Invalid folder path");
      if (!fs.existsSync(resolvedFolder)) fs.mkdirSync(resolvedFolder, { recursive: true });
      return res.status(200).send("Folder created");
    } else {
      const filePath = path.join(resolvedDestDir, safeName);
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.startsWith(base + path.sep)) return res.status(400).send("Invalid file path");
      if (!fs.existsSync(resolvedFile)) fs.writeFileSync(resolvedFile, "", "utf8");
      return res.status(200).send("File created");
    }
  } catch (e) {
    console.error("Create failed:", e);
    return res.status(500).send("Error creating " + type);
  }
});

app.post("/rename", (req, res) => {
  const { bot, oldPath, newName } = req.body || {};
  if (!bot || !oldPath || !newName) return res.status(400).send("Missing fields");
  const safeNewName = String(newName).trim();
  if (safeNewName === "" || safeNewName.includes("..") || safeNewName.includes("/") || safeNewName.includes("\\")) {
    return res.status(400).send("Invalid new name");
  }
  const base = path.resolve(BOTS_DIR);
  const oldFull = path.resolve(path.join(BOTS_DIR, bot, oldPath));
  if (!oldFull.startsWith(base + path.sep) && oldFull !== base) return res.status(400).send("Invalid path");
  if (!fs.existsSync(oldFull)) return res.status(404).send("Not found");

  const dir = path.dirname(oldFull);
  const newFull = path.resolve(path.join(dir, safeNewName));
  if (!newFull.startsWith(base + path.sep)) return res.status(400).send("Invalid new path");

  try {
    fs.renameSync(oldFull, newFull);
    return res.status(200).send("Renamed");
  } catch (e) {
    console.error("Rename failed:", e);
    return res.status(500).send("Rename failed");
  }
});

app.get("/bot/:bot", (req, res) => {
  const botName = req.params.bot;
  const botDir = path.join(BOTS_DIR, botName);
  if (!fs.existsSync(botDir)) return res.redirect("/");

  if (!isAdmin(req)) {
    if (!userHasAccessToServer(req.session.user, botName)) return res.redirect("/");
  }

  res.render("bot", {
    bot: botName,
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

/* -------------------- Sockets & Processes -------------------- */

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
