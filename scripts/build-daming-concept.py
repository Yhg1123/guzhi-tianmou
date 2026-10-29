"""Author a coherent Hanyuan Hall *concept*, render calibrated views and seeds.

Run with Blender's Python. All geometry is authored here, no downloaded mesh.
This is an artistic architectural interpretation, not a measured restoration.
The generated images are explicitly recorded as renders, never photographs.
"""
import argparse, hashlib, json, math, random, sys
from pathlib import Path
from datetime import datetime, timezone
import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'qa/daming-concept'
MATS, COLORS = [], []
random.seed(734)


def srgb(v):
    return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4


def material(name, hexcolor, roughness=.72, noise=0, brick=False, metallic=0):
    rgb = tuple(int(hexcolor[i:i+2],16)/255 for i in (0,2,4))
    linear = tuple(srgb(v) for v in rgb)
    mat = bpy.data.materials.new(name); mat.use_nodes=True
    mat.diffuse_color=(*linear,1)
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*linear,1)
    bsdf.inputs['Roughness'].default_value=roughness
    bsdf.inputs['Metallic'].default_value=metallic
    if noise or brick:
        nodes=mat.node_tree.nodes; links=mat.node_tree.links
        coord=nodes.new('ShaderNodeTexCoord')
        tex=nodes.new('ShaderNodeTexBrick' if brick else 'ShaderNodeTexNoise')
        links.new(coord.outputs['Object'],tex.inputs['Vector'])
        if brick:
            tex.inputs['Scale'].default_value=1
            tex.inputs['Brick Width'].default_value=1.15
            tex.inputs['Row Height'].default_value=.68
            tex.inputs['Mortar Size'].default_value=.016
            tex.inputs['Mortar Smooth'].default_value=.01
            tex.inputs['Color1'].default_value=(*linear,1)
            tex.inputs['Color2'].default_value=(*(v*.87 for v in linear),1)
            tex.inputs['Mortar'].default_value=(*(v*.48 for v in linear),1)
            links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
            bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.035
            links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
        else:
            tex.inputs['Scale'].default_value=6
            tex.inputs['Detail'].default_value=2
            ramp=nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[1].position=.85
            ramp.color_ramp.elements[0].color=(*(v*(1-noise) for v in linear),1)
            ramp.color_ramp.elements[1].color=(*(min(1,v*(1+noise)) for v in linear),1)
            links.new(tex.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs[0],bsdf.inputs['Base Color'])
    MATS.append(mat);COLORS.append(rgb)
    return len(MATS)-1


class Builder:
    def __init__(self):
        self.vertices=[];self.faces=[];self.materials=[];self.smooth=[]
        self.transform=Matrix.Identity(4)
    def mesh(self, vertices, faces, mat, smooth=False):
        at=len(self.vertices)
        self.vertices.extend([tuple(self.transform @ Vector(v)) for v in vertices])
        self.faces.extend([tuple(at+i for i in f) for f in faces])
        self.materials.extend([mat]*len(faces));self.smooth.extend([smooth]*len(faces))
    def box(self, center, size, mat):
        x,y,z=center;a,b,c=[v/2 for v in size]
        v=[(x+sx*a,y+sy*b,z+sz*c)for sz in [-1,1]for sy in [-1,1]for sx in [-1,1]]
        self.mesh(v,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],mat)
    def cylinder(self, center, radius, depth, mat, sides=12, top_radius=None):
        x,y,z=center;r2=radius if top_radius is None else top_radius
        v=[(x+r*math.cos(a*2*math.pi/sides),y+r*math.sin(a*2*math.pi/sides),z+dz)for r,dz in [(radius,-depth/2),(r2,depth/2)]for a in range(sides)]
        f=[tuple(range(sides-1,-1,-1)),tuple(range(sides,2*sides))]+[(a,(a+1)%sides,(a+1)%sides+sides,a+sides)for a in range(sides)]
        self.mesh(v,f,mat,True)
    def beam(self, a, b, width, depth, mat):
        a,b=Vector(a),Vector(b);direction=(b-a).normalized()
        ref=Vector((0,0,1)) if abs(direction.z)<.95 else Vector((0,1,0))
        x=direction.cross(ref).normalized()*width/2;y=direction.cross(x).normalized()*depth/2
        v=[tuple(p+sx*x+sy*y)for p in [a,b]for sy in [-1,1]for sx in [-1,1]]
        self.mesh(v,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],mat)
    def tube(self, path, radius, mat, sides=6):
        points=[Vector(p)for p in path];v=[]
        for i,p in enumerate(points):
            direction=(points[min(i+1,len(points)-1)]-points[max(i-1,0)]).normalized()
            ref=Vector((0,0,1)) if abs(direction.z)<.95 else Vector((0,1,0))
            a=direction.cross(ref).normalized()*radius;b=direction.cross(a).normalized()*radius
            v.extend([tuple(p+a*math.cos(n*2*math.pi/sides)+b*math.sin(n*2*math.pi/sides))for n in range(sides)])
        faces=[(i*sides+n,i*sides+(n+1)%sides,(i+1)*sides+(n+1)%sides,(i+1)*sides+n)for i in range(len(points)-1)for n in range(sides)]
        self.mesh(v,faces,mat,True)
    def finish(self):
        mesh=bpy.data.meshes.new('Hanyuan-authored-geometry');mesh.from_pydata(self.vertices,[],self.faces);mesh.update()
        obj=bpy.data.objects.new('Hanyuan Hall architectural concept',mesh);bpy.context.collection.objects.link(obj)
        for mat in MATS:mesh.materials.append(mat)
        for poly,mat,smooth in zip(mesh.polygons,self.materials,self.smooth):poly.material_index=mat;poly.use_smooth=smooth
        return obj


