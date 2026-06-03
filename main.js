'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  globalShortcut, clipboard, shell, nativeImage, Notification, dialog, net, powerMonitor
} = require('electron');

// net.fetch uses Chromium's network stack (honours system proxy, avoids undici quirks)
const netFetch = (...args) => net.fetch(...args);
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const zlib   = require('zlib');
const os   = require('os');
const { exec } = require('child_process');
const bcrypt  = require('bcryptjs');
const updater = require('./updater');

// ============================================================
// CONSTANTS
// ============================================================
const KEY_LIFETIME_MS     = 24 * 60 * 60 * 1000;
const WARNING_THRESHOLD   = 2  * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS  = 5;
const LOCKOUT_MS          = 5  * 60 * 1000;

const REGIONAL_ROUTING = {
  BR1: 'americas', NA1: 'americas', LAN: 'americas', LAS: 'americas',
  EUW1: 'europe',  EUNE1: 'europe', TR1: 'europe',   RU: 'europe',
  KR: 'asia',      JP1: 'asia',
  OC1: 'sea',      PH2: 'sea',     SG2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea',
};

const SERVER_HOSTS = {
  BR1: 'br1.api.riotgames.com',   NA1:  'na1.api.riotgames.com',
  EUW1: 'euw1.api.riotgames.com', EUNE1:'eun1.api.riotgames.com',
  LAN: 'la1.api.riotgames.com',   LAS:  'la2.api.riotgames.com',
  KR: 'kr.api.riotgames.com',     JP1:  'jp1.api.riotgames.com',
  OC1: 'oc1.api.riotgames.com',   TR1:  'tr1.api.riotgames.com',
  RU: 'ru.api.riotgames.com',
  // SEA servers
  PH2: 'ph2.api.riotgames.com',   SG2:  'sg2.api.riotgames.com',
  TH2: 'th2.api.riotgames.com',   TW2:  'tw2.api.riotgames.com',
  VN2: 'vn2.api.riotgames.com',
};

const TIER_ORDER = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];

// ============================================================
// HTTP STATUS → USER-FRIENDLY MESSAGES  (Bug 1 fix)
// ============================================================
function statusToMessage(status) {
  const map = {
    400: 'Requisição inválida (400) — verifique o Riot ID e a Tag.',
    401: 'Não autorizado (401) — API Key pode ser inválida.',
    403: 'API Key expirada ou inválida (403) — renove em developer.riotgames.com',
    404: 'Jogador não encontrado (404) — verifique o Nickname e a Tag (ex: Nome#BR1).',
    429: 'Limite de requisições atingido (429) — aguarde alguns segundos e tente novamente.',
    500: 'Erro interno da Riot API (500) — tente novamente mais tarde.',
    503: 'Riot API temporariamente indisponível (503) — tente mais tarde.',
  };
  return map[status] || `Erro HTTP ${status} retornado pela Riot API`;
}

// ============================================================
// TRAY ICON GENERATOR  (Bug 4 fix)
// ============================================================
function createPngBuffer(width, height, rgbaPixels) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const lenBuf  = Buffer.allocUnsafe(4);
    const crcBuf  = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    crcBuf.writeUInt32BE(crc32(typeData), 0);
    return Buffer.concat([lenBuf, typeData, crcBuf]);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // RGBA, no interlace

  const rowLen = 1 + width * 4;
  const raw    = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const ri = y * rowLen + 1 + x * 4;
      raw[ri]     = rgbaPixels[pi];
      raw[ri + 1] = rgbaPixels[pi + 1];
      raw[ri + 2] = rgbaPixels[pi + 2];
      raw[ri + 3] = rgbaPixels[pi + 3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createAppIcon() {
  try {
    const size = 32;
    const px   = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i  = (y * size + x) * 4;
        const dx = x - 15.5, dy = y - 15.5;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d <= 12) {
          px[i] = 192; px[i+1] = 57; px[i+2] = 43; px[i+3] = 255; // red fill
        } else if (d <= 13) {
          const a = Math.round(255 * (13 - d));                      // soft edge
          px[i] = 192; px[i+1] = 57; px[i+2] = 43; px[i+3] = a;
        }
        // else: transparent (already 0)
      }
    }
    return nativeImage.createFromBuffer(createPngBuffer(size, size, px));
  } catch (err) {
    console.error('[icon] createAppIcon error:', err.message);
    return nativeImage.createEmpty();
  }
}

// ============================================================
// APP STATE
// ============================================================
let mainWindow     = null;
let tray           = null;
let encryptionKey  = null;
let ddVersion      = null;   // cached Data Dragon version for profile icons
let loginAttempts  = 0;
let lockoutUntil   = 0;      // loaded from disk on startup — survives restarts
let refreshTimer   = null;
let clipboardTimer = null;
let isLoggedIn     = false;
let DATA_PATH;
const refreshingAccounts = new Set(); // IDs currently being refreshed — prevents race conditions

// ============================================================
// CRYPTO HELPERS
// ============================================================
function getMachineId() {
  const cpuModel = (os.cpus()[0] || {}).model || 'cpu';
  return crypto.createHash('sha256')
    .update(os.hostname() + os.userInfo().username + cpuModel)
    .digest('hex');
}

