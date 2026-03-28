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

module.exports = { db };
