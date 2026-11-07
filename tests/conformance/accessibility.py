"""Independent aTXT carrier acceptance, rejections and unchanged pixels."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from reference import Invalid, envelope, validate
from check import record
ROOT=Path(__file__).resolve().parents[2]
def run(cli):
    source=ROOT/'tests/fixtures/v1.0/raster-toggle.iimg';data=source.read_bytes();_,entries=envelope(data)
    cases=[({'description':'مصباح تفاعلي','language':'ar-SA'},True),({'description':'Interactive lamp','language':'en'},True)]
    for value in [{'description':' ','language':'en'},{'description':'x\n','language':'en'},{'description':'x','language':'en\n'},{'description':'x','language':'en_US'},{'description':'x','language':'x'},{'description':'x','language':'ar-'},{'description':'ض'*1025,'language':'ar'},['x','en']]:cases.append((value,False))
    with tempfile.TemporaryDirectory(prefix='iimg-alt-') as temp:
        scratch=Path(temp)
        def invoke(*args):return subprocess.run([str(cli),*map(str,args)],capture_output=True,timeout=15)
        initial=scratch/'plain.ppm';assert invoke('render',source,initial).returncode==0
        for index,(payload,accepted) in enumerate(cases):
            raw=json.dumps(payload,ensure_ascii=False).encode()
            file=data[:12]+b''.join(record(kind,body) for kind,body in entries[:-1])+record(b'aTXT',raw)+record(b'IEND',b'')
            path=scratch/f'{index}.iimg';path.write_bytes(file)
            try:validate(file);result=True
            except Invalid:result=False
            assert result==accepted,index
            assert (invoke('validate',path).returncode==0)==accepted,index
            if accepted:
                output=scratch/f'{index}.ppm';assert invoke('render',path,output).returncode==0;assert output.read_bytes()==initial.read_bytes()
        for extra in [record(b'aTXT',b'{"description":"x","language":"en"}')*2,record(b'aTXT',b' '*4097)]:
            file=data[:12]+b''.join(record(kind,body) for kind,body in entries[:-1])+extra+record(b'IEND',b'')
            path=scratch/'invalid.iimg';path.write_bytes(file)
            try:validate(file)
            except Invalid:pass
            else:raise AssertionError('Python accepted duplicate/oversize aTXT')
            assert invoke('validate',path).returncode!=0
    print('Alternative description: two valid Arabic/Latin cases kept exact pixels; ten malformed/oversize/duplicate cases rejected by Python and native CLI.')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cli',type=Path,default=ROOT/'target/debug'/('iimg-cli.exe' if os.name=='nt' else 'iimg-cli'));run(p.parse_args().cli.resolve())
