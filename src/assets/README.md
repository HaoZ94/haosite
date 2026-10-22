# Brain anatomy

`brain-fsaverage5.json` is a **modified conversion** of the FreeSurfer fsaverage5 pial surfaces and sulcal-depth arrays distributed in Nilearn. Each hemisphere contains 10,242 vertices and 20,480 triangular faces. The signals and links between anatomical surfaces added by the renderer are illustrative, not recorded neural activity or measured neural tracts.

Source: [Nilearn fsaverage5 dataset](https://github.com/nilearn/nilearn/tree/e5faab66dc2fe72d2cb50a8aaf2f44813aba4a51/nilearn/datasets/data/fsaverage5), revision `e5faab66dc2fe72d2cb50a8aaf2f44813aba4a51`.

Inputs: `pial_left.gii.gz`, `pial_right.gii.gz`, `sulc_left.gii.gz`, and `sulc_right.gii.gz`. GIFTI arrays were decompressed and converted to JSON. Coordinates were rounded to three decimal places and sulcal depths to four; topology was preserved. Coordinates retain anatomical RAS orientation and are centered, scaled, and rotated for display by the renderer.

`brain-subcortical.json` is a **modified derivative** of the official [FreeSurfer fsaverage `aseg.mgz` segmentation](https://www.freesurfer.net/pub/dist/freesurfer/tutorial_versions_centos6/freesurfer/subjects/fsaverage/mri/aseg.mgz). The left cerebellum combines labels 7 and 8; the right combines labels 46 and 47; the brainstem uses label 16. Each mask was smoothed with a 0.75 mm Gaussian and converted to a triangular mesh with marching cubes at 2 mm sampling. The largest connected component was retained, normals were oriented outward, and coordinates were rounded to three decimal places. The volume header's `vox2ras_tkr` transform places all three surfaces in the same surface RAS coordinates as the cortex. Fine cerebellar folia are limited by the segmentation resolution.

Source volume SHA-256: `b55ef817e5e5bd1a3d76d4a2305283eef16fbff199ead3d840dd4b0fa8205e48`. The derived meshes contain 3,874 vertices / 7,744 faces (left cerebellum), 3,880 / 7,756 (right cerebellum), and 2,146 / 4,288 (brainstem). Geometry provenance is also embedded in the JSON asset.

All or portions of this licensed product (such portions are the “Software”) have been obtained under license from The General Hospital Corporation “MGH” and are subject to the terms and conditions in the [FreeSurfer license](../../assets/licenses/FREESURFER-LICENSE.txt), included in full with the required preface. See also the [Nilearn license](../../assets/licenses/NILEARN-LICENSE.txt).
