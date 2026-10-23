#!/usr/bin/env python3
"""Build the display's cortical groups from pinned FreeSurfer fsaverage5 labels.

Uses only Python's standard library. Run from any directory:
  python3 scripts/build-brain-regions.py
Or reuse downloaded lh/rh.aparc.annot and lh/rh.pial files:
  python3 scripts/build-brain-regions.py --source-dir /path/to/files
"""

import argparse
from collections import Counter
from hashlib import sha256
import io
import json
from pathlib import Path
import struct
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    "https://www.freesurfer.net/pub/dist/freesurfer/"
    "tutorial_versions_centos6/freesurfer/subjects/fsaverage5/"
)
GROUPING_SOURCE = "https://www.freesurfer.net/fswiki/CorticalParcellation"
HASHES = {
    "lh.aparc.annot": "74d1c2fd5e6b7ca193f06fee45a86f5638f347e38cea5ba27fce9fd69c0056be",
    "rh.aparc.annot": "ca86b3b0bd5b74e367519dd94157154ae7c61ad128680fcc7b52e1a799e34e9f",
    "lh.pial": "d3e772b74f39ed7a979d78dab5b98d1fe5916f1354b52d05c23b85a8080b72bd",
    "rh.pial": "64440462e8d1cec650d100c0fb16cb4704937e19e0bc42f58997a6a09e5e536b",
}
# The documented FreeSurfer approximate lobar grouping leaves cingulate separate.
# The insula is also retained as its own region. Unknown/corpus-callosum vertices
# are an unassigned medial wall, not a cortical lobe or a callosal surface mesh.
GROUPS = [
    ("medial-wall", "Medial wall", ["unknown", "corpuscallosum"]),
    ("frontal", "Frontal lobe", [
        "superiorfrontal", "rostralmiddlefrontal", "caudalmiddlefrontal",
        "parsopercularis", "parstriangularis", "parsorbitalis",
        "lateralorbitofrontal", "medialorbitofrontal", "precentral",
        "paracentral", "frontalpole",
    ]),
    ("parietal", "Parietal lobe", [
        "superiorparietal", "inferiorparietal", "supramarginal",
        "postcentral", "precuneus",
    ]),
    ("temporal", "Temporal lobe", [
        "superiortemporal", "middletemporal", "inferiortemporal", "bankssts",
        "fusiform", "transversetemporal", "entorhinal", "temporalpole",
        "parahippocampal",
    ]),
    ("occipital", "Occipital lobe", [
        "lateraloccipital", "lingual", "cuneus", "pericalcarine",
    ]),
    ("insula", "Insula", ["insula"]),
    ("cingulate", "Cingulate cortex", [
        "rostralanteriorcingulate", "caudalanteriorcingulate",
        "posteriorcingulate", "isthmuscingulate",
    ]),
]


def checked_input(directory, filename):
    path = directory / filename
    if not path.exists():
        folder = "label" if filename.endswith(".annot") else "surf"
        with urllib.request.urlopen(SOURCE + folder + "/" + filename, timeout=60) as response:
            path.write_bytes(response.read())
    data = path.read_bytes()
    if sha256(data).hexdigest() != HASHES[filename]:
        raise ValueError(f"Unexpected source checksum: {filename}")
    return data


def read_annotation(data):
    stream = io.BytesIO(data)

    def integer():
        return struct.unpack(">i", stream.read(4))[0]

    def string():
        return stream.read(integer()).rstrip(b"\0").decode("utf-8")

    count = integer()
    vertices = [(integer(), integer()) for _ in range(count)]
    if integer() != 1 or integer() != -2:
        raise ValueError("Expected a FreeSurfer version-2 annotation color table")
    integer()  # Maximum table index.
    string()  # Original color-table path; not used for provenance.
    names = {0: "unknown"}  # Zero is also used for unassigned vertices.
    for _ in range(integer()):
        integer()  # Color-table index; vertices store packed RGB instead.
        name = string()
        red, green, blue, _transparency = [integer() for _ in range(4)]
        names[red + (green << 8) + (blue << 16)] = name
    if sorted(index for index, _ in vertices) != list(range(count)):
        raise ValueError("Annotation must label every vertex exactly once")
    labels = [None] * count
    for index, color in vertices:
        labels[index] = names[color]
    return labels


def verify_surface(data, mesh):
    stream = io.BytesIO(data)
    if stream.read(3) != b"\xff\xff\xfe":
        raise ValueError("Expected a FreeSurfer triangular pial surface")
    stream.readline()  # Creation comment.
    stream.readline()  # Blank line.
    vertices, faces = struct.unpack(">ii", stream.read(8))
    coordinates = struct.unpack(f">{vertices * 3}f", stream.read(vertices * 12))
    indices = struct.unpack(f">{faces * 3}i", stream.read(faces * 12))
    if list(indices) != mesh["indices"]:
        raise ValueError("Annotation template does not match the display's triangle topology")
    if len(coordinates) != len(mesh["positions"]) or any(
        abs(a - b) > 0.000501 for a, b in zip(coordinates, mesh["positions"])
    ):
        raise ValueError("Pial coordinates differ beyond the display's 0.001 mm rounding")


def build(directory, output):
    mesh = json.loads((ROOT / "src/assets/brain-fsaverage5.json").read_text())
    parcel_to_group = {
        parcel: group_id
        for group_id, (_key, _name, parcels) in enumerate(GROUPS)
        for parcel in parcels
    }
    hemispheres = {}
    for short, name in [("lh", "left"), ("rh", "right")]:
        verify_surface(checked_input(directory, short + ".pial"), mesh["hemispheres"][name])
        parcels = read_annotation(checked_input(directory, short + ".aparc.annot"))
        if len(parcels) != len(mesh["hemispheres"][name]["positions"]) // 3:
            raise ValueError("Annotation and display vertex counts differ")
        hemispheres[name] = [parcel_to_group[parcel] for parcel in parcels]
        if set(hemispheres[name]) != set(range(len(GROUPS))):
            raise ValueError("Every display region must be represented in each hemisphere")
        print(name, dict(sorted(Counter(hemispheres[name]).items())))
    asset = {
        "source": SOURCE,
        "sourceChecksums": HASHES,
        "groupingSource": GROUPING_SOURCE,
        "modified": (
            "Desikan-Killiany parcels grouped into approximate lobes; insula and "
            "cingulate retained separately. Unassigned medial-wall vertices use 0. "
            "Vertex order and labels preserved; exploded positions are illustrative."
        ),
        "labels": [
            {"id": index, "key": key, "name": name, "parcels": parcels}
            for index, (key, name, parcels) in enumerate(GROUPS)
        ],
        "hemispheres": hemispheres,
    }
    output.write_text(json.dumps(asset, separators=(",", ":")) + "\n")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Cache directory for official source files")
    parser.add_argument("--output", type=Path, default=ROOT / "src/assets/brain-regions.json")
    args = parser.parse_args()
    if args.source_dir:
        args.source_dir.mkdir(parents=True, exist_ok=True)
        build(args.source_dir, args.output)
    else:
        with tempfile.TemporaryDirectory(prefix="haosite-brain-regions-") as temporary:
            build(Path(temporary), args.output)


if __name__ == "__main__":
    main()
