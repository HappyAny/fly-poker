// Full graph, exact resting-state skip, and delay-safe blocks. Portable scalar WASM.
#![allow(static_mut_refs)]
use std::slice;
const REST:f32=-52.0; const AM:f32=0.99501246; const AG:f32=0.9801987; const MIXED:f32=0.0049379353;
struct Brain {
    graph:*const u32,n:usize,rows:usize,edges:usize,groups:usize,readout:usize,nr:usize,
    v:Vec<f32>,g:Vec<f32>,until:Vec<u32>,count:Vec<u32>,mask:Vec<u32>,last_arrival:Vec<u32>,
    current:Vec<usize>,next:Vec<usize>,marked:Vec<u8>,fired:Vec<usize>,queue:Vec<i32>,stim:Vec<usize>,
    output:Vec<u32>,time:u32,seed:u32,cutoff:[u32;4],warmup:u32,connected:bool,visits:u32,peak:u32,spikes:u32,
}
static mut BRAIN:Option<Brain>=None;
#[inline(always)] fn random(seed:u32,node:u32,time:u32)->u32 {
    let mut h=seed^node.wrapping_add(1).wrapping_mul(0x9e3779b9)^time.wrapping_add(1).wrapping_mul(0x85ebca6b);
    h^=h>>16;h=h.wrapping_mul(0x7feb352d);h^=h>>15;h=h.wrapping_mul(0x846ca68b);h^(h>>16)
}
#[no_mangle] pub extern "C" fn allocate(words:usize)->*mut u32 {
    let mut data=vec![0u32;words].into_boxed_slice();let p=data.as_mut_ptr();std::mem::forget(data);p
}
#[no_mangle] pub unsafe extern "C" fn initialize(p:*const u32,words:usize)->u32 {
    if p.is_null()||words<16{return 0;}let a=slice::from_raw_parts(p,words);
    if a[0]!=0x32425946||a[1]!=2||a[10]!=0||a[7] as usize+a[8] as usize!=words{return 0;}
    let n=a[2] as usize;let nr=a[8] as usize;let groups=a[6] as usize;
    BRAIN=Some(Brain{graph:p,n,rows:a[4] as usize,edges:a[5] as usize,groups,readout:a[7] as usize,nr,
        v:vec![REST;n],g:vec![0.;n],until:vec![0;n],count:vec![0;n],mask:vec![0;n],last_arrival:vec![0;n],
        current:Vec::with_capacity(n),next:Vec::with_capacity(n),marked:vec![0;n],fired:Vec::with_capacity(n),queue:vec![0;n*36],
        stim:(0..n).filter(|&i|a[groups+i]<4).collect(),output:vec![0;nr+4],time:0,seed:0,cutoff:[0;4],warmup:400,
        connected:true,visits:0,peak:0,spikes:0});1
}
#[no_mangle] pub unsafe extern "C" fn begin(seed:u32,a:u32,b:u32,c:u32,d:u32,warmup:u32,connected:u32) {
    let b0=BRAIN.as_mut().unwrap();b0.v.fill(REST);b0.g.fill(0.);b0.until.fill(0);b0.count.fill(0);b0.mask.fill(0);
    b0.last_arrival.fill(0);b0.queue.fill(0);b0.marked.fill(0);b0.current.clear();b0.next.clear();b0.fired.clear();
    b0.current.extend_from_slice(&b0.stim);b0.time=0;b0.seed=seed;b0.cutoff=[a,b,c,d];b0.warmup=warmup;
    b0.connected=connected!=0;b0.visits=0;b0.peak=0;b0.spikes=0;
}
#[no_mangle] pub unsafe extern "C" fn step(steps:u32) {
    let b=BRAIN.as_mut().unwrap();let graph=slice::from_raw_parts(b.graph,b.readout+b.nr);let stop=b.time+steps;
    while b.time<stop {
        let start=b.time;let length=(stop-start).min(18);let end=start+length;
        b.peak=b.peak.max(b.current.len() as u32);b.fired.clear();b.next.clear();
        for &i in &b.current {b.marked[i]=0;}
        for &i in &b.current {
            let mut v=b.v[i];let mut g=b.g[i];let mut until=b.until[i];let mut mask=0u32;let group=graph[b.groups+i];
            for k in 0..length {
                let t=start+k;let q=i*36+t as usize%36;
                g+=b.queue[q] as f32*0.275f32;b.queue[q]=0;
                if t>=until&&(v!=REST||g!=0.) {v=(REST+(v+52.0)*AM)+g*MIXED;g*=AG;}
                if group<4&&random(b.seed,i as u32,t)<b.cutoff[group as usize] {v+=68.75;}
                if t>=until&&v> -45.0 {
                    if t>=b.warmup {b.count[i]+=1;b.spikes+=1;}
                    v=REST;g=0.;until=t+if group<4{0}else{22};mask|=1<<k;
                }
            }
            b.visits+=2*length;b.v[i]=v;b.g[i]=g;b.until[i]=until;b.mask[i]=mask;
            if mask!=0 {b.fired.push(i);}
            // Float32 decay can reach a nonzero fixed point. Skip only when the
            // exact next passive update is identical; retain its actual state.
            // New arrivals reactivate it through propagation. No epsilon cutoff.
            let passive_v=(REST+(v+52.0)*AM)+g*MIXED;let passive_g=g*AG;
            if group<4||passive_v!=v||passive_g!=g||v> -45.0||b.last_arrival[i]>=end {b.marked[i]=1;b.next.push(i);}
        }
        if b.connected {for &i in &b.fired {
            for edge in graph[b.rows+i] as usize..graph[b.rows+i+1] as usize {
                let packed=graph[b.edges+edge];let post=(packed&0x3ffff) as usize;let weight=(packed as i32)>>18;
                let mut mask=b.mask[i];
                while mask!=0 {
                    let time=start+mask.trailing_zeros()+18;mask&=mask-1;
                    b.queue[post*36+time as usize%36]+=weight;b.last_arrival[post]=b.last_arrival[post].max(time);
                }
                if b.marked[post]==0 {b.marked[post]=1;b.next.push(post);}
            }
        }}
        std::mem::swap(&mut b.current,&mut b.next);b.time=end;
    }
}
// Begin a new observation while preserving membrane state and all delayed events.
#[no_mangle] pub unsafe extern "C" fn frame(a:u32,b:u32,c:u32,d:u32,connected:u32) {
    let brain=BRAIN.as_mut().unwrap();brain.cutoff=[a,b,c,d];brain.connected=connected!=0;
    brain.count.fill(0);brain.visits=0;brain.peak=0;brain.spikes=0;brain.warmup=0;
}
#[no_mangle] pub unsafe extern "C" fn finish()->*const u32 {
    let b=BRAIN.as_mut().unwrap();let a=slice::from_raw_parts(b.graph,b.readout+b.nr);
    for i in 0..b.nr {b.output[i]=b.count[a[b.readout+i] as usize];}
    b.output[b.nr]=b.count.iter().filter(|&&v|v>0).count() as u32;b.output[b.nr+1]=b.visits;
    b.output[b.nr+2]=b.peak;b.output[b.nr+3]=b.spikes;b.output.as_ptr()
}
#[no_mangle] pub unsafe extern "C" fn states()->*const f32 {BRAIN.as_ref().unwrap().v.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn synaptic_states()->*const f32 {BRAIN.as_ref().unwrap().g.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn all_counts()->*const u32 {BRAIN.as_ref().unwrap().count.as_ptr()}
