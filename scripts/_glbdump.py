import json, struct, sys
from mathutils import Matrix, Quaternion, Vector
def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n])
def world(j):
    nodes = j['nodes']; par = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): par[c] = i
    W = {}
    def get(i):
        if i in W: return W[i]
        n = nodes[i]
        if 'matrix' in n: M = Matrix([n['matrix'][r::4] for r in range(4)])
        else:
            q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1]); t = n.get('translation', [0, 0, 0])
            M = Matrix.Translation(t) @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
        W[i] = (get(par[i]) if i in par else Matrix.Identity(4)) @ M
        return W[i]
    return {n.get('name', i): get(i) for i, n in enumerate(nodes)}, par, nodes
