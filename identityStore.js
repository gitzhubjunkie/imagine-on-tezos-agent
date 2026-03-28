const { db } = require("./db/identityDb");

async function getLastWorkForHandle(handle) {
  const row = db
    .prepare(
      `SELECT lastTokenId, mainThemes, chapterCount FROM works WHERE handle = ?`
    )
    .get(handle);

  if (!row) {
    return null;
  }

  return {
    tokenId: row.lastTokenId,
    mainThemes: JSON.parse(row.mainThemes),
    chapterCount: row.chapterCount,
  };
}

async function saveNewWorkForHandle(handle, work) {
  const mainThemesJson = JSON.stringify(work.mainThemes);

  db.prepare(
    `
    INSERT INTO works (handle, lastTokenId, mainThemes, chapterCount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET
      lastTokenId = excluded.lastTokenId,
      mainThemes  = excluded.mainThemes,
      chapterCount = excluded.chapterCount
  `
  ).run(handle, Number(work.tokenId), mainThemesJson, work.chapterCount);
}

module.exports = { getLastWorkForHandle, saveNewWorkForHandle };
