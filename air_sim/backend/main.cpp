#include "deps/crow/include/crow_all.h"
#include "mesh_data.h"
#include "sim_room.h"
#include "splat_data.h"
#include "config.h"
#include "lbm_solver.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <memory>
#include <mutex>
#include <set>
#include <chrono>
#include <cstring>

#define HOSTED_PORT 42067
#define MAX_FREQ 30.0f

Config sim_config = { {}, {64, 0.6f, 0} };
bool sim_config_set = false;

std::unique_ptr<LBMSolver> solver;
std::thread sim_thread;
std::atomic<bool> sim_running{false};

std::set<crow::websocket::connection*> sim_connections;
std::mutex connections_mutex;

// 0x01: [uint32 count][x,y,z per cell]
static std::string build_position_msg(const std::vector<Measurement>& ms) {
    uint32_t count = static_cast<uint32_t>(ms.size());
    std::string buf(1 + sizeof(uint32_t) + count * 3 * sizeof(float), '\0');
    char* p = buf.data();
    *p++ = 0x01;
    std::memcpy(p, &count, sizeof(uint32_t)); p += sizeof(uint32_t);
    for (const auto& m : ms) {
        std::memcpy(p, &m.world_x, sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.world_y, sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.world_z, sizeof(float)); p += sizeof(float);
    }
    return buf;
}

// 0x02: [vx,vy,vz,speed,rho per cell]
static std::string build_frame_msg(const std::vector<Measurement>& ms) {
    std::string buf(1 + ms.size() * 5 * sizeof(float), '\0');
    char* p = buf.data();
    *p++ = 0x02;
    for (const auto& m : ms) {
        std::memcpy(p, &m.vel_x,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.vel_y,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.vel_z,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.speed,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.density, sizeof(float)); p += sizeof(float);
    }
    return buf;
}

