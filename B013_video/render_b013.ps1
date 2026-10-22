param(
    [Parameter(Mandatory = $true)]
    [string]$FfmpegPath
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$assets = Join-Path $root 'assets'
$output = Join-Path $root 'B013_65s_竖屏视觉版_无配乐.mp4'

$shots = @(
    @{ File='B013_钩子_白领食客嗤笑.jpg'; Duration=3; Motion='push' },
    @{ File='B013_反应_食客群像.jpg'; Duration=3; Motion='panRight' },
    @{ File='B013_反应_食客群像.jpg'; Duration=3; Motion='push' },
    @{ File='B013_主角_烤串大叔_夜市首帧.jpg'; Duration=2; Motion='push' },
    @{ File='B013_主角_烤串大叔_夜市首帧.jpg'; Duration=3; Motion='pushSlow' },
    @{ File='B013_钩子_白领食客嗤笑.jpg'; Duration=3; Motion='panLeft' },
    @{ File='B013_反应_食客群像.jpg'; Duration=3; Motion='panRight' },
    @{ File='B013_主角_烤串大叔_夜市首帧.jpg'; Duration=3; Motion='push' },
    @{ File='B013_闪回_老家小院母亲.jpg'; Duration=3; Motion='pushSlow' },
    @{ File='B013_反应_食客群像.jpg'; Duration=3; Motion='panLeft' },
    @{ File='B013_钩子_白领食客嗤笑.jpg'; Duration=3; Motion='push' },
    @{ File='B013_主角_烤串大叔_高潮哭腔特写.jpg'; Duration=6; Motion='pushSlow' },
    @{ File='B013_闪回_白天工地搬砖.jpg'; Duration=4; Motion='tiltUp' },
    @{ File='B013_反应_落泪特写.jpg'; Duration=4; Motion='pushSlow' },
    @{ File='B013_反应_食客群像.jpg'; Duration=4; Motion='panRight' },
    @{ File='B013_场景_夜市大排档空镜.jpg'; Duration=3; Motion='pushSlow' },
    @{ File='B013_场景_夜市大排档空镜.jpg'; Duration=4; Motion='tiltUp' },
    @{ File='B013_反应_食客群像.jpg'; Duration=3; Motion='push' },
    @{ File='B013_主角_烤串大叔_夜市首帧.jpg'; Duration=3; Motion='panLeft' },
    @{ File='B013_场景_夜市大排档空镜.jpg'; Duration=2; Motion='pushSlow' }
)

$args = [System.Collections.Generic.List[string]]::new()
foreach ($shot in $shots) {
    $args.Add('-i')
    $args.Add((Join-Path $assets $shot.File))
}

$args.Add('-f')
$args.Add('lavfi')
$args.Add('-t')
$args.Add('65')
$args.Add('-i')
$args.Add('anullsrc=r=48000:cl=stereo')

$filters = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $shots.Count; $i++) {
    $frames = [int]($shots[$i].Duration * 30)
    switch ($shots[$i].Motion) {
        'push' {
            $z = "min(zoom+0.00075,1.07)"
            $x = "iw/2-(iw/zoom/2)"
            $y = "ih/2-(ih/zoom/2)"
        }
        'pushSlow' {
            $z = "min(zoom+0.0004,1.045)"
            $x = "iw/2-(iw/zoom/2)"
            $y = "ih/2-(ih/zoom/2)"
        }
        'panLeft' {
            $z = "1.065"
            $x = "(iw-iw/zoom)*(1-on/$frames)"
            $y = "ih/2-(ih/zoom/2)"
        }
        'panRight' {
            $z = "1.065"
            $x = "(iw-iw/zoom)*(on/$frames)"
            $y = "ih/2-(ih/zoom/2)"
        }
        'tiltUp' {
            $z = "1.055"
            $x = "iw/2-(iw/zoom/2)"
            $y = "(ih-ih/zoom)*(1-on/$frames)"
        }
    }

    $filter = "[$i`:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='$z':x='$x':y='$y':d=$frames`:s=1080x1920`:fps=30,trim=duration=$($shots[$i].Duration),setsar=1,setpts=PTS-STARTPTS,format=yuv420p[v$i]"
    $filters.Add($filter)
}

$labels = (0..19 | ForEach-Object { "[v$_]" }) -join ''
$filters.Add("$labels`concat=n=20`:v=1`:a=0[outv]")

$args.Add('-filter_complex_threads')
$args.Add('1')
$args.Add('-filter_complex')
$args.Add(($filters -join ';'))
$args.Add('-map')
$args.Add('[outv]')
$args.Add('-map')
$args.Add('20:a')
$args.Add('-c:v')
$args.Add('libx264')
$args.Add('-preset')
$args.Add('medium')
$args.Add('-crf')
$args.Add('19')
$args.Add('-pix_fmt')
$args.Add('yuv420p')
$args.Add('-r')
$args.Add('30')
$args.Add('-c:a')
$args.Add('aac')
$args.Add('-b:a')
$args.Add('192k')
$args.Add('-shortest')
$args.Add('-movflags')
$args.Add('+faststart')
$args.Add('-y')
$args.Add($output)

& $FfmpegPath @args
if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg failed with exit code $LASTEXITCODE"
}

Write-Output $output
