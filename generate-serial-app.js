// generate-serial-app.cjs
// This is compiled into SerialGenerator.exe — double-click it, no Node.js
// install needed on the target machine (see README.md for how to rebuild).
//
// Flow implemented here (the "Generator" box in your diagram):
//   Admin Password → Enter Days → Generate Serial → License History (saved
//   to license-history.json next to this file) → send serial to customer.
//
// SETUP — do this once before you rely on it:
//   1. Run `node generate-keypair.mjs` inside the keygen/ folder.
//   2. Paste the PRIVATE key it prints into LICENSE_PRIVATE_KEY below.
//   3. Paste the PUBLIC key it prints into LICENSE_PUBLIC_KEY inside
//      src/utils/license.js (the app side).
//   4. Change ADMIN_GEN_PASSWORD below to your own password.
//   5. Rebuild the exe (see README.md) so these values are baked in.
//
// Never send this file, the .exe, or your private key to anyone but
// yourself — whoever has the private key can mint serials.
const readline = require("node:readline");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const nacl = require("tweetnacl");

// ── Fill these in before building the exe ──────────────────────────────────
const ADMIN_GEN_PASSWORD = "Prodex@2026Gen"; // ⚠️ CHANGE THIS to your own password, then rebuild the exe
const LICENSE_PRIVATE_KEY = "GTLBANIVOLOTYQYWJI4JH2H6BUT6CBOFL6IPOXVEIDHJX6Q4V4IQD45VAZT6CHLD4PEGYO3VE7ZX7GNXLT3RLVEDV7PZGIJHKDNZPDY";
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_FILE = path.join(__dirname, "license-history.json");
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let bits = 0, value = 0, output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function writeUint32BE(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function daysSinceEpoch(date) {
  return Math.floor(date.getTime() / 86400000);
}

function buildPayload(deviceId, expiryDate) {
  const deviceHash = crypto.createHash("sha256").update(deviceId, "utf8").digest().slice(0, 8);
  const expiryDays = expiryDate ? daysSinceEpoch(expiryDate) : 0;
  const payload = new Uint8Array(1 + 8 + 4);
  payload[0] = 1; // version
  payload.set(deviceHash, 1);
  payload.set(writeUint32BE(expiryDays), 9);
  return payload;
}

function signPayload(payload, privateKeyB32) {
  const secretKey = base32Decode(privateKeyB32);
  const sig = nacl.sign.detached(payload, secretKey);
  const full = new Uint8Array(payload.length + sig.length);
  full.set(payload, 0);
  full.set(sig, payload.length);
  return base32Encode(full);
}

function formatSerial(base32Str) {
  return base32Str.match(/.{1,8}/g).join("-");
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch { return []; }
}

function saveHistory(rows) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2));
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("========================================");
  console.log("   Serial Number Generator");
  console.log("========================================\n");

  if (LICENSE_PRIVATE_KEY === "PASTE-YOUR-PRIVATE-KEY-HERE") {
    console.log("This tool isn't set up yet — open this file and paste your");
    console.log("private key into LICENSE_PRIVATE_KEY (see the SETUP notes");
    console.log("at the top of the file), then rebuild the exe.\n");
    return closeAndPause();
  }

  const pw = await ask("Admin password: ");
  if (pw !== ADMIN_GEN_PASSWORD) {
    console.log("\nWrong admin password. Closing.\n");
    return closeAndPause();
  }

  const deviceId = (await ask("\nPaste the customer's Device ID and press Enter: ")).trim();
  if (!deviceId) {
    console.log("\nNo Device ID entered. Nothing generated.\n");
    return closeAndPause();
  }

  const daysStr = await ask("Days valid (0 = lifetime, never expires): ");
  const days = parseInt(daysStr, 10);
  if (Number.isNaN(days) || days < 0) {
    console.log("\nEnter a whole number of days (0 or more). Nothing generated.\n");
    return closeAndPause();
  }
  const expiryDate = days === 0 ? null : new Date(Date.now() + days * 86400000);

  const payload = buildPayload(deviceId, expiryDate);
  const raw = signPayload(payload, LICENSE_PRIVATE_KEY);
  const serial = formatSerial(raw);

  const history = loadHistory();
  history.push({
    deviceId,
    days,
    expiryDate: expiryDate ? expiryDate.toISOString() : null,
    serial,
    issuedAt: new Date().toISOString(),
  });
  saveHistory(history);

  console.log("\nDevice ID: " + deviceId);
  console.log("Valid for: " + (days === 0 ? "Lifetime" : `${days} day(s)`));
  console.log("Expires:   " + (expiryDate ? expiryDate.toISOString().slice(0, 10) : "never"));
  console.log("\nSERIAL (send this to the customer):\n");
  console.log(serial);
  console.log(`\nSaved to license-history.json (${history.length} total serials issued).`);
  console.log("\nSend the serial above back to the customer.");
  closeAndPause();
}

function closeAndPause() {
  console.log("\nPress Enter to close this window...");
  rl.question("", () => { rl.close(); process.exit(0); });
}

main();
