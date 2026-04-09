const { db } = require("./db/identityDb");

// ── Works (existing) ────────────────────────────────────

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

// ── Evolving identity profiles ──────────────────────────

/**
 * Get the full identity profile for a handle, including archetype history
 * and epoch state. Returns prior context suitable for curatorPanel.
 */
async function getIdentityProfile(handle) {
  const row = db
    .prepare(
      `SELECT archetype, sentiment, epochState, narrativeArc,
              archetypeHistory, sentimentHistory, resonances,
              curatorStatement, totalMints, totalChapters
       FROM identity_profiles WHERE handle = ?`
    )
    .get(handle);

  if (!row) return null;

  return {
    archetype: row.archetype,
    sentiment: row.sentiment,
    epochState: row.epochState,
    narrativeArc: row.narrativeArc,
    archetypeHistory: JSON.parse(row.archetypeHistory),
    sentimentHistory: JSON.parse(row.sentimentHistory),
    resonances: JSON.parse(row.resonances),
    curatorStatement: row.curatorStatement,
    totalMints: row.totalMints,
    totalChapters: row.totalChapters,
  };
}

/**
 * Build prior-context object for curatorPanel from works + profile data.
 */
async function getPriorContext(handle) {
  const work = await getLastWorkForHandle(handle);
  const profile = await getIdentityProfile(handle);

  if (!work && !profile) return null;

  return {
    themes: work?.mainThemes || [],
    chapterCount: work?.chapterCount || 0,
    archetype: profile?.archetype || null,
    sentiment: profile?.sentiment || null,
    epochState: profile?.epochState || 1,
    narrativeArc: profile?.narrativeArc || "origin",
    archetypeHistory: profile?.archetypeHistory || [],
    totalMints: profile?.totalMints || 0,
  };
}

/**
 * Update the identity profile after a curatorial panel interpretation.
 * Appends to archetype/sentiment history arrays to track drift over time.
 *
 * @param {string} handle
 * @param {object} interpretation — output from curateWithPanel()
 * @param {"mint"|"chapter"} action — what was done with this interpretation
 */
async function evolveIdentityProfile(handle, interpretation, action) {
  const existing = await getIdentityProfile(handle);

  const archetypeHistory = existing?.archetypeHistory || [];
  const sentimentHistory = existing?.sentimentHistory || [];
  const existingResonances = existing?.resonances || [];

  // Append current archetype/sentiment to history (keep last 20)
  if (interpretation.archetype) {
    archetypeHistory.push({
      value: interpretation.archetype,
      at: new Date().toISOString(),
    });
    if (archetypeHistory.length > 20) archetypeHistory.shift();
  }

  if (interpretation.sentiment) {
    sentimentHistory.push({
      value: interpretation.sentiment,
      at: new Date().toISOString(),
    });
    if (sentimentHistory.length > 20) sentimentHistory.shift();
  }

  // Merge resonances (deduplicate, keep last 10)
  const newResonances = interpretation.resonances || [];
  const mergedResonances = [
    ...new Set([...existingResonances, ...newResonances]),
  ].slice(-10);

  const totalMints =
    (existing?.totalMints || 0) + (action === "mint" ? 1 : 0);
  const totalChapters =
    (existing?.totalChapters || 0) + (action === "chapter" ? 1 : 0);

  db.prepare(
    `
    INSERT INTO identity_profiles
      (handle, archetype, sentiment, epochState, narrativeArc,
       archetypeHistory, sentimentHistory, resonances,
       curatorStatement, totalMints, totalChapters, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(handle) DO UPDATE SET
      archetype = excluded.archetype,
      sentiment = excluded.sentiment,
      epochState = excluded.epochState,
      narrativeArc = excluded.narrativeArc,
      archetypeHistory = excluded.archetypeHistory,
      sentimentHistory = excluded.sentimentHistory,
      resonances = excluded.resonances,
      curatorStatement = excluded.curatorStatement,
      totalMints = excluded.totalMints,
      totalChapters = excluded.totalChapters,
      updatedAt = excluded.updatedAt
  `
  ).run(
    handle,
    interpretation.archetype,
    interpretation.sentiment,
    interpretation.epochState || existing?.epochState || 1,
    interpretation.narrativeArc || existing?.narrativeArc || "origin",
    JSON.stringify(archetypeHistory),
    JSON.stringify(sentimentHistory),
    JSON.stringify(mergedResonances),
    interpretation.curatorStatement || existing?.curatorStatement || null,
    totalMints,
    totalChapters
  );
}

module.exports = {
  getLastWorkForHandle,
  saveNewWorkForHandle,
  getIdentityProfile,
  getPriorContext,
  evolveIdentityProfile,
};
