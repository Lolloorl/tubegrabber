# TubeGrabber – Professional Suite 2.2
By Lorenzo Orlandi

Applicazione desktop (Windows e macOS) per scaricare da YouTube, convertire file, sincronizzare audio/video del drone e creare QR Code.

## Perché Electron (e non C/C++/Java/Python/Tauri)

Il vero lavoro lo fanno già `yt-dlp` e `ffmpeg`, programmi esterni: il linguaggio dell'app serve solo per interfaccia, schede, code di lavoro e aggiornamenti.

| Scelta | Valutazione per questo progetto |
|---|---|
| **Electron (JS/HTML/CSS)** ✅ | Interfaccia a schede in stile Chrome naturale, stessa base di codice per Windows e macOS, installer e build automatici (electron-builder), ecosistema enorme. Contro: installer ~100 MB. |
| Tauri (Rust) | Installer leggero, ma richiede Rust e una WebView diversa per piattaforma (più differenze da gestire). Valido se in futuro il peso diventa un problema: l'interfaccia in `src/renderer` si riuserebbe quasi intera. |
| Python (PyQt/Tk) | Interfaccia moderna difficile da ottenere, impacchettamento (.exe/.app) più fragile. |
| C/C++/Java | Molto lavoro in più per un risultato peggiore sull'interfaccia, nessun vantaggio di prestazioni (il lavoro pesante è in ffmpeg). |

Il vecchio PowerShell/WinForms funzionava solo su Windows e costruiva i comandi concatenando stringhe (fragile con link e nomi file particolari). Ora i programmi si avviano con argomenti separati, senza shell.

## Cosa è cambiato rispetto alla versione PowerShell

1. **Interfaccia a schede** stile browser: puoi aprire più schede (anche dello stesso strumento) e lavorare in parallelo. Ogni scheda ha il suo avanzamento, visibile anche sulla linguetta. Scorciatoie: `Ctrl+T` nuova, `Ctrl+W` chiudi, `Ctrl+Tab` successiva.
2. **Playlist in cartelle**: ogni playlist va in `<output>/<titolo playlist>/NN - titolo.ext`, con il titolo preso da YouTube (yt-dlp sostituisce solo i caratteri vietati dal file system, es. `/ : ? "`). I video singoli vanno direttamente in `<output>`.
3. **Convertitore**: drag-and-drop, formati più usati (MP4, MP3, WAV, MKV) in evidenza, poi video, audio e immagini; compressione a 3 livelli. Non sovrascrive mai un file esistente (aggiunge ` (1)`).
4. **QR Studio** completamente locale (nessun servizio web, funziona offline): forma dei moduli, forma di cornice e centro degli occhi, sfumatura, colore per ogni occhio, **pennello per colorare il singolo blocco**, logo con base, cornice con scritta, preset, controllo di leggibilità, anteprima in tempo reale, esportazione PNG 1600 px.
5. **Fix Drone Sync**: il comando usava `-shortest`, che ferma l'output alla traccia più corta e troncava il video. Ora le durate vengono lette dai file: audio più corto → silenzio in coda e video completo; audio più lungo → tagliato alla durata del video. Verificato su file reali: con audio di 6 s su video di 10 s il vecchio comando produceva 149 fotogrammi su 250, il nuovo 250 su 250.
6. **Aggiornamenti** (vedi sotto) e **branding** "By Lorenzo Orlandi".

## Avvio in sviluppo

```
npm install        # scarica Electron e la libreria QR
# metti yt-dlp e ffmpeg in bin/win/ (o bin/mac/): vedi bin/README.md
npm start
npm test           # test automatici (usano ffmpeg se presente nel PATH)
```
Copia `icona.ico` in `build/icon.ico` (per Mac serve anche `build/icon.icns`).

## Aggiornamenti: come li gestisci tu come admin

L'app legge un piccolo file JSON all'avvio (e con il pulsante *Verifica aggiornamenti*). Se la versione nel file è più alta di quella installata, appare un banner con il pulsante **Scarica aggiornamento**.

1. Pubblica `docs/latest.json` in un posto raggiungibile via https (consigliato: il tuo repository GitHub, URL "raw", oppure GitHub Pages).
2. In `config/app-config.json` metti quell'URL in `updateUrl` (prima di costruire l'app).
3. Per rilasciare una nuova versione: alza `version` in `package.json`, crea gli installer, caricali (es. in una GitHub Release) e modifica `docs/latest.json`:

