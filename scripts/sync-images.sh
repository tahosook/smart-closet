#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${1:-$HOME/Downloads/クローゼット24着_個別切り抜き画像一式}"
DEST_DIR="${2:-$HOME/Downloads/SmartCloset_Photos}"
mkdir -p "$DEST_DIR"

if [ ! -d "$SRC_DIR" ]; then
  echo "Warning: Source directory $SRC_DIR not found."
  exit 1
fi

count=0
# Loop through all jpg, jpeg, png files in source directory
for filepath in "$SRC_DIR"/*.jpg "$SRC_DIR"/*.jpeg "$SRC_DIR"/*.png "$SRC_DIR"/*.JPG; do
  [ -e "$filepath" ] || continue
  filename=$(basename "$filepath")
  # Extract prefix before '_' e.g. "S1_濃ネイビー長袖シャツ.jpg" -> "S1"
  id_part="${filename%%_*}"
  # Also handle if filename was already "S1.jpg"
  id_part="${id_part%.*}"
  
  dest_path="$DEST_DIR/${id_part}.jpg"
  cp "$filepath" "$dest_path"
  count=$((count + 1))
  echo "Synced: $filename -> ${id_part}.jpg"
done

echo "Successfully synchronized $count images to $DEST_DIR"
