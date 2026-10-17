# Guida admin – aggiungere e modificare strumenti (senza codice)

Gli "strumenti extra" sono pagine aggiuntive della Home. Si gestiscono con un solo file, `docs/strumenti.json`,
e una pagina di aiuto che compila il file per te. **Non serve un nuovo installer**: gli utenti vedono le novità
al prossimo avvio dell'app (serve internet; senza internet vedono l'ultima copia salvata).

## Cosa si può fare (e cosa no)
- Si possono creare pagine che eseguono **ffmpeg** (video, audio, foto) o **yt-dlp** (YouTube e simili).
- Per funzioni con logica nuova (come il QR Studio) serve ancora codice e un nuovo installer.

## Aggiungere o modificare uno strumento
1. Apri con doppio clic `ADMIN_Editor_Strumenti.html` (nella cartella del progetto).
2. Passaggio 1: premi **Scegli file** e scegli `docs\strumenti.json`, poi **Carica elenco**.
3. Per **modificare**: scegli lo strumento dal menu "scegli uno strumento da modificare".
   Per **crearne uno**: premi **+ Nuovo strumento**.
4. Compila i campi (nome, frase, descrizione, colore, cosa fornisce l'utente, opzioni, comando).
5. Premi **Controlla**: se qualcosa non va, l'editor ti dice cosa correggere.
6. Premi **Aggiungi / aggiorna nell'elenco**.
7. In fondo alla pagina premi **Copia tutto**.
8. Su GitHub apri `docs/strumenti.json`, clicca la **matita**, `Ctrl+A`, `Ctrl+V`, **Commit changes**.
9. Nell'app apri **Impostazioni → Strumenti extra → Aggiorna elenco**: deve comparire il nuovo numero di strumenti.
   Se qualcosa non va, l'app mostra qui in rosso cosa correggere.

Tieni anche una copia aggiornata del file in `recipes\strumenti.json` (nel progetto): finisce dentro il prossimo installer
e permette agli utenti senza internet di avere gli strumenti.

## Nascondere uno strumento
Nell'editor scegli lo strumento, spunta **Nascondi questo strumento agli utenti** e premi "Aggiungi / aggiorna".

## Come si scrive il comando
Un argomento per riga. Esempio per estrarre l'audio (ffmpeg):
```
-i
{input}
-vn
[fmt=mp3] -c:a
[fmt=mp3] libmp3lame
{output}
```
- `{input}` = il file (o il link) scelto dall'utente.
- `{output}` = il file di uscita (per ffmpeg deve essere l'ultima riga). Il nome si imposta in "Nome del file di uscita", es. `{name}.mp3`.
- `{name}` = nome del file senza estensione. Poi i codici delle tue opzioni, es. `{fmt}`.
- `[fmt=mp3] ...` = la riga vale solo se l'opzione `fmt` è `mp3`. Per le caselle sì/no usa `true` o `false`.

## Regole di sicurezza (non modificabili)
Sono ammessi solo `ffmpeg` e `yt-dlp`. Sono vietate le opzioni che eseguirebbero altri programmi
(per esempio `--exec` di yt-dlp). Gli strumenti si prendono solo da questo repository (`toolsUrl` in `config/app-config.json`).
Chi controlla il tuo account GitHub controlla gli strumenti: usa una password forte e la verifica in due passaggi.
