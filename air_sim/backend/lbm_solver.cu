#include "lbm_solver.h"
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

// 19 Valid directions
static constexpr int Q = 19;

// All Directions
static constexpr int EX[Q] = { 0, 1,-1, 0, 0, 0, 0, 1,-1, 1,-1, 1,-1, 1,-1, 0, 0, 0, 0 };
static constexpr int EY[Q] = { 0, 0, 0, 1,-1, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0, 1,-1, 1,-1 };
static constexpr int EZ[Q] = { 0, 0, 0, 0, 0, 1,-1, 0, 0, 0, 0, 1,-1,-1, 1, 1,-1,-1, 1 };

// Weights for directions
static constexpr float W[Q] = {
    1.f/3.f,
    1.f/18.f, 1.f/18.f,
    1.f/18.f, 1.f/18.f,
    1.f/18.f, 1.f/18.f,
    1.f/36.f, 1.f/36.f,
    1.f/36.f, 1.f/36.f,
    1.f/36.f, 1.f/36.f,
    1.f/36.f, 1.f/36.f,
    1.f/36.f, 1.f/36.f,
    1.f/36.f, 1.f/36.f
};

// Look up pairs for the opposite direction for each direction defined
static constexpr int OPP[Q] = { 0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17 };

__constant__ int   d_EX[Q];
__constant__ int   d_EY[Q];
__constant__ int   d_EZ[Q];
__constant__ float d_W[Q];
__constant__ int   d_OPP[Q];

static void upload_constants() {
    cudaMemcpyToSymbol(d_EX,  EX,  Q * sizeof(int));
    cudaMemcpyToSymbol(d_EY,  EY,  Q * sizeof(int));
    cudaMemcpyToSymbol(d_EZ,  EZ,  Q * sizeof(int));
    cudaMemcpyToSymbol(d_W,   W,   Q * sizeof(float));
    cudaMemcpyToSymbol(d_OPP, OPP, Q * sizeof(int));
}

// Grid to 2d (cells)
__device__ __forceinline__
int d_cell_idx(int x, int y, int z, int Nx, int Ny) {
    return z * Nx * Ny + y * Nx + x;
}

// Grid to 2d (directions)
__device__ __forceinline__
int d_f_idx(int q, int x, int y, int z, int Nx, int Ny, int Nz) {
    return q * (Nx * Ny * Nz) + z * Nx * Ny + y * Nx + x;
}

__device__ __forceinline__
float d_feq(int q, float rho, float ux, float uy, float uz) {
    constexpr float cs2     = 1.f / 3.f;
    constexpr float inv_cs2 = 3.f;
    constexpr float inv_cs4 = 9.f / 2.f;
    float eu = d_EX[q] * ux + d_EY[q] * uy + d_EZ[q] * uz;
    float uu = ux * ux + uy * uy + uz * uz;
    return d_W[q] * rho * (1.f + eu * inv_cs2 + eu * eu * inv_cs4 - uu / (2.f * cs2));
}


__global__ void init_kernel(float* f_curr, const uint8_t* cell_type,
                             int Nx, int Ny, int Nz) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    int z = blockIdx.z * blockDim.z + threadIdx.z;
    if (x >= Nx || y >= Ny || z >= Nz) return;

    int ci = d_cell_idx(x, y, z, Nx, Ny);
    if (cell_type[ci] == 1) return; // Solid: leave zero

    for (int q = 0; q < Q; q++) {
        int fi = d_f_idx(q, x, y, z, Nx, Ny, Nz);
        f_curr[fi] = d_feq(q, 1.f, 0.f, 0.f, 0.f);
    }
}

