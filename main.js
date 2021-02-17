const { app, BrowserWindow, ipcMain, shell, nativeImage, Menu } = require('electron');

const path = require('path');
const fs = require('fs');
const Constants = require('./constants');
const { showJSONPArseMessageBox, showMessageBox } = require('./dialogs');
const treeKill = require('tree-kill');
let objectPath = require("object-path");
const { createTray, updateTray, destroyTray } = require('./tray');
const http = require('http');
var request = require('request');

// Create services for settings and scenarios
const { SettingsService } = require('./settings/settings-service');
const { ScenarioService } = require('./scenario/scenario-service');
let settingsService = Object.create(SettingsService);
let scenarioService = Object.create(ScenarioService);
settingsService.init();

const { CommandsService } = require('./commands/commands-service');
let commandsService = Object.create(CommandsService);

const { registerGlobalShortcuts } = require('./shortcuts');


//rimaf mladenr new tray functions april 2018
var rimraf = require('rimraf');
var glob = require('glob');
var archiver = require('archiver');

let mainWindow, consoleWindow, commandsWindow, gameManagerWindow;
let willQuitApp = false;
const platform = process.platform;
let windowIcon;
if (platform == 'darwin') {
    windowIcon = nativeImage.createFromPath(Constants.PATHS.IMAGES + '/icons/lde_icon4b.png');
}

else if (platform == 'win32') {
    windowIcon = nativeImage.createFromPath(Constants.PATHS.IMAGES + '/icons/lde_icon4b.ico');
}

var menuElements = [];

// LDE Scenario Selection
function createMainWindow() {
    mainWindow = new BrowserWindow({
        show: false,
        icon: windowIcon,
        // frame: true,
        // transparent: false,
        hasShadow: true,
        resizable: true,
    });

    // mainWindow.webContents.openDevTools();
    mainWindow.loadURL(path.join('file://', __dirname, '/scenariosWindow/scenarios.html'));
    mainWindow.setMenu(null);

    mainWindow.on('ready-to-show',() => {
        mainWindow.show();
    });

    mainWindow.on('closed',(e) => {
        app.quit();
    });
    createConsoleWindow();
    registerGlobalShortcuts(globalShortcutFunctions, mainWindow, consoleWindow);
}


function createConsoleWindow() {
    consoleWindow = new BrowserWindow({
        show: false,
        icon: windowIcon,
        hasShadow: true,
        autoHideMenuBar: true 
    });
    consoleWindow.loadURL(path.join('file://', __dirname, '/consoleWindow/console.html'));

    let consoleMenuTemplate = [
        {
            label: 'clear log',
            type: 'normal',
            click: () => {
                consoleWindow.webContents.send(Constants.Events.CLEAR_LOG, null)
            }
        }
        //,
        //{ type: 'separator'}
    ]

    let consoleMenu = Menu.buildFromTemplate(consoleMenuTemplate);
    //consoleWindow.setMenu(consoleMenu);

    //consoleWindow.webContents.openDevTools();

    consoleWindow.on('close', (e) => {
        if(willQuitApp) {
            consoleWindow = null;
        } else {
            e.preventDefault();
            consoleWindow.hide();
        }
    });
}


function createCommandsWindow() {
    commandsWindow = new BrowserWindow({
        height: 50,
        width: 400,
        frame: false,
        transparent: false,
        alwaysOnTop: false,
        resizable: false,
        useContentSize: true,
        center: true,
        icon: windowIcon,
        show: false
    });

    commandsWindow.loadURL(path.join('file://', __dirname, '/commandsWindow/commands.html'));
    commandsWindow.setMenu(null);

    commandsWindow.on('ready-to-show',() => {
        commandsWindow.show();
    });
}

function remove(array, element) {
    const index = array.indexOf(element);
    array.splice(index, 1);
}

function killAllProcesses(afterKill) {
    if (commandsService.processes.length > 0) {
        for (let x = 0; x < commandsService.processes.length; x++) {
            console.log("Killing: ", commandsService.processes[x].pid)
            treeKill(commandsService.processes[x].pid);
            remove(commandsService.runningProcesses, commandsService.processes[x]);
            if (x === commandsService.processes.length - 1) {
                if (afterKill) {
                    afterKill();
                }
            }
        }
    } else {
        if (afterKill) {
            afterKill();
        }
    }
}

function runStopCommands(afterStop) {
    if (scenarioService.activeScenario && scenarioService.activeScenario.setup && scenarioService.activeScenario.setup.stop && scenarioService.activeScenario.setup.stop.length > 0 ) {
        console.log("STOP CMDS:", scenarioService.activeScenario.setup.stop)
        var num = scenarioService.activeScenario.setup.stop.length;
        console.log("NUM OF COMMANDS: ", num)
        runCommand(scenarioService.activeScenario.setup.stop, scenarioService.activeScenario.commandsEnvironment,() => {
            console.log("=> ", num)
            if (num === 1) {
                console.log("AFTER STOP")
                afterStop();
            }
            num = num - 1;
        });
    } else {
        console.log("AFTER STOP");
        setTimeout(afterStop, 0);
    }
}

