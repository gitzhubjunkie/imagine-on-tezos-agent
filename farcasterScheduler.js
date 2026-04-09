const { searchCasts } = require("./farcasterClient");
const tweetStore = require("./db/tweetStore");

const REQUIRED_HASHTAG = "imagineontezos";
const POLL_INTERVAL = parseInt(process.env.FC_POLL_INTERVAL_MS) || parseInt(process.env.POLL_INTERVAL_MS) || 30000;

let intervalId = null;
let running = false;

/**
 * Run one Farcaster ingestion cycle:
 * 1. Search Farcaster for #imagineontezos casts
 * 2. Insert new casts as 'discovered' with source='farcaster'
 * 3. Validate and promote to 'eligible'
 */
async function ingestOnce() {
  if (running) {
    console.log("[fc-scheduler] Previous cycle still running, skipping");
    return { searched: 0, inserted: 0, promoted: 0, error: null };
  }
  running = true;

  try {
    console.log("[fc-scheduler] Searching Farcaster for #" + REQUIRED_HASHTAG + "…");

    const casts = await searchCasts(REQUIRED_HASHTAG, 25);
    console.log(`[fc-scheduler] Found ${casts.length} casts from Farcaster`);

    if (casts.length === 0) {
      return { searched: 0, inserted: 0, promoted: 0, error: null };
    }

    // Insert all new casts (dedup by tweetId which is fc-{hash})
    const inserted = tweetStore.insertMany(casts);
    console.log(`[fc-scheduler] Inserted ${inserted} new casts`);

    // Promote discovered → eligible (validate each)
    let promoted = 0;
    const discovered = tweetStore.getByStatusAndSource("discovered", "farcaster");
    for (const cast of discovered) {
      if (isEligible(cast)) {
        if (tweetStore.markEligible(cast.tweetId)) {
          promoted++;
        }
      }
    }
    console.log(`[fc-scheduler] Promoted ${promoted} casts to eligible`);

    return { searched: casts.length, inserted, promoted, error: null };
  } catch (err) {
    console.error("[fc-scheduler] Ingestion error:", err.message);
    return { searched: 0, inserted: 0, promoted: 0, error: err.message };
  } finally {
    running = false;
  }
}

/**
 * Check if a Farcaster cast qualifies for minting.
 */
function isEligible(cast) {
  // Must have the required hashtag
  const hasTag = (cast.hashtags || []).some(
    (h) => h.toLowerCase() === REQUIRED_HASHTAG
  );
  if (!hasTag) return false;

  // Must have non-empty text
  if (!cast.text || cast.text.trim().length === 0) return false;

  // Must have a valid ID
  if (!cast.tweetId) return false;

  return true;
}

/**
 * Start the Farcaster polling scheduler.
 */
function start() {
  if (process.env.ENABLE_FC_SCHEDULER !== "true") {
    console.log("[fc-scheduler] FC scheduler disabled (set ENABLE_FC_SCHEDULER=true to enable)");
    return;
  }

  if (intervalId) {
    console.log("[fc-scheduler] Already running");
    return;
  }

  if (!process.env.NEYNAR_API_KEY) {
    console.warn("[fc-scheduler] NEYNAR_API_KEY not set — required for hub-api.neynar.com gateway.");
    return;
  }

  console.log(`[fc-scheduler] Starting — polling every ${POLL_INTERVAL / 1000}s`);

  // Run immediately, then on interval
  ingestOnce();
  intervalId = setInterval(ingestOnce, POLL_INTERVAL);
}

/**
 * Stop the Farcaster polling scheduler.
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[fc-scheduler] Stopped");
  }
}

function isRunning() {
  return intervalId !== null;
}

module.exports = { start, stop, isRunning, ingestOnce };
