// precision mediump float;

// uniform float uMaxSpeed;

// in float vSpeed;

// void main() {
//     vec2 center = gl_PointCoord - vec2(0.5);
//     float distSq = dot(center, center);

//     if (distSq > 0.25) {
//         discard;
//     }

//     float t = clamp(vSpeed / uMaxSpeed, 0.0, 1.0);
//     gl_FragColor = vec4(t, 0.0, 1.0 - t, t * 0.8);
// }

precision highp float;

uniform float uOpacity;

varying float vSpeedNorm;

void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);

    if (r2 > 1.0) discard;

    // soft circular splat
    float alpha = exp(-r2 * 4.0);

    vec3 slowColor = vec3(0.0, 0.25, 1.0);
    vec3 fastColor = vec3(1.0, 0.15, 0.0);

    vec3 color = mix(slowColor, fastColor, vSpeedNorm);

    gl_FragColor = vec4(color, alpha * uOpacity * vSpeedNorm);
}