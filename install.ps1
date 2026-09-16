<#
============================================================================
 Super-Notepad — script de instalação (Windows / PowerShell)
============================================================================
 Espelho do install.sh para Windows. Prepara o app a partir do repositório:
   1. Cria o venv do backend e instala as dependências Python
   2. Compila o frontend (gera backend\super_notepad\web_dist)
   3. Escreve %USERPROFILE%\.super-notepad\desktop.json (o shell Tauri acha o backend)
   4. Instala um atalho `super-notepad.cmd` em %USERPROFILE%\.local\bin
   5. Compila o instalador Tauri (NSIS .exe) e o abre para você concluir

 Uso (PowerShell):
   .\install.ps1                  # tudo (inclui o instalador do app)
   .\install.ps1 -NoApp           # não compila o instalador NSIS
   .\install.ps1 -NoFrontend      # pula o build do frontend
   .\install.ps1 -NoLauncher      # não cria o atalho em .local\bin
   .\install.ps1 -NoDesktopConfig # não escreve o desktop.json
   .\install.ps1 -Port 9010       # porta do backend (padrão 9010)

 Se o PowerShell recusar rodar o script (política de execução), abra assim:
   powershell -ExecutionPolicy Bypass -File .\install.ps1
============================================================================
#>

[CmdletBinding()]
param(
    [switch]$NoFrontend,
    [switch]$NoLauncher,
    [switch]$NoDesktopConfig,
    [switch]$NoApp,
    [int]$Port = 9010,
    [switch]$Help
)

# Aborta em erro de cmdlet; erros de comandos nativos são checados via $LASTEXITCODE.
$ErrorActionPreference = 'Stop'

if ($Help) {
    Get-Content $PSCommandPath | Select-Object -Skip 1 -First 24 |
        ForEach-Object { $_ -replace '^\s*#?\s?', '' }
    exit 0
}

# ── Saída ────────────────────────────────────────────────────────────────────
function Write-Bar  { Write-Host ('─' * 52) -ForegroundColor DarkGray }
function Write-Step($m) { Write-Host "`n> $m" -ForegroundColor Red }
function Write-Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Die($m)        { Write-Host "`nX $m`n" -ForegroundColor Red; exit 1 }

# Roda um comando nativo e aborta se ele retornar código != 0.
function Invoke-Checked {
    param([scriptblock]$Block, [string]$What)
    & $Block
    if ($LASTEXITCODE -ne 0) { Die "$What falhou (código $LASTEXITCODE)." }
}

# ── Caminhos ─────────────────────────────────────────────────────────────────
$Root      = $PSScriptRoot
$Backend   = Join-Path $Root 'backend'
$Dashboard = Join-Path $Root 'frontend\dashboard'
$SnHome    = if ($env:SUPER_NOTEPAD_HOME) { $env:SUPER_NOTEPAD_HOME } else { Join-Path $env:USERPROFILE '.super-notepad' }
$VenvPy    = Join-Path $Backend '.venv\Scripts\python.exe'

$DoApp = -not $NoApp

Write-Bar
Write-Host '  Instalando o app Super-Notepad' -ForegroundColor White
Write-Host "  $Root" -ForegroundColor DarkGray
Write-Bar

# ── Pré-requisitos ───────────────────────────────────────────────────────────
Write-Step 'Verificando pré-requisitos'

# No Windows o interpretador é `python` (ou o launcher `py`); `python3` é do Unix.
$Python = $null
foreach ($cand in @('python', 'py')) {
    $cmd = Get-Command $cand -ErrorAction SilentlyContinue
    if ($cmd) { $Python = $cmd.Source; break }
}
if (-not $Python) { Die 'python não encontrado. Instale o Python 3.10+ (marque "Add to PATH").' }
$PyVer = (& $Python -c 'import sys; print("%d.%d" % sys.version_info[:2])')
Write-Ok "python $PyVer ($Python)"

if (-not $NoFrontend -or $DoApp) {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        Write-Ok "pnpm $(pnpm --version)"
    }
    elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
        Write-Warn 'pnpm ausente — habilitando via corepack'
        corepack enable 2>$null
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            Die 'Não consegui habilitar o pnpm. Instale-o: npm i -g pnpm'
        }
        Write-Ok "pnpm $(pnpm --version)"
    }
    else {
        Die 'pnpm não encontrado (necessário para o frontend/app). Instale-o ou rode com -NoFrontend -NoApp.'
    }
}

if ($DoApp) {
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        Write-Ok "cargo $((cargo --version).Split(' ')[1])"
    }
    else {
        Write-Warn 'cargo (Rust) não encontrado — pulando o app. Instale via https://rustup.rs e rode de novo, ou use -NoApp.'
        $DoApp = $false
    }
}

# ── Backend ──────────────────────────────────────────────────────────────────
Write-Step 'Backend (Python + SQLite)'
if (-not (Test-Path $VenvPy)) {
    Invoke-Checked { & $Python -m venv (Join-Path $Backend '.venv') } 'Criação do venv'
    Write-Ok 'venv criado em backend\.venv'
}
else {
    Write-Ok 'venv já existe'
}
Invoke-Checked { & $VenvPy -m pip install -q --upgrade pip } 'Atualização do pip'
Invoke-Checked { & $VenvPy -m pip install -q -r (Join-Path $Backend 'requirements.txt') } 'Instalação das dependências'
Write-Ok 'dependências instaladas'