def roof(B,cx,cy,eave,w,d,height,roofmat,ribmat,wood,gold,corner=.6):
    a,b=w/2,d/2;ridge=max(.15,a-b)
    def surface(face,u,t):
        z=eave+height*(1-t)**1.65+corner*abs(u)**8*t**4
        if face<2:return (cx+u*(ridge+(a-ridge)*t),cy+(-1 if face==0 else 1)*b*t,z)
        return (cx+(-1 if face==2 else 1)*(ridge+(a-ridge)*t),cy+u*b*t,z)
    for face in range(4):
        nu=48 if face<2 else 24;nv=16
        verts=[surface(face,-1+2*i/nu,j/nv)for j in range(nv+1)for i in range(nu+1)]
        faces=[(j*(nu+1)+i,j*(nu+1)+i+1,(j+1)*(nu+1)+i+1,(j+1)*(nu+1)+i)for j in range(nv)for i in range(nu)]
        B.mesh(verts,faces,roofmat,True)
        # Physical semicircular tile ribs and slim course lines keep roof detail
        # coherent in every view; no image-plane facade texture is used.
        count=max(6,round((w if face<2 else d)/.27))
        for i in range(count+1):
            u=-1+2*i/count
            path=[tuple(v+(0.035 if k==2 else 0)for k,v in enumerate(surface(face,u,.012+.988*j/18)))for j in range(19)]
            B.tube(path,.046 if w>20 else .038,ribmat)
        for row in range(1,14):
            B.tube([surface(face,-1+2*i/nu,row/14)for i in range(nu+1)],.012,roofmat,4)
        fascia=[(p[0],p[1],p[2]-.10)for p in [surface(face,-1+2*i/nu,1)for i in range(nu+1)]]
        B.tube(fascia,.14,wood,8)
        B.tube([(x,y,z+.12)for x,y,z in fascia],.035,gold)
    for sign in [-1,1]:
        for sy in [-1,1]:
            B.tube([(cx+sign*(ridge+(a-ridge)*t),cy+sy*b*t,eave+height*(1-t)**1.65+corner*t**4+.07)for t in np.linspace(0,1,22)],.10,ribmat,8)
    B.tube([(cx-ridge,cy,eave+height+.10),(cx+ridge,cy,eave+height+.10)],.16,gold,8)
    for sign in [-1,1]:
        # An authored ridge finial silhouette, not a reproduced excavated object.
        B.tube([(cx+sign*(ridge-.15),cy,eave+height+.15),(cx+sign*(ridge+.16),cy,eave+height+.45),(cx+sign*(ridge+.26),cy,eave+height+.90),(cx+sign*(ridge+.05),cy,eave+height+1.05)],.12,gold,8)


