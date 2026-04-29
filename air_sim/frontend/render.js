import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

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

export const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
);

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
    meshShaderSources: null,
    simShaderSources: null,
    splatShaderSources: null,
    grid: null,
    splats: null,
    splatViewport: null,
};

export function worldToPly(v) { return [v.x, -v.z, v.y]; }

export async function loadShaderSources(vertexPath, fragmentPath) {
    const [vertexRes, fragmentRes] = await Promise.all([fetch(vertexPath), fetch(fragmentPath)]);
    if (!vertexRes.ok) throw new Error(`Failed to load vertex shader: ${vertexPath}`);
    if (!fragmentRes.ok) throw new Error(`Failed to load fragment shader: ${fragmentPath}`);
    const [vertexShader, fragmentShader] = await Promise.all([vertexRes.text(), fragmentRes.text()]);
    return { vertexShader, fragmentShader };
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

    // PLY Z → world Y after RotX(-π/2); align camera to vertical midpoint
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < vertices.length; i += 3) {
        if (vertices[i] < minZ) minZ = vertices[i];
        if (vertices[i] > maxZ) maxZ = vertices[i];
    }
    const midY = (minZ + maxZ) / 2;
    camera.position.y = midY;
    controls.target.y = midY;
}

export function initSimPoints(positions) {
    clearSimPoints();
    const count = positions.length / 3;
    renderState.simSpeedBuffer = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('speed', new THREE.BufferAttribute(renderState.simSpeedBuffer, 1));
    const material = new THREE.ShaderMaterial({
        vertexShader: renderState.simShaderSources.vertexShader,
        fragmentShader: renderState.simShaderSources.fragmentShader,
        uniforms: { uMaxSpeed: { value: _displayScale } },
        transparent: true,
        depthWrite: false,
    });
    renderState.simPoints = new THREE.Points(geometry, material);
    renderState.simPoints.rotation.x = -Math.PI / 2;
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

export function setSplatTransform(rx, ry, rz, sx, sy, sz, tx, ty, tz) {
    if (!renderState.splats) return;
    renderState.splats.rotation.set(-Math.PI / 2 + rx, ry, rz);
    renderState.splats.scale.set(sx, sy, sz);
    renderState.splats.position.set(tx, ty, tz);
}

let _splatRaw = null;
let _lastSortCam = new THREE.Vector3(Infinity, Infinity, Infinity);
let _lastSortQuat = new THREE.Quaternion();
const _SORT_POS_THRESHOLD  = 0.01;  // world units
const _SORT_ANG_THRESHOLD  = 0.002; // ~0.1 deg in quaternion distance

function radixSort(keys, count) {
    // 16-bit radix sort (2 passes) on unsigned 16-bit quantized keys, descending
    const out = new Uint32Array(count);
    const tmp = new Uint32Array(count);

    // Quantize float distances to uint16 (larger float → smaller int for descending order)
    let maxDist = 0;
    for (let i = 0; i < count; i++) if (keys[i] > maxDist) maxDist = keys[i];
    const scale = maxDist > 0 ? 65535 / maxDist : 1;
    const quantized = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        quantized[i] = 65535 - Math.min(65535, (keys[i] * scale) | 0);
        out[i] = i;
    }

    // Pass 1: low 16 bits
    const cnt0 = new Int32Array(65536);
    for (let i = 0; i < count; i++) cnt0[quantized[i] & 0xffff]++;
    let total = 0;
    for (let i = 0; i < 65536; i++) { const c = cnt0[i]; cnt0[i] = total; total += c; }
    for (let i = 0; i < count; i++) { const b = quantized[out[i]] & 0xffff; tmp[cnt0[b]++] = out[i]; }

    // Pass 2: high 16 bits (all zero for uint16 keys — single pass suffices)
    // Copy tmp → out for consistent return
    out.set(tmp);
    return out;
}