function returnToScenarioSelection() {
    
    console.log("RETURNING...");
    //reloadSettings();
    setTimeout(()=>{
        runStopCommands(() => {
            menuElements = [];
            destroyTray();
            consoleWindow.hide();
            if (platform != "darwin") {
                killAllProcesses(() => {                    
              //      mainWindow.loadURL(path.join('file://', process.env['LDE_HOME'], '/core/nginxApps/portal/index.html'));
              //      mainWindow.loadURL(path.join('file://', __dirname, '/scenariosWindow/scenarios.html'));
              //      mainWindow.reload();
                    mainWindow.show();
                });
            } else {
                mainWindow.show();
            }
            scenarioService.activeScenario = {};
        });
    },0);
}

app.on('ready', createMainWindow);


app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createMainWindow();
    }
});

app.on('before-quit',() => {
    willQuitApp = true
    console.log("BEFORE QUIT")
    destroyTray();
});

//for Mac
app.on('window-all-closed',() => {
    if (process.platform !== 'darwin') {
        runStopCommands(() => {
            killAllProcesses(() => {
                console.log("I AM QUITING from window all closed............")
                app.quit();
            });
        });
    }
});

ipcMain.on(Constants.Events.GET_SCENARIOS,(evt, props) => {
    scenarioService.init(() => {
        evt.sender.send(Constants.Events.GET_SCENARIOS, scenarioService.scenarios);
    },(message) => {
            console.log(message)
        });
});

ipcMain.on(Constants.Events.GET_COMMANDS,(evt, props) => {
    evt.sender.send(Constants.Events.GET_COMMANDS, commandsService.commands)
});

ipcMain.on(Constants.Events.RUN_COMMAND,(evt, command) => {
    runCommand(command, scenarioService.activeScenario.commandsEnvironment);
    commandsWindow.hide();
});

// START SCENARIO EVENT
ipcMain.on(Constants.Events.START_SCENARIO,(evt, scenario) => {
    scenario.image = eval("(" + scenario.image + ")");
    scenarioService.createActiveScenario(settingsService.settings, scenario,(error) => {
        showJSONPArseMessageBox(mainWindow, "Error Parsing JSON", "Check configuration files for JSON errors.",() => {
            shell.openItem(scenario.ID);
        },()=>{
            shell.openItem(Constants.PATHS.SETTINGS_FILE_PATH);
        });
    }, () => {
        // Create ENVIRONMENT for Commands
        scenarioService.activeScenario.commandsEnvironment = Object.assign({}, process.env);
            if (scenarioService.activeScenario.variables.env) {
                Object.keys(scenarioService.activeScenario.variables.env).map(key => {
                    if (key !== "PATH" && key !== "Path" && key !== "WINDIR" && key !== "SYSTEMROOT" && key !== "SYSTEMDRIVE" && key !== "ProgramData") {
                        scenarioService.activeScenario.commandsEnvironment[key] = scenarioService.activeScenario.variables.env[key];
                        if (platform == 'win32') {
                            scenarioService.activeScenario.commandsEnvironment["Path"] = scenarioService.activeScenario.variables.env[key] + ";" + scenarioService.activeScenario.commandsEnvironment["Path"];
                        } else {
                            scenarioService.activeScenario.commandsEnvironment["PATH"] = scenarioService.activeScenario.variables.env[key] + ":" + scenarioService.activeScenario.commandsEnvironment["PATH"];
                        }
                    }
                });
            }

            // Copy gameslist to portal
            let gameslist = path.join(path.dirname(scenarioService.activeScenario.ID), "gameslist.json");
            let portalGamesList = path.join(process.env['LDE_HOME'], 'core', 'nginxApps', 'portal', 'gameslist.json');
            console.log("FROM: ", gameslist)
            console.log("TO: ", portalGamesList)
            if (fs.existsSync(gameslist)) {
                fs.createReadStream(gameslist).pipe(fs.createWriteStream(portalGamesList));
            } else {
                fs.writeFile(portalGamesList, `{"games":[]}`,(err) => {
                    if (err) {
                        console.log(err)
                    }
                });
            }

            mainWindow.hide();
            createTray(trayFunctions);
            consoleWindow.show();

            //Tray Menu Creation
            let regex_for_parameters = /\(([^)]+)?\)$/g
            for (let importedItem of scenarioService.activeScenario.setup.import){
                console.log(importedItem)
                if (regex_for_parameters.test(importedItem)) {
                    let params = importedItem.match(regex_for_parameters)[0];
                    console.log(params);
                    importedItem = importedItem.replace(params, '');
                    console.log("New: ", importedItem);
                    var element = objectPath.get(scenarioService.activeScenario, importedItem);
                    let result = JSON.stringify(element);
                    let array_params = params.substring(1, params.length - 1).split(',');
                    for (let key_value of array_params) {
                        let key = key_value.split('=')[0];
                        let value = key_value.split('=')[1];
                        console.log(key + " => " + value);
                        let regex_for_placeholder = new RegExp('\{\{' + key + '\}\}', "g");
                        result = result.replace(regex_for_placeholder, value);
                    }

                    result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                    console.log(result);
                    element = JSON.parse(result);
                    console.log(element);
                    let parent_array = importedItem.split(".");
                    let itemName = parent_array[parent_array.length - 1]
                    let new_parent_array = parent_array.splice(0, parent_array.length - 1);
                    let parent = new_parent_array.join(".");
                    parent = parent === "" ? null : parent;
                    addMenuItem(itemName, parent, element);
                } else {
                    var element = objectPath.get(scenarioService.activeScenario, importedItem);
                    let result = JSON.stringify(element);
                    result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                    console.log(result)
                    element = JSON.parse(result);
                    let parent_array = importedItem.split(".");
                    let itemName = parent_array[parent_array.length - 1]
                    let new_parent_array = parent_array.splice(0, parent_array.length - 1);
                    let parent = new_parent_array.join(".")
                    parent = parent === "" ? null : parent;
                    addMenuItem(itemName, parent, element);
                }
            }

            commandsService.init({ commands: scenarioService.activeScenario.commands }, scenarioService.activeScenario.setup.import,() => {
                replaceCommandTemplatesInStartAndStop(scenarioService.activeScenario.setup,() => {
                    if (scenarioService.activeScenario.setup.start.length > 0) {
                        runCommand(scenarioService.activeScenario.setup.start, scenarioService.activeScenario.commandsEnvironment);
                    }
                });
            });

        });
});

