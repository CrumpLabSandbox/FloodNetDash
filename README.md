# NYC Street Flood Explorer

A public-facing explorer for [FloodNet NYC](https://www.floodnet.nyc) street-flood sensor data. It shows where streets flood, how deep the water gets, how often, and what the City is doing about it.

- **Site:** `site/`, a static page (Leaflet + D3, no build step), deployed to GitHub Pages by `.github/workflows/pages.yml`.
- **Data pipeline:** `scripts/build_data.py`, Python standard library only. The workflow runs it on every push and weekly, so the site keeps itself up to date.

```bash
python3 scripts/build_data.py            # download everything fresh, rebuild site/data/
python3 scripts/build_data.py --offline  # rebuild from data/raw/ only
python3 -m http.server 8765 --directory site
```

## What's on the page

| Section | What it shows |
|---|---|
| How deep is "flooded"? | Every recorded flood on a to-scale depth ruler next to a person, with NWS driving-danger thresholds |
| Find floods near you | Map of all sensors. Search an address (NYC GeoSearch) or tap a sensor for its full history, deepest-flood curve, and nearby City projects |
| Flood calendar | Every day since 2020, colored by how many sensors flooded. Tap a day to replay it |
| Storm replay | Animated minute-by-minute replay of a storm from the sensors' own depth curves, alongside modeled hourly rain |
| Two kinds of flooding | Rain-driven vs. tidal floods by month and hour of day, and the share that happen on dry days |
| Rise & drain | Each flood's time-to-peak vs. time-to-drain. Tap a dot to see the flood's full shape |
| Neighborhoods | Sortable table of floods per sensor-year, which adjusts for how many sensors each area has |
| Sensors vs. 311 | Sensor-detected flood days compared with citywide 311 street-flooding calls |
| A growing network | Sensor count over time, and floods per active sensor, so growth isn't mistaken for worsening |
| City plans / What you can do | Sourced summaries of NYC flood programs and resident actions (`site/plans.js`) |

## Data sources and how to access them

### NYC Open Data (Socrata, no key needed)

| Dataset | ID | Notes |
|---|---|---|
| FloodNet: Street Flooding Events | [`aq7i-eu5q`](https://data.cityofnewyork.us/d/aq7i-eu5q) | One row per QC'd flood event. Includes the full depth time series (`flood_profile_depth_inches` / `flood_profile_time_secs`, JSON arrays). Times are GMT. Updated about every 2 weeks. |
| FloodNet: Sensor Deployment Metadata | [`kb2e-tjy3`](https://data.cityofnewyork.us/d/kb2e-tjy3) | Location, install/remove dates, `tidally_influenced`, NTA, council district, community board, and sensor height above the local low point |
| 311 Service Requests | [`erm2-nwe9`](https://data.cityofnewyork.us/d/erm2-nwe9) | Street-flooding calls. **In mid-2026 the categories were renamed** from `Sewer` / `Street Flooding (SJ)` etc. to `Sewer Maintenance` / `Flooding on Street`, `Catch Basin Clogged`, `Flooding on Highway`. The build script queries both. |
| 2020 NTA names | [`9nt8-h7nd`](https://data.cityofnewyork.us/d/9nt8-h7nd) | Neighborhood names for NTA codes |

Example SoQL query: `https://data.cityofnewyork.us/resource/aq7i-eu5q.json?$select=sensor_name,count(*)&$group=sensor_name&$order=count(*) DESC`

Attachments (saved in `data/docs/`): the FloodNet *Data Description* PDF (methods and citation) and the *Data Dictionary* xlsx.

### FloodNet raw per-minute readings (FieldKit API, public, no key)

The live dashboard at [dataviz.floodnet.nyc](https://dataviz.floodnet.nyc) runs on the FieldKit API. FloodNet is **project 174**. These endpoints answered without authentication in November 2026. They aren't officially documented as a public API, so use them gently.

```text
GET https://api.fieldkit.org/projects/174/stations           # all ~500 stations (name, borough, neighborhood, lat/lon, rain & tide gauge used)
GET https://api.fieldkit.org/meta/stations?stations=421       # module id + sensors for a station
GET https://api.fieldkit.org/sensors                          # sensor keys -> ids (wh.floodnet.depth = 44, tideFeet = 48, precip = 52/59, …)
GET https://api.fieldkit.org/sensors/data?start=<ms>&end=<ms>&stations=<id>&sensors=<moduleIdBase64>,<sensorId>&resolution=<n>
```

Example: station 421 (Q - 183rd St/90th Ave) depth on May 20, 2026:
`https://api.fieldkit.org/sensors/data?start=1779318000000&end=1779328800000&stations=421&sensors=eWVhcmx5X2ZyYW5rX211bGxldA%3D%3D,44&resolution=500`

FieldKit station IDs aren't the same as the Open Data `sensor_id`. Match them on sensor name or location.

### Other

- Rainfall: [Open-Meteo historical archive](https://open-meteo.com/en/docs/historical-weather-api) (ERA5 reanalysis, Central Park). It's modeled and coarse, so it can miss local cloudbursts.
- Address search: [NYC GeoSearch](https://geosearch.planninglabs.nyc/).
- Base map: Esri World Light/Dark Gray Canvas.

## Caveats

- A flood event is a run of readings deeper than 10 mm, QC'd by the FloodNet team. Each sensor measures one point on one street.
- "Rain-driven" vs. "tidal" uses each sensor's `tidally_influenced` flag. A tidal site can also flood from rain.
- Event counts grow with the network, so compare per-sensor rates rather than raw totals.
- City-plan statuses in `site/plans.js` were checked in November 2026 against official sources. Where sources disagree, the page gives a range.

## Citation

Mydlarz, C., et al. (2024). FloodNet: Low-cost ultrasonic sensors for real-time measurement of hyperlocal, street-level floods in New York City. *Water Resources Research*, 60, e2023WR036806. https://doi.org/10.1029/2023WR036806

Data: FloodNet (NYU & CUNY) with NYC DEP, MOCEJ, and OTI, via NYC Open Data. This project is not an official City or FloodNet product.
