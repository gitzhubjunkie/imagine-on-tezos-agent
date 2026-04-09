import { useState, useEffect, useCallback, Component } from "react";
import { JsonRpcProvider, Contract } from "ethers";
import abi from "./contractABI.json";
import "./App.css";

// ─── Error boundary ────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#ff6b6b", background: "#1a1a1a", minHeight: "100vh" }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#e0e0e0" }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", color: "#888", fontSize: 12 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ marginTop: 20, padding: "8px 16px", cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const NETWORK = {
  chainId: "0x1f34f",
  chainIdDec: 127823,
  chainName: "Etherlink Shadownet",
  rpcUrls: ["https://node.shadownet.etherlink.com"],
  nativeCurrency: { name: "XTZ", symbol: "XTZ", decimals: 18 },
  blockExplorerUrls: ["https://shadownet.explorer.etherlink.com"],
};

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const API_BASE = import.meta.env.VITE_API_URL || "";

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const ipfs = (u) =>
  u?.startsWith("ipfs://")
    ? u.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/")
    : u;

// Route IPFS content through our API proxy (Pinata public gateway blocks HTML)
const ipfsProxy = (u) => {
  if (!u) return u;
  let cid = null;
  if (u.startsWith("ipfs://")) cid = u.replace("ipfs://", "");
  else if (u.includes("/ipfs/")) cid = u.split("/ipfs/").pop();
  if (cid) return `${API_BASE}/api/ipfs/${cid}`;
  return u;
};

// ─── API helper ─────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  // Read body as text first to avoid crashing on empty responses
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`API ${res.status}: empty response`);
    throw new Error("Server returned an empty response");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Body is not JSON (e.g. HTML error page from proxy)
    throw new Error(
      !res.ok
        ? `API ${res.status}: ${text.slice(0, 120)}`
        : "Server returned non-JSON response"
    );
  }

  if (!res.ok) throw new Error(data.error || `API ${res.status}`);
  return data;
}

// ─── Wallet hook with chain detection ───────────────────
function useWallet() {
  const [account, setAccount] = useState(null);
  const [onCorrectChain, setOnCorrectChain] = useState(false);
  const [err, setErr] = useState(null);

  // Check current chain (case-insensitive hex compare)
  const isCorrectChain = (chainId) =>
    chainId?.toLowerCase() === NETWORK.chainId.toLowerCase();

  async function checkChain() {
    if (!window.ethereum) return;
    try {
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      setOnCorrectChain(isCorrectChain(chainId));
    } catch {}
  }

  // Listen for chain/account changes
  useEffect(() => {
    if (!window.ethereum) return;
    const handleChain = (chainId) => {
      setOnCorrectChain(isCorrectChain(chainId));
    };
    const handleAccounts = (accs) => {
      setAccount(accs[0] || null);
    };
    window.ethereum.on("chainChanged", handleChain);
    window.ethereum.on("accountsChanged", handleAccounts);
    checkChain();
    // Auto-reconnect if previously connected
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accs) => { if (accs.length) setAccount(accs[0]); })
      .catch(() => {});
    return () => {
      window.ethereum.removeListener("chainChanged", handleChain);
      window.ethereum.removeListener("accountsChanged", handleAccounts);
    };
  }, []);

  async function connect() {
    if (!window.ethereum) {
      setErr("Install MetaMask or an EVM wallet.");
      return;
    }
    try {
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      // Switch / add chain
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: NETWORK.chainId }],
        });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: NETWORK.chainId,
              chainName: NETWORK.chainName,
              rpcUrls: NETWORK.rpcUrls,
              nativeCurrency: NETWORK.nativeCurrency,
              blockExplorerUrls: NETWORK.blockExplorerUrls,
            }],
          });
        } else throw e;
      }
      setAccount(accs[0]);
      setOnCorrectChain(true);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function switchChain() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: NETWORK.chainId }],
      });
      setOnCorrectChain(true);
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: NETWORK.chainId,
            chainName: NETWORK.chainName,
            rpcUrls: NETWORK.rpcUrls,
            nativeCurrency: NETWORK.nativeCurrency,
            blockExplorerUrls: NETWORK.blockExplorerUrls,
          }],
        });
        setOnCorrectChain(true);
      }
    }
  }

  return { account, err, onCorrectChain, connect, switchChain };
}

