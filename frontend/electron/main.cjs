const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let backendProcess = null;
const isDev = !app.isPackaged;

function clearDirectory(directory) {
    if (fs.existsSync(directory)) {
        fs.readdirSync(directory).forEach((file) => {
            const curPath = path.join(directory, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                // Recursive delete for directories
                fs.rmSync(curPath, { recursive: true, force: true });
            } else {
                // Delete files
                fs.unlinkSync(curPath);
            }
        });
        console.log(`Electron Cleanup: Cleared ${directory}`);
    }
}

function cleanupFolders() {
    // Paths to backend folders
    let uploadsPath, outputsPath;

    if (isDev) {
        uploadsPath = path.join(__dirname, '..', '..', 'fastapi_backend', 'uploads');
        outputsPath = path.join(__dirname, '..', '..', 'fastapi_backend', 'outputs');
    } else {
        // In production, folders might be in the app data or alongside the binary
        const userDataPath = app.getPath('userData');
        uploadsPath = path.join(userDataPath, 'uploads');
        outputsPath = path.join(userDataPath, 'outputs');
    }

    if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
    if (!fs.existsSync(outputsPath)) fs.mkdirSync(outputsPath, { recursive: true });

    clearDirectory(uploadsPath);
    clearDirectory(outputsPath);
}

function startBackend() {
    if (isDev) return; // In dev we run it manually

    const backendPath = process.platform === 'win32'
        ? path.join(process.resourcesPath, 'backend', 'neural-pitch-backend.exe')
        : path.join(process.resourcesPath, 'backend', 'neural-pitch-backend');

    console.log(`Starting backend from: ${backendPath}`);

    const userDataPath = app.getPath('userData');
    const uploadsPath = path.join(userDataPath, 'uploads');
    const outputsPath = path.join(userDataPath, 'outputs');

    if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
    if (!fs.existsSync(outputsPath)) fs.mkdirSync(outputsPath, { recursive: true });

    backendProcess = spawn(backendPath, [], {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            NP_UPLOAD_DIR: uploadsPath,
            NP_OUTPUT_DIR: outputsPath
        },
        shell: false
    });

    backendProcess.stdout.on('data', (data) => console.log(`Backend: ${data}`));
    backendProcess.stderr.on('data', (data) => console.error(`Backend Error: ${data}`));

    backendProcess.on('close', (code) => {
        console.log(`Backend process exited with code ${code}`);
    });
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        resizable: false, // Lock format
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        },
        backgroundColor: '#0a0a0a',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#0a0a0a',
            symbolColor: '#ffffff'
        }
    });

    const startUrl = isDev
        ? (process.env.ELECTRON_START_URL || 'http://localhost:5173')
        : `file://${path.join(__dirname, '../dist/index.html')}`;
    mainWindow.loadURL(startUrl);
}

app.whenReady().then(() => {
    startBackend();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Perform cleanup when the app is quitting
app.on('will-quit', () => {
    cleanupFolders();
    if (backendProcess) {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
        } else {
            backendProcess.kill('SIGINT');
        }
    }
});

// IPC Handler for Native Drag
ipcMain.handle('start-drag', (event, filePath) => {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    // Resize to 32x32 for a clean ghost image
    const smallIcon = icon.resize({ width: 32, height: 32 });

    event.sender.startDrag({
        file: filePath,
        icon: smallIcon
    });
});
