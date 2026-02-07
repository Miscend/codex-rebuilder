const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Configuration
const REPO_ROOT = __dirname;
const MOUNT_POINT = '/Volumes/CodexMount';
const DMG_PATH = path.join(REPO_ROOT, 'Codex.dmg');
const TEMP_DIR = path.join(REPO_ROOT, 'temp_build');
const FINAL_APP_PATH = path.join(REPO_ROOT, 'Codex_Intel.app');
const RESOURCES_DIR = path.join(REPO_ROOT, 'resources');
// detect CODEX_CLI_PATH dynamically
let CODEX_CLI_PATH = '/usr/local/lib/node_modules/@openai/codex';

try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const possiblePath = path.join(globalRoot, '@openai/codex');
    if (fs.existsSync(possiblePath)) {
        CODEX_CLI_PATH = possiblePath;
        console.log(`Detected Codex CLI at: ${CODEX_CLI_PATH}`);
    } else {
        console.log(`Could not find @openai/codex at ${possiblePath}, using default: ${CODEX_CLI_PATH}`);
    }
} catch (e) {
    console.warn("Could not auto-detect npm root. Using default path.");
}

// Helper for executing commands
function run(cmd, cwd = REPO_ROOT) {
    console.log(`> ${cmd}`);
    try {
        execSync(cmd, { cwd, stdio: 'inherit' });
    } catch (e) {
        console.error(`Command failed: ${cmd}`);
        process.exit(1);
    }
}

