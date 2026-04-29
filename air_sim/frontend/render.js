import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(3, 3, 3);
camera.lookAt(0, 0, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;

scene.add(new THREE.AmbientLight(0xffffff, 0.3));

export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();

export const dot = new THREE.Group();

export const fbxLoader = new FBXLoader();

export const shaderMaterials = [];

const textureLoader = new THREE.TextureLoader();

const acDiffuseMap = textureLoader.load("../backend/data/AC/Textures/Ac_Base_Color.jpg");
acDiffuseMap.colorSpace = THREE.SRGBColorSpace;

const acNormalMap = textureLoader.load("../backend/data/AC/Textures/Ac_Normal_DirectX.jpg");

async function createACShaderMaterial() {
    const shaderSources = await loadACShaderSources();

    return new THREE.ShaderMaterial({
        vertexShader: shaderSources.vertexShader,
        fragmentShader: shaderSources.fragmentShader,

        uniforms: {
            uDiffuseMap: {
                value: acDiffuseMap
            },
            uNormalMap: {
                value: acNormalMap
            },
            uLightDir: {
                value: new THREE.Vector3(0.4, 1.0, 0.5).normalize()
            },
            uCameraPos: {
                value: new THREE.Vector3()
            }
        },

        side: THREE.DoubleSide
    });
}

fbxLoader.load("../backend/data/AC/AC.fbx", async (fbx) => {
    fbx.scale.setScalar(0.02);

    const materialPromises = [];

    fbx.traverse((child) => {
        if (!child.isMesh) return;

        child.frustumCulled = false;

        const promise = createACShaderMaterial().then((shaderMat) => {
            child.material = shaderMat;
            shaderMaterials.push(shaderMat);
        });

        materialPromises.push(promise);
    });

    await Promise.all(materialPromises);

    dot.add(fbx);
});

const arrowLength = 0.25;
const arrowOffset = 0.27;
const _outflowMat = new THREE.MeshBasicMaterial({ color: 0x0088ff });
const _inflowMat  = new THREE.MeshBasicMaterial({ color: 0xff8800 });

export const outflow = new THREE.Mesh(new THREE.ConeGeometry(0.04, arrowLength, 8), _outflowMat);
outflow.rotation.x = Math.PI/2;
outflow.position.set(0, 0, arrowOffset);
const outflowPivot = new THREE.Group();
outflowPivot.add(outflow);

export const inflow = new THREE.Mesh(new THREE.ConeGeometry(0.04, arrowLength, 8), _inflowMat);
inflow.rotation.x = 3 * Math.PI/2;
inflow.position.set(0, 0, arrowOffset);
const inflowPivot = new THREE.Group();
inflowPivot.add(inflow);

export const acGroup = new THREE.Group();
acGroup.add(dot);
acGroup.add(outflowPivot);
acGroup.add(inflowPivot);
acGroup.visible = false;
scene.add(acGroup);

const _up = new THREE.Vector3(0, 1, 0);
let _baseQuat = new THREE.Quaternion();
let _placementAngleRad = 0;
let _outflowAngleRad = 0;
let _inflowAngleRad = Math.PI/2;

function _applyGroupQuat() {
    const groupRot   = new THREE.Quaternion().setFromAxisAngle(_up, _placementAngleRad);
    const outflowRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), _outflowAngleRad);
    const inflowRot  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), _inflowAngleRad * -1);
    acGroup.quaternion.multiplyQuaternions(groupRot, _baseQuat);
    outflowPivot.quaternion.copy(outflowRot);
    inflowPivot.quaternion.copy(inflowRot);
}

export function setACNormal(worldNormal) {
    const norm = worldNormal.clone();
    norm.y = 0;
    norm.normalize();
    const localX = new THREE.Vector3(0, 1, 0).cross(norm).normalize();
    const localY = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().makeBasis(localX, localY, norm);
    _baseQuat.setFromRotationMatrix(m);
    _applyGroupQuat();
}

export function setPlacementAngle(deg) {
    _placementAngleRad = deg * Math.PI / 180;
    _applyGroupQuat();
}

export function setOutflowAngle(deg) {
    _outflowAngleRad = deg * Math.PI / 180;
    _applyGroupQuat();
}

export function setInflowAngle(deg) {
    _inflowAngleRad = deg * Math.PI / 180;
    _applyGroupQuat();
}

export function getOutflowConfig() {
    const v = new THREE.Vector3(0, 0, 1);
    v.applyQuaternion(outflowPivot.quaternion);
    v.applyQuaternion(acGroup.quaternion);
    return v;
}

