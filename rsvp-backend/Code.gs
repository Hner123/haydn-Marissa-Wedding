/**
 * RSVP backend — Google Apps Script Web App
 * --------------------------------------------------------------
 * SETUP (one time):
 *  1. Create a new Google Sheet (sheets.new). Name it e.g. "Wedding RSVPs".
 *  2. In that Sheet: Extensions ▸ Apps Script.
 *  3. Delete any sample code, paste THIS whole file, and Save.
 *  4. Change ADMIN_KEY below to your own secret word.
 *  5. Deploy ▸ New deployment ▸ type "Web app".
 *       - Description: rsvp
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Click Deploy, authorize, and COPY the "Web app URL"
 *     (it ends with /exec).
 *  6. Send that /exec URL + your ADMIN_KEY back, and the form +
 *     in-app Guest List get wired to it.
 *
 *  To re-deploy after edits: Deploy ▸ Manage deployments ▸ edit ▸
 *  Version: New version ▸ Deploy (keeps the same URL).
 */

const SHEET_NAME = 'RSVPs';
const ADMIN_KEY  = 'change-me-to-a-secret';   // <-- change this

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Timestamp', 'Name', 'Email', 'Attending', 'Guests', 'Meal', 'Message']);
  }
  return sh;
}

// Guest submits the RSVP form (sent as text/plain to avoid a CORS preflight).
function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    getSheet_().appendRow([
      new Date(),
      d.name || '', d.email || '', d.attending || '',
      d.guests || '', d.meal || '', d.message || ''
    ]);
    return json_({ ok: true }, e);
  } catch (err) {
    return json_({ ok: false, error: String(err) }, e);
  }
}

// In-app Guest List reads the attendees (JSONP, and only with the right key).
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== ADMIN_KEY) return json_({ ok: false, error: 'unauthorized' }, e);
  const rows = getSheet_().getDataRange().getValues();
  const head = rows.shift() || [];
  const attendees = rows.map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
  return json_({ ok: true, count: attendees.length, attendees: attendees }, e);
}

// Returns JSON, or JSONP if a ?callback= is supplied (bypasses browser CORS).
function json_(obj, e) {
  const body = JSON.stringify(obj);
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}
