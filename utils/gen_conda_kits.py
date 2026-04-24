import json
import subprocess
import pathlib

env_file = pathlib.Path(__file__).parent / ".env"
env_vars = dict(
    line.strip().split("=", 1)
    for line in env_file.read_text().splitlines()
    if line.strip() and not line.startswith("#")
)

base_path = pathlib.Path(env_vars["MINICONDA_PATH"])
conda = base_path / "Scripts/conda.exe"
envs = json.loads(subprocess.check_output([str(conda), "env", "list", "--json"]))["envs"]
kits = []

for env_path in envs:
    p = pathlib.Path(env_path)
    name = "base" if p == base_path else p.name
    kits.append({
        "name": f"conda: {name} (VS 2022 x64)",
        "visualStudio": "974d765e",
        "visualStudioArchitecture": "x64",
        "isTrusted": True,
        "preferredGenerator": {
            "name": "Visual Studio 17 2022",
            "platform": "x64",
            "toolset": "host=x64"
        },
        "environmentVariables": {
            "CONDA_PREFIX": str(p),
            "CONDA_DEFAULT_ENV": name,
            "PATH": f"{p};{p}/Scripts;{p}/Library/bin;{p}/Library/mingw-w64/bin;${{env:PATH}}"
        }
    })

out = pathlib.Path("C:/Users/Jack/.cmake-conda-kits.json")
out.write_text(json.dumps(kits, indent=2))
print(f"Wrote {len(kits)} kits to {out}")
