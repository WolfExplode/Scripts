// gallery-dl — Pinterest profiles; board list cached under %APPDATA%\DOpus_gallery_dl_pinterest\
var GALLERY_DL_EXE = "C:\\Users\\WXP\\AppData\\Local\\Programs\\Python\\Python310\\Scripts\\gallery-dl.exe";

var PIN_URLS = [
    "https://www.pinterest.com/allyfire1281/",
    "https://www.pinterest.com/FedTheBeast/",
    "https://www.pinterest.com/fireally31/"
];

function trimStr(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
}

function showError(shell, text, title) {
    shell.Popup(text, 0, title, 16);
}

function showInfo(shell, text, title) {
    shell.Popup(text, 0, title, 64);
}

function getCacheDir(shell) {
    return shell.ExpandEnvironmentStrings("%APPDATA%") + "\\DOpus_gallery_dl_pinterest";
}

function userSlugFromProfileUrl(url) {
    var s = trimStr(url).replace(/\/+$/, "");
    var parts = s.split("/");
    var last = parts[parts.length - 1] || "user";
    return last.replace(/[^\w\-]/g, "_");
}

function getBoardCachePath(shell, userSlug) {
    return getCacheDir(shell) + "\\boards_" + userSlug + ".txt";
}

function ensureCacheDir(fso, shell) {
    var dir = getCacheDir(shell);
    if (!fso.FolderExists(dir)) {
        fso.CreateFolder(dir);
    }
}

