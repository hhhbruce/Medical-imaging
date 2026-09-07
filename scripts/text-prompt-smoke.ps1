# Text-Prompt Segmentation (VoxTell) smoke test — mirrors the OHIF frontend flow:
#   1. POST /nninter/session/           -> claim session token
#   2. POST /infer/segmentation (init)  -> initialize image for the session
#   3. POST /infer/segmentation (texts) -> run VoxTell text-prompt segmentation
# The infer endpoint takes multipart/form-data with a single "params" field
# containing the JSON request body (same as the frontend's FormData).
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\text-prompt-smoke.ps1 [-Text liver]
param(
  [string]$MonaiUrl   = 'http://localhost:8002',
  [string]$SeriesUID  = '1.3.6.1.4.1.14519.5.2.1.1706.8374.139683127466268036038326476970', # abdomen CT (43)
  [string]$StudyUID   = '1.3.6.1.4.1.14519.5.2.1.1706.8374.164750580271137946982420100377',
  [string]$Text       = 'liver'
)
$ErrorActionPreference = 'Stop'

function Post-Params($Url, $Params) {
  $json = $Params | ConvertTo-Json -Depth 8 -Compress
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, $json)
  try {
    return curl.exe -s -X POST $Url -F "params=<$tmp"
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "== [1/3] claim nninter session token =="
$claimJson = curl.exe -s -X POST "$MonaiUrl/nninter/session/"
$token = ($claimJson | ConvertFrom-Json).token
Write-Host "token: $token"

Write-Host "== [2/3] init session with series $SeriesUID =="
$initBody = @{
  nninter           = 'init'
  nninter_token     = $token
  studyInstanceUID  = $StudyUID
  largest_cc        = $false
  result_extension  = '.nii.gz'
  result_dtype      = 'uint16'
  result_compress   = $false
  restore_label_idx = $false
}
$initResp = Post-Params "$MonaiUrl/infer/segmentation?image=$SeriesUID&output=dicom_seg" $initBody
Write-Host "init resp (first 300 chars): $($initResp.Substring(0, [Math]::Min(300, $initResp.Length)))"

Write-Host "== [3/3] run VoxTell text prompt: '$Text' =="
$inferBody = @{
  nninter           = $true
  nninter_token     = $token
  studyInstanceUID  = $StudyUID
  texts             = @($Text)
  largest_cc        = $false
  result_extension  = '.nii.gz'
  result_dtype      = 'uint16'
  result_compress   = $false
  restore_label_idx = $false
}
$json = $inferBody | ConvertTo-Json -Depth 8 -Compress
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $json)
$outFile = Join-Path $PSScriptRoot 'text-prompt-smoke-response.dcm'
$code = curl.exe -sS -o $outFile -w '%{http_code}' -X POST "$MonaiUrl/infer/segmentation?image=$SeriesUID&output=dicom_seg" -F "params=<$tmp"
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
$size = if (Test-Path $outFile) { (Get-Item $outFile).Length } else { 0 }
Write-Host "infer HTTP=$code size=$size bytes -> $outFile"