export function getInflowConfig() {
    const v = new THREE.Vector3(0, 0, 1);
    v.applyQuaternion(inflowPivot.quaternion);
    v.applyQuaternion(acGroup.quaternion);
    return v;
}

export const renderState = {
    mesh: null,
    simPoints: null,
    simSpeedBuffer: null,
    streamlines: null,
    streamlinePositionBuffer: null,
    volumePoints: null,
    volumeDensityBuffer: null,
    volumeSpeedBuffer: null,
    volumeRaymarchMesh: null,
    volumeTexture: null,
    volumeRaymarchShaderSources: null,
    volumeGridInfo: null,
    meshShaderSources: null,
    simShaderSources: null,
    acShaderSources: null,
    grid: null
};

export const vizFlags = {
    streamlines: false,
    volume: false,
    simPoints: true
};

export function worldToPly(v) { return [v.x, -v.z, v.y]; }

export async function loadShaderSources(vertexPath, fragmentPath) {
    const [vertexRes, fragmentRes] = await Promise.all([fetch(vertexPath), fetch(fragmentPath)]);
    if (!vertexRes.ok) throw new Error(`Failed to load vertex shader: ${vertexPath}`);
    if (!fragmentRes.ok) throw new Error(`Failed to load fragment shader: ${fragmentPath}`);
    const [vertexShader, fragmentShader] = await Promise.all([vertexRes.text(), fragmentRes.text()]);
    return { vertexShader, fragmentShader };
}

async function loadACShaderSources() {
    if (!renderState.acShaderSources) {
        renderState.acShaderSources = await loadShaderSources(
            "shaders/ac_vertex.glsl",
            "shaders/ac_fragment.glsl"
        );
    }

    return renderState.acShaderSources;
}

async function loadVolumeRaymarchShaderSources() {
    if (!renderState.volumeRaymarchShaderSources) {
        renderState.volumeRaymarchShaderSources = await loadShaderSources(
            "shaders/volume_raymarch_vertex.glsl",
            "shaders/volume_raymarch_fragment.glsl"
        );
    }

    return renderState.volumeRaymarchShaderSources;
}

export function initShaderMaterial({ vertexShader, fragmentShader }, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.FrontSide });
}

export function initMesh(vertices, colors, faces) {
    if (renderState.mesh) {
        scene.remove(renderState.mesh);
        renderState.mesh.geometry.dispose();
        renderState.mesh.material.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    if (colors && colors.length > 0)
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    geometry.computeVertexNormals();
    const material = initShaderMaterial(renderState.meshShaderSources, {
        uLightDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
    });
    renderState.mesh = new THREE.Mesh(geometry, material);
    renderState.mesh.rotation.x = -Math.PI / 2;
    scene.add(renderState.mesh);
    console.log(`Mesh loaded: ${vertices.length / 3} vertices, ${faces.length / 3} triangles`);
}

let _streamlineSeedEvery = 80;
let _streamlineSteps = 20;
let _streamlineStepSize = 0.06;
let _streamlineMinSpeed = 0.00001;

function nearestVelocityAt(pos, positions, frameData) {
    let bestIndex = -1;
    let bestDistSq = Infinity;

    const cellCount = positions.length / 3;

    for (let i = 0; i < cellCount; i++) {
        const p = i * 3;

        const dx = positions[p + 0] - pos.x;
        const dy = positions[p + 1] - pos.y;
        const dz = positions[p + 2] - pos.z;

        const d2 = dx * dx + dy * dy + dz * dz;

        if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestIndex = i;
        }
    }

    if (bestIndex < 0) {
        return null;
    }

    const f = bestIndex * 5;

    return {
        vx: frameData[f + 0],
        vy: frameData[f + 1],
        vz: frameData[f + 2],
        speed: frameData[f + 3],
        density: frameData[f + 4]
    };
}

export function initStreamlines(positions) {
    clearStreamlines();

    const cellCount = positions.length / 3;
    const seedCount = Math.floor(cellCount / _streamlineSeedEvery);
    const pointsPerLine = _streamlineSteps;
    const totalPoints = seedCount * pointsPerLine;

    renderState.streamlinePositionBuffer = new Float32Array(totalPoints * 3);

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(renderState.streamlinePositionBuffer, 3)
    );

    const material = new THREE.LineBasicMaterial({
        color: 0x00ccff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
    });

    const lines = new THREE.LineSegments(geometry, material);

    lines.rotation.x = -Math.PI / 2;

    renderState.streamlines = lines;
    scene.add(renderState.streamlines);
}

