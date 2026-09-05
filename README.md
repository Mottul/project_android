# LED Wall Planner

Eine für Mobiltelefone optimierte PWA zur Planung von LED-Walls: Rastergröße,
Auflösung, Gewicht, Signalwege und Stromverkabelung — installierbar und
vollständig offline nutzbar.

![Bereiche](https://img.shields.io/badge/PWA-offline-38bdf8) ![Ohne Build](https://img.shields.io/badge/Build-keiner-a3e635)

## Funktionen

Alle Bereiche sind einklappbar; der Zustand wird im Gerät gemerkt.

**Wand**
- Größe direkt in Metern eingeben — die Modulzahl wird gerundet, die Abweichung
  vom Zielmaß ausgewiesen und lässt sich mit ± modulweise nachjustieren
- Drei feste Modultypen aus der Modulliste (496-2,0 · uS2+ · rX3ioBF) plus
  frei konfigurierbares eigenes Modul
- Maß, Fläche, Auflösung, Pixelabstand, Seitenverhältnis, Diagonale, Bautiefe
- Gewicht gesamt, je Spalte und als Traglast je Meter Breite (Rigging)
- Bildquelle & Betrachtung: Grafik der Einpassung in 16:9 mit den entstehenden
  schwarzen Rändern in Pixeln, dazu Skalierung auf HD/UHD und die
  Betrachtungsabstände

**Signal**
- Drei feste Processoren (NovaPro UHD Jr · NovaStar VX4S · Brompton Tessera S8)
  plus eigene Werte für Ports, Pixelbudget und Gesamtkapazität
- Bildraten-Tabelle: Pixel je Port und Module je Port für 24 bis 120 Hz,
  direkt anwählbar; das Daisy-Chain-Limit wird gekennzeichnet
- Module je Port, benötigte Ports und Geräte, höchste Portlast, Redundanz
- Verkabelungsrichtung (spalten- oder zeilenweise), Startecke, Schlangenlinie

**Strom**
- Netzform: Spannung, Sicherung, Ausnutzung, ein- oder dreiphasig
- Belastbarkeit je Stromkreis, Module je Kreis automatisch oder manuell
- Leistung max/ø, W/m², Strom je Phase, empfohlene Einspeisung (CEE)
- Verteilung der Kreise auf die Phasen, Hinweis auf Einschaltstrom

**Plan**
- Maßstäbliche SVG-Grafik der Wand mit Modulnummern und Bemaßung
- Overlay umschaltbar: Signalwege, Stromgruppen oder reines Raster
- Farbige Kettenverläufe mit Startpunkt, Laufrichtung und Legende je Port/Kreis
- Zoom-Modus für kleine Displays, Export als SVG, Textzusammenfassung, Druck

**Projekte**
- Baumappe als PDF: vierseitig mit Übersicht, Signalplan, Stromplan und
  Modulraster samt Notizen — wahlweise quer, mit oder ohne Listen und Nummern
- Automatische Sicherung des aktuellen Stands im Gerät
- Mehrere Projekte speichern, laden, löschen
- Import/Export als JSON zum Weitergeben

## Nutzung

Statische Dateien, kein Build-Schritt. Lokal starten:

```bash
npm start          # http://localhost:8080
```

Auf dem Handy im Browser öffnen und über „Zum Startbildschirm hinzufügen“
installieren. Für den Service Worker (Offline-Betrieb, Installation) wird
HTTPS oder `localhost` benötigt.

## Deployment

Der Workflow `.github/workflows/pages.yml` testet den Rechenkern und
veröffentlicht das Repository anschließend auf GitHub Pages — bei jedem Push
auf den Default-Branch oder manuell über Actions → „Deploy PWA to GitHub
Pages“ → Run workflow.

Live: **https://mottul.github.io/project_android/**

Einmalig vorab nötig: unter **Settings → Pages → Source** „GitHub Actions“
wählen. Den `GITHUB_TOKEN` des Workflows lässt GitHub die Pages-Site nicht
selbst anlegen — ohne diesen Schritt bricht der Job „Deployen“ mit
`Resource not accessible by integration` ab. Danach den Workflow erneut
starten (Actions → Run workflow).

Alle Pfade sind relativ, das Unterverzeichnis `/project_android/` funktioniert
also ohne Anpassung — ebenso jeder andere Static-Host.

## Tests

```bash
npm test           # Rechenkern: Scan-Reihenfolge, Ketten, Kennzahlen
npm run icons      # Icons aus tools/make-icons.mjs neu erzeugen
```

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Ansichten Wand, Signal, Strom, Plan, Projekte |
| `css/app.css` | Dunkles Theme, Safe-Area, Tableiste, Druckansicht |
| `js/data.js` | Modulbibliothek, Processor-Presets, Bildraten, Farben |
| `js/calc.js` | Rechenkern: Scan-Reihenfolge, Kettenbildung, Kennzahlen |
| `js/render.js` | SVG-Grafik der Wand, Legende, 16:9-Einpassung |
| `js/pdf.js` | PDF-Baumappe (eigener PDF-Writer, ohne Abhängigkeiten) |
| `js/state.js` | Defaults, Migration, Speicherung im Gerät |
| `js/app.js` | Bindings, Ansichten, Export, PWA-Anbindung |
| `sw.js` | Service Worker, App-Shell-Cache |
| `tools/make-icons.mjs` | Icon-Generator (PNG ohne externe Abhängigkeiten) |

Bei Änderungen an den Dateien die Konstante `CACHE` in `sw.js` hochzählen,
damit installierte Clients die neue Version laden.

## Hinweis

Alle Werte sind Richtwerte für die Vorplanung. Vor Aufbau und Anschluss immer
die Datenblätter der eingesetzten Module, Processoren und der Stromverteilung
prüfen. Elektrische Arbeiten gehören in Fachhand.
