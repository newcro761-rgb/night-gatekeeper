// ===== 상수 =====
const SHEET_NAMES = { STAFF: '직원명단', RECORDS: '기록', GATEKEEPER: '문지기확정' };
const TIMEZONE = 'Asia/Seoul';
const CONFIRM_HOUR = 16;

// ===== 라우팅 =====
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'names') return names_();
    if (p.action === 'today') return today_();
    if (p.action === 'history') return history_(p);
    return jsonOutput_({ result: 'UNKNOWN_ACTION' });
  } catch (err) {
    return jsonOutput_({ result: 'ERROR', message: String(err) });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.action === 'submit') return submit_(data);
    if (data.action === 'admin_add_name') return withAdminAuth_(data, function () { return adminAddName_(data); });
    if (data.action === 'admin_deactivate_name') return withAdminAuth_(data, function () { return adminDeactivateName_(data); });
    if (data.action === 'admin_update_name') return withAdminAuth_(data, function () { return adminUpdateName_(data); });
    if (data.action === 'admin_records') return withAdminAuth_(data, function () { return adminRecords_(data.date); });
    return jsonOutput_({ result: 'UNKNOWN_ACTION' });
  } catch (err) {
    return jsonOutput_({ result: 'ERROR', message: String(err) });
  }
}

// ===== 공통 유틸 =====
function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

// Date 객체든 'YYYY-MM-DD' 문자열이든 'YYYY-MM-DD'로 통일 (Sheets가 날짜 셀을 Date로 자동변환하는 것을 방어)
function normalizeDateStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  }
  return String(v);
}

// created_at/updated_at/confirmed_at이 Date 객체든 ISO 문자열이든 Date 객체로 통일해 비교 가능하게
function parseTimestamp_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  return new Date(v);
}

function boolActive_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// 시트 쓰기 경로를 감싸는 동시성 제어 — 16:00 직후 동시 today/submit로 인한 중복 행 삽입을 방지
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonOutput_({ result: 'BUSY' });
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ===== 일반 API =====
function names_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_(ss, SHEET_NAMES.STAFF);
  const values = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < values.length; i++) {
    if (boolActive_(values[i][1])) names.push(values[i][0]);
  }
  return jsonOutput_({ names: names });
}

function isActiveStaff_(staffSheet, name) {
  const values = staffSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === name) return boolActive_(values[i][1]);
  }
  return false;
}

// records 시트에서 (dateStr, name) 매치되는 1-based row index 반환, 없으면 -1
function findRecordRow_(recordsSheet, dateStr, name) {
  const values = recordsSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (normalizeDateStr_(values[i][0]) === dateStr && values[i][1] === name) return i + 1;
  }
  return -1;
}

// 있으면 leave_time+updated_at만 갱신(created_at 보존), 없으면 신규 append
function upsertRecord_(recordsSheet, dateStr, name, leaveTime) {
  const rowIndex = findRecordRow_(recordsSheet, dateStr, name);
  const nowIso = new Date().toISOString();
  if (rowIndex === -1) {
    recordsSheet.appendRow([dateStr, name, leaveTime, nowIso, nowIso]);
  } else {
    recordsSheet.getRange(rowIndex, 3, 1, 3).setValues([[leaveTime, recordsSheet.getRange(rowIndex, 4).getValue(), nowIso]]);
  }
}

function submit_(data) {
  return withLock_(function () {
    const name = data.name;
    const leaveTime = data.leave_time;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(leaveTime))) {
      return jsonOutput_({ result: 'INVALID_TIME_FORMAT' });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = getSheet_(ss, SHEET_NAMES.STAFF);
    if (!isActiveStaff_(staffSheet, name)) {
      return jsonOutput_({ result: 'NAME_NOT_FOUND' });
    }
    const recordsSheet = getSheet_(ss, SHEET_NAMES.RECORDS);
    const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    upsertRecord_(recordsSheet, todayStr, name, leaveTime);

    const hour = Number(Utilities.formatDate(new Date(), TIMEZONE, 'H'));
    if (hour >= CONFIRM_HOUR) {
      runConfirmation_(todayStr, '제출 후 재확정');
    }
    return jsonOutput_({ result: 'OK', name: name, leave_time: leaveTime });
  });
}

// 특정 날짜의 전체 레코드를 배열로 반환 — runConfirmation_과 adminRecords_가 공유
function getRecordsForDate_(recordsSheet, dateStr) {
  const values = recordsSheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (normalizeDateStr_(values[i][0]) !== dateStr) continue;
    out.push({
      name: values[i][1],
      leave_time: values[i][2],
      created_at: values[i][3],
      updated_at: values[i][4]
    });
  }
  return out;
}

function history_(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_(ss, SHEET_NAMES.GATEKEEPER);
  const values = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < values.length; i++) {
    list.push({ date: normalizeDateStr_(values[i][0]), gatekeeper: values[i][1] });
  }
  list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  const limited = (params && params.more) ? list : list.slice(0, 30);
  return jsonOutput_({ history: limited });
}

// ===== 확정 로직 — 정기 트리거와 즉시 재확정이 공유하는 핵심 =====

// 순수 함수: 최댓값 leave_time, 동점시 created_at 빠른(먼저 입력한) 사람 우선
function pickGatekeeper_(records) {
  let best = records[0];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    if (r.leave_time > best.leave_time) {
      best = r;
    } else if (r.leave_time === best.leave_time
               && parseTimestamp_(r.created_at) < parseTimestamp_(best.created_at)) {
      best = r;
    }
  }
  return best;
}

