import{readFileSync as a,readdirSync as b,mkdirSync as c,writeFileSync as d}from"node:fs";
let S,D,E=process.env,L;
const I=E.MAKEFUN_INPUT_DIR??"/input",O=E.MAKEFUN_OUTPUT_DIR??"/output";
function fd(p,B,e){let v=new Set([p]),q=[p],m=new Map();for(let h=0;h<q.length;h++){let x=q[h];for(let i=0;i<4;i++){let y=x+D[i];if(L[y]!="#"&L[y]!="\n"&!B.includes(y)&(y/S|0)!=e&!v.has(y)){v.add(y);q.push(y);m.set(y,[x,i])}}}return[v,m]}
function lv(G,cs){let v=new Set(G),q=[...G];for(let h=0;h<q.length;h++){let y=q[h];for(let i=0;i<4;i++){let x=y-D[i],z=x-D[i];if(cs.has(x)&!v.has(x)&L[z]!="#"&L[z]!="\n"){v.add(x);q.push(x)}}}return v}
function K(B,v){return B+","+Math.min(...v)}
function rm(B0,G,cs,st){
 let V=lv(G,cs),q=[[B0,fd(st,B0)[0],[]]],sn=new Set([K(B0,q[0][1])]);
 for(let h=0;h<q.length;h++){
  let[B,v,path]=q[h];
  if(B.every(x=>G.has(x)))return path;
  for(let b of B){
   for(let i=0;i<4;i++){let t=b+D[i];
    if(!cs.has(t)|!V.has(t)|B.includes(t)|!v.has(b-D[i]))continue;
    let N=B.map(x=>x==b?t:x);N.sort();
    let v2=fd(b,N)[0],k2=K(N,v2);
    if(!sn.has(k2)){sn.add(k2);q.push([N,v2,[...path,[b,i]]])}
   }
  }
 }
 return null;
}
function sv(){
 S=L.indexOf("\n")+1;D=[-S,S,-1,1];
 let B=[],G=new Set(),P=0;
 for(let p=0;p<L.length;p++){let c=L[p];if(c=="$"|c=="*")B.push(p);if(c=="."|c=="*")G.add(p);if(c=="@"|c=="+")P=p}
 let hy=(P/S)|0,mv="",GB=[...B];
 for(let x=0;x<S-1;x++)for(let dy of[-1,1]){let y=hy+dy,p=y*S+x;if(L[p]!="#"){let cs=fd(p,[],hy)[0],ps=rm(GB.filter(b=>cs.has(b)),G,cs,P);if(!ps)return"";for(let[b,i]of ps){let[,m]=fd(P,GB),s="",q=b-D[i];while(q!==P){let[z,j]=m.get(q);s="udlr"[j]+s;q=z}mv+=s+"udlr"[i];GB[GB.indexOf(b)]=b+D[i];P=b}}}
 return mv;
}
for(let id of b(I)){L=a(I+"/"+id+"/level.txt","utf8");c(O+"/"+id,{recursive:!0});d(O+"/"+id+"/solution.txt",sv()+"\n")}
