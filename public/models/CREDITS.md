# 3D model credits

Models shipped with FreeVisualizer in `public/models/`. They keep their own licences.

| File | Used for | Model | Author | Licence | Source |
|---|---|---|---|---|---|
| `panther-60.glb` | BeamZ Panther 60 (built-in model preset) | Moving Head Beam (high Poly) | [Lord Henry](https://sketchfab.com/lordhenry) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | <https://sketchfab.com/3d-models/ce283a1277bb4e98bd29b157075e003f> |

Changes: optimised with glTF-Transform (meshopt compression, quantization, WebP texture),
as published in the open-source *stage-console* project; FreeVisualizer scales it to the
real Panther 60 height (290 mm), darkens the housing to black and moves its Support / Head
parts with pan / tilt. It is not an official BeamZ model.

The other fixtures (Chauvet Intimidator Spot LED 250, UKing ZQ01104, the 7-head vintage
retro, ADJ Entour Faze and all generic fixtures) are drawn in code (`public/js/fixture-parts.js`).
