<#
============================================================================
 Super-Notepad — script de instalação (Windows / PowerShell)
============================================================================
 Espelho do install.sh para Windows. Prepara o app a partir do repositório e,
 diferente do macOS, INSTALA as dependências que faltarem (via winget):
   0. Provisiona pré-requisitos ausentes: Python, Node.js (pnpm), Rust +
      MSVC C++ Build Tools e o WebView2 Runtime (o Tauri no Windows precisa
      dos dois últimos para compilar/rodar). Veja -NoBootstrap para desligar.
   1. Cria o venv do backend e instala as dependências Python
   2. Compila o frontend (gera backend\super_notepad\web_dist)
   3. Escreve %USERPROFILE%\.super-notepad\desktop.json (o shell Tauri acha o backend)
   4. Instala um atalho `super-notepad.cmd` em %USERPROFILE%\.local\bin
   5. Compila o instalador Tauri (NSIS .exe) e o abre para você concluir

 Uso (PowerShell):
   .\install.ps1                  # tudo (instala deps que faltam + instalador do app)
   .\install.ps1 -NoApp           # não compila o instalador NSIS (nem Rust/Build Tools)
   .\install.ps1 -NoFrontend      # pula o build do frontend
   .\install.ps1 -NoLauncher      # não cria o atalho em .local\bin
   .\install.ps1 -NoDesktopConfig # não escreve o desktop.json
   .\install.ps1 -NoBootstrap     # não instala nada automaticamente (só verifica)
   .\install.ps1 -Port 9010       # porta do backend (padrão 9010)

 Se o PowerShell recusar rodar o script (política de execução), abra assim:
   powershell -ExecutionPolicy Bypass -File .\install.ps1

 Dica: a instalação do MSVC C++ Build Tools e do WebView2 pode abrir um prompt
 de UAC (elevação). Aceite-o para o Tauri conseguir compilar.
============================================================================
#>

[CmdletBinding()]
param(
    [switch]$NoFrontend,
    [switch]$NoLauncher,
    [switch]$NoDesktopConfig,
    [switch]$NoApp,
    [switch]$NoBootstrap,
    [int]$Port = 9010,
    [switch]$Help
)

# Aborta em erro de cmdlet; erros de comandos nativos são checados via $LASTEXITCODE.
$ErrorActionPreference = 'Stop'

if ($Help) {
    Get-Content $PSCommandPath | Select-Object -Skip 1 -First 34 |
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

# ── Bootstrap de dependências (winget) ───────────────────────────────────────
# Reconstrói o PATH do processo a partir do registro (Máquina + Usuário) e das
# pastas conhecidas das ferramentas. Instaladores do winget mexem no PATH do
# sistema, mas o processo atual não enxerga a mudança até relermos o registro.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra   = @(
        (Join-Path $env:USERPROFILE '.cargo\bin')                       # rustup/cargo
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps')           # aliases de app (winget/python)
        (Join-Path $env:ProgramFiles 'nodejs')                          # node.js (machine)
        (Join-Path $env:APPDATA 'npm')                                  # npm -g / corepack shims
    )
    $parts = @()
    foreach ($p in @($machine, $user) + $extra) {
        if ($p) { $parts += ($p -split ';' | Where-Object { $_ }) }
    }
    # Preserva o PATH atual do processo à frente (venv ativado etc.) e deduplica.
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $final = @()
    foreach ($p in (($env:PATH -split ';') + $parts)) {
        $p = $p.TrimEnd('\')
        if ($p -and $seen.Add($p)) { $final += $p }
    }
    $env:PATH = ($final -join ';')
}

