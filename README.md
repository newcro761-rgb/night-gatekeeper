# 야근왕 (문지기)

팀 퇴근시간 기록 및 매일 16:00 문지기(문단속 담당) 자동 확정 웹앱.

- 프론트: GitHub Pages (`index.html`, `admin.html`, `common.js`)
- 백엔드: Google Apps Script 웹앱 (`apps-script/Code.gs`)
- DB: Google Sheets (관리자 개인 계정 소유)

전부 GitHub/Google 클라우드에서 실행되므로 배포 후에는 로컬 PC를 켜둘 필요가 없습니다.

## 1. Google Sheets 준비 (수동)

1. 새 Google 스프레드시트 생성 (이름 예: "야근왕 DB")
2. 시트 3개를 아래 스키마대로 생성 (1행은 헤더):

   **직원명단**
   | A: name | B: active | C: created_at |
   |---|---|---|

   **기록**
   | A: date | B: name | C: leave_time | D: created_at | E: updated_at |
   |---|---|---|---|---|

   **문지기확정**
   | A: date | B: gatekeeper | C: confirmed_at | D: revision | E: note |
   |---|---|---|---|---|

3. **중요**: 각 시트의 2행부터 전체 열(특히 `기록`의 A/C/D/E, `문지기확정`의 A/C)을 선택해 서식 → 숫자 → **일반 텍스트**로 지정하세요.
   (메뉴에서: 해당 열 범위 선택 → 서식(Format) → 숫자(Number) → 일반 텍스트(Plain text))
   이걸 빼먹으면 Sheets가 "19:30"이나 "2026-07-12"를 자동으로 시간/날짜 값으로 바꿔버려서 동점자 비교·날짜 매칭 로직이 깨집니다.
4. 파일 → 스프레드시트 설정에서 시간대를 **Asia/Seoul**로 맞춰두세요 (코드에서도 명시적으로 지정하지만 이중 방어).
5. 스프레드시트 URL은 별도로 메모만 해두고, 이 저장소에는 커밋하지 마세요.

## 2. Apps Script 배포 (수동)

1. 스프레드시트에서 **확장 프로그램 → Apps Script** 클릭
2. 기본 생성된 `Code.gs` 내용을 전부 지우고, 이 저장소의 `apps-script/Code.gs` 내용을 붙여넣기
3. 저장 (Ctrl+S)
4. 우측 상단 **배포 → 새 배포**
   - 유형: 웹 앱
   - 실행 인원: **나 (내 계정)**
   - 액세스 권한: **모든 사용자**
5. 배포 후 나오는 **웹 앱 URL(exec로 끝남)**을 복사
6. `common.js`의 `APPS_SCRIPT_URL` 상수 값을 방금 복사한 URL로 교체

### 코드를 수정할 때마다

같은 URL을 유지하려면 **배포 관리 → 기존 배포 수정 → 새 버전**으로 재배포하세요. "새 배포"를 다시 만들면 URL이 바뀌어 프론트를 다시 고쳐야 합니다.

## 3. 16:00 확정 트리거 등록 (수동, 1회)

1. Apps Script 편집기 상단 함수 선택 드롭다운에서 `setupDailyTrigger` 선택
2. **실행** 버튼 클릭 (처음 실행 시 권한 승인 필요 — 본인 계정이므로 "고급 → 안전하지 않음으로 이동" 후 허용)
3. 좌측 **트리거(시계 아이콘)** 메뉴에서 `dailyConfirmTrigger`가 매일 16시대에 등록됐는지 확인

`atHour(16)` 트리거는 16:00~17:00 사이 임의 시점에 실행되는 것이 Apps Script의 정상 동작입니다(정각 보장 안 됨). 실제 확정은 `today` API의 온디맨드 폴백이 보완하므로 트리거가 조금 늦게 돌아도 사용자에게는 문제가 없습니다.

## 4. 관리자 키 설정 (수동)

1. Apps Script 편집기 → 좌측 **프로젝트 설정(톱니바퀴)** → **스크립트 속성**
2. 속성 추가: 키 `ADMIN_KEY`, 값은 원하는 비밀번호(임의의 문자열)
3. 이 값은 `admin.html`의 로그인 비밀번호로도 그대로 사용됩니다. 저장소 어디에도 이 값을 커밋하지 마세요.

## 5. GitHub Pages 배포

```
git remote add origin https://github.com/<your-account>/night-gatekeeper.git
git push -u origin main
```

이후 GitHub 저장소 **Settings → Pages**에서 소스를 `main` 브랜치 / `/ (root)`로 지정하면 `https://<your-account>.github.io/night-gatekeeper/`로 서비스됩니다.

## 6. 통합 테스트

`test/manual-api-test.ps1` 참고. 실행 전 관리자 키를 환경변수로 주입:

```powershell
$env:ADMIN_KEY = "여기에 실제 ADMIN_KEY 값"
.\test\manual-api-test.ps1 -BaseUrl "https://script.google.com/macros/s/XXXX/exec"
```

## 프라이버시 원칙

- `names`/`today`/`history`/`submit` 응답에는 문지기 이름 또는 본인 입력값 에코 외의 시간 정보가 절대 포함되지 않습니다.
- 타인의 퇴근시간은 관리자 API(`admin_records`, admin_key 필요)로만 열람 가능합니다.
- `admin_key`는 Script Properties에만 저장되고 코드/저장소에 값 자체가 포함되지 않습니다.

## 알려진 제약

- 직원 이름은 고유키입니다. 이름 변경 시 과거 기록/문지기확정 시트의 데이터는 소급 갱신되지 않습니다(역대 문지기 목록에 개명 전 이름이 남을 수 있음). 동명이인도 지원하지 않습니다.
- `/names`는 자동완성을 위해 인증 없이 공개됩니다 — 이 앱의 URL 자체가 팀 내부 공유 전제의 접근 통제 수단입니다.

## Phase 2 (계획, 미구현)

`manifest.json` + service worker를 추가해 PWA로 전환.
