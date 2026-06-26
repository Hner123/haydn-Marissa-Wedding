/**
 * RSVP backend — zero-dependency Node.js server.
 *
 * Endpoints:
 *   POST /api/rsvp                  -> save one RSVP (JSON body from the invitation form)
 *   GET  /api/attendees?key=KEY     -> JSON list of all RSVPs (admin)
 *   GET  /api/attendees.csv?key=KEY -> CSV download (admin)
 *   GET  /api/admin?key=KEY         -> simple HTML guest-list page (admin)
 *
 * Run:   RSVP_ADMIN_KEY=yoursecret PORT=3000 node server.js
 * PM2:   pm2 start ecosystem.config.js
 *
 * Data is appended to ./data/rsvps.ndjson (one JSON object per line).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.RSVP_ADMIN_KEY || 'change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rsvps.ndjson');
fs.mkdirSync(DATA_DIR, { recursive: true });

const FIELDS = ['ts', 'name', 'email', 'attending', 'guests', 'meal', 'message'];

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readAll() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return fs.readFileSync(DATA_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- save an RSVP ----
  if (req.method === 'POST' && u.pathname === '/api/rsvp') {
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', function () {
      let d = {};
      try { d = JSON.parse(body || '{}'); } catch (e) {}
      const rec = {
        ts: new Date().toISOString(),
        name: String(d.name || '').slice(0, 200),
        email: String(d.email || '').slice(0, 200),
        attending: String(d.attending || '').slice(0, 20),
        guests: String(d.guests || '').slice(0, 10),
        meal: String(d.meal || '').slice(0, 120),
        message: String(d.message || '').slice(0, 2000),
      };
      try {
        fs.appendFileSync(DATA_FILE, JSON.stringify(rec) + '\n');
        send(res, 200, { ok: true });
      } catch (e) {
        send(res, 500, { ok: false, error: 'write failed' });
      }
    });
    return;
  }

  // ---- admin (key-protected) ----
  const isAdmin = ['/api/attendees', '/api/attendees.csv', '/api/admin'].indexOf(u.pathname) !== -1;
  if (req.method === 'GET' && isAdmin) {
    if (u.searchParams.get('key') !== ADMIN_KEY) return send(res, 401, { ok: false, error: 'unauthorized' });
    const list = readAll();

    if (u.pathname === '/api/attendees') {
      return send(res, 200, { ok: true, count: list.length, attendees: list });
    }

    if (u.pathname === '/api/attendees.csv') {
      const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      const csv = [FIELDS.join(',')]
        .concat(list.map(function (r) { return FIELDS.map(function (f) { return q(r[f]); }).join(','); }))
        .join('\n');
      res.setHeader('Content-Disposition', 'attachment; filename="rsvps.csv"');
      return send(res, 200, csv, 'text/csv; charset=utf-8');
    }

    // /api/admin -> HTML page
    let yes = 0, no = 0, heads = 0;
    list.forEach(function (r) {
      if (String(r.attending).toLowerCase().indexOf('y') === 0) { yes++; heads += parseInt(r.guests, 10) || 1; }
      else no++;
    });
    const rows = list.slice().reverse().map(function (r) {
      return '<tr><td>' + esc(r.ts.replace('T', ' ').slice(0, 16)) + '</td><td>' + esc(r.name) +
        '</td><td>' + esc(r.attending) + '</td><td>' + esc(r.guests) + '</td><td>' + esc(r.meal) +
        '</td><td>' + esc(r.email) + '</td><td>' + esc(r.message) + '</td></tr>';
    }).join('');
    const html = '<!doctype html><meta charset="utf-8"><title>Guest List</title>' +
      '<style>body{font:15px/1.5 system-ui,sans-serif;margin:32px;color:#1b2447;background:#F7F3EC}' +
      'h1{font-weight:600}.stats{margin:0 0 20px;font-size:18px}.stats b{color:#A87C2E}' +
      'table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 8px 30px -16px rgba(0,0,0,.3)}' +
      'th,td{border:1px solid #e6dcc6;padding:8px 10px;text-align:left;vertical-align:top}' +
      'th{background:#1b2447;color:#fff;font-weight:600}a.btn{display:inline-block;margin-bottom:18px;' +
      'background:#A87C2E;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none}</style>' +
      '<h1>Haydn &amp; Marisa — Guest List</h1>' +
      '<p class="stats"><b>' + list.length + '</b> responses &nbsp;·&nbsp; <b>' + yes + '</b> attending (' +
      heads + ' guests) &nbsp;·&nbsp; <b>' + no + '</b> regrets</p>' +
      '<a class="btn" href="/api/attendees.csv?key=' + esc(u.searchParams.get('key')) + '">Download CSV</a>' +
      '<table><tr><th>When</th><th>Name</th><th>Attending</th><th>Guests</th><th>Meal</th><th>Email</th><th>Message</th></tr>' +
      rows + '</table>';
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, function () {
  console.log('RSVP backend listening on http://localhost:' + PORT + ' (admin key: ' +
    (ADMIN_KEY === 'change-me' ? 'CHANGE ME via RSVP_ADMIN_KEY!' : 'set') + ')');
});
