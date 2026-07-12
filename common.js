// Apps Script 웹앱 배포(exec) URL — apps-script/Code.gs 배포 후 여기에 채워 넣는다.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec';

function handleApiResponse_(resp) {
  if (resp && resp.result === 'BUSY') {
    showToast('사용자가 많아 처리가 지연되고 있어요. 잠시 후 다시 시도해 주세요.');
  }
  return resp;
}

function apiGet(action, extraParams) {
  const qs = new URLSearchParams(Object.assign({ action: action }, extraParams || {})).toString();
  return fetch(`${APPS_SCRIPT_URL}?${qs}`)
    .then(r => r.json())
    .then(handleApiResponse_);
}

function apiPost(action, body) {
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(Object.assign({ action: action }, body || {}))
  })
    .then(r => r.json())
    .then(handleApiResponse_);
}

// 관리자 API는 admin_key가 브라우저 히스토리/쿼리스트링에 남지 않도록 반드시 POST로만 호출한다.
function adminApiPost(action, body) {
  return apiPost(action, Object.assign({ admin_key: getAdminKey() }, body || {}));
}

function getAdminKey() {
  return sessionStorage.getItem('admin_key') || '';
}
function setAdminKey(k) {
  sessionStorage.setItem('admin_key', k);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
