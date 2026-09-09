# OSC Pad

Ein frei belegbares OSC-Steuerpult fuers Handy — fuer **MadMapper**, **NovaStar**
und alles andere, was OSC versteht. Laeuft als PWA im Browser, offline
installierbar, ohne Konto und ohne Cloud.

![Aufbau](icons/icon.svg)

## Was drin ist

* **Zehn Bauteile** — Fader, Poti (auch Endlos-Encoder), Schalter, Taster, Bank,
  Auswahl, XY-Pad, Farbe, Anzeige und Text.
* **Freies Raster.** Kacheln verschieben und an der Ecke unten rechts aufziehen,
  4 bis 24 Spalten, „auf Bildschirm einpassen" fuer Bedienung ohne Scrollen
  (wirkt nur live — beim Bearbeiten bleibt die Zeilenhoehe fest).
* **Mehrere Seiten** je Projekt, Vorlagen fuer MadMapper und NovaStar,
  Export/Import als JSON, Zuruecksetzen je Seite oder fuers ganze Projekt.
* **Feedback.** Eingehendes OSC bewegt die Regler mit — ausser man haelt gerade
  den Finger drauf.
* **Monitor.** Zeigt gesendete und empfangene Nachrichten. Auf eine empfangene
  Zeile tippen legt daraus sofort ein Bauteil an — so uebernimmt man Adressen
  direkt aus MadMapper.
* **NovaStar.** `/nova/brightness`, `/nova/blackout`, `/nova/freeze`,
  `/nova/preset` gehen als TCP-Befehle an den Prozessor.

## Bedienung

Regler ziehen **relativ**: Antippen aendert nie einen Wert, erst die Bewegung.
Wer beim Ziehen **seitlich ausweicht**, bekommt einen feineren Griff (1/4, dann
1/12) — wie am Pult. Taster geben ein kurzes Vibrieren.

Im Bearbeiten-Modus (Stift oben rechts) verschiebt man Kacheln mit dem Finger,
zieht sie an der **Ecke unten rechts** groesser und tippt sie kurz an, um
Adresse, Bereich und Farbe zu aendern. Neue Bauteile kommen ueber
**+ Bauteil** — oder indem man auf eine freie Stelle im Raster tippt, dann
landet das Bauteil genau dort.

Das Menue (☰) ist eine Liste: Seiten, Verbindung, Monitor, Projekt sichern &
laden, Einstellungen, Zuruecksetzen, Hilfe — jeder Eintrag oeffnet ein eigenes,
kurzes Blatt.

## Die Bruecke

Ein Browser kann kein UDP — OSC aber schon. Deshalb laeuft auf dem Show-Rechner
ein kleines Programm ohne Abhaengigkeiten:

```
node bridge/osc-bridge.mjs
```

Es macht aus den WebSocket-Nachrichten des Handys echte UDP-Pakete, reicht
Feedback zurueck und liefert nebenbei die App selbst aus — dadurch funktioniert
alles auch ganz ohne Internet:

```
Am Handy oeffnen:
  http://192.168.1.20:8090
```

Einzelheiten: [`bridge/LIESMICH.txt`](bridge/LIESMICH.txt).

> Die App von der Webseite (HTTPS) kann aus Sicherheitsgruenden keine
> unverschluesselte Verbindung ins lokale Netz aufbauen. Fuer den Betrieb am
> Handy also die App **von der Bruecke** oeffnen — das ist ohnehin der
> robustere Weg, weil kein Internet noetig ist.

## Entwicklung

Kein Build, keine Abhaengigkeiten. Statisch ausliefern reicht:

```
npm start          # http://localhost:8080/osc/
npm test           # Rechenkern, Raster, Bruecke (inkl. Komplettlauf)
npm run icons:osc  # Icons neu erzeugen
```

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `js/osc.js` | OSC-1.0-Codec (Encoder/Decoder) |
| `js/model.js` | Widgets, Seiten, Rasterlogik |
| `js/presets.js` | Vorlagen MadMapper / NovaStar |
| `js/conn.js` | WebSocket zur Bruecke, Buendelung, Wiederverbinden |
| `js/widgets.js` | Aufbau und Verhalten der Bauteile |
| `js/editor.js` | Verschieben, Groesse, Inspektor |
| `js/app.js` | Ansicht, Seiten, Monitor, Speichern |
| `bridge/osc-bridge.mjs` | Bruecke: HTTP + WebSocket + UDP + NovaStar |
