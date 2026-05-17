# Bikewatching Boston

DSC 106 Lab 7 standalone website for exploring Bluebike traffic across Boston
and Cambridge.

## What It Shows

- Interactive Boston/Cambridge map.
- Boston and Cambridge bike lane GeoJSON layers.
- Bluebike station SVG markers positioned with the map projection.
- Marker area scaled by total station traffic.
- Tooltip with station name, total trips, departures, arrivals, and flow.
- Time slider that filters trips to a one-hour window around the selected time.
- Direction legend for more departures, balanced flow, and more arrivals.

## Local Preview

```bash
python3 -m http.server 8001
```

Open `http://localhost:8001/`.

## Video Checklist

For the one-minute lab video, show the map, pan or zoom once, hover a station to
show exact traffic numbers, drag the time slider, point out the changing marker
sizes/colors, and mention that the most interesting finding is how the downtown
station flow changes by time of day.
