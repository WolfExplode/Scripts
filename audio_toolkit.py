from re import T
import gradio as gr
import os
import subprocess
from pathlib import Path
import shutil

# Add mutagen for metadata tagging
try:
    from mutagen.easyid3 import EasyID3
    from mutagen.id3 import ID3NoHeaderError
    from mutagen.mp4 import MP4
    from mutagen.flac import FLAC
    from mutagen.oggvorbis import OggVorbis
    from mutagen.asf import ASF
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

# ------------------------------------------------------------------
# Original helper functions (these would need to be accessible in your Gradio environment)
# ------------------------------------------------------------------
AUDIO_EXTS = ('.mp3', '.m4a', '.aac', '.flac', '.wav', '.opus')
IMAGE_EXTS = ('.jpg', '.jpeg', '.png')
VIDEO_EXTS = ('.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv')

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Metadata tagging constants
PREFIX = "[MapleStory BGM] "  # what to strip from filenames

def set_title_from_filename(audio_path):
    """Set the TITLE tag with the prefix removed. Supports multiple audio formats."""
    if not MUTAGEN_AVAILABLE:
        return False, "Mutagen library not available for metadata tagging"
    
    if not audio_path or not os.path.exists(audio_path):
        return False, f"Audio file not found: {audio_path}"
    
    # Get file extension to determine format
    file_ext = os.path.splitext(audio_path)[1].lower()
    basename = os.path.splitext(os.path.basename(audio_path))[0]
    new_title = basename.removeprefix(PREFIX)  # Python 3.9+
    
    try:
        if file_ext == '.mp3':
            # Handle MP3 files with ID3 tags
            try:
                audio = EasyID3(audio_path)
            except ID3NoHeaderError:
                audio = EasyID3()
                audio.save(audio_path)
                audio = EasyID3(audio_path)
            
            audio["title"] = [new_title]
            audio.save(audio_path)
            
        elif file_ext in ['.m4a', '.mp4']:
            # Handle M4A/MP4 files
            audio = MP4(audio_path)
            audio['\xa9nam'] = [new_title]  # M4A title tag
            audio.save()
            
        elif file_ext == '.flac':
            # Handle FLAC files
            audio = FLAC(audio_path)
            audio['title'] = [new_title]
            audio.save()
            
        elif file_ext == '.ogg':
            # Handle OGG files
            audio = OggVorbis(audio_path)
            audio['title'] = [new_title]
            audio.save()
            
        elif file_ext == '.wma':
            # Handle WMA files
            audio = ASF(audio_path)
            audio['WM/Title'] = [new_title]
            audio.save()
            
        else:
            return False, f"Unsupported audio format: {file_ext}"
        
        return True, f"title = {new_title} ({file_ext})"
        
    except Exception as e:
        return False, f"Error setting metadata for {file_ext}: {e}"

def get_audio_codec(video_file):
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video_file
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return "??"  # Indicate failure to get codec


def extract_audio(video_file, output_dir, output_ext, overwrite=False, re_encode=False, target_format=None, quality=None):
    # Create output path in specified directory
    video_name = os.path.splitext(os.path.basename(video_file))[0]
    output_file = os.path.join(output_dir, f"{video_name}.{output_ext}")

    if os.path.exists(output_file) and not overwrite:
        return None  # Indicate skipping

    if re_encode and target_format:
        # Re-encode with specified format and quality
        cmd = ['ffmpeg', '-i', video_file, '-vn']
        
        # Add format-specific encoding settings
        if target_format == 'mp3':
            cmd.extend(['-c:a', 'libmp3lame', '-b:a', quality or '192k'])
        elif target_format == 'aac':
            cmd.extend(['-c:a', 'aac', '-b:a', quality or '192k'])
        elif target_format == 'flac':
            cmd.extend(['-c:a', 'flac'])
        elif target_format == 'opus':
            cmd.extend(['-c:a', 'libopus', '-b:a', quality or '128k'])
        elif target_format == 'wav':
            cmd.extend(['-c:a', 'pcm_s16le'])
        else:
            # Default to AAC if unknown format
            cmd.extend(['-c:a', 'aac', '-b:a', quality or '192k'])
        
        cmd.append(output_file)
    else:
        # No re-encoding - just copy the audio stream
        cmd = ['ffmpeg', '-i', video_file, '-vn', '-c:a', 'copy', output_file]
    
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return output_file
    except subprocess.CalledProcessError:
        return None  # Indicate failure


def extract_first_frame(video_file, output_dir):
    # Create output path in specified directory
    video_name = os.path.splitext(os.path.basename(video_file))[0]
    output_image = os.path.join(output_dir, f"{video_name}.jpg")
    cmd = ["ffmpeg", "-y", "-i", video_file, "-frames:v", "1", "-q:v", "2", output_image]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return output_image
    except subprocess.CalledProcessError:
        return None


