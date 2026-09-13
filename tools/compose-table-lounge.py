"""An original 16-bar, 84 BPM lounge loop. No sampled recordings or borrowed melody."""
from pathlib import Path
import hashlib
import json
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

root = Path(__file__).resolve().parents[2] / 'fly-poker'
rate = 44100
bpm = 84
beat = 60 / bpm
bars = 16
length = round(bars * 4 * beat * rate)
mix = np.zeros((length, 2), dtype=np.float64)
rng = np.random.default_rng(73104)

def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)

def place(sound, at, level, pan=0):
    start = round(at * rate)
    indices = (np.arange(len(sound)) + start) % length
    angle = (pan + 1) * np.pi / 4
    mix[indices, 0] += sound * level * np.cos(angle)
    mix[indices, 1] += sound * level * np.sin(angle)

def keys(note, duration=2.8):
    t = np.arange(round(duration * rate)) / rate
    f = frequency(note)
    attack = 1 - np.exp(-t / 0.007)
    body = np.sin(2*np.pi*f*t + .9*np.exp(-t/0.18)*np.sin(2*np.pi*f*2*t))
    body += .16*np.sin(2*np.pi*f*2.002*t)*np.exp(-t/.75)
    body += .06*np.sin(2*np.pi*f*3*t)*np.exp(-t/.25)
    envelope = attack*np.exp(-t/1.15)*np.minimum(1,(duration-t)/.12)
    return body*envelope

def bass(note):
    t = np.arange(round(0.68*rate)) / rate
    f = frequency(note)
    wave = np.sin(2*np.pi*f*t)+.18*np.sin(4*np.pi*f*t)+.035*np.sin(6*np.pi*f*t)
    return wave*(1-np.exp(-t/.008))*np.exp(-t/.22)*np.minimum(1,(.68-t)/.035)

def kick():
    t = np.arange(round(.19*rate))/rate
    phase = 2*np.pi*(47*t + 1.1*(1-np.exp(-t/.023)))
    return np.sin(phase)*(1-np.exp(-t/.002))*np.exp(-t/.039)

def brush():
    t=np.arange(round(.18*rate))/rate
    noise=sosfilt(butter(2,[650,5600],btype='bandpass',fs=rate,output='sos'),rng.standard_normal(len(t)))
    return noise*(1-np.exp(-t/.008))*np.exp(-t/.034)

def shaker():
    t=np.arange(round(.085*rate))/rate
    noise=sosfilt(butter(2,[3800,9500],btype='bandpass',fs=rate,output='sos'),rng.standard_normal(len(t)))
    return noise*(1-np.exp(-t/.002))*np.exp(-t/.014)

# Cmaj9, A minor 9, D minor 9, G13, with related second-half voicings.
progression=[(36,[52,55,59,62]),(36,[52,57,59,62]),(33,[55,59,60,64]),(33,[55,59,62,64]),
             (38,[53,57,60,64]),(38,[53,57,60,64]),(31,[53,57,59,64]),(31,[53,57,59,62]),
             (36,[52,55,59,62]),(40,[55,59,62,66]),(33,[55,59,60,64]),(33,[55,59,62,64]),
             (38,[53,57,60,64]),(31,[53,57,59,64]),(36,[52,55,59,62]),(31,[53,57,59,62])]
melody={0:[(1.55,67),(2.5,71)],1:[(.6,69),(2.55,67)],2:[(1.6,64),(3.1,67)],3:[(2.5,71)],
        4:[(.6,69),(2.6,72)],5:[(1.6,76),(3.2,72)],6:[(.6,71),(2.6,69)],7:[(1.6,67)],
        8:[(.6,64),(2.55,67),(3.15,71)],9:[(1.6,74)],10:[(.6,72),(2.55,71)],11:[(1.6,67)],
        12:[(.6,69),(2.6,72)],13:[(1.6,71),(3.2,69)],14:[(.6,67),(2.55,64)],15:[(1.6,62)]}
for bar,(low,chord) in enumerate(progression):
    start=bar*4*beat
    for offset,velocity in ((0,.115),(1.6,.068),(2.55,.092)):
        for i,note in enumerate(chord):
            place(keys(note),start+offset*beat+i*.012,velocity/len(chord),-.18)
    for offset,note,velocity in ((0,low,.16),(1.5,low+7,.105),(2.5,low+12,.115),(3.5,low+7,.08)):
        place(bass(note),start+offset*beat,velocity,-.03)
    for offset,note in melody.get(bar,[]):
        place(keys(note,1.9),start+offset*beat,.065,.2)
    for position in range(8):
        # Very light swung eighths. The loop is arranged to remain quiet behind play.
        at=(position//2 + (.58 if position%2 else 0))*beat
        place(shaker(),start+at,.016 if position%2 else .024,.35)
    for offset in (0,2): place(kick(),start+offset*beat,.095,0)
    for offset in (1,3): place(brush(),start+offset*beat,.025,-.23)

# Short circular room reflections keep the exact musical loop length.
dry=mix.copy()
for delay,gain in ((.051,.10),(.089,.075),(.137,.045)):
    mix[:,0]+=np.roll(dry[:,1],round(delay*rate))*gain
    mix[:,1]+=np.roll(dry[:,0],round((delay+.013)*rate))*gain
mix=sosfilt(butter(2,8500,fs=rate,output='sos'),mix,axis=0)
mix-=mix.mean(axis=0)
peak=float(np.abs(mix).max())
mix*=.72/peak
mix=np.tanh(mix*1.04)/1.04
file=root/'dist/audio/table-lounge.mp3'
sf.write(file,mix,rate,format='MP3',subtype='MPEG_LAYER_III',bitrate_mode='CONSTANT',compression_level=.4)
decoded,decoded_rate=sf.read(file)
assert decoded_rate==rate and decoded.ndim==2 and decoded.shape[1]==2
assert np.isfinite(decoded).all() and np.max(np.abs(decoded))<.98
report={'title':'Green Felt, Slow Hands','composer':'Original procedural composition for Fly Poker',
        'sampledRecordings':False,'borrowedMelody':False,'bpm':bpm,'bars':bars,
        'sampleRate':rate,'durationSeconds':len(decoded)/rate,'peak':float(np.max(np.abs(decoded))),
        'rms':float(np.sqrt(np.mean(decoded**2))),'bytes':file.stat().st_size,
        'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),
        'instrumentation':['soft electric piano','plucked bass','brushed percussion'],
        'arrangement':'16-bar original lounge loop, subtle swing, no vocals'}
(root/'release/music-master.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
