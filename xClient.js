require("dotenv").config();
const axios = require("axios");

const BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const OEMBED_URL = "https://publish.x.com/oembed";
const X_API = "https://api.x.com/2";

// ── URL parsing ─────────────────────────────────────────

/**
 * Extract tweet ID from an X/Twitter URL.
 * Supports: https://x.com/user/status/123, https://twitter.com/user/status/123
 */
function parseTweetId(input) {
  const match = input.match(
    /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i
  );
  return match ? match[2] : null;
}

/**
 * Extract username from an X/Twitter URL.
 */
function parseUsername(input) {
  const match = input.match(
    /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i
  );
  return match ? match[1] : null;
}

/**
 * Build canonical X URL from username + id.
 */
function canonicalUrl(username, tweetId) {
  return `https://x.com/${username || "i"}/status/${tweetId}`;
}

// ── oEmbed (no auth, stable) ────────────────────────────

/**
 * Fetch tweet data via X oEmbed endpoint. No bearer token needed.
 * Returns { html, author_name, author_url, url, ... }
 */
async function fetchOEmbed(tweetUrl) {
  const res = await axios.get(OEMBED_URL, {
    params: { url: tweetUrl, omit_script: true },
    timeout: 8000,
  });
  return res.data;
}

/**
 * Extract tweet text from oEmbed HTML blockquote.
 * The HTML contains <blockquote><p>text</p> — ...  </blockquote>
 */
