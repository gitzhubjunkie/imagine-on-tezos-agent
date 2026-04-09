const { searchHashtag } = require("./xClient");
const tweetStore = require("./db/tweetStore");

const REQUIRED_HASHTAG = "imagineontezos";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS) || 30000;

let intervalId = null;
let running = false;

/**
 * Run one ingestion cycle:
 * 1. Search X for #imagineontezos tweets
 * 2. Insert new tweets as 'discovered'
 * 3. Validate and promote to 'eligible'
 */
async function ingestOnce() {
  if (running) {
    console.log("[scheduler] Previous cycle still running, skipping");
    return { searched: 0, inserted: 0, promoted: 0, error: null };
  }
  running = true;

  try {
    console.log("[scheduler] Searching for #" + REQUIRED_HASHTAG + "…");

    const tweets = await searchHashtag(REQUIRED_HASHTAG, 20);
    console.log(`[scheduler] Found ${tweets.length} tweets from X`);

    if (tweets.length === 0) {
      return { searched: 0, inserted: 0, promoted: 0, error: null };
    }

    // Insert all new tweets (dedup by tweetId)
    const inserted = tweetStore.insertMany(tweets);
    console.log(`[scheduler] Inserted ${inserted} new tweets`);

    // Promote discovered → eligible (validate each)
    let promoted = 0;
    const discovered = tweetStore.getByStatus("discovered");
    for (const tweet of discovered) {
      if (isEligible(tweet)) {
        if (tweetStore.markEligible(tweet.tweetId)) {
          promoted++;
        }
      }
    }
    console.log(`[scheduler] Promoted ${promoted} tweets to eligible`);

    return { searched: tweets.length, inserted, promoted, error: null };
  } catch (err) {
    console.error("[scheduler] Ingestion error:", err.message);
    return { searched: 0, inserted: 0, promoted: 0, error: err.message };
  } finally {
    running = false;
  }
}

/**
 * Check if a tweet qualifies for minting.
 */
function isEligible(tweet) {
  // Must have the required hashtag
  const hasTag = (tweet.hashtags || []).some(
    (h) => h.toLowerCase() === REQUIRED_HASHTAG
  );
  if (!hasTag) return false;

  // Must have non-empty text
  if (!tweet.text || tweet.text.trim().length === 0) return false;

  // Must have a valid tweet ID
  if (!tweet.tweetId) return false;

  return true;
}

/**
 * Start the polling scheduler.
 */
function start() {
  if (process.env.ENABLE_X_SCHEDULER !== "true") {
    console.log("[scheduler] X scheduler disabled (set ENABLE_X_SCHEDULER=true to enable)");
    return;
  }

  if (intervalId) {
    console.log("[scheduler] Already running");
    return;
  }

  if (!process.env.X_BEARER_TOKEN) {
    console.warn("[scheduler] X_BEARER_TOKEN not set — search requires v2 API. Scheduler disabled.");
    return;
  }

  console.log(`[scheduler] Starting — polling every ${POLL_INTERVAL / 1000}s`);

  // Run immediately, then on interval
  ingestOnce();
  intervalId = setInterval(ingestOnce, POLL_INTERVAL);
}

/**
 * Stop the polling scheduler.
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[scheduler] Stopped");
  }
}

function isRunning() {
  return intervalId !== null;
}

module.exports = { start, stop, isRunning, ingestOnce };
