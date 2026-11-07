"""Generate finite-motion reference frames without the Rust encoder."""
from pathlib import Path
import runpy
import sys
ROOT = Path(__file__).resolve().parents[3]
generate = runpy.run_path(str(ROOT / "tests/fixtures/state-actions/generate.py"))["generate"]
start = {"type":"activate_pixel","x":5,"y":5}
def tick(time): return {"type":"advance_time","milliseconds":time}
def trace(events): return {"version":1,"events":events}
traces = {"initial":trace([]), "midpoint":trace([start,tick(500)]),
          "repeat":trace([start,tick(1000)]), "final":trace([start,tick(2000)]),
          "reduced":trace([start,{"type":"motion_preference","reduced":True}]),
          "reset":trace([start,tick(500),{"type":"reset"}]),
          "retrigger":trace([start,tick(500),start,start,tick(1000)]),
          "clock-limit":trace([start,tick(86400000)])}
if __name__ == "__main__":
    generate(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent,
             source_name="motion", file_name="motion.iimg", custom_traces=traces)
