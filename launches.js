/* ────────────────────────────────────────────
   ISS Hunter — SpaceX Launch Tracker Module
   Fetches upcoming launches, computes trajectory
   arcs, renders on a Southern Horizon Cityline view.
   Only shows Florida launches whose flare burns
   are visible overhead from the observer's location.
   ──────────────────────────────────────────── */

const LaunchTracker = (() => {
    'use strict';

    const DEG = 180 / Math.PI;
    const RAD = Math.PI / 180;
    const R_EARTH = 6371; // km

    // ── LAUNCH SITES ────────────────────────────
    const SITES = {
        vandenberg: {
            lat: 34.632, lon: -120.611,
            label: 'Vandenberg SFB',
            defaultHeading: 196,
            color: '#00e5ff',
            colorFaint: 'rgba(0,229,255,0.25)',
        },
        canaveral: {
            lat: 28.562, lon: -80.577,
            label: 'Cape Canaveral',
            defaultHeading: 90,
            color: '#ff9800',
            colorFaint: 'rgba(255,152,0,0.25)',
        },
        kennedy: {
            lat: 28.573, lon: -80.649,
            label: 'Kennedy Space Center',
            defaultHeading: 90,
            color: '#ff9800',
            colorFaint: 'rgba(255,152,0,0.25)',
        },
        boca_chica: {
            lat: 25.997, lon: -97.157,
            label: 'Starbase',
            defaultHeading: 90,
            color: '#ff5252',
            colorFaint: 'rgba(255,82,82,0.25)',
        }
    };

    const BOOSTER_COLOR = '#ffd600';
    const FLARE_COLOR = '#e040fb';

    // ── FALCON 9 ASCENT PROFILE ──────────────
    const ASCENT_PROFILE = [
        { t: 0, alt: 0, downrange: 0 },
        { t: 30, alt: 7, downrange: 2 },
        { t: 60, alt: 30, downrange: 20 },
        { t: 90, alt: 55, downrange: 55 },
        { t: 120, alt: 80, downrange: 100 },
        { t: 150, alt: 100, downrange: 160 },
        { t: 160, alt: 110, downrange: 180 },
        { t: 180, alt: 130, downrange: 220 },
        { t: 240, alt: 180, downrange: 350 },
        { t: 300, alt: 230, downrange: 500 },
        { t: 360, alt: 280, downrange: 680 },
        { t: 420, alt: 320, downrange: 850 },
        { t: 480, alt: 350, downrange: 1050 },
        { t: 540, alt: 380, downrange: 1250 },
    ];

    // Booster: droneship (Florida default)
    const BOOSTER_DRONESHIP = [
        { t: 160, alt: 110, downrange: 180 },
        { t: 200, alt: 120, downrange: 250 },
        { t: 240, alt: 90, downrange: 350 },
        { t: 280, alt: 55, downrange: 450 },
        { t: 320, alt: 20, downrange: 550 },
        { t: 360, alt: 5, downrange: 600 },
        { t: 400, alt: 0, downrange: 630 },
    ];

    // ── PANORAMA CONSTANTS ───────────────────
    // The panoramic view spans 180° of azimuth (90° E to 270° W through 180° S)
    // and 0°→70° elevation vertically
    const PANO_W = 700;
    const PANO_H = 280;
    const PANO_AZ_MIN = 90;   // east
    const PANO_AZ_MAX = 270;  // west
    const PANO_EL_MAX = 70;   // top of view
    const SKYLINE_H = 30;     // height of cityline silhouette

    // ── STATE ──────────────────────────────────
    let launches = [];
    let observer = { lat: 0, lon: 0 };
    let simRaf = null;
    let simulating = false;
    let panoContainer = null;

    // ── GEOMETRY HELPERS ───────────────────────

    function destinationPoint(lat1, lon1, headingDeg, distKm) {
        const d = distKm / R_EARTH;
        const brng = headingDeg * RAD;
        const lat1r = lat1 * RAD;
        const lon1r = lon1 * RAD;

        const lat2 = Math.asin(
            Math.sin(lat1r) * Math.cos(d) +
            Math.cos(lat1r) * Math.sin(d) * Math.cos(brng)
        );
        const lon2 = lon1r + Math.atan2(
            Math.sin(brng) * Math.sin(d) * Math.cos(lat1r),
            Math.cos(d) - Math.sin(lat1r) * Math.sin(lat2)
        );

        return { lat: lat2 * DEG, lon: lon2 * DEG };
    }

    function haversine(lat1, lon1, lat2, lon2) {
        const dLat = (lat2 - lat1) * RAD;
        const dLon = (lon2 - lon1) * RAD;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) *
            Math.sin(dLon / 2) ** 2;
        return 2 * R_EARTH * Math.asin(Math.sqrt(a));
    }

    function toAzEl(lat, lon, altKm, obsLat, obsLon) {
        const dLon = (lon - obsLon) * RAD;
        const obsLatR = obsLat * RAD;
        const latR = lat * RAD;

        const y = Math.sin(dLon) * Math.cos(latR);
        const x = Math.cos(obsLatR) * Math.sin(latR) -
            Math.sin(obsLatR) * Math.cos(latR) * Math.cos(dLon);
        let az = Math.atan2(y, x) * DEG;
        if (az < 0) az += 360;

        const groundDist = haversine(obsLat, obsLon, lat, lon);
        const el = Math.atan2(altKm, groundDist) * DEG;

        return { az, el };
    }

    // ── PANORAMA COORDINATE MAPPING ──────────
    // Map az/el to x/y on the panoramic canvas
    function azElToPano(az, el) {
        // Normalize azimuth to the 90..270 range
        let normAz = az;
        if (normAz < PANO_AZ_MIN) normAz += 360;
        // Clamp
        const x = ((normAz - PANO_AZ_MIN) / (PANO_AZ_MAX - PANO_AZ_MIN)) * PANO_W;
        const y = PANO_H - SKYLINE_H - ((Math.max(0, el) / PANO_EL_MAX) * (PANO_H - SKYLINE_H));
        return { x: Math.max(0, Math.min(PANO_W, x)), y: Math.max(0, Math.min(PANO_H, y)) };
    }

    // Check if az is within the panorama view
    function azInView(az) {
        return az >= PANO_AZ_MIN && az <= PANO_AZ_MAX;
    }

    // ── TRAJECTORY COMPUTATION ─────────────────

    function computeTrajectory(siteLat, siteLon, heading, profile) {
        return profile.map(pt => {
            const dest = destinationPoint(siteLat, siteLon, heading, pt.downrange);
            return { t: pt.t, lat: dest.lat, lon: dest.lon, alt: pt.alt };
        });
    }

    // ── IDENTIFY LAUNCH SITE ───────────────────

    function identifySite(padLat, padLon) {
        let bestKey = null;
        let bestDist = Infinity;
        for (const [key, site] of Object.entries(SITES)) {
            const d = haversine(padLat, padLon, site.lat, site.lon);
            if (d < bestDist) { bestDist = d; bestKey = key; }
        }
        return bestDist < 50 ? bestKey : null;
    }

    // ── IS VANDENBERG SITE? ─────────────────
    function isVandenbergSite(siteKey) {
        return siteKey === 'vandenberg';
    }

    // ── API FETCH ──────────────────────────────

    async function fetchLaunches() {
        try {
            const url = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?format=json&limit=10&search=spacex';
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();

            launches = (data.results || [])
                .filter(l => l.pad && l.pad.latitude && l.pad.longitude)
                .map(l => {
                    const padLat = parseFloat(l.pad.latitude);
                    const padLon = parseFloat(l.pad.longitude);
                    const siteKey = identifySite(padLat, padLon);
                    const site = siteKey ? SITES[siteKey] : null;

                    return {
                        id: l.id,
                        name: l.name || 'Unknown',
                        missionName: l.mission?.name || l.name || 'SpaceX Mission',
                        status: l.status?.abbrev || 'TBD',
                        net: l.net ? new Date(l.net) : null,
                        padLat, padLon,
                        padName: l.pad.name || '',
                        locationName: l.pad.location?.name || '',
                        siteKey,
                        site,
                        orbit: l.mission?.orbit?.abbrev || 'LEO',
                    };
                })
                .filter(l => l.site)
                // Only Vandenberg launches
                .filter(l => isVandenbergSite(l.siteKey))
                .filter(l => l.net && (l.net.getTime() - Date.now()) < 7 * 86400000);

            return launches;
        } catch (e) {
            console.warn('Launch fetch failed:', e);
            return [];
        }
    }

    // ── VISIBILITY CHECK ───────────────────────

    function isVisibleFromObserver(launch) {
        const dist = haversine(observer.lat, observer.lon, launch.padLat, launch.padLon);
        // Vandenberg launches visible up to ~2000km along the coast
        if (dist < 400) return { visible: true, dist, type: 'direct' };
        if (dist < 2000) return { visible: true, dist, type: 'flare' };
        return { visible: false, dist, type: 'none' };
    }

    // ── RENDER LAUNCH CARDS ────────────────────

    function renderCards(container) {
        if (!container) return;
        if (launches.length === 0) {
            container.innerHTML = `<div class="pass-loading glass-card"><span>No upcoming Vandenberg SpaceX launches in the next 7 days</span></div>`;
            return;
        }

        container.innerHTML = launches.map(l => {
            const vis = isVisibleFromObserver(l);
            const tMinus = l.net ? formatCountdown(l.net) : 'TBD';
            const statusClass = l.status === 'Go' ? 'go' : (l.status === 'Success' ? 'success' : (l.status === 'TBD' ? 'tbd' : 'other'));
            const siteColor = l.site ? l.site.color : '#888';
            const visLabel = vis.visible
                ? (vis.type === 'flare'
                    ? '✨ Flare burn may be visible overhead'
                    : '👁️ Visible from your location')
                : `📍 ${Math.round(vis.dist)} km away`;

            return `
        <div class="launch-card glass-card clickable-card" data-launch-idx="${launches.indexOf(l)}" style="border-left: 3px solid ${siteColor}">
          <div class="launch-top">
            <span class="launch-name">🚀 ${l.missionName}</span>
            <span class="launch-status launch-${statusClass}">${l.status}</span>
          </div>
          <div class="launch-details">
            <span class="launch-site" style="color:${siteColor}">${l.locationName}</span>
            <span class="launch-time mono">${tMinus}</span>
          </div>
          <div class="launch-vis">${visLabel}</div>
          <div class="card-simulate-hint">▶ Click to simulate trajectory</div>
        </div>`;
        }).join('');

        // Attach click handlers
        container.querySelectorAll('.launch-card[data-launch-idx]').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.launchIdx);
                const launch = launches[idx];
                if (!launch) return;
                container.querySelectorAll('.launch-card').forEach(c => c.classList.remove('card-active'));
                document.querySelectorAll('.pass-card').forEach(c => c.classList.remove('card-active'));
                card.classList.add('card-active');
                // Switch to panorama view
                if (typeof window.switchView === 'function') window.switchView('panorama');
                simulateLaunch(launch);
            });
        });
    }

    function formatCountdown(date) {
        const diff = date.getTime() - Date.now();
        if (diff < 0) {
            const ago = Math.abs(diff);
            if (ago < 3600000) return `Launched ${Math.round(ago / 60000)}m ago`;
            if (ago < 86400000) return `Launched ${Math.round(ago / 3600000)}h ago`;
            return `Launched ${date.toLocaleDateString()}`;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        if (d > 0) return `T-${d}d ${h}h ${m}m`;
        if (h > 0) return `T-${h}h ${m}m`;
        return `T-${m}m`;
    }

    // ── PANORAMIC HORIZON VIEW ───────────────
    // Builds the entire SVG panorama: sky gradient, stars, city skyline,
    // compass labels, grid lines, and trajectory arcs

    function buildSkylinePath() {
        // Procedural city skyline silhouette with buildings of varying height
        // Spanning from x=0 to x=PANO_W at the bottom of the view
        const baseY = PANO_H;
        const minH = 8;
        const maxH = SKYLINE_H;
        let path = `M 0 ${baseY} `;
        let x = 0;
        const seed = 42; // consistent seed for reproducible skyline

        // Simple seeded random
        let s = seed;
        function rng() { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }

        while (x < PANO_W) {
            const w = 8 + Math.floor(rng() * 24);
            const h = minH + Math.floor(rng() * (maxH - minH));
            const hasSpire = rng() > 0.85;
            const topY = baseY - h;

            // Building body
            path += `L ${x} ${topY} `;
            if (hasSpire) {
                const spireH = 4 + Math.floor(rng() * 8);
                const mid = x + w / 2;
                path += `L ${mid - 2} ${topY} L ${mid} ${topY - spireH} L ${mid + 2} ${topY} `;
            }
            path += `L ${x + w} ${topY} `;

            // Small gap between buildings
            const gap = 1 + Math.floor(rng() * 4);
            path += `L ${x + w} ${baseY - minH + Math.floor(rng() * 5)} `;
            x += w + gap;
        }
        path += `L ${PANO_W} ${baseY} Z`;
        return path;
    }

    function renderPanorama(container) {
        if (!container) return;

        // Check if any launches have visible trajectories
        const visibleLaunches = launches.filter(l => {
            const vis = isVisibleFromObserver(l);
            return vis.visible;
        });

        let html = `<svg class="horizon-pano" viewBox="0 0 ${PANO_W} ${PANO_H}" preserveAspectRatio="xMidYMid meet">
          <defs>
            <!-- Night sky gradient -->
            <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0a0e27"/>
              <stop offset="40%" stop-color="#111833"/>
              <stop offset="75%" stop-color="#1a1f3a"/>
              <stop offset="100%" stop-color="#252a45"/>
            </linearGradient>
            <!-- Horizon glow -->
            <radialGradient id="horizon-glow" cx="0.5" cy="1" r="0.6">
              <stop offset="0%" stop-color="rgba(255,152,0,0.08)"/>
              <stop offset="100%" stop-color="transparent"/>
            </radialGradient>
            <!-- Flare glow filter -->
            <filter id="flare-glow">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          <!-- Sky background -->
          <rect width="${PANO_W}" height="${PANO_H}" fill="url(#sky-grad)"/>
          <rect width="${PANO_W}" height="${PANO_H}" fill="url(#horizon-glow)"/>

          <!-- Stars (small random dots) -->
          ${generateStars()}

          <!-- Compass grid lines -->
          ${generateGrid()}

          <!-- Compass labels -->
          ${generateCompassLabels()}`;

        // ── Draw trajectory arcs ──
        visibleLaunches.forEach(launch => {
            const site = launch.site;
            const heading = site.defaultHeading;
            const vis = isVisibleFromObserver(launch);

            // Full ascent arc (orange for Florida)
            const ascentPts = computeTrajectory(launch.padLat, launch.padLon, heading, ASCENT_PROFILE);
            const ascentAzEl = ascentPts.map(p => toAzEl(p.lat, p.lon, p.alt, observer.lat, observer.lon));
            html += drawPanoPath(ascentAzEl, site.color, '2.5', '', 0.7);

            // Booster return (gold dashed)
            const boosterPts = computeTrajectory(launch.padLat, launch.padLon, heading, BOOSTER_DRONESHIP);
            const boosterAzEl = boosterPts.map(p => toAzEl(p.lat, p.lon, p.alt, observer.lat, observer.lon));
            html += drawPanoPath(boosterAzEl, BOOSTER_COLOR, '1.8', '8,5', 0.5);

            // Flare burn zone (magenta dotted, glowing)
            if (vis.type === 'flare') {
                const flarePts = ASCENT_PROFILE.filter(p => p.alt >= 200);
                const flareTraj = computeTrajectory(launch.padLat, launch.padLon, heading, flarePts);
                const flareAzEl = flareTraj.map(p => toAzEl(p.lat, p.lon, p.alt, observer.lat, observer.lon));
                html += drawPanoPath(flareAzEl, FLARE_COLOR, '3', '4,4', 0.8, true);
            }

            // Label near trajectory start
            const labelPt = ascentAzEl.find(p => p.el > 0 && azInView(p.az));
            if (labelPt) {
                const xy = azElToPano(labelPt.az, labelPt.el);
                html += `<text x="${xy.x}" y="${xy.y - 10}" text-anchor="middle"
                    fill="${site.color}" font-size="10" font-family="'Outfit',sans-serif"
                    font-weight="600" opacity="0.9">
                    🚀 ${launch.missionName.split('|').pop().trim()}</text>`;
            }
        });

        // ── Cityline silhouette ──
        const skylinePath = buildSkylinePath();
        html += `
          <path d="${skylinePath}" fill="#0d1117" opacity="0.95"/>
          <path d="${skylinePath}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

          <!-- Building window lights -->
          ${generateWindowLights()}
        `;

        // ── Legend ──
        html += `
          <g transform="translate(${PANO_W - 180}, 12)">
            <rect x="-8" y="-6" width="186" height="52" rx="6" fill="rgba(0,0,0,0.5)"/>
            <line x1="0" y1="0" x2="20" y2="0" stroke="${SITES.canaveral.color}" stroke-width="2.5"/>
            <text x="26" y="4" fill="#aaa" font-size="9" font-family="'Outfit',sans-serif">Rocket trajectory</text>
            <line x1="0" y1="14" x2="20" y2="14" stroke="${BOOSTER_COLOR}" stroke-width="1.8" stroke-dasharray="8,5"/>
            <text x="26" y="18" fill="#aaa" font-size="9" font-family="'Outfit',sans-serif">Booster return</text>
            <line x1="0" y1="28" x2="20" y2="28" stroke="${FLARE_COLOR}" stroke-width="3" stroke-dasharray="4,4"/>
            <text x="26" y="32" fill="#aaa" font-size="9" font-family="'Outfit',sans-serif">Flare burn zone</text>
            <line x1="0" y1="42" x2="20" y2="42" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3"/>
            <text x="26" y="46" fill="#666" font-size="8" font-family="'Outfit',sans-serif">Elevation grid (10°)</text>
          </g>`;

        html += `</svg>`;

        // If no visible launches, show a placeholder message inside
        if (visibleLaunches.length === 0) {
            html = `<svg class="horizon-pano" viewBox="0 0 ${PANO_W} ${PANO_H}" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0a0e27"/>
                  <stop offset="40%" stop-color="#111833"/>
                  <stop offset="75%" stop-color="#1a1f3a"/>
                  <stop offset="100%" stop-color="#252a45"/>
                </linearGradient>
              </defs>
              <rect width="${PANO_W}" height="${PANO_H}" fill="url(#sky-grad)"/>
              ${generateStars()}
              ${generateGrid()}
              ${generateCompassLabels()}
              <path d="${buildSkylinePath()}" fill="#0d1117" opacity="0.95"/>
              ${generateWindowLights()}
              <text x="${PANO_W / 2}" y="${PANO_H / 2 - 20}" text-anchor="middle"
                fill="rgba(255,255,255,0.3)" font-size="14" font-family="'Outfit',sans-serif">
                No Vandenberg launches visible from here this week</text>
              <text x="${PANO_W / 2}" y="${PANO_H / 2}" text-anchor="middle"
                fill="rgba(255,255,255,0.15)" font-size="10" font-family="'Outfit',sans-serif">
                Trajectories appear here when Vandenberg SpaceX launches are scheduled</text>
            </svg>`;
        }

        container.innerHTML = html;
    }

    function generateStars() {
        let stars = '';
        let seed = 137;
        function rng() { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; }
        for (let i = 0; i < 80; i++) {
            const x = rng() * PANO_W;
            const y = rng() * (PANO_H - SKYLINE_H - 10);
            const r = 0.3 + rng() * 1.2;
            const op = 0.2 + rng() * 0.5;
            stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="white" opacity="${op.toFixed(2)}"/>`;
        }
        return stars;
    }

    function generateGrid() {
        let grid = '';
        // Elevation lines every 10°
        for (let el = 10; el <= 60; el += 10) {
            const y = PANO_H - SKYLINE_H - ((el / PANO_EL_MAX) * (PANO_H - SKYLINE_H));
            grid += `<line x1="0" y1="${y}" x2="${PANO_W}" y2="${y}"
                stroke="rgba(255,255,255,0.06)" stroke-width="0.5" stroke-dasharray="3,6"/>`;
            grid += `<text x="6" y="${y - 3}" fill="rgba(255,255,255,0.15)" font-size="7"
                font-family="'Outfit',sans-serif">${el}°</text>`;
        }
        // Azimuth lines every 30°
        for (let az = 90; az <= 270; az += 30) {
            const x = ((az - PANO_AZ_MIN) / (PANO_AZ_MAX - PANO_AZ_MIN)) * PANO_W;
            grid += `<line x1="${x}" y1="0" x2="${x}" y2="${PANO_H - SKYLINE_H}"
                stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>`;
        }
        return grid;
    }

    function generateCompassLabels() {
        const labels = [
            { az: 90, text: 'E' },
            { az: 120, text: 'ESE' },
            { az: 150, text: 'SSE' },
            { az: 180, text: 'S' },
            { az: 210, text: 'SSW' },
            { az: 240, text: 'WSW' },
            { az: 270, text: 'W' },
        ];
        return labels.map(l => {
            const x = ((l.az - PANO_AZ_MIN) / (PANO_AZ_MAX - PANO_AZ_MIN)) * PANO_W;
            const isMajor = l.text.length === 1;
            return `<text x="${x}" y="${PANO_H - SKYLINE_H + 12}" text-anchor="middle"
                fill="${isMajor ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)'}"
                font-size="${isMajor ? '11' : '8'}" font-weight="${isMajor ? '700' : '400'}"
                font-family="'Outfit',sans-serif">${l.text}</text>`;
        }).join('');
    }

    function generateWindowLights() {
        let lights = '';
        let seed = 314;
        function rng() { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; }
        for (let i = 0; i < 60; i++) {
            const x = rng() * PANO_W;
            const y = PANO_H - 2 - rng() * (SKYLINE_H - 6);
            const w = 1.5 + rng() * 2;
            const h = 1.5 + rng() * 2;
            const colors = ['#ffeb3b', '#fff9c4', '#ffe0b2', '#ffffff'];
            const col = colors[Math.floor(rng() * colors.length)];
            const op = 0.15 + rng() * 0.35;
            lights += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
                fill="${col}" opacity="${op.toFixed(2)}" rx="0.3"/>`;
        }
        return lights;
    }

    function drawPanoPath(azElPoints, color, strokeWidth, dashArray, opacity, glow) {
        const visPoints = azElPoints.filter(p => p.el > 0 && azInView(p.az));
        if (visPoints.length < 2) return '';

        const xyPoints = visPoints.map(p => azElToPano(p.az, p.el));

        let d = `M ${xyPoints[0].x.toFixed(1)} ${xyPoints[0].y.toFixed(1)}`;
        for (let i = 1; i < xyPoints.length; i++) {
            // Use quadratic curves for smoother arcs
            const prev = xyPoints[i - 1];
            const curr = xyPoints[i];
            const cpx = (prev.x + curr.x) / 2;
            const cpy = Math.min(prev.y, curr.y) - 5; // slight upward curve
            d += ` Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
        }

        let svg = '';

        // Glow effect for flare burns
        if (glow) {
            svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${parseFloat(strokeWidth) + 4}"
                stroke-linecap="round" stroke-linejoin="round" opacity="${opacity * 0.2}"
                filter="url(#flare-glow)" ${dashArray ? `stroke-dasharray="${dashArray}"` : ''}/>`;
        }

        // Main path
        svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
            stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"
            ${dashArray ? `stroke-dasharray="${dashArray}"` : ''}/>`;

        // Waypoint dots
        xyPoints.forEach((pt, i) => {
            if (i % 2 !== 0) return;
            svg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2"
                fill="${color}" opacity="${opacity * 0.6}"/>`;
        });

        // Direction arrow
        if (xyPoints.length >= 2) {
            const end = xyPoints[xyPoints.length - 1];
            const prev = xyPoints[xyPoints.length - 2];
            const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
            const sz = 6;
            const tipX = end.x, tipY = end.y;
            const lx = tipX - sz * Math.cos(angle - 0.5);
            const ly = tipY - sz * Math.sin(angle - 0.5);
            const rx = tipX - sz * Math.cos(angle + 0.5);
            const ry = tipY - sz * Math.sin(angle + 0.5);
            svg += `<polygon points="${tipX},${tipY} ${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}"
                fill="${color}" opacity="${opacity}"/>`;
        }

        return svg;
    }

    // ── SIMULATION ANIMATION ─────────────────

    function simulateLaunch(launch) {
        stopSimulation();
        if (!panoContainer) return;

        const vis = isVisibleFromObserver(launch);
        if (!vis.visible) return;

        simulating = true;
        const site = launch.site;
        const heading = site.defaultHeading;

        // Compute the full trajectory for animation
        const ascentPts = computeTrajectory(launch.padLat, launch.padLon, heading, ASCENT_PROFILE);
        const ascentAzEl = ascentPts.map(p => toAzEl(p.lat, p.lon, p.alt, observer.lat, observer.lon));
        const visPoints = ascentAzEl.filter(p => p.el > 0 && azInView(p.az));

        if (visPoints.length < 2) {
            simulating = false;
            return;
        }

        const xyPoints = visPoints.map(p => azElToPano(p.az, p.el));

        // Create overlay SVG for the animation
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.setAttribute('class', 'pano-sim-overlay');
        overlay.setAttribute('viewBox', `0 0 ${PANO_W} ${PANO_H}`);
        overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        panoContainer.appendChild(overlay);

        // Predicted path (dashed white, dim)
        let pathD = `M ${xyPoints[0].x.toFixed(1)} ${xyPoints[0].y.toFixed(1)}`;
        for (let i = 1; i < xyPoints.length; i++) {
            pathD += ` L ${xyPoints[i].x.toFixed(1)} ${xyPoints[i].y.toFixed(1)}`;
        }
        const ghostPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        ghostPath.setAttribute('d', pathD);
        ghostPath.setAttribute('fill', 'none');
        ghostPath.setAttribute('stroke', 'rgba(255,255,255,0.3)');
        ghostPath.setAttribute('stroke-width', '1.5');
        ghostPath.setAttribute('stroke-dasharray', '4,4');
        overlay.appendChild(ghostPath);

        // Actual trail (green, solid, grows as dot moves)
        const trailPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        trailPath.setAttribute('fill', 'none');
        trailPath.setAttribute('stroke', '#00e676');
        trailPath.setAttribute('stroke-width', '2.5');
        trailPath.setAttribute('stroke-linecap', 'round');
        trailPath.setAttribute('opacity', '0.9');
        overlay.appendChild(trailPath);

        // Glowing animated dot
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', '#00e676');
        dot.setAttribute('opacity', '1');
        overlay.appendChild(dot);

        // Glow halo
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('r', '12');
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', '#00e676');
        halo.setAttribute('stroke-width', '2');
        halo.setAttribute('opacity', '0.3');
        overlay.appendChild(halo);

        // Status label
        const statusLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        statusLabel.setAttribute('fill', '#00e676');
        statusLabel.setAttribute('font-size', '9');
        statusLabel.setAttribute('font-family', "'Outfit',sans-serif");
        statusLabel.setAttribute('font-weight', '600');
        overlay.appendChild(statusLabel);

        const simDuration = 12; // 12 seconds to trace full trajectory
        const tStart = Date.now();

        const animate = () => {
            if (!simulating) return;
            const now = Date.now();
            const progress = Math.min((now - tStart) / (simDuration * 1000), 1);

            // Interpolate position along the trajectory
            const idx = progress * (xyPoints.length - 1);
            const i = Math.min(Math.floor(idx), xyPoints.length - 2);
            const frac = idx - i;
            const cx = xyPoints[i].x + (xyPoints[i + 1].x - xyPoints[i].x) * frac;
            const cy = xyPoints[i].y + (xyPoints[i + 1].y - xyPoints[i].y) * frac;

            dot.setAttribute('cx', cx);
            dot.setAttribute('cy', cy);
            halo.setAttribute('cx', cx);
            halo.setAttribute('cy', cy);

            // Pulse the halo
            const pulse = 10 + 4 * Math.sin(Date.now() / 200);
            halo.setAttribute('r', pulse);

            // Grow the trail
            const trailIdx = Math.floor(idx) + 1;
            let td = `M ${xyPoints[0].x.toFixed(1)} ${xyPoints[0].y.toFixed(1)}`;
            for (let j = 1; j < trailIdx && j < xyPoints.length; j++) {
                td += ` L ${xyPoints[j].x.toFixed(1)} ${xyPoints[j].y.toFixed(1)}`;
            }
            td += ` L ${cx.toFixed(1)} ${cy.toFixed(1)}`;
            trailPath.setAttribute('d', td);

            // Status label with altitude
            const altIdx = Math.floor(progress * (ASCENT_PROFILE.length - 1));
            const altKm = ASCENT_PROFILE[Math.min(altIdx, ASCENT_PROFILE.length - 1)].alt;
            const phase = altKm < 100 ? 'ASCENT' : (altKm < 200 ? 'MECO' : 'UPPER STAGE');
            statusLabel.setAttribute('x', cx + 15);
            statusLabel.setAttribute('y', cy - 5);
            statusLabel.textContent = `${phase}  ${altKm} km`;

            if (progress >= 1) {
                // Hold for a moment then clean up
                setTimeout(() => stopSimulation(), 2000);
                return;
            }

            simRaf = requestAnimationFrame(animate);
        };
        simRaf = requestAnimationFrame(animate);
    }

    function stopSimulation() {
        simulating = false;
        if (simRaf) cancelAnimationFrame(simRaf);
        simRaf = null;
        // Remove overlay
        if (panoContainer) {
            const overlay = panoContainer.querySelector('.pano-sim-overlay');
            if (overlay) overlay.remove();
        }
        // Remove active card highlights
        document.querySelectorAll('.launch-card').forEach(c => c.classList.remove('card-active'));
    }

    // ── PUBLIC API ─────────────────────────────

    return {
        setObserver(lat, lon) { observer = { lat, lon }; },

        async init(obsLat, obsLon, cardsContainer, panoCont) {
            observer = { lat: obsLat, lon: obsLon };
            panoContainer = panoCont;
            await fetchLaunches();
            if (cardsContainer) renderCards(cardsContainer);
            renderPanorama(panoContainer);
        },

        async refresh(cardsContainer, panoCont) {
            panoContainer = panoCont;
            await fetchLaunches();
            if (cardsContainer) renderCards(cardsContainer);
            renderPanorama(panoContainer);
        },

        renderPanorama(container) {
            panoContainer = container;
            renderPanorama(container);
        },

        getLaunches() { return launches; },

        // Trigger simulation for a specific launch by index
        simulateLaunchByIndex(idx, panoCont) {
            if (panoCont) panoContainer = panoCont;
            const launch = launches[idx];
            if (launch) simulateLaunch(launch);
        },

        // Get azimuth bearing from observer to the next launch site
        getNextLaunchAzimuth() {
            if (launches.length === 0) return null;
            const now = Date.now();
            const next = launches.find(l => l.net && l.net.getTime() > now) || launches[0];
            if (!next || !next.site) return null;

            const lat1 = observer.lat * RAD;
            const lon1 = observer.lon * RAD;
            const lat2 = next.padLat * RAD;
            const lon2 = next.padLon * RAD;
            const dLon = lon2 - lon1;
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            let bearing = Math.atan2(y, x) * DEG;
            if (bearing < 0) bearing += 360;

            const dist = haversine(observer.lat, observer.lon, next.padLat, next.padLon);

            return {
                azimuth: bearing,
                distance: dist,
                launch: next,
                siteName: next.locationName || next.site.label,
            };
        },
    };
})();