function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function deriveKey(password, salt) {
  const combined = password + ':' + getMachineId();
  return crypto.pbkdf2Sync(combined, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');
}

// Derivação portátil (sem machine ID) — usada para backup .lam
function deriveKeyPortable(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext, key) {
  const [ivH, tagH, encH] = ciphertext.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  d.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([d.update(Buffer.from(encH, 'hex')), d.final()]).toString('utf8');
}

// ============================================================
// STORAGE
// ============================================================
const DEFAULT_DATA = () => ({
  masterPasswordHash: null,
  encryptionSalt: null,
  apiKey: null,
  apiKeySavedAt: null,
  loginAttempts: 0,
  lockoutUntil:  0,   // persisted so lockout survives app restarts
  settings: {
    refreshInterval: 15,
    theme: 'dark',
    closeAction: 'ask',
    notifications: { rankUp: true, rankDown: true, promo: true, apiKeyExpiring: true },
  },
  accounts: [],
});

function readData() {
  try {
    if (fs.existsSync(DATA_PATH))
      return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) { console.error('readData:', e.message); }
  return DEFAULT_DATA();
}

function writeData(data) {
  // Atomic write: write to .tmp then rename — prevents file corruption on crash/power loss.
  // If the process dies between writeFileSync and renameSync the original file is untouched.
  const tmp = DATA_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_PATH);
    return true;
  } catch (e) {
    console.error('writeData:', e.message);
    // Clean up orphaned .tmp file if it exists
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    push('notification', { type: 'error', message: 'Falha ao salvar dados no disco: ' + e.message });
    return false;
  }
}

// ============================================================
// AUTH
// ============================================================
async function setupMasterPassword(password) {
  if (!password || password.length < 6)
    throw new Error('Senha muito curta — mínimo 6 caracteres');
  const data = readData();
  const salt = generateSalt();
  data.masterPasswordHash = await bcrypt.hash(password, 12);
  data.encryptionSalt = salt;
  writeData(data);
  encryptionKey = deriveKey(password, salt);
  isLoggedIn = true;
}

async function verifyPassword(password) {
  const data = readData();
  if (!data.masterPasswordHash) return false;
  const ok = await bcrypt.compare(password, data.masterPasswordHash);
  if (ok) {
    encryptionKey = deriveKey(password, data.encryptionSalt);
    isLoggedIn = true;
  }
  return ok;
}

// ============================================================
// ACCOUNTS
// ============================================================
function publicAccount(a) {
  return {
    id: a.id, nickname: a.nickname, tag: a.tag,
    server: a.server, tags: a.tags, notes: a.notes,
    puuid: a.puuid, summonerId: a.summonerId, profileIconId: a.profileIconId ?? null,
    currentRank: a.currentRank, flexRank: a.flexRank || null, champions: a.champions,
    history: a.history || [], flexHistory: a.flexHistory || [], lastUpdated: a.lastUpdated,
    accountType: a.accountType || 'full',
  };
}

function getAccounts() {
  return readData().accounts.map(publicAccount);
}

