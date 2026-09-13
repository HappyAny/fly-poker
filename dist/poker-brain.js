(function(root) {
  'use strict';
  class PokerBrain {
    constructor(onStatus = () => {}) {this.onStatus = onStatus; this.pending = new Map(); this.nextId = 1; this.epoch = 0; this.ready = false;}
    init() {
      if (this.ready) return Promise.resolve({backend: this.backend});
      if (this.initializing) return this.initializing;
      try {
        this.worker ??= new Worker(new URL('poker-worker.mjs', document.baseURI), {type: 'module'});
        this.worker.onmessage = event => {
          const message = event.data;
          if (message.type === 'status') {
            if (message.epoch !== undefined && message.epoch !== this.epoch) return;
            if (message.requestId !== undefined && !this.pending.has(message.requestId)) return;
            if (message.backend) this.backend = message.backend; this.onStatus(message); return;
          }
          const request = this.pending.get(message.id); if (!request) return;
          this.pending.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.value);
        };
        this.worker.onerror = () => {this.ready = false; this.fail(new Error('计算进程已停止，请重新载入。')); this.worker?.terminate(); this.worker = null;};
        this.worker.postMessage({type: 'cancel', epoch: this.epoch});
      } catch (error) {return Promise.reject(error);}
      this.initializing = this.request('init').then(value => {this.ready = true; this.backend = value.backend; return value;}).finally(() => {this.initializing = null;});
      return this.initializing;
    }
    request(type, args = {}) {
      return new Promise((resolve, reject) => {
        const id = this.nextId++; this.pending.set(id, {resolve, reject, type});
        try {this.worker.postMessage({id, type, epoch: this.epoch, ...args});}
        catch (error) {this.pending.delete(id); reject(error);}
      });
    }
    choose(view, profile) {return this.request('choose', {view, profile});}
    cancel() {
      this.epoch++; this.worker?.postMessage({type: 'cancel', epoch: this.epoch});
      for (const [id, request] of this.pending) if (request.type === 'choose') {request.reject(new Error('Simulation cancelled')); this.pending.delete(id);}
    }
    fail(error) {for (const request of this.pending.values()) request.reject(error); this.pending.clear();}
    destroy() {this.cancel(); this.fail(new Error('Closed')); this.worker?.terminate(); this.worker = null; this.ready = false;}
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = PokerBrain;
  root.PokerBrain = PokerBrain;
})(globalThis);
