# LED Wall Planner

Für Mobiltelefone optimierte PWA zur Planung von LED-Walls: Rastergröße,
Auflösung, Gewicht, Signalwege und Stromverkabelung — installierbar und
vollständig offline nutzbar.

Live: **https://mottul.github.io/project_android/led-wall/**

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
| `tests/` | Tests des Rechenkerns (`npm test` im Wurzelverzeichnis) |

Bei Änderungen an den Dateien die Konstante `CACHE` in `sw.js` hochzählen,
damit installierte Clients die neue Version laden.

## Hinweis

Alle Werte sind Richtwerte für die Vorplanung. Vor Aufbau und Anschluss immer
die Datenblätter der eingesetzten Module, Processoren und der Stromverteilung
prüfen. Elektrische Arbeiten gehören in Fachhand.