function findGatekeeperRowIndex_(gatekeeperSheet, dateStr) {
  const values = gatekeeperSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (normalizeDateStr_(values[i][0]) === dateStr) return i + 1;
  }
  return -1;
}

// 승자가 기존과 동일하면 아무 것도 하지 않음(revision 불필요 증가 방지), 바뀌면 revision+1
function upsertGatekeeper_(ss, dateStr, winnerName, note) {
  const sheet = getSheet_(ss, SHEET_NAMES.GATEKEEPER);
  const rowIndex = findGatekeeperRowIndex_(sheet, dateStr);
  const nowIso = new Date().toISOString();
  if (rowIndex === -1) {
    sheet.appendRow([dateStr, winnerName, nowIso, 0, note || '']);
    return { changed: true, gatekeeper: winnerName };
  }
  const existing = sheet.getRange(rowIndex, 1, 1, 5).getValues()[0];
  if (existing[1] === winnerName) {
    return { changed: false, gatekeeper: winnerName };
  }
  const newRevision = Number(existing[3] || 0) + 1;
  sheet.getRange(rowIndex, 1, 1, 5).setValues([[dateStr, winnerName, nowIso, newRevision, note || '']]);
  return { changed: true, gatekeeper: winnerName };
}

// 진입점 — dailyConfirmTrigger()와 submit_()/today_() 양쪽이 이 함수 하나만 호출
function runConfirmation_(dateStr, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = getRecordsForDate_(getSheet_(ss, SHEET_NAMES.RECORDS), dateStr);
  if (records.length === 0) return { status: 'no_records' };
  const winner = pickGatekeeper_(records);
  upsertGatekeeper_(ss, dateStr, winner.name, note);
  return { status: 'confirmed', gatekeeper: winner.name };
}

// 정기 트리거 핸들러 — 이 함수만 트리거에 등록한다.
// 주의: atHour(16) 트리거는 16:00~17:00 사이 임의 시점에 실행되는 것이 Apps Script의 정상 동작이다(버그 아님).
// 실제 확정 시점 보장은 today_()의 온디맨드 폴백이 담당한다.
function dailyConfirmTrigger() {
  withLock_(function () {
    const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    runConfirmation_(todayStr, '정기 확정(16:00)');
    return jsonOutput_({ result: 'OK' });
  });
}

// 트리거 등록 — Apps Script 편집기에서 이 함수를 선택해 "실행" 버튼으로 1회만 수동 실행
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyConfirmTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyConfirmTrigger')
    .timeBased().atHour(CONFIRM_HOUR).everyDays(1).inTimezone(TIMEZONE).create();
}

// 16:00 판정 + 트리거 지연 흡수(온디맨드 폴백)
function today_() {
  return withLock_(function () {
    const now = new Date();
    const todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    const hour = Number(Utilities.formatDate(now, TIMEZONE, 'H'));

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const gatekeeperSheet = getSheet_(ss, SHEET_NAMES.GATEKEEPER);
    const confirmedRow = findGatekeeperRowIndex_(gatekeeperSheet, todayStr);
    if (confirmedRow !== -1) {
      const row = gatekeeperSheet.getRange(confirmedRow, 1, 1, 5).getValues()[0];
      return jsonOutput_({ status: 'confirmed', gatekeeper: row[1] });
    }
    if (hour < CONFIRM_HOUR) {
      return jsonOutput_({ status: 'pending', confirm_at: '16:00' });
    }
    const result = runConfirmation_(todayStr, '조회 시점 온디맨드 확정');
    return jsonOutput_(result);
  });
}

// ===== 관리자 API =====
function withAdminAuth_(params, fn) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected || params.admin_key !== expected) {
    return jsonOutput_({ result: 'FORBIDDEN' });
  }
  return fn();
}

function adminAddName_(data) {
  return withLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = getSheet_(ss, SHEET_NAMES.STAFF);
    const values = staffSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.name) return jsonOutput_({ result: 'ALREADY_EXISTS' });
    }
    staffSheet.appendRow([data.name, true, new Date().toISOString()]);
    return jsonOutput_({ result: 'OK' });
  });
}

function adminDeactivateName_(data) {
  return withLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = getSheet_(ss, SHEET_NAMES.STAFF);
    const values = staffSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.name) {
        staffSheet.getRange(i + 1, 2).setValue(false);
        return jsonOutput_({ result: 'OK' });
      }
    }
    return jsonOutput_({ result: 'NOT_FOUND' });
  });
}

// 알려진 제약: name이 기록/문지기확정 시트의 연결키이므로, 이름 변경 시 과거 데이터는 소급 갱신하지 않는다.
function adminUpdateName_(data) {
  return withLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = getSheet_(ss, SHEET_NAMES.STAFF);
    const values = staffSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.old_name) {
        staffSheet.getRange(i + 1, 1).setValue(data.new_name);
        return jsonOutput_({ result: 'OK' });
      }
    }
    return jsonOutput_({ result: 'NOT_FOUND' });
  });
}

function adminRecords_(dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordsSheet = getSheet_(ss, SHEET_NAMES.RECORDS);
  const records = getRecordsForDate_(recordsSheet, dateStr);
  return jsonOutput_({ records: records });
}
