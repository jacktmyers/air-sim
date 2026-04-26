attribute float speed;

out float vSpeed;

void main() {
    vSpeed = speed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 20.0;
}