function replaceCommandTemplatesInStartAndStop(setup, after) {
    let regex_for_parameters = /\(([^)]+)?\)$/g
    if (scenarioService.activeScenario.setup.start) {
        for (let i = 0; i < scenarioService.activeScenario.setup.start.length; i++) {
            let importedItem = scenarioService.activeScenario.setup.start[i];
            console.log(importedItem)
            if (regex_for_parameters.test(importedItem)) {
                let params = importedItem.match(regex_for_parameters)[0];
                console.log(params);
                importedItem = importedItem.replace(params, '');
                console.log("New: ", importedItem);
                var element = objectPath.get(scenarioService.activeScenario, importedItem);
                let result = JSON.stringify(element);
                let array_params = params.substring(1, params.length - 1).split(',');
                for (let key_value of array_params) {
                    let key = key_value.split('=')[0];
                    let value = key_value.split('=')[1];
                    console.log(key + " => " + value);
                    let regex_for_placeholder = new RegExp('\{\{' + key + '\}\}', "g");
                    result = result.replace(regex_for_placeholder, value);
                }
    
                result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                console.log(result);
                element = JSON.parse(result);
                scenarioService.activeScenario.setup.start[i] = element
            } else {
                var element = objectPath.get(scenarioService.activeScenario, importedItem);
                let result = JSON.stringify(element);
                result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                console.log(result)
                element = JSON.parse(result);
                scenarioService.activeScenario.setup.start[i] = element
            }
        }
    }
    if (scenarioService.activeScenario.setup.stop) {
        for (let i = 0; i < scenarioService.activeScenario.setup.stop.length; i++) {
            let importedItem = scenarioService.activeScenario.setup.stop[i];
            console.log(importedItem)
            if (regex_for_parameters.test(importedItem)) {
                let params = importedItem.match(regex_for_parameters)[0];
                console.log(params);
                importedItem = importedItem.replace(params, '');
                console.log("New: ", importedItem);
                var element = objectPath.get(scenarioService.activeScenario, importedItem);
                let result = JSON.stringify(element);
                let array_params = params.substring(1, params.length - 1).split(',');
                for (let key_value of array_params) {
                    let key = key_value.split('=')[0];
                    let value = key_value.split('=')[1];
                    console.log(key + " => " + value);
                    let regex_for_placeholder = new RegExp('\{\{' + key + '\}\}', "g");
                    result = result.replace(regex_for_placeholder, value);
                }
    
                result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                console.log(result);
                element = JSON.parse(result);
                scenarioService.activeScenario.setup.stop[i] = element
            } else {
                var element = objectPath.get(scenarioService.activeScenario, importedItem);
                let result = JSON.stringify(element);
                result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                console.log(result)
                element = JSON.parse(result);
                scenarioService.activeScenario.setup.stop[i] = element
            }
        }
    }
    if (after) {
        after();
    }
}

