# OSC Pad

Ein frei belegbares OSC-Steuerpult fuers Handy — fuer **MadMapper**, **NovaStar**
und alles andere, was OSC versteht. Laeuft als PWA im Browser, offline
installierbar, ohne Konto und ohne Cloud.

![Aufbau](icons/icon.svg)

## Was drin ist

* **Zehn Bauteile** — Fader, Poti (auch Endlos-Encoder), Schalter, Taster, Bank,
  Auswahl, XY-Pad, Farbe, Anzeige und Text. Die **Bank** ist ein Feld aus
  Tastern, Schaltern **oder Potis** — je Eintrag eine eigene Adresse.
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

Im Bearbeiten-Modus (Stift oben rechts) gilt: **erster Tipp waehlt aus** —
darunter erscheint eine Leiste mit Einstellungen, Duplizieren und Loeschen —,
**zweiter Tipp auf dieselbe Kachel oeffnet die Einstellungen**. Ziehen
verschiebt, die **Ecke unten rechts** zieht auf. Ein Tipp ins Leere hebt nur
die Auswahl auf; wer **lange auf eine freie Stelle drueckt**, bekommt die
Bauteil-Auswahl und das neue Bauteil landet genau dort.

**↶ nimmt den letzten Schritt zurueck** — verschieben, Groesse, einfuegen,
loeschen, duplizieren, aufraeumen, Spalten und Einstellungen; am Rechner auch
mit `Strg`/`Cmd` + `Z`. Die Schaltflaeche nennt jeweils den Schritt, der
drankommt. Der Verlauf gilt der laufenden Sitzung im Bearbeiten-Modus: beim
Verlassen, beim Seitenwechsel und bei einem neuen Projekt faengt er von vorn
an. Die Stellung der Regler bleibt dabei unangetastet — zurueck geht der
Aufbau, nicht das Pult.

Die Einstellungen liegen in **Reitern** (Allgemein · Werte · Eintraege ·
Groesse), sodass nichts gescrollt werden muss. **Duplizieren** zaehlt
Beschriftung und Adresse hoch (`/cues/1/recall` → `/cues/2/recall`) und legt
die Kopie neben das Original — zwei Bauteile auf derselben Adresse entstehen so
gar nicht erst.

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
npm test           # Rechenkern, Raster, Poti-Geometrie, Bruecke
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
| `js/icons.js` | Piktogramme der Bauteile und Schaltflaechen |
| `js/app.js` | Ansicht, Seiten, Monitor, Speichern |
| `bridge/osc-bridge.mjs` | Bruecke: HTTP + WebSocket + UDP + NovaStar |
