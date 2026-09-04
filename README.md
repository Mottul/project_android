# LED Wall Planner

Eine für Mobiltelefone optimierte PWA zur Planung von LED-Walls: Rastergröße,
Auflösung, Gewicht, Signalwege und Stromverkabelung — installierbar und
vollständig offline nutzbar.

![Bereiche](https://img.shields.io/badge/PWA-offline-38bdf8) ![Ohne Build](https://img.shields.io/badge/Build-keiner-a3e635)

## Funktionen

**Wand**
- Panel-Bibliothek (P1.9 bis P10, 500×500 bis 960×960) oder frei definierbares Kabinett
- Raster über Stepper oder aus einem Zielmaß in Metern (auf- oder abrunden)
- Maß, Fläche, Auflösung, Pixelabstand, Seitenverhältnis, Diagonale
- Gewicht gesamt, je Spalte und als Traglast je Meter Breite (Rigging)
- Abgleich mit HD/UHD inklusive nötiger Skalierung
- Betrachtungsabstände: Mindestabstand, komfortabler Abstand, volle Auflösung

**Signal**
- Processor-Presets (1 GbE / 10 GbE) oder eigene Werte für Ports, Pixel je Port und Gesamtkapazität
- Panels je Port aus Pixelbudget und Daisy-Chain-Limit, inklusive Angabe, was begrenzt
- Anzahl benötigter Ports und Geräte, höchste Portlast, optionale Redundanz
- Verkabelungsrichtung (spalten- oder zeilenweise), Startecke und Schlangenlinie

**Strom**
- Netzform: Spannung, Sicherung, Ausnutzung, ein- oder dreiphasig
- Belastbarkeit je Stromkreis, Panels je Kreis automatisch oder manuell
- Leistung max/ø, W/m², Strom je Phase, empfohlene Einspeisung (CEE)
- Verteilung der Kreise auf die Phasen, Hinweis auf Einschaltstrom

**Plan**
- Maßstäbliche SVG-Grafik der Wand mit Panelnummern und Bemaßung
- Overlay umschaltbar: Signalwege, Stromgruppen oder reines Raster
- Farbige Kettenverläufe mit Startpunkt, Laufrichtung und Legende je Port/Kreis
- Zoom-Modus für kleine Displays, Export als SVG, Textzusammenfassung, Druck/PDF

**Projekte**
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

Deployment: Repository-Inhalt auf einen beliebigen Static-Host legen, z. B.
GitHub Pages (Settings → Pages → Branch wählen). Alle Pfade sind relativ,
ein Unterverzeichnis funktioniert also ebenfalls.

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
| `js/data.js` | Panel-Bibliothek, Processor-Presets, Farben |
| `js/calc.js` | Rechenkern: Scan-Reihenfolge, Kettenbildung, Kennzahlen |
| `js/render.js` | SVG-Grafik der Wand und Legende |
| `js/state.js` | Defaults, Migration, Speicherung im Gerät |
| `js/app.js` | Bindings, Ansichten, Export, PWA-Anbindung |
| `sw.js` | Service Worker, App-Shell-Cache |
| `tools/make-icons.mjs` | Icon-Generator (PNG ohne externe Abhängigkeiten) |

Bei Änderungen an den Dateien die Konstante `CACHE` in `sw.js` hochzählen,
damit installierte Clients die neue Version laden.

## Hinweis

Alle Werte sind Richtwerte für die Vorplanung. Vor Aufbau und Anschluss immer
die Datenblätter der eingesetzten Panels, Processoren und der Stromverteilung
prüfen. Elektrische Arbeiten gehören in Fachhand.
