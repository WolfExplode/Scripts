import gradio as gr
import os
import subprocess
from pathlib import Path
import json
import concurrent.futures

# Minimal helper to surface a concise ffmpeg/ffprobe error message
def _last_stderr_line(proc_error: subprocess.CalledProcessError) -> str:
    try:
        if proc_error.stderr:
            lines = proc_error.stderr.decode(errors='ignore').strip().splitlines()
            for line in reversed(lines):
                if line.strip():
                    return line.strip()
    except Exception:
        pass
    return ""

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


def ffprobe_audio_streams(input_path):
    cmd = [
        'ffprobe', '-v', 'error', '-show_streams', '-select_streams', 'a',
        '-of', 'json', input_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout or '{}')
        streams = data.get('streams', [])
        return streams
    except subprocess.CalledProcessError:
        return []
    except json.JSONDecodeError:
        return []


def scan_file_tracks_and_channels(input_path):
    streams = ffprobe_audio_streams(input_path)
    if not streams:
        return "No audio streams found or failed to probe."
    lines = []
    lines.append(f"File: {os.path.basename(input_path)}")
    lines.append(f"Audio tracks: {len(streams)}")
    for i, s in enumerate(streams):
        codec = s.get('codec_name', 'unknown')
        channels = s.get('channels', 'unknown')
        layout = s.get('channel_layout', 'unknown')
        lang = s.get('tags', {}).get('language', '') if isinstance(s.get('tags'), dict) else ''
        lang_str = f", lang={lang}" if lang else ""
        lines.append(f"  - track a:{i}: codec={codec}, channels={channels}, layout={layout}{lang_str}")
    return "\n".join(lines)


def codec_to_extension(codec_name):
    # Map common codecs to container extension suitable for stream copy
    mapping = {
        'aac': 'm4a',
        'alac': 'm4a',
        'flac': 'flac',
        'mp3': 'mp3',
        'opus': 'opus',
        'vorbis': 'ogg',
        'pcm_s16le': 'wav',
        'pcm_s24le': 'wav',
        'pcm_s32le': 'wav',
        'ac3': 'ac3',
        'eac3': 'eac3',
    }
    return mapping.get(codec_name, 'm4a')


def extract_all_audio_streams(input_path, output_dir, overwrite=False, preserve_metadata=True):
    streams = ffprobe_audio_streams(input_path)
    if not streams:
        return [], ["  ❌ No audio streams found"]
    created = []
    msgs = []
    base = os.path.splitext(os.path.basename(input_path))[0]
    for idx, s in enumerate(streams):
        codec = s.get('codec_name', 'unknown')
        ext = codec_to_extension(codec)
        out_path = os.path.join(output_dir, f"{base}.a{idx}.{ext}")
        if os.path.exists(out_path) and not overwrite:
            msgs.append(f"  ⏭️ Skipped stream a:{idx} (exists)")
            continue
        cmd = ['ffmpeg']
        if overwrite:
            cmd.append('-y')
        cmd += ['-i', input_path, '-map', f'0:a:{idx}', '-c:a', 'copy']
        if preserve_metadata:
            cmd.extend(['-map_metadata', '0'])
        cmd.append(out_path)
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
            created.append(out_path)
            msgs.append(f"  ✅ Extracted stream a:{idx} -> {os.path.basename(out_path)}")
        except subprocess.CalledProcessError as e:
            tail = _last_stderr_line(e)
            msgs.append(f"  ❌ Failed extracting stream a:{idx}{(' — ' + tail) if tail else ''}")
    return created, msgs


