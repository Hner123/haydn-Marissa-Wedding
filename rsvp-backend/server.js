/**
 * RSVP backend — zero-dependency Node.js server.
 *
 * Public:
 *   POST /api/rsvp                  -> save one RSVP (JSON body from the invitation form)
 * Admin (password login, session cookie):
 *   GET  /api/guests                 -> login page, then the guest-list page
 *   POST /api/login                 -> check password, set session cookie
 *   GET  /api/logout                -> clear session
 *   GET  /api/attendees             -> JSON (cookie session OR ?key=PASSWORD)
 *   GET  /api/attendees.csv         -> CSV download (cookie session OR ?key=PASSWORD)
 *
 * Run:   RSVP_ADMIN_KEY=yoursecret PORT=3007 node server.js
 * PM2:   pm2 start ecosystem.config.js
 *
 * RSVP_ADMIN_KEY is the admin PASSWORD. Data is appended to ./data/rsvps.ndjson.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3007;
const ADMIN_KEY = process.env.RSVP_ADMIN_KEY || 'change-me';      // the admin password
const COOKIE = 'rsvp_auth';
const MAX_AGE = 7 * 24 * 3600;                                    // 7-day session
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rsvps.ndjson');
const PW_FILE = path.join(DATA_DIR, 'admin.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Admin password: hashed in admin.json once changed via the dashboard;
// until then, RSVP_ADMIN_KEY (env) is the initial password.
let pwHash = null;
try { pwHash = JSON.parse(fs.readFileSync(PW_FILE, 'utf8')); } catch (e) {}
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  pwHash = { salt: salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
  fs.writeFileSync(PW_FILE, JSON.stringify(pwHash));
}
function verifyPassword(pw) {
  pw = String(pw || '');
  if (pwHash) return safeEqual(crypto.scryptSync(pw, pwHash.salt, 64).toString('hex'), pwHash.hash);
  return safeEqual(pw, ADMIN_KEY);
}
function currentToken() {
  return crypto.createHmac('sha256', pwHash ? pwHash.hash : ADMIN_KEY).update('rsvp-admin-v1').digest('hex');
}
const FIELDS = ['ts', 'name', 'email', 'attending', 'guests', 'meal', 'message'];

function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function authed(req, u) {
  const c = parseCookies(req);
  if (c[COOKIE] && safeEqual(c[COOKIE], currentToken())) return true;
  if (u && verifyPassword(u.searchParams.get('key') || '')) return true; // backward-compatible ?key
  return false;
}
function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  }, extra || {}));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function readAll() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(Boolean)
    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}
function readBody(req, cb) {
  let b = ''; req.on('data', function (c) { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', function () { cb(b); });
}
function setCookie(maxAge) {
  return COOKIE + '=' + (maxAge > 0 ? currentToken() : '') + '; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=' + maxAge;
}

function loginPage(msg) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Guest List — Sign in</title><style>' +
    'body{font:15px/1.5 system-ui,-apple-system,sans-serif;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:#10193f}' +
    'form{background:#F7F3EC;padding:42px 34px;border-radius:8px;box-shadow:0 30px 80px -30px rgba(0,0,0,.6);width:300px;text-align:center}' +
    'h1{font:600 26px Georgia,serif;margin:0 0 2px;color:#1b2447}p.sub{margin:0 0 24px;color:#A87C2E;font-size:12px;letter-spacing:.22em;text-transform:uppercase}' +
    'input{width:100%;box-sizing:border-box;padding:12px 13px;margin:0 0 14px;border:1px solid #d8ccb0;border-radius:4px;font-size:15px;background:#fff}' +
    'button{width:100%;padding:12px;border:0;border-radius:4px;background:#A87C2E;color:#fff;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}' +
    '.err{color:#b3261e;font-size:13px;margin:-4px 0 12px}</style>' +
    '<form method="POST" action="/api/login"><h1>Haydn &amp; Marisa</h1><p class="sub">Guest List</p>' +
    (msg ? '<p class="err">' + esc(msg) + '</p>' : '') +
    '<input name="password" type="password" placeholder="Password" autocomplete="current-password" autofocus>' +
    '<button type="submit">Sign in</button></form>';
}

function changePwPage(msg, ok) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Change Password</title><style>' +
    'body{font:15px/1.5 system-ui,-apple-system,sans-serif;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:#10193f}' +
    'form{background:#F7F3EC;padding:42px 34px;border-radius:8px;box-shadow:0 30px 80px -30px rgba(0,0,0,.6);width:300px;text-align:center}' +
    'h1{font:600 24px Georgia,serif;margin:0 0 2px;color:#1b2447}p.sub{margin:0 0 22px;color:#A87C2E;font-size:12px;letter-spacing:.22em;text-transform:uppercase}' +
    'input{width:100%;box-sizing:border-box;padding:12px 13px;margin:0 0 12px;border:1px solid #d8ccb0;border-radius:4px;font-size:15px;background:#fff}' +
    'button{width:100%;padding:12px;border:0;border-radius:4px;background:#A87C2E;color:#fff;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}' +
    '.err{color:#b3261e;font-size:13px;margin:-2px 0 12px}.ok{color:#2e7d32;font-size:13px;margin:-2px 0 12px}a{color:#A87C2E}</style>' +
    '<form method="POST" action="/api/change-password"><h1>Change Password</h1><p class="sub">Haydn &amp; Marisa</p>' +
    (msg ? '<p class="' + (ok ? 'ok' : 'err') + '">' + esc(msg) + '</p>' : '') +
    '<input name="current" type="password" placeholder="Current password" autocomplete="current-password" autofocus>' +
    '<input name="newpw" type="password" placeholder="New password (min 6 chars)" autocomplete="new-password">' +
    '<input name="confirm" type="password" placeholder="Confirm new password" autocomplete="new-password">' +
    '<button type="submit">Update password</button>' +
    '<p style="margin:16px 0 0;font-size:13px"><a href="/api/guests">← Back to guest list</a></p></form>';
}

function adminPage(list) {
  let yes = 0, no = 0, heads = 0;
  list.forEach(function (r) {
    if (String(r.attending).toLowerCase().indexOf('y') === 0) { yes++; heads += parseInt(r.guests, 10) || 1; }
    else no++;
  });
  const rows = list.slice().reverse().map(function (r) {
    const att = String(r.attending).toLowerCase().indexOf('y') === 0 ? 'yes' : 'no';
    return '<tr data-att="' + att + '"><td data-label="When">' + esc(r.ts.replace('T', ' ').slice(0, 16)) + '</td><td data-label="Name">' + esc(r.name) +
      '</td><td data-label="Attending">' + esc(r.attending) + '</td><td data-label="Guests">' + esc(r.guests) + '</td><td data-label="Meal">' + esc(r.meal) +
      '</td><td data-label="Email">' + esc(r.email) + '</td><td data-label="Message">' + esc(r.message) + '</td>' +
      '<td data-label="Delete"><button type="button" class="del" data-ts="' + esc(r.ts) + '" data-name="' + esc(r.name) + '" ' +
      'style="background:#b3261e;color:#fff;border:0;border-radius:4px;padding:5px 11px;cursor:pointer">Delete</button></td></tr>';
  }).join('');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Guest List</title><style>' +
    'body{font:15px/1.5 system-ui,sans-serif;margin:0 32px 40px;color:#1b2447;background:#F7F3EC}' +
    '.bar{position:sticky;top:0;background:#F7F3EC;z-index:5;padding:16px 0 12px;box-shadow:0 10px 16px -14px rgba(0,0,0,.5)}' +
    'h1{font-weight:600;display:inline-block;margin:0 14px 0 0;font-size:24px}' +
    '.stats{margin:6px 0 0;font-size:16px}.stats b{color:#A87C2E}' +
    '.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}' +
    '#q{flex:1 1 240px;min-width:170px;padding:9px 12px;border:1px solid #d8ccb0;border-radius:5px;font-size:14px;background:#fff}' +
    '.filters{display:flex;gap:6px}button.f{padding:8px 14px;border:1px solid #d8ccb0;background:#fff;border-radius:5px;cursor:pointer;font-size:13px;color:#1b2447}' +
    'button.f.active{background:#1b2447;color:#fff;border-color:#1b2447}#count{font-size:13px;color:#8a7a52;margin-left:auto}' +
    'table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 8px 30px -16px rgba(0,0,0,.3)}' +
    'th,td{border:1px solid #e6dcc6;padding:8px 10px;text-align:left;vertical-align:top}th{background:#1b2447;color:#fff;font-weight:600}' +
    'a.btn{display:inline-block;background:#A87C2E;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:14px}a.logout{background:#5a5c66}' +
    '.modal-ov{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(16,25,63,.55);z-index:1000}.modal-ov.show{display:flex;animation:ovIn .2s ease}.modal-bx{background:#F7F3EC;border-radius:10px;padding:30px 30px 24px;max-width:380px;width:90%;text-align:center;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)}.modal-ov.show .modal-bx{animation:bxIn .3s cubic-bezier(.16,.84,.44,1)}.modal-bx h3{font:600 22px Georgia,serif;margin:0 0 8px;color:#1b2447}.modal-bx p{margin:0 0 22px;color:#5a5c66;font-size:15px}.modal-ac{display:flex;gap:10px;justify-content:center}.modal-ac button{padding:10px 22px;border:0;border-radius:5px;font-size:14px;font-weight:600;cursor:pointer}.btn-cancel{background:#e3dac6;color:#1b2447}.btn-del{background:#b3261e;color:#fff}@keyframes ovIn{from{opacity:0}to{opacity:1}}@keyframes bxIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}' +
    '@media(max-width:640px){body{margin:0 14px 40px}h1{font-size:21px}.bar{padding:12px 0 10px}thead{display:none}table,tbody,tr,td{display:block;width:auto}table{box-shadow:none}tr{margin:0 0 14px;border:1px solid #e6dcc6;border-radius:8px;background:#fff;overflow:hidden}td{border:0;border-bottom:1px solid #f0e9da;padding:9px 14px;display:flex;justify-content:space-between;align-items:center;gap:14px;text-align:right;word-break:break-word}td:last-child{border-bottom:0}td::before{content:attr(data-label);font-weight:600;color:#A87C2E;text-transform:uppercase;font-size:11px;letter-spacing:.08em;text-align:left;flex:0 0 auto}#count{margin-left:0}}</style>' +
    '<div class="bar"><h1>Haydn &amp; Marisa — Guest List</h1>' +
    '<p class="stats"><b>' + list.length + '</b> responses &nbsp;·&nbsp; <b>' + yes + '</b> attending (' + heads + ' guests) &nbsp;·&nbsp; <b>' + no + '</b> regrets</p>' +
    '<div class="controls"><input id="q" type="search" placeholder="Search name, email, message…">' +
    '<div class="filters"><button class="f active" data-f="all">All</button><button class="f" data-f="yes">Attending</button><button class="f" data-f="no">Regrets</button></div>' +
    '<a class="btn" href="/api/attendees.csv">Download CSV</a><a class="btn" href="/api/change-password">Change password</a><a class="btn logout" href="/api/logout">Log out</a>' +
    '<span id="count"></span></div></div>' +
    '<table><thead><tr><th>When</th><th>Name</th><th>Attending</th><th>Guests</th><th>Meal</th><th>Email</th><th>Message</th><th>Delete</th></tr></thead><tbody id="tb">' +
    rows + '</tbody></table>' +
    '<div id="modal" class="modal-ov"><div class="modal-bx"><h3>Delete RSVP?</h3><p>Remove the response from <strong id="m-name"></strong>? This cannot be undone.</p><div class="modal-ac"><button type="button" id="m-cancel" class="btn-cancel">Cancel</button><form method="POST" action="/api/delete" style="margin:0"><input type="hidden" name="ts" id="m-ts"><button type="submit" class="btn-del">Delete</button></form></div></div></div>' +
    '<script>(function(){var rows=[].slice.call(document.querySelectorAll("#tb tr"));var q=document.getElementById("q"),countEl=document.getElementById("count"),filt="all";function apply(){var term=(q.value||"").toLowerCase(),shown=0;rows.forEach(function(tr){var okF=filt==="all"||tr.getAttribute("data-att")===filt;var okQ=!term||tr.textContent.toLowerCase().indexOf(term)>=0;var show=okF&&okQ;tr.style.display=show?"":"none";if(show)shown++;});countEl.textContent="Showing "+shown+" of "+rows.length;}q.addEventListener("input",apply);document.querySelectorAll("button.f").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll("button.f").forEach(function(x){x.classList.remove("active");});b.classList.add("active");filt=b.getAttribute("data-f");apply();});});apply();var m=document.getElementById("modal"),n=document.getElementById("m-name"),t=document.getElementById("m-ts");function o(ts,nm){t.value=ts;n.textContent=nm||"this guest";m.classList.add("show");}function c(){m.classList.remove("show");}document.querySelectorAll("button.del").forEach(function(b){b.addEventListener("click",function(){o(b.getAttribute("data-ts"),b.getAttribute("data-name"));});});document.getElementById("m-cancel").addEventListener("click",c);m.addEventListener("click",function(e){if(e.target===m)c();});document.addEventListener("keydown",function(e){if(e.key==="Escape")c();});})();</script>';
}
const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- save an RSVP ----
  if (req.method === 'POST' && u.pathname === '/api/rsvp') {
    return readBody(req, function (body) {
      let d = {}; try { d = JSON.parse(body || '{}'); } catch (e) {}
      const rec = {
        ts: new Date().toISOString(),
        name: String(d.name || '').slice(0, 200), email: String(d.email || '').slice(0, 200),
        attending: String(d.attending || '').slice(0, 20), guests: String(d.guests || '').slice(0, 10),
        meal: String(d.meal || '').slice(0, 120), message: String(d.message || '').slice(0, 2000),
      };
      try { fs.appendFileSync(DATA_FILE, JSON.stringify(rec) + '\n'); send(res, 200, { ok: true }); }
      catch (e) { send(res, 500, { ok: false, error: 'write failed' }); }
    });
  }

  // ---- login ----
  if (req.method === 'POST' && u.pathname === '/api/login') {
    return readBody(req, function (body) {
      const params = new URLSearchParams(body);
      if (verifyPassword(params.get('password') || '')) {
        send(res, 302, '', 'text/html', { 'Set-Cookie': setCookie(MAX_AGE), 'Location': '/api/guests' });
      } else {
        send(res, 401, loginPage('Incorrect password'), 'text/html; charset=utf-8');
      }
    });
  }

  // ---- logout ----
  if (req.method === 'GET' && u.pathname === '/api/logout') {
    return send(res, 302, '', 'text/html', { 'Set-Cookie': setCookie(0), 'Location': '/api/guests' });
  }

  // ---- change password ----
  if (u.pathname === '/api/change-password') {
    if (!authed(req, u)) return send(res, 200, loginPage(''), 'text/html; charset=utf-8');
    if (req.method === 'GET') return send(res, 200, changePwPage(''), 'text/html; charset=utf-8');
    if (req.method === 'POST') {
      return readBody(req, function (body) {
        const ps = new URLSearchParams(body);
        const cur = ps.get('current') || '', np = ps.get('newpw') || '', cf = ps.get('confirm') || '';
        if (!verifyPassword(cur)) return send(res, 200, changePwPage('Current password is incorrect'), 'text/html; charset=utf-8');
        if (np.length < 6) return send(res, 200, changePwPage('New password must be at least 6 characters'), 'text/html; charset=utf-8');
        if (np !== cf) return send(res, 200, changePwPage('New passwords do not match'), 'text/html; charset=utf-8');
        setPassword(np);
        send(res, 302, '', 'text/html', { 'Set-Cookie': setCookie(MAX_AGE), 'Location': '/api/guests' });
      });
    }
  }

  // ---- delete one RSVP (by timestamp) ----
  if (req.method === 'POST' && u.pathname === '/api/delete') {
    if (!authed(req, u)) return send(res, 401, { ok: false, error: 'unauthorized' });
    return readBody(req, function (body) {
      const ts = new URLSearchParams(body).get('ts') || '';
      const list = readAll().filter(function (r) { return r.ts !== ts; });
      try {
        fs.writeFileSync(DATA_FILE, list.map(function (r) { return JSON.stringify(r); }).join('\n') + (list.length ? '\n' : ''));
        send(res, 302, '', 'text/html', { 'Location': '/api/guests' });
      } catch (e) { send(res, 500, { ok: false, error: 'write failed' }); }
    });
  }

  // ---- admin page (login form if not authed) ----
  if (req.method === 'GET' && u.pathname === '/api/guests') {
    if (!authed(req, u)) return send(res, 200, loginPage(''), 'text/html; charset=utf-8');
    return send(res, 200, adminPage(readAll()), 'text/html; charset=utf-8', { 'Set-Cookie': setCookie(MAX_AGE) });
  }

  // ---- data endpoints (cookie session OR ?key=PASSWORD) ----
  if (req.method === 'GET' && (u.pathname === '/api/attendees' || u.pathname === '/api/attendees.csv')) {
    if (!authed(req, u)) return send(res, 401, { ok: false, error: 'unauthorized' });
    const list = readAll();
    if (u.pathname === '/api/attendees') return send(res, 200, { ok: true, count: list.length, attendees: list });
    const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    const csv = [FIELDS.join(',')].concat(list.map(function (r) { return FIELDS.map(function (f) { return q(r[f]); }).join(','); })).join('\n');
    return send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="rsvps.csv"' });
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, function () {
  console.log('RSVP backend on http://localhost:' + PORT +
    (ADMIN_KEY === 'change-me' ? '  (⚠ set RSVP_ADMIN_KEY!)' : ''));
});
