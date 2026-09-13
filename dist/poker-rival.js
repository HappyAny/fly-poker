/* Public presentation state only: unplayed card identities never enter the 3D scene. */
(function(root) {
  'use strict';
  const MODES = new Set(['idle','watching','thinking','passing','win','lose']);
  const LABELS = {idle:'等你入座',watching:'看着桌上的牌',thinking:'低头琢磨这一手',passing:'这手先让一让',win:'赢了，跳一段！',lose:'垂头丧气中…'};
  const actionDuration = (count, reduced = false) => reduced ? 120 : count ? 200 + 160*count + 420 : 460;
  function actionPose(count, elapsed, reduced = false) {
    const duration = actionDuration(count,reduced), t = Math.max(0,Math.min(elapsed,duration));
    if (reduced) return {selected:count,push:1,index:Math.max(0,count-1),reach:1,complete:t>=duration};
    if (!count) return {selected:0,push:0,index:0,reach:Math.sin(t/duration*Math.PI),complete:t>=duration};
    const step = Math.max(0,t-200)/160, selected = Math.min(count,Math.floor(step)+Number(step%1>.15));
    return {selected,index:Math.min(count-1,Math.floor(step)),reach:Math.min(1,step%1*2),push:Math.max(0,Math.min(1,(t-200-160*count)/420)),complete:t>=duration};
  }
  class PokerRival {
    constructor() {
      this.element = document.getElementById('rivalWindow'); this.canvas = document.getElementById('rivalCanvas');
      this.state = {mode:'idle',count:13,paused:false,cards:[],actor:null}; this.visible = true; this.collapsed = false;
      this.reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
      const label = document.getElementById('rivalMood'); this.label = (text,values={}) => root.PokerI18n.text(label,text,values);
      this.element?.setAttribute('data-pose','idle');
      this.toggle = document.getElementById('rivalToggle');
      this.toggle?.addEventListener('click',() => {
        this.collapsed=!this.collapsed; this.element.classList.toggle('collapsed',this.collapsed);
        this.toggle.setAttribute('aria-expanded',String(!this.collapsed)); root.PokerI18n.text(this.toggle,this.collapsed?'展开':'收起'); this.renderer?.visibility(!this.collapsed&&this.visible);
      });
      if (typeof IntersectionObserver === 'function' && this.canvas) {
        this.observer = new IntersectionObserver(entries => {this.visible=entries[0].isIntersecting;this.renderer?.visibility(this.visible&&!this.collapsed);}); this.observer.observe(this.canvas);
      }
      this.ready = import('./poker-scene.mjs').then(({FlyScene}) => {
        if (this.destroyed) return;
        this.renderer = new FlyScene(this.canvas,{reduced:this.reduced,onError:()=>this.fallback()});
        this.renderer.sync(this.state); this.renderer.visibility(this.visible&&!this.collapsed);
        this.element?.setAttribute('data-renderer','webgl2'); document.getElementById('rivalFallback').hidden=true;
        this.canvas.hidden=false;
      }).catch(() => this.fallback());
    }
    fallback() {
      this.renderer?.dispose(); this.renderer=null;
      if (this.canvas) this.canvas.hidden=true;
      const fallback=document.getElementById('rivalFallback'); if (fallback) fallback.hidden=false;
      this.element?.setAttribute('data-renderer','fallback'); this.label('3D 暂不可用 · 牌局照常进行');
    }
    reset(count=13) {this.state={mode:'idle',count,paused:false,cards:[],actor:null};this.element?.setAttribute('data-pose','idle');this.renderer?.reset(this.state);this.label(LABELS.idle);}
    mode(value) {
      if (!MODES.has(value)) return;
      this.state.mode=value;this.element?.setAttribute('data-pose',value);this.label(LABELS[value]);this.renderer?.sync(this.state);
    }
    pause(value) {this.state.paused=Boolean(value);this.renderer?.sync(this.state);}
    cancel() {this.renderer?.cancelAction();}
    preparePlay(count) {
      if (!Number.isInteger(count)||count<0||count>this.state.count) throw new Error('Invalid public action size');
      if (!this.renderer||!this.visible||this.collapsed||this.state.paused) return 0;
      const duration=actionDuration(count,this.reduced);
      this.element?.setAttribute('data-pose',count?'selecting':'passing');this.label(count?'一张张选好 · 准备出 {count} 张':'这手先让一让',{count});
      this.renderer.beginAction(count,duration);return duration;
    }
    commit({actor,cards,pass,count}) {
      this.state.count=count;
      if (!pass) {this.state.cards=[...cards];this.state.actor=actor;}
      this.renderer?.commit({actor,cards:[...cards],pass,count});
      if (pass&&actor===1) this.mode('passing');
    }
    neural(active) {if(Number.isFinite(active))this.renderer?.neural(active);}
    destroy() {this.destroyed=true;this.observer?.disconnect();this.renderer?.dispose();}
  }
  root.PokerRival=PokerRival;root.PokerMotion={actionDuration,actionPose};
  if (typeof module!=='undefined'&&module.exports)module.exports={actionDuration,actionPose};
})(globalThis);