def extract_all_audio_streams_best_effort(input_path, output_dir, overwrite=False, preserve_metadata=True, max_workers=0):
    """Extract each audio stream concurrently. Copy first; if copy fails, re-encode that stream and report."""
    streams = ffprobe_audio_streams(input_path)
    if not streams:
        return [], ["  ❌ No audio streams found"]
    base = os.path.splitext(os.path.basename(input_path))[0]

    def make_worker(idx, codec):
        ext = codec_to_extension(codec)
        out_copy = os.path.join(output_dir, f"{base}.a{idx}.{ext}")
        def worker():
            if os.path.exists(out_copy) and not overwrite:
                return None, f"  ⏭️ Skipped stream a:{idx} (exists)"
            cmd = ['ffmpeg']
            if overwrite:
                cmd.append('-y')
            cmd += ['-i', input_path, '-map', f'0:a:{idx}', '-c:a', 'copy']
            if preserve_metadata:
                cmd.extend(['-map_metadata', '0'])
            cmd.append(out_copy)
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                return out_copy, f"  ✅ Extracted stream a:{idx} via copy -> {os.path.basename(out_copy)}"
            except subprocess.CalledProcessError:
                pass
            # Re-encode fallback per stream
            enc_map = {
                'aac': ('aac', 'm4a'),
                'mp3': ('libmp3lame', 'mp3'),
                'flac': ('flac', 'flac'),
                'opus': ('libopus', 'opus'),
            }
            encoder, ext2 = enc_map.get(codec, ('aac', 'm4a'))
            out_enc = os.path.join(output_dir, f"{base}.a{idx}.{ext2}")
            cmd = ['ffmpeg']
            if overwrite:
                cmd.append('-y')
            cmd += ['-i', input_path, '-map', f'0:a:{idx}', '-c:a', encoder]
            if encoder in ('aac', 'libmp3lame', 'libopus'):
                cmd.extend(['-b:a', '192k'])
            if preserve_metadata:
                cmd.extend(['-map_metadata', '0'])
            cmd.append(out_enc)
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                return out_enc, f"  ⚠️ Stream a:{idx} re-encoded -> {os.path.basename(out_enc)}"
            except subprocess.CalledProcessError as e:
                tail = _last_stderr_line(e)
                return None, f"  ❌ Failed extracting stream a:{idx}{(' — ' + tail) if tail else ''}"
        return worker

    tasks = []
    for idx, s in enumerate(streams):
        codec = s.get('codec_name', 'unknown')
        tasks.append(make_worker(idx, codec))

    created, msgs = [], []
    try:
        os.makedirs(output_dir, exist_ok=True)
    except Exception as e:
        return created, [f"  ❌ Cannot create output directory: {e}"]

    workers = max(1, (os.cpu_count() or 4)) if not max_workers or max_workers <= 0 else max_workers
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(t) for t in tasks]
        for fut in concurrent.futures.as_completed(futures):
            out_path, message = fut.result()
            if out_path:
                created.append(out_path)
            msgs.append(message)

    return created, msgs


