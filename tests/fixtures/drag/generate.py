"""Independent DRAG fixture, traces and pixel hashes; no Rust encoder."""
from pathlib import Path
import runpy
import sys
ROOT = Path(__file__).resolve().parents[3]
generate = runpy.run_path(str(ROOT / "tests/fixtures/state-actions/generate.py"))["generate"]
def event(kind, **values): return dict(type=kind, **values)
def trace(*events): return dict(version=1, events=list(events))
start = event("drag_start", x=40, y=32)
move = event("drag_move", x=88, y=32)
traces = {
    "initial":trace(), "captured":trace(start,move),
    "commit":trace(start,move,event("drag_end")),
    "cancel":trace(start,move,event("drag_cancel")),
    "reset":trace(start,move,event("reset")),
    "snap":trace(start,event("drag_move",x=28,y=32),event("drag_end")),
    "clamp":trace(start,event("drag_move",x=65535,y=32)),
    "reverse":trace(event("drag_start",x=102,y=46),event("drag_move",x=102,y=0)),
    "range":trace(event("set_slider",index=0,value=100),event("set_slider",index=1,value=30)),
    "miss":trace(event("drag_start",x=0,y=0),move,event("drag_end")),
}
if __name__ == "__main__":
    generate(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent,
             source_name="drag",file_name="drag.iimg",custom_traces=traces)