function addAccount(d) {
  const data = readData();
  const id = crypto.randomUUID();
  // Strip leading '#' from tag — e.g. "#BR1" → "BR1"  (Bug 1 fix)
  const tag = String(d.tag || '').replace(/^#+/, '').trim();
  const isWatched = d.accountType === 'watched';
  data.accounts.push({
    id, nickname: d.nickname, tag,
    accountType: isWatched ? 'watched' : 'full',
    login:    isWatched ? null : encrypt(d.login,    encryptionKey),
    password: isWatched ? null : encrypt(d.password, encryptionKey),
    server: d.server, tags: d.tags || [], notes: d.notes || '',
    puuid: d.puuid || null, summonerId: null, profileIconId: null,
    currentRank: null, flexRank: null, champions: null, history: [], flexHistory: [], lastUpdated: null,
  });
  writeData(data);
  return id;
}

function updateAccount(id, u) {
  const data = readData();
  const a = data.accounts.find(x => x.id === id);
  if (!a) return false;
  const fields = ['nickname','tag','server','tags','notes','puuid','summonerId','profileIconId','currentRank','flexRank','champions','history','flexHistory','lastUpdated'];
  fields.forEach(f => {
    if (u[f] !== undefined) {
      // Strip leading '#' from tag on update too  (Bug 1 fix)
      a[f] = (f === 'tag') ? String(u[f]).replace(/^#+/, '').trim() : u[f];
    }
  });
  if (u.login    !== undefined) a.login    = encrypt(u.login, encryptionKey);
  if (u.password !== undefined) a.password = encrypt(u.password, encryptionKey);
  writeData(data);
  return true;
}

function deleteAccount(id) {
  const data = readData();
  const i = data.accounts.findIndex(x => x.id === id);
  if (i === -1) return false;
  data.accounts.splice(i, 1);
  writeData(data);
  return true;
}

function getCredentials(id) {
  const a = readData().accounts.find(x => x.id === id);
  if (!a || !encryptionKey) return null;
  if (a.accountType === 'watched') return null;  // watched accounts have no credentials
  return { login: decrypt(a.login, encryptionKey), password: decrypt(a.password, encryptionKey) };
}

// ============================================================
// RIOT API — Rate limiter
// ============================================================
const queue = [];
let processing = false, rps = 0, rpm = 0, rpsStart = Date.now(), rpmStart = Date.now();

async function riotRequest(url, key) {
  return new Promise((res, rej) => { queue.push({ url, key, res, rej }); processQueue(); });
}

async function processQueue() {
  if (processing || !queue.length) return;
  processing = true;
  while (queue.length) {
    const now = Date.now();
    if (now - rpsStart >= 1000)  { rps = 0; rpsStart = now; }
    if (now - rpmStart >= 120000) { rpm = 0; rpmStart = now; }
    if (rps >= 18 || rpm >= 95) {
      const wait = rps >= 18 ? 1000 - (now - rpsStart) + 100 : 120000 - (now - rpmStart) + 100;
      await sleep(wait); continue;
    }
    const { url, key, res, rej } = queue.shift();
    rps++; rpm++;
    try {
      const r = await netFetch(url, { headers: { 'X-Riot-Token': key } });
      if (r.status === 429) {
        const after = parseInt(r.headers.get('Retry-After') || '2', 10);
        await sleep(after * 1000);
        queue.unshift({ url, key, res, rej }); rps--; rpm--; continue;
      }
      if (!r.ok) {
        const err = new Error(statusToMessage(r.status));
        err.status = r.status;
        rej(err);
        continue;
      }
      res(await r.json());
    } catch (e) {
      // Network-level errors (no connection, DNS failure, etc.)
      if (!e.status) e.message = `Erro de rede: ${e.message || 'sem conexão'}`;
      rej(e);
    }
  }
  processing = false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getDDVersion() {
  if (ddVersion) return ddVersion;
  try {
    const r = await netFetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (r.ok) { const list = await r.json(); ddVersion = list[0] || '15.10.1'; }
    else       { ddVersion = '15.10.1'; }
  } catch    { ddVersion = '15.10.1'; }
  return ddVersion;
}

async function getApiKey() {
  const d = readData();
  if (!d.apiKey || !encryptionKey) return null;
  try { return decrypt(d.apiKey, encryptionKey); } catch { return null; }
}

async function refreshAccount(id) {
  // ── Phase 1: snapshot for reading current state (puuid / summonerId) ─────
  const snap = readData();
  const acct = snap.accounts.find(a => a.id === id);
  if (!acct) throw new Error('Conta não encontrada');

  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('API Key não configurada');

  const region = REGIONAL_ROUTING[acct.server] || 'americas';
  const host   = SERVER_HOSTS[acct.server]    || 'br1.api.riotgames.com';

  // ── Phase 2: ALL Riot API calls — results stored in LOCAL variables ───────
  // (no writeData here — this prevents the race condition where a new API key
  //  saved while these async calls are in-flight would be silently overwritten)
  let puuid         = acct.puuid;
  let summonerId    = acct.summonerId;
  let profileIconId = acct.profileIconId ?? null;

  if (!puuid) {
    // Primary: continental ACCOUNT-V1 (proper Riot ID — works with production/personal keys)
    // Fallback: regional SUMMONER-V4 by-name (works with development keys that lack
    //   continental routing access — returns puuid + summonerId in a single call)
    try {
      const info = await riotRequest(
        `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(acct.nickname)}/${encodeURIComponent(acct.tag)}`,
        apiKey
      );
      puuid = info.puuid;
    } catch (e) {
      if (e.status !== 403) throw e;   // only swallow 403 (permission denied for dev key)
      // Dev-key fallback — summoner name is usually the same as the game name in BR/LATAM
      try {
        const s = await riotRequest(
          `https://${host}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(acct.nickname)}`,
          apiKey
        );
        puuid         = s.puuid;
        summonerId    = s.id;   // grab summonerId here too — saves one extra round-trip
        profileIconId = profileIconId ?? s.profileIconId ?? null;
      } catch (e2) {
        if (e2.status === 403) {
          // Both endpoints blocked — this happens with Development Keys.
          // Signal the frontend that the user must enter the PUUID manually in the edit modal.
          const err = new Error(
            'PUUID_REQUIRED: Chave de desenvolvimento não tem acesso aos endpoints de busca por nome. ' +
            'Edite a conta e preencha o campo PUUID (obtenha em developer.riotgames.com → API Explorer).'
          );
          err.status = 403;
          err.puuidRequired = true;
          throw err;
        }
        throw e2;
      }
    }
  }

  // ── Ranked entries — try newest PUUID-based endpoint first, fall back to summonerId ──
  // Development keys often cannot access league/v4/entries/by-summoner (403).
  // league/v4/entries/by-puuid is a newer endpoint that may work where by-summoner doesn't.
  let entries;
  try {
    entries = await riotRequest(
      `https://${host}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
      apiKey
    );
  } catch (eLeaguePuuid) {
    // Endpoint not available (404) or blocked (403) — fall back to summonerId approach
    if (!summonerId) {
      try {
        const s = await riotRequest(
          `https://${host}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
          apiKey
        );
        if (!s || !s.id) throw new Error('Summoner não encontrado no servidor ' + host);
        summonerId    = s.id;
        profileIconId = profileIconId ?? s.profileIconId ?? null;
      } catch (eSum) {
        const step = `summoner/by-puuid [${host}]`;
        throw Object.assign(new Error(`STEP:${step} → ${eSum.message}`), { status: eSum.status });
      }
    }
    try {
      entries = await riotRequest(
        `https://${host}/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`,
        apiKey
      );
    } catch (eLeagueSumm) {
      if (eLeagueSumm.status === 403 || eLeagueSumm.status === 401) {
        // Both league endpoints blocked — dev key restriction on ranked data
        throw Object.assign(
          new Error(
            'LEAGUE_BLOCKED: Endpoints de rank bloqueados (403) para esta chave de desenvolvimento. ' +
            'É necessária uma Personal API Key em developer.riotgames.com.'
          ),
          { status: 403 }
        );
      }
      const step = `league/by-summoner [${host}]`;
      throw Object.assign(new Error(`STEP:${step} → ${eLeagueSumm.message}`), { status: eLeagueSumm.status });
    }
  }
  const solo    = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');
  const flex    = entries.find(e => e.queueType === 'RANKED_FLEX_SR');
  const prevRank = acct.currentRank;

  const currentRank = solo
    ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses, inPromo: !!solo.miniSeries }
    : { tier: 'UNRANKED', division: '', lp: 0, wins: 0, losses: 0, inPromo: false };

  const flexRank = flex
    ? { tier: flex.tier, division: flex.rank, lp: flex.leaguePoints, wins: flex.wins, losses: flex.losses }
    : { tier: 'UNRANKED', division: '', lp: 0, wins: 0, losses: 0 };

  // Non-critical: fetch profile icon if not yet captured from a summoner endpoint.
  // Only runs once per account (when icon has never been fetched before).
  if (profileIconId === null && puuid) {
    try {
      const sIcon = await riotRequest(
        `https://${host}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
        apiKey
      );
      if (sIcon?.profileIconId != null) profileIconId = sIcon.profileIconId;
    } catch { /* icon is cosmetic — silently ignore failures */ }
  }

  const now      = new Date().toISOString();
  const histEntry = { timestamp: now, tier: currentRank.tier, division: currentRank.division, lp: currentRank.lp };

  // ── Phase 3: ATOMIC WRITE — re-read the LATEST file state before writing ──
  // This guarantees that concurrent changes (e.g. a new API key saved while
  // the API calls above were in-flight) are not overwritten.
  const live     = readData();
  const liveAcct = live.accounts.find(a => a.id === id);
  if (!liveAcct) throw new Error('Conta removida durante atualização');

  liveAcct.puuid        = puuid;
  liveAcct.summonerId   = summonerId;
  liveAcct.profileIconId = profileIconId ?? liveAcct.profileIconId ?? null;
  liveAcct.currentRank  = currentRank;
  liveAcct.flexRank    = flexRank;
  liveAcct.lastUpdated = now;
  if (!liveAcct.history) liveAcct.history = [];
  // Only record a new entry when tier, division or LP actually changed — avoids
  // polluting the chart with duplicate points from consecutive refreshes with no games played.
  const lastHist = liveAcct.history[liveAcct.history.length - 1];
  const rankChanged = !lastHist ||
    lastHist.tier !== histEntry.tier ||
    lastHist.division !== histEntry.division ||
    lastHist.lp !== histEntry.lp;
  if (rankChanged) {
    liveAcct.history.push(histEntry);
    if (liveAcct.history.length > 100) liveAcct.history = liveAcct.history.slice(-100);
  }

  // Flex history — only record ranked flex entries (skip UNRANKED)
  if (!liveAcct.flexHistory) liveAcct.flexHistory = [];
  if (flexRank.tier !== 'UNRANKED') {
    const flexHistEntry = { timestamp: now, tier: flexRank.tier, division: flexRank.division, lp: flexRank.lp };
    const lastFlex      = liveAcct.flexHistory[liveAcct.flexHistory.length - 1];
    const flexChanged   = !lastFlex ||
      lastFlex.tier !== flexHistEntry.tier ||
      lastFlex.division !== flexHistEntry.division ||
      lastFlex.lp !== flexHistEntry.lp;
    if (flexChanged) {
      liveAcct.flexHistory.push(flexHistEntry);
      if (liveAcct.flexHistory.length > 100) liveAcct.flexHistory = liveAcct.flexHistory.slice(-100);
    }
  }

  writeData(live);

  push('rankUpdate', { accountId: id, rankData: currentRank, flexRankData: flexRank, profileIconId });

  // Rank change notifications
  if (prevRank && currentRank.tier !== 'UNRANKED' && prevRank.tier !== 'UNRANKED') {
    const pi = TIER_ORDER.indexOf(prevRank.tier), ci = TIER_ORDER.indexOf(currentRank.tier);
    if (ci > pi) notify('rankUp',   `${acct.nickname} subiu para ${currentRank.tier} ${currentRank.division}!`);
    if (ci < pi) notify('rankDown', `${acct.nickname} desceu para ${currentRank.tier} ${currentRank.division}`);
  }
  if (currentRank.inPromo) notify('promo', `${acct.nickname} está em promoção no ${currentRank.tier} ${currentRank.division}!`);

  return { currentRank, flexRank };
}

async function refreshAll() {
  for (const a of getAccounts()) {
    // Use the same lock used by riot:fetchRanking to prevent concurrent refreshes
    if (refreshingAccounts.has(a.id)) continue;
    refreshingAccounts.add(a.id);
    try { await refreshAccount(a.id); await sleep(300); }
    catch (e) { console.error('refresh err:', e.message); }
    finally { refreshingAccounts.delete(a.id); }
  }
  updateTrayMenu();
}

// ============================================================
// API KEY STATUS
// ============================================================
function apiKeyStatus() {
  const d = readData();
  if (!d.apiKey || !d.apiKeySavedAt) return { status: 'missing', remaining: 0 };
  const rem = KEY_LIFETIME_MS - (Date.now() - d.apiKeySavedAt);
  if (rem <= 0)               return { status: 'expired',  remaining: 0 };
  if (rem <= WARNING_THRESHOLD) return { status: 'warning',  remaining: rem };
  return { status: 'valid', remaining: rem };
}

function checkApiKeyExpiry() {
  const s = apiKeyStatus();
  push('apiKeyStatus', s);
  if (s.status === 'expired') notify('apiKeyExpired', 'API Key expirada! Clique para renovar agora.');
  else if (s.status === 'warning') {
    const h = Math.floor(s.remaining / 3600000), m = Math.floor((s.remaining % 3600000) / 60000);
    notify('apiKeyExpiring', `Sua API Key expira em ${h}h ${m}min. Clique para renovar.`);
  }
}

// ============================================================
// HELPERS
// ============================================================
function push(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function notify(type, body) {
  // Check user's notification preferences before firing
  const notifSettings = readData().settings?.notifications;
  if (notifSettings) {
    // 'apiKeyExpired' shares the same toggle as 'apiKeyExpiring'
    const key = type === 'apiKeyExpired' ? 'apiKeyExpiring' : type;
    if (notifSettings[key] === false) return;
  }
  if (Notification.isSupported()) new Notification({ title: 'LoL Account Manager', body }).show();
  push('notification', { type, message: body });
}

function formatRank(r) {
  if (!r || r.tier === 'UNRANKED') return 'Sem Rank';
  if (['MASTER','GRANDMASTER','CHALLENGER'].includes(r.tier)) return `${r.tier} ${r.lp} LP`;
  return `${r.tier} ${r.division} ${r.lp} LP`;
}

function setupRefreshTimer(interval) {
  if (refreshTimer) clearInterval(refreshTimer);
  if (!interval || interval <= 0) return;
  refreshTimer = setInterval(() => { if (isLoggedIn) { refreshAll(); checkApiKeyExpiry(); } }, interval * 60000);
}

// ============================================================
// WINDOWS
// ============================================================
function createLoginWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); }
  mainWindow = new BrowserWindow({
    width: 480, height: 600, resizable: false, center: true, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'login.html'));
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = new BrowserWindow({
    width: 1610, height: 740, minWidth: 1100, minHeight: 600, center: true, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('close', e => {
    const action = readData().settings?.closeAction || 'ask';
    if (action === 'tray')  { e.preventDefault(); mainWindow.hide(); }
    else if (action === 'ask') { e.preventDefault(); push('closeRequest', {}); }
    else { app.quit(); }   // action === 'close': fully quit (destroys tray via before-quit)
  });
}

// ============================================================
// TRAY
// ============================================================
function setupTray() {
  // The watcher build ships src/assets/icons/tray-watcher.png (eye icon).
  // If that file is present we're running the watcher build; otherwise use
  // tray.png or fall back to the generated red-circle (createAppIcon).
  const watcherIcon = path.join(__dirname, 'src', 'assets', 'icons', 'tray-watcher.png');
  const mainIcon    = path.join(__dirname, 'src', 'assets', 'icons', 'tray.png');
  const iconPath    = fs.existsSync(watcherIcon) ? watcherIcon : mainIcon;
  const icon        = fs.existsSync(iconPath) ? iconPath : createAppIcon();
  try { tray = new Tray(icon); } catch { tray = new Tray(nativeImage.createEmpty()); }
  tray.setToolTip('LoL Account Manager');
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const accounts = isLoggedIn ? getAccounts() : [];
  const items = accounts.slice(0, 10).map(a => ({
    label: `${a.nickname} | ${formatRank(a.currentRank)}`,
    click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir LoL Account Manager', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    ...items,
    { type: 'separator' },
    { label: 'Atualizar Todos', click: () => { if (isLoggedIn) refreshAll(); } },
    { label: 'Configurações', click: () => { mainWindow?.show(); push('navigate', 'settings'); } },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
}

// ============================================================
// IPC HANDLERS
// ============================================================

// — Auth —
ipcMain.handle('auth:isSetup', () => !!readData().masterPasswordHash);

ipcMain.handle('auth:setup', async (_, pwd) => {
  try { await setupMasterPassword(pwd); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('auth:login', async (_, pwd) => {
  const now = Date.now();
  if (lockoutUntil > now) return { success: false, error: `Bloqueado por ${Math.ceil((lockoutUntil - now) / 1000)}s` };
  try {
    const ok = await verifyPassword(pwd);
    if (ok) {
      loginAttempts = 0;
      lockoutUntil  = 0;
      // Clear persisted lockout so restart doesn't re-apply it on a successful login
      const d = readData(); d.loginAttempts = 0; d.lockoutUntil = 0; writeData(d);
      return { success: true };
    }
    loginAttempts++;
    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      lockoutUntil  = now + LOCKOUT_MS;
      loginAttempts = 0;
      const d = readData(); d.lockoutUntil = lockoutUntil; d.loginAttempts = 0; writeData(d);
      return { success: false, error: 'Bloqueado por 5 minutos.' };
    }
    const d = readData(); d.loginAttempts = loginAttempts; writeData(d);
    return { success: false, error: `Senha incorreta. ${MAX_LOGIN_ATTEMPTS - loginAttempts} tentativas restantes.` };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('auth:logout', () => {
  encryptionKey = null; isLoggedIn = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  createLoginWindow(); return { success: true };
});

ipcMain.handle('auth:changePassword', async (_, { oldPwd, newPwd }) => {
  const ok = await verifyPassword(oldPwd);
  if (!ok) return { success: false, error: 'Senha atual incorreta' };
  try {
    const data = readData();
    const oldKey = encryptionKey;
    const newSalt = generateSalt();
    const newKey  = deriveKey(newPwd, newSalt);
    for (const a of data.accounts) {
      // Watched accounts have no credentials (null) — skip them
      if (a.accountType === 'watched' || !a.login || !a.password) continue;
      a.login    = encrypt(decrypt(a.login,    oldKey), newKey);
      a.password = encrypt(decrypt(a.password, oldKey), newKey);
    }
    if (data.apiKey) data.apiKey = encrypt(decrypt(data.apiKey, oldKey), newKey);
    data.masterPasswordHash = await bcrypt.hash(newPwd, 12);
    data.encryptionSalt = newSalt;
    writeData(data);
    encryptionKey = newKey;
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// — Accounts —
ipcMain.handle('accounts:getAll',        ()          => isLoggedIn ? getAccounts() : []);
ipcMain.handle('accounts:add',           (_, d)      => { try { return { success: true, id: addAccount(d) }; } catch(e) { return { success: false, error: e.message }; } });
ipcMain.handle('accounts:update',        (_, {id,u}) => { try { updateAccount(id, u); return { success: true }; } catch(e) { return { success: false, error: e.message }; } });
ipcMain.handle('accounts:delete',        (_, id)     => { try { deleteAccount(id); return { success: true }; } catch(e) { return { success: false, error: e.message }; } });
ipcMain.handle('accounts:reorder', (_, ids) => {
  try {
    const data = readData();
    const map  = {};
    data.accounts.forEach(a => { map[a.id] = a; });
    data.accounts = ids.map(id => map[id]).filter(Boolean);
    writeData(data);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
});
ipcMain.handle('accounts:getCredentials',(_, id)     => isLoggedIn ? getCredentials(id) : null);

// — Riot API —
ipcMain.handle('riot:fetchRanking', async (_, id) => {
  if (!isLoggedIn) return { success: false, error: 'Não autenticado' };
  // Prevent concurrent refreshes of the same account (race condition → history entry loss)
  if (refreshingAccounts.has(id)) return { success: false, error: 'Atualização já em andamento para esta conta.' };
  refreshingAccounts.add(id);
  try {
    const rankData = await refreshAccount(id);
    updateTrayMenu();
    return { success: true, rankData };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      push('apiKeyStatus', apiKeyStatus());
    }
    return { success: false, error: e.message || 'Erro desconhecido' };
  } finally {
    refreshingAccounts.delete(id);
  }
});

ipcMain.handle('riot:fetchAllRankings', async () => {
  if (!isLoggedIn) return { success: false };
  try { await refreshAll(); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('riot:lookupPuuid', async (_, { nickname, tag, server }) => {
  const apiKey = await getApiKey();
  if (!apiKey) return { found: false, error: 'API Key não configurada' };
  const region = REGIONAL_ROUTING[server] || 'americas';
  const host   = SERVER_HOSTS[server]    || 'br1.api.riotgames.com';
  // Try continental ACCOUNT-V1 first (works with personal/production keys)
  try {
    const info = await riotRequest(
      `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(nickname)}/${encodeURIComponent(tag)}`,
      apiKey
    );
    return { found: true, puuid: info.puuid };
  } catch (e) {
    if (e.status !== 403) return { found: false, error: e.message };
  }
  // Fallback: SUMMONER-V4 by-name (works for legacy accounts on dev keys — deprecated but may still resolve)
  try {
    const s = await riotRequest(
      `https://${host}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(nickname)}`,
      apiKey
    );
    return { found: true, puuid: s.puuid };
  } catch (e) {
    return {
      found: false,
      error: '403',
      devKeyBlocked: true,
    };
  }
});

