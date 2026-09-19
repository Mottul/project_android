# Folio

Dokumente lesen, kommentieren und bearbeiten — vollständig auf dem eigenen
Gerät. PDF, EPUB, Bilder und Textdateien. Kein Konto, kein Server, kein Upload.

Teil der [PWA-Werkzeuge](../README.md); installierbar über „Zum Startbildschirm
hinzufügen“ und danach offline nutzbar.

## Was die App kann

### Bibliothek

Einen Ordner auswählen — Folio durchsucht ihn samt Unterordnern nach PDFs,
EPUBs, Bildern und Textdateien und legt daraus eine Bibliothek an: mit
Titelbild, Titel und Autor aus den Dokumenten selbst, Seitenzahl, Dateigröße,
Lesefortschritt und Notizzähler. Suche über Titel, Autor, Dateiname und Ordner,
Filter nach Art, Quelle, „mit Notizen“ und „angefangen“.

**Wie weit „Speicher durchsuchen“ geht.** Kein Browser gibt einer Web-App
Zugriff auf Dateien, die nicht ausdrücklich übergeben wurden — das ist kein
Mangel dieser App, sondern die Grenze der Plattform. Der Ordner-Dialog ist so
nah dran, wie es geht: Wer dort das Wurzelverzeichnis des Speichers oder der
SD-Karte auswählt, bekommt genau das, und deshalb ist die Suche rekursiv.

Es gibt zwei Qualitäten von Zugriff, und welche verfügbar ist, entscheidet der
Browser:

| | Ordner bleibt bekannt | Datei überschreibbar | Verfügbar |
| --- | --- | --- | --- |
| `showDirectoryPicker` | ja | ja | Chromium am Rechner |
| Ordner-Eingabefeld | nein, Kopie in Folio | nein, nur Export | fast überall außer iOS |

Im zweiten Fall funktioniert die Bibliothek genauso, nur liegt der Inhalt als
Kopie in Folio und „Über Original speichern“ entfällt. Welcher Weg genommen
wurde, steht in der Quellenliste unter „Quellen und Einstellungen“.

Dokumente lassen sich außerdem einzeln auswählen, ins Fenster ziehen oder vom
Betriebssystem übergeben („Öffnen mit Folio“).

### Lesen

* **PDF** — fortlaufende Seiten, nur das Sichtbare wird gerendert; Zoom auf
  Breite, ganze Seite oder feste Stufen; Seitenvorschau, Inhaltsverzeichnis,
  Volltextsuche; Seitenhintergrund wahlweise weiß, sepia, grau oder dunkel.
* **EPUB** — kapitelweise, mit eigener Typografie (Schriftgröße, Zeilenabstand,
  Serif oder Sans), Inhaltsverzeichnis und Volltextsuche.
* **Bilder** — zoombar und wie eine Seite kommentierbar.
* **Text und Markdown** — als Text, markierbar.

Die Leseposition wird gemerkt, der Bildschirm kann auf Wunsch anbleiben.

### Bedienung mit dem Finger

Eine Regel, überall dieselbe: **ein Finger gehört dem Werkzeug, zwei Finger
gehören der Seite.**

| Geste | Beim Lesen | Mit einem Werkzeug in der Hand |
| --- | --- | --- |
| ein Finger wischen | blättern | markieren, zeichnen, aufziehen |
| zwei Finger auseinander | zoomen | zoomen |
| zwei Finger schieben | verschieben | verschieben |
| Doppeltipp | heranholen bzw. zurück auf Seitenbreite | dito |

Beim Zoomen folgt die Seite während der Geste flüssig den Fingern und wird
danach einmal scharf neu gerendert — dabei bleibt der Punkt zwischen den
Fingern stehen, sodass man beim Vergrößern nicht die Stelle verliert. Auf
Seitenbreite ist eine A4-Seite auf einem 360-Pixel-Display etwa 42 % groß;
deshalb rechnet der Doppeltipp relativ zur Seitenbreite und nicht gegen einen
festen Zoomwert.

Kommt beim Zeichnen ein zweiter Finger dazu, wird der angefangene Strich
verworfen statt mit einem Ausrutscher beendet.

