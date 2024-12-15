import {app, BrowserWindow, Tray, Menu, ipcMain, dialog, Notification} from 'electron';
import semver from "semver";
import {download} from 'electron-dl';
import fs from "fs";
import {exec} from 'child_process';
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BaleApp {
    constructor() {
        this.mainWindow = null;
        this.tray = null;
        this.initNotificationHandlers();
        this.initApp();
    }

    initNotificationHandlers() {
        if (!Notification.isSupported()) {
            console.error('Notifications are not supported');
        }
    }

    createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            icon: this.getIconPath(),
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: false,
                enableRemoteModule: false,
                preload: path.join(__dirname, 'preload.js')
            },
        });

        this.mainWindow.removeMenu();

        this.mainWindow.webContents.setWindowOpenHandler(this.handleExternalLinks);

        this.mainWindow.loadURL('https://web.bale.ai/');

        this.setupWindowEvents();
        this.setupPermissions();
        this.setupNotificationListener();
        this.injectCustomAssets();
    }

    handleExternalLinks = (details) => {
        require('electron').shell.openExternal(details.url);
        return {action: 'deny'};
    }

    setupNotificationListener() {
        this.mainWindow.webContents.executeJavaScript(`
            Notification.requestPermission().then(permission => {
                console.log('Notification permission:', permission);
            });
        `);

        ipcMain.on('create-notification', (event, {title, body, icon}) => {
            try {
                const notification = new Notification({
                    title: title,
                    body: body || '',
                    icon: this.getIconPath()
                });

                notification.show();

                notification.on('click', () => {
                    this.mainWindow.show();
                });
            } catch (error) {
                console.error('Error creating notification:', error);
            }
        });
    }

    setupPermissions() {
        this.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'notifications') {
                callback(true);
            } else {
                callback(false);
            }
        });
    }

    injectCustomAssets() {
        this.mainWindow.webContents.on('dom-ready', () => {
            try {
                this.injectCSS();
                this.injectJS();
            } catch (error) {
                console.error('Error injecting assets:', error);
            }
        });
    }

    injectCSS() {
        const cssPath = path.join(__dirname, 'assets', 'style.css');
        if (fs.existsSync(cssPath)) {
            const cssContent = fs.readFileSync(cssPath, 'utf-8');
            this.mainWindow.webContents.insertCSS(cssContent);
        }
    }

    injectJS() {
        const jsPath = path.join(__dirname, 'assets', 'script.js');
        if (fs.existsSync(jsPath)) {
            const jsContent = fs.readFileSync(jsPath, 'utf-8');
            this.mainWindow.webContents.executeJavaScript(jsContent);
        }
    }

    createTray() {
        this.tray = new Tray(this.getIconPath());
        const contextMenu = Menu.buildFromTemplate([
            {label: 'نمایش', click: () => this.mainWindow.show()},
            {label: 'خروج', click: () => app.exit()},
        ]);

        this.tray.setToolTip('Bale');
        this.tray.setContextMenu(contextMenu);
        this.setupTrayEvents();
    }

    setupTrayEvents() {
        this.tray.on('click', () => {
            this.mainWindow.isVisible() ? this.mainWindow.hide() : this.mainWindow.show();
        });
    }

    setupWindowEvents() {
        this.mainWindow.on('close', (event) => {
            if (!app.isQuiting) {
                event.preventDefault();
                this.mainWindow.hide();
            }
        });
    }

    getIconPath() {
        return path.join(__dirname, 'icon.png');
    }

    initApp() {
        const gotTheLock = app.requestSingleInstanceLock();
        if (!gotTheLock) {
            app.exit();
            return;
        }

        app.on('second-instance', (event, commandLine, workingDirectory) => {
            if (this.mainWindow) {
                if (this.mainWindow.isMinimized()) this.mainWindow.restore();
                this.mainWindow.focus();
            }
        });

        app.setLoginItemSettings({openAtLogin: true});

        app.on('ready', () => {
            this.createWindow();
            this.createTray();
            this.checkForUpdates().then();
        });
    }

    async checkForUpdates() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/habibi-dev/Bale-windows/refs/heads/master/package.json');
            const latestData = await response.json();

            const currentVersion = app.getVersion();
            const latestVersion = latestData.version;

            if (semver.gt(latestVersion, currentVersion)) {
                const downloadLink = latestData.latest;

                const userResponse = await dialog.showMessageBox(this.mainWindow, {
                    type: 'question',
                    buttons: ['بله', 'خیر'],
                    title: 'بروزرسانی موجود است',
                    message: `نسخه ${latestVersion} جدید منتشر شده است. آیا می‌خواهید آن را دانلود و نصب کنید؟`,
                });

                if (userResponse.response === 0) {
                    this.downloadAndInstallUpdate(downloadLink);
                }
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    downloadAndInstallUpdate(downloadLink) {
        dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            title: 'در حال دانلود...',
            message: 'در حال دانلود نسخه جدید... لطفا منتظر بمانید.',
        });

        download(this.mainWindow, downloadLink)
            .then((downloadItem) => {
                dialog.showMessageBox(this.mainWindow, {
                    type: 'info',
                    title: 'دانلود تمام شد',
                    message: 'نسخه جدید دانلود شد. لطفا فایل را اجرا کنید.',
                });

                const filePath = downloadItem.getSavePath();

                exec(`start "" "${filePath}"`, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error launching installer:', error);
                    } else {
                        app.exit()
                        console.log('Installer started:', stdout);
                    }
                });
            })
            .catch((error) => {
                console.error('Error downloading update:', error);
                dialog.showMessageBox(this.mainWindow, {
                    type: 'error',
                    title: 'خطا',
                    message: 'در دانلود بروزرسانی مشکلی پیش آمد.',
                });
            });
    }

}

new BaleApp();