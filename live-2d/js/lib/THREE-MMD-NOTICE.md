# Vendored MMD loader

These files are adapted to CommonJS for the Electron renderer and share the
application's existing `three` dependency. No second Three.js runtime is bundled.

- `mmd-loader.cjs`: [Three.js r171 MMDLoader](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/loaders/MMDLoader.js).
- `mmd-toon-shader.cjs`: [Three.js r171 MMDToonShader](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/shaders/MMDToonShader.js).
- `mmd-parser.cjs`: [Three.js r171 mmdparser](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/libs/mmdparser.module.js), by Takahiro.
- `tga-loader.cjs`: [Three.js r183 TGALoader](https://github.com/mrdoob/three.js/blob/r183/examples/jsm/loaders/TGALoader.js).
- `outline-effect.cjs`: [Three.js r183 OutlineEffect](https://github.com/mrdoob/three.js/blob/r183/examples/jsm/effects/OutlineEffect.js).

License: MIT, included in `THREE-MMD-LICENSE.txt`. Modifications are the module
import/export conversion and the attribution header; loader and shader behavior
is retained. Modern Three.js no longer ships the MMD modules, so their source is
kept here for offline model loading.
