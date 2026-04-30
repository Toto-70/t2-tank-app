# Tank Tracker

Kleine, lokale Web-App zum Erfassen von Volltankvorgängen mit Meilentacho.

## Funktionen

- Erfassen von Datum, Meilenstand und getankten Litern pro Volltanken
- Optionaler Tour-Name wie `Reise Ostern 2026`
- Beim allerersten Eintrag ist nur der Tachostand erforderlich
- Automatische Umrechnung von Meilen nach Kilometern für die Verbrauchsberechnung
- Anzeige von letztem Verbrauch und Durchschnittsverbrauch in `l / 100 km`
- Berechnung der geschätzten Reichweite und des maximalen Meilenstands nach dem Tanken
- Fallback-Verbrauch von `15 l / 100 km` für die Reichweitenberechnung nach dem ersten Eintrag
- Lokale Speicherung im Browser via `localStorage`
- Offline-Nutzung als PWA
- Feste Annahme eines Tankvolumens von `55 l`
- Fester Tachokorrekturfaktor von `1,04` für die reale Strecke
- JSON-Export und JSON-Import für Datensicherung
- Sichtbare App-Version und Update-Hinweis in der Oberfläche
- Build-Version aus Datum und GitHub-Actions-Run-Nummer auf GitHub Pages

## Nutzung

1. Die Dateien lokal auf einem Webserver ausliefern, z. B. mit VS Code Live Server oder `python -m http.server`.
2. Auf dem iPhone in Safari öffnen.
3. Optional über `Teilen -> Zum Home-Bildschirm` als App ablegen.

## Deployment mit GitHub Pages

Das Projekt ist für GitHub Pages per GitHub Actions vorbereitet.

1. Auf GitHub ein neues Repository anlegen, z. B. `t2-tank-app`.
2. Dieses Projekt in das neue Repo pushen.
3. In GitHub unter `Settings -> Pages` als Quelle `GitHub Actions` auswählen.
4. Nach dem ersten Push baut GitHub die Seite automatisch.
5. Die App ist danach unter einer URL wie `https://Toto-70.github.io/t2-tank-app/` erreichbar.

Die App-Daten bleiben weiterhin lokal auf dem jeweiligen iPhone im Browser bzw. in der installierten PWA gespeichert.

## Wichtige Annahme

Die Reichweitenberechnung arbeitet fest mit einem Tankvolumen von `55 l`.

Solange erst ein Volltankvorgang gespeichert ist, verwendet die App dafür einen Fallback-Verbrauch von `15 l / 100 km`. Ab der zweiten Volltankung wird der echte Durchschnitt aus den gespeicherten Intervallen verwendet.

Der Tacho wird mit einem festen Korrekturfaktor von `1,04` behandelt. Das heißt: eine gemessene Meilendifferenz von `100 mi` entspricht real `104 mi`.

## Datenmodell

Der Verbrauch für ein Intervall wird aus diesen beiden Volltankungen berechnet:

- Vorheriger Volltank: nur Meilenstand
- Naechster Volltank: getankte Liter entsprechen dem Verbrauch der dazwischen gefahrenen Strecke

Das ist die übliche Methode für realistische Verbrauchswerte bei Fahrzeugen ohne direkte Kraftstoffmessung.
