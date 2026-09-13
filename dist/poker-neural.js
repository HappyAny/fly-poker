/* The map renders actual fresh readout counts. It never invents activity between observations. */
(function(root) {
  'use strict';
  class PokerNeural {
    constructor() {
      this.canvas = document.getElementById('pokerNeuralCanvas'); this.ctx = this.canvas?.getContext('2d');
      this.sample = null; this.points = null; this.history = []; this.mode = 'idle'; this.pending = 0;
      this.text = (id, value, values = {}) => root.PokerI18n.text(document.getElementById(id), value, values);
      this.resize = () => this.draw();
      if (typeof ResizeObserver === 'function' && this.canvas) {this.observer = new ResizeObserver(this.resize); this.observer.observe(this.canvas);}
      fetch(new URL('data/live-policy.json', document.baseURI)).then(r => {if (!r.ok) throw new Error('Map unavailable'); return r.json();}).then(data => {
        if (data.n !== 1411 || data.readoutXY.length !== 1411) throw new Error('Map mismatch'); this.points = data;
        const all=[...data.backdrop,...data.readoutXY];this.bounds=[0,1].map(axis=>[Math.min(...all.map(p=>p[axis])),Math.max(...all.map(p=>p[axis]))]);this.draw();
      }).catch(() => this.text('neuralHint', '活动数字仍来自本机计算；分布图暂未载入。'));
      this.clear();
    }
    clear() {
      this.sample = null; this.history = []; this.mode = 'idle'; this.observations = 0;
      this.text('neuralPhase', '等待开局'); this.text('neuralActive', '—'); this.text('neuralOutputs', '—'); this.text('neuralSamples', '0');
      this.text('neuralHint', '思考时实时更新 · 1,411 路输出'); this.queue();
    }
    begin() {
      this.mode = 'planning'; this.history = []; this.observations = 0; this.sample = null;
      this.text('neuralPhase', '正在推演'); this.text('neuralSamples', '0'); this.text('neuralActive', '—'); this.text('neuralOutputs', '—');
      this.text('neuralHint', '推演完成后，开始计算神经响应。'); this.queue();
    }
    receive(message) {
      if (!Array.isArray(message.response)) return;
      this.mode = 'live'; this.sample = {r: message.response, active: message.active}; this.observations = message.observations;
      this.history.push(message.response.length); if (this.history.length > 60) this.history.shift();
      this.text('neuralPhase', '正在比较 {candidate}/{total}', {candidate:message.candidate, total:message.total});
      this.text('neuralHint', '亮点是这一候选刚算出的神经响应。'); this.numbers(); this.queue();
    }
    selected(result) {
      if (!Array.isArray(result.response)) return;
      this.sample = {r: result.response, active: result.active}; this.observations = result.observations; this.mode = 'selected';
      this.text('neuralPhase', '已选定出法'); this.text('neuralHint', '保留选中出法的真实响应'); this.numbers(); this.queue();
    }
    rest(label = '等待你的出牌') {
      this.mode = 'idle'; this.text('neuralPhase', label);
      this.text('neuralHint', this.sample ? '上一手响应 · 当前没有继续计算' : '思考时实时更新 · 1,411 路输出'); this.queue();
    }
    numbers() {
      this.text('neuralActive', Number.isFinite(this.sample?.active) ? this.sample.active.toLocaleString(root.PokerI18n.language) : '—');
      this.text('neuralOutputs', this.sample ? `${this.sample.r.length}/1,411` : '—'); this.text('neuralSamples', String(this.observations || 0));
    }
    queue() {
      if (this.pending || !this.ctx) return;
      this.pending = requestAnimationFrame(() => {this.pending = 0; this.draw();});
    }
    draw() {
      if (!this.ctx || !this.canvas) return;
      const rect = this.canvas.getBoundingClientRect(), w = Math.max(1, rect.width), h = Math.max(1, rect.height), dpr = Math.min(2, root.devicePixelRatio || 1);
      if (this.canvas.width !== Math.round(w*dpr) || this.canvas.height !== Math.round(h*dpr)) {this.canvas.width = Math.round(w*dpr); this.canvas.height = Math.round(h*dpr);}
      const c = this.ctx; c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,w,h);
      if (!this.points) return;
      const mapHeight = h-20, [bx,by]=this.bounds, scale=Math.min(w*.9/(bx[1]-bx[0]),mapHeight*.88/(by[1]-by[0]));
      const xy=p=>[w*.5+(p[0]-(bx[0]+bx[1])*.5)*scale,mapHeight*.5+(p[1]-(by[0]+by[1])*.5)*scale];
      c.fillStyle = '#7eb0a02c';
      for (const p of this.points.backdrop) {const [x,y]=xy(p); c.fillRect(x,y,1,1);}
      c.fillStyle = '#a6d0b442';
      for (const p of this.points.readoutXY) {const [x,y]=xy(p); c.fillRect(x,y,1,1);}
      const live = this.mode === 'live';
      for (const [index,count] of this.sample?.r || []) {
        const p = this.points.readoutXY[index]; if (!p || !Number.isFinite(count) || count <= 0) continue;
        const [x,y]=xy(p), radius=.7+Math.min(2.5,Math.log1p(count)*.7);
        c.fillStyle = live ? '#d4ffb1' : '#a9d6af'; c.globalAlpha = live ? .94 : .65;
        c.beginPath(); c.arc(x,y,radius,0,Math.PI*2); c.fill();
      }
      c.globalAlpha=1; c.strokeStyle='#3e6254'; c.beginPath();c.moveTo(0,h-17);c.lineTo(w,h-17);c.stroke();
      if (this.history.length) {
        c.beginPath(); c.strokeStyle='#ffb47d'; c.lineWidth=1.5;
        this.history.forEach((value,i)=> {const x=4+i*(w-8)/Math.max(59,this.history.length-1),y=h-3-Math.min(1,value/1411)*12; i?c.lineTo(x,y):c.moveTo(x,y);}); c.stroke();
      }
    }
    destroy() {if (this.pending) cancelAnimationFrame(this.pending); this.observer?.disconnect();}
  }
  root.PokerNeural = PokerNeural;
})(globalThis);
