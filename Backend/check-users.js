import Database from "better-sqlite3";

const db = new Database("./data/tracker.db");

const users = db.prepare("SELECT username, role FROM users").all();

console.log("Existing users:", users);
