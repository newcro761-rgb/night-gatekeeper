<#
야근왕 API 스모크 테스트.
admin_key는 하드코딩하지 않고 $env:ADMIN_KEY로 주입한다 (커밋 시 노출 방지).

사용법:
  $env:ADMIN_KEY = "실제 ADMIN_KEY 값"
  .\test\manual-api-test.ps1 -BaseUrl "https://script.google.com/macros/s/XXXX/exec"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
)

if (-not $env:ADMIN_KEY) {
    Write-Host "ADMIN_KEY 환경변수가 설정되어 있지 않습니다. 관리자 API 테스트는 건너뜁니다." -ForegroundColor Yellow
}

function Post-Json($action, $body) {
    $payload = ($body + @{ action = $action }) | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri $BaseUrl -ContentType "text/plain;charset=UTF-8" -Body $payload
}

Write-Host "`n=== names ===" -ForegroundColor Cyan
Invoke-RestMethod "$BaseUrl?action=names" | ConvertTo-Json

Write-Host "`n=== submit (정상) ===" -ForegroundColor Cyan
Post-Json "submit" @{ name = "테스트직원"; leave_time = "19:30" } | ConvertTo-Json

Write-Host "`n=== submit (명단에 없는 이름) ===" -ForegroundColor Cyan
Post-Json "submit" @{ name = "존재하지않는사람"; leave_time = "19:00" } | ConvertTo-Json

Write-Host "`n=== submit (잘못된 시간 형식) ===" -ForegroundColor Cyan
Post-Json "submit" @{ name = "테스트직원"; leave_time = "9:5" } | ConvertTo-Json

Write-Host "`n=== today ===" -ForegroundColor Cyan
Invoke-RestMethod "$BaseUrl?action=today" | ConvertTo-Json

Write-Host "`n=== history ===" -ForegroundColor Cyan
Invoke-RestMethod "$BaseUrl?action=history" | ConvertTo-Json

if ($env:ADMIN_KEY) {
    Write-Host "`n=== admin_records (틀린 키) ===" -ForegroundColor Cyan
    Post-Json "admin_records" @{ date = (Get-Date -Format "yyyy-MM-dd"); admin_key = "wrong-key" } | ConvertTo-Json

    Write-Host "`n=== admin_records (올바른 키) ===" -ForegroundColor Cyan
    Post-Json "admin_records" @{ date = (Get-Date -Format "yyyy-MM-dd"); admin_key = $env:ADMIN_KEY } | ConvertTo-Json
}

Write-Host "`n응답 본문에 본인이 입력한 값 외의 타인 시간 정보가 없는지 위 출력을 직접 확인하세요." -ForegroundColor Yellow
