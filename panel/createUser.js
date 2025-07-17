const fs = require('fs');
const bcrypt = require('bcrypt');
const [,, username, password] = process.argv;

if (!username || !password) {
  console.log("Utilizare: node createUser.js <user> <parola>");
  process.exit(1);
}

const usersFile = './users.json';
const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile)) : {};

if (users[username]) {
  console.log("Utilizatorul există deja.");
  process.exit(1);
}

bcrypt.hash(password, 10, (err, hash) => {
  users[username] = hash;
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  console.log(`Cont creat: ${username}`);
});
