const THREE = require('three');

function createRamp(values, smooth = false) {
    const bytes = new Uint8Array(values.length * 4);
    values.forEach((value, i) => {
        bytes.set([value, value, value, 255], i * 4);
    });
    const ramp = new THREE.DataTexture(bytes, values.length, 1, THREE.RGBAFormat);
    ramp.colorSpace = THREE.NoColorSpace;
    ramp.minFilter = ramp.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
    return ramp;
}

// Anime textures already contain painted folds and highlights. Additional Phong
// lobes make cloth look like molded plastic and hide fine face lines.
function createPMXMaterials(originals, renderer) {
    const bodyRamp = createRamp([145, 180, 220, 255]);
    const skinRamp = createRamp(Array.from({ length: 32 }, (_, i) => Math.round(185 + i * 70 / 31)), true);
    const materials = originals.map(original => {
        const name = original.name || '';
        const detail = /目|眉|口_|歯|舌|口腔|eye|brow|lash|lip|teeth|tongue/i.test(name);
        const lip = /唇|lip/i.test(name);
        const skin = /颜|顔|face|skin|肌/i.test(name);
        const properties = {
            name, color: original.color.clone(), map: original.map,
            opacity: original.opacity, transparent: original.transparent,
            side: original.side, depthWrite: original.depthWrite,
            alphaTest: original.map && original.transparent ? 0.01 : 0,
            toneMapped: false,
            // Fine lip/lash surfaces may be nearly coplanar with the face.
            polygonOffset: detail, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        };
        let material;
        if (detail) {
            // Keep painted lashes/eyes and dark lip geometry independent of key
            // lighting. Preserve authored colored tints, remove neutral export gray.
            const color = properties.color;
            if (original.map && Math.abs(color.r - color.g) < 0.001 && Math.abs(color.g - color.b) < 0.001) color.setScalar(1);
            material = new THREE.MeshBasicMaterial(properties);
        } else {
            material = new THREE.MeshToonMaterial({ ...properties,
                gradientMap: skin ? skinRamp : bodyRamp, emissive: 0x000000 });
        }
        if (material.map) {
            material.map.colorSpace = THREE.SRGBColorSpace;
            material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            material.map.needsUpdate = true;
        }
        material.userData = { ...original.userData, outlineParameters: {
            visible: (lip || !detail) && original.opacity > 0,
            thickness: lip ? 0.0004 : skin ? 0.00055 : 0.0008,
            color: lip ? [0.045, 0.012, 0.018] : [0.035, 0.028, 0.055], alpha: original.opacity
        } };
        return material;
    });
    // Release loader-only ramps and sphere maps, while keeping albedo textures.
    const retained = new Set(materials.map(material => material.map).filter(Boolean));
    const disposed = new Set();
    for (const original of originals) {
        for (const value of Object.values(original)) {
            if (value?.isTexture && !retained.has(value) && !disposed.has(value)) {
                value.dispose();
                disposed.add(value);
            }
        }
        original.dispose();
    }
    return materials;
}

module.exports = { createPMXMaterials };