export function updateStreamlines(positions, frameData) {
    if (
        !renderState.streamlines ||
        !renderState.streamlinePositionBuffer ||
        !positions ||
        !frameData
    ) {
        return;
    }

    const buffer = renderState.streamlinePositionBuffer;

    let write = 0;
    const cellCount = positions.length / 3;

    for (let i = 0; i < cellCount; i += _streamlineSeedEvery) {
        const p = i * 3;

        const pos = new THREE.Vector3(
            positions[p + 0],
            positions[p + 1],
            positions[p + 2]
        );

        for (let s = 0; s < _streamlineSteps; s++) {
            const vel = nearestVelocityAt(pos, positions, frameData);

            if (!vel || vel.speed < _streamlineMinSpeed) {
                buffer[write++] = pos.x;
                buffer[write++] = pos.y;
                buffer[write++] = pos.z;
                continue;
            }

            buffer[write++] = pos.x;
            buffer[write++] = pos.y;
            buffer[write++] = pos.z;

            const dir = new THREE.Vector3(
                vel.vx,
                vel.vy,
                vel.vz
            ).normalize();

            pos.addScaledVector(dir, _streamlineStepSize);
        }
    }

    renderState.streamlines.geometry.attributes.position.needsUpdate = true;
}

export function clearStreamlines() {
    if (!renderState.streamlines) return;

    scene.remove(renderState.streamlines);

    renderState.streamlines.geometry.dispose();
    renderState.streamlines.material.dispose();

    renderState.streamlines = null;
    renderState.streamlinePositionBuffer = null;
}

function buildVolumeGridInfo(positions) {
    const xs = [];
    const ys = [];
    const zs = [];

    for (let i = 0; i < positions.length; i += 3) {
        xs.push(positions[i + 0]);
        ys.push(positions[i + 1]);
        zs.push(positions[i + 2]);
    }

    const uniqueSorted = (arr) =>
        Array.from(new Set(arr.map(v => v.toFixed(5))))
            .map(Number)
            .sort((a, b) => a - b);

    const ux = uniqueSorted(xs);
    const uy = uniqueSorted(ys);
    const uz = uniqueSorted(zs);

    const nx = ux.length;
    const ny = uy.length;
    const nz = uz.length;

    const min = new THREE.Vector3(ux[0], uy[0], uz[0]);
    const max = new THREE.Vector3(ux[nx - 1], uy[ny - 1], uz[nz - 1]);

    const dx = nx > 1 ? ux[1] - ux[0] : 1.0;
    const dy = ny > 1 ? uy[1] - uy[0] : 1.0;
    const dz = nz > 1 ? uz[1] - uz[0] : 1.0;

    min.sub(new THREE.Vector3(dx, dy, dz).multiplyScalar(0.5));
    max.add(new THREE.Vector3(dx, dy, dz).multiplyScalar(0.5));

    const xMap = new Map(ux.map((v, i) => [v.toFixed(5), i]));
    const yMap = new Map(uy.map((v, i) => [v.toFixed(5), i]));
    const zMap = new Map(uz.map((v, i) => [v.toFixed(5), i]));

    const indexMap = new Int32Array(positions.length / 3);

    for (let i = 0; i < positions.length / 3; i++) {
        const p = i * 3;

        const ix = xMap.get(positions[p + 0].toFixed(5));
        const iy = yMap.get(positions[p + 1].toFixed(5));
        const iz = zMap.get(positions[p + 2].toFixed(5));

        indexMap[i] = ix + iy * nx + iz * nx * ny;
    }

    return {
        nx,
        ny,
        nz,
        min,
        max,
        indexMap,
        data: new Float32Array(nx * ny * nz)
    };
}

export async function initVolumeRaymarching(positions) {
    clearVolumeRaymarching();

    const shaderSources = await loadVolumeRaymarchShaderSources();

    const grid = buildVolumeGridInfo(positions);
    renderState.volumeGridInfo = grid;

    const texture = new THREE.Data3DTexture(
        grid.data,
        grid.nx,
        grid.ny,
        grid.nz
    );

    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    renderState.volumeTexture = texture;

    const size = new THREE.Vector3().subVectors(grid.max, grid.min);
    const center = new THREE.Vector3().addVectors(grid.min, grid.max).multiplyScalar(0.5);

    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometry.translate(center.x, center.y, center.z);

    const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,

        vertexShader: shaderSources.vertexShader,
        fragmentShader: shaderSources.fragmentShader,

        uniforms: {
            uVolumeTex: { value: texture },
            uBoxMin: { value: grid.min },
            uBoxMax: { value: grid.max },
            uCameraLocalPos: { value: new THREE.Vector3() },

            uStepSize: { value: Math.min(size.x, size.y, size.z) / 192.0 },
            uOpacity: { value: 0.12 },
            uThreshold: { value: 0.02 }
        },

        transparent: true,
        depthWrite: false,

        depthTest: false,

        side: THREE.BackSide
    });

    renderState.volumeRaymarchMesh = new THREE.Mesh(geometry, material);

    renderState.volumeRaymarchMesh.rotation.x = -Math.PI / 2;

    scene.add(renderState.volumeRaymarchMesh);
}

