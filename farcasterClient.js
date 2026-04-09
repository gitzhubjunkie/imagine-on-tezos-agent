require("dotenv").config();
const axios = require("axios");

// ── Hub API (free via Neynar hub gateway) ───────────────
const HUB_BASE = "https://hub-api.neynar.com";
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_REST = "https://api.neynar.com/v2/farcaster";

// Optional: set FC_CHANNEL_URL to a channel parent URL (chain://eip155:...) for channel-based discovery
// Optional: set FC_WATCH_FIDS to comma-separated FIDs for user-based discovery
// If neither is set, the events API is used for global hashtag scanning

const FARCASTER_EPOCH = 1609459200; // Jan 1, 2021 UTC

// In-memory state for incremental polling
let _lastEventId = null;
let _lastTimestamp = null; // Farcaster timestamp (seconds since epoch)

function hubHeaders() {
  return { "x-api-key": NEYNAR_API_KEY };
}

// ── User info cache (FID → { username, displayName, pfpUrl }) ──
const _userCache = new Map();

async function getUserInfo(fid) {
  if (_userCache.has(fid)) return _userCache.get(fid);

  try {
    const res = await axios.get(`${HUB_BASE}/v1/userDataByFid`, {
      headers: hubHeaders(),
      params: { fid },
      timeout: 8000,
    });
    const info = { username: null, displayName: null, pfpUrl: null };
    for (const m of res.data?.messages || []) {
      const body = m.data?.userDataBody;
      if (!body) continue;
      if (body.type === "USER_DATA_TYPE_USERNAME") info.username = body.value;
      if (body.type === "USER_DATA_TYPE_DISPLAY") info.displayName = body.value;
      if (body.type === "USER_DATA_TYPE_PFP") info.pfpUrl = body.value;
    }
    _userCache.set(fid, info);
    return info;
  } catch {
    return { username: null, displayName: null, pfpUrl: null };
  }
}

/**
 * Search for casts containing #hashtag.
 * Strategy order:
 *   1. FC_CHANNEL_URL set → castsByParent (channel-based)
 *   2. FC_WATCH_FIDS set  → castsByFid per FID, client-side filter
 *   3. Neither             → events API global scan
 */
async function searchCasts(hashtag = "imagineontezos", limit = 25) {
  if (!NEYNAR_API_KEY) {
    throw new Error("NEYNAR_API_KEY required (used for hub-api.neynar.com gateway)");
  }

  const channelUrl = process.env.FC_CHANNEL_URL;
  const watchFids = process.env.FC_WATCH_FIDS;

  let hubMessages = [];

  if (channelUrl) {
    hubMessages = await searchByChannel(channelUrl, limit);
  } else if (watchFids) {
    hubMessages = await searchByFids(watchFids, hashtag, limit);
  } else {
    hubMessages = await searchByEvents(hashtag, limit);
  }

  // Enrich with user info and normalize
  const results = [];
  for (const msg of hubMessages.slice(0, limit)) {
    const fid = msg.data?.fid;
    const userInfo = fid ? await getUserInfo(fid) : {};
    results.push(normalizeHubCast(msg, userInfo));
  }
  return results;
}

/**
 * Strategy 1: Poll a channel via castsByParent.
 */
async function searchByChannel(channelUrl, limit) {
  const params = {
    url: channelUrl,
    pageSize: Math.min(limit, 100),
    reverse: true,
  };
  if (_lastTimestamp) params.startTimestamp = _lastTimestamp + 1;

  const res = await axios.get(`${HUB_BASE}/v1/castsByParent`, {
    headers: hubHeaders(), params, timeout: 10000,
  });
  const messages = res.data?.messages || [];
  console.log(`[farcasterClient] Channel feed returned ${messages.length} casts`);

  if (messages.length > 0) {
    _lastTimestamp = Math.max(...messages.map((m) => m.data?.timestamp || 0));
  }
  return messages;
}

/**
 * Strategy 2: Poll specific FIDs, filter for hashtag client-side.
 */
async function searchByFids(fidsCsv, hashtag, limit) {
  const fids = fidsCsv.split(",").map((f) => f.trim()).filter(Boolean);
  const tag = `#${hashtag}`.toLowerCase();
  const all = [];

  for (const fid of fids) {
    try {
      const params = { fid, pageSize: 50, reverse: true };
      if (_lastTimestamp) params.startTimestamp = _lastTimestamp + 1;

      const res = await axios.get(`${HUB_BASE}/v1/castsByFid`, {
        headers: hubHeaders(), params, timeout: 10000,
      });
      const messages = (res.data?.messages || []).filter(
        (m) => (m.data?.castAddBody?.text || "").toLowerCase().includes(tag)
      );
      all.push(...messages);
    } catch (e) {
      console.warn(`[farcasterClient] castsByFid(${fid}) failed:`, e.message);
    }
  }

  console.log(`[farcasterClient] FID scan: ${fids.length} FIDs, ${all.length} matching casts`);
  if (all.length > 0) {
    _lastTimestamp = Math.max(...all.map((m) => m.data?.timestamp || 0));
  }
  return all.slice(0, limit);
}

/**
 * Strategy 3: Scan the events API for new casts with the hashtag.
 * Tracks from_event_id to only process new events each poll.
 */