def rail(B,a,b,z,stone,dark,spacing=2):
    a,b=Vector((*a,z)),Vector((*b,z));length=(b-a).length;count=max(1,round(length/spacing))
    for i in range(count+1):
        p=a.lerp(b,i/count)
        B.box((p.x,p.y,z+.5),(.24,.24,1),stone)
        B.cylinder((p.x,p.y,z+1.09),.17,.16,stone,8,.09)
    for height in [.28,.78]:B.beam(tuple(a+Vector((0,0,height))),tuple(b+Vector((0,0,height))),.12,.13,stone)
    for i in range(count):
        mid=a.lerp(b,(i+.5)/count)
        B.beam(tuple(mid+Vector((0,0,.28))),tuple(mid+Vector((0,0,.78))),.12,.12,dark)


def stairs(B,cx,front,width,height,run,stone):
    count=max(5,round(height/.22))
    for i in range(count):
        depth=run*(count-i)/count;h=height*(i+1)/count
        B.box((cx,front-depth/2,h/2),(width,depth,h),stone)
    for side in [-1,1]:
        x=cx+side*(width/2+.18)
        B.beam((x,front-run,.62),(x,front,height+.62),.22,.22,stone)
        for i in range(8):
            t=i/7;B.cylinder((x,front-run+run*t,height*t+.32),.10,.64,stone,8)


def lattice(B,cx,y,z,width,height,wood,frame):
    B.box((cx,y,z),(width,.16,height),wood)
    B.box((cx,y-.10,z-height/2+.16),(width,.14,.32),frame)
    for x in np.arange(cx-width/2+.12,cx+width/2,.24):B.box((x,y-.115,z+.18),(.038,.065,height-.48),frame)
    for zz in np.arange(z-height/2+.42,z+height/2,.35):B.box((cx,y-.12,zz),(width,.065,.038),frame)
    for x in [cx-width/2,cx+width/2]:B.box((x,y-.12,z),(.12,.14,height+.12),frame)
    for zz in [z-height/2,z+height/2]:B.box((cx,y-.12,zz),(width+.12,.14,.12),frame)


def hall(B,cx,cy,base,w,d,h,bays,materials,double=True):
    wood,dark,wall,stone,roofmat,rib,gold=materials
    B.box((cx,cy,base+.10),(w+1.6,d+1.6,.20),stone)
    for xx in np.linspace(-w/2,w/2,bays+1):
        for sy in [-1,1]:
            y=cy+sy*d/2;x=cx+xx
            B.cylinder((x,y,base+.14),.40,.27,stone,16,.34)
            B.cylinder((x,y,base+h/2+.24),.30 if w>20 else .24,h-.30,wood,16,.25 if w>20 else .20)
            B.cylinder((x,y,base+h-.14),.30,.14,gold,12)
            for layer in range(3):
                zz=base+h-.14+layer*.20
                B.box((x,y+sy*layer*.18,zz),(1.02+layer*.40,.20,.17),wood)
                B.box((x,y+sy*.44,zz+.12),(.20,1.18+layer*.32,.14),wood)
            B.beam((x,y,base+h-1.0),(x,y+sy*1.45,base+h+.47),.18,.22,wood)
    for side in [-1,1]:
        x=cx+side*w/2
        for y in np.linspace(cy-d/2,cy+d/2,5)[1:-1]:
            B.cylinder((x,y,base+h/2+.22),.23,h-.3,wood,14,.20)
            B.box((x,y,base+h+.10),(.22,1.5,.20),wood)
    # Ivory infill and framed lattice doors on both elevations.
    B.box((cx,cy,base+h/2),(w-.9,d-3.0,h),wall)
    for sy in [-1,1]:
        y=cy+sy*(d-3)/2
        for i in range(bays):
            x=cx-w/2+(i+.5)*w/bays
            # A sign flip keeps the lattice relief on the exterior in back views.
            before=len(B.vertices)
            lattice(B,x,y-.10,base+h*.43,w/bays*.78,h*.69,dark,wood)
            if sy==1:
                for j in range(before,len(B.vertices)):
                    vx,vy,vz=B.vertices[j];B.vertices[j]=(vx,2*y-vy,vz)
            B.box((x,y+sy*.02,base+h*.84),(w/bays*.92,.18,.15),gold)
        for zz,thickness in [(base+h,.36),(base+h-.60,.22),(base+.35,.20)]:B.box((cx,cy+sy*d/2,zz),(w+.8,.28,thickness),wood)
    for sx in [-1,1]:
        x=cx+sx*(w-.8)/2
        for y in np.linspace(cy-(d-3)/2,cy+(d-3)/2,6):B.box((x,y,base+h/2),(.18,.17,h),wood)
        for zz in [base+.35,base+h*.55,base+h-.45]:B.box((x,cy,zz),(.20,d-2.7,.16),wood)
    roof(B,cx,cy,base+h+.55,w+5,d+5,2.9 if w>20 else 1.85,roofmat,rib,wood,gold,.60 if w>20 else .38)
    if double:
        upperbase=base+h+(1.40 if w>20 else .75);upperheight=1.65 if w>20 else 2.35
        B.box((cx,cy,upperbase+upperheight/2),(w-3,d-3.5,upperheight),wall)
        if w<20:
            B.box((cx,cy,upperbase+.04),(w-1.1,d-1.1,.16),wood)
            for sy in [-1,1]:
                yy=cy+sy*(d-1.25)/2
                for zz in [upperbase+.32,upperbase+.90]:B.box((cx,yy,zz),(w-1.1,.10,.12),wood)
                for xx in np.linspace(cx-(w-1.1)/2,cx+(w-1.1)/2,9):B.box((xx,yy,upperbase+.58),(.09,.09,.72),wood)
        for xx in np.linspace(-w/2+1.7,w/2-1.7,bays+1):
            for sy in [-1,1]:
                yy=cy+sy*(d-3.5)/2
                B.box((cx+xx,yy,upperbase+upperheight/2),(.16,.18,upperheight),wood)
        for sy in [-1,1]:
            for zz in [upperbase+.12,upperbase+upperheight-.10]:B.box((cx,cy+sy*(d-3.5)/2,zz),(w-2.7,.22,.20),wood)
        roof(B,cx,cy,upperbase+upperheight+.10,w+1.5,d+1.5,3.1 if w>20 else 2.0,roofmat,rib,wood,gold,.65 if w>20 else .4)


