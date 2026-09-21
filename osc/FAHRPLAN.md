# Fahrplan

Was an OSC Pad noch offen ist — alle Ideen aus der Entwicklung, nach Aufwand
sortiert, mit einem Plan zum Abarbeiten. Stand: App 1.9.0, Bruecke 1.1.0.

**Aufwand.** `S` = eine Sitzung, wenige Dutzend Zeilen an ein bis zwei Stellen.
`M` = ein halber bis ganzer Tag; beruehrt mehrere Dateien oder das Datenmodell.
`L` = mehrere Sitzungen; neues Konzept, eigener Entwurf, eigene Tests.

**Datenmodell.** Punkte mit dem Vermerk *Modell* brauchen ein neues Feld in
`js/model.js` samt `normalizeWidget`/`normalizePage` und einem Test — das ist
der Teil, der spaeter nicht mehr billig zu aendern ist.

---

## S — Kleinkram

| # | Punkt | Nutzen | Ort im Code |
| --- | --- | --- | --- |
| S1 | **Doppelte Adressen zeigen** | Zwei Bauteile auf derselben Adresse arbeiten still gegeneinander; im Bearbeiten-Modus bekommt die Kachel ein Warnzeichen | `app.js` (`renderSurface` baut `byAddress` schon), `app.css` |
| S2 | **Alles senden („Sync")** | Nach dem Start des Zielprogramms steht das Pult auf Stellungen, die dort niemand kennt — ein Knopf schickt jeden Wert einmal raus | `app.js` (Verbindungsblatt), nutzt die Buendelung in `conn.js` |
| S3 | **Adress-Vorschlaege aus dem Monitor** | Alles je Empfangene als `datalist` am Adressfeld — Adressen waehlen statt tippen | `editor.js` (Inspektor), `app.js` (`logBuf`) |
| S4 | **Seite duplizieren** | Neben ↑ ↓ ✕ in der Seitenliste; nutzt `copyWidget` mit | `app.js` (`renderPageList`) |
| S5 | **Sperre in die Kopfzeile** | „Bedienung sperren" will man im Betrieb schnell erreichen, nicht zwei Blaetter tief | `index.html`, `app.js` |
| S6 | **Monitor filtern** | Bei viel Feedback findet man die gesuchte Adresse sonst nicht | `app.js` (`renderLog`) |
| S7 | **Panik-Knopf** | Schickt einmal 0 an alle Adressen der Seite | `app.js` |
| S8 | **Bruecke: `--open`** | Startet den Browser gleich mit | `bridge/osc-bridge.mjs` |
| S9 | **Halten zum Ausloesen** *(Modell)* | Blackout erst nach ~600 ms Druck — gegen den Versehensdruck | `model.js` (`holdMs`), `widgets.js` (Taster) |
| S10 | **Grundstellung je Bauteil** *(Modell)* | Langer Druck im Live-Betrieb setzt auf einen hinterlegten Wert zurueck und sendet ihn | `model.js` (`home`), `widgets.js`, `editor.js` |
| S11 | **Fadername hochkant** | Bei ein bis zwei Spalten Breite bleibt der Name lesbar, wie am echten Pult | `app.css` (`.t-fader .tile-name`) |
| S12 | **Weisse Palettenfarbe** | Im hellen Design ist ein weisses Bauteil auf weisser Kachel unsichtbar; Palette ergaenzen oder Fuellung mit Haarlinie | `model.js` (`COLORS`) oder `app.css` |

## M — Mittel

| # | Punkt | Nutzen | Ort im Code |
| --- | --- | --- | --- |
| M1 | **Kurven je Fader** *(Modell)* | Helligkeit ist nicht linear; linear / logarithmisch / quadratisch, wirkt nur beim Senden — der Regler bleibt innen linear | `model.js` (`curve`), `widgets.js`, Test |
| M2 | **Rampenzeit** *(Modell)* | Statt Sprung in *n* ms zum Ziel fahren — fuer Taster mit festem Wert und Grundstellungen | `widgets.js`, kleine Zeitschleife in `conn.js` |
| M3 | **Rastpunkte** *(Modell)* | Fuehlbares Einrasten bei 0 / 50 / 100 % mit kurzem Vibrieren | `widgets.js` (`drag`) |
| M4 | **Makro-Taster** *(Modell)* | Ein Taster sendet mehrere Nachrichten an verschiedene Adressen (Blackout = Master 0 + Freeze an + Cue 0) | `model.js` (Liste von Nachrichten), `widgets.js`, `editor.js` |
| M5 | **Gruppen-Master** *(Modell)* | Ein Fader skaliert mehrere Adressen prozentual | wie M4, gleiches Nachrichtenmodell |
| M6 | **Mehrfachauswahl im Editor** | Mehrere Kacheln zugleich verschieben, faerben, loeschen | `editor.js`, `app.js` (Auswahl wird zur Menge) |
| M7 | **Seitenwechsel per Wischen** | Zwischen Seiten blaettern ohne Reiter zu treffen — kollidiert mit dem Ziehen der Regler, braucht eine saubere Abgrenzung | `app.js`, `widgets.js` |
| M8 | **Zwei Ziele gleichzeitig** | Haupt- und Reserverechner parallel versorgen | `bridge/osc-bridge.mjs`, Verbindungsblatt |
| M9 | **Seite aus dem Monitor lernen** | Eine Weile lauschen und aus allem Gehoerten eine Seite bauen — findet die Adressen der eigenen Installation, unabhaengig von Programm und Version. Robuster als jede Vorlage | `app.js` (`logBuf`), `model.js` |

## L — Gross

| # | Punkt | Nutzen | Ort im Code |
| --- | --- | --- | --- |
| L1 | **Szenen / Snapshots** *(Modell)* | Stand aller Regler einer Seite sichern und per Taster aufrufen, wahlweise mit Ueberblendzeit — der Schritt vom Fernbedienungspult zum Show-Werkzeug | `model.js` (Szenen je Seite), neues Bauteil, `widgets.js`, `editor.js` |
| L2 | **Mehrere Geraete synchron** | Regie und Buehne bedienen dasselbe Pult und sehen die Regler mitlaufen | `bridge/osc-bridge.mjs` (Zustand + Spiegelung), `conn.js` |
| L3 | **MIDI ueber die Bruecke** | Ein USB-Fadermodul am Show-Rechner steuert dieselben Adressen | `bridge/osc-bridge.mjs` (WebMIDI oder Node-MIDI ohne Abhaengigkeit ist der Knackpunkt) |

---

## Der Plan: in Buendeln statt einzeln

Vier Regeln, nach denen die Buendel geschnitten sind:

1. **Ein Commit je Buendel, nicht je Punkt.** Der Pruefdurchlauf — Tests plus
   Touch-Durchlauf im Browser, beide Designs — kostet mehr Zeit als die
   meisten Aenderungen selbst. Fuenf Kleinigkeiten zusammen kosten einen
   Durchlauf, einzeln fuenf.
2. **Nach gemeinsamer Codestelle buendeln, nicht nach Wichtigkeit.** Wer
   `widgets.js` zweimal aufmacht, liest zweimal dasselbe.
3. **Was das Modell erweitert, zuerst.** Neue Felder samt `normalize` und Test
   sind die Grundlage, an der spaeter alles andockt; nachtraeglich kosten sie
   eine Migration.
4. **Grosse Punkte erst, wenn ihre Vorarbeit drin ist.** L1 ohne M2 waere ein
   Szenenwechsel ohne Ueberblendung.

### Reihenfolge

| Buendel | Inhalt | Warum zusammen |
| --- | --- | --- |
| **1 · Adressen** | S1, S2, S3 (+ M9) | Alle fassen dieselbe Stelle an: die Adressliste beim Zeichnen, das Adressfeld, das Protokoll. Zusammen ein Gedanke — Adressen sehen, waehlen, senden. **M9** passt in denselben Aufwasch und macht aus dem Buendel etwa einen Tag statt eines halben. |
| **2 · Live-Sicherheit** | S5, S7, S9, S10 | Alles Verhalten am Finger im Live-Betrieb; ein Testlauf deckt alle vier ab. S9 und S10 bringen die ersten neuen Modellfelder mit. |
| **3 · Kleinkram** | S4, S6, S8, S11, S12 | Streut ueber die Dateien, aber jeder Punkt ist unter einer halben Stunde — ein Sammel-Commit statt fuenf. |
| **4 · Wertverarbeitung** | M1, M2, M3 | Alle drei sitzen zwischen „Regler bewegt sich" und „Nachricht geht raus". Gemeinsam entworfen bleibt die Stelle einfach; einzeln wird sie dreimal umgebaut. |
| **5 · Mehrere Nachrichten** | M4, M5 | Beide brauchen dasselbe: eine Aktion, mehrere Ziele. Das Modell dafuer will einmal richtig entworfen werden. |
| **6 · Editor** | M6, M7 | Beide aendern, wie die Flaeche auf Finger reagiert — Auswahl als Menge, Wischen gegen Ziehen abgrenzen. |
| **7 · Szenen** | L1 | Baut auf Buendel 4 (Ueberblendzeit) und 5 (mehrere Nachrichten) auf. |
| **8 · Netz** | M8, L2, L3 | Alles in der Bruecke, alles am selben Zustand. Wer hier einmal aufraeumt, hat die drei fast geschenkt. |

### Wenn Punkte wegfallen

Die Buendel sind aus der heutigen Liste geschnitten. Faellt etwas in die
Warteliste, werden sie neu geschnitten — betroffen ist meist nur eines:

* Ohne **S2** verliert Buendel 1 den Bezug zur Bruecke und wird reine Oberflaeche.
* Ohne **M2** kann **L1** trotzdem kommen, dann eben mit hartem Szenenwechsel.
* Ohne **M4/M5** bleibt Buendel 5 leer und Buendel 7 rueckt vor.
* Faellt aus Buendel 3 etwas weg, aendert das nichts — der Rest bleibt ein
  Sammel-Commit.

---

## Quellen

* MadMapper, feste OSC-Adressen und Kanalliste:
  <https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/osc-commands-and-channels-list>
  — war die Grundlage fuer **M0**, eingearbeitet in `js/presets.js`. Aus der
  Entwicklungsumgebung heraus nicht abrufbar (der Netzzugang ist dort
  gesperrt), die Seite lag beim Umsetzen als Datei vor. Geraten wurde nichts:
  eine falsche Adresse in einer Vorlage faellt erst auf der Buehne auf, und
  dann als „geht nicht". Offen bleibt, was die Liste nicht hergibt: einzelne
  Surfaces haben keine festen Adressen (in MadMapper per Rechtsklick → *Copy
  OSC address* oder „OSC lernen"), und der BPM-Bereich 40–240 ist eine
  Annahme.

## Warteliste

*(noch leer — hier landen Punkte, die nicht gebraucht werden, mitsamt dem
Grund. Geloescht wird nichts: Gruende aendern sich.)*

---

## Schon erledigt

Damit nichts doppelt vorgeschlagen wird — alles aus derselben Entwicklung:

* Poti: Bogen bei halber Stellung, Endlos-Encoder, Einpassen in jede Kachel
* Bank aus Potis, Wert im Zifferblatt
* Editor: Reiter statt Scrollen, Auswahl-Leiste, erster/zweiter Tipp,
  Raster-Auswahl mit Piktogrammen, kleinere Mindestgroessen, Duplizieren
  zaehlt Adressen hoch
* Rueckgaengig und Wiederherstellen
* Spaltenwechsel ohne Verzerrung
* Farbe: R/G/B, H/S/V, eigene Palette; 32-Bit-Farbe fuer MadMapper
* Fader: Wert in der Bahn, Name zweizeilig, knapper Rahmen
* Bruecke: QR-Code, Adressbewertung, „diese Adresse ist die richtige"
* Vollbild, helles Design
* MadMapper-Vorlagen mit den echten Adressen der Kanalliste: MM Master,
  MM Cues, MM Medien; Nachricht „ohne Wert" fuer die `nil`-Befehle (M0)
