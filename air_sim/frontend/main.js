import { renderer, scene, camera, controls, shaderMaterials } from './render.js';
import { simState } from './simulation.js';
import { updateSimPoints, updateSimArrows } from './render.js';
import { connectMeshWebSocket } from './connection.js';
import './ui.js';

// Render loop
function animate() {
    requestAnimationFrame(animate);

    for(const mat of shaderMaterials) {
        if(mat.uniforms.uCameraPos)
            mat.uniforms.uCameraPos.value.copy(camera.position);
    }

    controls.update();
    updateSimPoints(simState.frameData);
    updateSimArrows(simState.positions, simState.frameData);
    renderer.render(scene, camera);
}

connectMeshWebSocket();
animate();
