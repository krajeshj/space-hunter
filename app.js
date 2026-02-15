/* ────────────────────────────────────────────
   ISS Hunter — app.js (Restructured)
   Hero viewer + unified event list + live/sim
   ──────────────────────────────────────────── */

(() => {
  'use strict';

  // ── CONSTANTS ────────────────────────────
  let OBSERVER = { lat: 37.3861, lon: -122.0839, alt: 0.04 };
  const ISS_ID = 25544;
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;
  const BORTLE = { class: 7, label: 'Suburban Sky', desc: 'Milky Way invisible. Satellites like the ISS (mag −3) still visible when sunlit.' };

  // Trajectory colors
  const COLOR_SIM = '#00bcd4';   // cyan — simulated preview
  const COLOR_LIVE = '#00e676';  // green — live/real-time

  // API URLs
  const WTIA_POS = `https://api.wheretheiss.at/v1/satellites/${ISS_ID}`;
  const WTIA_TLE = `https://api.wheretheiss.at/v1/satellites/${ISS_ID}/tles`;
  const VC_BASE = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline';

  // ── STATE ────────────────────────────────
  const state = {
    vcApiKey: localStorage.getItem('vc_api_key') || '',
    issPos: null,
    tle: null,
    satrec: null,
    passes: [],
    sortedEvents: [],
    cloudCover: null,
    heading: 0,
    issAz: 0,
    issEl: -90,
    beeping: false,
    simulating: false,
    audioCtx: null,
    activeFilter: 'all',
    sortMode: 'date',
    livePassIndex: -1,
  };

  // ── DOM REFS ─────────────────────────────
  const $ = id => document.getElementById(id);
  const dom = {
    modal: $('api-modal'),
    keyInput: $('api-key-input'),
    btnSave: $('btn-save-key'),
    btnSkip: $('btn-skip-key'),
    clock: $('clock'),
    // Location
    locBadge: $('location-badge'),
    btnDetect: $('btn-detect'),
    locStatus: $('loc-status'),
    inputLat: $('input-lat'),
    inputLon: $('input-lon'),
    inputZip: $('input-zip'),
    btnSetLoc: $('btn-set-loc'),
    btnSetZip: $('btn-set-zip'),
    // Stats bar
    issLat: $('iss-lat'),
    issLon: $('iss-lon'),
    issAlt: $('iss-alt'),
    issVel: $('iss-vel'),
    issVis: $('iss-vis'),
    issRange: $('iss-range'),
    cloudCover: $('cloud-cover'),
    cloudIcon: $('cloud-icon'),
    lightPoll: $('light-pollution'),
    overallVis: $('overall-vis'),
    visIcon: $('vis-icon'),
    overallCard: $('overall-vis-card'),
    // Event list
    eventList: $('event-list'),
    // Radar
    issBlip: $('iss-blip'),
    issAzEl: $('iss-az'),
    issElEl: $('iss-el'),
    userHeading: $('user-heading'),
    btnBeep: $('btn-beep'),
    btnSimulate: $('btn-simulate'),
    starmapSlider: $('starmap-slider'),
    starmapVal: $('starmap-val'),
    skyHint: $('sky-hint'),
    launchPano: $('launch-pano'),
    arrow3d: $('arrow-3d'),
    arrowAz: $('arrow-az'),
    arrowEl: $('arrow-el'),
    // Stats bars
    statsBarIss: $('stats-bar-iss'),
    statsBarLaunch: $('stats-bar-launch'),
    // Launch stats
    launchMission: $('launch-mission'),
    launchCountdown: $('launch-countdown'),
    launchPad: $('launch-pad'),
    launchOrbit: $('launch-orbit'),
    launchStatus: $('launch-status'),
    launchDistance: $('launch-distance'),
    launchVelocity: $('launch-velocity'),
    // Launch direction
    launchDirContainer: $('launch-direction'),
    launchDirArrow: $('launch-dir-arrow'),
    launchDirText: $('launch-dir-text'),
  };

  // ── UTILITIES ────────────────────────────
  function fmtCoord(v, pos, neg) {
    const dir = v >= 0 ? pos : neg;
    return `${Math.abs(v).toFixed(4)}° ${dir}`;
  }
  function fmtNum(v, d = 1) { return v != null ? v.toFixed(d) : '—'; }
  function fmtTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function fmtDate(date) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtShortCoord(v) { return v.toFixed(2); }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function slantRange(obsLat, obsLon, obsAlt, issLat, issLon, issAlt) {
    const R = 6371;
    const toCart = (lat, lon, alt) => {
      const r = R + alt;
      return [
        r * Math.cos(lat * RAD) * Math.cos(lon * RAD),
        r * Math.cos(lat * RAD) * Math.sin(lon * RAD),
        r * Math.sin(lat * RAD),
      ];
    };
    const o = toCart(obsLat, obsLon, obsAlt);
    const s = toCart(issLat, issLon, issAlt);
    return Math.sqrt((s[0] - o[0]) ** 2 + (s[1] - o[1]) ** 2 + (s[2] - o[2]) ** 2);
  }

  // ── SUN ALTITUDE (for twilight filter) ──
  // Returns the sun's altitude in degrees at a given date for an observer.
  // Negative = below horizon.  < -6° = civil twilight or darker.
  function sunAltitude(date, lat, lon) {
    const JD = date.getTime() / 86400000 + 2440587.5;
    const n = JD - 2451545.0;                       // days since J2000
    const L = (280.460 + 0.9856474 * n) % 360;      // mean longitude
    const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // ecliptic lon
    const eps = 23.439 * RAD;                         // obliquity
    const sinDec = Math.sin(eps) * Math.sin(lambda);
    const dec = Math.asin(sinDec);

    // Greenwich Mean Sidereal Time (hours)
    const GMST = (18.697374558 + 24.06570982441908 * n) % 24;
    const LST = GMST + lon / 15;                    // local sidereal time (hours)
    // Right ascension
    const RA = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const HA = (LST * 15 * RAD) - RA;                // hour angle

    const latR = lat * RAD;
    const sinAlt = Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(HA);
    return Math.asin(sinAlt) * DEG;
  }

  // Returns true if the sun is below -6° (civil twilight or darker)
  function isTwilightOrNight(date) {
    return sunAltitude(date, OBSERVER.lat, OBSERVER.lon) < -6;
  }

  // ── CLOCK ────────────────────────────────
  function tickClock() {
    dom.clock.textContent = fmtTime(new Date());
  }

  // ══════════════════════════════════════════
  //  LOCATION MANAGER
  // ══════════════════════════════════════════
  const LocationManager = {
    autoDetect() {
      if (!navigator.geolocation) {
        this.setStatus('Geolocation not supported by this browser', 'error');
        return;
      }
      this.setStatus('Detecting…', '');
      dom.btnDetect.disabled = true;

      navigator.geolocation.getCurrentPosition(
        pos => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const alt = (pos.coords.altitude || 0) / 1000;
          this.applyLocation(lat, lon, alt);
          this.setStatus(`Detected: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'success');
          dom.inputLat.value = lat.toFixed(4);
          dom.inputLon.value = lon.toFixed(4);
          dom.btnDetect.disabled = false;
          this.reverseGeocode(lat, lon);
        },
        err => {
          const msgs = { 1: 'Permission denied — use manual entry', 2: 'Position unavailable', 3: 'Timed out' };
          this.setStatus(msgs[err.code] || 'Detection failed', 'error');
          dom.btnDetect.disabled = false;
          dom.locBadge.textContent = '📍 Sunnyvale, CA (default)';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },

    setManual() {
      const lat = parseFloat(dom.inputLat.value);
      const lon = parseFloat(dom.inputLon.value);
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        this.setStatus('Invalid coordinates', 'error');
        return;
      }
      this.applyLocation(lat, lon, 0.04);
      this.setStatus(`Set: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'success');
      this.reverseGeocode(lat, lon);
    },

    async setFromZip() {
      const zip = (dom.inputZip.value || '').trim();
      if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
        this.setStatus('Enter a valid US ZIP code (e.g. 94087)', 'error');
        return;
      }
      this.setStatus('Looking up ZIP…', '');
      try {
        const r = await fetch(`https://api.zippopotam.us/us/${zip.substring(0, 5)}`);
        if (!r.ok) throw new Error('ZIP not found');
        const d = await r.json();
        const place = d.places?.[0];
        if (!place) throw new Error('No results');
        const lat = parseFloat(place.latitude);
        const lon = parseFloat(place.longitude);
        const city = `${place['place name']}, ${place['state abbreviation']}`;
        this.applyLocation(lat, lon, 0.04);
        dom.inputLat.value = lat.toFixed(4);
        dom.inputLon.value = lon.toFixed(4);
        dom.locBadge.textContent = `📍 ${city}`;
        this.setStatus(`Found: ${city} (${lat.toFixed(4)}, ${lon.toFixed(4)})`, 'success');
      } catch (e) {
        this.setStatus('ZIP code not found — try coordinates instead', 'error');
      }
    },

    applyLocation(lat, lon, alt) {
      OBSERVER = { lat, lon, alt: alt || 0.04 };
      localStorage.setItem('observer_loc', JSON.stringify(OBSERVER));

      // Re-compute everything
      PassPredictor.init();
      WeatherChecker.fetch();

      if (typeof LaunchTracker !== 'undefined') {
        LaunchTracker.setObserver(lat, lon);
        LaunchTracker.refresh(null, dom.launchPano);
      }
    },

    async reverseGeocode(lat, lon) {
      try {
        const r = await fetch(`https://api.wheretheiss.at/v1/coordinates/${lat},${lon}`);
        if (r.ok) {
          const d = await r.json();
          const tz = d.timezone_id || '';
          const parts = tz.split('/');
          const city = parts[parts.length - 1].replace(/_/g, ' ');
          dom.locBadge.textContent = `📍 ${city} (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
          return;
        }
      } catch (e) { /* fall through */ }
      dom.locBadge.textContent = `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    },

    setStatus(msg, cls) {
      dom.locStatus.textContent = msg;
      dom.locStatus.className = 'loc-status' + (cls ? ` ${cls}` : '');
    },

    init() {
      const saved = localStorage.getItem('observer_loc');
      if (saved) {
        try {
          const loc = JSON.parse(saved);
          OBSERVER = loc;
          dom.inputLat.value = loc.lat.toFixed(4);
          dom.inputLon.value = loc.lon.toFixed(4);
          this.setStatus(`Saved: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`, 'success');
          this.reverseGeocode(loc.lat, loc.lon);
          return;
        } catch (e) { /* fall through */ }
      }
      this.autoDetect();
    }
  };

  // ══════════════════════════════════════════
  //  ISS TRACKER (live position)
  // ══════════════════════════════════════════
  const ISSTracker = {
    interval: null,
    async fetch() {
      try {
        const r = await fetch(WTIA_POS);
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        state.issPos = d;
        this.updateUI(d);
      } catch (e) {
        console.warn('ISS position fetch failed:', e);
      }
    },
    updateUI(d) {
      dom.issLat.textContent = fmtShortCoord(d.latitude) + '°';
      dom.issLon.textContent = fmtShortCoord(d.longitude) + '°';
      dom.issAlt.textContent = fmtNum(d.altitude, 0);
      dom.issVel.textContent = fmtNum(d.velocity, 0);
      dom.issVis.textContent = d.visibility.charAt(0).toUpperCase() + d.visibility.slice(1);

      const range = slantRange(OBSERVER.lat, OBSERVER.lon, OBSERVER.alt, d.latitude, d.longitude, d.altitude);
      dom.issRange.textContent = fmtNum(range, 0);

      this.computeLookAngles(d);
    },
    computeLookAngles(d) {
      const dLat = (d.latitude - OBSERVER.lat) * RAD;
      const dLon = (d.longitude - OBSERVER.lon) * RAD;
      const obsLatR = OBSERVER.lat * RAD;

      const y = Math.sin(dLon) * Math.cos(d.latitude * RAD);
      const x = Math.cos(obsLatR) * Math.sin(d.latitude * RAD) - Math.sin(obsLatR) * Math.cos(d.latitude * RAD) * Math.cos(dLon);
      let az = Math.atan2(y, x) * DEG;
      if (az < 0) az += 360;

      const groundDist = haversine(OBSERVER.lat, OBSERVER.lon, d.latitude, d.longitude);
      const altDiff = d.altitude - OBSERVER.alt;
      const el = Math.atan2(altDiff, groundDist) * DEG;

      if (!state.simulating) {
        state.issAz = az;
        state.issEl = el;

        dom.issAzEl.textContent = `${az.toFixed(1)}°`;
        dom.issElEl.textContent = `${el.toFixed(1)}°`;
        dom.arrowAz.textContent = `${az.toFixed(1)}°`;
        dom.arrowEl.textContent = `${el.toFixed(1)}°`;

        CompassArrow.update();
        RadarBlip.update(az, el);

        if (typeof StarMap !== 'undefined') {
          StarMap.render(new Date(), OBSERVER.lat, OBSERVER.lon, state.heading);
          const hint = StarMap.getLandmarkHint(az, el);
          dom.skyHint.textContent = el > 0 ? `🌟 ISS visible — ${hint}` : hint;
        }
      }
    },
    start() {
      this.fetch();
      this.interval = setInterval(() => this.fetch(), 5000);
    }
  };

  // ══════════════════════════════════════════
  //  PASS PREDICTOR (satellite.js)
  // ══════════════════════════════════════════
  const PassPredictor = {
    async init() {
      try {
        const r = await fetch(WTIA_TLE);
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        state.tle = d;
        state.satrec = satellite.twoline2satrec(d.line1, d.line2);
        this.predict();
      } catch (e) {
        console.error('TLE fetch failed:', e);
        dom.eventList.innerHTML = `<div class="pass-loading glass-card"><span>⚠️ Could not load TLE data. Retrying…</span></div>`;
        setTimeout(() => this.init(), 10000);
      }
    },

    lookAngles(date) {
      const gmst = satellite.gstime(date);
      const posVel = satellite.propagate(state.satrec, date);
      if (!posVel.position) return null;

      const posEci = posVel.position;
      const observerGd = {
        longitude: OBSERVER.lon * RAD,
        latitude: OBSERVER.lat * RAD,
        height: OBSERVER.alt
      };
      const posEcf = satellite.eciToEcf(posEci, gmst);
      const lookAnglesResult = satellite.ecfToLookAngles(observerGd, posEcf);

      return {
        az: lookAnglesResult.azimuth * DEG,
        el: lookAnglesResult.elevation * DEG,
        range: lookAnglesResult.rangeSat
      };
    },

    predict() {
      const passes = [];
      const now = new Date();
      const end = new Date(now.getTime() + 5 * 24 * 3600 * 1000);
      const step = 30 * 1000;
      const minEl = 10;

      let inPass = false;
      let currentPass = null;

      for (let t = now.getTime(); t < end.getTime(); t += step) {
        const date = new Date(t);
        const la = this.lookAngles(date);
        if (!la) continue;

        if (la.el >= minEl) {
          if (!inPass) {
            inPass = true;
            currentPass = {
              riseTime: date,
              riseAz: la.az,
              maxEl: la.el,
              maxElTime: date,
              maxElAz: la.az,
              setTime: date,
              setAz: la.az,
              points: []
            };
          }
          if (la.el > currentPass.maxEl) {
            currentPass.maxEl = la.el;
            currentPass.maxElTime = date;
            currentPass.maxElAz = la.az;
          }
          currentPass.setTime = date;
          currentPass.setAz = la.az;
          currentPass.points.push({ time: date, az: la.az, el: la.el, range: la.range });
        } else {
          if (inPass && currentPass) {
            currentPass.duration = (currentPass.setTime - currentPass.riseTime) / 1000;
            // Only keep passes during twilight/night (sun < -6°)
            if (currentPass.duration >= 30 && isTwilightOrNight(currentPass.maxElTime)) {
              passes.push(currentPass);
            }
          }
          inPass = false;
          currentPass = null;
        }
      }

      state.passes = passes;
      EventListManager.rebuild();
    }
  };

  // ══════════════════════════════════════════
  //  WEATHER CHECKER
  // ══════════════════════════════════════════
  const WeatherChecker = {
    async fetch() {
      if (!state.vcApiKey) {
        dom.cloudCover.textContent = 'No Key';
        dom.cloudIcon.textContent = '🔑';
        this.updateOverallVis();
        return;
      }
      try {
        const url = `${VC_BASE}/${OBSERVER.lat},${OBSERVER.lon}/today?unitGroup=metric&include=current&key=${state.vcApiKey}&contentType=json`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const cc = d.currentConditions?.cloudcover;
        state.cloudCover = cc ?? null;

        if (cc != null) {
          dom.cloudCover.textContent = `${cc.toFixed(0)}%`;
          dom.cloudIcon.textContent = cc < 25 ? '☀️' : cc < 60 ? '⛅' : '☁️';
        }
      } catch (e) {
        dom.cloudCover.textContent = '⚠️';
        dom.cloudIcon.textContent = '⚠️';
      }
      this.updateOverallVis();
    },
    updateOverallVis() {
      const result = VisibilityEngine.overall();
      dom.overallVis.textContent = result.label;
      dom.visIcon.textContent = result.icon;
      if (dom.overallCard) dom.overallCard.style.borderColor = result.borderColor;

      // Re-render event list with updated vis
      if (state.passes.length > 0) {
        EventListManager.rebuild();
      }
    }
  };

  // ══════════════════════════════════════════
  //  VISIBILITY ENGINE
  // ══════════════════════════════════════════
  const VisibilityEngine = {
    overall() {
      const cc = state.cloudCover;
      if (cc == null) return { label: 'Unknown', icon: '❓', color: 'yellow', borderColor: 'rgba(255,214,0,.25)' };
      if (cc < 25) return { label: 'Excellent', icon: '✨', color: 'green', borderColor: 'rgba(0,230,118,.3)' };
      if (cc < 50) return { label: 'Good', icon: '👍', color: 'green', borderColor: 'rgba(0,230,118,.2)' };
      if (cc < 75) return { label: 'Fair', icon: '🌥️', color: 'yellow', borderColor: 'rgba(255,214,0,.25)' };
      return { label: 'Poor', icon: '☁️', color: 'red', borderColor: 'rgba(255,82,82,.25)' };
    },

    rate(pass) {
      const cc = state.cloudCover;
      const el = pass.maxEl;
      if (cc == null) {
        if (el >= 45) return { label: 'High Pass', color: 'green' };
        if (el >= 25) return { label: 'Medium', color: 'yellow' };
        return { label: 'Low Pass', color: 'red' };
      }
      let score = 0;
      score += cc < 25 ? 0 : cc < 50 ? 1 : cc < 75 ? 2 : 3;
      score += el >= 45 ? 0 : el >= 25 ? 1 : 2;
      score += 0.5;
      if (score <= 1.5) return { label: 'Excellent', color: 'green' };
      if (score <= 3) return { label: 'Good', color: 'green' };
      if (score <= 4) return { label: 'Fair', color: 'yellow' };
      return { label: 'Poor', color: 'red' };
    }
  };

  // ══════════════════════════════════════════
  //  EVENT LIST MANAGER — Unified pass+launch
  // ══════════════════════════════════════════
  const EventListManager = {
    rebuild() {
      const events = [];
      const now = Date.now();

      // ISS passes
      state.passes.forEach((p, i) => {
        const isLive = now >= p.riseTime.getTime() && now <= p.setTime.getTime();
        const vis = VisibilityEngine.rate(p);
        const hint = typeof StarMap !== 'undefined' ? StarMap.getLandmarkHint(p.maxElAz, p.maxEl) : '';
        events.push({
          type: 'pass',
          sortTime: p.riseTime.getTime(),
          isLive,
          passIndex: i,
          pass: p,
          title: isLive ? '🛰️ ISS Pass — LIVE NOW' : '🛰️ ISS Pass',
          subtitle: `${fmtDate(p.riseTime)}  ${fmtTime(p.riseTime)} → ${fmtTime(p.setTime)}`,
          hint: hint ? `✨ ${hint}` : '',
          stats: [
            { val: `${p.maxEl.toFixed(1)}°`, lbl: 'Max El' },
            { val: `${Math.round(p.duration)}s`, lbl: 'Duration' },
            { val: `${p.riseAz.toFixed(0)}°→${p.setAz.toFixed(0)}°`, lbl: 'Az Arc' },
          ],
          visLabel: vis.label,
          visColor: vis.color,
          maxEl: p.maxEl,
        });
      });

      // SpaceX launches (only twilight/night)
      if (typeof LaunchTracker !== 'undefined') {
        const launches = LaunchTracker.getLaunches();
        launches.forEach((l, i) => {
          // Skip daytime launches — they won't be visible
          if (l.net && !isTwilightOrNight(l.net)) return;

          const isLive = l.net && Math.abs(l.net.getTime() - now) < 30 * 60 * 1000; // within 30min of T-0
          events.push({
            type: 'launch',
            sortTime: l.net ? l.net.getTime() : now + 999999999,
            isLive,
            launchIndex: i,
            launch: l,
            title: `🚀 ${l.missionName}`,
            subtitle: l.net ? `${fmtDate(l.net)}  ${fmtTime(l.net)}  •  ${l.locationName}` : `TBD  •  ${l.locationName}`,
            hint: '',
            stats: [
              { val: l.status, lbl: 'Status' },
              { val: l.orbit || 'LEO', lbl: 'Orbit' },
            ],
            visLabel: l.status === 'Go' ? 'Go' : l.status,
            visColor: l.status === 'Go' ? 'green' : 'yellow',
            maxEl: 0,
          });
        });
      }

      // Sort
      if (state.sortMode === 'elevation') {
        events.sort((a, b) => b.maxEl - a.maxEl);
      } else {
        events.sort((a, b) => a.sortTime - b.sortTime);
      }

      // Filter
      const filtered = events.filter(e => {
        if (state.activeFilter === 'pass') return e.type === 'pass';
        if (state.activeFilter === 'launch') return e.type === 'launch';
        return true;
      });

      state.sortedEvents = filtered;
      this.render(filtered);
    },

    render(events) {
      if (events.length === 0) {
        dom.eventList.innerHTML = `<div class="pass-loading glass-card"><span>No upcoming events found</span></div>`;
        return;
      }

      dom.eventList.innerHTML = events.map((e, i) => {
        const icon = e.type === 'pass' ? '🛰️' : '🚀';
        const liveClass = e.isLive ? ' card-live' : '';
        const dataAttr = e.type === 'pass'
          ? `data-type="pass" data-index="${e.passIndex}"`
          : `data-type="launch" data-index="${e.launchIndex}"`;

        return `
          <div class="event-card glass-card${liveClass}" ${dataAttr}>
            <div class="event-type-icon">${icon}</div>
            <div class="event-body">
              <span class="event-title">${e.title}</span>
              <span class="event-time">${e.subtitle}</span>
              ${e.hint ? `<span class="event-hint">${e.hint}</span>` : ''}
            </div>
            <div class="event-meta">
              ${e.stats.map(s => `
                <div class="event-stat">
                  <span class="event-stat-val">${s.val}</span>
                  <span class="event-stat-lbl">${s.lbl}</span>
                </div>
              `).join('')}
              <span class="event-vis-badge vis-${e.visColor}">${e.visLabel}</span>
              <span class="event-live-badge">● LIVE</span>
            </div>
          </div>`;
      }).join('');

      // Attach click handlers
      dom.eventList.querySelectorAll('.event-card').forEach(card => {
        card.addEventListener('click', () => {
          const type = card.dataset.type;
          const idx = parseInt(card.dataset.index);

          // Clear all active states
          dom.eventList.querySelectorAll('.event-card').forEach(c => c.classList.remove('card-simulating'));

          if (type === 'pass') {
            const pass = state.passes[idx];
            if (!pass) return;
            card.classList.add('card-simulating');
            switchView('radar');
            RadarBeep.startSimulation(pass);
          } else if (type === 'launch') {
            card.classList.add('card-simulating');
            switchView('panorama');
            if (typeof LaunchTracker !== 'undefined') {
              const launches = LaunchTracker.getLaunches();
              const launch = launches[idx];
              if (launch) {
                // Trigger launch simulation on panorama
                LaunchTracker.simulateLaunchByIndex(idx, dom.launchPano);
              }
            }
          }
        });
      });
    },

    // Called every 5s to detect live passes and auto-draw them
    checkLive() {
      const now = Date.now();
      let foundLive = false;

      state.passes.forEach((p, i) => {
        if (now >= p.riseTime.getTime() && now <= p.setTime.getTime()) {
          foundLive = true;
          if (state.livePassIndex !== i) {
            state.livePassIndex = i;
            // Auto-draw the live pass trajectory in green
            RadarBlip.drawPredictedArc(p, COLOR_LIVE);
            dom.issBlip.classList.add('blip-live');
          }
        }
      });

      if (!foundLive && state.livePassIndex !== -1) {
        state.livePassIndex = -1;
        RadarBlip.clearPredictedArc();
        dom.issBlip.classList.remove('blip-live');
      }

      // Update live classes on cards
      dom.eventList.querySelectorAll('.event-card').forEach(card => {
        const type = card.dataset.type;
        const idx = parseInt(card.dataset.index);
        if (type === 'pass') {
          const p = state.passes[idx];
          if (p && now >= p.riseTime.getTime() && now <= p.setTime.getTime()) {
            card.classList.add('card-live');
          } else {
            card.classList.remove('card-live');
          }
        }
      });
    }
  };

  // ══════════════════════════════════════════
  //  COMPASS / 3D ARROW
  // ══════════════════════════════════════════
  const CompassArrow = {
    hasOrientation: false,
    compassLocked: true,
    dragStartX: 0,
    dragBaseHeading: 0,
    isDragging: false,

    init() {
      if (window.DeviceOrientationEvent) {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          document.body.addEventListener('click', () => {
            DeviceOrientationEvent.requestPermission().then(p => {
              if (p === 'granted') this.bindOrientation();
            });
          }, { once: true });
        } else {
          this.bindOrientation();
        }
      }

      const scene = document.querySelector('.arrow-scene');
      if (scene) {
        scene.addEventListener('mousedown', e => this.onDragStart(e.clientX));
        scene.addEventListener('touchstart', e => this.onDragStart(e.touches[0].clientX));
      }
      window.addEventListener('mousemove', e => { if (this.isDragging) this.onDragMove(e.clientX); });
      window.addEventListener('touchmove', e => { if (this.isDragging) this.onDragMove(e.touches[0].clientX); });
      window.addEventListener('mouseup', () => this.isDragging = false);
      window.addEventListener('touchend', () => this.isDragging = false);

      const radarRing = document.querySelector('.radar-ring');
      if (radarRing) {
        radarRing.addEventListener('mousedown', e => this.onDragStart(e.clientX));
        radarRing.addEventListener('touchstart', e => this.onDragStart(e.touches[0].clientX));
      }
    },

    bindOrientation() {
      window.addEventListener('deviceorientation', e => {
        if (e.alpha != null) {
          this.hasOrientation = true;
          // Only update heading when compass is actively locked
          if (this.compassLocked) {
            let heading = e.webkitCompassHeading ?? (360 - e.alpha);
            state.heading = heading;
            dom.userHeading.textContent = `${heading.toFixed(0)}°`;
            this.update();
          }
        }
      });
    },

    onDragStart(x) {
      this.isDragging = true;
      this.dragStartX = x;
      this.dragBaseHeading = state.heading;
    },
    onDragMove(x) {
      const dx = x - this.dragStartX;
      state.heading = (this.dragBaseHeading + dx * 0.5 + 360) % 360;
      dom.userHeading.textContent = `${state.heading.toFixed(0)}°`;
      this.update();
    },

    update() {
      const relAz = (state.issAz - state.heading + 360) % 360;
      const el = Math.max(-90, Math.min(90, state.issEl));
      dom.arrow3d.style.transform = `rotateY(${relAz}deg) rotateX(${-el}deg)`;

      // Rotate the radar-rotator wrapper when compass is available AND active
      if (this.hasOrientation && this.compassLocked) {
        const rotator = document.querySelector('.radar-rotator');
        if (rotator) rotator.style.transform = `rotate(${-state.heading}deg)`;
      }

      // Create or update compass badge
      if (this.hasOrientation) {
        let badge = document.getElementById('compass-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'compass-badge';
          badge.className = 'compass-badge';
          badge.innerHTML = '🧭 Live';
          const ring = document.querySelector('.radar-ring');
          if (ring) ring.appendChild(badge);
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.compassLocked = !this.compassLocked;
            badge.innerHTML = this.compassLocked ? '🧭 Live' : '🧭 Off';
            badge.classList.toggle('compass-off', !this.compassLocked);
            if (!this.compassLocked) {
              // Reset heading to 0 (north-up) and clear rotation
              state.heading = 0;
              dom.userHeading.textContent = '0°';
              const rotator = document.querySelector('.radar-rotator');
              if (rotator) rotator.style.transform = '';
            }
            this.update();
          });
        }
      }

      RadarBlip.update(state.issAz, state.issEl);
      if (typeof StarMap !== 'undefined') {
        // When compass is locked, rotator handles rotation physically → render at heading 0
        // When compass is off/desktop, starmap must apply heading internally
        const mapHeading = (this.hasOrientation && this.compassLocked) ? 0 : state.heading;
        StarMap.render(new Date(), OBSERVER.lat, OBSERVER.lon, mapHeading);
      }

      // Update launch direction arrow if panorama is active
      updateLaunchDirection();
    }
  };

  // ══════════════════════════════════════════
  //  RADAR BLIP
  // ══════════════════════════════════════════
  const RadarBlip = {
    arcLayer: null,

    update(az, el) {
      const blip = dom.issBlip;
      if (el < 0) {
        blip.classList.add('hidden');
        return;
      }
      blip.classList.remove('hidden');

      const ring = document.querySelector('.radar-ring');
      const size = ring.offsetWidth / 2;
      const r = size * (1 - el / 90);

      // When compass is active AND locked, ring rotates, so use absolute az
      // When drag-mode or compass off, use relative az
      const useAz = (CompassArrow.hasOrientation && CompassArrow.compassLocked) ? az : (az - state.heading + 360) % 360;
      const theta = (useAz - 90) * RAD;

      const cx = size + r * Math.cos(theta);
      const cy = size + r * Math.sin(theta);

      blip.style.left = `${cx}px`;
      blip.style.top = `${cy}px`;
    },

    drawPredictedArc(pass, color = COLOR_SIM) {
      this.clearPredictedArc();
      if (!pass || !pass.points || pass.points.length < 2) return;

      const ring = document.querySelector('.radar-ring');
      if (!ring) return;

      this.arcLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.arcLayer.setAttribute('class', 'predicted-arc-layer');
      this.arcLayer.setAttribute('viewBox', '0 0 340 340');
      ring.appendChild(this.arcLayer);

      const R = 160;
      const ctr = 170;
      const pts = pass.points.map(p => {
        const useAz = (CompassArrow.hasOrientation && CompassArrow.compassLocked) ? p.az : ((p.az - state.heading + 360) % 360);
        const r = R * (1 - Math.max(0, p.el) / 90);
        const theta = (useAz - 90) * RAD;
        return {
          x: ctr + r * Math.cos(theta),
          y: ctr + r * Math.sin(theta)
        };
      });

      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-dasharray', color === COLOR_LIVE ? 'none' : '6,4');
      path.setAttribute('opacity', color === COLOR_LIVE ? '0.7' : '0.4');
      path.setAttribute('stroke-linecap', 'round');
      this.arcLayer.appendChild(path);

      // Start/end markers
      [pts[0], pts[pts.length - 1]].forEach((pt, idx) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt.x);
        c.setAttribute('cy', pt.y);
        c.setAttribute('r', '4');
        c.setAttribute('fill', 'none');
        c.setAttribute('stroke', color);
        c.setAttribute('stroke-width', '1.5');
        c.setAttribute('opacity', '0.6');
        this.arcLayer.appendChild(c);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', pt.x);
        label.setAttribute('y', pt.y + (idx === 0 ? 14 : -8));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', color);
        label.setAttribute('font-size', '7');
        label.setAttribute('font-family', "'Outfit',sans-serif");
        label.setAttribute('opacity', '0.6');
        label.textContent = idx === 0 ? 'RISE' : 'SET';
        this.arcLayer.appendChild(label);
      });
    },

    clearPredictedArc() {
      if (this.arcLayer) {
        this.arcLayer.remove();
        this.arcLayer = null;
      }
    }
  };

  // ══════════════════════════════════════════
  //  RADAR BEEP (Web Audio API)
  // ══════════════════════════════════════════
  const RadarBeep = {
    osc: null,
    gain: null,
    beepTimer: null,
    simTimer: null,

    ensureCtx() {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }
      return state.audioCtx;
    },

    beep(freq, vol, duration = 0.35) {
      const ctx = this.ensureCtx();
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, t + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, t);
      filter.Q.setValueAtTime(8, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      const delay = ctx.createDelay(1.0);
      delay.delayTime.setValueAtTime(0.15, t);
      const echoGain = ctx.createGain();
      echoGain.gain.setValueAtTime(vol * 0.25, t);
      echoGain.gain.exponentialRampToValueAtTime(0.001, t + duration + 0.2);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(delay);
      delay.connect(echoGain);
      echoGain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + duration + 0.3);
    },

    gaussian(t, tPeak, sigma) {
      return Math.exp(-((t - tPeak) ** 2) / (2 * sigma ** 2));
    },

    startForPass(pass) {
      if (state.beeping) this.stop();
      state.beeping = true;
      dom.btnBeep.textContent = '🔇 Stop Radar Beep';

      const tRise = pass.riseTime.getTime();
      const tSet = pass.setTime.getTime();
      const tPeak = pass.maxElTime.getTime();
      const duration = (tSet - tRise) / 1000;
      const sigma = duration / 4;

      const tick = () => {
        if (!state.beeping) return;
        const now = Date.now();
        const tFromPeak = (now - tPeak) / 1000;
        const g = this.gaussian(tFromPeak, 0, sigma);
        const freq = 1200 + 600 * g;
        const vol = 0.04 + 0.46 * g;
        const interval = 2500 - 2000 * g;
        this.beep(freq, vol);
        if (now < tSet) {
          this.beepTimer = setTimeout(tick, interval);
        } else {
          this.stop();
        }
      };
      tick();
    },

    startSimulation(pass) {
      if (state.simulating) return;
      state.simulating = true;
      state.beeping = true;
      dom.btnBeep.textContent = '🔇 Stop Radar Beep';
      dom.btnSimulate.textContent = '⚡ Simulating…';
      dom.btnSimulate.disabled = true;

      dom.issBlip.classList.add('blip-simulating');

      const simDuration = pass ? Math.min(pass.duration / 4, 20) : 15;
      const tStart = Date.now();
      const tPeak = tStart + (simDuration / 2) * 1000;
      const sigma = simDuration / 4;

      const hasPassPts = pass && pass.points && pass.points.length >= 2;

      if (hasPassPts) {
        RadarBlip.drawPredictedArc(pass, COLOR_SIM);
      }

      let startAz, azSweep;
      if (!hasPassPts) {
        startAz = Math.random() * 360;
        azSweep = 120 + Math.random() * 60;
      }

      const interpolatePass = (progress) => {
        if (!hasPassPts) {
          const az = (startAz + azSweep * progress) % 360;
          const el = 10 + 70 * (1 - (2 * progress - 1) ** 2);
          return { az, el };
        }
        const pts = pass.points;
        const idx = progress * (pts.length - 1);
        const i = Math.min(Math.floor(idx), pts.length - 2);
        const frac = idx - i;
        return {
          az: pts[i].az + (pts[i + 1].az - pts[i].az) * frac,
          el: pts[i].el + (pts[i + 1].el - pts[i].el) * frac
        };
      };

      const animFrame = () => {
        if (!state.simulating) return;
        const now = Date.now();
        const progress = Math.min((now - tStart) / (simDuration * 1000), 1);

        if (progress >= 1) {
          this.endSim();
          return;
        }

        const pos = interpolatePass(progress);
        state.issAz = pos.az;
        state.issEl = pos.el;
        dom.issAzEl.textContent = `${pos.az.toFixed(1)}°`;
        dom.issElEl.textContent = `${pos.el.toFixed(1)}°`;
        dom.arrowAz.textContent = `${pos.az.toFixed(1)}°`;
        dom.arrowEl.textContent = `${pos.el.toFixed(1)}°`;
        CompassArrow.update();
        RadarBlip.update(pos.az, pos.el);

        this.simRaf = requestAnimationFrame(animFrame);
      };
      this.simRaf = requestAnimationFrame(animFrame);

      const beepTick = () => {
        if (!state.beeping || !state.simulating) return;
        const now = Date.now();
        const progress = (now - tStart) / (simDuration * 1000);
        if (progress > 1) return;

        const tFromPeak = (now - tPeak) / 1000;
        const g = this.gaussian(tFromPeak, 0, sigma);
        const freq = 1200 + 600 * g;
        const vol = 0.04 + 0.46 * g;
        const interval = 2500 - 2000 * g;
        this.beep(freq, vol);
        this.beepTimer = setTimeout(beepTick, Math.max(100, interval));
      };
      beepTick();
    },

    endSim() {
      state.simulating = false;
      cancelAnimationFrame(this.simRaf);
      this.stop();
      dom.btnSimulate.textContent = '⚡ Simulate Pass';
      dom.btnSimulate.disabled = false;
      dom.issBlip.classList.remove('blip-simulating');
      RadarBlip.clearPredictedArc();
      // Remove simulating highlight from cards
      dom.eventList.querySelectorAll('.event-card').forEach(c => c.classList.remove('card-simulating'));
    },

    stop() {
      state.beeping = false;
      clearTimeout(this.beepTimer);
      dom.btnBeep.textContent = '🔊 Start Radar Beep';
    },

    toggle() {
      if (state.beeping) {
        if (state.simulating) {
          this.endSim();
        } else {
          this.stop();
        }
      } else {
        const now = Date.now();
        const activePass = state.passes.find(p =>
          now >= p.riseTime.getTime() && now <= p.setTime.getTime()
        );
        if (activePass) {
          this.startForPass(activePass);
        } else {
          this.startAmbient();
        }
      }
    },

    startAmbient() {
      state.beeping = true;
      dom.btnBeep.textContent = '🔇 Stop Radar Beep';
      const tick = () => {
        if (!state.beeping) return;
        this.beep(1000, 0.06, 0.25);
        this.beepTimer = setTimeout(tick, 3000);
      };
      tick();
    }
  };

  // ══════════════════════════════════════════
  //  APP ORCHESTRATOR
  // ══════════════════════════════════════════
  const App = {
    init() {
      if (!state.vcApiKey) {
        dom.modal.classList.remove('hidden');
      } else {
        this.launch();
      }

      // Modal events
      dom.btnSave.addEventListener('click', () => {
        const key = dom.keyInput.value.trim();
        if (key) {
          state.vcApiKey = key;
          localStorage.setItem('vc_api_key', key);
        }
        dom.modal.classList.add('hidden');
        this.launch();
      });
      dom.btnSkip.addEventListener('click', () => {
        dom.modal.classList.add('hidden');
        this.launch();
      });

      // Location buttons
      dom.btnDetect.addEventListener('click', () => LocationManager.autoDetect());
      dom.btnSetLoc.addEventListener('click', () => LocationManager.setManual());
      dom.btnSetZip.addEventListener('click', () => LocationManager.setFromZip());
      dom.inputZip.addEventListener('keydown', e => { if (e.key === 'Enter') LocationManager.setFromZip(); });

      // Beep / Simulate buttons
      dom.btnBeep.addEventListener('click', () => RadarBeep.toggle());
      dom.btnSimulate.addEventListener('click', () => RadarBeep.startSimulation());

      // Star map slider
      dom.starmapSlider.addEventListener('input', e => {
        const val = parseInt(e.target.value);
        dom.starmapVal.textContent = val + '%';
        if (typeof StarMap !== 'undefined') StarMap.setOpacity(val / 100);
      });

      // Viewer tab switching
      document.querySelectorAll('.viewer-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
      });

      // Filter buttons
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.activeFilter = btn.dataset.filter;
          EventListManager.rebuild();

          // Auto-sync viewer tab with filter selection
          const viewMap = { pass: 'radar', launch: 'panorama' };
          const targetView = viewMap[btn.dataset.filter];
          if (targetView) switchView(targetView);
        });
      });

      // Sort buttons
      document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.sortMode = btn.dataset.sort;
          EventListManager.rebuild();
        });
      });
    },

    launch() {
      tickClock();
      setInterval(tickClock, 1000);

      dom.lightPoll.textContent = `Bortle ${BORTLE.class}`;

      LocationManager.init();

      ISSTracker.start();
      PassPredictor.init();
      WeatherChecker.fetch();
      CompassArrow.init();

      // Star map
      if (typeof StarMap !== 'undefined') {
        const radarRing = document.querySelector('.radar-ring');
        StarMap.init(radarRing);
        StarMap.render(new Date(), OBSERVER.lat, OBSERVER.lon, state.heading);
      }

      // Launch tracker (panorama)
      if (typeof LaunchTracker !== 'undefined') {
        LaunchTracker.init(OBSERVER.lat, OBSERVER.lon, null, dom.launchPano);
      }

      // Live pass detection every 5s
      setInterval(() => EventListManager.checkLive(), 5000);

      // Refresh weather every 15 min, launches every 30 min
      setInterval(() => WeatherChecker.fetch(), 15 * 60 * 1000);
      setInterval(() => {
        if (typeof LaunchTracker !== 'undefined') {
          LaunchTracker.refresh(null, dom.launchPano);
          EventListManager.rebuild();
        }
      }, 30 * 60 * 1000);

      // Auto-detect which view to show: if a pass is live, show radar
      setTimeout(() => {
        const now = Date.now();
        const livePass = state.passes.find(p =>
          now >= p.riseTime.getTime() && now <= p.setTime.getTime()
        );
        if (livePass) {
          switchView('radar');
        }
        // Radar is already the default active, so no need to switch otherwise
      }, 3000);
    }
  };

  // ── VIEW SWITCHER ─────────────────────────
  function switchView(viewName) {
    document.querySelectorAll('.viewer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.viewer-panel').forEach(p => p.classList.remove('active'));

    const tab = document.querySelector(`.viewer-tab[data-view="${viewName}"]`);
    const panel = document.getElementById(`view-${viewName}`);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');

    // Toggle stats bars
    if (viewName === 'panorama') {
      if (dom.statsBarIss) dom.statsBarIss.style.display = 'none';
      if (dom.statsBarLaunch) dom.statsBarLaunch.style.display = '';
      updateLaunchStats();
      updateLaunchDirection();
    } else {
      if (dom.statsBarIss) dom.statsBarIss.style.display = '';
      if (dom.statsBarLaunch) dom.statsBarLaunch.style.display = 'none';
    }

    // Auto-sync event filter with viewer tab
    const filterMap = { radar: 'pass', panorama: 'launch' };
    const targetFilter = filterMap[viewName];
    if (targetFilter && state.activeFilter !== targetFilter) {
      state.activeFilter = targetFilter;
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === targetFilter);
      });
      EventListManager.rebuild();
    }
  }

  // ── LAUNCH STATS UPDATER ────────────────────
  function updateLaunchStats() {
    if (typeof LaunchTracker === 'undefined') return;
    const launches = LaunchTracker.getLaunches();
    if (!launches || launches.length === 0) {
      if (dom.launchMission) dom.launchMission.textContent = 'No launches';
      return;
    }

    // Pick the next upcoming launch
    const now = Date.now();
    const next = launches.find(l => l.net && l.net.getTime() > now) || launches[0];
    if (!next) return;

    if (dom.launchMission) dom.launchMission.textContent = next.missionName || '—';

    if (dom.launchCountdown && next.net) {
      const diff = next.net.getTime() - now;
      if (diff > 0) {
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        dom.launchCountdown.textContent = d > 0 ? `T-${d}d ${h}h ${m}m` : h > 0 ? `T-${h}h ${m}m` : `T-${m}m`;
      } else {
        dom.launchCountdown.textContent = 'LAUNCHED';
      }
    }

    if (dom.launchPad) dom.launchPad.textContent = next.locationName || next.padName || '—';
    if (dom.launchOrbit) dom.launchOrbit.textContent = next.orbit || 'LEO';

    if (dom.launchStatus) {
      dom.launchStatus.textContent = next.status || '—';
      dom.launchStatus.style.color = next.status === 'Go' ? '#00e676' : next.status === 'TBD' ? '#ffd600' : '#aaa';
    }

    // Distance from observer to launch pad
    if (dom.launchDistance) {
      const dLat = (next.padLat - OBSERVER.lat) * Math.PI / 180;
      const dLon = (next.padLon - OBSERVER.lon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(OBSERVER.lat * Math.PI / 180) * Math.cos(next.padLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const dist = 2 * 6371 * Math.asin(Math.sqrt(a));
      dom.launchDistance.textContent = Math.round(dist).toLocaleString();
    }
  }

  // ── LAUNCH DIRECTION ARROW ──────────────────
  function updateLaunchDirection() {
    if (!dom.launchDirContainer) return;
    // Only show when panorama is active
    const panoPanel = document.getElementById('view-panorama');
    if (!panoPanel || !panoPanel.classList.contains('active')) {
      dom.launchDirContainer.style.display = 'none';
      return;
    }

    if (typeof LaunchTracker === 'undefined') {
      dom.launchDirContainer.style.display = 'none';
      return;
    }

    const info = LaunchTracker.getNextLaunchAzimuth();
    if (!info) {
      dom.launchDirContainer.style.display = 'none';
      return;
    }

    dom.launchDirContainer.style.display = '';
    const targetAz = info.azimuth;
    const heading = state.heading;

    // Compute shortest angular difference
    let diff = targetAz - heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const absDiff = Math.abs(diff);
    const hasCompass = CompassArrow.hasOrientation;

    if (!hasCompass) {
      // Desktop: show static bearing info
      const cardinal = bearingToCardinal(targetAz);
      dom.launchDirArrow.textContent = '🧭';
      dom.launchDirText.textContent = `Launch site: Face ${cardinal} (${targetAz.toFixed(0)}°) • ${info.siteName}`;
      dom.launchDirContainer.className = 'launch-direction glass-card';
      return;
    }

    if (absDiff <= 15) {
      // Aligned!
      dom.launchDirArrow.textContent = '✅';
      dom.launchDirText.textContent = `You're facing ${info.siteName}!`;
      dom.launchDirContainer.className = 'launch-direction glass-card dir-aligned';
    } else if (absDiff <= 45) {
      // Almost there
      const arrow = diff > 0 ? '↗️' : '↖️';
      const dir = diff > 0 ? 'slightly right' : 'slightly left';
      dom.launchDirArrow.textContent = arrow;
      dom.launchDirText.textContent = `Turn ${dir} towards ${info.siteName} (${absDiff.toFixed(0)}° off)`;
      dom.launchDirContainer.className = 'launch-direction glass-card dir-close';
    } else {
      // Need to turn more
      const arrow = diff > 0 ? '➡️' : '⬅️';
      const dir = diff > 0 ? 'right' : 'left';
      dom.launchDirArrow.textContent = arrow;
      dom.launchDirText.textContent = `Turn ${dir} ${absDiff.toFixed(0)}° towards ${info.siteName}`;
      dom.launchDirContainer.className = 'launch-direction glass-card dir-far';
    }
  }

  function bearingToCardinal(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }
  window.switchView = switchView;

  // ── BOOT ─────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => App.init());
})();
