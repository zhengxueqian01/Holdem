param(
  [string]$BaseUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

Write-Host "Smoke check base url: $BaseUrl"

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health"
if (-not $health.ok) {
  throw "Health check failed"
}
Write-Host "Health OK"

$auth = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/guest" -ContentType "application/json" -Body (@{ name = "smoke-user" } | ConvertTo-Json)
$token = $auth.token
if (-not $token) {
  throw "Auth token missing"
}
Write-Host "Auth OK"

$headers = @{
  Authorization = "Bearer $token"
}

$tablePayload = @{
  name = "smoke-table"
  smallBlind = 5
  bigBlind = 10
  maxSeats = 6
  minBuyIn = 100
  maxBuyIn = 1000
  actionTimeoutSec = 20
} | ConvertTo-Json

$table = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/tables" -Headers $headers -ContentType "application/json" -Body $tablePayload
$tableId = $table.table.id
if (-not $tableId) {
  throw "Table creation failed"
}
Write-Host "Table creation OK: $tableId"

Write-Host "Smoke check completed successfully."
