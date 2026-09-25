// generate-serial-app.cjs  (v5 — short serial + NEW date-based security password)
// ─────────────────────────────────────────────────────────────────────────────
// Flow:
//   Days (letters) → Security password (NEW formula, see below) → Device ID
//   → prints:
//     • SERIAL          — short 16-char code, 4 groups of 4 (XXXX-XXXX-XXXX-XXXX)
//     • (the security password itself is never printed here — it's the gate
//        YOU must already know to use this tool)
//
// ── THE NEW SECURITY-PASSWORD FORMULA (v5) ─────────────────────────────────
// Uses REAL calendar-date addition/subtraction (handles month/year rollover
// automatically — no more "mod 31" trick), then reverses the digits:
//
//   1. today = current date
//   2. plus8Date  = today + 8 days                  (real calendar add)
//   3. startCode  = day-of-month of plus8Date, 2 digits
//   4. expiryDate = today + Days (the license length you type in)
//   5. minus7Date = expiryDate − 7 days              (real calendar subtract)
//   6. expiryCode = day-of-month of minus7Date, 2 digits
//   7. password   = reverse( startCode + expiryCode )   ← whole 4-char string reversed
//
// Worked example (matches what you asked for): today = 23 July 2026, Days = 2
//   plus8Date  = 23 Jul + 8 days = 31 Jul  → startCode  = "31"
//   expiryDate = 23 Jul + 2 days = 25 Jul
//   minus7Date = 25 Jul − 7 days = 18 Jul  → expiryCode = "18"
//   combined   = "31" + "18" = "3118"
//   password   = reverse("3118") = "8113"
//
// This formula lives in THREE places and all three must stay byte-for-byte
// identical or the codes won't match:
//   • this file (generate-serial-app.cjs)
//   • security-password-only.cjs
//   • src/utils/trialPassword.js (and keygen/trial-password-calculator.mjs)
// ─────────────────────────────────────────────────────────────────────────────
//
// ── WHY THE SERIAL IS SHORT (unchanged from v4 — read this once) ───────────
// This uses a much shorter 16-character KEYED code instead of a long
// signed serial:
//   payload = deviceHash(3 bytes) + expiryDays(2 bytes) + MAC(5 bytes)
//           = 10 bytes → base32 → exactly 16 characters, no padding.
// The MAC is HMAC-SHA256(SECRET_KEY, deviceHash + expiryDays) truncated to
// 5 bytes (40 bits). That means:
//   ✔ Still bound to the specific device + expiry date (can't just copy the
//     serial to a different phone or edit the expiry).
//   ✔ Can't be produced without SECRET_KEY (not simple guessable date math).
//   ✘ SECRET_KEY must also live inside the APP (to verify offline) — see
//     src/utils/shortSerial.js. Keep the EXACT SAME STRING in both places.
// ─────────────────────────────────────────────────────────────────────────────

const readline = require("node:readline");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ── Fill these in — MUST match src/utils/shortSerial.js exactly ────────────
const SECRET_KEY = "CHANGE-ME-Prodex-2026-Secret-Key"; // ⚠️ change, then keep in sync with the app
const EPOCH = new Date("2025-01-01T00:00:00Z");         // day-counting reference, must match app
const START_OFFSET_DAYS = 8;  // days added to today for the "start code" step
const EXPIRY_OFFSET_DAYS = 7; // days subtracted from expiry for the "expiry code" step
// ─────────────────────────────────────────────────────────────────────────────

// Where this script (or the packaged .exe) lives, so the history file is
// always written next to it — not next to node.exe or in a temp folder.
const BASE_DIR = path.dirname(process.pkg ? process.execPath : __filename);
const HISTORY_FILE = path.join(BASE_DIR, "license-history.json");
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DAY_LETTER_MAP = { A: "1", B: "2", C: "3", D: "4", E: "5", F: "6", G: "7", H: "8", I: "9", J: "0" };

