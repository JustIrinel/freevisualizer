# Texture credits

Photo-based PBR textures shipped with FreeVisualizer in `public/textures/`
(albedo `*_albedo.jpg`, OpenGL normal map `*_normal.jpg`, roughness `*_rough.jpg`).
All of them are **CC0 1.0** (public domain): no attribution required, credited here anyway.

| Files | Used for | Texture | Author / source | Licence |
|---|---|---|---|---|
| `parquet_*` | Event hall floor (banquet room) | WoodFloor051 | [ambientCG](https://ambientcg.com/view?id=WoodFloor051) (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `plaster_*` | Painted plaster walls | Plaster001 | [ambientCG](https://ambientcg.com/view?id=Plaster001) | CC0 1.0 |
| `velvet_*` | Window curtains, velvet backdrop (prop „Perete / backdrop”) | Velour Velvet (`velour_velvet`) | [Poly Haven](https://polyhaven.com/a/velour_velvet) | CC0 1.0 |
| `metal_*` | Truss chords (brushed aluminium) | Metal009 | [ambientCG](https://ambientcg.com/view?id=Metal009) | CC0 1.0 |
| `carpet_*` | Stage risers (prop „Podium / scenă”) | Carpet006 | [ambientCG](https://ambientcg.com/view?id=Carpet006) | CC0 1.0 |
| `linen_*` | Tablecloths, chiffon drape behind the DJ, lycra booth facade | Fabric036 | [ambientCG](https://ambientcg.com/view?id=Fabric036) | CC0 1.0 |

The asset sites themselves are not reachable from the build machine, so the original 1K
files were taken from public GitHub projects that ship them unchanged
(WoodFloor051: `Rebelion-Board-game/Dice_Roll`; Plaster001: `TheMarco/liminal`;
velour_velvet: `m4tth1euNa0p1c/Tapao-Rush-Island`; Metal009: `BrandtFgit/Starbucks-VR-Simulator`;
Carpet006: `bearlikelion/SurfsUpSDK`; Fabric036: `ashalluf/rando-game`).

Changes: re-encoded as JPEG, metal / carpet / linen downsized to 512 px, the velvet albedo
turned to grey (the curtain colour tints it), roughness maps rescaled to 0.4–1 so the
material's roughness stays the average value.

Drawn in code (`public/js/textures.js`, no files): the black dance-floor panels (albedo,
groove normal map, scuff roughness), the wainscoting panels and their moulding normal map,
the coffered ceiling, windows, curtain folds, and the stand-ins shown until the photos load.
