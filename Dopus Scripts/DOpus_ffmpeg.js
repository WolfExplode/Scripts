// Video/Audio Converter with XML Dialog
var SETTINGS_FILE = null;  // Set on first use via %APPDATA%

function getSettingsPath(shell) {
    if (!SETTINGS_FILE) {
        SETTINGS_FILE = shell.ExpandEnvironmentStrings("%APPDATA%") + "\\DOpus_ffmpeg_settings.ini";
    }
    return SETTINGS_FILE;
}

function loadLastSettings(shell, fso) {
    var path = getSettingsPath(shell);
    var out = { mode: 0, formatName: "", quality: "23" };
    try {
        if (fso.FileExists(path)) {
            var stream = fso.OpenTextFile(path, 1, false);
            var content = stream.ReadAll();
            stream.Close();
            var lines = content.split("\n");
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].replace(/\r$/, "");
                var eq = line.indexOf("=");
                if (eq > 0) {
                    var key = line.substring(0, eq);
                    var val = line.substring(eq + 1);
                    if (key == "mode") out.mode = parseInt(val, 10) || 0;
                    else if (key == "formatName") out.formatName = val;
                    else if (key == "quality") out.quality = val;
                }
            }
        }
    } catch (e) { /* use defaults */ }
    return out;
}

function saveLastSettings(shell, fso, mode, formatName, quality) {
    try {
        var path = getSettingsPath(shell);
        var stream = fso.OpenTextFile(path, 2, true);  // ForWriting, Create
        stream.WriteLine("mode=" + mode);
        stream.WriteLine("formatName=" + formatName);
        stream.WriteLine("quality=" + (quality || "23"));
        stream.Close();
    } catch (e) { /* ignore */ }
}

