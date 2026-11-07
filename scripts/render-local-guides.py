"""Render one curated ride with pinned Kokoro weights on the local CUDA GPU.
No hosted speech API. Python 3.10–3.12; see docs/rides/oxford-last-page.md.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'f3ff3571791e39611d31c381e3a41a3af07b4987'
MODEL = 'hexgrad/Kokoro-82M'
VOICE = 'bm_george'
SPEED = 1.0
ARTIFACTS = {
    'kokoro-v1_0.pth': ('496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4', 327212226),
    'voices/bm_george.pt': ('f1bc812213dc59774769e5c80004b13eeb79bd78130b11b2d7f934542dab811b', 523430),
}


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def artifact(cache, name):
    target = cache / name
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = ARTIFACTS.get(name)
    if target.exists() and expected:
        if (hashlib.sha256(target.read_bytes()).hexdigest(), target.stat().st_size) == expected:
            return target
    elif target.exists():
        return target
    part = target.with_suffix(target.suffix + '.part')
    subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--continue-at', '-',
                    '--output', str(part), f'https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}'], check=True)
    if expected and (hashlib.sha256(part.read_bytes()).hexdigest(), part.stat().st_size) != expected:
        raise RuntimeError(f'Checksum/size mismatch: {part}')
    part.replace(target)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--route-prefix', required=True, help='Unique ride name prefix')
    parser.add_argument('--force', action='store_true', help='Replace audio even when voice/text match')
    args = parser.parse_args()
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA GPU required; no silent CPU fallback')
    torch.set_num_threads(2)
    cache = Path(os.environ.get('OPENRIDE_TTS_CACHE', Path.home() / '.cache/openride-tts')) / REVISION
    config = artifact(cache, 'config.json')
    weights = artifact(cache, 'kokoro-v1_0.pth')
    voice = artifact(cache, f'voices/{VOICE}.pt')
    model = KModel(repo_id=MODEL, config=str(config), model=str(weights)).to('cuda').eval()
    pipeline = KPipeline(lang_code='b', repo_id=MODEL, model=model, device='cuda')
    manifest = ROOT / 'backend/routes/starter-routes.json'
    routes = json.loads(manifest.read_text())
    matches = [r for r in routes if r['name'].startswith(args.route_prefix)]
    if len(matches) != 1:
        raise ValueError('The route prefix must match exactly one ride')
    route, = matches
    directory = ROOT / 'backend/routes/audio' / route['id']
    directory.mkdir(parents=True, exist_ok=True)
    signature = f'{MODEL}@{REVISION}:{VOICE}:speed={SPEED}:pcm16-24000:v1'
    rendered_count = 0
    for stop in route['guide']['stops']:
        path = directory / (stop['id'] + '.wav')
        stamp = directory / (stop['id'] + '.sha256')
        recipe = directory / (stop['id'] + '.tts.json')
        fingerprint = dict(textSha256=digest(stop['text']), renderer=signature)
        reusable = path.exists() and stamp.exists() and recipe.exists()
        if reusable:
            reusable = stamp.read_text() == digest(stop['text']) and json.loads(recipe.read_text()) == fingerprint
        if args.force or not reusable:
            parts = []
            with torch.inference_mode():
                for result in pipeline(stop['text'], voice=str(voice), speed=SPEED, split_pattern=r'\n+'):
                    parts.append(result.audio.detach().cpu().numpy())
            if not parts:
                raise RuntimeError(f'No speech: {stop["title"]}')
            audio = np.concatenate(parts)
            pcm = (np.clip(audio, -1, 1) * 32767).round().astype('<i2')
            seconds = len(pcm) / 24000
            if not 10 < seconds < 65 or 44 + pcm.nbytes >= 3 * 1024 * 1024:
                raise RuntimeError(f'Clip exceeds ride limits: {stop["title"]}, {seconds}s')
            temporary = path.with_suffix('.wav.part')
            with wave.open(str(temporary), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                wav.writeframes(pcm.tobytes())
            temporary.replace(path)
            rendered_count += 1
            stamp.write_text(digest(stop['text']))
            recipe.write_text(json.dumps(fingerprint, indent=2) + '\n')
        with wave.open(str(path), 'rb') as wav:
            stop['audioSeconds'] = wav.getnframes() / wav.getframerate()
        print(f'{stop["distanceKm"]:5.2f} km | {stop["audioSeconds"]:5.2f}s | {stop["title"]}', flush=True)
    # Use JavaScript's number serialisation, not Python's float formatting.
    route_hash = subprocess.check_output(['node', '--input-type=module', '-e',
        "import {createHash} from 'node:crypto';let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s);process.stdout.write(createHash('sha256').update(JSON.stringify(p.map(p=>[p.lat,p.lng,p.ele,p.distanceFromStart]))).digest('hex'));"], input=json.dumps(route['points']).encode()).decode()
    revision = digest(json.dumps(route['guide']['stops'], sort_keys=True) + signature)
    gid = str(uuid.uuid5(uuid.NAMESPACE_URL, route['id'] + '/local-tts/' + revision))
    gid = gid[:14] + '4' + gid[15:]
    route['routeHash'] = route['guide']['routeHash'] = route_hash
    route['guide'].update(id=gid, speechModel=f'{MODEL}@{REVISION} (PyTorch CUDA)', voice=VOICE)
    temp = manifest.with_suffix('.json.tmp')
    temp.write_text(json.dumps(routes, ensure_ascii=False, separators=(',', ':')))
    temp.replace(manifest)
    report = dict(model=MODEL, revision=REVISION, voice=VOICE, speed=SPEED,
                  device=torch.cuda.get_device_name(0), torch=torch.__version__,
                  peakAllocatedMiB=round(torch.cuda.max_memory_allocated() / 1024**2, 1),
                  clips=len(route['guide']['stops']),
                  narrationSeconds=sum(s['audioSeconds'] for s in route['guide']['stops']))
    report_path = directory / 'generation.json'
    if rendered_count or not report_path.exists():
        report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Rendered this run: {rendered_count}; reused: {len(route["guide"]["stops"]) - rendered_count}')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