def create_scene():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    wood=material('Cinnabar timber','8D3429',noise=.12)
    dark=material('Dark carved timber','42241B',noise=.12)
    wall=material('Warm ivory plaster','E1D9C1',noise=.055)
    stone=material('Limestone terraces','C7BDA4',noise=.10)
    darkstone=material('Balustrade insets','A79C83',noise=.08)
    tile=material('Charcoal green ceramic','202E2D',roughness=.88,noise=.08)
    rib=material('Ceramic tile edges','344B48',roughness=.84,noise=.06)
    gold=material('Muted bronze details','A98D58',roughness=.65,metallic=.2)
    paving=material('Courtyard stone pavers','C7BDAB',brick=True)
    B=Builder();mats=(wood,dark,wall,stone,tile,rib,gold)
    B.box((0,0,-.20),(89,45,.40),stone)
    B.box((0,0,.02),(88.8,44.8,.06),paving)
    # Three tiers, all creative units. No surveyed dimension is asserted.
    for z,w,d in [(.60,53,28),(1.65,51.3,25.5),(2.70,49.5,23)]:
        B.box((0,2,z),(w,d,1.10),stone)
        B.box((0,2,z+.56),(w+.26,d+.26,.12),paving)
        for sy in [-1,1]:B.box((0,2+sy*d/2,z+.22),(w,.14,.12),darkstone)
    base=3.32
    hall(B,0,2,base,42,15,5.5,11,mats)
    stairs(B,0,-9.5,11.5,base,10.5,stone)
    for a,b in [((-24.7,-9.5),(-6.2,-9.5)),((6.2,-9.5),(24.7,-9.5)),((-24.7,-9.5),(-24.7,13.5)),((24.7,-9.5),(24.7,13.5)),((-24.7,13.5),(24.7,13.5))]:rail(B,a,b,base,stone,darkstone)
    for sx in [-1,1]:
        cx=sx*34;cy=-3.8
        B.box((cx,cy,.80),(13.3,14.8,1.60),stone)
        B.box((cx,cy,1.65),(13.8,15.3,.14),paving)
        hall(B,cx,cy,1.78,9.2,8.4,3.35,3,mats)
        stairs(B,cx,-11.2,4.4,1.78,4.6,stone)
        for a,b in [((cx-6.5,cy-7),(cx-2.5,cy-7)),((cx+2.5,cy-7),(cx+6.5,cy-7)),((cx-6.5,cy-7),(cx-6.5,cy+7)),((cx+6.5,cy-7),(cx+6.5,cy+7))]:rail(B,a,b,1.78,stone,darkstone,1.8)
        # Elevated galleries with a bend, giving the complex spatial depth.
        segments=[((sx*23,5),(sx*28.5,5)),((sx*28.5,5),(sx*28.5,-.8)),((sx*28.5,-.8),(sx*31,-.8))]
        for start,end in segments:
            ax,ay=start;bx,by=end;length=math.hypot(bx-ax,by-ay);angle=math.atan2(by-ay,bx-ax)
            old=B.transform;B.transform=Matrix.Translation(((ax+bx)/2,(ay+by)/2,0)) @ Matrix.Rotation(angle,4,'Z')
            B.box((0,0,2.9),(length,2.7,.35),stone)
            for xx in np.linspace(-length/2,length/2,max(3,round(length/1.8))):
                for side in [-1,1]:B.cylinder((xx,side,4.05),.11,2.0,wood,8)
            for side in [-1,1]:
                B.box((0,side,3.45),(length,.12,.12),wood);B.box((0,side,4.95),(length,.18,.20),wood)
            roof(B,0,0,5.12,length+1.2,3.9,1.0,tile,rib,wood,gold,.22)
            B.transform=old
    obj=B.finish()
    bevel=obj.modifiers.new('Soft architectural edges','BEVEL');bevel.width=.025;bevel.segments=1;bevel.limit_method='ANGLE';bevel.angle_limit=.85
    scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
    scene.eevee.use_raytracing=True;scene.eevee.fast_gi_method='GLOBAL_ILLUMINATION';scene.eevee.fast_gi_distance=4
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
    scene.render.image_settings.color_depth='8';scene.render.image_settings.compression=15
    scene.world.color=(.35,.35,.35)
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.68,.75,.80,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=0
    for name,loc,energy,size in [('Large soft key',(-30,-40,55),30000,38),('Warm fill',(35,-5,35),15000,30),('Roof rim',(-10,30,45),20000,28)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        data.color=(1,.87,.72) if name!='Warm fill' else (.78,.88,1)
        light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=loc;light.rotation_euler=(Vector((0,0,4))-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.lights.new('Afternoon sunlight','SUN');data.energy=2.1;data.angle=.16;data.color=(1,.92,.79)
    sun=bpy.data.objects.new('Afternoon sunlight',data);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(25),math.radians(-30),math.radians(-25))
    camera=bpy.data.cameras.new('Calibrated concept camera');cam=bpy.data.objects.new('Calibrated concept camera',camera);scene.collection.objects.link(cam);scene.camera=cam
    camera.type='PERSP';camera.lens=43;camera.sensor_width=36;camera.clip_start=.05;camera.clip_end=500
    scene.render.resolution_x=960;scene.render.resolution_y=720
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'hanyuan-concept.blend'))
    return obj


