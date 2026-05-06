import * as THREE from 'three';
import { acGroup, renderState, initGrid, clearGrid, initACVoxels, clearACVoxels, worldToPly, setPlacementAngle, setACNormal, setOutflowAngle, setInflowAngle, getOutflowConfig, getInflowConfig, setDisplayScale, setSplatTransform, renderer, camera, controls, fpControls, enterDollhouseMode, enterWalkthroughMode, walkthroughMode, setWalkSpeed, raycaster, pointer, initStreamlines, clearStreamlines, clearVolumeRaymarching, initVolumeRaymarching } from './render.js';

import { simConfig, simState } from './simulation.js';
import { sendConfig, startSim, stopSim, onSimStopped, captureFrames, abortCapture, saveRecording, saveScene } from './connection.js';
import { vizFlags } from './render.js';

function _fmt2(n) { return parseFloat(n).toFixed(2); }
function buildDirname(cfg) {
  const p=cfg.ac_placement.placement, o=cfg.ac_placement.out_vel, iv=cfg.ac_placement.in_vel, s=cfg.sim_data;
  return `p${_fmt2(p[0])}_${_fmt2(p[1])}_${_fmt2(p[2])}`
    +`-o${_fmt2(o[0])}_${_fmt2(o[1])}_${_fmt2(o[2])}`
    +`-i${_fmt2(iv[0])}_${_fmt2(iv[1])}_${_fmt2(iv[2])}`
    +`-r${s.resolution}-t${_fmt2(s.tau)}-w${s.warmup_steps}`;
}

let movingAC = false;
let outVelMag       = 1.0;
let inVelMag        = 1.0;
let outflowAngleDeg  = 0;
let intakeAngleDeg   = 0;
let placementAngleDeg = 0;

const toggleStreamlinesButton = document.getElementById('toggleStreamlinesButton');

toggleStreamlinesButton.onclick = () => {
    vizFlags.streamlines = !vizFlags.streamlines;

    toggleStreamlinesButton.classList.toggle('clicked', vizFlags.streamlines);

    if (!simState.positions) return;

    if (vizFlags.streamlines) {
        initStreamlines(simState.positions);
    } else {
        clearStreamlines();
    }
};

const toggleVolumeButton = document.getElementById('toggleVolumeButton');

toggleVolumeButton.onclick = () => {
    vizFlags.volume = !vizFlags.volume;

    toggleVolumeButton.classList.toggle('clicked', vizFlags.volume);

    if (!simState.positions) return;

    if (vizFlags.volume) {
        initVolumeRaymarching(simState.positions).catch(console.error);
    } else {
        clearVolumeRaymarching();
    }
};

const toggleSimPointsButton = document.getElementById('toggleSimPointsButton');
toggleSimPointsButton.classList.toggle('clicked', vizFlags.simPoints);

toggleSimPointsButton.onclick = () => {
    vizFlags.simPoints = !vizFlags.simPoints;

    toggleSimPointsButton.classList.toggle('clicked', vizFlags.simPoints);

    if (!renderState.simPoints) return;

    renderState.simPoints.visible = vizFlags.simPoints;
};

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
    if (movingAC) {
        resetPlacementAngle();
        controls.enabled = false;
    } else {
        controls.enabled = true;
    }
};