// Iterates all the cells towards equilibrium unless the cell is solid
__global__ void collide_kernel(const float* __restrict__ f_curr,
                                float* __restrict__ f_next,
                                const uint8_t* __restrict__ cell_type,
                                int Nx, int Ny, int Nz, float inv_tau) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    int z = blockIdx.z * blockDim.z + threadIdx.z;
    if (x >= Nx || y >= Ny || z >= Nz) return;

    int ci = d_cell_idx(x, y, z, Nx, Ny);
    uint8_t ct = cell_type[ci];
    if (ct == 1) return; // Solid

    float f[Q];
    for (int q = 0; q < Q; q++)
        f[q] = f_curr[d_f_idx(q, x, y, z, Nx, Ny, Nz)];

    float rho = 0.f, ux = 0.f, uy = 0.f, uz = 0.f;
    for (int q = 0; q < Q; q++) {
        rho += f[q];
        ux  += d_EX[q] * f[q];
        uy  += d_EY[q] * f[q];
        uz  += d_EZ[q] * f[q];
    }
    float inv_rho = 1.f / rho;
    ux *= inv_rho; uy *= inv_rho; uz *= inv_rho;

    for (int q = 0; q < Q; q++) {
        float feq = d_feq(q, rho, ux, uy, uz);
        f_next[d_f_idx(q, x, y, z, Nx, Ny, Nz)] = f[q] - inv_tau * (f[q] - feq);
    }
}


// Move particle populations to neighboring grids based on velocity. If the destination cell is solid turn the velocity around
__global__ void stream_kernel(const float* __restrict__ f_next,
                               float* __restrict__ f_curr,
                               const uint8_t* __restrict__ cell_type,
                               int Nx, int Ny, int Nz) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    int z = blockIdx.z * blockDim.z + threadIdx.z;
    if (x >= Nx || y >= Ny || z >= Nz) return;

    int ci = d_cell_idx(x, y, z, Nx, Ny);
    uint8_t ct = cell_type[ci];
    if (ct == 1) return; // Solid

    for (int q = 0; q < Q; q++) {
        float fq = f_next[d_f_idx(q, x, y, z, Nx, Ny, Nz)];
        int nx = x + d_EX[q];
        int ny = y + d_EY[q];
        int nz = z + d_EZ[q];

        bool oob = (nx < 0 || nx >= Nx || ny < 0 || ny >= Ny || nz < 0 || nz >= Nz);
        bool solid = !oob && (cell_type[d_cell_idx(nx, ny, nz, Nx, Ny)] == 1);

        if (!oob && !solid) {
            f_curr[d_f_idx(q, nx, ny, nz, Nx, Ny, Nz)] = fq;
        } else {
            // Bounce-back: reflect back into source cell, opposite direction
            f_curr[d_f_idx(d_OPP[q], x, y, z, Nx, Ny, Nz)] = fq;
        }
    }
}

// CUDA error helper
static void cuda_check(cudaError_t err, const char* msg) {
    if (err != cudaSuccess)
        throw std::runtime_error(std::string(msg) + ": " + cudaGetErrorString(err));
}


// Create the grid and initialize
LBMSolver::LBMSolver(const Mesh& mesh, const ACUnitData& ac,
                     int resolution, float tau)
    : tau_(tau) {
    compute_aabb(mesh);

    float lx = aabb_.max_x - aabb_.min_x;
    float ly = aabb_.max_y - aabb_.min_y;
    float lz = aabb_.max_z - aabb_.min_z;
    float longest = std::max({lx, ly, lz});
    voxel_size_ = longest / static_cast<float>(resolution);

    Nx_ = static_cast<int>(std::ceil(lx / voxel_size_));
    Ny_ = static_cast<int>(std::ceil(ly / voxel_size_));
    Nz_ = static_cast<int>(std::ceil(lz / voxel_size_));

    h_cell_type_.assign(static_cast<size_t>(Nx_) * Ny_ * Nz_, CellType::Fluid);

    voxelize(mesh);
    mark_ac_voxels(ac);
    init_device_memory();
    build_measurements();
}

LBMSolver::~LBMSolver() {
    if (d_f_curr_)    cudaFree(d_f_curr_);
    if (d_f_next_)    cudaFree(d_f_next_);
    if (d_cell_type_) cudaFree(d_cell_type_);
}