def extract_all_audio_channels(input_path, output_dir, overwrite=False, preserve_metadata=True):
    # Best-effort channel split via -map_channel without re-encoding
    streams = ffprobe_audio_streams(input_path)
    if not streams:
        return [], ["  ❌ No audio streams found"]
    created = []
    msgs = []
    base = os.path.splitext(os.path.basename(input_path))[0]
    for s_idx, s in enumerate(streams):
        codec = s.get('codec_name', 'unknown')
        channels = s.get('channels', 0) or 0
        ext = codec_to_extension(codec)
        # Only attempt per-channel stream copy for raw PCM; most compressed codecs cannot change channel count without re-encoding
        pcm_codecs = {
            'pcm_s8', 'pcm_u8', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_s32be',
            'pcm_f32le', 'pcm_f32be', 'pcm_f64le', 'pcm_f64be'
        }
        if codec not in pcm_codecs:
            msgs.append(
                f"  ⚠️ Skipping per-channel split for a:{s_idx} (codec={codec}) — not possible without re-encoding"
            )
            # Suggest extracting entire stream instead
            continue
        if not channels or channels == 1:
            # Single-channel: just copy the stream
            out_path = os.path.join(output_dir, f"{base}.a{s_idx}.ch0.{ext}")
            if os.path.exists(out_path) and not overwrite:
                msgs.append(f"  ⏭️ Skipped channel a:{s_idx}:0 (exists)")
                continue
            cmd = ['ffmpeg']
            if overwrite:
                cmd.append('-y')
            cmd += ['-i', input_path, '-map', f'0:a:{s_idx}', '-c:a', 'copy']
            if preserve_metadata:
                cmd.extend(['-map_metadata', '0'])
            cmd.append(out_path)
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                created.append(out_path)
                msgs.append(f"  ✅ Extracted channel a:{s_idx}:0 -> {os.path.basename(out_path)}")
            except subprocess.CalledProcessError as e:
                tail = _last_stderr_line(e)
                msgs.append(f"  ❌ Failed extracting channel a:{s_idx}:0{(' — ' + tail) if tail else ''}")
            continue
        # Multi-channel: attempt per-channel copy using -map_channel (may fail for some codecs)
        for ch in range(int(channels)):
            out_path = os.path.join(output_dir, f"{base}.a{s_idx}.ch{ch}.{ext}")
            if os.path.exists(out_path) and not overwrite:
                msgs.append(f"  ⏭️ Skipped channel a:{s_idx}:{ch} (exists)")
                continue
            cmd = ['ffmpeg']
            if overwrite:
                cmd.append('-y')
            cmd += ['-i', input_path, '-map_channel', f'0.0.{ch}', '-c:a', 'copy']
            # Note: 0.0.ch uses first input file, first audio program; for container-index stability we also try stream-qualified form
            # Prefer stream-qualified mapping if supported by ffmpeg version
            # Fallback is the generic 0.0.ch which maps channel index within the first audio stream
            try:
                subprocess.run(cmd + [out_path], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                created.append(out_path)
                msgs.append(f"  ✅ Extracted channel a:{s_idx}:{ch} -> {os.path.basename(out_path)}")
            except subprocess.CalledProcessError:
                # Attempt stream-qualified mapping if available: 0:a:s_idx.c:ch
                alt_cmd = ['ffmpeg']
                if overwrite:
                    alt_cmd.append('-y')
                alt_cmd += ['-i', input_path, '-map_channel', f'0:a:{s_idx}.{ch}', '-c:a', 'copy', out_path]
                try:
                    subprocess.run(alt_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                    created.append(out_path)
                    msgs.append(f"  ✅ Extracted channel a:{s_idx}:{ch} -> {os.path.basename(out_path)}")
                except subprocess.CalledProcessError as e:
                    tail = _last_stderr_line(e)
                    msgs.append(f"  ❌ Failed extracting channel a:{s_idx}:{ch} (codec={codec}){(' — ' + tail) if tail else ''}")
    return created, msgs


def split_channels_best_effort(input_path, output_dir, overwrite=False, preserve_metadata=True, max_workers=0):
    """Split channels per track concurrently.

    - For PCM codecs, attempt channel copy with -map_channel. If that fails, try stream-qualified mapping.
    - For compressed codecs, re-encode per channel using pan filter.
    """
    streams = ffprobe_audio_streams(input_path)
    if not streams:
        return [], ["  ❌ No audio streams found"]
    base = os.path.splitext(os.path.basename(input_path))[0]
    pcm_codecs = {
        'pcm_s8', 'pcm_u8', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_s32be',
        'pcm_f32le', 'pcm_f32be', 'pcm_f64le', 'pcm_f64be'
    }

    tasks = []

    def make_worker(s_idx, ch, codec):
        is_pcm = codec in pcm_codecs
        ext = codec_to_extension(codec) if is_pcm else 'm4a'
        out_path = os.path.join(output_dir, f"{base}.a{s_idx}.ch{ch}.{ext}")
        def worker():
            if os.path.exists(out_path) and not overwrite:
                return None, f"  ⏭️ Skipped channel a:{s_idx}:{ch} (exists)"
            if is_pcm:
                # Try generic mapping
                cmd = ['ffmpeg', '-i', input_path, '-map_channel', f'0.0.{ch}', '-c:a', 'copy']
                if preserve_metadata:
                    cmd.extend(['-map_metadata', '0'])
                cmd.append(out_path)
                try:
                    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                    return out_path, f"  ✅ Extracted channel a:{s_idx}:{ch} -> {os.path.basename(out_path)}"
                except subprocess.CalledProcessError:
                    # Fallback: stream-qualified mapping
                    alt_cmd = ['ffmpeg', '-i', input_path, '-map_channel', f'0:a:{s_idx}.{ch}', '-c:a', 'copy']
                    if preserve_metadata:
                        alt_cmd.extend(['-map_metadata', '0'])
                    alt_cmd.append(out_path)
                    try:
                        subprocess.run(alt_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                        return out_path, f"  ✅ Extracted channel a:{s_idx}:{ch} -> {os.path.basename(out_path)}"
                    except subprocess.CalledProcessError as e:
                        tail = _last_stderr_line(e)
                        return None, f"  ❌ Failed extracting channel a:{s_idx}:{ch} (PCM){(' — ' + tail) if tail else ''}"
            else:
                # Re-encode per channel using pan
                pan = f"pan=mono|c0=c{ch}"
                cmd = ['ffmpeg', '-i', input_path, '-map', f'0:a:{s_idx}', '-af', pan, '-c:a', 'aac', '-b:a', '160k']
                if preserve_metadata:
                    cmd.extend(['-map_metadata', '0'])
                cmd.append(out_path)
                try:
                    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                    return out_path, f"  ⚠️ Channel a:{s_idx}:{ch} re-encoded -> {os.path.basename(out_path)}"
                except subprocess.CalledProcessError as e:
                    tail = _last_stderr_line(e)
                    return None, f"  ❌ Failed splitting channel a:{s_idx}:{ch}{(' — ' + tail) if tail else ''}"
        return worker

    # Build tasks for all streams/channels
    for s_idx, s in enumerate(streams):
        codec = s.get('codec_name', 'unknown')
        channels = int(s.get('channels', 0) or 0)
        if channels <= 0:
            continue
        for ch in range(channels):
            tasks.append(make_worker(s_idx, ch, codec))

    created = []
    msgs = []
    if not tasks:
        return created, ["  ❌ No channels to process"]

    try:
        os.makedirs(output_dir, exist_ok=True)
    except Exception as e:
        return created, [f"  ❌ Cannot create output directory: {e}"]

    workers = max(1, (os.cpu_count() or 4)) if not max_workers or max_workers <= 0 else max_workers
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(t) for t in tasks]
        for fut in concurrent.futures.as_completed(futures):
            out_path, message = fut.result()
            if out_path:
                created.append(out_path)
            msgs.append(message)

    return created, msgs


def extract_audio(video_file, output_dir, output_ext, overwrite=False, re_encode=False, target_format=None, quality=None, preserve_metadata=True):
    # Create output path in specified directory
    video_name = os.path.splitext(os.path.basename(video_file))[0]
    output_file = os.path.join(output_dir, f"{video_name}.{output_ext}")

    if os.path.exists(output_file) and not overwrite:
        return None  # Indicate skipping

    if re_encode and target_format:
        # Re-encode with specified format and quality
        cmd = ['ffmpeg']
        if overwrite:
            cmd.append('-y')
        cmd += ['-i', video_file, '-vn']
        
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
        
        if preserve_metadata:
            cmd.extend(['-map_metadata', '0'])
        cmd.append(output_file)
    else:
        # No re-encoding - just copy the audio stream
        cmd = ['ffmpeg']
        if overwrite:
            cmd.append('-y')
        cmd += ['-i', video_file, '-vn', '-c:a', 'copy']
        if preserve_metadata:
            cmd.extend(['-map_metadata', '0'])
        cmd.append(output_file)
    
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
        return output_file
    except subprocess.CalledProcessError as e:
        return None  # Keep quiet here; higher-level caller reports a message


def extract_audio_best_effort(input_path, output_dir, preserve_metadata=True):
    """Try to extract main audio via stream copy; if it fails, re-encode and report.

    Returns (path_or_None, messages:list[str])
    """
    msgs = []
    codec = get_audio_codec(input_path)
    ext_map = {"aac": "m4a", "mp3": "mp3", "flac": "flac", "opus": "opus", "pcm_s16le": "wav", "pcm_s24le": "wav", "pcm_s32le": "wav"}
    target_ext = ext_map.get(codec, "m4a")
    # Attempt copy first
    copied = extract_audio(input_path, output_dir, target_ext, overwrite=True, re_encode=False, preserve_metadata=preserve_metadata)
    if copied:
        msgs.append("  ✅ Extracted via stream copy")
        return copied, msgs
    # Fallback: re-encode
    msgs.append("  ⚠️ Stream copy failed; re-encoding audio")
    # choose encoder
    target_format = target_ext if target_ext in ["mp3", "aac", "flac", "opus", "wav"] else "aac"
    reenc = extract_audio(input_path, output_dir, target_format, overwrite=True, re_encode=True, target_format=target_format, quality="192k", preserve_metadata=preserve_metadata)
    if reenc:
        msgs.append(f"  ✅ Re-encoded to {target_format} (192k)")
        return reenc, msgs
    msgs.append("  ❌ Failed to extract audio")
    return None, msgs

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
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.replace(temp_file, audio_file)
        return True
    except subprocess.CalledProcessError:
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False


def process_videos_in_directory(
        input_directory: str,
        output_directory: str,
        selected_files: list,
        use_first_frame_as_cover: bool,
        delete_original_video: bool,
        overwrite_existing_files: bool,
        add_metadata_tags: bool,
        re_encode_audio: bool,
        target_audio_format: str,
        audio_quality: str,
        external_cover_image_path: str = None,
        preserve_metadata: bool = True
):
    """
    Processes all video files in the specified input directory.
    """
    status_messages = []
    processed_files = []
    
    # Validate directories
    if not input_directory or not os.path.exists(input_directory):
        return "❌ Input directory does not exist or is not specified."
    
    if not output_directory:
        output_directory = input_directory  # Default to same directory
    
    # Create output directory if it doesn't exist
    try:
        os.makedirs(output_directory, exist_ok=True)
    except Exception as e:
        return f"❌ Cannot create output directory: {e}"
    
    # Find all video files in the input directory
    video_files = []
    for ext in VIDEO_EXTS:
        video_files.extend(Path(input_directory).glob(f"*{ext}"))
    
    if not video_files:
        return f"No video files found in: {input_directory}"

    # If a selection is provided, filter to only those files; otherwise process all
    if selected_files:
        selected_set = set(selected_files)
        video_files = [p for p in video_files if (p.name in selected_set or str(p) in selected_set)]
        if not video_files:
            return "No matching selected files in directory."
    
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
                quality=audio_quality if re_encode_audio else None,
                preserve_metadata=preserve_metadata
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
            elif external_cover_image_path is not None:
                status_messages.append("  Embedding external album art...")
                external_image_path = external_cover_image_path
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
    gr.Markdown("# Audio Extractor")

    with gr.Row():
        with gr.Column():
            # Directory inputs
            input_dir_input = gr.Textbox(
                label="Input Directory Path",
                placeholder="Enter path to folder containing video files",
                value=SCRIPT_DIR,
            )
            
            output_dir_input = gr.Textbox(
                label="Output Directory Path (defaults to input directory)",
                placeholder="Leave empty to use same as input directory",
                value=""
            )

            

            file_selector = gr.CheckboxGroup(
                label="Files to process (empty = all)",
                choices=[],
                interactive=True,
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
                    value="aac",
                    info="Format to convert audio to (when re-encoding)"
                )
                
                quality_dropdown = gr.Dropdown(
                    label="Audio Quality",
                    choices=["64k", "96k", "128k", "160k", "192k", "256k", "320k"],
                    value="192k",
                    info="Bitrate for compressed formats (when re-encoding)"
                )
                preserve_metadata_checkbox = gr.Checkbox(
                    label="Preserve original metadata (recommended)",
                    value=True,
                    info="Copy as much metadata as possible from the original video/audio."
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

            process_button = gr.Button("🚀 Start Processing", variant="primary", size="lg")

            with gr.Accordion("Tools", open=False):
                scan_button = gr.Button("🔍 Scan Tracks & Channels")
                scan_output = gr.Textbox(label="Scan Result", lines=8)
                gr.Markdown("---")
                extract_main_button = gr.Button("🎵 Extract Main Audio (copy-first, auto re-encode)")
                extract_streams_button = gr.Button("🎧 Extract All Audio Tracks (copy-first, auto re-encode)")
                split_channels_button = gr.Button("🎚️ Split Channels (copy for PCM, re-encode otherwise)")
                extract_output = gr.Textbox(label="Operation Log", lines=10)

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
            file_selector,
            use_first_frame_checkbox,
            delete_original_checkbox,
            overwrite_checkbox,
            add_metadata_checkbox,
            re_encode_checkbox,
            target_format_dropdown,
            quality_dropdown,
            external_cover_input,
            preserve_metadata_checkbox
        ],
        outputs=[
            status_output,
        ]
    )

    # Helpers wired to shared inputs
    def _list_media_in_dir(dirpath):
        files = []
        for ext in VIDEO_EXTS + AUDIO_EXTS:
            files.extend(sorted(Path(dirpath).glob(f"*{ext}")))
        return [str(p) for p in files]

    def _update_file_choices(dirpath):
        if not dirpath or not os.path.isdir(dirpath):
            return gr.update(choices=[], value=[])
        files = []
        for ext in VIDEO_EXTS:
            files.extend([p.name for p in sorted(Path(dirpath).glob(f"*{ext}"))])
        return gr.update(choices=files, value=[])

    def _scan(dirpath, selected):
        if not dirpath or not os.path.isdir(dirpath):
            return "❌ Path not found or no media files"
        files = _list_media_in_dir(dirpath)
        if not files:
            return "❌ Path not found or no media files"
        if selected:
            files = [str(Path(dirpath) / s) for s in selected if (Path(dirpath) / s).exists()]
        reports = [scan_file_tracks_and_channels(f) for f in files]
        return "\n\n".join(reports)

    def _resolve_targets(dirpath, selected):
        if not dirpath or not os.path.isdir(dirpath):
            return []
        files = _list_media_in_dir(dirpath)
        if selected:
            files = [str(Path(dirpath) / s) for s in selected if (Path(dirpath) / s).exists()]
        return files

    def _extract_main(dirpath, selected, outdir, overwrite, preserve_meta):
        files = _resolve_targets(dirpath, selected)
        if not files:
            return "❌ Path not found or no media files"
        log = []
        for f in files:
            od = outdir or os.path.dirname(f)
            try:
                os.makedirs(od, exist_ok=True)
            except Exception as e:
                log.append(f"📄 {os.path.basename(f)}\n❌ Cannot create output directory: {e}")
                continue
            out, msgs = extract_audio_best_effort(f, od, preserve_metadata=preserve_meta)
            header = f"📄 {os.path.basename(f)}\n📁 Output: {od}\nResult: {'OK' if out else 'FAILED'}"
            log.append("\n".join([header] + msgs))
        return "\n\n".join(log)

    def _extract_tracks(dirpath, selected, outdir, overwrite, preserve_meta):
        files = _resolve_targets(dirpath, selected)
        if not files:
            return "❌ Path not found or no media files"
        log = []
        for f in files:
            od = outdir or os.path.dirname(f)
            try:
                os.makedirs(od, exist_ok=True)
            except Exception as e:
                log.append(f"📄 {os.path.basename(f)}\n❌ Cannot create output directory: {e}")
                continue
            created, msgs = extract_all_audio_streams_best_effort(f, od, overwrite=overwrite, preserve_metadata=preserve_meta, max_workers=0)
            header = f"📄 {os.path.basename(f)}\n📁 Output: {od}\nCreated: {len(created)} file(s)"
            log.append("\n".join([header] + msgs))
        return "\n\n".join(log)

    def _split_channels(dirpath, selected, outdir, overwrite, preserve_meta):
        files = _resolve_targets(dirpath, selected)
        if not files:
            return "❌ Path not found or no media files"
        log = []
        for f in files:
            od = outdir or os.path.dirname(f)
            try:
                os.makedirs(od, exist_ok=True)
            except Exception as e:
                log.append(f"📄 {os.path.basename(f)}\n❌ Cannot create output directory: {e}")
                continue
            created, msgs = split_channels_best_effort(f, od, overwrite=overwrite, preserve_metadata=preserve_meta, max_workers=0)
            header = f"📄 {os.path.basename(f)}\n📁 Output: {od}\nCreated: {len(created)} file(s)"
            log.append("\n".join([header] + msgs))
        return "\n\n".join(log)

    scan_button.click(fn=_scan, inputs=[input_dir_input, file_selector], outputs=[scan_output])
    input_dir_input.change(fn=_update_file_choices, inputs=[input_dir_input], outputs=[file_selector])
    extract_main_button.click(fn=_extract_main, inputs=[input_dir_input, file_selector, output_dir_input, overwrite_checkbox, preserve_metadata_checkbox], outputs=[extract_output])
    extract_streams_button.click(fn=_extract_tracks, inputs=[input_dir_input, file_selector, output_dir_input, overwrite_checkbox, preserve_metadata_checkbox], outputs=[extract_output])
    split_channels_button.click(fn=_split_channels, inputs=[input_dir_input, file_selector, output_dir_input, overwrite_checkbox, preserve_metadata_checkbox], outputs=[extract_output])

demo.launch()