function runCommand(command, environment, afterCommand) {
    commandsService.runCommand(command, environment,
        (id) => {
            if (consoleWindow) {
                console.log(`RUN => ${id}\n`);
                consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, `RUN => ${id}\n`);
            }
        },
        (data) => {
            if (consoleWindow) {
                // console.log(data)
                consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, data);
            }
        },
        (error) => {
            if (consoleWindow) {
                // console.log(error)
                consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, error);
            }
        },
        (error) => {
            if (consoleWindow) {
                // console.log(error)
                consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, error);
            }
        },
        () => {
            console.log("FINNISHED");
            if (afterCommand) {
                afterCommand();
            }
        }
        );
}

var trayFunctions = {
    clearDCache: function () {
        // step 0: stop Tomcat
            //printCommand(command.exe + " catalina stop");
            //runCommand('command.exe catalina stop', scenarioService.activeScenario.commandsEnvironment);
            //runCommand(command, scenarioService.activeScenario.commandsEnvironment);            

            //runCommand(command1, scenarioService.activeScenario.commandsEnvironment);
            
            //call direct to CS
            //commandsService.runCommand(`RUN => catalina stop`, scenarioService.activeScenario.commandsEnvironment);
            
            //console.log(`RUN => catalina stop\n`)
            //consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, `RUN => catalina stop\n`);


            //runCommand(element.stop, scenarioService.activeScenario.commandsEnvironment);
            //runCommand(catalina stop);
            //commands.tomcat.stop;

        // step 1: delete catalina
    
        let pathToCatalina = path.join(process.env['LDE_HOME'], 'core','tomcat','work','Catalina');
        rimraf(pathToCatalina, function () { 
            //console.log('Catalina deleted.'); 
            consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, " \nCatalina folder deleted.");
        });
       
        // step 2: delete all similar files in bin  
        var options = "";
        var forFiles2 = "";
        var forFiles3 = "";    
        let path2 = path.join(process.env['LDE_HOME'], 'core','tomcat','bin');
        options = {
            cwd: path2
        },
        forFiles2 = function(err,files){
            console.log('Deleting cache files in: ' + path2);
            consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, " \nDeleting cache files in: " + path2 + " ");
            if (err) {
                console.log(err);
            } else {
                files.forEach(function(value){
                    let pathToCatalina = path.join(process.env['LDE_HOME'], 'core','tomcat','bin',value);
                    rimraf(pathToCatalina, function () { console.log(value + ' deleted.'); });
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, " \n" + value + " deleted.  ");
                });
            }
        };
        glob('wg_logger.txt*', options, forFiles2);
        
        // step 3: delete all outcomes folders
        let path3 = path.join(process.env['LDE_HOME'], 'games','paytables');
        options = {
            cwd: path3
        },
        forFiles3 = function(err,files){
            console.log('Deleting outcomes in: ' + path3);
            consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, " \nDeleting outcomes in: " + path3 + " ");
            if (err) {
                console.log(err);
            } else {
                files.forEach(function(value){
                    let pathToCatalina = path.join(process.env['LDE_HOME'], 'games','paytables',value);
                    rimraf(pathToCatalina, function () { console.log(value + ' deleted.'); });
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, " \n" + value + " deleted. ");
                });
            }
        };
        glob('**/outcomes', options, forFiles3);

        // step 4: start catalina
        // printCommand(command.exe + " catalina start");
    },

    // export settings for Eugene :)
    // https://www.npmjs.com/package/archiver

    exportSettings: function() {
        console.log('Exporting Configuration...');        
        let pathToScenario = path.join(process.env['LDE_HOME'], 'scenarios', scenarioService.activeScenario.name ,'scenario.json');  
        let pathToGameslist = path.join(process.env['LDE_HOME'], 'scenarios', scenarioService.activeScenario.name ,'gameslist.json'); 
        let pathToPaytables = path.join(process.env['LDE_HOME'], 'games','paytables/');
        let pathToExport = path.join(process.env['LDE_HOME']);
                
        var dateT = new Date();
        var output = fs.createWriteStream(pathToExport + '/ExportedConfig_' + scenarioService.activeScenario.name + '_date.' + dateT.getFullYear() + '.' + (dateT.getMonth()+1) + '.' + dateT.getDate() + '_time.' + dateT.getHours() + '.' + dateT.getMinutes() + '.' + dateT.getSeconds() + '.zip');
        var archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });
        
        output.on('close', function() {
            console.log(archive.pointer() + ' total bytes');
            console.log('archiver has been finalized and the output file descriptor has closed.');
        });
        
        output.on('end', function() {
            console.log('Data has been drained');
        });
        
        archive.on('warning', function(err) {
            if (err.code === 'ENOENT') {
                // log warning
            } else {
                // throw error
                throw err;
            }
        });
        
        archive.on('error', function(err) {
            throw err;
        });



        // REMOVING USERNAME AND PASSWORD CODE BELOW

