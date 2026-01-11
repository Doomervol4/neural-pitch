import os
import sys
import datetime

# Move logging to the absolute top to catch any import errors
UPLOAD_DIR = os.environ.get("NP_UPLOAD_DIR", "uploads")
log_path = os.path.join(os.path.dirname(os.path.abspath(UPLOAD_DIR)), "backend.log")

def log_info(msg):
    try:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a") as f:
            f.write(f"[{timestamp}] {msg}\n")
        print(msg)
    except:
        pass

log_info("--- Neural Pitch Backend Booting ---")
log_info(f"Python: {sys.version}")
log_info(f"Env NP_UPLOAD_DIR: {UPLOAD_DIR}")

try:
    import shutil
    import uuid
    import asyncio
    import uvicorn
    from fastapi import FastAPI, UploadFile, File, Form, HTTPException
    from fastapi.responses import FileResponse
    from fastapi.middleware.cors import CORSMiddleware
    from basic_pitch.inference import predict_and_save
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from fastapi.staticfiles import StaticFiles
    log_info("All core modules imported successfully")
except Exception as e:
    import traceback
    log_info(f"CRITICAL IMPORT ERROR: {str(e)}")
    log_info(traceback.format_exc())
    sys.exit(1)

# Handle PyInstaller paths
def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# Correct model path for PyInstaller
MODEL_PATH = get_resource_path("basic_pitch/model_output") if hasattr(sys, '_MEIPASS') else ICASSP_2022_MODEL_PATH
log_info(f"Model Path: {MODEL_PATH}")

app = FastAPI()

# Folders configuration
OUTPUT_DIR = os.environ.get("NP_OUTPUT_DIR", "outputs")

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
                print(f"Failed to delete {file_path}. Reason: {e}")

# Clear folders on startup for a clean slate
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
clear_directory(UPLOAD_DIR)
clear_directory(OUTPUT_DIR)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Detected-Bpm", "X-Bpm-Error", "X-Generated-Filename", "X-Absolute-Path"],
)

async def delayed_delete(file_path: str, delay: int = 60):
    await asyncio.sleep(delay)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except:
            pass

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
    file_id = str(uuid.uuid4())
    input_filename = f"{file_id}_{file.filename}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")
    
    bpm_error = None
    midi_path = None

    try:
        final_tempo = midi_tempo
        if final_tempo <= 0:
            try:
                import librosa
                y, sr = librosa.load(input_path, sr=None, duration=60)
                tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
                if hasattr(tempo_arr, 'item'):
                    tempo = tempo_arr.item()
                elif hasattr(tempo_arr, '__getitem__'):
                    tempo = tempo_arr[0]
                else:
                    tempo = tempo_arr
                final_tempo = int(round(float(tempo)))
            except Exception as e:
                bpm_error = str(e)
                final_tempo = 120

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
        
        base_name = os.path.splitext(input_filename)[0]
        midi_filename = f"{base_name}_basic_pitch.mid"
        midi_path = os.path.join(OUTPUT_DIR, midi_filename)
        
        if not os.path.exists(midi_path):
             raise HTTPException(status_code=500, detail="MIDI generation failed")
             
        abs_path = os.path.abspath(midi_path)
        headers = {
            "X-Detected-Bpm": str(final_tempo),
            "X-Generated-Filename": midi_filename,
            "X-Absolute-Path": abs_path
        }
        if bpm_error:
            headers["X-Bpm-Error"] = bpm_error
        
        return FileResponse(
            midi_path, 
            media_type="audio/midi", 
            filename=f"{os.path.splitext(file.filename)[0]}.mid",
            headers=headers
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
    finally:
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
            except:
                pass

if __name__ == "__main__":
    log_info("Starting uvicorn server on 127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