def source_camera(azimuth,elevation,radius=128,target=(0,0,5.8)):
    camera=bpy.context.scene.camera;az=math.radians(azimuth);el=math.radians(elevation)
    camera.location=(radius*math.sin(az)*math.cos(el),-radius*math.cos(az)*math.cos(el),target[2]+radius*math.sin(el))
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()


def write_seeds(obj,output,count=180000):
    mesh=obj.data;mesh.calc_loop_triangles()
    vertices=np.asarray([tuple(v.co)for v in mesh.vertices],dtype=np.float64)
    triangles=np.asarray([tuple(t.vertices)for t in mesh.loop_triangles],dtype=np.int32)
    indices=np.asarray([t.material_index for t in mesh.loop_triangles])
    p=vertices[triangles];areas=np.linalg.norm(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),axis=1)/2
    weights=np.asarray([.22 if MATS[i].name.startswith('Courtyard') else 2.2 if 'Ceramic' in MATS[i].name or 'ceramic' in MATS[i].name else 1.4 if 'timber' in MATS[i].name else 1 for i in indices])
    prob=areas*weights;prob/=prob.sum()
    rng=np.random.default_rng(734);choice=rng.choice(len(p),count,p=prob)
    r=rng.random((count,2));a=np.sqrt(r[:,0]);b=r[:,1]
    xyz=p[choice,0]*(1-a[:,None])+p[choice,1]*(a*(1-b))[:,None]+p[choice,2]*(a*b)[:,None]
    xyz=xyz[:,[0,2,1]];xyz[:,2]*=-1
    colors=(np.asarray(COLORS)[indices[choice]]*230).clip(0,255).astype(np.uint8)
    data=np.empty(count,dtype=[('xyz','<f4',(3,)),('rgb','u1',(3,))]);data['xyz']=xyz;data['rgb']=colors
    header=f'ply\nformat binary_little_endian 1.0\nelement vertex {count}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
    output.write_bytes(header.encode()+data.tobytes())
    return count


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--preview-only',action='store_true');parser.add_argument('--render-views',action='store_true');parser.add_argument('--resolution',type=int,default=960)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else [])
    BASE.mkdir(parents=True,exist_ok=True)
    obj=create_scene();scene=bpy.context.scene
    scene.render.resolution_x=args.resolution;scene.render.resolution_y=round(args.resolution*.75)
    if args.preview_only:
        for name,az,el in [('front',22,24),('back',202,28),('roof',45,58)]:
            source_camera(az,el);scene.render.filepath=str(BASE/f'concept-{name}.png');bpy.ops.render.render(write_still=True)
        print('Authored concept preview complete',flush=True);return
    if not args.render_views:return
    dataset=BASE/'prepared';(dataset/'images').mkdir(parents=True,exist_ok=True)
    seed_count=write_seeds(obj,dataset/'init.ply')
    T=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    poses=[(j*15,e,128)for e in [18,35,55]for j in range(24)]+[(j*45,76,128)for j in range(8)]+[(j*45,-12,128)for j in range(8)]+[(j*22.5,25,85)for j in range(16)]
    fx=scene.camera.data.lens/scene.camera.data.sensor_width*scene.render.resolution_x
    config={'camera_model':'OPENCV','fl_x':fx,'fl_y':fx,'cx':scene.render.resolution_x/2,'cy':scene.render.resolution_y/2,'w':scene.render.resolution_x,'h':scene.render.resolution_y,'ply_file_path':'init.ply'}
    records=[]
    for i,(az,el,radius)in enumerate(poses):
        source_camera(az,el,radius);name=f'hanyuan_{i:03d}.png';path=dataset/'images'/name
        scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
        transform=T @ scene.camera.matrix_world
        records.append({'name':name,'split':'validation'if i%8==7 else'train','azimuth':az,'elevation':el,'radius':radius,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'frame':{'file_path':'images/'+name,'transform_matrix':[list(row)for row in transform]}})
        print('RENDERED',i+1,len(poses),name,flush=True)
    for split,suffix in [('train','train'),('validation','val')]:
        (dataset/f'transforms_{suffix}.json').write_text(json.dumps({**config,'frames':[p['frame']for p in records if p['split']==split]},indent=2),encoding='utf8')
    record={'schema':1,'subject':'大明宫 · 含元殿复原构想','generatedAt':datetime.now(timezone.utc).isoformat(),'inputKind':'locally-authored-multiview-renders','notCapturedPhotographs':True,'notSurveyedRestoration':True,'notSingleImageDepth':True,'notImportedFinishedModel':True,'authoringScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,'geometryVertices':len(obj.data.vertices),'geometryPolygons':len(obj.data.polygons),'seedPointCount':seed_count,'seedSha256':hashlib.sha256((dataset/'init.ply').read_bytes()).hexdigest(),'seedMethod':'Area-weighted sampling of locally authored geometric surfaces, converted from Blender Z-up to Y-up; source geometry is creative, not observed or surveyed.','photoCount':len(records),'intrinsics':config,'views':records,'limitations':'Architectural interpretation generated for visual experience. No surveyed ancient building, measured dimensions, current site capture, archaeological restoration verification, or invented real photo coverage.'}
    (BASE/'preparation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
    print('GENERATED_DATASET',len(records),seed_count,'consistent authored 3D seed points',flush=True)


if __name__=='__main__':main()
