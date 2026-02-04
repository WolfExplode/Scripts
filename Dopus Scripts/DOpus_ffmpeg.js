// Video/Audio Converter with XML Dialog - DYNAMIC MODE SWITCHING VERSION (FIXED)
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

        // Select first item (index 0)
        if (formats.length > 0) {
            formatCtrl.SelectItem(0);
        }
    }

    // FIX 1: Explicitly set mode to Video (index 0) instead of assuming default
    modeCtrl.SelectItem(0);  // This ensures modeCtrl.value is valid

    // FIX 2: Now populate formats based on the explicitly set mode
    populateFormats(true);   // Video mode = true

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
