# PWA-Werkzeuge

Sammlung offline nutzbarer Web-Apps. Jede App liegt in einem eigenen Ordner und
bekommt dadurch eine eigene Adresse unter GitHub Pages; die Startseite im
Wurzelverzeichnis verlinkt sie.

Live: **https://mottul.github.io/project_android/**

## Apps

| App | Adresse | Inhalt |
| --- | --- | --- |
| [LED Wall Planner](led-wall/) | `/led-wall/` | Größe, Auflösung, Gewicht, Signalwege, Stromkreise, Plan und PDF-Baumappe einer LED-Wand |

## Aufbau

```
index.html          Startseite mit der App-Übersicht
favicon.svg         Symbol der Startseite
led-wall/           App: LED Wall Planner (eigenes Manifest, eigener Worker)
.github/workflows/  Deployment auf GitHub Pages
```

Jede App bringt ihr eigenes `index.html`, `manifest.webmanifest` und `sw.js`
mit und ist damit einzeln installierbar. Alle Pfade innerhalb einer App sind
relativ, der Ordnername ist deshalb frei wählbar.

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
npm start          # http://localhost:8080 — Startseite und alle Apps
npm test           # Tests aller Apps
npm run icons      # Icons des LED Wall Planners neu erzeugen
```

Für Service Worker und Installation wird HTTPS oder `localhost` benötigt.

## Deployment

Der Workflow `.github/workflows/pages.yml` testet und veröffentlicht das
Repository bei jedem Push auf den Default-Branch auf GitHub Pages; manuell
über Actions → „Deploy PWA to GitHub Pages“ → Run workflow.
