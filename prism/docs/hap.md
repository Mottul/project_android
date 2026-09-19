# HAP im Browser

HAP war der Grund, warum Prism einen eigenen ffmpeg-Build brauchen sollte.
Inzwischen braucht es ihn nicht mehr: Prism schreibt HAP, HAP Alpha und HAP Q
selbst. Diese Notiz hält fest, wie das funktioniert und wo die Grenzen liegen.

## Was HAP anders macht

Normale Videocodecs liefern ein Bild, das die CPU erst dekodieren und dann zur
Grafikkarte schieben muss. HAP überspringt das: die Datei enthält bereits
GPU-Texturblöcke (BC1/BC3), die unverändert in den Grafikspeicher geladen
werden. Das Abspielen kostet dadurch fast keine CPU-Zeit — deshalb verlangen
Resolume, TouchDesigner, Millumin und vergleichbare Medienserver dieses Format.

Der Preis ist die Dateigröße: HAP komprimiert mit festem Faktor, nicht
inhaltsabhängig. Eine Minute 1080p liegt je nach Variante bei 1–3 GB. Es gibt
entsprechend keinen Qualitätsregler und keine Bitrate — die Dateigröße folgt
allein aus Auflösung, Bildrate und Laufzeit.

| Variante | FourCC | Texturformat | Alpha | Datenrate | Prism |
|---|---|---|---|---|---|
| HAP | `Hap1` | BC1 / DXT1 | nein | 1× | eigener Encoder |
| HAP Alpha | `Hap5` | BC3 / DXT5 | ja | 2× | eigener Encoder |
| HAP Q | `HapY` | YCoCg DXT5 | nein | 2× | eigener Encoder |
| HAP Q Alpha | `HapM` | YCoCg + RGTC1 | ja | 3× | erweiterter Core |

Container ist immer MOV. `chunks` teilt jedes Bild in N Blöcke, damit der
Decoder es beim Abspielen über mehrere Kerne verteilen kann; 4 ist der übliche
Wert für Medienserver. Das ist ein Hinweis für die Wiedergabe, keine
Kompressionseinstellung.

## Warum kein ffmpeg

`@ffmpeg/core` wird mit einer schlanken Encoder-Auswahl gebaut. `hap` ist nicht
dabei, und die chunked-Varianten brauchen zusätzlich **libsnappy**, das in
keinem der veröffentlichten Builds enthalten ist. Einen eigenen Core zu bauen
heißt: Docker, Emscripten, snappy von Hand nach wasm übersetzen, und am Ende
3–5 MB mehr, die jeder Besucher lädt — auch wer nie HAP anfasst.

Die eigentliche Arbeit ist dagegen überschaubar. HAP-Encoding ist eine
DXT-Blockkompression pro Bild plus ein sehr einfacher Containerschreiber. Das
sind ein paar hundert Zeilen, die überall laufen, wo der Browser die Quelle
dekodieren kann.

## Wie der Encoder gebaut ist

```
Quelle ──mp4box──► Samples ──VideoDecoder──► VideoFrame
                                                 │
                                    OffscreenCanvas (Skalierung, Fit)
                                                 │
                                              RGBA
                                                 │
        ┌────────────────────────────────────────┤
        │                                        │
   HAP / HAP Alpha                            HAP Q
   BC1 bzw. BC3                        RGB→YCoCg, dann BC3
        └────────────────────┬───────────────────┘
                             │
                     HAP-Sections (Snappy, Chunks)
                             │
                      QuickTime-Index (moov)
```

| Datei | Aufgabe |
|---|---|
| [`hap/dxt.ts`](../src/engine/hap/dxt.ts) | BC1/BC3-Blockkompression, YCoCg-Transformation |
| [`hap/snappy.ts`](../src/engine/hap/snappy.ts) | Snappy-Kompressor (zweite Stufe) |
| [`hap/hap-frame.ts`](../src/engine/hap/hap-frame.ts) | Sections, Chunk-Tabellen |
| [`hap/mov.ts`](../src/engine/hap/mov.ts) | QuickTime-Schreiber |
| [`hap/frame-source.ts`](../src/engine/hap/frame-source.ts) | Demux und Dekodierung |
| [`hap/encode.ts`](../src/engine/hap/encode.ts) | Varianten, Zielgröße, Bildraten-Raster |
| [`workers/hap.worker.ts`](../src/engine/workers/hap.worker.ts) | die Schleife über alle Bilder |

### Blockkompression

