import os
import sys
import datetime
import shutil
import uuid
import asyncio
import traceback
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 1. FORCE UTF-8 FOR EMOJIS (Fix UnicodeEncodeError on Windows)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

# 1. IMMEDIATE LOGGING SETUP
if sys.platform == "win32":
    base_log_folder = os.environ.get("APPDATA", os.path.expanduser("~"))
else:
    base_log_folder = os.path.expanduser("~")

log_dir = os.path.join(base_log_folder, "Neural Pitch")
os.makedirs(log_dir, exist_ok=True)
log_path = os.path.join(log_dir, "backend.log")

def log_info(msg):
    try:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {msg}\n")
            f.flush()
        print(msg)
    except:
        pass

log_info("--- ENGINE BOOT ---")

# 2. FORCE MULTIPART BUNDLING
try:
    import multipart
    log_info("Multipart library detected")
except Exception as e:
    log_info(f"Multipart library MISSING: {e}")

# Try to import heavy modules early
try:
    from basic_pitch.inference import predict_and_save
    from basic_pitch import ICASSP_2022_MODEL_PATH
    log_info("Neural AI modules loaded")
except Exception as e:
    log_info(f"AI LOAD ERROR: {e}")
    log_info(traceback.format_exc())

# Handle PyInstaller paths
def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

MODEL_PATH = get_resource_path(os.path.join("basic_pitch", "saved_models", "icassp_2022", "nmp")) if hasattr(sys, '_MEIPASS') else ICASSP_2022_MODEL_PATH

log_info(f"Targeting MODEL_PATH: {MODEL_PATH}")
if os.path.exists(MODEL_PATH):
    try:
        files = os.listdir(MODEL_PATH)
        log_info(f"Model Dir Content: {files}")
    except Exception as e:
        log_info(f"ERROR reading model dir: {e}")
else:
    log_info("CRITICAL: MODEL_PATH does not exist!")

# 3. APP DEFINITION
app = FastAPI()

# 4. ROBUST LOGGING MIDDLEWARE (Added first to be executed last)
@app.middleware("http")
async def log_requests(request: Request, call_next):
    log_info(f"INC: {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        log_info(f"OUT: {request.url.path} [{response.status_code}]")
        return response
    except Exception as e:
        err = traceback.format_exc()
        log_info(f"CRASH IN MIDDLEWARE: {err}")
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": err})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 5. ENDPOINTS
@app.get("/")
def read_root():
    log_info("Root ping received")
    return {"status": "online", "message": "Neural Engine Core Active"}

@app.get("/health")
def health_check():
    log_info("Health check received")
    return {"status": "ok", "version": "1.1.7"}

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    onset_threshold: float = Form(0.5),
    frame_threshold: float = Form(0.3),
    min_note_length: float = Form(58.0),
    midi_tempo: int = Form(0),
):
    log_info(f"START Prediction: {file.filename}")
    
    upload_dir = os.environ.get("NP_UPLOAD_DIR", "uploads")
    output_dir = os.environ.get("NP_OUTPUT_DIR", "outputs")
    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    file_id = str(uuid.uuid4())
    input_path = os.path.join(upload_dir, f"{file_id}_{file.filename}")
    
    log_info(f"Saving temporary file...")
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        log_info("File saved to disk")
    except Exception as e:
        log_info(f"SAVE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # BPM DETECTION
    detected_bpm = 120
    bpm_error = None
    try:
        import librosa
        import numpy as np
        log_info("Detecting BPM...")
        y, sr = librosa.load(input_path, sr=None)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        
        # In newer librosa, tempo might be an array or a float
        if isinstance(tempo, (list, np.ndarray)):
            detected_bpm = float(tempo[0])
        else:
            detected_bpm = float(tempo)
            
        detected_bpm = round(detected_bpm)
        log_info(f"Detected BPM: {detected_bpm}")
    except Exception as e:
        bpm_error = str(e)
        log_info(f"BPM Error: {bpm_error}")

    try:
        # AI Processing
        log_info("Running Neural Inference...")
        predict_and_save(
            audio_path_list=[input_path],
            output_directory=output_dir,
            save_midi=True,
            sonify_midi=False,
            save_model_outputs=False,
            save_notes=False,
            model_or_model_path=MODEL_PATH,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_length,
            midi_tempo=midi_tempo if midi_tempo > 0 else (detected_bpm if detected_bpm > 0 else 120)
        )
        log_info("Inference complete")
        
        # Find generated file
        midi_filename = f"{os.path.splitext(os.path.basename(input_path))[0]}_basic_pitch.mid"
        midi_path = os.path.join(output_dir, midi_filename)
        
        if not os.path.exists(midi_path):
             log_info("CRITICAL: Output file missing")
             raise HTTPException(status_code=500, detail="Output generation failed")
             
        log_info("Returning result")
        return FileResponse(
            midi_path, media_type="audio/midi", 
            filename=f"{os.path.splitext(file.filename)[0]}.mid",
            headers={
                "X-Absolute-Path": os.path.abspath(midi_path),
                "X-Detected-Bpm": str(detected_bpm),
                "X-Bpm-Error": bpm_error if bpm_error else ""
            }
        )

    finally:
        if os.path.exists(input_path):
            os.remove(input_path)

if __name__ == "__main__":
    try:
        log_info("Launching Engine on port 8009...")
        uvicorn.run(app, host="0.0.0.0", port=8009, log_level="info")
    except Exception as e:
        log_info(f"FATAL SERVER ERROR: {e}")
        log_info(traceback.format_exc())