```json
{
  "version": "2.1.0",
  "mandatory": false,
  "notes": "Cosa c'è di nuovo",
  "downloads": {
    "win": "https://…/TubeGrabber-2.1.0-win-x64.exe",
    "mac": "https://…/TubeGrabber-2.1.0-mac-arm64.dmg"
  }
}
```
`mandatory: true` (oppure `minVersion`) rende il banner non chiudibile. Sono accettati solo link `https`. Gli utenti che hanno scelto *Più tardi* non vengono disturbati di nuovo per la stessa versione.

Nota: questo sistema avvisa e porta al download, ma l'installazione la fa l'utente. È voluto: l'aggiornamento silenzioso su macOS richiede un certificato Apple a pagamento (Developer ID + notarizzazione), mentre così funziona subito su entrambi i sistemi. Se in futuro lo avrai, si può aggiungere `electron-updater` senza toccare il resto.

## Build finale: due installer separati

* **Windows** (da Windows): `npm run dist:win` → `dist/TubeGrabber-<versione>-win-x64.exe`
* **macOS** (da un Mac): `npm run dist:mac` → `.dmg`. Non si può creare un'app Mac da Windows.
* In alternativa `.github/workflows/release.yml` costruisce entrambi sui server di GitHub quando crei un tag `v2.x.x`.

Limiti da conoscere:
* Un'app Mac **non firmata** mostra l'avviso "sviluppatore non identificato": gli utenti devono aprirla con clic destro → *Apri*. Per eliminarlo serve l'account Apple Developer (99 $/anno).
* Anche su Windows senza firma digitale compare l'avviso SmartScreen finché l'app non ha reputazione.
* Il `.dmg` contiene l'ffmpeg di una sola architettura (Apple Silicon *o* Intel): se hai utenti con entrambi, servono due build.
* ffmpeg deve essere una build "gpl" con libx264 (per MP4/MKV/MOV).
* yt-dlp va tenuto aggiornato (YouTube cambia spesso): sostituisci il file in `bin/` e fai un nuovo rilascio.

## Struttura

```
main.js, preload.js            finestra, IPC (ponte sicuro verso l'interfaccia)
src/main/                      logica: youtube.js, drone.js, jobs.js, updater.js, runner.js, binaries.js
src/shared/formats.js          catalogo formati del convertitore
src/renderer/                  interfaccia: index.html, styles.css, app.js, tools/*.js
config/app-config.json         URL aggiornamenti
docs/latest.json               file versione (esempio)
test/core.test.js              test automatici
```

## Novità della 2.1

* **Home**: all'avvio e a ogni nuova scheda ("+" o Ctrl+T) compaiono i 4 strumenti; passando il cursore si vede cosa fa ciascuno. Tasti 1-4 per aprirli.
* **Impostazioni** (in basso a destra): cartella, notifiche, scelte YouTube predefinite, aggiornamento programmi, controllo nuove versioni. Tutto ricordato a ogni avvio.
* **Aggiornamento automatico di yt-dlp** (una volta ogni 12 ore, con verifica SHA-256) e pulsante per **ffmpeg** (solo Windows, build BtbN). Le copie aggiornate stanno nella cartella dati dell'utente e non toccano l'installazione.
* **Segnala errore**: copia i dettagli (con il nome utente nascosto) e apre l'e-mail già indirizzata all'indirizzo `supportEmail` di `config/app-config.json`.
* **Notifica di sistema** a fine lavoro, se la finestra non è in primo piano.
* **QR Studio**: modelli Wi-Fi, WhatsApp, e-mail e biglietto da visita.
* Cartella `futuro/`: strumenti già scritti e provati, non ancora nell'interfaccia.

## Novità della 2.2
* **Strumenti extra a ricetta**: pagine aggiuntive descritte da un file (`recipes/strumenti.json`, aggiornabile online da `docs/strumenti.json`).
  Si gestiscono senza codice con `ADMIN_Editor_Strumenti.html`: vedi `GUIDA_ADMIN.md`. Inclusi 5 esempi (Estrai audio, Video in GIF, Ruota video, Foto più leggere, Sottotitoli YouTube).
* Home con banner (immagine facoltativa in `src/renderer/assets/banner.jpg`), finestra "Segnala problema".

## Versione per Mac (da un PC Windows)
Si costruisce sui server di GitHub: scheda *Actions* → "Costruisci versione Mac" → *Run workflow* (file `.github/workflows/build-mac.yml`).
Produce `TubeGrabber-<versione>-mac-arm64.dmg` per Mac Apple Silicon (M1 e successivi) e lo allega alla release indicata.