async function searchByEvents(hashtag, limit) {
  const tag = `#${hashtag}`.toLowerCase();
  const matches = [];
  const MAX_PAGES = 5; // cap pages per poll to limit API calls

  for (const shardIndex of [1, 2]) {
    let pageToken = "";
    let pagesScanned = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = { shard_index: shardIndex, pageSize: 1000 };
      if (_lastEventId?.[shardIndex]) params.from_event_id = _lastEventId[shardIndex];
      if (pageToken) params.pageToken = pageToken;

      let res;
      try {
        res = await axios.get(`${HUB_BASE}/v1/events`, {
          headers: hubHeaders(), params, timeout: 15000,
        });
      } catch (e) {
        console.warn(`[farcasterClient] Events shard ${shardIndex} failed:`, e.message);
        break;
      }

      const events = res.data?.events || [];
      pagesScanned++;

      for (const ev of events) {
        if (ev.type !== "HUB_EVENT_TYPE_MERGE_MESSAGE") continue;
        const msg = ev.mergeMessageBody?.message;
        if (!msg || msg.data?.type !== "MESSAGE_TYPE_CAST_ADD") continue;
        const text = msg.data?.castAddBody?.text || "";
        if (text.toLowerCase().includes(tag)) {
          matches.push(msg);
        }
        // Track latest event id
        if (!_lastEventId) _lastEventId = {};
        _lastEventId[shardIndex] = ev.id;
      }

      pageToken = res.data?.nextPageToken || "";
      if (!pageToken) break;
    }
    console.log(`[farcasterClient] Events shard ${shardIndex}: scanned ${pagesScanned} pages`);
  }

  console.log(`[farcasterClient] Events scan: ${matches.length} casts with #${hashtag}`);
  return matches.slice(0, limit);
}

/**
 * Look up a single cast by Warpcast URL (uses Neynar REST — free for individual lookups).
 */
async function lookupCast(identifier, type = "url") {
  if (!NEYNAR_API_KEY) {
    throw new Error("NEYNAR_API_KEY required for Farcaster lookup");
  }

  const res = await axios.get(`${NEYNAR_REST}/cast`, {
    headers: { "x-api-key": NEYNAR_API_KEY, accept: "application/json" },
    params: { identifier, type },
    timeout: 10000,
  });

  const cast = res.data?.cast;
  if (!cast) throw new Error("Cast not found");
  return normalizeNeynarCast(cast);
}

/**
 * Normalize a Hub API message into the shared store shape.
 */
function normalizeHubCast(msg, userInfo = {}) {
  const data = msg.data || {};
  const body = data.castAddBody || {};
  const text = body.text || "";
  const hashtags = extractHashtags(text);
  const fid = data.fid;

  const warpcastUrl = userInfo.username
    ? `https://warpcast.com/${userInfo.username}/${msg.hash?.slice(0, 10)}`
    : null;

  // Extract embedded images from hub embeds
  const embeds = body.embeds || [];
  const images = embeds.filter((e) => /\.(jpg|jpeg|png|gif|webp)$/i.test(e.url || ""));

  // Convert Farcaster timestamp to ISO
  const createdAt = data.timestamp
    ? new Date((data.timestamp + FARCASTER_EPOCH) * 1000).toISOString()
    : null;

  return {
    tweetId: `fc-${msg.hash}`,
    tweetUrl: warpcastUrl,
    url: warpcastUrl,
    text,
    authorHandle: userInfo.username || null,
    authorName: userInfo.displayName || userInfo.username || null,
    authorAvatar: userInfo.pfpUrl || null,
    createdAt,
    imageUrl: images[0]?.url || null,
    media: images.map((e) => ({ type: "photo", url: e.url })),
    hashtags,
    source: "farcaster",
    _farcasterHash: msg.hash,
    _fid: fid || null,
  };
}

/**
 * Normalize a Neynar REST cast object (used by lookupCast).
 */
function normalizeNeynarCast(cast) {
  const author = cast.author || {};
  const text = cast.text || "";
  const hashtags = extractHashtags(text);

  const warpcastUrl = author.username
    ? `https://warpcast.com/${author.username}/${cast.hash?.slice(0, 10)}`
    : null;

  const embeds = cast.embeds || [];
  const images = embeds.filter(
    (e) => e.metadata?.content_type?.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(e.url || "")
  );

  return {
    tweetId: `fc-${cast.hash}`,
    tweetUrl: warpcastUrl,
    url: warpcastUrl,
    text,
    authorHandle: author.username || null,
    authorName: author.display_name || author.username || null,
    authorAvatar: author.pfp_url || null,
    createdAt: cast.timestamp || null,
    imageUrl: images[0]?.url || null,
    media: images.map((e) => ({ type: "photo", url: e.url })),
    hashtags,
    source: "farcaster",
    _farcasterHash: cast.hash,
    _fid: author.fid || null,
  };
}

/**
 * Extract hashtags from cast text.
 */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#(\w+)/g);
  return matches ? matches.map((h) => h.slice(1)) : [];
}

/**
 * Parse a Warpcast URL to extract identifiers.
 * e.g. https://warpcast.com/username/0xabcdef1234
 */
function parseWarpcastUrl(input) {
  const match = input.match(/warpcast\.com\/(\w+)\/(0x[a-fA-F0-9]+)/i);
  if (match) return { username: match[1], hash: match[2] };
  return null;
}

module.exports = { searchCasts, lookupCast, parseWarpcastUrl, extractHashtags };
