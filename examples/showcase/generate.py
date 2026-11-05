"""Author original, script-free IIMG posters and bounded scale workloads."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
GLYPHS = {
    "I": ["11111","00100","00100","00100","00100","00100","11111"],
    "M": ["10001","11011","10101","10101","10001","10001","10001"],
    "G": ["01110","10001","10000","10111","10001","10001","01110"],
    "O": ["01110","10001","10001","10001","10001","10001","01110"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "B": ["11110","10001","10001","11110","10001","10001","11110"],
    "T": ["11111","00100","00100","00100","00100","00100","00100"],
    "H": ["10001","10001","10001","11111","10001","10001","10001"],
    "U": ["10001","10001","10001","10001","10001","10001","01110"],
    "S": ["01111","10000","10000","01110","00001","00001","11110"],
    "E": ["11111","10000","10000","11110","10000","10000","11111"],
    "L": ["10000","10000","10000","10000","10000","10000","11111"],
}


def rgb(value):
    return [int(value[index:index + 2], 16) for index in (1, 3, 5)]


class Art:
    def __init__(self, width, height, background):
        self.source = {"width": width, "height": height,
                       "scene": {"background": rgb(background), "objects": []},
                       "interaction": {"controls": []}}
        self.points = []

    def shape(self, kind, color, name=None, **geometry):
        objects = self.source["scene"]["objects"]
        name = name or f"shape-{len(objects)}"
        objects.append({"type": kind, "id": name, **geometry, "fill": rgb(color)})
        return name

    def rect(self, x, y, width, height, color, name=None):
        return self.shape("rect", color, name, x=x, y=y, width=width, height=height)

    def circle(self, x, y, radius, color, name=None):
        return self.shape("circle", color, name, cx=x, cy=y, radius=radius)

    def control(self, target, label, color, point):
        self.source["interaction"]["controls"].append({
            "target": target, "label": label, "active_fill": rgb(color)})
        self.points.append({"target": target, "label": label, "point": point,
                            "activePixel": rgb(color)})

    def text(self, value, x, y, scale, color):
        # Original five-column letter geometry, merged into vertical runs.
        for letter in value:
            if letter == " ": x += 4 * scale; continue
            runs = {}
            for row, bits in enumerate(GLYPHS[letter] + ["00000"]):
                row_runs = set()
                column = 0
                while column < 5:
                    if bits[column] == "0": column += 1; continue
                    end = column + 1
                    while end < 5 and bits[end] == "1": end += 1
                    row_runs.add((column, end - column)); column = end
                for key in list(runs):
                    if key not in row_runs:
                        start = runs.pop(key)
                        self.rect(x + key[0] * scale, y + start * scale,
                                  key[1] * scale, (row - start) * scale, color)
                for key in sorted(row_runs): runs.setdefault(key, row)
            x += 6 * scale

    def bands(self, top, bottom, count=20):
        width, height = self.source["width"], self.source["height"]
        first, last = rgb(top), rgb(bottom)
        for row in range(count):
            start, end = height * row // count, height * (row + 1) // count
            color = "#" + "".join(f"{round(a + (b-a)*row/(count-1)):02x}" for a,b in zip(first,last))
            self.rect(0, start, width, end - start, color)


def orbit():
    art = Art(1024, 640, "#081320")
    art.bands("#081320", "#132b42")
    rng = random.Random(12)
    for _ in range(28):
        art.circle(rng.randint(40, 985), rng.randint(50, 575), rng.choice((1, 2)), "#66869a")
    art.text("IIMG", 62, 56, 5, "#d3f8ef")
    art.text("ORBIT", 64, 112, 3, "#6aa6af")
    for radius, color in [(210,"#18394d"),(202,"#20556a"),(190,"#2e7b86"),(177,"#52a79f")]:
        art.circle(750, 280, radius, color)
    art.circle(726, 255, 153, "#6dc3b0")
    for x,y,r in [(675,205,24),(758,190,34),(797,287,22),(695,315,16),(766,350,29)]:
        art.circle(x,y,r,"#4eaa9e")
        art.circle(x-3,y-4,max(2,r-5),"#61b9a8")
    for index in range(22):
        x = 520 + index * 22
        y = round(352 + 45 * math.sin(index * math.pi / 21))
        art.rect(x, y, 22, 4, "#b7e5bc" if index > 4 else "#477882")
    art.rect(143, 203, 10, 190, "#5f8290")
    for y in (180, 365):
        art.rect(65,y,160,48,"#3b667c")
        art.rect(70,y+5,150,38,"#142b45")
        for column in range(1,7): art.rect(70+column*21,y+5,2,38,"#3b667c")
        art.rect(70,y+23,150,2,"#3b667c")
    art.circle(145,296,36,"#5c7986")
    art.circle(342,296,36,"#7497a0")
    art.rect(145,260,197,72,"#92b4b7")
    art.rect(145,316,197,16,"#527482")
    art.rect(112,283,40,26,"#c9ddd5")
    art.rect(66,515,348,13,"#8aa59d")
    art.rect(94,528,292,58,"#203e51")
    for column in range(8): art.rect(110+column*33,545,18,8,"#3e6976")
    for x,y,name,label,color in [(183,291,"port-a","الكوة الأولى","#f4c978"),
                                  (241,291,"port-b","الكوة الثانية","#88e3c7"),
                                  (299,291,"port-c","الكوة الثالثة","#f09b90")]:
        art.circle(x,y,17,"#365967")
        target = art.circle(x,y,12,"#183544",name)
        art.control(target,label,color,[x,y])
    art.circle(887,533,18,"#294e60")
    beacon = art.circle(887,533,11,"#477984","beacon")
    art.control(beacon,"إشارة المحطة","#f4c978",[887,533])
    return art


def house():
    art = Art(1024,768,"#142938")
    art.bands("#142938","#31535a")
    art.text("IIMG",62,56,5,"#e6ead9")
    art.text("HOUSE",64,112,3,"#93b5a5")
    art.circle(885,105,43,"#d4dec6")
    art.circle(898,94,34,"#18333f")
    art.rect(0,634,1024,134,"#203c40")
    art.rect(217,620,643,18,"#5c7a73")
    art.rect(250,280,575,340,"#d3d7be")
    art.rect(244,250,587,30,"#81978b")
    art.rect(274,308,239,130,"#284e56")
    art.rect(540,308,258,130,"#284e56")
    art.rect(274,465,524,125,"#315c60")
    art.rect(318,185,316,55,"#709393")
    art.rect(326,192,300,41,"#1a3b50")
    for index in range(1,10): art.rect(326+index*30,192,2,41,"#527b83")
    art.rect(326,211,300,2,"#527b83")
    art.rect(338,240,9,10,"#81978b")
    art.rect(608,240,9,10,"#81978b")
    art.rect(305,385,165,8,"#a6b09b")
    art.rect(317,393,9,44,"#a6b09b")
    art.rect(449,393,9,44,"#a6b09b")
    art.rect(365,358,54,24,"#668d84")
    art.rect(384,382,16,3,"#bcc9ad")
    art.rect(570,391,196,31,"#bdad94")
    art.rect(579,381,52,17,"#e6d1b0")
    art.rect(639,381,52,17,"#d1be9c")
    art.rect(583,422,9,16,"#a69b80")
    art.rect(745,422,9,16,"#a69b80")
    art.rect(335,547,230,31,"#b48670")
    art.rect(335,532,230,19,"#c0987d")
    art.rect(347,578,8,12,"#d2c8a6")
    art.rect(546,578,8,12,"#d2c8a6")
    art.rect(641,545,79,8,"#b7c2a8")
    art.rect(677,553,8,37,"#b7c2a8")
    for x,y,r,color in [(139,535,42,"#638d73"),(159,488,35,"#7da17d"),(110,490,32,"#54806b"),(914,545,37,"#628b70")]:
        art.circle(x,y,r,color)
    art.rect(135,535,9,99,"#80917a")
    art.rect(909,545,9,89,"#80917a")
    for x,y,name,label in [(393,337,"study","مصباح غرفة العمل"),(667,337,"bedroom","مصباح غرفة النوم"),(576,493,"living","مصباح الصالة")]:
        art.rect(x-2,y-29,4,17,"#91a493")
        target=art.circle(x,y,15,"#728f81",name)
        art.control(target,label,"#ffdc88",[x,y])
    art.rect(739,193,52,47,"#55766d")
    battery=art.rect(750,204,30,23,"#254940","battery")
    art.control(battery,"مؤشر الطاقة الشمسية","#9be3a6",[765,215])
    return art


def bloom():
    art=Art(768,1024,"#f1eee4")
    art.bands("#f3f0e7","#dedfcf",16)
    art.text("IIMG",54,56,5,"#274d4b")
    art.text("BLOOM",56,112,3,"#688c79")
    art.circle(384,520,300,"#a7c4b4")
    art.circle(384,516,287,"#c9dace")
    art.circle(371,504,267,"#dce5d9")
    art.rect(225,350,10,450,"#557c66")
    art.rect(515,420,10,380,"#557c66")
    art.rect(350,600,10,200,"#557c66")
    for x,y,r,color in [(197,501,35,"#739b74"),(263,555,37,"#92af7d"),(486,580,34,"#739b74"),(549,635,36,"#92af7d"),(320,705,32,"#7da080"),(388,728,33,"#a1b78d")]:
        art.circle(x,y,r,color)
    for x,y,r,petal,name,label,active in [
        (230,350,29,"#c98880","flower-a","زهرة المرجان","#ffdb86"),
        (520,420,31,"#8da7bb","flower-b","زهرة السماء","#f6bf75"),
        (355,600,26,"#bcaa80","flower-c","زهرة الشمس","#f08980"),
    ]:
        for index in range(8):
            angle=index*math.pi/4
            art.circle(round(x+42*math.cos(angle)),round(y+42*math.sin(angle)),r,petal)
        center=art.circle(x,y,23,"#607c68",name)
        art.control(center,label,active,[x,y])
    art.rect(145,800,478,14,"#3c665a")
    art.rect(179,814,410,94,"#688b70")
    art.rect(196,908,376,14,"#3c665a")
    for column in range(12): art.rect(197+column*31,826,5,67,"#92ac88")
    art.rect(220,938,326,3,"#a9b99e")
    return art


def workload(side):
    art=Art(side,side,"#102a34")
    palette=["#214453","#3b6972","#70a49b","#afc7ad","#d9ceaa","#bf977f"]
    tile=side//16
    for y in range(16):
        for x in range(16):
            name=art.rect(x*tile+1,y*tile+1,tile-2,tile-2,palette[(x*7+y*11)%len(palette)])
            if (x,y)==(8,8): art.control(name,"المربع المركزي","#f4ca78",[x*tile+tile//2,y*tile+tile//2])
    return art


def generate(cli, output):
    output=output.resolve()
    if output.exists(): raise FileExistsError(f"Output must be new: {output}")
    output.parent.mkdir(parents=True,exist_ok=True)
    scenes=[("orbital-night",orbit()),("solar-house",house()),("signal-garden",bloom())]
    scenes += [(f"workload-{side}",workload(side)) for side in (256,1024,2048)]
    with tempfile.TemporaryDirectory(prefix="iimg-showcase-",dir=output.parent) as temporary:
        stage=Path(temporary)/"files"
        stage.mkdir()
        manifest={"license":"Apache-2.0","provenance":"Original project-authored rect/circle artwork and letter geometry; no external artwork or fonts.","scenes":[]}
        for name,art in scenes:
            def run(*args):
                subprocess.run([str(cli.resolve()),*map(str,args)],check=True,capture_output=True)
            source=stage/f"{name}.source.json"
            source.write_text(json.dumps(art.source,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
            path=stage/f"{name}.iimg"
            run("compile-v1",source,path)
            run("validate",path)
            run("extract-preview",path,stage/f"{name}.png")
            run("render",path,stage/f"{name}.initial.ppm")
            trace={"version":1,"events":[{"type":"activate_pixel","x":art.points[0]["point"][0],"y":art.points[0]["point"][1]}]}
            trace_path=stage/f"{name}.trace.json"
            trace_path.write_text(json.dumps(trace)+"\n",encoding="utf-8",newline="\n")
            run("replay",path,trace_path,stage/f"{name}.active.ppm")
            width,height=art.source["width"],art.source["height"]
            header=f"P6\n{width} {height}\n255\n".encode()
            frames={}
            for mode in ("initial","active"):
                frame=stage/f"{name}.{mode}.ppm"
                data=frame.read_bytes()
                assert data.startswith(header) and len(data)==len(header)+width*height*3
                x,y=art.points[0]["point"]
                offset=len(header)+(y*width+x)*3
                expected=art.points[0]["activePixel"] if mode=="active" else next(
                    shape["fill"] for shape in art.source["scene"]["objects"] if shape["id"]==art.points[0]["target"])
                assert list(data[offset:offset+3])==expected, f"{name}: activation point is obscured"
                frames[mode]=hashlib.sha256(data[len(header):]).hexdigest()
                frame.unlink()
            first=art.points[0]
            initial=next(shape["fill"] for shape in art.source["scene"]["objects"] if shape["id"]==first["target"])
            entry={"name":name,"kind":"showcase" if not name.startswith("workload") else "workload",
                   "width":width,"height":height,"objects":len(art.source["scene"]["objects"]),
                   "file":path.name,"fileBytes":path.stat().st_size,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                   "preview":f"{name}.png","initialRgbSha256":frames["initial"],"activeRgbSha256":frames["active"],
                   "activation":first["point"],"initialPixel":initial,"activePixel":first["activePixel"],"controls":art.points}
            manifest["scenes"].append(entry)
            print(f"{name}: {width}x{height}, {entry['objects']} shapes, {entry['fileBytes']} bytes",flush=True)
        (stage/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
        if not stage.resolve().is_relative_to(output.parent): raise ValueError("Invalid staging location")
        stage.rename(output)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    executable="iimg-cli.exe" if os.name=="nt" else "iimg-cli"
    parser.add_argument("--cli",type=Path,default=ROOT/"target/debug"/executable)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    generate(args.cli,args.output)