void LBMSolver::compute_aabb(const Mesh& mesh) {
    if (mesh.vertices.empty())
        throw std::runtime_error("mesh has no vertices");

    aabb_.min_x = aabb_.max_x = mesh.vertices[0];
    aabb_.min_y = aabb_.max_y = mesh.vertices[1];
    aabb_.min_z = aabb_.max_z = mesh.vertices[2];

    for (size_t i = 0; i + 2 < mesh.vertices.size(); i += 3) {
        float vx = mesh.vertices[i];
        float vy = mesh.vertices[i + 1];
        float vz = mesh.vertices[i + 2];
        aabb_.min_x = std::min(aabb_.min_x, vx);
        aabb_.min_y = std::min(aabb_.min_y, vy);
        aabb_.min_z = std::min(aabb_.min_z, vz);
        aabb_.max_x = std::max(aabb_.max_x, vx);
        aabb_.max_y = std::max(aabb_.max_y, vy);
        aabb_.max_z = std::max(aabb_.max_z, vz);
    }
}

bool LBMSolver::ray_triangle(float ox, float oy, float oz,
                              float dx, float dy, float dz,
                              float ax, float ay, float az,
                              float bx, float by, float bz,
                              float cx, float cy, float cz,
                              float& t) const {
    constexpr float EPS = 1e-7f;
    float e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    float e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    float hx = dy * e2z - dz * e2y;
    float hy = dz * e2x - dx * e2z;
    float hz = dx * e2y - dy * e2x;

    float a_det = e1x * hx + e1y * hy + e1z * hz;
    if (std::abs(a_det) < EPS) return false;

    float f = 1.f / a_det;
    float sx = ox - ax, sy = oy - ay, sz = oz - az;
    float u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0.f || u > 1.f) return false;

    float qx = sy * e1z - sz * e1y;
    float qy = sz * e1x - sx * e1z;
    float qz = sx * e1y - sy * e1x;
    float v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0.f || u + v > 1.f) return false;

    t = f * (e2x * qx + e2y * qy + e2z * qz);
    return t > EPS;
}

// Calculate inside and outside voxels for watertight mesh
void LBMSolver::voxelize(const Mesh& mesh) {
    uint32_t tri_count = static_cast<uint32_t>(mesh.faces.size() / 3);

    for (int iy = 0; iy < Ny_; iy++) {
        float wy = aabb_.min_y + (iy + 0.5f) * voxel_size_;
        for (int iz = 0; iz < Nz_; iz++) {
            float wz = aabb_.min_z + (iz + 0.5f) * voxel_size_;

            // Ray from just outside AABB in +X direction
            float ray_ox = aabb_.min_x - voxel_size_;
            float ray_oy = wy;
            float ray_oz = wz;

            std::vector<float> hits;
            hits.reserve(16);

            for (uint32_t fi = 0; fi < tri_count; fi++) {
                uint32_t ai = mesh.faces[fi * 3 + 0] * 3;
                uint32_t bi = mesh.faces[fi * 3 + 1] * 3;
                uint32_t ci = mesh.faces[fi * 3 + 2] * 3;
                float t;
                if (ray_triangle(
                        ray_ox, ray_oy, ray_oz,
                        1.f, 0.f, 0.f,
                        mesh.vertices[ai], mesh.vertices[ai+1], mesh.vertices[ai+2],
                        mesh.vertices[bi], mesh.vertices[bi+1], mesh.vertices[bi+2],
                        mesh.vertices[ci], mesh.vertices[ci+1], mesh.vertices[ci+2],
                        t)) {
                    hits.push_back(t);
                }
            }

            std::sort(hits.begin(), hits.end());

            bool inside = false;
            size_t hit_idx = 0;

            for (int ix = 0; ix < Nx_; ix++) {
                float wx = aabb_.min_x + (ix + 0.5f) * voxel_size_;
                float t_cell = wx - ray_ox; // ray dir is +X, so t = x distance

                while (hit_idx < hits.size() && hits[hit_idx] < t_cell) {
                    inside = !inside;
                    hit_idx++;
                }

                if (!inside) {
                    h_cell_type_[cell_idx(ix, iy, iz)] = CellType::Solid;
                }
            }
        }
    }
}


