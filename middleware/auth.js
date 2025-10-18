const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const speakeasy = require("speakeasy");

const USERS_FILE = path.join(__dirname, "..", "users.json");

let users = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
} catch {
  users = {};
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function authMiddleware(req, res, next) {
  if (req.path.startsWith("/register")) return next(); // permit register

  const sessionUser = req.session?.user;
  if (!sessionUser) {
    // no session, redirect to login
    return res.redirect("/login");
  }

  const user = users[sessionUser];
  if (!user) {
    // user not found, clear session and redirect to login
    req.session.destroy(() => {});
    return res.redirect("/login");
  }\

  next();
}

module.exports = { authMiddleware, users, saveUsers };
