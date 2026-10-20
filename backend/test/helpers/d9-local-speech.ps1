param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$resolvedRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
if(-not $resolvedRoot.StartsWith('D:\trae_project\new1\integration-I1\backend\.tmp\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe local evidence root' }
New-Item -ItemType Directory -Force -Path $resolvedRoot | Out-Null
Add-Type -AssemblyName System.Speech
$measurements = @()
foreach($round in 0,1) {
  $outputPath = Join-Path $resolvedRoot "windows-local-$round.wav"
  if(Test-Path -LiteralPath $outputPath) { throw 'Refusing to overwrite prior evidence' }
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $speech.SelectVoice('Microsoft Huihui Desktop')
    $speech.SetOutputToWaveFile($outputPath)
    $speech.Speak('圆形没有尖角，所以可以滚动。')
  } finally { $speech.Dispose() }
  $timer.Stop()
  $measurements += [pscustomobject]@{ round=$round; provider='installed Windows System.Speech, Microsoft Huihui Desktop'; elapsedMs=$timer.Elapsed.TotalMilliseconds; audioBytes=(Get-Item -LiteralPath $outputPath).Length; physicalSpeakerVerified=$false; cloudRequests=0 }
}
$measurements | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $resolvedRoot 'local-speech.json') -Encoding utf8
