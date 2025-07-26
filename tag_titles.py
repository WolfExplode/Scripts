#!/usr/bin/env python3
"""
tag_titles.py
Write the filename (minus extension and minus the prefix "[MapleStory BGM] ")
into the TITLE tag of every *.mp3 in the current folder.
Requires: pip install mutagen
"""

import os
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3NoHeaderError

PREFIX = "[MapleStory BGM] "  # what to strip

def set_title_from_filename(mp3_path):
    """Set the TITLE tag with the prefix removed."""
    try:
        audio = EasyID3(mp3_path)
    except ID3NoHeaderError:
        audio = EasyID3()
        audio.save(mp3_path)

    basename = os.path.splitext(os.path.basename(mp3_path))[0]
    new_title = basename.removeprefix(PREFIX)  # Python 3.9+
    # Fallback for Python < 3.9:
    # if basename.startswith(PREFIX):
    #     new_title = basename[len(PREFIX):]
    # else:
    #     new_title = basename

    audio["title"] = new_title
    audio.save()
    print(f"Tagged: {os.path.basename(mp3_path)}  ->  TITLE = {new_title}")

def main():
    folder = os.getcwd()
    mp3_files = [f for f in os.listdir(folder) if f.lower().endswith('.mp3')]

    if not mp3_files:
        print("No .mp3 files found in this directory.")
        return

    for f in mp3_files:
        set_title_from_filename(os.path.join(folder, f))

if __name__ == "__main__":
    main()