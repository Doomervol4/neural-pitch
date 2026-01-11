const { app, BrowserWindow, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

/**
 * 1. ULTRA-SAFE LOGGING
 * Created in System Temp folder to bypass any permission issues
 * in the installation folder or AppData during early boot.
 */
const debugLogPath = path.join(os.tmpdir(), 'neural_pitch_debug.log');

function log(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}\n`;
    try {
        fs.appendFileSync(debugLogPath, fullMsg);
    } catch (e) {
        // Nowhere else to log if this fails
    }
}

// Initial Telemetry
try {
    log('=== APP PROCESS STARTING ===');
    log(`Exe Path: ${process.execPath}`);
    log(`CWD: ${process.cwd()}`);
    log(`Platform: ${process.platform}`);
    log(`IsPackaged: ${app.isPackaged}`);
} catch (e) { }

let backendProcess = null;
const isDev = !app.isPackaged;

// 2. GLOBAL CRASH HANDLER
process.on('uncaughtException', (err) => {
    const errorMsg = `UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`;
    log(errorMsg);
    try {
        dialog.showErrorBox('Fatal Startup Error', errorMsg);
    } catch (e) { }
    app.quit();
});

process.on('unhandledRejection', (reason, promise) => {
    log(`UNHANDLED REJECTION: ${reason}`);
});


function clearDirectory(directory) {
    if (fs.existsSync(directory)) {
        try {
            fs.readdirSync(directory).forEach((file) => {
                const curPath = path.join(directory, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    fs.rmSync(curPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            log(`Cleanup: Cleared ${directory}`);
        } catch (e) {
            log(`Cleanup Error: ${e.message}`);
        }
    }
}

function cleanupFolders() {
    try {
        const userData = app.getPath('userData');
        let uploadsPath, outputsPath;

        if (isDev) {
            uploadsPath = path.join(__dirname, '..', '..', 'fastapi_backend', 'uploads');
            outputsPath = path.join(__dirname, '..', '..', 'fastapi_backend', 'outputs');
        } else {
            uploadsPath = path.join(userData, 'uploads');
            outputsPath = path.join(userData, 'outputs');
        }

        if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
        if (!fs.existsSync(outputsPath)) fs.mkdirSync(outputsPath, { recursive: true });

        clearDirectory(uploadsPath);
        clearDirectory(outputsPath);
    } catch (e) {
        log(`cleanupFolders Error: ${e.message}`);
    }
}

function startBackend() {
    try {
        if (isDev) return;

        // Path to backend in production (resources/backend/neural-pitch-backend.exe)
        const backendPath = process.platform === 'win32'
            ? path.join(process.resourcesPath, 'backend', 'neural-pitch-backend.exe')
            : path.join(process.resourcesPath, 'backend', 'neural-pitch-backend');

        log(`Targeting backend: ${backendPath}`);

        const userData = app.getPath('userData');
        const uploadsPath = path.join(userData, 'uploads');
        const outputsPath = path.join(userData, 'outputs');

        if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
        if (!fs.existsSync(outputsPath)) fs.mkdirSync(outputsPath, { recursive: true });

        if (!fs.existsSync(backendPath)) {
            const err = `CRITICAL: Backend not found at ${backendPath}`;
            log(err);
            dialog.showErrorBox('Engine Missing', err);
            return;
        }

        backendProcess = spawn(backendPath, [], {
            env: {
                ...process.env,
                NODE_ENV: 'production',
                NP_UPLOAD_DIR: uploadsPath,
                NP_OUTPUT_DIR: outputsPath
            },
            shell: false
        });

        backendProcess.stdout.on('data', (data) => log(`[Engine Out]: ${data}`));
        backendProcess.stderr.on('data', (data) => log(`[Engine Err]: ${data}`));

        backendProcess.on('close', (code) => {
            log(`Engine process exited (Code: ${code})`);
        });

        backendProcess.on('error', (err) => {
            log(`Engine failed to spawn: ${err.message}`);
        });

    } catch (e) {
        log(`startBackend Exception: ${e.message}`);
    }
}

function createWindow() {
    try {
        log('Initializing Main Window...');
        const mainWindow = new BrowserWindow({
            width: 1500,
            height: 900,
            resizable: false,
            // Temporarily removed icon property to eliminate it as a crash source
            backgroundColor: '#0a0a0a',
            titleBarStyle: 'hidden',
            titleBarOverlay: {
                color: '#0a0a0a',
                symbolColor: '#ffffff'
            },
            webPreferences: {
                preload: path.join(__dirname, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: false
            }
        });

        if (isDev) {
            mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:5173');
        } else {
            const indexPath = path.join(__dirname, '../dist/index.html');
            log(`Loading frontend: ${indexPath}`);
            if (!fs.existsSync(indexPath)) {
                log(`ERROR: index.html not found!`);
            }
            mainWindow.loadFile(indexPath);
        }

        mainWindow.webContents.on('did-finish-load', () => log('UI loaded successfully'));
        mainWindow.webContents.on('did-fail-load', (e, code, desc) => log(`UI load failed: ${code} (${desc})`));

    } catch (e) {
        log(`createWindow Exception: ${e.message}`);
        dialog.showErrorBox('Startup Error', `Window creation failed: ${e.message}`);
    }
}

// 3. APP LIFECYCLE
app.whenReady().then(() => {
    log('Electron Ready');
    try {
        cleanupFolders();
        startBackend();
        createWindow();
    } catch (e) {
        log(`Ready error: ${e.message}`);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    log('Terminating App...');
    try {
        if (backendProcess) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
            } else {
                backendProcess.kill('SIGINT');
            }
        }
    } catch (e) { }
});

// IPC for Native Drag-and-Drop
ipcMain.handle('start-drag', (event, filePath) => {
    try {
        const iconPath = path.join(__dirname, 'icon.png');
        if (fs.existsSync(iconPath)) {
            const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
            event.sender.startDrag({ file: filePath, icon });
        } else {
            event.sender.startDrag({ file: filePath, icon: nativeImage.createEmpty() });
        }
    } catch (e) {
        log(`Drag Error: ${e.message}`);
    }
});

ipcMain.on('log', (event, msg) => {
    log(`[Renderer]: ${msg}`);
});
