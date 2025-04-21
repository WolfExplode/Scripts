import os
import glob
import subprocess

# Constants
AUDIO_EXTS = ('.mp3', '.m4a', '.aac', '.flac', '.wav')
IMAGE_EXTS = ('.jpg', '.jpeg', '.png')
VIDEO_EXTS = ('.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv')

def get_audio_codec(video_file):
    """Get audio codec of video file using ffprobe"""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video_file
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()

def extract_audio(video_file, output_ext):
    """Extract audio from video file using ffmpeg"""
    output_file = os.path.splitext(video_file)[0] + f".{output_ext}"
    cmd = [
        'ffmpeg',
        '-i', video_file,
        '-vn',
        '-c:a', 'copy',
        output_file
    ]
    subprocess.run(cmd)
    print(f"Extracted audio from {video_file} to {output_file}")

def process_video_files():
    """Process all video files in current directory"""
    for file in os.listdir('.'):
        if os.path.splitext(file)[1].lower() in VIDEO_EXTS:
            print(f"\nProcessing video file: {file}")
            codec = get_audio_codec(file)
            
            if codec == 'aac':
                extract_audio(file, 'm4a')
            elif codec == 'mp3':
                extract_audio(file, 'mp3')
            elif codec == 'flac':
                extract_audio(file, 'flac')
            elif codec == 'opus':
                extract_audio(file, 'opus')
            else:
                print(f"Unsupported codec '{codec}' in {file}. Outputting as .m4a.")
                extract_audio(file, 'm4a')

def find_matching_image(audio_file):
    """Find image file matching the audio file name"""
    base_name = os.path.splitext(audio_file)[0]
    print(f"\nProcessing audio: {audio_file}")
    print(f"Base name: {base_name}")

    # Look for exact match first
    for ext in IMAGE_EXTS:
        exact_match = f"{base_name}{ext}"
        if os.path.exists(exact_match):
            print(f"Found exact match: {exact_match}")
            return exact_match

    # Look for partial matches
    for ext in IMAGE_EXTS:
        pattern = f"{base_name}*{ext}"
        matches = glob.glob(pattern)
        if matches:
            print(f"Found partial match: {matches[0]}")
            return matches[0]

    print("No matching image found")
    return None

def add_album_art(audio_file, image_file):
    """Add album art to audio file using ffmpeg"""
    temp_file = f"{audio_file}.tmp"
    file_ext = os.path.splitext(audio_file)[1][1:]
    output_format = 'mp4' if file_ext == 'm4a' else file_ext

    cmd = [
        'ffmpeg',
        '-i', audio_file,
        '-i', image_file,
        '-c', 'copy',
        '-map', '0',
        '-map', '1',
        '-disposition:v:0', 'attached_pic',
        '-metadata:s:v:0', 'title=Album cover',
        '-metadata:s:v:0', 'comment=Cover (front)',
        '-metadata:s:v:0', 'mimetype=image/jpeg',
        '-f', output_format,
        '-y', temp_file
    ]

    print("\nFFmpeg command:", ' '.join(cmd))

    try:
        result = subprocess.run(
            cmd, check=True, capture_output=True, text=True
        )
        print("\nFFmpeg output:")
        print(result.stdout)
        print(result.stderr)
        os.replace(temp_file, audio_file)
        print(f"\nSuccessfully updated {audio_file}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"\nError processing {audio_file}:")
        print(e.stderr)
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False

def process_audio_files():
    """Process all audio files in current directory"""
    for audio_file in glob.glob("*.*"):
        if audio_file.lower().endswith(AUDIO_EXTS):
            print("\n" + "="*50)
            print(f"Processing audio file: {audio_file}")

            image_file = find_matching_image(audio_file)
            if not image_file:
                print(f"[SKIP] No image found for {audio_file}")
                continue

            add_album_art(audio_file, image_file)

def main():
    """Main workflow: extract audio first, then add album art"""
    print("="*50)
    print("Starting video extraction process")
    process_video_files()
    
    print("\n" + "="*50)
    print("Starting album art addition process")
    process_audio_files()

if __name__ == "__main__":
    main()