try {  
    var readScenarioFile = fs.readFileSync(pathToScenario, 'utf8');
    var scenarioLines = readScenarioFile.split('\n');

    for(var i = 0; i < scenarioLines.length; i++)   {
        if(scenarioLines[i].includes('"SVN_USER":')) {
            scenarioLines[i] = '\t\t\t"SVN_USER": "",';
        }
        else if(scenarioLines[i].includes('"SVN_PASSWORD":')) {
            scenarioLines[i] = '\t\t\t"SVN_PASSWORD": ""';
        }
    }
    var newScenarioFile = scenarioLines.join('\n');

} catch(e) {
    console.log('Error:', e.stack);
}
     
        archive.pipe(output);
        archive.append(newScenarioFile, { name: 'scenario.json' });
        archive.append(fs.createReadStream(pathToGameslist), { name: 'gameslist.json' });        
        archive.append(fs.createReadStream(Constants.PATHS.SETTINGS_FILE_PATH), { name: 'settings.json' });        
        archive.directory(pathToPaytables, 'paytables');
        var buffer3 = Buffer.from('Extract the files you need in appropriate directories such as: \r\n \r\n LDE_HOME/scenarios <- for scenario.json and gameslist.json\r\n LDE_HOME/games/paytables <- for paytable of game(s) you want to test\r\n c:/Users/USERNAME/.lde <- settings.json on WINDOWS\r\n ~/.lde/ <- settings.json on MAC \r\n \r\nPlease, do not overwrite old files. Create a zip/back up your old files in case you need them again. \r\n \r\nLDE team \r\nLDE manual link:\r\nhttps://intranet.gtechg2.com/pages/viewpage.action?title=LDE+2&spaceKey=GAMBG');
        archive.append(buffer3, { name: 'README.txt' });
        archive.finalize();        
    },

    toggleConsoleWindow: function () {
        if (consoleWindow) {
            if (consoleWindow.isVisible()) {
                consoleWindow.hide();
            } else {
                consoleWindow.show();
            }
        }
    },
    //--------------------------------MILIC
    gamesManagertWindow: function (trayFunctions) {
        gameManagerWindow = new BrowserWindow({
            height: 590,
            width: 1240,
            title: "LDE Games Manager",
            frame: true,
            transparent: false,
            alwaysOnTop: false,
            resizable: true,
            useContentSize: true,
            center: true,
            icon: windowIcon
            //show: false
        });
        
        //gameManagerWindow.webContents.openDevTools();
        gameManagerWindow.loadURL(path.join('file://', __dirname, '/gamesManager/gamesManager.html?' + scenarioService.activeScenario.name));
        gameManagerWindow.setMenu(null);
    
        gameManagerWindow.on('ready-to-show',() => {
        gameManagerWindow.show();
        });
    },
    updateGleGamesFromNexus: function () {
        //CREATE DIRECTORY gle-games IF IT DOES NOT EXIST UNDER %LDE_HOME/games
        var dir = process.env['LDE_HOME'] + '/games/gle-games';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        } 
        
        var file;
        var marray = []; 
        var latestSnapshotVersion;
        var linksCount;
        var snapshotLink;

        //GET NUMBER OF LINKS THAT CONTAIN VERSION OF THE GAME IN IT IN THE NEXUS WEB PAGE
        function getLinksCount(){
            request('http://igti-nexus.lab.wagerworks.com/content/repositories/releases/com/igt/interactivegame/gle/gle-games/', function (err, resp, body) {
                
                if (!err && resp.statusCode == 200) {
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nSearching GLE Games. Please wait... \n\n");
                    linksCount = Math.round((body.match(/[0-9]{1,2}([.][0-9]{1,2})([.][0-9]{1,2})/g) || []).length / 2);
                }
            });
        }

        //GET LATEST SNAPSHOT LINK
        function getLatestSnapshotLink(){
            request('http://igti-nexus.lab.wagerworks.com/content/repositories/snapshots/com/igt/interactivegame/gle/gle-games/' + latestSnapshotVersion + '-SNAPSHOT/', function (err, resp, body) {
                
                if (!err && resp.statusCode == 200) {                  
                    snapshotLink = body.match(/-[0-9]{8}([.][0-9]{6,8})([-][0-9]{1}.jar)/g);
                }
            });
        }

        //USED FOR DETERMINING LATEST SNAPSHOT VERSION
        function findLatestSnapshotVersion() {
            var explodedMarray = [];
            var max1 = 0;
            var max2 = 0;
            var max3 = 0;

            for (var i = 0; i < marray.length; i++) {
                explodedMarray[i] = marray[i].split(".");

                if (explodedMarray[i][0] > max1) {
                    max1 = parseInt(explodedMarray[i][0]);		
                }
            }

            for (var i = 0; i < marray.length; i++) {
                explodedMarray[i] = marray[i].split(".");

                if(max1 == explodedMarray[i][0] && explodedMarray[i][1] > max2){
                    max2 = parseInt(explodedMarray[i][1]);
                }
            }

            for (var i = 0; i < marray.length; i++) {
                explodedMarray[i] = marray[i].split(".");

                if(max1 == explodedMarray[i][0] && max2 == explodedMarray[i][1] && explodedMarray[i][2] > max3){
                    max3 = parseInt(explodedMarray[i][2]);
                }
            }

            max3 = max3 + 1;
            latestSnapshotVersion = max1 + "." + max2 + "." + max3;
        }

        //CHECK NEXUS FOR GLE VERSIONS
        function searching() {           
            for(var i = 1; i < linksCount; i++) {
                for(var j = 0; j < linksCount; j++) {
                    for(var k = 0; k < linksCount; k++) {
                        tryOne(i, j, k);
                    }
                }
            }

        }

        //IF GLE VERSION EXISTS ON SERVER PUT IT'S NAME INTO marray AND LOG IT IN CONSOLE
        function tryOne(i, j, k) {  
            request('http://igti-nexus.lab.wagerworks.com/content/repositories/releases/com/igt/interactivegame/gle/gle-games/' + i + '.' + j + '.' + k + '/gle-games-' + i + '.' + j + '.' + k + '.jar', function (err, resp) {
                
                if (!err && resp.statusCode == 200) {
                    marray.push(i + '.' + j + '.' + k);
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "Found: " + marray + "\n");
                    console.log("Found: " + marray);
                }
            });
        }

        var numm = 0;

        //DOWNLOAD AND CREATE FILE 
        function doit() { 
            consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nCopying: gle-games-" + marray[numm] + "\n");
            console.log("Copying GLE: " + marray[numm] + "\n");
            //DOWNLOAD DATA AND CREATE A NEW .JAR FILE
            file = fs.createWriteStream(process.env['LDE_HOME'] + '/games/gle-games/gle-games-' + marray[numm] + '.jar');
            http.get('http://igti-nexus.lab.wagerworks.com/content/repositories/releases/com/igt/interactivegame/gle/gle-games/' + marray[numm] + '/gle-games-' + marray[numm] + '.jar', function(response) {
                response.pipe(file);
                file.on('finish', function() {
                    file.close();
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "gle-games-" + marray[numm] + " copying complete. \n");
                    console.log(marray[numm] + " copying complete. \n");
                    numm = numm + 1;
                    donext();
                });
            });
        }

        //DOWNLOAD SNAPSHOT       
        function downloadSnapshot() {
            request('http://igti-nexus.lab.wagerworks.com/content/repositories/snapshots/com/igt/interactivegame/gle/gle-games/' + latestSnapshotVersion + '-SNAPSHOT/gle-games-' + latestSnapshotVersion + snapshotLink[0], function (err, resp) {
                
                if (!err && resp.statusCode == 200) {
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nFound: " + latestSnapshotVersion + "-SNAPSHOT");
                    console.log("Found: " + latestSnapshotVersion + "-SNAPSHOT");
                    file = fs.createWriteStream(process.env['LDE_HOME'] + '/games/gle-games/gle-games-' + latestSnapshotVersion + '.jar');
                    http.get('http://igti-nexus.lab.wagerworks.com/content/repositories/snapshots/com/igt/interactivegame/gle/gle-games/' + latestSnapshotVersion + '-SNAPSHOT/gle-games-' + latestSnapshotVersion + snapshotLink[0], function(response) {
                        consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nCopying: gle-games-" + latestSnapshotVersion + "-SNAPSHOT.jar\n");
                        console.log("Copying: gle-games-" + latestSnapshotVersion + "-SNAPSHOT.jar\n");
                        response.pipe(file);
                        file.on('finish', function() {
                            file.close();
                            consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "gle-games-" + latestSnapshotVersion + "-SNAPSHOT copying complete. \n");
                            console.log(latestSnapshotVersion + "-SNAPSHOT copying complete. \n");
                            numm = numm + 1;
                            donext();
                        });
                    });
                } else {
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nDONE - Download finished. WARNING: Failed to download latest snapshot version for gle-games, please download it manually.");
                }
            });
        }

        function donext() {
            if (numm < marray.length) {
                doit();
            } else if (numm == marray.length){
                //IF EXISTS, DOWNLOAD SNAPSHOT
                if(snapshotLink != undefined) {
                    downloadSnapshot();
                } else {
                    consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nDONE - Gle-games update complete. \nNOTE - Snapshot version was not found.\n");
                    console.log("\nGle-games update complete. \n");
                }
            } else if (numm == marray.length + 1){
                consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, "\nDONE - Gle-games update complete. \n");
                console.log("\nGle-games update complete. \n");
            }
        }

        getLinksCount();       
        setTimeout (searching, 10000); 
        setTimeout (findLatestSnapshotVersion, 35000);
        setTimeout (getLatestSnapshotLink, 37000);
        setTimeout (doit, 37000);
    },      
    //------------------------------MILIC ENDS
    getActiveScenario: function () {
        return scenarioService.activeScenario.name;
    },
    reloadSettings,
    openScenarioJSON: function () {
        shell.openItem(scenarioService.activeScenario.ID);
    },
    killAllProcesses,
    runStopCommands,
    returnToScenarioSelection
}


