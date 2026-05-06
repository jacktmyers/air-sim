varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;

void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;

    // Gaussian falloff: at |vUv|=1 (3-sigma edge) value = exp(-4.5) ≈ 0.011
    float alpha = exp(-4.5 * r2) * vOpacity;
    if (alpha < 0.003) discard;

    gl_FragColor = vec4(vColor, alpha);
}