### Warum Markieren eine Wischgeste ist

Weil Android sonst zwei Menüs zeigt. Sobald eine Seite eine native Textauswahl
hält, legt das System seine eigene Leiste darüber — kopieren, teilen,
übersetzen. Eine Web-Seite kann die Auswahl verhindern, aber sie kann nicht die
Auswahl behalten und die Leiste verbergen. Wer über die Browserauswahl
markiert, bekommt also immer beides gleichzeitig.

Folio trennt die Fälle deshalb:

* **Beim Lesen** bleibt die native Auswahl unverändert. Sie ist vertraut, und
  Kopieren, Teilen und Übersetzen kommen kostenlos mit. Folios eigenes
  Auswahlmenü erscheint hier nur auf Geräten mit Maus.
* **Mit einem Markierwerkzeug** ist die Auswahl auf der Textebene abgeschaltet.
  Folio nimmt die Geste selbst: der Textcursor unter dem Finger am Anfang und
  der unter ihm jetzt ergeben einen Bereich, der beim Wischen als Vorschau
  mitwächst und beim Loslassen zur Markierung wird.

Kein Systemmenü, kein zweites Menü, und Markieren ist ein Strich über die
Wörter statt erst auswählen, dann wählen — die Bewegung, die man mit einem
echten Textmarker ohnehin macht.

### Kommentieren

| Werkzeug | PDF | Bild | EPUB / Text |
| --- | --- | --- | --- |
| Markieren, Unterstreichen, Durchstreichen | ✓ | — | ✓ |
| Kommentar zu jeder Markierung | ✓ | ✓ | ✓ |
| Notizzettel an einer Stelle | ✓ | ✓ | — |
| Freihand-Stift und Radierer | ✓ | ✓ | — |
| Textfeld einfügen | ✓ | ✓ | — |
| Abdecken | ✓ | ✓ | — |

Die Leiste zeigt fünf Gruppen — **Lesen · Markieren · Stift · Notiz · Mehr** —
statt zehn Einzelknöpfe. Ein Tipp aktiviert das zuletzt benutzte Werkzeug der
Gruppe, ein zweiter öffnet ihr Feld mit den Varianten und den Farben. Darunter
steht, was gerade in der Hand liegt, ausgeschrieben und mit Farbnamen
(„Markieren · Gelb“), samt Farbfeldern und Strichstärke.

Das ist kein Geschmack, sondern Platz: zehn Knöpfe plus Farbreihe waren rund
560 px breit, ein Handy ist 360 px — die Farben lagen hinter einer
Scrollstrecke. Fünf Gruppen passen mit Luft, und die Farbe des aktiven
Werkzeugs ist als Streifen unter seinem Symbol immer sichtbar.

Fünf Marker- und fünf Stiftfarben, einstellbare Strichstärke, Rückgängig und
Wiederholen (auch per `Strg`/`Cmd`+`Z`).

Markierungen liegen **neben** dem Dokument, nicht darin: in einer lokalen
Datenbank, verknüpft mit der Datei. Dadurch lässt sich auch ein
schreibgeschütztes Dokument kommentieren, dieselbe Datei einmal mit und einmal
ohne Markierungen exportieren, und nichts wird verändert, solange nicht
ausdrücklich gespeichert wird.

In PDFs und Bildern sind Markierungen an Seitenkoordinaten verankert — relativ
zur Seite, damit Zoom und Drehung nichts verschieben. In EPUB und Textdateien
gibt es keine festen Koordinaten, dort wird der markierte Text selbst gespeichert,
mit etwas Kontext davor und dahinter, und beim Anzeigen wiedergefunden. Deshalb
verrutscht beim Ändern der Schriftgröße keine einzige Markierung.

### Text direkt bearbeiten

Werkzeug „Text bearbeiten“, dann auf eine Zeile tippen: die Zeile lässt sich
überschreiben oder leeren.

**Was dabei wirklich passiert.** Ein PDF kennt keine Absätze, nur Glyphen an
festen Koordinaten. „Bearbeiten“ heißt deshalb: die alte Zeile wird mit der
Hintergrundfarbe überdeckt — die aus der gerenderten Seite ausgelesen wird, nicht
geraten — und der neue Text darüber gesetzt, in der Schriftfamilie, Größe und
Farbe der alten Zeile. Das ist das Verfahren, das jeder Browser-PDF-Editor
verwendet, und es hat drei sichtbare Grenzen:

