import { renderer, scene, camera, controls, updateWalkthrough, walkthroughMode, shaderMaterials } from './render.js';
import { simState } from './simulation.js';
import { updateSimPoints, sortSplats, updateSimArrows } from './render.js';
import { connectMeshWebSocket, connectSplatWebSocket } from './connection.js';
import './ui.js';

// Render loop
function animate() {
    requestAnimationFrame(animate);
    if (!walkthroughMode) controls.update();
    updateWalkthrough();
    updateSimPoints(simState.frameData);
    updateSimArrows(simState.positions, simState.frameData);
    sortSplats();
    for(const mat of shaderMaterials) {
        if(mat.uniforms.uCameraPos)
            mat.uniforms.uCameraPos.value.copy(camera.position);
    }
    renderer.render(scene, camera);
}

connectMeshWebSocket();
connectSplatWebSocket();
animate();
