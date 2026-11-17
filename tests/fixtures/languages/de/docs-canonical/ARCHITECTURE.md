# Bestellungen: arquitetura

## Systemüberblick

Das System erfasst die Bestellungen eines kleinen Ladens. Es hängt nicht von externen Diensten ab und speichert alles in lokalen Dateien. Jede Bestellung hat einen Namen und einen Betrag. Wenn die Person die Bestellung bestätigt, schreibt das Hauptmodul eine Zeile in die Datei und gibt dieselbe Bestellung als erfasst zurück. Das Team prüft die Datei einmal pro Woche und archiviert alte Bestellungen. Alle diese Schritte lassen sich leicht testen, weil jeder nur von lokalen Daten und kleinen Funktionen abhängt.

## Komponentenübersicht

Das Hauptmodul liegt in `src/index.js`. Die Eingabeschicht greift nicht direkt auf die Festplatte zu.

## Technologie-Stack

Das Projekt verwendet Node.js 20 und den eingebauten Testläufer.
