#pragma once
#include <glm/glm.hpp>

struct ACUnitData {
    glm::vec3 placement;
    glm::vec3 out_vel;
    glm::vec3 in_vel;
};

struct SimData {
    int resolution;
    float tau;
    int warmup_steps;
};

struct Config {
    ACUnitData ac_placement;
    SimData sim_data;
};
