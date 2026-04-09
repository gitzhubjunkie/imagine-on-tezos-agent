/**
 * Generate a self-contained HTML artifact for animation_url.
 * This creates an interactive identity piece rendered from the AI interpretation.
 */
function renderArtifactHtml({ sourcePost, ai }) {
  const palette = ai.palette || ["#0F172A", "#14B8A6", "#F8FAFC", "#6366F1", "#1E293B"];
  const bg = palette[0];
  const accent = palette[1];
  const text = palette[2] || "#F8FAFC";
  const highlight = palette[3] || accent;
  const depth = palette[4] || bg;

  const motionCss = motionStyles(ai.motionMode || "calm");
  const escapedText = escapeHtml(sourcePost.text || "");
  const escapedTitle = escapeHtml(ai.title || "Untitled");
  const escapedSummary = escapeHtml(ai.summary || "");
  const escapedArchetype = escapeHtml(ai.archetype || "Unknown");
  const escapedSentiment = escapeHtml(ai.sentiment || "neutral");
  const escapedAuthor = escapeHtml(sourcePost.username || sourcePost.authorHandle || "anonymous");
  const keywords = (ai.keywords || []).map(escapeHtml);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapedTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@keyframes breathe{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes drift{0%{transform:translate(0,0)}50%{transform:translate(8px,-12px)}100%{transform:translate(0,0)}}
@keyframes pulse-ring{0%{transform:scale(.95);opacity:.4}50%{transform:scale(1.05);opacity:.8}100%{transform:scale(.95);opacity:.4}}
@keyframes fracture{0%{clip-path:inset(0 0 0 0)}25%{clip-path:inset(5% 0 0 3%)}50%{clip-path:inset(0 2% 8% 0)}75%{clip-path:inset(3% 0 0 5%)}100%{clip-path:inset(0 0 0 0)}}
@keyframes bloom-scale{0%{transform:scale(.98);filter:brightness(.9)}50%{transform:scale(1.02);filter:brightness(1.1)}100%{transform:scale(.98);filter:brightness(.9)}}
@keyframes flicker{0%,100%{opacity:1}10%{opacity:.8}30%{opacity:1}50%{opacity:.7}70%{opacity:1}90%{opacity:.85}}
@keyframes glyph-float{0%{transform:translateY(0) rotate(0deg)}100%{transform:translateY(-100vh) rotate(360deg)}}

html,body{width:100%;height:100%;overflow:hidden;background:${bg};color:${text};font-family:"SF Mono",Monaco,"Cascadia Code",monospace}

.canvas{position:relative;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;overflow:hidden}

/* Ambient background layer */
.ambient{position:absolute;inset:0;z-index:0}
.ambient::before{content:"";position:absolute;top:50%;left:50%;width:120%;height:120%;transform:translate(-50%,-50%);background:radial-gradient(ellipse at 30% 40%,${accent}15 0%,transparent 60%),radial-gradient(ellipse at 70% 60%,${highlight}10 0%,transparent 50%);${motionCss.ambient}}
.ambient::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,${bg}08 2px,${bg}08 4px);opacity:.3}

/* Floating glyphs layer */
.glyphs{position:absolute;inset:0;z-index:1;overflow:hidden;opacity:.15}
.glyph{position:absolute;font-size:clamp(10px,2vw,18px);color:${accent};animation:glyph-float linear infinite;opacity:.4}

/* Content */
.content{position:relative;z-index:2;max-width:600px;width:90%;text-align:center;padding:2rem}

.archetype-ring{width:120px;height:120px;border-radius:50%;border:2px solid ${accent};margin:0 auto 1.5rem;display:flex;align-items:center;justify-content:center;${motionCss.ring}}
.archetype-glyph{font-size:2rem;color:${accent};line-height:1}

.title{font-size:clamp(1.2rem,3.5vw,2rem);font-weight:200;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.75rem;color:${text};${motionCss.title}}
.summary{font-size:clamp(.75rem,1.8vw,.95rem);line-height:1.6;color:${text}aa;margin-bottom:1.5rem;font-style:italic}

.post-text{font-size:clamp(.7rem,1.5vw,.85rem);line-height:1.7;color:${text}cc;background:${depth}60;border-left:3px solid ${accent};padding:.75rem 1rem;text-align:left;margin-bottom:1.5rem;max-height:6rem;overflow:hidden;border-radius:0 4px 4px 0}

