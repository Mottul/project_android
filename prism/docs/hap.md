# HAP im Browser

HAP ist der Grund, warum Prism einen eigenen ffmpeg-Build braucht. Diese Notiz
hält fest, warum das so ist und wie der Build entsteht.

## Was HAP anders macht

Normale Videocodecs liefern ein Bild, das die CPU erst dekodieren und dann zur
Grafikkarte schieben muss. HAP überspringt das: die Datei enthält bereits
GPU-Texturblöcke (BC1/BC3), die unverändert in den Grafikspeicher geladen
werden. Das Abspielen kostet dadurch fast keine CPU-Zeit — deshalb verlangen
Resolume, TouchDesigner, Millumin und vergleichbare Medienserver dieses Format.

Der Preis ist die Dateigröße: HAP komprimiert mit festem Faktor (etwa 1:6
gegenüber unkomprimiert), nicht inhaltsabhängig. Eine Minute 1080p liegt je nach
Variante bei 1–3 GB. Genau deshalb ist die Streaming-Architektur aus dem README
für diesen Anwendungsfall keine Kür, sondern Voraussetzung.

| Variante | Texturformat | Alpha | Datenrate | Einsatz |
|---|---|---|---|---|
| HAP | BC1 / DXT1 | nein | 1× | Standard, kleinste Dateien |
| HAP Alpha | BC3 / DXT5 | ja | 2× | Overlays, Keying |
| HAP Q | Scaled YCoCg DXT5 | nein | 2× | sichtbar bessere Qualität |
| HAP Q Alpha | YCoCg + Alpha | ja | 3× | beides |

Container ist immer MOV. `-chunks N` teilt jedes Bild in N Blöcke, damit der
Decoder es beim Abspielen über mehrere Kerne verteilen kann; 4 ist der übliche
Wert für Medienserver.

## Warum der Standard-Core es nicht kann

`@ffmpeg/core` wird mit einer schlanken Encoder-Auswahl gebaut. `hap` ist nicht
dabei, und die chunked-Varianten brauchen zusätzlich **libsnappy**, das in
keinem der veröffentlichten Builds enthalten ist.

Prism ist darauf vorbereitet: die HAP-Codecs sind in
[`src/lib/formats.ts`](../src/lib/formats.ts) mit `availability:
'requires-core'` registriert, die Argumente baut
[`ffmpeg-args.ts`](../src/engine/ffmpeg-args.ts) bereits korrekt, und
`explainFailure()` erkennt `Unknown encoder 'hap'` und verweist auf dieses
Dokument statt einen rohen Exitcode zu zeigen.

Es fehlt also ausschließlich der Core.

## Den Core bauen

`ffmpeg.wasm` baut über Docker und Emscripten. Der relevante Teil der
`build.sh`-Flags:

```bash
FFMPEG_ST_FLAGS=(
  --enable-encoder=hap
  --enable-decoder=hap
  --enable-libsnappy          # nötig für chunked HAP
  --enable-encoder=prores_ks  # wenn ProRes gleich mit soll
  --enable-decoder=prores
  --enable-muxer=mov
  --enable-demuxer=mov
)
```

`libsnappy` muss vorher selbst nach wasm kompiliert und über
`--extra-cflags`/`--extra-ldflags` eingebunden werden — es gehört nicht zu den
Bibliotheken, die `ffmpeg.wasm` von Haus aus mitbaut.

Grober Ablauf:

1. `ffmpegwasm/ffmpeg.wasm` klonen
2. `snappy` als Emscripten-Ziel bauen und nach `build/` installieren
3. Die Flags oben in die Core-Build-Konfiguration eintragen
4. `make` — Ergebnis sind `ffmpeg-core.js`, `.wasm` und für MT `.worker.js`

Rechne mit einem spürbar größeren Core: HAP plus ProRes plus snappy addieren
etwa 3–5 MB.

## Einbinden

Die gebauten Dateien ersetzen, was `scripts/sync-ffmpeg-core.mjs` sonst aus
`node_modules` kopiert:

```
public/ffmpeg/st/ffmpeg-core.js
public/ffmpeg/st/ffmpeg-core.wasm
public/ffmpeg/mt/ffmpeg-core.js
public/ffmpeg/mt/ffmpeg-core.wasm
public/ffmpeg/mt/ffmpeg-core.worker.js
```

Danach greifen die HAP-Presets ohne weitere Codeänderung — die Warnung
verschwindet von selbst, weil `availability` nur noch die UI-Markierung steuert
und `explainFailure()` schlicht nicht mehr auslöst. Der `requires-core`-Status in
`formats.ts` kann dann auf `ready` gesetzt werden.

## Die schnellere Alternative

HAP-Encoding ist im Kern eine DXT-Blockkompression pro Bild — eine Aufgabe, die
auf der GPU sehr gut liegt. Über einen **WebGPU-Compute-Shader** wäre das
deutlich schneller als `libsnappy` in WASM, und WebGPU ist ohnehin schon in der
Capability-Erkennung vorgesehen.

Das ist ein eigenes, größeres Projekt und kein Ersatz für den Core-Build: der
Container (MOV mit HAP-Sample-Descriptions) müsste dann ebenfalls selbst
geschrieben werden. Als Richtung für später aber die interessantere.
