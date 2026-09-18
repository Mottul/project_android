# PWA-Werkzeuge

Sammlung offline nutzbarer Web-Apps. Jede App liegt in einem eigenen Ordner und
bekommt dadurch eine eigene Adresse unter GitHub Pages; die Startseite im
Wurzelverzeichnis verlinkt sie.

Live: **https://mottul.github.io/project_android/**

## Apps

| App | Adresse | Inhalt |
| --- | --- | --- |
| [LED Wall Planner](led-wall/) | `/led-wall/` | Größe, Auflösung, Gewicht, Signalwege, Stromkreise, Plan und PDF-Baumappe einer LED-Wand |
| [OSC Pad](osc/) | `/osc/` | Frei belegbares OSC-Pult für MadMapper und NovaStar — Fader, Taster, XY, Farbe, Feedback und Monitor |
| [Prism](prism/) | `/prism/` | Video, Bild und Audio in gängige Formate umwandeln — Vorlagen für Web, Social Media, Zielgröße und Medienserver |
| [Folio](folio/) | `/folio/` | PDF, EPUB, Bilder und Text lesen, markieren, kommentieren, Text bearbeiten und mit einstellbarer Qualität exportieren |

## Aufbau

```
index.html          Startseite mit der App-Übersicht
favicon.svg         Symbol der Startseite
led-wall/           App: LED Wall Planner (eigenes Manifest, eigener Worker)
osc/                App: OSC Pad — dazu bridge/osc-bridge.mjs für den Show-Rechner
prism/              App: Prism — Vite-Projekt, wird gebaut (siehe unten)
folio/              App: Folio — Vite-Projekt, wird gebaut (siehe unten)
tools/              Werkzeuge fürs ganze Repository (lokaler Pages-Server)
.github/workflows/  Deployment auf GitHub Pages
```

Jede App bringt ihr eigenes `index.html`, `manifest.webmanifest` und `sw.js`
mit und ist damit einzeln installierbar. Alle Pfade innerhalb einer App sind
relativ, der Ordnername ist deshalb frei wählbar.

### Zwei Apps werden gebaut

led-wall und osc sind handgeschriebenes HTML/JS und werden unverändert
veröffentlicht. Prism und Folio sind Vite-Projekte mit TypeScript und einem
Build-Schritt; im Repository liegt der Quellcode, auf der Seite landet nur das
Ergebnis aus `prism/dist/` beziehungsweise `folio/dist/`. Das übernimmt der
Workflow. Die Konventionen oben gelten trotzdem: relative Pfade, eigenes
Manifest, eigener Service Worker mit Wirkungsbereich `./`.

Jede der beiden hat eine Eigenheit, die im Unterordner dokumentiert ist:

* **Prism** braucht **Cross-Origin-Isolation** für den mehrthreadigen
  ffmpeg-Kern. GitHub Pages kann keine Header senden, deshalb rüstet Prisms
  eigener Service Worker sie nach — siehe [prism/README.md](prism/README.md).
* **Folio** kopiert vor jedem Build die Laufzeitdaten von pdf.js nach
  `folio/public/pdfjs/` (Standardschriften, CMaps, WASM-Decoder). Sie sind
  erzeugt und liegen nicht im Repository — siehe
  [folio/README.md](folio/README.md).

## Neue App anlegen

1. Ordner anlegen, darin `index.html`, `manifest.webmanifest` und `sw.js`.
   Im Manifest `start_url` und `scope` relativ halten (`./index.html`, `./`),
   damit der Unterordner nicht hart verdrahtet ist.
2. Den Service Worker mit `navigator.serviceWorker.register('./sw.js')`
   registrieren — sein Wirkungsbereich endet dann am eigenen Ordner und die
   Apps stören sich gegenseitig nicht.
3. Die App auf der Startseite (`index.html`) als Karte eintragen.
4. Tests unter `<app>/tests/*.test.mjs` ablegen; `npm test` findet sie
   automatisch.

## Entwicklung

```bash
npm start           # http://localhost:8080 — Startseite und die HTML-Apps
npm test            # Tests der HTML-Apps
npm run icons       # Icons des LED Wall Planners neu erzeugen
npm run icons:osc   # Icons des OSC Pads neu erzeugen
npm run bridge      # OSC-Brücke starten (liefert auch die App im LAN aus)
```

Für die gebauten Apps:

```bash
npm run prism:install   # einmalig: Abhängigkeiten installieren
npm run prism:dev       # Vite-Dev-Server auf Port 5180
npm run prism:build     # nach prism/dist/ bauen
npm run test:prism      # Tests von Prism

npm run folio:install   # einmalig: Abhängigkeiten installieren
npm run folio:dev       # Vite-Dev-Server auf Port 5190
npm run folio:build     # nach folio/dist/ bauen
npm run test:folio      # Tests von Folio

npm run serve           # ganze Seite ausliefern wie GitHub Pages, inkl. /prism/ und /folio/
```

`npm start` zeigt die gebauten Apps nur, wenn vorher gebaut wurde — und dann
unter `/prism/dist/` statt `/prism/`. Für die echten Pfade stattdessen
`npm run serve` verwenden; das bildet die veröffentlichte Struktur exakt ab.

Für Service Worker und Installation wird HTTPS oder `localhost` benötigt.

## Deployment

Der Workflow `.github/workflows/pages.yml` läuft bei jedem Push auf den
Default-Branch, manuell über Actions → „Deploy PWA to GitHub Pages“ →
Run workflow. Er

1. testet die HTML-Apps, Prism und Folio und prüft deren Typen,
2. baut Prism und Folio,
3. stellt die Seite zusammen — Repository unverändert, plus `prism/dist/`
   als `/prism/` und `folio/dist/` als `/folio/` — und veröffentlicht sie.
