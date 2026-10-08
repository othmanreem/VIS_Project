"""Rebuild this folder's GeoJSON from saved source_extracts. Python standard library only."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from prepare_dataset import convert_kind
if __name__ == "__main__":
    print(convert_kind('casualties'))
