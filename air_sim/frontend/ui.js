import * as THREE from 'three';
import { acGroup, renderState, initGrid, clearGrid, worldToPly, setPlacementAngle, setACNormal, setOutflowAngle, setInflowAngle, getOutflowConfig, getInflowConfig, setDisplayScale } from './render.js';
import { simConfig, simState } from './simulation.js';
import { sendConfig, startSim, stopSim, onSimStopped } from './connection.js';

let movingAC = false;
let outVelMag       = 1.0;
let inVelMag        = 1.0;
let outflowAngleDeg  = 0;
let intakeAngleDeg   = 0;
let placementAngleDeg = 0;

function updateOutVel() {
    const d = getOutflowConfig();
    simConfig.ac_placement.out_vel = worldToPly(d).map(v => v * outVelMag);
}
function updateInVel() {
    const d = getInflowConfig();
    simConfig.ac_placement.in_vel = worldToPly(d).map(v => v * inVelMag);
}

const consoleDiv = document.querySelector('#console');
export function consoleMessage(message) { consoleDiv.innerHTML = message; }

const placementAngleInput   = document.getElementById('placementAngleInput');
const placementAngleDisplay = document.getElementById('placementAngleDisplay');

function resetPlacementAngle() {
    placementAngleDeg = 0;
    placementAngleInput.value = 0;
    placementAngleDisplay.textContent = '0°';
    setPlacementAngle(0);
}

const moveACButton = document.querySelector('#moveACButton');
moveACButton.onclick = () => {
    consoleMessage('');
    moveACButton.classList.toggle('clicked');
    movingAC = moveACButton.classList.contains('clicked');
    if (movingAC) resetPlacementAngle();
};

const startSimButton = document.querySelector('#startSimButton');
startSimButton.onclick = async () => {
    consoleMessage('');
    if (!acGroup.visible) {
        consoleMessage('Place the AC unit before starting the simulation');
        return;
    }

    if (!simState.running) {
        const result = await startSim();
        if (!result.ok) { consoleMessage(result.message); return; }
        startSimButton.classList.add('clicked');
        startSimButton.innerHTML = 'Stop Simulation';
    } else {
        const result = await stopSim();
        if (!result.ok) { consoleMessage(result.message); return; }
        startSimButton.classList.remove('clicked');
        startSimButton.innerHTML = 'Start Simulation';
    }
};

onSimStopped(() => {
    startSimButton.classList.remove('clicked');
    startSimButton.innerHTML = 'Start Simulation';
    consoleMessage('Simulation stopped');
});

const showGridButton = document.querySelector('#showGridButton');
let gridVisible = false;
showGridButton.onclick = () => {
    gridVisible = !gridVisible;
    showGridButton.classList.toggle('clicked', gridVisible);
    if (gridVisible) initGrid(simConfig.sim_data.resolution);
    else clearGrid();
};

const inputBindings = [
    ['outVelInput',    v => { outVelMag = v; updateOutVel(); }],
    ['inVelInput',     v => { inVelMag  = v; updateInVel();  }],
    ['resolutionInput',v => { simConfig.sim_data.resolution = Math.round(v); if (gridVisible) initGrid(simConfig.sim_data.resolution); }],
    ['tauInput',       v => simConfig.sim_data.tau          = v],
    ['warmupInput',    v => simConfig.sim_data.warmup_steps = Math.round(v)],
];

const vizBindings = [
    ['displayScaleInput', v => setDisplayScale(v)],
];

async function stopSimIfRunning() {
    if (!simState.running) return;
    const result = await stopSim();
    if (!result.ok) { consoleMessage(result.message); return; }
    startSimButton.classList.remove('clicked');
    startSimButton.innerHTML = 'Start Simulation';
}

for (const [id, setter] of inputBindings) {
    const el = document.getElementById(id);
    setter(parseFloat(el.value));
    el.addEventListener('input', (e) => {
        setter(parseFloat(e.target.value));
        stopSimIfRunning();
        sendConfig();
    });
}

for (const [id, setter] of vizBindings) {
    const el = document.getElementById(id);
    setter(parseFloat(el.value));
    el.addEventListener('input', (e) => setter(parseFloat(e.target.value)));
}

const outflowAngleInput   = document.getElementById('outflowAngleInput');
const outflowAngleDisplay = document.getElementById('outflowAngleDisplay');
const intakeAngleInput    = document.getElementById('intakeAngleInput');
const intakeAngleDisplay  = document.getElementById('intakeAngleDisplay');

outflowAngleDeg = parseFloat(outflowAngleInput.value);
intakeAngleDeg  = parseFloat(intakeAngleInput.value);
updateOutVel();
updateInVel();

outflowAngleInput.addEventListener('input', () => {
    outflowAngleDeg = parseFloat(outflowAngleInput.value);
    outflowAngleDisplay.textContent = outflowAngleDeg + '°';
    setOutflowAngle(outflowAngleDeg)
    updateOutVel();
    stopSimIfRunning();
});

outflowAngleInput.addEventListener('change', () => {
    stopSimIfRunning();
    sendConfig();
});

intakeAngleInput.addEventListener('input', () => {
    intakeAngleDeg = parseFloat(intakeAngleInput.value);
    intakeAngleDisplay.textContent = intakeAngleDeg + '°';
    setInflowAngle(intakeAngleDeg);
    updateInVel();
    stopSimIfRunning();
});

intakeAngleInput.addEventListener('change', () => {
    stopSimIfRunning();
    sendConfig();
});

placementAngleInput.addEventListener('input', () => {
    placementAngleDeg = parseFloat(placementAngleInput.value);
    placementAngleDisplay.textContent = placementAngleDeg + '°';
    setPlacementAngle(placementAngleDeg);
    updateOutVel();
    updateInVel();
});

placementAngleInput.addEventListener('change', () => {
    stopSimIfRunning();
    sendConfig();
});

sendConfig();

import { renderer, camera, raycaster, pointer } from './render.js';

renderer.domElement.addEventListener('click', () => {
    if (!movingAC || !acGroup.visible) return;
    moveACButton.classList.remove('clicked');
    movingAC = false;
    updateOutVel();
    updateInVel();
    sendConfig();
});

renderer.domElement.addEventListener('mousemove', (e) => {
    if (!renderState.mesh || !movingAC) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(renderState.mesh);

    if (hits.length > 0) {
        const hit = hits[0];
        const n = hit.face.normal.clone()
            .transformDirection(renderState.mesh.matrixWorld)
            .normalize();
        setACNormal(n);
        acGroup.position.copy(hit.point);
        acGroup.visible = true;
        simConfig.ac_placement.placement = worldToPly(hit.point);
    }
});
