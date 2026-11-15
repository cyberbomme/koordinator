# Koordinator

Geo-Koordinaten live umrechnen – direkt im Browser: **https://cyberbomme.github.io/koordinator/**

Tippe in irgendein Feld, alle anderen Formate passen sich sofort an. Jedes Format lässt sich per Knopfdruck kopieren.

## Formate

| Standard | Erweitert (in den Einstellungen zuschaltbar) |
|---|---|
| WGS84 Dezimalgrad – `52.516275, 13.377704` | UTM (WGS84/ETRS89) – `33U 389918 5819699` |
| WGS84 Grad/Min/Sek – `52°30'58.59"N 13°22'39.73"E` | MGRS / UTMREF – `33U UU 89918 19699` |
| WGS84 Grad/Dezimalminuten – `N 52° 30.977' E 013° 22.662'` | Gauß-Krüger (DHDN) – `R 4593627 H 5821242` |
| Plus Code – `9F4MG98H+G38` (auch Kurzcodes) | Geohash – `u33db2m37` |
| | Maidenhead-Locator – `JO62qm` |

Die drei Winkel-Felder akzeptieren jede gängige Schreibweise (Dezimalkomma, Präfix/Suffix-Himmelsrichtung, `O` für Ost …).

## Funktionen

- Live-Umrechnung zwischen allen Formaten, Kopieren-Button pro Format
- Karte (OpenStreetMap/Leaflet): Klicken oder Marker ziehen setzt die Position
- „Mein Standort“ über die Browser-Geolocation
- Teilen-Link (`?c=lat,lon`), Öffnen in Google Maps / OpenStreetMap / Apple Maps
- Deutsch / Englisch, helles / dunkles Design
- Läuft komplett lokal, keine Daten verlassen den Browser (außer Kartenkacheln)

## Hinweise zur Genauigkeit

- Gauß-Krüger nutzt eine 7-Parameter-Helmert-Transformation (DHDN → WGS84), Genauigkeit ca. 1–3 m.
- MGRS wird – wie üblich – abgeschnitten, nicht gerundet (Abweichung zum UTM-Wert ≤ 1 m).

## Technik

Statische Seite ohne Build-Schritt. Bibliotheken liegen in `vendor/`:
[proj4js](https://github.com/proj4js/proj4js) 2.11.0, [mgrs](https://github.com/proj4js/mgrs) 2.1.0, [Leaflet](https://leafletjs.com) 1.9.4.
Plus Code, Geohash und Maidenhead sind in [`js/convert.js`](js/convert.js) selbst implementiert.

Lokal starten: `python3 -m http.server` im Repo-Ordner, dann http://localhost:8000 öffnen.