.meta-row{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem}
.meta-chip{font-size:.65rem;text-transform:uppercase;letter-spacing:.12em;padding:.25rem .6rem;border:1px solid ${accent}40;border-radius:2px;color:${accent}}

.keywords{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem}
.kw{font-size:.6rem;color:${highlight};letter-spacing:.1em;opacity:.7}

.author-line{font-size:.6rem;color:${text}50;letter-spacing:.15em;text-transform:uppercase;margin-top:1rem}

.epoch{position:absolute;bottom:1rem;right:1.5rem;font-size:.55rem;color:${text}30;letter-spacing:.2em;text-transform:uppercase}
.palette-strip{position:absolute;bottom:0;left:0;right:0;height:3px;display:flex}
.palette-bar{flex:1}
</style>
</head>
<body>
<div class="canvas">
  <div class="ambient"></div>
  <div class="glyphs" id="glyphs"></div>

  <div class="content">
    <div class="archetype-ring">
      <span class="archetype-glyph">${archetypeGlyph(ai.archetype)}</span>
    </div>

    <h1 class="title">${escapedTitle}</h1>
    <p class="summary">${escapedSummary}</p>
    <div class="post-text">${escapedText}</div>

    <div class="meta-row">
      <span class="meta-chip">${escapedArchetype}</span>
      <span class="meta-chip">${escapedSentiment}</span>
      <span class="meta-chip">${ai.motionMode || "calm"}</span>
    </div>

    <div class="keywords">
      ${keywords.map((k) => `<span class="kw">· ${k}</span>`).join("\n      ")}
    </div>

    <div class="author-line">@${escapedAuthor}</div>
  </div>

  <span class="epoch">epoch ${ai.epochState || 1}</span>
  <div class="palette-strip">
    ${palette.map((c) => `<div class="palette-bar" style="background:${escapeHtml(c)}"></div>`).join("")}
  </div>
</div>

<script>
(function(){
  var g=document.getElementById("glyphs");
  var chars="◇◆△▽○●□■◈◊▲▼";
  for(var i=0;i<20;i++){
    var s=document.createElement("span");
    s.className="glyph";
    s.textContent=chars[Math.floor(Math.random()*chars.length)];
    s.style.left=Math.random()*100+"%";
    s.style.top=100+Math.random()*20+"%";
    s.style.animationDuration=10+Math.random()*20+"s";
    s.style.animationDelay=-Math.random()*20+"s";
    s.style.fontSize=(.5+Math.random()*1.5)+"rem";
    g.appendChild(s);
  }
})();
</script>
</body>
</html>`;
}

function motionStyles(mode) {
  switch (mode) {
    case "pulse":
      return {
        ambient: "animation:breathe 4s ease-in-out infinite;",
        ring: "animation:pulse-ring 3s ease-in-out infinite;",
        title: "",
      };
    case "fracture":
      return {
        ambient: "animation:breathe 6s ease-in-out infinite;",
        ring: "animation:fracture 8s ease-in-out infinite;",
        title: "animation:flicker 5s ease-in-out infinite;",
      };
    case "bloom":
      return {
        ambient: "animation:breathe 5s ease-in-out infinite;",
        ring: "animation:bloom-scale 6s ease-in-out infinite;",
        title: "",
      };
    case "drift":
      return {
        ambient: "animation:drift 12s ease-in-out infinite;",
        ring: "animation:drift 8s ease-in-out infinite;",
        title: "",
      };
    case "flicker":
      return {
        ambient: "animation:breathe 3s ease-in-out infinite;",
        ring: "animation:flicker 4s ease-in-out infinite;",
        title: "animation:flicker 6s ease-in-out infinite;",
      };
    default: // calm
      return {
        ambient: "animation:breathe 8s ease-in-out infinite;",
        ring: "",
        title: "",
      };
  }
}

function archetypeGlyph(archetype) {
  const map = {
    Builder: "◆",
    Dreamer: "◇",
    Dissenter: "▼",
    Mystic: "◈",
    Observer: "○",
    Pioneer: "▲",
    Guardian: "■",
    Trickster: "◊",
  };
  return map[archetype] || "●";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { renderArtifactHtml };
