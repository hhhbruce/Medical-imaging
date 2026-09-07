# NEXUS 医学影像平台 - 本地开发一键启动
#
# 启动细节与 docs/backstart.md 保持一致（Node 真实目录 + corepack yarn）。
#
# 用法（在 Medical-imaging 目录下）:
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -WithMonai       # 同时拉起 MONAI Label (:8002)
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -WithWorkbench   # 同时拉起 docker 后台 (:1026)
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -NoOpen          # 不自动打开主页
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -Stop            # 停掉主页/人体图谱/研究空间三个开发服务
#
# 默认拉起：Orthanc、主页 (:8791)、人体图谱 (:5173)、研究空间 (:3000)。
# 已在运行的服务不会重复启动。

param(
  [switch]$WithMonai,
  [switch]$WithWorkbench,
  [switch]$NoOpen,
  [switch]$Stop
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot  # -> Medical-imaging
$nodeDir = 'D:\environment\nvm\v20.9.0'   # docs/backstart.md: 必须用 Node 真实安装目录

function Test-Port([int]$p) {
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# ---------- -Stop: 只停开发服务（不动 Docker 与 MONAI） ----------
if ($Stop) {
  foreach ($port in 8791, 5173, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        Write-Host ("停止端口 {0} 上的进程 (PID {1})" -f $port, $_)
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  }
  return
}

function Compose-Up([string[]]$services) {
  docker compose -f (Join-Path $root 'docker-compose.yml') up -d @services
}

Write-Host ''
Write-Host '=== NEXUS 本地开发启动 ===' -ForegroundColor Cyan

# --- 1. Orthanc 中间件 (:8042) ---
if (Test-Port 8042) {
  Write-Host '[1/5] Orthanc :8042 已在运行'
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Host '[1/5] 启动 Orthanc (docker compose up -d orthanc)...'
  Compose-Up @('orthanc') | Out-Host
} else {
  Write-Host '[1/5] 跳过 Orthanc：未检测到 docker' -ForegroundColor Yellow
}

# --- 2. MONAI Label (:8002, 可选) ---
if (Test-Port 8002) {
  Write-Host '[2/5] MONAI Label :8002 已在运行'
} elseif ($WithMonai) {
  Write-Host '[2/5] 启动 MONAI Label (conda 环境 smartcity)...'
  $env:PYTHONPATH = 'D:\Smart City\Medical-imaging\monai-label'
  $env:MONAI_LABEL_CHECKPOINTS_DIR = 'D:\Smart City\checkpoints'
  $env:MONAI_LABEL_RUNTIME_DIR = 'D:\Smart City\Medical-imaging\monai-label'
  $env:LOAD_SAM2 = 'lazy'; $env:LOAD_SAM3 = 'lazy'; $env:LOAD_MEDSAM2 = 'lazy'; $env:LOAD_VOXTELL = 'lazy'
  # VoxTell 文本编码器：本地预下载目录（scripts/download_qwen_embedding.py），免运行时联网
  $env:VOXTELL_TEXT_BACKBONE = 'D:\Smart City\checkpoints\Qwen3-Embedding-4B'
  $env:PYTHONUNBUFFERED = '1'
  Start-Process -WindowStyle Hidden -FilePath 'cmd' -ArgumentList '/c',
    ('conda run --no-capture-output -n smartcity python -u -m monailabel.main start_server' +
     ' --app "D:\Smart City\Medical-imaging\monai-label\sample-apps\radiology"' +
     ' --studies "http://localhost:8042/dicom-web"' +
     ' --conf models segmentation --conf use_pretrained_model false' +
     ' --host 0.0.0.0 --port 8002')
} else {
  Write-Host '[2/5] MONAI Label :8002 未运行（加 -WithMonai 可一并拉起）' -ForegroundColor Yellow
}

# --- 3. 主页 (:8791) ---
if (Test-Port 8791) {
  Write-Host '[3/5] 主页 :8791 已在运行'
} else {
  Write-Host '[3/5] 启动主页静态服务 :8791...'
  Start-Process -WindowStyle Hidden -FilePath python `
    -ArgumentList '-m', 'http.server', '8791' `
    -WorkingDirectory (Join-Path $root 'landing')
}

# --- 4. 人体图谱 (:5173, Vite dev) ---
if (Test-Port 5173) {
  Write-Host '[4/5] 人体图谱 :5173 已在运行'
} elseif (Test-Path (Join-Path $nodeDir 'node.exe')) {
  Write-Host '[4/5] 启动人体图谱 (vite dev :5173)...'
  $env:Path = "$nodeDir;$env:Path"
  Start-Process -WindowStyle Hidden -FilePath 'cmd' `
    -ArgumentList '/c', 'npm run dev >> atlas_dev_stdout.log 2>&1' `
    -WorkingDirectory (Join-Path $root 'landing\landing')
} else {
  Write-Host "[4/5] 跳过人体图谱：未找到 Node ($nodeDir)" -ForegroundColor Yellow
}

# --- 5. 研究空间 (:3000, Viewers rsbuild dev) ---
if (Test-Port 3000) {
  Write-Host '[5/5] 研究空间 :3000 已在运行'
} elseif (Test-Path (Join-Path $nodeDir 'node.exe')) {
  Write-Host '[5/5] 启动研究空间 (corepack yarn dev:fast)...'
  # 与 docs/backstart.md 第 3 节完全一致
  $env:Path = "$nodeDir;$env:Path"
  $env:NODE_ENV = 'development'
  $env:MONAI_PROXY_DOMAIN = 'http://localhost:8002'
  $env:PROXY_TARGET = '/pacs/dicom-web'
  $env:PROXY_DOMAIN = 'http://localhost:8042'
  $env:PROXY_PATH_REWRITE_FROM = '/pacs/dicom-web'
  $env:PROXY_PATH_REWRITE_TO = '/dicom-web'
  $env:APP_CONFIG = 'config/docker-nginx-orthanc.js'
  Start-Process -WindowStyle Hidden -FilePath 'cmd' `
    -ArgumentList '/c', 'corepack yarn dev:fast >> ohif_dev_stdout.log 2>&1' `
    -WorkingDirectory (Join-Path $root 'Viewers')
} else {
  Write-Host "[5/5] 跳过研究空间：未找到 Node ($nodeDir)" -ForegroundColor Yellow
}

# --- docker 后台 (:1026, 可选) ---
if ($WithWorkbench) {
  if (Test-Port 1026) {
    Write-Host '      后台 :1026 已在运行'
  } elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host '      启动后台 ohif_viewer (docker compose)...'
    Compose-Up @('ohif_viewer') | Out-Host
  } else {
    Write-Host '      跳过后台：未检测到 docker' -ForegroundColor Yellow
  }
}

# --- 打开主页（系统统一入口） ---
if (-not $NoOpen) {
  Start-Sleep -Seconds 2
  Write-Host '打开主页 http://localhost:8791/ ...'
  Start-Process 'http://localhost:8791/'
}

Write-Host ''
Write-Host '--- 路由表 ---' -ForegroundColor Cyan
Write-Host '主页         http://localhost:8791/   landing/ 静态页，所有入口的出发点'
Write-Host '人体图谱     http://localhost:5173/   landing/landing vite dev，左上角「返回 NEXUS 主页」回主页'
Write-Host '研究空间     http://localhost:3000/   Viewers rsbuild dev，左上角 NEXUS logo 返回主页'
Write-Host '后台         http://localhost:1026/   docker ohif_viewer（-WithWorkbench 启动，logo 同样返回主页）'
Write-Host '中间件后台   http://localhost:8042/   docker orthanc（Orthanc Explorer，无返回链接，浏览器返回）'
Write-Host 'MONAI Label  http://localhost:8002/   本机原生服务，研究空间经 /monai 代理访问'
