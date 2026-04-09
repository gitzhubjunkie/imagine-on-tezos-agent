const Database = require("better-sqlite3");

const db = new Database("./identity.sqlite");

// Run once on import
db.exec(`
CREATE TABLE IF NOT EXISTS works (
  handle TEXT PRIMARY KEY,
  lastTokenId INTEGER NOT NULL,
  mainThemes TEXT NOT NULL,
  chapterCount INTEGER NOT NULL
);
`);

// Evolving identity profile — tracks archetype/sentiment drift over time
db.exec(`
CREATE TABLE IF NOT EXISTS identity_profiles (
  handle TEXT PRIMARY KEY,
  archetype TEXT,
  sentiment TEXT,
  epochState INTEGER NOT NULL DEFAULT 1,
  narrativeArc TEXT DEFAULT 'origin',
  archetypeHistory TEXT NOT NULL DEFAULT '[]',
  sentimentHistory TEXT NOT NULL DEFAULT '[]',
  resonances TEXT NOT NULL DEFAULT '[]',
  curatorStatement TEXT,
  totalMints INTEGER NOT NULL DEFAULT 0,
  totalChapters INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = { db };
