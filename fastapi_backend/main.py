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

# Setup basic logging immediately in AppData
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
        print(msg)
    except:
        pass

log_info("--- Neural Pitch Backend Starting ---")
log_info(f"Python: {sys.version}")
log_info(f"Log Path: {log_path}")
log_info(f"CWD: {os.getcwd()}")
log_info(f"Resources: {getattr(sys, 'resourcesPath', 'N/A')}")
log_info(f"MEIPASS: {getattr(sys, '_MEIPASS', 'N/A')}")

# Try to import heavy modules
try:
    from basic_pitch.inference import predict_and_save
    from basic_pitch import ICASSP_2022_MODEL_PATH
    log_info("Basic Pitch modules loaded")
except Exception as e:
    log_info(f"IMPORT ERROR: {str(e)}")
    log_info(traceback.format_exc())

# Handle PyInstaller paths
def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# Correct model path for PyInstaller
MODEL_PATH = get_resource_path("basic_pitch/model_output") if hasattr(sys, '_MEIPASS') else ICASSP_2022_MODEL_PATH
log_info(f"Model Path: {MODEL_PATH}")

app = FastAPI()

# Middleware to catch ALL errors and return JSON
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    err_msg = traceback.format_exc()
    log_info(f"GLOBAL ERROR during {request.url.path}: {err_msg}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": err_msg},
    )

# Folders configuration
def clear_directory(directory):
    if os.path.exists(directory):
        for filename in os.listdir(directory):
            file_path = os.path.join(directory, filename)
            try:
                if os.path.isfile(file_path) or os.path.islink(file_path):
                    os.unlink(file_path)
                elif os.path.isdir(file_path):
                    shutil.rmtree(file_path)
            except Exception as e:
                log_info(f"Failed to delete {file_path}: {e}")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
clear_directory(UPLOAD_DIR)
clear_directory(OUTPUT_DIR)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Detected-Bpm", "X-Bpm-Error", "X-Generated-Filename", "X-Absolute-Path"],
)

@app.get("/")
def read_root():
    return {"message": "Neural Pitch API is running"}

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    onset_threshold: float = Form(0.5),
    frame_threshold: float = Form(0.3),
    min_note_length: float = Form(58.0),
    midi_tempo: int = Form(0),
):
    log_info(f"--- Processing Request: {file.filename} ---")
    file_id = str(uuid.uuid4())
    input_filename = f"{file_id}_{file.filename}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    
    log_info(f"Saving uploaded file to: {input_path}")
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        log_info("File saved successfully")
    except Exception as e:
        log_info(f"FILE SAVE ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")
    
    bpm_error = None
    midi_path = None

    try:
        final_tempo = midi_tempo
        if final_tempo <= 0:
            log_info("Starting tempo auto-detection...")
            try:
                import librosa
                # Use a shorter duration for faster detection
                y, sr = librosa.load(input_path, sr=None, duration=30)
                tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
                if hasattr(tempo_arr, 'item'):
                    tempo = tempo_arr.item()
                elif hasattr(tempo_arr, '__getitem__'):
                    tempo = tempo_arr[0]
                else:
                    tempo = tempo_arr
                final_tempo = int(round(float(tempo)))
                log_info(f"Tempo detected: {final_tempo} BPM")
            except Exception as e:
                log_info(f"Tempo detection failed: {e}")
                bpm_error = str(e)
                final_tempo = 120

        log_info(f"Entering core prediction (model={MODEL_PATH})...")
        predict_and_save(
            audio_path_list=[input_path],
            output_directory=OUTPUT_DIR,
            save_midi=True,
            sonify_midi=False,
            save_model_outputs=False,
            save_notes=False,
            model_or_model_path=MODEL_PATH,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_length,
            midi_tempo=final_tempo
        )
        log_info("Core prediction completed successfully")
        
        base_name = os.path.splitext(input_filename)[0]
        midi_filename = f"{base_name}_basic_pitch.mid"
        midi_path = os.path.join(OUTPUT_DIR, midi_filename)
        
        if not os.path.exists(midi_path):
             log_info("MIDI file NOT found after prediction")
             raise HTTPException(status_code=500, detail="MIDI generation failed")
             
        log_info(f"Successfully generated MIDI: {midi_path}")
        abs_path = os.path.abspath(midi_path)
        headers = {
            "X-Detected-Bpm": str(final_tempo),
            "X-Generated-Filename": midi_filename,
            "X-Absolute-Path": abs_path
        }
        if bpm_error: headers["X-Bpm-Error"] = bpm_error
        
        return FileResponse(
            midi_path, media_type="audio/midi", 
            filename=f"{os.path.splitext(file.filename)[0]}.mid",
            headers=headers
        )

    finally:
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
            except:
                pass

if __name__ == "__main__":
    log_info("Starting server on 127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
