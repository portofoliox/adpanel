const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 2025;

const users = fs.existsSync('./users.json') ? JSON.parse(fs.readFileSync('./users.json')) : {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret123',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static('public'));

app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, 'views/login.html'));
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const hash = users[username];
  if (!hash) return res.send("Utilizator inexistent.");

  bcrypt.compare(password, hash, (err, same) => {
    if (same) {
      req.session.loggedIn = true;
      req.session.user = username;
      res.redirect('/dashboard');
    } else {
      res.send("Parolă greșită.");
    }
  });
});

app.get('/dashboard', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'views/dashboard.html'));
  } else {
    res.redirect('/');
  }
});

app.listen(PORT, () => {
  console.log(`Panel pornit pe http://localhost:${PORT}`);
});