function OnClick(clickData) {
    var cmd = clickData.func.command;
    var selected = clickData.func.sourcetab.selected;
    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var shell = new ActiveXObject("WScript.Shell");

    if (selected.count == 0) {
        DOpus.dlg.message("Please select file(s) to convert", "Error");
        return;
    }

    // Format definitions
    var videoFormats = [
        { name: "MP4 H.264 (Fast)", ext: ".mp4", codec: "libx264 -crf 23 -preset fast -c:a aac -b:a 192k -pix_fmt yuv420p" },
        { name: "MP4 H.265/HEVC", ext: ".mp4", codec: "libx265 -crf 28 -preset fast -c:a aac -b:a 192k -pix_fmt yuv420p" },
        { name: "MP4 YouTube Ready", ext: ".mp4", codec: "libx264 -crf 23 -preset slow -c:a aac -b:a 256k -pix_fmt yuv420p -movflags +faststart" },
        { name: "MOV ProRes 422", ext: ".mov", codec: "prores -profile:v 2 -c:a pcm_s16le" },
        { name: "MOV ProRes 4444", ext: ".mov", codec: "prores -profile:v 3 -alpha_bits 0 -c:a pcm_s16le" },
        { name: "MOV H.264", ext: ".mov", codec: "libx264 -crf 23 -preset fast -c:a aac -b:a 192k -pix_fmt yuv420p" },
        { name: "WebM VP9", ext: ".webm", codec: "libvpx-vp9 -crf 30 -b:v 0 -c:a libopus -b:a 128k" },
        { name: "AVI Uncompressed", ext: ".avi", codec: "rawvideo -c:a pcm_s16le" }
    ];

    var audioFormats = [
        { name: "MP3 High Quality (320k)", ext: ".mp3", codec: "libmp3lame -q:a 0 -b:a 320k" },
        { name: "MP3 Standard (192k)", ext: ".mp3", codec: "libmp3lame -q:a 2 -b:a 192k" },
        { name: "MP3 Voice (64k)", ext: ".mp3", codec: "libmp3lame -q:a 6 -b:a 64k" },
        { name: "FLAC Lossless", ext: ".flac", codec: "flac" },
        { name: "WAV PCM 16-bit", ext: ".wav", codec: "pcm_s16le" },
        { name: "WAV PCM 24-bit", ext: ".wav", codec: "pcm_s24le" },
        { name: "AAC M4A", ext: ".m4a", codec: "aac -b:a 256k" },
        { name: "OGG Vorbis", ext: ".ogg", codec: "libvorbis -q:a 6" },
        { name: "OGG Opus", ext: ".ogg", codec: "libopus -b:a 128k" }
    ];

    // Create detached dialog
    var dlg = DOpus.dlg;
    dlg.window = clickData.func.sourcetab;
    dlg.template = "ConverterDlg";
    dlg.detach = true;

    // Create dialog first (hidden)
    dlg.Create();

    // Get control references
    var modeCtrl = dlg.control("mode_combo");
    var formatCtrl = dlg.control("format_combo");
    var qualityCtrl = dlg.control("quality_edit");

    // Function to populate format dropdown based on mode
    function populateFormats(isVideo) {
        var formats = isVideo ? videoFormats : audioFormats;

        // Clear existing items
        formatCtrl.RemoveItem(-1);

        // Add new items
        for (var i = 0; i < formats.length; i++) {
            formatCtrl.AddItem(formats[i].name, formats[i].name);
        }

        // Select first item (index 0) unless formatName provided
        if (formats.length > 0) {
            formatCtrl.SelectItem(0);
        }
    }

    // Restore last used settings
    var last = loadLastSettings(shell, fso);
    var modeIdx = (last.mode === 1) ? 1 : 0;
    modeCtrl.SelectItem(modeIdx);
    populateFormats(modeIdx === 0);
    if (last.formatName) {
        try {
            var fmtItem = formatCtrl.GetItemByName(last.formatName);
            if (fmtItem) formatCtrl.SelectItem(fmtItem);
        } catch (e) { /* keep default selection */ }
    }
    qualityCtrl.value = last.quality || "23";

    // Show the fully initialized dialog
    dlg.Show();

    // Variable to track if user clicked OK or Cancel
    var dialogResult = 0;

    // Message loop to handle events
    while (true) {
        var msg = dlg.GetMsg();

        // Exit if dialog closed
        if (!msg.result) {
            dialogResult = dlg.result;
            break;
        }

        // Handle selection change events
        if (msg.event == "selchange") {
            if (msg.control == "mode_combo") {
                // Mode changed - update format dropdown
                var modeItem = modeCtrl.value;
                var isVideo = (modeItem.index == 0);
                populateFormats(isVideo);

                // FIX 3: Re-select first item after repopulating to ensure valid selection
                if (formatCtrl.count > 0) {
                    formatCtrl.SelectItem(0);
                }
            }
        }
    }

    // Check if user clicked OK (close="1") or Cancel (close="2")
    // dlg.result will be "1" for OK, "2" for Cancel, or "0" for window close
    if (dialogResult == "0" || dialogResult == "2" || dialogResult == "cancel_btn") {
        DOpus.Output("Dialog cancelled");
        return;
    }

    // Get final values
    var modeItem = modeCtrl.value;
    var formatItem = formatCtrl.value;
    var quality = qualityCtrl.value;

    var modeIndex = modeItem.index;
    var formatIndex = formatItem.index;

    saveLastSettings(shell, fso, modeIndex, formatItem.name, quality);

    DOpus.Output("Mode index: " + modeIndex);
    DOpus.Output("Format index: " + formatIndex);
    DOpus.Output("Quality: " + quality);
    DOpus.Output("Mode: " + modeItem.name);
    DOpus.Output("Format: " + formatItem.name);

    // Determine mode and format
    var isVideo = (modeIndex == 0);
    var formats = isVideo ? videoFormats : audioFormats;

    if (formatIndex < 0 || formatIndex >= formats.length) {
        DOpus.dlg.message("Invalid format selected", "Error");
        return;
    }

    var fmt = formats[formatIndex];

    // Process files
    var processed = 0;
    var failed = 0;
    var enumerator = new Enumerator(selected);

    for (; !enumerator.atEnd(); enumerator.moveNext()) {
        var item = enumerator.item();
        var outPath = item.path + "\\" + item.name_stem + fmt.ext;

        // Avoid overwrite
        var counter = 1;
        while (fso.fileExists(outPath)) {
            outPath = item.path + "\\" + item.name_stem + "_" + counter + fmt.ext;
            counter++;
        }

        // Build ffmpeg command
        var exec;
        if (isVideo) {
            exec = 'ffmpeg.exe -i "' + item.realpath + '" -c:v ' + fmt.codec + ' -y "' + outPath + '"';
        } else {
            exec = 'ffmpeg.exe -i "' + item.realpath + '" -vn -c:a ' + fmt.codec + ' -y "' + outPath + '"';
        }

        DOpus.Output("Converting: " + item.name + " -> " + fmt.name);

        try {
            var exitCode = shell.Run(exec, 0, true);
            if (exitCode == 0) {
                processed++;
                DOpus.Output("Success: " + outPath);
            } else {
                DOpus.Output("Failed (code " + exitCode + "): " + item.name);
                failed++;
            }
        } catch (e) {
            DOpus.Output("Error: " + e.message);
            failed++;
        }
    }

    // Refresh file display
    clickData.func.command.RunCommand("Go REFRESH");
}
