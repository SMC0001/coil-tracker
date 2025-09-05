// db.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// SSL is required by Render Postgres
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl
});

// Helper function: use this instead of raw pool.query
export const query = (text, params) => pool.query(text, params);