// ─── Contract read hook ─────────────────────────────────
function useGallery() {
  const [tokens, setTokens] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!CONTRACT_ADDRESS) {
      setError("Set VITE_CONTRACT_ADDRESS in frontend/.env");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const provider = new JsonRpcProvider(NETWORK.rpcUrls[0]);
      const c = new Contract(CONTRACT_ADDRESS, abi, provider);
      const supply = Number(await c.currentTokenId());
      setTotal(supply);

      const items = [];
      for (let id = 0; id < supply; id++) {
        const [owner, author, hash, chapCount] = await Promise.all([
          c.ownerOf(id),
          c.originalAuthor(id),
          c.promptHash(id),
          c.getChapterCount(id).then(Number),
        ]);
        const chapters = [];
        for (let i = 0; i < chapCount; i++) chapters.push(await c.getChapter(id, i));

        let meta = null;
        try {
          const uri = await c.tokenURI(id);
          if (uri && /^(http|ipfs)/.test(uri)) {
            const r = await fetch(ipfs(uri));
            meta = await r.json();
          }
        } catch {}

        items.push({ id, owner, author, hash, chapters, meta });
      }
      setTokens(items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { tokens, total, loading, error, reload: load };
}

// ─── Mint form (URL-paste only) ─────────────────────────
function MintForm({ account, onCorrectChain, switchChain, onMinted }) {
  const [url, setUrl] = useState("");
  const [tweet, setTweet] = useState(null);
  const [interpretation, setInterpretation] = useState(null);
  const [step, setStep] = useState("idle");
  // idle | resolving | preview | interpreting | interpreted | minting | done
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function handleResolve() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/x\.com|twitter\.com/.test(trimmed)) {
      setError("Paste a valid X/Twitter post URL (e.g. https://x.com/user/status/123…)");
      return;
    }
    setStep("resolving");
    setError(null);
    try {
      const data = await api("/api/resolve-tweet", {
        method: "POST",
        body: JSON.stringify({ tweetUrl: trimmed }),
      });
      setTweet(data.tweet);
      setStep("preview");
    } catch (e) {
      setError(e.message);
      setStep("idle");
    }
  }

  async function handleInterpret() {
    setStep("interpreting");
    setError(null);
    try {
      const data = await api("/api/interpret-post", {
        method: "POST",
        body: JSON.stringify({ post: tweet }),
      });
      setInterpretation(data.interpretation);
      setStep("interpreted");
    } catch (e) {
      setError(e.message);
      setStep("preview");
    }
  }

  async function handleMint() {
    if (!account) {
      setError("Connect your wallet first.");
      return;
    }
    if (!onCorrectChain) {
      setError("Switch to Etherlink Shadownet first.");
      return;
    }
    setStep("minting");
    setError(null);
    try {
      const data = await api("/api/dynamic-mint", {
        method: "POST",
        body: JSON.stringify({ tweet, walletAddress: account }),
      });
      setResult(data);
      setStep("done");
      onMinted?.();
    } catch (e) {
      setError(e.message);
      setStep("interpreted");
    }
  }

  function reset() {
    setUrl("");
    setTweet(null);
    setInterpretation(null);
    setStep("idle");
    setError(null);
    setResult(null);
  }

  return (
    <div className="ingest-box">
      <h2 className="ingest-title">Mint a post</h2>
      <p className="ingest-sub">
        Paste an X post URL containing <code>#imagineontezos</code>. AI will interpret it
        into a dynamic identity artifact before minting.
      </p>

      {error && <p className="banner banner--error">{error}</p>}

      {/* Step 1: URL input */}
      {(step === "idle" || step === "resolving") && (
        <div className="ingest-row">
          <input
            className="ingest-input"
            type="url"
            placeholder="https://x.com/user/status/123456789…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleResolve()}
            disabled={step === "resolving"}
          />
          <button
            className="btn-primary"
            onClick={handleResolve}
            disabled={step === "resolving" || !url.trim()}
          >
            {step === "resolving" ? "Resolving…" : "Fetch post"}
          </button>
        </div>
      )}

      {/* Step 2: Preview tweet + trigger AI */}
      {step === "preview" && tweet && (
        <div className="ingest-preview">
          <TweetCard tweet={tweet} />
          <div className="ingest-actions">
            <button className="btn-secondary" onClick={reset}>Cancel</button>
            <button className="btn-primary" onClick={handleInterpret}>
              AI Interpret
            </button>
          </div>
        </div>
      )}

      {/* Step 2.5: Interpreting spinner */}
      {step === "interpreting" && (
        <div className="ingest-preview">
          <TweetCard tweet={tweet} />
          <div className="ai-loading">
            <div className="spinner" />
            <p>AI is interpreting this post…</p>
          </div>
        </div>
      )}

      {/* Step 3: AI interpretation preview + mint button */}
      {(step === "interpreted" || step === "minting") && interpretation && (
        <div className="ingest-preview">
          <TweetCard tweet={tweet} compact />
          <InterpretationCard ai={interpretation} />
          <div className="ingest-actions">
            <button className="btn-secondary" onClick={reset} disabled={step === "minting"}>
              Cancel
            </button>
            {!account ? (
              <p className="hint">Connect wallet above to mint.</p>
            ) : !onCorrectChain ? (
              <button className="btn-primary" onClick={switchChain}>
                Switch to Shadownet
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleMint}
                disabled={step === "minting"}
              >
                {step === "minting" ? "Generating & minting…" : "Mint dynamic NFT"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === "done" && result && (
        <div className="ingest-done">
          <p className="done-check">Minted as Token #{result.tokenId}</p>
          <p className="mono small">Tx: {result.txHash}</p>
          {result.interpretation && (
            <InterpretationCard ai={result.interpretation} />
          )}
          {result.imageUri && (
            <img className="mint-preview-img" src={result.imageUri} alt="Preview" />
          )}
          {result.animationUri && (
            <a className="artifact-link" href={result.animationUri} target="_blank" rel="noreferrer">
              View live artifact ↗
            </a>
          )}
          <button className="btn-secondary" onClick={reset}>
            Mint another
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AI Interpretation card (enhanced for multi-agent panel) ────
function InterpretationCard({ ai }) {
  const [showPanel, setShowPanel] = useState(false);
  if (!ai) return null;
  const panel = ai._panel;

  return (
    <div className="ai-card">
      <h3 className="ai-title">{ai.title}</h3>
      <p className="ai-summary">{ai.summary}</p>
      <div className="ai-meta">
        <span className="ai-chip ai-chip--archetype">{ai.archetype}</span>
        <span className="ai-chip ai-chip--sentiment">{ai.sentiment}</span>
        <span className="ai-chip ai-chip--motion">{ai.motionMode}</span>
        {ai.texture && <span className="ai-chip ai-chip--texture">{ai.texture}</span>}
        {ai.narrativeArc && <span className="ai-chip ai-chip--arc">{ai.narrativeArc}</span>}
      </div>
      {Array.isArray(ai.palette) && (
        <div className="ai-palette">
          {ai.palette.map((c, i) => (
            <span key={i} className="ai-swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      )}
      {ai.curatorStatement && (
        <blockquote className="ai-curator-statement">{ai.curatorStatement}</blockquote>
      )}
      {Array.isArray(ai.resonances) && ai.resonances.length > 0 && (
        <div className="ai-resonances">
          {ai.resonances.map((r, i) => (
            <span key={i} className="ai-resonance">{r}</span>
          ))}
        </div>
      )}
      {Array.isArray(ai.keywords) && (
        <div className="ai-keywords">
          {ai.keywords.map((k, i) => (
            <span key={i} className="ai-kw">{k}</span>
          ))}
        </div>
      )}
      {ai.visualPrompt && (
        <p className="ai-prompt">{ai.visualPrompt}</p>
      )}
      {panel && (
        <div className="ai-panel-toggle">
          <button className="btn-panel-toggle" onClick={() => setShowPanel(!showPanel)}>
            {showPanel ? "Hide" : "Show"} curatorial panel readings
          </button>
          {showPanel && (
            <div className="ai-panel-readings">
              <div className="ai-panel-agent">
                <h4>Chromatic Agent</h4>
                <p className="ai-panel-note">{panel.chromatic?.visualNotes}</p>
                <div className="ai-meta">
                  <span className="ai-chip ai-chip--motion">{panel.chromatic?.motionMode}</span>
                  <span className="ai-chip ai-chip--texture">{panel.chromatic?.texture}</span>
                </div>
              </div>
              <div className="ai-panel-agent">
                <h4>Narrative Agent</h4>
                <p className="ai-panel-note">{panel.narrative?.narrativeNotes}</p>
                <div className="ai-meta">
                  <span className="ai-chip ai-chip--archetype">{panel.narrative?.archetype}</span>
                  <span className="ai-chip ai-chip--sentiment">{panel.narrative?.sentiment}</span>
                  <span className="ai-chip ai-chip--arc">{panel.narrative?.narrativeArc}</span>
                </div>
              </div>
              <div className="ai-panel-agent">
                <h4>Pattern Agent</h4>
                <p className="ai-panel-note">{panel.pattern?.patternNotes}</p>
                <div className="ai-meta">
                  <span className="ai-chip">{panel.pattern?.epochSignal}</span>
                </div>
                {Array.isArray(panel.pattern?.resonances) && panel.pattern.resonances.length > 0 && (
                  <div className="ai-resonances">
                    {panel.pattern.resonances.map((r, i) => (
                      <span key={i} className="ai-resonance">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tweet card (preview + gallery + modal) ─────────────
function cleanTweetText(text) {
  if (!text) return "";
  return text
    .replace(/\s*https?:\/\/t\.co\/\w+/gi, "")
    .replace(/\s*pic\.twitter\.com\/\w+/gi, "")
    .trim();
}

function TweetCard({ tweet, compact }) {
  if (!tweet) return null;
  const t = tweet;
  const mediaItems = Array.isArray(t.media) && t.media.length > 0
    ? t.media.filter((m) => m.url)
    : t.imageUrl ? [{ url: t.imageUrl, type: "photo" }] : [];
  return (
    <div className={`tweet-card${compact ? " tweet-card--compact" : ""}`}>
      <div className="tweet-header">
        {t.authorAvatar && (
          <img className="tweet-avatar" src={t.authorAvatar} alt="" />
        )}
        <div className="tweet-author">
          <span className="tweet-name">{t.authorName || t.username || "Anonymous"}</span>
          {(t.authorHandle || t.username) && (
            <span className="tweet-handle">@{t.authorHandle || t.username}</span>
          )}
        </div>
        {(t.tweetUrl || t.url) && (
          <a
            className="tweet-link"
            href={t.tweetUrl || t.url}
            target="_blank"
            rel="noreferrer"
            title="View on X"
          >
            𝕏
          </a>
        )}
      </div>
      <p className="tweet-text">{cleanTweetText(t.text)}</p>
      {mediaItems.length > 0 && (
        <div className={`tweet-media-grid tweet-media-grid--${Math.min(mediaItems.length, 4)}`}>
          {mediaItems.map((m, i) => (
            <img key={i} className="tweet-media" src={m.url} alt="" loading="lazy" />
          ))}
        </div>
      )}
      {(t.createdAt || t.created_at) && (
        <time className="tweet-time">
          {new Date(t.createdAt || t.created_at).toLocaleString()}
        </time>
      )}
      {t.hashtags?.length > 0 && (
        <div className="tweet-tags">
          {t.hashtags.map((h, i) => (
            <span key={i} className="tweet-tag">#{h}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reconstruct tweet from stored metadata ─────────────
function tweetFromMeta(meta) {
  if (!meta) return null;
  // 3-layer format: metadata.sourcePost
  const sp = meta.sourcePost;
  if (sp && sp.text) {
    return {
      tweetId: null,
      tweetUrl: sp.url,
      text: sp.text,
      authorHandle: sp.username,
      authorName: sp.username,
      authorAvatar: null,
      createdAt: sp.created_at,
      imageUrl: meta.image || null,
      hashtags: (meta.attributes || [])
        .filter((a) => a.trait_type === "Tag" || a.trait_type === "Hashtag")
        .map((a) => a.value?.replace(/^#/, "")),
      media: [],
    };
  }
  // Legacy format: metadata.tweet object
  const tw = meta.tweet;
  if (tw && tw.text) {
    return {
      tweetId: tw.id,
      tweetUrl: tw.url,
      text: tw.text,
      authorHandle: tw.username,
      authorName: tw.username,
      authorAvatar: null,
      createdAt: tw.created_at,
      imageUrl: meta.image || null,
      hashtags: (meta.attributes || [])
        .filter((a) => a.trait_type === "tag" || a.trait_type === "Hashtag")
        .map((a) => a.value?.replace(/^#/, "")),
      media: (tw.media || []).map((u) => (typeof u === "string" ? { url: u } : u)),
    };
  }
  // Legacy format: metadata.properties
  const props = meta.properties;
  if (props?.tweetUrl) {
    return {
      tweetId: props.tweetId,
      tweetUrl: props.tweetUrl,
      text: meta.description,
      authorHandle: props.authorHandle,
      authorName: props.authorName,
      authorAvatar: props.authorAvatar,
      createdAt: props.createdAt,
      imageUrl: meta.image || null,
      hashtags: (meta.attributes || [])
        .filter((a) => a.trait_type === "tag")
        .map((a) => a.value),
      media: props.media || [],
    };
  }
  return null;
}

// ─── Gallery card ───────────────────────────────────────
function Card({ token, onSelect, isSelected }) {
  const t = token;
  const isTweet = !!tweetFromMeta(t.meta);
  const ai = t.meta?.ai;
  const palette = ai?.palette;

  return (
    <article
      className={`card${isSelected ? " card--active" : ""}${ai ? " card--ai" : ""}`}
      onClick={() => onSelect(t)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(t)}
    >
      <div className="card-visual">
        {t.meta?.image ? (
          <img src={ipfs(t.meta.image)} alt={t.meta?.name || `#${t.id}`} loading="lazy" />
        ) : isTweet ? (
          <div className="card-tweet-preview">
            <span className="card-tweet-icon">𝕏</span>
            <p className="card-tweet-snippet">
              {(t.meta?.description || "").slice(0, 120)}
            </p>
          </div>
        ) : (
          <div className="card-placeholder">
            <span>#{t.id}</span>
          </div>
        )}
        {ai && (
          <div className="card-ai-overlay">
            <span className="card-ai-chip card-ai-chip--archetype">{ai.archetype}</span>
            <span className="card-ai-chip card-ai-chip--sentiment">{ai.sentiment}</span>
          </div>
        )}
        {palette && (
          <div
            className="card-palette-bar"
            style={{ background: `linear-gradient(90deg, ${palette.join(", ")})` }}
          />
        )}
      </div>
      <div className="card-body">
        <h3>{t.meta?.name || `Token #${t.id}`}</h3>
        <p className="card-desc">{ai?.summary || t.meta?.description || "Awaiting metadata"}</p>
        <div className="card-footer">
          <span className="card-owner" title={t.owner}>{short(t.owner)}</span>
          {t.chapters.length > 0 && (
            <span className="badge">{t.chapters.length} ch</span>
          )}
          {ai ? (
            <span className="badge badge--motion">{ai.motionMode}</span>
          ) : isTweet ? (
            <span className="badge badge--tweet">tweet</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// ─── Detail modal ───────────────────────────────────────
function Detail({ token, onClose }) {
  const [artifactUrl, setArtifactUrl] = useState(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Render artifact HTML via our API (bypasses Pinata HTML block)
  const meta = token?.meta;
  useEffect(() => {
    if (!meta?.ai || !meta?.animation_url) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/render-artifact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePost: meta.sourcePost || {}, ai: meta.ai }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        if (cancelled) return;
        const blob = new Blob([html], { type: "text/html" });
        setArtifactUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setArtifactUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [meta]);

  if (!token) return null;
  const t = token;
  const tweetData = tweetFromMeta(t.meta);
  const externalUrl = t.meta?.external_url || t.meta?.sourcePost?.url || t.meta?.tweet?.url;
  const aiData = t.meta?.ai;
  const animUrl = t.meta?.animation_url;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {/* Live artifact iframe — rendered server-side to bypass Pinata HTML block */}
        {artifactUrl && (
          <div className="modal-artifact">
            <iframe
              src={artifactUrl}
              title="Live artifact"
              sandbox="allow-scripts"
              className="artifact-iframe"
            />
          </div>
        )}

        {/* Preview image (if no animation) */}
        {!artifactUrl && t.meta?.image ? (
          tweetData ? (
            <TweetCard tweet={tweetData} />
          ) : (
            <img className="modal-img" src={ipfs(t.meta.image)} alt={t.meta?.name || ""} />
          )
        ) : null}

        <h2 className="modal-title">{t.meta?.name || `Token #${t.id}`}</h2>

        {/* AI interpretation section */}
        {aiData && <InterpretationCard ai={aiData} />}

        {/* Source post (if no AI card already shows it) */}
        {!aiData && tweetData && <TweetCard tweet={tweetData} compact />}
        {!aiData && !tweetData && (
          <p className="modal-desc">{t.meta?.description || "No description available."}</p>
        )}

        <dl className="modal-fields">
          <dt>Token</dt><dd>#{t.id}</dd>
          <dt>Owner</dt><dd className="mono">{t.owner}</dd>
          <dt>Author</dt><dd className="mono">{t.author}</dd>
          <dt>Prompt hash</dt><dd className="mono small">{t.hash}</dd>
          {aiData?.epochState && (
            <><dt>Epoch</dt><dd>{aiData.epochState}</dd></>
          )}
          {externalUrl && (
            <>
              <dt>Source</dt>
              <dd>
                <a href={externalUrl} target="_blank" rel="noreferrer">
                  View original ↗
                </a>
              </dd>
            </>
          )}
          {animUrl && (
            <>
              <dt>Artifact</dt>
              <dd>
                <a href={ipfs(animUrl)} target="_blank" rel="noreferrer">
                  View live artifact ↗
                </a>
              </dd>
            </>
          )}
        </dl>

        {t.meta?.attributes?.length > 0 && (
          <section className="modal-attrs">
            <h4>Attributes</h4>
            <div className="attr-grid">
              {t.meta.attributes.map((a, i) => (
                <div key={i} className="attr-chip">
                  <span className="attr-label">{a.trait_type}</span>
                  <span className="attr-val">{a.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {t.chapters.length > 0 && (
          <section className="modal-chapters">
            <h4>Identity timeline</h4>
            <ol className="timeline">
              {t.chapters.map((ch, i) => (
                <li key={i} className="timeline-item">
                  <div className="timeline-dot" />
                  <a href={ipfs(ch)} target="_blank" rel="noreferrer">
                    Chapter {i + 1}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────
function Tabs({ active, onChange, account }) {
  return (
    <div className="tabs">
      <button className={active === "all" ? "active" : ""} onClick={() => onChange("all")}>
        All works
      </button>
      <button className={active === "feed" ? "active" : ""} onClick={() => onChange("feed")}>
        Live feed
      </button>
      {account && (
        <button className={active === "mine" ? "active" : ""} onClick={() => onChange("mine")}>
          My collection
        </button>
      )}
    </div>
  );
}

// ─── Pipeline feed hook ─────────────────────────────────
function usePipelineFeed(active) {
  const [tweets, setTweets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [tweetsRes, statsRes] = await Promise.all([
        api("/api/tweets?limit=100"),
        api("/api/stats"),
      ]);
      setTweets(tweetsRes.tweets || []);
      setStats(statsRes);
    } catch (e) {
      console.error("Feed error:", e.message);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s when active
  useEffect(() => {
    if (!active) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [active, load]);

  return { tweets, stats, loading, reload: load };
}

// ─── Status badge component ─────────────────────────────
function StatusBadge({ status }) {
  const colors = {
    discovered: "badge--discovered",
    eligible: "badge--eligible",
    minting: "badge--minting",
    minted: "badge--minted",
    failed: "badge--failed",
  };
  return <span className={`badge ${colors[status] || ""}`}>{status}</span>;
}

function SourceBadge({ source }) {
  if (source === "farcaster") return <span className="badge badge--farcaster">Farcaster</span>;
  return <span className="badge badge--x">𝕏</span>;
}

// ─── Feed item with inline AI interpretation ───────────
function FeedItem({ tweet, interpretations, onInterpret }) {
  const t = tweet;
  const ai = interpretations[t.tweetId];
  const isInterpreting = ai === "loading";

  return (
    <div className={`feed-item${ai && ai !== "loading" ? " feed-item--interpreted" : ""}`}>
      <div className="feed-item-header">
        <SourceBadge source={t.source} />
        <StatusBadge status={t.status} />
        {ai && ai !== "loading" && (
          <>
            <span className="ai-chip ai-chip--archetype">{ai.archetype}</span>
            <span className="ai-chip ai-chip--sentiment">{ai.sentiment}</span>
          </>
        )}
        <span className="feed-author">
          {t.authorHandle ? `${t.source === "farcaster" ? "" : "@"}${t.authorHandle}` : "anonymous"}
        </span>
        <time className="feed-time">
          {new Date(t.discoveredAt).toLocaleString()}
        </time>
      </div>

      {ai && ai !== "loading" && ai.palette && (
        <div
          className="feed-palette-bar"
          style={{ background: `linear-gradient(90deg, ${ai.palette.join(", ")})` }}
        />
      )}

      {t.authorAvatar && (
        <img className="feed-avatar" src={t.authorAvatar} alt="" />
      )}
      <p className="feed-text">{t.text}</p>

      {ai && ai !== "loading" && (
        <div className="feed-ai-summary">
          <strong className="feed-ai-title">{ai.title}</strong>
          <p className="feed-ai-desc">{ai.summary}</p>
          {Array.isArray(ai.keywords) && (
            <div className="ai-keywords">
              {ai.keywords.map((k, i) => (
                <span key={i} className="ai-kw">{k}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="feed-item-actions">
        {t.url && (
          <a className="feed-link" href={t.url} target="_blank" rel="noreferrer">
            {t.source === "farcaster" ? "View on Warpcast ↗" : "View on X ↗"}
          </a>
        )}
        {!ai && t.status !== "minting" && (
          <button
            className="btn-interpret"
            onClick={(e) => { e.stopPropagation(); onInterpret(t); }}
          >
            AI Interpret
          </button>
        )}
        {isInterpreting && (
          <span className="feed-interpreting">
            <span className="spinner spinner--small" /> Interpreting…
          </span>
        )}
      </div>

      {t.status === "minted" && (
        <div className="feed-minted-info">
          <span className="mono small">Token #{t.mintedTokenId}</span>
          <span className="mono small">Tx: {t.mintTxHash?.slice(0, 16)}…</span>
        </div>
      )}
      {t.status === "failed" && t.errorMessage && (
        <p className="feed-error">{t.errorMessage}</p>
      )}
    </div>
  );
}

// ─── Pipeline feed view ─────────────────────────────────
function FeedView({ tweets, stats, loading, reload }) {
  const [interpretations, setInterpretations] = useState({});

  async function handleInterpret(tweet) {
    setInterpretations((prev) => ({ ...prev, [tweet.tweetId]: "loading" }));
    try {
      const data = await api("/api/interpret-post", {
        method: "POST",
        body: JSON.stringify({
          post: {
            text: tweet.text,
            authorHandle: tweet.authorHandle,
            source: tweet.source,
            hashtags: [],
          },
        }),
      });
      setInterpretations((prev) => ({ ...prev, [tweet.tweetId]: data.interpretation }));
    } catch (e) {
      console.error("Interpret error:", e.message);
      setInterpretations((prev) => {
        const next = { ...prev };
        delete next[tweet.tweetId];
        return next;
      });
    }
  }

  return (
    <div className="feed-view">
      {stats && (
        <div className="feed-stats">
          <span className="stat-pill">Discovered: {stats.discovered}</span>
          <span className="stat-pill">Eligible: {stats.eligible}</span>
          <span className="stat-pill">Minting: {stats.minting}</span>
          <span className="stat-pill stat-pill--minted">Minted: {stats.minted}</span>
          {stats.failed > 0 && (
            <span className="stat-pill stat-pill--failed">Failed: {stats.failed}</span>
          )}
          <span className="stat-pill stat-pill--info">
            Scheduler: {stats.schedulerRunning ? "ON" : "OFF"}
          </span>
          <span className="stat-pill stat-pill--info">
            FC Scheduler: {stats.fcSchedulerRunning ? "ON" : "OFF"}
          </span>
          <span className="stat-pill stat-pill--info">
            Auto-mint: {stats.autoMintEnabled ? "ON" : "OFF"}
          </span>
        </div>
      )}

      {loading && tweets.length === 0 ? (
        <div className="state-msg">
          <div className="spinner" />
          <p>Loading feed…</p>
        </div>
      ) : tweets.length === 0 ? (
        <div className="state-msg">
          <p className="state-emoji">◇</p>
          <p>No posts discovered yet. Schedulers search X and Farcaster every 30 seconds.</p>
        </div>
      ) : (
        <div className="feed-list">
          {tweets.map((t) => (
            <FeedItem
              key={t.tweetId}
              tweet={t}
              interpretations={interpretations}
              onInterpret={handleInterpret}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────
function AppInner() {
  const { account, err: walletErr, onCorrectChain, connect, switchChain } = useWallet();
  const { tokens, total, loading, error, reload } = useGallery();
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("all");

  const feed = usePipelineFeed(tab === "feed");

  const displayed =
    tab === "mine" && account
      ? tokens.filter((t) => t.owner.toLowerCase() === account.toLowerCase())
      : tokens;

  return (
    <div className="app">
      {/* ── Hero ── */}
      <header className="hero">
        <div className="hero-text">
          <h1>
            Imagine<span className="accent"> on Tezos</span>
          </h1>
          <p className="hero-sub">
            Paste a tweet, mint it onchain. Each #imagineontezos post becomes a
            permanent identity artifact on Etherlink.
          </p>
        </div>
        <div className="hero-actions">
          {account ? (
            <div className="wallet-status">
              <span className="wallet-pill">{short(account)}</span>
              {!onCorrectChain && (
                <button className="btn-warn" onClick={switchChain}>
                  Switch to Shadownet
                </button>
              )}
            </div>
          ) : (
            <button className="btn-primary" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {walletErr && <p className="banner banner--error">{walletErr}</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {/* ── Mint form ── */}
      <MintForm
        account={account}
        onCorrectChain={onCorrectChain}
        switchChain={switchChain}
        onMinted={reload}
      />

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <Tabs active={tab} onChange={setTab} account={account} />
        <div className="toolbar-right">
          <span className="pill">{total} minted</span>
          <button
            className="btn-icon"
            onClick={tab === "feed" ? feed.reload : reload}
            disabled={tab === "feed" ? feed.loading : loading}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Feed or Gallery ── */}
      {tab === "feed" ? (
        <FeedView
          tweets={feed.tweets}
          stats={feed.stats}
          loading={feed.loading}
          reload={feed.reload}
        />
      ) : loading ? (
        <div className="state-msg">
          <div className="spinner" />
          <p>Loading from Etherlink…</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="state-msg">
          <p className="state-emoji">◇</p>
          <p>{tab === "mine" ? "You don't own any tokens yet." : "No tokens minted yet."}</p>
        </div>
      ) : (
        <section className="gallery">
          {displayed.map((t) => (
            <Card
              key={t.id}
              token={t}
              isSelected={selected?.id === t.id}
              onSelect={(tok) => setSelected(selected?.id === tok.id ? null : tok)}
            />
          ))}
        </section>
      )}

      <Detail token={selected} onClose={() => setSelected(null)} />

      <footer className="footer">
        <span>Imagine on Tezos</span>
        <span className="footer-sep">·</span>
        <a
          href={`${NETWORK.blockExplorerUrls[0]}/address/${CONTRACT_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          View contract
        </a>
        <span className="footer-sep">·</span>
        <span>Etherlink Shadownet</span>
      </footer>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

export default App;