export function sortSplats() {
    if (!renderState.splats || !_splatRaw) return;

    // Skip if camera hasn't moved or rotated significantly
    const camPos  = camera.position;
    const camQuat = camera.quaternion;
    const posMoved = camPos.distanceToSquared(_lastSortCam) > _SORT_POS_THRESHOLD * _SORT_POS_THRESHOLD;
    const angMoved = Math.abs(camQuat.dot(_lastSortQuat) - 1) > _SORT_ANG_THRESHOLD;
    if (!posMoved && !angMoved) return;
    _lastSortCam.copy(camPos);
    _lastSortQuat.copy(camQuat);

    const { count, positions, colors, opacities, scales, rotations } = _splatRaw;
    const geo = renderState.splats.geometry;

    renderState.splats.updateMatrixWorld();
    const invWorld = renderState.splats.matrixWorld.clone().invert();
    const camLocal = camPos.clone().applyMatrix4(invWorld);
    const cx = camLocal.x, cy = camLocal.y, cz = camLocal.z;

    const dists = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const dx = positions[i*3] - cx, dy = positions[i*3+1] - cy, dz = positions[i*3+2] - cz;
        dists[i] = dx*dx + dy*dy + dz*dz;
    }

    const order = radixSort(dists, count);

    const sPos = geo.attributes.splatPosition.array;
    const sCol = geo.attributes.splatColor.array;
    const sOpa = geo.attributes.splatOpacity.array;
    const sSca = geo.attributes.splatScale.array;
    const sRot = geo.attributes.splatRot.array;

    for (let j = 0; j < count; j++) {
        const i = order[j];
        sPos[j*3]   = positions[i*3];   sPos[j*3+1] = positions[i*3+1]; sPos[j*3+2] = positions[i*3+2];
        sCol[j*3]   = colors[i*3];      sCol[j*3+1] = colors[i*3+1];   sCol[j*3+2] = colors[i*3+2];
        sOpa[j]     = opacities[i];
        sSca[j*3]   = scales[i*3];      sSca[j*3+1] = scales[i*3+1];   sSca[j*3+2] = scales[i*3+2];
        sRot[j*4]   = rotations[i*4];   sRot[j*4+1] = rotations[i*4+1]; sRot[j*4+2] = rotations[i*4+2]; sRot[j*4+3] = rotations[i*4+3];
    }

    geo.attributes.splatPosition.needsUpdate = true;
    geo.attributes.splatColor.needsUpdate    = true;
    geo.attributes.splatOpacity.needsUpdate  = true;
    geo.attributes.splatScale.needsUpdate    = true;
    geo.attributes.splatRot.needsUpdate      = true;
}

export function initSplats(positions, colors, opacities, scales, rotations) {
    if (renderState.splats) {
        scene.remove(renderState.splats);
        renderState.splats.geometry.dispose();
        renderState.splats.material.dispose();
        renderState.splats = null;
    }

    const count = positions.length / 3;
    _splatRaw = { count, positions, colors, opacities, scales, rotations };

    const sPos = new Float32Array(positions);
    const sCol = new Float32Array(colors);
    const sOpa = new Float32Array(opacities);
    const sSca = new Float32Array(scales);
    const sRot = new Float32Array(rotations);

    // Base quad: 2 triangles, corners at (±1, ±1)
    const quadVerts = new Float32Array([-1,-1,0,  1,-1,0,  -1,1,0,  1,1,0]);
    const quadIdx   = new Uint16Array([0,1,2, 1,3,2]);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(quadVerts, 3));
    geometry.setIndex(new THREE.BufferAttribute(quadIdx, 1));
    geometry.setAttribute('splatPosition', new THREE.InstancedBufferAttribute(sPos, 3));
    geometry.setAttribute('splatColor',    new THREE.InstancedBufferAttribute(sCol, 3));
    geometry.setAttribute('splatOpacity',  new THREE.InstancedBufferAttribute(sOpa, 1));
    geometry.setAttribute('splatScale',    new THREE.InstancedBufferAttribute(sSca, 3));
    geometry.setAttribute('splatRot',      new THREE.InstancedBufferAttribute(sRot, 4));
    geometry.instanceCount = count;

    const vp = new THREE.Vector2(renderer.domElement.width, renderer.domElement.height);
    const material = new THREE.ShaderMaterial({
        vertexShader:   renderState.splatShaderSources.vertexShader,
        fragmentShader: renderState.splatShaderSources.fragmentShader,
        uniforms: { viewport: { value: vp } },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
    });

    renderState.splats = new THREE.Mesh(geometry, material);
    renderState.splats.rotation.x = -Math.PI / 2;
    renderState.splatViewport = vp;
    scene.add(renderState.splats);
    console.log(`Splats loaded: ${count}`);
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
    if (renderState.splatViewport)
        renderState.splatViewport.set(renderer.domElement.width, renderer.domElement.height);
});