ipcMain.handle('ddragon:getVersion', async () => await getDDVersion());

ipcMain.handle('riot:fetchChampions', async (_, id) => {
  if (!isLoggedIn) return { success: false };
  try {
    // Phase 1: snapshot for reading current puuid
    const snap = readData();
    const acct = snap.accounts.find(a => a.id === id);
    if (!acct) return { success: false, error: 'Conta não encontrada' };
    const apiKey = await getApiKey();
    if (!apiKey) return { success: false, error: 'API Key não configurada' };
    const region = REGIONAL_ROUTING[acct.server] || 'americas';
    const host   = SERVER_HOSTS[acct.server]    || 'br1.api.riotgames.com';

    // Phase 2: all API calls — store in local variables, no writes yet
    let puuid = acct.puuid;
    if (!puuid) {
      try {
        const i = await riotRequest(`https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(acct.nickname)}/${encodeURIComponent(acct.tag)}`, apiKey);
        puuid = i.puuid;
      } catch (e) {
        if (e.status !== 403) throw e;
        const s = await riotRequest(`https://${host}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(acct.nickname)}`, apiKey);
        puuid = s.puuid;
      }
    }
    const masteries = await riotRequest(`https://${host}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`, apiKey);

    // Phase 3: atomic write — re-read fresh data before writing
    const live = readData();
    const liveAcct = live.accounts.find(a => a.id === id);
    if (liveAcct) {
      liveAcct.puuid     = puuid;
      liveAcct.champions = { total: masteries.length, lastUpdated: new Date().toISOString() };
      writeData(live);
    }

    return { success: true, masteries: masteries.slice(0, 50) };
  } catch (e) { return { success: false, error: e.message || 'Erro ao buscar campeões' }; }
});

