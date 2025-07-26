# Video Audio Extractor - Batch Processor
This Gradio application allows you to extract audio from multiple video files in a specified directory, with various options for encoding, album art embedding, and metadata tagging.
## Features
- **Batch Processing:** Process all video files within a given input directory.
- **Audio Extraction:** Extract audio streams from common video formats.
- **Audio Re-encoding:** Optionally re-encode extracted audio to various formats (MP3, AAC, FLAC, Opus, WAV) with adjustable quality.
- **Album Art Embedding:**
    - Use the first frame of the video as the album cover.
    - Upload an external image file to use as the album cover.
- **Metadata Tagging:** Automatically set the `TITLE` metadata tag based on the filename, with an option to remove a specified prefix (e.g., `[MapleStory BGM]` ).
- **Original Video Deletion:** Option to delete the original video files after successful audio extraction (only works if input and output directories are the same).
- **Overwrite Control:** Prevent overwriting existing audio files.
- **Real-time Status Updates:** View processing status and logs directly in the Gradio interface.
- **Audio Preview:** Listen to the last extracted audio file directly in the application.

## Requirements
- Python 3.x
- `ffmpeg` and `ffprobe` (must be installed and accessible in your system's PATH)
- `Gradio` Python library (`pip install gradio`)
- `mutagen` Python library (optional, but highly recommended for metadata tagging: `pip install mutagen`)

## Installation
1. **Install FFmpeg:** Download and install `ffmpeg` from [ffmpeg.org](https://ffmpeg.org/download.html "null"). Ensure that `ffmpeg` and `ffprobe` are added to your system's PATH environment variable.
2. **Install Python Dependencies:**
    ```
    pip install gradio mutagen
    ```
## How to Use
1. **Save the Script:** Save the provided Python code as `audio_toolkit.py` (or any other `.py` file).
2. **Run the Application:** Open your terminal or command prompt, navigate to the directory where you saved the script, and run:
    ```
    python audio_toolkit.py
    ```
3. **Access the Interface:** A local URL (usually `http://127.0.0.1:7860/`) will be displayed in your terminal. Open this URL in your web browser to access the Gradio interface.
4. **Configure and Process:**
    - **Input Directory Path:** Enter the full path to the folder containing your video files. By default, it will show the script's current directory.
    - **Output Directory Path (optional):** Specify where you want the extracted audio files to be saved. If left empty, audio files will be saved in the same directory as the input videos.
    - **Audio Encoding Options (Accordion):**
        - **Re-encode audio:** Check this box if you want to convert the audio to a specific format and quality. If unchecked, the original audio stream will be copied (faster, but no format conversion).
        - **Target Audio Format:** Choose the desired output format (e.g., `mp3`, `aac`).
        - **Audio Quality:** Select the bitrate for compressed formats.
    - **Album Art Options (Accordion):**
        - **Use first frame of video as album cover:** If checked, the first frame of each video will be extracted and embedded as album art.
        - **Upload External Cover Image:** If you prefer a custom cover, upload an image file here. This option takes precedence over "Use first frame" if both are selected.
    - **Metadata Options (Accordion):**
        - **Add metadata tags (TITLE from filename):** If checked, the script will attempt to set the `TITLE` tag of the audio file based on its filename, removing the `[MapleStory BGM]` prefix if present.
        - _Note:_ If `mutagen` is not installed, a warning will appear, and metadata tagging will be skipped.
    - **Delete original videos after extraction:** If checked, the original video files will be deleted _only if_ the input and output directories are the same.
    - **Overwrite existing audio files:** If checked, any existing audio files with the same name in the output directory will be overwritten. If unchecked, they will be skipped.
    - **Start Batch Processing:** Click this button to begin the extraction process.
5. **Monitor Status:** The "Processing Status" textbox will display real-time updates and logs. The "Last Extracted Audio (Preview)" will allow you to listen to the most recently processed audio file.
## Helper Functions
The script includes several helper functions:
- `set_title_from_filename(audio_path)`: Sets the `TITLE` metadata tag for various audio formats.
- `get_audio_codec(video_file)`: Retrieves the audio codec of a video file using `ffprobe`.
- `extract_audio(...)`: Extracts audio from a video file, with options for re-encoding and quality.
- `extract_first_frame(video_file, output_dir)`: Extracts the first frame of a video as a JPEG image.
- `add_album_art(audio_file, image_file)`: Embeds an image file as album art into an audio file.
- `process_videos_in_directory(...)`: The main function that orchestrates the batch processing of video files.
## Important Notes
- **FFmpeg/FFprobe:** Ensure `ffmpeg` and `ffprobe` are correctly installed and in your system's PATH for the script to function.
- **Mutagen:** While optional, installing `mutagen` is necessary for the metadata tagging feature to work.
- **File Paths:** Use absolute paths for input and output directories to avoid issues.
- **Prefix for Metadata:** The script is configured to remove `[MapleStory BGM]` from filenames when setting the title. You can modify the `PREFIX` constant in the script if you have a different prefix to remove.
