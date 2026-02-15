# ISS Hunter 🛰️

**Track & spot the International Space Station in real time.**

ISS Hunter is a browser-based app that helps you locate, track, and predict when the ISS will be visible from your location. No server, no build step — just open `index.html`.

![HTML](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)

---

## ✨ Features

- **Live ISS Tracking** — Real-time latitude, longitude, altitude, velocity, and slant range updated every few seconds
- **Radar View** — Interactive compass radar showing the ISS position relative to you with azimuth/elevation readouts
- **Pass Predictions** — SGP4-powered orbital propagation (via [satellite.js](https://github.com/shashwatak/satellite-js)) predicts upcoming visible passes from your location
- **Star Map Overlay** — Bright stars, constellation stick figures (Big Dipper, Orion, Cassiopeia, Summer Triangle), and sky landmark hints overlaid on the radar
- **Southern Horizon Panorama** — SVG-rendered cityline view showing rocket launch trajectories from Florida & Vandenberg
- **SpaceX Launch Tracker** — Upcoming launches with countdown timers, trajectory simulation, and visibility assessment
- **Weather Integration** — Optional cloud cover data via [Visual Crossing API](https://www.visualcrossing.com/) for spotting condition assessment
- **3D Pointer Arrow** — CSS 3D arrow pointing toward the ISS's current position
- **Radar Beep** — Audio feedback that increases in pitch as the ISS approaches overhead
- **Light Pollution Awareness** — Bortle scale indicator for your location
- **Multiple Location Inputs** — Auto-detect via GPS, enter a ZIP code, or set coordinates manually

## 🚀 Getting Started

### Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/krajeshj/space-hunter.git
   cd space-hunter
   ```
2. Open `index.html` in any modern browser.
3. Allow location access when prompted (or enter your location manually).

### Weather Data (Optional)

For cloud cover information, get a free API key from [Visual Crossing](https://www.visualcrossing.com/sign-up) and enter it when prompted on first launch.

## 📁 Project Structure

```
space-hunter/
├── index.html      # Main app shell & UI structure
├── style.css       # Full styling — glassmorphism, dark theme, animations
├── app.js          # Core app logic — ISS tracking, pass prediction, radar, weather
├── starmap.js      # Star catalog, constellation rendering, sky landmark hints
├── launches.js     # SpaceX launch fetching, trajectory sim, panorama renderer
├── .gitignore      # Git ignore rules
└── README.md       # This file
```

## 🌐 Data Sources

| Data | Source |
|------|--------|
| ISS position | [Where the ISS at?](https://wheretheiss.at/) API |
| Orbital elements (TLE) | [CelesTrak](https://celestrak.org/) |
| Weather / cloud cover | [Visual Crossing](https://www.visualcrossing.com/) |
| Upcoming launches | [Launch Library 2](https://thespacedevs.com/llapi) |
| SGP4 propagation | [satellite.js](https://github.com/shashwatak/satellite-js) |

## 🛠️ Tech Stack

- **Pure HTML / CSS / JavaScript** — no frameworks, no build step
- **satellite.js** (CDN) — SGP4/SDP4 orbital propagation for pass predictions
- **Google Fonts** — Outfit + JetBrains Mono
- **CSS Glassmorphism** — frosted glass cards, dark space theme, smooth animations

## 📄 License

This project is open source. Feel free to use, modify, and distribute.
