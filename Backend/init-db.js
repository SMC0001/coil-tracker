// init-db.js
import fs from "fs";
import Database from "better-sqlite3";

// Ensure data folder exists
if (!fs.existsSync("data")) {
  fs.mkdirSync("data");
}

const db = new Database("data/tracker.db");

// Read schema.sql and execute
const schema = fs.readFileSync("schema.sql", "utf8");
db.exec(schema);

console.log("✅ Database initialized at data/tracker.db");
