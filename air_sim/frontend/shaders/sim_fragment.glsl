precision mediump float;

uniform float uMaxSpeed;

in float vSpeed;

void main() {
    float t = clamp(vSpeed / uMaxSpeed, 0.0, 1.0);
    gl_FragColor = vec4(t, 0.0, 1.0 - t, t * 0.8);
}