const _volumeLocalCamera = new THREE.Vector3();

export function updateVolumeRaymarching(frameData) {
    const mesh = renderState.volumeRaymarchMesh;
    const texture = renderState.volumeTexture;
    const grid = renderState.volumeGridInfo;

    if (!mesh || !texture || !grid || !frameData) return;

    grid.data.fill(0.0);

    let maxSpeed = 0.00001;

    for (let i = 0; i < grid.indexMap.length; i++) {
        const speed = frameData[i * 5 + 3];
        if (speed > maxSpeed) maxSpeed = speed;
    }

    for (let i = 0; i < grid.indexMap.length; i++) {
        const speed = frameData[i * 5 + 3];
        const texIndex = grid.indexMap[i];

        grid.data[texIndex] = speed / maxSpeed;
    }

    texture.needsUpdate = true;

    mesh.updateMatrixWorld(true);

    _volumeLocalCamera.copy(camera.position);
    mesh.worldToLocal(_volumeLocalCamera);

    mesh.material.uniforms.uCameraLocalPos.value.copy(_volumeLocalCamera);
}

export function clearVolumeRaymarching() {
    if (!renderState.volumeRaymarchMesh) return;

    scene.remove(renderState.volumeRaymarchMesh);

    renderState.volumeRaymarchMesh.geometry.dispose();
    renderState.volumeRaymarchMesh.material.dispose();

    if (renderState.volumeTexture) {
        renderState.volumeTexture.dispose();
    }

    renderState.volumeRaymarchMesh = null;
    renderState.volumeTexture = null;
    renderState.volumeGridInfo = null;
}

export function initSimPoints(positions) {
    clearSimPoints();

    const count = positions.length / 3;

    renderState.simSpeedBuffer = new Float32Array(count);

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(positions), 3)
    );

    geometry.setAttribute(
        'speed',
        new THREE.BufferAttribute(renderState.simSpeedBuffer, 1)
    );

    const material = new THREE.ShaderMaterial({
        vertexShader: renderState.simShaderSources.vertexShader,
        fragmentShader: renderState.simShaderSources.fragmentShader,

        uniforms: {
            uMaxSpeed: { value: _displayScale },
            uPointSize: { value: 18.0 },
            uOpacity: { value: 0.45 }
        },

        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    renderState.simPoints = new THREE.Points(geometry, material);
    renderState.simPoints.rotation.x = -Math.PI / 2;
    renderState.simPoints.visible = vizFlags.simPoints;

    scene.add(renderState.simPoints);
}

let _displayScale = 0.05;
export function setDisplayScale(s) {
    _displayScale = s;
    if (renderState.simPoints)
        renderState.simPoints.material.uniforms.uMaxSpeed.value = _displayScale;
}

export function updateSimPoints(frameData) {
    if (!renderState.simPoints || !frameData || !renderState.simSpeedBuffer) return;
    const count = renderState.simSpeedBuffer.length;
    for (let i = 0; i < count; i++)
        renderState.simSpeedBuffer[i] = frameData[i * 5 + 3];
    renderState.simPoints.geometry.attributes.speed.needsUpdate = true;
    renderState.simPoints.material.uniforms.uMaxSpeed.value = _displayScale;
}

export function clearSimPoints() {
    if (!renderState.simPoints) return;
    scene.remove(renderState.simPoints);
    renderState.simPoints.geometry.dispose();
    renderState.simPoints.material.dispose();
    renderState.simPoints = null;
    renderState.simSpeedBuffer = null;
}

export function initGrid(resolution) {
    clearGrid();
    if (!renderState.mesh) return;

    const pos = renderState.mesh.geometry.attributes.position.array;
    let min_x = Infinity,  min_y = Infinity,  min_z = Infinity;
    let max_x = -Infinity, max_y = -Infinity, max_z = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        if (pos[i]   < min_x) min_x = pos[i];   if (pos[i]   > max_x) max_x = pos[i];
        if (pos[i+1] < min_y) min_y = pos[i+1]; if (pos[i+1] > max_y) max_y = pos[i+1];
        if (pos[i+2] < min_z) min_z = pos[i+2]; if (pos[i+2] > max_z) max_z = pos[i+2];
    }

    const lx = max_x - min_x;
    const ly = max_y - min_y;
    const lz = max_z - min_z;
    const voxelSize = Math.max(lx, ly, lz) / resolution;

    const Nx = Math.ceil(lx / voxelSize);
    const Ny = Math.ceil(ly / voxelSize);
    const Nz = Math.ceil(lz / voxelSize);

    const ox = min_x;
    const oy = min_y;
    const oz = min_z;

    const verts = [];

    for (let j = 0; j <= Ny; j++) {
        for (let k = 0; k <= Nz; k++) {
            const y = oy + j * voxelSize;
            const z = oz + k * voxelSize;
            verts.push(ox, y, z, ox + Nx * voxelSize, y, z);
        }
    }
    for (let i = 0; i <= Nx; i++) {
        for (let k = 0; k <= Nz; k++) {
            const x = ox + i * voxelSize;
            const z = oz + k * voxelSize;
            verts.push(x, oy, z, x, oy + Ny * voxelSize, z);
        }
    }
    for (let i = 0; i <= Nx; i++) {
        for (let j = 0; j <= Ny; j++) {
            const x = ox + i * voxelSize;
            const y = oy + j * voxelSize;
            verts.push(x, y, oz, x, y, oz + Nz * voxelSize);
        }
    }

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(verts);
    const material = new LineMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: .3,
        linewidth: 2,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    renderState.grid = new LineSegments2(geometry, material);
    renderState.grid.rotation.x = -Math.PI / 2;
    scene.add(renderState.grid);
}

