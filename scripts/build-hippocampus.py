#!/usr/bin/env python3
"""Build hippocampi from the same fsaverage segmentation as the lower anatomy.

Requires Python 3.12 with numpy, nibabel, scipy, scikit-image, and trimesh.
The exact dependency versions used are recorded in the generated metadata.

Download the checksummed source from SOURCE_URL, then run:
    python3 scripts/build-hippocampus.py --source /path/to/aseg.mgz

The two masks are real whole-hippocampus segmentations, not procedural shapes.
Their surfaces are smoothed for display and retain FreeSurfer surface RAS mm.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes
import trimesh


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://www.freesurfer.net/pub/dist/freesurfer/tutorial_versions_centos6/freesurfer/subjects/fsaverage/mri/aseg.mgz"
SOURCE_SHA256 = "b55ef817e5e5bd1a3d76d4a2305283eef16fbff199ead3d840dd4b0fa8205e48"
LABEL_URL = "https://surfer.nmr.mgh.harvard.edu/fswiki/FsTutorial/AnatomicalROI/FreeSurferColorLUT"
SETTINGS = {
    "gaussianSigmaMM": 0.7,
    "samplingMM": 1,
    "isolation": 0.5,
    "normalSmoothingPasses": 1,
    "normalSmoothingBlend": 0.5,
    "coordinateDecimals": 5,
    "normalDecimals": 5,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def smooth_normals(mesh: trimesh.Trimesh) -> np.ndarray:
    """Soften the voxel-derived shading without changing anatomical geometry."""
    normals = np.asarray(mesh.vertex_normals).copy()
    for _ in range(SETTINGS["normalSmoothingPasses"]):
        smoothed = normals.copy()
        for vertex, neighbors in enumerate(mesh.vertex_neighbors):
            blend = SETTINGS["normalSmoothingBlend"]
            smoothed[vertex] = normals[vertex] * (1 - blend) + normals[neighbors].mean(axis=0) * blend
        normals = smoothed / np.linalg.norm(smoothed, axis=1, keepdims=True)
    return normals


def extract(data: np.ndarray, affine: np.ndarray, label: int) -> tuple[dict, dict]:
    mask = data == label
    points = np.argwhere(mask)
    if not len(points):
        raise ValueError(f"Source contains no voxels for label {label}.")
    lower = np.maximum(points.min(axis=0) - 4, 0)
    upper = np.minimum(points.max(axis=0) + 5, data.shape)
    local = mask[tuple(slice(a, b) for a, b in zip(lower, upper))].astype(np.float32)
    field = gaussian_filter(local, sigma=SETTINGS["gaussianSigmaMM"], mode="constant")
    vertices, faces, _, _ = marching_cubes(
        field, level=SETTINGS["isolation"], step_size=1, allow_degenerate=False,
    )
    vertices = nib.affines.apply_affine(affine, vertices + lower)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    components = mesh.split(only_watertight=False)
    mesh = max(components, key=lambda part: len(part.vertices))
    mesh.fix_normals()
    # Validate the rounded positions actually stored in the browser asset.
    mesh.vertices = np.round(mesh.vertices, SETTINGS["coordinateDecimals"])
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0:
        raise ValueError(f"Label {label} did not produce a closed, outward-facing solid.")
    if not np.isfinite(mesh.vertices).all() or np.any(mesh.area_faces <= 1e-10):
        raise ValueError(f"Label {label} contains invalid or degenerate faces.")
    normals = smooth_normals(mesh)
    if not np.isfinite(normals).all():
        raise ValueError(f"Label {label} has invalid normals.")
    part = {
        "labels": [label],
        "positions": mesh.vertices.ravel().tolist(),
        "indices": mesh.faces.ravel().tolist(),
        "normals": np.round(normals, SETTINGS["normalDecimals"]).ravel().tolist(),
    }
    metadata = {
        "label": label,
        "sourceVoxels": int(mask.sum()),
        "vertices": len(mesh.vertices),
        "triangles": len(mesh.faces),
        "boundsMM": np.round(mesh.bounds, 5).tolist(),
        "volumeMM3": round(float(mesh.volume), 5),
        "componentsBeforeSelection": len(components),
        "watertight": bool(mesh.is_watertight),
        "windingConsistent": bool(mesh.is_winding_consistent),
        "eulerCharacteristic": int(mesh.euler_number),
    }
    return part, metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Official fsaverage aseg.mgz")
    parser.add_argument("--output", type=Path, default=ROOT / "src/assets/brain-hippocampus.json")
    arguments = parser.parse_args()
    if sha256(arguments.source) != SOURCE_SHA256:
        raise ValueError("Source SHA-256 differs from the pinned official fsaverage segmentation.")
    image = nib.load(arguments.source)
    if not np.allclose(image.header.get_zooms()[:3], [1, 1, 1]):
        raise ValueError("This generator requires the source's native 1 mm voxels.")
    data = np.asarray(image.dataobj)
    affine = image.header.get_vox2ras_tkr()
    source = {
        "name": "FreeSurfer fsaverage aseg whole-hippocampus segmentation",
        "url": SOURCE_URL,
        "sha256": SOURCE_SHA256,
        "labelDocumentation": LABEL_URL,
        "coordinateSystem": "FreeSurfer surface RAS (vox2ras_tkr), in mm; aligned with fsaverage5 pial surfaces",
        "vox2rasTkr": affine.tolist(),
        "license": "FreeSurfer Software License Agreement v1.0 (February 2011)",
        "modification": "Labels 17 and 53 extracted at 1 mm sampling after a 0.7 mm Gaussian; largest closed component retained, outward normals averaged once. Whole hippocampi, not hippocampal subfields.",
        "settings": SETTINGS,
    }
    asset = {"source": source, "parts": {}}
    metadata = {
        "source": source,
        "generator": {"path": "scripts/build-hippocampus.py", "sha256": sha256(Path(__file__))},
        "dependencies": {
            name: importlib.metadata.version(name)
            for name in ["numpy", "nibabel", "scipy", "scikit-image", "trimesh"]
        },
        "parts": {},
    }
    for name, label in [("hippocampusLeft", 17), ("hippocampusRight", 53)]:
        part, stats = extract(data, affine, label)
        asset["parts"][name] = part
        metadata["parts"][name] = stats
        print(f"{name}: {stats['vertices']} vertices, {stats['triangles']} triangles, "
              f"{stats['volumeMM3']} mm³, bounds {stats['boundsMM']}")
    arguments.output.write_text(json.dumps(asset, separators=(",", ":")) + "\n")
    metadata["outputSha256"] = sha256(arguments.output)
    metadata_path = arguments.output.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Wrote {arguments.output} ({arguments.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