int main() {
    std::string port_string = std::to_string(HOSTED_PORT);
    
    std::vector<SimRoom> rooms = load_in_rooms(DATA_DIR);
    
    crow::App<crow::CORSHandler> app;
    auto& cors = app.get_middleware<crow::CORSHandler>();
    cors.global().origin("*").methods("POST"_method, "GET"_method, "OPTIONS"_method).headers("Content-Type");
    
    const Mesh& mesh = rooms.front().waterTight;
    const HorizontalAlignment& alignment = rooms.front().alignment;
    
    SplatData splat = load_splat_ply(std::filesystem::path(DATA_DIR) / "lab" / "splat.ply", alignment);
    std::string splat_msg = build_splat_msg(splat);
    
    nlohmann::json mesh_json = {
        {"vertices", mesh.vertices},
        {"colors", mesh.colors},
        {"faces", mesh.faces}
    };
    
    std::string mesh_data_str = mesh_json.dump();
    
    CROW_WEBSOCKET_ROUTE(app, "/mesh")
    .onopen([&](crow::websocket::connection& conn) {
        std::cout << "Client connected\n";
        conn.send_text(mesh_data_str);
    })
    .onclose([](crow::websocket::connection& conn, const std::string& reason, uint16_t) {
        std::cout << "Client disconnected: " << reason << "\n";
    });
    
    CROW_WEBSOCKET_ROUTE(app, "/splat")
    .onopen([&](crow::websocket::connection& conn) {
        conn.send_binary(splat_msg);
    })
    .onclose([](crow::websocket::connection&, const std::string&, uint16_t) {});
    
    CROW_WEBSOCKET_ROUTE(app, "/sim/data")
    .onopen([&](crow::websocket::connection& conn) {
        std::lock_guard<std::mutex> lock(connections_mutex);
        sim_connections.insert(&conn);
        std::cout << "Sim Data WS Connected" << std::endl;
    })
    .onclose([&](crow::websocket::connection& conn, const std::string&, uint16_t) {
        std::lock_guard<std::mutex> lock(connections_mutex);
        sim_connections.erase(&conn);
        if (sim_connections.empty() && sim_running) {
            std::thread([&]() {
                sim_running = false;
                if (sim_thread.joinable())
                sim_thread.join();
                solver.reset();
            }).detach();
        }
    })
    .onmessage([](crow::websocket::connection&, const std::string&, bool) {});
    
    app.route_dynamic("/configure")
    .methods("POST"_method)
    ([](const crow::request& req) {
        crow::response res(200);
        try {
            auto body = nlohmann::json::parse(req.body);
            auto ac = body.at("ac_placement");
            auto pl = ac.at("placement");
            auto ov = ac.at("out_vel");
            auto iv = ac.at("in_vel");
            sim_config.ac_placement.placement = { pl[0].get<float>(), pl[1].get<float>(), pl[2].get<float>() };
            sim_config.ac_placement.out_vel   = { ov[0].get<float>(), ov[1].get<float>(), ov[2].get<float>() };
            sim_config.ac_placement.in_vel          = { iv[0].get<float>(), iv[1].get<float>(), iv[2].get<float>() };
            
            if (body.contains("sim_data")) {
                auto sd = body.at("sim_data");
                sim_config.sim_data.resolution   = sd.value("resolution", 64);
                sim_config.sim_data.tau          = sd.value("tau", 0.6f);
                sim_config.sim_data.warmup_steps = sd.value("warmup_steps", 0);
            }
            sim_config_set = true;
            std::cout << "configure: " << body.dump(2) << "\n";
        } catch (const std::exception& e) {
            std::cerr << "configure parse error: " << e.what() << "\n";
            res.code = 400;
        }
        return res;
    });
    
    app.route_dynamic("/sim/start")
    .methods("POST"_method)
    ([&](const crow::request& req) {
        std::cout << "Sim Start Request Received" << std::endl;
        if (sim_running)
        return crow::response(409, "Simulation already running");
        if (!sim_config_set)
        return crow::response(400, "Simulation not configured");
        
        try {
            solver = std::make_unique<LBMSolver>(
                mesh,
                sim_config.ac_placement,
                sim_config.sim_data.resolution,
                sim_config.sim_data.tau);
            } catch (const std::exception& e) {
                std::cerr << "sim start error: " << e.what() << "\n";
                return crow::response(500, e.what());
            }
            
            std::string pos_msg = build_position_msg(solver->measurements());
            std::lock_guard<std::mutex> lock(connections_mutex);
            for (auto* conn : sim_connections){
                conn->send_binary(pos_msg);
            }
            
            sim_running = true;
            int warmup = sim_config.sim_data.warmup_steps;
            sim_thread = std::thread([&, warmup]() {
                for (int i = 0; i < warmup && sim_running; i++)
                solver->step();
                
                auto last_send = std::chrono::steady_clock::now();
                while (sim_running) {
                    solver->step();
                    auto now = std::chrono::steady_clock::now();
                    if (std::chrono::duration<float>(now - last_send).count() < 1.f / MAX_FREQ) continue;
                    last_send = now;
                    
                    std::string msg = build_frame_msg(solver->measurements());
                    std::lock_guard<std::mutex> lock(connections_mutex);
                    for (auto* conn : sim_connections)
                    conn->send_binary(msg);
                }
            });
            
            return crow::response(200);
        });
        
        app.route_dynamic("/sim/solid_cells")
        .methods("GET"_method)
        ([&](const crow::request&) {
            if (!solver)
                return crow::response(400, "Simulation not running");

            // Each entry: [x, y, z, type] where type matches CellType (1=Solid, 2=Emitter, 3=Intake)
            std::vector<float> cells;
            const float vs = solver->voxel_size();
            for (int z = 0; z < solver->nz(); z++)
            for (int y = 0; y < solver->ny(); y++)
            for (int x = 0; x < solver->nx(); x++) {
                CellType ct = solver->cell_type(x, y, z);
                if (ct == CellType::Fluid) continue;
                auto [wx, wy, wz] = solver->grid_to_world(x, y, z);
                cells.push_back(wx);
                cells.push_back(wy);
                cells.push_back(wz);
                cells.push_back(static_cast<float>(ct));
            }

            uint32_t count = static_cast<uint32_t>(cells.size() / 4);
            std::string buf(sizeof(uint32_t) + sizeof(float) + count * 4 * sizeof(float), '\0');
            char* p = buf.data();
            std::memcpy(p, &count, sizeof(uint32_t)); p += sizeof(uint32_t);
            std::memcpy(p, &vs,    sizeof(float));    p += sizeof(float);
            if (count > 0)
                std::memcpy(p, cells.data(), count * 4 * sizeof(float));

            crow::response res(200);
            res.set_header("Content-Type", "application/octet-stream");
            res.body = std::move(buf);
            return res;
        });

        app.route_dynamic("/sim/stop")
        .methods("POST"_method)
        ([&](const crow::request&) {
            if (!sim_running)
            return crow::response(400, "Simulation not running");
            
            sim_running = false;
            if (sim_thread.joinable())
            sim_thread.join();
            solver.reset();
            
            return crow::response(200);
        });
        
        app.route_dynamic("/recording/save")
        .methods("POST"_method, "OPTIONS"_method)
        ([&room_name = rooms.front().name](const crow::request& req) {
            if (req.method == crow::HTTPMethod::Options)
                return crow::response(204);

            const char* dn = req.url_params.get("dirname");
            std::string dirname = dn ? dn : "";

            if (dirname.empty()){
                return crow::response(400, "Missing dirname");
            }
            
            for (char c : dirname){
                if (!std::isalnum((unsigned char)c) && c!='-' && c!='_' && c!='.'){
                    return crow::response(400, "Invalid dirname");
                }
            }
            
            const char* p   = req.body.data();
            const char* end = p + req.body.size();

            auto rd32 = [&](uint32_t& v) -> bool {
                if (p+4>end) { return false; }
                std::memcpy(&v,p,4); p+=4; return true;
            };

            uint32_t cfg_len=0, pos_len=0;
            if (!rd32(cfg_len) || p+cfg_len>end) { return crow::response(400, "Bad config"); }
            std::string cfg_json(p, cfg_len); p+=cfg_len;
            if (!rd32(pos_len) || p+pos_len>end) { return crow::response(400, "Bad positions"); }
            std::string pos_data(p, pos_len); p+=pos_len;
            std::string frm_data(p, end-p);

            if (frm_data.size()<8) { return crow::response(400, "Bad frames"); }
            std::filesystem::path rec_dir = std::filesystem::path(RECORDING_DIR) / room_name / dirname;
            try { std::filesystem::create_directories(rec_dir); }
            catch (std::exception& e) { return crow::response(500, e.what()); }

            auto write_file = [&](const std::string& name, const std::string& data) -> bool {
                std::ofstream f(rec_dir/name, std::ios::binary);
                if (!f) { return false; }
                f.write(data.data(), (std::streamsize)data.size());
                return true;
            };

            if (!write_file("config.json",   cfg_json)) { return crow::response(500, "Write config.json failed"); }
            if (!write_file("positions.bin", pos_data)) { return crow::response(500, "Write positions.bin failed"); }
            if (!write_file("frames.bin",    frm_data)) { return crow::response(500, "Write frames.bin failed"); }
            std::cout << "Recording saved: " << rec_dir << "\n";
            return crow::response(200);
        });
        
        app.route_dynamic("/scene/save")
        .methods("POST"_method, "OPTIONS"_method)
        ([&mesh, &splat_msg, &room_name = rooms.front().name](const crow::request& req) {
            if (req.method == crow::HTTPMethod::Options)
                return crow::response(204);

            std::filesystem::path out_dir = std::filesystem::path(RECORDING_DIR) / room_name;
            try { std::filesystem::create_directories(out_dir); }
            catch (std::exception& e) { return crow::response(500, e.what()); }

            // mesh.bin: [uint32 nVerts][float32*nVerts*3][uint32 nColors][float32*nColors*3][uint32 nFaces][uint32*nFaces]
            {
                std::ofstream f(out_dir / "mesh.bin", std::ios::binary);
                if (!f) return crow::response(500, "Write mesh.bin failed");
                auto w32 = [&](uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
                auto wf  = [&](const std::vector<float>& v)    { f.write(reinterpret_cast<const char*>(v.data()), v.size()*4); };
                auto wu  = [&](const std::vector<uint32_t>& v) { f.write(reinterpret_cast<const char*>(v.data()), v.size()*4); };
                w32(static_cast<uint32_t>(mesh.vertices.size() / 3)); wf(mesh.vertices);
                w32(static_cast<uint32_t>(mesh.colors.size()   / 3)); wf(mesh.colors);
                w32(static_cast<uint32_t>(mesh.faces.size()    / 3)); wu(mesh.faces);
            }

            // splat.bin: same format as WebSocket message (build_splat_msg output)
            {
                std::ofstream f(out_dir / "splat.bin", std::ios::binary);
                if (!f) return crow::response(500, "Write splat.bin failed");
                f.write(splat_msg.data(), static_cast<std::streamsize>(splat_msg.size()));
            }

            std::cout << "Scene saved: " << out_dir << "\n";
            return crow::response(200);
        });

        app.route_dynamic("/")
        .methods("GET"_method)
        ([](const crow::request&) {
            crow::response res(200);
            res.write(std::format("Mesh WebSocket Server Running. Connect to ws://localhost:{}/mesh", HOSTED_PORT));
            return res;
        });
        
        app.port(HOSTED_PORT).multithreaded().run();
        
        return 0;
    }
    