// — API Key —
ipcMain.handle('apiKey:getStatus', () => apiKeyStatus());

ipcMain.handle('apiKey:save', async (_, rawKey) => {
  if (!isLoggedIn) return { success: false, error: 'Não autenticado' };
  try {
    // Strip all whitespace and invisible Unicode chars that can corrupt the key when pasted
    //   = NBSP, ­ = soft-hyphen, ​-‍ = zero-width space/non-joiner/joiner
    // ⁠ = word-joiner, ﻿ = BOM
    const key = String(rawKey || '').replace(/[\s\u00A0\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, '');
    if (!key)                    return { success: false, error: 'Chave vazia após sanitização — verifique o campo' };
    if (!key.startsWith('RGAPI-')) return { success: false, error: 'Formato inválido — a chave deve começar com RGAPI-' };

    const data = readData();
    data.apiKey       = encrypt(key, encryptionKey);
    data.apiKeySavedAt = Date.now();
    writeData(data);
    setupRefreshTimer(data.settings?.refreshInterval || 15);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('apiKey:validate', async (_, key) => {
  try {
    const r = await netFetch('https://br1.api.riotgames.com/lol/status/v4/platform-data', { headers: { 'X-Riot-Token': key } });
    if (r.status === 200) return { valid: true };
    if (r.status === 401) return { valid: false, error: 'Chave rejeitada pela Riot (401) — pode haver espaços ou caracteres invisíveis. Tente copiar a chave novamente.' };
    if (r.status === 403) return { valid: false, error: 'API Key inválida ou expirada (403) — gere uma nova em developer.riotgames.com' };
    if (r.status === 429) return { valid: false, error: 'Muitas tentativas (429) — aguarde alguns segundos e tente novamente' };
    if (r.status >= 500)  return { valid: false, error: `Riot API indisponível (${r.status}) — tente novamente em instantes` };
    return { valid: false, error: `Erro inesperado da Riot API (HTTP ${r.status})` };
  } catch (e) { return { valid: false, error: `Erro de rede ao validar: ${e.message}` }; }
});

// Diagnostic: tests the STORED key (decrypted) against Riot API and returns detailed info
ipcMain.handle('apiKey:testStored', async () => {
  const key = await getApiKey();
  if (!key) return { ok: false, stored: false, message: 'Nenhuma chave armazenada no app.' };

  const masked = key.substring(0, 12) + '****' + key.slice(-4);
  const len    = key.length;

  try {
    const r = await netFetch('https://br1.api.riotgames.com/lol/status/v4/platform-data', { headers: { 'X-Riot-Token': key } });
    let body = '';
    try { body = await r.text(); } catch {}
    return {
      ok: r.status === 200,
      stored: true,
      masked,
      len,
      httpStatus: r.status,
      message: r.status === 200
        ? `✅ Chave aceita pela Riot (${masked})`
        : `❌ Riot retornou ${r.status} para a chave ${masked} (${len} chars)`,
      rawBody: body.substring(0, 200),
    };
  } catch (e) {
    return { ok: false, stored: true, masked, len, message: `Erro de rede: ${e.message}` };
  }
});

ipcMain.handle('apiKey:openRenewalPage', () => shell.openExternal('https://developer.riotgames.com/'));

// — Settings —
ipcMain.handle('settings:get', () => readData().settings || {});
ipcMain.handle('settings:set', async (_, {key, value}) => {
  const data = readData();
  if (!data.settings) data.settings = {};
  data.settings[key] = value;
  writeData(data);
  if (key === 'refreshInterval') setupRefreshTimer(value);
  return { success: true };
});

// — Clipboard —
ipcMain.handle('clipboard:copy', async (_, { id, field }) => {
  if (!isLoggedIn) return { success: false };
  const creds = getCredentials(id);
  if (!creds) return { success: false, error: 'Credenciais não encontradas' };
  const val = field === 'login' ? creds.login : creds.password;
  clipboard.writeText(val);
  if (clipboardTimer) clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(() => { try { if (clipboard.readText() === val) clipboard.clear(); } catch {} }, 30000);
  return { success: true };
});

// — Tools —
ipcMain.handle('tools:killRiotProcesses', () => new Promise(res => {
  const procs = ['RiotClientServices.exe','LeagueClient.exe','LeagueClientUx.exe','League of Legends.exe'];
  let n = procs.length;
  procs.forEach(p => exec(`taskkill /F /IM "${p}"`, () => { if (--n === 0) res({ success: true }); }));
}));

ipcMain.handle('tools:clearClientCache', () => {
  const base = process.env.LOCALAPPDATA || '';
  // Both Cache (HTTP/assets) and GPUCache (compiled shaders) can cause visual glitches
  const targets = [
    path.join(base, 'Riot Games', 'Riot Client', 'Cache'),
    path.join(base, 'Riot Games', 'Riot Client', 'GPUCache'),
  ];
  let cleared = 0;
  const errors = [];
  for (const p of targets) {
    if (!fs.existsSync(p)) continue;   // already clean — not an error
    try {
      fs.rmSync(p, { recursive: true, force: true });
      cleared++;
    } catch (e) {
      errors.push(path.basename(p) + ': ' + e.message);
    }
  }
  if (errors.length) return { success: false, error: errors.join(' | ') };
  if (cleared === 0)  return { success: true,  message: 'Cache já estava limpo — nenhum arquivo removido.' };
  return { success: true, message: `Cache limpo com sucesso! (${cleared} pasta${cleared > 1 ? 's' : ''} removida${cleared > 1 ? 's' : ''})` };
});

ipcMain.handle('tools:repairClient', () => {
  const local    = process.env.LOCALAPPDATA  || '';
  const pf       = process.env.ProgramFiles  || 'C:\\Program Files';
  const pf86     = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  // Cover: Riot Client lockfile + LoL lockfile in every common install location
  const lockPaths = [
    path.join(local, 'Riot Games', 'Riot Client', 'lockfile'),
    path.join('C:\\Riot Games',        'League of Legends', 'lockfile'),
    path.join('D:\\Riot Games',        'League of Legends', 'lockfile'),
    path.join(pf,    'Riot Games',     'League of Legends', 'lockfile'),
    path.join(pf86,  'Riot Games',     'League of Legends', 'lockfile'),
  ];
  const removed = [];
  const errors  = [];
  for (const p of lockPaths) {
    if (!fs.existsSync(p)) continue;
    try { fs.unlinkSync(p); removed.push(path.dirname(p).split(path.sep).slice(-2).join('/')); }
    catch (e) { errors.push(e.message); }
  }
  if (errors.length)   return { success: false, error: 'Erro ao remover lockfile: ' + errors.join(' | ') };
  if (!removed.length) return { success: true,  message: 'Nenhum lockfile encontrado — cliente parece saudável.' };
  return { success: true, message: `Lockfile removido em: ${removed.join(', ')}` };
});

ipcMain.handle('tools:openDataFolder', () => { shell.openPath(app.getPath('userData')); return { success: true }; });

// — Backup (.lam) —
ipcMain.handle('backup:export', async (_, { password }) => {
  if (!isLoggedIn || !encryptionKey) return { success: false, error: 'Não autenticado' };
  const data = readData();
  const ok = await bcrypt.compare(password, data.masterPasswordHash);
  if (!ok) return { success: false, error: 'Senha incorreta' };

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar Backup .lam',
    defaultPath: `lam-backup-${new Date().toISOString().slice(0, 10)}.lam`,
    filters: [{ name: 'LoL Account Manager Backup', extensions: ['lam'] }],
  });
  if (canceled || !filePath) return { success: false, canceled: true };

  try {
    const portableSalt = generateSalt();
    const portableKey  = deriveKeyPortable(password, portableSalt);

    const exportAccounts = data.accounts.map(a => {
      // Watched accounts have no credentials — export them as-is
      if (a.accountType === 'watched' || !a.login || !a.password) {
        return { ...a, login: null, password: null };
      }
      try {
        return {
          ...a,
          login:    encrypt(decrypt(a.login,    encryptionKey), portableKey),
          password: encrypt(decrypt(a.password, encryptionKey), portableKey),
        };
      } catch { return null; }
    }).filter(Boolean);

    const backup = {
      version:    1,
      exportedAt: new Date().toISOString(),
      salt:       portableSalt,
      accounts:   exportAccounts,
      settings:   data.settings,
    };

    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { success: true, path: filePath, count: exportAccounts.length };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('backup:import', async (_, { password }) => {
  if (!isLoggedIn || !encryptionKey) return { success: false, error: 'Não autenticado' };

  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar Backup .lam',
    filters: [{ name: 'LoL Account Manager Backup', extensions: ['lam'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.[0]) return { success: false, canceled: true };

  try {
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!raw.version || !raw.salt || !Array.isArray(raw.accounts))
      return { success: false, error: 'Arquivo .lam inválido ou corrompido' };

    const portableKey = deriveKeyPortable(password, raw.salt);

    // Testa descriptografia na primeira conta com credenciais
    const testAcc = raw.accounts.find(a => a.login);
    if (testAcc) {
      try { decrypt(testAcc.login, portableKey); }
      catch { return { success: false, error: 'Senha incorreta ou arquivo corrompido' }; }
    }

    const data = readData();
    const existingIds = new Set(data.accounts.map(a => a.id));
    let imported = 0;

    for (const a of raw.accounts) {
      if (existingIds.has(a.id)) continue;
      // Watched accounts (intentionally no credentials) — preserve original type
      if (a.accountType === 'watched') {
        data.accounts.push({ ...a, login: null, password: null, accountType: 'watched' });
        imported++;
        continue;
      }
      // Full account with missing credentials (e.g. pre-1.0 export or corruption)
      if (!a.login || !a.password) {
        console.warn(`[import] account ${a.id} (${a.nickname}) has no credentials — imported as watched`);
        data.accounts.push({ ...a, login: null, password: null, accountType: 'watched' });
        imported++;
        continue;
      }
      try {
        data.accounts.push({
          ...a,
          login:    encrypt(decrypt(a.login,    portableKey), encryptionKey),
          password: encrypt(decrypt(a.password, portableKey), encryptionKey),
        });
        imported++;
      } catch (e) {
        console.warn(`[import] skipped account ${a.id} (${a.nickname}) — credentials corrupted: ${e.message}`);
      }
    }

    writeData(data);
    updateTrayMenu();
    return { success: true, imported, total: raw.accounts.length };
  } catch (e) { return { success: false, error: e.message }; }
});

// — Auto-Update —
ipcMain.handle('update:check', () => {
  const ok = updater.checkForUpdates();
  return { success: ok, message: ok ? 'Verificando...' : 'Auto-update não disponível em desenvolvimento' };
});

ipcMain.handle('update:install', () => { updater.installUpdate(); return { success: true }; });

// — Window controls —
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); });
ipcMain.handle('window:close',    () => app.quit());   // fully quit + destroy tray
ipcMain.handle('window:hide',     () => mainWindow?.hide());
ipcMain.handle('window:show',     () => { mainWindow?.show(); mainWindow?.focus(); });

// — Startup with Windows —
ipcMain.handle('startup:get', () => ({
  openAtLogin: app.getLoginItemSettings().openAtLogin,
}));
ipcMain.handle('startup:set', (_, { openAtLogin }) => {
  app.setLoginItemSettings({ openAtLogin });
  return { success: true };
});

ipcMain.handle('app:openMain', () => {
  createMainWindow();
  const data = readData();
  setupRefreshTimer(data.settings?.refreshInterval || 15);
  setTimeout(checkApiKeyExpiry, 2000);
  return { success: true };
});

// ============================================================
// APP LIFECYCLE
// ============================================================
app.whenReady().then(() => {
  DATA_PATH = path.join(app.getPath('userData'), 'lam-data.json');
  // Restore lockout state persisted from a previous session
  const _d = readData();
  loginAttempts = _d.loginAttempts || 0;
  lockoutUntil  = _d.lockoutUntil  || 0;
  globalShortcut.register('CommandOrControl+Shift+L', () => { mainWindow?.show(); mainWindow?.focus(); });
  setupTray();
  createLoginWindow();
  setInterval(checkApiKeyExpiry, 60 * 60 * 1000);

  // Re-push API key status when system resumes from sleep/hibernate or screen unlock.
  // This triggers the renderer to recalculate the countdown from the real timestamp,
  // preventing the timer from showing stale/drifted values after the system wakes up.
  powerMonitor.on('resume',        () => { if (isLoggedIn) push('apiKeyStatus', apiKeyStatus()); });
  powerMonitor.on('unlock-screen', () => { if (isLoggedIn) push('apiKeyStatus', apiKeyStatus()); });

  // Auto-update: inicializa e verifica 8s após o start (para não travar o boot)
  updater.setupUpdater(push);
  setTimeout(() => updater.checkForUpdates(), 8000);
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }   // remove tray icon immediately on quit
});
app.on('window-all-closed', () => { /* Stay in tray */ });
app.on('activate', () => { if (!mainWindow) createLoginWindow(); });
