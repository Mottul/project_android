# Prism

Lokaler Medienkonverter. Video, Bild und Audio werden vollständig im Browser
umgerechnet — keine Datei verlässt das Gerät, es gibt kein Backend und keinen
Upload.

Teil von [PWA-Werkzeuge](../README.md), erreichbar unter `/prism/`.

```bash
npm run prism:install   # aus dem Wurzelverzeichnis, einmalig
npm run prism:dev       # http://localhost:5180
npm run prism:build     # nach prism/dist/
npm run serve           # ganze Seite wie GitHub Pages, Prism unter /prism/
```

---

## Warum überhaupt im Browser

Der Verkaufspunkt ist nicht Bequemlichkeit, sondern Vertraulichkeit: die
üblichen Online-Konverter laden die Datei auf einen fremden Server. Prism kann
ehrlich behaupten, dass das hier nicht passiert — und funktioniert deshalb auch
offline und ohne Betriebskosten.

Der Preis dafür sind echte Grenzen, die die App sichtbar macht statt sie zu
verschweigen (siehe [Grenzen](#grenzen)).

---

## Die Ausnahme im Repository

led-wall und osc sind handgeschriebenes HTML/JS ohne Build. Prism ist ein
Vite-Projekt mit TypeScript und React; im Repository liegt der Quellcode, auf
der Seite landet nur `dist/`.

Die Konventionen des Repositories bleiben eingehalten:

- **Relative Pfade überall.** `base: './'` in der Vite-Konfiguration, im
  Manifest `start_url: './index.html'` und `scope: './'`. Derselbe Build
  funktioniert unter `/project_android/prism/`, unter `/prism/` oder an der
  Wurzel.
- **Eigener Service Worker mit Wirkungsbereich `./`.** LED Wall Planner und OSC
  Pad behalten ihre eigenen; die Apps stören sich nicht.
- **Tests**, die der Deploy-Workflow prüft — hier mit Vitest statt `node --test`,
  weil der Quellcode TypeScript ist.

---

## Cross-Origin-Isolation auf GitHub Pages

Das ist der heikelste Teil und lohnt die Erklärung.

Der mehrthreadige ffmpeg-Kern braucht `SharedArrayBuffer`. Den gibt der Browser
nur an ein **cross-origin-isoliertes** Dokument heraus, und dafür müssen zwei
Header kommen:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**GitHub Pages kann keine eigenen Header senden.** Ohne Gegenmaßnahme liefe
Prism dort dauerhaft einthreadig — je nach Codec vier- bis achtmal langsamer.

Die Lösung steht in [`src/sw.ts`](src/sw.ts): Der Service Worker hängt die
Header an jede Antwort, die er ausliefert. Ablauf beim ersten Besuch:

1. Das Dokument kommt ohne Header an, `crossOriginIsolated` ist `false`.
2. Der Worker installiert sich und übernimmt die Kontrolle.
3. [`src/register-sw.ts`](src/register-sw.ts) lädt die Seite **einmal** neu.
4. Jetzt läuft die Antwort durch den Worker, die Header sind da,
   `SharedArrayBuffer` ist verfügbar — der Mehrthread-Kern lädt.

Der Reload ist über `sessionStorage` abgesichert und passiert höchstens einmal
pro Sitzung. Scheitert die Isolation trotzdem, läuft Prism einthreadig weiter
und sagt das in der Kopfzeile (`1 Thread` statt `8 Threads`).

> **Noch nicht in einem echten Browser verifiziert.** Die Header-Logik ist durch
> [`tests/sw-headers.test.ts`](tests/sw-headers.test.ts) abgedeckt, das
> Zusammenspiel mit dem Browser aber nicht. So lässt es sich prüfen:
>
> ```bash
> npm run prism:build
> npm run serve          # bewusst OHNE COOP/COEP — wie GitHub Pages
> ```
>
> Dann `http://localhost:8099/prism/` öffnen und in der Konsole
> `crossOriginIsolated` eingeben: beim ersten Aufruf `false`, nach dem
> automatischen Reload `true`. In der Kopfzeile muss aus `1 Thread` ein
> `8 Threads` werden. Zum Gegentest `npm run serve -- --headers`, das simuliert
> einen Host wie Cloudflare Pages oder Netlify.

Wird Prism später auf einen Host mit echten Headern umgezogen, bleibt der Worker
harmlos: er setzt dann Header, die ohnehin schon stimmen.

---

## Architektur

### Drei Engines, ein Router

| | Bildpfad | Medienpfad | HAP-Pfad |
|---|---|---|---|
| Läuft auf | `OffscreenCanvas` im Worker-Pool | `ffmpeg.wasm` | eigener Worker |
| Parallelität | `cores / 2`, max. 4 | strikt 1 | strikt 1 |
| Formate | PNG, JPEG, WebP, AVIF, BMP, TIFF, ICO | alles andere | HAP, HAP Alpha, HAP Q |

Der Router sitzt in [`src/engine/scheduler.ts`](src/engine/scheduler.ts). Bilder
laufen parallel, weil die Jobs kurz und unabhängig sind. Video läuft bewusst
seriell: es gibt genau eine `ffmpeg.wasm`-Instanz mit einem wasm-Heap, und zwei
davon würden den Spitzenspeicher verdoppeln, ohne Durchsatz zu gewinnen — der
Kern nutzt bereits alle Threads, die er bekommt.

HAP teilt sich die Medienspur, kommt aber ohne ffmpeg aus: der Texturkompressor
ist eigener Code. Die beiden Engines treffen sich an genau einer Stelle — wenn
`VideoDecoder` die Quelle nicht lesen kann (ProRes, Matroska), erzeugt ffmpeg
ein Zwischenformat, aus dem der HAP-Worker dann weiterarbeitet. Siehe
[`docs/hap.md`](docs/hap.md).

### Hardwarebeschleunigung

`ffmpeg.wasm` nutzt **keine** GPU. Es ist reines CPU-WASM und damit je nach
Codec 3–10× langsamer als natives ffmpeg.

Die Hardware-Encoder des Geräts (NVENC, QuickSync, VideoToolbox) sind nur über
**WebCodecs** erreichbar. `detectCapabilities()` prüft per
`VideoEncoder.isConfigSupported()`, welche Codecs das Gerät tatsächlich in
Hardware kann, und zeigt das Ergebnis in der Kopfzeile an.

> **Stand:** Die Capability-Erkennung und das Routing sind vorhanden, der
> WebCodecs-Encoder selbst ist noch nicht implementiert — außer für HAP läuft
> jede Video-Konvertierung über `ffmpeg.wasm`. Der HAP-Pfad nutzt WebCodecs
> bereits zum Dekodieren. Siehe [Roadmap](#roadmap).

### Große Dateien

Eingaben ab 192 MB werden nicht in den Speicher kopiert, sondern per
**WORKERFS** eingehängt ([`ffmpeg-runner.ts`](src/engine/ffmpeg-runner.ts)).
WORKERFS liest über `File.slice()` nach Bedarf, der Speicherverbrauch bleibt
dadurch konstant statt mit der Dateigröße zu wachsen.

Die **Ausgabe** ist derzeit noch der Engpass: `ffmpeg.readFile()` liefert die
fertige Datei am Stück, sie muss also vollständig in den Speicher passen. Erst
der WebCodecs-Pfad schreibt streamend über `FileSystemWritableFileStream` direkt
auf die Platte — dann ist die Dateigröße nur noch durch den freien Speicherplatz
begrenzt.

### ffmpeg-Kerne

Die Kerne liegen nicht im Bundle und nicht im Git. `scripts/sync-ffmpeg-core.mjs`
kopiert sie beim `predev`/`prebuild` nach `public/ffmpeg/`, von wo sie als
statische Dateien ausgeliefert und vom Service Worker bei der ersten Nutzung
gecacht werden — statt 62 MB vorab zu precachen.

Die Kern-Skripte werden über `toBlobURL()` geladen. Grund: ffmpegs Worker holt
sie per dynamischem `import()`, und ein Modul-Import aus `/public` wird vom
Dev-Server abgelehnt. Der Umweg über einen Blob umgeht die Modul-Pipeline und
verhält sich in Entwicklung und Produktion gleich.

Die Kern-URLs werden absolut aus `document.baseURI` gebildet. Relativ dürfen sie
nicht bleiben: `wasmURL` wird **innerhalb** von ffmpegs Worker aufgelöst, der von
einer `blob:`-URL läuft — ein relativer Pfad liefe dort ins Leere.

---

## Grenzen

Ermittelt zur Laufzeit in [`src/lib/capabilities.ts`](src/lib/capabilities.ts)
und in der Kopfzeile sichtbar.

| Plattform | Max. Dateigröße | Threads |
|---|---|---|
| Chrome / Edge, Desktop | 2 GB (16 GB+ mit WebCodecs-Streaming) | bis 8 |
| Firefox | 2 GB | bis 8 |
| Safari, macOS | 1,5 GB | bis 8 |
| **iOS / iPadOS** | **1,2 GB** | **1** |

Die Zahlen kommen aus drei harten Wänden:

1. wasm32 begrenzt den linearen Speicher auf 4 GB; `ffmpeg.wasm` bricht in der
   Praxis oberhalb von ~2 GB Arbeitsdatenmenge ab.
2. Safari beendet einen Tab, der über rund 1–1,5 GB wächst.
3. Ohne schreibbaren Dateistrom muss die fertige Datei als ein Blob im Speicher
   existieren, bevor sie ausgeliefert werden kann.

Dateien über dem harten Limit werden mit Begründung abgelehnt, statt mitten in
der Konvertierung abzustürzen.

**Auf iOS sind >3 GB nicht machbar, und HAP nur für kurze Clips.** Das ist keine
Nachlässigkeit, sondern eine Plattformgrenze: eine Minute 1080p HAP Q sind rund
zwei Gigabyte, und so viel gibt Safari einem Tab nicht.

---

## Formate

Jedes Format in [`src/lib/formats.ts`](src/lib/formats.ts) trägt ein
`availability`-Feld. Das ist der Vertrag mit der Oberfläche: was den erweiterten
Kern braucht, wird **angezeigt und markiert**, nie stillschweigend weggelassen.

- `ready` — funktioniert jetzt
- `requires-core` — braucht den erweiterten ffmpeg-Build (ProRes, DNxHR, HAP Q Alpha)
- `decode-only` — lesbar, nicht schreibbar (FLV, WMV, HEIC, WMA)
- `planned` — registriert, noch kein Encoder (PDF, JPEG XL, RAW, DDS, Untertitel)

BMP, TIFF und ICO kann `canvas.convertToBlob()` nicht schreiben. Statt dafür ein
Megabyte WASM zu laden, sind die drei Container in
[`raster-encoders.ts`](src/engine/raster-encoders.ts) direkt implementiert.

HAP, HAP Alpha und HAP Q schreibt Prism selbst — DXT-Blockkompression und ein
QuickTime-Schreiber sind zusammen weniger Code als der Umweg über einen eigenen
30-MB-ffmpeg-Kern, und sie laufen überall. Nur HAP Q Alpha mit seinen zwei
Texturen pro Bild bleibt auf dem ffmpeg-Pfad. Siehe
[`docs/hap.md`](docs/hap.md).

---

## Presets

[`src/lib/presets.ts`](src/lib/presets.ts). Gruppiert nach Absicht statt nach
technischer Eigenschaft — Leute wissen, wohin die Datei soll („das ist für
WhatsApp"), nicht welchen CRF sie wollen. Auf jeder Karte steht trotzdem die
technische Angabe, damit das Preset die Regler erklärt statt sie zu verstecken.

Ein Preset bleibt nur so lange hervorgehoben, wie **jedes** Feld, das es
festlegt, noch passt (`presetMatches`). Wer einen Regler anfasst, sieht sofort,
dass er die Vorlage verlassen hat.

---

## Design

Siehe [`src/styles/tokens.css`](src/styles/tokens.css).

Farben sind in **OKLCH** notiert, damit jede Rampe eine konstante wahrgenommene
Helligkeit behält: ein Mint und ein Violett bei L = 0,78 wirken tatsächlich
gleich hell. Genau das hält die mehrfarbige „Spektrum"-Identität davon ab,
unruhig zu wirken.

Die Neutraltöne sind ein warm verschobenes Indigo, kein neutrales Grau — ein
reines Grau liest sich bei stundenlanger Arbeit klinisch.

Das Spektrum (Mint → Perlblau → Orchidee) ist kein Dekor: es ist gleichzeitig
Logo, Fortschrittsbalken und die Farbkodierung der Dateifamilien. Identität und
Informationsdesign sind dasselbe System.

### Zwei Layouts

Ab 1024 px Breite steht der Inspector als 384-px-Spalte rechts neben der
Warteschlange. Darunter — also auf jedem Telefon — gibt es ihn nicht als
Spalte, sondern als Sheet über der Warteschlange, geöffnet aus einer festen
Aktionsleiste am unteren Rand: Datei hinzufügen, Einstellungen, Konvertieren.
Gerendert wird immer nur eine der beiden Varianten.

Die Höhe ist dabei die knappere Ressource als die Breite. Ein quer gehaltenes
Telefon hat rund 390 px davon, deshalb gibt es die Variante `short`
(`max-height: 600px`): Logo, Formathinweise und die Titelzeile des Sheets
entfallen dort, die Kopfzeile schrumpft, und die Vorlagen sind ohnehin
eingeklappt. Sicherheitsabstände für Notch und Home-Indicator sitzen einmal
zentral auf `#root`.

---

## Tests

```bash
npm run test:prism          # aus dem Wurzelverzeichnis
npm test --prefix prism     # gleichwertig
```

Abgedeckt sind die beiden Stellen, an denen ein Fehler still bleibt statt
aufzufallen:

- [`tests/ffmpeg-args.test.ts`](tests/ffmpeg-args.test.ts) — der Kommandobauer.
  Ein falsches Flag erzeugt eine Datei, die existiert, aber kaputt ist.
- [`tests/hap.test.ts`](tests/hap.test.ts) — der HAP-Encoder, gegen unabhängig
  geschriebene Decoder für DXT, Snappy, die Sections und den QuickTime-Index.
  Ein Encoder, den nur sein eigener Decoder lesen kann, ist nicht getestet.
- [`tests/sw-headers.test.ts`](tests/sw-headers.test.ts) — die Header-Logik des
  Service Workers. Kopiert sie eine Antwort falsch, bricht die ganze App auf
  einmal.

Der Deploy-Workflow führt beide plus `tsc` aus, bevor er veröffentlicht.

---

## Roadmap

**Als Nächstes**

1. **WebCodecs-Encoder für die übrigen Codecs** — der eigentliche
   Geschwindigkeitssprung. Demux mit `mp4box.js` und `VideoDecoder` stehen
   seit dem HAP-Encoder bereits ([`hap/frame-source.ts`](src/engine/hap/frame-source.ts));
   es fehlt die Gegenrichtung, also `VideoEncoder` plus `mp4-muxer`/`webm-muxer`
   und die Ausgabe streamend auf die Platte. Damit fallen gleichzeitig das
   Größenlimit und der Faktor 10 bei der Dauer.
2. **HAP auf der GPU** — die Blockkompression ist genau die Art Arbeit, für die
   ein WebGPU-Compute-Shader da ist. Auszutauschen wäre allein
   [`hap/dxt.ts`](src/engine/hap/dxt.ts); der Rest der Kette bliebe stehen.
3. **Erweiterter ffmpeg-Kern** — ProRes, DNxHR, HAP Q Alpha. Siehe
   [`docs/hap.md`](docs/hap.md).
4. **Zuschneiden und Trimmen in der Oberfläche** — die Einstellungen
   (`trimStart`, `trimEnd`) und die ffmpeg-Argumente existieren bereits, es fehlt
   nur die Bedienung.

**Danach**

- Dokumente: PDF zusammenfügen/teilen/komprimieren (`pdf-lib`), PDF ↔ Bild
  (`pdf.js`), CSV ↔ JSON ↔ XLSX
- HEIC- und RAW-Dekodierung (`libheif.wasm`, `libraw.wasm`)
- Untertitel SRT ↔ VTT ↔ ASS (reines Textparsing, sehr wenig Aufwand)
- Archive: ZIP, TAR, 7z, RAR entpacken
- Tauri-v2-Verpackung für Desktop und Mobil mit nativem ffmpeg, falls echte
  Produktionsleistung gebraucht wird

Was bewusst **nicht** kommt: DOCX/XLSX/PPTX → PDF mit korrektem Layout. Das
verlangt LibreOffice; die WASM-Variante wäre ein Download von rund 300 MB.

---

## Entwicklung

Im Dev-Modus liegt der Store unter `window.__prism` — `__prism.getState()`.

Das ffmpeg-Protokoll öffnet das Terminal-Symbol oben rechts. Dort steht auch die
exakte ffmpeg-Kommandozeile jedes Auftrags, damit ein überraschendes Ergebnis
reproduziert oder mit nativem ffmpeg verglichen werden kann.
