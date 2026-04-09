const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "..", "tweets.sqlite"));

// Enable WAL for better concurrent read/write
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS tweets (
  tweetId       TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  text          TEXT NOT NULL,
  authorHandle  TEXT,
  authorName    TEXT,
  authorAvatar  TEXT,
  createdAt     TEXT,
  imageUrl      TEXT,
  media         TEXT DEFAULT '[]',
  hashtags      TEXT DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'x',
  status        TEXT NOT NULL DEFAULT 'discovered'
                CHECK(status IN ('discovered','eligible','minting','minted','failed')),
  mintedTokenId TEXT,
  mintTxHash    TEXT,
  tokenURI      TEXT,
  errorMessage  TEXT,
  discoveredAt  TEXT NOT NULL DEFAULT (datetime('now')),
  mintedAt      TEXT,
  retryCount    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);
`);

// Migration: add source column if upgrading from older schema
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN source TEXT NOT NULL DEFAULT 'x'`);
} catch (_) {
  // Column already exists — ignore
}

// Now create the source index (safe after migration)
db.exec(`CREATE INDEX IF NOT EXISTS idx_tweets_source ON tweets(source);`);

// ── Prepared statements ────────────────────────────────

const stmts = {
  upsertTweet: db.prepare(`
    INSERT INTO tweets (tweetId, url, text, authorHandle, authorName, authorAvatar,
                        createdAt, imageUrl, media, hashtags, source, status)
    VALUES (@tweetId, @url, @text, @authorHandle, @authorName, @authorAvatar,
            @createdAt, @imageUrl, @media, @hashtags, @source, 'discovered')
    ON CONFLICT(tweetId) DO NOTHING
  `),

  setStatus: db.prepare(`
    UPDATE tweets SET status = @status WHERE tweetId = @tweetId
  `),

  markEligible: db.prepare(`
    UPDATE tweets SET status = 'eligible' WHERE tweetId = @tweetId AND status = 'discovered'
  `),

  markMinting: db.prepare(`
    UPDATE tweets SET status = 'minting' WHERE tweetId = @tweetId AND status = 'eligible'
  `),

  markMinted: db.prepare(`
    UPDATE tweets
    SET status = 'minted',
        mintedTokenId = @mintedTokenId,
        mintTxHash = @mintTxHash,
        tokenURI = @tokenURI,
        mintedAt = datetime('now')
    WHERE tweetId = @tweetId AND status = 'minting'
  `),

  markFailed: db.prepare(`
    UPDATE tweets
    SET status = 'failed',
        errorMessage = @errorMessage,
        retryCount = retryCount + 1
    WHERE tweetId = @tweetId
  `),

  resetFailed: db.prepare(`
    UPDATE tweets SET status = 'eligible', errorMessage = NULL
    WHERE tweetId = @tweetId AND status = 'failed'
  `),

  getByStatus: db.prepare(`
    SELECT * FROM tweets WHERE status = @status ORDER BY discoveredAt DESC
  `),

  getById: db.prepare(`
    SELECT * FROM tweets WHERE tweetId = @tweetId
  `),

  getAll: db.prepare(`
    SELECT * FROM tweets ORDER BY discoveredAt DESC LIMIT @limit OFFSET @offset
  `),

  getAllBySource: db.prepare(`
    SELECT * FROM tweets WHERE source = @source ORDER BY discoveredAt DESC LIMIT @limit OFFSET @offset
  `),

  getByStatusAndSource: db.prepare(`
    SELECT * FROM tweets WHERE status = @status AND source = @source ORDER BY discoveredAt DESC
  `),

  countByStatus: db.prepare(`
    SELECT status, COUNT(*) as count FROM tweets GROUP BY status
  `),

  totalCount: db.prepare(`
    SELECT COUNT(*) as count FROM tweets
  `),
};

// ── Public API ─────────────────────────────────────────

/**
 * Insert a newly discovered tweet. No-ops if tweetId already exists.
 * Returns true if inserted, false if duplicate.
 */
function insertTweet(tweet) {
  const result = stmts.upsertTweet.run({
    tweetId: tweet.tweetId,
    url: tweet.tweetUrl || tweet.url || "",
    text: tweet.text || "",
    authorHandle: tweet.authorHandle || null,
    authorName: tweet.authorName || null,
    authorAvatar: tweet.authorAvatar || null,
    createdAt: tweet.createdAt || null,
    imageUrl: tweet.imageUrl || null,
    media: JSON.stringify(tweet.media || []),
    hashtags: JSON.stringify(tweet.hashtags || []),
    source: tweet.source || "x",
  });
  return result.changes > 0;
}

/**
 * Insert multiple tweets in a single transaction.
 * Returns number of new tweets inserted.
 */
const insertMany = db.transaction((tweets) => {
  let inserted = 0;
  for (const tweet of tweets) {
    if (insertTweet(tweet)) inserted++;
  }
  return inserted;
});

function markEligible(tweetId) {
  return stmts.markEligible.run({ tweetId }).changes > 0;
}

function markMinting(tweetId) {
  return stmts.markMinting.run({ tweetId }).changes > 0;
}

function markMinted(tweetId, { mintedTokenId, mintTxHash, tokenURI }) {
  return stmts.markMinted.run({
    tweetId,
    mintedTokenId: String(mintedTokenId),
    mintTxHash,
    tokenURI,
  }).changes > 0;
}

function markFailed(tweetId, errorMessage) {
  return stmts.markFailed.run({ tweetId, errorMessage }).changes > 0;
}

function resetFailed(tweetId) {
  return stmts.resetFailed.run({ tweetId }).changes > 0;
}

function getByStatus(status) {
  return stmts.getByStatus.all({ status }).map(deserializeRow);
}

function getById(tweetId) {
  const row = stmts.getById.get({ tweetId });
  return row ? deserializeRow(row) : null;
}

function getAll(limit = 50, offset = 0, source = null) {
  if (source) {
    return stmts.getAllBySource.all({ limit, offset, source }).map(deserializeRow);
  }
  return stmts.getAll.all({ limit, offset }).map(deserializeRow);
}

function getByStatusAndSource(status, source) {
  return stmts.getByStatusAndSource.all({ status, source }).map(deserializeRow);
}

function getStats() {
  const rows = stmts.countByStatus.all();
  const stats = { discovered: 0, eligible: 0, minting: 0, minted: 0, failed: 0, total: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }
  return stats;
}

function deserializeRow(row) {
  return {
    ...row,
    media: JSON.parse(row.media || "[]"),
    hashtags: JSON.parse(row.hashtags || "[]"),
  };
}

module.exports = {
  insertTweet,
  insertMany,
  markEligible,
  markMinting,
  markMinted,
  markFailed,
  resetFailed,
  getByStatus,
  getByStatusAndSource,
  getById,
  getAll,
  getStats,
};