def add_album_art(audio_file, image_file):
    temp_file = f"{audio_file}.tmp"
    file_ext = os.path.splitext(audio_file)[1][1:]
    output_format = 'mp4' if file_ext == 'm4a' else file_ext

    cmd = [
        'ffmpeg', '-i', audio_file, '-i', image_file,
        '-c', 'copy', '-map', '0', '-map', '1',
        '-disposition:v:0', 'attached_pic',
        '-metadata:s:v:0', 'title=Album cover',
        '-metadata:s:v:0', 'comment=Cover (front)',
        '-metadata:s:v:0', 'mimetype=image/jpeg',
        '-f', output_format, '-y', temp_file
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(temp_file, audio_file)
        return True
    except subprocess.CalledProcessError:
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False


def process_videos_in_directory(
        input_directory: str,
        output_directory: str,
        use_first_frame_as_cover: bool,
        delete_original_video: bool,
        overwrite_existing_files: bool,
        add_metadata_tags: bool,
        re_encode_audio: bool,
        target_audio_format: str,
        audio_quality: str,
        external_cover_image_obj: gr.File = None
):
    """
    Processes all video files in the specified input directory.
    """
    status_messages = []
    processed_files = []
    
    # Validate directories
    if not input_directory or not os.path.exists(input_directory):
        return "❌ Input directory does not exist or is not specified.", None
    
    if not output_directory:
        output_directory = input_directory  # Default to same directory
    
    # Create output directory if it doesn't exist
    try:
        os.makedirs(output_directory, exist_ok=True)
    except Exception as e:
        return f"❌ Cannot create output directory: {e}", None
    
    # Find all video files in the input directory
    video_files = []
    for ext in VIDEO_EXTS:
        video_files.extend(Path(input_directory).glob(f"*{ext}"))
    
    if not video_files:
        return f"No video files found in: {input_directory}", None
    
    status_messages.append(f"📁 Input directory: {input_directory}")
    status_messages.append(f"📁 Output directory: {output_directory}")
    status_messages.append(f"🎬 Found {len(video_files)} video files to process:")
    for video_file in video_files:
        status_messages.append(f"  - {video_file.name}")
    
    # Show encoding settings
    if re_encode_audio:
        status_messages.append(f"🔄 Re-encoding: {target_audio_format.upper()} at {audio_quality}")
    else:
        status_messages.append("📋 No re-encoding: Copying original audio stream")
    
    status_messages.append("\n" + "="*60 + "\n")
    
    for i, video_file in enumerate(video_files, 1):
        status_messages.append(f"[{i}/{len(video_files)}] Processing: {video_file.name}")
        
        try:
            if re_encode_audio:
                # Use user-specified format and quality
                target_ext = target_audio_format
            else:
                # Detect original codec and use appropriate extension
                codec = get_audio_codec(str(video_file))
                ext_map = {"aac": "m4a", "mp3": "mp3", "flac": "flac", "opus": "opus"}
                target_ext = ext_map.get(codec, "m4a")
            
            # Create expected output path
            video_name = video_file.stem
            expected_audio_output_path = Path(output_directory) / f"{video_name}.{target_ext}"
            
            audio_path = extract_audio(
                str(video_file), 
                output_directory, 
                target_ext, 
                overwrite=overwrite_existing_files,
                re_encode=re_encode_audio,
                target_format=target_audio_format if re_encode_audio else None,
                quality=audio_quality if re_encode_audio else None
            )
            
            if audio_path is None:
                if expected_audio_output_path.exists() and not overwrite_existing_files:
                    status_messages.append(f"  ⏭️ Skipped: Audio file already exists")
                else:
                    status_messages.append(f"  ❌ Failed to extract audio")
                continue
            
            status_messages.append(f"  ✅ Audio extracted to {os.path.basename(audio_path)}")
            processed_files.append(audio_path)
            
            # Handle album art
            if use_first_frame_as_cover:
                status_messages.append("  Extracting first frame for cover...")
                img = extract_first_frame(str(video_file), output_directory)
                if img:
                    ok = add_album_art(audio_path, img)
                    # Clean up the temporary image file after embedding
                    try:
                        os.remove(img)
                        status_messages.append("  ✅ Album art (first frame) embedded and cleaned up.")
                    except OSError:
                        status_messages.append("  ✅ Album art (first frame) embedded (cleanup failed).")
                    if not ok:
                        status_messages.append("  ❌ Failed to embed album art (first frame).")
                else:
                    status_messages.append("  ❌ Could not extract first frame for album art.")
            elif external_cover_image_obj is not None:
                status_messages.append("  Embedding external album art...")
                external_image_path = external_cover_image_obj.name
                ok = add_album_art(audio_path, external_image_path)
                if ok:
                    status_messages.append("  ✅ Album art (external) embedded.")
                else:
                    status_messages.append("  ❌ Failed to embed external album art.")
            else:
                status_messages.append("  ⏭️ Album art embedding skipped.")
            
            # Add metadata tags
            if add_metadata_tags:
                status_messages.append("  Adding metadata tags...")
                success, result = set_title_from_filename(audio_path)
                if success:
                    status_messages.append(f"  ✅ Metadata tagged: {result}")
                else:
                    status_messages.append(f"  ⚠️ Metadata tagging failed: {result}")
            else:
                status_messages.append("  ⏭️ Metadata tagging skipped.")
            
            # Delete original video (only if input and output are the same directory)
            if delete_original_video and input_directory == output_directory:
                try:
                    video_file.unlink()
                    status_messages.append(f"  🗑️ Original video deleted.")
                except OSError as e:
                    status_messages.append(f"  ❌ Failed to delete original video: {e}")
            elif delete_original_video:
                status_messages.append(f"  ⚠️ Skipped deleting original (different input/output directories)")
            
        except Exception as e:
            status_messages.append(f"  ❌ Error: {e}")
        
        status_messages.append("")  # Empty line for readability
    
    status_messages.append("="*60)
    status_messages.append(f"🎉 Processing complete! {len(processed_files)} files processed successfully.")
    status_messages.append(f"📁 Output location: {output_directory}")
    
    return "\n".join(status_messages)


# Define the Gradio interface
with gr.Blocks() as demo:
    gr.Markdown("# 🎬 Video Audio Extractor - Batch Processor")
    gr.Markdown("Extract audio from video files and optionally embed album art.")
    gr.Markdown(f"**Script directory:** {SCRIPT_DIR}")

    with gr.Row():
        with gr.Column():
            # Directory inputs
            input_dir_input = gr.Textbox(
                label="Input Directory Path",
                placeholder="Enter path to folder containing video files",
                value=SCRIPT_DIR,
                info="Directory containing video files to process"
            )
            
            output_dir_input = gr.Textbox(
                label="Output Directory Path (optional)",
                placeholder="Leave empty to use same as input directory",
                value="",
                info="Directory to save extracted audio files (defaults to input directory)"
            )

            with gr.Accordion("Audio Encoding Options", open=False):
                re_encode_checkbox = gr.Checkbox(
                    label="Re-encode audio (uncheck to copy original audio stream)",
                    value=False,
                    info="Re-encoding allows format conversion but takes longer"
                )
                
                target_format_dropdown = gr.Dropdown(
                    label="Target Audio Format",
                    choices=["mp3", "aac", "flac", "opus", "wav"],
                    value="mp3",
                    info="Format to convert audio to (when re-encoding)"
                )
                
                quality_dropdown = gr.Dropdown(
                    label="Audio Quality",
                    choices=["64k", "96k", "128k", "160k", "192k", "256k", "320k"],
                    value="192k",
                    info="Bitrate for compressed formats (when re-encoding)"
                )

            with gr.Accordion("Album Art Options", open=False):
                use_first_frame_checkbox = gr.Checkbox(
                    label="Use first frame of video as album cover",
                    value=True
                )
                external_cover_input = gr.File(
                    label="Upload External Cover Image (if not using first frame)",
                    type="filepath",
                    file_types=["image"]
                )

            with gr.Accordion("Metadata Options", open=False):
                add_metadata_checkbox = gr.Checkbox(
                    label="Add metadata tags (TITLE from filename)",
                    value=True,
                    info="Removes '[MapleStory BGM] ' prefix and sets TITLE tag"
                )
                if not MUTAGEN_AVAILABLE:
                    gr.Markdown("⚠️ **Metadata tagging requires:** `pip install mutagen`")

            delete_original_checkbox = gr.Checkbox(
                label="Delete original videos after extraction",
                value=False,
                info="Only works when input and output directories are the same"
            )
            overwrite_checkbox = gr.Checkbox(
                label="Overwrite existing audio files",
                value=False
            )

            process_button = gr.Button("🚀 Start Batch Processing", variant="primary", size="lg")

        with gr.Column():
            status_output = gr.Textbox(
                label="Processing Status", 
                lines=20, 
                interactive=False,
                max_lines=30
            )

    # Connect the UI components to the processing function
    process_button.click(
        fn=process_videos_in_directory,
        inputs=[
            input_dir_input,
            output_dir_input,
            use_first_frame_checkbox,
            delete_original_checkbox,
            overwrite_checkbox,
            add_metadata_checkbox,
            re_encode_checkbox,
            target_format_dropdown,
            quality_dropdown,
            external_cover_input
        ],
        outputs=[
            status_output,
        ]
    )

demo.launch()