var separatorPlaced = false;

function addMenuItem(name, parent, element) {
    let update = false;
    var item = {
        label: element.name ? element.name : name
    }
    if (element.exe || Array.isArray(element)) {
        item.type = 'normal';
        item.click = function () {
            runCommand(element, scenarioService.activeScenario.commandsEnvironment);
        }
        update = true;     
        
        
    } else if (element.start && element.stop) {
        item.type = 'submenu';
        item.submenu = [
            {
                label: "start",
                type: 'normal',
                click: function () {
                    runCommand(element.start, scenarioService.activeScenario.commandsEnvironment)
                }
            },
            {
                label: "stop",
                type: 'normal',
                click: function () {
                    runCommand(element.stop, scenarioService.activeScenario.commandsEnvironment)
                }
            },
            {
                label: "restart",
                type: 'normal',
                click: function () {
                    runCommand([element.stop, element.start], scenarioService.activeScenario.commandsEnvironment)
                }
            }
        ]
        update = true;
    } else {
        item.type = 'submenu';
        item.submenu = [];
        Object.keys(element).forEach((el) => {
            setTimeout(() => {
                var parentName = ''
                if (parent == null) {
                    parentName = name
                } else {
                    parentName = parent + "." + name
                }
                addMenuItem(el, parentName, element[el]);
            })
        })
    }

    if (update) {
        if (parent === null) {
            // never should happen
            menuElements.push(item)

        } else {
            var submenuPath = parent.split(".");
            var submenuObj = menuElements;        
            
            // break down of all menuElements
            for (let pathPart of submenuPath) {
                let submenuObjExists = submenuObj.filter(m => { return m.label === pathPart })[0];

                if(submenuObjExists) {
                    submenuObj = submenuObjExists.submenu

                    // separator between games and non-games
                    if (element.name) {
                        if (!separatorPlaced) {
                            separatorPlaced = true;
                            var item2 =  { }
                            item2.type = 'separator';
                            submenuObj.push(item2);
                        }
                    }
                  
                //two branches
           //     if (element.name == "") {
                // console.log("Mla: ", trayFunctions)
                // console.log("Mla: ", submenuObj)
             //   }

                } else {
                    //create and add submenu
                    submenuObj.push({
                        label: pathPart,
                        submenu: []
                    })
                    submenuObj = submenuObj.filter(m => { return m.label === pathPart })[0].submenu                    
                }
            }
            submenuObj.push(item);     
        }
        // this happens many many times (13)
        //if ()
        updateTray(trayFunctions, menuElements)
       // console.log("Mla: ", submenuObj)
    }
}



