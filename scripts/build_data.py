#!/usr/bin/env python3
"""Fetch FloodNet + related NYC open data and build compact JSON for the site.

Standard library only, so it runs unchanged in GitHub Actions.

Sources
  - FloodNet flood events        NYC Open Data aq7i-eu5q
  - FloodNet sensor metadata     NYC Open Data kb2e-tjy3
  - 2020 NTA names               NYC Open Data 9nt8-h7nd
  - 311 street-flooding requests NYC Open Data erm2-nwe9 (daily counts by borough)
  - Daily rainfall, Central Park Open-Meteo historical archive (ERA5 reanalysis)

Usage: python3 scripts/build_data.py [--offline]
  --offline  rebuild site data from data/raw/*.json without re-downloading
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "site", "data")
SODA = "https://data.cityofnewyork.us/resource/{}.json"
START = "2020-11-01"
STEP_MIN = 3  # resample flood profiles to this many minutes


def get_json(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "floodnet-dash-build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def soda(dataset, **params):
    """Page through a SODA endpoint and return all rows."""
    rows, offset, limit = [], 0, 50000
    while True:
        q = dict(params, **{"$limit": limit, "$offset": offset})
        q.setdefault("$order", ":id")
        page = get_json(SODA.format(dataset) + "?" + urllib.parse.urlencode(q))
        rows += page
        if len(page) < limit:
            return rows
        offset += limit


def save(path, obj, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"))
        else:
            json.dump(obj, f, indent=1)


def load(path):
    with open(path) as f:
        return json.load(f)


def fetch_all():
    print("fetching flood events…")
    save(os.path.join(RAW, "flood_events.json"), soda("aq7i-eu5q"))
    print("fetching sensor metadata…")
    save(os.path.join(RAW, "sensors.json"), soda("kb2e-tjy3"))
    print("fetching NTA names…")
    save(os.path.join(RAW, "nta_names.json"),
         soda("9nt8-h7nd", **{"$select": "nta2020,ntaname,boroname", "$order": "nta2020"}))
    print("fetching 311 street-flooding daily counts…")
    # 311 renamed these categories in mid-2026 ("Sewer" -> "Sewer Maintenance"); include both.
    where = ("((complaint_type='Sewer' AND descriptor in('Street Flooding (SJ)',"
             "'Catch Basin Clogged/Flooding (Use Comments) (SC)','Highway Flooding (SH)'))"
             " OR (complaint_type='Sewer Maintenance' AND descriptor in('Flooding on Street',"
             "'Catch Basin Clogged','Flooding on Highway')))"
             f" AND created_date >= '{START}T00:00:00'")
    save(os.path.join(RAW, "311_flooding_daily.json"), soda("erm2-nwe9", **{
        "$select": "date_trunc_ymd(created_date) as d, borough, count(*) as n",
        "$where": where, "$group": "d, borough", "$order": "d"}))
    print("fetching Central Park daily rainfall…")
    end = (dt.date.today() - dt.timedelta(days=6)).isoformat()
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude=40.7789&longitude=-73.9692"
           f"&start_date={START}&end_date={end}&daily=precipitation_sum,precipitation_hours"
           "&hourly=precipitation&precipitation_unit=inch&timezone=America%2FNew_York")
    save(os.path.join(RAW, "rain_centralpark.json"), get_json(url))


def parse_ts(s):
    # SODA floating timestamps; FloodNet event times are GMT
    return dt.datetime.fromisoformat(s.replace("Z", "")).replace(tzinfo=dt.timezone.utc)


def num(x, nd=2):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if math.isfinite(v) else None


def resample(times, depths, step_s):
    """Max depth within each step_s bucket, starting at t=0."""
    if not times:
        return []
    n = int(times[-1] // step_s) + 1
    out = [0.0] * n
    for t, d in zip(times, depths):
        i = int(t // step_s)
        if d > out[i]:
            out[i] = d
    return [round(v, 1) for v in out]


def build():
    events = load(os.path.join(RAW, "flood_events.json"))
    sensors = load(os.path.join(RAW, "sensors.json"))
    nta = {r["nta2020"]: r["ntaname"] for r in load(os.path.join(RAW, "nta_names.json"))}
    now = dt.datetime.now(dt.timezone.utc)

    # --- sensors
    sensors.sort(key=lambda s: s["sensor_id"])
    sidx = {s["sensor_id"]: i for i, s in enumerate(sensors)}
    s_out = []
    for s in sensors:
        s_out.append({
            "id": s["sensor_id"],
            "name": s.get("sensor_name", ""),
            "street": s.get("street_name", ""),
            "boro": s.get("borough", ""),
            "zip": s.get("zipcode", ""),
            "nta": s.get("nta", ""),
            "ntaName": nta.get(s.get("nta", ""), ""),
            "cd": s.get("council_district", ""),
            "cb": s.get("community_board", ""),
            "lat": num(s.get("latitude"), 6),
            "lon": num(s.get("longitude"), 6),
            "tidal": s.get("tidally_influenced") == "Yes",
            "installed": (s.get("date_installed") or "")[:10],
            "removed": (s.get("date_removed") or "")[:10],
            "lowPt": num(s.get("lowest_point_height_delta_inches")),
        })

    # --- events
    ev_out, profiles, skipped = [], {}, 0
    for e in events:
        i = sidx.get(e.get("sensor_id"))
        if i is None or not e.get("flood_start_time"):
            skipped += 1
            continue
        t0 = parse_ts(e["flood_start_time"])
        row = [
            i,
            int(t0.timestamp() // 60),                      # start, epoch minutes (UTC)
            num(e.get("max_depth_inches")),
            num(e.get("duration_mins"), 1),
            num(e.get("onset_time_mins"), 1),
            num(e.get("drain_time_mins"), 1),
            num(e.get("duration_above_4_inches_mins"), 1),
            num(e.get("duration_above_12_inches_mins"), 1),
            num(e.get("duration_above_24_inches_mins"), 1),
        ]
        k = len(ev_out)
        ev_out.append(row)
        try:
            d = json.loads(e.get("flood_profile_depth_inches") or "[]")
            t = json.loads(e.get("flood_profile_time_secs") or "[]")
            if d and len(d) == len(t):
                profiles[k] = resample([float(x) for x in t], [float(x) for x in d], STEP_MIN * 60)
        except (ValueError, TypeError):
            pass
    order = sorted(range(len(ev_out)), key=lambda k: ev_out[k][1])
    ev_sorted = [ev_out[k] for k in order]
    prof_sorted = [profiles.get(k, []) for k in order]

    # per-sensor stats
    for s in s_out:
        s["n"], s["maxDepth"], s["last"] = 0, 0, None
    for r in ev_sorted:
        s = s_out[r[0]]
        s["n"] += 1
        s["maxDepth"] = max(s["maxDepth"], r[2] or 0)
        s["last"] = r[1]

    # --- 311 daily
    c311 = {}
    for r in load(os.path.join(RAW, "311_flooding_daily.json")):
        d = r["d"][:10]
        c311.setdefault(d, {})[r.get("borough", "Unspecified").title()] = int(r["n"])

    # --- rain (Central Park): daily total + max hourly intensity
    rain, rain_hourly = {}, {}
    rp = os.path.join(RAW, "rain_centralpark.json")
    if os.path.exists(rp):
        rj = load(rp)
        daily = rj.get("daily", {})
        for day, tot in zip(daily.get("time", []), daily.get("precipitation_sum", [])):
            if tot is not None:
                rain[day] = [round(tot, 2), 0.0]
        hourly = rj.get("hourly", {})
        for ts, p in zip(hourly.get("time", []), hourly.get("precipitation", [])):
            day, hr = ts[:10], int(ts[11:13])
            if p is None or day not in rain:
                continue
            if p > rain[day][1]:
                rain[day][1] = round(p, 2)
            if rain[day][0] >= 0.05:
                rain_hourly.setdefault(day, [0.0] * 24)[hr] = round(p, 2)

    meta = {
        "built": now.isoformat(timespec="seconds"),
        "nEvents": len(ev_sorted), "nSensors": len(s_out), "skipped": skipped,
        "eventCols": ["sensor", "startMin", "maxDepth", "duration", "onset", "drain",
                      "dur4", "dur12", "dur24"],
        "profileStepMin": STEP_MIN,
        "sources": {
            "events": "https://data.cityofnewyork.us/d/aq7i-eu5q",
            "sensors": "https://data.cityofnewyork.us/d/kb2e-tjy3",
            "311": "https://data.cityofnewyork.us/d/erm2-nwe9",
            "rain": "https://open-meteo.com/en/docs/historical-weather-api",
        },
    }
    save(os.path.join(OUT, "floodnet.json"), {
        "meta": meta, "sensors": s_out, "events": ev_sorted})
    save(os.path.join(OUT, "profiles.json"), prof_sorted)
    save(os.path.join(OUT, "context.json"), {"c311": c311, "rain": rain, "rainHourly": rain_hourly})
    for f in ("floodnet.json", "profiles.json", "context.json"):
        p = os.path.join(OUT, f)
        print(f"  {f}: {os.path.getsize(p)/1e6:.2f} MB")
    print(f"built {len(ev_sorted)} events, {len(s_out)} sensors, skipped {skipped}")


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        fetch_all()
    build()
