# Tank Tracker

Kleine, lokale Web-App zum Erfassen von Volltankvorgaengen mit Meilentacho.

## Funktionen

- Erfassen von Datum, Meilenstand und getankten Litern pro Volltanken
- Beim allerersten Eintrag ist nur der Tachostand erforderlich
- Automatische Umrechnung von Meilen nach Kilometern fuer die Verbrauchsberechnung
- Anzeige von letztem Verbrauch und Durchschnittsverbrauch in `l / 100 km`
- Berechnung der geschaetzten Reichweite und des maximalen Meilenstands nach dem Tanken
- Lokale Speicherung im Browser via `localStorage`
- Offline-Nutzung als PWA
- Feste Annahme eines Tankvolumens von `55 l`
- Fester Tachokorrekturfaktor von `1,04` fuer die reale Strecke

## Nutzung

1. Die Dateien lokal auf einem Webserver ausliefern, z. B. mit VS Code Live Server oder `python -m http.server`.
2. Auf dem iPhone in Safari oeffnen.
3. Optional ueber `Teilen -> Zum Home-Bildschirm` als App ablegen.

## Deployment mit GitHub Pages

Das Projekt ist fuer GitHub Pages per GitHub Actions vorbereitet.

1. Auf GitHub ein neues Repository anlegen, z. B. `t2-tank-app`.
2. Dieses Projekt in das neue Repo pushen.
3. In GitHub unter `Settings -> Pages` als Quelle `GitHub Actions` auswaehlen.
4. Nach dem ersten Push baut GitHub die Seite automatisch.
5. Die App ist danach unter einer URL wie `https://Toto-70.github.io/t2-tank-app/` erreichbar.

Die App-Daten bleiben weiterhin lokal auf dem jeweiligen iPhone im Browser bzw. in der installierten PWA gespeichert.

## Wichtige Annahme

Die Reichweitenberechnung arbeitet fest mit einem Tankvolumen von `55 l`.

Der Tacho wird mit einem festen Korrekturfaktor von `1,04` behandelt. Das heisst: eine gemessene Meilendifferenz von `100 mi` entspricht real `104 mi`.

## Datenmodell

Der Verbrauch fuer ein Intervall wird aus diesen beiden Volltankungen berechnet:

- Vorheriger Volltank: nur Meilenstand
- Naechster Volltank: getankte Liter entsprechen dem Verbrauch der dazwischen gefahrenen Strecke

Das ist die uebliche Methode fuer realistische Verbrauchswerte bei Fahrzeugen ohne direkte Kraftstoffmessung.