function base32Encode(bytes) {
  let bits = 0, value = 0, output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { output += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function daysSinceEpoch(date) { return Math.floor((date.getTime() - EPOCH.getTime()) / 86400000); }

function lettersToDays(input) {
  const clean = (input || "").toUpperCase().replace(/[^A-J]/g, "");
  if (!clean) return NaN;
  let digits = "";
  for (const ch of clean) digits += DAY_LETTER_MAP[ch];
  return parseInt(digits, 10);
}

function addCalendarDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function two(n) { return String(n).padStart(2, "0"); }

/** NEW v5 formula — see the big comment block at the top of this file. */
function computeSecurityPassword(today, days) {
  const plus8Date = addCalendarDays(today, START_OFFSET_DAYS);
  const startCode = two(plus8Date.getDate());

  const expiryDate = addCalendarDays(today, days);
  const minus7Date = addCalendarDays(expiryDate, -EXPIRY_OFFSET_DAYS);
  const expiryCode = two(minus7Date.getDate());

  const combined = startCode + expiryCode; // e.g. "3118"
  return combined.split("").reverse().join(""); // e.g. "8113"
}

/** Builds the 16-char keyed serial. days=0 means lifetime (expiryDays=0). */
function buildShortSerial(deviceId, days) {
  const deviceHash = crypto.createHash("sha256").update(deviceId, "utf8").digest().slice(0, 3); // 3 bytes
  const expiryDays = days === 0 ? 0 : daysSinceEpoch(new Date(Date.now() + days * 86400000));
  const expiryBytes = Buffer.alloc(2);
  expiryBytes.writeUInt16BE(expiryDays & 0xffff, 0); // 2 bytes

  const mac = crypto.createHmac("sha256", SECRET_KEY)
    .update(Buffer.concat([deviceHash, expiryBytes]))
    .digest()
    .slice(0, 5); // 5 bytes

  const payload = Buffer.concat([deviceHash, expiryBytes, mac]); // 10 bytes total
  const raw = base32Encode(payload); // exactly 16 chars, no padding
  return raw.match(/.{1,4}/g).join("-"); // XXXX-XXXX-XXXX-XXXX
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch { return []; }
}
function saveHistory(rows) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2)); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) { return new Promise((resolve) => rl.question(question, resolve)); }

async function main() {

  // 1) Days first.
  const daysLetters = await ask("What you want?: ");
  const days = lettersToDays(daysLetters);
  if (Number.isNaN(days)) {
    console.log("\nCouldn't read that — use only letters A through J. Nothing generated.\n");
    return closeAndPause();
  }

  // 2) Security Password now acts as the admin gate for THIS tool — see the
  //    NEW formula explained at the top of this file. Get it by running
  //    security-password-only.cjs first with the same Days.
  const today = new Date();
  const expectedPassword = computeSecurityPassword(today, days);
  const enteredPassword = await ask("\nPassword?: ");
  if (enteredPassword.replace(/\D/g, "") !== expectedPassword) {
    console.log("\nWrong security password for today's date + these days. Nothing generated.\n");
    return closeAndPause();
  }

  // 3) Only now ask for the Device ID.
  const deviceId = (await ask("\nDevice ID: ")).trim();
  if (!deviceId) {
    console.log("\nNo Device ID entered. Nothing generated.\n");
    return closeAndPause();
  }

  // 4) Generate and print ONLY the serial.
  const serial = buildShortSerial(deviceId, days);

  const history = loadHistory();
  history.push({ deviceId, days, serial, issuedAt: today.toISOString() });
  saveHistory(history);

  console.log(serial);
  console.log("");
  closeAndPause();
}

function closeAndPause() {
  console.log("Press ENTER once to close this window...");
  rl.question("", () => {
    rl.close();
    process.exitCode = 0;
    // Force-exit immediately so a packaged .exe never needs a 2nd keypress.
    setImmediate(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("\nUnexpected error:", err && err.message ? err.message : err);
  closeAndPause();
});
