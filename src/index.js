const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const { audio } = require('system-control');

const path = require('path');
const MQTT = require("async-mqtt");
const Store = require('electron-store');
const _ = require('underscore');

const store = new Store();

const appFolder = path.dirname(process.execPath)
const updateExe = path.resolve(appFolder, '..', 'Update.exe')
const exeName = path.basename(process.execPath)

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;
let tray;
let volume;
let mqttClient;
let mqttConfig;

// Used when the app starts up. Checks whether it's already configured and
// only displays the window on launch if we need to ask the user for input.
const initialize = async () => {
  const { openAtLogin = true } = (await store.get('startupPreferences')) || {};
  app.setLoginItemSettings({
    openAtLogin,
    path: updateExe,
    args: [
      '--processStart', `"${exeName}"`,
      '--process-start-args', `"--hidden"`
    ]
  })

  mqttConfig = await store.get('mqttConfig');
  if (mqttConfig) {
    setUpMqtt(mqttConfig);
    createWindow({ show: false });
  } else {
    createWindow();
  }

  // Check every 100ms to see if the volume has changed. This is about as close
  // to realtime as we care about for reporting.
  setInterval(async () => {
    const newVolume = await audio.volume();
    if (newVolume != volume) {
      volume = newVolume;
      mqttClient.publish(`${mqttConfig.baseTopic}/volume`, volume.toString(), { retain: true });
    }
  }, 100);
};

const createWindow = async ({ show = true } = {}) => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    show,
    frame: false,
    width: 560,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '/preload.js'),
      contextIsolation: true,
      enableRemoteModule: false
    }
  });

  // TODO show a different page if already set up?
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // keep the app running in the tray unless we alt+F4 out
  mainWindow.on('close', (event) => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      event.preventDefault();
    }
  });

  tray = new Tray(path.join(__dirname, 'tray_icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show App',
      click: () => { mainWindow.show(); }
    },
    { 
      label: 'Quit',
      click: () => { app.quit(); } 
    }
  ])
  tray.setToolTip('Bifrost')
  tray.setContextMenu(contextMenu)

  // Allows the main window to be restored or brought to the front on a
  // single click, instead of requiring interaction with the context menu.
  tray.on('click', () => {
    mainWindow.show();
  })
};

const setUpMqtt = ({ url, username, password, baseTopic }) => {
  mqttClient = MQTT.connect(url, { username, password });

  mqttClient.on("connect", () => {
    mqttClient.subscribe(`${baseTopic}/#`, (err) => {
      if (err) {
        console.error(`ERROR: could not subscribe to topic -> ${baseTopic}/#`);
      }
    });

    mqttClient.on('message', async (topic, message) => {
      console.debug('Received message on topic ->', topic);
      if (topic === 'electron-ha/volume/set') {
        const targetVolume = parseInt(message.toString(), 10);
        console.log('Setting volume to ->', targetVolume);
        await audio.volume(targetVolume);
      }
    });
  });
};

app.on('ready', initialize);

app.on('window-all-closed', () => {
  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  if (process.platform !== 'darwin') {
    if (mqttClient) { mqttClient.end() }
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('mqtt-setup', async (_event, { url, username, password, baseTopic }) => {
  console.log('MQTT config submitted ->', url, username, password, baseTopic);

  const testConfig = { url, username, password, baseTopic }

  try {
    await validateMqttConfig(testConfig);
    console.log('Persisting MQTT config');
    store.set('mqttConfig', testConfig);
    if (mqttClient) { mqttClient.end() }
    mqttConfig = testConfig
    setUpMqtt(mqttConfig);
    mainWindow.webContents.postMessage('mqtt-setup-success', 'MQTT configured successfully!');
    setTimeout(() => {
      mainWindow.hide();
    }, 2000);
  } catch (err) {
    mainWindow.webContents.postMessage('mqtt-setup-error', err.message);
  }
});

ipcMain.on('startup-preferences', async (_event, { openAtLogin }) => {
  console.log('Startup preferences submitted ->', { openAtLogin });

  const startupPreferences = { openAtLogin };

  store.set('startupPreferences', startupPreferences);
});

const validateMqttConfig = async (mqttConfig) => {
  console.log('Validating MQTT config');
  const isValid = _.all(Object.keys(mqttConfig), (key) => {
    return _.isString(mqttConfig[key]) && mqttConfig[key].length > 0;
  });

  if (!isValid) throw new Error('Invalid MQTT config!');

  return await testMqttConnection(mqttConfig);
};

const testMqttConnection = async ({ url, username, password }) => {
  return new Promise((resolve, reject) => {
    let testClient;
    try {
      testClient = MQTT.connect(url, { username, password });
    } catch(err) {
      console.error('Failed to create MQTT client', err.message);
      reject(err.message);
    }

    testClient.on("connect", () => {
      console.log('Connected, config valid');
      testClient.end();
      resolve();
    });
  });
};