// Create AC voxels
void LBMSolver::mark_ac_voxels(const ACUnitData& ac) {
    constexpr float SPEED_SCALE = 0.05f; // max lattice speed (Ma < 0.1)

    emitter_vx_ = ac.out_vel.x * SPEED_SCALE;
    emitter_vy_ = ac.out_vel.y * SPEED_SCALE;
    emitter_vz_ = ac.out_vel.z * SPEED_SCALE;

    // intake_vx_ = ac.in_vel.x * SPEED_SCALE;
    // intake_vy_ = ac.in_vel.y * SPEED_SCALE;
    // intake_vz_ = ac.in_vel.z * SPEED_SCALE;

    // Find nearest fluid voxel to ac position
    auto find_nearest_fluid = [&](float wx, float wy, float wz, int& gx, int& gy, int& gz) {
        int cx, cy, cz;
        world_to_grid(wx, wy, wz, cx, cy, cz);
        cx = std::clamp(cx, 0, Nx_-1);
        cy = std::clamp(cy, 0, Ny_-1);
        cz = std::clamp(cz, 0, Nz_-1);

        if (h_cell_type_[cell_idx(cx, cy, cz)] == CellType::Fluid) {
            gx = cx; gy = cy; gz = cz;
            return;
        }
        // Search expanding cube of radius up to 3
        int best_x = cx, best_y = cy, best_z = cz;
        int best_r2 = INT_MAX;
        for (int r = 1; r <= 3; r++) {
            for (int dz = -r; dz <= r; dz++)
            for (int dy = -r; dy <= r; dy++)
            for (int dx = -r; dx <= r; dx++) {
                int nx2 = cx+dx, ny2 = cy+dy, nz2 = cz+dz;
                if (nx2 < 0 || nx2 >= Nx_ || ny2 < 0 || ny2 >= Ny_ || nz2 < 0 || nz2 >= Nz_) continue;
                if (h_cell_type_[cell_idx(nx2, ny2, nz2)] != CellType::Fluid) continue;
                int r2 = dx*dx + dy*dy + dz*dz;
                if (r2 < best_r2) { best_r2 = r2; best_x = nx2; best_y = ny2; best_z = nz2; }
            }
            if (best_r2 != INT_MAX) break;
        }
        gx = best_x; gy = best_y; gz = best_z;
    };

    find_nearest_fluid(ac.placement.x, ac.placement.y, ac.placement.z, emit_x_, emit_y_, emit_z_);
    // find_nearest_fluid(ac.placement.x, ac.placement.y, ac.placement.z, intake_x_, intake_y_, intake_z_);

    h_cell_type_[cell_idx(emit_x_, emit_y_, emit_z_)] = CellType::Emitter;
    // h_cell_type_[cell_idx(intake_x_, intake_y_, intake_z_)] = CellType::Intake;
}

// Allocates memory for GPU
void LBMSolver::init_device_memory() {
    upload_constants();

    size_t n_cells = static_cast<size_t>(Nx_) * Ny_ * Nz_;
    size_t n_f     = static_cast<size_t>(Q) * n_cells;

    cuda_check(cudaMalloc(&d_f_curr_,    n_f * sizeof(float)),     "cudaMalloc d_f_curr");
    cuda_check(cudaMalloc(&d_f_next_,    n_f * sizeof(float)),     "cudaMalloc d_f_next");
    cuda_check(cudaMalloc(&d_cell_type_, n_cells * sizeof(uint8_t)), "cudaMalloc d_cell_type");

    cuda_check(cudaMemset(d_f_curr_, 0, n_f * sizeof(float)),     "memset d_f_curr");
    cuda_check(cudaMemset(d_f_next_, 0, n_f * sizeof(float)),     "memset d_f_next");

    cuda_check(cudaMemcpy(d_cell_type_, h_cell_type_.data(),
                          n_cells * sizeof(uint8_t),
                          cudaMemcpyHostToDevice), "upload cell_type");

    dim3 block(8, 8, 4);
    dim3 grid((Nx_+7)/8, (Ny_+7)/8, (Nz_+3)/4);
    init_kernel<<<grid, block>>>(d_f_curr_, d_cell_type_, Nx_, Ny_, Nz_);
    cuda_check(cudaDeviceSynchronize(), "init_kernel sync");
}


