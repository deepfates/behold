# Minecraft-Legible Cartography Policy Selection

`minecraft-legible-v1` is selected for the hero and unseen-transfer builds. This is a bounded
selection, not a claim that canopy policy alone solves place quality.

The paired experiment compiled the same frozen OSM inputs, bounds, scale, generation settings,
and locked Arnis binary under `literal-v1` and `minecraft-legible-v1`. Its three calibration
windows cover a wooded coastal park and bridge, a dense tower-and-civic fabric, and a canal city.
The selected rule removes tall and giant synthetic tree schematics and thins synthetic grove fill.
Individually mapped `natural=tree` nodes retain their exact source coordinates and bypass thinning.
Building footprints, roads, terrain, projection, and landmark heights are unchanged.

At 4,000 deterministic, paired voxel columns per world, obstructing-canopy share fell by 3.01
percentage points in the Presidio, 4.84 points in Lower Manhattan, and 1.27 points in Venice. These
are relative reductions of approximately 45%, 35%, and 45%. Severe-canopy share fell in every
window; exposed-solid share rose in every window; underlying-surface coverage was unchanged.
The labeled atlas review preserved the road, building, terrain, water, and mapped-tree fabric while
making Manhattan's civic greens and the Presidio canopy materially easier to read.

Evidence is retained under
`.behold-artifacts/cartography-experiments/minecraft-legible-v1-calibration-02`:

- experiment manifest SHA-256: `b72e4cf9574db8e57dfd510577adebf8086cbc7db72e33e862311bf1eb2f11e8`
- structural metrics SHA-256: `66ea4dd3322139c98f0840ac3951466ded125988b9f6b1c2ac91e83cf4b322a0`
- paired atlas SHA-256: `46c157d789902517a08ad46bee6a25f217dc4b39b57e2dcfb627cf587756b8e3`
- locked Arnis binary SHA-256: `4b50682348f6de2f1f63ba1e6be6eade96f5f4a6a9fed9b39dc28dec2bfce853`

The policy now advances to San Francisco as the hero place and Berkeley as a transfer place that
was not used to tune or select it. Promotion still requires real arrival, route, atlas, native
ecology, reproducibility, and in-client experience evidence in both worlds.
