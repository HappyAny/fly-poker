"""Losslessly encode the complete graph's integer synapse counts for the browser."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

OUT = ROOT / 'dist' / 'model'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Prepared graph.npz with ids, indptr, indices, weights, stim, stim_group, readout')
    args = parser.parse_args()
    SOURCE = args.source
    data = np.load(SOURCE)
    n, m = len(data['ids']), len(data['indices'])
    assert n < 2**18
    scale = np.float32(.275)
    units = np.rint(data['weights'].astype(np.float64) / float(scale)).astype(np.int32)
    assert np.array_equal(units.astype(np.float32) * scale, data['weights'])
    assert units.min() >= -(2**13) and units.max() < 2**13
    posts = data['indices'].astype(np.uint32)
    bound = np.bincount(posts, weights=np.abs(units).astype(np.float64), minlength=n).max()
    assert bound < 2**31, 'Integer accumulation must not overflow even if all incoming edges fire.'
    indptr = data['indptr'].astype(np.uint32)
    delta = posts.copy()
    delta[1:] -= posts[:-1]
    starts = np.unique(indptr[:-1][indptr[:-1] < m])
    delta[starts] = posts[starts]
    assert delta.max() < 2**18
    packed = ((units.astype(np.uint32) & 0x3FFF) << 18) | delta
    groups = np.full(n, 4, np.uint32)
    groups[data['stim']] = data['stim_group']
    readout = data['readout'].astype(np.uint32)
    header = np.zeros(16, np.uint32)
    header[:16] = [0x32425946, 2, n, m, 16, 16+n+1, 16+n+1+m,
                   16+n+1+m+n, len(readout), len(data['stim']), 1, 1, 100, 18, 22,
                   int(scale.view(np.uint32))]
    raw = b''.join(array.astype('<u4', copy=False).tobytes() for array in (header, indptr, packed, groups, readout))
    compressed = gzip.compress(raw, compresslevel=7, mtime=0)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'brain.bin').write_bytes(raw)
    (OUT / 'brain.bin.gz').write_bytes(compressed)
    manifest = {
        'format': 'FYB2', 'version': 2, 'neurons': n, 'connections': m,
        'readout': len(readout), 'stimulated': len(data['stim']),
        'bytes': len(raw), 'gzip_bytes': len(compressed),
        'sha256': hashlib.sha256(raw).hexdigest(), 'gzip_sha256': hashlib.sha256(compressed).hexdigest(),
        'source_graph_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'weight_float32_reconstruction_exact': True, 'max_incoming_absolute_units': int(bound),
        'units_min': int(units.min()), 'units_max': int(units.max()),
        'model': {'dt_ms': .1, 'delay_steps': 18, 'refractory_steps': 22,
                  'rest_mv': -52, 'threshold_mv': -45, 'input_jump_mv': 68.75,
                  'tau_membrane_ms': 20, 'tau_synapse_ms': 5, 'weight_mv_per_unit': .275},
        'source': 'Full existing FlyWire-derived graph; all nodes and edges retained. Root identifiers omitted.',
        'numerics': 'Arrival weights sum in exact integer synapse units, then convert to float32 mV. Hash-based Bernoulli inputs are shared by both backends. This changes floating addition order and random streams versus the original Numba implementation.',
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({key: manifest[key] for key in ('neurons','connections','bytes','gzip_bytes','max_incoming_absolute_units')}))


if __name__ == '__main__':
    main()