function extractTextFromOEmbed(html) {
  if (!html) return "";
  // Strip <script> tags
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Get content inside <p> tags within the blockquote
  const pMatch = noScript.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (pMatch) {
    // Strip remaining tags, decode entities
    return pMatch[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<\/?[^>]+(>|$)/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
  // Fallback: strip all tags
  return noScript.replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extract author handle from oEmbed author_url.
 * author_url is typically "https://x.com/username"
 */
function extractAuthorHandle(authorUrl) {
  if (!authorUrl) return null;
  const match = authorUrl.match(/(?:x\.com|twitter\.com)\/(\w+)\/?$/i);
  return match ? match[1] : null;
}

/**
 * Extract hashtags from tweet text.
 */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#(\w+)/g);
  return matches ? matches.map((h) => h.slice(1)) : [];
}

// ── og:image scraper (no auth, gets images) ─────────────

/**
 * Fetch tweet media via vxtwitter public API (no auth required).
 * Returns { imageUrl, media[] } or null.
 */
async function fetchTweetMedia(tweetUrl) {
  try {
    // vxtwitter returns full media URLs without authentication
    const vxUrl = tweetUrl.replace(
      /https?:\/\/(x\.com|twitter\.com)/,
      "https://api.vxtwitter.com"
    );
    const res = await axios.get(vxUrl, { timeout: 8000 });
    const data = res.data;
    if (!data) return null;

    const media = (data.media_extended || [])
      .filter((m) => m.url)
      .map((m) => ({
        type: m.type === "image" ? "photo" : m.type,
        url: m.url,
      }));

    const imageUrl =
      media.find((m) => m.type === "photo")?.url ||
      (data.mediaURLs && data.mediaURLs[0]) ||
      null;

    return { imageUrl, media };
  } catch (e) {
    console.warn(`[xClient] vxtwitter media fetch failed: ${e.message}`);
    return null;
  }
}

// ── v2 API (bearer, optional) ───────────────────────────

const TWEET_FIELDS = "created_at,author_id,text,attachments,entities";
const MEDIA_FIELDS = "url,preview_image_url,type";
const USER_FIELDS = "username,name,profile_image_url";
const EXPANSIONS = "author_id,attachments.media_keys";

/**
 * Look up a single tweet via X API v2 (requires BEARER_TOKEN).
 * Throws on any non-200 response.
 */
async function fetchV2(tweetId) {
  const res = await axios.get(`${X_API}/tweets/${tweetId}`, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    params: {
      "tweet.fields": TWEET_FIELDS,
      "media.fields": MEDIA_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    },
    timeout: 10000,
  });
  return res.data;
}

function normalizeV2Response(apiResponse, tweetId) {
  const tweet = apiResponse.data;
  const includes = apiResponse.includes || {};

  const author =
    (includes.users || []).find((u) => u.id === tweet.author_id) || {};

  const mediaKeys = tweet.attachments?.media_keys || [];
  const allMedia = includes.media || [];
  const media = mediaKeys
    .map((key) => allMedia.find((m) => m.media_key === key))
    .filter(Boolean);
  const firstImage = media.find((m) => m.type === "photo");

  const hashtags = (tweet.entities?.hashtags || []).map((h) => h.tag);

  return {
    tweetId,
    tweetUrl: canonicalUrl(author.username, tweetId),
    authorHandle: author.username || null,
    authorName: author.name || null,
    authorAvatar: author.profile_image_url || null,
    text: tweet.text,
    createdAt: tweet.created_at,
    hashtags,
    imageUrl: firstImage?.url || firstImage?.preview_image_url || null,
    media: media.map((m) => ({
      type: m.type,
      url: m.url || m.preview_image_url,
    })),
  };
}

// ── Public API ──────────────────────────────────────────

/**
 * Look up a tweet — v2 first (gets media), oEmbed fallback (no auth).
 * Always returns a normalized tweet object.
 */
async function lookupTweet(tweetId, tweetUrl) {
  const url = tweetUrl || canonicalUrl("i", tweetId);
  const username = parseUsername(url) || "i";

  // 1. v2 first — returns media/avatar/timestamps
  if (BEARER_TOKEN) {
    try {
      const data = await fetchV2(tweetId);
      console.log(`[xClient] v2 success for ${tweetId}`);
      return { ...normalizeV2Response(data, tweetId), _source: "v2" };
    } catch (e) {
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        console.error(
          `[xClient] v2 auth error ${status} — check X_BEARER_TOKEN`
        );
      } else if (status === 503) {
        console.warn(
          `[xClient] v2 returned 503 (known X platform issue), trying oEmbed…`
        );
      } else {
        console.error(`[xClient] v2 failed: ${e.message}, trying oEmbed…`);
      }
    }
  }

  // 2. oEmbed fallback — no auth, most stable, but no media
  try {
    const oembed = await fetchOEmbed(url);
    const text = extractTextFromOEmbed(oembed.html);
    const handle = extractAuthorHandle(oembed.author_url) || username;
    const hashtags = extractHashtags(text);
    const tweetUrlNorm = canonicalUrl(handle, tweetId);

    // Enrich with media via vxtwitter (no auth, gets actual image URLs)
    const mediaData = await fetchTweetMedia(tweetUrlNorm);
    if (mediaData?.imageUrl) {
      console.log(`[xClient] oEmbed + vxtwitter image success for ${tweetId}`);
    } else {
      console.log(`[xClient] oEmbed success (no image) for ${tweetId}`);
    }

    return {
      tweetId,
      tweetUrl: tweetUrlNorm,
      authorHandle: handle,
      authorName: oembed.author_name || handle,
      authorAvatar: null,
      text,
      createdAt: null,
      hashtags,
      imageUrl: mediaData?.imageUrl || null,
      media: mediaData?.media || [],
      _source: "oembed",
    };
  } catch (e) {
    console.warn(`[xClient] oEmbed failed: ${e.message}`);
  }

  throw new Error(
    "Unable to fetch tweet — both v2 API and oEmbed failed. The post may be deleted, private, or X services are down."
  );
}

/**
 * Search recent tweets with a hashtag via v2.
 * This requires BEARER_TOKEN — no oEmbed equivalent exists for search.
 */
async function searchHashtag(hashtag = "imagineontezos", maxResults = 10) {
  if (!BEARER_TOKEN) {
    throw new Error("X_BEARER_TOKEN required for hashtag search");
  }

  const res = await axios.get(`${X_API}/tweets/search/recent`, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    params: {
      query: `#${hashtag} -is:retweet`,
      max_results: Math.min(maxResults, 100),
      "tweet.fields": TWEET_FIELDS,
      "media.fields": MEDIA_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    },
    timeout: 10000,
  });

  if (!res.data.data) return [];

  return res.data.data.map((tweet) => ({
    ...normalizeV2Response(
      { data: tweet, includes: res.data.includes },
      tweet.id
    ),
    _source: "v2",
  }));
}

module.exports = { parseTweetId, lookupTweet, searchHashtag };