* Der Ersatztext wird in einer der Standardschriften gesetzt (Helvetica, Times
  oder Courier), nicht in der eingebetteten Originalschrift.
* Längerer Text bricht um und wächst nach unten, statt den Rest der Seite
  umzubrechen.
* **Der ursprüngliche Text bleibt in der Datei.** Er ist überdeckt, nicht
  gelöscht, und lässt sich aus dem exportierten PDF weiterhin herauskopieren.

Der letzte Punkt gilt genauso für „Abdecken“, und der Export-Dialog sagt es
auch dort. Wer eine Stelle wirklich entfernen will, exportiert verkleinert: dann
werden die Seiten zu Bildern, und darunter liegt nichts mehr.

### Speichern und exportieren

Ziel wahlweise: über das Original (wenn der Browser das erlaubt), „Speichern
unter“, Download oder Weitergabe an eine andere App.

**PDF, unverändert** — Struktur, Text und Vektoren bleiben, Markierungen werden
eingezeichnet, Kommentare zusätzlich als echte PDF-Notizen eingebettet, sodass
jedes andere Programm sie in seiner Kommentarliste zeigt. Seitenbereiche wie
`1-4, 9, 12-` sind möglich.

**PDF, verkleinert** — jede Seite wird neu gerastert. Zwei Wege:

* *Qualität wählen*: Auflösung (72–300 dpi) und JPEG-Qualität direkt einstellen,
  dazu optional Graustufen. „Größe schätzen“ misst wirklich — es codiert
  Stichproben aus dem Dokument und rechnet hoch.
* *Zielgröße vorgeben*: 1 bis 20 MB. Folio probiert an einigen Seiten aus,
  welche Einstellung passt, und nimmt die beste, die darunter bleibt. Die Suche
  gibt zuerst Auflösung ab und erst dann Qualität, weil JPEG-Artefakte auf Text
  hässlicher sind als eine etwas weichere Seite.

Warum neu rastern statt „die Bilder im PDF kleiner rechnen“? Weil Letzteres bei
einem Dokument, dessen Größe von eingebetteten Schriften oder Vektorgrafiken
kommt, schlicht nichts tut — und eine Größenangabe, die manchmal wirkt und
manchmal nicht, ist keine.

**Weitere Ausgaben** — Seiten als JPEG oder PNG (mehrere Seiten als ZIP),
annotiertes EPUB mit optionalem Notizkapitel und einstellbarer Bildqualität,
annotiertes Bild, Notizen als Markdown oder als JSON.

## Aufbau

```
src/
  lib/        Bausteine ohne Fachlogik: DOM, IndexedDB, Geometrie, Dateizugriff
  store/      Zustand: Bibliothek, Marken, Einstellungen, Suche/Sortierung
  pdf/        pdf.js-Anbindung, Textebene, Seitenplatzierung, Export
  epub/       Entpacken, Paket lesen, Kapitel darstellen, Verankern, Export
  export/     Formatunabhängiges: Seitenbereiche, Notizen, Canvas, Ausgabeziel
  ui/         Oberfläche: Bibliothek, Reader, Werkzeuge, Dialoge
```

Die Oberfläche ist imperativ gebaut, ohne Framework. Der Reader ist ein Canvas
mit mehreren absolut positionierten Ebenen darüber, deren Geometrie bei jedem
Zoom neu gerechnet wird — dabei wäre ein virtuelles DOM im Weg, und der Rest der
App ist klein genug, dass sich eines nicht lohnt.

### Drei Dinge, die leicht kaputtgehen

**Die Textebene.** pdf.js zeichnet die Seite als Bild und legt für jeden
Textlauf ein durchsichtiges Element darüber. Die genaue Größe dieser Elemente
kommt aus CSS-Variablen, die pdf.js setzt (`--total-scale-factor`,
`--font-height`, `--scale-x`); die zugehörigen Regeln stehen in
`styles/app.css`. Fehlen sie, sitzt die unsichtbare Schrift nicht auf der
sichtbaren: Markierungen landen neben dem Satz, und der Texteditor bietet ein
Feld an, das nicht zur Zeile passt.