function isPinterestBoardLine(line) {
    line = trimStr(line);
    if (!line || line.indexOf("#") === 0) return false;
    if (line.toLowerCase().indexOf("pinterest.") < 0) return false;
    if (line.indexOf("/pin/") >= 0) return false;
    var m = line.match(/pinterest\.[^/]+\/([^/]+)\/([^/?#]+)\/?$/);
    if (!m) return false;
    var seg = m[2].toLowerCase();
    if (seg === "pins" || seg === "_created" || seg === "_saved" || seg === "search" || seg === "ideas") return false;
    return true;
}

function boardDisplayNameFromUrl(url) {
    var m = trimStr(url).match(/\/([^/?#]+)\/?$/);
    if (!m) return url;
    try {
        return decodeURIComponent(m[1].replace(/\+/g, " "));
    } catch (e) {
        return m[1];
    }
}

function psQuoteSingle(s) {
    return String(s).replace(/'/g, "''");
}

function writeBoardCache(fso, shell, userSlug, lines) {
    ensureCacheDir(fso, shell);
    var path = getBoardCachePath(shell, userSlug);
    var stream = fso.CreateTextFile(path, true, false);
    for (var i = 0; i < lines.length; i++) {
        stream.WriteLine(lines[i]);
    }
    stream.Close();
}

function readAndFilterBoardUrls(fso, tempOutPath) {
    var out = [];
    if (!fso.FileExists(tempOutPath)) return out;
    var stream = fso.OpenTextFile(tempOutPath, 1, false);
    var content = stream.ReadAll();
    stream.Close();
    var lines = content.split(/\r?\n/);
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
        var line = trimStr(lines[i]);
        if (!isPinterestBoardLine(line)) continue;
        if (seen[line]) continue;
        seen[line] = true;
        out.push(line);
    }
    return out;
}

function populateBoardCombo(dlg, profileIdx, shell, fso) {
    var combo = dlg.control("board_combo");
    var profileUrl = PIN_URLS[profileIdx];
    var slug = userSlugFromProfileUrl(profileUrl);

    combo.RemoveItem(-1);
    combo.AddItem("(All boards — entire profile)", profileUrl);

    var path = getBoardCachePath(shell, slug);
    if (fso.FileExists(path)) {
        var stream = fso.OpenTextFile(path, 1, false);
        var content = stream.ReadAll();
        stream.Close();
        var lines = content.split(/\r?\n/);
        var seen = {};
        for (var i = 0; i < lines.length; i++) {
            var line = trimStr(lines[i]);
            if (!line || line.indexOf("#") === 0) continue;
            if (!isPinterestBoardLine(line)) continue;
            if (seen[line]) continue;
            seen[line] = true;
            combo.AddItem(boardDisplayNameFromUrl(line), line);
        }
    }

    combo.SelectItem(0);
}

function profileIdxFromDlg(dlg) {
    if (dlg.control("pin_radio2").value) return 1;
    if (dlg.control("pin_radio3").value) return 2;
    return 0;
}

function runRefreshBoardCache(shell, fso, profileUrl, useCookies) {
    if (!fso.FileExists(GALLERY_DL_EXE)) {
        showError(shell, "gallery-dl.exe not found at:\n" + GALLERY_DL_EXE, "gallery-dl Error");
        return 0;
    }

    var slug = userSlugFromProfileUrl(profileUrl);
    var tempOut = shell.ExpandEnvironmentStrings("%TEMP%") + "\\gdl-boards-raw-" + slug + ".txt";
    var tempPs1 = shell.ExpandEnvironmentStrings("%TEMP%") + "\\gdl-list-boards.ps1";

    try {
        var ps1 = fso.CreateTextFile(tempPs1, true, false);
        ps1.WriteLine("$ErrorActionPreference = 'Continue'");
        ps1.WriteLine("$gd = '" + psQuoteSingle(GALLERY_DL_EXE) + "'");
        ps1.WriteLine("$u = '" + psQuoteSingle(profileUrl) + "'");
        ps1.WriteLine("$o = '" + psQuoteSingle(tempOut) + "'");
        ps1.WriteLine("$args = @('-g')");
        if (useCookies) {
            ps1.WriteLine("$args += '--cookies-from-browser'");
            ps1.WriteLine("$args += 'firefox'");
        }
        ps1.WriteLine("$args += $u");
        ps1.WriteLine("& $gd @args 2>&1 | ForEach-Object { $_.ToString() } | Set-Content -LiteralPath $o -Encoding utf8");
        ps1.WriteLine("exit $LASTEXITCODE");
        ps1.Close();
    } catch (e) {
        showError(shell, "Failed to write list script: " + e.message, "gallery-dl Error");
        return 0;
    }

    var waitPs = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + tempPs1 + '"';
    shell.Run(waitPs, 0, true);

    var boardLines = readAndFilterBoardUrls(fso, tempOut);
    if (boardLines.length === 0) {
        showError(
            shell,
            "No board URLs were returned for:\n" + profileUrl + "\n\nCheck Firefox cookies, network, and gallery-dl. Previous cache was not overwritten.",
            "gallery-dl"
        );
        return 0;
    }

    writeBoardCache(fso, shell, slug, boardLines);
    try {
        if (fso.FileExists(tempOut)) fso.DeleteFile(tempOut);
    } catch (e2) { /* ignore */ }

    return boardLines.length;
}

function OnClick(clickData) {
    var shell = new ActiveXObject("WScript.Shell");
    var fso = new ActiveXObject("Scripting.FileSystemObject");

    var destPath = String(clickData.func.sourcetab.path);

    var dlg = DOpus.dlg;
    dlg.window = clickData.func.sourcetab;
    dlg.template = "GalleryDlPinterestDlg";
    dlg.detach = true;
    dlg.Create();

    dlg.control("pin_radio1").value = true;
    dlg.control("cookies_check").value = true;
    dlg.control("keepps_check").value = false;

    populateBoardCombo(dlg, 0, shell, fso);

    dlg.Show();

    var dialogResult = 0;
    while (true) {
        var msg = dlg.GetMsg();
        if (!msg.result) {
            dialogResult = dlg.result;
            break;
        }
        if (msg.event == "click" && msg.control == "refresh_btn") {
            var pidx = profileIdxFromDlg(dlg);
            var useC = dlg.control("cookies_check").value;
            var nb = runRefreshBoardCache(shell, fso, PIN_URLS[pidx], useC);
            if (nb > 0) {
                populateBoardCombo(dlg, pidx, shell, fso);
                showInfo(shell, "Saved " + nb + " board(s) for this profile.\n\n" + getBoardCachePath(shell, userSlugFromProfileUrl(PIN_URLS[pidx])), "gallery-dl");
            }
        } else if (msg.event == "click" && (msg.control == "pin_radio1" || msg.control == "pin_radio2" || msg.control == "pin_radio3")) {
            var pi = profileIdxFromDlg(dlg);
            populateBoardCombo(dlg, pi, shell, fso);
        }
    }

    if (dialogResult == "0" || dialogResult == "2") {
        DOpus.Output("gallery-dl Pinterest: cancelled");
        return;
    }

    var idx = profileIdxFromDlg(dlg);

    var url = dlg.control("board_combo").value;
    if (!url) url = PIN_URLS[idx];

    var useFirefoxCookies = dlg.control("cookies_check").value;
    var keepPsOpen = dlg.control("keepps_check").value;

    if (!fso.FileExists(GALLERY_DL_EXE)) {
        showError(shell, "gallery-dl.exe not found at:\n" + GALLERY_DL_EXE, "gallery-dl Error");
        return;
    }

    var tempPs1 = shell.ExpandEnvironmentStrings("%TEMP%") + "\\gallery-dl-pinterest-run.ps1";
    try {
        var ps1 = fso.CreateTextFile(tempPs1, true, false);
        ps1.WriteLine("Set-Location '" + psQuoteSingle(destPath) + "'");
        var gdArgs = useFirefoxCookies ? " --cookies-from-browser firefox" : "";
        ps1.WriteLine("& '" + psQuoteSingle(GALLERY_DL_EXE) + "'" + gdArgs + " '" + psQuoteSingle(url) + "'");
        ps1.Close();
    } catch (e) {
        showError(shell, "Failed to write temp script: " + e.message, "gallery-dl Error");
        return;
    }

    var labels = ["allyfire1281", "FedTheBeast", "fireally31"];
    DOpus.Output("gallery-dl Pinterest | Profile: " + labels[idx]);
    DOpus.Output("gallery-dl Pinterest | Firefox cookies: " + (useFirefoxCookies ? "on" : "off"));
    DOpus.Output("gallery-dl Pinterest | URL: " + url);
    DOpus.Output("gallery-dl Pinterest | Dest: " + destPath);
    DOpus.Output("gallery-dl Pinterest | Exe: " + GALLERY_DL_EXE);
    DOpus.Output("gallery-dl Pinterest | Board cache: " + getBoardCachePath(shell, userSlugFromProfileUrl(PIN_URLS[idx])));

    var psCmd = keepPsOpen
        ? 'powershell -NoExit -ExecutionPolicy Bypass -File "' + tempPs1 + '"'
        : 'powershell -ExecutionPolicy Bypass -File "' + tempPs1 + '"';
    shell.Run(psCmd, 1, false);
}
