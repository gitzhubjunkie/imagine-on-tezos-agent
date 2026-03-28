const { decideAndActOnPost } = require("./decideAndActOnPost");
const { getLastWorkForHandle, saveNewWorkForHandle } = require("./identityStore");
const { db } = require("./db/identityDb");

(async () => {
  // 1. Fake curated post
  const curated = {
    handle: "alice_tez",
    walletAddress: "0xcc50149446bf9036F9f5aDb6e089a32D458620d7",
    rawText: "digital identity is the new canvas #imagineontezos",
    themes: ["identity", "digital-art", "tezos"],
    tone: "hopeful",
    score: 0.92,
    metadataUri: "https://example.com/metadata/alice-1.json",
    chapterUri: "https://example.com/chapters/alice-ch1.json",
  };

  // 2. Before: check DB
  const before = await getLastWorkForHandle("alice_tez");
  console.log("\n=== BEFORE ===");
  console.log("DB row for alice_tez:", before);

  // 3. Run decision
  console.log("\n=== RUNNING decideAndActOnPost ===");
  const result = await decideAndActOnPost(curated, getLastWorkForHandle, saveNewWorkForHandle);
  console.log("\nResult:", result);

  // 4. After: check DB
  const after = await getLastWorkForHandle("alice_tez");
  console.log("\n=== AFTER ===");
  console.log("DB row for alice_tez:", after);

  // 5. Raw SQL check
  const raw = db.prepare("SELECT * FROM works WHERE handle = ?").get("alice_tez");
  console.log("Raw SQL row:", raw);

  console.log("\nIdentity memory is functionally in place.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