**Die Gestentrennung.** `ui/gestures.ts` hört auf dem Viewport in der
*Capture*-Phase, die Werkzeuge hören weiter unten am Ziel. Diese Reihenfolge ist
Absicht: nur so kann ein zweiter Finger den laufenden Strich abbrechen, bevor
die Werkzeugschicht dasselbe Ereignis sieht. Sie muss dann aber auch
stillhalten — dafür fragen `ui/overlay.ts` und `ui/text-drag.ts` vor jeder Geste
`gesturesBlocked()`. Fehlt diese Abfrage, fängt der zweite Finger sofort einen
neuen Strich an, während die Seite zoomt.

**Die Seitenplatzierung.** Marken werden in normalisierten Koordinaten der
*angezeigten* Seite gespeichert (0…1, Ursprung oben links). Eine PDF-Seite hat
ihren Ursprung unten links, misst in Punkten, kann eine CropBox mit Versatz und
einen `/Rotate`-Eintrag haben. `pdf/placement.ts` fasst das in eine einzige
Transformationsmatrix pro Seite; alle vier Drehungen sind dort mit Tests
festgenagelt, weil sich ein Fehler sonst erst auf der einen gedrehten Seite
eines Scans zeigt.

## Entwicklung

```bash
npm install          # einmalig
npm run dev          # Vite-Dev-Server auf Port 5190
npm run build        # nach dist/
npm test             # Vitest
npm run typecheck    # TypeScript ohne Ausgabe
npm run assets       # pdf.js-Daten kopieren und Icons erzeugen
```

`npm run assets` läuft vor `dev` und `build` automatisch. Es kopiert die
Laufzeitdaten von pdf.js — Standardschriften, CMaps für CJK, die WASM-Decoder
für JBIG2 und JPEG 2000 — nach `public/pdfjs/` und erzeugt die Icons aus
`public/icons/icon.svg`. Beides ist erzeugt und liegt nicht im Repository.

Folio nutzt bewusst den **Legacy-Build** von pdf.js: der normale Build von
pdf.js 6 setzt sehr neue Browser voraus (er ruft unter anderem
`Map.prototype.getOrInsertComputed`), und ein paar Monate altes Chrome ist auf
Android der Normalfall.

### Tests

`npm test` prüft die Teile, die Regeln haben und ohne Browser laufen:
Dateierkennung, Formatierung, Bibliothekssuche und -sortierung, Geometrie und
Strichvereinfachung, Seitenplatzierung für alle vier Drehungen, die Suche nach
der passenden Kompressionsstufe, WinAnsi-Faltung und Zeilenumbruch,
Seitenbereiche, Textverankerung, den Notizen-Export sowie die Pinch-Arithmetik
und die Werkzeuggruppen.

Die Oberfläche selbst — Rendern, Auswählen, Zeichnen, Exportieren — wird von
Hand im Browser geprüft; dafür gibt es keine Abhängigkeit im Repository.

## Grenzen

* Passwortgeschützte PDFs werden zum Lesen geöffnet, wenn das Passwort bekannt
  ist; gespeichert wird ohne Verschlüsselung.
* PDF-Formulare werden angezeigt, aber nicht ausgefüllt.
* Word-, Excel- und PowerPoint-Dateien erscheinen in der Bibliothek, lassen sich
  aber nicht öffnen — dafür bräuchte es einen zweiten Konverter in der App.
* EPUB wird mit Folios eigener Typografie dargestellt, nicht mit dem
  Stylesheet des Verlags. Das kostet Initialen und die eine oder andere
  Sonderanordnung und bringt dafür durchgängig einstellbare Schrift, verlässliche
  Textauswahl über Kapitel hinweg und keine fremden Stile in der Oberfläche.
* Ersatztext in PDFs verwendet Standardschriften und WinAnsi. Für westeuropäische
  Sprachen reicht das vollständig; griechische, kyrillische oder CJK-Zeichen
  werden ersetzt, und der Export sagt, welche.
