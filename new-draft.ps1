# Windows equivalent of new-draft.sh. Run before every draft:  .\new-draft.ps1
# Archives the previous draft's state so the board doesn't cold-start as it.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$dest  = "data\drafts\$stamp"
$moved = $false

foreach ($f in @("data\live.json", "data\seed.json")) {
  if (Test-Path $f) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Move-Item $f $dest
    Write-Host "archived $f -> $dest"
    $moved = $true
  }
}
Get-ChildItem "data\picks-*.ndjson" -ErrorAction SilentlyContinue | ForEach-Object {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Move-Item $_.FullName $dest
  Write-Host "archived $($_.Name) -> $dest"
  $moved = $true
}
if (-not $moved) { Write-Host "no previous draft state to archive" }

if (Test-Path ".watch.pid") { Remove-Item ".watch.pid" -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "Watcher state cleared."
Write-Host ""
Write-Host "One more step - the board keeps its own copy in the browser:"
Write-Host "   open the board and click  New draft  (top right)"
Write-Host ""
Write-Host "Then check config.json matches this league:"
node -e "const c=require('./config.json');console.log('   '+c.league+': '+c.teams+' teams x $'+c.budget+', '+c.rosterSlots+' spots, you = '+JSON.stringify(c.myTeamName))"
Write-Host ""