Die Endpunkte eines 4×4-Blocks kommen aus der Bounding Box der 16 Pixel und
werden dann per kleinster Quadrate nachgezogen. Das ist bewusst die Mitte: eine
reine Bounding Box ist auf Verläufen sichtbar klotzig, eine vollständige
Hauptachsensuche kostet etwa doppelt so viel Zeit für einen Bruchteil eines dB.
Die Verfeinerung ist der Schritt, aus dem die Qualität kommt.

HAP Q legt die Luminanz in den Alphakanal des DXT5-Blocks — dort gibt es acht
interpolierte Stufen statt der groben 5:6:5-Farbrampe. Genau daher kommt der
sichtbare Unterschied zu HAP bei doppelter Datenrate. Das Skalierungs-Byte
bleibt 0, was der HAP-Shader als „Chroma unskaliert" liest.

### Quellen, die der Browser nicht liest

`VideoDecoder` kennt kein ProRes und kein DNxHD, und mp4box liest kein
Matroska. Für solche Dateien erzeugt Prism zuerst ein Zwischenformat
(H.264, CRF 12) über ffmpeg.wasm und kodiert daraus nach HAP. Der Job sagt das
als Warnung dazu — ein Qualitätsverlust, den niemand gewählt hat, muss sichtbar
sein. Verlustfrei geht es nur über eine MP4- oder MOV-Quelle, die der Browser
direkt dekodiert.

### Speicher

Fertige Bilder wandern sofort in einen `Blob`, nicht in ein Array. Der Browser
verwaltet diesen Speicher und lagert ihn bei Bedarf auf die Platte aus; zwei
Gigabyte als JS-Arrays würden den Worker irgendwo in der Mitte aus dem Heap
laufen lassen. `mdat` steht vor `moov`, damit nur der kleine Index auf das
letzte Bild warten muss.

## Grenzen

- **HAP Q Alpha** legt zwei Texturen pro Bild hinter eine Multi-Image-Section.
  Das Layout ist nicht sauber dokumentiert, und eine halb verstandene Fassung
  erzeugt Dateien, die auf dem Medienserver mitten in der Show abstürzen statt
  hier zu scheitern. Diese Variante bleibt deshalb auf dem ffmpeg-Pfad und
  verlangt weiterhin den erweiterten Core.
- **Tempo.** Ein 1080p-Bild sind rund 130.000 Blöcke. Der Encoder läuft in
  einem Worker und schafft je nach Maschine etwa 5–15 Bilder pro Sekunde. Für
  einen Konverter in Ordnung, aber kein Echtzeitwerkzeug.
- **Kein Ton.** Die Ausgabe ist eine reine Videospur. Medienserver spielen den
  Ton ohnehin getrennt ab.

## Wenn doch ein eigener Core gebaut werden soll

Für HAP Q Alpha und ProRes bleibt der Weg über einen eigenen Core. Der
relevante Teil der `build.sh`-Flags:

```bash
FFMPEG_ST_FLAGS=(
  --enable-encoder=hap
  --enable-decoder=hap
  --enable-libsnappy          # nötig für chunked HAP
  --enable-encoder=prores_ks
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

Die gebauten Dateien ersetzen, was `scripts/sync-ffmpeg-core.mjs` sonst aus
`node_modules` kopiert:

```
public/ffmpeg/st/ffmpeg-core.js
public/ffmpeg/st/ffmpeg-core.wasm
public/ffmpeg/mt/ffmpeg-core.js
public/ffmpeg/mt/ffmpeg-core.wasm
public/ffmpeg/mt/ffmpeg-core.worker.js
```

Danach kann `hap_q_alpha` in [`formats.ts`](../src/lib/formats.ts) von
`requires-core` auf `ready` gesetzt werden. Die drei anderen Varianten bleiben
auch dann beim eigenen Encoder — der Umweg über einen 30-MB-Core lohnt sich
für sie nicht.

## Die schnellere Alternative

DXT-Blockkompression liegt der GPU sehr gut. Über einen **WebGPU-Compute-Shader**
wäre der Texturteil um ein Vielfaches schneller, und WebGPU steht ohnehin schon
in der Capability-Erkennung. Der Rest der Pipeline — Demux, Dekodierung,
Sections, Container — bliebe unverändert; auszutauschen wäre allein
`dxt.ts`. Das ist die interessanteste offene Baustelle an dieser Stelle.

## Tests

[`tests/hap.test.ts`](../tests/hap.test.ts) dekodiert alles wieder: DXT mit
einem unabhängig geschriebenen Blockdecoder, Snappy mit einem eigenen
Dekompressor, die Sections und den QuickTime-Index durch einen Box-Walker. Ein
Encoder, den nur sein eigener Decoder lesen kann, ist nicht getestet.