function Test-Command {
    param([string]$Name)
    [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$script:WingetChecked = $false
function Assert-Winget {
    if ($script:WingetChecked) { return $true }
    $script:WingetChecked = $true
    if (Test-Command 'winget') {
        Write-Ok "winget $((winget --version) 2>$null)"
        return $true
    }
    Write-Warn 'winget (App Installer) não encontrado — não consigo instalar dependências automaticamente.'
    Write-Warn 'Instale o "App Installer" pela Microsoft Store (ou atualize o Windows) e rode de novo,'
    Write-Warn 'ou instale as dependências manualmente e use -NoBootstrap.'
    return $false
}

# Instala um pacote pelo winget de forma não-interativa. Retorna $true no sucesso.
# winget devolve 0 no sucesso; -1978335189 = "já instalado" (também tratamos como ok).
function Install-WingetPackage {
    param([string]$Id, [string]$Label, [string[]]$ExtraArgs = @())
    if (-not (Assert-Winget)) { return $false }
    Write-Warn "instalando $Label — pode demorar e talvez peça elevação (UAC)…"
    $wgArgs = @(
        'install', '--id', $Id, '--exact',
        '--accept-package-agreements', '--accept-source-agreements',
        '--disable-interactivity', '--source', 'winget'
    ) + $ExtraArgs
    & winget @wgArgs
    $code = $LASTEXITCODE
    Update-SessionPath
    if ($code -eq 0 -or $code -eq -1978335189) {
        Write-Ok "$Label instalado"
        return $true
    }
    Write-Warn "winget retornou código $code ao instalar $Label."
    return $false
}

# Garante que um comando exista; se faltar e o bootstrap estiver ligado, instala.
# $Verify é um comando alternativo pra confirmar (útil quando o exe não fica no PATH).
function Ensure-Tool {
    param(
        [string]$Command,
        [string]$WingetId,
        [string]$Label,
        [string[]]$ExtraArgs = @(),
        [scriptblock]$Verify
    )
    if (Test-Command $Command) { return $true }
    Update-SessionPath
    if (Test-Command $Command) { return $true }

    if ($NoBootstrap) {
        Write-Warn "$Label não encontrado e -NoBootstrap ativo — pulando a instalação automática."
        return $false
    }
    [void](Install-WingetPackage -Id $WingetId -Label $Label -ExtraArgs $ExtraArgs)
    Update-SessionPath
    if (Test-Command $Command) { return $true }
    if ($Verify -and (& $Verify)) { return $true }
    return $false
}

# ── Caminhos ─────────────────────────────────────────────────────────────────
$Root      = $PSScriptRoot
$Backend   = Join-Path $Root 'backend'
$Dashboard = Join-Path $Root 'frontend\dashboard'
$SnHome    = if ($env:SUPER_NOTEPAD_HOME) { $env:SUPER_NOTEPAD_HOME } else { Join-Path $env:USERPROFILE '.super-notepad' }
$VenvPy    = Join-Path $Backend '.venv\Scripts\python.exe'

$DoApp = -not $NoApp
$NeedFront = (-not $NoFrontend) -or $DoApp

Write-Bar
Write-Host '  Instalando o app Super-Notepad' -ForegroundColor White
Write-Host "  $Root" -ForegroundColor DarkGray
Write-Bar

# ── Pré-requisitos ───────────────────────────────────────────────────────────
Write-Step 'Verificando / instalando pré-requisitos'
Update-SessionPath

# Python: no Windows o interpretador é `python` (ou o launcher `py`).
$Python = $null
foreach ($cand in @('python', 'py')) {
    $cmd = Get-Command $cand -ErrorAction SilentlyContinue
    # O alias da Microsoft Store (WindowsApps\python.exe) tem 0 bytes e só abre a
    # loja — ignoramos esse stub para não confundir com um Python real.
    if ($cmd -and ($cmd.Source -notmatch 'WindowsApps' -or (Get-Item $cmd.Source).Length -gt 0)) {
        $Python = $cmd.Source; break
    }
}
if (-not $Python) {
    if (Ensure-Tool -Command 'python' -WingetId 'Python.Python.3.12' -Label 'Python 3.12') {
        $Python = (Get-Command 'python' -ErrorAction SilentlyContinue).Source
    }
    if (-not $Python) { $Python = (Get-Command 'py' -ErrorAction SilentlyContinue).Source }
}
if (-not $Python) {
    Die 'python não encontrado e não foi possível instalá-lo. Instale o Python 3.10+ (marque "Add to PATH").'
}
$PyVer = (& $Python -c 'import sys; print("%d.%d" % sys.version_info[:2])')
Write-Ok "python $PyVer ($Python)"

# Node.js + pnpm (necessários pro frontend e pro app).
if ($NeedFront) {
    if (-not (Test-Command 'pnpm')) {
        # pnpm vem via corepack, que vem com o Node. Garante o Node primeiro.
        if (-not (Test-Command 'corepack') -and -not (Test-Command 'npm')) {
            [void](Ensure-Tool -Command 'node' -WingetId 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS')
        }
        if (Test-Command 'corepack') {
            Write-Warn 'habilitando o pnpm via corepack'
            corepack enable 2>$null
            corepack prepare pnpm@latest --activate 2>$null
            Update-SessionPath
        }
        if (-not (Test-Command 'pnpm') -and (Test-Command 'npm')) {
            Write-Warn 'corepack não resolveu — instalando pnpm via npm -g'
            npm install -g pnpm 2>$null
            Update-SessionPath
        }
    }
    if (Test-Command 'pnpm') {
        Write-Ok "pnpm $(pnpm --version)"
    }
    else {
        Die 'pnpm não encontrado e não foi possível instalá-lo. Instale o Node.js LTS (que traz o corepack) e rode de novo, ou use -NoFrontend -NoApp.'
    }
}

# Rust + toolchain de compilação nativa (só se for compilar o app).
if ($DoApp) {
    # 1) Rust (cargo). O rustup no Windows usa o host MSVC por padrão.
    if (-not (Test-Command 'cargo')) {
        [void](Ensure-Tool -Command 'cargo' -WingetId 'Rustlang.Rustup' -Label 'Rust (rustup)')
    }
    if (Test-Command 'cargo') {
        Write-Ok "cargo $((cargo --version).Split(' ')[1])"

        # 2) WebView2 Runtime — o Tauri usa o WebView2 pra renderizar a UI.
        #    Vem pré-instalado no Win11 e em Win10 atualizado; garantimos mesmo assim.
        if (-not $NoBootstrap) {
            $wv2Key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
            $wv2KeyAlt = 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
            if ((Test-Path $wv2Key) -or (Test-Path $wv2KeyAlt)) {
                Write-Ok 'WebView2 Runtime presente'
            }
            else {
                [void](Install-WingetPackage -Id 'Microsoft.EdgeWebView2Runtime' -Label 'WebView2 Runtime')
            }
        }

        # 3) MSVC C++ Build Tools — o linker que o target *-pc-windows-msvc do Rust
        #    usa. Sem isso o `cargo build`/`tauri build` falha ao "link".
        $hasMsvc = $false
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path $vswhere) {
            $vsInstall = & $vswhere -latest -products '*' `
                -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
                -property installationPath 2>$null
            if ($vsInstall) { $hasMsvc = $true }
        }
        if ($hasMsvc) {
            Write-Ok 'MSVC C++ Build Tools presentes'
        }
        elseif (-not $NoBootstrap) {
            # --override passa argumentos ao instalador do VS: workload C++ + SDK.
            $vsOverride = '--quiet --wait --norestart --nocache ' +
                '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
            [void](Install-WingetPackage -Id 'Microsoft.VisualStudio.2022.BuildTools' `
                -Label 'MSVC C++ Build Tools (workload VCTools)' `
                -ExtraArgs @('--override', $vsOverride))
        }
        else {
            Write-Warn 'MSVC C++ Build Tools ausentes e -NoBootstrap ativo — o build do Tauri pode falhar no link.'
        }
    }
    else {
        Write-Warn 'cargo (Rust) não encontrado e não foi possível instalá-lo — pulando o app. Instale via https://rustup.rs e rode de novo, ou use -NoApp.'
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
if (-not $NoBootstrap) {
    Write-Host ''
    Write-Warn 'Se instalamos algo agora (Node, Rust, Build Tools), feche e reabra o terminal'
    Write-Warn 'antes de usar esses comandos numa nova sessão — o PATH só atualiza em janelas novas.'
}
Write-Host ''
