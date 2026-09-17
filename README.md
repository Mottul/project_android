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

## Aufbau

```
index.html          Startseite mit der App-Übersicht
favicon.svg         Symbol der Startseite
led-wall/           App: LED Wall Planner (eigenes Manifest, eigener Worker)
osc/                App: OSC Pad — dazu bridge/osc-bridge.mjs für den Show-Rechner
prism/              App: Prism — Vite-Projekt, wird gebaut (siehe unten)
.github/workflows/  Deployment auf GitHub Pages
```

Jede App bringt ihr eigenes `index.html`, `manifest.webmanifest` und `sw.js`
mit und ist damit einzeln installierbar. Alle Pfade innerhalb einer App sind
relativ, der Ordnername ist deshalb frei wählbar.

### Prism ist die Ausnahme

led-wall und osc sind handgeschriebenes HTML/JS und werden unverändert
veröffentlicht. Prism ist ein Vite-Projekt mit TypeScript und einem
Build-Schritt; im Repository liegt der Quellcode, auf der Seite landet nur das
Ergebnis aus `prism/dist/`. Das übernimmt der Workflow. Die Konventionen oben
gelten trotzdem: relative Pfade, eigenes Manifest, eigener Service Worker mit
Wirkungsbereich `./`.

Prism braucht zusätzlich **Cross-Origin-Isolation** für den mehrthreadigen
ffmpeg-Kern. GitHub Pages kann keine Header senden, deshalb rüstet Prisms
eigener Service Worker sie nach. Details in [prism/README.md](prism/README.md).

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

Für Prism:

```bash
npm run prism:install   # einmalig: Abhängigkeiten installieren
npm run prism:dev       # Vite-Dev-Server auf Port 5180
npm run prism:build     # nach prism/dist/ bauen
npm run test:prism      # Tests von Prism
npm run serve           # ganze Seite so ausliefern wie GitHub Pages, inkl. /prism/
```

`npm start` zeigt Prism nur, wenn vorher einmal gebaut wurde — und dann unter
`/prism/dist/`. Für den echten Pfad `/prism/` stattdessen `npm run serve`
verwenden; das bildet die veröffentlichte Struktur exakt ab.

Für Service Worker und Installation wird HTTPS oder `localhost` benötigt.

## Deployment

Der Workflow `.github/workflows/pages.yml` läuft bei jedem Push auf den
Default-Branch, manuell über Actions → „Deploy PWA to GitHub Pages“ →
Run workflow. Er

1. testet die HTML-Apps und Prism und prüft Prisms Typen,
2. baut Prism,
3. stellt die Seite zusammen — Repository unverändert, plus `prism/dist/`
   als `/prism/` — und veröffentlicht sie.
