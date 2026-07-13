// ===== 상수 =====
const SHEET_NAMES = { STAFF: '직원명단', RECORDS: '기록', GATEKEEPER: '문지기확정' };
const TIMEZONE = 'Asia/Seoul';
// 시간 대신 허용되는 특수 상태 — 이 값으로 등록한 사람은 문지기 후보에서 제외된다
const SPECIAL_STATUSES = ['출장', '휴가'];

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

// leave_time 셀이 Sheets에 의해 시간 값(Date)으로 자동변환됐어도 'HH:mm' 문자열로 통일
function normalizeTimeStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TIMEZONE, 'HH:mm');
  }
  return String(v);
}

// 'HH:MM' 형식(문지기 후보 자격)인지 판별 — 출장/휴가 등 특수 상태는 false
function isTimeValue_(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
}

function boolActive_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// 시트 쓰기 경로를 감싸는 동시성 제어 — 동시 submit/마감 기록으로 인한 중복 행 삽입을 방지
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
    const leaveTime = String(data.leave_time);
    if (!isTimeValue_(leaveTime) && SPECIAL_STATUSES.indexOf(leaveTime) === -1) {
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

    return jsonOutput_({ result: 'OK', name: name, leave_time: leaveTime });
  });
}

// 특정 날짜의 전체 레코드를 배열로 반환 — today_/finalizePastDates_/adminRecords_가 공유
function getRecordsForDate_(recordsSheet, dateStr) {
  const values = recordsSheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (normalizeDateStr_(values[i][0]) !== dateStr) continue;
    out.push({
      name: values[i][1],
      leave_time: normalizeTimeStr_(values[i][2]),
      created_at: values[i][3],
      updated_at: values[i][4]
    });
  }
  return out;
}

function history_(params) {
  finalizePastDates_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_(ss, SHEET_NAMES.GATEKEEPER);
  const values = sheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const dateStr = normalizeDateStr_(values[i][0]);
    if (dateStr >= todayStr) continue; // 오늘/미래 날짜는 역대 기록에 포함하지 않음 (마감된 날짜만)
    list.push({ date: dateStr, gatekeeper: values[i][1] });
  }
  list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  const limited = (params && params.more) ? list : list.slice(0, 30);
  return jsonOutput_({ history: limited });
}

// ===== 문지기 계산 — "현재 1등"을 항상 실시간으로 계산한다 (고정 확정 시각 없음) =====

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

// 오늘보다 이전 날짜인데 아직 문지기확정 시트에 없는 날짜를 찾아 1회만 기록한다(멱등).
// 날짜가 지나면 그 날짜의 기록은 더 이상 바뀌지 않으므로(자정 이후 입력 없음), 재확정 로직이 필요 없다.
function finalizePastDates_() {
  withLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const recordsSheet = getSheet_(ss, SHEET_NAMES.RECORDS);
    const gatekeeperSheet = getSheet_(ss, SHEET_NAMES.GATEKEEPER);
    const recordValues = recordsSheet.getDataRange().getValues();
    const pastDates = {};
    for (let i = 1; i < recordValues.length; i++) {
      const d = normalizeDateStr_(recordValues[i][0]);
      if (d < todayStr) pastDates[d] = true;
    }
    Object.keys(pastDates).forEach(function (dateStr) {
      if (findGatekeeperRowIndex_(gatekeeperSheet, dateStr) !== -1) return;
      const candidates = getRecordsForDate_(recordsSheet, dateStr).filter(function (r) { return isTimeValue_(r.leave_time); });
      if (candidates.length === 0) return; // 전원 출장/휴가였던 날은 문지기 없음
      const winner = pickGatekeeper_(candidates);
      gatekeeperSheet.appendRow([dateStr, winner.name, new Date().toISOString(), 0, '마감 시 자동 기록']);
    });
    return jsonOutput_({ result: 'OK' });
  });
}

// 오늘 지금까지의 1등을 실시간으로 계산해 반환 (쓰기 없음, 락 불필요)
// leave_time(1등의 시간)과 count(오늘 등록 인원)를 함께 공개하는 것은 제품 결정 사항
function today_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const records = getRecordsForDate_(getSheet_(ss, SHEET_NAMES.RECORDS), todayStr);
  if (records.length === 0) return jsonOutput_({ status: 'no_records' });
  const candidates = records.filter(function (r) { return isTimeValue_(r.leave_time); });
  if (candidates.length === 0) {
    return jsonOutput_({ status: 'all_away', count: records.length });
  }
  const winner = pickGatekeeper_(candidates);
  return jsonOutput_({ status: 'live', gatekeeper: winner.name, leave_time: winner.leave_time, count: records.length });
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
