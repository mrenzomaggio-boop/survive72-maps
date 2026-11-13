# survive72-maps

Offline map areas for the SURVIVE 72 app.

The workflow `Build offline map areas` cuts each area listed in `regions.json`
out of the latest [Protomaps](https://protomaps.com) world build and publishes
it on the `maps` release. The app downloads
`https://github.com/mrenzomaggio-boop/survive72-maps/releases/download/maps/<id>.pmtiles`.

`regions.json` (all countries of the world from Natural Earth, big countries also split into states/regions) is a copy of `ios/SURVIVE72/MapStyle/regions.json` in the app
repository: change both together.

It runs on the 5th of every month and can be started by hand from the Actions
tab, optionally for a few area ids only.

## Licence

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
available under the Open Database License (ODbL). Tiles built with Protomaps.
