import React, { useState, useEffect, useRef } from 'react';
import UploadZone from './components/UploadZone';
import 'html-midi-player';

function App() {
  const [status, setStatus] = useState('booting'); // booting, idle, uploading, processing, success, error
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [staticUrl, setStaticUrl] = useState(null);
  const [absolutePath, setAbsolutePath] = useState(null); // For Electron native drag
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [duration, setDuration] = useState(0);

  // Audio Processing Parameters
  const [params, setParams] = useState({
    onsetThreshold: 0.5,
    frameThreshold: 0.3,
    minNoteLen: 58.0,
    midiTempo: 0.0 // 0 means Auto
  });

  const debounceTimerRef = useRef(null);

  // Playback Progress Logic (Hybrid Event + Polling for perfect sync)
  const playerRef = useRef(null);
  const [playProgress, setPlayProgress] = useState(0);
  const syncRef = useRef({
    isPlaying: false,
    lastFrameTime: 0,
    smoothTime: 0,
    lastActualTime: -1
  });

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handleDurationChange = () => {
      if (player.duration && player.duration > 0) {
        setDuration(player.duration);
      }
    };

    player.addEventListener('load', handleDurationChange);
    player.addEventListener('durationchange', handleDurationChange);

    // Initial check in case it's already loaded
    handleDurationChange();

    return () => {
      player.removeEventListener('load', handleDurationChange);
      player.removeEventListener('durationchange', handleDurationChange);
    };
  }, [downloadUrl]);

  // Polling for engine readiness
  useEffect(() => {
    let interval;
    if (status === 'booting') {
      interval = setInterval(async () => {
        try {
          const resp = await fetch('http://127.0.0.1:8009/health');
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === 'ok') {
              setStatus('idle');
              clearInterval(interval);
            }
          }
        } catch (e) {
          // Engine still starting...
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]);


  const handleFileSelect = (file) => {
    setSelectedFile(file);
    // Reset to Auto (0) for new file
    setParams(p => ({ ...p, midiTempo: 0.0 }));
    processFile(file, { ...params, midiTempo: 0.0 });
  };

  const handleParamChange = (name, value) => {
    const newParams = { ...params, [name]: parseFloat(value) };
    setParams(newParams);

    if (selectedFile && status === 'success') {
      // Stop the MIDI player before reprocessing
      if (playerRef.current) {
        try {
          playerRef.current.stop();
        } catch (e) {
          console.warn("Error stopping player:", e);
        }
      }

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => processFile(selectedFile, newParams), 500);
    }
  };

  const processFile = async (file, currentParams) => {
    setStatus('processing');
    if (window.electron) window.electron.log(`Processing start: ${file.name}`);
    setDownloadUrl(null);
    setErrorMsg('');
    setDuration(0);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('onset_threshold', currentParams.onsetThreshold);
    formData.append('frame_threshold', currentParams.frameThreshold);
    formData.append('min_note_length', currentParams.minNoteLen);
    formData.append('midi_tempo', currentParams.midiTempo);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const response = await fetch('http://127.0.0.1:8009/predict', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        let detail = 'Conversion failed';
        try {
          const json = JSON.parse(text);
          detail = json.detail || json.traceback || detail;
        } catch (e) {
          detail = text.slice(0, 200) || 'Internal Server Error';
        }
        throw new Error(detail);
      }

      // Check for auto-detected BPM header
      const detectedBpm = response.headers.get("X-Detected-Bpm");
      const bpmError = response.headers.get("X-Bpm-Error");
      const generatedFilename = response.headers.get("X-Generated-Filename");
      const absPath = response.headers.get("X-Absolute-Path");

      if (generatedFilename) {
        setStaticUrl(`http://127.0.0.1:8001/outputs/${generatedFilename}`);
      } else {
        setStaticUrl(null);
      }

      if (absPath) {
        setAbsolutePath(absPath);
      }

      if (detectedBpm && currentParams.midiTempo === 0) {
        const bpmVal = parseFloat(detectedBpm);
        setParams(p => ({ ...p, midiTempo: bpmVal }));

        if (bpmError) {
          console.warn("BPM Detection Error:", bpmError);
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus('success');
    } catch (err) {
      if (window.electron) window.electron.log(`Fetch Error: ${err.message}`);
      console.error(err);
      setErrorMsg(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const testConnection = async () => {
    if (window.electron) window.electron.log('Testing connection from UI...');
    try {
      const resp = await fetch('http://127.0.0.1:8009/health');
      const data = await resp.json();
      if (data.status === 'ok') {
        alert("Succès ! Le moteur répond (v" + data.version + ")");
      } else {
        alert("Réponse inattendue : " + JSON.stringify(data));
      }
    } catch (err) {
      if (window.electron) window.electron.log(`Conn Test Error: ${err.message}`);
      alert("Erreur de liaison : " + err.message + "\nAssurez-vous que le moteur est bien lancé sur le port 8009.");
    }
  };


  return (
    <div className="min-h-screen w-full relative z-10 flex flex-col p-8 font-outfit text-white/90 overflow-hidden">

      {/* Animated Background Blobs */}
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>

      {/* Native Window Drag Handle - VISIBLE BAR AT TOP */}
      <div
        className="fixed top-0 left-0 right-0 h-8 z-[100] bg-transparent cursor-default"
        style={{ WebkitAppRegion: 'drag' }}
      ></div>

      {/* Navbar / Logo Area */}
      <header className="flex justify-between items-center mb-12 border-b border-white/5 pb-6 select-none relative z-[101] mt-4">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 border border-white/20 grid grid-cols-2 gap-1 p-1">
            <div className="bg-emerald-400 rounded-sm"></div>
            <div className="bg-white/10 rounded-sm"></div>
            <div className="bg-white/10 rounded-sm"></div>
            <div className="bg-emerald-400 rounded-sm"></div>
          </div>
          <h1 className="text-xl font-light tracking-[0.2em] uppercase">Neural<span className="font-bold text-white">Pitch</span></h1>
        </div>
      </header>

      {/* Main Content Wrapper */}
      <div className={`flex-grow flex items-center justify-center transition-all duration-700 ${status === 'success' ? 'items-start' : 'items-center'}`}>
        <div className={`w-full max-w-[1700px] grid gap-12 ${status === 'success' ? 'lg:grid-cols-12' : 'grid-cols-1 max-w-2xl'}`}>

          {/* LEFT PANEL: Controls */}
          <div className={`${status === 'success' ? 'lg:col-span-3' : ''} flex flex-col gap-6`}>
            <div className="mb-4">
              <h2 className="text-4xl font-light leading-tight">
                {status === 'booting' && "Neural Engine Initializing."}
                {status === 'idle' && "Audio to MIDI Transformation."}
                {status === 'processing' && "Topology Analysis."}
                {status === 'success' && "Analysis Complete."}
                {status === 'error' && "Process Interrupted."}
              </h2>
            </div>

            <div className="bg-[#0a0a0a] border border-white/10 p-6 rounded-sm shadow-2xl relative">
              {/* Decoration lines */}
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-emerald-500"></div>
              <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-emerald-500"></div>
              <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-emerald-500"></div>
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-emerald-500"></div>

              {status === 'booting' && (
                <div className="h-48 flex flex-col items-center justify-center space-y-6">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-2 border-emerald-500/10 rounded-full"></div>
                    <div className="absolute inset-0 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <div className="text-[10px] font-mono text-emerald-500/50 uppercase tracking-[0.2em] animate-pulse">
                    Loading Neural Weights...
                  </div>
                </div>
              )}

              {status === 'idle' && <UploadZone onFileSelect={handleFileSelect} />}

              {status === 'processing' && (
                <div className="h-48 flex flex-col items-center justify-center space-y-6">
                  <div className="w-full max-w-[140px] h-1 bg-white/10 overflow-hidden">
                    <div className="h-full bg-emerald-400 w-1/3 animate-[slide_1s_infinite_linear]"></div>
                  </div>
                  <div className="text-xs font-mono text-emerald-500 uppercase tracking-widest animate-pulse">
                    Calculating...
                  </div>
                </div>
              )}

              {status === 'success' && (
                <div className="space-y-6">
                  {/* Preset & Parameters */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Presets</h3>
                      <div className="flex gap-1.5">
                        {[
                          { id: 'clean', label: 'Clean', onset: 0.7, frame: 0.4, minLen: 100 },
                          { id: 'standard', label: 'Standard', onset: 0.5, frame: 0.3, minLen: 58 },
                          { id: 'sensitive', label: 'Detailed', onset: 0.3, frame: 0.2, minLen: 30 }
                        ].map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              // Stop the MIDI player before applying preset
                              if (playerRef.current) {
                                try {
                                  playerRef.current.stop();
                                } catch (e) {
                                  console.warn("Error stopping player:", e);
                                }
                              }

                              const newParams = { ...params, onsetThreshold: p.onset, frameThreshold: p.frame, minNoteLen: p.minLen };
                              setParams(newParams);
                              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                              debounceTimerRef.current = setTimeout(() => processFile(selectedFile, newParams), 500);
                            }}
                            className="px-2 py-1 text-[9px] border border-white/10 hover:border-emerald-500/50 hover:text-emerald-400 transition-all uppercase"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-5">
                      {[
                        { id: 'onsetThreshold', label: 'Sensitivity', min: 0.1, max: 0.9, step: 0.05 },
                        { id: 'frameThreshold', label: 'Sustain', min: 0.1, max: 0.9, step: 0.05 },
                        { id: 'minNoteLen', label: 'Vibrato Filter', min: 10, max: 200, step: 10 },
                        { id: 'midiTempo', label: 'Tempo (BPM)', min: 60, max: 200, step: 2 }
                      ].map((p) => (
                        <div key={p.id} className="space-y-2 group">
                          <div className="flex justify-between text-[9px] uppercase tracking-wider text-white/30 truncate">
                            <label>{p.label}</label>
                            <span className="font-mono text-emerald-400">{p.id === 'midiTempo' && params[p.id] === 0 ? "AUTO" : params[p.id]}</span>
                          </div>
                          <input
                            type="range"
                            min={p.min} max={p.max} step={p.step}
                            value={params[p.id]}
                            onChange={(e) => handleParamChange(p.id, e.target.value)}
                            className="w-full h-1 bg-white/5 appearance-none cursor-pointer accent-emerald-500/50 hover:accent-emerald-400"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-white/5 space-y-3">
                      <div className="flex gap-3">
                        <div
                          draggable="true"
                          onDragStart={(e) => {
                            if (window.electron && absolutePath) {
                              e.preventDefault();
                              window.electron.startDrag(absolutePath);
                              return;
                            }
                            e.dataTransfer.effectAllowed = 'copy';
                            const finalUrl = staticUrl || new URL(downloadUrl).href;
                            const filename = 'output.mid';
                            e.dataTransfer.setData('DownloadURL', `application/octet-stream:${filename}:${finalUrl}`);
                            e.dataTransfer.setData('text/uri-list', finalUrl);
                            e.dataTransfer.setData('text/plain', finalUrl);
                          }}
                          className="bg-emerald-500/10 border border-emerald-500/50 w-12 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-emerald-500/20 transition-colors rounded-sm group"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l3 3m0 0l3-3m-3 3v-7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <a href={downloadUrl} download="output.mid" className="flex-grow py-3 bg-white text-black text-center text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors flex items-center justify-center">
                          Export MIDI
                        </a>
                      </div>
                      <button onClick={() => { setStatus('idle'); setSelectedFile(null); }} className="block w-full py-3 border border-white/10 text-white/30 text-center text-[10px] font-bold uppercase tracking-widest hover:border-white/30 hover:text-white transition-colors">
                        Start Over
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="py-8 text-center space-y-4">
                  <div className="text-red-500 font-mono text-xs uppercase tracking-widest border border-red-500/20 inline-block px-3 py-1">System Error</div>
                  <p className="text-white/50 text-sm">{errorMsg}</p>
                  <div className="flex justify-center gap-4">
                    <button onClick={() => setStatus('idle')} className="text-xs font-bold underline hover:text-emerald-400 uppercase tracking-widest">Reset</button>
                    <button onClick={testConnection} className="text-xs font-bold underline hover:text-emerald-500 uppercase tracking-widest">Test Link</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Visualizer */}
          {status === 'success' && (
            <div className="lg:col-span-9 animate-in slide-in-from-right-10 duration-1000 relative">
              <div className="absolute top-0 right-0 p-4 z-20 flex gap-4 text-[10px] font-mono text-white/20 uppercase tracking-widest">
                <span>Model: NeuralPitch</span>
                <span>Mode: Lab</span>
              </div>

              <div className="h-[75vh] min-h-[550px] bg-[#050505] border border-white/10 p-1 rounded-sm relative shadow-2xl flex flex-col">
                <div className="flex-grow w-full border border-white/5 bg-[#030303] flex flex-col relative overflow-hidden">
                  <div className="absolute inset-0 pointer-events-none opacity-10" style={{
                    backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                    backgroundPosition: 'center'
                  }}></div>

                  {/* VISUALIZER AREA - Simple clean display */}
                  <div className="flex-grow overflow-hidden p-8 z-10">
                    <div className="h-full border border-white/10 bg-black relative">
                      <midi-visualizer
                        type="piano-roll" id="labVisualizer" src={downloadUrl}
                        style={{ width: '100%', height: '100%', background: 'transparent' }}
                      ></midi-visualizer>
                    </div>
                  </div>


                  {/* Player Bar at the bottom */}
                  <div className="px-8 py-4 border-t border-white/5 bg-[#050505] z-40">
                    <midi-player ref={playerRef} src={downloadUrl} sound-font visualizer="#labVisualizer" style={{ width: '100%' }}></midi-player>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