// Get the values out
void LBMSolver::build_measurements() {
    measurements_.clear();
    for (int z = 0; z < Nz_; z++)
    for (int y = 0; y < Ny_; y++)
    for (int x = 0; x < Nx_; x++) {
        if (h_cell_type_[cell_idx(x, y, z)] != CellType::Fluid) continue;
        auto [wx, wy, wz] = grid_to_world(x, y, z);
        measurements_.push_back({wx, wy, wz, 0.f, 0.f, 0.f, 0.f, 1.f, x, y, z});
    }
}


// Zou-He for spots were we have a known velocity but want to conserve momentum
static void apply_zouhe(float* f, float ux, float uy, float uz) {
    // Determine dominant axis
    float ax = std::abs(ux), ay = std::abs(uy), az = std::abs(uz);
    int axis = (ax >= ay && ax >= az) ? 0 : (ay >= az ? 1 : 2);
    float sign = (axis == 0) ? (ux >= 0 ? 1.f : -1.f)
               : (axis == 1) ? (uy >= 0 ? 1.f : -1.f)
                             : (uz >= 0 ? 1.f : -1.f);
    float u_n = (axis == 0) ? ux : (axis == 1) ? uy : uz;

    // The full D3Q19 Zou-He for +X face (rho unknown, ux known):
    // rho = (f0+f3+f4+f5+f6+f15+f16+f17+f18 + 2*(f2+f8+f10+f12+f14)) / (1 - ux)
    // f1  = f2  + (2/3)*rho*ux
    // f7  = f8  + (1/6)*rho*ux - 0.5*(f3-f4) + 0.5*rho*uy
    // f9  = f10 + (1/6)*rho*ux + 0.5*(f3-f4) - 0.5*rho*uy
    // f11 = f12 + (1/6)*rho*ux - 0.5*(f5-f6) + 0.5*rho*uz
    // f13 = f14 + (1/6)*rho*ux + 0.5*(f5-f6) - 0.5*rho*uz

    // Map so that axis 'axis' with sign 'sign' looks like the +X face:
    // We permute (ux,uy,uz) into (u_normal, u_t1, u_t2) and select correct indices.

    // For generality, encode axis combinations. Face index 0..5 = ±X,±Y,±Z
    int face = axis * 2 + (sign < 0 ? 1 : 0); // 0=+X,1=-X,2=+Y,3=-Y,4=+Z,5=-Z

    // Transverse velocity components per face
    float ut1, ut2;
    switch (face) {
    case 0: ut1 = uy; ut2 = uz; break; // +X: t1=Y t2=Z
    case 1: ut1 = uy; ut2 = uz; break; // -X
    case 2: ut1 = ux; ut2 = uz; break; // +Y: t1=X t2=Z
    case 3: ut1 = ux; ut2 = uz; break; // -Y
    case 4: ut1 = ux; ut2 = uy; break; // +Z: t1=X t2=Y
    case 5: ut1 = ux; ut2 = uy; break; // -Z
    default: ut1 = ut2 = 0.f;
    }

    // Known distributions per face (q-indices of distributions pointing AWAY from face,
    // i.e., the ones we know after streaming), and unknown (pointing INTO face).
    float rho;
    switch (face) {
    case 0: { // +X: flow in +X direction, unknown: q=1,7,9,11,13
        float sum_known = f[0]+f[3]+f[4]+f[5]+f[6]+f[15]+f[16]+f[17]+f[18]
                        + 2.f*(f[2]+f[8]+f[10]+f[12]+f[14]);
        rho = sum_known / (1.f - u_n);
        f[1]  = f[2]  + (2.f/3.f)*rho*u_n;
        f[7]  = f[8]  + (1.f/6.f)*rho*u_n - 0.5f*(f[3]-f[4])  + 0.5f*rho*ut1;
        f[9]  = f[10] + (1.f/6.f)*rho*u_n + 0.5f*(f[3]-f[4])  - 0.5f*rho*ut1;
        f[11] = f[12] + (1.f/6.f)*rho*u_n - 0.5f*(f[5]-f[6])  + 0.5f*rho*ut2;
        f[13] = f[14] + (1.f/6.f)*rho*u_n + 0.5f*(f[5]-f[6])  - 0.5f*rho*ut2;
        break;
    }
    case 1: { // -X: flow in -X direction, unknown: q=2,8,10,12,14
        float sum_known = f[0]+f[3]+f[4]+f[5]+f[6]+f[15]+f[16]+f[17]+f[18]
                        + 2.f*(f[1]+f[7]+f[9]+f[11]+f[13]);
        rho = sum_known / (1.f + u_n); // u_n < 0
        f[2]  = f[1]  - (2.f/3.f)*rho*u_n;
        f[8]  = f[7]  - (1.f/6.f)*rho*u_n + 0.5f*(f[3]-f[4])  - 0.5f*rho*ut1;
        f[10] = f[9]  - (1.f/6.f)*rho*u_n - 0.5f*(f[3]-f[4])  + 0.5f*rho*ut1;
        f[12] = f[11] - (1.f/6.f)*rho*u_n + 0.5f*(f[5]-f[6])  - 0.5f*rho*ut2;
        f[14] = f[13] - (1.f/6.f)*rho*u_n - 0.5f*(f[5]-f[6])  + 0.5f*rho*ut2;
        break;
    }
    case 2: { // +Y: unknown: q=3,7,10,15,17
        float sum_known = f[0]+f[1]+f[2]+f[5]+f[6]+f[11]+f[12]+f[13]+f[14]
                        + 2.f*(f[4]+f[8]+f[9]+f[16]+f[18]);
        rho = sum_known / (1.f - u_n);
        f[3]  = f[4]  + (2.f/3.f)*rho*u_n;
        f[7]  = f[9]  + (1.f/6.f)*rho*u_n - 0.5f*(f[1]-f[2])  + 0.5f*rho*ut1;
        f[10] = f[8]  + (1.f/6.f)*rho*u_n + 0.5f*(f[1]-f[2])  - 0.5f*rho*ut1;
        f[15] = f[16] + (1.f/6.f)*rho*u_n - 0.5f*(f[5]-f[6])  + 0.5f*rho*ut2;
        f[17] = f[18] + (1.f/6.f)*rho*u_n + 0.5f*(f[5]-f[6])  - 0.5f*rho*ut2;
        break;
    }
    case 3: { // -Y: unknown: q=4,8,9,16,18
        float sum_known = f[0]+f[1]+f[2]+f[5]+f[6]+f[11]+f[12]+f[13]+f[14]
                        + 2.f*(f[3]+f[7]+f[10]+f[15]+f[17]);
        rho = sum_known / (1.f + u_n);
        f[4]  = f[3]  - (2.f/3.f)*rho*u_n;
        f[8]  = f[10] - (1.f/6.f)*rho*u_n + 0.5f*(f[1]-f[2])  - 0.5f*rho*ut1;
        f[9]  = f[7]  - (1.f/6.f)*rho*u_n - 0.5f*(f[1]-f[2])  + 0.5f*rho*ut1;
        f[16] = f[15] - (1.f/6.f)*rho*u_n + 0.5f*(f[5]-f[6])  - 0.5f*rho*ut2;
        f[18] = f[17] - (1.f/6.f)*rho*u_n - 0.5f*(f[5]-f[6])  + 0.5f*rho*ut2;
        break;
    }
    case 4: { // +Z: unknown: q=5,11,14,15,18
        float sum_known = f[0]+f[1]+f[2]+f[3]+f[4]+f[7]+f[8]+f[9]+f[10]
                        + 2.f*(f[6]+f[12]+f[13]+f[16]+f[17]);
        rho = sum_known / (1.f - u_n);
        f[5]  = f[6]  + (2.f/3.f)*rho*u_n;
        f[11] = f[12] + (1.f/6.f)*rho*u_n - 0.5f*(f[1]-f[2])  + 0.5f*rho*ut1;
        f[14] = f[13] + (1.f/6.f)*rho*u_n + 0.5f*(f[1]-f[2])  - 0.5f*rho*ut1;
        f[15] = f[16] + (1.f/6.f)*rho*u_n - 0.5f*(f[3]-f[4])  + 0.5f*rho*ut2;
        f[18] = f[17] + (1.f/6.f)*rho*u_n + 0.5f*(f[3]-f[4])  - 0.5f*rho*ut2;
        break;
    }
    case 5: { // -Z: unknown: q=6,12,13,16,17
        float sum_known = f[0]+f[1]+f[2]+f[3]+f[4]+f[7]+f[8]+f[9]+f[10]
                        + 2.f*(f[5]+f[11]+f[14]+f[15]+f[18]);
        rho = sum_known / (1.f + u_n);
        f[6]  = f[5]  - (2.f/3.f)*rho*u_n;
        f[12] = f[11] - (1.f/6.f)*rho*u_n + 0.5f*(f[1]-f[2])  - 0.5f*rho*ut1;
        f[13] = f[14] - (1.f/6.f)*rho*u_n - 0.5f*(f[1]-f[2])  + 0.5f*rho*ut1;
        f[16] = f[15] - (1.f/6.f)*rho*u_n + 0.5f*(f[3]-f[4])  - 0.5f*rho*ut2;
        f[17] = f[18] - (1.f/6.f)*rho*u_n - 0.5f*(f[3]-f[4])  + 0.5f*rho*ut2;
        break;
    }
    }
}

