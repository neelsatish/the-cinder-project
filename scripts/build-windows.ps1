$ErrorActionPreference = "Stop"

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "Windows installers must be built on Windows."
}

$repoDir = Split-Path -Parent $PSScriptRoot
Push-Location $repoDir

try {
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript checks failed." }

    npm.cmd run test:gradebook-intent
    if ($LASTEXITCODE -ne 0) { throw "Gradebook intent tests failed." }

    npm.cmd run audit:dependencies
    if ($LASTEXITCODE -ne 0) { throw "The npm dependency audit failed." }

    cargo fmt --all -- --check
    if ($LASTEXITCODE -ne 0) { throw "Rust formatting checks failed." }

    cargo test --workspace --locked
    if ($LASTEXITCODE -ne 0) { throw "Rust tests failed." }

    npm.cmd run bundle:windows:student
    if ($LASTEXITCODE -ne 0) { throw "Cinder Student packaging failed." }

    npm.cmd run bundle:windows:teacher
    if ($LASTEXITCODE -ne 0) { throw "Cinder Teacher packaging failed." }

    Write-Host "Cinder Student and Teacher Windows installers are ready under target\release\bundle\nsis."
    Get-ChildItem "target\release\bundle\nsis" -File |
        Where-Object { $_.Name -match "(setup\.exe|nsis\.zip|\.sig)$" } |
        Select-Object Name, Length
}
finally {
    Pop-Location
}