# ── Frontend ─────────────────────────────────────────────────────────────────
if (-not $NoFrontend) {
    Write-Step 'Frontend (React + Vite)'
    Push-Location $Dashboard
    try {
        Invoke-Checked { pnpm install --silent } 'pnpm install (frontend)'
        Write-Ok 'dependências instaladas'
        Invoke-Checked { pnpm build } 'pnpm build (frontend)'
        Write-Ok 'build gerado em backend\super_notepad\web_dist'
    }
    finally { Pop-Location }
}
else {
    Write-Warn 'Frontend pulado (-NoFrontend). O backend precisa do build para servir a UI.'
}

# ── Config do desktop (Tauri) ────────────────────────────────────────────────
if (-not $NoDesktopConfig) {
    Write-Step 'Configuração do desktop (Tauri)'
    New-Item -ItemType Directory -Force -Path $SnHome | Out-Null
    # ConvertTo-Json escapa as barras invertidas dos caminhos do Windows — montar
    # o JSON à mão geraria `\` soltos e um arquivo inválido.
    $desktopCfg = [ordered]@{
        python      = $VenvPy
        backend_dir = $Backend
        port        = $Port
        keep_panel  = $false
    }
    $desktopJson = Join-Path $SnHome 'desktop.json'
    # WriteAllText grava UTF-8 SEM BOM (o `Set-Content -Encoding UTF8` do
    # Windows PowerShell 5.1 põe BOM, e o serde_json do shell Rust não lê JSON
    # com BOM na frente → o desktop.json seria ignorado).
    [System.IO.File]::WriteAllText($desktopJson, ($desktopCfg | ConvertTo-Json))
    Write-Ok "escrito $desktopJson"
}

# ── Atalho `super-notepad` ───────────────────────────────────────────────────
if (-not $NoLauncher) {
    Write-Step 'Atalho de linha de comando'
    $BinDir = Join-Path $env:USERPROFILE '.local\bin'
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $Launcher = Join-Path $BinDir 'super-notepad.cmd'
    # `.cmd` (não `.ps1`) para rodar de qualquer shell só digitando `super-notepad`.
    $cmdBody = @"
@echo off
rem Sobe o backend do app Super-Notepad (gerado por install.ps1).
cd /d "$Backend"
"$VenvPy" -m super_notepad --port $Port %*
"@
    Set-Content -Path $Launcher -Value $cmdBody -Encoding ASCII
    Write-Ok "instalado $Launcher"
    $pathDirs = ($env:PATH -split ';')
    if ($pathDirs -notcontains $BinDir) {
        Write-Warn "$BinDir não está no PATH — adicione-o (Configurações > Variáveis de ambiente) ou rode:"
        Write-Warn "  setx PATH `"%PATH%;$BinDir`""
    }
}

# ── App do sistema (instalador NSIS) ─────────────────────────────────────────
$AppInstalled = $false
if ($DoApp) {
    Write-Step 'App do sistema (Tauri → instalador NSIS)'
    if (-not (Test-Path (Join-Path $Backend 'super_notepad\web_dist\index.html'))) {
        Write-Warn 'web_dist ausente (rode sem -NoFrontend). O app precisa do frontend compilado; pulando.'
    }
    else {
        Push-Location (Join-Path $Root 'desktop')
        try {
            Invoke-Checked { pnpm install --silent } 'pnpm install (desktop)'
            Write-Host '  compilando o app em modo release — pode levar alguns minutos…' -ForegroundColor DarkGray
            # `--bundles nsis` sobrepõe o alvo `app` (bundle macOS) do tauri.conf.json.
            Invoke-Checked { pnpm tauri build --bundles nsis } 'pnpm tauri build'
        }
        finally { Pop-Location }

        $nsisDir = Join-Path $Root 'desktop\src-tauri\target\release\bundle\nsis'
        $installer = Get-ChildItem -Path $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($installer) {
            Write-Ok "instalador gerado: $($installer.FullName)"
            # Diferente do macOS (cp do .app para /Applications), no Windows a
            # instalação passa pelo assistente do NSIS — abrimos para você concluir.
            try {
                Start-Process -FilePath $installer.FullName
                Write-Ok 'assistente de instalação aberto — conclua os passos na janela.'
                $AppInstalled = $true
            }
            catch {
                Write-Warn "não consegui abrir o instalador automaticamente; rode-o manualmente: $($installer.FullName)"
            }
        }
        else {
            Write-Warn "instalador NSIS não encontrado em: $nsisDir"
        }
    }
}

# ── Resumo ───────────────────────────────────────────────────────────────────
Write-Host ''
Write-Bar
Write-Host '  Pronto!' -ForegroundColor Green
Write-Bar
if ($AppInstalled) {
    Write-Host '  Super Note: conclua o assistente e abra pelo menu Iniciar.' -ForegroundColor White
}
Write-Host '  Iniciar pelo terminal:'
if (-not $NoLauncher) {
    Write-Host "    super-notepad                 # abre em http://127.0.0.1:$Port" -ForegroundColor White
}
Write-Host "    backend\.venv\Scripts\python.exe -m super_notepad --port $Port" -ForegroundColor White
Write-Host '  App desktop (Tauri, modo dev):'
Write-Host '    cd desktop; pnpm install; pnpm tauri dev' -ForegroundColor White
Write-Host "  Dados em: $SnHome  (notes.db)" -ForegroundColor White
Write-Host ''