const startSimButton = document.querySelector('#startSimButton');
startSimButton.onclick = async () => {
    consoleMessage('');
    if (!acGroup.visible && !acVisibleBeforeGrid) {
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
let acVisibleBeforeGrid = false;
showGridButton.onclick = () => {
    gridVisible = !gridVisible;
    showGridButton.classList.toggle('clicked', gridVisible);
    if (gridVisible) {
        initGrid(simConfig.sim_data.resolution);
        acVisibleBeforeGrid = acGroup.visible;
        if (acGroup.visible)
            initACVoxels(acGroup.position, simConfig.sim_data.resolution);
        acGroup.visible = false;
    } else {
        clearGrid();
        clearACVoxels();
        acGroup.visible = acVisibleBeforeGrid;
    }
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

const splatRotXInput    = document.getElementById('splatRotXInput');
const splatRotXDisplay  = document.getElementById('splatRotXDisplay');
const splatRotYInput    = document.getElementById('splatRotYInput');
const splatRotYDisplay  = document.getElementById('splatRotYDisplay');
const splatRotZInput    = document.getElementById('splatRotZInput');
const splatRotZDisplay  = document.getElementById('splatRotZDisplay');
const splatScaleInput   = document.getElementById('splatScaleInput');
const splatScaleDisplay = document.getElementById('splatScaleDisplay');
const splatTransXInput  = document.getElementById('splatTransXInput');
const splatTransYInput  = document.getElementById('splatTransYInput');
const splatTransZInput  = document.getElementById('splatTransZInput');

const showSplatToggle = document.getElementById('showSplatToggle');
const showMeshToggle  = document.getElementById('showMeshToggle');

showSplatToggle.addEventListener('change', () => {
    if (renderState.splats) renderState.splats.visible = showSplatToggle.checked;
});
showMeshToggle.addEventListener('change', () => {
    if (renderState.mesh) renderState.mesh.visible = showMeshToggle.checked;
});

const walkthroughToggle = document.getElementById('walkthroughToggle');
walkthroughToggle.onclick = () => {
    enterWalkthroughMode();
    walkthroughToggle.classList.add('clicked');
};
fpControls.addEventListener('unlock', () => {
    if (!walkthroughMode) return;
    enterDollhouseMode();
    walkthroughToggle.classList.remove('clicked');
});

const walkSpeedInput = document.getElementById('walkSpeedInput');
setWalkSpeed(parseFloat(walkSpeedInput.value));
walkSpeedInput.addEventListener('input', e => setWalkSpeed(parseFloat(e.target.value)));

const exportMatrixButton = document.getElementById('exportMatrixButton');
exportMatrixButton.onclick = () => {
    const splatMatrix = new THREE.Matrix4();
    splatMatrix.makeTranslation(
        parseFloat(splatTransXInput.value),
        parseFloat(splatTransYInput.value),
        parseFloat(splatTransZInput.value)
    );

    const rx = parseFloat(splatRotXInput.value) * Math.PI / 180;
    const ry = parseFloat(splatRotYInput.value) * Math.PI / 180;
    const rz = parseFloat(splatRotZInput.value) * Math.PI / 180;
    const s  = parseFloat(splatScaleInput.value);

    const rotX = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + rx);
    const rotY = new THREE.Matrix4().makeRotationY(ry);
    const rotZ = new THREE.Matrix4().makeRotationZ(rz);
    const scaleMatrix = new THREE.Matrix4().makeScale(s, s, s);

    const combined = splatMatrix.multiply(rotX).multiply(rotY).multiply(rotZ).multiply(scaleMatrix);

    const elements = [];
    for (let i = 0; i < 16; i++) elements.push(combined.elements[i]);
    console.log('Affine transformation matrix (left to right, top to bottom):');
    console.log(elements.toString());
};

const saveSceneButton = document.getElementById('saveSceneButton');
saveSceneButton.onclick = async () => {
  saveSceneButton.disabled = true;
  try {
    const res = await saveScene();
    if (res.ok) consoleMessage('Scene saved (mesh.bin + splat.bin).');
    else consoleMessage(`Save scene failed: ${await res.text()}`);
  } catch (err) {
    consoleMessage(`Save scene error: ${err.message}`);
  } finally {
    saveSceneButton.disabled = false;
  }
};

const exportFramesButton  = document.getElementById('exportFramesButton');
const exportFramesCounter = document.getElementById('exportFramesCounter');
const frameCountInput     = document.getElementById('frameCountInput');

exportFramesButton.onclick = async () => {
  const fc=Math.max(1,Math.round(parseFloat(frameCountInput.value)));
  exportFramesButton.disabled=true;
  exportFramesButton.classList.add('clicked');
  exportFramesCounter.textContent=`0/${fc}`;
  try {
    if (!simState.running) {
      const r=await startSim();
      if (!r.ok) { consoleMessage(`Export: failed to start sim — ${r.message}`); return; }
    }
    if (!simState.positions) {
      await new Promise((res,rej)=>{
        const t=setTimeout(()=>rej(new Error('Timed out waiting for positions')),10000);
        const iv=setInterval(()=>{ if(simState.positions){clearInterval(iv);clearTimeout(t);res();} },50);
      });
    }
    const frames=await captureFrames(fc,(n,total)=>{ exportFramesCounter.textContent=`${n}/${total}`; });
    exportFramesCounter.textContent=`${fc}/${fc}`;
    const dirname=buildDirname(simConfig);
    consoleMessage(`Saving recording "${dirname}"…`);
    const res=await saveRecording(dirname,JSON.stringify(simConfig),simState.positions,frames);
    if (!res.ok) consoleMessage(`Export failed: ${await res.text()}`);
    else consoleMessage(`Saved: ${dirname}`);
  } catch(err) {
    consoleMessage(`Export error: ${err.message}`);
    abortCapture();
  } finally {
    exportFramesButton.disabled=false;
    exportFramesButton.classList.remove('clicked');
    exportFramesCounter.textContent='';
  }
};

function applySplatTransform() {
    const rx = parseFloat(splatRotXInput.value) * Math.PI / 180;
    const ry = parseFloat(splatRotYInput.value) * Math.PI / 180;
    const rz = parseFloat(splatRotZInput.value) * Math.PI / 180;
    const s  = parseFloat(splatScaleInput.value);
    const tx = parseFloat(splatTransXInput.value);
    const ty = parseFloat(splatTransYInput.value);
    const tz = parseFloat(splatTransZInput.value);
    setSplatTransform(rx, ry, rz, s, s, s, tx, ty, tz);
}

splatRotXInput.addEventListener('input', () => { splatRotXDisplay.textContent = splatRotXInput.value + '°'; applySplatTransform(); });
splatRotYInput.addEventListener('input', () => { splatRotYDisplay.textContent = splatRotYInput.value + '°'; applySplatTransform(); });
splatRotZInput.addEventListener('input', () => { splatRotZDisplay.textContent = splatRotZInput.value + '°'; applySplatTransform(); });
splatScaleInput.addEventListener('input', () => { splatScaleDisplay.textContent = splatScaleInput.value; applySplatTransform(); });
splatTransXInput.addEventListener('input', applySplatTransform);
splatTransYInput.addEventListener('input', applySplatTransform);
splatTransZInput.addEventListener('input', applySplatTransform);


renderer.domElement.addEventListener('click', () => {
    if (!movingAC || !acGroup.visible) return;
    moveACButton.classList.remove('clicked');
    movingAC = false;
    controls.enabled = true;
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
