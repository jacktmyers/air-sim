// attribute float speed;

// out float vSpeed;

// void main() {
//     vSpeed = speed;
//     gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
//     gl_PointSize = 20.0;
// }

attribute float speed;

uniform float uMaxSpeed;
uniform float uPointSize;

varying float vSpeedNorm;

void main() {
    vSpeedNorm = clamp(speed / max(uMaxSpeed, 0.0001), 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    gl_PointSize = uPointSize * (1.0 + vSpeedNorm * 1.5);

    // perspective size falloff
    gl_PointSize *= 1.0 / max(-mvPosition.z * 0.15, 0.25);

    gl_Position = projectionMatrix * mvPosition;
}