var globalShortcutFunctions = {
    reloadSettings,
    toggleCommandsWindow: function () {
        if (scenarioService.activeScenario.ID) {
            if (commandsWindow) {
                if (commandsWindow.isVisible() && commandsWindow.isFocused()) {
                    commandsWindow.hide();
                } else if (commandsWindow.isVisible() && !commandsWindow.isFocused()) {
                    commandsWindow.focus();
                } else if (!commandsWindow.isVisible()) {
                    commandsWindow.show();
                    commandsWindow.focus();
                }
            } else {
                createCommandsWindow();
            }
        }
    },
    runStopCommands,
    killAllProcesses
}

function reloadSettings() {
    if (scenarioService.activeScenario.name) {
        settingsService.refreshData(() => {
            if (scenarioService.activeScenario.ID) {

                separatorPlaced = false;
                
                    
                 // Copy gameslist to portal
                let gameslist = path.join(path.dirname(scenarioService.activeScenario.ID), "gameslist.json");
                let portalGamesList = path.join(process.env['LDE_HOME'], 'core','nginxApps','portal', 'gameslist.json');
                console.log("FROM: ", gameslist)
                console.log("TO: ", portalGamesList)
                if(fs.existsSync(gameslist)) {
                    fs.createReadStream(gameslist).pipe(fs.createWriteStream(portalGamesList));
                } else {
                    fs.writeFile(portalGamesList, `{"games":[]}`, (err) => {
                        if(err) {
                            console.log(err)
                        }
                    });
                }
                //consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, JSON.stringify(scenarioService.activeScenario, null, 4) + "\n END. \n");
                scenarioService.reloadScenarioData(scenarioService.activeScenario.ID, ()=>{
                    let scenario = scenarioService.scenarios.filter(function(s){
                        return s.ID === scenarioService.activeScenario.ID
                    })[0];
                    scenario.image = eval("(" + scenario.image + ")");
                    //consoleWindow.webContents.send(Constants.Events.CONSOLE_LOG, JSON.stringify(scenario, null, 4) + "\n");
                    scenarioService.createActiveScenario(settingsService.settings, scenario,(error) => {
                        showJSONPArseMessageBox(mainWindow, "Error Parsing JSON", "Check configuration files for JSON errors.",() => {
                            shell.openItem(scenario.ID);
                        },()=>{
                            shell.openItem(Constants.PATHS.SETTINGS_FILE_PATH);
                        });
                    }, () => {
                        // Create ENVIRONMENT for Commands
                        scenarioService.activeScenario.commandsEnvironment = Object.assign({}, process.env);
                            if (scenarioService.activeScenario.variables.env) {
                                Object.keys(scenarioService.activeScenario.variables.env).map(key => {
                                    if (key !== "PATH" && key !== "Path" && key !== "WINDIR" && key !== "SYSTEMROOT" && key !== "SYSTEMDRIVE" && key !== "ProgramData") {
                                        scenarioService.activeScenario.commandsEnvironment[key] = scenarioService.activeScenario.variables.env[key];
                                        if (platform == 'win32') {
                                            scenarioService.activeScenario.commandsEnvironment["Path"] = scenarioService.activeScenario.variables.env[key] + ";" + scenarioService.activeScenario.commandsEnvironment["Path"];
                                        } else {
                                            scenarioService.activeScenario.commandsEnvironment["PATH"] = scenarioService.activeScenario.variables.env[key] + ":" + scenarioService.activeScenario.commandsEnvironment["PATH"];
                                        }
                                    }
                                });
                            }
                            
                            menuElements = [];

                            let regex_for_parameters = /\(([^)]+)?\)$/g
                            for (let importedItem of scenarioService.activeScenario.setup.import){
                                console.log(importedItem)
                                if (regex_for_parameters.test(importedItem)) {
                                    let params = importedItem.match(regex_for_parameters)[0];
                                    console.log(params);
                                    importedItem = importedItem.replace(params, '');
                                    console.log("New: ", importedItem);
                                    var element = objectPath.get(scenarioService.activeScenario, importedItem);
                                    let result = JSON.stringify(element);
                                    let array_params = params.substring(1, params.length - 1).split(',');
                                    for (let key_value of array_params) {
                                        let key = key_value.split('=')[0];
                                        let value = key_value.split('=')[1];
                                        console.log(key + " => " + value);
                                        let regex_for_placeholder = new RegExp('\{\{' + key + '\}\}', "g");
                                        result = result.replace(regex_for_placeholder, value);
                                    }

                                    result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                                    console.log(result);
                                    element = JSON.parse(result);
                                    console.log(element)
                                    let parent_array = importedItem.split(".");
                                    let itemName = parent_array[parent_array.length - 1]
                                    let new_parent_array = parent_array.splice(0, parent_array.length - 1);
                                    let parent = new_parent_array.join(".")
                                    parent = parent === "" ? null : parent;
                                    addMenuItem(itemName, parent, element);
                                } else {
                                    var element = objectPath.get(scenarioService.activeScenario, importedItem);
                                    let result = JSON.stringify(element);
                                    result = result.replace(/\{\{([^}}]+)?\}\}/g, ''); // Remove all placeholders with no value
                                    console.log(result)
                                    element = JSON.parse(result);
                                    let parent_array = importedItem.split(".");
                                    let itemName = parent_array[parent_array.length - 1]
                                    let new_parent_array = parent_array.splice(0, parent_array.length - 1);
                                    let parent = new_parent_array.join(".")
                                    parent = parent === "" ? null : parent;
                                    addMenuItem(itemName, parent, element);
                                }
                            }
                            
                            commandsService.init({ commands: scenarioService.activeScenario.commands }, scenarioService.activeScenario.setup.import,() => {
                                replaceCommandTemplatesInStartAndStop(scenarioService.activeScenario.setup,() => {
                                    if (commandsWindow) {
                                        commandsWindow.webContents.send(Constants.Events.RELOAD_WINDOW);
                                    }
                                });
                            });
                        });
                });
            }
        });
    } else {
        app.relaunch();
        app.quit();
    }
}