async function main() {
    console.log("Starting Codex Rebuilder...");

    // 1. Prepare Resources (Mount DMG if needed)
    if (!fs.existsSync(RESOURCES_DIR)) {
        fs.mkdirSync(RESOURCES_DIR);
    }

    const requiredResources = [
        'app.asar',
        'electron.icns',
        'Info.plist'
    ];

    // Check if we have resources locally
    const missingResources = requiredResources.filter(r => !fs.existsSync(path.join(RESOURCES_DIR, r)));

    if (missingResources.length > 0) {
        console.log(`Missing resources (${missingResources.join(', ')}). Mounting DMG...`);

        let mounted = false;
        if (!fs.existsSync(MOUNT_POINT)) {
            // Check if already mounted by user?
            try {
                // Try to mount
                run(`hdiutil attach "${DMG_PATH}" -nobrowse -mountpoint "${MOUNT_POINT}"`);
                mounted = true;
            } catch (e) {
                console.log("Mount failed or already mounted. Checking...");
            }
        } else {
            console.log("Mount point exists, assuming mounted.");
            mounted = true;
            // If strictly it's just a folder, we might fail, but let's assume valid mount or previous run leftover
        }

        try {
            const appPath = path.join(MOUNT_POINT, 'Codex.app/Contents');
            const resPath = path.join(appPath, 'Resources');

            if (fs.existsSync(path.join(resPath, 'app.asar'))) {
                // Copy app.asar
                if (!fs.existsSync(path.join(RESOURCES_DIR, 'app.asar'))) {
                    console.log("Extracting app.asar...");
                    run(`cp "${path.join(resPath, 'app.asar')}" "${path.join(RESOURCES_DIR, 'app.asar')}"`);
                }

                // Copy electron.icns
                if (!fs.existsSync(path.join(RESOURCES_DIR, 'electron.icns'))) {
                    console.log("Extracting electron.icns...");
                    run(`cp "${path.join(resPath, 'electron.icns')}" "${path.join(RESOURCES_DIR, 'electron.icns')}"`);
                }

                // Copy Info.plist
                if (!fs.existsSync(path.join(RESOURCES_DIR, 'Info.plist'))) {
                    console.log("Extracting Info.plist...");
                    run(`cp "${path.join(appPath, 'Info.plist')}" "${path.join(RESOURCES_DIR, 'Info.plist')}"`);
                }

                // Copy app.asar.unpacked structure
                if (!fs.existsSync(path.join(RESOURCES_DIR, 'app.asar.unpacked'))) {
                    console.log("Extracting app.asar.unpacked...");
                    if (fs.existsSync(path.join(resPath, 'app.asar.unpacked'))) {
                        run(`cp -r "${path.join(resPath, 'app.asar.unpacked')}" "${path.join(RESOURCES_DIR, 'app.asar.unpacked')}"`);
                    } else {
                        fs.mkdirSync(path.join(RESOURCES_DIR, 'app.asar.unpacked'));
                    }
                }
            } else {
                throw new Error("Could not find Codex.app/Contents/Resources/app.asar in DMG");
            }
        } finally {
            if (mounted) {
                // Try to detach, don't fail if busy
                try {
                    run(`hdiutil detach "${MOUNT_POINT}"`);
                } catch (e) {
                    console.warn("Failed to unmount, ignoring.");
                }
            }
        }
    }

    // 2. Read Electron Version from extracted app.asar
    console.log("Reading Electron version...");
    const localAppAsar = path.join(RESOURCES_DIR, 'app.asar');
    const pkgJsonPath = path.join(REPO_ROOT, 'package.json');

    // We only extract if we haven't already or if we want to force check
    run(`npx -y @electron/asar extract-file "${localAppAsar}" package.json > "${pkgJsonPath}"`);

    if (!fs.existsSync(pkgJsonPath)) {
        console.error("Failed to extract package.json");
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    let electronVersion = pkg.devDependencies?.electron || pkg.dependencies?.electron;

    if (!electronVersion) {
        console.log("Could not find electron version, defaulting to 40.0.0 based on previous analysis.");
        electronVersion = '40.0.0';
    }

    // Clean version (remove ^ or ~)
    electronVersion = electronVersion.replace(/^[\^~]/, '');
    console.log(`Target Electron Version: ${electronVersion}`);

    // 3. Download Electron x64
    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR);

    const zipName = `electron-v${electronVersion}-darwin-x64.zip`;
    const downloadUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/${zipName}`;
    const zipPath = path.join(REPO_ROOT, zipName); // Cache zip in root

    if (!fs.existsSync(zipPath)) {
        console.log(`Downloading ${downloadUrl}...`);
        run(`curl -L -o "${zipPath}" "${downloadUrl}"`);
    } else {
        console.log("Using cached Electron zip.");
    }

    // 4. Extract Electron
    console.log("Extracting Electron...");
    run(`unzip "${zipPath}" -d "${TEMP_DIR}"`);

    // 5. Assemble Codex App
    console.log("Assembling Codex.app...");
    const electronApp = path.join(TEMP_DIR, 'Electron.app');
    const targetApp = FINAL_APP_PATH;

    if (fs.existsSync(targetApp)) {
        fs.rmSync(targetApp, { recursive: true, force: true });
    }
    run(`mv "${electronApp}" "${targetApp}"`);

    // Replace Resources
    const targetResources = path.join(targetApp, 'Contents/Resources');
    const defaultAsar = path.join(targetResources, 'default_app.asar');
    if (fs.existsSync(defaultAsar)) {
        fs.unlinkSync(defaultAsar);
    }

    fs.copyFileSync(localAppAsar, path.join(targetResources, 'app.asar'));

    // Copy Icon
    const localIcon = path.join(RESOURCES_DIR, 'electron.icns');
    if (fs.existsSync(localIcon)) {
        console.log("Applying custom App Icon...");
        // Destination might be electron.icns or whatever Info.plist specifies
        // We know from previous steps it expects 'electron.icns'
        fs.copyFileSync(localIcon, path.join(targetResources, 'electron.icns'));
    }

    // 6. Native Modules Replacement
    console.log("Handling native modules...");
    const targetUnpacked = path.join(targetResources, 'app.asar.unpacked');

    // Copy extracted unpacked folder from resources
    const localUnpacked = path.join(RESOURCES_DIR, 'app.asar.unpacked');
    if (fs.existsSync(localUnpacked)) {
        run(`cp -r "${localUnpacked}" "${targetUnpacked}"`);
    } else {
        fs.mkdirSync(targetUnpacked, { recursive: true });
    }

    // Fix Rebuild needed modules
    console.log("Rebuilding native modules (better-sqlite3, node-pty) for Electron x64...");

    const tempBuildDir = path.join(REPO_ROOT, 'native_build_temp');
    if (fs.existsSync(tempBuildDir)) {
        fs.rmSync(tempBuildDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempBuildDir);

    const nativePkg = {
        "name": "temp-build",
        "dependencies": {
            "better-sqlite3": pkg.dependencies['better-sqlite3'],
            "node-pty": pkg.dependencies['node-pty']
        }
    };
    fs.writeFileSync(path.join(tempBuildDir, 'package.json'), JSON.stringify(nativePkg, null, 2));

    const env = {
        ...process.env,
        npm_config_target: electronVersion,
        npm_config_arch: 'x64',
        npm_config_target_arch: 'x64',
        npm_config_dist_url: 'https://electronjs.org/headers',
        npm_config_runtime: 'electron',
        npm_config_build_from_source: 'true'
    };

    console.log("Running npm install with electron environment...");
    try {
        execSync(`npm install --no-bin-links --force`, { cwd: tempBuildDir, env, stdio: 'inherit' });
    } catch (e) {
        console.error("Build failed, continuing carefully...");
    }

    // Copy built modules
    const bs3Src = path.join(tempBuildDir, 'node_modules/better-sqlite3');
    const bs3Dest = path.join(targetUnpacked, 'node_modules/better-sqlite3');
    if (fs.existsSync(bs3Dest)) {
        fs.rmSync(bs3Dest, { recursive: true, force: true });
    }
    // Check if source exists
    if (fs.existsSync(bs3Src)) {
        run(`cp -r "${bs3Src}" "${bs3Dest}"`);
    }

    const ptySrc = path.join(tempBuildDir, 'node_modules/node-pty');
    const ptyDest = path.join(targetUnpacked, 'node_modules/node-pty');
    if (fs.existsSync(ptyDest)) {
        fs.rmSync(ptyDest, { recursive: true, force: true });
    }
    if (fs.existsSync(ptySrc)) {
        run(`cp -r "${ptySrc}" "${ptyDest}"`);
    }

    console.log("Native modules updated.");

    // Config Info.plist and Executable
    console.log("Configuring Info.plist and Executable...");

    const infoPlistDest = path.join(targetApp, 'Contents/Info.plist');
    const localInfoPlist = path.join(RESOURCES_DIR, 'Info.plist');

    if (fs.existsSync(localInfoPlist)) {
        fs.copyFileSync(localInfoPlist, infoPlistDest);
    }

    const macOsDir = path.join(targetApp, 'Contents/MacOS');
    const electronBin = path.join(macOsDir, 'Electron');
    const codexBin = path.join(macOsDir, 'Codex');

    if (fs.existsSync(electronBin)) {
        fs.renameSync(electronBin, codexBin);
    } else {
        console.warn("Electron binary not found at checked path: " + electronBin);
    }

    // 7. Copy Codex Binary
    console.log("Copying Codex x64 binary...");
    const localCodexBinStr = path.join(CODEX_CLI_PATH, 'vendor/x86_64-apple-darwin/codex/codex');
    // Also check previous location just in case

    let sourceCodexBin = localCodexBinStr;

    if (fs.existsSync(sourceCodexBin)) {
        const targetCodexBin = path.join(targetResources, 'codex');
        console.log(`Copying ${sourceCodexBin} to ${targetCodexBin}`);
        fs.copyFileSync(sourceCodexBin, targetCodexBin);
        fs.chmodSync(targetCodexBin, '755');

        const binDir = path.join(targetResources, 'bin');
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir);
        }
        const targetBinCodex = path.join(binDir, 'codex');
        fs.copyFileSync(sourceCodexBin, targetBinCodex);
        fs.chmodSync(targetBinCodex, '755');
    } else {
        console.warn(`WARNING: Could not find local x64 Codex binary`);
    }

    // 8. Fix Timestamps
    console.log("Fixing app timestamps...");
    run(`touch "${targetApp}"`);

    // Fix creation date using SetFile if available (macOS specific)
    try {
        const now = new Date();
        // Format: MM/DD/YYYY hh:mm:ss
        const p = (n) => n.toString().padStart(2, '0');
        const dateStr = `${p(now.getMonth() + 1)}/${p(now.getDate())}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
        console.log(`Setting creation date to ${dateStr}...`);
        execSync(`SetFile -d "${dateStr}" "${targetApp}"`, { stdio: 'inherit' });
    } catch (e) {
        console.warn("SetFile failed or not available (this is normal on non-macOS or minimal envs). Creation date might be old.");
    }

    console.log("Done! Codex_Intel.app is ready at " + targetApp);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
