/* ────────────────────────────────────────────
   ISS Hunter — Star Map Module
   Bright stars, constellation stickfigures,
   and sky landmark hints for the radar view.
   ──────────────────────────────────────────── */

const StarMap = (() => {
    'use strict';

    const DEG = 180 / Math.PI;
    const RAD = Math.PI / 180;

    // ── BRIGHT STAR CATALOG (RA in hours, Dec in degrees, magnitude) ──
    const STARS = [
        { name: 'Sirius', ra: 6.752, dec: -16.72, mag: -1.46 },
        { name: 'Canopus', ra: 6.399, dec: -52.70, mag: -0.74 },
        { name: 'Arcturus', ra: 14.261, dec: 19.18, mag: -0.05 },
        { name: 'Vega', ra: 18.616, dec: 38.78, mag: 0.03 },
        { name: 'Capella', ra: 5.278, dec: 46.00, mag: 0.08 },
        { name: 'Rigel', ra: 5.242, dec: -8.20, mag: 0.13 },
        { name: 'Procyon', ra: 7.655, dec: 5.22, mag: 0.34 },
        { name: 'Betelgeuse', ra: 5.919, dec: 7.41, mag: 0.42 },
        { name: 'Altair', ra: 19.846, dec: 8.87, mag: 0.76 },
        { name: 'Aldebaran', ra: 4.599, dec: 16.51, mag: 0.85 },
        { name: 'Spica', ra: 13.420, dec: -11.16, mag: 0.97 },
        { name: 'Antares', ra: 16.490, dec: -26.43, mag: 1.09 },
        { name: 'Pollux', ra: 7.755, dec: 28.03, mag: 1.14 },
        { name: 'Fomalhaut', ra: 22.961, dec: -29.62, mag: 1.16 },
        { name: 'Deneb', ra: 20.690, dec: 45.28, mag: 1.25 },
        { name: 'Regulus', ra: 10.140, dec: 11.97, mag: 1.40 },
        { name: 'Castor', ra: 7.577, dec: 31.89, mag: 1.58 },
        { name: 'Bellatrix', ra: 5.419, dec: 6.35, mag: 1.64 },
        { name: 'Polaris', ra: 2.530, dec: 89.26, mag: 1.98 },
        { name: 'Dubhe', ra: 11.062, dec: 61.75, mag: 1.79 },
        { name: 'Merak', ra: 11.031, dec: 56.38, mag: 2.37 },
        { name: 'Phecda', ra: 11.897, dec: 53.69, mag: 2.44 },
        { name: 'Megrez', ra: 12.257, dec: 57.03, mag: 3.31 },
        { name: 'Alioth', ra: 12.900, dec: 55.96, mag: 1.77 },
        { name: 'Mizar', ra: 13.399, dec: 54.93, mag: 2.27 },
        { name: 'Alkaid', ra: 13.792, dec: 49.31, mag: 1.86 },
        { name: 'Schedar', ra: 0.675, dec: 56.54, mag: 2.24 },
        { name: 'Caph', ra: 0.153, dec: 59.15, mag: 2.28 },
        { name: 'Tsih', ra: 0.945, dec: 60.72, mag: 2.47 },
        { name: 'Ruchbah', ra: 1.430, dec: 60.24, mag: 2.68 },
        { name: 'Segin', ra: 1.907, dec: 63.67, mag: 3.37 },
        { name: 'Mintaka', ra: 5.533, dec: -0.30, mag: 2.23 },
        { name: 'Alnilam', ra: 5.603, dec: -1.20, mag: 1.69 },
        { name: 'Alnitak', ra: 5.679, dec: -1.94, mag: 1.77 },
        { name: 'Saiph', ra: 5.796, dec: -9.67, mag: 2.09 },
        { name: 'Denebola', ra: 11.818, dec: 14.57, mag: 2.14 },
    ];

    // ── CONSTELLATION STICK FIGURES (pairs of star names) ──
    const CONSTELLATIONS = [
        {
            name: 'Big Dipper',
            lines: [
                ['Dubhe', 'Merak'], ['Dubhe', 'Megrez'], ['Megrez', 'Phecda'],
                ['Phecda', 'Merak'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'],
                ['Mizar', 'Alkaid']
            ]
        },
        {
            name: 'Cassiopeia',
            lines: [
                ['Segin', 'Ruchbah'], ['Ruchbah', 'Tsih'], ['Tsih', 'Schedar'],
                ['Schedar', 'Caph']
            ]
        },
        {
            name: 'Orion',
            lines: [
                ['Betelgeuse', 'Bellatrix'], ['Betelgeuse', 'Mintaka'],
                ['Bellatrix', 'Mintaka'], ['Mintaka', 'Alnilam'],
                ['Alnilam', 'Alnitak'], ['Alnitak', 'Saiph'],
                ['Mintaka', 'Rigel'], ['Alnitak', 'Rigel'], ['Betelgeuse', 'Saiph']
            ]
        },
        {
            name: 'Summer Triangle',
            lines: [
                ['Vega', 'Altair'], ['Altair', 'Deneb'], ['Deneb', 'Vega']
            ]
        },
    ];

    // ── NAMED LANDMARKS for pass directions ──
    const LANDMARKS = [
        { name: 'Big Dipper', azMin: 300, azMax: 60, decMin: 40 },
        { name: 'Orion', azMin: 150, azMax: 250, decMin: -10 },
        { name: 'Cassiopeia', azMin: 330, azMax: 70, decMin: 50 },
        { name: 'Polaris (North Star)', azMin: 345, azMax: 15, decMin: 85 },
        { name: 'Summer Triangle', azMin: 60, azMax: 180, decMin: 20 },
    ];

    // ── COORDINATE CONVERSION ──

    // Julian date from JS Date
    function julianDate(date) {
        return date.getTime() / 86400000 + 2440587.5;
    }

    // Greenwich Mean Sidereal Time (degrees)
    function gmst(date) {
        const jd = julianDate(date);
        const T = (jd - 2451545.0) / 36525.0;
        let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * T * T - T * T * T / 38710000.0;
        return ((gmstDeg % 360) + 360) % 360;
    }

    // Local Sidereal Time (degrees)
    function lst(date, lonDeg) {
        return ((gmst(date) + lonDeg) % 360 + 360) % 360;
    }

    // RA/Dec → Az/El for observer at given lat/lon at given time
    function raDecToAzEl(raHours, decDeg, date, latDeg, lonDeg) {
        const lstDeg = lst(date, lonDeg);
        const ha = ((lstDeg - raHours * 15) % 360 + 360) % 360; // hour angle in degrees

        const haRad = ha * RAD;
        const decRad = decDeg * RAD;
        const latRad = latDeg * RAD;

        // Altitude
        const sinAlt = Math.sin(decRad) * Math.sin(latRad)
            + Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);
        const alt = Math.asin(sinAlt) * DEG;

        // Azimuth
        const cosA = (Math.sin(decRad) - Math.sin(alt * RAD) * Math.sin(latRad))
            / (Math.cos(alt * RAD) * Math.cos(latRad));
        let az = Math.acos(Math.max(-1, Math.min(1, cosA))) * DEG;
        if (Math.sin(haRad) > 0) az = 360 - az;

        return { az, el: alt };
    }

    // ── RENDERING STATE ──
    let svgLayer = null;
    let opacity = 0.4;

    // Build an SVG overlay that goes inside the radar ring
    function init(radarRing) {
        svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgLayer.setAttribute('class', 'star-map-layer');
        svgLayer.setAttribute('viewBox', '0 0 300 300');
        svgLayer.style.opacity = opacity;
        radarRing.appendChild(svgLayer);
    }

    // Convert az/el to radar-ring x/y (center = 150,150, radius 150)
    function azElToXY(az, el, heading) {
        const R = 140; // leave a little padding
        const relAz = ((az - heading + 360) % 360);
        const r = R * (1 - Math.max(0, el) / 90);
        const theta = (relAz - 90) * RAD;
        return {
            x: 150 + r * Math.cos(theta),
            y: 150 + r * Math.sin(theta)
        };
    }

    // Render all stars, constellations, and labels
    function render(date, latDeg, lonDeg, heading) {
        if (!svgLayer) return;
        svgLayer.innerHTML = '';

        // Pre-compute star positions
        const starPos = {};
        STARS.forEach(s => {
            const pos = raDecToAzEl(s.ra, s.dec, date, latDeg, lonDeg);
            starPos[s.name] = pos;
        });

        // Draw constellation lines first (behind stars)
        CONSTELLATIONS.forEach(c => {
            c.lines.forEach(([a, b]) => {
                const pa = starPos[a];
                const pb = starPos[b];
                if (!pa || !pb) return;
                if (pa.el < -5 && pb.el < -5) return; // both below horizon

                const xyA = azElToXY(pa.az, Math.max(0, pa.el), heading);
                const xyB = azElToXY(pb.az, Math.max(0, pb.el), heading);

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', xyA.x);
                line.setAttribute('y1', xyA.y);
                line.setAttribute('x2', xyB.x);
                line.setAttribute('y2', xyB.y);
                line.setAttribute('stroke', 'rgba(162,155,254,0.35)');
                line.setAttribute('stroke-width', '0.8');
                line.setAttribute('stroke-dasharray', '3,3');
                // Fade lines that are partially below horizon
                if (pa.el < 5 || pb.el < 5) {
                    line.setAttribute('stroke', 'rgba(162,155,254,0.15)');
                }
                svgLayer.appendChild(line);
            });

            // Constellation label at centroid of visible stars
            const visStars = c.lines.flat().filter((v, i, a) => a.indexOf(v) === i)
                .map(n => starPos[n]).filter(p => p && p.el > 5);
            if (visStars.length >= 2) {
                const cx = visStars.reduce((s, p) => s + azElToXY(p.az, p.el, heading).x, 0) / visStars.length;
                const cy = visStars.reduce((s, p) => s + azElToXY(p.az, p.el, heading).y, 0) / visStars.length;
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', cx);
                label.setAttribute('y', cy - 10);
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('fill', 'rgba(162,155,254,0.55)');
                label.setAttribute('font-size', '8');
                label.setAttribute('font-family', "'Outfit',sans-serif");
                label.setAttribute('font-weight', '600');
                label.textContent = c.name;
                svgLayer.appendChild(label);
            }
        });

        // Draw stars
        STARS.forEach(s => {
            const pos = starPos[s.name];
            if (pos.el < -2) return; // below horizon

            const xy = azElToXY(pos.az, Math.max(0, pos.el), heading);
            // Size based on magnitude: brighter = bigger
            const size = Math.max(1, 3.5 - s.mag * 0.7);
            const alpha = pos.el < 5 ? 0.25 : (s.mag < 1 ? 0.9 : 0.6);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', xy.x);
            circle.setAttribute('cy', xy.y);
            circle.setAttribute('r', size);
            circle.setAttribute('fill', `rgba(255,255,245,${alpha})`);
            svgLayer.appendChild(circle);

            // Glow for brightest stars
            if (s.mag < 0.5) {
                const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                glow.setAttribute('cx', xy.x);
                glow.setAttribute('cy', xy.y);
                glow.setAttribute('r', size + 3);
                glow.setAttribute('fill', 'none');
                glow.setAttribute('stroke', `rgba(200,200,255,${alpha * 0.3})`);
                glow.setAttribute('stroke-width', '1');
                svgLayer.appendChild(glow);
            }

            // Label for the brightest stars (mag < 1.5)
            if (s.mag < 1.5 && pos.el > 8) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', xy.x + size + 3);
                text.setAttribute('y', xy.y + 3);
                text.setAttribute('fill', `rgba(200,200,255,${alpha * 0.7})`);
                text.setAttribute('font-size', '6.5');
                text.setAttribute('font-family', "'Outfit',sans-serif");
                text.textContent = s.name;
                svgLayer.appendChild(text);
            }
        });
    }

    // Generate a sky landmark hint for an ISS pass
    function getLandmarkHint(passAz, passEl) {
        // Find which constellation/landmark is closest to the pass direction
        let bestHint = null;
        let bestDist = Infinity;

        STARS.filter(s => s.mag < 1.5).forEach(s => {
            // Simple angular distance on the az circle
            let dAz = Math.abs(passAz - (((s.ra * 15) % 360 + 360) % 360));
            if (dAz > 180) dAz = 360 - dAz;
            if (dAz < bestDist) {
                bestDist = dAz;
                bestHint = s.name;
            }
        });

        if (bestDist < 40 && bestHint) {
            return `Look near ${bestHint}`;
        }

        // Fall back to constellation regions
        for (const lm of LANDMARKS) {
            let inRange;
            if (lm.azMin < lm.azMax) {
                inRange = passAz >= lm.azMin && passAz <= lm.azMax;
            } else {
                inRange = passAz >= lm.azMin || passAz <= lm.azMax;
            }
            if (inRange) {
                return `Look near ${lm.name}`;
            }
        }

        // Cardinal direction fallback
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const dir = dirs[Math.round(passAz / 45) % 8];
        return `Look ${dir} at ${passEl.toFixed(0)}° elevation`;
    }

    function setOpacity(val) {
        opacity = val;
        if (svgLayer) svgLayer.style.opacity = val;
    }

    return { init, render, getLandmarkHint, setOpacity, STARS, raDecToAzEl, azElToXY };
})();
