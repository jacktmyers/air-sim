attribute vec3 splatPosition;
attribute vec3 splatColor;
attribute float splatOpacity;
attribute vec3 splatScale;
attribute vec4 splatRot;

uniform vec2 viewport;

varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;

mat3 quatToMat3(vec4 q) {
    float w = q.x, x = q.y, y = q.z, z = q.w;
    return mat3(
        1.0-2.0*(y*y+z*z), 2.0*(x*y+w*z),    2.0*(x*z-w*y),
        2.0*(x*y-w*z),     1.0-2.0*(x*x+z*z), 2.0*(y*z+w*x),
        2.0*(x*z+w*y),     2.0*(y*z-w*x),    1.0-2.0*(x*x+y*y)
    );
}

void main() {
    vec4 camPos4 = modelViewMatrix * vec4(splatPosition, 1.0);
    vec3 camPos  = camPos4.xyz;

    // Cull splats behind the camera
    if (camPos.z > 0.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // Build 3D covariance: Sigma = (R*S) * (R*S)^T
    mat3 R = quatToMat3(splatRot);
    vec3 s = exp(splatScale);
    mat3 M = mat3(R[0]*s.x, R[1]*s.y, R[2]*s.z);
    mat3 Sigma = M * transpose(M);

    // Project 3D covariance to 2D screen space via EWA Jacobian
    float z  = camPos.z;
    float fx = projectionMatrix[0][0] * viewport.x * 0.5;
    float fy = projectionMatrix[1][1] * viewport.y * 0.5;

    mat3 J = mat3(
        fx/z,  0.0,   0.0,
        0.0,   fy/z,  0.0,
        -fx*camPos.x/(z*z), -fy*camPos.y/(z*z), 0.0
    );
    mat3 W    = mat3(modelViewMatrix);
    mat3 T    = J * W;
    mat3 cov2 = T * Sigma * transpose(T);

    // Extract upper-left 2x2 and add low-pass filter to avoid aliasing
    float a = cov2[0][0] + 0.3;
    float b = cov2[1][0];
    float c = cov2[1][1] + 0.3;

    // Eigendecomposition of the 2x2 covariance
    float mid   = (a + c) * 0.5;
    float disc  = sqrt(max(0.1, (a - c)*(a - c)*0.25 + b*b));
    float lam1  = mid + disc;
    float lam2  = max(mid - disc, 0.0);

    // Eigenvector axes scaled to 3-sigma extent in screen pixels
    vec2 ev = vec2(b, lam1 - a);
    vec2 v1dir = (dot(ev, ev) < 1e-8) ? vec2(1.0, 0.0) : normalize(ev);
    vec2 v2dir = vec2(-v1dir.y, v1dir.x);
    vec2 v1 = v1dir * min(3.0 * sqrt(lam1), 2048.0);
    vec2 v2 = v2dir * min(3.0 * sqrt(lam2), 2048.0);

    // Offset base quad corner from projected splat center
    vec2 quadCorner = position.xy;
    vec2 ndcOffset  = (quadCorner.x * v1 + quadCorner.y * v2) * (2.0 / viewport);
    vec4 proj       = projectionMatrix * camPos4;
    proj.xy        += ndcOffset * proj.w;

    vUv     = quadCorner;
    vColor  = splatColor;
    vOpacity = splatOpacity;
    gl_Position = proj;
}
