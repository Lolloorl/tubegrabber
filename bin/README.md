# Programmi esterni

Metti qui i programmi che l'app usa (NON vanno nel repository: sono grandi e si aggiornano spesso).

| Cartella | File | Dove prenderlo |
|---|---|---|
| `bin/win/` | `yt-dlp.exe`, `ffmpeg.exe` | quelli che hai già nella cartella del vecchio TubeGrabber |
| `bin/mac/` | `yt-dlp` (da `yt-dlp_macos`), `ffmpeg` | github.com/yt-dlp/yt-dlp/releases  ·  build statica di ffmpeg per macOS (versione "gpl", con libx264) |

Facoltativo, in entrambe le cartelle: `deno` (o `node`). yt-dlp lo usa per leggere tutti i formati di YouTube.
Se non lo metti, l'app prova a usare quello installato nel sistema.

Su Mac gli eseguibili devono combaciare con il processore: ffmpeg per Apple Silicon (arm64) e per Intel (x64) sono file diversi,
quindi si fa un installer per ciascuno (vedi README principale).