export function clearGrid() {
    if (!renderState.grid) return;
    scene.remove(renderState.grid);
    renderState.grid.geometry.dispose();
    renderState.grid.material.dispose();
    renderState.grid = null;
}

let _emitVoxel = null, _intakeVoxel = null;
const _emitVoxelMat   = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.6 });
const _intakeVoxelMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.6 });

export function initACVoxels(worldPos, resolution) {
    clearACVoxels();
    if (!renderState.mesh) return;

    const pos = renderState.mesh.geometry.attributes.position.array;
    let min_x = Infinity, min_y = Infinity, min_z = Infinity;
    let max_x = -Infinity, max_y = -Infinity, max_z = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        if (pos[i]   < min_x) min_x = pos[i];   if (pos[i]   > max_x) max_x = pos[i];
        if (pos[i+1] < min_y) min_y = pos[i+1]; if (pos[i+1] > max_y) max_y = pos[i+1];
        if (pos[i+2] < min_z) min_z = pos[i+2]; if (pos[i+2] > max_z) max_z = pos[i+2];
    }
    const voxelSize = Math.max(max_x-min_x, max_y-min_y, max_z-min_z) / resolution;

    const ply_x = worldPos.x;
    const ply_y = -worldPos.z;
    const ply_z = worldPos.y;
    const ix = Math.floor((ply_x - min_x) / voxelSize);
    const iy = Math.floor((ply_y - min_y) / voxelSize);
    const iz = Math.floor((ply_z - min_z) / voxelSize);

    const emit_px = min_x + (ix + 0.5) * voxelSize;
    const emit_py = min_y + (iy + 0.5) * voxelSize;
    const emit_pz = min_z + (iz + 0.5) * voxelSize;
    const intake_pz = emit_pz + voxelSize;

    const geom = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    _emitVoxel = new THREE.Mesh(geom, _emitVoxelMat);
    _emitVoxel.position.set(emit_px, emit_pz, -emit_py);
    scene.add(_emitVoxel);

    _intakeVoxel = new THREE.Mesh(geom, _intakeVoxelMat);
    _intakeVoxel.position.set(emit_px, intake_pz, -emit_py);
    scene.add(_intakeVoxel);
}

export function clearACVoxels() {
    if (_emitVoxel) {
        scene.remove(_emitVoxel);
        _emitVoxel.geometry.dispose();
        _emitVoxel = null;
    }
    if (_intakeVoxel) {
        scene.remove(_intakeVoxel);
        _intakeVoxel = null;
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (renderState.grid)
        renderState.grid.material.resolution.set(window.innerWidth, window.innerHeight);
});
