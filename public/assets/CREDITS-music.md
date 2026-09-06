# Music provenance

AI-generated music beds and stingers (Google Flow Music, user-supplied generations remastered into game loops).
Never labelled CC0. Source `music/` dir is git-ignored (raw user generations, 16 MB); the committed files below
are the remastered game loops only. Chain per bed (`tools/assets/master-music.mjs`): trim dead air → append a
6–10 s equal-power (qsin) tail-head crossfade so the file's own end melts into its own start (measured head/tail
correlations were ~0.04–0.19 — no true loop point exists — and morgarten/title carry composed fade-out tails) →
two-pass EBU R128 to −14 LUFS beds / −16 LUFS stingers, true-peak −1.5 dBTP via lookahead limiter → opus 48 kHz
stereo 64 kbps + mp3 48 kHz stereo 128 kbps. Player loops the whole file (`loop=true`); the seam region is
music-over-music, no silence, no click.

| file | source | date | bytes |
|---|---|---|---|
| music/title.opus+mp3 | music.title.mp3 (Google Flow Music, user generation) | 2026-09-06 | 4242687 |
| music/explore.opus+mp3 | music.explore.mp3 (Google Flow Music, user generation) | 2026-09-06 | 3554881 |
| music/tavern.opus+mp3 | music.tavern.mp3 (Google Flow Music, user generation) | 2026-09-06 | 4170343 |
| music/battle.opus+mp3 | music.battle.mp3 (Google Flow Music, user generation) | 2026-09-06 | 4011317 |
| music/church.opus+mp3 | music.church.mp3 (Google Flow Music, user generation) | 2026-09-06 | 3946473 |
| music/morgarten.opus+mp3 | music.morgarten.mp3 (Google Flow Music, user generation) | 2026-09-06 | 4429682 |
| music/discover.opus+mp3 | discover.mp3 (Google Flow Music, user generation) | 2026-09-06 | 70133 |
| music/quest-done.opus+mp3 | quest-done.mp3 (Google Flow Music, user generation) | 2026-09-06 | 74327 |
| music/quest-fail.opus+mp3 | quest-fail.m4a (Google Flow Music, user generation) | 2026-09-06 | 72770 |
