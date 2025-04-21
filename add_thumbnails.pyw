import os
import glob
import subprocess

AUDIO_EXTS = ('.mp3', '.m4a', '.aac', '.flac', '.wav')
IMAGE_EXTS = ('.jpg', '.jpeg', '.png')

def find_matching_image(audio_file):
    """Find image file matching the audio file with debug info"""
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
    """Add album art with format-specific handling"""
    temp_file = f"{audio_file}.tmp"
    file_ext = os.path.splitext(audio_file)[1][1:].lower()
    output_format = 'mp4' if file_ext == 'm4a' else file_ext
    
    # Determine MIME type based on image extension
    image_ext = os.path.splitext(image_file)[1].lower()
    mimetype = 'image/jpeg' if image_ext in ('.jpg', '.jpeg') else 'image/png'
    
    # Build FFmpeg command based on audio format
    if file_ext == 'mp3':
        # MP3 requires ID3v2 tags for embedded art
        cmd = [
            'ffmpeg',
            '-i', audio_file,
            '-i', image_file,
            '-c', 'copy',
            '-map', '0:a',
            '-map', '1:v',
            '-id3v2_version', '3',
            '-metadata:s:v', 'title=Album cover',
            '-metadata:s:v', 'comment=Cover (front)',
            '-metadata:s:v', f'mimetype={mimetype}',
            '-f', output_format,
            '-y', temp_file
        ]
    else:
        # Use attached_pic for other formats (M4A, FLAC, etc.)
        cmd = [
            'ffmpeg',
            '-i', audio_file,
            '-i', image_file,
            '-c', 'copy',
            '-map', '0:a',
            '-map', '1:v',
            '-disposition:v:0', 'attached_pic',
            '-metadata:s:v:0', 'title=Album cover',
            '-metadata:s:v:0', 'comment=Cover (front)',
            '-metadata:s:v:0', f'mimetype={mimetype}',
            '-f', output_format,
            '-y', temp_file
        ]
    
    print("\nFFmpeg command:")
    print(' '.join(cmd))
    
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True
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

def main():
    """Process all audio files in current directory"""
    for audio_file in glob.glob("*.*"):
        if audio_file.lower().endswith(AUDIO_EXTS):
            print("\n" + "="*50)
            print(f"Processing file: {audio_file}")
            image_file = find_matching_image(audio_file)
            if not image_file:
                print(f"[SKIP] No image found for {audio_file}")
                continue
            add_album_art(audio_file, image_file)

if __name__ == "__main__":
    main()