void LBMSolver::apply_boundary_conditions_cpu() {
    size_t n_cells = static_cast<size_t>(Nx_) * Ny_ * Nz_;

    auto reset_to_equil = [&](int x, int y, int z, float vx, float vy, float vz) {
        constexpr float cs2     = 1.f / 3.f;
        constexpr float inv_cs2 = 3.f;
        constexpr float inv_cs4 = 9.f / 2.f;
        float uu = vx*vx + vy*vy + vz*vz;
        for (int q = 0; q < Q; q++) {
            float eu = EX[q]*vx + EY[q]*vy + EZ[q]*vz;
            float fval = W[q] * (1.f + eu*inv_cs2 + eu*eu*inv_cs4 - uu/(2.f*cs2));
            size_t fi = static_cast<size_t>(q) * n_cells + static_cast<size_t>(cell_idx(x, y, z));
            cudaMemcpy(d_f_curr_ + fi, &fval, sizeof(float), cudaMemcpyHostToDevice);
        }
    };

    reset_to_equil(emit_x_, emit_y_, emit_z_, emitter_vx_, emitter_vy_, emitter_vz_);
    // reset_to_equil(intake_x_, intake_y_, intake_z_, intake_vx_, intake_vy_, intake_vz_);
}


// Copy measurements from gpu to cpu. Main bottleneck
void LBMSolver::update_measurements() {
    size_t n_cells = static_cast<size_t>(Nx_) * Ny_ * Nz_;

    for (auto& m : measurements_) {
        float f[Q];
        for (int q = 0; q < Q; q++) {
            size_t fi = static_cast<size_t>(q) * n_cells
                      + static_cast<size_t>(cell_idx(m.grid_x, m.grid_y, m.grid_z));
            cudaMemcpy(&f[q], d_f_curr_ + fi, sizeof(float), cudaMemcpyDeviceToHost);
        }

        float rho = 0.f, ux = 0.f, uy = 0.f, uz = 0.f;
        for (int q = 0; q < Q; q++) {
            rho += f[q];
            ux  += EX[q] * f[q];
            uy  += EY[q] * f[q];
            uz  += EZ[q] * f[q];
        }
        if (rho > 1e-10f) { ux /= rho; uy /= rho; uz /= rho; }

        m.vel_x   = ux;
        m.vel_y   = uy;
        m.vel_z   = uz;
        m.speed   = std::sqrt(ux*ux + uy*uy + uz*uz);
        m.density = rho;
    }
}

// Main loop
void LBMSolver::step() {
    float inv_tau = 1.f / tau_;

    dim3 block(8, 8, 4);
    dim3 grid((Nx_+7)/8, (Ny_+7)/8, (Nz_+3)/4);

    collide_kernel<<<grid, block>>>(d_f_curr_, d_f_next_, d_cell_type_, Nx_, Ny_, Nz_, inv_tau);
    stream_kernel <<<grid, block>>>(d_f_next_,  d_f_curr_, d_cell_type_, Nx_, Ny_, Nz_);
    cuda_check(cudaDeviceSynchronize(), "step sync");

    apply_boundary_conditions_cpu();
    update_measurements();
}
