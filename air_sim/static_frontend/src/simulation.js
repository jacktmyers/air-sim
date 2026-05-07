export const simConfig = {
    ac_placement: {
        placement: [0, 0, 0],
        out_vel:   [0, 0, 0],
        in_vel:    [0, 0, 0],
    },
    sim_data: {
        resolution: 64,
        tau: 0.6,
        warmup_steps: 0,
    }
};

export const simState = {
    running: false,
    positions: null,
    frameData: null,
    ws: null,
};
