import Database from "better-sqlite3";
import bcrypt from "bcrypt";

const db = new Database("./data/tracker.db");

// user details
const username = "admin";
const plainPassword = "Admin@123";
const role = "admin";

// hash the password
const password_hash = bcrypt.hashSync(plainPassword, 10);

// insert into users table
db.prepare(
  "INSERT OR REPLACE INTO users(username, password_hash, role) VALUES (?,?,?)"
).run(username, password_hash, role);

console.log(`✅ Admin user created: ${username} / ${plainPassword}`);
