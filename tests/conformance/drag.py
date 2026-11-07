"""Discrete slider independent/native acceptance and rejection checks."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from reference import Invalid, envelope, replay_fixture, validate
from check import record
ROOT = Path(__file__).resolve().parents[2]
def run(cli):
    fixture = ROOT/'tests/fixtures/drag'
    data = (fixture/'drag.iimg').read_bytes(); validate(data)
    manifest=json.loads((fixture/'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='iimg-drag-') as temp:
        scratch=Path(temp)
        def invoke(*args): return subprocess.run([str(cli),*map(str,args)],capture_output=True,timeout=15)
        assert invoke('validate',fixture/'drag.iimg').returncode==0
        for name in manifest['rgbSha256']:
            trace=fixture/f'{name}.trace.json';output=scratch/f'{name}.ppm'
            result=invoke('replay',fixture/'drag.iimg',trace,output)
            assert result.returncode==0,result.stderr
            assert output.read_bytes()==replay_fixture(data,trace.read_bytes()),name
        _, entries=envelope(data);original=json.loads(dict(entries)[b'DRAG'])
        mutations=[]
        for field,value in [('min',100),('max',1025),('step',0),('step',3),('initial',26),('initial',101),('axis','z'),('target','missing'),('from',[8,24]),('to',{'x':8,'y':24}),('to',{'x':113,'y':24}),('to',{'x':104,'y':25})]:
            payload=json.loads(json.dumps(original));payload['sliders'][0][field]=value;mutations.append(payload)
        for field,value in [('id','horizontal'),('target','handleX')]:
            payload=json.loads(json.dumps(original));payload['sliders'][1][field]=value;mutations.append(payload)
        for index,payload in enumerate(mutations):
            changed=data[:12]+b''.join(record(kind,json.dumps(payload).encode() if kind==b'DRAG' else body) for kind,body in entries)
            path=scratch/f'bad-{index}.iimg';path.write_bytes(changed)
            try:validate(changed)
            except Invalid:pass
            else:raise AssertionError(f'Python accepted mutation {index}')
            assert invoke('validate',path).returncode!=0,index
        for index,event in enumerate([dict(type='set_slider',index=2,value=0),dict(type='set_slider',index=0,value=26),dict(type='set_slider',index=0,value=101),dict(type='drag_start',x=65536,y=0)]):
            raw=json.dumps(dict(version=1,events=[dict(type='reset'),event])).encode();path=scratch/f'bad-trace-{index}.json';path.write_bytes(raw)
            try:replay_fixture(data,raw)
            except Invalid:pass
            else:raise AssertionError(f'Python accepted trace {index}')
            assert invoke('replay',fixture/'drag.iimg',path,scratch/'bad.ppm').returncode!=0
    print(f"DRAG: {len(manifest['rgbSha256'])} independent/native frames, {len(mutations)} payload and four trace rejections matched.")
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cli',type=Path,default=ROOT/'target/debug'/('iimg-cli.exe' if os.name=='nt' else 'iimg-cli'))
    run(parser.parse_args().cli.resolve())
