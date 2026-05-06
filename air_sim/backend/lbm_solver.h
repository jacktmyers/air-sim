#pragma once

#include "mesh_data.h"
#include "config.h"
#include <vector>
#include <array>
#include <cstdint>

struct AABB {
    float min_x, min_y, min_z;
    float max_x, max_y, max_z;
};

enum class CellType : uint8_t { Fluid = 0, Solid = 1, Emitter = 2, Intake = 3 };

struct Measurement {
    float world_x, world_y, world_z;
    float vel_x, vel_y, vel_z;
    float speed;
    float density;
    int grid_x, grid_y, grid_z;
};

class LBMSolver {
public:
    LBMSolver(const Mesh& mesh, const ACUnitData& ac,
              int resolution,
              float tau = 0.6f);
    ~LBMSolver();

    LBMSolver(const LBMSolver&) = delete;
    LBMSolver& operator=(const LBMSolver&) = delete;

    void step();
    const std::vector<Measurement>& measurements() const { return measurements_; }

    int nx() const { return Nx_; }
    int ny() const { return Ny_; }
    int nz() const { return Nz_; }
    float voxel_size() const { return voxel_size_; }

    CellType cell_type(int x, int y, int z) const {
        return h_cell_type_[cell_idx(x, y, z)];
    }

    std::array<float, 3> grid_to_world(int x, int y, int z) const {
        return {
            aabb_.min_x + (x + 0.5f) * voxel_size_,
            aabb_.min_y + (y + 0.5f) * voxel_size_,
            aabb_.min_z + (z + 0.5f) * voxel_size_
        };
    }

    bool world_to_grid(float wx, float wy, float wz, int& gx, int& gy, int& gz) const {
        gx = static_cast<int>((wx - aabb_.min_x) / voxel_size_);
        gy = static_cast<int>((wy - aabb_.min_y) / voxel_size_);
        gz = static_cast<int>((wz - aabb_.min_z) / voxel_size_);
        return gx >= 0 && gx < Nx_ && gy >= 0 && gy < Ny_ && gz >= 0 && gz < Nz_;
    }

private:
    int Nx_, Ny_, Nz_;
    float voxel_size_;
    AABB aabb_;

    float tau_;

    std::vector<CellType> h_cell_type_;

    int emit_x_, emit_y_, emit_z_;
    int intake_x_, intake_y_, intake_z_;
    float emitter_vx_, emitter_vy_, emitter_vz_;
    float intake_vx_,  intake_vy_,  intake_vz_;

    float* d_f_curr_    = nullptr;
    float* d_f_next_    = nullptr;
    uint8_t* d_cell_type_ = nullptr;

    std::vector<Measurement> measurements_;

    void compute_aabb(const Mesh& mesh);
    void voxelize(const Mesh& mesh);
    void mark_ac_voxels(const ACUnitData& ac);
    void init_device_memory();
    void build_measurements();
    void apply_boundary_conditions_cpu();
    void update_measurements();

    bool ray_triangle(float ox, float oy, float oz,
                      float dx, float dy, float dz,
                      float ax, float ay, float az,
                      float bx, float by, float bz,
                      float cx, float cy, float cz,
                      float& t) const;

    inline int cell_idx(int x, int y, int z) const {
        return z * Nx_ * Ny_ + y * Nx_ + x;
    }
};
