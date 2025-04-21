import os
import subprocess
from concurrent.futures import ProcessPoolExecutor, as_completed

def process_file(file, input_folder, waveform_params):
    input_path = os.path.join(input_folder, file)
    output_file = f"{os.path.splitext(file)[0]}.jpg"
    output_path = os.path.join(input_folder, output_file)
    
    ffmpeg_cmd = [
        'ffmpeg',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', input_path,
        '-f', 'lavfi',
        '-i', f"color={waveform_params['bg_color']}:s={waveform_params['size']}",
    ]
    
    audio_filter = "[0:a]"
    if waveform_params['dynamic_range']:
        audio_filter += (
            "compand=attacks=0:points=-80/-900|-45/-15|-27/-9|0/-7,"
        )
    
    filter_complex = (
        f"{audio_filter}"
        f"showwavespic=s={waveform_params['size']}"
        f":colors={waveform_params['colors']}[wave];"
        f"[1:v][wave]overlay=format=rgb"
    )
    
    ffmpeg_cmd.extend([
        '-filter_complex', filter_complex,
        '-frames:v', '1',
        '-y',
        output_path
    ])
    
    try:
        result = subprocess.run(
            ffmpeg_cmd,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=600  # Add timeout for safety
        )
        if result.returncode != 0:
            return (file, f"Error: {result.stderr.strip()}")
        return (file, None)
    except Exception as e:
        return (file, f"Critical error: {str(e)}")

def generate_waveforms(input_folder):
    audio_extensions = ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac')
    waveform_params = {
        'colors': '#007bff|#ff0000',
        'size': '2500x300',
        'bg_color': 'white',
        'dynamic_range': True,
    }
    
    files_to_process = [
        file for file in os.listdir(input_folder)
        if file.lower().endswith(audio_extensions)
    ]
    
    with ProcessPoolExecutor() as executor:
        futures = []
        for file in files_to_process:
            futures.append(
                executor.submit(
                    process_file,
                    file,
                    input_folder,
                    waveform_params
                )
            )
        
        for future in as_completed(futures):
            file, error = future.result()
            if error:
                print(f"Failed: {file} - {error}")
            else:
                print(f"Success: {file}")

if __name__ == "__main__":
    print("Starting waveform generation...")
    generate_waveforms(os.getcwd())
    print("Processing completed!")