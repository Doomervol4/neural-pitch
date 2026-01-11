<p align="center">
  <img src="assets/logo.png" width="128" height="128" alt="Neural Pitch Logo">
</p>

<h1 align="center">Neural Pitch</h1>

<p align="center">
  Desktop application for converting audio to MIDI using Spotify's Basic Pitch model.
</p>

<br>

## Download

**For Users**: Download the latest release for your platform:
- [Windows (.exe)](https://github.com/Doomervol4/neural-pitch/releases) 
- [macOS (.app)](https://github.com/Doomervol4/neural-pitch/releases)

No installation required - just download and run!

---

## For Developers

### Prerequisites
- Python 3.8+
- Node.js 16+

### Setup

```bash
# Clone
git clone https://github.com/Doomervol4/neural-pitch.git
cd neural-pitch

# Backend
cd fastapi_backend
python -m venv venv
venv\Scripts\activate  # Windows (or source venv/bin/activate on Mac/Linux)
pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..
```

### Run Development

**Windows**: Create and run `start_app.bat`:
```batch
@echo off
start cmd /k "cd fastapi_backend && venv\Scripts\activate && uvicorn main:app --port 8000"
timeout /t 3
cd frontend && npm run electron
```

**Manual**:
```bash
# Terminal 1 - Backend
cd fastapi_backend
venv\Scripts\activate
uvicorn main:app --port 8000

# Terminal 2 - Frontend  
cd frontend
npm run electron
```

### Build for Distribution

```bash
cd frontend
npm run electron:build
```

This creates distributable packages in `frontend/dist/`.

> **Note**: To create standalone executables that bundle Python, you'll need to configure PyInstaller for the backend and integrate it with Electron Builder. See [packaging guide](https://www.electronjs.org/docs/latest/tutorial/application-distribution).

## Features

- 🎵 Audio-to-MIDI conversion
- 🎹 Piano roll visualization
- 🎚️ Sensitivity presets
- 💾 Drag & drop export
- 🎨 Dark animated UI

## Tech Stack

**Frontend**: Electron, React, Vite, Tailwind  
**Backend**: FastAPI, Basic Pitch, Librosa

## License

MIT - See [LICENSE](LICENSE)

## Acknowledgments

- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch)
- [html-midi-player](https://github.com/cifkao/html-midi-player)
