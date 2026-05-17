import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.9.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const mapboxgl = maplibregl;
const BOSTON_BIKE_LANES =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_BIKE_LANES =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const statusElement = document.querySelector('#status');
const timeSlider = document.querySelector('#time-slider');
const selectedTime = document.querySelector('#selected-time');
const anyTimeLabel = document.querySelector('#any-time-label');
const tooltip = document.querySelector('#station-tooltip');
const tooltipName = document.querySelector('#tooltip-name');
const tooltipTotal = document.querySelector('#tooltip-total');
const tooltipDepartures = document.querySelector('#tooltip-departures');
const tooltipArrivals = document.querySelector('#tooltip-arrivals');
const tooltipFlow = document.querySelector('#tooltip-flow');

const svg = d3.select('#map svg');
const comma = d3.format(',');
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);

let baseStations = [];
let totalTripCount = 0;
let allStationTraffic = null;
let updateFrame = null;
let circles;
let radiusScale = d3.scaleSqrt().domain([0, 1]).range([0, 28]);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 10,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

function setStatus(message) {
  statusElement.textContent = message;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(mins).padStart(2, '0')} ${period}`;
}

function rollupStationCounts(tripsByMinute, minute, stationKey) {
  const counts = new Map();

  function countTrip(trip) {
    const id = trip[stationKey];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  if (minute === -1) {
    for (const bucket of tripsByMinute) {
      for (const trip of bucket) {
        countTrip(trip);
      }
    }
    return counts;
  }

  for (let offset = -60; offset <= 60; offset += 1) {
    const bucketIndex = (minute + offset + 1440) % 1440;
    for (const trip of tripsByMinute[bucketIndex]) {
      countTrip(trip);
    }
  }

  return counts;
}

function computeStationTraffic(stations, timeFilter = -1) {
  if (timeFilter === -1 && allStationTraffic) {
    return allStationTraffic;
  }

  const departures = rollupStationCounts(departuresByMinute, timeFilter, 'start_station_id');
  const arrivals = rollupStationCounts(arrivalsByMinute, timeFilter, 'end_station_id');

  const stationsWithTraffic = stations.map((station) => {
    const id = station.short_name;
    const departureCount = departures.get(id) ?? 0;
    const arrivalCount = arrivals.get(id) ?? 0;

    return {
      ...station,
      departures: departureCount,
      arrivals: arrivalCount,
      totalTraffic: departureCount + arrivalCount,
    };
  });

  if (timeFilter === -1) {
    allStationTraffic = stationsWithTraffic;
  }

  return stationsWithTraffic;
}

function getCoords(station) {
  const point = map.project([Number(station.lon), Number(station.lat)]);
  return { cx: point.x, cy: point.y };
}

function updatePositions() {
  if (!circles) return;

  circles
    .attr('cx', (station) => getCoords(station).cx)
    .attr('cy', (station) => getCoords(station).cy);
}

function updateTooltipContent(station) {
  const departureRatio = station.totalTraffic ? station.departures / station.totalTraffic : 0.5;
  const flow =
    departureRatio > 0.55
      ? 'More departures'
      : departureRatio < 0.45
        ? 'More arrivals'
        : 'Balanced';

  tooltipName.textContent = station.name;
  tooltipTotal.textContent = comma(station.totalTraffic);
  tooltipDepartures.textContent = comma(station.departures);
  tooltipArrivals.textContent = comma(station.arrivals);
  tooltipFlow.textContent = flow;
}

function updateTooltipPosition(event) {
  tooltip.style.left = `${event.clientX + 14}px`;
  tooltip.style.top = `${event.clientY + 14}px`;
}

function updateCircles(timeFilter = -1) {
  const stations = computeStationTraffic(baseStations, timeFilter);
  const maxTraffic = d3.max(stations, (station) => station.totalTraffic) || 1;

  radiusScale = d3
    .scaleSqrt()
    .domain([0, maxTraffic])
    .range(timeFilter === -1 ? [0, 28] : [3, 48]);

  circles = svg
    .selectAll('circle')
    .data(stations, (station) => station.short_name)
    .join(
      (enter) =>
        enter
          .append('circle')
          .attr('r', 0)
          .on('mouseenter', (event, station) => {
            updateTooltipContent(station);
            updateTooltipPosition(event);
            tooltip.hidden = false;
          })
          .on('mousemove', updateTooltipPosition)
          .on('mouseleave', () => {
            tooltip.hidden = true;
          }),
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr('r', (station) => radiusScale(station.totalTraffic))
    .style('--departure-ratio', (station) => {
      if (!station.totalTraffic) return 0.5;
      return stationFlow(station.departures / station.totalTraffic);
    });

  updatePositions();
}

function queueCircleUpdate(timeFilter) {
  if (updateFrame !== null) {
    cancelAnimationFrame(updateFrame);
  }

  updateFrame = requestAnimationFrame(() => {
    updateCircles(timeFilter);
    updateFrame = null;
  });
}

function updateTimeDisplay({ immediate = false } = {}) {
  const timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.hidden = false;
    setStatus(`${comma(baseStations.length)} stations, ${comma(totalTripCount)} trips`);
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.hidden = true;
    setStatus(`${comma(baseStations.length)} stations, +/- 1 hour around ${formatTime(timeFilter)}`);
  }

  if (immediate) {
    updateCircles(timeFilter);
  } else {
    queueCircleUpdate(timeFilter);
  }
}

function addBikeLaneLayer(sourceId, layerId, data, color) {
  map.addSource(sourceId, {
    type: 'geojson',
    data,
  });

  map.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 4.8],
      'line-opacity': 0.58,
    },
  });
}

async function loadTrips() {
  const trips = await d3.csv(TRIPS_URL, (trip) => {
    const startedAt = new Date(trip.started_at);
    const endedAt = new Date(trip.ended_at);
    const parsedTrip = {
      ...trip,
      started_at: startedAt,
      ended_at: endedAt,
    };

    departuresByMinute[minutesSinceMidnight(startedAt)].push(parsedTrip);
    arrivalsByMinute[minutesSinceMidnight(endedAt)].push(parsedTrip);
    return parsedTrip;
  });

  return trips;
}

map.on('load', async () => {
  try {
    setStatus('Loading bike lanes...');
    addBikeLaneLayer('boston-bike-lanes', 'boston-bike-lanes-line', BOSTON_BIKE_LANES, '#16a34a');
    addBikeLaneLayer('cambridge-bike-lanes', 'cambridge-bike-lanes-line', CAMBRIDGE_BIKE_LANES, '#22c55e');

    setStatus('Loading stations and trips...');
    const [stationsJson, trips] = await Promise.all([d3.json(STATIONS_URL), loadTrips()]);
    totalTripCount = trips.length;

    baseStations = stationsJson.data.stations.filter(
      (station) => Number.isFinite(Number(station.lon)) && Number.isFinite(Number(station.lat)),
    );

    timeSlider.disabled = false;
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay({ immediate: true });

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
  } catch (error) {
    console.error(error);
    setStatus('Could not load bike data. Check the console for details.');
  }
});
